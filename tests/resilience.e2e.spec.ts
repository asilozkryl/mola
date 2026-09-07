import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const forceRelay = process.env.MOLA_TEST_FORCE_RELAY === 'true';

declare global {
  interface Window {
    __resilience: { peers: RTCPeerConnection[]; tracks: MediaStreamTrack[]; sockets: WebSocket[]; screen: MediaStreamTrack | null; iceErrors: { code: number; text: string; url: string }[] };
  }
}
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(forceRelay ? ['--allow-loopback-in-peer-connection'] : [])] } });

async function instrument(page: Page) {
  await page.addInitScript(({ forceRelay }) => {
    window.__resilience = { peers: [], tracks: [], sockets: [], screen: null, iceErrors: [] };
    const OriginalPeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalPeer {
      constructor(config?: RTCConfiguration) {
        super({ ...config, ...(forceRelay ? { iceTransportPolicy: 'relay' as const } : {}) }); window.__resilience.peers.push(this);
        this.addEventListener('icecandidateerror', event => window.__resilience.iceErrors.push({ code: event.errorCode, text: event.errorText, url: event.url }));
      }
    };
    const OriginalSocket = window.WebSocket;
    window.WebSocket = class extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); window.__resilience.sockets.push(this); }
    };
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints); window.__resilience.tracks.push(...stream.getTracks()); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const drawing = canvas.getContext('2d')!; let frame = 0;
      const draw = () => { drawing.fillStyle = '#153d36'; drawing.fillRect(0, 0, 640, 360); drawing.fillStyle = '#c0e1ad'; drawing.fillRect(frame++ * 8 % 580, 70, 60, 100); };
      draw(); const timer = setInterval(draw, 66);
      const stream = canvas.captureStream(15); const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => clearInterval(timer));
      window.__resilience.tracks.push(track); window.__resilience.screen = track;
      return stream;
    };
  }, { forceRelay });
}
const connected = (page: Page, count: number) => expect.poll(() => page.evaluate(() => window.__resilience.peers.filter(peer => peer.connectionState === 'connected').length), { timeout: 30000 }).toBe(count);
const allMediaStopped = (page: Page) => page.evaluate(() => window.__resilience.tracks.every(track => track.readyState === 'ended') && window.__resilience.peers.every(peer => peer.connectionState === 'closed'));

