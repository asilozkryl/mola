import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io as connectSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp, type AppOptions } from '../server/app.js';

async function fixture(run: (ctx: { runtime: ReturnType<typeof createApp>; request: (path: string, options?: RequestInit & { json?: unknown }) => Promise<Response>; getCookie: () => string; setCookie: (cookie: string) => void }) => Promise<void>, appOptions: AppOptions = {}) {
  const uploadDir = mkdtempSync(join(tmpdir(), 'mola-backend-'));
  const runtime = createApp({ databasePath: ':memory:', uploadDir, production: false, mailEncryptionKey: 'a'.repeat(64), mailTransport: async () => {}, ...appOptions });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  let cookie = '';
  const request = async (path: string, options: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(options.headers);
    if (cookie) headers.set('Cookie', cookie);
    headers.set('Origin', appOptions.appOrigin || 'http://localhost:5173');
    if (options.json !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(base + path, { ...options, headers, body: options.json === undefined ? options.body : JSON.stringify(options.json) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };
  try { await run({ runtime, request, getCookie: () => cookie, setCookie: value => { cookie = value; } }); }
  finally { await runtime.close(); assert.ok(resolve(uploadDir).startsWith(resolve(tmpdir()) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))); rmSync(uploadDir, { recursive: true, force: true }); }
}

test('registration, hashed sessions, login and logout persist and revoke access', async () => fixture(async ({ runtime, request, getCookie, setCookie }) => {
  assert.equal((await request('/api/auth/me')).status, 401);
  const registration = await request('/api/auth/register', { method: 'POST', json: { name: 'Asil Test', email: 'Asil@Example.com', password: 'correct-horse-123', workspaceName: 'Test ekibi' } });
  assert.equal(registration.status, 200);
  assert.match(registration.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(registration.headers.get('set-cookie')!, /SameSite=Lax/);
  const state = await registration.json();
  assert.equal(state.user.email, 'asil@example.com');
  assert.equal(state.workspace.isDemo, false);
  assert.equal(state.members.length, 1);
  assert.equal(state.onlineIds.length, 0);
  const oldCookie = getCookie();
  const saved = runtime.repo.get('SELECT * FROM sessions')!;
  assert.notEqual(saved.token_hash, oldCookie.split('=')[1]);
  assert.equal(runtime.repo.get('SELECT password_hash FROM users')!.password_hash.includes('correct-horse-123'), false);
  assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 204);
  setCookie(oldCookie);
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', json: { email: 'asil@example.com', password: 'wrong-password' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', json: { email: 'asil@example.com', password: 'correct-horse-123' } })).status, 200);
  assert.notEqual(getCookie(), oldCookie);
}));

test('demo sessions are isolated and messages support threads, reactions, edits and deletion', async () => fixture(async ({ request, getCookie, setCookie }) => {
  const first = await (await request('/api/auth/demo', { method: 'POST' })).json();
  assert.equal(first.members.length, 5);
  assert.equal(first.onlineIds.length, 0);
  const firstCookie = getCookie();
  setCookie('');
  const second = await (await request('/api/auth/demo', { method: 'POST' })).json();
  assert.notEqual(first.workspace.id, second.workspace.id);
  const channel = first.channels.find((value: any) => value.name === 'tasarım');
  assert.equal((await request(`/api/channels/${channel.id}/messages`)).status, 404);
  setCookie(firstCookie);
  const search = await (await request('/api/search?q=TASARIM')).json();
  assert.ok(search.messages.length > 0, 'Turkish uppercase search finds lowercase content');
  const created = await request(`/api/channels/${channel.id}/messages`, { method: 'POST', json: { content: 'Birlikte test edelim' } });
  assert.equal(created.status, 201);
  const message = await created.json();
  const reply = await (await request(`/api/channels/${channel.id}/messages`, { method: 'POST', json: { content: 'Yanıt hazır', parentId: message.id } })).json();
  assert.equal(reply.parentId, message.id);
  const messages = await (await request(`/api/channels/${channel.id}/messages`)).json();
  assert.equal(messages.messages.find((value: any) => value.id === message.id).replyCount, 1);
  assert.equal(messages.messages.some((value: any) => value.id === reply.id), false);
  assert.equal((await (await request(`/api/channels/${channel.id}/messages?parentId=${message.id}`)).json()).messages.length, 1);
  const reacted = await (await request(`/api/messages/${message.id}/reactions`, { method: 'POST', json: { emoji: '🙌' } })).json();
  assert.deepEqual(reacted.reactions, [{ emoji: '🙌', userIds: [first.user.id] }]);
  const unreacted = await (await request(`/api/messages/${message.id}/reactions`, { method: 'POST', json: { emoji: '🙌' } })).json();
  assert.deepEqual(unreacted.reactions, []);
  const edited = await (await request(`/api/messages/${message.id}`, { method: 'PATCH', json: { content: 'Düzenlendi', pinned: true } })).json();
  assert.equal(edited.content, 'Düzenlendi'); assert.equal(edited.pinned, true); assert.ok(edited.editedAt);
  assert.equal((await request(`/api/messages/${message.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/api/messages/${reply.id}`, { method: 'PATCH', json: { content: 'Yok' } })).status, 404);
}));

