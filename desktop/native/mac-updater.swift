import AppKit
import Darwin
import Foundation

// This helper is compiled into the app before the bundle is signed. It only
// replaces whole bundles; it never changes downloaded code or Gatekeeper data.
private struct UpdateFailure: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

// A pending launch or a live process must not have its bundle swapped out from
// underneath it. Keep the backup until the launch outcome can be established.
private struct LaunchStillRunning: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct Configuration: Decodable {
    let schema: Int
    let parentPid: Int32
    let targetPath: String
    let candidatePath: String
    let currentVersion: String
    let version: String
    let bundleId: String
    let arch: String
    let resultPath: String
    let readyPath: String
    let commitPath: String
}

private struct Identity {
    let device: dev_t
    let inode: ino_t
    let owner: uid_t
    let mode: mode_t
    let size: off_t
    let links: nlink_t

    init(_ path: String) throws {
        var value = stat()
        guard lstat(path, &value) == 0 else {
            throw UpdateFailure(message: "Dosya bilgisi okunamadı: \(String(cString: strerror(errno)))")
        }
        device = value.st_dev
        inode = value.st_ino
        owner = value.st_uid
        mode = value.st_mode
        size = value.st_size
        links = value.st_nlink
    }

    var isDirectory: Bool { mode & mode_t(S_IFMT) == mode_t(S_IFDIR) }
    var isRegular: Bool { mode & mode_t(S_IFMT) == mode_t(S_IFREG) }
    func matches(_ other: Identity) -> Bool { device == other.device && inode == other.inode }
}

private func fail(_ message: String) throws -> Never { throw UpdateFailure(message: message) }
private func url(_ path: String) -> URL { URL(fileURLWithPath: path) }

private func canonicalPath(_ path: String) throws -> String {
    guard path.hasPrefix("/"), !path.utf8.contains(0), path.utf8.count < 4096 else {
        try fail("Güncelleme dosyasının yolu geçersiz.")
    }
    let canonical = url(path).standardizedFileURL.resolvingSymlinksInPath().path
    guard canonical == path else { try fail("Güncelleme yolu sembolik bağlantı veya yönlendirme içeriyor.") }
    return canonical
}

private func versionParts(_ value: String) throws -> [Int] {
    guard value.count <= 48, value.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil else {
        try fail("Güncelleme sürümü geçersiz.")
    }
    let parts = value.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 3 else { try fail("Güncelleme sürümü geçersiz.") }
    return parts
}

private func readPrivateJSON(_ path: String) throws -> Data {
    _ = try canonicalPath(path)
    let identity = try Identity(path)
    guard identity.isRegular, identity.links == 1, identity.owner == getuid(),
          identity.mode & 0o077 == 0, identity.size > 0, identity.size <= 65536 else {
        try fail("Güncelleme talimatı özel ve güvenli bir dosya olmalı.")
    }
    let descriptor = open(path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { try fail("Güncelleme talimatı açılamadı.") }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    var held = stat()
    guard fstat(descriptor, &held) == 0, held.st_dev == identity.device, held.st_ino == identity.inode else {
        try fail("Güncelleme talimatı okunurken değişti.")
    }
    let data = try handle.readToEnd() ?? Data()
    guard data.count > 0, data.count <= 65536 else { try fail("Güncelleme talimatı geçersiz.") }
    return data
}

private func writeJSON(_ object: [String: Any], to path: String) throws {
    let temporary = path + "." + UUID().uuidString + ".tmp"
    defer { try? FileManager.default.removeItem(atPath: temporary) }
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try data.write(to: url(temporary), options: .withoutOverwriting)
    guard chmod(temporary, 0o600) == 0 else { try fail("Güncelleme sonucu kaydedilemedi.") }
    let descriptor = open(temporary, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { try fail("Güncelleme sonucu kaydedilemedi.") }
    defer { close(descriptor) }
    guard fsync(descriptor) == 0, rename(temporary, path) == 0 else {
        try fail("Güncelleme sonucu diske yazılamadı.")
    }
}

private func syncDirectory(_ path: String) throws {
    let descriptor = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard descriptor >= 0 else { try fail("Uygulama klasörü doğrulanamadı.") }
    defer { close(descriptor) }
    guard fsync(descriptor) == 0 else { try fail("Uygulama değişikliği diske yazılamadı.") }
}

private func command(_ executable: String, _ arguments: [String]) throws -> (String, String) {
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = url(executable)
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let deadline = ProcessInfo.processInfo.systemUptime + 30
    while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.02) }
    if process.isRunning {
        process.terminate()
        Thread.sleep(forTimeInterval: 0.1)
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
        try fail("macOS paket doğrulaması zamanında tamamlanamadı.")
    }
    let stdout = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    let stderr = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    guard process.terminationStatus == 0 else {
        try fail("macOS uygulama paketini doğrulayamadı. Mevcut sürüm korunuyor.")
    }
    return (stdout, stderr)
}

