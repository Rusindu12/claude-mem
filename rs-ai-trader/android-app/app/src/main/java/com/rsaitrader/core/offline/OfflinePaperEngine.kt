package com.rsaitrader.core.offline

import com.rsaitrader.core.network.AnalyticsDto
import com.rsaitrader.core.network.AnalyticsSummaryDto
import com.rsaitrader.core.network.BalanceDto
import com.rsaitrader.core.network.CancelResponse
import com.rsaitrader.core.network.CostAssumptionsDto
import com.rsaitrader.core.network.MarketContextDto
import com.rsaitrader.core.network.OrderCreateRequest
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.core.network.OrderPreviewDto
import com.rsaitrader.core.network.OrderRequest
import com.rsaitrader.core.network.PortfolioDto
import com.rsaitrader.core.network.PositionDto
import com.rsaitrader.core.network.RiskCheckDto
import com.rsaitrader.core.network.RiskDecisionDto
import com.rsaitrader.core.network.RiskPolicyDto
import com.rsaitrader.core.network.RiskPolicyUpdate
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.core.network.RiskUsageDto
import com.rsaitrader.core.network.RiskViolationDto
import com.rsaitrader.core.network.ServerRiskConfigDto
import com.rsaitrader.core.network.TradingControlDto
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.abs

/**
 * Paper-trading and risk engine that runs entirely on the device.
 *
 * Rules that matter and are enforced here, not in the UI:
 *  * an order is never reported as filled before this engine has filled it;
 *  * live mode is rejected — routing a real order requires the backend;
 *  * every risk check is evaluated server-side-style (here: engine-side) and a
 *    single failed check rejects the order;
 *  * the same idempotency key never creates a second order;
 *  * fills include taker fee and slippage, and realised P&L is net of fees.
 */
class OfflinePaperEngine(private val store: OfflineStore) {

    companion object {
        const val TAKER_FEE_BPS = 10.0
        const val SLIPPAGE_BPS = 2.0
        const val MIN_NOTIONAL = 5.0
        const val DEFAULT_EQUITY = "10000"
    }

    private val feeRate = TAKER_FEE_BPS / 10_000.0
    private val slippageRate = SLIPPAGE_BPS / 10_000.0

    // ---------------------------------------------------------------- account
    fun account(userId: String): LocalPaperAccount {
        store.state().paper[userId]?.let { return it }
        val fresh = LocalPaperAccount(
            userId = userId,
            startingEquity = DEFAULT_EQUITY,
            quoteBalance = DEFAULT_EQUITY,
            resetAt = store.now(),
        )
        store.update { it.copy(paper = it.paper + (userId to fresh)) }
        return fresh
    }

    fun reset(userId: String, startingEquity: String) {
        val equity = startingEquity.toDoubleOrNull()?.takeIf { it > 0 } ?: DEFAULT_EQUITY.toDouble()
        store.update { state ->
            state.copy(
                paper = state.paper + (userId to LocalPaperAccount(
                    userId = userId,
                    startingEquity = num(equity),
                    quoteBalance = num(equity),
                    resetAt = store.now(),
                )),
                orders = state.orders.filterNot { it.userId == userId && it.mode == "paper" },
                positions = state.positions.filterNot { it.userId == userId },
            )
        }
        store.audit(userId, "user", "paper_reset", mapOf("equity" to num(equity)))
    }

    // ----------------------------------------------------------------- policy
    fun policy(userId: String): RiskPolicyDto =
        store.state().riskPolicies[userId] ?: RiskPolicyDto()

