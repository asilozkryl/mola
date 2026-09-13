import UIKit
import WebKit

/// Downloads stay in WebKit's cookie store. No cookie is read by native code or JavaScript.
@MainActor
final class DownloadCoordinator: NSObject, WKDownloadDelegate {
    private let origin: ServerOrigin
    private weak var webView: WKWebView?
    private weak var presenter: UIViewController?
    private var active: WKDownload?
    private var directory: URL?
    private var destination: URL?
    private var sharing = false
    private static var root: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("MolaDownloads", isDirectory: true)
    }

    init(origin: ServerOrigin, webView: WKWebView, presenter: UIViewController) {
        self.origin = origin
        self.webView = webView
        self.presenter = presenter
    }

    static func removeAbandonedFiles() { try? FileManager.default.removeItem(at: root) }

    func accept(_ download: WKDownload) {
        guard active == nil, !sharing, download.webView === webView,
              origin.contains(webView?.url), origin.isDownload(download.originalRequest?.url) else {
            download.cancel { _ in }
            showMessage("Dosya şu anda indirilemiyor. Açık paylaşımı tamamlayıp tekrar dene.")
            return
        }
        active = download
        download.delegate = self
    }

    func cancelAll() {
        let download = active
        active = nil
        download?.delegate = nil
        download?.cancel { _ in }
        cleanup()
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard download === active, origin.isDownload(response.url),
              origin.contains(webView?.url) else { completionHandler(nil); return }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            completionHandler(nil)
            showMessage("Dosya indirilemedi. Oturumunu ve dosya erişimini kontrol et.")
            return
        }
        do {
            let folder = Self.root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete])
            let file = folder.appendingPathComponent(ServerOrigin.safeFilename(suggestedFilename), isDirectory: false)
            directory = folder
            destination = file
            completionHandler(file)
        } catch {
            completionHandler(nil)
            showMessage("Dosya için geçici alan oluşturulamadı.")
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(download === active && origin.isAttachment(request.url) ? .allow : .cancel)
    }

    func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // Preserve system certificate verification; never accept invalid TLS certificates.
        completionHandler(.performDefaultHandling, nil)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard download === active else { return }
        active = nil
        guard let file = destination, let presenter,
              presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
            cleanup()
            showMessage("Dosyayı kaydetmek için açık pencereyi kapatıp indirmeyi tekrar başlat.")
            return
        }
        sharing = true
        let temporaryFolder = directory
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = presenter.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX,
            y: presenter.view.bounds.maxY - presenter.view.safeAreaInsets.bottom, width: 1, height: 1)
        sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in
            if let temporaryFolder { try? FileManager.default.removeItem(at: temporaryFolder) }
            self?.sharing = false
            self?.directory = nil
            self?.destination = nil
        }
        presenter.present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard download === active else { return }
        active = nil
        cleanup()
        showMessage("Dosya indirilemedi. Bağlantını kontrol edip tekrar dene.")
    }

    private func cleanup() {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        destination = nil
    }

    private func showMessage(_ message: String) {
        guard let presenter, presenter.presentedViewController == nil,
              presenter.viewIfLoaded?.window != nil else { return }
        let alert = UIAlertController(title: "Dosya indir", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Tamam", style: .default))
        presenter.present(alert, animated: true)
    }
}
