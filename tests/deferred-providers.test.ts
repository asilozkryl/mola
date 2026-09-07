import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createMailService } from '../server/mail.js';
import { createWorkspace } from '../server/seed.js';
import { HttpError } from '../server/errors.js';
import type { Repository } from '../server/db.js';

const origin = 'https://deferred-providers.example';
const password = 'existing-verified-password-123';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const envNames = ['EMAIL_DELIVERY_ENABLED', 'REQUIRE_TURN', 'TURN_URLS', 'TURN_SECRET', 'MAIL_ENCRYPTION_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'ENABLE_DEMO', 'REQUIRE_EMAIL_VERIFICATION', 'OPS_PORT', 'OPS_TOKEN', 'OPS_TOKEN_FILE', 'ALERT_WEBHOOK_URL', 'LOCAL_MAILBOX_URL'] as const;

async function environment(values: Record<string, string>, run: () => Promise<void>) {
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  try {
    for (const name of envNames) delete process.env[name];
    Object.assign(process.env, values);
    await run();
  } finally { for (const name of envNames) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
}

function removeFixture(directory: string) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  rmSync(directory, { recursive: true, force: true });
}

async function fixture(run: (context: {
  runtime: ReturnType<typeof createApp>; directory: string; base: string;
  request: (path: string, method?: string, body?: unknown, cookie?: string) => Promise<Response>;
}) => Promise<void>) {
  await environment({ EMAIL_DELIVERY_ENABLED: 'false', REQUIRE_TURN: 'false', REQUIRE_EMAIL_VERIFICATION: 'false' }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mola-deferred-providers-'));
    let runtime: ReturnType<typeof createApp> | undefined;
    try {
      runtime = createApp({ production: true, appOrigin: origin, dataDir: directory, requireEmailVerification: false });
      await new Promise<void>(done => runtime!.server.listen(0, '127.0.0.1', done));
      const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
      const request = (path: string, method = 'GET', body?: unknown, cookie = '') => fetch(base + '/api' + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      await run({ runtime, directory, base, request });
    } finally { await runtime?.close(); removeFixture(directory); }
  });
}

function seedAccount(runtime: ReturnType<typeof createApp>, email: string, verified: boolean) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  const account = createWorkspace(runtime.repo, { name: 'Existing team', userName: 'Existing user', email, passwordHash: `scrypt$32768$8$3$${salt}$${key.toString('hex')}` });
  if (verified) runtime.repo.run('UPDATE users SET email_verified=1 WHERE id=?', account.userId);
  return account;
}

test('explicitly deferred production starts without mail keys or TURN, disables registration and sends no mail', async () => fixture(async ({ runtime, request, directory }) => {
  assert.equal((await request('/health')).status, 200);
  assert.deepEqual(await (await request('/config')).json(), { demoEnabled: false, emailVerificationRequired: true, emailDeliveryAvailable: false, registrationAvailable: false, relayConfigured: false });
  assert.equal((await request('/auth/demo', 'POST')).status, 403);
  const response = await request('/auth/register', 'POST', { name: 'Blocked registration', email: 'new@example.invalid', password, workspaceName: 'Should not exist' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).code, 'EMAIL_UNAVAILABLE');
  const recovery = await request('/auth/forgot-password', 'POST', { email: 'unknown@example.invalid' });
  assert.equal(recovery.status, 503); assert.equal((await recovery.json()).code, 'EMAIL_UNAVAILABLE');
  await runtime.mail.flush();
  for (const table of ['users', 'workspaces', 'sessions', 'auth_tokens', 'mail_outbox']) assert.equal(runtime.repo.get(`SELECT count(*) AS n FROM ${table}`)!.n, 0, table);
  assert.equal(existsSync(join(directory, '.mail-key')), false);
  assert.equal(existsSync(join(directory, 'mail')), false);
}));

test('disabled mail performs no repository work, creates no timer or key, and rejects issue before mutation', async () => environment({ EMAIL_DELIVERY_ENABLED: 'false', MAIL_ENCRYPTION_KEY: 'deliberately-invalid-unused-key', SMTP_HOST: 'unused.invalid' }, async () => {
  const directory = join(tmpdir(), `mola-unused-mail-${randomUUID()}`);
  const repository = new Proxy({}, { get() { throw new Error('Disabled mail touched the repository'); } }) as Repository;
  const interval = mock.method(globalThis, 'setInterval');
  let transportCalls = 0;
  try {
    const mail = createMailService(repository, { production: true, dataDir: directory, origin, mailTransport: async () => { transportCalls++; } });
    assert.equal(mail.available, false);
    assert.throws(() => mail.issue({ id: 'unused', email: 'unused@example.invalid' }, 'verify'), error => error instanceof HttpError && error.status === 503 && error.code === 'EMAIL_UNAVAILABLE');
    assert.throws(() => mail.issue({ id: 'unused', email: 'unused@example.invalid' }, 'reset'), { code: 'EMAIL_UNAVAILABLE' });
    await mail.flush(); await mail.close();
    assert.equal(interval.mock.callCount(), 0);
    assert.equal(transportCalls, 0);
    assert.equal(existsSync(directory), false);
  } finally { interval.mock.restore(); }
}));

