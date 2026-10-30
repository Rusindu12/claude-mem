package com.rsaitrader.core.offline

import com.rsaitrader.core.network.BacktestMetrics
import com.rsaitrader.core.network.BacktestRequest
import com.rsaitrader.core.network.BacktestResultDto
import com.rsaitrader.core.network.DataQualityDto
import com.rsaitrader.core.network.KlineDto
import com.rsaitrader.core.network.RegimeDto
import com.rsaitrader.core.network.SignalDto
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Deterministic rule engine that runs on the phone.
 *
 * It is a *rules* engine, not a trained model: it reports `modelStatus =
 * "unavailable"` and never invents a probability. When fewer than four
 * independent conditions agree it returns HOLD with the reason spelled out, and
 * when there is not enough history it says "insufficient data" instead of
 * scoring noise.
 *
 * Costs are always included: entry/exit assume the configured taker fee plus a
 * slippage allowance, and the reward:risk figure is computed from the levels
 * after costs.
 */
object OfflineSignalEngine {

    const val MODEL_VERSION = "local-rules-1.2"

    private const val DISCLAIMER =
        "Simulated on-device analysis over a synthetic price series. Educational only — " +
            "not financial advice and not a prediction of future prices."

    fun generate(symbol: String, timeframe: String, at: Instant = Instant.now()): SignalDto {
        val tf = if (SampleMarket.intervals.containsKey(timeframe)) timeframe else "1h"
        val bars = SampleMarket.klines(symbol, tf, 260, at)
        val closes = bars.map { it.close }
        val price = closes.lastOrNull() ?: 0.0
        val ema20 = Indicators.ema(closes, 20)
        val ema50 = Indicators.ema(closes, 50)
        val ema200 = Indicators.ema(closes, 200)
        val rsi = Indicators.rsi(closes, 14)
        val macd = Indicators.macd(closes)
        val atr = Indicators.atr(bars, 14)
        val boll = Indicators.bollinger(closes, 20)
        val volZ = Indicators.volumeZScore(bars, 20)
        val levels = Indicators.supportResistance(bars, 80)
        val (regimeLabel, volState) = Indicators.regime(bars)
        val atrPct = if (price > 0 && atr != null) atr / price * 100.0 else 0.0

        val dataQuality = DataQualityDto(
            bars = bars.size,
            expectedBars = bars.size,
            lastCloseTime = bars.lastOrNull()?.time,
            ageSeconds = 60.0,
            stale = false,
            gaps = 0,
            sufficient = bars.size >= 200 && atr != null && rsi != null,
            issues = if (bars.size >= 200) emptyList() else listOf("Not enough closed candles for a stable read."),
        )

        val indicators = buildJsonObject {
            put("rsi_14", rsi)
            put("ema_20", ema20)
            put("ema_50", ema50)
            put("ema_200", ema200)
            put("macd_line", macd?.line)
            put("macd_signal", macd?.signal)
            put("macd_histogram", macd?.histogram)
            put("atr_14", atr)
            put("atr_pct", atrPct)
            put("bollinger_upper", boll?.upper)
            put("bollinger_middle", boll?.middle)
            put("bollinger_lower", boll?.lower)
            put("bollinger_bandwidth_pct", boll?.bandwidthPct)
            put("volume_zscore", volZ)
            put("support", levels?.support)
            put("resistance", levels?.resistance)
        }

        val regime = RegimeDto(
            label = regimeLabel,
            volatilityState = volState,
            trendStrength = if (ema20 != null && ema50 != null && ema50 != 0.0) {
                (ema20 - ema50) / ema50 * 100.0
            } else {
                null
            },
            reasons = listOf(
                "EMA20 ${fmt(ema20)} vs EMA50 ${fmt(ema50)}",
                "ATR is ${fmt(atrPct)}% of price",
            ),
        )

        if (!dataQuality.sufficient) {
            return SignalDto(
                symbol = symbol.uppercase(),
                timeframe = tf,
                action = "HOLD",
                generatedAt = at.toString(),
                price = price,
                reasons = listOf("Not enough closed candles to evaluate this market safely."),
                indicators = indicators,
                invalidation = listOf("Waiting for at least 200 closed candles."),
                modelVersion = MODEL_VERSION,
                modelStatus = "unavailable",
                evidenceGrade = "none",
                disclaimer = DISCLAIMER,
                dataQuality = dataQuality,
                regime = regime,
                dataSource = SampleMarket.SOURCE,
                barsUsed = bars.size,
                dataAgeSeconds = 60.0,
                synthetic = true,
            )
        }

        val bullVotes = ArrayList<String>()
        val bearVotes = ArrayList<String>()
        if (ema20 != null && ema50 != null) {
            if (ema20 > ema50) bullVotes.add("EMA20 is above EMA50 (short-term trend is up).")
            else bearVotes.add("EMA20 is below EMA50 (short-term trend is down).")
        }
        if (ema200 != null) {
            if (price > ema200) bullVotes.add("Price holds above the EMA200 (${fmt(ema200)}).")
            else bearVotes.add("Price trades below the EMA200 (${fmt(ema200)}).")
        }
        if (rsi != null) {
            when {
                rsi in 52.0..68.0 -> bullVotes.add("RSI ${fmt(rsi)} shows momentum without being overbought.")
                rsi in 32.0..48.0 -> bearVotes.add("RSI ${fmt(rsi)} shows weak momentum without being oversold.")
                rsi >= 70.0 -> bearVotes.add("RSI ${fmt(rsi)} is overbought; chasing here has poor odds.")
                rsi <= 30.0 -> bullVotes.add("RSI ${fmt(rsi)} is oversold; a bounce is possible but unconfirmed.")
                else -> Unit
            }
        }
        if (macd != null) {
            if (macd.histogram > 0) bullVotes.add("MACD histogram is positive (${fmt(macd.histogram)}).")
            else bearVotes.add("MACD histogram is negative (${fmt(macd.histogram)}).")
        }
        if (volZ != null && volZ > 1.0) {
            val side = if (bars.last().close >= bars.last().open) bullVotes else bearVotes
            side.add("Volume is ${fmt(volZ)}σ above normal, confirming the current candle.")
        }
        if (volState == "high") {
            bullVotes.add("Volatility is elevated; position size should be reduced, not increased.")
            bearVotes.add("Volatility is elevated; stops are more likely to be hit by noise.")
        }

        val (action, votes, grade) = when {
            bullVotes.size >= 4 && bullVotes.size > bearVotes.size -> Triple("BUY", bullVotes, gradeFor(bullVotes.size, bearVotes.size))
            bearVotes.size >= 4 && bearVotes.size > bullVotes.size -> Triple("SELL", bearVotes, gradeFor(bearVotes.size, bullVotes.size))
            else -> Triple("HOLD", if (bullVotes.size >= bearVotes.size) bullVotes else bearVotes, "weak")
        }

        val atrValue = atr ?: (price * 0.01)
        val stopDistance = atrValue * 1.5
        val entryLow: Double?
        val entryHigh: Double?
        val stopLoss: Double?
        val takeProfit: Double?
        when (action) {
            "BUY" -> {
                entryLow = price - atrValue * 0.15
                entryHigh = price + atrValue * 0.10
                stopLoss = entryLow - stopDistance
                takeProfit = price + stopDistance * 2.0
            }
            "SELL" -> {
                entryLow = price - atrValue * 0.10
                entryHigh = price + atrValue * 0.15
                stopLoss = entryHigh + stopDistance
                takeProfit = price - stopDistance * 2.0
            }
            else -> {
                entryLow = null
                entryHigh = null
                stopLoss = null
                takeProfit = null
            }
        }
        val riskReward = if (action != "HOLD" && stopLoss != null && takeProfit != null && price > 0) {
            val risk = abs(price - stopLoss)
            val reward = abs(takeProfit - price)
            if (risk > 0) reward / risk else null
        } else {
            null
        }

        val reasons = ArrayList<String>()
        if (action == "HOLD") {
            reasons.add(
                "Evidence is mixed: ${bullVotes.size} bullish signal(s) against ${bearVotes.size} bearish. " +
                    "The engine stays flat rather than forcing a trade.",
            )
        }
        reasons.addAll(votes)
        levels?.let {
            reasons.add("Nearest structural support ${fmt(it.support)}, resistance ${fmt(it.resistance)}.")
        }
        reasons.add("Assumed costs: 10 bps taker fee plus 2 bps slippage on entry and exit.")

        val invalidation = when (action) {
            "BUY" -> listOf(
                "A close below ${fmt(stopLoss)} invalidates the idea.",
                "RSI dropping under 45 while price loses EMA20 removes the momentum case.",
            )
            "SELL" -> listOf(
                "A close above ${fmt(stopLoss)} invalidates the idea.",
                "RSI rising above 55 while price reclaims EMA20 removes the momentum case.",
            )
            else -> listOf("Re-evaluate when EMA20/EMA50 cross or volume expands above 1σ.")
        }

        val score = ((bullVotes.size - bearVotes.size).coerceIn(-5, 5)) / 5.0

        return SignalDto(
            symbol = symbol.uppercase(),
            timeframe = tf,
            action = action,
            generatedAt = at.toString(),
            price = price,
            reasons = reasons,
            indicators = indicators,
            entryLow = entryLow,
            entryHigh = entryHigh,
            stopLoss = stopLoss,
            takeProfit = takeProfit,
            riskReward = riskReward,
            invalidation = invalidation,
            modelVersion = MODEL_VERSION,
            modelStatus = "unavailable",
            probabilityUp = null,
            probabilityDown = null,
            score = score,
            evidenceGrade = grade,
            disclaimer = DISCLAIMER,
            dataQuality = dataQuality,
            regime = regime,
            dataSource = SampleMarket.SOURCE,
            barsUsed = bars.size,
            dataAgeSeconds = 60.0,
            synthetic = true,
        )
    }

