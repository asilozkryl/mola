import UIKit
import WebKit

extension MolaViewController: WKUIDelegate {
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor securityOrigin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard webView === self.webView, trusted(frame), let origin,
              origin.contains(scheme: securityOrigin.protocol, host: securityOrigin.host, port: securityOrigin.port) else {
            decisionHandler(.deny); return
        }
        switch type {
        case .camera, .microphone, .cameraAndMicrophone: decisionHandler(.prompt)
        @unknown default: decisionHandler(.deny)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // New windows are routed by the navigation policy; never create a second privileged view.
        nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard webView === self.webView, trusted(frame), presentedViewController == nil else { completionHandler(); return }
        let alert = UIAlertController(title: origin?.host ?? "Mola", message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard webView === self.webView, trusted(frame), presentedViewController == nil else { completionHandler(false); return }
        let alert = UIAlertController(title: origin?.host ?? "Mola", message: String(message.prefix(2000)), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Vazgeç", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard webView === self.webView, trusted(frame), presentedViewController == nil else { completionHandler(nil); return }
        let alert = UIAlertController(title: origin?.host ?? "Mola", message: String(prompt.prefix(2000)), preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Vazgeç", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, animated: true)
    }
}