test('verified users retain secure login and realtime chat while unverified users and invite registration remain blocked', async () => fixture(async ({ runtime, request, base }) => {
  const verified = seedAccount(runtime, 'verified@example.invalid', true);
  const unverified = seedAccount(runtime, 'unverified@example.invalid', false);
  const login = await request('/auth/login', 'POST', { email: 'verified@example.invalid', password });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /; Secure/i); assert.match(login.headers.get('set-cookie')!, /; HttpOnly/i);
  const state = await login.json();
  assert.equal(state.emailDeliveryAvailable, false); assert.equal(state.emailVerificationRequired, true); assert.equal(state.user.emailVerified, true);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const channel = state.channels.find((candidate: { kind: string }) => candidate.kind === 'text');
  const rtc = await (await request('/rtc/config', 'GET', undefined, cookie)).json();
  assert.equal(rtc.relayConfigured, false); assert.equal(rtc.iceServers.some((ice: { credential?: string }) => ice.credential), false);
  const socket = connect(base, { transports: ['websocket'], reconnection: false, timeout: 3000, extraHeaders: { Origin: origin, Cookie: cookie } });
  try {
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    const received = new Promise<{ content: string }>(done => socket.once('message:created', done));
    const message = await request(`/channels/${channel.id}/messages`, 'POST', { content: 'Mail setup can wait; existing chat works.' }, cookie);
    assert.equal(message.status, 201); assert.equal((await received).content, 'Mail setup can wait; existing chat works.');
  } finally { socket.disconnect(); }
  const inviteToken = randomBytes(32).toString('hex');
  runtime.repo.run('INSERT INTO invites (token_hash,workspace_id,created_by,expires_at,uses,max_uses,id,created_at) VALUES (?,?,?,?,?,?,?,?)', digest(inviteToken), verified.workspaceId, verified.userId, Date.now() + 60_000, 0, 5, randomUUID(), new Date().toISOString());
  const before = Object.fromEntries(['users', 'workspaces', 'sessions', 'auth_tokens', 'mail_outbox'].map(table => [table, runtime.repo.get(`SELECT count(*) AS n FROM ${table}`)!.n]));
  const registration = await request('/auth/register', 'POST', { name: 'Invited person', email: 'invited@example.invalid', password, inviteToken });
  assert.equal(registration.status, 503);
  for (const [table, count] of Object.entries(before)) assert.equal(runtime.repo.get(`SELECT count(*) AS n FROM ${table}`)!.n, count, table);
  assert.equal(runtime.repo.get('SELECT uses FROM invites WHERE token_hash=?', digest(inviteToken))!.uses, 0);
  const blockedLogin = await request('/auth/login', 'POST', { email: 'unverified@example.invalid', password });
  assert.equal(blockedLogin.status, 200);
  const blockedState = await blockedLogin.json();
  assert.equal(blockedState.user.emailVerified, false); assert.deepEqual(blockedState.channels, []); assert.deepEqual(blockedState.members, []);
  const blockedCookie = blockedLogin.headers.get('set-cookie')!.split(';')[0];
  for (const path of ['/channels', '/rtc/config', `/channels/${channel.id}/messages`]) {
    const blocked = await request(path, 'GET', undefined, blockedCookie);
    assert.equal(blocked.status, 403); assert.equal((await blocked.json()).code, 'EMAIL_NOT_VERIFIED');
  }
  const rejectedSocket = connect(base, { transports: ['websocket'], reconnection: false, timeout: 3000, extraHeaders: { Origin: origin, Cookie: blockedCookie } });
  try {
    const error = await new Promise<Error & { data?: { code: string } }>(done => rejectedSocket.once('connect_error', done));
    assert.equal(error.data?.code, 'EMAIL_NOT_VERIFIED');
  } finally { rejectedSocket.disconnect(); }
  const resend = await request('/auth/resend-verification', 'POST', undefined, blockedCookie);
  assert.equal(resend.status, 503); assert.equal((await resend.json()).code, 'EMAIL_UNAVAILABLE');
  const known = await request('/auth/forgot-password', 'POST', { email: 'verified@example.invalid' });
  const unknown = await request('/auth/forgot-password', 'POST', { email: 'absent@example.invalid' });
  assert.equal(known.status, 503); assert.equal(unknown.status, 503); assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(runtime.repo.get('SELECT email_verified FROM users WHERE id=?', unverified.userId)!.email_verified, 0);
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM auth_tokens')!.n, 0); assert.equal(runtime.repo.get('SELECT count(*) AS n FROM mail_outbox')!.n, 0);
}));

