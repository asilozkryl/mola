package app.mola.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.*
import java.io.IOException
import java.util.concurrent.Executors

/** A server-connected client. There is deliberately no JavaScript/native bridge. */
class MainActivity : Activity() {
    private val preferences by lazy { getSharedPreferences("mola", MODE_PRIVATE) }
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var root: LinearLayout
    private var web: WebView? = null
    private var server: ServerAddress? = null
    private var progress: ProgressBar? = null
    private var navigationToolbar: View? = null
    private var errorPanel: View? = null
    private var errorLabel: TextView? = null
    private var loadFailed = false
    private var generation = 0
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var chooserTypes = emptyList<String>()
    private var multipleFiles = false
    private var mediaRequest: PermissionRequest? = null
    private var mediaResources = emptyArray<String>()
    private var runtimePermissionPending = false
    private var downloader: AttachmentDownloader? = null
    private var savedDownload: AttachmentDownloader.Download? = null
    private var downloadBusy = false
    private val popupViews = mutableSetOf<WebView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(245, 247, 242))
        }
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                // Keep the composer and send button usable in landscape with the IME open.
                navigationToolbar?.visibility = if (insets.isVisible(WindowInsets.Type.ime())) View.GONE else View.VISIBLE
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
                WindowInsets.CONSUMED
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) { navigateBack() }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptCookie(true)
        // Interrupted downloads never leave private attachment copies across app launches.
        cacheDir.listFiles()?.filter { it.name.startsWith("mola-attachment-") }?.forEach { it.delete() }
        val existing = preferences.getString("server", null)?.let { runCatching { ServerAddress.parse(it, BuildConfig.DEBUG) }.getOrNull() }
        if (existing == null) showSetup() else connect(existing)
    }

    private fun label(text: String, size: Float = 16f) = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(Color.rgb(21, 61, 54))
    }
    private fun button(text: String, action: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        minHeight = dp(48)
        setOnClickListener { action() }
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun showSetup() {
        disposeWeb()
        root.removeAllViews()
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(28), dp(32), dp(28), dp(32))
        }
        form.addView(label("Mola", 42f))
        form.addView(label("Ekibin, cebinde.", 24f).apply { setPadding(0, dp(16), 0, dp(12)) })
        form.addView(label("Mola sunucunun adresini gir. Mevcut hesabınla giriş yaparak konuşmalarına devam et."))
        val address = EditText(this).apply {
            hint = "https://mola.sirketiniz.com"
            contentDescription = "Mola sunucu adresi"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(preferences.getString("server", ""))
            setPadding(0, dp(24), 0, dp(20))
        }
        form.addView(address, LinearLayout.LayoutParams(-1, -2))
        val error = label("").apply { setTextColor(Color.rgb(160, 35, 35)); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        form.addView(error)
        var connecting = false
        val submit = button("Bağlan") {
            if (connecting) return@button
            val target = try { ServerAddress.parse(address.text.toString(), BuildConfig.DEBUG) }
            catch (failure: IllegalArgumentException) { error.text = failure.message; return@button }
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(address.windowToken, 0)
            address.clearFocus()
            if (preferences.getString("server", null) != target.origin) {
                // Changing server forgets all previous WebView sessions and local drafts on this device.
                connecting = true
                CookieManager.getInstance().removeAllCookies {
                    if (!isDestroyed) {
                        WebStorage.getInstance().deleteAllData()
                        preferences.edit().putString("server", target.origin).apply()
                        connect(target)
                    }
                }
            } else connect(target)
        }
        form.addView(submit, LinearLayout.LayoutParams(-1, -2))
        scroll.addView(form)
        root.addView(scroll, LinearLayout.LayoutParams(-1, -1))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun connect(target: ServerAddress) {
        disposeWeb()
        server = target
        preferences.edit().putString("server", target.origin).apply()
        root.removeAllViews()
        val toolbar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
            addView(label("Mola", 20f), LinearLayout.LayoutParams(0, -2, 1f))
            addView(button("Yenile") { web?.reload() })
            addView(button("Sunucu") {
                AlertDialog.Builder(this@MainActivity).setTitle("Sunucu adresi")
                    .setMessage("${target.origin}\n\nBaşka sunucuya bağlandığında bu cihazdaki önceki oturum ve taslaklar temizlenir.")
                    .setNegativeButton("Vazgeç", null).setPositiveButton("Değiştir") { _, _ -> showSetup() }.show()
            })
        }
        navigationToolbar = toolbar
        root.addView(toolbar, LinearLayout.LayoutParams(-1, dp(52)))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
        val frame = FrameLayout(this)
        val browser = WebView(this)
        web = browser
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // Required for explicit ACTION_OPEN_DOCUMENT selections only.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString MolaMobile/1.0 Android"
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
        browser.webViewClient = object : WebViewClient() {
            // POST navigations do not reliably invoke shouldOverrideUrlLoading. Deny them
            // before networking too, so cookies cannot reach another port on the same host.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.isForMainFrame && !target.isSameOrigin(request.url.toString())) blockedNavigationResponse() else null
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return !target.isSameOrigin(request.url.toString())
                return route(request.url.toString(), request.hasGesture())
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                cancelMedia()
                if (url == null || !target.isSameOrigin(url)) { view.stopLoading(); showError("Bu yönlendirmeye izin verilmiyor."); return }
                chooser?.onReceiveValue(null)
                chooser = null
                loadFailed = false
                errorPanel?.visibility = View.GONE
                progress?.visibility = View.VISIBLE
            }
            override fun onPageFinished(view: WebView, url: String?) {
                progress?.visibility = View.GONE
                CookieManager.getInstance().flush()
                if (!loadFailed) errorPanel?.visibility = View.GONE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("Sunucuya ulaşılamadı. İnternet bağlantını ve sunucu adresini kontrol et.")
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) showError("Sunucu yanıt veremedi (HTTP ${response.statusCode}).")
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                showError("Sunucunun güvenli bağlantısı doğrulanamadı. Geçerli bir HTTPS sertifikası gerekiyor.")
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                disposeWeb()
                showSetup()
                toast("Uygulama görünümü kapandı. Sunucuna yeniden bağlanabilirsin.")
                return true
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, value: Int) { progress?.progress = value }
            override fun onPermissionRequest(request: PermissionRequest) { requestMedia(request) }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (mediaRequest === request) { mediaRequest = null; mediaResources = emptyArray() }
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null)
                chooser = null
                if (!trustedPage()) { callback.onReceiveValue(null); return true }
                val requested = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                chooserTypes = AttachmentDownloader.ALLOWED_MIME.filter { mime -> requested.isEmpty() || requested.any { accept ->
                    accept == "*/*" || accept == mime || (accept == "image/*" && mime.startsWith("image/")) ||
                        accept in extensionsFor(mime)
                } }
                if (chooserTypes.isEmpty()) { callback.onReceiveValue(null); toast("Bu dosya türü desteklenmiyor."); return true }
                chooser = callback
                multipleFiles = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (chooserTypes.size == 1) chooserTypes.first() else "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, chooserTypes.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multipleFiles)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                try { startActivityForResult(picker, PICK_UPLOAD) }
                catch (_: ActivityNotFoundException) { chooser = null; callback.onReceiveValue(null); toast("Dosya seçici bulunamadı.") }
                return true
            }
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                if (!isUserGesture || !trustedPage()) return false
                // Resolve target=_blank without letting an untrusted popup acquire a native surface.
                popupViews.toList().forEach { it.stopLoading(); it.destroy() }
                popupViews.clear()
                val popup = WebView(this@MainActivity).apply {
                    settings.javaScriptEnabled = false
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                }
                popupViews.add(popup)
                popup.webViewClient = object : WebViewClient() {
                    // This disposable view only resolves the requested URL; the main view
                    // or an explicit browser intent performs any permitted navigation.
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse = blockedNavigationResponse()
                    private var handled = false
                    private fun handle(url: String): Boolean {
                        if (url == "about:blank") return false
                        if (handled) return true
                        handled = true
                        popup.stopLoading()
                        val blocked = route(url, true)
                        if (!blocked) web?.loadUrl(url)
                        popup.post { popupViews.remove(popup); popup.destroy() }
                        return true
                    }
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = handle(request.url.toString())
                    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { if (url != null) handle(url) }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }
        }
        browser.setDownloadListener { url, _, _, _, _ -> beginDownload(url) }
        frame.addView(browser, FrameLayout.LayoutParams(-1, -1))
        val error = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(Color.rgb(245, 247, 242))
            visibility = View.GONE
            errorLabel = label("").apply { gravity = Gravity.CENTER; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
            addView(errorLabel)
            addView(button("Tekrar dene") { web?.loadUrl(target.home) })
            addView(button("Sunucu adresini değiştir") { showSetup() })
        }
        errorPanel = error
        frame.addView(error, FrameLayout.LayoutParams(-1, -1))
        root.addView(frame, LinearLayout.LayoutParams(-1, 0, 1f))
        browser.loadUrl(target.home)
    }

    private fun blockedNavigationResponse() = WebResourceResponse(
        "text/plain", "UTF-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"),
        "Bu yönlendirmeye izin verilmiyor.".byteInputStream(Charsets.UTF_8)
    )

    private fun route(url: String, gesture: Boolean): Boolean {
        val target = server ?: return true
        if (target.isAttachment(url)) { beginDownload(url); return true }
        return when (target.navigation(url, gesture)) {
            Navigation.INTERNAL -> false
            Navigation.EXTERNAL -> {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
                catch (_: ActivityNotFoundException) { toast("Bu bağlantıyı açacak tarayıcı bulunamadı.") }
                true
            }
            Navigation.BLOCK -> { toast(if (url.startsWith("blob:")) "Bu indirme mobil uygulamada desteklenmiyor. Tarayıcıdan indirebilirsin." else "Bu bağlantıya izin verilmiyor."); true }
        }
    }

    private fun trustedPage() = server?.isSameOrigin(web?.url.orEmpty()) == true
    private fun requestMedia(request: PermissionRequest) {
        cancelMedia()
        if (runtimePermissionPending || isFinishing || isDestroyed) { request.deny(); return }
        val supported = setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE, PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!trustedPage() || server?.isSameOrigin(request.origin.toString()) != true || request.resources.isEmpty() || request.resources.any { it !in supported }) {
            request.deny(); return
        }
        mediaRequest = request
        mediaResources = request.resources.copyOf()
        val permissions = mediaResources.map { if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA }
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.distinct()
        if (permissions.isEmpty()) grantMedia() else {
            runtimePermissionPending = true
            requestPermissions(permissions.toTypedArray(), MEDIA_PERMISSION)
        }
    }
    private fun grantMedia() {
        val request = mediaRequest ?: return
        mediaRequest = null
        val resources = mediaResources
        mediaResources = emptyArray()
        val permitted = resources.filter { resource -> checkSelfPermission(if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED }
        if (!isDestroyed && trustedPage() && server?.isSameOrigin(request.origin.toString()) == true && permitted.isNotEmpty()) request.grant(permitted.toTypedArray()) else request.deny()
    }
    private fun cancelMedia() { mediaRequest?.deny(); mediaRequest = null; mediaResources = emptyArray() }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MEDIA_PERMISSION) { runtimePermissionPending = false; grantMedia() }
    }

    private fun beginDownload(url: String) {
        val target = server ?: return
        if (!trustedPage() || !target.isAttachment(url)) { toast("Bu indirme mobil uygulamada desteklenmiyor. Tarayıcıdan indirebilirsin."); return }
        if (downloadBusy) { toast("Önce devam eden dosya indirmesini tamamla."); return }
        downloadBusy = true
        val token = generation
        val download = AttachmentDownloader()
        downloader = download
        val cookie = CookieManager.getInstance().getCookie(url)
        toast("Dosya hazırlanıyor…")
        worker.execute {
            try {
                val result = download.fetch(target, url, cookie, cacheDir)
                runOnUiThread {
                    if (isDestroyed || generation != token) { result.file.delete(); return@runOnUiThread }
                    savedDownload = result
                    try {
                        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = result.mime
                            putExtra(Intent.EXTRA_TITLE, result.name)
                        }, SAVE_DOWNLOAD)
                    } catch (_: ActivityNotFoundException) { finishDownload(); toast("Dosya kaydetme uygulaması bulunamadı.") }
                }
            } catch (error: Exception) {
                runOnUiThread { if (!isDestroyed && generation == token) { finishDownload(); toast(error.message ?: "Dosya indirilemedi.") } }
            }
        }
    }
    private fun finishDownload() { savedDownload?.file?.delete(); savedDownload = null; downloader = null; downloadBusy = false }

    @Deprecated("Platform file picker callback remains available for API 26+")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_UPLOAD) {
            val callback = chooser ?: return
            chooser = null
            val uris = if (resultCode == RESULT_OK && trustedPage()) {
                val clip = data?.clipData
                val selected = if (clip != null) (0 until minOf(clip.itemCount, 20)).map { clip.getItemAt(it).uri } else listOfNotNull(data?.data)
                selected.take(if (multipleFiles) 20 else 1).filter { allowedDocument(it) }
            } else emptyList()
            callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
        }
        if (requestCode == SAVE_DOWNLOAD) {
            val download = savedDownload ?: return
            val destination = data?.data
            if (resultCode != RESULT_OK || destination?.scheme != "content") { finishDownload(); return }
            val token = generation
            worker.execute {
                var failure: String? = null
                try {
                    contentResolver.openOutputStream(destination, "wt")?.use { output -> download.file.inputStream().use { it.copyTo(output) } }
                        ?: throw IOException("Dosya açılamadı.")
                } catch (_: Exception) {
                    failure = "Dosya kaydedilemedi. Tekrar deneyin."
                    runCatching { DocumentsContract.deleteDocument(contentResolver, destination) }
                } finally { download.file.delete() }
                runOnUiThread { if (!isDestroyed && token == generation) { finishDownload(); toast(failure ?: "Dosya kaydedildi.") } }
            }
        }
    }
    private fun extensionsFor(mime: String): Set<String> = when (mime) {
        "image/png" -> setOf(".png")
        "image/jpeg" -> setOf(".jpg", ".jpeg")
        "image/gif" -> setOf(".gif")
        "image/webp" -> setOf(".webp")
        "application/pdf" -> setOf(".pdf")
        "text/plain" -> setOf(".txt")
        "text/csv" -> setOf(".csv")
        else -> emptySet()
    }
    private fun allowedDocument(uri: Uri): Boolean = try {
        if (uri.scheme != "content") false
        else {
            var name = ""
            var size = -1L
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) {
                    name = it.getString(0).orEmpty()
                    if (!it.isNull(1)) size = it.getLong(1)
                }
            }
            val mime = contentResolver.getType(uri)?.lowercase()
            val allowed = mime in chooserTypes || ((mime == null || mime == "application/octet-stream") && chooserTypes.any { ".${name.substringAfterLast('.', "").lowercase()}" in extensionsFor(it) })
            (allowed && size <= AttachmentDownloader.MAX_BYTES).also { if (!it) toast("PNG, JPG, GIF, WebP, PDF, TXT veya CSV seçin (en fazla 10 MB).") }
        }
    } catch (_: Exception) { toast("Seçilen dosya okunamadı."); false }

    private fun showError(message: String) { loadFailed = true; progress?.visibility = View.GONE; errorLabel?.text = message; errorPanel?.visibility = View.VISIBLE }
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    private fun navigateBack() {
        if (web?.canGoBack() == true) web?.goBack()
        else if (web == null && server != null) connect(server!!)
        else finish()
    }
    // Android 13+ uses the native OnBackInvokedDispatcher registered in onCreate.
    // This fallback is only dispatched by older platforms.
    @SuppressLint("GestureBackNavigation")
    @Deprecated("Use OnBackInvokedDispatcher on Android 13+")
    override fun onBackPressed() { navigateBack() }
    private fun disposeWeb() {
        generation++
        cancelMedia()
        chooser?.onReceiveValue(null)
        chooser = null
        downloader?.cancel()
        finishDownload()
        popupViews.toList().forEach { it.stopLoading(); it.destroy() }
        popupViews.clear()
        web?.let { browser ->
            browser.stopLoading()
            (browser.parent as? ViewGroup)?.removeView(browser)
            browser.destroy()
        }
        web = null
        navigationToolbar = null
        progress = null
        errorPanel = null
        errorLabel = null
    }
    override fun onPause() { CookieManager.getInstance().flush(); web?.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); web?.onResume() }
    override fun onStop() { cancelMedia(); super.onStop() }
    override fun onDestroy() { disposeWeb(); worker.shutdownNow(); super.onDestroy() }

    companion object {
        private const val PICK_UPLOAD = 101
        private const val SAVE_DOWNLOAD = 102
        private const val MEDIA_PERMISSION = 103
    }
}