    fun updatePolicy(userId: String, body: RiskPolicyUpdate): RiskPolicyDto {
        val current = policy(userId)
        val next = current.copy(
            maxTradeNotional = body.maxTradeNotional ?: current.maxTradeNotional,
            maxPortfolioExposurePct = body.maxPortfolioExposurePct ?: current.maxPortfolioExposurePct,
            maxDailyLoss = body.maxDailyLoss ?: current.maxDailyLoss,
            maxRiskPerTradePct = body.maxRiskPerTradePct ?: current.maxRiskPerTradePct,
            maxOpenOrders = body.maxOpenOrders ?: current.maxOpenOrders,
            maxOpenPositions = body.maxOpenPositions ?: current.maxOpenPositions,
            stopLossRequired = body.stopLossRequired ?: current.stopLossRequired,
            cooldownAfterLosses = body.cooldownAfterLosses ?: current.cooldownAfterLosses,
            cooldownMinutes = body.cooldownMinutes ?: current.cooldownMinutes,
            automationOptIn = body.automationOptIn ?: current.automationOptIn,
            liveOptIn = false,
        )
        store.update { it.copy(riskPolicies = it.riskPolicies + (userId to next)) }
        store.audit(userId, "user", "risk_policy_updated")
        return next
    }

    fun emergencyStop(userId: String) {
        store.update {
            it.copy(
                killSwitch = LocalKillSwitch(
                    engaged = true,
                    reason = "Emergency stop triggered by the user",
                    activatedAt = store.now(),
                ),
            )
        }
        store.notify(userId, "risk", "Emergency stop engaged", "New orders are blocked until the kill switch is released.", "critical")
        store.audit(userId, "user", "emergency_stop")
    }

    fun setKillSwitch(engaged: Boolean, reason: String) {
        store.update {
            it.copy(
                killSwitch = if (engaged) {
                    LocalKillSwitch(engaged = true, reason = reason, activatedAt = store.now())
                } else {
                    LocalKillSwitch(engaged = false, reason = null, activatedAt = null)
                },
            )
        }
    }

    // -------------------------------------------------------------- portfolio
    fun processOpenOrders(userId: String, at: Instant = Instant.now()) {
        val working = store.state().orders.filter {
            it.userId == userId && it.mode == "paper" && (it.status == "NEW" || it.status == "PARTIALLY_FILLED")
        }
        working.forEach { order ->
            val price = SampleMarket.price(order.symbol, at)
            val limit = order.price?.toDoubleOrNull() ?: return@forEach
            val crossable = when (order.side) {
                "BUY" -> price <= limit
                "SELL" -> price >= limit
                else -> false
            }
            if (crossable) fill(order, limit, at)
        }
    }

    fun portfolio(userId: String, mode: String, at: Instant = Instant.now()): PortfolioDto {
        if (mode == "live") {
            return PortfolioDto(
                mode = "live",
                simulated = false,
                note = "Live exchange balances are only available through the backend, which holds the API keys. " +
                    "This build is running on the device with no server, so no live balance can be shown.",
                canTrade = false,
                totalValueUsdt = "0",
                updatedAt = at.toString(),
            )
        }
        processOpenOrders(userId, at)
        val state = store.state()
        val account = account(userId)
        val positions = state.positions.filter { it.userId == userId }
        val positionDtos = positions.map { position -> positionDto(position, at) }
        val holdings = positionDtos.sumOf { (it.marketValue ?: "0").toDoubleOrNull() ?: 0.0 }
        val unrealized = positionDtos.sumOf { (it.unrealizedPnl ?: "0").toDoubleOrNull() ?: 0.0 }
        val quote = account.quoteBalance.toDoubleOrNull() ?: 0.0
        val total = quote + holdings
        val equity = account.startingEquity.toDoubleOrNull() ?: total
        val balances = ArrayList<BalanceDto>()
        balances.add(
            BalanceDto(
                asset = "USDT",
                free = num(quote),
                locked = num(openOrders(userId).sumOf { it.price?.toDoubleOrNull()?.times(it.quantity.toDoubleOrNull() ?: 0.0) ?: 0.0 }),
                usdtValue = num(quote),
            ),
        )
        positions.forEach { position ->
            val price = SampleMarket.price(position.symbol, at)
            balances.add(
                BalanceDto(
                    asset = position.symbol.removeSuffix("USDT"),
                    free = position.quantity,
                    locked = "0",
                    usdtValue = num((position.quantity.toDoubleOrNull() ?: 0.0) * price),
                ),
            )
        }
        val canTrade = !state.killSwitch.engaged && state.settings.paperTradingEnabled
        return PortfolioDto(
            mode = "paper",
            simulated = true,
            environment = "simulated",
            startingEquity = account.startingEquity,
            quoteBalance = account.quoteBalance,
            totalValueUsdt = num(total),
            availableUsdt = num(quote),
            holdingsValue = num(holdings),
            realizedPnl = account.realizedPnl,
            unrealizedPnl = num(unrealized),
            feesPaid = account.feesPaid,
            exposure = if (equity > 0) num(holdings / equity * 100.0) + "%" else "0%",
            positionCount = positions.size,
            positions = positionDtos,
            balances = balances,
            note = "Simulated paper account on this device. Not real exchange balances.",
            canTrade = canTrade,
            updatedAt = at.toString(),
        )
    }