private func verifyBundle(_ path: String, version: String, configuration: Configuration) throws {
    _ = try canonicalPath(path)
    guard path.hasSuffix(".app"), try Identity(path).isDirectory else { try fail("Geçerli bir Mola uygulama paketi bulunamadı.") }
    let infoPath = url(path).appendingPathComponent("Contents/Info.plist").path
    _ = try canonicalPath(infoPath)
    let infoData = try Data(contentsOf: url(infoPath))
    guard infoData.count <= 1024 * 1024,
          let info = try PropertyListSerialization.propertyList(from: infoData, options: [], format: nil) as? [String: Any],
          info["CFBundleIdentifier"] as? String == configuration.bundleId,
          info["CFBundleShortVersionString"] as? String == version,
          info["CFBundleVersion"] as? String == version,
          info["CFBundleExecutable"] as? String == "Mola",
          info["CFBundlePackageType"] as? String == "APPL" else {
        try fail("Paketin uygulama kimliği veya sürümü beklenen Mola sürümüyle eşleşmiyor.")
    }
    let executable = url(path).appendingPathComponent("Contents/MacOS/Mola").path
    _ = try canonicalPath(executable)
    guard try Identity(executable).isRegular else { try fail("Mola çalıştırıcısı doğrulanamadı.") }
    _ = try command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", path])
    let (_, signature) = try command("/usr/bin/codesign", ["--display", "--verbose=4", path])
    guard signature.split(separator: "\n").contains(Substring("Identifier=\(configuration.bundleId)")) else {
        try fail("Paket imzasının uygulama kimliği doğrulanamadı.")
    }
    let (architectures, _) = try command("/usr/bin/lipo", ["-archs", executable])
    let expectedArchitecture = configuration.arch == "arm64" ? "arm64" : "x86_64"
    guard architectures.split(whereSeparator: { $0.isWhitespace }).contains(Substring(expectedArchitecture)) else {
        try fail("Bu güncelleme Mac'in işlemci mimarisiyle uyumlu değil.")
    }
}

