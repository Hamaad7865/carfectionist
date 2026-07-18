package mu.carfection.pos.core.hardware

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** Golden bytes for the GS v 0 raster — the wire format a wrong bit corrupts silently. */
class LogoRasterTest {

    @Test
    fun `header carries GS v 0, row bytes and height little-endian`() {
        val out = LogoRaster.encode(paperDots = 16, imgW = 16, imgH = 2) { _, _ -> false }
        // GS v 0 m=0, xL=2 xH=0 (2 bytes/row), yL=2 yH=0 (2 rows), then 4 empty data bytes.
        assertArrayEquals(
            byteArrayOf(0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0, 0, 0, 0),
            out,
        )
    }

    @Test
    fun `pixels pack MSB-first`() {
        // Single row, 8 dots on 8-dot paper; black at x=0 and x=7 → 1000 0001.
        val out = LogoRaster.encode(paperDots = 8, imgW = 8, imgH = 1) { x, _ -> x == 0 || x == 7 }
        assertEquals(0x81.toByte(), out.last())
    }

    @Test
    fun `narrow logo is centred on the paper`() {
        // 8-dot-wide all-black logo on 32-dot paper → offset (32-8)/2 = 12 dots:
        // row bits 0000 0000 | 0000 1111 | 1111 0000 | 0000 0000.
        val out = LogoRaster.encode(paperDots = 32, imgW = 8, imgH = 1) { _, _ -> true }
        assertArrayEquals(
            byteArrayOf(0x00, 0x0F, 0xF0.toByte(), 0x00),
            out.copyOfRange(out.size - 4, out.size),
        )
    }

    @Test
    fun `tall image height spills into yH`() {
        val out = LogoRaster.encode(paperDots = 8, imgW = 1, imgH = 300) { _, _ -> false }
        assertEquals(44, out[6].toInt() and 0xFF) // 300 = 44 + 1*256
        assertEquals(1, out[7].toInt() and 0xFF)
    }
}
