package app.campusnet

import app.campusnet.data.Address
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressTest {
    @Test
    fun emptyInputHasNoCandidates() {
        assertTrue(Address.candidates("   ").isEmpty())
    }

    @Test
    fun bareHostTriesHttpsThenHttp() {
        assertEquals(
            listOf("https://192.168.1.5:3000", "http://192.168.1.5:3000"),
            Address.candidates("192.168.1.5:3000"),
        )
    }

    @Test
    fun explicitSchemeIsKeptAndTrailingSlashRemoved() {
        assertEquals(listOf("http://example.com"), Address.candidates("http://example.com/"))
    }

    @Test
    fun unsupportedSchemeIsRejected() {
        assertTrue(Address.candidates("ftp://example.com").isEmpty())
    }

    @Test
    fun labelShowsHostAndPort() {
        assertEquals("192.168.1.5:3000", Address.label("http://192.168.1.5:3000"))
        assertEquals("example.com", Address.label("https://example.com"))
    }
}
