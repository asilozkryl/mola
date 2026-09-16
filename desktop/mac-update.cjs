const { constants } = require('node:fs');
const { access, lstat, realpath, mkdtemp, mkdir, open, readFile, writeFile, rename, rm, chmod } = require('node:fs/promises');
const { basename, dirname, isAbsolute, join, resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn: spawnDefault } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function failure(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.userMessage = message;
  return error;
}

async function installedBundle(execPath) {
  if (typeof execPath !== 'string' || !isAbsolute(execPath) || execPath.includes('/AppTranslocation/') ||
      basename(execPath) !== 'Mola' || basename(dirname(execPath)) !== 'MacOS' || basename(dirname(dirname(execPath))) !== 'Contents') {
    throw failure('Mola’yı Uygulamalar klasörüne kurup oradan açtıktan sonra yeniden dene.');
  }
  const targetPath = resolve(execPath, '../../..');
  const info = await lstat(targetPath);
  if (!targetPath.endsWith('.app') || !info.isDirectory() || info.isSymbolicLink()) {
    throw failure('Kurulu Mola uygulamasının konumu doğrulanamadı.');
  }
  // Canonicalize the parent (macOS /var is an OS symlink), but never accept a
  // redirected bundle or main executable as the installation to replace.
  const canonical = join(await realpath(dirname(targetPath)), basename(targetPath));
  if (await realpath(execPath) !== join(canonical, 'Contents/MacOS/Mola')) {
    throw failure('Kurulu Mola uygulamasının yolu başka bir dosyaya yönlendiriliyor.');
  }
  const parentInfo = await lstat(dirname(canonical));
  if (!(info.mode & 0o222) || !(parentInfo.mode & 0o222)) {
    throw failure('Mola’nın kurulu olduğu klasöre yazma izni gerekiyor. Uygulamayı yazabildiğin Uygulamalar klasöründen aç.');
  }
  try {
    await access(canonical, constants.W_OK | constants.X_OK);
    await access(dirname(canonical), constants.W_OK | constants.X_OK);
  } catch (error) {
    throw failure('Mola’nın kurulu olduğu klasöre yazma izni yok. Uygulamayı Uygulamalar klasörüne kurup yeniden dene.', error);
  }
  return canonical;
}

async function copyVerifiedImage(source, destination, release) {
  const target = await open(destination, 'wx', 0o600);
  try {
    let size = 0;
    const hash = createHash('sha256');
    for await (const chunk of source.createReadStream({ start: 0, autoClose: false })) {
      size += chunk.length;
      if (size > release.size) throw failure('Güncelleme dosyasının boyutu değişti. Yeniden indir.');
      hash.update(chunk);
      await target.writeFile(chunk);
    }
    if (size !== release.size || hash.digest('hex') !== release.sha256.toLowerCase()) {
      throw failure('Güncelleme dosyası hazırlanırken doğrulanamadı. Yeniden indir.');
    }
    await target.sync();
  } finally { await target.close(); }
}

async function validateCandidate(path, release, arch, execute) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure('Güncellemede geçerli bir Mola uygulaması bulunamadı.');
  const plist = join(path, 'Contents/Info.plist');
  const field = async key => (await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim();
  if (await field('CFBundleIdentifier') !== 'app.mola.desktop' || await field('CFBundleExecutable') !== 'Mola') {
    throw failure('Güncellemenin uygulama kimliği doğrulanamadı.');
  }
  if (await field('CFBundleShortVersionString') !== release.version || await field('CFBundleVersion') !== release.version) {
    throw failure('Güncellemenin sürüm bilgisi indirilen sürümle eşleşmiyor.');
  }
  try { await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]); }
  catch (error) { throw failure('Güncellemenin uygulama imzası doğrulanamadı. Dosyayı yeniden indir.', error); }
  const executable = join(path, 'Contents/MacOS/Mola');
  if (await realpath(executable) !== executable) throw failure('Güncellemenin çalıştırılabilir dosyası doğrulanamadı.');
  const architectures = (await execute('/usr/bin/lipo', ['-archs', executable])).stdout.trim().split(/\s+/);
  if (!architectures.includes(arch === 'x64' ? 'x86_64' : arch)) throw failure('Güncelleme bu Mac’in işlemci mimarisine uygun değil.');
}

