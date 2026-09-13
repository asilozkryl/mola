package app.mola.mobile

import java.net.URI
import java.util.Locale

enum class Navigation { INTERNAL, EXTERNAL, BLOCK }

/** Shared, Android-independent policy; no credentials are accepted in user-provided URLs. */
class ServerAddress private constructor(val origin: String, private val base: URI) {
    val home: String get() = "$origin/"

    fun isSameOrigin(url: String): Boolean {
        val candidate = safeUri(url) ?: return false
        return candidate.scheme.equals(base.scheme, true) &&
            candidate.host.equals(base.host, true) && port(candidate) == port(base)
    }

    fun navigation(url: String, userGesture: Boolean): Navigation {
        val candidate = safeUri(url) ?: return Navigation.BLOCK
        if (isSameOrigin(url)) return Navigation.INTERNAL
        return if (userGesture && candidate.scheme.equals("https", true)) Navigation.EXTERNAL else Navigation.BLOCK
    }

    fun isAttachment(url: String): Boolean {
        val candidate = safeUri(url) ?: return false
        return candidate.scheme.equals("https", true) && isSameOrigin(url) &&
            candidate.rawQuery == null && candidate.rawFragment == null &&
            ATTACHMENT.matches(candidate.rawPath ?: "")
    }

    companion object {
        private val ATTACHMENT = Regex("/api/files/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "[::1]", "10.0.2.2")

        fun parse(value: String, allowLocalHttp: Boolean = false): ServerAddress {
            require(value.none { it.code < 32 || it.code == 127 } && '\\' !in value) { "Geçerli bir sunucu adresi girin." }
            val trimmed = value.trim()
            require(trimmed.isNotEmpty()) { "Sunucu adresini girin." }
            val raw = if ("://" in trimmed) trimmed else "https://$trimmed"
            val uri = safeUri(raw) ?: throw IllegalArgumentException("Geçerli bir sunucu adresi girin.")
            val scheme = uri.scheme.lowercase(Locale.ROOT)
            val host = uri.host.lowercase(Locale.ROOT)
            require(scheme == "https" || (allowLocalHttp && scheme == "http" && host in LOCAL_HOSTS)) {
                "Sunucu HTTPS kullanmalıdır. Örnek: https://mola.sirketiniz.com"
            }
            require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") { "Sunucunun kök adresini girin; /kanal gibi bir yol eklemeyin." }
            require(uri.rawQuery == null && uri.rawFragment == null) { "Sunucu adresinden sorgu ve # bölümünü kaldırın." }
            val port = if (uri.port == -1 || uri.port == if (scheme == "https") 443 else 80) "" else ":${uri.port}"
            val origin = "$scheme://$host$port"
            return ServerAddress(origin, URI(origin))
        }

        private fun port(uri: URI): Int = if (uri.port != -1) uri.port else if (uri.scheme.equals("https", true)) 443 else 80

        private fun safeUri(value: String): URI? = try {
            if (value.any { it.code < 32 || it.code == 127 } || '\\' in value) null
            else URI(value).takeIf {
                it.isAbsolute && !it.isOpaque && it.host != null && it.rawUserInfo == null &&
                    it.port in -1..65535 && it.port != 0 && '%' !in (it.rawAuthority ?: "") &&
                    (it.scheme.equals("https", true) || it.scheme.equals("http", true))
            }
        } catch (_: Exception) { null }
    }
}
