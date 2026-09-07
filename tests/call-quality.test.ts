import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sampleConnectionQuality,
  type PacketSample,
} from "../src/lib/callQuality.js";

function report(...values: Record<string, unknown>[]): RTCStatsReport {
  return new Map(
    values.map((value, index) => [String(value.id ?? index), value]),
  ) as unknown as RTCStatsReport;
}
test("call quality reports unknown until actual statistics arrive", () => {
  const value = sampleConnectionQuality(report(), new Map());
  assert.deepEqual(value, {
    level: "unknown",
    rttMs: null,
    jitterMs: null,
    packetLossPercent: null,
  });
});
test("call quality uses interval packet loss and worst active audio link, excluding camera", () => {
  const history = new Map<string, PacketSample>();
  sampleConnectionQuality(
    report({
      id: "audio",
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: 9000,
      packetsLost: 1000,
    }),
    history,
  );
  const value = sampleConnectionQuality(
    report(
      {
        id: "pair",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 0.125,
      },
      {
        id: "audio",
        type: "inbound-rtp",
        kind: "audio",
        packetsReceived: 9190,
        packetsLost: 1010,
        jitter: 0.033,
      },
      {
        id: "camera",
        type: "inbound-rtp",
        kind: "video",
        packetsReceived: 1,
        packetsLost: 9999,
        jitter: 10,
      },
    ),
    history,
  );
  assert.deepEqual(value, {
    level: "fair",
    rttMs: 125,
    jitterMs: 33,
    packetLossPercent: 5,
  });
  const poor = sampleConnectionQuality(
    report({
      id: "pair",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      currentRoundTripTime: 0.6,
    }),
    history,
  );
  assert.equal(poor.level, "poor");
  assert.equal(history.size, 0, "removed RTP streams release their samples");
});
test("packet counter restarts and corrected negative loss do not fabricate loss", () => {
  const history = new Map<string, PacketSample>([
    ["audio", { received: 100, lost: 3 }],
  ]);
  const reset = sampleConnectionQuality(
    report({
      id: "audio",
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: 1,
      packetsLost: 0,
    }),
    history,
  );
  assert.equal(reset.packetLossPercent, null);
  const recovered = sampleConnectionQuality(
    report({
      id: "audio",
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: 101,
      packetsLost: -2,
    }),
    history,
  );
  assert.equal(recovered.packetLossPercent, 0);
});
