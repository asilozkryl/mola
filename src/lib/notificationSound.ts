const SOUND_PATH = "/sounds/mola.wav";
const SOUND_VOLUME = 0.72;
const PLAYBACK_TIMEOUT_MS = 10_000;

let activePlayback: {
  completion: Promise<void>;
  stop: () => void;
} | null = null;

/** Coalesces a burst of notifications into one chime. Resolves on end or stop. */
export function playMolaNotificationSound(): Promise<void> {
  if (activePlayback) return activePlayback.completion;
  if (typeof Audio === "undefined" || typeof window === "undefined") {
    return Promise.reject(
      new Error("Bu cihazda bildirim sesi desteklenmiyor."),
    );
  }

  // An absolute same-origin URL cannot be redirected by an HTML <base> element.
  const audio = new Audio(new URL(SOUND_PATH, window.location.origin).href);
  audio.preload = "auto";
  audio.volume = SOUND_VOLUME;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const completion = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  let finished = false;
  const finish = (error?: unknown) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (activePlayback?.completion === completion) activePlayback = null;
    if (error) reject(error);
    else resolve();
  };
  const onEnded = () => finish();
  const onError = () =>
    finish(new Error("Bildirim sesi yüklenemedi. Lütfen yeniden dene."));
  const timeout = setTimeout(
    () =>
      finish(
        new Error(
          "Bildirim sesi zamanında başlatılamadı. Lütfen yeniden dene.",
        ),
      ),
    PLAYBACK_TIMEOUT_MS,
  );
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);
  activePlayback = { completion, stop: () => finish() };
  try {
    void audio.play().catch(finish);
  } catch (error) {
    finish(error);
  }
  return completion;
}

/** Stops sound immediately, releases the media resource, and settles callers. */
export function stopMolaNotificationSound(): void {
  activePlayback?.stop();
}
