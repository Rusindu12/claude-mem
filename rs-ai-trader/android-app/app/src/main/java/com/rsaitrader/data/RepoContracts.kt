package com.rsaitrader.data

import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AlertDto
import com.rsaitrader.core.network.AnalyticsDto
import com.rsaitrader.core.network.AppConfigDto
import com.rsaitrader.core.network.AssistantAnswerDto
import com.rsaitrader.core.network.AssistantHistoryDto
import com.rsaitrader.core.network.BacktestRequest
import com.rsaitrader.core.network.BacktestResultDto
import com.rsaitrader.core.network.CancelResponse
import com.rsaitrader.core.network.CredentialDto
import com.rsaitrader.core.network.CredentialListDto
import com.rsaitrader.core.network.DepthDto
import com.rsaitrader.core.network.KlineResponse
import com.rsaitrader.core.network.MarketHealthDto
import com.rsaitrader.core.network.ModelReportDto
import com.rsaitrader.core.network.NotificationDto
import com.rsaitrader.core.network.OrderCreateRequest
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.core.network.OrderPreviewDto
import com.rsaitrader.core.network.OrderRequest
import com.rsaitrader.core.network.OverviewDto
import com.rsaitrader.core.network.PairsResponse
import com.rsaitrader.core.network.PortfolioDto
import com.rsaitrader.core.network.RiskPolicyDto
import com.rsaitrader.core.network.RiskPolicyUpdate
import com.rsaitrader.core.network.RiskStatusDto
import com.rsaitrader.core.network.SessionDto
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.network.TokenPair
import com.rsaitrader.core.network.TradeTickDto
import com.rsaitrader.core.network.UserDto
import kotlinx.serialization.json.JsonElement

/**
 * Repository contracts.
 *
 * Two implementations exist for every contract:
 *  * the REST implementation in `Repositories.kt`, which talks to the backend
 *    (and through it to Binance), and
 *  * the on-device implementation in `core/offline`, which runs the whole app —
 *    accounts, market simulation, signals, paper trading, risk, admin — inside
 *    the APK with no server and no network.
 *
 * The UI only ever sees these interfaces, so switching engines never changes a
 * screen. The on-device engine is clearly labelled in the UI (see
 * `OfflineBanner`) and can never place a live exchange order: live mode is
 * rejected locally and only the backend can reach Binance.
 */
interface SessionApi {
    val user: UserDto?
    val isSignedIn: Boolean
    val isAdmin: Boolean

    suspend fun login(email: String, password: String): ApiResult<TokenPair>
    suspend fun register(email: String, password: String, displayName: String, language: String): ApiResult<TokenPair>
    suspend fun restore(): ApiResult<UserDto>
    suspend fun logout()
    suspend fun logoutEverywhere(): ApiResult<Unit>
    suspend fun sessions(): ApiResult<List<SessionDto>>
    suspend fun revokeSession(id: String): ApiResult<Unit>
    suspend fun deleteAccount(password: String, confirmation: String): ApiResult<Unit>
    suspend fun changePassword(current: String, newPassword: String): ApiResult<Unit>
    suspend fun requestPasswordReset(email: String): ApiResult<JsonElement>
    suspend fun confirmPasswordReset(token: String, newPassword: String): ApiResult<Unit>
    suspend fun updateProfile(displayName: String?, language: String?): ApiResult<UserDto>
}

interface MarketApi {
    suspend fun config(): ApiResult<AppConfigDto>
    suspend fun overview(): ApiResult<OverviewDto>
    suspend fun tickers(symbols: List<String>): ApiResult<List<TickerDto>>
    suspend fun ticker(symbol: String): ApiResult<TickerDto>
    suspend fun klines(symbol: String, interval: String, limit: Int = 300): ApiResult<KlineResponse>
    suspend fun depth(symbol: String, limit: Int = 15): ApiResult<DepthDto>
    suspend fun trades(symbol: String): ApiResult<List<TradeTickDto>>
    suspend fun pairs(): ApiResult<PairsResponse>
    suspend fun health(): ApiResult<MarketHealthDto>
}

