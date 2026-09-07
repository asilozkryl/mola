import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

declare global {
  interface Window {
    __callTest: { peers: RTCPeerConnection[]; tracks: MediaStreamTrack[]; screen: MediaStreamTrack | null };
  }
}
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function instrumentMedia(page: Page) {
  await page.addInitScript(() => {
    window.__callTest = { peers: [], tracks: [], screen: null };
    const OriginalConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalConnection {
      constructor(configuration?: RTCConfiguration) { super(configuration); window.__callTest.peers.push(this); }
    };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getMedia(constraints);
      window.__callTest.tracks.push(...stream.getTracks());
      return stream;
    };
    // The system picker cannot be automated portably. A moving canvas supplies a real
    // distinct video track; the test still verifies its encoded RTP reaches the peer.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const drawing = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => { drawing.fillStyle = '#153d36'; drawing.fillRect(0, 0, 640, 360); drawing.fillStyle = '#c0e1ad'; drawing.fillRect((frame++ * 9) % 580, 90, 60, 100); };
      draw();
      const timer = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => clearInterval(timer));
      window.__callTest.tracks.push(track);
      window.__callTest.screen = track;
      return stream;
    };
  });
}
async function waitForConnected(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__callTest.peers.some(pc => pc.connectionState === 'connected')), { timeout: 20_000 }).toBe(true);
}
async function inboundBytes(page: Page, mid: string) {
  return page.evaluate(async target => {
    let bytes = 0;
    for (const pc of window.__callTest.peers) {
      const stats = await pc.getStats();
      stats.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.mid === target) bytes += Number(stat.bytesReceived || 0); });
    }
    return bytes;
  }, mid);
}

test('two browsers exchange audio, camera and screen, keep audio when minimized, and release devices', async ({ browser }) => {
  test.setTimeout(90_000);
  const first = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 1440, height: 1000 } });
  const second = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 1440, height: 1000 } });
  try {
    const a = await first.newPage(); const b = await second.newPage();
    await instrumentMedia(a); await instrumentMedia(b);
    const errors: string[] = [];
    a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
    await a.goto('/');
    await expect(a.getByRole('button', { name: 'Bir araya gel', exact: true })).toBeVisible();
    await second.addCookies(await first.cookies());
    await b.goto('/');
    await expect(b.getByRole('button', { name: 'Bir araya gel', exact: true })).toBeVisible();
    await expect(a.getByText('Her şey güncel', { exact: true })).toBeVisible();
    await expect(b.getByText('Her şey güncel', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await expect(a.getByText('Katılımcılar bekleniyor', { exact: false })).toBeVisible();
    await b.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await Promise.all([waitForConnected(a), waitForConnected(b)]);
    await expect(a.getByText('2 kişi görüşmede')).toBeVisible();
    await expect.poll(() => inboundBytes(a, '0')).toBeGreaterThan(0);
    await expect.poll(() => inboundBytes(b, '0')).toBeGreaterThan(0);
    for (const page of [a, b]) {
      const audioPrompt = page.getByRole('button', { name: 'Sesi etkinleştir', exact: true });
      if (await audioPrompt.isVisible()) await audioPrompt.click();
      await expect.poll(() => page.locator('audio').evaluateAll(elements => (elements as HTMLAudioElement[]).every(element => !element.paused && !element.muted && element.readyState >= 2))).toBe(true);
    }

    await a.getByRole('button', { name: 'Mikrofonu kapat', exact: true }).click();
    expect(await a.evaluate(() => window.__callTest.tracks.filter(t => t.kind === 'audio').every(t => !t.enabled))).toBe(true);
    await a.getByRole('button', { name: 'Mikrofonu aç', exact: true }).click();
    await a.getByRole('button', { name: 'Kamerayı aç', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Kamerayı kapat', exact: true })).toBeVisible();
    await expect.poll(() => inboundBytes(b, '1')).toBeGreaterThan(0);
    await a.getByRole('button', { name: 'Ekranı paylaş', exact: true }).click();
    await expect(b.locator('.call-share-stage')).toBeVisible();
    await expect.poll(() => inboundBytes(b, '2')).toBeGreaterThan(0);
    await expect(b.locator('.call-person-camera video')).toBeVisible();
    await b.screenshot({ path: test.info().outputPath('call-camera-and-screen.png') });
    const accessibility = await new AxeBuilder({ page: b }).include('.call-dialog').analyze();
    expect(accessibility.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ rule: v.id, nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary })) }))).toEqual([]);

    await a.getByRole('button', { name: 'Görüşmeyi küçült', exact: true }).click();
    await expect(a.getByRole('region', { name: 'Devam eden görüşme' })).toBeVisible();
    expect(await a.locator('audio').count()).toBe(1);
    await waitForConnected(a);
    expect(await a.locator('audio').evaluateAll(elements => (elements as HTMLAudioElement[]).every(element => !element.paused && element.readyState >= 2))).toBe(true);
    await a.locator('.call-dock-main').click();
    await expect(a.getByRole('dialog')).toBeVisible();
    await a.evaluate(() => { const track = window.__callTest.screen!; track.stop(); track.dispatchEvent(new Event('ended')); });
    await expect(a.getByRole('button', { name: 'Ekranı paylaş', exact: true })).toBeVisible();
    await expect(b.locator('.call-share-stage')).toHaveCount(0);
    await expect(b.locator('.call-person-camera video')).toBeVisible();
    await a.getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
    expect(await a.evaluate(() => window.__callTest.tracks.every(t => t.readyState === 'ended') && window.__callTest.peers.every(pc => pc.connectionState === 'closed'))).toBe(true);
    await expect(b.getByText('Katılımcılar bekleniyor', { exact: false })).toBeVisible();
    await b.getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
    expect(await b.evaluate(() => window.__callTest.tracks.every(t => t.readyState === 'ended'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await first.close(); await second.close(); }
});

