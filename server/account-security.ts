import type { Express, Request, Response, RequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "socket.io";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import { loadAccountSecurityKey } from "./security-key.js";
import type {
  AccountSession,
  SecurityStatus,
} from "../shared/security-types.js";

const CHALLENGE_COOKIE = "mola_2fa";
const SESSION_COOKIE = "mola_session";
const CHALLENGE_MS = 5 * 60_000;
const SETUP_MS = 10 * 60_000;
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const passwordInput = z.string().min(1).max(128);
const codeInput = z.string().trim().min(6).max(32);

export function migrateAccountSecurity(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_security (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret_cipher TEXT, enabled_at INTEGER, generation TEXT,
      last_counter INTEGER NOT NULL DEFAULT -1,
      pending_cipher TEXT, pending_session TEXT, pending_password TEXT, pending_expires INTEGER,
      pending_attempts INTEGER NOT NULL DEFAULT 0,
      factor_attempts INTEGER NOT NULL DEFAULT 0, factor_window INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS security_login_challenges (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      password_fingerprint TEXT NOT NULL, generation TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_security_challenges_user ON security_login_challenges(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_challenges_expiry ON security_login_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS security_recovery_codes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, PRIMARY KEY(user_id,code_hash)
    );
    CREATE TABLE IF NOT EXISTS session_devices (
      token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      id TEXT NOT NULL UNIQUE, device TEXT NOT NULL,
      created_at INTEGER, last_seen_at INTEGER
    );
    INSERT OR IGNORE INTO session_devices(token_hash,id,device,created_at,last_seen_at)
      SELECT token_hash,lower(hex(randomblob(16))),'Önceden açılmış oturum',NULL,NULL FROM sessions;
  `);
}

/** RFC 6238 / RFC 4226: SHA-1, 30-second steps and dynamic truncation. */
export function totpCode(secret: Buffer, time: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}

export function base32Secret(secret: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "Gönderdiğin bilgileri kontrol et.");
  return result.data;
}

export interface AccountSecurityOptions {
  repo: Repository;
  io: Server;
  authenticate: RequestHandler;
  verifyPassword: (password: string, stored: string | null) => Promise<boolean>;
  startSession: (req: Request, res: Response, userId: string) => void;
  dataDir: string;
  production: boolean;
  encryptionKey?: string;
  now?: () => number;
}

export function installAccountSecurity(
  app: Express,
  options: AccountSecurityOptions,
) {
  const { repo, io, authenticate, verifyPassword, startSession, production } =
    options;
  const now = options.now || Date.now;
  const configured = options.encryptionKey || process.env.MAIL_ENCRYPTION_KEY;
  if (
    !configured &&
    !existsSync(join(options.dataDir, ".account-security-key")) &&
    repo.get(
      "SELECT 1 FROM account_security WHERE secret_cipher IS NOT NULL OR pending_cipher IS NOT NULL",
    )
  )
    throw new Error(
      "Account security key is missing. Restore the original key before starting Mola.",
    );
  const master = loadAccountSecurityKey(options.dataDir, options.encryptionKey);
  const key = Buffer.from(
    hkdfSync("sha256", master, Buffer.alloc(0), "mola/account-security/v1", 32),
  );
  const seal = (secret: Buffer, aad: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  };
  const unseal = (value: string, aad: string): Buffer => {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    cipher.setAAD(Buffer.from(aad));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
  };
  // A replaced/missing key must fail deployment, never silently disable protection.
  for (const row of repo.all(
    "SELECT user_id,secret_cipher,pending_cipher FROM account_security",
  )) {
    try {
      if (row.secret_cipher) unseal(row.secret_cipher, `${row.user_id}:active`);
      if (row.pending_cipher)
        unseal(row.pending_cipher, `${row.user_id}:pending`);
    } catch {
      throw new Error(
        "Account security secrets could not be decrypted. Restore the original encryption key.",
      );
    }
  }
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: "/api/auth",
  };
  const account = (userId: string) =>
    repo.get("SELECT * FROM account_security WHERE user_id=?", userId);
  const ensureAccount = (userId: string) =>
    repo.run(
      "INSERT OR IGNORE INTO account_security(user_id) VALUES(?)",
      userId,
    );
  const clearChallenges = (userId: string) =>
    repo.run("DELETE FROM security_login_challenges WHERE user_id=?", userId);
  const currentSession = (req: Request): Row => {
    const user = req.sessionHash && repo.session(req.sessionHash);
    if (!user || user.id !== req.auth?.id || user.suspended_at)
      throw new HttpError(401, "Oturumun sona erdi. Yeniden giriş yap.");
    return user;
  };
  const requirePassword = async (
    req: Request,
    password: string,
  ): Promise<Row> => {
    const user = currentSession(req);
    if (!user.password_hash)
      throw new HttpError(
        403,
        "Güvenlik ayarları için kendi hesabınla giriş yap.",
      );
    if (!(await verifyPassword(password, user.password_hash)))
      throw new HttpError(401, "Mevcut parolan hatalı.");
    const fresh = currentSession(req);
    if (fresh.password_hash !== user.password_hash)
      throw new HttpError(401, "Parolan değişti. Yeniden giriş yap.");
    return fresh;
  };
  const matchCounter = (
    secret: Buffer,
    code: string,
    last: number,
  ): number | undefined => {
    if (!/^\d{6}$/.test(code)) return undefined;
    const counter = Math.floor(now() / 30_000);
    for (const candidate of [counter, counter - 1, counter + 1]) {
      if (candidate <= last || candidate < 0) continue;
      if (
        timingSafeEqual(
          Buffer.from(totpCode(secret, candidate * 30_000)),
          Buffer.from(code),
        )
      )
        return candidate;
    }
    return undefined;
  };
  const consumeFactor = (userId: string, code: string): boolean => {
    const row = account(userId);
    if (!row?.enabled_at || !row.secret_cipher) return false;
    const freshWindow = now() - row.factor_window >= WINDOW_MS;
    if (!freshWindow && row.factor_attempts >= MAX_ATTEMPTS)
      throw new HttpError(
        429,
        "Çok fazla doğrulama denemesi. 15 dakika sonra yeniden dene.",
      );
    repo.run(
      "UPDATE account_security SET factor_attempts=?,factor_window=? WHERE user_id=?",
      freshWindow ? 1 : row.factor_attempts + 1,
      freshWindow ? now() : row.factor_window,
      userId,
    );
    const counter = matchCounter(
      unseal(row.secret_cipher, `${userId}:active`),
      code,
      row.last_counter,
    );
    if (counter !== undefined) {
      repo.run(
        "UPDATE account_security SET last_counter=?,factor_attempts=0,factor_window=0 WHERE user_id=?",
        counter,
        userId,
      );
      return true;
    }
    const normalized = code.toUpperCase().replace(/[\s-]/g, "");
    if (/^[A-F0-9]{20}$/.test(normalized)) {
      const result = repo.run(
        "DELETE FROM security_recovery_codes WHERE user_id=? AND code_hash=?",
        userId,
        hash(`${userId}:${normalized}`),
      );
      if (Number(result.changes) === 1) {
        repo.run(
          "UPDATE account_security SET factor_attempts=0,factor_window=0 WHERE user_id=?",
          userId,
        );
        return true;
      }
    }
    return false;
  };
  const recoveryCodes = (userId: string): string[] => {
    repo.run("DELETE FROM security_recovery_codes WHERE user_id=?", userId);
    return Array.from({ length: 10 }, () => {
      const raw = randomBytes(10).toString("hex").toUpperCase();
      repo.run(
        "INSERT INTO security_recovery_codes(user_id,code_hash) VALUES(?,?)",
        userId,
        hash(`${userId}:${raw}`),
      );
      return raw.match(/.{1,5}/g)!.join("-");
    });
  };
  const revokeOthers = (userId: string, currentHash: string) => {
    const rows = repo.all(
      "SELECT token_hash FROM sessions WHERE user_id=? AND token_hash!=?",
      userId,
      currentHash,
    );
    repo.run(
      "DELETE FROM sessions WHERE user_id=? AND token_hash!=?",
      userId,
      currentHash,
    );
    for (const row of rows)
      io.in(`session:${row.token_hash}`).disconnectSockets(true);
  };
  const securityLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Çok fazla güvenlik işlemi. 15 dakika sonra yeniden dene.",
    },
  });
  const status = (userId: string): SecurityStatus => {
    const row = account(userId);
    return {
      enabled: Boolean(row?.enabled_at),
      enabledAt: row?.enabled_at ?? null,
      recoveryCodesRemaining: Number(
        repo.get(
          "SELECT count(*) AS n FROM security_recovery_codes WHERE user_id=?",
          userId,
        )!.n,
      ),
    };
  };

  app.get("/api/account/security", authenticate, (req, res) => {
    currentSession(req);
    res.json(status(req.auth!.id));
  });
  app.post(
    "/api/account/security/setup",
    authenticate,
    securityLimiter,
    async (req, res) => {
      const { password } = parse(
        z.object({ password: passwordInput }).strict(),
        req.body,
      );
      const user = await requirePassword(req, password);
      if (account(user.id)?.enabled_at)
        throw new HttpError(409, "İki aşamalı doğrulama zaten açık.");
      ensureAccount(user.id);
      const secret = randomBytes(20);
      const expiresAt = now() + SETUP_MS;
      repo.run(
        "UPDATE account_security SET pending_cipher=?,pending_session=?,pending_password=?,pending_expires=?,pending_attempts=0 WHERE user_id=?",
        seal(secret, `${user.id}:pending`),
        req.sessionHash!,
        hash(user.password_hash),
        expiresAt,
        user.id,
      );
      const encoded = base32Secret(secret);
      res.json({
        secret: encoded,
        uri: `otpauth://totp/${encodeURIComponent(`Mola:${user.email}`)}?secret=${encoded}&issuer=Mola&algorithm=SHA1&digits=6&period=30`,
        expiresAt,
      });
    },
  );
  app.post(
    "/api/account/security/enable",
    authenticate,
    securityLimiter,
    (req, res) => {
      const { code } = parse(z.object({ code: codeInput }).strict(), req.body);
      const user = currentSession(req);
      const row = account(user.id);
      if (row?.enabled_at)
        throw new HttpError(409, "İki aşamalı doğrulama zaten açık.");
      if (
        !row?.pending_cipher ||
        row.pending_session !== req.sessionHash ||
        row.pending_password !== hash(user.password_hash || "") ||
        row.pending_expires <= now() ||
        row.pending_attempts >= MAX_ATTEMPTS
      )
        throw new HttpError(
          400,
          "Kurulumun süresi doldu. Parolanla yeniden başlat.",
        );
      repo.run(
        "UPDATE account_security SET pending_attempts=pending_attempts+1 WHERE user_id=?",
        user.id,
      );
      const secret = unseal(row.pending_cipher, `${user.id}:pending`);
      const counter = matchCounter(secret, code, -1);
      if (counter === undefined)
        throw new HttpError(
          400,
          "Kod geçersiz. Doğrulama uygulamandaki güncel kodu kullan.",
        );
      const codes = repo.transaction(() => {
        repo.run(
          "UPDATE account_security SET secret_cipher=?,enabled_at=?,generation=?,last_counter=?,pending_cipher=NULL,pending_session=NULL,pending_password=NULL,pending_expires=NULL,pending_attempts=0,factor_attempts=0,factor_window=0 WHERE user_id=?",
          seal(secret, `${user.id}:active`),
          now(),
          randomUUID(),
          counter,
          user.id,
        );
        clearChallenges(user.id);
        return recoveryCodes(user.id);
      });
      revokeOthers(user.id, req.sessionHash!);
      res.json({ recoveryCodes: codes });
    },
  );
  app.post(
    "/api/account/security/disable",
    authenticate,
    securityLimiter,
    async (req, res) => {
      const { password, code } = parse(
        z.object({ password: passwordInput, code: codeInput }).strict(),
        req.body,
      );
      const user = await requirePassword(req, password);
      if (!consumeFactor(user.id, code))
        throw new HttpError(
          400,
          "Kod geçersiz veya daha önce kullanılmış. Güncel kodu ya da bir kurtarma kodunu kullan.",
        );
      repo.transaction(() => {
        repo.run("DELETE FROM account_security WHERE user_id=?", user.id);
        repo.run(
          "DELETE FROM security_recovery_codes WHERE user_id=?",
          user.id,
        );
        clearChallenges(user.id);
      });
      revokeOthers(user.id, req.sessionHash!);
      res.json(status(user.id));
    },
  );
  app.post(
    "/api/account/security/recovery-codes",
    authenticate,
    securityLimiter,
    async (req, res) => {
      const { password, code } = parse(
        z.object({ password: passwordInput, code: codeInput }).strict(),
        req.body,
      );
      const user = await requirePassword(req, password);
      if (!consumeFactor(user.id, code))
        throw new HttpError(
          400,
          "Kod geçersiz veya daha önce kullanılmış. Güncel kodu ya da bir kurtarma kodunu kullan.",
        );
      res.json({
        recoveryCodes: repo.transaction(() => recoveryCodes(user.id)),
      });
    },
  );
  app.get("/api/account/sessions", authenticate, (req, res) => {
    currentSession(req);
    const sessions: AccountSession[] = repo
      .all(
        "SELECT d.*,s.expires_at FROM sessions s JOIN session_devices d ON d.token_hash=s.token_hash WHERE s.user_id=? AND s.expires_at>? ORDER BY (s.token_hash=?) DESC,coalesce(d.last_seen_at,0) DESC",
        req.auth!.id,
        now(),
        req.sessionHash!,
      )
      .map((row) => ({
        id: row.id,
        device: row.device,
        current: row.token_hash === req.sessionHash,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
      }));
    res.json({ sessions });
  });
  app.post(
    "/api/account/sessions/:id/revoke",
    authenticate,
    securityLimiter,
    (req, res) => {
      currentSession(req);
      const id = parse(z.string().regex(/^[a-f0-9-]{16,36}$/), req.params.id);
      const target = repo.get(
        "SELECT s.token_hash FROM sessions s JOIN session_devices d ON d.token_hash=s.token_hash WHERE d.id=? AND s.user_id=?",
        id,
        req.auth!.id,
      );
      if (!target) throw new HttpError(404, "Oturum bulunamadı.");
      if (target.token_hash === req.sessionHash)
        throw new HttpError(400, "Bu cihaz için Çıkış yap düğmesini kullan.");
      repo.run("DELETE FROM sessions WHERE token_hash=?", target.token_hash);
      io.in(`session:${target.token_hash}`).disconnectSockets(true);
      res.status(204).end();
    },
  );
  app.post("/api/auth/2fa/challenge", securityLimiter, (req, res) => {
    const { code } = parse(z.object({ code: codeInput }).strict(), req.body);
    const raw = req.cookies?.[CHALLENGE_COOKIE];
    const tokenHash =
      typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw) ? hash(raw) : "";
    const challenge = repo.get(
      "SELECT * FROM security_login_challenges WHERE token_hash=?",
      tokenHash,
    );
    const user =
      challenge &&
      repo.get("SELECT * FROM users WHERE id=?", challenge.user_id);
    const row = user && account(user.id);
    if (
      !challenge ||
      !user ||
      user.suspended_at ||
      challenge.expires_at <= now() ||
      challenge.attempts >= MAX_ATTEMPTS ||
      hash(user.password_hash || "") !== challenge.password_fingerprint ||
      !row?.enabled_at ||
      row.generation !== challenge.generation
    ) {
      if (tokenHash)
        repo.run(
          "DELETE FROM security_login_challenges WHERE token_hash=?",
          tokenHash,
        );
      res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
      throw new HttpError(
        401,
        "Doğrulama oturumunun süresi doldu. E-posta ve parolanla yeniden giriş yap.",
        "TWO_FACTOR_EXPIRED",
      );
    }
    repo.run(
      "UPDATE security_login_challenges SET attempts=attempts+1 WHERE token_hash=?",
      tokenHash,
    );
    if (!consumeFactor(user.id, code))
      throw new HttpError(
        400,
        "Kod geçersiz veya daha önce kullanılmış. Güncel kodu ya da bir kurtarma kodunu kullan.",
      );
    repo.run(
      "DELETE FROM security_login_challenges WHERE token_hash=?",
      tokenHash,
    );
    res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
    startSession(req, res, user.id);
  });

  return {
    cleanup(): void {
      repo.run(
        "DELETE FROM security_login_challenges WHERE expires_at<=?",
        now(),
      );
      repo.run(
        "UPDATE account_security SET pending_cipher=NULL,pending_session=NULL,pending_password=NULL,pending_expires=NULL,pending_attempts=0 WHERE pending_expires<=?",
        now(),
      );
    },
    beginLogin(req: Request, res: Response, user: Row): boolean {
      const row = account(user.id);
      if (!row?.enabled_at) return false;
      if (
        now() - row.factor_window < WINDOW_MS &&
        row.factor_attempts >= MAX_ATTEMPTS
      )
        throw new HttpError(
          429,
          "Çok fazla doğrulama denemesi. 15 dakika sonra yeniden dene.",
        );
      const raw = randomBytes(32).toString("hex");
      repo.run(
        "DELETE FROM security_login_challenges WHERE expires_at<=?",
        now(),
      );
      // Bound the number of pending challenges even when the password is known.
      repo.run(
        "DELETE FROM security_login_challenges WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM security_login_challenges WHERE user_id=? ORDER BY expires_at DESC LIMIT 4)",
        user.id,
        user.id,
      );
      repo.run(
        "INSERT INTO security_login_challenges(token_hash,user_id,password_fingerprint,generation,expires_at) VALUES(?,?,?,?,?)",
        hash(raw),
        user.id,
        hash(user.password_hash),
        row.generation,
        now() + CHALLENGE_MS,
      );
      const previous = req.cookies?.[SESSION_COOKIE];
      if (typeof previous === "string" && /^[a-f0-9]{64}$/.test(previous)) {
        repo.run("DELETE FROM sessions WHERE token_hash=?", hash(previous));
        io.in(`session:${hash(previous)}`).disconnectSockets(true);
      }
      res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
      });
      res.cookie(CHALLENGE_COOKIE, raw, {
        ...cookieOptions,
        maxAge: CHALLENGE_MS,
      });
      res.json({ twoFactorRequired: true, expiresAt: now() + CHALLENGE_MS });
      return true;
    },
    registerSession(req: Request, tokenHash: string): void {
      const ua = req.headers["user-agent"] || "";
      const browser = /Edg\//.test(ua)
        ? "Edge"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Tarayıcı";
      const os = /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(ua)
              ? "macOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "Diğer cihaz";
      repo.run(
        "INSERT OR REPLACE INTO session_devices(token_hash,id,device,created_at,last_seen_at) VALUES(?,?,?,?,?)",
        tokenHash,
        randomUUID(),
        `${browser} · ${os}`,
        now(),
        now(),
      );
    },
    touchSession(tokenHash: string): void {
      repo.run(
        "UPDATE session_devices SET last_seen_at=? WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<?)",
        now(),
        tokenHash,
        now() - 60_000,
      );
    },
  };
}
