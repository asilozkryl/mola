# Desktop updates

The desktop application checks for stable Mola releases and offers a native window to download, verify, and start installation. The user starts both download and installation. Checking and downloading leave conversations and calls running; installation has a separate native confirmation describing the interruption.

Only the fixed `asilozkryl/mola` GitHub repository is an executable source. The main process selects a strictly newer stable numeric version and the native platform/architecture, verifies the complete release and SHA256SUMS, downloads to private staging, and verifies again before installation. Remote workspace content cannot supply URLs, paths, or commands. It may only open the packaged updates window through a fixed marker. Local IPC requires that exact window, main frame, and packaged page.

macOS opens the verified DMG with quarantine metadata retained. Without Developer ID, the user completes replacement in Applications. Windows opens the verified NSIS installer with Internet-zone metadata. Installed Linux DEB opens the system package installer. AppImage stages a verified replacement beside the current file, retains a backup, atomically replaces it, and schedules relaunch after quitting. Failures preserve the running app and report a retryable error; downloaded bytes alone never mean installation succeeded.

The native Mola menu and desktop notification settings provide an entry point. Packaged applications check shortly after launch and every six hours; a new version updates the menu and may show one silent system notification per process. No automatic download, restart, or OS trust bypass is introduced. Version 1.0.6 bootstraps the updater and must itself be installed once using the existing installer.

Validation covers hostile or corrupt release metadata, downgrade prevention, cancellation, partial/tampered files, filesystem boundaries, explicit installation, native IPC isolation, accessible stateful UI, native quarantine/Internet-zone metadata, AppImage rollback, and the existing actual Mac ZIP/DMG launch checks.
