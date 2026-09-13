const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeServerUrl, isTrustedUrl, isTrustedDownloadUrl, popupAction, permissionKinds, isDisplayCapturePermission } = require('../policy.cjs');

test('server address accepts HTTPS origins and local development only', () => {
  assert.equal(normalizeServerUrl('  https://mola.example/  '), 'https://mola.example');
  assert.equal(normalizeServerUrl('https://mola.example:8443'), 'https://mola.example:8443');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(normalizeServerUrl(`http://${host}:5173/`), `http://${host}:5173`);
  }
  for (const url of ['', 'mola.example', 'http://mola.example', 'file:///tmp/mola',
    'javascript:alert(1)', 'https://user:secret@mola.example', 'https://mola.example/app',
    'https://mola.example/?invite=secret', 'https://mola.example/#token',
    'http://localhost.evil.example', 'http://192.168.1.2:3001']) {
    assert.throws(() => normalizeServerUrl(url), { name: 'Error' }, url);
  }
  assert.throws(() => normalizeServerUrl({ origin: 'https://mola.example' }));
});

test('origin boundary rejects lookalikes, alternate ports, schemes and invalid URLs', () => {
  const server = 'https://mola.example';
  assert.equal(isTrustedUrl('https://mola.example/?workspace=1', server), true);
  for (const url of ['https://mola.example.evil/', 'https://mola.example:8443',
    'http://mola.example', 'https://mola.example@evil.example', 'about:blank',
    'blob:https://mola.example/id', 'https://user@mola.example', 'broken']) {
    assert.equal(isTrustedUrl(url, server), false, url);
  }
});

test('popups preserve call windows and authenticated file downloads', () => {
  const server = 'https://mola.example';
  assert.equal(popupAction('about:blank', server), 'call');
  assert.equal(popupAction('https://mola.example/api/files/file-1', server), 'download');
  assert.equal(popupAction('https://mola.example/?invite=123', server), 'navigate');
  assert.equal(popupAction('https://other.example/api/files/file-1', server), 'external');
  assert.equal(popupAction('https://other.example', server), 'external');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:x@example.com',
    'data:text/html,hello', 'mola://test', 'https://user:pass@other.example', 'broken']) {
    assert.equal(popupAction(url, server), 'deny', url);
  }
});

test('only supported permissions can prompt and unknown media requests fail closed', () => {
  assert.deepEqual(permissionKinds('media', { mediaTypes: ['audio', 'video'] }), ['microphone', 'camera']);
  assert.deepEqual(permissionKinds('media', { mediaTypes: ['audio'] }), ['microphone']);
  assert.deepEqual(permissionKinds('notifications', {}), ['notifications']);
  assert.deepEqual(permissionKinds('speaker-selection', {}), ['speaker-selection']);
  for (const [permission, details] of [['geolocation', {}], ['media', {}],
    ['media', { mediaTypes: [] }], ['media', { mediaTypes: ['unknown'] }],
    ['clipboard-read', {}], ['display-capture', {}]]) {
    assert.equal(permissionKinds(permission, details), null);
  }
});

test('downloads include locally generated recovery codes without accepting foreign blobs', () => {
  const server = 'https://mola.example';
  assert.equal(isTrustedDownloadUrl('https://mola.example/api/files/id', server), true);
  assert.equal(isTrustedDownloadUrl('blob:https://mola.example/recovery-id', server), true);
  for (const value of ['blob:https://other.example/id', 'blob:null/id', 'file:///tmp/file',
    'data:text/plain,recovery', 'blob:https://user@mola.example/id']) {
    assert.equal(isTrustedDownloadUrl(value, server), false, value);
  }
});

test('Electron 44 display preflight is distinct from physical camera or unspecified media', () => {
  assert.equal(isDisplayCapturePermission('media', { mediaTypes: [] }), true);
  assert.equal(isDisplayCapturePermission('display-capture', {}), true);
  assert.equal(isDisplayCapturePermission('media', {}), false);
  assert.equal(isDisplayCapturePermission('media', { mediaTypes: ['video'] }), false);
  assert.equal(isDisplayCapturePermission('media', { mediaTypes: ['unknown'] }), false);
});
