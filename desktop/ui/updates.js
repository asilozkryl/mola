'use strict';

const elements = Object.fromEntries([
  'state-title', 'state-description', 'current-version', 'latest-version', 'latest-version-row',
  'download-progress', 'progress-percent', 'progress-track', 'progress-fill', 'transfer-size',
  'update-error', 'last-checked', 'installation-note', 'installation-help', 'continuity-note',
  'check-updates', 'download-update', 'cancel-update', 'install-update', 'later',
].map(id => [id, document.getElementById(id)]));
const phases = new Set(['idle', 'checking', 'current', 'available', 'downloading', 'ready', 'installing', 'installed', 'error', 'unsupported']);
const formats = new Set(['dmg', 'exe', 'deb', 'AppImage']);
const numberFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const inFlight = new Set();
let state = null;
let localError = '';
let bridge;
let disposed = false;
let revision = 0;
let unsubscribe = null;

function readableError(error, fallback) {
  if (!(error instanceof Error) || !error.message) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function installationCopy(format) {
  if (format === 'dmg') return 'DMG açılınca Mola’yı Applications (Uygulamalar) klasörüne sürükle ve mevcut uygulamayı değiştir. Ardından Mola’yı yeniden aç.';
  if (format === 'exe') return 'Windows kurulum penceresindeki adımları tamamla. Mevcut Mola kurulumu güncellenir; ardından uygulamayı yeniden açabilirsin.';
  if (format === 'deb') return 'Sisteminin paket yükleyicisinde kurulumu tamamla. Yönetici parolası istenebilir. Kurulumdan sonra Mola’yı yeniden aç.';
  if (format === 'AppImage') return 'Onayladığında mevcut AppImage güncellenir ve Mola yeniden açılır. Görüşmeni bitirip gönderilmemiş mesajlarını kontrol et.';
  return '';
}

function acceptState(value) {
  if (disposed || !value || typeof value !== 'object' || !phases.has(value.phase)) return false;
  state = {
    ...value,
    currentVersion: typeof value.currentVersion === 'string' ? value.currentVersion : '—',
    latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : null,
    format: formats.has(value.format) ? value.format : null,
    error: typeof value.error === 'string' ? value.error : '',
  };
  render();
  return true;
}

function render() {
  if (disposed) return;
  const phase = state?.phase || 'idle';
  const format = state?.format;
  const busy = inFlight.size > 0;
  const descriptions = {
    idle: ['Yeni bir sürüm var mı?', 'Mola’nın bu bilgisayara uygun en yeni sürümünü kontrol et.'],
    checking: ['Güncellemeler kontrol ediliyor…', 'Yeni masaüstü sürümü aranıyor.'],
    current: ['Mola güncel', 'Bu bilgisayar için en yeni sürümü kullanıyorsun.'],
    available: ['Yeni bir Mola sürümü var', 'Hazır olduğunda güncellemeyi indir. Kurulum için ayrıca onayın istenir.'],
    downloading: ['Güncelleme indiriliyor', 'Mola’yı kullanmaya devam edebilirsin. Dosya tamamlandığında doğrulanacak.'],
    ready: ['Güncelleme kurulmaya hazır', 'İndirme tamamlandı ve dosyanın bütünlüğü doğrulandı.'],
    installing: [format === 'AppImage' ? 'Mola yeniden açılmak üzere…' : 'Kurulum açılıyor…', 'Lütfen işlemin tamamlanmasını bekle.'],
    installed: format === 'dmg'
      ? ['DMG açıldı', 'Mola’yı Applications (Uygulamalar) klasörüne sürükleyip mevcut uygulamayı değiştir. Kurulumu tamamladıktan sonra Mola’yı yeniden aç.']
      : format === 'AppImage'
        ? ['Mola yeniden açılıyor', 'Güncelleme uygulandı. Çalışma alanın yeni pencerede açılacak.']
        : ['Kurulum açıldı', 'Güncellemeyi tamamlamak için açılan sistem kurulum penceresindeki adımları izle.'],
    error: ['İşlem tamamlanamadı', 'Bağlantını kontrol edip yeniden deneyebilirsin.'],
    unsupported: ['Bu kurulumda güncelleme kullanılamıyor', 'Bu Mola kurulumu için uygulama içinden güncelleme desteklenmiyor.'],
  };
  const copy = descriptions[phase];
  // Progress ticks must not re-announce an unchanged status to screen readers.
  if (elements['state-title'].textContent !== copy[0]) elements['state-title'].textContent = copy[0];
  if (elements['state-description'].textContent !== copy[1]) elements['state-description'].textContent = copy[1];
  elements['current-version'].textContent = state?.currentVersion || '—';
  elements['latest-version'].textContent = state?.latestVersion || '—';
  elements['latest-version-row'].hidden = !state?.latestVersion || state.latestVersion === state.currentVersion;
  const error = localError || state?.error || '';
  elements['update-error'].textContent = error;
  elements['update-error'].hidden = !error;

  const transferred = Number.isFinite(state?.transferred) ? Math.max(0, state.transferred) : 0;
  const total = Number.isFinite(state?.total) ? Math.max(0, state.total) : 0;
  const progress = Number.isFinite(state?.progress) ? Math.min(100, Math.max(0, Math.round(state.progress))) : 0;
  elements['download-progress'].hidden = phase !== 'downloading';
  elements['progress-percent'].textContent = `%${progress}`;
  elements['progress-track'].setAttribute('aria-valuenow', String(progress));
  elements['progress-fill'].style.width = `${progress}%`;
  elements['transfer-size'].textContent = total > 0
    ? `${numberFormat.format(transferred / 1_000_000)} MB / ${numberFormat.format(total / 1_000_000)} MB`
    : `${numberFormat.format(transferred / 1_000_000)} MB`;

  const checked = state?.lastCheckedAt ? new Date(state.lastCheckedAt) : null;
  elements['last-checked'].hidden = !checked || !Number.isFinite(checked.getTime());
  elements['last-checked'].textContent = elements['last-checked'].hidden ? '' : `Son kontrol: ${dateFormat.format(checked)}`;
  const help = installationCopy(format);
  elements['installation-note'].hidden = !help || !['available', 'ready', 'installed', 'error'].includes(phase)
    || (phase === 'error' && state?.canDownload !== true && state?.canInstall !== true);
  elements['installation-help'].textContent = help;
  elements['continuity-note'].hidden = phase === 'unsupported' || phase === 'installed';

  const canDownload = phase === 'available' || (phase === 'error' && state?.canDownload === true);
  const canInstall = phase === 'ready' || (phase === 'error' && state?.canInstall === true);
  elements['check-updates'].hidden = !['idle', 'checking', 'current', 'available', 'error'].includes(phase);
  elements['check-updates'].disabled = !bridge || !state || busy || phase === 'checking';
  elements['check-updates'].className = `button ${canDownload || canInstall ? 'button-secondary' : 'button-primary'}`;
  elements['check-updates'].textContent = phase === 'checking' ? 'Kontrol ediliyor…' : 'Güncellemeleri kontrol et';
  elements['download-update'].hidden = !canDownload;
  elements['download-update'].disabled = busy || !bridge || state?.canDownload === false;
  elements['install-update'].hidden = !canInstall;
  elements['install-update'].disabled = busy || !bridge || state?.canInstall === false || !format;
  elements['install-update'].textContent = format === 'dmg' ? 'DMG’yi aç' : format === 'AppImage' ? 'Güncelle ve yeniden aç' : 'Kurulumu başlat';
  elements['cancel-update'].hidden = phase !== 'downloading';
  elements['cancel-update'].disabled = !bridge || inFlight.has('cancelUpdate');
}

async function runAction(method) {
  if (disposed || !bridge || inFlight.has(method)) return;
  if (inFlight.size && method !== 'cancelUpdate') return;
  localError = '';
  inFlight.add(method);
  const startedAt = revision;
  render();
  try {
    const result = await bridge[method]();
    if (disposed) return;
    // State events may already contain newer download progress than this reply.
    if (revision === startedAt && !acceptState(result)) {
      const refreshed = await bridge.getUpdateState();
      if (revision === startedAt) acceptState(refreshed);
    }
  } catch (error) {
    if (!disposed) localError = readableError(error, 'İşlem tamamlanamadı. Yeniden dene.');
  } finally {
    inFlight.delete(method);
    render();
  }
}

elements['check-updates'].addEventListener('click', () => void runAction('checkUpdates'));
elements['download-update'].addEventListener('click', () => void runAction('downloadUpdate'));
elements['cancel-update'].addEventListener('click', () => void runAction('cancelUpdate'));
elements['install-update'].addEventListener('click', () => void runAction('installUpdate'));
elements.later.addEventListener('click', () => window.close());
window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  if (typeof unsubscribe === 'function') unsubscribe();
}, { once: true });

async function initialize() {
  try {
    const candidate = window.molaDesktop;
    if (!candidate || ['getUpdateState', 'checkUpdates', 'downloadUpdate', 'cancelUpdate', 'installUpdate', 'onUpdateState'].some(method => typeof candidate[method] !== 'function')) {
      throw new Error('Masaüstü güncelleme penceresi başlatılamadı. Mola’yı yeniden açıp tekrar dene.');
    }
    bridge = candidate;
    unsubscribe = bridge.onUpdateState(value => {
      if (disposed) return;
      revision++;
      localError = '';
      acceptState(value);
    });
    const startedAt = revision;
    const value = await bridge.getUpdateState();
    if (disposed) return;
    if (revision === startedAt && !acceptState(value)) throw new Error('Güncelleme durumu okunamadı. Mola’yı yeniden açıp tekrar dene.');
  } catch (error) {
    if (!disposed) {
      localError = readableError(error, 'Güncelleme durumu okunamadı.');
      state = { phase: 'error', currentVersion: '—', format: null };
    }
  } finally { render(); }
}

void initialize();
