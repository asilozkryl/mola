import XCTest
@testable import Mola

final class ServerOriginTests: XCTestCase {
    private let origin = ServerOrigin("https://mola.example")!
    private let id = "91cb6d86-a648-4133-8711-4303b2f5e250"

    func testNormalizesDefaultPortCaseAndSlash() {
        XCTAssertEqual(ServerOrigin(" HTTPS://MOLA.EXAMPLE:443/ \n"), origin)
        XCTAssertEqual(origin.address, "https://mola.example/")
    }

    func testRejectsNonOriginServerConfiguration() {
        for address in ["http://mola.example", "file:///tmp/a", "javascript:alert(1)",
                        "https://user:secret@mola.example", "https://mola.example/path",
                        "https://mola.example/?token=a", "https://mola.example/#section",
                        "https://mola.example:0", "https://mola.example:65536",
                        "https://mola.example\\@evil.example", "https://mola.example/\npath"] {
            XCTAssertNil(ServerOrigin(address), address)
        }
    }

    func testContainsUsesFullOriginAndRejectsCredentials() {
        XCTAssertTrue(origin.contains(URL(string: "https://mola.example:443/api/auth/me")))
        for address in ["https://mola.example.evil.test/", "https://mola.example:444/",
                        "http://mola.example/", "https://evil.test/?next=https://mola.example",
                        "https://user@mola.example/"] {
            XCTAssertFalse(origin.contains(URL(string: address)), address)
        }
    }

    func testCookieStoreIsStableAndIsolatedAcrossPortsAndHosts() {
        XCTAssertEqual(origin.dataStoreIdentifier, ServerOrigin("https://MOLA.example:443/")!.dataStoreIdentifier)
        XCTAssertNotEqual(origin.dataStoreIdentifier, ServerOrigin("https://mola.example:444")!.dataStoreIdentifier)
        XCTAssertNotEqual(origin.dataStoreIdentifier, ServerOrigin("https://other.example")!.dataStoreIdentifier)
    }

    func testMediaOriginTreatsDefaultPortAs443AndRejectsOtherOrigins() {
        XCTAssertTrue(origin.contains(scheme: "https", host: "mola.example", port: 0))
        XCTAssertTrue(origin.contains(scheme: "https", host: "mola.example", port: 443))
        XCTAssertFalse(origin.contains(scheme: "https", host: "mola.example", port: 8443))
        XCTAssertFalse(origin.contains(scheme: "http", host: "mola.example", port: 443))
        XCTAssertFalse(origin.contains(scheme: "https", host: "mola.example.evil.test", port: 443))
    }

    func testDownloadPolicyAllowsAuthenticatedAttachmentsAndSameOriginBlobsOnly() {
        XCTAssertTrue(origin.isDownload(URL(string: "https://mola.example/api/files/\(id)")))
        XCTAssertTrue(origin.isDownload(URL(string: "blob:https://mola.example/\(id)")))
        for address in ["https://mola.example/api/files/not-a-file", "https://mola.example/api/files/\(id)/other",
                        "https://mola.example/api/auth/me", "https://mola.example:444/api/files/\(id)",
                        "blob:https://evil.test/\(id)", "data:text/plain,secret", "file:///tmp/secret"] {
            XCTAssertFalse(origin.isDownload(URL(string: address)), address)
        }
    }

    func testExternalNavigationRequiresUserLinkAndTrustedMainFrame() {
        let external = URL(string: "https://docs.example/help")!
        XCTAssertEqual(origin.navigation(to: external, sourceIsTrustedMainFrame: true,
            targetsMainFrame: true, isLink: true, requestsDownload: false), .external)
        XCTAssertEqual(origin.navigation(to: external, sourceIsTrustedMainFrame: true,
            targetsMainFrame: true, isLink: false, requestsDownload: false), .cancel)
        XCTAssertEqual(origin.navigation(to: external, sourceIsTrustedMainFrame: false,
            targetsMainFrame: true, isLink: true, requestsDownload: false), .cancel)
        XCTAssertEqual(origin.navigation(to: external, sourceIsTrustedMainFrame: true,
            targetsMainFrame: false, isLink: true, requestsDownload: false), .cancel)
    }

    func testInternalStartupAllowedButDownloadsNeedTrustedDocument() {
        XCTAssertEqual(origin.navigation(to: origin.url, sourceIsTrustedMainFrame: false,
            targetsMainFrame: true, isLink: false, requestsDownload: false), .allow)
        let attachment = URL(string: "https://mola.example/api/files/\(id)")!
        XCTAssertEqual(origin.navigation(to: attachment, sourceIsTrustedMainFrame: false,
            targetsMainFrame: true, isLink: true, requestsDownload: true), .cancel)
        XCTAssertEqual(origin.navigation(to: attachment, sourceIsTrustedMainFrame: true,
            targetsMainFrame: true, isLink: true, requestsDownload: true), .download)
    }

    func testFilenameCannotEscapeTemporaryDirectory() {
        XCTAssertEqual(ServerOrigin.safeFilename("../../recovery.txt"), "recovery.txt")
        XCTAssertEqual(ServerOrigin.safeFilename("C:\\secret\\recovery.txt"), "recovery.txt")
        XCTAssertEqual(ServerOrigin.safeFilename(".."), "dosya")
        XCTAssertEqual(ServerOrigin.safeFilename("a\u{202e}b\n.txt"), "ab.txt")
        XCTAssertLessThanOrEqual(ServerOrigin.safeFilename(String(repeating: "a", count: 300)).count, 160)
    }
}
