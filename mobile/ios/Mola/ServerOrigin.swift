import CryptoKit
import Foundation

/// Pure policy: never compare origins by a URL string prefix or by hostname alone.
struct ServerOrigin: Equatable {
    let url: URL
    let host: String
    let port: Int

    init?(_ input: String) {
        let input = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.contains("\\"),
              !input.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              var parts = URLComponents(string: input),
              parts.scheme?.lowercased() == "https",
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              let hostname = parts.host, !hostname.isEmpty,
              (1...65535).contains(parts.port ?? 443) else { return nil }
        parts.scheme = "https"
        parts.host = hostname.lowercased()
        if parts.port == 443 { parts.port = nil }
        parts.path = "/"
        guard let url = parts.url, let host = url.host else { return nil }
        self.url = url
        self.host = host.lowercased()
        self.port = url.port ?? 443
    }

    var address: String { url.absoluteString }

    func contains(_ candidate: URL?) -> Bool {
        guard let candidate,
              candidate.scheme?.lowercased() == "https",
              candidate.user == nil, candidate.password == nil,
              !candidate.absoluteString.contains("\\"),
              candidate.host?.lowercased() == host else { return false }
        return (candidate.port ?? 443) == port
    }

    func contains(scheme: String, host: String, port: Int) -> Bool {
        scheme.lowercased() == "https" && host.lowercased() == self.host &&
            (port == 0 ? 443 : port) == self.port
    }

    func isAttachment(_ candidate: URL?) -> Bool {
        guard contains(candidate), let candidate else { return false }
        let parts = candidate.path.split(separator: "/", omittingEmptySubsequences: false)
        return parts.count == 4 && parts[0].isEmpty && parts[1] == "api" &&
            parts[2] == "files" && UUID(uuidString: String(parts[3])) != nil
    }

    func isDownload(_ candidate: URL?) -> Bool {
        guard let candidate else { return false }
        if isAttachment(candidate) { return true }
        // Recovery-code exports use a blob created by the trusted main document.
        return candidate.scheme == "blob" &&
            contains(URL(string: String(candidate.absoluteString.dropFirst(5))))
    }

    /// Cookies ignore ports; distinct persistent stores are essential for port isolation.
    var dataStoreIdentifier: UUID {
        var bytes = Array(SHA256.hash(data: Data(address.utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x80
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
                           bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]))
    }

    enum Navigation: Equatable { case allow, download, external, cancel }

    func navigation(to target: URL?, sourceIsTrustedMainFrame: Bool,
                    targetsMainFrame: Bool, isLink: Bool, requestsDownload: Bool) -> Navigation {
        guard let target else { return .cancel }
        if requestsDownload || isAttachment(target) {
            return sourceIsTrustedMainFrame && isDownload(target) ? .download : .cancel
        }
        if contains(target) { return .allow }
        if sourceIsTrustedMainFrame && targetsMainFrame && isLink &&
            target.scheme == "https" && target.host != nil &&
            target.user == nil && target.password == nil { return .external }
        return .cancel
    }

    static func safeFilename(_ suggested: String) -> String {
        let leaf = suggested.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? "dosya"
        let safe = String(leaf.unicodeScalars.filter {
            !CharacterSet.controlCharacters.contains($0) &&
                !CharacterSet(charactersIn: ":").contains($0) &&
                !(0x202a...0x202e).contains($0.value) && !(0x2066...0x2069).contains($0.value)
        }.map(String.init).joined().prefix(160))
        return safe.isEmpty || safe == "." || safe == ".." ? "dosya" : safe
    }
}