    private fun positionDto(position: LocalPosition, at: Instant): PositionDto {
        val price = SampleMarket.price(position.symbol, at)
        val qty = position.quantity.toDoubleOrNull() ?: 0.0
        val entry = position.entryPrice.toDoubleOrNull() ?: 0.0
        return PositionDto(
            id = position.id,
            symbol = position.symbol,
            quantity = position.quantity,
            entryPrice = position.entryPrice,
            currentPrice = num(price),
            unrealizedPnl = num((price - entry) * qty),
            stopLoss = position.stopLoss,
            takeProfit = position.takeProfit,
            marketValue = num(price * qty),
            openedAt = position.openedAt,
            simulated = true,
        )
    }

    // -------------------------------------------------------------- analytics
    fun analytics(userId: String, mode: String, days: Int, at: Instant = Instant.now()): AnalyticsDto {
        val window = days.coerceIn(1, 365)
        val state = store.state()
        val account = account(userId)
        val closed = state.orders.filter {
            it.userId == userId && it.mode == "paper" && (it.status == "FILLED" || it.status == "CANCELED") &&
                it.realizedPnl != null
        }
        val start = LocalDate.now(ZoneOffset.UTC).minusDays(window.toLong() - 1)
        val perDay = LinkedHashMap<String, MutableList<LocalOrder>>()
        closed.forEach { order ->
            val day = order.closedAt?.take(10) ?: order.createdAt.take(10)
            if (day >= start.toString()) {
                perDay.getOrPut(day) { ArrayList() }.add(order)
            }
        }
        var cumulative = 0.0
        val daily = ArrayList<JsonObject>()
        var worstDay = 0.0
        var running = 0.0
        val startEquity = account.startingEquity.toDoubleOrNull() ?: 0.0
        for (i in 0 until window) {
            val day = start.plusDays(i.toLong()).toString()
            val orders = perDay[day] ?: emptyList()
            val realized = orders.sumOf { it.realizedPnl?.toDoubleOrNull() ?: 0.0 }
            cumulative += realized
            running += realized
            worstDay = minOf(worstDay, running)
            daily.add(
                buildJsonObject {
                    put("date", day)
                    put("realized_pnl", num(realized))
                    put("trades", orders.size)
                    put("cumulative_pnl", num(cumulative))
                    put(
                        "drawdown_pct",
                        num(if (startEquity > 0) abs(running) / startEquity * 100.0 else 0.0),
                    )
                },
            )
        }
        val portfolio = portfolio(userId, "paper", at)
        val equity = portfolio.totalValueUsdt.toDoubleOrNull() ?: 0.0
        val starting = account.startingEquity.toDoubleOrNull() ?: 0.0
        val wins = closed.count { (it.realizedPnl?.toDoubleOrNull() ?: 0.0) > 0 }
        val grossWin = closed.sumOf { maxOf(it.realizedPnl?.toDoubleOrNull() ?: 0.0, 0.0) }
        val grossLoss = closed.sumOf { maxOf(-(it.realizedPnl?.toDoubleOrNull() ?: 0.0), 0.0) }
        val summary = AnalyticsSummaryDto(
            equity = num(equity),
            realizedPnl = account.realizedPnl,
            unrealizedPnl = portfolio.unrealizedPnl,
            feesPaid = account.feesPaid,
            returnPct = if (starting > 0) num((equity - starting) / starting * 100.0) else "0",
            maxDrawdownPct = num(if (starting > 0) abs(worstDay) / starting * 100.0 else 0.0),
            winRatePct = if (closed.isNotEmpty()) num(wins.toDouble() / closed.size * 100.0) else null,
            tradeCount = closed.size,
            profitFactor = if (grossLoss > 0) num(grossWin / grossLoss) else null,
        )
        return AnalyticsDto(
            mode = "paper",
            simulated = true,
            windowDays = window,
            summary = summary,
            daily = daily,
            note = "Computed from simulated paper trades on this device, net of fees and slippage.",
            costAssumptions = CostAssumptionsDto(takerFeeBps = TAKER_FEE_BPS, slippageBps = SLIPPAGE_BPS),
        )
    }

