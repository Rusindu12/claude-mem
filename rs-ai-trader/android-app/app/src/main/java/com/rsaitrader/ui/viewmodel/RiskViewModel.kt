package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.RiskPolicyDto
import com.rsaitrader.core.network.RiskPolicyUpdate
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RiskState(
    val status: Loadable<RiskStatusDto> = Loadable.idle(),
    // editable draft values
    val maxTradeNotional: String = "",
    val maxExposurePct: String = "",
    val maxDailyLoss: String = "",
    val maxRiskPerTradePct: String = "",
    val maxOpenOrders: String = "",
    val maxOpenPositions: String = "",
    val stopLossRequired: Boolean = true,
    val cooldownAfterLosses: String = "",
    val cooldownMinutes: String = "",
    val saving: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val optInDialog: Boolean = false,
    val confirmationText: String = "",
    val acknowledgeRisk: Boolean = false,
    val emergencyConfirm: Boolean = false,
    val working: Boolean = false,
)

class RiskViewModel : ViewModel() {

    private val repo = ServiceLocator.risk

    private val _state = MutableStateFlow(RiskState())
    val state: StateFlow<RiskState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(status = it.status.loading()) }
            when (val result = repo.status()) {
                is ApiResult.Success -> _state.update { it.copy(status = it.status.success(result.data)).applyPolicy(result.data.policy) }
                is ApiResult.Failure -> _state.update { it.copy(status = it.status.failure(result.message, result.code)) }
            }
        }
    }

    private fun RiskState.applyPolicy(policy: RiskPolicyDto): RiskState = copy(
        maxTradeNotional = policy.maxTradeNotional,
        maxExposurePct = policy.maxPortfolioExposurePct,
        maxDailyLoss = policy.maxDailyLoss,
        maxRiskPerTradePct = policy.maxRiskPerTradePct,
        maxOpenOrders = policy.maxOpenOrders.toString(),
        maxOpenPositions = policy.maxOpenPositions.toString(),
        stopLossRequired = policy.stopLossRequired,
        cooldownAfterLosses = policy.cooldownAfterLosses.toString(),
        cooldownMinutes = policy.cooldownMinutes.toString(),
    )

    fun setMaxTradeNotional(v: String) = _state.update { it.copy(maxTradeNotional = numeric(v)) }
    fun setMaxExposurePct(v: String) = _state.update { it.copy(maxExposurePct = numeric(v)) }
    fun setMaxDailyLoss(v: String) = _state.update { it.copy(maxDailyLoss = numeric(v)) }
    fun setMaxRiskPerTradePct(v: String) = _state.update { it.copy(maxRiskPerTradePct = numeric(v)) }
    fun setMaxOpenOrders(v: String) = _state.update { it.copy(maxOpenOrders = numeric(v)) }
    fun setMaxOpenPositions(v: String) = _state.update { it.copy(maxOpenPositions = numeric(v)) }
    fun setStopLossRequired(v: Boolean) = _state.update { it.copy(stopLossRequired = v) }
    fun setCooldownAfterLosses(v: String) = _state.update { it.copy(cooldownAfterLosses = numeric(v)) }
    fun setCooldownMinutes(v: String) = _state.update { it.copy(cooldownMinutes = numeric(v)) }

    fun save() {
        val s = _state.value
        val errors = mutableListOf<String>()
        if (s.maxTradeNotional.toDoubleOrNull()?.let { it > 0 } != true) errors.add("max trade notional")
        if (s.maxExposurePct.toDoubleOrNull()?.let { it in 0.01..100.0 } != true) errors.add("max exposure (0-100%)")
        if (s.maxDailyLoss.toDoubleOrNull()?.let { it > 0 } != true) errors.add("daily loss limit")
        if (s.maxRiskPerTradePct.toDoubleOrNull()?.let { it in 0.01..10.0 } != true) errors.add("risk per trade (0.01-10%)")
        if (errors.isNotEmpty()) {
            _state.update { it.copy(error = "Check these fields: ${errors.joinToString()}.") }
            return
        }
        _state.update { it.copy(saving = true, error = null, message = null) }
        val update = RiskPolicyUpdate(
            maxTradeNotional = s.maxTradeNotional,
            maxPortfolioExposurePct = s.maxExposurePct,
            maxDailyLoss = s.maxDailyLoss,
            maxRiskPerTradePct = s.maxRiskPerTradePct,
            maxOpenOrders = s.maxOpenOrders.toIntOrNull(),
            maxOpenPositions = s.maxOpenPositions.toIntOrNull(),
            stopLossRequired = s.stopLossRequired,
            cooldownAfterLosses = s.cooldownAfterLosses.toIntOrNull(),
            cooldownMinutes = s.cooldownMinutes.toIntOrNull(),
        )
        viewModelScope.launch {
            when (val result = repo.updatePolicy(update)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(saving = false, message = "Risk limits saved.").applyPolicy(result.data) }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(saving = false, error = result.message) }
            }
        }
    }

    // ------------------------------------------------------------- live opt-in
    fun openOptIn() = _state.update { it.copy(optInDialog = true, confirmationText = "", acknowledgeRisk = false) }
    fun closeOptIn() = _state.update { it.copy(optInDialog = false) }
    fun setConfirmationText(v: String) = _state.update { it.copy(confirmationText = v) }
    fun setAcknowledge(value: Boolean) = _state.update { it.copy(acknowledgeRisk = value) }

    fun enableLive() {
        val s = _state.value
        if (s.confirmationText.trim().uppercase() != "ENABLE LIVE TRADING") {
            _state.update { it.copy(error = "Type \"ENABLE LIVE TRADING\" exactly to confirm.") }
            return
        }
        if (!s.acknowledgeRisk) {
            _state.update { it.copy(error = "Tick the risk acknowledgement first.") }
            return
        }
        _state.update { it.copy(working = true, error = null) }
        viewModelScope.launch {
            when (val result = repo.optInLive(true, s.confirmationText, true)) {
                is ApiResult.Success -> _state.update {
                    it.copy(working = false, optInDialog = false, message = "Live trading enabled with manual approval for every order.")
                }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    fun disableLive() {
        _state.update { it.copy(working = true, error = null) }
        viewModelScope.launch {
            when (val result = repo.optInLive(false, "DISABLE", false)) {
                is ApiResult.Success -> _state.update { it.copy(working = false, message = "Live trading disabled.") }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    // ------------------------------------------------------------ kill switch
    fun openEmergency() = _state.update { it.copy(emergencyConfirm = true) }
    fun closeEmergency() = _state.update { it.copy(emergencyConfirm = false) }

    fun emergencyStop() {
        _state.update { it.copy(emergencyConfirm = false, working = true, error = null) }
        viewModelScope.launch {
            when (val result = repo.emergencyStop()) {
                is ApiResult.Success -> _state.update {
                    it.copy(working = false, message = "Emergency stop engaged: live trading off, open orders cancelled.")
                }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }

    private fun numeric(value: String): String = value.filter { it.isDigit() || it == '.' }
}

val ALERT_CONDITIONS = listOf(
    "price_above",
    "price_below",
    "rsi_above",
    "rsi_below",
    "signal_buy",
    "signal_sell",
)

fun alertConditionLabel(condition: String): String = when (condition) {
    "price_above" -> "Price above"
    "price_below" -> "Price below"
    "rsi_above" -> "RSI above"
    "rsi_below" -> "RSI below"
    "signal_buy" -> "AI signal BUY"
    "signal_sell" -> "AI signal SELL"
    else -> condition
}

data class AlertsState(
    val alerts: Loadable<List<com.rsaitrader.core.network.AlertDto>> = Loadable.idle(),
    val symbol: String = "BTCUSDT",
    val condition: String = "price_above",
    val targetPrice: String = "",
    val note: String = "",
    val saving: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class AlertsViewModel : ViewModel() {

    private val repo = ServiceLocator.alerts

    private val _state = MutableStateFlow(AlertsState())
    val state: StateFlow<AlertsState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(alerts = it.alerts.loading()) }
            _state.update { it.copy(alerts = repo.alerts().toLoadable(it.alerts)) }
        }
    }

    fun setSymbol(v: String) = _state.update { it.copy(symbol = v.uppercase()) }
    fun setCondition(v: String) = _state.update { it.copy(condition = v) }
    fun setTarget(v: String) = _state.update { it.copy(targetPrice = v.filter { c -> c.isDigit() || c == '.' }) }
    fun setNote(v: String) = _state.update { it.copy(note = v.take(200)) }

    fun create() {
        val s = _state.value
        val needsTarget = s.condition.startsWith("price_") || s.condition.startsWith("rsi_")
        if (needsTarget && s.targetPrice.toDoubleOrNull()?.let { it > 0 } != true) {
            _state.update { it.copy(error = "Enter a target price above zero.") }
            return
        }
        _state.update { it.copy(saving = true, error = null, message = null) }
        viewModelScope.launch {
            val target = if (needsTarget) s.targetPrice else null
            when (val result = repo.create(s.symbol, s.condition, target, s.note.ifBlank { null })) {
                is ApiResult.Success -> {
                    _state.update { it.copy(saving = false, message = "Alert created.", targetPrice = "", note = "") }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(saving = false, error = result.message) }
            }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            when (val result = repo.delete(id)) {
                is ApiResult.Success -> load()
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun evaluateNow() {
        viewModelScope.launch {
            when (val result = repo.evaluate()) {
                is ApiResult.Success -> _state.update { it.copy(message = "Alerts evaluated against the latest prices.") }
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}