private func loadConfiguration(_ path: String) throws -> Configuration {
    let data = try readPrivateJSON(path)
    let configuration = try JSONDecoder().decode(Configuration.self, from: data)
    guard configuration.schema == 1, configuration.parentPid > 1, configuration.parentPid == getppid(),
          configuration.bundleId == "app.mola.desktop", ["arm64", "x64"].contains(configuration.arch) else {
        try fail("Güncelleme isteği çalışan Mola uygulamasına ait değil.")
    }
    let old = try versionParts(configuration.currentVersion)
    let new = try versionParts(configuration.version)
    guard old.lexicographicallyPrecedes(new) else { try fail("Yeni paket kurulu Mola sürümünden daha yeni olmalı.") }
    let directory = url(path).deletingLastPathComponent().path
    _ = try canonicalPath(directory)
    let directoryInfo = try Identity(directory)
    guard directoryInfo.isDirectory, directoryInfo.owner == getuid(), directoryInfo.mode & 0o077 == 0,
          url(directory).lastPathComponent.hasPrefix(".mola-update-") else {
        try fail("Güncelleme hazırlık klasörü özel ve güvenli olmalı.")
    }
    _ = try canonicalPath(configuration.targetPath)
    _ = try canonicalPath(configuration.candidatePath)
    guard url(configuration.targetPath).deletingLastPathComponent().path == url(directory).deletingLastPathComponent().path,
          configuration.candidatePath == url(directory).appendingPathComponent("Mola.app").path,
          configuration.targetPath != configuration.candidatePath else {
        try fail("Güncelleme yalnızca kurulu Mola paketinin yanında hazırlanabilir.")
    }
    let outputs = [configuration.resultPath, configuration.readyPath, configuration.commitPath]
    guard Set(outputs).count == outputs.count, !outputs.contains(path) else { try fail("Güncelleme yanıt dosyaları geçersiz.") }
    for output in outputs {
        _ = try canonicalPath(output)
        guard url(output).deletingLastPathComponent().path == directory,
              output != configuration.candidatePath, !FileManager.default.fileExists(atPath: output) else {
            try fail("Güncelleme yanıt dosyasının yolu geçersiz.")
        }
    }
    let installed = try Identity(configuration.targetPath)
    let candidate = try Identity(configuration.candidatePath)
    guard installed.isDirectory, candidate.isDirectory, installed.device == candidate.device,
          !installed.matches(candidate), access(configuration.targetPath, W_OK) == 0,
          access(url(directory).deletingLastPathComponent().path, W_OK | X_OK) == 0 else {
        try fail("Mola yazılabilir bir uygulama klasöründe olmalı. Disk imajı içinden güncellenemez.")
    }
    return configuration
}

private var waitTimeout: TimeInterval {
    #if MOLA_UPDATER_TESTING
    return 0.8
    #else
    return 60
    #endif
}

private func waitForCommit(_ configuration: Configuration) throws {
    let deadline = ProcessInfo.processInfo.systemUptime + waitTimeout
    while ProcessInfo.processInfo.systemUptime < deadline {
        if FileManager.default.fileExists(atPath: configuration.commitPath) {
            let data = try readPrivateJSON(configuration.commitPath)
            guard let commit = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  commit["schema"] as? Int == 1,
                  commit["parentPid"] as? Int == Int(configuration.parentPid),
                  commit["helperPid"] as? Int == Int(getpid()) else {
                try fail("Güncelleme kurulum onayı eşleşmedi.")
            }
            return
        }
        guard getppid() == configuration.parentPid else { try fail("Mola kurulum onayını göndermeden kapandı; mevcut sürüm korundu.") }
        Thread.sleep(forTimeInterval: 0.025)
    }
    try fail("Güncelleme kurulum onayı zamanında alınamadı; mevcut sürüm korundu.")
}

private func waitForParentExit(_ configuration: Configuration) throws {
    let deadline = ProcessInfo.processInfo.systemUptime + waitTimeout
    // The original direct parent's identity cannot be confused with PID reuse.
    while getppid() == configuration.parentPid {
        guard ProcessInfo.processInfo.systemUptime < deadline else {
            try fail("Mola kapanmadığı için güncelleme uygulanmadı. Açık görüşmeni kontrol edip tekrar dene.")
        }
        Thread.sleep(forTimeInterval: 0.025)
    }
}

private func swap(_ first: String, _ second: String) throws {
    guard renameatx_np(AT_FDCWD, first, AT_FDCWD, second, UInt32(RENAME_SWAP)) == 0 else {
        if errno == EPERM || errno == EACCES {
            try fail("macOS, Mola'nın uygulamayı güncellemesine izin vermedi. Sistem Ayarları > Gizlilik ve Güvenlik > Uygulama Yönetimi izinlerini kontrol et.")
        }
        try fail("Mola uygulama paketi değiştirilemedi: \(String(cString: strerror(errno)))")
    }
}

