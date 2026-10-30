package com.rsaitrader.core.offline

import com.rsaitrader.core.network.DepthDto
import com.rsaitrader.core.network.KlineDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.network.TradeTickDto
import java.time.Instant
import java.util.Locale
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * On-device market simulator.
 *
 * The app has to be usable with no backend at all, so prices, candles, depth and
 * trades are generated deterministically on the phone. Two rules keep this
 * honest:
 *
 *  1. every value is a pure function of (symbol, time) — refreshing does not
 *     reshuffle history, and two screens agree on the same price;
 *  2. everything produced here is tagged `synthetic = true` / `source =
 *     simulator`, and the UI shows a banner. Simulated data must never be
 *     mistaken for Binance data, and it can never be traded live: live order
 *     routing exists only in the backend.
 */
object SampleMarket {

    data class Spec(
        val symbol: String,
        val base: Double,
        val volatility: Double,
        val phase: Double,
        val quote: String = "USDT",
    )

    val specs: List<Spec> = listOf(
        Spec("BTCUSDT", 96_500.0, 1.0, 0.31),
        Spec("ETHUSDT", 3_350.0, 1.25, 1.12),
        Spec("BNBUSDT", 690.0, 1.15, 2.04),
        Spec("SOLUSDT", 198.0, 1.65, 0.77),
        Spec("XRPUSDT", 2.32, 1.4, 2.88),
        Spec("ADAUSDT", 0.92, 1.5, 1.61),
        Spec("DOGEUSDT", 0.38, 1.9, 3.42),
        Spec("AVAXUSDT", 41.5, 1.55, 0.44),
        Spec("LINKUSDT", 22.8, 1.45, 5.12),
        Spec("DOTUSDT", 7.4, 1.5, 2.31),
        Spec("MATICUSDT", 0.58, 1.7, 4.03),
        Spec("TRXUSDT", 0.27, 1.2, 3.71),
    )

    val defaultSymbols: List<String> = specs.map { it.symbol }

    const val SOURCE = "simulator"

    fun spec(symbol: String): Spec =
        specs.firstOrNull { it.symbol == symbol.uppercase() } ?: specs.first()

    fun isKnown(symbol: String): Boolean = specs.any { it.symbol == symbol.uppercase() }

    // ------------------------------------------------------------ randomness
    private fun hash(seed: Long): Long {
        var x = seed
        x = (x xor (x ushr 33)) * -0xae502812aa7333L
        x = (x xor (x ushr 29)) * -0x3b314601e57a13adL
        return x xor (x ushr 32)
    }

    /** Deterministic value in [-1, 1]. */
    private fun noise(seed: Long, index: Long): Double {
        val h = hash(seed * 0x9E3779B97F4A7C15uL.toLong() + index * 0x165667B19E3779F9uL.toLong())
        return ((h ushr 11).toDouble() / (1L shl 52).toDouble()) - 1.0
    }

    private fun symbolSeed(spec: Spec): Long = spec.symbol.fold(7L) { acc, c -> acc * 31 + c.code }

    // ----------------------------------------------------------------- price
    /** Price in quote currency at a given epoch minute. */
    fun priceAt(spec: Spec, minute: Double): Double {
        val seed = symbolSeed(spec)
        val t = minute
        val stride =
            0.20 * sin(2.0 * Math.PI * t / (60.0 * 24.0 * 19.0) + spec.phase) +
                0.055 * sin(2.0 * Math.PI * t / (60.0 * 7.5) + spec.phase * 1.7) +
                0.012 * sin(2.0 * Math.PI * t / (60.0 * 1.9) + spec.phase * 2.9) +
                0.0025 * noise(seed, floor(t).toLong())
        return spec.base * exp(stride * spec.volatility)
    }

    private fun minuteOf(instant: Instant): Double = instant.epochSecond / 60.0

    fun price(symbol: String, at: Instant = Instant.now()): Double = priceAt(spec(symbol), minuteOf(at))

    fun round(price: Double): Double = when {
        price >= 1000 -> Math.round(price * 100.0) / 100.0
        price >= 10 -> Math.round(price * 1000.0) / 1000.0
        price >= 1 -> Math.round(price * 10000.0) / 10000.0
        else -> Math.round(price * 1_000_000.0) / 1_000_000.0
    }

    // ---------------------------------------------------------------- ticker
    fun ticker(symbol: String, at: Instant = Instant.now()): TickerDto {
        val spec = spec(symbol)
        val nowMinute = minuteOf(at)
        val current = priceAt(spec, nowMinute)
        val dayAgo = priceAt(spec, nowMinute - 1440.0)
        var high = current
        var low = current
        var volume = 0.0
        var step = 0
        while (step <= 96) {
            val p = priceAt(spec, nowMinute - step * 15.0)
            high = max(high, p)
            low = min(low, p)
            volume += 12.0 + abs(noise(symbolSeed(spec), (nowMinute / 15).toLong() - step)) * 48.0
            step++
        }
        val changePct = if (dayAgo > 0) (current - dayAgo) / dayAgo * 100.0 else 0.0
        return TickerDto(
            symbol = spec.symbol,
            price = round(current),
            changePercent24h = Math.round(changePct * 100.0) / 100.0,
            high24h = round(high),
            low24h = round(low),
            volume24h = Math.round(volume * 100.0) / 100.0,
            quoteVolume24h = Math.round(volume * current * 100.0) / 100.0,
            fetchedAt = at.toString(),
            exchangeCloseTime = at.toString(),
            ageSeconds = 0.0,
            source = SOURCE,
            synthetic = true,
            stale = false,
        )
    }