interface SignalApi {
    suspend fun signal(symbol: String, timeframe: String): ApiResult<SignalDto>
    suspend fun latest(symbol: String, timeframe: String): ApiResult<SignalDto>
    suspend fun model(symbol: String, timeframe: String): ApiResult<ModelReportDto>
    suspend fun backtest(body: BacktestRequest): ApiResult<BacktestResultDto>
    suspend fun backtestHistory(): ApiResult<List<JsonElement>>
}

interface TradingApi {
    suspend fun preview(body: OrderRequest): ApiResult<OrderPreviewDto>
    suspend fun place(body: OrderCreateRequest): ApiResult<OrderDto>
    suspend fun orders(mode: String, openOnly: Boolean = false): ApiResult<List<OrderDto>>
    suspend fun cancel(id: String, mode: String): ApiResult<CancelResponse>
    suspend fun reconcile(): ApiResult<JsonElement>
}

interface PortfolioApi {
    suspend fun portfolio(mode: String): ApiResult<PortfolioDto>
    suspend fun analytics(mode: String, days: Int): ApiResult<AnalyticsDto>
    suspend fun resetPaper(startingEquity: String): ApiResult<Unit>
}

interface RiskApi {
    suspend fun policy(): ApiResult<RiskPolicyDto>
    suspend fun updatePolicy(body: RiskPolicyUpdate): ApiResult<RiskPolicyDto>
    suspend fun status(): ApiResult<RiskStatusDto>
    suspend fun optInLive(optIn: Boolean, confirmation: String, acknowledge: Boolean): ApiResult<JsonElement>
    suspend fun emergencyStop(): ApiResult<JsonElement>
}

interface AlertApi {
    suspend fun alerts(): ApiResult<List<AlertDto>>
    suspend fun create(symbol: String, condition: String, targetPrice: String?, note: String?): ApiResult<AlertDto>
    suspend fun delete(id: String): ApiResult<Unit>
    suspend fun evaluate(): ApiResult<Unit>
}

interface AssistantApi {
    suspend fun ask(question: String, lang: String?, symbol: String?, timeframe: String?): ApiResult<AssistantAnswerDto>
    suspend fun history(limit: Int = 50): ApiResult<List<AssistantHistoryDto>>
}

interface CredentialApi {
    suspend fun list(): ApiResult<CredentialListDto>
    suspend fun add(apiKey: String, apiSecret: String, label: String): ApiResult<CredentialDto>
    suspend fun verify(id: String): ApiResult<JsonElement>
    suspend fun revoke(id: String): ApiResult<Unit>
}

interface NotificationApi {
    suspend fun list(): ApiResult<List<NotificationDto>>
    suspend fun markRead(): ApiResult<Unit>
}

interface AdminApi {
    suspend fun users(search: String? = null): ApiResult<com.rsaitrader.core.network.AdminUsersResponse>
    suspend fun health(): ApiResult<com.rsaitrader.core.network.AdminHealthDto>
    suspend fun audit(): ApiResult<List<com.rsaitrader.core.network.AuditEventDto>>
    suspend fun settings(): ApiResult<com.rsaitrader.core.network.AdminSettingsResponse>
    suspend fun updateSetting(key: String, value: JsonElement): ApiResult<JsonElement>
    suspend fun pairs(): ApiResult<List<com.rsaitrader.core.network.PairDto>>
    suspend fun syncPairs(): ApiResult<JsonElement>
    suspend fun togglePair(symbol: String, enabled: Boolean): ApiResult<JsonElement>
    suspend fun killSwitch(engage: Boolean, reason: String): ApiResult<JsonElement>
    suspend fun updateUser(id: String, status: String?, role: String?): ApiResult<UserDto>
}
