const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtemp, rm, readFile, writeFile, readdir, stat, symlink, link, mkdir, realpath } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createUpdateManager } = require('../updater.cjs');

const API = 'https://api.github.com/repos/asilozkryl/mola/releases?per_page=100';
const ROOT = 'https://github.com/asilozkryl/mola/releases';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function release(version = '1.0.6') {
  const names = [`Mola-${version}-linux-amd64.deb`, `Mola-${version}-linux-x86_64.AppImage`,
    `Mola-${version}-win-x64.exe`, `Mola-${version}-mac-x64.dmg`, `Mola-${version}-mac-x64.zip`,
    `Mola-${version}-mac-arm64.dmg`, `Mola-${version}-mac-arm64.zip`];
  const files = new Map(names.map(name => [name, Buffer.from(`installer fixture ${name}`)]));
  files.set('SHA256SUMS', Buffer.from(names.map(name => `${hash(files.get(name))}  ${name}\n`).join('')));
  const metadata = { tag_name: `desktop-v${version}`, draft: false, prerelease: false,
    html_url: `${ROOT}/tag/desktop-v${version}`,
    assets: [...files].map(([name, bytes]) => ({ name, size: bytes.length, state: 'uploaded',
      digest: `sha256:${hash(bytes)}`, browser_download_url: `${ROOT}/download/desktop-v${version}/${name}` })) };
  return { metadata, files };
}
async function fixture(t, options = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mola-updater-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const releases = options.releases || [release()];
  const calls = [];
  const installs = [];
  const states = [];
  const transport = async (url, init) => {
    calls.push(url);
    if (options.fetch) {
      const response = await options.fetch(url, init);
      if (response) return response;
    }
    if (url === API) return Response.json(releases.map(item => item.metadata));
    for (const item of releases) {
      const asset = item.metadata.assets.find(entry => entry.browser_download_url === url);
      if (asset) return new Response(item.files.get(asset.name));
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const manager = createUpdateManager({ currentVersion: '1.0.5', platform: 'darwin', arch: 'arm64',
    packageType: 'dmg', cacheDir: join(directory, 'updates'), fetchImpl: transport,
    onChange: state => states.push(state), install: async (path, info) => installs.push({ path, info }),
    ...options.manager });
  return { manager, directory, releases, calls, installs, states };
}

test('selects newest stable version numerically and downloads only exact native installer with verified bytes', async t => {
  const f = await fixture(t, { releases: [release('1.0.7'), release('1.0.10'), release('1.0.6')] });
  const checked = await f.manager.check();
  assert.equal(checked.latestVersion, '1.0.10', JSON.stringify(checked));
  assert.equal(f.manager.getState().phase, 'available');
  assert.equal(f.installs.length, 0);
  assert.equal((await f.manager.download()).phase, 'ready');
  assert.equal(f.manager.getState().progress, 100);
  assert.equal(f.installs.length, 0);
  assert.equal((await f.manager.install()).phase, 'installed');
  assert.equal(f.installs.length, 1);
  const { path, info } = f.installs[0];
  assert.equal(info.name, 'Mola-1.0.10-mac-arm64.dmg');
  assert.equal(info.sha256, hash(await readFile(path)));
  assert.equal(info.url, `${ROOT}/download/desktop-v1.0.10/${info.name}`);
  assert.equal(Object.hasOwn(f.manager.getState(), 'path'), false);
  if (process.platform !== 'win32') assert.equal((await stat(join(f.directory, 'updates'))).mode & 0o777, 0o700);
});

test('current, unsupported, drafts, prereleases and noncanonical versions never offer installation', async t => {
  const old = release('1.0.4');
  const draft = release('9.0.0'); draft.metadata.draft = true;
  const pre = release('8.0.0'); pre.metadata.prerelease = true;
  const weird = release('01.0.6');
  const f = await fixture(t, { releases: [old, draft, pre, weird] });
  assert.equal((await f.manager.check()).phase, 'current');
  await f.manager.download(); await f.manager.install();
  assert.equal(f.installs.length, 0);
  const unsupported = await fixture(t, { manager: { platform: 'linux', arch: 'arm64', packageType: 'deb' } });
  assert.equal((await unsupported.manager.check()).phase, 'unsupported');
  assert.equal(unsupported.calls.length, 0);
});

test('incomplete releases, duplicate assets and unsafe URLs fail closed', async t => {
  for (const mutate of [
    data => data.assets.pop(), data => data.assets.push(data.assets[0]),
    data => { data.assets[0].browser_download_url = 'https://evil.example/package'; },
    data => { data.assets[0].state = 'new'; }, data => { data.assets[0].size = 2 ** 40; },
    data => { data.html_url = 'https://github.com/other/mola/releases/tag/desktop-v1.0.6'; },
  ]) {
    const item = release(); mutate(item.metadata);
    const f = await fixture(t, { releases: [item] });
    assert.equal((await f.manager.check()).phase, 'error');
    await f.manager.download(); await f.manager.install();
    assert.equal(f.installs.length, 0);
  }
});

test('checksum table rejects duplicates, missing files, unsafe names and conflicting GitHub digest', async t => {
  for (const mutate of [
    text => text + text.split('\n')[0] + '\n', text => text.split('\n').slice(1).join('\n'),
    text => text.replace('Mola-', '../Mola-'), text => text.replace(/^[a-f0-9]{64}/, '0'.repeat(64)),
  ]) {
    const item = release(); const body = Buffer.from(mutate(item.files.get('SHA256SUMS').toString()));
    item.files.set('SHA256SUMS', body);
    Object.assign(item.metadata.assets.at(-1), { size: body.length, digest: `sha256:${hash(body)}` });
    const f = await fixture(t, { releases: [item] });
    assert.equal((await f.manager.check()).phase, 'error');
  }
});

test('download rejects corrupt or oversized payload and never retains a ready installer', async t => {
  for (const bytes of [Buffer.from('wrong'), Buffer.alloc(4096)]) {
    const f = await fixture(t, { fetch: async url => url.endsWith('.dmg') ? new Response(bytes) : null });
    await f.manager.check();
    assert.equal((await f.manager.download()).phase, 'error');
    await f.manager.install();
    assert.equal(f.installs.length, 0);
    assert.deepEqual(await readdir(join(f.directory, 'updates')), []);
  }
});

test('download follows only bounded GitHub release asset redirects and rejects API redirects', async t => {
  const item = release(); const target = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/fixture?token=one';
  const bytes = item.files.get('Mola-1.0.6-mac-arm64.dmg');
  const f = await fixture(t, { releases: [item], fetch: async url => {
    if (url.endsWith('.dmg')) return new Response(null, { status: 302, headers: { location: target } });
    if (url === target) return new Response(bytes);
  } });
  await f.manager.check(); assert.equal((await f.manager.download()).phase, 'ready');
  for (const target of ['https://evil.example/file', 'http://release-assets.githubusercontent.com/file',
    'https://name:password@release-assets.githubusercontent.com/file', `${ROOT}/download/desktop-v1.0.5/other.dmg`]) {
    const bad = await fixture(t, { fetch: async url => url.endsWith('.dmg') ? new Response(null, { status: 302, headers: { location: target } }) : null });
    await bad.manager.check(); assert.equal((await bad.manager.download()).phase, 'error');
  }
  const api = await fixture(t, { fetch: async url => url === API ? new Response(null, { status: 302, headers: { location: API } }) : null });
  assert.equal((await api.manager.check()).phase, 'error');
});

test('immediate cancellation invalidates late results and retry remains possible', async t => {
  let pending; let first = true;
  const f = await fixture(t, { fetch: async (url, { signal }) => {
    if (url.endsWith('.dmg') && first) {
      first = false;
      return new Response(new ReadableStream({ start(controller) { pending = controller; signal.addEventListener('abort', () => controller.error(new Error('cancelled'))); } }));
    }
  } });
  await f.manager.check(); const download = f.manager.download();
  while (!pending) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(f.manager.cancel().phase, 'available');
  await download;
  assert.equal(f.manager.getState().phase, 'available');
  assert.equal((await f.manager.download()).phase, 'ready');
  assert.equal(f.installs.length, 0);
});

test('concurrent check and download actions coalesce instead of starting parallel writes', async t => {
  const f = await fixture(t);
  await Promise.all([f.manager.check(), f.manager.check(), f.manager.check()]);
  assert.equal(f.calls.filter(url => url === API).length, 1);
  await Promise.all([f.manager.download(), f.manager.download(), f.manager.check()]);
  assert.equal(f.calls.filter(url => url.endsWith('.dmg')).length, 1);
  assert.equal(f.manager.getState().phase, 'ready');
});

test('tampered downloaded bytes and hardlinked cache installers cannot be installed', async t => {
  for (const tamper of [
    async path => writeFile(path, 'changed'),
    async path => link(path, `${path}.extra`),
  ]) {
    const f = await fixture(t); await f.manager.check(); await f.manager.download();
    const names = await readdir(join(f.directory, 'updates'));
    await tamper(join(f.directory, 'updates', names[0]));
    assert.equal((await f.manager.install()).phase, 'error');
    assert.equal(f.installs.length, 0);
  }
});

test('symlinked cache directories cannot redirect updater writes', async t => {
  if (process.platform === 'win32') return t.skip('Creating symlinks requires Windows developer privileges.');
  const f = await fixture(t);
  const outside = join(f.directory, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.directory, 'updates'));
  await f.manager.check();
  assert.equal((await f.manager.download()).phase, 'error');
  assert.deepEqual(await readdir(outside), []);
});

test('network timeouts and oversized metadata become retryable UI errors', async t => {
  const timeout = await fixture(t, { manager: { requestTimeoutMs: 15 }, fetch: async (url, { signal }) => {
    if (url === API) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  } });
  assert.equal((await timeout.manager.check()).phase, 'error');
  const oversized = await fixture(t, { fetch: async url => url === API ? new Response(' '.repeat(2 * 1024 * 1024 + 1)) : null });
  assert.equal((await oversized.manager.check()).phase, 'error');
});

test('OS confirmation cancellation keeps the verified package ready for another attempt', async t => {
  let accepted = false; const f = await fixture(t, { manager: { install: async () => accepted } });
  await f.manager.check(); await f.manager.download();
  assert.equal((await f.manager.install()).phase, 'ready');
  accepted = true;
  assert.equal((await f.manager.install()).phase, 'installed');
});

test('network and filesystem details never leak into update UI error messages', async t => {
  const privateDetail = '/private/user/cache?token=secret';
  const f = await fixture(t, { fetch: async () => { throw new Error(privateDetail); } });
  const state = await f.manager.check();
  assert.equal(state.phase, 'error');
  assert.equal(JSON.stringify(state).includes(privateDetail), false);
});

test('corrupt private cache can be downloaded again after install verification refuses it', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.download();
  const name = (await readdir(join(f.directory, 'updates')))[0];
  await writeFile(join(f.directory, 'updates', name), 'corrupt');
  assert.equal((await f.manager.install()).phase, 'error');
  assert.equal((await f.manager.download()).phase, 'ready');
  assert.equal((await f.manager.install()).phase, 'installed');
});

