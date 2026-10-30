package com.rsaitrader.data

import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AlertCreateRequest
import com.rsaitrader.core.network.AlertDto
import com.rsaitrader.core.network.AnalyticsDto
import com.rsaitrader.core.network.ApiClient
import com.rsaitrader.core.network.ApiService
import com.rsaitrader.core.network.AppConfigDto
import com.rsaitrader.core.network.AssistantAnswerDto
import com.rsaitrader.core.network.AssistantQuery
import com.rsaitrader.core.network.BacktestRequest
import com.rsaitrader.core.network.BacktestResultDto
import com.rsaitrader.core.network.CancelResponse
import com.rsaitrader.core.network.ChangePasswordRequest
import com.rsaitrader.core.network.CredentialCreateRequest
import com.rsaitrader.core.network.CredentialDto
import com.rsaitrader.core.network.CredentialListDto
import com.rsaitrader.core.network.DepthDto
import com.rsaitrader.core.network.KlineResponse
import com.rsaitrader.core.network.KillSwitchRequest
import com.rsaitrader.core.network.LiveOptInRequest
import com.rsaitrader.core.network.MarketHealthDto
import com.rsaitrader.core.network.ModelReportDto
import com.rsaitrader.core.network.NotificationDto
import com.rsaitrader.core.network.OrderCreateRequest
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.core.network.OrderPreviewDto
import com.rsaitrader.core.network.OrderRequest
import com.rsaitrader.core.network.OverviewDto
import com.rsaitrader.core.network.PairsResponse
import com.rsaitrader.core.network.PasswordResetRequest
import com.rsaitrader.core.network.PortfolioDto
import com.rsaitrader.core.network.RefreshRequest
import com.rsaitrader.core.network.RegisterRequest
import com.rsaitrader.core.network.RiskPolicyDto
import com.rsaitrader.core.network.RiskPolicyUpdate
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.core.network.SessionDto
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.network.TokenPair
import com.rsaitrader.core.network.TradeTickDto
import com.rsaitrader.core.network.UserDto
import com.rsaitrader.core.map
import com.rsaitrader.core.network.safeCall
import kotlinx.serialization.json.JsonElement

class SessionRepository(private val api: ApiService, private val client: ApiClient) : SessionApi {

    override val user: UserDto? get() = client.tokenStore.user()
    override val isSignedIn: Boolean get() = client.tokenStore.isSignedIn()
    override val isAdmin: Boolean get() = client.tokenStore.isAdmin

    override suspend fun login(email: String, password: String): ApiResult<TokenPair> =
        safeCall { api.login(com.rsaitrader.core.network.LoginRequest(email.trim(), password)) }
            .also { persist(it) }

    override suspend fun register(email: String, password: String, displayName: String, language: String): ApiResult<TokenPair> =
        safeCall { api.register(RegisterRequest(email.trim(), password, displayName, language)) }
            .also { persist(it) }

    override suspend fun restore(): ApiResult<UserDto> = safeCall { api.me() }
        .also { result -> (result as? ApiResult.Success)?.let { client.tokenStore.saveUser(it.data) } }

    override suspend fun logout() {
        val refresh = client.tokenStore.refreshToken()
        runCatching { api.logout(com.rsaitrader.core.network.LogoutRequest(refresh)) }
        client.tokenStore.clear()
    }

    override suspend fun logoutEverywhere(): ApiResult<Unit> = safeCall { api.logoutAll() }
        .map { }
        .also { client.tokenStore.clear() }

    override suspend fun sessions(): ApiResult<List<SessionDto>> = safeCall { api.sessions() }

    override suspend fun revokeSession(id: String): ApiResult<Unit> = safeCall { api.revokeSession(id) }

    override suspend fun deleteAccount(password: String, confirmation: String): ApiResult<Unit> =
        safeCall { api.deleteAccount(com.rsaitrader.core.network.DeleteAccountRequest(password, confirmation)) }
            .map { }
            .also { if (it is ApiResult.Success) client.tokenStore.clear() }

    override suspend fun changePassword(current: String, newPassword: String): ApiResult<Unit> =
        safeCall { api.changePassword(ChangePasswordRequest(current, newPassword)) }
            .map { }
            .also { if (it is ApiResult.Success) client.tokenStore.clear() }

