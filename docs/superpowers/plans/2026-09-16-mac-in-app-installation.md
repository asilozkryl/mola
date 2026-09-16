# macOS installation inside Mola (1.0.8)

The existing updater downloads packages inside Mola, but macOS 1.0.7 finishes with a manual DMG installation. This follow-up replaces that last step with a prepared whole-bundle replacement and LaunchServices restart. Clients before 1.0.8 require one installer upgrade to acquire this implementation.

## Implementation

- [x] Use the fixed native updates entry from Settings, Help and the desktop download page; explain the legacy bootstrap requirement.
- [x] Keep release selection, checksums, network allowlists and privileged IPC in the main process.
- [x] Copy the verified disk image into private staging beside the installed app. Mount read-only, copy Mola.app, validate signature, bundle identity, both versions and architecture; retain quarantine.
- [x] Derive all installation paths from the current process, reject redirected/translocated or unwritable installations, and leave Mola running on preparation errors.
- [x] Publish a complete commit file atomically only after the packaged helper reports readiness.
- [x] Validate the native helper's whole-bundle swap, LaunchServices reopening, timeout and identity-safe rollback on both Mac architectures.
- [x] Verify signed ZIP and DMG artifacts include the packaged helper and the local updater capability.
- [x] Publish 1.0.8 after platform builds and checksums pass; verify the public release feed.

## Boundaries

The helper keeps the previous bundle as a recovery copy. A restart request is not presented as completed installation. Gatekeeper and App Management remain active; ad-hoc releases may still require macOS approval, and this work does not claim Developer ID/notarization. Windows NSIS and Linux DEB retain their system installer; AppImage retains replacement and restart. No renderer supplies an executable URL, installer path, or command.

## Verification

The previous manual Mac path failed all six new Node staging regressions before implementation. The changed implementation passes these preparation/failure tests. The initial full desktop suite passes 65 unit tests and 19 Electron smoke tests. The web update-entry/download/notification suites pass 14 browser tests (including 5 update-entry tests independently repeated), and 3 real Electron app/API/notification integration tests pass.

[Native Mac verification](https://github.com/asilozkryl/mola/actions/runs/35111165319) passes all 9 helper scenarios on both Apple Silicon and Intel at `32896317ef53193941ab5e2a0e916e90877f08e5`. Tests prove whole-bundle replacement, old-bundle retention, a real LaunchServices start receipt, signature validity, quarantine-preserving rollback, uncertain/live-launch preservation, and old-version reopening after candidate tampering. The `/private/var` alias regression was reproduced and fixed with POSIX canonicalization.

[The final desktop build](https://github.com/asilozkryl/mola/actions/runs/35111529958) repeats the native tests and verifies both ZIP and DMG packages, the compiled helper's exact architecture/signature, absence of test-only helper code, the packaged `relaunch` capability, and actual DMG preparation through the production Node module. All four platform package checks and the guarded release publication passed. [Mola Desktop 1.0.8](https://github.com/asilozkryl/mola/releases/tag/desktop-v1.0.8) was published with seven installers and SHA256SUMS at the tested commit.

The local fixture LaunchServices test does not claim Gatekeeper approval of an ad-hoc internet download. macOS security and App Management approvals remain operating-system decisions.

The live `/api/desktop/releases` catalog returns version `1.0.8` with `stale: false`. The production updater module, using installed version `1.0.7` and Mac arm64, discovered the public release and downloaded all 127156915 bytes of the DMG to verified `ready` state. The verification cache was removed afterward; no installer ran on the local Linux machine.
