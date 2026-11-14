package mu.carfection.pos.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-11-14: a wiped till came back as two "new tablets". The code must be the same every
 * time the same tablet asks, and the fingerprint must never be something many devices share.
 */
class DeviceIdentityTest {

    @Test
    fun `the same tablet always gets the same code`() {
        val hw = DeviceIdentity.hardwareId("a1b2c3d4e5f60718")
        assertEquals(DeviceIdentity.codeFor(hw), DeviceIdentity.codeFor(DeviceIdentity.hardwareId("a1b2c3d4e5f60718")))
        assertTrue(DeviceIdentity.codeFor(hw).matches(Regex("TAB-[0-9A-F]{6}")))
    }

    @Test
    fun `different tablets get different fingerprints`() {
        assertNotEquals(DeviceIdentity.hardwareId("a1b2c3d4e5f60718"), DeviceIdentity.hardwareId("a1b2c3d4e5f60719"))
    }

    @Test
    fun `the raw android id never leaves the tablet`() {
        val hw = DeviceIdentity.hardwareId("a1b2c3d4e5f60718")!!
        assertEquals(64, hw.length)
        assertTrue("a1b2c3d4e5f60718" !in hw)
    }

    @Test
    fun `untrustworthy ids give no fingerprint and a random code`() {
        assertNull(DeviceIdentity.hardwareId(null))
        assertNull(DeviceIdentity.hardwareId(""))
        assertNull(DeviceIdentity.hardwareId("9774d56d682e549c")) // shared by a broken Android build
        assertNull(DeviceIdentity.hardwareId("0000000000000000"))
        assertTrue(DeviceIdentity.codeFor(null).matches(Regex("TAB-[0-9A-F]{6}")))
    }
}
