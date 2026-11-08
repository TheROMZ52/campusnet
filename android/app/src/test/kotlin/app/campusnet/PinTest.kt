package app.campusnet

import app.campusnet.data.CapturingTrust
import app.campusnet.data.Pins
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

class PinTest {
    private val pem = """
-----BEGIN CERTIFICATE-----
MIIDFTCCAf2gAwIBAgIUI7AOooRLZNaeaQsvWo2ScX7QZ4MwDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOY2FtcHVzbmV0LXRlc3QwIBcNMjYxMTA4MDMyMzI2WhgP
MjEyNjEwMTUwMzIzMjZaMBkxFzAVBgNVBAMMDmNhbXB1c25ldC10ZXN0MIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnTqRvPk6lxd2iDt93hzBiyIjQV3w
M8opgDuROMpbG4s1DG6EFtTLF/LfVgDAGKP8Ix0adeHGdvCRmyZ1tmHWJRy6Nz2i
OhJenR6IoN5M69foqnixtbbERcszg2RDcHXZsxF+szSz+0zMOerqqSgRerhkeFdy
8RLxAG+xdnS1k/f6nBPCVLJ4Be/rC2cMv4bIGKbw2a3/PZTk1wOiBn3Y7y90qW3+
MYU3pL9bQAoKSJUEgs0crWDEyeeoq/+6d0soHVjckCwK6uUqxH/vhC2rR0Zxr0Ov
uPisvpfwugN8G8BFZWCmkXuDDWuzvOzrYJY4wn7dhV/vpqr/7KguRl7tJwIDAQAB
o1MwUTAdBgNVHQ4EFgQUUfafMTmGEOU8b/Up4uhTdI0Dui8wHwYDVR0jBBgwFoAU
UfafMTmGEOU8b/Up4uhTdI0Dui8wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEAHsAg5bEXbS5EiId5YxOpoZ7L9DL+OTLAv7ncw73r1c5w2+eyt5uA
uCoR4UIkPLpuKv9vFGwD5V1ZNAIERYcDvN5TSWmzblPjLyr4EaSMvrI4owP0JMBu
q7Ox9cp2WFiwg/Li1KYtzwRRRSIawvcCKqa9B6QS+s8rZHKCeYf0a5rgdk7WAKf/
/nqQ1gDwdrYJaS8qT7MBjp0yQBNFDgI95dD9xId5I7kP4NEZAEmeh7Q5CEpmZFg0
TgcqhbPUK3z9o46KLfGQ2w9avYo6cqt+vXOvwlZi8/6flxDpsBjyvDRz0LRrTvik
BjIxmxaByZAb2BfPvXc0KDEwNvFXDT2K7Q==
-----END CERTIFICATE-----
""".trimIndent()
    private val fingerprint = "56d6b4ce1216b63a32f446140b8d32d8052b94a9a4b3c9ea29649bd2a92c2317"

    private fun certificate(): X509Certificate =
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(pem.toByteArray())) as X509Certificate

    @Test
    fun sha256OfAbcMatchesTheKnownValue() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Pins.sha256Hex("abc".toByteArray()))
    }

    @Test
    fun fingerprintOfTheCertificateMatchesOpenssl() {
        assertEquals(fingerprint, Pins.sha256Hex(certificate().encoded))
    }

    @Test
    fun firstConnectionAcceptsAndRecordsTheFingerprint() {
        val trust = CapturingTrust(null)
        trust.checkServerTrusted(arrayOf(certificate()), "RSA")
        assertEquals(fingerprint, trust.seen)
        assertFalse(trust.mismatch)
    }

    @Test
    fun matchingPinIsAccepted() {
        val trust = CapturingTrust(fingerprint)
        trust.checkServerTrusted(arrayOf(certificate()), "RSA")
        assertFalse(trust.mismatch)
    }

    @Test
    fun differentPinIsRejected() {
        val trust = CapturingTrust("0".repeat(64))
        assertThrows(CertificateException::class.java) { trust.checkServerTrusted(arrayOf(certificate()), "RSA") }
        assertTrue(trust.mismatch)
        assertEquals(fingerprint, trust.seen)
    }

    @Test
    fun noPinWasSeenBeforeAnyHandshake() {
        assertNull(CapturingTrust(null).seen)
    }
}
