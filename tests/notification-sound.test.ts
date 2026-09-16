import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  playMolaNotificationSound,
  stopMolaNotificationSound,
} from "../src/lib/notificationSound";

test("Mola chime is reproducible PCM with a short duration, headroom, and soft edges", () => {
  const sound = readFileSync(
    new URL("../public/sounds/mola.wav", import.meta.url),
  );
  assert.equal(sound.toString("ascii", 0, 4), "RIFF");
  assert.equal(sound.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(sound.readUInt32LE(4), sound.length - 8);
  assert.equal(sound.readUInt16LE(20), 1);
  assert.equal(sound.readUInt16LE(22), 1);
  assert.equal(sound.readUInt16LE(34), 16);
  assert.equal(sound.toString("ascii", 36, 40), "data");
  const sampleRate = sound.readUInt32LE(24);
  assert.equal(sampleRate, 48_000);
  assert.equal(sound.readUInt32LE(28), sampleRate * 2);
  assert.equal(sound.readUInt16LE(32), 2);
  assert.equal(sound.readUInt32LE(40), sound.length - 44);
  const samples = Array.from(
    { length: (sound.length - 44) / 2 },
    (_, index) => sound.readInt16LE(44 + index * 2) / 32767,
  );
  assert.equal(samples.length / sampleRate, 0.74);
  const peak = Math.max(...samples.map(Math.abs));
  assert.ok(
    peak > 0.25 && peak <= 0.321,
    `peak ${peak} has no clipping and useful headroom`,
  );
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 0);
  assert.ok(
    Math.max(...samples.slice(0, 48).map(Math.abs)) < 0.003,
    "first millisecond fades in",
  );
  assert.ok(
    samples.slice(-480).every((sample) => sample === 0),
    "tail ends in silence",
  );
  const rms = (values: number[]) =>
    Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0) / values.length,
    );
  assert.ok(
    rms(samples.slice(-4800)) < rms(samples.slice(9600, 14400)) * 0.03,
    "tail fades well below the main tone",
  );
  execFileSync(process.execPath, [
    new URL("../scripts/generate-notification-sound.mjs", import.meta.url)
      .pathname,
    "--check",
  ]);
});

class FakeAudio extends EventTarget {
  static created: FakeAudio[] = [];
  static nextPlay: () => Promise<void> = () => Promise.resolve();
  preload = "";
  volume = 1;
  paused = false;
  unloaded = false;
  constructor(public src: string) {
    super();
    FakeAudio.created.push(this);
  }
  play() {
    return FakeAudio.nextPlay();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {
    this.unloaded = true;
  }
}

function useFakeAudio(t: { after: (fn: () => void) => void }) {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: FakeAudio,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://mola.example" } },
  });
  FakeAudio.created = [];
  FakeAudio.nextPlay = () => Promise.resolve();
  t.after(() => {
    stopMolaNotificationSound();
    if (originalAudio)
      Object.defineProperty(globalThis, "Audio", originalAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
}

test("notification bursts share one same-origin sound and release it when ended", async (t) => {
  useFakeAudio(t);
  const first = playMolaNotificationSound();
  const second = playMolaNotificationSound();
  assert.equal(first, second);
  assert.equal(FakeAudio.created.length, 1);
  const audio = FakeAudio.created[0];
  assert.equal(audio.src, "https://mola.example/sounds/mola.wav");
  assert.equal(audio.volume, 0.72);
  audio.dispatchEvent(new Event("ended"));
  await first;
  assert.equal(audio.paused, true);
  assert.equal(audio.unloaded, true);
  const next = playMolaNotificationSound();
  assert.equal(FakeAudio.created.length, 2);
  stopMolaNotificationSound();
  await next;
});

test("autoplay and asset errors reach the caller and permit retry", async (t) => {
  useFakeAudio(t);
  const denied = new DOMException("Permission denied", "NotAllowedError");
  FakeAudio.nextPlay = () => Promise.reject(denied);
  await assert.rejects(
    playMolaNotificationSound(),
    (error) => error === denied,
  );
  FakeAudio.nextPlay = () => Promise.resolve();
  const retry = playMolaNotificationSound();
  const expected = assert.rejects(retry, /yüklenemedi/);
  FakeAudio.created.at(-1)!.dispatchEvent(new Event("error"));
  await expected;
});

test("stopping during pending playback settles callers and cannot stop a later chime", async (t) => {
  useFakeAudio(t);
  let rejectFirst!: (error: Error) => void;
  FakeAudio.nextPlay = () =>
    new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
  const first = playMolaNotificationSound();
  const firstAudio = FakeAudio.created[0];
  stopMolaNotificationSound();
  await first;
  assert.equal(firstAudio.paused, true);
  FakeAudio.nextPlay = () => Promise.resolve();
  const second = playMolaNotificationSound();
  rejectFirst(new DOMException("Playback cancelled", "AbortError"));
  await Promise.resolve();
  assert.equal(FakeAudio.created[1].paused, false);
  assert.equal(playMolaNotificationSound(), second);
  stopMolaNotificationSound();
  await second;
});