    // ---------------------------------------------------------------- preview
    fun preview(userId: String, request: OrderRequest, at: Instant = Instant.now()): OrderPreviewDto {
        val reference = SampleMarket.price(request.symbol, at)
        val quantity = request.quantity.toDoubleOrNull() ?: 0.0
        val limit = request.price?.toDoubleOrNull()
        val effective = if (request.orderType == "MARKET") reference else (limit ?: reference)
        val notional = quantity * effective
        val decision = riskDecision(userId, request, notional, effective, at)
        val adjustments = ArrayList<String>()
        if (quantity > 0) {
            val rounded = (quantity * 1_000_000).toLong() / 1_000_000.0
            if (rounded != quantity) adjustments.add("Quantity rounded to 6 decimals (${num(rounded)}).")
            if (notional < MIN_NOTIONAL) adjustments.add("Notional below the ${MIN_NOTIONAL} USDT minimum; the order would be rejected.")
        }
        return OrderPreviewDto(
            symbol = request.symbol.uppercase(),
            mode = request.mode,
            side = request.side,
            orderType = request.orderType,
            quantity = num(quantity),
            referencePrice = num(effective),
            estimatedNotional = num(notional),
            estimatedFeeUsdt = num(notional * feeRate),
            estimatedSlippageBps = SLIPPAGE_BPS,
            adjustments = adjustments,
            risk = decision,
            canPlace = decision.approved,
            market = MarketContextDto(
                source = SampleMarket.SOURCE,
                synthetic = true,
                stale = false,
                ageSeconds = 0.0,
                spreadBps = 2.0,
                volatilityPct = 1.0,
            ),
            filters = buildJsonObject {
                put("min_notional", num(MIN_NOTIONAL))
                put("step_size", "0.000001")
                put("tick_size", "0.000001")
            },
        )
    }

