const { constants } = require('node:fs');
const { access, lstat, open, mkdtemp, rename, rm, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { dirname, extname, isAbsolute, join } = require('node:path');
const { promisify } = require('node:util');
const execFileDefault = promisify(require('node:child_process').execFile);

const FORMATS = { darwin: ['dmg'], win32: ['exe'], linux: ['deb', 'AppImage'] };

function installerError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.userMessage = message;
  return error;
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino && first.size === second.size && first.mtimeMs === second.mtimeMs;
}

async function openRegularFile(filePath) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw installerError('Güncelleme dosyasının yolu geçersiz.');
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw installerError('Güncelleme dosyası normal, bağımsız bir dosya olmalı.');
  const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await file.stat();
    if (!sameFile(before, info)) throw installerError('Güncelleme dosyası doğrulama sırasında değişti.');
    return { file, info };
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function verifyHash(file, release) {
  if (!/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw installerError('Güncelleme checksum bilgisi geçersiz.');
  const info = await file.stat();
  if (release.size !== undefined && info.size !== release.size) throw installerError('Güncelleme dosyasının boyutu doğrulanamadı.');
  const hash = createHash('sha256');
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
  if (hash.digest('hex') !== release.sha256.toLowerCase()) throw installerError('Güncelleme dosyasının hash değeri doğrulanamadı.');
}

async function assertUnchanged(filePath, expected) {
  const current = await lstat(filePath);
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || !sameFile(current, expected)) {
    throw installerError('Dosya doğrulama sırasında değişti; güncelleme durduruldu.');
  }
}

async function assertAppImage(file) {
  const header = Buffer.alloc(11);
  const { bytesRead } = await file.read(header, 0, header.length, 0);
  if (bytesRead !== 11 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2]))) {
    throw installerError('Dosya geçerli bir AppImage çalıştırıcısı değil.');
  }
}

async function copyToNewFile(source, destination, mode) {
  const target = await open(destination, 'wx', 0o600);
  try {
    for await (const chunk of source.createReadStream({ start: 0, autoClose: false })) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await target.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw installerError('Güncelleme dosyası yazılamadı.');
        offset += bytesWritten;
      }
    }
    await target.chmod(mode);
    await target.sync();
  } finally {
    await target.close();
  }
}

async function syncDirectory(path) {
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function replaceAppImage(download, release, { appImagePath, relaunch, quit }) {
  if (typeof relaunch !== 'function') throw installerError('Uygulamayı yeniden başlatma desteği bulunamadı.');
  const installed = await openRegularFile(appImagePath);
  let stagingDirectory;
  let replaced = false;
  let backupPath;
  let stagedInfo;
  try {
    if (installed.info.dev === download.info.dev && installed.info.ino === download.info.ino) {
      throw installerError('İndirilen güncelleme çalışan uygulamadan ayrı olmalı.');
    }
    await assertAppImage(installed.file);
    await assertAppImage(download.file);
    const parent = dirname(appImagePath);
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || !(parentInfo.mode & 0o222) || !(installed.info.mode & 0o222)) {
      throw installerError('AppImage dosyası ve klasörü yazılabilir olmalı.');
    }
    await access(appImagePath, constants.W_OK);
    await access(parent, constants.W_OK | constants.X_OK);
    stagingDirectory = await mkdtemp(join(parent, '.mola-update-'));
    const stagedPath = join(stagingDirectory, 'replacement.AppImage');
    backupPath = join(stagingDirectory, 'previous.AppImage');
    await copyToNewFile(download.file, stagedPath, (installed.info.mode & 0o777) | 0o111);
    const staged = await openRegularFile(stagedPath);
    try {
      await verifyHash(staged.file, release);
      await assertAppImage(staged.file);
      stagedInfo = staged.info;
    } finally { await staged.file.close(); }
    await copyToNewFile(installed.file, backupPath, installed.info.mode & 0o777);
    await syncDirectory(stagingDirectory);
    await assertUnchanged(appImagePath, installed.info);
    await assertUnchanged(stagedPath, stagedInfo);
    // Both paths share a filesystem. rename replaces the old name atomically;
    // the running image remains accessible through its open file/mount.
    await rename(stagedPath, appImagePath);
    replaced = true;
    await syncDirectory(parent);
    // Electron's app.relaunch schedules the new process after app.quit. Starting
    // it immediately would race the currently running app's single-instance lock.
    await relaunch(appImagePath);
    await quit();
    return { mode: 'relaunch', backupPath };
  } catch (error) {
    if (replaced) {
      let restored = false;
      try {
        await assertUnchanged(appImagePath, stagedInfo);
        await rename(backupPath, appImagePath);
        restored = true;
        replaced = false;
        await syncDirectory(dirname(appImagePath));
      } catch (rollbackError) {
        if (restored) {
          throw installerError('Önceki uygulama geri yüklendi, ancak disk yazımı doğrulanamadı.', rollbackError);
        }
        const failure = new Error(`Güncelleme tamamlanamadı. Önceki uygulama ${backupPath} konumunda korundu. ${error.message}`, { cause: rollbackError });
        failure.userMessage = 'Güncelleme tamamlanamadı. Önceki uygulamanın kurtarma kopyası korundu.';
        throw failure;
      }
    }
    if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await installed.file.close();
  }
}

