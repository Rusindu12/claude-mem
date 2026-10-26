package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OrdersState(
    val mode: String = "paper",
    val orders: Loadable<List<OrderDto>> = Loadable.idle(),
    val openOnly: Boolean = false,
    val cancellingId: String? = null,
    val reconciling: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class OrdersViewModel : ViewModel() {

    private val trading = ServiceLocator.trading

    private val _state = MutableStateFlow(OrdersState())
    val state: StateFlow<OrdersState> = _state.asStateFlow()

    init {
        load()
    }

    fun setMode(mode: String) {
        if (mode == _state.value.mode) return
        _state.update { it.copy(mode = mode, orders = it.orders.loading()) }
        load()
    }

    fun toggleOpenOnly() {
        _state.update { it.copy(openOnly = !it.openOnly, orders = it.orders.loading()) }
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(orders = it.orders.loading()) }
            _state.update { it.copy(orders = trading.orders(_state.value.mode, _state.value.openOnly).toLoadable(it.orders)) }
        }
    }

    fun cancel(order: OrderDto) {
        _state.update { it.copy(cancellingId = order.id, error = null, message = null) }
        viewModelScope.launch {
            when (val result = trading.cancel(order.id, _state.value.mode)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(cancellingId = null, message = "Cancel sent. New status: ${result.data.status}") }
                    delay(600)
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(cancellingId = null, error = result.message) }
            }
        }
    }

    /** Ask the backend to reconcile UNKNOWN live orders with the exchange. */
    fun reconcile() {
        _state.update { it.copy(reconciling = true, error = null) }
        viewModelScope.launch {
            when (val result = trading.reconcile()) {
                is ApiResult.Success -> {
                    _state.update { it.copy(reconciling = false, message = "Reconciliation finished.") }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(reconciling = false, error = result.message) }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

data class PortfolioState(
    val mode: String = "paper",
    val portfolio: Loadable<com.rsaitrader.core.network.PortfolioDto> = Loadable.idle(),
    val resetting: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class PortfolioViewModel : ViewModel() {

    private val repo = ServiceLocator.portfolio

    private val _state = MutableStateFlow(PortfolioState())
    val state: StateFlow<PortfolioState> = _state.asStateFlow()

    init {
        load()
    }

    fun setMode(mode: String) {
        if (mode == _state.value.mode) return
        _state.update { it.copy(mode = mode, portfolio = it.portfolio.loading()) }
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(portfolio = it.portfolio.loading()) }
            _state.update { it.copy(portfolio = repo.portfolio(_state.value.mode).toLoadable(it.portfolio)) }
        }
    }

    fun resetPaper(startingEquity: String) {
        val value = startingEquity.toDoubleOrNull()
        if (value == null || value <= 0) {
            _state.update { it.copy(error = "Enter a starting balance above zero.") }
            return
        }
        _state.update { it.copy(resetting = true, error = null) }
        viewModelScope.launch {
            when (val result = repo.resetPaper(startingEquity)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(resetting = false, message = "Simulated account reset.", mode = "paper") }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(resetting = false, error = result.message) }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

data class AnalyticsState(
    val mode: String = "paper",
    val days: Int = 30,
    val analytics: Loadable<com.rsaitrader.core.network.AnalyticsDto> = Loadable.idle(),
)

class AnalyticsViewModel : ViewModel() {

    private val repo = ServiceLocator.portfolio

    private val _state = MutableStateFlow(AnalyticsState())
    val state: StateFlow<AnalyticsState> = _state.asStateFlow()

    init {
        load()
    }

    fun setMode(mode: String) {
        _state.update { it.copy(mode = mode) }
        load()
    }

    fun setDays(days: Int) {
        _state.update { it.copy(days = days) }
        load()
    }

    fun load() {
        viewModelScope.launch {
            val current = _state.value
            _state.update { it.copy(analytics = it.analytics.loading()) }
            _state.update {
                it.copy(analytics = repo.analytics(current.mode, current.days).toLoadable(it.analytics))
            }
        }
    }

    fun dismissError() = _state.update { it.copy(analytics = it.analytics.clearError()) }
}

data class BacktestState(
    val symbol: String = "BTCUSDT",
    val timeframe: String = "1h",
    val days: Int = 30,
    val initialCapital: String = "10000",
    val feeBps: String = "10",
    val slippageBps: String = "5",
    val running: Boolean = false,
    val result: Loadable<com.rsaitrader.core.network.BacktestResultDto> = Loadable.idle(),
)

class BacktestViewModel : ViewModel() {

    private val signals = ServiceLocator.signals
    private val favorites = ServiceLocator.favorites

    private val _state = MutableStateFlow(BacktestState(symbol = favorites.lastSymbol()))
    val state: StateFlow<BacktestState> = _state.asStateFlow()

    fun setSymbol(symbol: String) = _state.update { it.copy(symbol = symbol.uppercase()) }
    fun setTimeframe(tf: String) = _state.update { it.copy(timeframe = tf) }
    fun setDays(days: Int) = _state.update { it.copy(days = days) }
    fun setCapital(value: String) = _state.update { it.copy(initialCapital = value) }
    fun setFee(value: String) = _state.update { it.copy(feeBps = value) }
    fun setSlippage(value: String) = _state.update { it.copy(slippageBps = value) }

    fun run() {
        val current = _state.value
        val capital = current.initialCapital.toDoubleOrNull()
        if (capital == null || capital <= 0) {
            _state.update { it.copy(result = it.result.failure("Enter a starting capital above zero.", "invalid_input")) }
            return
        }
        _state.update { it.copy(running = true, result = it.result.loading()) }
        viewModelScope.launch {
            val request = com.rsaitrader.core.network.BacktestRequest(
                symbol = current.symbol,
                timeframe = current.timeframe,
                days = current.days,
                initialCapital = capital,
                feeBps = current.feeBps.toDoubleOrNull(),
                slippageBps = current.slippageBps.toDoubleOrNull(),
            )
            _state.update { it.copy(running = false, result = signals.backtest(request).toLoadable(it.result)) }
        }
    }

    fun dismissError() = _state.update { it.copy(result = it.result.clearError()) }
}
