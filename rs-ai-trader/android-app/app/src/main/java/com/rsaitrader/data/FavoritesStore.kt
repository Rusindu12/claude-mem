package com.rsaitrader.data

import android.content.Context
import androidx.core.content.edit

/**
 * Watchlist ordering + favourites. Not secret material, so plain prefs are fine;
 * it never contains tokens, keys or account identifiers beyond symbols.
 */
class FavoritesStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("rsai_prefs", Context.MODE_PRIVATE)

    fun favorites(): List<String> =
        prefs.getString(KEY_FAVORITES, null)
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotBlank() }
            ?: DEFAULT

    fun toggle(symbol: String): List<String> {
        val current = favorites().toMutableList()
        if (!current.remove(symbol)) current.add(0, symbol)
        prefs.edit { putString(KEY_FAVORITES, current.joinToString(",")) }
        return current
    }

    fun isFavorite(symbol: String): Boolean = favorites().contains(symbol)

    fun language(): String = prefs.getString(KEY_LANGUAGE, "en") ?: "en"

    fun setLanguage(lang: String) = prefs.edit { putString(KEY_LANGUAGE, lang) }

    fun lastSymbol(): String = prefs.getString(KEY_LAST_SYMBOL, "BTCUSDT") ?: "BTCUSDT"

    fun setLastSymbol(symbol: String) = prefs.edit { putString(KEY_LAST_SYMBOL, symbol) }

    fun onboardingDone(): Boolean = prefs.getBoolean(KEY_ONBOARDING, false)

    /**
     * Where data comes from: "device" (built-in on-device engine, no server) or
     * "server" (the authenticated backend). Defaults to on-device so a fresh
     * install works with no infrastructure.
     */
    fun dataSource(): String = prefs.getString(KEY_DATA_SOURCE, "device") ?: "device"

    fun setDataSource(source: String) = prefs.edit { putString(KEY_DATA_SOURCE, source) }

    fun setOnboardingDone(done: Boolean) = prefs.edit { putBoolean(KEY_ONBOARDING, done) }

    private companion object {
        const val KEY_FAVORITES = "favorites"
        const val KEY_LANGUAGE = "assistant_language"
        const val KEY_LAST_SYMBOL = "last_symbol"
        const val KEY_ONBOARDING = "onboarding_done"
        const val KEY_DATA_SOURCE = "data_source"
        val DEFAULT = listOf("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT")
    }
}