test('six distinct members sustain a full mesh, enforce capacity, and recover after leave and transport loss', async ({ browser, baseURL }) => {
  test.setTimeout(150000);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const origin = new URL(baseURL!).origin;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const started = Date.now();
  let inviteToken = '';
  try {
    for (let index = 0; index < 7; index++) {
      const context = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 1100, height: 850 } });
      contexts.push(context);
      const registration = await context.request.post(`${origin}/api/auth/register`, {
        headers: { Origin: origin },
        data: { name: `Medya Üyesi ${index + 1}`, email: `media-${index}-${suffix}@example.invalid`, password: 'resilience-test-password-strong', ...(index ? { inviteToken } : { workspaceName: 'Bağımsız Medya Testi' }) },
      });
      expect(registration.ok(), await registration.text()).toBe(true);
      if (!index) {
        const invitation = await context.request.post(`${origin}/api/invites`, { headers: { Origin: origin } });
        expect(invitation.status()).toBe(201);
        inviteToken = new URL((await invitation.json()).url).searchParams.get('invite')!;
      }
      const page = await context.newPage(); pages.push(page);
      await instrument(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.getByText('Her şey güncel', { exact: true })).toBeAttached();
      await expect(page.getByRole('button', { name: 'Bir araya gel', exact: true })).toBeVisible();
    }
    const members = pages.slice(0, 6);
    await Promise.all(members.map(page => page.getByRole('button', { name: 'Bir araya gel', exact: true }).click()));
    await Promise.all(members.map(page => connected(page, 5)));
    // Six clients hold thirty RTCPeerConnection endpoints: fifteen bidirectional pairs.
    expect((await Promise.all(members.map(page => page.evaluate(() => window.__resilience.peers.length)))).reduce((sum, count) => sum + count, 0)).toBe(30);
    await Promise.all(members.map(page => expect.poll(() => page.evaluate(async () => {
      const peers = window.__resilience.peers.filter(peer => peer.connectionState === 'connected');
      const received = await Promise.all(peers.map(async peer => { const stats = await peer.getStats(); let audio = 0; stats.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.kind === 'audio') audio += stat.bytesReceived || 0; }); return audio > 0; }));
      return received.length === 5 && received.every(Boolean);
    }), { timeout: 15000 }).toBe(true)));
    const transports = await Promise.all(members.map((page, member) => page.evaluate(async memberIndex => {
      const paths = await Promise.all(window.__resilience.peers.map(async peer => {
        const stats = await peer.getStats();
        let pair: RTCStats | undefined;
        stats.forEach(stat => { if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = stats.get(stat.selectedCandidatePairId); });
        if (!pair) stats.forEach(stat => { if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) pair = stat; });
        const candidate = pair as RTCStats & { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number; bytesSent?: number; bytesReceived?: number } | undefined;
        return { localType: candidate?.localCandidateId ? stats.get(candidate.localCandidateId)?.candidateType : null, remoteType: candidate?.remoteCandidateId ? stats.get(candidate.remoteCandidateId)?.candidateType : null, roundTripMs: Math.round((candidate?.currentRoundTripTime || 0) * 100000) / 100, bytesSent: candidate?.bytesSent || 0, bytesReceived: candidate?.bytesReceived || 0 };
      }));
      return { member: memberIndex + 1, endpoints: paths };
    }, member)));
    expect(transports.every(member => member.endpoints.length === 5 && member.endpoints.every(endpoint => endpoint.localType && endpoint.remoteType))).toBe(true);
    if (forceRelay) expect(transports.every(member => member.endpoints.every(endpoint => endpoint.localType === 'relay' && endpoint.remoteType === 'relay'))).toBe(true);
    await pages[6].getByRole('button', { name: 'Bir araya gel', exact: true }).click();
    await expect(pages[6].getByRole('alert')).toContainText('görüşme dolu');
    expect(await allMediaStopped(pages[6])).toBe(true);
    await pages[6].getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click();

    const presenter = members[0];
    await presenter.getByRole('button', { name: 'Kamerayı aç', exact: true }).click();
    await presenter.getByRole('button', { name: 'Ekranı paylaş', exact: true }).click();
    await Promise.all(members.slice(1).map(page => expect.poll(() => page.evaluate(async () => {
      const states = await Promise.all(window.__resilience.peers.map(async peer => {
        let camera = 0; let screen = 0; const stats = await peer.getStats();
        stats.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.mid === '1') camera += stat.framesDecoded || 0; if (stat.type === 'inbound-rtp' && stat.mid === '2') screen += stat.framesDecoded || 0; });
        return camera > 0 && screen > 0;
      })); return states.some(Boolean);
    }), { timeout: 20000 }).toBe(true)));
    await presenter.evaluate(() => { const track = window.__resilience.screen!; track.stop(); track.dispatchEvent(new Event('ended')); });
    await Promise.all(members.map(page => expect(page.locator('.call-share-stage')).toHaveCount(0)));
    await Promise.all(members.slice(1).map(page => expect(page.locator('.call-person-camera video')).toBeVisible()));

    const returning = members[5];
    for (let cycle = 0; cycle < 3; cycle++) {
      await returning.getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
      expect(await allMediaStopped(returning)).toBe(true);
      await Promise.all(members.slice(0, 5).map(page => connected(page, 4)));
      await returning.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
      await Promise.all(members.map(page => connected(page, 5)));
    }

    await contexts[5].setOffline(true);
    await returning.evaluate(() => window.__resilience.sockets.filter(socket => socket.url.includes('/socket.io/')).forEach(socket => socket.close()));
    await expect(returning.getByRole('alert')).toContainText('Sunucu bağlantısı kesildi');
    const retry = returning.getByRole('button', { name: 'Yeniden katıl', exact: true });
    await expect(retry).toBeDisabled();
    expect(await allMediaStopped(returning)).toBe(true);
    await Promise.all(members.slice(0, 5).map(page => connected(page, 4)));
    await contexts[5].setOffline(false);
    await expect(returning.getByText('Her şey güncel', { exact: true })).toBeAttached({ timeout: 20000 });
    await expect(retry).toBeEnabled();
    await retry.click();
    await Promise.all(members.map(page => connected(page, 5)));
    await Promise.all(members.map(page => page.getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click()));
    for (const page of members) expect(await allMediaStopped(page)).toBe(true);
    expect(errors).toEqual([]);
    const report = { generatedAt: new Date().toISOString(), passed: true, forceRelay, members: 6, independentBrowserContexts: 7, connectedEndpoints: 30, bidirectionalPeerPairs: 15, elapsedSeconds: (Date.now() - started) / 1000, repeatedLeaveJoinCycles: 3, verified: ['audio RTP from all five peers at every member', 'camera and screen decoded by five peers simultaneously', 'seventh member rejected and microphone released', 'browser screen-ended preserves camera', 'offline transport cleanup and online rejoin', 'all media and peer connections closed at completion'], transports, inputDevices: 'Chromium fake microphone/camera and moving canvas screen source', network: 'one local machine; production HTTPS/WAN and physical-device behavior require separate acceptance' };
    await mkdir('artifacts', { recursive: true });
    await writeFile(`artifacts/media-mesh-${forceRelay ? 'relay' : 'direct'}.json`, JSON.stringify(report, null, 2));
    await test.info().attach('mesh-resilience', { body: JSON.stringify(report), contentType: 'application/json' });
  } catch (error) {
    const diagnostics = await Promise.all(pages.map(page => page.evaluate(async () => ({ iceErrors: window.__resilience.iceErrors, peers: await Promise.all(window.__resilience.peers.map(async peer => { const stats = await peer.getStats(); const candidateTypes: string[] = []; stats.forEach(stat => { if (stat.type === 'local-candidate') candidateTypes.push(stat.candidateType); }); return { state: peer.connectionState, ice: peer.iceConnectionState, gathering: peer.iceGatheringState, candidateTypes }; })) })).catch(() => ({ unavailable: true }))));
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/media-mesh-failure.json', JSON.stringify(diagnostics, null, 2));
    await test.info().attach('media-failure-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
