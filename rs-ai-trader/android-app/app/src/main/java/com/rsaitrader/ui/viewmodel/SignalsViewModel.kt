package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.ModelReportDto
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SignalsState(
    val symbol: String = "BTCUSDT",
    val timeframe: String = "1h",
    val signal: Loadable<SignalDto> = Loadable.idle(),
    val model: Loadable<ModelReportDto> = Loadable.idle(),
    val generating: Boolean = false,
    val history: List<SignalDto> = emptyList(),
)

class SignalsViewModel : ViewModel() {

    private val signals = ServiceLocator.signals
    private val favorites = ServiceLocator.favorites

    private val _state = MutableStateFlow(SignalsState(symbol = favorites.lastSymbol()))
    val state: StateFlow<SignalsState> = _state.asStateFlow()

    init {
        generate()
    }

    fun setSymbol(symbol: String) {
        val clean = symbol.uppercase()
        if (clean == _state.value.symbol) return
        _state.update { it.copy(symbol = clean) }
        generate()
    }

    fun setTimeframe(timeframe: String) {
        if (timeframe == _state.value.timeframe) return
        _state.update { it.copy(timeframe = timeframe) }
        generate()
    }

    /** Ask the AI engine for a fresh analysis. Never fabricates HOLD/confidence client-side. */
    fun generate() {
        val current = _state.value
        _state.update { it.copy(generating = true, signal = it.signal.loading()) }
        viewModelScope.launch {
            val result = signals.signal(current.symbol, current.timeframe)
            _state.update {
                it.copy(
                    generating = false,
                    signal = result.toLoadable(it.signal),
                    history = (result as? ApiResult.Success)?.let { r -> listOf(r.data) + it.history.take(9) }
                        ?: it.history,
                )
            }
            _state.update { it.copy(model = signals.model(current.symbol, current.timeframe).toLoadable(it.model)) }
        }
    }

    fun dismissError() = _state.update {
        it.copy(signal = it.signal.clearError(), model = it.model.clearError())
    }
}
