package com.rsaitrader.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Wire models mirroring the FastAPI OpenAPI schema (/docs).
 *
 * All fields have defaults so a backend addition never crashes an older APK.
 * There are no Binance credentials anywhere in this package: the app only ever
 * talks to the RS AI TRADER backend.
 */

@Serializable
data class ApiErrorBody(val error: ApiError? = null)

@Serializable
data class ApiError(
    val code: String = "unknown",
    val message: String = "Something went wrong.",
    val details: JsonObject = JsonObject(emptyMap()),
)

// ------------------------------------------------------------------- auth
@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    @SerialName("display_name") val displayName: String = "Trader",
    val language: String = "en",
)

@Serializable
data class RefreshRequest(@SerialName("refresh_token") val refreshToken: String)

@Serializable
data class LogoutRequest(@SerialName("refresh_token") val refreshToken: String? = null)

@Serializable
data class UserDto(
    val id: String = "",
    val email: String = "",
    @SerialName("display_name") val displayName: String = "",
    val role: String = "user",
    val status: String = "active",
    val language: String = "en",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_login_at") val lastLoginAt: String? = null,
)

@Serializable
data class TokenPair(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String = "Bearer",
    @SerialName("expires_in") val expiresIn: Int = 900,
    @SerialName("refresh_expires_in") val refreshExpiresIn: Int = 1209600,
    val user: UserDto,
)

@Serializable
data class ChangePasswordRequest(
    @SerialName("current_password") val currentPassword: String,
    @SerialName("new_password") val newPassword: String,
)

@Serializable
data class PasswordResetRequest(val email: String)

@Serializable
data class PasswordResetConfirm(val token: String, @SerialName("new_password") val newPassword: String)

@Serializable
data class SessionDto(
    val id: String,
    val device: String = "Device",
    @SerialName("ip_address") val ipAddress: String? = null,
    @SerialName("user_agent") val userAgent: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("expires_at") val expiresAt: String = "",
    val current: Boolean = false,
)

@Serializable
data class FcmTokenRequest(val token: String)

@Serializable
data class DeleteAccountRequest(val password: String, val confirmation: String = "DELETE")

// ----------------------------------------------------------------- market
@Serializable
data class TickerDto(
    val symbol: String = "",
    val price: Double = 0.0,
    @SerialName("change_percent_24h") val changePercent24h: Double = 0.0,
    @SerialName("high_24h") val high24h: Double = 0.0,
    @SerialName("low_24h") val low24h: Double = 0.0,
    @SerialName("volume_24h") val volume24h: Double = 0.0,
    @SerialName("quote_volume_24h") val quoteVolume24h: Double = 0.0,
    @SerialName("fetched_at") val fetchedAt: String = "",
    @SerialName("exchange_close_time") val exchangeCloseTime: String? = null,
    @SerialName("age_seconds") val ageSeconds: Double? = null,
    val source: String = "unknown",
    val synthetic: Boolean = false,
    val stale: Boolean = false,
)

@Serializable
data class KlineDto(
    val time: String = "",
    val open: Double = 0.0,
    val high: Double = 0.0,
    val low: Double = 0.0,
    val close: Double = 0.0,
    val volume: Double = 0.0,
)

@Serializable
data class KlineResponse(
    val symbol: String = "",
    val interval: String = "",
    val klines: List<KlineDto> = emptyList(),
    val source: String = "unknown",
    val synthetic: Boolean = false,
    @SerialName("fetched_at") val fetchedAt: String = "",
    @SerialName("last_candle_close") val lastCandleClose: String? = null,
    @SerialName("age_seconds") val ageSeconds: Double = 0.0,
    val stale: Boolean = false,
)