    private fun riskDecision(
        userId: String,
        request: OrderRequest,
        notional: Double,
        price: Double,
        at: Instant,
    ): RiskDecisionDto {
        val state = store.state()
        val policy = policy(userId)
        val account = account(userId)
        val working = openOrders(userId)
        val positions = state.positions.filter { it.userId == userId }
        val equity = portfolioEquity(userId, at)
        val checks = ArrayList<RiskCheckDto>()
        val violations = ArrayList<RiskViolationDto>()
        val warnings = ArrayList<String>()

        fun check(name: String, passed: Boolean, detail: String, severity: String = "block") {
            checks.add(RiskCheckDto(name = name, passed = passed, severity = severity, detail = detail))
            if (!passed && severity == "block") violations.add(RiskViolationDto(code = name, message = detail))
            if (!passed && severity == "warn") warnings.add(detail)
        }

        check("mode", request.mode != "live",
            if (request.mode == "live") {
                "Live orders need the backend, which holds the API keys. On-device mode supports paper trading only."
            } else {
                "Paper mode."
            })
        check("kill_switch", !state.killSwitch.engaged,
            if (state.killSwitch.engaged) "Trading is stopped: ${state.killSwitch.reason ?: "kill switch engaged"}." else "Trading enabled.")
        check("pair", state.settings.enabledSymbols.contains(request.symbol.uppercase()),
            if (state.settings.enabledSymbols.contains(request.symbol.uppercase())) "Pair enabled." else "${request.symbol} is disabled by the administrator.")
        check("quantity", notional > 0,
            if (notional > 0) "Quantity is positive." else "Quantity must be greater than zero.")
        check("min_notional", notional >= MIN_NOTIONAL,
            if (notional >= MIN_NOTIONAL) "Notional ${num(notional)} USDT." else "Notional ${num(notional)} USDT is below the ${MIN_NOTIONAL} USDT minimum.")
        val maxNotional = policy.maxTradeNotional.toDoubleOrNull() ?: 100.0
        check("max_trade_notional", notional <= maxNotional,
            if (notional <= maxNotional) "Within the ${num(maxNotional)} USDT per-trade cap." else "Order is ${num(notional)} USDT; the cap is ${num(maxNotional)} USDT.")
        val exposurePct = if (equity > 0) (positionsValue(userId, at) + notional) / equity * 100.0 else 0.0
        val maxExposure = policy.maxPortfolioExposurePct.toDoubleOrNull() ?: 25.0
        check("max_exposure", exposurePct <= maxExposure,
            if (exposurePct <= maxExposure) "Exposure would be ${num(exposurePct)}% of equity." else "Exposure would reach ${num(exposurePct)}%; the limit is ${num(maxExposure)}%.")
        if (request.side == "BUY" && policy.stopLossRequired) {
            val hasStop = !request.stopLoss.isNullOrBlank() || request.takeProfit.isNullOrBlank()
            check("stop_loss_required", !request.stopLoss.isNullOrBlank(),
                if (!request.stopLoss.isNullOrBlank()) "Stop-loss attached." else "A stop-loss price is required for new buys.", "block")
            if (!hasStop) warnings.add("Consider attaching a take-profit as well.")
        }
        check("max_open_orders", working.size < policy.maxOpenOrders,
            if (working.size < policy.maxOpenOrders) "${working.size} open order(s)." else "Open order limit (${policy.maxOpenOrders}) reached.")
        check("max_open_positions", request.side == "SELL" || positions.size < policy.maxOpenPositions ||
            positions.any { it.symbol == request.symbol.uppercase() },
            if (positions.size < policy.maxOpenPositions) "${positions.size} open position(s)." else "Open position limit (${policy.maxOpenPositions}) reached.")
        val duplicates = working.filter {
            it.symbol == request.symbol.uppercase() && it.side == request.side
        }
        check("duplicate_order", duplicates.isEmpty(),
            if (duplicates.isEmpty()) "No identical working order." else "An identical ${request.side} order on ${request.symbol} is already working.")
        val quote = account.quoteBalance.toDoubleOrNull() ?: 0.0
        if (request.side == "BUY") {
            check("balance", quote >= notional + notional * feeRate,
                if (quote >= notional) "Available ${num(quote)} USDT." else "Available ${num(quote)} USDT is less than the ${num(notional)} USDT order.")
        } else {
            val held = state.positions.firstOrNull { it.userId == userId && it.symbol == request.symbol.uppercase() }
                ?.quantity?.toDoubleOrNull() ?: 0.0
            val qty = request.quantity.toDoubleOrNull() ?: 0.0
            check("holdings", held >= qty,
                if (held >= qty) "Holding ${num(held)} ${request.symbol.removeSuffix("USDT")}." else "You only hold ${num(held)} of this asset.")
        }
        val dailyRealized = dailyRealizedPnl(userId, at)
        val maxDailyLoss = policy.maxDailyLoss.toDoubleOrNull() ?: 50.0
        check("daily_loss_limit", dailyRealized > -maxDailyLoss,
            if (dailyRealized > -maxDailyLoss) "Today's realised result is ${num(dailyRealized)} USDT." else "Daily loss limit hit (${num(dailyRealized)} USDT of ${num(maxDailyLoss)} USDT).")
        val cooldown = cooldownActive(userId, policy, at)
        check("cooldown", !cooldown,
            if (!cooldown) "No cooldown active." else "Paused after ${policy.cooldownAfterLosses} consecutive losses.")
        if (price <= 0.0) violations.add(RiskViolationDto(code = "price", message = "No valid reference price for this market."))
        if (state.settings.enabledSymbols.isEmpty()) warnings.add("No pairs enabled.")
        warnings.add("Simulated market data — paper results are not evidence about live performance.")
        return RiskDecisionDto(approved = violations.isEmpty(), violations = violations, warnings = warnings, checks = checks)
    }

