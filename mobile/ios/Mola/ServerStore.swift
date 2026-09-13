import Foundation
import WebKit

final class ServerStore {
    private let defaults: UserDefaults
    private let key = "mola.server-origin"

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var selected: ServerOrigin? {
        get { defaults.string(forKey: key).flatMap(ServerOrigin.init) }
        set { defaults.set(newValue?.address, forKey: key) }
    }

    @MainActor
    func websiteData(for origin: ServerOrigin) -> WKWebsiteDataStore {
        WKWebsiteDataStore(forIdentifier: origin.dataStoreIdentifier)
    }
}
