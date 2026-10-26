package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.network.DepthDto
import com.rsaitrader.core.network.KlineResponse
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.network.TradeTickDto
import com.rsaitrader.core.realtime.StreamStatus
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

val TIMEFRAMES = listOf("1m", "5m", "15m", "1h", "4h", "1d")

data class ChartState(
    val symbol: String = "BTCUSDT",
    val interval: String = "1h",
    val klines: Loadable<KlineResponse> = Loadable.idle(),
    val depth: Loadable<DepthDto> = Loadable.idle(),
    val trades: Loadable<List<TradeTickDto>> = Loadable.idle(),
    val ticker: TickerDto? = null,
    val signal: Loadable<SignalDto> = Loadable.idle(),
)

class ChartViewModel : ViewModel() {

    private val market get() = ServiceLocator.market
    private val signals get() = ServiceLocator.signals
    private val favorites get() = ServiceLocator.favorites
    private val feed get() = ServiceLocator.feed

    private val _state = MutableStateFlow(
        ChartState(symbol = favorites.lastSymbol(), interval = "1h"),
    )
    val state: StateFlow<ChartState> = _state.asStateFlow()

    val streamStatus: StateFlow<StreamStatus> = feed.status
    val liveTickers: StateFlow<Map<String, TickerDto>> = feed.tickers

    private var refreshJob: Job? = null

    init {
        feed.watch(listOf(_state.value.symbol))
        loadAll()
        refreshJob = viewModelScope.launch {
            while (true) {
                delay(15_000)
                refresh(showSpinner = false)
            }
        }
    }

    fun setSymbol(symbol: String) {
        val clean = symbol.trim().uppercase()
        if (clean == _state.value.symbol) return
        _state.update { it.copy(symbol = clean, klines = it.klines.loading(), signal = it.signal.loading()) }
        favorites.setLastSymbol(clean)
        feed.watch(listOf(clean))
        loadAll()
    }

    fun setInterval(interval: String) {
        if (interval == _state.value.interval) return
        _state.update { it.copy(interval = interval, klines = it.klines.loading()) }
        viewModelScope.launch { loadKlines() }
    }

    fun loadAll() {
        viewModelScope.launch {
            refresh(showSpinner = true)
        }
    }

    private suspend fun refresh(showSpinner: Boolean) {
        val current = _state.value
        if (showSpinner) {
            _state.update { it.copy(klines = it.klines.loading(), depth = it.depth.loading()) }
        }
        loadKlines()
        _state.update { it.copy(depth = market.depth(current.symbol, 20).toLoadable(it.depth)) }
        _state.update { it.copy(trades = market.trades(current.symbol).toLoadable(it.trades)) }
        _state.update { it.copy(signal = signals.signal(current.symbol, current.interval).toLoadable(it.signal)) }
        when (val ticker = market.ticker(current.symbol)) {
            is com.rsaitrader.core.ApiResult.Success -> _state.update { it.copy(ticker = ticker.data) }
            is com.rsaitrader.core.ApiResult.Failure -> Unit
        }
    }

    private suspend fun loadKlines() {
        val current = _state.value
        _state.update { it.copy(klines = market.klines(current.symbol, current.interval, 240).toLoadable(it.klines)) }
    }

    fun dismissError() = _state.update {
        it.copy(
            klines = it.klines.clearError(),
            depth = it.depth.clearError(),
            trades = it.trades.clearError(),
            signal = it.signal.clearError(),
        )
    }

    override fun onCleared() {
        refreshJob?.cancel()
        super.onCleared()
    }
}
