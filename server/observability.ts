import type { Express, Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Server } from 'socket.io';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const buckets = [0.005, 0.025, 0.1, 0.5, 1, 5];
const requests = new Map<string, { count: number; sum: number; buckets: number[] }>();
export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const method = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method) ? req.method : 'OTHER';
    const key = `method="${method}",status="${Math.floor(res.statusCode / 100)}xx"`;
    const record = requests.get(key) || { count: 0, sum: 0, buckets: buckets.map(() => 0) };
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    record.count++; record.sum += seconds;
    buckets.forEach((upper, index) => { if (seconds <= upper) record.buckets[index]++; });
    requests.set(key, record);
  });
  next();
}

export function installOperations(app: Express, options: { db: DatabaseSync; io: Server; dataDir: string; uploadDir: string; production: boolean }) {
  const dataDir = resolve(options.dataDir);
  const root = join(dataDir, 'snapshots');
  const tokenFile = resolve(process.env.OPS_TOKEN_FILE || join(dataDir, '.ops-token'));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o750 });
  let token = process.env.OPS_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomBytes(48).toString('base64url'));
  if (token.length < 32 || /\s/.test(token)) throw new Error('OPS_TOKEN must contain at least 32 non-whitespace characters.');
  writeFileSync(tokenFile, token, { mode: 0o640 }); chmodSync(tokenFile, 0o640);
  if (process.env.ALERT_WEBHOOK_URL) {
    const destination = new URL(process.env.ALERT_WEBHOOK_URL);
    if (destination.protocol !== 'https:') throw new Error('ALERT_WEBHOOK_URL must use HTTPS.');
    const webhookFile = join(dirname(tokenFile), 'alert-webhook-url');
    writeFileSync(webhookFile, destination.href, { mode: 0o640 }); chmodSync(webhookFile, 0o640);
  }
  // Coolify reads a private generated config. An absent receiver keeps alerts
  // visible internally without making external delivery attempts.
  const alertConfigFile = join(dirname(tokenFile), 'alertmanager.yml');
  const alertTemplate = process.env.ALERT_WEBHOOK_URL ? '../ops/alertmanager.yml' : '../ops/alertmanager-disabled.yml';
  writeFileSync(alertConfigFile, readFileSync(new URL(alertTemplate, import.meta.url)), { mode: 0o640 });
  chmodSync(alertConfigFile, 0o640);
  const expected = Buffer.from(token); token = '';
  let lastSnapshot = 0, snapshots = 0, failures = 0, snapshotDuration = 0;
  const authorize = (req: Request, res: Response, next: NextFunction) => {
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.status(401).json({ error: 'Operations authentication required.' }); return; }
    res.setHeader('Cache-Control', 'no-store'); next();
  };
  const safePath = (id: string) => {
    if (!/^snapshot-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid snapshot id.');
    const path = resolve(root, id);
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid snapshot path.');
    return path;
  };
  // Snapshot files are hard-linked while the one application event loop is paused.
  // Uploads are immutable: later message deletions unlink originals, never these links.
  app.post('/internal/snapshots', authorize, (_req, res) => {
    const started = performance.now();
    const id = `snapshot-${randomUUID()}`;
    const path = safePath(id);
    try {
      const existing = readdirSync(root).filter(name => /^snapshot-[a-f0-9-]{36}$/.test(name));
      if (existing.length >= 3) { res.status(409).json({ error: 'Release or expire previous snapshots before creating another.' }); return; }
      mkdirSync(join(path, 'uploads'), { recursive: true, mode: 0o700 });
      const files = options.db.prepare('SELECT storage_name,size FROM attachments').all() as { storage_name: string; size: number }[];
      options.db.prepare('VACUUM INTO ?').run(join(path, 'mola.sqlite'));
      chmodSync(join(path, 'mola.sqlite'), 0o600);
      for (const file of files) {
        if (!/^[a-f0-9-]{36}\.bin$/.test(file.storage_name)) throw new Error('Unexpected upload storage name.');
        const source = join(options.uploadDir, file.storage_name);
        if (statSync(source).size !== file.size) throw new Error('Upload size does not match database.');
        try { linkSync(source, join(path, 'uploads', file.storage_name)); }
        catch (error) { if (['EXDEV', 'EPERM', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code || '')) copyFileSync(source, join(path, 'uploads', file.storage_name)); else throw error; }
      }
      if (existsSync(join(dataDir, '.mail-key'))) copyFileSync(join(dataDir, '.mail-key'), join(path, '.mail-key'));
      const manifest = { version: 1, id, createdAt: new Date().toISOString(), files: files.length, uploadBytes: files.reduce((sum, file) => sum + file.size, 0), database: 'mola.sqlite', consistency: 'single-instance synchronous vacuum and immutable file links' };
      writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      lastSnapshot = Date.now() / 1000; snapshots++;
      res.status(201).json(manifest);
    } catch (error) {
      failures++;
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
      console.error('Snapshot failed:', error instanceof Error ? error.message : 'unknown');
      res.status(500).json({ error: 'A consistent snapshot could not be created.' });
    } finally { snapshotDuration = (performance.now() - started) / 1000; }
  });
  app.delete('/internal/snapshots/:id', authorize, (req, res) => {
    try { rmSync(safePath(String(req.params.id)), { recursive: true, force: true }); res.status(204).end(); }
    catch { res.status(400).json({ error: 'Invalid snapshot id.' }); }
  });
  app.get('/internal/metrics', authorize, (_req, res) => {
    const lines = ['# TYPE mola_http_requests_total counter', '# TYPE mola_http_request_duration_seconds histogram'];
    for (const [labels, value] of requests) {
      lines.push(`mola_http_requests_total{${labels}} ${value.count}`, `mola_http_request_duration_seconds_sum{${labels}} ${value.sum}`, `mola_http_request_duration_seconds_count{${labels}} ${value.count}`);
      buckets.forEach((upper, index) => lines.push(`mola_http_request_duration_seconds_bucket{${labels},le="${upper}"} ${value.buckets[index]}`));
      lines.push(`mola_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`);
    }
    const memory = process.memoryUsage();
    try { const disk = statfsSync(dataDir); lines.push(`mola_data_disk_available_bytes ${disk.bavail * disk.bsize}`, `mola_data_disk_total_bytes ${disk.blocks * disk.bsize}`); } catch {}
    let databaseReady = 0;
    try {
      options.db.prepare('SELECT 1').get(); databaseReady = 1;
      const mail = options.db.prepare('SELECT status,COUNT(*) AS count FROM mail_outbox GROUP BY status').all() as { status: string; count: number }[];
      for (const status of ['pending', 'delivered', 'cancelled', 'failed']) lines.push(`mola_mail_outbox{status="${status}"} ${mail.find(row => row.status === status)?.count || 0}`);
      const actionableFailed = options.db.prepare("SELECT COUNT(*) AS count FROM mail_outbox m JOIN auth_tokens t ON t.id=m.token_id WHERE m.status='failed' AND t.consumed_at IS NULL AND t.expires_at>?").get(Date.now()) as { count: number };
      lines.push(`mola_mail_pending ${mail.find(row => row.status === 'pending')?.count || 0}`, `mola_mail_failed ${actionableFailed.count}`);
      const oldest = options.db.prepare("SELECT MIN(created_at) AS oldest FROM mail_outbox WHERE status='pending'").get() as { oldest: number | null };
      lines.push(`mola_mail_oldest_pending_age_seconds ${oldest.oldest ? Math.max(0, (Date.now() - oldest.oldest) / 1000) : 0}`);
    } catch { databaseReady = 0; }
    lines.push(`mola_database_ready ${databaseReady}`, `mola_snapshot_last_duration_seconds ${snapshotDuration}`);
    lines.push(`# TYPE mola_process_uptime_seconds gauge`, `mola_process_uptime_seconds ${process.uptime()}`, `mola_process_resident_memory_bytes ${memory.rss}`, `mola_process_heap_used_bytes ${memory.heapUsed}`, `mola_socket_connections ${options.io.engine.clientsCount}`, `mola_snapshot_success_total ${snapshots}`, `mola_snapshot_failure_total ${failures}`, `mola_snapshot_last_success_timestamp_seconds ${lastSnapshot}`);
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
  const sweep = () => {
    for (const name of readdirSync(root)) if (/^snapshot-[a-f0-9-]{36}$/.test(name)) { const path = safePath(name); if (Date.now() - statSync(path).mtimeMs > 24 * 60 * 60_000) rmSync(path, { recursive: true, force: true }); }
  };
  sweep();
  const timer = setInterval(() => { try { sweep(); } catch (error) { console.error('Snapshot cleanup failed:', error instanceof Error ? error.message : 'unknown'); } }, 60 * 60_000); timer.unref();
  return { close: () => clearInterval(timer) };
}
