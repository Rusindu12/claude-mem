package com.rsaitrader.core.offline

import com.rsaitrader.core.network.BacktestRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Pure-Kotlin checks for the on-device engine (no Android framework needed).
 *
 * These assert the properties the app relies on: the simulator is deterministic,
 * produces sane numbers, and the signal engine never emits an impossible verdict
 * or fabricates a probability.
 */
class OfflineEngineTest {

    private val at = Instant.parse("2026-01-15T12:00:00Z")

    @Test
    fun pricesAreDeterministicAndPositive() {
        val first = SampleMarket.price("BTCUSDT", at)
        val second = SampleMarket.price("BTCUSDT", at)
        assertEquals(first, second, 0.0)
        assertTrue("price must be positive", first > 0.0)
        for (symbol in SampleMarket.defaultSymbols) {
            val price = SampleMarket.price(symbol, at)
            assertTrue("$symbol price", price > 0.0 && price.isFinite())
        }
    }

    @Test
    fun candlesAreConsistent() {
        val bars = SampleMarket.klines("ETHUSDT", "1h", 200, at)
        assertEquals(200, bars.size)
        for (bar in bars) {
            assertTrue("high >= low", bar.high >= bar.low)
            assertTrue("high >= open", bar.high >= bar.open)
            assertTrue("high >= close", bar.high >= bar.close)
            assertTrue("low <= open", bar.low <= bar.open)
            assertTrue("low <= close", bar.low <= bar.close)
            assertTrue("volume positive", bar.volume > 0.0)
        }
        // The same request must return the same history (no reshuffling on refresh).
        val again = SampleMarket.klines("ETHUSDT", "1h", 200, at)
        assertEquals(bars.map { it.close }, again.map { it.close })
    }

    @Test
    fun indicatorsMatchKnownValues() {
        val closes = listOf(1.0, 2.0, 3.0, 4.0, 5.0)
        // SMA of the last three values of [1..5] is (3 + 4 + 5) / 3
        assertEquals(4.0, Indicators.sma(closes, 3)!!, 1e-9)
        assertNull(Indicators.sma(closes, 6))
        // A monotonically rising series has no losses, so RSI is 100.
        assertEquals(100.0, Indicators.rsi(closes, 3)!!, 1e-9)
        assertNotNull(Indicators.ema(bars().map { it.close }, 20))
        assertNotNull(Indicators.atr(bars(), 14))
        assertNotNull(Indicators.bollinger(listOf(1.0, 2.0, 3.0, 4.0, 5.0), 3))
    }

    @Test
    fun signalIsHonest() {
        val signal = OfflineSignalEngine.generate("BTCUSDT", "1h", at)
        assertTrue(signal.action in setOf("BUY", "SELL", "HOLD"))
        assertTrue("evidence grade", signal.evidenceGrade in setOf("none", "weak", "moderate", "strong"))
        assertNull("no invented probability", signal.probabilityUp)
        assertNull("no invented probability", signal.probabilityDown)
        assertEquals("unavailable", signal.modelStatus)
        assertTrue("synthetic data must be labelled", signal.synthetic)
        assertTrue("reasons must be present", signal.reasons.isNotEmpty())
        if (signal.action == "HOLD") {
            assertNull(signal.stopLoss)
        } else {
            assertNotNull(signal.stopLoss)
            assertNotNull(signal.takeProfit)
            assertNotNull(signal.riskReward)
            assertTrue(signal.riskReward!! > 0.0)
        }
    }

    @Test
    fun unknownTimeframeFallsBackSafely() {
        val signal = OfflineSignalEngine.generate("SOLUSDT", "3s", at)
        assertEquals("1h", signal.timeframe)
    }

    @Test
    fun backtestProducesFiniteMetrics() {
        val result = OfflineSignalEngine.backtest(
            BacktestRequest(symbol = "BTCUSDT", timeframe = "1h", days = 30),
            at,
        )
        assertTrue(result.bars > 100)
        assertTrue(result.metrics.totalReturnPct.isFinite())
        assertTrue(result.metrics.maxDrawdownPct >= 0.0)
        assertTrue(result.metrics.finalEquity.isFinite())
        assertTrue("costs must be modelled", result.assumptions.any { it.contains("slippage") })
        assertTrue("simulated data must be disclosed", result.warnings.any { it.contains("simulated") })
    }

    private fun bars() = SampleMarket.klines("BTCUSDT", "1h", 120, at)
}
