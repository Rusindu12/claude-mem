package com.rsaitrader.core.offline

import com.rsaitrader.core.network.OrderCreateRequest
import com.rsaitrader.core.network.OrderRequest
import com.rsaitrader.core.network.RiskPolicyUpdate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * Behavioural tests for the on-device paper/risk engine.
 *
 * These run as plain JVM unit tests (no Android, no emulator) and cover the rules
 * that must not regress: live orders are impossible, risk limits reject orders,
 * idempotency prevents double submission, and fills are net of fees.
 */
class OfflinePaperEngineTest {

    private val userId = "user-1"
    private val now: Instant = Instant.parse("2026-02-01T10:00:00Z")

    private fun engine(): OfflinePaperEngine {
        val file = File.createTempFile("rsai-test", ".json")
        file.delete()
        return OfflinePaperEngine(OfflineStore.forFile(file))
    }

    private fun buy(
        quantity: String = "0.0005",
        stopLoss: String? = "1",
        mode: String = "paper",
        key: String = "key-1",
        approved: Boolean = true,
    ) = OrderCreateRequest(
        symbol = "BTCUSDT",
        side = "BUY",
        orderType = "MARKET",
        quantity = quantity,
        stopLoss = stopLoss,
        mode = mode,
        idempotencyKey = key,
        approved = approved,
    )

    @Test
    fun marketBuyFillsNetOfFeesAndCreatesPosition() {
        val engine = engine()
        val before = engine.portfolio(userId, "paper", now)
        val result = engine.place(userId, buy(), now)
        assertTrue("order should be accepted: ${result.exceptionOrNull()?.message}", result.isSuccess)
        val order = result.getOrThrow()
        assertEquals("FILLED", order.status)
        assertTrue("fill is simulated", order.simulated)
        assertNotNull(order.averageFillPrice)

        val after = engine.portfolio(userId, "paper", now)
        assertEquals(1, after.positionCount)
        val quoteBefore = before.availableUsdt!!.toDouble()
        val quoteAfter = after.availableUsdt!!.toDouble()
        assertTrue("quote balance must fall", quoteAfter < quoteBefore)
        assertTrue("fees must be recorded", after.feesPaid!!.toDouble() > 0.0)
        // Slippage: the fill is above the reference price for a buy.
        val reference = SampleMarket.price("BTCUSDT", now)
        assertTrue(order.averageFillPrice!!.toDouble() > reference)
    }

    @Test
    fun liveOrdersAreImpossibleOnDevice() {
        val engine = engine()
        val attempt = engine.place(userId, buy(mode = "live", key = "live-1"), now)
        assertTrue("live must be rejected", attempt.isFailure)
        val message = attempt.exceptionOrNull()?.message ?: ""
        assertTrue("message must explain why: $message", message.contains("backend", ignoreCase = true))
        val preview = engine.preview(userId, OrderRequest("BTCUSDT", "BUY", "MARKET", "0.0005", mode = "live", stopLoss = "1"), now)
        assertFalse(preview.canPlace)
        assertTrue(preview.risk.violations.any { it.code == "mode" })
    }

    @Test
    fun notionalCapRejectsTheOrder() {
        val engine = engine()
        engine.updatePolicy(userId, RiskPolicyUpdate(maxTradeNotional = "10"))
        val preview = engine.preview(
            userId,
            OrderRequest("BTCUSDT", "BUY", "MARKET", "0.001", mode = "paper", stopLoss = "1"),
            now,
        )
        assertFalse(preview.canPlace)
        assertTrue(preview.risk.violations.any { it.code == "max_trade_notional" })
        assertTrue(engine.place(userId, buy(quantity = "0.001", key = "over-cap"), now).isFailure)
    }

    @Test
    fun missingStopLossIsRejectedForNewBuys() {
        val engine = engine()
        val preview = engine.preview(
            userId,
            OrderRequest("BTCUSDT", "BUY", "MARKET", "0.0005", mode = "paper"),
            now,
        )
        assertFalse(preview.canPlace)
        assertTrue(preview.risk.violations.any { it.code == "stop_loss_required" })
    }

    @Test
    fun idempotencyKeyNeverCreatesASecondOrder() {
        val engine = engine()
        val first = engine.place(userId, buy(key = "same-key"), now).getOrThrow()
        val second = engine.place(userId, buy(key = "same-key"), now).getOrThrow()
        assertEquals(first.id, second.id)
        assertTrue("replay must be flagged", second.idempotentReplay)
        assertEquals(1, engine.orders(userId, "paper", false).size)
    }

