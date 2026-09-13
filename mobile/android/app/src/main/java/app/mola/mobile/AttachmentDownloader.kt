package app.mola.mobile

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLDecoder
import java.util.Locale

/** Fetches one trusted attachment. Redirects are never followed with the session cookie. */
class AttachmentDownloader {
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var cancelled = false

    data class Download(val file: File, val name: String, val mime: String)

    fun cancel() { cancelled = true; connection?.disconnect() }

    fun fetch(server: ServerAddress, url: String, cookie: String?, directory: File): Download {
        require(server.isAttachment(url)) { "Yalnızca bağlı Mola sunucusundaki dosyalar indirilebilir." }
        val destination = File.createTempFile("mola-attachment-", ".tmp", directory)
        try {
            checkCancelled()
            val request = URI(url).toURL().openConnection() as HttpURLConnection
            connection = request
            request.instanceFollowRedirects = false
            request.connectTimeout = 15_000
            request.readTimeout = 20_000
            request.setRequestProperty("Accept", ALLOWED_MIME.joinToString(", "))
            if (!cookie.isNullOrEmpty()) request.setRequestProperty("Cookie", cookie)
            checkCancelled()
            val status = request.responseCode
            if (status != 200) throw IOException(when (status) {
                401, 403 -> "Dosyayı indirmek için yeniden giriş yapın."
                404 -> "Dosya bulunamadı veya erişim izniniz yok."
                in 300..399 -> "Dosya başka bir adrese yönlendirildi; indirme durduruldu."
                else -> "Dosya indirilemedi (HTTP $status)."
            })
            val mime = request.contentType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
            if (mime !in ALLOWED_MIME) throw IOException("Bu dosya türü desteklenmiyor.")
            if (request.contentLengthLong > MAX_BYTES) throw IOException("Dosya 10 MB sınırını aşıyor.")
            request.inputStream.use { input ->
                destination.outputStream().use { output ->
                    val buffer = ByteArray(32 * 1024)
                    var total = 0L
                    while (true) {
                        checkCancelled()
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_BYTES) throw IOException("Dosya 10 MB sınırını aşıyor.")
                        output.write(buffer, 0, count)
                    }
                }
            }
            checkCancelled()
            return Download(destination, fileName(request.getHeaderField("Content-Disposition"), mime!!), mime)
        } catch (error: Exception) {
            destination.delete()
            throw error
        } finally {
            connection?.disconnect()
            connection = null
        }
    }

    private fun checkCancelled() {
        if (cancelled || Thread.currentThread().isInterrupted) throw IOException("İndirme iptal edildi.")
    }

    companion object {
        const val MAX_BYTES = 10L * 1024 * 1024
        val ALLOWED_MIME = listOf("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv")
        private val EXTENSIONS = mapOf("image/png" to "png", "image/jpeg" to "jpg", "image/gif" to "gif", "image/webp" to "webp", "application/pdf" to "pdf", "text/plain" to "txt", "text/csv" to "csv")

        internal fun fileName(disposition: String?, mime: String): String {
            val encoded = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(disposition.orEmpty())?.groupValues?.get(1)
            val plain = Regex("filename=\"([^\"]*)\"", RegexOption.IGNORE_CASE).find(disposition.orEmpty())?.groupValues?.get(1)
            val decoded = try { encoded?.let { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") } } catch (_: Exception) { null }
            val safe = (decoded ?: plain ?: "Mola-dosya").replace(Regex("[\\p{Cntrl}/\\\\:*?\"<>|]"), "_")
                .replace(Regex("[\\u202A-\\u202E\\u2066-\\u2069]"), "").trim().trim('.').take(160).ifEmpty { "Mola-dosya" }
            val extension = EXTENSIONS.getValue(mime)
            // Use the response MIME extension even if the supplied name tries to disguise an executable.
            return if (safe.substringAfterLast('.', "").lowercase(Locale.ROOT) == extension) safe else "$safe.$extension"
        }
    }
}
