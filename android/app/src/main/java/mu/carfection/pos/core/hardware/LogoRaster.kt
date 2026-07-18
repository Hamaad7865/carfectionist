package mu.carfection.pos.core.hardware

/**
 * ESC/POS raster image (GS v 0, normal density) — how the studio logo gets onto
 * thermal paper, the way Cashmag prints its header. Pure byte-work with the
 * pixels read through a lambda, so the encoding is unit-testable on the JVM
 * without any Android graphics.
 */
object LogoRaster {
    /**
     * Encode an [imgW]×[imgH] image onto a full-[paperDots]-wide canvas, centred
     * horizontally. Padding into the canvas (rather than trusting ESC a) is
     * deliberate: raster blocks ignore text alignment on many printers, and a
     * deterministic canvas is testable byte-for-byte.
     */
    fun encode(paperDots: Int, imgW: Int, imgH: Int, isBlack: (x: Int, y: Int) -> Boolean): ByteArray {
        require(imgW in 1..paperDots) { "logo ($imgW dots) wider than paper ($paperDots)" }
        require(imgH >= 1)
        val bytesPerRow = (paperDots + 7) / 8
        val xOff = (paperDots - imgW) / 2
        val data = ByteArray(bytesPerRow * imgH)
        for (y in 0 until imgH) {
            for (x in 0 until imgW) {
                if (isBlack(x, y)) {
                    val dot = xOff + x
                    val i = y * bytesPerRow + dot / 8
                    data[i] = (data[i].toInt() or (0x80 ushr (dot % 8))).toByte()
                }
            }
        }
        return byteArrayOf(
            0x1D, 0x76, 0x30, 0x00, // GS v 0, m=0 (normal)
            (bytesPerRow and 0xFF).toByte(), ((bytesPerRow shr 8) and 0xFF).toByte(),
            (imgH and 0xFF).toByte(), ((imgH shr 8) and 0xFF).toByte(),
        ) + data
    }
}