    @Test
    fun unapprovedOrderIsRefused() {
        val engine = engine()
        val result = engine.place(userId, buy(key = "no-approval", approved = false), now)
        assertTrue(result.isFailure)
        assertTrue(engine.orders(userId, "paper", false).isEmpty())
    }

    @Test
    fun sellingRealisesPnl() {
        val engine = engine()
        engine.place(userId, buy(key = "open-1"), now)
        val sell = OrderCreateRequest(
            symbol = "BTCUSDT",
            side = "SELL",
            orderType = "MARKET",
            quantity = "0.0005",
            mode = "paper",
            idempotencyKey = "close-1",
            approved = true,
        )
        val result = engine.place(userId, sell, now)
        assertTrue("sell should fill: ${result.exceptionOrNull()?.message}", result.isSuccess)
        val portfolio = engine.portfolio(userId, "paper", now)
        assertEquals(0, portfolio.positionCount)
        val realized = portfolio.realizedPnl?.toDoubleOrNull() ?: 0.0
        assertTrue("round trip must cost fees and slippage, got $realized", realized < 0.0)
    }

    @Test
    fun killSwitchBlocksNewOrders() {
        val engine = engine()
        engine.setKillSwitch(true, "drill")
        val preview = engine.preview(
            userId,
            OrderRequest("BTCUSDT", "BUY", "MARKET", "0.0005", mode = "paper", stopLoss = "1"),
            now,
        )
        assertFalse(preview.canPlace)
        assertTrue(preview.risk.violations.any { it.code == "kill_switch" })
        assertTrue(engine.place(userId, buy(key = "killed"), now).isFailure)
        val status = engine.riskStatus(userId, now)
        assertTrue(status.control.killSwitch)
        assertFalse("live can never be traded on device", status.canTradeLive)
    }

    @Test
    fun duplicateWorkingOrderIsBlocked() {
        val engine = engine()
        val limit = OrderCreateRequest(
            symbol = "BTCUSDT",
            side = "BUY",
            orderType = "LIMIT",
            quantity = "0.0005",
            price = (SampleMarket.price("BTCUSDT", now) * 0.5).toString(),
            stopLoss = "1",
            mode = "paper",
            idempotencyKey = "limit-1",
            approved = true,
        )
        assertTrue(engine.place(userId, limit, now).isSuccess)
        val duplicate = limit.copy(idempotencyKey = "limit-2")
        val attempt = engine.place(userId, duplicate, now)
        assertTrue(attempt.isFailure)
        assertTrue(attempt.exceptionOrNull()?.message?.contains("identical", ignoreCase = true) == true)
    }

    @Test
    fun cancellingAnOpenOrderWorks() {
        val engine = engine()
        val limit = OrderCreateRequest(
            symbol = "BTCUSDT",
            side = "BUY",
            orderType = "LIMIT",
            quantity = "0.0005",
            price = (SampleMarket.price("BTCUSDT", now) * 0.5).toString(),
            stopLoss = "1",
            mode = "paper",
            idempotencyKey = "cancel-1",
            approved = true,
        )
        val placed = engine.place(userId, limit, now).getOrThrow()
        assertEquals("NEW", placed.status)
        val cancelled = engine.cancel(userId, placed.id, "paper")
        assertEquals("CANCELED", cancelled.status)
        assertTrue(engine.openOrders(userId).isEmpty())
        assertNull(engine.orders(userId, "paper", false).first { it.id == placed.id }.averageFillPrice)
    }

    @Test
    fun analyticsAreNetOfCosts() {
        val engine = engine()
        engine.place(userId, buy(key = "an-1"), now)
        engine.place(
            userId,
            OrderCreateRequest(
                symbol = "BTCUSDT",
                side = "SELL",
                orderType = "MARKET",
                quantity = "0.0005",
                mode = "paper",
                idempotencyKey = "an-2",
                approved = true,
            ),
            now,
        )
        val analytics = engine.analytics(userId, "paper", 30, now)
        assertEquals(1, analytics.summary.tradeCount)
        assertNotNull(analytics.summary.feesPaid)
        assertTrue(analytics.costAssumptions!!.takerFeeBps > 0.0)
        assertTrue(analytics.daily.any { it.toString().contains("cumulative_pnl") })
    }
}
