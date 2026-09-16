# Mola notification sound

`mola.wav` is an original, synthesized two-note Mola notification chime (G5 → D6).
It contains no third-party recordings or samples. It was created for this
repository using `scripts/generate-notification-sound.mjs`.

The file is mono, 48 kHz, 16-bit PCM WAV, 0.74 seconds long, with an 18 ms soft
attack and an 85 ms fade-out per note. Its peak is limited to 32% of full scale;
the player also uses 72% volume to keep notifications gentle.

Regenerate from the repository root:

```sh
node scripts/generate-notification-sound.mjs
```

Verify that the checked-in sound is reproducible without modifying it:

```sh
node scripts/generate-notification-sound.mjs --check
```
