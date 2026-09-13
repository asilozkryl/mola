import XCTest
@testable import Mola

final class ServerStoreTests: XCTestCase {
    func testPersistsOnlyValidatedAddressAcrossInstances() throws {
        let suite = "MolaTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ServerStore(defaults: defaults)
        let origin = try XCTUnwrap(ServerOrigin("https://mola.example:8443"))
        store.selected = origin
        XCTAssertEqual(ServerStore(defaults: defaults).selected, origin)
        store.selected = nil
        XCTAssertNil(store.selected)
        defaults.set("http://mola.example", forKey: "mola.server-origin")
        XCTAssertNil(store.selected)
    }
}
