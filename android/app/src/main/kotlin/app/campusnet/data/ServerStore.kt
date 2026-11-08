package app.campusnet.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLException
import java.net.URI
import java.net.URL
import java.util.Locale
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

object Address {
    fun candidates(raw: String): List<String> {
        val value = raw.trim().trimEnd('/')
        if (value.isEmpty()) return emptyList()
        val inputs = if (value.matches(Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://.*"))) {
            listOf(value)
        } else {
            listOf("https://$value", "http://$value")
        }
        return inputs.mapNotNull { candidate ->
            runCatching {
                val uri = URI(candidate)
                val scheme = uri.scheme?.lowercase(Locale.ROOT)
                val host = uri.host
                if ((scheme != "http" && scheme != "https") || host.isNullOrBlank()) return@runCatching null
                URI(scheme, null, host, uri.port, uri.path?.takeIf { it.isNotBlank() && it != "/" }, null, null)
                    .toASCIIString().trimEnd('/')
            }.getOrNull()
        }.distinct()
    }

    fun label(origin: String): String = runCatching {
        val uri = URI(origin)
        buildString {
            append(uri.host ?: origin)
            if (uri.port >= 0) append(":").append(uri.port)
            uri.path?.takeIf { it.isNotBlank() && it != "/" }?.let { append(it) }
        }
    }.getOrDefault(origin.removePrefix("https://").removePrefix("http://").trimEnd('/'))
}

class ServerStore(context: Context) {
    private val prefs = context.getSharedPreferences("campusnet_servers", Context.MODE_PRIVATE)

    fun last(): String = prefs.getString("last_server", "").orEmpty()

    fun setLast(origin: String) {
        prefs.edit().putString("last_server", origin).apply()
    }

    fun recent(): List<String> = prefs.getStringSet("recent_servers", emptySet())
        .orEmpty().toList().sortedBy { it.lowercase(Locale.ROOT) }

    fun add(origin: String) {
        val updated = (recent().filterNot { it == origin } + origin).takeLast(8)
        prefs.edit().putStringSet("recent_servers", updated.toSet()).putString("last_server", origin).apply()
    }

    fun remove(origin: String) {
        prefs.edit().putStringSet("recent_servers", recent().filterNot { it == origin }.toSet()).remove("pin:$origin").apply()
    }

    fun pin(origin: String): String? = prefs.getString("pin:$origin", null)

    fun setPin(origin: String, pin: String?) {
        prefs.edit().apply { if (pin == null) remove("pin:$origin") else putString("pin:$origin", pin) }.apply()
    }

    fun batteryAsked(): Boolean = prefs.getBoolean("battery_asked", false)

    fun setBatteryAsked() {
        prefs.edit().putBoolean("battery_asked", true).apply()
    }
}

sealed class Probe {
    data class Ok(val origin: String, val name: String, val pin: String? = null) : Probe()
    object CertChanged : Probe()
    data class NotCampusNet(val detail: String? = null) : Probe()
    object Unreachable : Probe()
}

object Pins {
    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

internal class CapturingTrust(private val expected: String?) : X509TrustManager {
    @Volatile var seen: String? = null
    @Volatile var mismatch = false

    override fun getAcceptedIssuers() = emptyArray<X509Certificate>()

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val fingerprint = Pins.sha256Hex(chain[0].encoded)
        seen = fingerprint
        if (expected != null && expected != fingerprint) {
            mismatch = true
            throw CertificateException("certificate changed")
        }
    }
}

private fun httpGet(url: String, trust: CapturingTrust?): Pair<Int, String> {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.connectTimeout = 4500
        connection.readTimeout = 4500
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = true
        if (trust != null && connection is HttpsURLConnection) {
            connection.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(trust), SecureRandom()) }.socketFactory
            connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
        }
        val status = connection.responseCode
        val body = if (status in 200..299) connection.inputStream.bufferedReader().use { it.readText() } else ""
        return status to body
    } finally {
        connection.disconnect()
    }
}

suspend fun probe(origin: String, pinned: String? = null): Probe = withContext(Dispatchers.IO) {
    var trust: CapturingTrust? = null
    fun fetch(path: String): Pair<Int, String> {
        try {
            return httpGet(origin + path, trust)
        } catch (e: SSLException) {
            if (!origin.startsWith("https://") || trust != null) throw e
            val capturing = CapturingTrust(pinned)
            trust = capturing
            return httpGet(origin + path, capturing)
        }
    }
    try {
        val (status, body) = fetch("/healthz")
        if (status !in 200..299) return@withContext Probe.NotCampusNet("HTTP $status")
        val health = runCatching { JSONObject(body) }.getOrNull()
            ?: return@withContext Probe.NotCampusNet("Invalid health response")
        if (health.optBoolean("ok") != true) return@withContext Probe.NotCampusNet("Not a CampusNet server")
        val (infoStatus, infoBody) = fetch("/api/info")
        val name = if (infoStatus in 200..299) {
            runCatching { JSONObject(infoBody).optString("name", "CampusNet").ifBlank { "CampusNet" } }.getOrDefault("CampusNet")
        } else {
            "CampusNet"
        }
        Probe.Ok(origin, name, trust?.seen)
    } catch (_: Exception) {
        if (trust?.mismatch == true) Probe.CertChanged else Probe.Unreachable
    }
}
