import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiverAudioLevel } from '../src/lib/rtcAudioLevel.js';

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
test('stale or invalid synchronization sources cannot keep speech active', () => {
  assert.equal(receiverAudioLevel([{ timestamp: 100, audioLevel: .8 }], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 1100, audioLevel: .8 }], 1000), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 1_788_809_110_000, audioLevel: .8 }], 4040.3, 1_788_809_107_072.6), 0);
  assert.equal(receiverAudioLevel([{ timestamp: 990, audioLevel: Number.NaN }], 1000), null);
  assert.equal(receiverAudioLevel([{ timestamp: 990, audioLevel: -.2 }, { timestamp: 990, audioLevel: .4 }], 1000), .4);
});
