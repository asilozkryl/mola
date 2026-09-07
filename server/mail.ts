import nodemailer from 'nodemailer';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Repository, type Row } from './db.js';
import { HttpError } from './errors.js';

export interface AuthMail { id: string; to: string; subject: string; text: string; html: string; }
export type MailTransport = (message: AuthMail) => Promise<void>;
export interface MailOptions { production: boolean; dataDir: string; origin: string; mailTransport?: MailTransport; mailEncryptionKey?: string; }

function loadKey(options: MailOptions): Buffer {
  const configured = options.mailEncryptionKey || process.env.MAIL_ENCRYPTION_KEY;
  if (configured) {
    const key = /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY must contain exactly 32 bytes encoded as hex or base64.');
    return key;
  }
  if (options.production) throw new Error('Production requires MAIL_ENCRYPTION_KEY for the encrypted mail outbox.');
  mkdirSync(options.dataDir, { recursive: true });
  const keyPath = join(options.dataDir, '.mail-key');
  if (!existsSync(keyPath)) { try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (!existsSync(keyPath)) throw error; } }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('The local mail encryption key is invalid. Restore the original .mail-key.');
  return key;
}

export function createMailService(repo: Repository, options: MailOptions) {
  const configuredDelivery = process.env.EMAIL_DELIVERY_ENABLED;
  if (configuredDelivery !== undefined && !['true', 'false'].includes(configuredDelivery)) throw new Error('EMAIL_DELIVERY_ENABLED must be true or false.');
  if (configuredDelivery === 'false') {
    const assertAvailable = (): never => { throw new HttpError(503, 'E-posta hizmeti henüz etkin değil. Bağlantı gönderimi için lütfen daha sonra tekrar deneyin.', 'EMAIL_UNAVAILABLE'); };
    // Explicitly deferred delivery must not load keys, generate tokens, queue mail,
    // run delivery timers or fall back to a plaintext development mailbox.
    return { available: false, assertAvailable, issue: (_user: Row, _kind: 'verify' | 'reset') => assertAvailable(), cooldown: (_userId: string, _kind: 'verify' | 'reset') => ({ allowed: false, retryAfter: 0 }), flush: async () => {}, close: async () => {} };
  }
  const key = loadKey(options);
  let shutdownTransport: (() => void) | undefined;
  let spoolDirectory: string | undefined;
  let send: MailTransport;
  if (options.mailTransport) send = options.mailTransport;
  else if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port.');
    if (options.production && ['SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].some(name => !process.env[name])) throw new Error('Production requires SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and MAIL_FROM.');
    if (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE)) throw new Error('SMTP_SECURE must be true or false.');
    const secure = process.env.SMTP_SECURE === 'true';
    const insecure = !options.production && process.env.SMTP_ALLOW_INSECURE === 'true';
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure, requireTLS: !secure && !insecure, ignoreTLS: insecure,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
      disableFileAccess: true, disableUrlAccess: true });
    send = async message => { await transport.sendMail({ from: process.env.MAIL_FROM || 'Mola <mola@localhost>', to: message.to, subject: message.subject, text: message.text, html: message.html, messageId: `<${message.id}@mola.local>` }); };
    shutdownTransport = () => transport.close();
  } else {
    if (options.production) throw new Error('Production requires SMTP_HOST and a configured SMTP provider.');
    const spool = join(options.dataDir, 'mail');
    spoolDirectory = spool;
    send = async message => { mkdirSync(spool, { recursive: true, mode: 0o700 }); writeFileSync(join(spool, `${message.id}.json`), JSON.stringify(message, null, 2), { mode: 0o600 }); };
  }
  const encrypt = (message: AuthMail) => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };
  const decrypt = (payload: string): AuthMail => {
    const bytes = Buffer.from(payload, 'base64'); const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  };
  let pending: Promise<void> | null = null;
  let stopped = false;
  const flush = (): Promise<void> => {
    if (pending) return pending;
    if (stopped) return Promise.resolve();
    pending = (async () => {
      const rows = repo.all("SELECT * FROM mail_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 20", Date.now());
      for (const row of rows) {
        if (stopped) break;
        const token = repo.get('SELECT t.*,u.email AS current_email FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=?', row.token_id);
        if (!token || token.consumed_at || token.expires_at <= Date.now() || token.email !== token.current_email) { repo.run("UPDATE mail_outbox SET status='cancelled',payload='' WHERE id=?", row.id); continue; }
        try {
          await send(decrypt(row.payload));
          repo.run("UPDATE mail_outbox SET status='delivered',payload='',delivered_at=?,attempts=attempts+1 WHERE id=?", Date.now(), row.id);
        } catch {
          const attempts = row.attempts + 1;
          repo.run("UPDATE mail_outbox SET attempts=?,next_attempt_at=?,status=? WHERE id=?", attempts, Date.now() + Math.min(3600000, 5000 * 2 ** Math.min(attempts - 1, 10)), attempts >= 12 ? 'failed' : 'pending', row.id);
          console.warn(JSON.stringify({ event: 'mail_delivery_retry', mailId: row.id, attempt: attempts }));
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const issue = (user: Row, kind: 'verify' | 'reset') => {
    const now = Date.now(); const id = randomUUID(); const raw = randomBytes(32).toString('hex');
    repo.run('UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL', now, user.id, kind);
    repo.run('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)', id, createHash('sha256').update(raw).digest('hex'), user.id, kind, user.email, now + (kind === 'verify' ? 24 * 60 * 60_000 : 15 * 60_000), null, now);
    const action = kind === 'verify' ? 'verify-email' : 'reset-password';
    const link = `${options.origin}/#action=${action}&token=${raw}`;
    const subject = kind === 'verify' ? 'Mola e-posta adresini doğrula' : 'Mola parolanı yenile';
    const instructions = kind === 'verify' ? 'E-posta adresini doğrulamak için bağlantıyı açıp onayla. Bağlantı 24 saat geçerli.' : 'Yeni bir parola belirlemek için bağlantıyı aç. Bağlantı 15 dakika geçerli. Bu isteği sen yapmadıysan mesajı yok sayabilirsin.';
    const mailId = randomUUID();
    const message: AuthMail = { id: mailId, to: user.email, subject, text: `${subject}\n\n${instructions}\n\n${link}\n\nMola`, html: `<p>${instructions}</p><p><a href="${link}">${subject}</a></p><p>Mola</p>` };
    repo.run('INSERT INTO mail_outbox (id,token_id,payload,next_attempt_at,created_at) VALUES (?,?,?,?,?)', mailId, id, encrypt(message), now, now);
  };
  const cooldown = (userId: string, kind: 'verify' | 'reset') => {
    const now = Date.now(); const window = kind === 'verify' ? 24 * 60 * 60_000 : 60 * 60_000;
    const count = repo.get('SELECT count(*) AS count,max(created_at) AS latest FROM auth_tokens WHERE user_id=? AND kind=? AND created_at>?', userId, kind, now - window)!;
    return { allowed: count.count < (kind === 'verify' ? 10 : 5) && (!count.latest || now - count.latest >= 60_000), retryAfter: count.count >= (kind === 'verify' ? 10 : 5) ? Math.ceil(window / 1000) : Math.max(1, Math.ceil((60_000 - (now - (count.latest || 0))) / 1000)) };
  };
  const sweepSpool = () => {
    if (!spoolDirectory || !existsSync(spoolDirectory)) return;
    const files = readdirSync(spoolDirectory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => ({ name, modified: statSync(join(spoolDirectory!, name)).mtimeMs })).sort((a, b) => b.modified - a.modified);
    for (const [index, file] of files.entries()) if (index >= 1000 || Date.now() - file.modified > 7 * 24 * 60 * 60_000) unlinkSync(join(spoolDirectory, file.name));
  };
  sweepSpool();
  const retentionTimer = setInterval(() => { try { sweepSpool(); } catch { console.warn(JSON.stringify({ event: 'mail_spool_cleanup_failure' })); } }, 60 * 60_000); retentionTimer.unref();
  const timer = setInterval(() => { void flush().catch(() => console.warn(JSON.stringify({ event: 'mail_queue_failure' }))); }, 5000); timer.unref();
  return { available: true, assertAvailable: () => {}, issue, cooldown, flush, close: async () => { stopped = true; clearInterval(timer); clearInterval(retentionTimer); await pending; shutdownTransport?.(); } };
}