test('uploads are validated and can be attached only once by the uploader', async () => fixture(async ({ request }) => {
  const state = await (await request('/api/auth/demo', { method: 'POST' })).json();
  const channelId = state.channels[0].id;
  const forbidden = new FormData(); forbidden.set('file', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'unsafe.svg');
  assert.equal((await request('/api/uploads', { method: 'POST', body: forbidden })).status, 400);
  const form = new FormData(); form.set('file', new Blob(['Takım notları'], { type: 'text/plain' }), 'tasarım-notları.txt');
  const uploaded = await request('/api/uploads', { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);
  const attachment = await uploaded.json();
  const file = await request(attachment.url);
  assert.equal(file.status, 200); assert.match(file.headers.get('content-disposition')!, /^attachment;/); assert.equal(await file.text(), 'Takım notları');
  const sent = await request(`/api/channels/${channelId}/messages`, { method: 'POST', json: { attachmentIds: [attachment.id] } });
  assert.equal(sent.status, 201);
  assert.equal((await sent.json()).attachments[0].name, 'tasarım-notları.txt');
  assert.equal((await request(`/api/channels/${channelId}/messages`, { method: 'POST', json: { attachmentIds: [attachment.id] } })).status, 400);
}));

test('pins and files include older channel history and direct message reads remain isolated', async () => fixture(async ({ runtime, request, getCookie, setCookie }) => {
  const state = await (await request('/api/auth/demo', { method: 'POST' })).json();
  const channelId = state.channels[0].id;
  const oldId = randomUUID();
  runtime.repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', oldId, channelId, state.user.id, 'Arşivdeki sabit mesaj', '2020-01-01T00:00:00.000Z', null, null, 1);
  const csv = new FormData(); csv.set('file', new Blob(['name,count\nMola,1'], { type: 'text/csv' }), 'tablo.csv');
  const uploaded = await request('/api/uploads', { method: 'POST', body: csv });
  assert.equal(uploaded.status, 201);
  const file = await uploaded.json();
  assert.equal(file.mime, 'text/csv');
  runtime.repo.run('UPDATE attachments SET message_id=? WHERE id=?', oldId, file.id);
  for (let index = 0; index < 51; index++) runtime.repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', randomUUID(), channelId, state.user.id, `Yeni mesaj ${index}`, new Date(Date.now() + index).toISOString(), null, null, 0);
  const latest = await (await request(`/api/channels/${channelId}/messages`)).json();
  assert.equal(latest.hasMore, true);
  assert.equal(latest.messages.some((message: any) => message.id === oldId), false);
  assert.ok((await (await request(`/api/channels/${channelId}/pins`)).json()).messages.some((message: any) => message.id === oldId));
  assert.deepEqual((await (await request(`/api/channels/${channelId}/files`)).json()).files.map((attachment: any) => attachment.id), [file.id]);
  assert.equal((await (await request(`/api/messages/${oldId}`)).json()).content, 'Arşivdeki sabit mesaj');
  const firstCookie = getCookie();
  setCookie(''); await request('/api/auth/demo', { method: 'POST' });
  for (const path of [`/api/messages/${oldId}`, `/api/channels/${channelId}/pins`, `/api/channels/${channelId}/files`]) assert.equal((await request(path)).status, 404);
  setCookie(firstCookie);
  assert.match((await request(file.url)).headers.get('content-disposition')!, /^attachment;/);
  assert.equal((await request(`/api/channels/${channelId}/messages`, { method: 'POST', json: { content: 'a'.repeat(10_000) } })).status, 201);
  assert.equal((await request(`/api/channels/${channelId}/messages`, { method: 'POST', json: { content: 'a'.repeat(10_001) } })).status, 400);
  assert.equal((await request(`/api/channels/${channelId}/messages`, { method: 'POST', json: { attachmentIds: Array.from({ length: 5 }, () => randomUUID()) } })).status, 400);
}));

test('password change verifies the current password and revokes other sessions including sockets', async () => fixture(async ({ runtime, request, getCookie, setCookie }) => {
  const account = { name: 'Asil Test', email: 'password@example.com', password: 'original-password-123', workspaceName: 'Parola ekibi' };
  await request('/api/auth/register', { method: 'POST', json: account });
  const currentCookie = getCookie();
  setCookie('');
  await request('/api/auth/login', { method: 'POST', json: { email: account.email, password: account.password } });
  const otherCookie = getCookie();
  const socket = connectSocket(`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`, { transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5173', Cookie: otherCookie }, reconnection: false });
  try {
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    setCookie(currentCookie);
    assert.equal((await request('/api/auth/password', { method: 'PATCH', json: { currentPassword: 'incorrect-password', newPassword: 'replacement-password-456' } })).status, 401);
    assert.equal((await request('/api/auth/password', { method: 'PATCH', json: { currentPassword: account.password, newPassword: 'too-short' } })).status, 400);
    const disconnected = new Promise<void>(done => socket.once('disconnect', () => done()));
    assert.equal((await request('/api/auth/password', { method: 'PATCH', json: { currentPassword: account.password, newPassword: 'replacement-password-456' } })).status, 204);
    await disconnected;
    assert.equal((await request('/api/auth/me')).status, 200);
    setCookie(otherCookie);
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', json: { email: account.email, password: account.password } })).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', json: { email: account.email, password: 'replacement-password-456' } })).status, 200);
  } finally { socket.disconnect(); }
}));

