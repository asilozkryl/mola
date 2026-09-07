import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.DATA_DIR || './data', 'mola.sqlite');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === source) {
  console.error('Usage: node scripts/backup.mjs /absolute/path/to/new-backup.sqlite');
  process.exit(1);
}
await mkdir(dirname(destination), { recursive: true });
try {
  // Reserve atomically with private permissions; never overwrite someone else's backup.
  const target = await open(destination, 'wx', 0o600);
  await target.close();
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('Destination already exists. Choose a new backup path.');
  process.exit(1);
}
let db;
try {
  db = new DatabaseSync(source, { readOnly: true });
  await backup(db, destination);
  const verification = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = verification.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  } finally {
    verification.close();
  }
  console.log(`Verified SQLite backup: ${destination}`);
  console.log('Uploaded files are separate. See docs/DEPLOYMENT.md for a complete backup.');
} catch (error) {
  await rm(destination, { force: true });
  throw error;
} finally {
  db?.close();
}
