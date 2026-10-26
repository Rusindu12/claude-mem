package com.rsaitrader.core.network

import kotlinx.serialization.json.JsonElement
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/**
 * RS AI TRADER backend contract (prefix /api/v1).
 *
 * The Android app never calls api.binance.com: all exchange access happens on
 * the backend so that API secrets can never be extracted from the APK.
 */
interface ApiService {

    // ---------------------------------------------------------------- auth
    @POST("api/v1/auth/register")
    suspend fun register(@Body body: RegisterRequest): Response<TokenPair>

    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<TokenPair>

    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Response<TokenPair>

    @POST("api/v1/auth/logout")
    suspend fun logout(@Body body: LogoutRequest): Response<Unit>

    @POST("api/v1/auth/logout-all")
    suspend fun logoutAll(): Response<MessageResponse>

    @GET("api/v1/auth/me")
    suspend fun me(): Response<UserDto>

    @PATCH("api/v1/auth/me")
    suspend fun updateProfile(
        @Query("display_name") displayName: String? = null,
        @Query("language") language: String? = null,
    ): Response<UserDto>

    @POST("api/v1/auth/password/change")
    suspend fun changePassword(@Body body: ChangePasswordRequest): Response<MessageResponse>

    @POST("api/v1/auth/password/reset/request")
    suspend fun requestPasswordReset(@Body body: PasswordResetRequest): Response<JsonElement>

    @POST("api/v1/auth/password/reset/confirm")
    suspend fun confirmPasswordReset(@Body body: PasswordResetConfirm): Response<MessageResponse>

    @GET("api/v1/auth/sessions")
    suspend fun sessions(): Response<List<SessionDto>>

    @DELETE("api/v1/auth/sessions/{id}")
    suspend fun revokeSession(@Path("id") id: String): Response<Unit>

    @DELETE("api/v1/auth/account")
    suspend fun deleteAccount(@Body body: DeleteAccountRequest): Response<MessageResponse>

    @POST("api/v1/auth/fcm-token")
    suspend fun registerFcmToken(@Body body: FcmTokenRequest): Response<Unit>

    // -------------------------------------------------------------- market
    @GET("api/v1/config")
    suspend fun appConfig(): Response<AppConfigDto>

    @GET("api/v1/market/overview")
    suspend fun overview(): Response<OverviewDto>

    @GET("api/v1/market/tickers")
    suspend fun tickers(@Query("symbols") symbols: String? = null): Response<List<TickerDto>>

    @GET("api/v1/market/ticker/{symbol}")
    suspend fun ticker(@Path("symbol") symbol: String): Response<TickerDto>

    @GET("api/v1/market/klines/{symbol}")
    suspend fun klines(
        @Path("symbol") symbol: String,
        @Query("interval") interval: String = "1h",
        @Query("limit") limit: Int = 300,
    ): Response<KlineResponse>

    @GET("api/v1/market/depth/{symbol}")
    suspend fun depth(@Path("symbol") symbol: String, @Query("limit") limit: Int = 20): Response<DepthDto>

    @GET("api/v1/market/trades/{symbol}")
    suspend fun recentTrades(@Path("symbol") symbol: String, @Query("limit") limit: Int = 30): Response<List<TradeTickDto>>

    @GET("api/v1/market/pairs")
    suspend fun pairs(): Response<PairsResponse>

    // ------------------------------------------------------------- signals
    @GET("api/v1/signals/{symbol}")
    suspend fun signal(
        @Path("symbol") symbol: String,
        @Query("timeframe") timeframe: String = "1h",
    ): Response<SignalDto>

    @GET("api/v1/signals/{symbol}/latest")
    suspend fun latestSignal(
        @Path("symbol") symbol: String,
        @Query("timeframe") timeframe: String = "1h",
    ): Response<SignalDto>

    @GET("api/v1/signals/{symbol}/model")
    suspend fun modelReport(
        @Path("symbol") symbol: String,
        @Query("timeframe") timeframe: String = "1h",
    ): Response<ModelReportDto>

    @POST("api/v1/signals/backtest")
    suspend fun backtest(@Body body: BacktestRequest): Response<BacktestResultDto>

    @GET("api/v1/signals/backtests/history")
    suspend fun backtestHistory(@Query("limit") limit: Int = 20): Response<List<JsonElement>>

    // -------------------------------------------------------------- orders
    @POST("api/v1/orders/preview")
    suspend fun previewOrder(@Body body: OrderRequest): Response<OrderPreviewDto>

    @POST("api/v1/orders")
    suspend fun placeOrder(@Body body: OrderCreateRequest): Response<OrderDto>

    @GET("api/v1/orders")
    suspend fun orders(
        @Query("mode") mode: String = "paper",
        @Query("open_only") openOnly: Boolean = false,
        @Query("limit") limit: Int = 100,
    ): Response<List<OrderDto>>

    @GET("api/v1/orders/{id}")
    suspend fun order(@Path("id") id: String, @Query("mode") mode: String = "paper"): Response<OrderDto>