test('platform format selection keeps Windows, DEB and AppImage downloads separate', async t => {
  for (const [platform, packageType, suffix] of [['win32', 'exe', 'win-x64.exe'],
    ['linux', 'deb', 'linux-amd64.deb'], ['linux', 'AppImage', 'linux-x86_64.AppImage'], ['darwin', 'dmg', 'mac-x64.dmg']]) {
    const f = await fixture(t, { manager: { platform, arch: 'x64', packageType } });
    await f.manager.check(); await f.manager.download(); await f.manager.install();
    assert.equal(f.installs[0].info.name, `Mola-1.0.6-${suffix}`);
  }
});

test('redirect loops and content-length mismatch never produce an installable download', async t => {
  const loop = await fixture(t, { fetch: async url => url.endsWith('.dmg') ? new Response(null, { status: 302, headers: { location: url } }) : null });
  await loop.manager.check(); assert.equal((await loop.manager.download()).phase, 'error');
  assert.equal(loop.calls.filter(url => url.endsWith('.dmg')).length, 4);
  const mismatch = await fixture(t, { fetch: async url => url.endsWith('.dmg') ? new Response('short', { headers: { 'content-length': '10' } }) : null });
  await mismatch.manager.check(); assert.equal((await mismatch.manager.download()).phase, 'error');
});

