const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function normalizeServerUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Sunucu adresini girin.');
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error('https:// ile başlayan geçerli bir sunucu adresi girin.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))) {
    throw new Error('Güvenli bağlantı için HTTPS kullanın. HTTP yalnızca localhost geliştirmesinde kullanılabilir.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Yalnızca sunucu adresini girin; kullanıcı bilgisi, sayfa yolu veya davet bağlantısı eklemeyin.');
  }
  return url.origin;
}

function isTrustedUrl(value, serverUrl) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.origin === serverUrl;
  } catch { return false; }
}

function isTrustedDownloadUrl(value, serverUrl) {
  return isTrustedUrl(value, serverUrl) ||
    (typeof value === 'string' && value.startsWith('blob:') && isTrustedUrl(value.slice(5), serverUrl));
}

function popupAction(value, serverUrl) {
  if (value === 'about:blank') return 'call';
  if (isTrustedUrl(value, serverUrl)) {
    return /^\/api\/files\/[^/]+$/.test(new URL(value).pathname) ? 'download' : 'navigate';
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? 'external' : 'deny';
  } catch { return 'deny'; }
}

function permissionKinds(permission, details = {}) {
  if (permission === 'media') {
    if (!Array.isArray(details.mediaTypes) || !details.mediaTypes.length ||
      details.mediaTypes.some(type => !['audio', 'video'].includes(type))) return null;
    return [...new Set(details.mediaTypes.map(type => type === 'audio' ? 'microphone' : 'camera'))];
  }
  return ['notifications', 'speaker-selection'].includes(permission) ? [permission] : null;
}

function isDisplayCapturePermission(permission, details = {}) {
  // Electron 44 reports display capture as media with no physical device types.
  // Newer versions use a dedicated permission; both still require source selection.
  return permission === 'display-capture' ||
    (permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0);
}

module.exports = { normalizeServerUrl, isTrustedUrl, isTrustedDownloadUrl, popupAction, permissionKinds, isDisplayCapturePermission };
