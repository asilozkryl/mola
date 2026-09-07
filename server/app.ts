import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { z } from 'zod';
import { openDatabase, Repository, type Row } from './db.js';
import { createWorkspace } from './seed.js';
import { getRtcConfig, registerCallHandlers } from './calls.js';
import { createMailService, type MailTransport } from './mail.js';
import { installOperations, requestMetrics } from './observability.js';
import { readListenerConfig } from './listeners.js';
import { HttpError } from './errors.js';
import { installAdminRoutes, recordAudit } from './admin.js';
import type { Bootstrap, Message } from '../shared/types.js';

declare global { namespace Express { interface Request { auth?: Row; sessionHash?: string; } } }

const COOKIE = 'mola_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keyLength: number, options?: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const idSchema = z.string().uuid();
const displayName = z.string().trim().min(2, 'En az 2 karakter kullanın.').max(60);
const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message || 'Gönderilen bilgileri kontrol edin.');
  return result.data;
}
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password: string, stored: string | null) {
  // Always derive a key so nonexistent accounts follow the same expensive path.
  const fields = stored?.split('$');
  const modern = fields?.length === 6 && fields[0] === 'scrypt';
  const [salt, key] = modern ? [fields[4], fields[5]] : (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const candidate = await scryptAsync(password, salt, 64, modern || !stored ? SCRYPT_OPTIONS : undefined);
  const expected = Buffer.from(key, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate) && Boolean(stored);
}

export interface AppOptions { databasePath?: string; uploadDir?: string; dataDir?: string; production?: boolean; appOrigin?: string; requireEmailVerification?: boolean; mailTransport?: MailTransport; mailEncryptionKey?: string; }

export function createApp(options: AppOptions = {}) {
  const { opsPort } = readListenerConfig();
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const appOrigin = options.appOrigin || process.env.APP_ORIGIN || 'http://localhost:5173';
  if (production) {
    if (!options.appOrigin && !process.env.APP_ORIGIN) throw new Error('Production requires APP_ORIGIN.');
    const parsed = new URL(appOrigin);
    if (parsed.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  }
  const configuredRequireTurn = process.env.REQUIRE_TURN;
  if (configuredRequireTurn !== undefined && !['true', 'false'].includes(configuredRequireTurn)) throw new Error('REQUIRE_TURN must be true or false.');
  const requireTurn = configuredRequireTurn === undefined ? production : configuredRequireTurn === 'true';
  const turnUrls = process.env.TURN_URLS || '';
  const turnSecret = process.env.TURN_SECRET || '';
  if (requireTurn || turnUrls || turnSecret) {
    if (!turnUrls.trim() || turnSecret.trim().length < 32) throw new Error('TURN_URLS and a TURN_SECRET of at least 32 characters are required when TURN is configured or REQUIRE_TURN is enabled.');
    if (turnUrls.split(',').some(value => !/^turns?:[^\s]+$/.test(value.trim()))) throw new Error('Every TURN_URLS entry must be a valid turn: or turns: URL.');
  }
  const relayConfigured = Boolean(turnUrls && turnSecret);
  const origin = new URL(appOrigin).origin;
  const allowedOrigins = new Set(production ? [origin] : [origin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001']);
  const demoEnabled = !production || process.env.ENABLE_DEMO === 'true';
  const testAuthLimit = process.env.MOLA_TEST_AUTH_LIMIT?.trim() || '';
  const requestedTestLimit = /^\d+$/.test(testAuthLimit) ? Number(testAuthLimit) : Number.NaN;
  const authLimit = !production && process.env.NODE_ENV === 'test' && Number.isInteger(requestedTestLimit) && requestedTestLimit >= 20 && requestedTestLimit <= 500 ? requestedTestLimit : 20;
  const testApiLimit = process.env.MOLA_TEST_API_LIMIT?.trim() || '';
  const requestedTestApiLimit = /^\d+$/.test(testApiLimit) ? Number(testApiLimit) : Number.NaN;
  const apiLimit = !production && process.env.NODE_ENV === 'test' && Number.isInteger(requestedTestApiLimit) && requestedTestApiLimit >= 300 && requestedTestApiLimit <= 5000 ? requestedTestApiLimit : 300;
  const verificationRequired = production || (options.requireEmailVerification ?? process.env.REQUIRE_EMAIL_VERIFICATION === 'true');
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || (options.uploadDir ? join(options.uploadDir, '.state') : 'data'));
  const uploadDir = resolve(options.uploadDir || join(dataDir, 'uploads'));
  mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(options.databasePath || join(dataDir, 'mola.sqlite'));
  const repo = new Repository(db);
  let mail: ReturnType<typeof createMailService>;
  try { mail = createMailService(repo, { production, dataDir, origin, mailTransport: options.mailTransport, mailEncryptionKey: options.mailEncryptionKey }); }
  catch (error) { db.close(); throw error; }
  const app = express();
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUST_PROXY must be an integer from 0 to 5.');
    app.set('trust proxy', hops);
  }
  app.disable('x-powered-by');
  app.use(requestMetrics);
  if (opsPort !== undefined) app.use((req, res, next) => {
    // Reserve operations paths before body parsing and the SPA fallback. Express
    // routes are case insensitive; normalize encoded separators here as well.
    let path = req.path;
    try { path = decodeURIComponent(path); } catch {}
    path = path.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (/^\/internal(?:\/|$)/i.test(path)) { res.status(404).json({ error: 'Not found.' }); return; }
    next();
  });
  app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()'); next(); });
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'", origin.replace(/^http/, 'ws')], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: production ? [] : null } }, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '96kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: apiLimit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Biraz yavaşlayın; bir dakika sonra yeniden deneyin.' } }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.headers.origin || !allowedOrigins.has(req.headers.origin))) return next(new HttpError(403, 'İstek kaynağı doğrulanamadı. Sayfayı yenileyip tekrar deneyin.'));
    next();
  });

  const server = createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 256 * 1024, serveClient: false, cors: { origin: [...allowedOrigins], credentials: true }, allowRequest: (req, callback) => callback(null, Boolean(req.headers.origin && allowedOrigins.has(req.headers.origin))) });
  const opsApp = opsPort === undefined ? undefined : express();
  if (opsApp) { opsApp.disable('x-powered-by'); opsApp.use(helmet()); opsApp.use(requestMetrics); }
  const operations = installOperations(opsApp || app, { db, io, dataDir, uploadDir, production });
  if (opsApp) {
    opsApp.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });
    opsApp.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error('Operations request failed:', error instanceof Error ? error.message : 'Unknown error');
      if (!res.headersSent) res.status(500).json({ error: 'Operations request failed.' });
    });
  }
  const opsServer = opsApp ? createServer(opsApp) : undefined;
  const onlineByWorkspace = new Map<string, Map<string, Set<string>>>();
  const onlineIds = (workspaceId: string) => [...(onlineByWorkspace.get(workspaceId)?.keys() || [])];
  const emitPresence = (workspaceId: string) => io.to(`workspace:${workspaceId}`).emit('presence', { onlineIds: onlineIds(workspaceId) });

  const findSession = (token: unknown) => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    return repo.get('SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', hashToken(token), Date.now());
  };
  const authenticate = (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    const user = findSession(token);
    if (!user) return next(new HttpError(401, 'Devam etmek için giriş yapın.'));
    if (user.suspended_at) return next(new HttpError(403, 'Hesabınız askıya alındı. Çalışma alanı yöneticinize başvurun.', 'ACCOUNT_SUSPENDED'));
    req.auth = user; req.sessionHash = hashToken(token); next();
  };
  const requiresVerification = (user: Row) => verificationRequired && !user.email_verified && !repo.workspace(user.workspace_id).isDemo;
  const bootstrap = (user: Row): Bootstrap => {
    const workspace = repo.workspace(user.workspace_id);
    const restricted = requiresVerification(user) || Boolean(user.suspended_at) || workspace.suspended;
    return { user: repo.user(user), workspace, emailVerificationRequired: verificationRequired && !workspace.isDemo, emailDeliveryAvailable: mail.available, channels: restricted ? [] : repo.channels(user.id, user.workspace_id), members: restricted ? [] : repo.all('SELECT * FROM users WHERE workspace_id=? ORDER BY created_at,rowid', user.workspace_id).map(row => repo.user(row)), onlineIds: restricted ? [] : onlineIds(user.workspace_id) };
  };
  const requireActiveWorkspace = (req: Request) => {
    const user = repo.get('SELECT * FROM users WHERE id=?', req.auth!.id);
    if (!user || user.suspended_at) throw new HttpError(403, 'Hesabınız askıya alındı.', 'ACCOUNT_SUSPENDED');
    if (repo.workspace(user.workspace_id).suspended) throw new HttpError(403, 'Bu çalışma alanı askıya alındı. Uygulama yöneticinize başvurun.', 'WORKSPACE_SUSPENDED');
    if (!repo.get('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?', req.sessionHash!, Date.now())) throw new HttpError(401, 'Oturumunuz sona erdi. Yeniden giriş yapın.');
  };
  const startSession = (req: Request, res: Response, userId: string) => {
    const previous = req.cookies?.[COOKIE];
    if (typeof previous === 'string' && /^[a-f0-9]{64}$/.test(previous)) { const hash = hashToken(previous); repo.run('DELETE FROM sessions WHERE token_hash=?', hash); io.in(`session:${hash}`).disconnectSockets(true); }
    const token = randomBytes(32).toString('hex');
    repo.run('INSERT INTO sessions VALUES (?,?,?)', hashToken(token), userId, Date.now() + SESSION_MS);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: production, maxAge: SESSION_MS, path: '/' });
    res.json(bootstrap(repo.get('SELECT * FROM users WHERE id=?', userId)!));
  };
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: authLimit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' } });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  let localMailboxUrl: string | undefined;
  if (!production && process.env.LOCAL_MAILBOX_URL) { try { const url = new URL(process.env.LOCAL_MAILBOX_URL); if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password) localMailboxUrl = url.toString(); } catch {} }
  app.get('/api/config', (_req, res) => res.json({ demoEnabled, emailVerificationRequired: verificationRequired, emailDeliveryAvailable: mail.available, registrationAvailable: !verificationRequired || mail.available, relayConfigured, ...(mail.available && localMailboxUrl ? { localMailboxUrl } : {}) }));
  app.get('/api/auth/me', authenticate, (req, res) => res.json(bootstrap(req.auth!)));
  app.post('/api/auth/demo', authLimiter, (req, res) => {
    if (!demoEnabled) throw new HttpError(403, 'Örnek alan bu sunucuda kapalı.');
    const existing = findSession(req.cookies?.[COOKIE]);
    if (existing && repo.workspace(existing.workspace_id).isDemo) return res.json(bootstrap(existing));
    const created = repo.transaction(() => createWorkspace(repo, { name: 'Studio Mola', userName: 'Asil', email: `demo-${randomUUID()}@example.invalid`, passwordHash: null, demo: true }));
    startSession(req, res, created.userId);
  });
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    if (verificationRequired) mail.assertAvailable();
    const input = parse(z.object({ name: displayName, email: emailSchema, password: z.string().min(12, 'Parolanız en az 12 karakter olmalı.').max(128), workspaceName: z.string().trim().min(2).max(60).optional(), inviteToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }), req.body);
    if (!input.inviteToken && !input.workspaceName) throw new HttpError(400, 'Çalışma alanınıza bir ad verin.');
    if (repo.get('SELECT id FROM users WHERE email=?', input.email)) throw new HttpError(409, 'Bu e-posta ile hesap oluşturulamıyor. Giriş yapmayı deneyin.');
    const password = await passwordHash(input.password);
    const userId = repo.transaction(() => {
      if (repo.get('SELECT id FROM users WHERE email=?', input.email)) throw new HttpError(409, 'Bu e-posta ile hesap oluşturulamıyor. Giriş yapmayı deneyin.');
      if (input.inviteToken) {
        const invite = repo.get('SELECT i.*,w.is_demo FROM invites i JOIN workspaces w ON w.id=i.workspace_id WHERE token_hash=? AND expires_at>? AND uses<max_uses AND i.revoked_at IS NULL AND w.suspended_at IS NULL', hashToken(input.inviteToken), Date.now());
        if (!invite || invite.is_demo) throw new HttpError(400, 'Davet bağlantısı geçersiz veya süresi dolmuş.');
        const id = randomUUID();
        repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, invite.workspace_id, input.name, input.email, password, '#b6aceb', 'member', '', new Date().toISOString());
        repo.run('UPDATE invites SET uses=uses+1 WHERE token_hash=?', invite.token_hash);
        if (mail.available) mail.issue(repo.get('SELECT * FROM users WHERE id=?', id)!, 'verify');
        return id;
      }
      const id = createWorkspace(repo, { name: input.workspaceName!, userName: input.name, email: input.email, passwordHash: password }).userId;
      if (mail.available) mail.issue(repo.get('SELECT * FROM users WHERE id=?', id)!, 'verify');
      return id;
    });
    const user = repo.get('SELECT * FROM users WHERE id=?', userId)!;
    if (!requiresVerification(user)) io.to(`workspace:${user.workspace_id}`).emit('member:updated', repo.user(user));
    startSession(req, res, userId);
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const input = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128) }), req.body);
    const user = repo.get('SELECT * FROM users WHERE email=?', input.email);
    if (!await verifyPassword(input.password, user?.password_hash || null)) throw new HttpError(401, 'E-posta veya parola hatalı.');
    if (repo.get('SELECT password_hash FROM users WHERE id=?', user!.id)?.password_hash !== user!.password_hash) throw new HttpError(401, 'Parolanız değişti. Yeni parolanızla tekrar giriş yapın.');
    const fresh = repo.get('SELECT * FROM users WHERE id=?', user!.id)!;
    if (fresh.suspended_at) throw new HttpError(403, 'Hesabınız askıya alındı. Çalışma alanı yöneticinize başvurun.', 'ACCOUNT_SUSPENDED');
    if (!fresh.site_admin && repo.workspace(fresh.workspace_id).suspended) throw new HttpError(403, 'Bu çalışma alanı askıya alındı.', 'WORKSPACE_SUSPENDED');
    startSession(req, res, user!.id);
  });
  app.post('/api/auth/logout', authenticate, (req, res) => {
    repo.run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash!);
    io.in(`session:${req.sessionHash}`).disconnectSockets(true);
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: production, path: '/' });
    res.status(204).end();
  });

  const recoveryLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Çok fazla istek. 15 dakika sonra tekrar deneyin.' } });
  const tokenInput = z.string().regex(/^[a-f0-9]{64}$/, 'Bağlantı geçersiz veya süresi dolmuş.');
  const activeToken = (raw: string, kind: 'verify' | 'reset') => repo.get('SELECT t.*,u.email AS current_email,u.email_verified FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind=? AND t.consumed_at IS NULL AND t.expires_at>? AND t.email=u.email', hashToken(raw), kind, Date.now());
  app.post('/api/auth/forgot-password', recoveryLimiter, async (req, res) => {
    mail.assertAvailable();
    const began = Date.now();
    const input = parse(z.object({ email: emailSchema }), req.body);
    const user = repo.get('SELECT * FROM users WHERE email=?', input.email);
    if (user?.password_hash && mail.cooldown(user.id, 'reset').allowed) repo.transaction(() => mail.issue(user, 'reset'));
    await new Promise<void>(done => setTimeout(done, Math.max(0, 250 - (Date.now() - began))));
    res.status(202).json({ message: 'Bu adresle bir hesap varsa parola yenileme bağlantısı e-posta kutuna gönderilecek.' });
  });
  app.post('/api/auth/reset-password', recoveryLimiter, async (req, res) => {
    const input = parse(z.object({ token: tokenInput, newPassword: z.string().min(12, 'Yeni parolan en az 12 karakter olmalı.').max(128) }), req.body);
    if (!activeToken(input.token, 'reset')) throw new HttpError(400, 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir bağlantı iste.');
    const nextHash = await passwordHash(input.newPassword);
    const sessions = repo.transaction(() => {
      const token = activeToken(input.token, 'reset');
      if (!token) throw new HttpError(400, 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir bağlantı iste.');
      repo.run('UPDATE users SET password_hash=? WHERE id=?', nextHash, token.user_id);
      repo.run('UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL', Date.now(), token.user_id, 'reset');
      const sessions = repo.all('SELECT token_hash FROM sessions WHERE user_id=?', token.user_id);
      repo.run('DELETE FROM sessions WHERE user_id=?', token.user_id);
      return sessions;
    });
    for (const session of sessions) io.in(`session:${session.token_hash}`).disconnectSockets(true);
    res.status(200).json({ message: 'Parolan yenilendi ve tüm oturumların kapatıldı. Yeni parolanla giriş yapabilirsin.' });
  });
  app.get('/api/auth/verification-status', (req, res, next) => {
    if (req.query.token !== undefined) {
      const raw = parse(tokenInput, req.query.token);
      const row = repo.get('SELECT t.*,u.email AS current_email,u.email_verified FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind=?', hashToken(raw), 'verify');
      const matching = Boolean(row && row.email === row.current_email);
      return res.json({ valid: Boolean(matching && !row!.consumed_at && row!.expires_at > Date.now()), expired: Boolean(matching && row!.expires_at <= Date.now()), verified: Boolean(matching && row!.email_verified) });
    }
    authenticate(req, res, error => { if (error) return next(error); res.json({ emailVerified: Boolean(req.auth!.email_verified), emailVerificationRequired: verificationRequired && !repo.workspace(req.auth!.workspace_id).isDemo }); });
  });
  app.post('/api/auth/verify-email', recoveryLimiter, (req, res) => {
    const input = parse(z.object({ token: tokenInput }), req.body);
    const user = repo.transaction(() => {
      const token = activeToken(input.token, 'verify');
      if (!token) throw new HttpError(400, 'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı iste.');
      repo.run('UPDATE users SET email_verified=1 WHERE id=?', token.user_id);
      repo.run('UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL', Date.now(), token.user_id, 'verify');
      return repo.get('SELECT * FROM users WHERE id=?', token.user_id)!;
    });
    io.to(`workspace:${user.workspace_id}`).emit('member:updated', repo.user(user));
    res.json({ message: 'E-posta adresin doğrulandı. Artık çalışma alanına katılabilirsin.' });
  });
  app.post('/api/auth/resend-verification', authenticate, recoveryLimiter, (req, res) => {
    mail.assertAvailable();
    if (req.auth!.email_verified || repo.workspace(req.auth!.workspace_id).isDemo) return res.status(202).json({ message: 'E-posta adresin zaten doğrulandı.' });
    const cooldown = mail.cooldown(req.auth!.id, 'verify');
    if (!cooldown.allowed) { res.setHeader('Retry-After', cooldown.retryAfter); throw new HttpError(429, cooldown.retryAfter > 60 ? 'Günlük doğrulama e-postası sınırına ulaştın. Yarın tekrar deneyebilirsin.' : `Yeni bağlantı için ${cooldown.retryAfter} saniye bekle.`); }
    repo.transaction(() => mail.issue(req.auth!, 'verify'));
    res.status(202).json({ message: 'Yeni doğrulama bağlantın e-posta kutuna gönderilecek.' });
  });

  app.use('/api', authenticate);
  app.use('/api', (req, _res, next) => requiresVerification(req.auth!) ? next(new HttpError(403, 'Çalışma alanına erişmek için e-posta adresini doğrula.', 'EMAIL_NOT_VERIFIED')) : next());
  installAdminRoutes(app, { repo, io, verifyPassword });
  app.use('/api', (req, _res, next) => { try { requireActiveWorkspace(req); next(); } catch (error) { next(error); } });
  const passwordLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Çok fazla parola değiştirme denemesi. 15 dakika sonra tekrar deneyin.' } });
  app.patch('/api/auth/password', passwordLimiter, async (req, res) => {
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12, 'Yeni parolanız en az 12 karakter olmalı.').max(128) }), req.body);
    const account = repo.get('SELECT * FROM users WHERE id=?', req.auth!.id)!;
    if (!account.password_hash) throw new HttpError(400, 'Örnek hesap için parola değiştirilemez. Kendi hesabınızı oluşturun.');
    if (!await verifyPassword(input.currentPassword, account.password_hash)) throw new HttpError(401, 'Mevcut parolanız hatalı.');
    if (input.currentPassword === input.newPassword) throw new HttpError(400, 'Yeni parolanız mevcut parolanızdan farklı olmalı.');
    const nextHash = await passwordHash(input.newPassword);
    const revoked = repo.transaction(() => {
      requireActiveWorkspace(req);
      const changed = repo.run('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?', nextHash, account.id, account.password_hash);
      if (changed.changes !== 1) throw new HttpError(409, 'Parolanız başka bir oturumda değişti. Güncel parolanızla tekrar deneyin.');
      const sessions = repo.all('SELECT token_hash FROM sessions WHERE user_id=? AND token_hash!=?', account.id, req.sessionHash!);
      repo.run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', account.id, req.sessionHash!);
      repo.run('UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL', Date.now(), account.id, 'reset');
      return sessions;
    });
    for (const session of revoked) io.in(`session:${session.token_hash}`).disconnectSockets(true);
    res.status(204).end();
  });
  app.get('/api/rtc/config', (_req, res) => res.json(getRtcConfig()));
  const requireChannel = (req: Request, channelId: string) => {
    if (!idSchema.safeParse(channelId).success || !repo.canAccessChannel(req.auth!.id, channelId)) throw new HttpError(404, 'Kanal bulunamadı.');
    const channel = repo.get('SELECT * FROM channels WHERE id=?', channelId)!;
    if (!['GET', 'HEAD'].includes(req.method) && channel.archived_at) throw new HttpError(403, 'Bu kanal arşivlendi. Geçmişi okuyabilirsiniz; yeni işlem için kanalın geri yüklenmesi gerekir.', 'CHANNEL_ARCHIVED');
    return channel;
  };
  const requireMessage = (req: Request, messageId: string) => {
    const message = idSchema.safeParse(messageId).success ? repo.get('SELECT * FROM messages WHERE id=?', messageId) : undefined;
    if (!message || !repo.canAccessChannel(req.auth!.id, message.channel_id)) throw new HttpError(404, 'Mesaj bulunamadı.');
    requireChannel(req, message.channel_id);
    return message;
  };
  const broadcastMessage = (messageId: string, event = 'message:updated'): Message => {
    const message = repo.message(repo.get('SELECT * FROM messages WHERE id=?', messageId)!);
    io.to(`channel:${message.channelId}`).emit(event, message);
    return message;
  };

  app.get('/api/messages/:id', (req, res) => res.json(repo.message(requireMessage(req, String(req.params.id)))));
  app.get('/api/channels/:id/pins', (req, res) => {
    const channel = requireChannel(req, String(req.params.id));
    const messages = repo.all('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY created_at DESC,id DESC LIMIT 100', channel.id);
    res.json({ messages: messages.map(message => repo.message(message)) });
  });
  app.get('/api/channels/:id/files', (req, res) => {
    const channel = requireChannel(req, String(req.params.id));
    const files = repo.all('SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.channel_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 100', channel.id);
    res.json({ files: files.map(file => repo.attachment(file)) });
  });

  app.get('/api/channels/:id/messages', (req, res) => {
    const channel = requireChannel(req, String(req.params.id));
    const input = parse(z.object({ parentId: idSchema.optional(), before: z.string().max(64).optional() }), req.query);
    if (input.parentId) { const parent = requireMessage(req, input.parentId); if (parent.channel_id !== channel.id || parent.parent_id) throw new HttpError(400, 'Geçersiz mesaj dizisi.'); }
    let before: Row | undefined;
    if (input.before) {
      before = repo.get('SELECT * FROM messages WHERE id=? AND channel_id=?', input.before, channel.id);
      if (!before && !Number.isNaN(Date.parse(input.before))) before = { created_at: new Date(input.before).toISOString(), id: '' };
      if (!before) throw new HttpError(400, 'Geçersiz sayfalama bilgisi.');
    }
    const rows = repo.all(`SELECT * FROM messages WHERE channel_id=? AND parent_id IS ? ${before ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT 51`, channel.id, input.parentId || null, ...(before ? [before.created_at, before.created_at, before.id] : []));
    res.json({ messages: rows.slice(0, 50).reverse().map(row => repo.message(row)), hasMore: rows.length > 50 });
  });
  app.post('/api/channels/:id/messages', (req, res) => {
    const channel = requireChannel(req, String(req.params.id));
    const input = parse(z.object({ content: z.string().trim().max(10000).default(''), parentId: idSchema.optional(), attachmentIds: z.array(idSchema).max(4).default([]) }).refine(v => v.content.length > 0 || v.attachmentIds.length > 0, { message: 'Bir mesaj yazın veya dosya ekleyin.' }), req.body);
    if (input.parentId) { const parent = requireMessage(req, input.parentId); if (parent.channel_id !== channel.id || parent.parent_id) throw new HttpError(400, 'Geçersiz mesaj dizisi.'); }
    const messageId = repo.transaction(() => {
      const attachmentIds = [...new Set(input.attachmentIds)];
      for (const id of attachmentIds) if (!repo.get('SELECT id FROM attachments WHERE id=? AND user_id=? AND workspace_id=? AND message_id IS NULL', id, req.auth!.id, req.auth!.workspace_id)) throw new HttpError(400, 'Dosya kullanılamıyor. Yeniden yükleyin.');
      const id = randomUUID();
      repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', id, channel.id, req.auth!.id, input.content, new Date().toISOString(), null, input.parentId || null, 0);
      for (const attachmentId of attachmentIds) repo.run('UPDATE attachments SET message_id=? WHERE id=?', id, attachmentId);
      return id;
    });
    const message = broadcastMessage(messageId, 'message:created');
    if (input.parentId) broadcastMessage(input.parentId);
    res.status(201).json(message);
  });
  app.patch('/api/messages/:id', (req, res) => {
    const message = requireMessage(req, String(req.params.id));
    const input = parse(z.object({ content: z.string().trim().min(1).max(10000).optional(), pinned: z.boolean().optional() }).refine(v => v.content !== undefined || v.pinned !== undefined, { message: 'Değişiklik bulunamadı.' }), req.body);
    if (input.content !== undefined && message.user_id !== req.auth!.id) throw new HttpError(403, 'Yalnızca kendi mesajınızı düzenleyebilirsiniz.');
    if (input.content !== undefined) repo.run('UPDATE messages SET content=?,edited_at=? WHERE id=?', input.content, new Date().toISOString(), message.id);
    if (input.pinned !== undefined) repo.run('UPDATE messages SET pinned=? WHERE id=?', input.pinned ? 1 : 0, message.id);
    res.json(broadcastMessage(message.id));
  });
  app.delete('/api/messages/:id', (req, res) => {
    const message = requireMessage(req, String(req.params.id));
    if (message.user_id !== req.auth!.id && req.auth!.role !== 'owner') throw new HttpError(403, 'Bu mesajı silme yetkiniz yok.');
    const descendants = repo.all('SELECT id FROM messages WHERE parent_id=?', message.id);
    const attachments = repo.all('SELECT storage_name FROM attachments WHERE message_id=? OR message_id IN (SELECT id FROM messages WHERE parent_id=?)', message.id, message.id);
    repo.run('DELETE FROM messages WHERE id=?', message.id);
    for (const file of attachments) try { unlinkSync(join(uploadDir, file.storage_name)); } catch { /* already removed */ }
    for (const id of [message.id, ...descendants.map(row => row.id)]) io.to(`channel:${message.channel_id}`).emit('message:deleted', { id, channelId: message.channel_id });
    if (message.parent_id) broadcastMessage(message.parent_id);
    res.status(204).end();
  });
  app.post('/api/messages/:id/reactions', (req, res) => {
    const message = requireMessage(req, String(req.params.id));
    const input = parse(z.object({ emoji: z.string().min(1).max(32).regex(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0F\u200D]+$/u, 'Bir emoji seçin.') }), req.body);
    const existing = repo.get('SELECT * FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', message.id, req.auth!.id, input.emoji);
    if (existing) repo.run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', message.id, req.auth!.id, input.emoji);
    else {
      if (repo.get('SELECT count(DISTINCT emoji) AS count FROM reactions WHERE message_id=?', message.id)!.count >= 20 && !repo.get('SELECT 1 FROM reactions WHERE message_id=? AND emoji=?', message.id, input.emoji)) throw new HttpError(400, 'Bu mesajdaki farklı tepki sınırına ulaşıldı.');
      repo.run('INSERT INTO reactions VALUES (?,?,?)', message.id, req.auth!.id, input.emoji);
    }
    res.json(broadcastMessage(message.id));
  });

  app.post('/api/channels', (req, res) => {
    const input = parse(z.object({ name: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}\s_-]+$/u, 'Kanal adında harf, sayı, boşluk ve tire kullanabilirsiniz.'), description: z.string().trim().max(300).default(''), kind: z.enum(['text', 'voice']) }), req.body);
    if (repo.get("SELECT id FROM channels WHERE workspace_id=? AND name=? COLLATE NOCASE AND kind!='dm'", req.auth!.workspace_id, input.name)) throw new HttpError(409, 'Bu isimde bir kanal var.');
    const id = randomUUID();
    repo.run('INSERT INTO channels (id,workspace_id,name,description,kind,created_at) VALUES (?,?,?,?,?,?)', id, req.auth!.workspace_id, input.name, input.description, input.kind, new Date().toISOString());
    const channel = repo.channel(repo.get('SELECT * FROM channels WHERE id=?', id)!);
    io.in(`workspace:${req.auth!.workspace_id}`).socketsJoin(`channel:${id}`);
    io.to(`workspace:${req.auth!.workspace_id}`).emit('channel:created', channel);
    res.status(201).json(channel);
  });
  app.post('/api/dms', (req, res) => {
    const input = parse(z.object({ userId: idSchema }), req.body);
    const other = repo.get('SELECT * FROM users WHERE id=? AND workspace_id=?', input.userId, req.auth!.workspace_id);
    if (!other || other.suspended_at || other.id === req.auth!.id) throw new HttpError(400, 'Mesajlaşmak için aktif bir ekip arkadaşı seçin.');
    const existing = repo.get("SELECT c.* FROM channels c WHERE c.workspace_id=? AND c.kind='dm' AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?) AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?)", req.auth!.workspace_id, req.auth!.id, other.id);
    if (existing) return res.json(repo.channel(existing));
    const id = repo.transaction(() => {
      const id = randomUUID(); repo.run('INSERT INTO channels (id,workspace_id,name,description,kind,created_at) VALUES (?,?,?,?,?,?)', id, req.auth!.workspace_id, other.name, 'Doğrudan mesaj', 'dm', new Date().toISOString());
      for (const userId of [req.auth!.id, other.id]) repo.run('INSERT INTO channel_members VALUES (?,?)', id, userId);
      return id;
    });
    const channel = repo.channel(repo.get('SELECT * FROM channels WHERE id=?', id)!);
    for (const userId of [req.auth!.id, other.id]) { io.in(`user:${userId}`).socketsJoin(`channel:${id}`); io.to(`user:${userId}`).emit('channel:created', channel); }
    res.status(201).json(channel);
  });
  app.get('/api/search', (req, res) => {
    const input = parse(z.object({ q: z.string().trim().min(2, 'Aramak için en az 2 karakter yazın.').max(100) }), req.query);
    const pattern = `%${input.q.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const rows = repo.all("SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.workspace_id=? AND (c.kind!='dm' OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=?)) AND fold_text(m.content) LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC,m.id DESC LIMIT 50", req.auth!.workspace_id, req.auth!.id, pattern);
    res.json({ messages: rows.map(row => repo.message(row)) });
  });
  app.post('/api/invites', (req, res) => {
    if (req.auth!.role !== 'owner' && !req.auth!.site_admin) throw new HttpError(403, 'Davet bağlantısını çalışma alanı sahibi oluşturabilir.');
    if (repo.workspace(req.auth!.workspace_id).isDemo) throw new HttpError(400, 'Ekibinizi davet etmek için kendi çalışma alanınızı oluşturun.');
    const token = randomBytes(32).toString('hex'); const expiresAt = Date.now() + 3 * 24 * 60 * 60_000;
    const invitationId = randomUUID();
    repo.transaction(() => {
      requireActiveWorkspace(req);
      const actor = repo.get('SELECT * FROM users WHERE id=?', req.auth!.id)!;
      if (actor.role !== 'owner' && !actor.site_admin) throw new HttpError(403, 'Davet oluşturma yetkiniz artık yok.');
      repo.run('INSERT INTO invites (token_hash,workspace_id,created_by,expires_at,uses,max_uses,id,created_at) VALUES (?,?,?,?,?,?,?,?)', hashToken(token), req.auth!.workspace_id, req.auth!.id, expiresAt, 0, 20, invitationId, new Date().toISOString());
      recordAudit(repo, actor, actor.workspace_id, 'invite.created', 'invite', invitationId);
    });
    io.to(`workspace:${req.auth!.workspace_id}`).emit('admin:refresh');
    res.status(201).json({ url: `${origin}/?invite=${token}`, expiresAt: new Date(expiresAt).toISOString() });
  });
  app.patch('/api/profile', (req, res) => {
    const input = parse(z.object({ name: displayName.optional(), status: z.string().trim().max(100).optional() }).refine(v => v.name !== undefined || v.status !== undefined), req.body);
    repo.run('UPDATE users SET name=?,status=? WHERE id=?', input.name ?? req.auth!.name, input.status ?? req.auth!.status, req.auth!.id);
    const user = repo.user(repo.get('SELECT * FROM users WHERE id=?', req.auth!.id)!);
    for (const socket of io.sockets.sockets.values()) if (socket.data.user?.id === user.id) socket.data.user = user;
    io.to(`workspace:${req.auth!.workspace_id}`).emit('member:updated', user);
    res.json(user);
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 2 } });
  const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Dosya yükleme sınırına ulaştınız. Bir dakika sonra tekrar deneyin.' } });
  app.post('/api/uploads', uploadLimiter, upload.single('file'), (req, res) => {
    // Multipart bodies can finish after an administrator revoked the account.
    requireActiveWorkspace(req);
    if (!req.file || req.file.size === 0) throw new HttpError(400, 'Yüklemek için bir dosya seçin.');
    const { buffer } = req.file;
    let mime = '';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
    else if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
    else if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) mime = 'image/gif';
    else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
    else if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') mime = 'application/pdf';
    else if (req.file.mimetype === 'text/plain' && !buffer.includes(0)) mime = 'text/plain';
    else if (req.file.mimetype === 'text/csv' && !buffer.includes(0)) mime = 'text/csv';
    if (!mime) throw new HttpError(400, 'PNG, JPG, GIF, WebP, PDF, TXT veya CSV dosyası yükleyin.');
    const total = repo.get('SELECT coalesce(sum(size),0) AS size FROM attachments WHERE workspace_id=?', req.auth!.workspace_id)!.size;
    if (total + req.file.size > 500 * 1024 * 1024) throw new HttpError(413, 'Çalışma alanının 500 MB dosya sınırına ulaşıldı.');
    const id = randomUUID(); const storageName = `${id}.bin`;
    let originalName = req.file.originalname;
    // Browser multipart headers use UTF-8 while busboy defaults to Latin-1.
    try { if ([...originalName].every(char => char.charCodeAt(0) <= 255)) originalName = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(originalName, 'latin1')); } catch { /* already decoded or a legacy filename */ }
    const name = basename(originalName.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'dosya';
    writeFileSync(join(uploadDir, storageName), buffer, { flag: 'wx', mode: 0o600 });
    try { repo.run('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)', id, req.auth!.workspace_id, req.auth!.id, null, name, req.file.size, mime, storageName, new Date().toISOString()); }
    catch (error) { unlinkSync(join(uploadDir, storageName)); throw error; }
    res.status(201).json(repo.attachment(repo.get('SELECT * FROM attachments WHERE id=?', id)!));
  });
  app.get('/api/files/:id', (req, res, next) => {
    const file = idSchema.safeParse(req.params.id).success ? repo.get('SELECT * FROM attachments WHERE id=? AND workspace_id=?', String(req.params.id), req.auth!.workspace_id) : undefined;
    if (!file) throw new HttpError(404, 'Dosya bulunamadı.');
    if (file.message_id) {
      const message = repo.get('SELECT * FROM messages WHERE id=?', file.message_id);
      if (!message || !repo.canAccessChannel(req.auth!.id, message.channel_id)) throw new HttpError(404, 'Dosya bulunamadı.');
    } else if (file.user_id !== req.auth!.id) throw new HttpError(404, 'Dosya bulunamadı.');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`);
    res.sendFile(join(uploadDir, file.storage_name), error => { if (error) next(new HttpError(404, 'Dosya bulunamadı.')); });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Bu işlem bulunamadı.')));
  const distDir = resolve('dist');
  if ((production || process.env.SERVE_STATIC === 'true') && existsSync(join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(distDir, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Dosya en fazla 10 MB olabilir.' : 'Tek seferde bir dosya yükleyin.' });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') return res.status(413).json({ error: 'Gönderilen içerik çok büyük.' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Geçersiz istek.' });
    if (error && typeof error === 'object' && 'code' in error && String(error.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Bu kayıt zaten var veya işlem artık geçerli değil.' });
    if (!production) console.error(error);
    else console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' });
  });

  io.use((socket, next) => {
    const cookies = socket.request.headers.cookie || '';
    const rawToken = cookies.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const user = findSession(rawToken);
    if (!user) return next(new Error('Oturumunuz sona erdi. Yeniden giriş yapın.'));
    if (user.suspended_at || repo.workspace(user.workspace_id).suspended) { const error = new Error('Hesap veya çalışma alanı askıya alındı.') as Error & { data: object }; error.data = { code: user.suspended_at ? 'ACCOUNT_SUSPENDED' : 'WORKSPACE_SUSPENDED' }; return next(error); }
    if (requiresVerification(user)) { const error = new Error('Çalışma alanına erişmek için e-posta adresini doğrula.') as Error & { data: object }; error.data = { code: 'EMAIL_NOT_VERIFIED' }; return next(error); }
    socket.data.user = repo.user(user); socket.data.workspaceId = user.workspace_id; socket.data.sessionHash = hashToken(rawToken!); socket.data.expiresAt = user.expires_at;
    next();
  });
  io.on('connection', socket => {
    const user = socket.data.user;
    const workspaceId = socket.data.workspaceId;
    socket.join([`workspace:${workspaceId}`, `user:${user.id}`, `session:${socket.data.sessionHash}`, ...repo.channels(user.id, workspaceId).map(c => `channel:${c.id}`)]);
    let members = onlineByWorkspace.get(workspaceId); if (!members) { members = new Map(); onlineByWorkspace.set(workspaceId, members); }
    let sockets = members.get(user.id); if (!sockets) { sockets = new Set(); members.set(user.id, sockets); } sockets.add(socket.id);
    emitPresence(workspaceId);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(1, socket.data.expiresAt - Date.now())); expiryTimer.unref();
    let typingEvents = 0; let typingWindow = Date.now();
    socket.on('typing', (payload: unknown) => {
      if (Date.now() - typingWindow > 10_000) { typingEvents = 0; typingWindow = Date.now(); }
      if (++typingEvents > 30) return;
      const result = z.object({ channelId: idSchema, typing: z.boolean() }).safeParse(payload);
      if (result.success && repo.canWriteChannel(user.id, result.data.channelId)) socket.to(`channel:${result.data.channelId}`).emit('typing', { channelId: result.data.channelId, userId: user.id, typing: result.data.typing });
    });
    registerCallHandlers(io, socket, { user, canAccessChannel: channelId => repo.canWriteChannel(user.id, channelId) });
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      const members = onlineByWorkspace.get(workspaceId); const sockets = members?.get(user.id); sockets?.delete(socket.id);
      if (sockets?.size === 0) members?.delete(user.id); if (members?.size === 0) onlineByWorkspace.delete(workspaceId);
      emitPresence(workspaceId);
    });
  });

  const maintenance = () => {
    repo.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
    repo.run('DELETE FROM invites WHERE expires_at<?', Date.now() - 30 * 24 * 60 * 60_000);
    repo.run('DELETE FROM auth_tokens WHERE expires_at<?', Date.now() - 7 * 24 * 60 * 60_000);
    const orphaned = repo.all('SELECT id,storage_name FROM attachments WHERE message_id IS NULL AND created_at<?', new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    for (const file of orphaned) { try { unlinkSync(join(uploadDir, file.storage_name)); } catch {} repo.run('DELETE FROM attachments WHERE id=?', file.id); }
    repo.run('DELETE FROM workspaces WHERE is_demo=1 AND created_at<? AND NOT EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.workspace_id=workspaces.id)', new Date(Date.now() - SESSION_MS).toISOString());
    // Clear files left behind after expired demo data was removed or a process crash.
    for (const fileName of readdirSync(uploadDir)) if (/^[a-f0-9-]{36}\.bin$/.test(fileName) && !repo.get('SELECT id FROM attachments WHERE storage_name=?', fileName)) { try { if (Date.now() - statSync(join(uploadDir, fileName)).mtimeMs > 60_000) unlinkSync(join(uploadDir, fileName)); } catch {} }
  };
  maintenance();
  const cleanupTimer = setInterval(maintenance, 60 * 60_000); cleanupTimer.unref();
  // CLI authorization changes happen in another process; revoke their active sockets too.
  const sessionValidationTimer = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      const account = repo.get('SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', socket.data.sessionHash, Date.now());
      if (!account || account.suspended_at || repo.workspace(account.workspace_id).suspended || requiresVerification(account) || Boolean(account.site_admin) !== Boolean(socket.data.user?.siteAdmin)) socket.disconnect(true);
    }
  }, 5000); sessionValidationTimer.unref();
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => {
    clearInterval(cleanupTimer); clearInterval(sessionValidationTimer);
    await Promise.all([
      new Promise<void>(resolveClose => io.close(() => resolveClose())),
      opsServer?.listening ? new Promise<void>((resolveClose, reject) => opsServer.close(error => error ? reject(error) : resolveClose())) : Promise.resolve(),
    ]);
    if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    await mail.close();
    await operations.close?.();
    repo.close();
  })();
  return { app, server, opsServer, io, db, repo, mail, close };
}