test('microphone permission denial gives a clear retry state without joining', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Mikrofon izni verilmedi');
  await expect(page.getByRole('button', { name: 'Yeniden katıl', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mikrofonu kapat', exact: true })).toHaveCount(0);
});

test('closing a pending permission request stops media acquired after cancellation', async ({ page }) => {
  await instrumentMedia(page);
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise((resolve, reject) => {
      window.addEventListener('qa:release-media', () => { void acquire(constraints).then(resolve, reject); }, { once: true });
    });
  });
  await page.goto('/');
  await expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
  await expect(page.getByText('Görüşmeye katılıyorsunuz', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('qa:release-media')));
  await expect.poll(() => page.evaluate(() => window.__callTest.tracks.length > 0 && window.__callTest.tracks.every(t => t.readyState === 'ended'))).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Devam eden görüşme' })).toHaveCount(0);
});

test('cancelling while call configuration is loading immediately releases the microphone', async ({ page }) => {
  await instrumentMedia(page);
  let release: (() => void) | undefined;
  await page.route('**/api/rtc/config', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto('/');
    await expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__callTest.tracks.some(track => track.readyState === 'live'))).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click();
    expect(await page.evaluate(() => window.__callTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { release?.(); }
});

test('archiving an active channel ends microphone, camera, screen and peer connections in both browsers', async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all([browser.newContext({ permissions: ['microphone', 'camera'] }), browser.newContext({ permissions: ['microphone', 'camera'] })]);
  try {
    const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all([instrumentMedia(a), instrumentMedia(b)]);
    await a.goto('/');
    await expect(a.getByRole('button', { name: 'Bir araya gel', exact: true })).toBeVisible();
    await contexts[1].addCookies(await contexts[0].cookies());
    await b.goto('/');
    await Promise.all([a, b].map(page => expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible()));
    const snapshot = await (await a.request.get('/api/auth/me')).json();
    const channelName = (await a.getByRole('textbox', { name: /kanalına mesaj yaz/ }).getAttribute('aria-label'))!.match(/^#(.+) kanalına mesaj yaz$/)![1];
    const channel = snapshot.channels.find((entry: { name: string }) => entry.name === channelName);
    expect(channel).toBeTruthy();
    await a.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await expect(a.getByText('Katılımcılar bekleniyor', { exact: false })).toBeVisible();
    await b.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await Promise.all([waitForConnected(a), waitForConnected(b)]);
    await a.getByRole('button', { name: 'Kamerayı aç', exact: true }).click();
    await a.getByRole('button', { name: 'Ekranı paylaş', exact: true }).click();
    await expect.poll(() => inboundBytes(b, '1')).toBeGreaterThan(0);
    await expect.poll(() => inboundBytes(b, '2')).toBeGreaterThan(0);
    const archive = await a.request.patch(`/api/admin/workspace/channels/${channel.id}`, { headers: { Origin: new URL(baseURL!).origin }, data: { archived: true } });
    expect(archive.status()).toBe(200);
    for (const page of [a, b]) {
      await expect(page.getByRole('alert')).toContainText('arşivlendi');
      await expect.poll(() => page.evaluate(() => window.__callTest.tracks.length > 0 && window.__callTest.tracks.every(track => track.readyState === 'ended') && window.__callTest.peers.length > 0 && window.__callTest.peers.every(peer => peer.connectionState === 'closed'))).toBe(true);
      await expect(page.getByRole('button', { name: 'Yeniden katıl', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Mikrofonu kapat', exact: true })).toHaveCount(0);
      await page.getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click();
      await expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible();
      expect((await page.request.get(`/api/channels/${channel.id}/messages`)).status()).toBe(200);
    }
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
