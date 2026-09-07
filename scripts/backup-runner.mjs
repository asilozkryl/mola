import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const readyPattern = /^backup-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
export async function syncDirectory(path) {
  if (process.platform === 'win32') return; // Windows does not expose directory fsync through Node.
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
export async function verifyBackup(directory, { requireChecksums = false } = {}) {
  const allowed = new Set(['mola.sqlite', 'manifest.json', 'checksums.json', '.mail-key', 'uploads']);
  for (const entry of await readdir(directory)) {
    if (!allowed.has(entry)) throw new Error(`Unexpected backup entry: ${entry}`);
    const info = await lstat(join(directory, entry));
    if (info.isSymbolicLink() || (entry === 'uploads' ? !info.isDirectory() : !info.isFile())) throw new Error('Backup must contain regular files and one uploads directory.');
  }
  for (const entry of await readdir(join(directory, 'uploads'))) {
    const info = await lstat(join(directory, 'uploads', entry));
    if (!/^[a-f0-9-]{36}\.bin$/.test(entry) || !info.isFile() || info.isSymbolicLink()) throw new Error('Invalid backup upload entry.');
  }
  const db = new DatabaseSync(join(directory, 'mola.sqlite'), { readOnly: true });
  let rows;
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed.');
    rows = db.prepare('SELECT storage_name,size FROM attachments').all();
  } finally { db.close(); }
  const paths = ['mola.sqlite', 'manifest.json'];
  for (const row of rows) {
    if (!/^[a-f0-9-]{36}\.bin$/.test(row.storage_name)) throw new Error('Unsafe storage name.');
    const path = join('uploads', row.storage_name);
    if ((await stat(join(directory, path))).size !== row.size) throw new Error('Upload size mismatch.');
    paths.push(path);
  }
  if ((await readdir(join(directory, 'uploads'))).length !== rows.length) throw new Error('Unexpected backup upload files.');
  try { await stat(join(directory, '.mail-key')); paths.push('.mail-key'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sums = {};
  for (const path of paths) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(directory, path))) hash.update(chunk);
    sums[path.replaceAll('\\', '/')] = hash.digest('hex');
  }
  try {
    const previous = JSON.parse(await readFile(join(directory, 'checksums.json'), 'utf8'));
    if (Object.keys(previous).sort().join('\n') !== Object.keys(sums).sort().join('\n')) throw new Error('Backup checksum manifest is incomplete.');
    for (const [path, hash] of Object.entries(previous)) if (sums[path] !== hash) throw new Error(`Backup checksum mismatch: ${path}`);
  } catch (error) { if (error.code !== 'ENOENT' || requireChecksums) throw error; }
  return { files: rows.length, checksums: sums };
}

