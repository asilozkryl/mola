// Destructive actions are restricted to the explicitly named QA container/volume below.
// Existing application data and backup volumes are retained.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const compose = ['compose', '-f', 'compose.local.yaml'];
const base = 'http://localhost:3000';
let cookie = '';
const api = (path, init = {}) => fetch(base + path, { ...init, headers: { Origin: base, Cookie: cookie, ...init.headers } });
const demo = await api('/api/auth/demo', { method: 'POST' });
assert.equal(demo.status, 200); cookie = demo.headers.get('set-cookie').split(';')[0];
const state = await demo.json();
const payload = 'Container full-backup restore proof: immutable file.';
const form = new FormData(); form.set('file', new Blob([payload], { type: 'text/plain' }), 'restore-proof.txt');
const uploaded = await api('/api/uploads', { method: 'POST', body: form }); assert.equal(uploaded.status, 201);
const attachment = await uploaded.json();
const created = await api(`/api/channels/${state.channels[0].id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Docker restore proof', attachmentIds: [attachment.id] }) });
assert.equal(created.status, 201); const message = await created.json();
const backupOutput = docker([...compose, 'exec', '-T', 'backups', 'node', 'scripts/backup-runner.mjs', '--once']);
const backup = JSON.parse(backupOutput.split('\n').find(line => line.startsWith('{')));
assert.equal((await api(`/api/messages/${message.id}`, { method: 'DELETE' })).status, 204);
docker(['run', '--rm', '--read-only', '--tmpfs', '/tmp', '-v', 'mola-local_mola_backups:/backups:ro', '-v', 'mola_qa_restore_data:/app/data', 'mola:local', 'node', 'scripts/restore-backup.mjs', `/backups/${backup.name}`, '/app/data/restored']);
try {
  docker(['run', '-d', '--name', 'mola-restore-qa', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-p', '127.0.0.1:3099:3001', '-e', 'NODE_ENV=development', '-e', 'SERVE_STATIC=true', '-e', 'APP_ORIGIN=http://localhost:3099', '-e', 'DATA_DIR=/app/data/restored', '-v', 'mola_qa_restore_data:/app/data', 'mola:local']);
  let ready = false;
  for (let tries = 0; tries < 40; tries++) { try { if ((await fetch('http://localhost:3099/api/health')).ok) { ready = true; break; } } catch {} await new Promise(done => setTimeout(done, 250)); }
  assert.ok(ready);
  const file = await fetch('http://localhost:3099' + attachment.url, { headers: { Cookie: cookie } });
  assert.equal(file.status, 200); assert.equal(await file.text(), payload);
  const restoredMessage = await fetch(`http://localhost:3099/api/messages/${message.id}`, { headers: { Cookie: cookie } });
  assert.equal(restoredMessage.status, 200); assert.equal((await restoredMessage.json()).content, 'Docker restore proof');
  docker(['restart', 'mola-restore-qa']);
  for (let tries = 0; tries < 40; tries++) { try { if ((await fetch('http://localhost:3099/api/health')).ok) break; } catch {} await new Promise(done => setTimeout(done, 250)); }
  assert.equal(await (await fetch('http://localhost:3099' + attachment.url, { headers: { Cookie: cookie } })).text(), payload);
  const proof = { passed: true, createdAt: new Date().toISOString(), backup: backup.name, snapshotFiles: backup.files, liveAttachmentDeleted: true, restoredMessage: true, restoredFileBytes: payload.length, survivedContainerRestart: true };
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/docker-ops-proof.json', JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof));
} finally {
  try { docker(['rm', '-f', 'mola-restore-qa']); } catch {}
  docker(['volume', 'rm', 'mola_qa_restore_data']);
}