test('cancelling an uncooperative check prevents its late response from replacing a newer check', async t => {
  let resolveFirst; let first = true;
  const f = await fixture(t, { fetch: async url => {
    if (url === API && first) { first = false; return new Promise(resolve => { resolveFirst = resolve; }); }
  } });
  const old = f.manager.check();
  while (!resolveFirst) await new Promise(resolve => setTimeout(resolve, 1));
  f.manager.cancel();
  assert.equal((await f.manager.check()).phase, 'available');
  resolveFirst(Response.json([])); await old;
  assert.equal(f.manager.getState().phase, 'available');
  assert.equal(f.manager.getState().latestVersion, '1.0.6');
});

test('cancelling in the same turn prevents even queued work from changing state or starting a request', async t => {
  const f = await fixture(t);
  const checking = f.manager.check(); f.manager.cancel(); await checking;
  assert.equal(f.manager.getState().phase, 'idle');
  assert.equal(f.calls.length, 0);
  await f.manager.check();
  const downloading = f.manager.download(); f.manager.cancel(); await downloading;
  assert.equal(f.manager.getState().phase, 'available');
  assert.equal(f.calls.filter(url => url.endsWith('.dmg')).length, 0);
});

test('ready downloads retain one previous cache version and never clean foreign names or linked files', async t => {
  const f = await fixture(t); const cache = join(f.directory, 'updates'); await mkdir(cache, { mode: 0o700 });
  const old = 'Mola-1.0.3-mac-arm64.dmg'; const previous = 'Mola-1.0.4-mac-arm64.dmg';
  const future = 'Mola-9.0.0-mac-arm64.dmg'; const linked = 'Mola-1.0.2-mac-arm64.dmg';
  for (const name of [old, previous, future, linked, 'notes.txt']) await writeFile(join(cache, name), 'cached fixture');
  await link(join(cache, linked), join(f.directory, 'linked-installer'));
  if (process.platform !== 'win32') await symlink(join(f.directory, 'linked-installer'), join(cache, 'Mola-1.0.1-mac-arm64.dmg'));
  await f.manager.check(); assert.equal((await f.manager.download()).phase, 'ready');
  const names = await readdir(cache);
  assert.equal(names.includes(old), false);
  for (const name of [previous, future, linked, 'notes.txt', 'Mola-1.0.6-mac-arm64.dmg']) assert.equal(names.includes(name), true);
  if (process.platform !== 'win32') assert.equal(names.includes('Mola-1.0.1-mac-arm64.dmg'), true);
});

test('decoded compressed metadata uses decoded size bounds instead of wire Content-Length', async t => {
  for (const encoding of ['gzip', 'br', 'deflate']) {
    const item = release();
    const f = await fixture(t, { releases: [item], fetch: async url => url === API ?
      new Response(JSON.stringify([item.metadata]), { headers: { 'content-encoding': encoding, 'content-length': '42' } }) : null });
    assert.equal((await f.manager.check()).phase, 'available', `Fetch already decoded ${encoding} metadata.`);
  }
  const oversized = await fixture(t, { fetch: async url => url === API ?
    new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-encoding': 'gzip', 'content-length': '42' } }) : null });
  assert.equal((await oversized.manager.check()).phase, 'error');
  const identity = await fixture(t, { fetch: async url => url === API ?
    new Response('[]', { headers: { 'content-encoding': 'identity', 'content-length': '42' } }) : null });
  assert.equal((await identity.manager.check()).phase, 'error');
});
