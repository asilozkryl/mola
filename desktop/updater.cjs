const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { lstat, mkdir, open, opendir, rename, unlink } = require('node:fs/promises');
const { dirname, isAbsolute, join, resolve } = require('node:path');

const API = 'https://api.github.com/repos/asilozkryl/mola/releases?per_page=100';
const RELEASES = 'https://github.com/asilozkryl/mola/releases';
const MAX_INSTALLER = 1024 * 1024 * 1024;
const MAX_METADATA = 2 * 1024 * 1024;
const MAX_CHECKSUMS = 16 * 1024;
const failure = message => Object.assign(new Error(message), { userMessage: message });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function versionParts(value) {
  if (typeof value !== 'string' || value.length > 48 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareVersions(a, b) {
  const left = versionParts(a); const right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function installerNames(version) {
  return [`Mola-${version}-linux-amd64.deb`, `Mola-${version}-linux-x86_64.AppImage`,
    `Mola-${version}-win-x64.exe`, `Mola-${version}-mac-x64.dmg`, `Mola-${version}-mac-x64.zip`,
    `Mola-${version}-mac-arm64.dmg`, `Mola-${version}-mac-arm64.zip`];
}
function targetName(version, platform, arch, format) {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch) && format === 'dmg') return `Mola-${version}-mac-${arch}.dmg`;
  if (platform === 'win32' && arch === 'x64' && format === 'exe') return `Mola-${version}-win-x64.exe`;
  if (platform === 'linux' && arch === 'x64' && format === 'deb') return `Mola-${version}-linux-amd64.deb`;
  if (platform === 'linux' && arch === 'x64' && format === 'AppImage') return `Mola-${version}-linux-x86_64.AppImage`;
  return null;
}
function githubDigest(asset) {
  if (asset.digest == null) return null;
  if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw failure('Yayın dosyasının özeti geçersiz.');
  return asset.digest.slice(7);
}
function validateRelease(data, version) {
  const names = [...installerNames(version), 'SHA256SUMS'];
  if (data.html_url !== `${RELEASES}/tag/desktop-v${version}` || !Array.isArray(data.assets) || data.assets.length !== names.length) {
    throw failure('Güncelleme yayını henüz eksiksiz değil. Lütfen daha sonra tekrar dene.');
  }
  const assets = new Map();
  for (const asset of data.assets) {
    if (!asset || !names.includes(asset.name) || assets.has(asset.name) || asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > (asset.name === 'SHA256SUMS' ? MAX_CHECKSUMS : MAX_INSTALLER) ||
      asset.browser_download_url !== `${RELEASES}/download/desktop-v${version}/${asset.name}`) {
      throw failure('Güncelleme dosyalarının kaynağı veya boyutu doğrulanamadı.');
    }
    githubDigest(asset);
    assets.set(asset.name, asset);
  }
  return assets;
}
function parseChecksums(bytes, assets, version) {
  const checksumAsset = assets.get('SHA256SUMS');
  if (bytes.length !== checksumAsset.size || (githubDigest(checksumAsset) && sha256(bytes) !== githubDigest(checksumAsset))) {
    throw failure('Güncelleme doğrulama dosyası eşleşmedi.');
  }
  const names = installerNames(version); const hashes = new Map();
  const text = bytes.toString('utf8');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length !== names.length) throw failure('Güncelleme doğrulama listesi eksik veya yinelenmiş.');
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (Mola-[A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || !names.includes(match[2]) || hashes.has(match[2])) throw failure('Güncelleme doğrulama listesi geçersiz.');
    const digest = githubDigest(assets.get(match[2]));
    if (digest && digest !== match[1]) throw failure('Yayın ve dosya özetleri eşleşmedi.');
    hashes.set(match[2], match[1]);
  }
  return hashes;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || failure('İşlem iptal edildi.'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || failure('İşlem iptal edildi.'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function allowedRedirect(value, original) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    (url.href === original || (url.hostname === 'release-assets.githubusercontent.com' && url.pathname.startsWith('/github-production-release-asset/')));
}
async function networkResponse(fetchImpl, url, signal, asset = false) {
  const original = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const response = await abortable(fetchImpl(url, { signal, redirect: 'manual', credentials: 'omit',
      headers: { Accept: asset ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'Mola-Desktop-Updater' } }), signal);
    if (response.redirected || (response.url && response.url !== url)) throw failure('Beklenmeyen güncelleme yönlendirmesi.');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const target = response.headers.get('location');
      if (!asset || redirects === 3 || !allowedRedirect(target, original)) throw failure('Güncelleme kaynağı yönlendirmesi doğrulanamadı.');
      url = target; continue;
    }
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw failure(response.status === 403 || response.status === 429 ? 'Güncelleme sunucusu şu an meşgul. Daha sonra tekrar dene.' : 'Güncelleme sunucusuna ulaşılamadı.');
    }
    return response;
  }
  throw failure('Çok fazla güncelleme yönlendirmesi.');
}
async function readBody(response, signal, limit, receive) {
  const length = response.headers.get('content-length');
  // Fetch exposes decoded bytes but retains the compressed wire Content-Length.
  // Bound the decoded stream below; only identity encoding has comparable sizes.
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const identityEncoding = !encoding || encoding === 'identity';
  if (length != null && (!/^\d+$/.test(length) || (identityEncoding && Number(length) > limit))) {
    void response.body.cancel().catch(() => {});
    throw failure('Güncelleme yanıtı beklenen boyutu aşıyor.');
  }
  const reader = response.body.getReader(); let count = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      count += value.byteLength;
      if (count > limit) throw failure('Güncelleme yanıtı beklenen boyutu aşıyor.');
      await receive(Buffer.from(value), count);
      signal.throwIfAborted();
    }
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read is being cancelled. */ }
  }
  if (identityEncoding && length != null && count !== Number(length)) throw failure('İndirme tamamlanamadı. Tekrar dene.');
  return count;
}
async function readNetworkBytes(fetchImpl, url, signal, limit, asset = false) {
  const response = await networkResponse(fetchImpl, url, signal, asset); const chunks = [];
  await readBody(response, signal, limit, chunk => chunks.push(chunk));
  return Buffer.concat(chunks);
}

