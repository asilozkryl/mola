import { cp, mkdir, open, readdir, rename, rmdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncDirectory, verifyBackup } from './backup-runner.mjs';

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error('Usage: node scripts/restore-backup.mjs BACKUP_DIRECTORY NEW_EMPTY_DATA_DIRECTORY');
const source = resolve(sourceArg), target = resolve(targetArg);
if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep)) throw new Error('Restore source and destination must be separate directories.');
const verified = await verifyBackup(source, { requireChecksums: true });
await mkdir(target, { recursive: true, mode: 0o700 });
if ((await readdir(target)).length) throw new Error('Restore destination must be empty. Stop the application and choose a new empty data directory.');
const staging = join(dirname(target), `.mola-restore-${randomUUID()}`);
await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
await verifyBackup(staging, { requireChecksums: true });
for (const path of [...Object.keys(verified.checksums), 'checksums.json']) {
  const handle = await open(join(staging, path), 'r+'); try { await handle.sync(); } finally { await handle.close(); }
}
await syncDirectory(join(staging, 'uploads')); await syncDirectory(staging);
await rmdir(target); // Only succeeds while the checked destination is still empty.
await rename(staging, target);
await syncDirectory(dirname(target));
console.log(JSON.stringify({ restored: true, destination: target, files: verified.files, note: 'Keep the original MAIL_ENCRYPTION_KEY when it was supplied through the environment.' }));