    override suspend fun requestPasswordReset(email: String): ApiResult<JsonElement> =
        safeCall { api.requestPasswordReset(PasswordResetRequest(email)) }

    override suspend fun confirmPasswordReset(token: String, newPassword: String): ApiResult<Unit> =
        safeCall { api.confirmPasswordReset(com.rsaitrader.core.network.PasswordResetConfirm(token, newPassword)) }
            .map { }

    override suspend fun updateProfile(displayName: String?, language: String?): ApiResult<UserDto> =
        safeCall { api.updateProfile(displayName, language) }
            .also { result -> (result as? ApiResult.Success)?.let { client.tokenStore.saveUser(it.data) } }

    private fun persist(result: ApiResult<TokenPair>) {
        if (result is ApiResult.Success) client.tokenStore.save(result.data)
    }
}

class MarketRepository(private val api: ApiService) : MarketApi {
    override suspend fun config(): ApiResult<AppConfigDto> = safeCall { api.appConfig() }
    override suspend fun overview(): ApiResult<OverviewDto> = safeCall { api.overview() }
    override suspend fun tickers(symbols: List<String>): ApiResult<List<TickerDto>> =
        safeCall { api.tickers(symbols.joinToString(",")) }
    override suspend fun ticker(symbol: String): ApiResult<TickerDto> = safeCall { api.ticker(symbol) }
    override suspend fun klines(symbol: String, interval: String, limit: Int): ApiResult<KlineResponse> =
        safeCall { api.klines(symbol, interval, limit) }
    override suspend fun depth(symbol: String, limit: Int): ApiResult<DepthDto> = safeCall { api.depth(symbol, limit) }
    override suspend fun trades(symbol: String): ApiResult<List<TradeTickDto>> = safeCall { api.recentTrades(symbol) }
    override suspend fun pairs(): ApiResult<PairsResponse> = safeCall { api.pairs() }
    override suspend fun health(): ApiResult<MarketHealthDto> =
        safeCall { api.appConfig() }.map { it.marketData }
}

class SignalRepository(private val api: ApiService) : SignalApi {
    override suspend fun signal(symbol: String, timeframe: String): ApiResult<SignalDto> =
        safeCall { api.signal(symbol, timeframe) }
    override suspend fun latest(symbol: String, timeframe: String): ApiResult<SignalDto> =
        safeCall { api.latestSignal(symbol, timeframe) }
    override suspend fun model(symbol: String, timeframe: String): ApiResult<ModelReportDto> =
        safeCall { api.modelReport(symbol, timeframe) }
    override suspend fun backtest(body: BacktestRequest): ApiResult<BacktestResultDto> = safeCall { api.backtest(body) }
    override suspend fun backtestHistory(): ApiResult<List<JsonElement>> = safeCall { api.backtestHistory() }
}

class TradingRepository(private val api: ApiService) : TradingApi {
    override suspend fun preview(body: OrderRequest): ApiResult<OrderPreviewDto> = safeCall { api.previewOrder(body) }
    override suspend fun place(body: OrderCreateRequest): ApiResult<OrderDto> = safeCall { api.placeOrder(body) }
    override suspend fun orders(mode: String, openOnly: Boolean): ApiResult<List<OrderDto>> =
        safeCall { api.orders(mode, openOnly) }
    override suspend fun cancel(id: String, mode: String): ApiResult<CancelResponse> =
        safeCall { api.cancelOrder(id, mode) }
    override suspend fun reconcile(): ApiResult<JsonElement> = safeCall { api.reconcileOrders() }
}

class PortfolioRepository(private val api: ApiService) : PortfolioApi {
    override suspend fun portfolio(mode: String): ApiResult<PortfolioDto> = safeCall { api.portfolio(mode) }
    override suspend fun analytics(mode: String, days: Int): ApiResult<AnalyticsDto> =
        safeCall { api.analytics(mode, days) }
    override suspend fun resetPaper(startingEquity: String): ApiResult<Unit> =
        safeCall { api.resetPaper(startingEquity) }.map { }
}

