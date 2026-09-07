import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { readListenerConfig, startListeners } from '../server/listeners.js';

const origin = 'http://separate-operations.test';
const listen = (server: Server) => new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const portOf = (server: Server) => (server.address() as AddressInfo).port;
const stop = (server: Server) => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));

async function fixture(run: (context: { runtime: ReturnType<typeof createApp>; publicUrl: string; operationsUrl: string; token: string; directory: string }) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'mola-operations-listener-'));
  const previousPort = process.env.OPS_PORT;
  process.env.OPS_PORT = process.env.PORT === '9100' ? '9101' : '9100';
  const runtime = createApp({ dataDir: directory, production: false, appOrigin: origin, mailEncryptionKey: 'f'.repeat(64), mailTransport: async () => {} });
  if (previousPort === undefined) delete process.env.OPS_PORT; else process.env.OPS_PORT = previousPort;
  try {
    assert.ok(runtime.opsServer);
    await listen(runtime.server); await listen(runtime.opsServer);
    await run({ runtime, publicUrl: `http://127.0.0.1:${portOf(runtime.server)}`, operationsUrl: `http://127.0.0.1:${portOf(runtime.opsServer)}`, token: readFileSync(join(directory, '.ops-token'), 'utf8').trim(), directory });
  } finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('dedicated operations ports require valid distinct listener ports; default mode is unchanged', () => {
  assert.deepEqual(readListenerConfig({}), { port: 3001, opsPort: undefined, host: '0.0.0.0' });
  assert.deepEqual(readListenerConfig({ PORT: '3001', OPS_PORT: ' 9100 ', HOST: '127.0.0.1' }), { port: 3001, opsPort: 9100, host: '127.0.0.1' });
  assert.equal(readListenerConfig({ OPS_PORT: ' ' }).opsPort, undefined);
  for (const field of ['PORT', 'OPS_PORT']) for (const value of ['0', '-1', '65536', '1.5', 'NaN', 'Infinity', '0x238c', '9.1e3', 'abc']) {
    assert.throws(() => readListenerConfig({ [field]: value }), new RegExp(`${field} must be an integer`), `${field}=${value}`);
  }
  assert.throws(() => readListenerConfig({ PORT: '9100', OPS_PORT: '9100' }), /must differ/);
  const previousPort = process.env.OPS_PORT;
  const directory = join(tmpdir(), `mola-invalid-operations-${crypto.randomUUID()}`);
  try {
    process.env.OPS_PORT = 'invalid';
    assert.throws(() => createApp({ dataDir: directory }), /OPS_PORT/);
    assert.equal(existsSync(directory), false, 'Invalid listener configuration does not initialize database or secret files');
  } finally { if (previousPort === undefined) delete process.env.OPS_PORT; else process.env.OPS_PORT = previousPort; }
});