    // ------------------------------------------------------------------ place
    fun place(userId: String, body: OrderCreateRequest, at: Instant = Instant.now()): Result<OrderDto> {
        val existing = store.state().orders.firstOrNull {
            it.userId == userId && it.idempotencyKey != null && it.idempotencyKey == body.idempotencyKey
        }
        if (existing != null) return Result.success(toDto(existing, replay = true))
        if (!body.approved) {
            return Result.failure(IllegalArgumentException("An order must be explicitly confirmed before it is placed."))
        }
        val request = OrderRequest(
            symbol = body.symbol.uppercase(),
            side = body.side.uppercase(),
            orderType = body.orderType.uppercase(),
            quantity = body.quantity,
            price = body.price,
            stopLoss = body.stopLoss,
            takeProfit = body.takeProfit,
            mode = body.mode,
            timeInForce = body.timeInForce,
            signalId = body.signalId,
        )
        val preview = preview(userId, request, at)
        if (!preview.canPlace) {
            val reason = preview.risk.violations.joinToString(" ") { it.message }
            val rejected = LocalOrder(
                id = OfflineStore.newId(),
                userId = userId,
                mode = request.mode,
                symbol = request.symbol,
                side = request.side,
                orderType = request.orderType,
                quantity = request.quantity,
                price = request.price,
                stopLoss = request.stopLoss,
                takeProfit = request.takeProfit,
                status = "REJECTED",
                idempotencyKey = body.idempotencyKey,
                createdAt = store.now(),
                rejectReason = reason.ifBlank { "Risk checks failed." },
            )
            store.update { it.copy(orders = it.orders + rejected) }
            store.audit(userId, "user", "order_rejected", mapOf("symbol" to request.symbol, "reason" to reason))
            return Result.failure(IllegalStateException(reason.ifBlank { "The risk engine rejected this order." }))
        }
        val order = LocalOrder(
            id = OfflineStore.newId(),
            userId = userId,
            mode = "paper",
            symbol = request.symbol,
            side = request.side,
            orderType = request.orderType,
            quantity = preview.quantity,
            price = request.price,
            stopLoss = request.stopLoss,
            takeProfit = request.takeProfit,
            status = "NEW",
            idempotencyKey = body.idempotencyKey,
            createdAt = store.now(),
        )
        store.update { it.copy(orders = it.orders + order) }
        val filled = if (request.orderType == "MARKET") {
            fill(order, SampleMarket.price(order.symbol, at), at)
        } else {
            null
        }
        val final = filled ?: order
        store.audit(
            userId,
            "user",
            if (final.status == "FILLED") "order_filled" else "order_open",
            mapOf("symbol" to final.symbol, "side" to final.side, "id" to final.id),
        )
        return Result.success(toDto(final))
    }

