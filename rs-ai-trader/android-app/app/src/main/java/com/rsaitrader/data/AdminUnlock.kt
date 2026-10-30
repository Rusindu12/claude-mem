package com.rsaitrader.data

import android.content.Context
import androidx.core.content.edit
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Device-local administrator unlock.
 *
 * In on-device mode there is no server to hand out an `admin` role, so the admin
 * panel is opened with a code that is verified **and hashed on the phone**. The
 * rules that keep this from becoming a backdoor:
 *
 *  * the code is compared against a PBKDF2-HMAC-SHA256 hash (120k iterations,
 *    per-install salt) — the plaintext is never written anywhere;
 *  * five wrong attempts lock the gate for a minute, and the delay doubles up to
 *    fifteen minutes, so it cannot be brute-forced on the device;
 *  * the unlock expires after 15 minutes and is memory-only, never persisted;
 *  * it only opens local views (accounts, audit, kill switch, pairs). It cannot
 *    grant a server role, read exchange keys, or enable live trading — those
 *    paths do not exist in the APK.
 *
 * The first-run default code is [DEFAULT_CODE]; users are prompted to replace it
 * in Settings → Admin unlock. This is a deliberate product decision by the app
 * owner, not a mechanism that protects a multi-tenant server.
 */
class AdminUnlock(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("rsai_admin_unlock", Context.MODE_PRIVATE)

    @Volatile
    private var unlockedAtMillis: Long = 0L

    val isUnlocked: Boolean
        get() {
            val at = unlockedAtMillis
            if (at == 0L) return false
            if (System.currentTimeMillis() - at > UNLOCK_TTL_MILLIS) {
                unlockedAtMillis = 0L
                return false
            }
            return true
        }

    val isUsingDefaultCode: Boolean get() = prefs.getBoolean(KEY_DEFAULT, true)

    val remainingLockSeconds: Int
        get() {
            val until = prefs.getLong(KEY_LOCKED_UNTIL, 0L)
            val remaining = until - System.currentTimeMillis()
            return if (remaining > 0) ((remaining + 999) / 1000).toInt() else 0
        }

    sealed interface Result {
        data object Unlocked : Result
        data class Wrong(val attemptsLeft: Int) : Result
        data class Locked(val seconds: Int) : Result
    }

    fun unlock(code: String): Result {
        val lockSeconds = remainingLockSeconds
        if (lockSeconds > 0) return Result.Locked(lockSeconds)
        ensureSeeded()
        val salt = prefs.getString(KEY_SALT, null) ?: return Result.Wrong(0)
        val hash = prefs.getString(KEY_HASH, null) ?: return Result.Wrong(0)
        return if (hashMatches(code, salt, hash)) {
            prefs.edit {
                putInt(KEY_FAILS, 0)
                remove(KEY_LOCKED_UNTIL)
            }
            unlockedAtMillis = System.currentTimeMillis()
            Result.Unlocked
        } else {
            val fails = prefs.getInt(KEY_FAILS, 0) + 1
            if (fails >= MAX_ATTEMPTS) {
                val delaySeconds = (30L shl (fails - MAX_ATTEMPTS).coerceAtMost(4)).coerceAtMost(900L)
                prefs.edit {
                    putInt(KEY_FAILS, 0)
                    putLong(KEY_LOCKED_UNTIL, System.currentTimeMillis() + delaySeconds * 1000)
                }
                Result.Locked(delaySeconds.toInt())
            } else {
                prefs.edit { putInt(KEY_FAILS, fails) }
                Result.Wrong(MAX_ATTEMPTS - fails)
            }
        }
    }

    fun lock() {
        unlockedAtMillis = 0L
    }

    /** Replace the code. Requires the current code, not just an unlocked session. */
    fun changeCode(currentCode: String, newCode: String): String? {
        ensureSeeded()
        val salt = prefs.getString(KEY_SALT, null) ?: return "Unlock is not initialised."
        val hash = prefs.getString(KEY_HASH, null) ?: return "Unlock is not initialised."
        if (!hashMatches(currentCode, salt, hash)) return "The current code is not correct."
        if (newCode.length < 6) return "Use at least 6 characters for the new code."
        if (newCode == currentCode) return "Choose a code that is different from the current one."
        val newSalt = newSalt()
        prefs.edit {
            putString(KEY_SALT, newSalt)
            putString(KEY_HASH, hash(newCode, newSalt))
            putBoolean(KEY_DEFAULT, false)
            putInt(KEY_FAILS, 0)
            remove(KEY_LOCKED_UNTIL)
        }
        unlockedAtMillis = System.currentTimeMillis()
        return null
    }

    private fun ensureSeeded() {
        if (prefs.contains(KEY_HASH)) return
        val salt = newSalt()
        prefs.edit {
            putString(KEY_SALT, salt)
            putString(KEY_HASH, hash(DEFAULT_CODE, salt))
            putBoolean(KEY_DEFAULT, true)
            putInt(KEY_FAILS, 0)
        }
    }

    private fun newSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return Base64.getEncoder().encodeToString(bytes)
    }

    private fun hash(code: String, salt: String): String {
        val spec = PBEKeySpec(code.toCharArray(), Base64.getDecoder().decode(salt), ITERATIONS, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return Base64.getEncoder().encodeToString(factory.generateSecret(spec).encoded)
    }

    private fun hashMatches(code: String, salt: String, expected: String): Boolean =
        runCatching { hash(code, salt) == expected }.getOrDefault(false)

    companion object {
        /** First-run code. Change it in Settings → Admin unlock. */
        const val DEFAULT_CODE = "RS2011"
        private const val ITERATIONS = 120_000
        private const val MAX_ATTEMPTS = 5
        private const val UNLOCK_TTL_MILLIS = 15L * 60L * 1000L
        private const val KEY_SALT = "salt"
        private const val KEY_HASH = "hash"
        private const val KEY_FAILS = "fails"
        private const val KEY_LOCKED_UNTIL = "locked_until"
        private const val KEY_DEFAULT = "using_default"
    }
}
