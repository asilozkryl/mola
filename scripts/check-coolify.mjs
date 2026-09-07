// Isolated production acceptance. Never reuse the local application's project, image or volumes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.every(arg => arg === '--deferred'), 'Usage: node scripts/check-coolify.mjs [--deferred]');
const deferred = args.includes('--deferred');
const reportName = deferred ? 'coolify-deferred-smoke.json' : 'coolify-smoke.json';
const project = `mola-coolify-qa-${Date.now()}-${randomBytes(3).toString('hex')}`;
const scratch = await mkdtemp(join(tmpdir(), 'mola-coolify-qa-'));
const emptyEnv = join(scratch, 'empty.env');
const overridePath = join(scratch, 'override.json');
const startedAt = new Date().toISOString();
const checks = {};
const secrets = [];
const report = { passed: false, mode: deferred ? 'deferred-providers' : 'configured-providers', startedAt, project, checks, limitations: ['A local private CA stands in for the Coolify TLS proxy; no real Coolify instance was contacted.', 'External SMTP delivery, TURN reachability, remote offsite storage and alert delivery require deployment credentials and separate live checks.'] };
let composeArgs;
let composeEnv;
let ca;
let socket;

function redact(value) {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/mola_session=[a-f0-9]+/g, 'mola_session=[redacted]');
}
function command(args, { input, env = composeEnv, timeout = 120_000, allowFailure = false } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn('docker', args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8_000_000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if ((code !== 0 || timedOut) && !allowFailure) reject(new Error(redact(`Docker ${args.slice(0, 2).join(' ')} ${timedOut ? 'timed out' : `failed (${code})`}: ${stderr || stdout}`)));
      else resolveCommand({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const compose = (args, options) => command([...composeArgs, ...args], options);
const jsonLine = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')) || output);
const execNode = async (code, service = 'app') => jsonLine((await compose(['exec', '-T', service, 'node', '--import', 'tsx', '--input-type=module', '-'], { input: code })).stdout);
const step = (name, detail = true) => { checks[name] = detail; console.log(`PASS ${name}`); };
const delay = ms => new Promise(done => setTimeout(done, ms));
async function eventually(description, fn, timeout = 60_000) {
  const end = Date.now() + timeout;
  let last;
  do { try { const result = await fn(); if (result) return result; } catch (error) { last = error; } await delay(500); } while (Date.now() < end);
  throw new Error(`${description} timed out${last ? `: ${redact(last.message)}` : ''}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
function https(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, reject) => {
    const req = httpsRequest(new URL(path, composeEnv.APP_ORIGIN), { method, ca, rejectUnauthorized: true, family: 4, headers, timeout: 15_000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); done({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }); });
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
async function socketResult(origin, cookie, { expected = 'connect', port, path } = {}) {
  return new Promise((done, reject) => {
    const client = io(port ? `http://localhost:${port}` : composeEnv.APP_ORIGIN, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 10_000, ca, rejectUnauthorized: true, extraHeaders: { Origin: origin, Cookie: cookie }, ...(path ? { path } : {}) });
    const timer = setTimeout(() => { client.disconnect(); reject(new Error('Socket acceptance timed out')); }, 15_000);
    client.once('connect', () => { clearTimeout(timer); if (expected === 'connect') done(client); else { client.disconnect(); reject(new Error('Rejected-origin socket connected')); } });
    client.once('connect_error', error => { clearTimeout(timer); client.disconnect(); if (expected === 'connect_error') done(true); else reject(error); });
  });
}
async function cleanup() {
  // Resolve ownership using Docker's exact project labels before any removal.
  const ids = (await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])).stdout.split(/\s+/).filter(Boolean);
  const helpers = [];
  if (ids.length) {
    const containers = JSON.parse((await command(['inspect', ...ids])).stdout);
    for (const item of containers) {
      assert.equal(item.Config.Labels['com.docker.compose.project'], project);
      assert.ok(item.Name.replace(/^\//, '').startsWith(project + '-'), 'Refusing cleanup of a container outside the QA prefix');
      if (['qa-restored', 'restore-copy'].includes(item.Config.Labels['com.docker.compose.service'])) helpers.push(item.Id);
    }
  }
  const volumeNames = (await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])).stdout.split(/\s+/).filter(Boolean);
  if (volumeNames.length) {
    const volumes = JSON.parse((await command(['volume', 'inspect', ...volumeNames])).stdout);
    for (const item of volumes) {
      assert.equal(item.Labels['com.docker.compose.project'], project);
      assert.ok(item.Name.startsWith(project + '_'), 'Refusing cleanup of a volume outside the QA prefix');
    }
  }
  // These explicitly created helpers are outside Compose's service model and may not
  // be recognized as orphans. Remove the verified helpers before their data volume.
  if (helpers.length) await command(['rm', '-f', ...helpers]);
  if (composeArgs) await compose(['down', '--volumes', '--remove-orphans', '--timeout', '10'], { timeout: 90_000 });
  // Compose also skips declared volumes that only the manual restore helper used.
  const remainingVolumes = (await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])).stdout.split(/\s+/).filter(Boolean);
  for (const name of remainingVolumes) {
    const volume = JSON.parse((await command(['volume', 'inspect', name])).stdout)[0];
    assert.equal(volume.Labels['com.docker.compose.project'], project);
    assert.equal(volume.Name, `${project}_qa_restore_data`, 'Refusing removal of an unexpected remaining volume');
    await command(['volume', 'rm', volume.Name]);
  }
  assert.equal((await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])).stdout, '');
  assert.equal((await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])).stdout, '');
  checks.ownedResourcesCleaned = true;
}

