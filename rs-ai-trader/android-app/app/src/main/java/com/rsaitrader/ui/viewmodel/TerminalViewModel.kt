package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.OrderCreateRequest
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.core.network.OrderPreviewDto
import com.rsaitrader.core.network.OrderRequest
import com.rsaitrader.core.network.PortfolioDto
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.realtime.StreamStatus
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Spot order entry.
 *
 * Every order is previewed server-side first (validation + all risk checks), and
 * placing requires an explicit confirmation tap. The idempotency key is created
 * once per attempt and reused on retry so a flaky connection cannot double-submit.
 */
data class TerminalState(
    val mode: String = "paper",
    val symbol: String = "BTCUSDT",
    val side: String = "BUY",
    val orderType: String = "MARKET",
    val quantity: String = "",
    val price: String = "",
    val stopLoss: String = "",
    val takeProfit: String = "",
    val timeInForce: String? = null,
    val preview: Loadable<OrderPreviewDto> = Loadable.idle(),
    val placing: Boolean = false,
    val placed: OrderDto? = null,
    val message: String? = null,
    val error: String? = null,
    val idempotencyKey: String = UUID.randomUUID().toString(),
    val ticker: TickerDto? = null,
    val portfolio: Loadable<PortfolioDto> = Loadable.idle(),
    val risk: Loadable<RiskStatusDto> = Loadable.idle(),
    val confirming: Boolean = false,
) {
    val isLive: Boolean get() = mode == "live"
    val canPreview: Boolean get() = quantity.toDoubleOrNull()?.let { it > 0 } == true
    val needsPrice: Boolean get() = orderType == "LIMIT" || orderType == "STOP_LOSS_LIMIT"
    val referencePrice: Double?
        get() = ticker?.price ?: preview.data?.referencePrice?.toDoubleOrNull()
}

class TerminalViewModel : ViewModel() {

    private val market = ServiceLocator.market
    private val trading = ServiceLocator.trading
    private val portfolioRepo = ServiceLocator.portfolio
    private val riskRepo = ServiceLocator.risk
    private val favorites = ServiceLocator.favorites
    private val feed = ServiceLocator.feed

    private val _state = MutableStateFlow(TerminalState(symbol = favorites.lastSymbol()))
    val state: StateFlow<TerminalState> = _state.asStateFlow()

    val streamStatus: StateFlow<StreamStatus> = feed.status
    val liveTickers: StateFlow<Map<String, TickerDto>> = feed.tickers

    init {
        feed.watch(listOf(_state.value.symbol))
        refreshContext()
    }

    fun refreshContext() {
        val symbol = _state.value.symbol
        viewModelScope.launch {
            _state.update { it.copy(portfolio = it.portfolio.loading(), risk = it.risk.loading()) }
            _state.update { it.copy(portfolio = portfolioRepo.portfolio(_state.value.mode).toLoadable(it.portfolio)) }
            _state.update { it.copy(risk = riskRepo.status().toLoadable(it.risk)) }
            when (val result = market.ticker(symbol)) {
                is ApiResult.Success -> _state.update { it.copy(ticker = result.data) }
                is ApiResult.Failure -> Unit
            }
        }
    }

    fun setMode(mode: String) {
        _state.update { it.copy(mode = mode, preview = Loadable.idle(), idempotencyKey = UUID.randomUUID().toString()) }
        viewModelScope.launch {
            _state.update { it.copy(portfolio = portfolioRepo.portfolio(mode).toLoadable(it.portfolio)) }
        }
    }

    fun setSymbol(symbol: String) {
        val clean = symbol.trim().uppercase()
        if (clean == _state.value.symbol) return
        favorites.setLastSymbol(clean)
        _state.update { it.copy(symbol = clean, preview = Loadable.idle(), quantity = "", price = "", error = null) }
        feed.watch(listOf(clean))
        refreshContext()
    }

    fun setSide(side: String) = _state.update { it.copy(side = side.uppercase(), preview = Loadable.idle()) }

    fun setOrderType(type: String) = _state.update { it.copy(orderType = type.uppercase(), preview = Loadable.idle()) }

    fun setQuantity(value: String) = _state.update { it.copy(quantity = sanitize(value), preview = Loadable.idle()) }

