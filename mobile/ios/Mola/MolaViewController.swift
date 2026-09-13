import UIKit
import WebKit

final class MolaViewController: UIViewController {
    let store = ServerStore()
    var origin: ServerOrigin?
    var webView: WKWebView?
    private var downloads: DownloadCoordinator?
    private let activity = UIActivityIndicatorView(style: .medium)
    private let errorPanel = UIStackView()
    private let errorLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "Mola"
        let titleLabel = UILabel()
        titleLabel.text = "Mola"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        let titleStack = UIStackView(arrangedSubviews: [activity, titleLabel])
        titleStack.spacing = 8
        navigationItem.titleView = titleStack
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        let menu = UIMenu(children: [
            UIAction(title: "Geri", image: UIImage(systemName: "chevron.backward")) { [weak self] _ in
                guard let web = self?.webView, web.canGoBack else { return }
                web.goBack()
            },
            UIAction(title: "Sunucuyu değiştir", image: UIImage(systemName: "server.rack")) { [weak self] _ in self?.showSetup() }
        ])
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: nil, image: UIImage(systemName: "ellipsis.circle"), primaryAction: nil, menu: menu)
        navigationItem.rightBarButtonItem?.accessibilityLabel = "Uygulama seçenekleri"
        configureErrorPanel()
        if let saved = store.selected { connect(to: saved) }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if origin == nil && presentedViewController == nil { showSetup() }
    }

    private func configureErrorPanel() {
        errorPanel.axis = .vertical
        errorPanel.spacing = 20
        errorPanel.translatesAutoresizingMaskIntoConstraints = false
        errorLabel.font = .preferredFont(forTextStyle: .body)
        errorLabel.adjustsFontForContentSizeCategory = true
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorPanel.addArrangedSubview(errorLabel)
        var configuration = UIButton.Configuration.filled()
        configuration.title = "Tekrar dene"
        let retry = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.reload() })
        retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        errorPanel.addArrangedSubview(retry)
        view.addSubview(errorPanel)
        NSLayoutConstraint.activate([
            errorPanel.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            errorPanel.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            errorPanel.leadingAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            errorPanel.trailingAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            errorPanel.widthAnchor.constraint(lessThanOrEqualToConstant: 420)
        ])
        errorPanel.isHidden = true
    }

    private func connect(to selected: ServerOrigin) {
        downloads?.cancelAll()
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.removeFromSuperview()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store.websiteData(for: selected)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.applicationNameForUserAgent = "MolaMobile/1.0 iOS"
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(web, belowSubview: errorPanel)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
        origin = selected
        store.selected = selected
        webView = web
        downloads = DownloadCoordinator(origin: selected, webView: web, presenter: self)
        errorPanel.isHidden = true
        web.load(URLRequest(url: selected.url))
    }

    private func showSetup() {
        guard presentedViewController == nil else { return }
        let setup = ServerSetupViewController(current: origin) { [weak self] selected in
            guard let self else { return }
            self.dismiss(animated: true) { self.connect(to: selected) }
        }
        let navigation = UINavigationController(rootViewController: setup)
        navigation.modalPresentationStyle = origin == nil ? .fullScreen : .formSheet
        navigation.isModalInPresentation = origin == nil
        present(navigation, animated: true)
    }

    @objc private func reload() {
        guard let webView, let origin else { showSetup(); return }
        errorPanel.isHidden = true
        webView.isHidden = false
        if origin.contains(webView.url) { webView.reload() }
        else { webView.load(URLRequest(url: origin.url)) }
    }

    func showConnectionError(_ message: String = "Sunucuya bağlanılamadı. İnternet bağlantını ve sunucu adresini kontrol et.") {
        activity.stopAnimating()
        webView?.isHidden = true
        errorLabel.text = message
        errorPanel.isHidden = false
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    func trusted(_ frame: WKFrameInfo) -> Bool {
        guard let origin else { return false }
        let security = frame.securityOrigin
        return frame.isMainFrame && origin.contains(webView?.url) &&
            origin.contains(scheme: security.protocol, host: security.host, port: security.port)
    }
}

extension MolaViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === self.webView, let origin else { decisionHandler(.cancel); return }
        let action = origin.navigation(to: navigationAction.request.url,
            sourceIsTrustedMainFrame: trusted(navigationAction.sourceFrame),
            targetsMainFrame: navigationAction.targetFrame?.isMainFrame ?? true,
            isLink: navigationAction.navigationType == .linkActivated,
            requestsDownload: navigationAction.shouldPerformDownload)
        switch action {
        case .download: decisionHandler(.download)
        case .allow:
            if navigationAction.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(navigationAction.request)
            } else { decisionHandler(.allow) }
        case .external:
            decisionHandler(.cancel)
            if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        case .cancel:
            decisionHandler(.cancel)
            if navigationAction.targetFrame?.isMainFrame == true,
               navigationAction.navigationType == .other,
               !origin.contains(navigationAction.request.url),
               !origin.isDownload(navigationAction.request.url) {
                showConnectionError("Sunucu başka bir adrese yönlendirdi. Seçenekler menüsünden doğru HTTPS sunucu adresini gir.")
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard webView === self.webView, let origin else { decisionHandler(.cancel); return }
        guard origin.contains(navigationResponse.response.url) else { decisionHandler(.cancel); return }
        if let response = navigationResponse.response as? HTTPURLResponse,
           navigationResponse.isForMainFrame, response.statusCode >= 400 {
            decisionHandler(.cancel)
            showConnectionError("Sunucu sayfayı açamadı (HTTP \(response.statusCode)). Tekrar deneyebilir veya sunucu adresini değiştirebilirsin.")
        } else if navigationResponse.isForMainFrame && origin.isAttachment(navigationResponse.response.url) {
            decisionHandler(.download)
        } else if !navigationResponse.canShowMIMEType {
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        guard webView === self.webView, trusted(navigationAction.sourceFrame),
              origin?.isDownload(navigationAction.request.url) == true else {
            download.cancel { _ in }; return
        }
        downloads?.accept(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        guard webView === self.webView, navigationResponse.isForMainFrame,
              origin?.isAttachment(navigationResponse.response.url) == true else {
            download.cancel { _ in }; return
        }
        downloads?.accept(download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        activity.startAnimating()
        errorPanel.isHidden = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { activity.stopAnimating() }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(webView, error: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(webView, error: error)
    }

    private func failed(_ webView: WKWebView, error: Error) {
        guard webView === self.webView else { return }
        activity.stopAnimating()
        let error = error as NSError
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
        // WebKit cancels a navigation when its request becomes a download.
        if ["WKErrorDomain", "WebKitErrorDomain"].contains(error.domain) && error.code == 102 { return }
        showConnectionError()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        showConnectionError("Mola sayfası kapandı. Devam etmek için tekrar yükle.")
    }
}
