import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer as createTcpServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { io as connect } from 'socket.io-client';
import { createApp, type AppOptions } from '../server/app.js';
import type { AuthMail } from '../server/mail.js';

const KEY = 'b'.repeat(64);
const ORIGIN = 'http://localhost:5173';
const account = { name: 'Asil Recovery', email: 'recovery@example.com', password: 'original-password-123', workspaceName: 'Recovery team' };

async function fixture(run: (ctx: {
  runtime: ReturnType<typeof createApp>; emails: AuthMail[]; base: string;
  request: (path: string, method?: string, body?: unknown) => Promise<Response>;
  cookie: () => string; setCookie: (value: string) => void;
}) => Promise<void>, options: AppOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mola-recovery-'));
  const emails: AuthMail[] = [];
  const runtime = createApp({ databasePath: ':memory:', uploadDir: join(directory, 'uploads'), dataDir: directory, requireEmailVerification: true, production: false, mailEncryptionKey: KEY, mailTransport: async mail => { emails.push(mail); }, ...options });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  let cookie = '';
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + '/api' + path, { method, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return response;
  };
  try { await run({ runtime, emails, base, request, cookie: () => cookie, setCookie: value => { cookie = value; } }); }
  finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
}
function mailToken(mail: AuthMail): string {
  const link = mail.text.split('\n').find(value => value.startsWith('http'))!;
  assert.ok(link.includes('/#action='), 'Auth secrets stay in fragments rather than request URLs');
  return new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
}

test('unverified accounts cannot access workspace APIs or sockets until explicit single-use email verification', async () => fixture(async ({ runtime, emails, request, base, cookie }) => {
  const registration = await request('/auth/register', 'POST', account);
  assert.equal(registration.status, 200);
  const state = await registration.json();
  assert.equal(state.user.emailVerified, false);
  assert.equal(state.emailVerificationRequired, true);
  assert.deepEqual(state.channels, []); assert.deepEqual(state.members, []); assert.deepEqual(state.onlineIds, []);
  const channel = runtime.repo.get('SELECT id FROM channels WHERE workspace_id=?', state.workspace.id)!.id;
  for (const [path, method, body] of [
    [`/channels/${channel}/messages`, 'GET', undefined],
    [`/channels/${channel}/pins`, 'GET', undefined],
    ['/search?q=hello', 'GET', undefined],
    ['/channels', 'POST', { name: 'blocked', kind: 'text' }],
    ['/profile', 'PATCH', { name: 'Blocked Name' }],
    ['/rtc/config', 'GET', undefined],
    ['/files/' + randomUUID(), 'GET', undefined],
  ] as const) {
    const response = await request(path, method, body);
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, 'EMAIL_NOT_VERIFIED');
  }
  const rejectedSocket = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: ORIGIN, Cookie: cookie() } });
  try { const error = await new Promise<Error & { data?: { code: string } }>(done => rejectedSocket.once('connect_error', done)); assert.equal(error.data?.code, 'EMAIL_NOT_VERIFIED'); }
  finally { rejectedSocket.disconnect(); }
  const pending = runtime.repo.get('SELECT * FROM mail_outbox')!;
  assert.equal(pending.payload.includes(account.email), false);
  await runtime.mail.flush();
  assert.equal(emails.length, 1);
  const token = mailToken(emails[0]);
  assert.notEqual(runtime.repo.get('SELECT token_hash FROM auth_tokens')!.token_hash, token);
  assert.deepEqual(await (await request(`/auth/verification-status?token=${token}`)).json(), { valid: true, expired: false, verified: false });
  assert.equal(runtime.repo.get('SELECT consumed_at FROM auth_tokens')!.consumed_at, null, 'Status GET must not consume the token');
  assert.equal((await request('/auth/verify-email', 'POST', { token })).status, 200);
  assert.equal((await request('/auth/verify-email', 'POST', { token })).status, 400);
  const verified = await (await request('/auth/me')).json();
  assert.equal(verified.user.emailVerified, true); assert.ok(verified.channels.length > 0);
  assert.equal((await request(`/channels/${channel}/messages`)).status, 200);
}));

