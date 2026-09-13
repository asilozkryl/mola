package app.mola.mobile

import org.junit.Assert.*
import org.junit.Test

class AttachmentDownloaderTest {
    @Test fun respectsEncodedFilenameWithoutTurningPlusIntoSpace() {
        assertEquals("rapor+eylül.pdf", AttachmentDownloader.fileName("attachment; filename=\"download\"; filename*=UTF-8''rapor+eyl%C3%BCl.pdf", "application/pdf"))
    }
    @Test fun sanitizesPathAndMakesMimeExtensionExplicit() {
        assertEquals("_.._script.exe.txt", AttachmentDownloader.fileName("attachment; filename=\"../../script.exe\"", "text/plain"))
        assertEquals("Mola-dosya.png", AttachmentDownloader.fileName(null, "image/png"))
        assertEquals("picture.jpg", AttachmentDownloader.fileName("inline; filename=\"picture.jpg\"", "image/jpeg"))
    }
}