async function validateCache(cacheDir, create = false) {
  if (typeof cacheDir !== 'string' || !isAbsolute(cacheDir) || cacheDir.includes('\0') || resolve(cacheDir) !== cacheDir) throw failure('Güncelleme klasörü geçersiz.');
  let current = cacheDir;
  while (true) {
    try {
      const value = await lstat(current);
      if (!value.isDirectory() || value.isSymbolicLink()) throw failure('Güncelleme klasörü güvenli değil.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  if (create) await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const value = await lstat(cacheDir);
  if (!value.isDirectory() || value.isSymbolicLink() || (process.platform !== 'win32' &&
    ((value.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && value.uid !== process.getuid())))) throw failure('Güncelleme klasörünün izinleri güvenli değil.');
}
async function verifyFile(filePath, release, signal) {
  const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const value = await file.stat();
    if (!value.isFile() || value.nlink !== 1 || value.size !== release.size) throw failure('İndirilen güncelleme dosyası değişmiş. Yeniden indir.');
    const digest = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let position = 0;
    while (position < value.size) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, value.size - position), position);
      if (!bytesRead) throw failure('İndirilen dosya tamamlanamadı.');
      digest.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const latest = await lstat(filePath); const after = await file.stat();
    if (!latest.isFile() || latest.isSymbolicLink() || latest.nlink !== 1 || after.nlink !== 1 ||
      latest.ino !== value.ino || latest.dev !== value.dev || after.size !== value.size ||
      after.mtimeMs !== value.mtimeMs || digest.digest('hex') !== release.sha256) throw failure('İndirilen güncelleme doğrulanamadı. Yeniden indir.');
  } finally { await file.close(); }
}

async function cleanPreviousDownloads(cacheDir, currentVersion, signal) {
  // This private directory contains installer caches, never user documents. Keep
  // the newest previous version; leave unfamiliar, future, or linked files alone.
  try {
    await validateCache(cacheDir);
    const directory = await opendir(cacheDir); const candidates = []; let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 128 || signal.aborted) break;
      const match = /^Mola-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-/.exec(entry.name);
      if (!match || !versionParts(match[1]) || !installerNames(match[1]).includes(entry.name) || compareVersions(match[1], currentVersion) >= 0) continue;
      const path = join(cacheDir, entry.name); const value = await lstat(path);
      if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 ||
        (typeof process.getuid === 'function' && value.uid !== process.getuid())) continue;
      candidates.push({ path, version: match[1], ino: value.ino, dev: value.dev });
    }
    const previousVersion = candidates.map(entry => entry.version).sort((a, b) => compareVersions(b, a))[0];
    for (const entry of candidates) {
      if (signal.aborted) break;
      if (entry.version === previousVersion) continue;
      await validateCache(cacheDir);
      const latest = await lstat(entry.path);
      if (latest.isFile() && !latest.isSymbolicLink() && latest.nlink === 1 && latest.ino === entry.ino && latest.dev === entry.dev) await unlink(entry.path);
    }
  } catch { /* Cache housekeeping must not invalidate a verified download. */ }
}