test('authentication limit override is bounded and isolated to non-production test servers', async () => {
  const envKeys = ['NODE_ENV', 'MOLA_TEST_AUTH_LIMIT', 'TURN_URLS', 'TURN_SECRET'] as const;
  const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    process.env.TURN_URLS = 'turn:relay.example.com:3478';
    process.env.TURN_SECRET = 'test-only-secret-never-use-in-production-123456';
    for (const scenario of [
      { env: 'test', override: '100', production: false, expected: 100 },
      { env: 'test', override: '500', production: false, expected: 500 },
      { env: 'test', override: undefined, production: false, expected: 20 },
      { env: 'test', override: 'invalid', production: false, expected: 20 },
      { env: 'test', override: '19', production: false, expected: 20 },
      { env: 'test', override: '501', production: false, expected: 20 },
      { env: 'test', override: '20.5', production: false, expected: 20 },
      { env: 'test', override: 'Infinity', production: false, expected: 20 },
      { env: 'development', override: '100', production: false, expected: 20 },
      { env: 'test', override: '100', production: true, expected: 20 },
    ]) {
      process.env.NODE_ENV = scenario.env;
      if (scenario.override === undefined) delete process.env.MOLA_TEST_AUTH_LIMIT;
      else process.env.MOLA_TEST_AUTH_LIMIT = scenario.override;
      await fixture(async ({ request }) => {
        const response = await request('/api/auth/login', { method: 'POST', json: {} });
        assert.equal(response.status, 400);
        assert.match(response.headers.get('ratelimit-policy') || '', new RegExp(`q=${scenario.expected}(?:;|,)`), JSON.stringify(scenario));
      }, { production: scenario.production, ...(scenario.production ? { appOrigin: 'https://app.example.com' } : {}) });
    }
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test('API limit override is bounded to test fixtures and production still rejects request 301', async () => {
  const envKeys = ['NODE_ENV', 'MOLA_TEST_API_LIMIT', 'TURN_URLS', 'TURN_SECRET'] as const;
  const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    process.env.TURN_URLS = 'turn:relay.example.com:3478';
    process.env.TURN_SECRET = 'test-only-api-limit-secret-never-use-in-production';
    for (const scenario of [
      { env: 'test', override: '2000', production: false, expected: 2000, probe: true },
      { env: 'test', override: '5000', production: false, expected: 5000 },
      { env: 'test', override: '300', production: false, expected: 300 },
      { env: 'test', override: undefined, production: false, expected: 300 },
      { env: 'test', override: 'invalid', production: false, expected: 300 },
      { env: 'test', override: '299', production: false, expected: 300 },
      { env: 'test', override: '5001', production: false, expected: 300 },
      { env: 'test', override: '300.5', production: false, expected: 300 },
      { env: 'test', override: 'Infinity', production: false, expected: 300 },
      { env: 'development', override: '2000', production: false, expected: 300, probe: true },
      { env: 'production', override: '2000', production: true, expected: 300 },
      { env: 'test', override: '2000', production: true, expected: 300, probe: true },
    ]) {
      process.env.NODE_ENV = scenario.env;
      if (scenario.override === undefined) delete process.env.MOLA_TEST_API_LIMIT;
      else process.env.MOLA_TEST_API_LIMIT = scenario.override;
      await fixture(async ({ request }) => {
        const response = await request('/api/health');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('ratelimit-policy') || '', new RegExp(`q=${scenario.expected}(?:;|,)`), JSON.stringify(scenario));
        await response.arrayBuffer();
        if (scenario.probe) {
          for (let count = 2; count <= 301; count++) {
            const next = await request('/api/health');
            assert.equal(next.status, count > scenario.expected ? 429 : 200, `${JSON.stringify(scenario)} request ${count}`);
            await next.arrayBuffer();
          }
        }
      }, { production: scenario.production, ...(scenario.production ? { appOrigin: 'https://app.example.com' } : {}) });
    }
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
