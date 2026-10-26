package com.rsaitrader.core.network

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Session storage backed by the Android Keystore (EncryptedSharedPreferences).
 *
 * Only the *backend* session tokens live here. Binance API keys never touch the
 * device: they are entered once in Settings and sent straight to the backend,
 * which encrypts them at rest.
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        // Never fall back to plaintext storage: an unusable keystore means the
        // user must sign in again, not that secrets get written unencrypted.
        InMemoryPreferences()
    }

    private val json = Json { ignoreUnknownKeys = true }

    @Synchronized
    fun save(tokens: TokenPair) {
        prefs.edit()
            .putString(KEY_ACCESS, tokens.accessToken)
            .putString(KEY_REFRESH, tokens.refreshToken)
            .putString(KEY_USER, json.encodeToString(UserDto.serializer(), tokens.user))
            .apply()
    }

    @Synchronized
    fun updateAccess(accessToken: String, refreshToken: String) {
        prefs.edit().putString(KEY_ACCESS, accessToken).putString(KEY_REFRESH, refreshToken).apply()
    }

    fun accessToken(): String? = prefs.getString(KEY_ACCESS, null)

    fun refreshToken(): String? = prefs.getString(KEY_REFRESH, null)

    fun user(): UserDto? = prefs.getString(KEY_USER, null)?.let {
        runCatching { json.decodeFromString(UserDto.serializer(), it) }.getOrNull()
    }

    fun saveUser(user: UserDto) {
        prefs.edit().putString(KEY_USER, json.encodeToString(UserDto.serializer(), user)).apply()
    }

    fun isSignedIn(): Boolean = !accessToken().isNullOrBlank()

    val isAdmin: Boolean get() = user()?.role == "admin"

    @Synchronized
    fun clear() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).remove(KEY_USER).apply()
    }

    private class InMemoryPreferences : SharedPreferences {
        private val values = mutableMapOf<String, String?>()
        override fun getAll(): Map<String, *> = values
        override fun getString(key: String, defValue: String?): String? = values[key] ?: defValue
        override fun getStringSet(key: String, defValues: MutableSet<String>?) = defValues
        override fun getInt(key: String, defValue: Int) = defValue
        override fun getLong(key: String, defValue: Long) = defValue
        override fun getFloat(key: String, defValue: Float) = defValue
        override fun getBoolean(key: String, defValue: Boolean) = defValue
        override fun contains(key: String) = values.containsKey(key)
        override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
            private val pending = mutableMapOf<String, String?>()
            override fun putString(key: String, value: String?) = apply { pending[key] = value }
            override fun putStringSet(key: String, values: MutableSet<String>?) = apply { }
            override fun putInt(key: String, value: Int) = apply { }
            override fun putLong(key: String, value: Long) = apply { }
            override fun putFloat(key: String, value: Float) = apply { }
            override fun putBoolean(key: String, value: Boolean) = apply { }
            override fun remove(key: String) = apply { pending[key] = null }
            override fun clear() = apply { pending["*"] = null }
            override fun commit(): Boolean { apply(); return true }
            override fun apply() { values.putAll(pending) }
        }
        override fun registerOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?,
        ) = Unit
        override fun unregisterOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?,
        ) = Unit
    }

    companion object {
        const val FILE_NAME = "rsai_secure_prefs"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_USER = "user_json"
    }
}

@Serializable
data class OnboardingState(val completed: Boolean = false, val language: String = "en")
