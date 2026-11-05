package app.campusnet.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
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
        prefs.edit().putStringSet("recent_servers", recent().filterNot { it == origin }.toSet()).apply()
    }

    fun batteryAsked(): Boolean = prefs.getBoolean("battery_asked", false)

    fun setBatteryAsked() {
        prefs.edit().putBoolean("battery_asked", true).apply()
    }
}

sealed class Probe {
    data class Ok(val origin: String, val name: String) : Probe()
    data class NotCampusNet(val detail: String? = null) : Probe()
    object Unreachable : Probe()
}

private val probeSslContext: SSLContext by lazy {
    SSLContext.getInstance("TLS").apply {
        val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
            override fun getAcceptedIssuers() = emptyArray<java.security.cert.X509Certificate>()
            override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) = Unit
            override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) = Unit
        })
        init(null, trustAll, java.security.SecureRandom())
    }
}

suspend fun probe(origin: String): Probe = withContext(Dispatchers.IO) {
    var connection: HttpURLConnection? = null
    try {
        connection = URL("$origin/healthz").openConnection() as HttpURLConnection
        connection.connectTimeout = 4500
        connection.readTimeout = 4500
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = true
        if (connection is HttpsURLConnection) {
            connection.sslSocketFactory = probeSslContext.socketFactory
            connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
        }
        val status = connection.responseCode
        if (status !in 200..299) return@withContext Probe.NotCampusNet("HTTP $status")
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val health = runCatching { JSONObject(body) }.getOrNull()
            ?: return@withContext Probe.NotCampusNet("Invalid health response")
        if (health.optBoolean("ok") != true) return@withContext Probe.NotCampusNet("Not a CampusNet server")

        connection.disconnect()
        connection = URL("$origin/api/info").openConnection() as HttpURLConnection
        connection.connectTimeout = 4500
        connection.readTimeout = 4500
        connection.requestMethod = "GET"
        if (connection is HttpsURLConnection) {
            connection.sslSocketFactory = probeSslContext.socketFactory
            connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
        }
        val infoStatus = connection.responseCode
        val name = if (infoStatus in 200..299) {
            runCatching {
                JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                    .optString("name", "CampusNet")
                    .ifBlank { "CampusNet" }
            }.getOrDefault("CampusNet")
        } else {
            "CampusNet"
        }
        Probe.Ok(origin, name)
    } catch (_: Exception) {
        Probe.Unreachable
    } finally {
        connection?.disconnect()
    }
}