    private fun fill(order: LocalOrder, marketPrice: Double, at: Instant): LocalOrder {
        val qty = order.quantity.toDoubleOrNull() ?: 0.0
        if (qty <= 0) return order
        val side = order.side.uppercase()
        val fillPrice = if (side == "BUY") marketPrice * (1 + slippageRate) else marketPrice * (1 - slippageRate)
        val notional = fillPrice * qty
        val fee = notional * feeRate
        var realized: Double? = null
        store.update { state ->
            val account = state.paper[order.userId] ?: LocalPaperAccount(
                userId = order.userId,
                resetAt = store.now(),
            )
            val quote = account.quoteBalance.toDoubleOrNull() ?: 0.0
            val positions = state.positions.toMutableList()
            val index = positions.indexOfFirst { it.userId == order.userId && it.symbol == order.symbol }
            var newQuote = quote
            if (side == "BUY") {
                newQuote = quote - notional - fee
                if (index >= 0) {
                    val existing = positions[index]
                    val existingQty = existing.quantity.toDoubleOrNull() ?: 0.0
                    val existingEntry = existing.entryPrice.toDoubleOrNull() ?: 0.0
                    val totalQty = existingQty + qty
                    val entry = if (totalQty > 0) (existingQty * existingEntry + qty * fillPrice) / totalQty else fillPrice
                    positions[index] = existing.copy(
                        quantity = num(totalQty),
                        entryPrice = num(entry),
                        stopLoss = order.stopLoss ?: existing.stopLoss,
                        takeProfit = order.takeProfit ?: existing.takeProfit,
                    )
                } else {
                    positions.add(
                        LocalPosition(
                            id = OfflineStore.newId(),
                            userId = order.userId,
                            symbol = order.symbol,
                            quantity = num(qty),
                            entryPrice = num(fillPrice),
                            stopLoss = order.stopLoss,
                            takeProfit = order.takeProfit,
                            openedAt = store.now(),
                        ),
                    )
                }
            } else {
                newQuote = quote + notional - fee
                if (index >= 0) {
                    val existing = positions[index]
                    val existingQty = existing.quantity.toDoubleOrNull() ?: 0.0
                    val entry = existing.entryPrice.toDoubleOrNull() ?: fillPrice
                    val closedQty = minOf(existingQty, qty)
                    realized = (fillPrice - entry) * closedQty - fee
                    val remaining = existingQty - closedQty
                    if (remaining <= 0.0) positions.removeAt(index)
                    else positions[index] = existing.copy(quantity = num(remaining))
                } else {
                    realized = -fee
                }
            }
            val realizedTotal = (account.realizedPnl.toDoubleOrNull() ?: 0.0) + (realized ?: 0.0)
            state.copy(
                paper = state.paper + (order.userId to account.copy(
                    quoteBalance = num(newQuote),
                    feesPaid = num((account.feesPaid.toDoubleOrNull() ?: 0.0) + fee),
                    realizedPnl = num(realizedTotal),
                )),
                positions = positions,
                orders = state.orders.map { existing ->
                    if (existing.id == order.id) {
                        existing.copy(
                            status = "FILLED",
                            filledQuantity = num(qty),
                            averageFillPrice = num(fillPrice),
                            feePaid = num(fee),
                            closedAt = at.toString(),
                            realizedPnl = realized?.let { num(it) },
                        )
                    } else {
                        existing
                    }
                },
            )
        }
        store.notify(
            order.userId,
            "order",
            "Order filled",
            "${order.side} ${order.quantity} ${order.symbol} at ${num(fillPrice)} (paper)",
            "info",
        )
        return store.state().orders.first { it.id == order.id }
    }

    fun reconcile(userId: String): JsonObject {
        val state = store.state()
        val stuck = state.orders.filter {
            it.userId == userId && it.mode == "paper" && it.status == "NEW" &&
                (it.orderType == "MARKET")
        }
        store.update { current ->
            current.copy(
                orders = current.orders.map { order ->
                    if (stuck.any { it.id == order.id }) order.copy(status = "CANCELED", closedAt = store.now()) else order
                },
            )
        }
        return buildJsonObject {
            put("checked", state.orders.count { it.userId == userId })
            put("repaired", stuck.size)
            put("note", "On-device reconciliation: market orders that never filled are marked canceled.")
        }
    }

    // ----------------------------------------------------------------- orders
    fun orders(userId: String, mode: String, openOnly: Boolean): List<OrderDto> {
        if (mode == "live") return emptyList()
        processOpenOrders(userId)
        return store.state().orders
            .filter { it.userId == userId && it.mode == "paper" && (!openOnly || it.status == "NEW") }
            .sortedByDescending { it.createdAt }
            .map { toDto(it) }
    }

    fun cancel(userId: String, id: String, mode: String): CancelResponse {
        val order = store.state().orders.firstOrNull { it.userId == userId && it.id == id }
            ?: return CancelResponse(id = id, status = "NOT_FOUND", mode = mode)
        if (order.status != "NEW") return CancelResponse(id = id, status = order.status, mode = mode)
        store.update { current ->
            current.copy(
                orders = current.orders.map {
                    if (it.id == id) it.copy(status = "CANCELED", closedAt = store.now()) else it
                },
            )
        }
        store.notify(userId, "order", "Order canceled", "${order.side} ${order.quantity} ${order.symbol} was canceled.", "info")
        return CancelResponse(id = id, status = "CANCELED", mode = mode)
    }

