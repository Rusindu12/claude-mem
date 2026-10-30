package com.rsaitrader.core.offline

import com.rsaitrader.core.network.KlineDto
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Plain indicator math used by the on-device signal engine.
 *
 * Deliberately small and explicit: every function returns `null` when there is
 * not enough data instead of inventing a value, so the engine can report
 * "insufficient data" honestly.
 */
object Indicators {

    fun closes(bars: List<KlineDto>): List<Double> = bars.map { it.close }

    fun sma(values: List<Double>, period: Int): Double? {
        if (period <= 0 || values.size < period) return null
        val window = values.subList(values.size - period, values.size)
        return window.sum() / period
    }

    /** Exponential moving average; needs at least `period` values. */
    fun ema(values: List<Double>, period: Int): Double? {
        if (period <= 0 || values.size < period) return null
        val k = 2.0 / (period + 1.0)
        var acc = values.take(period).average()
        for (i in period until values.size) {
            acc = values[i] * k + acc * (1 - k)
        }
        return acc
    }

    fun emaSeries(values: List<Double>, period: Int): List<Double> {
        if (values.size < period || period <= 0) return emptyList()
        val k = 2.0 / (period + 1.0)
        val out = ArrayList<Double>(values.size - period + 1)
        var acc = values.take(period).average()
        out.add(acc)
        for (i in period until values.size) {
            acc = values[i] * k + acc * (1 - k)
            out.add(acc)
        }
        return out
    }

    /** Wilder's RSI (0..100). */
    fun rsi(values: List<Double>, period: Int = 14): Double? {
        if (values.size < period + 1) return null
        var gain = 0.0
        var loss = 0.0
        for (i in 1..period) {
            val diff = values[i] - values[i - 1]
            if (diff >= 0) gain += diff else loss += -diff
        }
        var avgGain = gain / period
        var avgLoss = loss / period
        for (i in period + 1 until values.size) {
            val diff = values[i] - values[i - 1]
            val g = if (diff > 0) diff else 0.0
            val l = if (diff < 0) -diff else 0.0
            avgGain = (avgGain * (period - 1) + g) / period
            avgLoss = (avgLoss * (period - 1) + l) / period
        }
        if (avgLoss == 0.0) return 100.0
        val rs = avgGain / avgLoss
        return 100.0 - 100.0 / (1.0 + rs)
    }

    data class Macd(val line: Double, val signal: Double, val histogram: Double)

    fun macd(values: List<Double>, fast: Int = 12, slow: Int = 26, signalPeriod: Int = 9): Macd? {
        val fastSeries = emaSeries(values, fast)
        val slowSeries = emaSeries(values, slow)
        if (fastSeries.isEmpty() || slowSeries.isEmpty()) return null
        val offset = slow - fast
        if (fastSeries.size <= offset) return null
        val diffs = ArrayList<Double>(fastSeries.size - offset)
        for (i in offset until fastSeries.size) diffs.add(fastSeries[i] - slowSeries[i - offset])
        if (diffs.size < signalPeriod) return null
        val signal = ema(diffs, signalPeriod) ?: return null
        val line = diffs.last()
        return Macd(line = line, signal = signal, histogram = line - signal)
    }

    fun atr(bars: List<KlineDto>, period: Int = 14): Double? {
        if (bars.size < period + 1) return null
        val trueRanges = ArrayList<Double>(bars.size - 1)
        for (i in 1 until bars.size) {
            val high = bars[i].high
            val low = bars[i].low
            val prevClose = bars[i - 1].close
            trueRanges.add(maxOf(high - low, abs(high - prevClose), abs(low - prevClose)))
        }
        if (trueRanges.size < period) return null
        var acc = trueRanges.take(period).average()
        for (i in period until trueRanges.size) {
            acc = (acc * (period - 1) + trueRanges[i]) / period
        }
        return acc
    }

    data class Bollinger(val middle: Double, val upper: Double, val lower: Double, val bandwidthPct: Double)

    fun bollinger(values: List<Double>, period: Int = 20, deviations: Double = 2.0): Bollinger? {
        if (values.size < period) return null
        val window = values.subList(values.size - period, values.size)
        val mean = window.average()
        val variance = window.sumOf { (it - mean) * (it - mean) } / period
        val sd = sqrt(variance)
        return Bollinger(
            middle = mean,
            upper = mean + deviations * sd,
            lower = mean - deviations * sd,
            bandwidthPct = if (mean > 0) (2 * deviations * sd) / mean * 100.0 else 0.0,
        )
    }

    /** z-score of the latest volume against the previous `period` bars. */
    fun volumeZScore(bars: List<KlineDto>, period: Int = 20): Double? {
        if (bars.size < period + 1) return null
        val window = bars.subList(bars.size - period - 1, bars.size - 1).map { it.volume }
        if (window.isEmpty()) return null
        val mean = window.average()
        if (mean <= 0.0) return null
        val variance = window.sumOf { (it - mean) * (it - mean) } / window.size
        val sd = sqrt(variance)
        if (sd <= 0.0) return null
        return (bars.last().volume - mean) / sd
    }

    data class Levels(val support: Double, val resistance: Double)

    /** Nearest swing low/high over the last `lookback` bars (structural S/R, not a promise). */
    fun supportResistance(bars: List<KlineDto>, lookback: Int = 60): Levels? {
        if (bars.size < 10) return null
        val window = bars.takeLast(lookback.coerceAtMost(bars.size))
        val price = window.last().close
        val lows = window.map { it.low }.filter { it < price }.sortedDescending()
        val highs = window.map { it.high }.filter { it > price }.sorted()
        val support = lows.firstOrNull() ?: window.minOf { it.low }
        val resistance = highs.firstOrNull() ?: window.maxOf { it.high }
        return Levels(support, resistance)
    }

    /** Simple regime classification from trend slope and ATR%. */
    fun regime(bars: List<KlineDto>): Pair<String, String> {
        val close = bars.map { it.close }
        val fast = ema(close, 20)
        val slow = ema(close, 50)
        val atr = atr(bars, 14)
        val price = close.lastOrNull() ?: 0.0
        val atrPct = if (price > 0 && atr != null) atr / price * 100.0 else 0.0
        val label = when {
            fast == null || slow == null -> "unknown"
            atrPct > 2.5 -> "high volatility"
            fast > slow * 1.004 -> "uptrend"
            fast < slow * 0.996 -> "downtrend"
            else -> "range"
        }
        val volState = when {
            atrPct > 2.5 -> "high"
            atrPct > 0.8 -> "normal"
            else -> "low"
        }
        return label to volState
    }
}
