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
  // getSynchronizationSources retains entries for ten seconds. Old packets must
  // not make a departed or stalled sender appear to keep speaking.
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
