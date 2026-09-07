/** Analyses an existing capture; never requests permission or retains media tracks. */
export function monitorAudio(
  streams: { id: string; stream: MediaStream }[],
  onSample: (levels: Record<string, number>) => void,
): () => void {
  if (typeof AudioContext === "undefined" || !streams.length) {
    onSample({});
    return () => {};
  }
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    onSample({});
    return () => {};
  }
  const silent = context.createGain();
  silent.gain.value = 0;
  silent.connect(context.destination);
  const meters = streams
    .filter(({ stream }) => stream.getAudioTracks().length)
    .map(({ id, stream }) => {
      const source = context.createMediaStreamSource(
        new MediaStream(stream.getAudioTracks()),
      );
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(silent);
      return { id, stream, source, analyser, samples: new Float32Array(512) };
    });
  const resume = () => {
    if (context.state === "suspended") void context.resume().catch(() => {});
  };
  resume();
  document.addEventListener("pointerdown", resume);
  document.addEventListener("keydown", resume);
  const timer = window.setInterval(() => {
    const levels: Record<string, number> = {};
    for (const meter of meters) {
      meter.analyser.getFloatTimeDomainData(meter.samples);
      const live = meter.stream
        .getAudioTracks()
        .some(
          (track) =>
            track.enabled && !track.muted && track.readyState === "live",
        );
      levels[meter.id] =
        live && context.state === "running"
          ? Math.sqrt(
              meter.samples.reduce((sum, value) => sum + value * value, 0) /
                meter.samples.length,
            )
          : 0;
    }
    onSample(levels);
  }, 100);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("pointerdown", resume);
    document.removeEventListener("keydown", resume);
    for (const meter of meters) {
      meter.source.disconnect();
      meter.analyser.disconnect();
    }
    silent.disconnect();
    void context.close().catch(() => {});
  };
}