    @POST("api/v1/orders/{id}/cancel")
    suspend fun cancelOrder(
        @Path("id") id: String,
        @Query("mode") mode: String = "paper",
    ): Response<CancelResponse>

    @POST("api/v1/orders/reconcile")
    suspend fun reconcileOrders(): Response<JsonElement>

    @Streaming
    @GET("api/v1/orders/export.csv")
    suspend fun exportOrders(@Query("mode") mode: String = "paper"): Response<ResponseBody>

    // ----------------------------------------------------------- portfolio
    @GET("api/v1/portfolio")
    suspend fun portfolio(@Query("mode") mode: String = "paper"): Response<PortfolioDto>

    @GET("api/v1/portfolio/analytics")
    suspend fun analytics(
        @Query("mode") mode: String = "paper",
        @Query("days") days: Int = 30,
    ): Response<AnalyticsDto>

    @POST("api/v1/portfolio/paper/reset")
    suspend fun resetPaper(@Query("starting_equity") startingEquity: String = "10000"): Response<MessageResponse>

    @Streaming
    @GET("api/v1/portfolio/export/trades.csv")
    suspend fun exportTrades(): Response<ResponseBody>

    // ---------------------------------------------------------------- risk
    @GET("api/v1/risk/policy")
    suspend fun riskPolicy(): Response<RiskPolicyDto>

    @PUT("api/v1/risk/policy")
    suspend fun updateRiskPolicy(@Body body: RiskPolicyUpdate): Response<RiskPolicyDto>

    @GET("api/v1/risk/status")
    suspend fun riskStatus(): Response<RiskStatusDto>

    @POST("api/v1/risk/live-opt-in")
    suspend fun liveOptIn(@Body body: LiveOptInRequest): Response<JsonElement>

    @POST("api/v1/risk/emergency-stop")
    suspend fun emergencyStop(): Response<JsonElement>

    // -------------------------------------------------------------- alerts
    @GET("api/v1/alerts")
    suspend fun alerts(): Response<List<AlertDto>>

    @POST("api/v1/alerts")
    suspend fun createAlert(@Body body: AlertCreateRequest): Response<AlertDto>

    @DELETE("api/v1/alerts/{id}")
    suspend fun deleteAlert(@Path("id") id: String): Response<Unit>

    @POST("api/v1/alerts/evaluate")
    suspend fun evaluateAlerts(): Response<AlertEvaluationDto>

    // ----------------------------------------------------------- assistant
    @POST("api/v1/assistant/ask")
    suspend fun askAssistant(@Body body: AssistantQuery): Response<AssistantAnswerDto>

    @GET("api/v1/assistant/history")
    suspend fun assistantHistory(@Query("limit") limit: Int = 50): Response<List<AssistantHistoryDto>>

    // --------------------------------------------------------- credentials
    @GET("api/v1/credentials")
    suspend fun credentials(): Response<CredentialListDto>

    @POST("api/v1/credentials")
    suspend fun addCredential(@Body body: CredentialCreateRequest): Response<CredentialDto>

    @POST("api/v1/credentials/{id}/verify")
    suspend fun verifyCredential(@Path("id") id: String): Response<JsonElement>

    @DELETE("api/v1/credentials/{id}")
    suspend fun revokeCredential(@Path("id") id: String): Response<Unit>

    // --------------------------------------------------------------- misc
    @GET("api/v1/notifications")
    suspend fun notifications(@Query("limit") limit: Int = 50): Response<List<NotificationDto>>

    @POST("api/v1/notifications/read")
    suspend fun markNotificationsRead(@Body body: NotificationReadRequest = NotificationReadRequest()): Response<JsonElement>

    // -------------------------------------------------------------- admin
    @GET("api/v1/admin/users")
    suspend fun adminUsers(@Query("search") search: String? = null): Response<AdminUsersResponse>

    @PATCH("api/v1/admin/users/{id}")
    suspend fun adminUpdateUser(@Path("id") id: String, @Body body: AdminUserUpdate): Response<UserDto>

    @GET("api/v1/admin/health")
    suspend fun adminHealth(): Response<AdminHealthDto>

    @GET("api/v1/admin/audit")
    suspend fun adminAudit(@Query("limit") limit: Int = 100): Response<List<AuditEventDto>>

    @GET("api/v1/admin/settings")
    suspend fun adminSettings(): Response<AdminSettingsResponse>

    @PUT("api/v1/admin/settings")
    suspend fun adminUpdateSetting(@Body body: SettingUpdateRequest): Response<JsonElement>

    @GET("api/v1/admin/pairs")
    suspend fun adminPairs(): Response<List<PairDto>>

    @POST("api/v1/admin/pairs/sync")
    suspend fun adminSyncPairs(): Response<JsonElement>

    @PATCH("api/v1/admin/pairs/{symbol}")
    suspend fun adminTogglePair(@Path("symbol") symbol: String, @Body body: PairToggleRequest): Response<JsonElement>

    @POST("api/v1/admin/kill-switch")
    suspend fun adminKillSwitch(@Body body: KillSwitchRequest): Response<JsonElement>
}
