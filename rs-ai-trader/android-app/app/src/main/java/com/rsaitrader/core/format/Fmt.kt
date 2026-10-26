package com.rsaitrader.core.format

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Formatting helpers shared by every screen. Never rounds in a misleading way. */
object Fmt {

    private val dayFmt = DateTimeFormatter.ofPattern("dd MMM", Locale.US)
    private val timeFmt = DateTimeFormatter.ofPattern("HH:mm:ss", Locale.US)
    private val dateTimeFmt = DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm", Locale.US)

    fun parseInstant(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return runCatching { Instant.parse(raw) }
            .recoverCatching {
                // Python isoformat may omit the trailing Z.
                Instant.parse(if (raw.endsWith("Z")) raw else "${raw}Z")
            }
            .getOrNull()
    }

    fun time(raw: String?): String = parseInstant(raw)?.atZone(ZoneId.systemDefault())?.format(timeFmt) ?: "—"

    fun dateTime(raw: String?): String =
        parseInstant(raw)?.atZone(ZoneId.systemDefault())?.format(dateTimeFmt) ?: "—"

    fun day(raw: String?): String = parseInstant(raw)?.atZone(ZoneId.systemDefault())?.format(dayFmt) ?: "—"

    fun clock(): String = timeFmt.format(java.time.LocalTime.now())

    fun age(seconds: Double?): String {
        if (seconds == null) return "unknown"
        val s = seconds.toLong()
        return when {
            s < 2 -> "just now"
            s < 60 -> "${s}s ago"
            s < 3600 -> "${s / 60}m ago"
            s < 86_400 -> "${s / 3600}h ago"
            else -> "${s / 86_400}d ago"
        }
    }

    fun since(instant: Instant?): String {
        if (instant == null) return "—"
        val d = Duration.between(instant, Instant.now())
        val s = d.seconds
        return when {
            s < 60 -> "${s}s ago"
            s < 3600 -> "${s / 60}m ago"
            s < 86_400 -> "${s / 3600}h ago"
            else -> "${s / 86_400}d ago"
        }
    }

    /** Prices: keep Binance tick precision for small values, thousands separators for big ones. */
    fun price(value: Double?): String = price(value?.let { BigDecimal.valueOf(it).toPlainString() })

    fun price(value: String?): String {
        val dec = value?.toBigDecimalOrNull() ?: return "—"
        val abs = dec.abs()
        val scale = when {
            abs >= BigDecimal("1000") -> 2
            abs >= BigDecimal.ONE -> 4
            abs >= BigDecimal("0.01") -> 5
            else -> 8
        }
        return dec.setScale(scale, RoundingMode.HALF_UP).toPlainString()
    }

    fun amount(value: String?): String {
        val dec = value?.toBigDecimalOrNull() ?: return "—"
        return dec.stripTrailingZeros().toPlainString()
    }

    fun usdt(value: String?): String {
        val dec = value?.toBigDecimalOrNull() ?: return "—"
        return "$" + dec.setScale(2, RoundingMode.HALF_UP).toPlainString()
    }

    fun usdt(value: Double): String = usdt(BigDecimal.valueOf(value).toPlainString())

    fun usdtSigned(value: String?): String {
        val dec = value?.toBigDecimalOrNull() ?: return "—"
        val sign = if (dec.signum() >= 0) "+" else "-"
        return "$sign$" + dec.abs().setScale(2, RoundingMode.HALF_UP).toPlainString()
    }

    fun percent(value: Double?, digits: Int = 2): String =
        if (value == null) "—" else String.format(Locale.US, "%.${digits}f%%", value)

    fun percent(value: String?): String {
        val dec = value?.toBigDecimalOrNull() ?: return "—"
        return "${dec.setScale(2, RoundingMode.HALF_UP).toPlainString()}%"
    }

    fun signedPercent(value: Double?): String {
        if (value == null) return "—"
        val sign = if (value >= 0) "+" else ""
        return String.format(Locale.US, "%s%.2f%%", sign, value)
    }

    fun compactVolume(value: Double?): String {
        if (value == null) return "—"
        val abs = kotlin.math.abs(value)
        return when {
            abs >= 1_000_000_000 -> String.format(Locale.US, "%.2fB", value / 1_000_000_000)
            abs >= 1_000_000 -> String.format(Locale.US, "%.2fM", value / 1_000_000)
            abs >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000)
            else -> String.format(Locale.US, "%.2f", value)
        }
    }

    /** "BTCUSDT" -> "BTC / USDT" for labels. */
    fun pair(symbol: String): String {
        val quote = listOf("USDT", "FDUSD", "BUSD", "USDC", "BTC", "ETH", "BNB")
            .firstOrNull { symbol.endsWith(it) && symbol.length > it.length }
            ?: return symbol
        return symbol.dropLast(quote.length) + " / " + quote
    }

    fun base(symbol: String): String = pair(symbol).substringBefore(" / ")

    fun modeLabel(mode: String): String = if (mode.lowercase() == "live") "LIVE SPOT" else "PAPER"

    fun jsonish(value: Any?): String = when (value) {
        null -> "—"
        is String -> value
        is Number -> if (value.toDouble() == value.toLong().toDouble()) value.toLong().toString() else value.toString()
        else -> value.toString()
    }
}

/** Parse a user-typed decimal without throwing. Returns null for garbage. */
fun String.toDecimalOrNull(): BigDecimal? = runCatching { BigDecimal(this.trim()) }.getOrNull()