    fun tickers(symbols: List<String>, at: Instant = Instant.now()): List<TickerDto> =
        (if (symbols.isEmpty()) defaultSymbols else symbols).map { ticker(it, at) }

    // ---------------------------------------------------------------- klines
    /** Supported candle intervals, in minutes, matching the backend contract. */
    val intervals: Map<String, Long> = linkedMapOf(
        "1m" to 1L,
        "5m" to 5L,
        "15m" to 15L,
        "1h" to 60L,
        "4h" to 240L,
        "1d" to 1440L,
    )

    fun klines(symbol: String, interval: String, limit: Int, at: Instant = Instant.now()): List<KlineDto> {
        val spec = spec(symbol)
        val step = intervals[interval] ?: 60L
        val seed = symbolSeed(spec)
        val nowMinute = minuteOf(at)
        val lastBucket = floor(nowMinute / step) * step
        val count = limit.coerceIn(20, 1000)
        val result = ArrayList<KlineDto>(count)
        var previousClose = priceAt(spec, lastBucket - step * count)
        for (i in 0 until count) {
            val start = lastBucket - step * (count - 1 - i)
            val close = priceAt(spec, start + step.toDouble())
            val open = previousClose
            val wick = abs(noise(seed, start.toLong())) * 0.45 + 0.08
            val high = max(open, close) * (1.0 + wick * 0.004 * spec.volatility)
            val low = min(open, close) * (1.0 - wick * 0.004 * spec.volatility)
            val volume = 40.0 + abs(noise(seed + 11, start.toLong())) * 260.0
            result.add(
                KlineDto(
                    time = Instant.ofEpochSecond((start * 60).toLong()).toString(),
                    open = round(open),
                    high = round(high),
                    low = round(low),
                    close = round(close),
                    volume = Math.round(volume * 100.0) / 100.0,
                ),
            )
            previousClose = close
        }
        return result
    }

    // ----------------------------------------------------------------- depth
    fun depth(symbol: String, limit: Int, at: Instant = Instant.now()): DepthDto {
        val spec = spec(symbol)
        val seed = symbolSeed(spec)
        val mid = price(symbol, at)
        val levels = limit.coerceIn(5, 50)
        val tick = mid * 0.0001
        val bids = ArrayList<List<Double>>(levels)
        val asks = ArrayList<List<Double>>(levels)
        for (i in 1..levels) {
            val bidSize = 0.4 + abs(noise(seed + 3, i.toLong())) * 6.0
            val askSize = 0.4 + abs(noise(seed + 5, i.toLong() + 100)) * 6.0
            bids.add(listOf(round(mid - tick * i), Math.round(bidSize * 10000.0) / 10000.0))
            asks.add(listOf(round(mid + tick * i), Math.round(askSize * 10000.0) / 10000.0))
        }
        val bestBid = bids.first()[0]
        val bestAsk = asks.first()[0]
        return DepthDto(
            symbol = spec.symbol,
            bids = bids,
            asks = asks,
            bestBid = bestBid,
            bestAsk = bestAsk,
            spreadBps = if (mid > 0) (bestAsk - bestBid) / mid * 10000.0 else null,
            imbalance = 0.5 + noise(seed + 7, floor(minuteOf(at)).toLong()) * 0.25,
            source = SOURCE,
            synthetic = true,
            updatedAt = at.toString(),
        )
    }

    // ---------------------------------------------------------------- trades
    fun trades(symbol: String, at: Instant = Instant.now(), count: Int = 30): List<TradeTickDto> {
        val spec = spec(symbol)
        val seed = symbolSeed(spec)
        val nowMinute = minuteOf(at)
        return (0 until count).map { i ->
            val minute = nowMinute - i * 0.18
            val raw = priceAt(spec, minute)
            TradeTickDto(
                id = hash(seed + i * 31L + floor(minute).toLong()),
                price = round(raw),
                quantity = Math.round((0.002 + abs(noise(seed + 13, i.toLong())) * 0.4) * 100000.0) / 100000.0,
                time = Instant.ofEpochSecond((minute * 60).toLong()).toString(),
                buyerIsMaker = noise(seed + 17, i.toLong()) < 0,
                source = SOURCE,
            )
        }
    }

    /** Bids/asks as flat strings for the order-book style screens. */
    fun formatPrice(value: Double): String = String.format(Locale.US, "%.6f", value).trimEnd('0').trimEnd('.')
}