private final class LaunchResult: @unchecked Sendable {
    private let lock = NSLock()
    private var value: (NSRunningApplication?, Error?)?
    func set(_ application: NSRunningApplication?, _ error: Error?) {
        lock.lock(); defer { lock.unlock() }
        value = (application, error)
    }
    func get() -> (NSRunningApplication?, Error?)? {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}

private func launch(_ configuration: Configuration) throws {
    #if MOLA_UPDATER_TESTING
    if ProcessInfo.processInfo.environment["MOLA_UPDATER_TEST_SCENARIO"] == "deny-launch" {
        try fail("Test: LaunchServices rejected the update.")
    }
    if ProcessInfo.processInfo.environment["MOLA_UPDATER_TEST_SCENARIO"] == "launch-timeout" {
        throw LaunchStillRunning(message: "Test: LaunchServices launch result is unknown.")
    }
    #endif
    let result = LaunchResult()
    let options = NSWorkspace.OpenConfiguration()
    options.activates = true
    options.addsToRecentItems = false
    options.createsNewApplicationInstance = true
    NSWorkspace.shared.openApplication(at: url(configuration.targetPath), configuration: options) { application, error in
        result.set(application, error)
    }
    let deadline = ProcessInfo.processInfo.systemUptime + 45
    while result.get() == nil && ProcessInfo.processInfo.systemUptime < deadline {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.025))
    }
    guard let (application, error) = result.get() else {
        throw LaunchStillRunning(message: "Mola'nın yeniden açılışı henüz doğrulanamadı. macOS açılış işlemi sürüyor olabilir.")
    }
    guard let application = application else {
        try fail("macOS güncellenen Mola'yı açamadı. Güvenlik onayı veya uygulama izinleri gerekebilir.")
    }
    guard error == nil, application.processIdentifier != configuration.parentPid,
          application.bundleIdentifier == configuration.bundleId,
          application.bundleURL?.resolvingSymlinksInPath().path == configuration.targetPath,
          application.executableURL?.resolvingSymlinksInPath().path == url(configuration.targetPath).appendingPathComponent("Contents/MacOS/Mola").path,
          !application.isTerminated else {
        if !application.isTerminated {
            throw LaunchStillRunning(message: "Açılan Mola'nın konumu doğrulanamadı. Çalışan uygulama korunuyor; eski sürümün kurtarma kopyası saklandı.")
        }
        try fail("macOS güncellenen Mola'yı açamadı. Güvenlik onayı veya uygulama izinleri gerekebilir.")
    }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
    guard !application.isTerminated else { try fail("Güncellenen Mola açılırken kapandı.") }
    #if MOLA_UPDATER_TESTING
    if ProcessInfo.processInfo.environment["MOLA_UPDATER_TEST_SCENARIO"] == "unverified-live-launch" {
        throw LaunchStillRunning(message: "Test: live launch identity could not be verified.")
    }
    #endif
}

private func showFailure(_ message: String) {
    #if MOLA_UPDATER_TESTING
    return
    #else
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Mola güncellenemedi"
    alert.informativeText = message
    alert.alertStyle = .warning
    alert.addButton(withTitle: "Tamam")
    alert.runModal()
    #endif
}

private func reopenOriginal(_ configuration: Configuration, identity: Identity) {
    guard let current = try? Identity(configuration.targetPath), identity.matches(current) else { return }
    do {
        try verifyBundle(configuration.targetPath, version: configuration.currentVersion, configuration: configuration)
        try launch(configuration)
    } catch { /* The native error remains visible if macOS refuses it. */ }
}