@Serializable
data class DepthDto(
    val symbol: String = "",
    val bids: List<List<Double>> = emptyList(),
    val asks: List<List<Double>> = emptyList(),
    @SerialName("best_bid") val bestBid: Double? = null,
    @SerialName("best_ask") val bestAsk: Double? = null,
    @SerialName("spread_bps") val spreadBps: Double? = null,
    val imbalance: Double? = null,
    val source: String = "unknown",
    val synthetic: Boolean = false,
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class TradeTickDto(
    val id: Long? = null,
    val price: Double = 0.0,
    val quantity: Double = 0.0,
    val time: String = "",
    @SerialName("buyer_is_maker") val buyerIsMaker: Boolean = false,
    val source: String = "unknown",
)

@Serializable
data class ConnectionDto(
    val status: String = "unknown",
    val provider: String = "unknown",
    val synthetic: Boolean = false,
    @SerialName("degraded_reason") val degradedReason: String? = null,
)

@Serializable
data class FreshnessDto(
    @SerialName("stale_after_seconds") val staleAfterSeconds: Int = 180,
    @SerialName("oldest_age_seconds") val oldestAgeSeconds: Double? = null,
    @SerialName("any_stale") val anyStale: Boolean = false,
)

@Serializable
data class OverviewDto(
    val tickers: List<TickerDto> = emptyList(),
    val connection: ConnectionDto = ConnectionDto(),
    val freshness: FreshnessDto = FreshnessDto(),
    @SerialName("server_time") val serverTime: String = "",
)

@Serializable
data class PairDto(
    val symbol: String = "",
    val enabled: Boolean = true,
    @SerialName("base_asset") val baseAsset: String = "",
    @SerialName("quote_asset") val quoteAsset: String = "USDT",
    val status: String = "TRADING",
    @SerialName("min_qty") val minQty: String? = null,
    @SerialName("step_size") val stepSize: String? = null,
    @SerialName("tick_size") val tickSize: String? = null,
    @SerialName("min_notional") val minNotional: String? = null,
)

@Serializable
data class PairsResponse(
    val symbols: List<PairDto> = emptyList(),
    val timeframes: List<String> = emptyList(),
    val source: String = "unknown",
    val synthetic: Boolean = false,
)

// ---------------------------------------------------------------- signals
@Serializable
data class DataQualityDto(
    val bars: Int = 0,
    @SerialName("expected_bars") val expectedBars: Int = 0,
    @SerialName("last_close_time") val lastCloseTime: String? = null,
    @SerialName("age_seconds") val ageSeconds: Double? = null,
    val stale: Boolean = false,
    val gaps: Int = 0,
    val sufficient: Boolean = false,
    val issues: List<String> = emptyList(),
)

@Serializable
data class RegimeDto(
    val label: String = "unknown",
    @SerialName("volatility_state") val volatilityState: String = "unknown",
    @SerialName("trend_strength") val trendStrength: Double? = null,
    val reasons: List<String> = emptyList(),
)

@Serializable
data class SignalDto(
    val symbol: String = "",
    val timeframe: String = "",
    val action: String = "HOLD",
    @SerialName("generated_at") val generatedAt: String = "",
    val price: Double? = null,
    val reasons: List<String> = emptyList(),
    val indicators: JsonObject = JsonObject(emptyMap()),
    @SerialName("entry_low") val entryLow: Double? = null,
    @SerialName("entry_high") val entryHigh: Double? = null,
    @SerialName("stop_loss") val stopLoss: Double? = null,
    @SerialName("take_profit") val takeProfit: Double? = null,
    @SerialName("risk_reward") val riskReward: Double? = null,
    val invalidation: List<String> = emptyList(),
    @SerialName("model_version") val modelVersion: String = "",
    @SerialName("model_status") val modelStatus: String = "unavailable",
    @SerialName("probability_up") val probabilityUp: Double? = null,
    @SerialName("probability_down") val probabilityDown: Double? = null,
    val score: Double = 0.0,
    @SerialName("evidence_grade") val evidenceGrade: String = "none",
    val disclaimer: String = "",
    @SerialName("data_quality") val dataQuality: DataQualityDto = DataQualityDto(),
    val regime: RegimeDto = RegimeDto(),
    @SerialName("data_source") val dataSource: String? = null,
    @SerialName("bars_used") val barsUsed: Int? = null,
    @SerialName("data_age_seconds") val dataAgeSeconds: Double? = null,
    val synthetic: Boolean = false,
)

@Serializable
data class ModelReportDto(
    val available: Boolean = false,
    val note: String? = null,
    @SerialName("model_version") val modelVersion: String? = null,
    @SerialName("trained_at") val trainedAt: String? = null,
    val evaluation: JsonObject? = null,
)

@Serializable
data class BacktestRequest(
    val symbol: String,
    val timeframe: String = "1h",
    val days: Int = 30,
    @SerialName("initial_capital") val initialCapital: Double = 10_000.0,
    @SerialName("fee_bps") val feeBps: Double? = null,
    @SerialName("slippage_bps") val slippageBps: Double? = null,
)

@Serializable
data class BacktestMetrics(
    @SerialName("total_return_pct") val totalReturnPct: Double = 0.0,
    @SerialName("max_drawdown_pct") val maxDrawdownPct: Double = 0.0,
    @SerialName("win_rate_pct") val winRatePct: Double? = null,
    @SerialName("trade_count") val tradeCount: Int = 0,
    @SerialName("profit_factor") val profitFactor: Double? = null,
    @SerialName("sharpe_annualised") val sharpeAnnualised: Double? = null,
    @SerialName("fees_and_slippage_paid") val feesAndSlippagePaid: Double? = null,
    @SerialName("final_equity") val finalEquity: Double = 0.0,
)

@Serializable
data class BacktestResultDto(
    val symbol: String = "",
    val timeframe: String = "",
    val start: String = "",
    val end: String = "",
    val bars: Int = 0,
    val metrics: BacktestMetrics = BacktestMetrics(),
    val assumptions: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
    @SerialName("buy_and_hold") val buyAndHold: JsonObject? = null,
    @SerialName("backtest_id") val backtestId: String? = null,
)

// ----------------------------------------------------------------- orders
@Serializable
data class OrderRequest(
    val symbol: String,
    val side: String,
    @SerialName("order_type") val orderType: String = "MARKET",
    val quantity: String,
    val price: String? = null,
    @SerialName("stop_price") val stopPrice: String? = null,
    @SerialName("stop_loss") val stopLoss: String? = null,
    @SerialName("take_profit") val takeProfit: String? = null,
    val mode: String = "paper",
    @SerialName("time_in_force") val timeInForce: String? = null,
    @SerialName("signal_id") val signalId: String? = null,
)

@Serializable
data class OrderCreateRequest(
    val symbol: String,
    val side: String,
    @SerialName("order_type") val orderType: String = "MARKET",
    val quantity: String,
    val price: String? = null,
    @SerialName("stop_price") val stopPrice: String? = null,
    @SerialName("stop_loss") val stopLoss: String? = null,
    @SerialName("take_profit") val takeProfit: String? = null,
    val mode: String = "paper",
    @SerialName("time_in_force") val timeInForce: String? = null,
    @SerialName("signal_id") val signalId: String? = null,
    @SerialName("idempotency_key") val idempotencyKey: String,
    val approved: Boolean = false,
)

@Serializable
data class RiskCheckDto(
    val name: String = "",
    val passed: Boolean = false,
    val severity: String = "block",
    val detail: String = "",
)

@Serializable
data class RiskViolationDto(val code: String = "", val message: String = "")

@Serializable
data class RiskDecisionDto(
    val approved: Boolean = false,
    val violations: List<RiskViolationDto> = emptyList(),
    val warnings: List<String> = emptyList(),
    val checks: List<RiskCheckDto> = emptyList(),
)

@Serializable
data class MarketContextDto(
    val source: String? = null,
    val synthetic: Boolean = false,
    val stale: Boolean = false,
    @SerialName("age_seconds") val ageSeconds: Double? = null,
    @SerialName("spread_bps") val spreadBps: Double? = null,
    @SerialName("volatility_pct") val volatilityPct: Double? = null,
)

@Serializable
data class OrderPreviewDto(
    val symbol: String = "",
    val mode: String = "paper",
    val side: String = "BUY",
    @SerialName("order_type") val orderType: String = "MARKET",
    val quantity: String = "0",
    @SerialName("reference_price") val referencePrice: String = "0",
    @SerialName("estimated_notional") val estimatedNotional: String = "0",
    @SerialName("estimated_fee_usdt") val estimatedFeeUsdt: String = "0",
    @SerialName("estimated_slippage_bps") val estimatedSlippageBps: Double = 0.0,
    val adjustments: List<String> = emptyList(),
    val risk: RiskDecisionDto = RiskDecisionDto(),
    @SerialName("can_place") val canPlace: Boolean = false,
    val market: MarketContextDto = MarketContextDto(),
    val filters: JsonObject? = null,
)

@Serializable
data class OrderDto(
    val id: String = "",
    val mode: String = "paper",
    val symbol: String = "",
    val side: String = "BUY",
    @SerialName("order_type") val orderType: String = "MARKET",
    val quantity: String = "0",
    val price: String? = null,
    @SerialName("stop_loss") val stopLoss: String? = null,
    @SerialName("take_profit") val takeProfit: String? = null,
    val status: String = "",
    @SerialName("filled_quantity") val filledQuantity: String = "0",
    @SerialName("average_fill_price") val averageFillPrice: String? = null,
    @SerialName("fee_paid") val feePaid: String = "0",
    val approved: Boolean = false,
    val environment: String = "paper",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("idempotent_replay") val idempotentReplay: Boolean = false,
    val simulated: Boolean = false,
)

@Serializable
data class CancelResponse(val id: String = "", val status: String = "", val mode: String = "paper")

// -------------------------------------------------------------- portfolio
@Serializable
data class PositionDto(
    val id: String = "",
    val symbol: String = "",
    val quantity: String = "0",
    @SerialName("entry_price") val entryPrice: String = "0",
    @SerialName("current_price") val currentPrice: String? = null,
    @SerialName("unrealized_pnl") val unrealizedPnl: String? = null,
    @SerialName("stop_loss") val stopLoss: String? = null,
    @SerialName("take_profit") val takeProfit: String? = null,
    @SerialName("market_value") val marketValue: String? = null,
    @SerialName("opened_at") val openedAt: String? = null,
    val simulated: Boolean = true,
)

@Serializable
data class BalanceDto(
    val asset: String = "",
    val free: String = "0",
    val locked: String = "0",
    @SerialName("usdt_value") val usdtValue: String? = null,
    val priced: Boolean = true,
)

@Serializable
data class PortfolioDto(
    val mode: String = "paper",
    val simulated: Boolean = true,
    val environment: String? = null,
    @SerialName("starting_equity") val startingEquity: String? = null,
    @SerialName("quote_balance") val quoteBalance: String? = null,
    @SerialName("total_value_usdt") val totalValueUsdt: String = "0",
    @SerialName("available_usdt") val availableUsdt: String? = null,
    @SerialName("holdings_value") val holdingsValue: String? = null,
    @SerialName("realized_pnl") val realizedPnl: String? = null,
    @SerialName("unrealized_pnl") val unrealizedPnl: String? = null,
    @SerialName("fees_paid") val feesPaid: String? = null,
    val exposure: String? = null,
    @SerialName("position_count") val positionCount: Int = 0,
    val positions: List<PositionDto> = emptyList(),
    val balances: List<BalanceDto> = emptyList(),
    val note: String? = null,
    @SerialName("can_trade") val canTrade: Boolean? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class AnalyticsSummaryDto(
    val equity: String? = null,
    @SerialName("realized_pnl") val realizedPnl: String? = null,
    @SerialName("unrealized_pnl") val unrealizedPnl: String? = null,
    @SerialName("fees_paid") val feesPaid: String? = null,
    @SerialName("return_pct") val returnPct: String? = null,
    @SerialName("max_drawdown_pct") val maxDrawdownPct: String? = null,
    @SerialName("win_rate_pct") val winRatePct: String? = null,
    @SerialName("trade_count") val tradeCount: Int? = null,
    @SerialName("profit_factor") val profitFactor: String? = null,
)

@Serializable
data class CostAssumptionsDto(
    @SerialName("taker_fee_bps") val takerFeeBps: Double = 0.0,
    @SerialName("slippage_bps") val slippageBps: Double = 0.0,
)

@Serializable
data class AnalyticsDto(
    val mode: String = "paper",
    val simulated: Boolean = true,
    @SerialName("window_days") val windowDays: Int = 30,
    val summary: AnalyticsSummaryDto = AnalyticsSummaryDto(),
    val daily: List<JsonObject> = emptyList(),
    val note: String? = null,
    @SerialName("cost_assumptions") val costAssumptions: CostAssumptionsDto? = null,
)

// -------------------------------------------------------------------- risk
@Serializable
data class RiskPolicyDto(
    @SerialName("max_trade_notional") val maxTradeNotional: String = "100",
    @SerialName("max_portfolio_exposure_pct") val maxPortfolioExposurePct: String = "25",
    @SerialName("max_daily_loss") val maxDailyLoss: String = "50",
    @SerialName("max_risk_per_trade_pct") val maxRiskPerTradePct: String = "1",
    @SerialName("max_open_orders") val maxOpenOrders: Int = 3,
    @SerialName("max_open_positions") val maxOpenPositions: Int = 2,
    @SerialName("stop_loss_required") val stopLossRequired: Boolean = true,
    @SerialName("cooldown_after_losses") val cooldownAfterLosses: Int = 3,
    @SerialName("cooldown_minutes") val cooldownMinutes: Int = 60,
    @SerialName("live_opt_in") val liveOptIn: Boolean = false,
    @SerialName("automation_opt_in") val automationOptIn: Boolean = false,
    @SerialName("cooldown_until") val cooldownUntil: String? = null,
    @SerialName("consecutive_losses") val consecutiveLosses: Int = 0,
)

@Serializable
data class RiskPolicyUpdate(
    @SerialName("max_trade_notional") val maxTradeNotional: String? = null,
    @SerialName("max_portfolio_exposure_pct") val maxPortfolioExposurePct: String? = null,
    @SerialName("max_daily_loss") val maxDailyLoss: String? = null,
    @SerialName("max_risk_per_trade_pct") val maxRiskPerTradePct: String? = null,
    @SerialName("max_open_orders") val maxOpenOrders: Int? = null,
    @SerialName("max_open_positions") val maxOpenPositions: Int? = null,
    @SerialName("stop_loss_required") val stopLossRequired: Boolean? = null,
    @SerialName("cooldown_after_losses") val cooldownAfterLosses: Int? = null,
    @SerialName("cooldown_minutes") val cooldownMinutes: Int? = null,
    @SerialName("automation_opt_in") val automationOptIn: Boolean? = null,
)

@Serializable
data class TradingControlDto(
    @SerialName("kill_switch") val killSwitch: Boolean = false,
    val reason: String? = null,
    @SerialName("stale_data_block") val staleDataBlock: Boolean = false,
    @SerialName("api_error_block") val apiErrorBlock: Boolean = false,
    @SerialName("activated_at") val activatedAt: String? = null,
)

@Serializable
data class ServerRiskConfigDto(
    @SerialName("live_trading_enabled") val liveTradingEnabled: Boolean = false,
    @SerialName("automation_enabled") val automationEnabled: Boolean = false,
    @SerialName("require_manual_approval") val requireManualApproval: Boolean = true,
    @SerialName("binance_environment") val binanceEnvironment: String = "testnet",
    @SerialName("risk_engine_enabled") val riskEngineEnabled: Boolean = true,
)

@Serializable
data class RiskUsageDto(
    @SerialName("daily_realized_pnl") val dailyRealizedPnl: String = "0",
    @SerialName("daily_loss_limit") val dailyLossLimit: String = "0",
    @SerialName("cooldown_active") val cooldownActive: Boolean = false,
    @SerialName("open_live_orders") val openLiveOrders: Int = 0,
    @SerialName("unreconciled_orders") val unreconciledOrders: Int = 0,
)

@Serializable
data class MarketHealthDto(
    val provider: String = "unknown",
    val synthetic: Boolean = false,
    val degraded: Boolean = false,
    @SerialName("degraded_reason") val degradedReason: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("market_stale_after_seconds") val marketStaleAfterSeconds: Int = 180,
)

@Serializable
data class RiskStatusDto(
    val policy: RiskPolicyDto = RiskPolicyDto(),
    val control: TradingControlDto = TradingControlDto(),
    val server: ServerRiskConfigDto = ServerRiskConfigDto(),
    val usage: RiskUsageDto = RiskUsageDto(),
    val market: MarketHealthDto = MarketHealthDto(),
    @SerialName("can_trade_live") val canTradeLive: Boolean = false,
)

@Serializable
data class LiveOptInRequest(
    @SerialName("opt_in") val optIn: Boolean,
    val confirmation: String,
    @SerialName("acknowledge_risk") val acknowledgeRisk: Boolean,
)

@Serializable
data class KillSwitchRequest(val engage: Boolean, val reason: String)

// ------------------------------------------------------------------ alerts
@Serializable
data class AlertDto(
    val id: String = "",
    val symbol: String = "",
    val condition: String = "",
    @SerialName("target_price") val targetPrice: String? = null,
    val status: String = "active",
    val note: String? = null,
    @SerialName("triggered_at") val triggeredAt: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class AlertCreateRequest(
    val symbol: String,
    val condition: String,
    @SerialName("target_price") val targetPrice: String? = null,
    val note: String? = null,
)

@Serializable
data class AlertEvaluationDto(
    val evaluated: Boolean = false,
    val triggered: List<JsonObject> = emptyList(),
)

// --------------------------------------------------------------- assistant
@Serializable
data class AssistantQuery(
    val question: String,
    val lang: String? = null,
    val symbol: String? = null,
    val timeframe: String? = null,
    @SerialName("include_portfolio") val includePortfolio: Boolean = true,
)

@Serializable
data class AssistantAnswerDto(
    val id: String = "",
    val question: String = "",
    val answer: String = "",
    val lang: String = "en",
    val intent: String = "app",
    val facts: JsonObject = JsonObject(emptyMap()),
    val limitations: List<String> = emptyList(),
    @SerialName("data_as_of") val dataAsOf: String? = null,
    val refused: Boolean = false,
    val disclaimer: String = "",
)

@Serializable
data class AssistantHistoryDto(
    val id: String = "",
    val question: String = "",
    val answer: String = "",
    val lang: String = "en",
    val intent: String = "app",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("data_as_of") val dataAsOf: String? = null,
)

// ------------------------------------------------------------- credentials
@Serializable
data class CredentialDto(
    val id: String = "",
    val label: String = "",
    val environment: String = "testnet",
    @SerialName("masked_key") val maskedKey: String = "",
    val status: String = "active",
    val permissions: JsonObject = JsonObject(emptyMap()),
    @SerialName("ip_restricted") val ipRestricted: Boolean = false,
    @SerialName("last_verified_at") val lastVerifiedAt: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class CredentialListDto(
    val environment: String = "testnet",
    val credentials: List<CredentialDto> = emptyList(),
    val guidance: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class CredentialCreateRequest(
    @SerialName("api_key") val apiKey: String,
    @SerialName("api_secret") val apiSecret: String,
    val label: String = "Binance",
    val environment: String? = null,
)

// ---------------------------------------------------------------- platform
@Serializable
data class AppConfigDto(
    @SerialName("app_name") val appName: String = "RS AI TRADER",
    val environment: String = "development",
    @SerialName("binance_environment") val binanceEnvironment: String = "testnet",
    @SerialName("maintenance_mode") val maintenanceMode: Boolean = false,
    @SerialName("min_app_version") val minAppVersion: String = "1.0.0",
    @SerialName("assistant_enabled") val assistantEnabled: Boolean = true,
    @SerialName("supported_symbols") val supportedSymbols: List<String> = emptyList(),
    @SerialName("supported_timeframes") val supportedTimeframes: List<String> = emptyList(),
    @SerialName("paper_trading_enabled") val paperTradingEnabled: Boolean = true,
    @SerialName("live_trading_enabled") val liveTradingEnabled: Boolean = false,
    @SerialName("automation_enabled") val automationEnabled: Boolean = false,
    @SerialName("require_manual_approval") val requireManualApproval: Boolean = true,
    @SerialName("market_data") val marketData: MarketHealthDto = MarketHealthDto(),
    @SerialName("stale_after_seconds") val staleAfterSeconds: Int = 180,
    @SerialName("assistant_languages") val assistantLanguages: List<String> = emptyList(),
    val disclaimer: String = "",
    @SerialName("server_time") val serverTime: String = "",
)

@Serializable
data class NotificationDto(
    val id: String = "",
    val kind: String = "",
    val title: String = "",
    val body: String = "",
    val severity: String = "info",
    val read: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class NotificationReadRequest(@SerialName("notification_id") val notificationId: String? = null)

// ------------------------------------------------------------------- admin
@Serializable
data class AdminUserDto(
    val id: String = "",
    val email: String = "",
    @SerialName("display_name") val displayName: String = "",
    val role: String = "user",
    val status: String = "active",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("last_login_at") val lastLoginAt: String? = null,
    @SerialName("has_exchange_key") val hasExchangeKey: Boolean = false,
)

@Serializable
data class AdminUsersResponse(
    val total: Int = 0,
    val users: List<AdminUserDto> = emptyList(),
    val note: String? = null,
)

@Serializable
data class AdminUserUpdate(val status: String? = null, val role: String? = null)

@Serializable
data class AdminCountsDto(
    val users: Int = 0,
    @SerialName("active_users") val activeUsers: Int = 0,
    @SerialName("paper_orders") val paperOrders: Int = 0,
    @SerialName("live_orders") val liveOrders: Int = 0,
    val signals: Int = 0,
    @SerialName("audit_events") val auditEvents: Int = 0,
)

@Serializable
data class AdminHealthDto(
    val database: String = "unknown",
    val market: MarketHealthDto = MarketHealthDto(),
    val config: JsonObject = JsonObject(emptyMap()),
    @SerialName("trading_control") val tradingControl: TradingControlDto = TradingControlDto(),
    val counts: AdminCountsDto = AdminCountsDto(),
    val time: String = "",
)

@Serializable
data class AdminSettingDto(
    val key: String = "",
    val value: kotlinx.serialization.json.JsonElement? = null,
    val description: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class AdminSettingsResponse(val settings: List<AdminSettingDto> = emptyList())

@Serializable
data class SettingUpdateRequest(val key: String, val value: kotlinx.serialization.json.JsonElement)

@Serializable
data class AuditEventDto(
    val id: String = "",
    val user_id: String? = null,
    val actor_role: String = "anonymous",
    val action: String = "",
    val outcome: String = "success",
    val detail: JsonObject = JsonObject(emptyMap()),
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class PairToggleRequest(val enabled: Boolean)

@Serializable
data class MessageResponse(val message: String? = null)
