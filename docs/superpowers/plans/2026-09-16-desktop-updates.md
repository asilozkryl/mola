# Desktop Updates Implementation Plan

**Goal:** Check for, download, verify, and initiate desktop updates from Mola.

**Architecture:** A main-process updater owns fixed-source networking and verified files. A sandboxed packaged window offers bounded actions; platform helpers hand off installers or replace a writable AppImage. The remote app only opens that window through a fixed marker.

**Tech Stack:** Electron 44.3, Node 24, existing GitHub installers and SHA256SUMS, native HTML/CSS/JS, React settings, Node tests and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-desktop-updates-design.md`

## Global constraints

- Preserve remote renderer isolation, live calls during checks/downloads, and OS trust checks.
- No Developer ID currently exists: macOS finishes through DMG and Applications.
- No updater URL/path/command arguments from renderers; no elevated shell commands.
- Keep published versions immutable; release 1.0.7 after required verification.

## Tasks

- [x] Implement `desktop/updater.cjs` and regression tests: stable version/platform selection, canonical release assets, bounded transport, SHA256, staging, cancel/retry and revalidation before injected installation.
- [x] Implement `desktop/update-installers.cjs` and tests: native installer metadata/handoff, AppImage atomic replacement, backup and rollback, never quit on failed handoff.
- [x] Implement packaged `desktop/ui/updates.html`, `updates.js`, `updates.css` and state-transition/accessibility tests using the fixed bridge contract.
- [x] Add `desktop/update-window.cjs`, exact-sender IPC, native menu/background checks, and a fixed window-opening marker; cover confirmation and untrusted sender rejection before implementation.
- [x] Add the settings entry using explicit native capability/version in user agent; older clients retain a one-time installer link. Preserve browser/mobile behavior.
- [x] Run focused unit and real Electron tests; native package jobs also verify OS metadata. Build web and inspect native UI at narrow/wide sizes.
- [x] Document platform-specific final steps, bump package/lock/release notes, commit/push, and publish after all native artifact checks. Verify live frontend and the M3 bootstrap link.

## Verification record

Released as [Mola Desktop 1.0.7](https://github.com/asilozkryl/mola/releases/tag/desktop-v1.0.7) at commit `6c644b7cd70c316f62486c9395f7b2b0488991d4`. [Desktop CI](https://github.com/asilozkryl/mola/actions/runs/35101035959) passed all four native builds, OS metadata tests, complete installer checksums, and the Mac ZIP/DMG signature, launch, and updater-window checks.

Local validation passed 56 unit tests (the native Mac metadata check runs on Mac CI), 18 real Electron smoke tests, 2 real Mola API/notification integration tests, and 4 desktop settings browser tests. Native updater UI passed four state/viewport accessibility checks. A clean dependency install verified one Electron preparation before parallel workers.

The live frontend includes the settings entry. Production updater code using installed version 1.0.5 discovered and verified the public 1.0.7 arm64 DMG. Its direct download returned HTTP 200 with the expected 127115349 bytes. The AppImage restart check used an isolated copy in extraction mode; native FUSE startup was not available on the local host.