private func perform(_ configuration: Configuration) throws {
    try verifyBundle(configuration.targetPath, version: configuration.currentVersion, configuration: configuration)
    try verifyBundle(configuration.candidatePath, version: configuration.version, configuration: configuration)
    let installed = try Identity(configuration.targetPath)
    let candidate = try Identity(configuration.candidatePath)
    try writeJSON(["schema": 1, "phase": "ready", "pid": Int(getpid())], to: configuration.readyPath)
    try waitForCommit(configuration)
    try waitForParentExit(configuration)
    var swapped = false
    do {
        guard installed.matches(try Identity(configuration.targetPath)), candidate.matches(try Identity(configuration.candidatePath)) else {
            try fail("Uygulama paketi kurulum hazırlanırken değişti; güncelleme durduruldu.")
        }
        try verifyBundle(configuration.targetPath, version: configuration.currentVersion, configuration: configuration)
        try verifyBundle(configuration.candidatePath, version: configuration.version, configuration: configuration)
        try swap(configuration.targetPath, configuration.candidatePath)
        swapped = true
        try syncDirectory(url(configuration.targetPath).deletingLastPathComponent().path)
        try syncDirectory(url(configuration.candidatePath).deletingLastPathComponent().path)
        try launch(configuration)
    } catch {
        if swapped, error is LaunchStillRunning {
            let message = error.localizedDescription + " Kurtarma kopyası: \(configuration.candidatePath)"
            try? writeJSON(["schema": 1, "phase": "failed", "version": configuration.version,
                            "message": message, "backupPath": configuration.candidatePath, "rolledBack": false], to: configuration.resultPath)
            showFailure(message)
            exit(1)
        }
        var restored = false
        if swapped {
            do {
                guard candidate.matches(try Identity(configuration.targetPath)), installed.matches(try Identity(configuration.candidatePath)) else {
                    try fail("Geri alınacak uygulama paketi değişti.")
                }
                try swap(configuration.targetPath, configuration.candidatePath)
                restored = true
                try syncDirectory(url(configuration.targetPath).deletingLastPathComponent().path)
            } catch {
                let message = restored
                    ? "Önceki Mola sürümü geri yüklendi, ancak disk yazımı doğrulanamadı. Kurulu uygulama: \(configuration.targetPath)"
                    : "Güncelleme tamamlanamadı ve eski sürüm otomatik geri yüklenemedi. Kurtarma kopyası: \(configuration.candidatePath)"
                var result: [String: Any] = ["schema": 1, "phase": "failed", "version": configuration.version,
                                             "message": message, "rolledBack": restored]
                if !restored { result["backupPath"] = configuration.candidatePath }
                try? writeJSON(result, to: configuration.resultPath)
                if restored { reopenOriginal(configuration, identity: installed) }
                showFailure(message)
                exit(1)
            }
        }
        let message = error.localizedDescription + (restored ? " Önceki Mola sürümü geri yüklendi." : " Mevcut Mola sürümü korundu.")
        try? writeJSON(["schema": 1, "phase": "failed", "version": configuration.version,
                        "message": message, "rolledBack": restored], to: configuration.resultPath)
        // The parent is already closed. Reopen the preserved/restored original
        // after EPERM or failed preparation too, but never a changed target.
        reopenOriginal(configuration, identity: installed)
        showFailure(message)
        exit(1)
    }
    // Once the new app is running, a receipt write failure must not replace its
    // bundle underneath it. The previous version is still retained for recovery.
    do {
        try writeJSON(["schema": 1, "phase": "installed", "version": configuration.version,
                       "message": "Mola güncellendi ve yeniden açıldı.", "backupPath": configuration.candidatePath], to: configuration.resultPath)
    } catch {
        showFailure("Mola güncellendi ve yeniden açıldı, ancak güncelleme kaydı yazılamadı. Önceki sürümün kurtarma kopyası korundu.")
    }
}

umask(0o077)
private var configuration: Configuration?
do {
    guard CommandLine.arguments.count == 2 else { try fail("Güncelleme yardımcısı yalnızca Mola içinden başlatılabilir.") }
    let loaded = try loadConfiguration(CommandLine.arguments[1])
    configuration = loaded
    try perform(loaded)
} catch {
    if let configuration = configuration {
        try? writeJSON(["schema": 1, "phase": "failed", "version": configuration.version,
                        "message": error.localizedDescription, "rolledBack": false], to: configuration.resultPath)
    }
    fputs("Mola updater: \(error.localizedDescription)\n", stderr)
    showFailure(error.localizedDescription)
    exit(1)
}
