package app.mola.mobile

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun normalizesHttpsRootAndDefaultPort() {
        assertEquals("https://mola.example", ServerAddress.parse(" MOLA.example/ ").origin)
        assertEquals("https://mola.example", ServerAddress.parse("https://mola.example:443/").origin)
        assertEquals("https://mola.example:8443", ServerAddress.parse("https://mola.example:8443").origin)
    }
    @Test fun rejectsAmbiguousOrPrivilegedAddresses() {
        listOf("", "http://mola.example", "file:///etc/passwd", "javascript:alert(1)",
            "https://user:password@mola.example", "https://mola.example/app", "https://mola.example?q=1",
            "https://mola.example#fragment", "https://mola.example\\@evil.test", "https://mola.example:0",
            "https://mola.example:65536", "https://mola.example/%2e%2e", "https://mola.example\n").forEach {
            assertThrows(it, IllegalArgumentException::class.java) { ServerAddress.parse(it) }
        }
    }
    @Test fun onlyDebugBuildMayUseExactLoopbackHttpHosts() {
        listOf("http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://10.0.2.2:3000").forEach {
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse(it) }
            assertEquals(it, ServerAddress.parse(it, allowLocalHttp = true).origin)
        }
        listOf("http://192.168.1.2", "http://localhost.evil.test", "http://127.0.0.2").forEach {
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse(it, true) }
        }
    }
    @Test fun navigationRequiresExactOriginAndExternalUserGesture() {
        val server = ServerAddress.parse("https://mola.example")
        assertEquals(Navigation.INTERNAL, server.navigation("https://mola.example/channel?a=1", false))
        assertEquals(Navigation.INTERNAL, server.navigation("https://MOLA.example:443/path", false))
        assertEquals(Navigation.BLOCK, server.navigation("https://evil.test", false))
        assertEquals(Navigation.EXTERNAL, server.navigation("https://evil.test", true))
        assertEquals(Navigation.BLOCK, server.navigation("http://mola.example", true))
        assertEquals(Navigation.BLOCK, server.navigation("intent://mola", true))
        assertEquals(Navigation.BLOCK, server.navigation("javascript:alert(1)", true))
        assertEquals(Navigation.BLOCK, server.navigation("https://user@mola.example", true))
        assertFalse(server.isSameOrigin("https://mola.example:444"))
    }
    @Test fun authenticatedDownloadOnlyAcceptsCanonicalAttachmentRoutes() {
        val server = ServerAddress.parse("https://mola.example")
        val path = "/api/files/550e8400-e29b-41d4-a716-446655440000"
        assertTrue(server.isAttachment("https://mola.example$path"))
        listOf("https://evil.test$path", "http://mola.example$path", "https://mola.example$path?x=1",
            "https://mola.example$path#x", "https://mola.example/api/files/../admin",
            "https://mola.example/api/files/%35%35", "https://mola.example/api/files/test.js").forEach {
            assertFalse(it, server.isAttachment(it))
        }
    }
}
