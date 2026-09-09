import { fork } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { request, Agent } from 'node:http';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';

const script = fileURLToPath(import.meta.url);
const origin = 'http://mola-load.test';
const hash = value => createHash('sha256').update(value).digest('hex');
const percentile = (values, p) => values.length ? +[...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)].toFixed(2) : 0;
const summarize = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: +values.reduce((maximum, value) => Math.max(maximum, value), 0).toFixed(2) });

if (process.argv.includes('--worker')) {
  process.once('message', async config => {
    let runtime;
    try {
      process.env.NODE_ENV = 'test';
      process.env.TRUST_PROXY = '1';
      process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
      // Benchmark production quotas, even when invoked from a browser-test shell.
      delete process.env.MOLA_TEST_API_LIMIT;
      delete process.env.MOLA_TEST_AUTH_LIMIT;
      delete process.env.MOLA_TEST_UPLOAD_LIMIT;
      const { createApp } = await import('../server/app.ts');
      const { createWorkspace } = await import('../server/seed.ts');
      const { openDatabase } = await import('../server/db.ts');
      runtime = createApp({ databasePath: join(config.directory, 'mola.sqlite'), uploadDir: join(config.directory, 'uploads'), appOrigin: origin, production: false, requireEmailVerification: false });
      const workspace = createWorkspace(runtime.repo, { name: 'Isolated performance fixture', userName: 'Load user 1', email: 'load-1@example.invalid', passwordHash: null });
      const users = [];
      runtime.repo.transaction(() => {
        for (let index = 0; index < config.users; index++) {
          const id = index === 0 ? workspace.userId : randomUUID();
          if (index) runtime.repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, workspace.workspaceId, `Load user ${index + 1}`, `load-${index + 1}@example.invalid`, null, '#c0e1ad', 'member', '', new Date().toISOString());
          const token = randomBytes(32).toString('hex');
          runtime.repo.run('INSERT INTO sessions (token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)', hash(token), id, workspace.workspaceId, Date.now() + (config.duration + 300) * 1000);
          users.push({ id, cookie: `mola_session=${token}`, ip: config.sharedIp ? '198.18.0.1' : `198.18.${Math.floor(index / 250)}.${index % 250 + 1}` });
        }
      });
      const channel = runtime.repo.get("SELECT id FROM channels WHERE workspace_id=? AND kind='text' ORDER BY rowid LIMIT 1", workspace.workspaceId).id;
      const baselineMessages = runtime.repo.get('SELECT count(*) AS count FROM messages').count;
      await new Promise(done => runtime.server.listen(0, '127.0.0.1', done));
      const histogram = monitorEventLoopDelay({ resolution: 20 });
      histogram.enable();
      const cpuStart = process.cpuUsage();
      const started = performance.now();
      const baselineRss = process.memoryUsage().rss;
      let peakRss = baselineRss;
      const memorySamples = [];
      const memoryTimer = setInterval(() => { const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); memorySamples.push({ elapsedSeconds: Math.round((performance.now() - started) / 1000), rssMiB: +(memory.rss / 1048576).toFixed(2), heapMiB: +(memory.heapUsed / 1048576).toFixed(2) }); }, 5000);
      process.send({ type: 'ready', port: runtime.server.address().port, channel, users });
      process.on('message', async message => {
        if (message.type !== 'finish') return;
        clearInterval(memoryTimer); histogram.disable();
        const finalMemory = process.memoryUsage();
        peakRss = Math.max(peakRss, finalMemory.rss);
        const elapsed = performance.now() - started;
        const cpu = process.cpuUsage(cpuStart);
        const online = runtime.repo.get('SELECT count(*) AS count FROM messages').count - baselineMessages;
        const resources = { process: 'isolated API/Socket.IO child process', elapsedSeconds: +(elapsed / 1000).toFixed(2), cpuPercentOfOneCore: +((cpu.user + cpu.system) / (elapsed * 10)).toFixed(2), baselineRssMiB: +(baselineRss / 1048576).toFixed(2), peakRssMiB: +(peakRss / 1048576).toFixed(2), finalRssMiB: +(finalMemory.rss / 1048576).toFixed(2), eventLoopDelayMs: { p50: +(histogram.percentile(50) / 1e6).toFixed(2), p95: +(histogram.percentile(95) / 1e6).toFixed(2), p99: +(histogram.percentile(99) / 1e6).toFixed(2), max: +(histogram.max / 1e6).toFixed(2) }, memorySamples };
        if (message.crash) {
          const wal = await stat(join(config.directory, 'mola.sqlite-wal')).catch(() => ({ size: 0 }));
          process.send({ type: 'crash-ready', resources, baselineMessages, committedMessages: online, walBytesBeforeKill: wal.size });
          return; // Parent force-terminates this process with SQLite still open.
        }
        await runtime.close();
        const reopened = openDatabase(join(config.directory, 'mola.sqlite'));
        const persisted = reopened.prepare('SELECT count(*) AS count FROM messages').get().count - baselineMessages;
        const integrity = reopened.prepare('PRAGMA integrity_check').get().integrity_check;
        reopened.close();
        process.send({ type: 'finished', resources, durability: { mode: 'graceful close and reopen', committedMessages: online, reopenedMessages: persisted, integrity } }, () => process.disconnect());
      });
    } catch (error) { process.send?.({ type: 'error', error: error instanceof Error ? error.message : String(error) }); await runtime?.close(); process.exitCode = 1; process.disconnect(); }
  });
} else {
  function option(name, fallback, min, max) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index < 0 ? fallback : Number(process.argv[index + 1]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer ${min}..${max}.`);
    return value;
  }
  const duration = option('duration', 120, 10, 1800);
  const userCount = option('users', 30, 2, 200);
  const targetMessages = option('messages', 1500, userCount, 20000);
  const crash = process.argv.includes('--crash');
  const sharedIp = process.argv.includes('--shared-ip');
  const outputIndex = process.argv.indexOf('--output');
  const output = resolve(outputIndex < 0 ? 'artifacts/load-latest.json' : process.argv[outputIndex + 1]);
  const directory = await mkdtemp(join(tmpdir(), 'mola-load-'));
  const { openDatabase } = await import('../server/db.ts');
  const child = fork(script, ['--worker'], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const sockets = [];
  const agent = new Agent({ keepAlive: true, maxSockets: userCount });
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const awaitWorker = type => new Promise((done, reject) => {
    const timeout = setTimeout(() => { child.off('message', listener); reject(new Error(`Worker ${type} timed out.`)); }, 30000);
    const listener = message => { if (message.type === type || message.type === 'error') { clearTimeout(timeout); child.off('message', listener); message.type === 'error' ? reject(new Error(message.error)) : done(message); } };
    child.on('message', listener);
    child.once('error', reject);
  });
  let finished = false;
  try {
    const readyPromise = awaitWorker('ready');
    child.send({ directory, users: userCount, duration, sharedIp });
    const ready = await readyPromise;
    const base = `http://127.0.0.1:${ready.port}`;
    const runId = randomUUID();
    const marker = `mola-load-${runId}:`;
    const latencies = { write: [], list: [], search: [] };
    const statusCounts = {};
    const errors = [];
    const accepted = new Set();
    const deliveries = new Map();
    const sendTimes = new Map();
    const notificationLatencies = [];
    let notificationSamples = 0;
    let duplicateDeliveries = 0;
    let completedRequests = 0;
    const call = (user, path, kind, body) => new Promise(done => {
      const start = performance.now();
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(`${base}/api${path}`, { method: payload ? 'POST' : 'GET', agent, timeout: 12000, headers: { Origin: origin, Cookie: user.cookie, 'X-Forwarded-For': user.ip, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const elapsed = performance.now() - start;
          latencies[kind].push(elapsed); completedRequests++;
          statusCounts[res.statusCode] = (statusCounts[res.statusCode] || 0) + 1;
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { data = {}; }
          if (res.statusCode < 200 || res.statusCode >= 300) { if (errors.length < 30) errors.push({ kind, status: res.statusCode, error: data.error || 'non-JSON error' }); }
          if (kind === 'write' && res.statusCode === 201 && data.id) accepted.add(data.id);
          done();
        });
      });
      req.once('timeout', () => req.destroy(new Error('Request exceeded 12 seconds.')));
      req.once('error', error => { completedRequests++; latencies[kind].push(performance.now() - start); statusCounts.networkError = (statusCounts.networkError || 0) + 1; if (errors.length < 30) errors.push({ kind, error: error.message }); done(); });
      req.end(payload);
    });
    console.log(`Isolated soak: ${userCount} sessions, ${targetMessages} messages, ${duration}s, ${sharedIp ? 'one shared office IP' : 'one IP per session'}; no existing data/server is used.`);
    await Promise.all(ready.users.map(async (user, index) => {
      const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 10000, extraHeaders: { Origin: origin, Cookie: user.cookie, 'X-Forwarded-For': user.ip } });
      sockets.push(socket);
      socket.on('message:created', message => {
        if (message.channelId !== ready.channel || !message.content.startsWith(marker)) return;
        const sequence = Number(message.content.slice(marker.length).split(' ')[0]);
        let bitset = deliveries.get(message.id);
        if (!bitset) { bitset = new Uint8Array(Math.ceil(userCount / 8)); deliveries.set(message.id, bitset); }
        const mask = 1 << index % 8;
        if (bitset[Math.floor(index / 8)] & mask) duplicateDeliveries++;
        else {
          bitset[Math.floor(index / 8)] |= mask;
          const latency = performance.now() - sendTimes.get(sequence);
          notificationSamples++;
          if (notificationLatencies.length < 200000) notificationLatencies.push(latency);
          else { const replace = Math.floor(Math.random() * notificationSamples); if (replace < notificationLatencies.length) notificationLatencies[replace] = latency; }
        }
      });
      await new Promise((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    }));
    const started = performance.now();
    const progress = setInterval(() => console.log(`Soak ${Math.round((performance.now() - started) / 1000)}s: ${accepted.size}/${targetMessages} persisted HTTP writes, ${completedRequests} requests.`), 30000);
    try {
      await Promise.all(ready.users.map(async (user, index) => {
        const count = Math.floor(targetMessages / userCount) + (index < targetMessages % userCount ? 1 : 0);
        for (let round = 0; round < count; round++) {
          if (abort.signal.aborted) break;
          const scheduled = started + round * duration * 1000 / count + index * 4;
          if (scheduled > performance.now()) await sleep(scheduled - performance.now(), undefined, { signal: abort.signal }).catch(() => undefined);
          if (abort.signal.aborted) break;
          const sequence = round * userCount + index;
          sendTimes.set(sequence, performance.now());
          await call(user, `/channels/${ready.channel}/messages`, 'write', { content: `${marker}${sequence} Ekip sohbeti, ölçülen kalıcı mesaj ve gerçek zamanlı teslim.` });
          await call(user, `/channels/${ready.channel}/messages`, 'list');
          if (round % 5 === 0) await call(user, `/search?q=${encodeURIComponent(marker)}`, 'search');
        }
      }));
      const remaining = started + duration * 1000 - performance.now();
      if (remaining > 0 && !abort.signal.aborted) await sleep(remaining, undefined, { signal: abort.signal }).catch(() => undefined);
    } finally { clearInterval(progress); }
    const drainUntil = performance.now() + 5000;
    const deliveredCount = bitset => [...bitset].reduce((total, byte) => { while (byte) { total += byte & 1; byte >>= 1; } return total; }, 0);
    while (performance.now() < drainUntil && [...accepted].some(id => !deliveries.has(id) || deliveredCount(deliveries.get(id)) !== userCount)) await sleep(50);
    const missing = [...accepted].reduce((total, id) => total + userCount - (deliveries.has(id) ? deliveredCount(deliveries.get(id)) : 0), 0);
    const elapsed = performance.now() - started;
    sockets.forEach(socket => socket.disconnect()); agent.destroy();
    let final;
    if (crash) {
      const snapshotPromise = awaitWorker('crash-ready'); child.send({ type: 'finish', crash: true });
      const snapshot = await snapshotPromise;
      const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
      child.kill('SIGKILL');
      const termination = await exited;
      const reopened = openDatabase(join(directory, 'mola.sqlite'));
      const persisted = reopened.prepare('SELECT count(*) AS count FROM messages').get().count - snapshot.baselineMessages;
      const integrity = reopened.prepare('PRAGMA integrity_check').get().integrity_check;
      reopened.close();
      final = { resources: snapshot.resources, durability: { mode: 'forced process termination with SQLite open, then WAL recovery', termination, walBytesBeforeKill: snapshot.walBytesBeforeKill, committedMessages: snapshot.committedMessages, reopenedMessages: persisted, integrity } };
    } else {
      const finishPromise = awaitWorker('finished'); child.send({ type: 'finish' });
      final = await finishPromise;
    }
    finished = true;
    const failures = Object.entries(statusCounts).filter(([code]) => !/^2\d\d$/.test(code)).reduce((sum, [, count]) => sum + count, 0);
    const report = {
      generatedAt: new Date().toISOString(), runId, scenario: { users: userCount, targetMessages, durationSeconds: duration, elapsedSeconds: +(elapsed / 1000).toFixed(2), clientConcurrency: userCount, sharedIp, sourceIPs: sharedIp ? 'one shared synthetic office address for every authenticated session via one trusted loopback proxy hop' : 'one synthetic benchmark address per authenticated session via one trusted loopback proxy hop', fixtureSetup: 'isolated temporary SQLite; seeded workspace memberships and explicit active-workspace sessions; real HTTP authorization, Origin checks, production user/anonymous/network quotas and Socket.IO handlers', excludes: ['password hashing throughput', 'TLS/proxy network latency', 'physical devices', 'WebRTC media capacity', 'external networks'] },
      host: { node: process.version, os: `${platform()} ${release()}`, logicalCPUs: cpus().length, cpuModel: cpus()[0]?.model },
      http: { requests: completedRequests, statuses: statusCounts, failedRequests: failures, errorRate: completedRequests ? +(failures / completedRequests).toFixed(6) : 1, requestsPerSecond: +(completedRequests / elapsed * 1000).toFixed(2), latencyMs: Object.fromEntries(Object.entries(latencies).map(([kind, values]) => [kind, summarize(values)])), firstErrors: errors },
      broadcasts: { expected: accepted.size * userCount, receivedUnique: notificationSamples, missing, duplicates: duplicateDeliveries, latencyFromPostStartMs: summarize(notificationLatencies), latencySampled: notificationSamples > notificationLatencies.length },
      durability: final.durability, server: final.resources, clientRssMiB: +(process.memoryUsage().rss / 1048576).toFixed(2),
      passed: !abort.signal.aborted && failures === 0 && accepted.size === targetMessages && missing === 0 && duplicateDeliveries === 0 && final.durability.reopenedMessages === targetMessages && final.durability.integrity === 'ok',
    };
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, report: output, requests: completedRequests, errors: failures, messages: accepted.size, missingDeliveries: missing, httpP95: Object.fromEntries(Object.entries(report.http.latencyMs).map(([kind, value]) => [kind, value.p95])), notificationP95: report.broadcasts.latencyFromPostStartMs.p95, eventLoopP95: report.server.eventLoopDelayMs.p95, peakServerRssMiB: report.server.peakRssMiB, reopenedMessages: report.durability.reopenedMessages }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    sockets.forEach(socket => socket.disconnect()); agent.destroy();
    if (!finished) child.kill();
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    const absolute = resolve(directory); const temporaryRoot = resolve(tmpdir());
    if (!absolute.startsWith(temporaryRoot + sep) || !absolute.includes(`${sep}mola-load-`)) throw new Error('Refusing cleanup outside the isolated temporary load directory.');
    await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