test('password recovery is generic, expiry-bound, race-safe and revokes every session and socket', async () => fixture(async ({ runtime, emails, request, base, cookie, setCookie }) => {
  await request('/auth/register', 'POST', account); await runtime.mail.flush();
  await request('/auth/verify-email', 'POST', { token: mailToken(emails[0]) });
  const firstCookie = cookie();
  setCookie(''); await request('/auth/login', 'POST', { email: account.email, password: account.password });
  const secondCookie = cookie();
  const socket = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: ORIGIN, Cookie: secondCookie } });
  try {
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    const known = await request('/auth/forgot-password', 'POST', { email: account.email });
    const unknown = await request('/auth/forgot-password', 'POST', { email: 'unknown@example.com' });
    assert.equal(known.status, 202); assert.equal(unknown.status, 202); assert.deepEqual(await known.json(), await unknown.json());
    const repeated = await request('/auth/forgot-password', 'POST', { email: account.email }); assert.equal(repeated.status, 202);
    assert.equal(runtime.repo.get("SELECT count(*) AS n FROM auth_tokens WHERE kind='reset'")!.n, 1);
    await runtime.mail.flush();
    const expired = mailToken(emails.at(-1)!);
    runtime.repo.run("UPDATE auth_tokens SET expires_at=?,created_at=? WHERE kind='reset'", Date.now() - 1, Date.now() - 61_000);
    assert.equal((await request('/auth/reset-password', 'POST', { token: expired, newPassword: 'replacement-password-456' })).status, 400);
    await request('/auth/forgot-password', 'POST', { email: account.email }); await runtime.mail.flush();
    const token = mailToken(emails.at(-1)!);
    const disconnected = new Promise<void>(done => socket.once('disconnect', () => done()));
    const attempts = await Promise.all([request('/auth/reset-password', 'POST', { token, newPassword: 'replacement-password-456' }), request('/auth/reset-password', 'POST', { token, newPassword: 'replacement-password-456' })]);
    assert.deepEqual(attempts.map(response => response.status).sort(), [200, 400]);
    await disconnected;
    for (const oldCookie of [firstCookie, secondCookie]) { setCookie(oldCookie); assert.equal((await request('/auth/me')).status, 401); }
    assert.equal((await request('/auth/login', 'POST', { email: account.email, password: account.password })).status, 401);
    assert.equal((await request('/auth/login', 'POST', { email: account.email, password: 'replacement-password-456' })).status, 200);
    assert.equal((await request('/auth/reset-password', 'POST', { token, newPassword: 'another-password-789' })).status, 400);
  } finally { socket.disconnect(); }
}));

test('verification tokens bind the account email and resend cooldown and daily caps are persistent', async () => fixture(async ({ runtime, emails, request }) => {
  const state = await (await request('/auth/register', 'POST', account)).json();
  await runtime.mail.flush(); const token = mailToken(emails[0]);
  runtime.repo.run('UPDATE users SET email=? WHERE id=?', 'changed@example.com', state.user.id);
  assert.equal((await request('/auth/verify-email', 'POST', { token })).status, 400);
  runtime.repo.run('UPDATE users SET email=? WHERE id=?', account.email, state.user.id);
  assert.equal((await request('/auth/resend-verification', 'POST')).status, 429);
  runtime.repo.run('UPDATE auth_tokens SET expires_at=?,created_at=? WHERE user_id=?', Date.now() - 1, Date.now() - 61_000, state.user.id);
  assert.equal((await request('/auth/verify-email', 'POST', { token })).status, 400);
  assert.equal((await request('/auth/resend-verification', 'POST')).status, 202);
  await runtime.mail.flush(); assert.equal(emails.length, 2);
  assert.notEqual(mailToken(emails[1]), token);
  runtime.repo.run('UPDATE auth_tokens SET created_at=? WHERE user_id=?', Date.now() - 61_000, state.user.id);
  for (let n = 0; n < 8; n++) runtime.repo.run('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)', randomUUID(), randomBytes(32).toString('hex'), state.user.id, 'verify', account.email, Date.now() + 1000, Date.now() - 60_000, Date.now() - 61_000);
  assert.equal((await request('/auth/resend-verification', 'POST')).status, 429);
}));

test('mail failures leave encrypted durable work queued without failing committed registration', async () => {
  let fail = true; const delivered: AuthMail[] = [];
  await fixture(async ({ runtime, request }) => {
    assert.equal((await request('/auth/register', 'POST', account)).status, 200);
    await runtime.mail.flush();
    const queued = runtime.repo.get('SELECT * FROM mail_outbox')!;
    assert.equal(queued.status, 'pending'); assert.equal(queued.attempts, 1); assert.ok(queued.payload.length > 100);
    assert.equal(queued.payload.includes(account.email), false);
    assert.equal(runtime.repo.get('SELECT count(*) AS n FROM users')!.n, 1);
    fail = false; runtime.repo.run('UPDATE mail_outbox SET next_attempt_at=0');
    await runtime.mail.flush();
    assert.equal(delivered.length, 1); assert.equal(runtime.repo.get('SELECT status FROM mail_outbox')!.status, 'delivered');
    assert.equal(runtime.repo.get('SELECT payload FROM mail_outbox')!.payload, '');
  }, { mailTransport: async message => { if (fail) throw new Error('simulated SMTP failure'); delivered.push(message); } });
});

