package com.rsaitrader.data

import android.content.Context
import androidx.core.content.edit
import com.rsaitrader.BuildConfig

/**
 * Which backend the app talks to.
 *
 * Defaults to the URL baked in at build time (`rsaiBaseUrl` Gradle property).
 * A user can override it from the sign-in screen or Settings, which is what makes
 * a single APK usable against a phone-reachable server without a rebuild.
 *
 * Only the *backend* URL is configurable. Exchange credentials never live on the
 * device and the app never talks to Binance directly.
 */
class ServerConfig(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("rsai_prefs", Context.MODE_PRIVATE)

    /** Effective base URL, always ending with a slash. */
    fun baseUrl(): String {
        val override = prefs.getString(KEY_BASE_URL, null)?.trim()
        val raw = if (!override.isNullOrBlank()) override else BuildConfig.API_BASE_URL
        return normalize(raw)
    }

    val isOverridden: Boolean get() = !prefs.getString(KEY_BASE_URL, null).isNullOrBlank()

    fun setBaseUrl(url: String?) {
        if (url.isNullOrBlank()) {
            prefs.edit { remove(KEY_BASE_URL) }
        } else {
            prefs.edit { putString(KEY_BASE_URL, normalize(url)) }
        }
    }

    fun reset() = prefs.edit { remove(KEY_BASE_URL) }

    companion object {
        private const val KEY_BASE_URL = "backend_base_url"

        fun normalize(url: String): String {
            val trimmed = url.trim()
            val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
            return withScheme.trimEnd('/') + "/"
        }

        /** Validation shared by the UI so a typo is caught before it reaches Retrofit. */
        fun validate(url: String): String? {
            val normalized = normalize(url)
            if (normalized == "http://" || normalized == "https://") return "Enter a server address."
            if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
                return "The address must start with http:// or https://"
            }
            val host = normalized.removePrefix("http://").removePrefix("https://").substringBefore("/")
            if (host.isBlank() || host.contains(" ")) return "That does not look like a host name or IP."
            return null
        }

        /** True for loopback / private addresses where cleartext HTTP is a dev-only choice. */
        fun isPrivateHost(url: String): Boolean {
            val host = normalize(url).removePrefix("http://").removePrefix("https://").substringBefore("/").substringBefore(":")
            return host == "localhost" ||
                host == "10.0.2.2" ||
                host == "127.0.0.1" ||
                host.startsWith("192.168.") ||
                host.startsWith("10.") ||
                Regex("^172\\.(1[6-9]|2\\d|3[01])\\.").containsMatchIn(host)
        }
    }
}