async function privateJSON(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16_384 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw failure('Güncelleme yardımcısının yanıtı doğrulanamadı.');
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

async function publishCommit(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally { await file.close(); }
  // The helper watches for this exact name. Make the complete JSON visible in
  // one operation, never an empty file created before an asynchronous write.
  await rename(temporary, path);
}

async function waitUntilReady(child, config, timeoutMs) {
  let spawnError;
  let exited = false;
  const onError = error => { spawnError = error; };
  const onExit = () => { exited = true; };
  child.on('error', onError);
  child.on('exit', onExit);
  const deadline = Date.now() + timeoutMs;
  try {
    do {
      if (spawnError) throw failure('Güncelleme yardımcısı başlatılamadı. Mola açık bırakıldı.', spawnError);
      try {
        const result = await privateJSON(config.resultPath);
        if (result.phase === 'failed') throw failure(typeof result.message === 'string' ? result.message.slice(0, 300) : 'Güncelleme yardımcısı hazırlanamadı.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exited) throw failure('Güncelleme yardımcısı hazır olmadan kapandı. Mola açık bırakıldı.');
      try {
        const ready = await privateJSON(config.readyPath);
        if (ready.schema !== 1 || ready.phase !== 'ready' || ready.pid !== child.pid) throw failure('Güncelleme yardımcısının yanıtı doğrulanamadı.');
        return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(50);
    } while (Date.now() < deadline);
    throw failure('Güncelleme yardımcısı zamanında hazır olmadı. Mola açık bırakıldı; yeniden dene.');
  } finally {
    child.off('exit', onExit);
    // Keep an error listener after handoff: asynchronous child errors must not
    // terminate the still-running parent while it is processing app.quit().
  }
}

async function prepareMacUpdate(download, release, {
  execPath = process.execPath, resourcesPath = process.resourcesPath,
  currentVersion, arch = process.arch, execFile, spawn = spawnDefault,
  helperReadyTimeoutMs = 90_000, quit,
}) {
  if (!['arm64', 'x64'].includes(arch) || !/^\d+\.\d+\.\d+$/.test(currentVersion || '') ||
      !/^\d+\.\d+\.\d+$/.test(release.version || '') || !Number.isSafeInteger(release.size) || release.size <= 0) {
    throw failure('Bu Mac kurulumu için güncelleme bilgileri doğrulanamadı.');
  }
  const targetPath = await installedBundle(execPath);
  const helperPath = join(targetPath, 'Contents/Resources/mac-updater');
  if (typeof resourcesPath !== 'string' || await realpath(resourcesPath) !== dirname(helperPath)) {
    throw failure('Güncelleme yardımcısının kurulu uygulamaya ait olduğu doğrulanamadı.');
  }
  const helperInfo = await lstat(helperPath);
  if (!helperInfo.isFile() || helperInfo.isSymbolicLink() || helperInfo.nlink !== 1) throw failure('Güncelleme yardımcısı bulunamadı. Mola’yı yeniden kur.');
  await access(helperPath, constants.X_OK);
  const execute = (binary, args) => execFile(binary, args, { timeout: 180_000, maxBuffer: 1024 * 1024 });
  const staging = await mkdtemp(join(dirname(targetPath), '.mola-update-'));
  await chmod(staging, 0o700);
  const mount = join(staging, 'image');
  let attached = false;
  let handedOff = false;
  let child;
  try {
    const payload = join(staging, 'update.dmg');
    await copyVerifiedImage(download.file, payload, release);
    const quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};Mola;${randomUUID()}`;
    await execute('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantine, payload]);
    await mkdir(mount, { mode: 0o700 });
    // Mark as potentially attached before the call, so a late attach error
    // never causes recursive cleanup through a still-mounted filesystem.
    attached = true;
    await execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, payload]);
    const source = join(mount, 'Mola.app');
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw failure('Disk imajında geçerli bir Mola uygulaması bulunamadı.');
    const candidatePath = join(staging, 'Mola.app');
    await execute('/usr/bin/ditto', [source, candidatePath]);
    await execute('/usr/bin/hdiutil', ['detach', mount]);
    attached = false;
    await rm(payload);
    await validateCandidate(candidatePath, release, arch, execute);
    await execute('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantine, candidatePath]);
    const config = { schema: 1, parentPid: process.pid, targetPath, candidatePath,
      currentVersion, version: release.version, bundleId: 'app.mola.desktop', arch,
      readyPath: join(staging, 'ready.json'), resultPath: join(staging, 'result.json'), commitPath: join(staging, 'commit.json') };
    const configPath = join(staging, 'config.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    child = spawn(helperPath, [configPath], { detached: true, stdio: 'ignore' });
    await waitUntilReady(child, config, helperReadyTimeoutMs);
    if (child.exitCode != null || child.signalCode != null) throw failure('Güncelleme yardımcısı beklenmedik biçimde kapandı. Mola açık bırakıldı.');
    await publishCommit(config.commitPath, { schema: 1, parentPid: process.pid, helperPid: child.pid });
    child.unref();
    await quit();
    handedOff = true;
    return { mode: 'relaunch', backupPath: candidatePath };
  } catch (error) {
    child?.kill();
    if (error.userMessage) throw error;
    throw failure('Mac güncellemesi hazırlanamadı. Mola açık bırakıldı. Kurulum iznini ve boş disk alanını kontrol edip yeniden dene.', error);
  } finally {
    if (attached) {
      try { await execute('/usr/bin/hdiutil', ['detach', mount]); attached = false; }
      catch { /* Preserve staging if the OS could still have a mounted volume. */ }
    }
    if (!handedOff && !attached) await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { prepareMacUpdate };