test('v1 migration preserves accounts and sessions while adding the verification gate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-v1-migration-')); const databasePath = join(directory, 'old.sqlite');
  const db = new DatabaseSync(databasePath); const user = randomUUID(); const workspace = randomUUID(); const token = randomBytes(32).toString('hex');
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,is_demo INTEGER,created_at TEXT); CREATE TABLE users(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,email TEXT,password_hash TEXT,color TEXT,role TEXT,status TEXT,created_at TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); PRAGMA user_version=1;");
  db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(workspace, 'Preserved team', 0, new Date().toISOString());
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)').run(user, workspace, 'Old account', account.email, null, '#abcdef', 'owner', '', new Date().toISOString());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), user, Date.now() + 60_000); db.close();
  try {
    await fixture(async ({ runtime, request, setCookie }) => {
      setCookie(`mola_session=${token}`);
      const response = await request('/auth/me'); assert.equal(response.status, 200);
      const state = await response.json(); assert.equal(state.user.id, user); assert.equal(state.workspace.name, 'Preserved team'); assert.equal(state.user.emailVerified, false);
      assert.equal(runtime.repo.get('PRAGMA user_version')!.user_version, 10);
    }, { databasePath });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('encrypted queued mail survives an application restart and remains usable with the same key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-outbox-restart-')); const databasePath = join(directory, 'mola.sqlite');
  try {
    await fixture(async ({ request, runtime }) => {
      assert.equal((await request('/auth/register', 'POST', account)).status, 200);
      assert.equal(runtime.repo.get('SELECT status FROM mail_outbox')!.status, 'pending');
    }, { databasePath });
    await fixture(async ({ runtime, emails, request }) => {
      await runtime.mail.flush(); assert.equal(emails.length, 1);
      assert.equal((await request('/auth/verify-email', 'POST', { token: mailToken(emails[0]) })).status, 200);
      assert.equal(runtime.repo.get('SELECT email_verified FROM users')!.email_verified, 1);
    }, { databasePath });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production SMTP refuses plaintext fallback and cannot disable email verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-smtp-tls-'));
  const commands: string[] = [];
  const smtp = createTcpServer(socket => {
    socket.write('220 localhost test SMTP\r\n');
    let buffered = '';
    socket.on('data', data => {
      buffered += data.toString();
      while (buffered.includes('\n')) {
        const newline = buffered.indexOf('\n'); const line = buffered.slice(0, newline).trim(); buffered = buffered.slice(newline + 1); commands.push(line.split(' ')[0]);
        if (line.startsWith('EHLO') || line.startsWith('HELO')) socket.write('250 localhost\r\n');
        else if (line === 'STARTTLS') socket.end('454 TLS unavailable\r\n');
        else socket.end('550 Plaintext delivery forbidden\r\n');
      }
    });
  });
  await new Promise<void>(done => smtp.listen(0, '127.0.0.1', done));
  const variables = ['TURN_URLS', 'TURN_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'SMTP_ALLOW_INSECURE'] as const;
  const saved = Object.fromEntries(variables.map(name => [name, process.env[name]]));
  let runtime: ReturnType<typeof createApp> | undefined;
  try {
    Object.assign(process.env, { TURN_URLS: 'turn:relay.example.com:3478', TURN_SECRET: 'a'.repeat(48), SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as AddressInfo).port), SMTP_SECURE: 'false', SMTP_USER: 'test-user', SMTP_PASS: 'test-password', MAIL_FROM: 'mola@example.com', SMTP_ALLOW_INSECURE: 'true' });
    runtime = createApp({ production: true, requireEmailVerification: false, appOrigin: 'https://app.example.com', databasePath: ':memory:', dataDir: directory, mailEncryptionKey: KEY });
    await new Promise<void>(done => runtime!.server.listen(0, '127.0.0.1', done));
    const response = await fetch(`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}/api/auth/register`, { method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
    assert.equal(response.status, 200); const state = await response.json(); assert.equal(state.emailVerificationRequired, true); assert.deepEqual(state.channels, []);
    await runtime.mail.flush();
    assert.ok(commands.includes('STARTTLS')); assert.equal(commands.includes('MAIL'), false); assert.equal(commands.includes('DATA'), false);
    assert.equal(runtime.repo.get('SELECT status FROM mail_outbox')!.status, 'pending');
  } finally {
    await runtime?.close(); await new Promise<void>(done => smtp.close(() => done()));
    for (const name of variables) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local mail spool drops expired generated mail while retaining fresh mail and unrelated files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-spool-retention-'));
  const spool = join(directory, 'mail'); mkdirSync(spool);
  const oldMail = join(spool, `${randomUUID()}.json`); const freshMail = join(spool, `${randomUUID()}.json`); const unrelated = join(spool, 'readme.json');
  for (const path of [oldMail, freshMail, unrelated]) writeFileSync(path, '{}');
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60_000); utimesSync(oldMail, oldDate, oldDate); utimesSync(unrelated, oldDate, oldDate);
  const smtpHost = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
  let runtime: ReturnType<typeof createApp> | undefined;
  try {
    runtime = createApp({ production: false, databasePath: ':memory:', dataDir: directory, mailEncryptionKey: KEY });
    assert.equal(existsSync(oldMail), false); assert.equal(existsSync(freshMail), true); assert.equal(existsSync(unrelated), true);
  } finally {
    await runtime?.close(); if (smtpHost !== undefined) process.env.SMTP_HOST = smtpHost;
    rmSync(directory, { recursive: true, force: true });
  }
});