try {
  console.log(`Testing isolated project ${project} (${report.mode})`);
  const source = await readFile(join(root, 'compose.coolify.yaml'), 'utf8');
  const variables = [...source.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map(match => match[1]);
  const cleanEnv = { ...process.env };
  for (const name of [...variables, ...Object.keys(cleanEnv).filter(name => /^(SMTP_|TURN_|MAIL_|ALERT_)/.test(name)), 'COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME']) delete cleanEnv[name];
  await writeFile(emptyEnv, '');
  const baseArgs = ['compose', '--project-directory', root, '--project-name', project, '--env-file', emptyEnv, '-f', 'compose.coolify.yaml'];
  const missing = await command([...baseArgs, 'config', '--format', 'json'], { env: cleanEnv, allowFailure: true });
  assert.notEqual(missing.code, 0, 'Missing production settings must fail Compose validation');
  assert.match(missing.stderr, /required|missing|Set |is not set/i);
  step('missingRequiredEnvironmentRejected');
  const port = await freePort();
  composeEnv = { ...cleanEnv, APP_ORIGIN: `https://localhost:${port}`, EMAIL_DELIVERY_ENABLED: deferred ? 'false' : 'true', REQUIRE_TURN: deferred ? 'false' : 'true', OFFSITE_ENABLED: 'false', BACKUP_INTERVAL_SECONDS: '86400', ...(deferred ? {} : { TURN_URLS: 'turn:qa.invalid:3478', TURN_SECRET: randomBytes(32).toString('hex'), SMTP_HOST: 'smtp.qa.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'qa', SMTP_PASS: randomBytes(24).toString('hex'), MAIL_FROM: 'Mola QA <qa@example.invalid>', MAIL_ENCRYPTION_KEY: randomBytes(32).toString('hex'), ALERT_WEBHOOK_URL: 'https://alerts.qa.invalid/no-delivery' }) };
  secrets.push(composeEnv.TURN_SECRET, composeEnv.SMTP_PASS, composeEnv.MAIL_ENCRYPTION_KEY);
  const config = JSON.parse((await command([...baseArgs, 'config', '--format', 'json'])).stdout);
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal((service.ports || []).length, 0, `${name} must not publish host ports`);
    assert.equal(service.container_name, undefined, `${name} must allow independent Compose projects`);
    for (const mount of service.volumes || []) if (mount.type === 'bind') assert.equal(mount.read_only, true, `${name} must not write through a host bind mount`);
  }
  for (const [name, volume] of Object.entries(config.volumes || {})) {
    assert.equal(Boolean(volume.external), false, `${name} must not reuse an external volume`);
    assert.ok(volume.name.startsWith(project + '_'), `${name} must be isolated by the QA project`);
  }
  for (const [name, network] of Object.entries(config.networks || {})) {
    assert.equal(Boolean(network.external), false, `${name} must not join an external network`);
    assert.ok(network.name.startsWith(project + '_'), `${name} must be isolated by the QA project`);
  }
  assert.equal(config.services.app.environment.NODE_ENV, 'production');
  assert.equal(String(config.services.app.environment.PORT), '3001');
  assert.equal(String(config.services.app.environment.OPS_PORT), '9100');
  assert.equal(String(config.services.app.environment.TRUST_PROXY), '1');
  assert.equal(String(config.services.app.environment.EMAIL_DELIVERY_ENABLED), deferred ? 'false' : 'true');
  assert.equal(String(config.services.app.environment.REQUIRE_TURN), deferred ? 'false' : 'true');
  if (deferred) {
    for (const key of ['TURN_URLS', 'TURN_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_ENCRYPTION_KEY', 'ALERT_WEBHOOK_URL']) {
      assert.ok(!config.services.app.environment[key], `${key} must remain empty in the deferred-provider stack`);
    }
  }
  assert.ok(config.services.backups.environment.APP_URL.endsWith(':9100'));
  assert.ok(config.services.app.build && config.services.backups.build);
  assert.equal(config.services.app.image, undefined, 'Application build must not overwrite a shared image tag');
  assert.equal(config.services.backups.image, undefined, 'Backup build must not overwrite a shared image tag');
  step('composeProductionIsolation');
  await writeFile(join(scratch, 'Caddyfile'), '{\n admin off\n auto_https disable_redirects\n}\nhttps://localhost {\n tls internal\n reverse_proxy app:3001\n}\n');
  const override = { services: { proxy: { image: 'caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648', ports: [`127.0.0.1:${port}:443`], volumes: [{ type: 'bind', source: join(scratch, 'Caddyfile'), target: '/etc/caddy/Caddyfile', read_only: true }, 'qa_caddy_data:/data', 'qa_caddy_config:/config'], depends_on: { app: { condition: 'service_healthy' } }, logging: { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '1' } } } }, volumes: { qa_caddy_data: {}, qa_caddy_config: {}, qa_restore_data: {} } };
  await writeFile(overridePath, JSON.stringify(override));
  composeArgs = [...baseArgs, '-f', overridePath];
  console.log('Building separate production application and backup images...');
  await compose(['build', 'app', 'backups'], { timeout: 600_000 });
  step('productionImagesBuilt');
  console.log('Starting the private production stack and local TLS proxy...');
  await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], { timeout: 240_000 });
  const serviceIds = (await compose(['ps', '-q', 'app', 'backups', 'prometheus', 'alertmanager', 'restic'])).stdout.split(/\s+/).filter(Boolean);
  assert.equal(serviceIds.length, 5);
  const serviceHealth = {};
  for (const item of JSON.parse((await command(['inspect', ...serviceIds])).stdout)) {
    const name = item.Config.Labels['com.docker.compose.service'];
    assert.equal(item.Config.Labels['com.docker.compose.project'], project);
    assert.equal(item.State.Health.Status, 'healthy', `${name} must become healthy`);
    serviceHealth[name] = item.State.Health.Status;
  }
  step('allFiveServicesHealthy', serviceHealth);
  await compose(['cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', join(scratch, 'root.crt')]);
  ca = await readFile(join(scratch, 'root.crt'));
  assert.equal((await eventually('HTTPS readiness', async () => { const response = await https('/api/health'); return response.status === 200 && response; })).json().status, 'ok');
  const index = await https('/');
  assert.equal(index.status, 200); assert.match(index.text, /<html/);
  const publicConfig = (await https('/api/config')).json();
  assert.equal(publicConfig.demoEnabled, false); assert.equal(publicConfig.emailVerificationRequired, true);
  assert.equal(publicConfig.emailDeliveryAvailable, !deferred);
  assert.equal(publicConfig.registrationAvailable, !deferred);
  assert.equal(publicConfig.relayConfigured, !deferred);
  step('verifiedTlsAndProductionDefaults');
  const opsToken = (await compose(['exec', '-T', 'app', 'node', '-e', "process.stdout.write(require('node:fs').readFileSync(process.env.OPS_TOKEN_FILE,'utf8').trim())"])).stdout;
  secrets.push(opsToken);
  for (const [path, method] of [['/internal/metrics', 'GET'], ['/internal/snapshots', 'POST']]) {
    assert.equal((await https(path, { method, headers: { Authorization: `Bearer ${opsToken}` } })).status, 404);
  }
  const privateChecks = await execNode(`const token=await(await import('node:fs/promises')).readFile(process.env.OPS_TOKEN_FILE,'utf8');const base='http://127.0.0.1:9100';let result={};for(const [name,path,auth] of [['unauthenticated','/internal/metrics',false],['authenticated','/internal/metrics',true],['root','/',true],['api','/api/health',true],['socket','/socket.io/?EIO=4&transport=polling',true]]){const r=await fetch(base+path,{headers:auth?{Authorization:'Bearer '+token.trim()}: {}});result[name]=r.status;}console.log(JSON.stringify(result));`);
  assert.deepEqual(privateChecks, { unauthenticated: 401, authenticated: 200, root: 404, api: 404, socket: 404 });
  step('operationsPrivateListenerIsolated', privateChecks);
  // Create one synthetic verified account without sending any email; log in through the real HTTPS API.
  const password = randomBytes(24).toString('base64url'); secrets.push(password);
  const email = `qa-${randomUUID()}@example.invalid`;
  const seeded = await execNode(`import {scryptSync,randomBytes} from 'node:crypto';import {openDatabase,Repository} from './server/db.ts';import {createWorkspace} from './server/seed.ts';const db=openDatabase('/app/data/mola.sqlite');const repo=new Repository(db);const salt=randomBytes(16).toString('hex');const hash='scrypt$32768$8$3$'+salt+'$'+scryptSync(${JSON.stringify(password)},salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');const created=repo.transaction(()=>createWorkspace(repo,{name:'Coolify QA',userName:'QA Owner',email:${JSON.stringify(email)},passwordHash:hash}));repo.run('UPDATE users SET email_verified=1 WHERE id=?',created.userId);console.log(JSON.stringify(created));db.close();`);
  assert.ok(seeded.userId);
  let cookie = '';
  const api = (path, options = {}) => https(path, { ...options, headers: { Origin: composeEnv.APP_ORIGIN, Cookie: cookie, ...options.headers } });
  if (deferred) {
    const authCounts = () => execNode(`import {openDatabase} from './server/db.ts';const db=openDatabase('/app/data/mola.sqlite');const counts={};for(const table of ['users','workspaces','sessions','auth_tokens','mail_outbox'])counts[table]=db.prepare('SELECT count(*) AS count FROM '+table).get().count;console.log(JSON.stringify(counts));db.close();`);
    const before = await authCounts();
    const blockedRegistration = await api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Unavailable signup', email: `registration-${randomUUID()}@example.invalid`, password, workspaceName: 'Must not be created' }) });
    assert.equal(blockedRegistration.status, 503, blockedRegistration.text);
    const recoveryResponses = [];
    for (const address of [email, `unknown-${randomUUID()}@example.invalid`]) {
      const response = await api('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: address }) });
      assert.equal(response.status, 503, response.text);
      recoveryResponses.push(response.json());
    }
    assert.deepEqual(recoveryResponses[0], recoveryResponses[1], 'Unavailable recovery must not reveal whether an account exists');
    assert.deepEqual(await authCounts(), before, 'Unavailable registration and recovery must not create accounts, sessions, tokens or queued email');
    step('deferredRegistrationAndRecoveryRejectWithoutWrites');
  }
  const login = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200, login.text);
  const cookieHeader = login.headers['set-cookie'][0];
  assert.match(cookieHeader, /; Secure/); assert.match(cookieHeader, /; HttpOnly/); assert.match(cookieHeader, /; SameSite=Lax/i);
  cookie = cookieHeader.split(';')[0]; secrets.push(cookie);
  const state = login.json(); assert.equal(state.user.emailVerified, true);
  const rtcResponse = await api('/api/rtc/config');
  assert.equal(rtcResponse.status, 200, rtcResponse.text);
  const rtcConfig = rtcResponse.json();
  assert.equal(rtcConfig.relayConfigured, !deferred);
  const rtcUrls = rtcConfig.iceServers.flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]);
  assert.equal(rtcUrls.some(url => /^turns?:/.test(url)), !deferred);
  if (deferred) step('directCallConfigurationWithoutRelay');
  assert.equal((await api('/api/auth/login', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).status, 403);
  socket = await socketResult(composeEnv.APP_ORIGIN, cookie);
  assert.equal(socket.io.engine.transport.name, 'websocket');
  await socketResult('https://attacker.invalid', cookie, { expected: 'connect_error' });
  step('secureSessionOriginAndWebsocket');
  const payload = `Coolify isolated restore proof ${project}`;
  const boundary = `qa-${randomUUID()}`;
  const uploadBody = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="coolify-proof.txt"\r\nContent-Type: text/plain\r\n\r\n${payload}\r\n--${boundary}--\r\n`;
  const uploaded = await api('/api/uploads', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: uploadBody });
  assert.equal(uploaded.status, 201, uploaded.text); const attachment = uploaded.json();
  let receivedMessage;
  socket.once('message:created', value => { receivedMessage = value; });
  const created = await api(`/api/channels/${state.channels[0].id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Coolify backup acceptance', attachmentIds: [attachment.id] }) });
  assert.equal(created.status, 201, created.text); const message = created.json();
  await eventually('Realtime message delivery through WSS', async () => receivedMessage?.id === message.id, 10_000);
  assert.equal((await api(attachment.url)).text, payload);
  step('authenticatedMessageUploadAndRealtimeDelivery');
  const backup = jsonLine((await compose(['exec', '-T', 'backups', 'node', 'scripts/backup-runner.mjs', '--once'])).stdout);
  assert.equal(backup.files, 1);
  const verified = jsonLine((await compose(['exec', '-T', 'backups', 'node', 'scripts/backup-runner.mjs', '--verify', `/backups/${backup.name}`])).stdout);
  assert.equal(verified.files, 1);
  const uploadedBackupPath = Object.keys(verified.checksums).find(key => key.startsWith('uploads/'));
  assert.match(verified.checksums[uploadedBackupPath], /^[a-f0-9]{64}$/);
  step('consistentBackupWithChecksums', { files: backup.files });
  socket.disconnect(); socket = undefined;
  await compose(['restart', 'app'], { timeout: 60_000 });
  await eventually('Application restart', async () => (await api('/api/health')).status === 200);
  assert.equal((await api(attachment.url)).text, payload);
  assert.equal((await api(`/api/messages/${message.id}`)).json().content, 'Coolify backup acceptance');
  step('applicationRestartPreservesDataAndSession');
  assert.equal((await api(`/api/messages/${message.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(attachment.url)).status, 404);
  const appId = (await compose(['ps', '-q', 'app'])).stdout;
  const appInspect = JSON.parse((await command(['inspect', appId])).stdout)[0];
  const backupId = (await compose(['ps', '-q', 'backups'])).stdout;
  const backupInspect = JSON.parse((await command(['inspect', backupId])).stdout)[0];
  report.images = { app: appInspect.Image, backups: backupInspect.Image };
  const backupVolume = backupInspect.Mounts.find(item => item.Destination === '/backups').Name;
  const restoreVolume = `${project}_qa_restore_data`;
  assert.ok(backupVolume.startsWith(project + '_'));
  await command(['volume', 'create', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.volume=qa_restore_data', restoreVolume]);
  const restored = jsonLine((await command(['run', '--rm', '--name', `${project}-restore-copy`, '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=restore-copy', '--read-only', '--tmpfs', '/tmp', '-v', `${backupVolume}:/backups:ro`, '-v', `${restoreVolume}:/app/data`, appInspect.Image, 'node', 'scripts/restore-backup.mjs', `/backups/${backup.name}`, '/app/data/restored'])).stdout);
  assert.equal(restored.restored, true); assert.equal(restored.files, 1);
  const restoreName = `${project}-restored`;
  const network = Object.keys(appInspect.NetworkSettings.Networks).find(name => name.startsWith(project + '_'));
  assert.ok(network, 'The restore container must join only the isolated QA network');
  const restoreArgs = ['run', '-d', '--name', restoreName, '--network', network, '--network-alias', 'qa-restored', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=qa-restored', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-v', `${restoreVolume}:/app/data`];
  const restoreEnv = { ...config.services.app.environment, DATA_DIR: '/app/data/restored', OPS_TOKEN_FILE: '/app/data/restored/.ops-token' };
  for (const [key, value] of Object.entries(restoreEnv)) restoreArgs.push('-e', `${key}=${value}`);
  restoreArgs.push(appInspect.Image);
  await command(restoreArgs);
  const restoreProbe = `const base='http://qa-restored:3001';const health=await fetch(base+'/api/health');if(!health.ok)throw new Error('Restored health failed');const headers={Cookie:${JSON.stringify(cookie)}};const file=await fetch(base+${JSON.stringify(attachment.url)},{headers});const message=await fetch(base+${JSON.stringify(`/api/messages/${message.id}`)},{headers});console.log(JSON.stringify({fileStatus:file.status,file:await file.text(),messageStatus:message.status,message:await message.json()}));`;
  let restoredProof = await eventually('Restored production application readiness', () => execNode(restoreProbe));
  assert.equal(restoredProof.fileStatus, 200); assert.equal(restoredProof.file, payload); assert.equal(restoredProof.messageStatus, 200); assert.equal(restoredProof.message.content, 'Coolify backup acceptance');
  await command(['restart', restoreName], { timeout: 60_000 });
  restoredProof = await eventually('Restored application restart', () => execNode(restoreProbe));
  assert.equal(restoredProof.file, payload); assert.equal(restoredProof.message.content, 'Coolify backup acceptance');
  step('separateVolumeRestoreAndRestart', { restoredFiles: restored.files, sourceMessageDeletedBeforeRestore: true });
  const monitoring = await execNode(`const results={};for(const [name,url] of [['backups','http://backups:9101/health'],['prometheus','http://prometheus:9090/-/ready'],['alertmanager','http://alertmanager:9093/-/ready']]){results[name]=(await fetch(url)).status;}const targets=await(await fetch('http://prometheus:9090/api/v1/targets')).json();results.targets=targets.data.activeTargets.map(t=>({job:t.labels.job,health:t.health}));console.log(JSON.stringify(results));`);
  assert.equal(monitoring.backups, 200); assert.equal(monitoring.prometheus, 200); assert.equal(monitoring.alertmanager, 200);
  const targetState = await eventually('Prometheus private authenticated scrapes', async () => { const current = await execNode(`const r=await(await fetch('http://prometheus:9090/api/v1/targets')).json();console.log(JSON.stringify({targets:r.data.activeTargets.map(t=>({job:t.labels.job,health:t.health}))}));`); return current.targets.map(target => target.job).sort().join(',') === 'alertmanager,mola,mola-backups' && current.targets.every(target => target.health === 'up') && current; });
  assert.deepEqual(targetState.targets.map(target => target.job).sort(), ['alertmanager', 'mola', 'mola-backups']);
  step('privateMonitoringAndBackupsHealthy', { targets: targetState.targets });
  const resticId = (await compose(['ps', '-q', 'restic'])).stdout;
  assert.ok(resticId, 'Disabled offsite must retain a healthy idle restic service');
  const resticInspect = JSON.parse((await command(['inspect', resticId])).stdout)[0];
  assert.equal(resticInspect.State.Health.Status, 'healthy');
  step('offsiteDisabledHealthy');
  // Exercise encryption and repository integrity using only an ephemeral local QA repository.
  const repositoryPassword = randomBytes(32).toString('hex'); secrets.push(repositoryPassword);
  override.services.restic = { environment: { OFFSITE_ENABLED: 'true', RESTIC_REPOSITORY: '/qa-repository', RESTIC_PASSWORD: repositoryPassword }, tmpfs: ['/qa-repository:size=64m,uid=1000,gid=1000,mode=0700'] };
  override.services.backups = { environment: { OFFSITE_ENABLED: 'true' } };
  await writeFile(overridePath, JSON.stringify(override));
  await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'backups', 'restic'], { timeout: 180_000 });
  const encryptedSnapshots = JSON.parse((await compose(['exec', '-T', 'restic', 'restic', 'snapshots', '--json'])).stdout);
  assert.ok(encryptedSnapshots.length > 0);
  await compose(['exec', '-T', 'restic', 'restic', 'check', '--read-data']);
  const roundTrip = (await compose(['exec', '-T', 'restic', 'restic', 'dump', 'latest', `/backups/${backup.name}/${uploadedBackupPath}`])).stdout;
  assert.equal(roundTrip, payload);
  step('encryptedLocalOffsiteRoundTrip', { snapshots: encryptedSnapshots.length, fullRepositoryIntegrityCheck: true, restoredAttachmentMatches: true });
  report.passed = true;
} catch (error) {
  report.error = redact(error.stack || error.message);
  console.error(report.error);
  if (composeArgs) {
    try { report.diagnostics = redact((await compose(['logs', '--no-color', '--tail', '30'], { allowFailure: true })).stdout).slice(-20_000); } catch {}
  }
  process.exitCode = 1;
} finally {
  socket?.disconnect();
  try { await cleanup(); } catch (error) { report.cleanupError = redact(error.message); report.passed = false; process.exitCode = 1; console.error(`QA cleanup failed: ${report.cleanupError}`); }
  report.finishedAt = new Date().toISOString();
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', reportName), JSON.stringify(report, null, 2) + '\n');
  // scratch was created by mkdtemp, and only this exact owned directory is removed.
  assert.ok(scratch.startsWith(join(tmpdir(), 'mola-coolify-qa-')));
  await rm(scratch, { recursive: true, force: true });
  console.log(`Coolify smoke ${report.passed ? 'passed' : 'failed'}; report: artifacts/${reportName}`);
}