/**
 * Launch a verified installer after native user confirmation. An external
 * installer handoff is not proof that installation completed. AppImage relaunch
 * confirms restart scheduling; a recovery copy is retained for startup failures.
 */
async function launchUpdateInstaller(filePath, release, {
  platform = process.platform,
  arch = process.arch,
  currentVersion,
  execPath = process.execPath,
  resourcesPath = process.resourcesPath,
  spawn,
  helperReadyTimeoutMs,
  appImagePath = process.env.APPIMAGE,
  openPath,
  execFile = execFileDefault,
  relaunch,
  quit = () => {},
} = {}) {
  if (!release || !FORMATS[platform]?.includes(release.format) || extname(filePath || '') !== `.${release.format}`) {
    throw installerError('Bu güncelleme paketi mevcut işletim sistemi için uygun değil.');
  }
  const download = await openRegularFile(filePath);
  try {
    await verifyHash(download.file, release);
    if (release.format === 'AppImage') return await replaceAppImage(download, release, { appImagePath, relaunch, quit });
    if (platform === 'darwin') return await require('./mac-update.cjs').prepareMacUpdate(download, release, {
      arch, currentVersion, execPath, resourcesPath, execFile, spawn, helperReadyTimeoutMs, quit,
    });
    if (typeof openPath !== 'function') throw installerError('Sistem yükleyicisi başlatılamıyor.');
    await assertUnchanged(filePath, download.info);
    if (platform === 'win32') {
      const origin = new URL(release.url);
      if (origin.protocol !== 'https:' || /[\r\n]/.test(release.url)) throw installerError('Güncelleme indirme adresi geçersiz.');
      await writeFile(`${filePath}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${origin.href}\r\n`, { encoding: 'utf8', mode: 0o600 });
    }
    // NTFS metadata writes can update the base file timestamp. Recheck the
    // contents and held file identity after marking instead of trusting mtime.
    const markedInfo = await download.file.stat();
    await verifyHash(download.file, release);
    await assertUnchanged(filePath, markedInfo);
    const error = await openPath(filePath);
    if (typeof error !== 'string' || error) {
      const failure = new Error(error || 'Sistem yükleyicisi başlatılamadı.');
      failure.userMessage = 'Sistem yükleyicisi açılamadı. Mola açık bırakıldı; tekrar deneyebilirsin.';
      throw failure;
    }
    await quit();
    return { mode: 'installer' };
  } finally {
    await download.file.close();
  }
}

module.exports = { launchUpdateInstaller };