test('public listener hides all operations routes and normalized variants even with a valid bearer token', async () => fixture(async ({ publicUrl, token }) => {
  for (const path of ['/internal', '/internal/', '/internal/metrics', '/internal/metrics/', '/INTERNAL/METRICS', '//internal/metrics', '/%69nternal/metrics', '/internal%2Fmetrics', '/internal%5Cmetrics', '/internal//snapshots', '/internal/snapshots/nonexistent']) {
    for (const method of ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await fetch(publicUrl + path, { method, headers: { Authorization: `Bearer ${token}`, Origin: origin } });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal((await response.text()).includes('mola_database_ready'), false);
    }
  }
  const malformed = await fetch(publicUrl + '/internal/snapshots', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(malformed.status, 404, 'Reserved paths are blocked before body parsing');
  assert.equal((await fetch(publicUrl + '/api/health')).status, 200);
  assert.equal((await fetch(publicUrl + '/api/auth/me')).status, 401);
}));

test('private listener retains bearer authentication, metrics and snapshots but exposes no application or Socket.IO routes', async () => fixture(async ({ publicUrl, operationsUrl, token, directory }) => {
  const demo = await fetch(publicUrl + '/api/auth/demo', { method: 'POST', headers: { Origin: origin } });
  assert.equal(demo.status, 200);
  const cookie = demo.headers.get('set-cookie')!.split(';')[0];
  for (const authorization of [undefined, `Bearer ${'x'.repeat(token.length)}`, 'Bearer short']) {
    for (const [method, path] of [['GET', '/internal/metrics'], ['POST', '/internal/snapshots'], ['DELETE', '/internal/snapshots/snapshot-00000000-0000-0000-0000-000000000000']]) {
      const response = await fetch(operationsUrl + path, { method, headers: { Cookie: cookie, ...(authorization ? { Authorization: authorization } : {}) } });
      assert.equal(response.status, 401, `${method} ${path}`);
      await response.text();
    }
  }
  const headers = { Authorization: `Bearer ${token}` };
  const metrics = await fetch(operationsUrl + '/internal/metrics', { headers });
  assert.equal(metrics.status, 200); assert.equal(metrics.headers.get('cache-control'), 'no-store');
  assert.match(await metrics.text(), /mola_database_ready 1/);
  const snapshot = await fetch(operationsUrl + '/internal/snapshots', { method: 'POST', headers });
  assert.equal(snapshot.status, 201);
  const created = await snapshot.json();
  assert.ok(existsSync(join(directory, 'snapshots', created.id, 'mola.sqlite')));
  assert.equal((await fetch(operationsUrl + `/internal/snapshots/${created.id}`, { method: 'DELETE', headers })).status, 204);
  assert.equal(existsSync(join(directory, 'snapshots', created.id)), false);
  for (const [method, path] of [['GET', '/'], ['GET', '/api/health'], ['GET', '/api/auth/me'], ['POST', '/api/auth/demo'], ['GET', '/socket.io/?EIO=4&transport=polling'], ['GET', '/assets/index.js']]) {
    const response = await fetch(operationsUrl + path, { method, headers: { ...headers, Cookie: cookie, Origin: origin } });
    assert.equal(response.status, 404, `${method} ${path}`); await response.text();
  }
  const upgradeStatus = await new Promise<number>((done, reject) => {
    const request = httpRequest(operationsUrl + '/socket.io/?EIO=4&transport=websocket', { headers: { ...headers, Origin: origin, Cookie: cookie, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64'), 'Sec-WebSocket-Version': '13' } }, response => { response.resume(); done(response.statusCode!); });
    request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Operations listener accepted a WebSocket upgrade')); });
    request.on('error', reject); request.end();
  });
  assert.equal(upgradeStatus, 404);
}));

test('shutdown closes both listeners and authenticated public sockets before closing the database', async () => fixture(async ({ runtime, publicUrl, operationsUrl, token }) => {
  const demo = await fetch(publicUrl + '/api/auth/demo', { method: 'POST', headers: { Origin: origin } });
  const cookie = demo.headers.get('set-cookie')!.split(';')[0];
  await demo.text();
  const socket = connect(publicUrl, { transports: ['websocket'], extraHeaders: { Origin: origin, Cookie: cookie }, reconnection: false });
  try {
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    assert.equal(socket.connected, true);
    const disconnected = new Promise<void>(done => socket.once('disconnect', () => done()));
    await Promise.all([runtime.close(), runtime.close(), disconnected]);
    assert.equal(runtime.server.listening, false); assert.equal(runtime.opsServer!.listening, false);
    assert.equal(socket.connected, false);
    assert.throws(() => runtime.db.prepare('SELECT 1'), /not open|closed/i);
    await assert.rejects(fetch(publicUrl + '/api/health'));
    await assert.rejects(fetch(operationsUrl + '/internal/metrics', { headers: { Authorization: `Bearer ${token}` } }));
  } finally { socket.disconnect(); }
}));

test('either listener bind failure closes the runtime and never leaves a healthy public server behind', async () => {
  for (const occupied of ['public', 'operations']) {
    const directory = mkdtempSync(join(tmpdir(), 'mola-listener-bind-'));
    const blocker = createServer(); const available = createServer();
    await listen(blocker); await listen(available);
    const occupiedPort = portOf(blocker); const availablePort = portOf(available);
    await stop(available);
    const config = readListenerConfig({ PORT: String(occupied === 'public' ? occupiedPort : availablePort), OPS_PORT: String(occupied === 'operations' ? occupiedPort : availablePort), HOST: '127.0.0.1' });
    const previousPort = process.env.OPS_PORT;
    process.env.OPS_PORT = String(config.opsPort);
    const runtime = createApp({ dataDir: directory, production: false, appOrigin: origin, mailEncryptionKey: 'e'.repeat(64), mailTransport: async () => {} });
    if (previousPort === undefined) delete process.env.OPS_PORT; else process.env.OPS_PORT = previousPort;
    try {
      await assert.rejects(startListeners(runtime, config), { code: 'EADDRINUSE' });
      assert.equal(runtime.server.listening, false); assert.equal(runtime.opsServer!.listening, false);
      assert.throws(() => runtime.db.prepare('SELECT 1'), /not open|closed/i);
    } finally { await runtime.close(); await stop(blocker); rmSync(directory, { recursive: true, force: true }); }
  }
});