function createUpdateManager({ currentVersion, platform, arch, packageType, cacheDir,
  fetchImpl = globalThis.fetch, onChange = () => {}, install: installFile = async () => {},
  requestTimeoutMs = 20_000, downloadTimeoutMs = 10 * 60_000 }) {
  const supported = !!versionParts(currentVersion) && !!targetName(currentVersion, platform, arch, packageType);
  // Installation behavior is a capability of this packaged updater, never
  // metadata supplied by a remote release or its asset extension.
  const installMode = !supported ? null : (platform === 'darwin' && packageType === 'dmg') || packageType === 'AppImage' ? 'relaunch' : 'installer';
  const timeoutBound = (value, fallback, max) => Number.isFinite(value) ? Math.max(10, Math.min(max, value)) : fallback;
  requestTimeoutMs = timeoutBound(requestTimeoutMs, 20_000, 60_000);
  downloadTimeoutMs = timeoutBound(downloadTimeoutMs, 600_000, 1_800_000);
  let state = { phase: supported ? 'idle' : 'unsupported', currentVersion, latestVersion: null,
    format: packageType, platform, installMode, progress: 0, transferred: 0, total: 0, releaseUrl: null, error: '', lastCheckedAt: null };
  let selected = null; let readyPath = null; let operation = null; let generation = 0;
  const getState = () => ({ ...state, canDownload: !!selected && ['available', 'error'].includes(state.phase), canInstall: !!readyPath && state.phase === 'ready' });
  const setState = patch => { state = { ...state, ...patch }; try { onChange(getState()); } catch { /* UI observers cannot interrupt integrity checks. */ } };
  function run(work, timeout) {
    if (!supported) return Promise.resolve(getState());
    if (operation) return operation.promise;
    const id = ++generation; const controller = new AbortController();
    const current = { id, controller, promise: null };
    operation = current;
    const timer = setTimeout(() => controller.abort(failure('Güncelleme işlemi zaman aşımına uğradı. Tekrar dene.')), timeout);
    const active = () => { controller.signal.throwIfAborted(); if (generation !== id) throw failure('İşlem iptal edildi.'); };
    current.promise = Promise.resolve().then(() => { active(); return work(controller.signal, active); }).catch(error => {
      if (generation === id) {
        readyPath = null;
        const message = typeof error?.userMessage === 'string' && error.userMessage.length <= 300 ? error.userMessage : 'Güncelleme tamamlanamadı. Bağlantını ve boş disk alanını kontrol edip tekrar dene.';
        setState({ phase: 'error', error: message });
      }
    }).finally(() => { clearTimeout(timer); if (operation === current) operation = null; }).then(getState);
    return current.promise;
  }
  function check() {
    return run(async (signal, active) => {
      selected = null; readyPath = null;
      setState({ phase: 'checking', error: '', progress: 0, transferred: 0, total: 0, latestVersion: null, releaseUrl: null });
      const bytes = await readNetworkBytes(fetchImpl, API, signal, MAX_METADATA); active();
      let releases;
      try { releases = JSON.parse(bytes.toString('utf8')); } catch { throw failure('Güncelleme listesi okunamadı.'); }
      if (!Array.isArray(releases) || releases.length > 100) throw failure('Güncelleme listesi geçersiz.');
      const versions = new Map();
      for (const entry of releases) {
        if (!entry || entry.draft !== false || entry.prerelease !== false || typeof entry.tag_name !== 'string' || !entry.tag_name.startsWith('desktop-v')) continue;
        const version = entry.tag_name.slice('desktop-v'.length);
        if (!versionParts(version)) continue;
        if (versions.has(version)) throw failure('Güncelleme listesinde yinelenen sürüm var.');
        versions.set(version, entry);
      }
      const latest = [...versions.keys()].sort((a, b) => compareVersions(b, a))[0];
      if (!latest || compareVersions(latest, currentVersion) <= 0) {
        setState({ phase: 'current', latestVersion: latest || currentVersion, lastCheckedAt: new Date().toISOString() }); return;
      }
      const data = versions.get(latest); const assets = validateRelease(data, latest);
      const sums = await readNetworkBytes(fetchImpl, assets.get('SHA256SUMS').browser_download_url, signal, MAX_CHECKSUMS, true); active();
      const hashes = parseChecksums(sums, assets, latest);
      const name = targetName(latest, platform, arch, packageType); const asset = assets.get(name);
      selected = Object.freeze({ version: latest, name, format: packageType, url: asset.browser_download_url,
        sha256: hashes.get(name), size: asset.size, releaseUrl: data.html_url });
      setState({ phase: 'available', latestVersion: latest, releaseUrl: data.html_url, total: asset.size, lastCheckedAt: new Date().toISOString() });
    }, requestTimeoutMs);
  }
  function download() {
    if (operation) return operation.promise;
    if (!selected || !['available', 'error'].includes(state.phase)) return Promise.resolve(getState());
    return run(async (signal, active) => {
      const release = selected; readyPath = null;
      setState({ phase: 'downloading', error: '', progress: 0, transferred: 0, total: release.size });
      await validateCache(cacheDir, true); active();
      const destination = join(cacheDir, release.name);
      try {
        const existing = await lstat(destination);
        if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 ||
          (typeof process.getuid === 'function' && existing.uid !== process.getuid())) throw failure('Önbellekteki güncelleme dosyası güvenli değil.');
        try {
          await verifyFile(destination, release, signal); active();
          await cleanPreviousDownloads(cacheDir, release.version, signal); active();
          readyPath = destination; setState({ phase: 'ready', progress: 100, transferred: release.size }); return;
        } catch (error) {
          active();
          const latest = await lstat(destination);
          if (!latest.isFile() || latest.isSymbolicLink() || latest.nlink !== 1 || latest.ino !== existing.ino || latest.dev !== existing.dev) throw error;
          await unlink(destination);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const temporary = join(cacheDir, `.${randomUUID()}.partial`); let file;
      try {
        file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        const response = await networkResponse(fetchImpl, release.url, signal, true); active();
        const digest = createHash('sha256');
        const count = await readBody(response, signal, release.size, async (chunk, transferred) => {
          active(); await file.writeFile(chunk); active(); digest.update(chunk);
          setState({ transferred, progress: Math.min(99, Math.floor(transferred / release.size * 100)) });
        });
        active();
        if (count !== release.size || digest.digest('hex') !== release.sha256) throw failure('İndirilen güncellemenin özeti eşleşmedi. Tekrar dene.');
        await file.sync(); await file.close(); file = null;
        await validateCache(cacheDir); await verifyFile(temporary, release, signal); active();
        try { await lstat(destination); throw failure('Güncelleme dosyası beklenmedik biçimde değişti.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(temporary, destination); active();
        await cleanPreviousDownloads(cacheDir, release.version, signal); active();
        readyPath = destination; setState({ phase: 'ready', progress: 100, transferred: release.size });
      } finally {
        if (file) await file.close().catch(() => {});
        await unlink(temporary).catch(() => {});
      }
    }, downloadTimeoutMs);
  }
  function install() {
    if (operation) return operation.promise;
    if (!readyPath || state.phase !== 'ready' || !selected) return Promise.resolve(getState());
    return run(async (signal, active) => {
      const path = readyPath; const release = selected;
      setState({ phase: 'installing', error: '' });
      await validateCache(cacheDir); await verifyFile(path, release, signal); active();
      const accepted = await installFile(path, release); active();
      setState({ phase: accepted === false ? 'ready' : 'installed' });
    }, downloadTimeoutMs);
  }
  function cancel() {
    // Once handed to the operating system, installation cannot be cancelled here.
    if (state.phase === 'installing') return getState();
    generation++; const old = operation; operation = null;
    old?.controller.abort(failure('İşlem iptal edildi.'));
    if (state.phase === 'checking' || state.phase === 'downloading') {
      readyPath = null; setState({ phase: selected ? 'available' : (supported ? 'idle' : 'unsupported'), error: '', progress: 0, transferred: 0 });
    }
    return getState();
  }
  return { getState, check, download, cancel, install };
}

module.exports = { createUpdateManager };