    fun setPrice(value: String) = _state.update { it.copy(price = sanitize(value), preview = Loadable.idle()) }

    fun setStopLoss(value: String) = _state.update { it.copy(stopLoss = sanitize(value), preview = Loadable.idle()) }

    fun setTakeProfit(value: String) = _state.update { it.copy(takeProfit = sanitize(value), preview = Loadable.idle()) }

    fun setTimeInForce(tif: String?) = _state.update { it.copy(timeInForce = tif) }

    /** Fill quantity from a USDT notional using the last price (never a guess). */
    fun sizeFromNotional(notional: Double) {
        val price = _state.value.referencePrice ?: return
        if (price <= 0.0) return
        val qty = notional / price
        _state.update { it.copy(quantity = String.format(java.util.Locale.US, "%.6f", qty).trimEnd('0').trimEnd('.')) }
    }

    fun percentOfBalance(percent: Double) {
        val available = _state.value.portfolio.data?.availableUsdt?.toDoubleOrNull() ?: return
        sizeFromNotional(available * percent / 100.0)
    }

    private fun request() = OrderRequest(
        symbol = _state.value.symbol,
        side = _state.value.side,
        orderType = _state.value.orderType,
        quantity = _state.value.quantity,
        price = _state.value.price.ifBlank { null },
        stopLoss = _state.value.stopLoss.ifBlank { null },
        takeProfit = _state.value.takeProfit.ifBlank { null },
        mode = _state.value.mode,
        timeInForce = _state.value.timeInForce,
    )

    fun preview() {
        val current = _state.value
        if (!current.canPreview) {
            _state.update { it.copy(error = "Enter a quantity greater than zero.") }
            return
        }
        if (current.needsPrice && current.price.isBlank()) {
            _state.update { it.copy(error = "A limit price is required for ${current.orderType} orders.") }
            return
        }
        _state.update { it.copy(preview = it.preview.loading(), error = null, message = null) }
        viewModelScope.launch {
            _state.update { it.copy(preview = trading.preview(request()).toLoadable(it.preview)) }
        }
    }

    fun requestConfirmation() {
        if (_state.value.preview.data == null) {
            preview()
            return
        }
        _state.update { it.copy(confirming = true) }
    }

    fun cancelConfirmation() = _state.update { it.copy(confirming = false) }

    /** Called only from the explicit confirmation dialog. */
    fun confirmAndPlace() {
        val current = _state.value
        val previewData = current.preview.data
        if (previewData == null) {
            _state.update { it.copy(error = "Preview the order before placing it.", confirming = false) }
            return
        }
        if (!previewData.canPlace) {
            _state.update {
                it.copy(
                    confirming = false,
                    error = "The server's risk check rejected this order. Fix the highlighted problems and preview again.",
                )
            }
            return
        }
        _state.update { it.copy(confirming = false, placing = true, error = null) }
        val body = OrderCreateRequest(
            symbol = current.symbol,
            side = current.side,
            orderType = current.orderType,
            quantity = previewData.quantity.ifBlank { current.quantity },
            price = current.price.ifBlank { null },
            stopLoss = current.stopLoss.ifBlank { null },
            takeProfit = current.takeProfit.ifBlank { null },
            mode = current.mode,
            timeInForce = current.timeInForce,
            idempotencyKey = current.idempotencyKey,
            approved = true, // explicit human approval of this exact order
        )
        viewModelScope.launch {
            when (val result = trading.place(body)) {
                is ApiResult.Success -> _state.update {
                    it.copy(
                        placing = false,
                        placed = result.data,
                        preview = Loadable.idle(),
                        // New key only after the server accepted the order.
                        idempotencyKey = UUID.randomUUID().toString(),
                        message = "Order ${result.data.status} — ${result.data.id.take(8)}",
                    )
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(placing = false, error = result.message)
                }
            }
            refreshContext()
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null, placed = null) }

    private fun sanitize(value: String): String {
        val filtered = value.filterIndexed { index, c ->
            c.isDigit() || c == '.' || (c == '-' && index == 0)
        }
        return if (filtered.count { it == '.' } > 1) {
            filtered.dropLast(1)
        } else {
            filtered
        }
    }
}