    fun openOrders(userId: String): List<LocalOrder> = store.state().orders.filter {
        it.userId == userId && it.mode == "paper" && it.status == "NEW"
    }

    private fun toDto(order: LocalOrder, replay: Boolean = false): OrderDto = OrderDto(
        id = order.id,
        mode = order.mode,
        symbol = order.symbol,
        side = order.side,
        orderType = order.orderType,
        quantity = order.quantity,
        price = order.price,
        stopLoss = order.stopLoss,
        takeProfit = order.takeProfit,
        status = order.status,
        filledQuantity = order.filledQuantity,
        averageFillPrice = order.averageFillPrice,
        feePaid = order.feePaid,
        approved = order.status != "REJECTED",
        environment = "simulated",
        createdAt = order.createdAt,
        idempotentReplay = replay,
        simulated = true,
    )

    // ------------------------------------------------------------------- risk
    fun riskStatus(userId: String, at: Instant = Instant.now()): RiskStatusDto {
        val state = store.state()
        val policy = policy(userId)
        val usage = RiskUsageDto(
            dailyRealizedPnl = num(dailyRealizedPnl(userId, at)),
            dailyLossLimit = policy.maxDailyLoss,
            cooldownActive = cooldownActive(userId, policy, at),
            openLiveOrders = 0,
            unreconciledOrders = 0,
        )
        return RiskStatusDto(
            policy = policy,
            control = TradingControlDto(killSwitch = state.killSwitch.engaged, reason = state.killSwitch.reason, activatedAt = state.killSwitch.activatedAt),
            server = ServerRiskConfigDto(
                liveTradingEnabled = false,
                automationEnabled = false,
                requireManualApproval = true,
                binanceEnvironment = "simulated (device)",
                riskEngineEnabled = true,
            ),
            usage = usage,
            market = com.rsaitrader.core.network.MarketHealthDto(
                provider = SampleMarket.SOURCE,
                synthetic = true,
                degraded = false,
                marketStaleAfterSeconds = 180,
            ),
            canTradeLive = false,
        )
    }

    private fun dailyRealizedPnl(userId: String, at: Instant): Double {
        val today = LocalDate.ofInstant(at, ZoneOffset.UTC).toString()
        return store.state().orders
            .filter { it.userId == userId && (it.closedAt?.take(10) ?: it.createdAt.take(10)) == today }
            .sumOf { it.realizedPnl?.toDoubleOrNull() ?: 0.0 }
    }

    private fun cooldownActive(userId: String, policy: RiskPolicyDto, at: Instant): Boolean {
        if (policy.cooldownAfterLosses <= 0) return false
        val closed = store.state().orders
            .filter { it.userId == userId && it.realizedPnl != null }
            .sortedByDescending { it.closedAt ?: it.createdAt }
        val recent = closed.take(policy.cooldownAfterLosses)
        if (recent.size < policy.cooldownAfterLosses) return false
        if (recent.any { (it.realizedPnl?.toDoubleOrNull() ?: 0.0) >= 0.0 }) return false
        val lastLossAt = closed.firstOrNull()?.closedAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        return lastLossAt.plusSeconds(policy.cooldownMinutes * 60L).isAfter(at)
    }

    private fun positionsValue(userId: String, at: Instant): Double =
        store.state().positions.filter { it.userId == userId }.sumOf {
            (it.quantity.toDoubleOrNull() ?: 0.0) * SampleMarket.price(it.symbol, at)
        }

    private fun portfolioEquity(userId: String, at: Instant): Double {
        val account = account(userId)
        return (account.quoteBalance.toDoubleOrNull() ?: 0.0) + positionsValue(userId, at)
    }

    private fun num(value: Double): String {
        if (value.isNaN() || value.isInfinite()) return "0"
        val rounded = Math.round(value * 100_000_000.0) / 100_000_000.0
        return String.format(Locale.US, "%.8f", rounded).trimEnd('0').trimEnd('.').ifBlank { "0" }
    }
}