test('already delivered verification and reset links remain usable while disabled mail leaves pending encrypted mail untouched', async () => fixture(async ({ runtime, request }) => {
  const account = seedAccount(runtime, 'existing-token@example.invalid', false);
  const verify = randomBytes(32).toString('hex'); const reset = randomBytes(32).toString('hex');
  for (const [kind, raw] of [['verify', verify], ['reset', reset]]) runtime.repo.run('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)', randomUUID(), digest(raw), account.userId, kind, 'existing-token@example.invalid', Date.now() + 60_000, null, Date.now());
  const tokenId = runtime.repo.get("SELECT id FROM auth_tokens WHERE kind='verify'")!.id;
  runtime.repo.run('INSERT INTO mail_outbox (id,token_id,payload,next_attempt_at,created_at) VALUES (?,?,?,?,?)', randomUUID(), tokenId, 'opaque-existing-encrypted-payload', 0, Date.now());
  await runtime.mail.flush();
  const queued = runtime.repo.get('SELECT * FROM mail_outbox')!;
  assert.equal(queued.payload, 'opaque-existing-encrypted-payload'); assert.equal(queued.status, 'pending'); assert.equal(queued.attempts, 0);
  assert.equal((await request('/auth/verify-email', 'POST', { token: verify })).status, 200);
  assert.equal((await request('/auth/verify-email', 'POST', { token: verify })).status, 400);
  assert.equal((await request('/auth/reset-password', 'POST', { token: reset, newPassword: 'replacement-existing-password-456' })).status, 200);
  assert.equal((await request('/auth/reset-password', 'POST', { token: reset, newPassword: 'another-existing-password-789' })).status, 400);
  const login = await request('/auth/login', 'POST', { email: 'existing-token@example.invalid', password: 'replacement-existing-password-456' });
  assert.equal(login.status, 200); assert.equal((await login.json()).user.emailVerified, true);
}));

test('strict production defaults still reject missing providers and optional TURN refuses partial or invalid configuration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-provider-validation-'));
  const options = { production: true, appOrigin: origin, dataDir: directory, databasePath: ':memory:' };
  try {
    await environment({ EMAIL_DELIVERY_ENABLED: 'false' }, async () => { assert.throws(() => createApp(options), /TURN_URLS/); });
    await environment({ REQUIRE_TURN: 'false' }, async () => { assert.throws(() => createApp(options), /MAIL_ENCRYPTION_KEY/); });
    await environment({ REQUIRE_TURN: 'false', MAIL_ENCRYPTION_KEY: 'a'.repeat(64) }, async () => { assert.throws(() => createApp(options), /SMTP_HOST/); });
    await environment({ REQUIRE_TURN: 'false', EMAIL_DELIVERY_ENABLED: 'off' }, async () => { assert.throws(() => createApp(options), /EMAIL_DELIVERY_ENABLED/); });
    await environment({ REQUIRE_TURN: 'off', EMAIL_DELIVERY_ENABLED: 'false' }, async () => { assert.throws(() => createApp(options), /REQUIRE_TURN/); });
    for (const turn of [
      { TURN_URLS: 'turn:relay.example:3478', TURN_SECRET: '' },
      { TURN_URLS: '', TURN_SECRET: 'a'.repeat(48) },
      { TURN_URLS: 'turn:relay.example:3478', TURN_SECRET: 'short' },
      { TURN_URLS: 'turn:relay.example:3478', TURN_SECRET: ' '.repeat(48) },
      { TURN_URLS: 'https://relay.example', TURN_SECRET: 'a'.repeat(48) },
      { TURN_URLS: 'turn:relay.example:3478,', TURN_SECRET: 'a'.repeat(48) },
    ]) await environment({ EMAIL_DELIVERY_ENABLED: 'false', REQUIRE_TURN: 'false', ...turn }, async () => { assert.throws(() => createApp(options), /TURN_URLS|TURN_SECRET/); });
    await environment({ EMAIL_DELIVERY_ENABLED: 'false', REQUIRE_TURN: 'false', TURN_URLS: 'turn:relay.example:3478,turns:relay.example:5349', TURN_SECRET: 'a'.repeat(48) }, async () => {
      const runtime = createApp(options);
      try { assert.equal(runtime.mail.available, false); } finally { await runtime.close(); }
    });
  } finally { removeFixture(directory); }
});
