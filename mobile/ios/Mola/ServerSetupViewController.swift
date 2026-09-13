import UIKit

final class ServerSetupViewController: UIViewController, UITextFieldDelegate {
    private let current: ServerOrigin?
    private let onConnect: (ServerOrigin) -> Void
    private let addressField = UITextField()
    private let errorLabel = UILabel()

    init(current: ServerOrigin?, onConnect: @escaping (ServerOrigin) -> Void) {
        self.current = current
        self.onConnect = onConnect
        super.init(nibName: nil, bundle: nil)
        isModalInPresentation = current == nil
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Mola'ya bağlan"
        view.backgroundColor = .systemBackground
        if current != nil {
            navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Vazgeç", style: .plain, target: self, action: #selector(close))
        }

        let symbol = UIImageView(image: UIImage(systemName: "bubble.left.and.bubble.right.fill"))
        symbol.tintColor = .systemIndigo
        symbol.contentMode = .scaleAspectFit
        symbol.heightAnchor.constraint(equalToConstant: 56).isActive = true
        symbol.isAccessibilityElement = false
        let heading = UILabel()
        heading.text = "Ekibin, her yerde."
        heading.font = .preferredFont(forTextStyle: .title1)
        heading.adjustsFontForContentSizeCategory = true
        heading.numberOfLines = 0
        let detail = UILabel()
        detail.text = "Mola sunucunun HTTPS adresini gir. Ardından mevcut hesabınla giriş yapabilirsin."
        detail.font = .preferredFont(forTextStyle: .body)
        detail.adjustsFontForContentSizeCategory = true
        detail.textColor = .secondaryLabel
        detail.numberOfLines = 0
        let fieldLabel = UILabel()
        fieldLabel.text = "Sunucu adresi"
        fieldLabel.font = .preferredFont(forTextStyle: .headline)
        fieldLabel.adjustsFontForContentSizeCategory = true
        addressField.borderStyle = .roundedRect
        addressField.placeholder = "https://mola.ornek.com"
        addressField.text = current?.address
        addressField.accessibilityLabel = "Sunucu adresi"
        addressField.keyboardType = .URL
        addressField.textContentType = .URL
        addressField.autocapitalizationType = .none
        addressField.autocorrectionType = .no
        addressField.spellCheckingType = .no
        addressField.returnKeyType = .go
        addressField.clearButtonMode = .whileEditing
        addressField.delegate = self
        addressField.font = .preferredFont(forTextStyle: .body)
        addressField.adjustsFontForContentSizeCategory = true
        addressField.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        errorLabel.font = .preferredFont(forTextStyle: .footnote)
        errorLabel.adjustsFontForContentSizeCategory = true
        errorLabel.textColor = .systemRed
        errorLabel.numberOfLines = 0
        errorLabel.isHidden = true
        var configuration = UIButton.Configuration.filled()
        configuration.title = "Bağlan"
        configuration.baseBackgroundColor = .systemIndigo
        configuration.cornerStyle = .medium
        let connect = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.connect() })
        connect.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        let stack = UIStackView(arrangedSubviews: [symbol, heading, detail, fieldLabel, addressField, errorLabel, connect])
        stack.axis = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 32),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -32),
            stack.centerXAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerXAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { connect(); return true }

    private func connect() {
        guard let server = ServerOrigin(addressField.text ?? "") else {
            errorLabel.text = "Geçerli bir HTTPS sunucu adresi gir. Adreste sayfa yolu, kullanıcı bilgisi veya sorgu bulunmamalı."
            errorLabel.isHidden = false
            UIAccessibility.post(notification: .announcement, argument: errorLabel.text)
            return
        }
        view.endEditing(true)
        onConnect(server)
    }

    @objc private func close() { dismiss(animated: true) }
}