class RiskRepository(private val api: ApiService) : RiskApi {
    override suspend fun policy(): ApiResult<RiskPolicyDto> = safeCall { api.riskPolicy() }
    override suspend fun updatePolicy(body: RiskPolicyUpdate): ApiResult<RiskPolicyDto> =
        safeCall { api.updateRiskPolicy(body) }
    override suspend fun status(): ApiResult<RiskStatusDto> = safeCall { api.riskStatus() }
    override suspend fun optInLive(optIn: Boolean, confirmation: String, acknowledge: Boolean): ApiResult<JsonElement> =
        safeCall { api.liveOptIn(LiveOptInRequest(optIn, confirmation, acknowledge)) }
    override suspend fun emergencyStop(): ApiResult<JsonElement> = safeCall { api.emergencyStop() }
}

class AlertRepository(private val api: ApiService) : AlertApi {
    override suspend fun alerts(): ApiResult<List<AlertDto>> = safeCall { api.alerts() }
    override suspend fun create(symbol: String, condition: String, targetPrice: String?, note: String?): ApiResult<AlertDto> =
        safeCall { api.createAlert(AlertCreateRequest(symbol, condition, targetPrice, note)) }
    override suspend fun delete(id: String): ApiResult<Unit> = safeCall { api.deleteAlert(id) }
    override suspend fun evaluate(): ApiResult<Unit> = safeCall { api.evaluateAlerts() }.map { }
}

class AssistantRepository(private val api: ApiService) : AssistantApi {
    override suspend fun ask(question: String, lang: String?, symbol: String?, timeframe: String?): ApiResult<AssistantAnswerDto> =
        safeCall { api.askAssistant(AssistantQuery(question, lang, symbol, timeframe)) }

    override suspend fun history(limit: Int): ApiResult<List<com.rsaitrader.core.network.AssistantHistoryDto>> =
        safeCall { api.assistantHistory(limit) }
}

class CredentialRepository(private val api: ApiService) : CredentialApi {
    override suspend fun list(): ApiResult<CredentialListDto> = safeCall { api.credentials() }
    override suspend fun add(apiKey: String, apiSecret: String, label: String): ApiResult<CredentialDto> =
        safeCall { api.addCredential(CredentialCreateRequest(apiKey.trim(), apiSecret.trim(), label)) }
    override suspend fun verify(id: String): ApiResult<JsonElement> = safeCall { api.verifyCredential(id) }
    override suspend fun revoke(id: String): ApiResult<Unit> = safeCall { api.revokeCredential(id) }
}

class NotificationRepository(private val api: ApiService) : NotificationApi {
    override suspend fun list(): ApiResult<List<NotificationDto>> = safeCall { api.notifications() }
    override suspend fun markRead(): ApiResult<Unit> = safeCall { api.markNotificationsRead() }.map { }
}

class AdminRepository(private val api: ApiService) : AdminApi {
    override suspend fun users(search: String?): ApiResult<com.rsaitrader.core.network.AdminUsersResponse> =
        safeCall { api.adminUsers(search) }
    override suspend fun health() = safeCall { api.adminHealth() }
    override suspend fun audit() = safeCall { api.adminAudit() }
    override suspend fun settings() = safeCall { api.adminSettings() }
    override suspend fun updateSetting(key: String, value: JsonElement) =
        safeCall { api.adminUpdateSetting(com.rsaitrader.core.network.SettingUpdateRequest(key, value)) }
    override suspend fun pairs() = safeCall { api.adminPairs() }
    override suspend fun syncPairs() = safeCall { api.adminSyncPairs() }
    override suspend fun togglePair(symbol: String, enabled: Boolean) =
        safeCall { api.adminTogglePair(symbol, com.rsaitrader.core.network.PairToggleRequest(enabled)) }
    override suspend fun killSwitch(engage: Boolean, reason: String) =
        safeCall { api.adminKillSwitch(KillSwitchRequest(engage, reason)) }
    override suspend fun updateUser(id: String, status: String?, role: String?) =
        safeCall { api.adminUpdateUser(id, com.rsaitrader.core.network.AdminUserUpdate(status, role)) }
}
