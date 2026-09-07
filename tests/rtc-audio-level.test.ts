import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiverAudioLevel, sampleAudioStats } from '../src/lib/rtcAudioLevel.js';

test('receiver audio levels distinguish real silence from unsupported measurement', () => {
  assert.equal(receiverAudioLevel(undefined, 1000), null);
  assert.equal(receiverAudioLevel([], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 950 }], 1000), null);
  assert.equal(receiverAudioLevel([{ timestamp: 950, audioLevel: 0 }], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 950, audioLevel: .3 }], 1000), .3);
  assert.equal(receiverAudioLevel([{ timestamp: 1_788_809_111_093, audioLevel: .3 }], 4040.3, 1_788_809_107_072.6), .3);
  assert.equal(receiverAudioLevel([{ timestamp: 950, audioLevel: .3 }], 1000, 1_788_809_107_072.6), .3);
  assert.equal(receiverAudioLevel([{ timestamp: 1001, audioLevel: .3 }], 1000), .3);
});

const report = (...values: Record<string, unknown>[]) => new Map(values.map(value => [value.id, value])) as unknown as RTCStatsReport;
test('audio stats reject a stalled stream even when its report timestamp advances', () => {
  const previous = new Map<string, number>();
  const stat = { id: 'inbound', type: 'inbound-rtp', kind: 'audio', audioLevel: .4, packetsReceived: 5, timestamp: 1000 };
  assert.equal(sampleAudioStats(report(stat), 'remote', undefined, previous, 1000, 0), .4);
  assert.equal(sampleAudioStats(report({ ...stat, timestamp: 1400 }), 'remote', undefined, previous, 1400, 0), 0);
  assert.equal(sampleAudioStats(report({ ...stat, packetsReceived: 6, timestamp: 1800 }), 'remote', undefined, previous, 1800, 0), .4);
});
test('local audio stats select the current microphone and require sample progress', () => {
  const previous = new Map<string, number>();
  const current = { id: 'current', type: 'media-source', kind: 'audio', trackIdentifier: 'microphone', audioLevel: .2, totalSamplesDuration: 1, timestamp: 1000 };
  const old = { ...current, id: 'old', trackIdentifier: 'old-microphone', audioLevel: .9 };
  assert.equal(sampleAudioStats(report(old, current), 'local', 'microphone', previous, 1000, 0), .2);
  assert.equal(sampleAudioStats(report({ ...current, timestamp: 1400 }), 'local', 'microphone', previous, 1400, 0), 0);
  assert.equal(sampleAudioStats(report(old), 'local', 'microphone', previous, 1400, 0), null);
});
test('missing native audio measurements or progress counters use the analyser fallback', () => {
  const base = { id: 'inbound', type: 'inbound-rtp', kind: 'audio', timestamp: 1000 };
  assert.equal(sampleAudioStats(report(base), 'remote', undefined, new Map(), 1000, 0), null);
  assert.equal(sampleAudioStats(report({ ...base, audioLevel: .2 }), 'remote', undefined, new Map(), 1000, 0), null);
  assert.equal(sampleAudioStats(report({ ...base, audioLevel: 0, packetsReceived: 5 }), 'remote', undefined, new Map(), 1000, 0), 0);
});
test('stale or invalid synchronization sources cannot keep speech active', () => {
  assert.equal(receiverAudioLevel([{ timestamp: 100, audioLevel: .8 }], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 1100, audioLevel: .8 }], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 1_788_809_110_000, audioLevel: .8 }], 4040.3, 1_788_809_107_072.6), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 990, audioLevel: Number.NaN }], 1000), null);
  assert.equal(receiverAudioLevel([{ timestamp: 990, audioLevel: -.2 }, { timestamp: 990, audioLevel: .4 }], 1000), .4);
});
