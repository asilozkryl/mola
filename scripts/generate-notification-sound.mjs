import { readFileSync, writeFileSync } from "node:fs";

// Original Mola motif: two soft sine-based notes, G5 followed by D6.
// No recordings, external samples, random noise, or runtime dependencies.
const sampleRate = 48_000;
const duration = 0.74;
const sampleCount = Math.round(sampleRate * duration);
const samples = new Float64Array(sampleCount);
const notes = [
  { start: 0, duration: 0.49, frequency: 783.9908719634985, gain: 0.9 },
  { start: 0.17, duration: 0.54, frequency: 1174.6590716696303, gain: 1 },
];

for (let index = 0; index < sampleCount; index++) {
  const time = index / sampleRate;
  for (const note of notes) {
    const elapsed = time - note.start;
    if (elapsed < 0 || elapsed >= note.duration) continue;
    const attack = Math.sin((Math.PI / 2) * Math.min(elapsed / 0.018, 1)) ** 2;
    const release =
      Math.sin(
        (Math.PI / 2) * Math.min((note.duration - elapsed) / 0.085, 1),
      ) ** 2;
    const envelope =
      attack * release * Math.exp((-4.7 * elapsed) / note.duration);
    const phase = 2 * Math.PI * note.frequency * elapsed;
    const tone = Math.sin(phase) + 0.045 * Math.sin(2 * phase);
    samples[index] += note.gain * envelope * tone;
  }
}

let peak = 0;
for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // Mono
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(sampleCount * 2, 40);
for (let index = 0; index < sampleCount; index++) {
  wav.writeInt16LE(
    Math.round((samples[index] / peak) * 0.32 * 32767),
    44 + index * 2,
  );
}

const destination = new URL("../public/sounds/mola.wav", import.meta.url);
if (process.argv.includes("--check")) {
  if (!readFileSync(destination).equals(wav)) {
    throw new Error(
      "The notification sound differs from its deterministic generator.",
    );
  }
  console.log("Mola notification sound matches its generator.");
} else {
  writeFileSync(destination, wav);
  console.log(
    `Generated ${sampleCount / sampleRate}s Mola notification sound (${wav.length} bytes).`,
  );
}
