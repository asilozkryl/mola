import type { ConnectionQuality } from "../../shared/call-types";

export type PacketSample = { received: number; lost: number };
export const unknownQuality = (): ConnectionQuality => ({
  level: "unknown",
  rttMs: null,
  jitterMs: null,
  packetLossPercent: null,
});

export function sampleConnectionQuality(
  report: RTCStatsReport,
  previous: Map<string, PacketSample>,
): ConnectionQuality {
  const quality = unknownQuality();
  let received = 0,
    lost = 0,
    measuredPackets = false;
  const active = new Set<string>();
  report.forEach((stat) => {
    if (
      stat.type === "candidate-pair" &&
      stat.state === "succeeded" &&
      (stat.nominated || stat.selected) &&
      Number.isFinite(stat.currentRoundTripTime)
    ) {
      quality.rttMs = Math.max(
        quality.rttMs ?? 0,
        stat.currentRoundTripTime * 1000,
      );
    }
    if (stat.type !== "inbound-rtp" || stat.isRemote || stat.kind !== "audio")
      return;
    if (Number.isFinite(stat.jitter))
      quality.jitterMs = Math.max(quality.jitterMs ?? 0, stat.jitter * 1000);
    if (
      !Number.isFinite(stat.packetsReceived) ||
      !Number.isFinite(stat.packetsLost)
    )
      return;
    active.add(stat.id);
    const sample = {
      received: stat.packetsReceived as number,
      lost: stat.packetsLost as number,
    };
    const before = previous.get(stat.id);
    previous.set(stat.id, sample);
    if (!before || sample.received < before.received) return;
    received += Math.max(0, sample.received - before.received);
    lost += Math.max(0, sample.lost - before.lost);
    measuredPackets = true;
  });
  for (const id of previous.keys()) if (!active.has(id)) previous.delete(id);
  if (measuredPackets && received + lost > 0)
    quality.packetLossPercent = (100 * lost) / (received + lost);
  const { rttMs: rtt, jitterMs: jitter, packetLossPercent: loss } = quality;
  if (rtt === null && jitter === null && loss === null) return quality;
  quality.level =
    (rtt ?? 0) > 500 || (jitter ?? 0) > 50 || (loss ?? 0) > 5
      ? "poor"
      : (rtt ?? 0) > 200 || (jitter ?? 0) > 30 || (loss ?? 0) > 2
        ? "fair"
        : "good";
  return quality;
}