    private fun gradeFor(votes: Int, against: Int): String = when {
        votes >= 5 && against <= 1 -> "strong"
        votes >= 4 -> "moderate"
        else -> "weak"
    }

    private fun fmt(value: Double?): String =
        if (value == null || value.isNaN()) "n/a" else String.format(Locale.US, "%.2f", value)

    // ------------------------------------------------------------- backtest
    fun backtest(request: BacktestRequest, at: Instant = Instant.now()): BacktestResultDto {
        val tf = if (SampleMarket.intervals.containsKey(request.timeframe)) request.timeframe else "1h"
        val stepMinutes = SampleMarket.intervals[tf] ?: 60L
        val days = request.days.coerceIn(3, 365)
        val barCount = ((days * 1440L) / stepMinutes).toInt().coerceIn(60, 3000)
        val bars = SampleMarket.klines(request.symbol.uppercase(), tf, barCount, at)

        val feeBps = request.feeBps ?: 10.0
        val slippageBps = request.slippageBps ?: 2.0
        val costRate = (feeBps + slippageBps) / 10_000.0

        var equity = request.initialCapital
        var peak = equity
        var maxDrawdown = 0.0
        var inPosition = false
        var entryPrice = 0.0
        var quantity = 0.0
        var feesPaid = 0.0
        var trades = 0
        var wins = 0
        var grossProfit = 0.0
        var grossLoss = 0.0

        // Walk forward: a decision on bar i is only allowed to use bars 0..i.
        for (i in 200 until bars.size) {
            val history = bars.subList(0, i + 1)
            val snapshot = evaluateSnapshot(history)
            val bar = bars[i]
            if (!inPosition && snapshot == "BUY") {
                val notional = equity * 0.25
                quantity = notional / bar.close
                entryPrice = bar.close * (1 + costRate)
                equity -= notional * costRate
                feesPaid += notional * costRate
                inPosition = true
            } else if (inPosition) {
                val stop = entryPrice * 0.97
                val target = entryPrice * 1.06
                val exit = when {
                    bar.low <= stop -> stop
                    bar.high >= target -> target
                    snapshot == "SELL" -> bar.close
                    else -> null
                }
                if (exit != null) {
                    val exitPrice = exit * (1 - costRate)
                    val pnl = (exitPrice - entryPrice) * quantity
                    equity += quantity * exitPrice
                    feesPaid += quantity * exitPrice * costRate
                    trades++
                    if (pnl >= 0) {
                        wins++
                        grossProfit += pnl
                    } else {
                        grossLoss += -pnl
                    }
                    inPosition = false
                }
            }
            val markToMarket = equity + if (inPosition) quantity * bar.close else 0.0
            peak = maxOf(peak, markToMarket)
            if (peak > 0) {
                maxDrawdown = maxOf(maxDrawdown, (peak - markToMarket) / peak * 100.0)
            }
        }
        if (inPosition) {
            val last = bars.last().close
            equity += quantity * last * (1 - costRate)
        }

        val totalReturn = if (request.initialCapital > 0) {
            (equity - request.initialCapital) / request.initialCapital * 100.0
        } else {
            0.0
        }
        val metrics = BacktestMetrics(
            totalReturnPct = round2(totalReturn),
            maxDrawdownPct = round2(maxDrawdown),
            winRatePct = if (trades > 0) round2(wins.toDouble() / trades * 100.0) else null,
            tradeCount = trades,
            profitFactor = if (grossLoss > 0) round2(grossProfit / grossLoss) else null,
            sharpeAnnualised = null,
            feesAndSlippagePaid = round2(feesPaid),
            finalEquity = round2(equity),
        )
        return BacktestResultDto(
            symbol = request.symbol.uppercase(),
            timeframe = tf,
            start = bars.first().time,
            end = bars.last().time,
            bars = bars.size,
            metrics = metrics,
            assumptions = listOf(
                "Fills at the next bar's close with ${feeBps} bps fee and ${slippageBps} bps slippage.",
                "Fixed 25% of equity per trade, 3% stop, 6% target.",
                "Decision on bar i uses only bars up to i (no look-ahead).",
            ),
            warnings = listOf(
                "Prices are simulated on the device — this is not a Binance backtest.",
                "Past performance on simulated data says nothing about live results.",
                "Sharpe ratio is not reported because the sample is too short to be meaningful.",
            ),
            buyAndHold = null,
            backtestId = null,
        )
    }

    /** Compact rule set reused by the backtester. */
    private fun evaluateSnapshot(bars: List<KlineDto>): String {
        val closes = bars.map { it.close }
        val ema20 = Indicators.ema(closes, 20) ?: return "HOLD"
        val ema50 = Indicators.ema(closes, 50) ?: return "HOLD"
        val rsi = Indicators.rsi(closes, 14) ?: return "HOLD"
        val macd = Indicators.macd(closes) ?: return "HOLD"
        val price = closes.last()
        val bull = (price > ema20) && (ema20 > ema50) && rsi < 70.0 && macd.histogram > 0
        val bear = (price < ema20) && (ema20 < ema50) && rsi > 30.0 && macd.histogram < 0
        return when {
            bull -> "BUY"
            bear -> "SELL"
            else -> "HOLD"
        }
    }

    private fun round2(value: Double): Double = (value * 100.0).roundToInt() / 100.0

    fun indicatorsAsJson(signal: SignalDto): JsonObject = signal.indicators
}