async function performBackup(options = {}) {
  const source = resolve(options.source || process.env.SOURCE_DATA_DIR || '/source');
  const target = resolve(options.target || process.env.BACKUP_DIR || '/backups');
  const app = options.app || process.env.APP_URL || 'http://app:3001';
  const retained = Number(options.keep || process.env.BACKUP_KEEP || 14);
  if (!Number.isInteger(retained) || retained < 1 || retained > 3650) throw new Error('BACKUP_KEEP must be 1..3650.');
  const token = (options.token || await readFile(process.env.OPS_TOKEN_FILE || '/run/mola-secrets/ops-token', 'utf8')).trim();
  const headers = { Authorization: `Bearer ${token}` };
  await mkdir(target, { recursive: true, mode: 0o700 });
  const response = await fetch(`${app}/internal/snapshots`, { method: 'POST', headers, signal: AbortSignal.timeout(120_000) });
  if (response.status !== 201) throw new Error(`Snapshot service returned ${response.status}.`);
  const snapshot = await response.json();
  if (!/^snapshot-[a-f0-9-]{36}$/.test(snapshot.id)) throw new Error('Snapshot returned an invalid id.');
  const name = `backup-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}-${randomUUID().slice(0, 8)}`;
  const partial = join(target, `.partial-${randomUUID()}`);
  try {
    await cp(join(source, 'snapshots', snapshot.id), partial, { recursive: true, errorOnExist: true, force: false });
    const verified = await verifyBackup(partial);
    await writeFile(join(partial, 'checksums.json'), JSON.stringify(verified.checksums, null, 2), { mode: 0o600 });
    for (const path of [...Object.keys(verified.checksums), 'checksums.json']) { const handle = await open(join(partial, path), 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
    await syncDirectory(join(partial, 'uploads')); await syncDirectory(partial);
    await rename(partial, join(target, name));
    await syncDirectory(target);
    // Keep completed directories only; partial/unknown paths can never become retention targets.
    const others = await Promise.all((await readdir(target)).filter(item => item !== name && readyPattern.test(item)).map(async item => ({ item, created: (await stat(join(target, item))).mtimeMs })));
    const backups = [name, ...others.sort((a, b) => b.created - a.created).map(entry => entry.item)];
    for (const old of backups.slice(retained)) {
      const path = resolve(target, old);
      if (!path.startsWith(target + sep)) throw new Error('Unsafe retention path.');
      await rm(path, { recursive: true, force: true });
    }
    return { name, files: verified.files, completedAt: Date.now() / 1000 };
  } catch (error) { await rm(partial, { recursive: true, force: true }); throw error; }
  finally {
    try {
      const released = await fetch(`${app}/internal/snapshots/${snapshot.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) });
      if (!released.ok) console.error(`Snapshot release failed (${released.status}); server TTL cleanup will retry.`);
    } catch { console.error('Snapshot release deferred to server TTL cleanup. Completed backup remains valid.'); }
  }
}

export async function runBackup(options = {}) {
  const target = resolve(options.target || process.env.BACKUP_DIR || '/backups');
  await mkdir(target, { recursive: true, mode: 0o700 });
  const lock = join(target, '.backup-lock');
  // An atomic directory lock also serializes manual --once runs with the scheduler.
  // A crashed worker leaves the lock for explicit operator review, never unsafe expiry.
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Backup lock exists. Check for an active backup; remove .backup-lock only after confirming no backup is running.'); throw error; }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    return await performBackup(options);
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function main() {
  if (process.argv.includes('--verify')) { console.log(JSON.stringify(await verifyBackup(resolve(process.argv.at(-1)), { requireChecksums: true }))); return; }
  if (process.argv.includes('--once')) { console.log(JSON.stringify(await runBackup())); return; }
  const interval = Number(process.env.BACKUP_INTERVAL_SECONDS || 86400);
  if (!Number.isInteger(interval) || interval < 60 || interval > 604800) throw new Error('BACKUP_INTERVAL_SECONDS must be 60..604800.');
  const statusDir = resolve(process.env.BACKUP_STATUS_DIR || '/status');
  await mkdir(statusDir, { recursive: true, mode: 0o750 });
  let state = { lastSuccess: 0, lastAttempt: 0, failures: 0, lastRunOk: false, running: false };
  try { state = { ...state, ...JSON.parse(await readFile(join(statusDir, 'backup-status.json'), 'utf8')), running: false }; } catch {}
  let stopping = false;
  const server = createServer(async (req, res) => {
    try {
    const healthy = state.lastRunOk && Date.now() / 1000 - state.lastSuccess < interval * 2 + 300;
    if (req.url === '/health') { res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ healthy, running: state.running })); return; }
    const token = (await readFile(process.env.OPS_TOKEN_FILE || '/run/mola-secrets/ops-token', 'utf8')).trim();
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    if (req.url !== '/metrics') { res.writeHead(404); res.end(); return; }
    let offsiteSuccess = 0;
    try { offsiteSuccess = Number(await readFile(join(statusDir, 'restic-success'), 'utf8')) || 0; } catch {}
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(`mola_backup_last_success_timestamp_seconds ${state.lastSuccess}\nmola_backup_last_attempt_timestamp_seconds ${state.lastAttempt}\nmola_backup_failures_total ${state.failures}\nmola_backup_last_run_success ${state.lastRunOk ? 1 : 0}\nmola_backup_running ${state.running ? 1 : 0}\nmola_backup_interval_seconds ${interval}\nmola_offsite_enabled ${process.env.OFFSITE_ENABLED === 'true' ? 1 : 0}\nmola_offsite_last_success_timestamp_seconds ${offsiteSuccess}\n`);
    } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
  }).listen(Number(process.env.BACKUP_METRICS_PORT || 9101), '0.0.0.0');
  const persist = async () => { const path = join(statusDir, 'backup-status.json'); await writeFile(path + '.tmp', JSON.stringify(state), { mode: 0o640 }); await rename(path + '.tmp', path); };
  const run = async () => {
    state.running = true; state.lastAttempt = Date.now() / 1000;
    try { const result = await runBackup(); state.lastSuccess = result.completedAt; state.lastRunOk = true; console.log(JSON.stringify({ event: 'backup_complete', ...result })); }
    catch (error) { state.lastRunOk = false; state.failures++; console.error(JSON.stringify({ event: 'backup_failed', error: error.message })); }
    finally { state.running = false; await persist(); }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; server.close(); });
  while (!stopping) {
    await run();
    const delay = state.lastRunOk ? interval : Math.min(300, interval);
    for (let elapsed = 0; elapsed < delay && !stopping; elapsed++) await new Promise(done => setTimeout(done, 1000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
