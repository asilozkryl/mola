# macOS installation inside Mola (1.0.8)

The existing updater downloads packages inside Mola, but macOS 1.0.7 finishes with a manual DMG installation. This follow-up replaces that last step with a prepared whole-bundle replacement and LaunchServices restart. Clients before 1.0.8 require one installer upgrade to acquire this implementation.

## Implementation

- [x] Use the fixed native updates entry from Settings, Help and the desktop download page; explain the legacy bootstrap requirement.
- [x] Keep release selection, checksums, network allowlists and privileged IPC in the main process.
- [x] Copy the verified disk image into private staging beside the installed app. Mount read-only, copy Mola.app, validate signature, bundle identity, both versions and architecture; retain quarantine.
- [x] Derive all installation paths from the current process, reject redirected/translocated or unwritable installations, and leave Mola running on preparation errors.
- [x] Publish a complete commit file atomically only after the packaged helper reports readiness.
- [ ] Validate the native helper's whole-bundle swap, LaunchServices reopening, timeout and identity-safe rollback on both Mac architectures.
- [ ] Verify signed ZIP and DMG artifacts include the packaged helper and the local updater capability.
- [ ] Publish 1.0.8 after platform builds and checksums pass; verify the public release feed.

## Boundaries

The helper keeps the previous bundle as a recovery copy. A restart request is not presented as completed installation. Gatekeeper and App Management remain active; ad-hoc releases may still require macOS approval, and this work does not claim Developer ID/notarization. Windows NSIS and Linux DEB retain their system installer; AppImage retains replacement and restart. No renderer supplies an executable URL, installer path, or command.

## Verification so far

The previous manual Mac path failed all six new Node staging regressions before implementation. The changed implementation passes these preparation/failure tests. The initial full desktop suite passes 65 unit tests and 19 Electron smoke tests. Native macOS evidence is pending the CI run; Linux mocks do not establish Mac installation behavior.
