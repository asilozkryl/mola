/** null means this receiver needs the Web Audio fallback; zero means silence. */
export function receiverAudioLevel(
  sources: readonly { audioLevel?: number; timestamp: number }[] | undefined,
  now: number,
  timeOrigin = 0,
): number | null {
  if (!sources) return null;
  if (!sources.length) return 0;
  const measured = sources.filter((source) =>
    Number.isFinite(source.audioLevel),
  );
  if (!measured.length) return null;
  // Old measurements must not make a stalled sender appear to keep speaking.
  return Math.max(
    0,
    ...measured
      .filter((source) => {
        // Chromium reports an epoch timestamp here; other implementations use
        // the performance time origin. Normalize both, allowing clock rounding.
        const timestamp =
          timeOrigin > 0 && source.timestamp >= timeOrigin
            ? source.timestamp - timeOrigin
            : source.timestamp;
        const age = now - timestamp;
        return age >= -20 && age < 500;
      })
      .map((source) => Math.max(0, Math.min(1, source.audioLevel!))),
  );
}

/** Reads a real, advancing audio measurement. Missing support needs an analyser. */
export function sampleAudioStats(
  stats: RTCStatsReport,
  direction: "local" | "remote",
  trackId: string | undefined,
  previous: Map<string, number>,
  now: number,
  timeOrigin: number,
): number | null {
  let result: number | null = null;
  stats.forEach((stat) => {
    if (
      stat.kind !== "audio" ||
      stat.type !== (direction === "local" ? "media-source" : "inbound-rtp")
    )
      return;
    if (direction === "local" && stat.trackIdentifier !== trackId) return;
    const counter =
      direction === "local"
        ? (stat.totalSamplesDuration ?? stat.totalAudioEnergy)
        : (stat.packetsReceived ??
          stat.totalSamplesReceived ??
          stat.totalAudioEnergy);
    if (!Number.isFinite(stat.audioLevel) || !Number.isFinite(counter)) return;
    const key = `${direction}:${stat.id}`;
    const last = previous.get(key);
    previous.set(key, counter);
    // Stats timestamps advance even when RTP has stalled. Packet/sample progress
    // is necessary before reusing an audioLevel that may be the last old value.
    const level =
      last !== undefined && counter <= last
        ? 0
        : receiverAudioLevel([stat], now, timeOrigin);
    if (level !== null) result = Math.max(result ?? 0, level);
  });
  return result;
}
