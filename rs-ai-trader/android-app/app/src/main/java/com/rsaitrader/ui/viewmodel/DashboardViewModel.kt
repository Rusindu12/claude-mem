package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AppConfigDto
import com.rsaitrader.core.network.OverviewDto
import com.rsaitrader.core.network.PortfolioDto
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.core.network.TickerDto
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

data class DashboardState(
    val config: Loadable<AppConfigDto> = Loadable.idle(),
    val overview: Loadable<OverviewDto> = Loadable.idle(),
    val portfolio: Loadable<PortfolioDto> = Loadable.idle(),
    val risk: Loadable<RiskStatusDto> = Loadable.idle(),
    val signal: Loadable<SignalDto> = Loadable.idle(),
    val mode: String = "paper",
    val refreshing: Boolean = false,
)

class DashboardViewModel : ViewModel() {

    private val market = ServiceLocator.market
    private val portfolioRepo = ServiceLocator.portfolio
    private val signalRepo = ServiceLocator.signals
    private val riskRepo = ServiceLocator.risk
    private val favorites = ServiceLocator.favorites
    private val feed = ServiceLocator.feed

    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    val streamStatus: StateFlow<StreamStatus> = feed.status
    val liveTickers: StateFlow<Map<String, TickerDto>> = feed.tickers

    val watchSymbols: List<String> = favorites.favorites().take(6).ifEmpty { listOf("BTCUSDT") }

    private var pollJob: Job? = null

    init {
        feed.watch(watchSymbols)
        refresh()
        startPolling()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            _state.update { it.copy(config = it.config.loading()) }
            when (val result = market.config()) {
                is ApiResult.Success -> _state.update { it.copy(config = it.config.success(result.data)) }
                is ApiResult.Failure -> _state.update { it.copy(config = it.config.failure(result.message, result.code)) }
            }
            _state.update { it.copy(overview = it.overview.loading()) }
            _state.update { it.copy(overview = market.overview().toLoadable(it.overview)) }

            val mode = _state.value.mode
            _state.update { it.copy(portfolio = it.portfolio.loading()) }
            _state.update { it.copy(portfolio = portfolioRepo.portfolio(mode).toLoadable(it.portfolio)) }
            _state.update { it.copy(risk = riskRepo.status().toLoadable(it.risk)) }

            val primary = watchSymbols.firstOrNull() ?: "BTCUSDT"
            _state.update { it.copy(signal = it.signal.loading()) }
            _state.update { it.copy(signal = signalRepo.signal(primary, "1h").toLoadable(it.signal)) }

            _state.update { it.copy(refreshing = false) }
        }
    }

    fun setMode(mode: String) {
        if (mode == _state.value.mode) return
        _state.update { it.copy(mode = mode) }
        viewModelScope.launch {
            _state.update { it.copy(portfolio = portfolioRepo.portfolio(mode).toLoadable(it.portfolio)) }
        }
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (true) {
                delay(20_000)
                if (_state.value.risk.data?.control?.killSwitch == true) continue
                _state.update { it.copy(portfolio = portfolioRepo.portfolio(_state.value.mode).toLoadable(it.portfolio)) }
            }
        }
    }

    fun dismissError() {
        _state.update {
            it.copy(
                config = it.config.clearError(),
                overview = it.overview.clearError(),
                portfolio = it.portfolio.clearError(),
                risk = it.risk.clearError(),
                signal = it.signal.clearError(),
            )
        }
    }

    override fun onCleared() {
        pollJob?.cancel()
        super.onCleared()
    }
}
