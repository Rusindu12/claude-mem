package com.rsaitrader.core.offline

import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AdminCountsDto
import com.rsaitrader.core.network.AdminHealthDto
import com.rsaitrader.core.network.AdminSettingDto
import com.rsaitrader.core.network.AdminSettingsResponse
import com.rsaitrader.core.network.AdminUserDto
import com.rsaitrader.core.network.AdminUsersResponse
import com.rsaitrader.core.network.AlertDto
import com.rsaitrader.core.network.AnalyticsDto
import com.rsaitrader.core.network.AppConfigDto
import com.rsaitrader.core.network.AssistantAnswerDto
import com.rsaitrader.core.network.AssistantHistoryDto
import com.rsaitrader.core.network.AuditEventDto
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
import com.rsaitrader.core.network.PairDto
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
import com.rsaitrader.core.network.TradingControlDto
import com.rsaitrader.data.AdminApi
import com.rsaitrader.data.AlertApi
import com.rsaitrader.data.AssistantApi
import com.rsaitrader.data.CredentialApi
import com.rsaitrader.data.MarketApi
import com.rsaitrader.data.NotificationApi
import com.rsaitrader.data.PortfolioApi
import com.rsaitrader.data.RiskApi
import com.rsaitrader.data.SessionApi
import com.rsaitrader.data.SignalApi
import com.rsaitrader.data.TradingApi
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Local password hashing: PBKDF2-HMAC-SHA256, 120k iterations, 16-byte salt.
 *
 * The same primitive the backend uses (Argon2id there) so that a stolen state
 * file does not reveal passwords. The hash never leaves the device.
 */
internal object LocalAuth {
    private const val ITERATIONS = 120_000
    private const val KEY_LENGTH = 256

    fun newSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return Base64.getEncoder().encodeToString(bytes)
    }

    fun hash(password: String, salt: String): String {
        val saltBytes = Base64.getDecoder().decode(salt)
        val spec = PBEKeySpec(password.toCharArray(), saltBytes, ITERATIONS, KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return Base64.getEncoder().encodeToString(factory.generateSecret(spec).encoded)
    }

    fun verify(password: String, salt: String, expected: String): Boolean =
        runCatching { hash(password, salt) == expected }.getOrDefault(false)
}

private fun fail(message: String, code: String): ApiResult.Failure = ApiResult.Failure(message = message, code = code)

private val EMAIL = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")

// ---------------------------------------------------------------- session
class OfflineSessionRepository(
    private val store: OfflineStore,
    private val tokenStore: com.rsaitrader.core.network.TokenStore,
) : SessionApi {

    override val user: UserDto? get() = tokenStore.user()
    override val isSignedIn: Boolean get() = tokenStore.isSignedIn()
    override val isAdmin: Boolean get() = tokenStore.isAdmin

    private fun toDto(account: LocalAccount): UserDto = UserDto(
        id = account.id,
        email = account.email,
        displayName = account.displayName,
        role = account.role,
        status = account.status,
        language = account.language,
        createdAt = account.createdAt,
        lastLoginAt = account.lastLoginAt,
    )

    private fun tokenPair(account: LocalAccount): TokenPair {
        val now = Instant.now().toEpochMilli()
        return TokenPair(
            accessToken = "local-${account.id}-$now",
            refreshToken = "local-refresh-${account.id}-$now",
            tokenType = "Local",
            expiresIn = 86_400,
            refreshExpiresIn = 86_400,
            user = toDto(account),
        )
    }

    override suspend fun login(email: String, password: String): ApiResult<TokenPair> {
        val normalized = email.trim().lowercase()
        val account = store.state().accounts.firstOrNull { it.email == normalized }
            ?: return fail("Incorrect email or password.", "http_401")
        if (account.status != "active") return fail("This account is ${account.status}. Contact the administrator.", "http_403")
        if (!LocalAuth.verify(password, account.salt, account.passwordHash)) {
            store.audit(account.id, "anonymous", "login_failed", mapOf("reason" to "bad_password"))
            return fail("Incorrect email or password.", "http_401")
        }
        val updated = account.copy(lastLoginAt = store.now())
        store.update { state ->
            state.copy(accounts = state.accounts.map { if (it.id == account.id) updated else it })
        }
        store.audit(account.id, account.role, "login_success")
        val pair = tokenPair(updated)
        tokenStore.save(pair)
        return ApiResult.Success(pair)
    }

    override suspend fun register(
        email: String,
        password: String,
        displayName: String,
        language: String,
    ): ApiResult<TokenPair> {
        val normalized = email.trim().lowercase()
        if (!EMAIL.matches(normalized)) return fail("Enter a valid email address.", "validation")
        if (password.length < 10) return fail("Use at least 10 characters for the password.", "validation")
        if (store.state().accounts.any { it.email == normalized }) {
            return fail("An account with that email already exists on this device.", "user_exists")
        }
        val salt = LocalAuth.newSalt()
        val account = LocalAccount(
            id = OfflineStore.newId(),
            email = normalized,
            displayName = displayName.ifBlank { "Trader" },
            role = "user",
            language = language,
            salt = salt,
            passwordHash = LocalAuth.hash(password, salt),
            createdAt = store.now(),
            lastLoginAt = store.now(),
        )
        store.update { it.copy(accounts = it.accounts + account) }
        store.audit(account.id, "user", "account_created")
        store.notify(
            account.id,
            "account",
            "Welcome to RS AI TRADER",
            "This build runs on your device: market prices are simulated and paper trading starts with 10,000 USDT.",
        )
        val pair = tokenPair(account)
        tokenStore.save(pair)
        return ApiResult.Success(pair)
    }

    override suspend fun restore(): ApiResult<UserDto> {
        val cached = tokenStore.user() ?: return fail("Sign in to continue.", "http_401")
        val account = store.state().accounts.firstOrNull { it.id == cached.id }
            ?: run {
                tokenStore.clear()
                return fail("This account no longer exists on this device.", "http_401")
            }
        if (account.status != "active") {
            tokenStore.clear()
            return fail("This account is ${account.status}.", "http_403")
        }
        val dto = toDto(account)
        tokenStore.saveUser(dto)
        return ApiResult.Success(dto)
    }

    override suspend fun logout() {
        tokenStore.user()?.id?.let { store.audit(it, "user", "logout") }
        tokenStore.clear()
    }

    override suspend fun logoutEverywhere(): ApiResult<Unit> {
        tokenStore.user()?.id?.let { store.audit(it, "user", "logout_all") }
        tokenStore.clear()
        return ApiResult.Success(Unit)
    }

    override suspend fun sessions(): ApiResult<List<SessionDto>> {
        val account = tokenStore.user() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(
            listOf(
                SessionDto(
                    id = "device-${account.id}",
                    device = "This device",
                    ipAddress = "on-device",
                    userAgent = "RS AI TRADER Android",
                    createdAt = store.state().accounts.firstOrNull { it.id == account.id }?.createdAt ?: store.now(),
                    expiresAt = Instant.now().plusSeconds(86_400).toString(),
                    current = true,
                ),
            ),
        )
    }

    override suspend fun revokeSession(id: String): ApiResult<Unit> {
        tokenStore.user()?.id?.let { store.audit(it, "user", "session_revoked", mapOf("session" to id)) }
        tokenStore.clear()
        return ApiResult.Success(Unit)
    }

    override suspend fun deleteAccount(password: String, confirmation: String): ApiResult<Unit> {
        val me = tokenStore.user() ?: return fail("Sign in to continue.", "http_401")
        if (confirmation != "DELETE") return fail("Type DELETE to confirm.", "validation")
        val account = store.state().accounts.firstOrNull { it.id == me.id }
            ?: return fail("Account not found.", "not_found")
        if (!LocalAuth.verify(password, account.salt, account.passwordHash)) {
            return fail("Incorrect password.", "http_401")
        }
        store.update { state ->
            state.copy(
                accounts = state.accounts.filterNot { it.id == me.id },
                orders = state.orders.filterNot { it.userId == me.id },
                positions = state.positions.filterNot { it.userId == me.id },
                alerts = state.alerts.filterNot { it.userId == me.id },
                notifications = state.notifications.filterNot { it.userId == me.id },
                chat = state.chat.filterNot { it.userId == me.id },
                paper = state.paper - me.id,
                riskPolicies = state.riskPolicies - me.id,
            )
        }
        store.audit(null, "user", "account_deleted")
        tokenStore.clear()
        return ApiResult.Success(Unit)
    }

    override suspend fun changePassword(current: String, newPassword: String): ApiResult<Unit> {
        val me = tokenStore.user() ?: return fail("Sign in to continue.", "http_401")
        if (newPassword.length < 10) return fail("Use at least 10 characters.", "validation")
        val account = store.state().accounts.firstOrNull { it.id == me.id }
            ?: return fail("Account not found.", "not_found")
        if (!LocalAuth.verify(current, account.salt, account.passwordHash)) {
            return fail("Current password is incorrect.", "http_401")
        }
        val salt = LocalAuth.newSalt()
        val updated = account.copy(salt = salt, passwordHash = LocalAuth.hash(newPassword, salt))
        store.update { state ->
            state.copy(accounts = state.accounts.map { if (it.id == account.id) updated else it })
        }
        store.audit(account.id, account.role, "password_changed")
        tokenStore.clear()
        return ApiResult.Success(Unit)
    }

    override suspend fun requestPasswordReset(email: String): ApiResult<JsonElement> =
        fail(
            "Password reset needs an email server. This build keeps accounts on the device — " +
                "sign in with your password and change it under Settings → Security.",
            "offline_no_email",
        )

    override suspend fun confirmPasswordReset(token: String, newPassword: String): ApiResult<Unit> =
        fail("Password reset needs an email server, which this on-device build does not have.", "offline_no_email")

    override suspend fun updateProfile(displayName: String?, language: String?): ApiResult<UserDto> {
        val me = tokenStore.user() ?: return fail("Sign in to continue.", "http_401")
        val account = store.state().accounts.firstOrNull { it.id == me.id }
            ?: return fail("Account not found.", "not_found")
        val updated = account.copy(
            displayName = displayName?.takeIf { it.isNotBlank() } ?: account.displayName,
            language = language ?: account.language,
        )
        store.update { state ->
            state.copy(accounts = state.accounts.map { if (it.id == account.id) updated else it })
        }
        val dto = toDto(updated)
        tokenStore.saveUser(dto)
        return ApiResult.Success(dto)
    }
}

// ----------------------------------------------------------------- market
class OfflineMarketRepository(private val store: OfflineStore) : MarketApi {

    override suspend fun config(): ApiResult<AppConfigDto> = ApiResult.Success(
        AppConfigDto(
            appName = "RS AI TRADER",
            environment = "on-device",
            binanceEnvironment = "simulated",
            maintenanceMode = false,
            minAppVersion = "1.0.0",
            assistantEnabled = store.state().settings.assistantEnabled,
            supportedSymbols = store.state().settings.enabledSymbols,
            supportedTimeframes = SampleMarket.intervals.keys.toList(),
            paperTradingEnabled = store.state().settings.paperTradingEnabled,
            liveTradingEnabled = false,
            automationEnabled = false,
            requireManualApproval = true,
            marketData = MarketHealthDto(
                provider = SampleMarket.SOURCE,
                synthetic = true,
                degraded = false,
                marketStaleAfterSeconds = 180,
            ),
            staleAfterSeconds = 180,
            assistantLanguages = listOf("en", "si"),
            disclaimer = "Prices, candles and signals are generated on this device. Nothing here is real market data.",
            serverTime = store.now(),
        ),
    )

    override suspend fun overview(): ApiResult<OverviewDto> = ApiResult.Success(
        OverviewDto(
            tickers = SampleMarket.tickers(store.state().settings.enabledSymbols),
            connection = com.rsaitrader.core.network.ConnectionDto(
                status = "local",
                provider = SampleMarket.SOURCE,
                synthetic = true,
            ),
            freshness = com.rsaitrader.core.network.FreshnessDto(
                staleAfterSeconds = 180,
                oldestAgeSeconds = 0.0,
                anyStale = false,
            ),
            serverTime = store.now(),
        ),
    )

    override suspend fun tickers(symbols: List<String>): ApiResult<List<TickerDto>> =
        ApiResult.Success(SampleMarket.tickers(symbols))

    override suspend fun ticker(symbol: String): ApiResult<TickerDto> {
        if (!SampleMarket.isKnown(symbol)) return fail("$symbol is not part of the on-device symbol list.", "unknown_symbol")
        return ApiResult.Success(SampleMarket.ticker(symbol))
    }

    override suspend fun klines(symbol: String, interval: String, limit: Int): ApiResult<KlineResponse> {
        if (!SampleMarket.isKnown(symbol)) return fail("$symbol is not part of the on-device symbol list.", "unknown_symbol")
        val tf = if (SampleMarket.intervals.containsKey(interval)) interval else "1h"
        return ApiResult.Success(
            KlineResponse(
                symbol = symbol.uppercase(),
                interval = tf,
                klines = SampleMarket.klines(symbol, tf, limit),
                source = SampleMarket.SOURCE,
                synthetic = true,
                fetchedAt = store.now(),
                lastCandleClose = store.now(),
                ageSeconds = 0.0,
                stale = false,
            ),
        )
    }

    override suspend fun depth(symbol: String, limit: Int): ApiResult<DepthDto> =
        ApiResult.Success(SampleMarket.depth(symbol, limit))

    override suspend fun trades(symbol: String): ApiResult<List<TradeTickDto>> =
        ApiResult.Success(SampleMarket.trades(symbol))

    override suspend fun pairs(): ApiResult<PairsResponse> {
        val enabled = store.state().settings.enabledSymbols
        return ApiResult.Success(
            PairsResponse(
                symbols = SampleMarket.specs.map { spec ->
                    PairDto(
                        symbol = spec.symbol,
                        enabled = enabled.contains(spec.symbol),
                        baseAsset = spec.symbol.removeSuffix("USDT"),
                        quoteAsset = "USDT",
                        status = "TRADING",
                        minQty = "0.000001",
                        stepSize = "0.000001",
                        tickSize = "0.000001",
                        minNotional = OfflinePaperEngine.MIN_NOTIONAL.toString(),
                    )
                },
                timeframes = SampleMarket.intervals.keys.toList(),
                source = SampleMarket.SOURCE,
                synthetic = true,
            ),
        )
    }

    override suspend fun health(): ApiResult<MarketHealthDto> = ApiResult.Success(
        MarketHealthDto(
            provider = SampleMarket.SOURCE,
            synthetic = true,
            degraded = false,
            marketStaleAfterSeconds = 180,
        ),
    )
}

// ---------------------------------------------------------------- signals
class OfflineSignalRepository(private val store: OfflineStore) : SignalApi {

    private val history = ArrayList<JsonElement>()

    override suspend fun signal(symbol: String, timeframe: String): ApiResult<SignalDto> =
        ApiResult.Success(OfflineSignalEngine.generate(symbol, timeframe))

    override suspend fun latest(symbol: String, timeframe: String): ApiResult<SignalDto> =
        ApiResult.Success(OfflineSignalEngine.generate(symbol, timeframe))

    override suspend fun model(symbol: String, timeframe: String): ApiResult<ModelReportDto> =
        ApiResult.Success(
            ModelReportDto(
                available = false,
                note = "No trained model ships with the app. Signals come from deterministic indicator rules " +
                    "evaluated on synthetic candles, so no out-of-sample model performance can be reported.",
                modelVersion = OfflineSignalEngine.MODEL_VERSION,
                trainedAt = null,
                evaluation = null,
            ),
        )

    override suspend fun backtest(body: BacktestRequest): ApiResult<BacktestResultDto> = runCatching {
        OfflineSignalEngine.backtest(body)
    }.fold(
        onSuccess = { result ->
            history.add(
                buildJsonObject {
                    put("symbol", result.symbol)
                    put("timeframe", result.timeframe)
                    put("bars", result.bars)
                    put("total_return_pct", result.metrics.totalReturnPct)
                },
            )
            store.audit(null, "user", "backtest_run", mapOf("symbol" to body.symbol, "timeframe" to body.timeframe))
            ApiResult.Success(result)
        },
        onFailure = { ApiResult.Failure(message = it.message ?: "Backtest failed.", code = "backtest_failed") },
    )

    override suspend fun backtestHistory(): ApiResult<List<JsonElement>> = ApiResult.Success(history.toList())
}

// ---------------------------------------------------------------- trading
class OfflineTradingRepository(
    private val store: OfflineStore,
    private val engine: OfflinePaperEngine,
    private val userId: () -> String?,
) : TradingApi {

    override suspend fun preview(body: OrderRequest): ApiResult<OrderPreviewDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        if (body.mode == "live") {
            return fail(
                "Live trading needs the backend. This build runs entirely on the device, so only paper orders are possible.",
                "live_requires_server",
            )
        }
        return ApiResult.Success(engine.preview(id, body))
    }

    override suspend fun place(body: OrderCreateRequest): ApiResult<OrderDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return engine.place(id, body).fold(
            onSuccess = { ApiResult.Success(it) },
            onFailure = { ApiResult.Failure(message = it.message ?: "Order rejected.", code = "order_rejected", retryable = false) },
        )
    }

    override suspend fun orders(mode: String, openOnly: Boolean): ApiResult<List<OrderDto>> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        if (mode == "live") return fail("Live orders need the backend.", "live_requires_server")
        return ApiResult.Success(engine.orders(id, mode, openOnly))
    }

    override suspend fun cancel(id: String, mode: String): ApiResult<CancelResponse> {
        val user = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.cancel(user, id, mode))
    }

    override suspend fun reconcile(): ApiResult<JsonElement> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.reconcile(id))
    }
}

// -------------------------------------------------------------- portfolio
class OfflinePortfolioRepository(
    private val engine: OfflinePaperEngine,
    private val userId: () -> String?,
) : PortfolioApi {

    override suspend fun portfolio(mode: String): ApiResult<PortfolioDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.portfolio(id, mode))
    }

    override suspend fun analytics(mode: String, days: Int): ApiResult<AnalyticsDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.analytics(id, mode, days))
    }

    override suspend fun resetPaper(startingEquity: String): ApiResult<Unit> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        engine.reset(id, startingEquity)
        return ApiResult.Success(Unit)
    }
}

// ------------------------------------------------------------------- risk
class OfflineRiskRepository(
    private val store: OfflineStore,
    private val engine: OfflinePaperEngine,
    private val userId: () -> String?,
) : RiskApi {

    override suspend fun policy(): ApiResult<RiskPolicyDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.policy(id))
    }

    override suspend fun updatePolicy(body: RiskPolicyUpdate): ApiResult<RiskPolicyDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.updatePolicy(id, body))
    }

    override suspend fun status(): ApiResult<RiskStatusDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(engine.riskStatus(id))
    }

    override suspend fun optInLive(optIn: Boolean, confirmation: String, acknowledge: Boolean): ApiResult<JsonElement> =
        fail(
            "Live trading cannot be enabled without the backend: the signed exchange requests must come from a server " +
                "that holds the API keys. Configure a backend to opt in.",
            "live_requires_server",
        )

    override suspend fun emergencyStop(): ApiResult<JsonElement> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        engine.emergencyStop(id)
        return ApiResult.Success(
            buildJsonObject {
                put("kill_switch", true)
                put("scope", "this device")
                put("note", "New orders are blocked until the kill switch is released in Risk settings.")
            },
        )
    }
}

// ----------------------------------------------------------------- alerts
class OfflineAlertRepository(
    private val store: OfflineStore,
    private val userId: () -> String?,
) : AlertApi {

    private fun toDto(alert: LocalAlert) = AlertDto(
        id = alert.id,
        symbol = alert.symbol,
        condition = alert.condition,
        targetPrice = alert.targetPrice,
        status = alert.status,
        note = alert.note,
        triggeredAt = alert.triggeredAt,
        createdAt = alert.createdAt,
    )

    override suspend fun alerts(): ApiResult<List<AlertDto>> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(store.state().alerts.filter { it.userId == id }.map { toDto(it) })
    }

    override suspend fun create(
        symbol: String,
        condition: String,
        targetPrice: String?,
        note: String?,
    ): ApiResult<AlertDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        if (!SampleMarket.isKnown(symbol)) return fail("Unknown symbol $symbol.", "unknown_symbol")
        val needsPrice = condition.equals("above", true) || condition.equals("below", true)
        if (needsPrice && targetPrice?.toDoubleOrNull() == null) return fail("A target price is required for that condition.", "validation")
        val alert = LocalAlert(
            id = OfflineStore.newId(),
            userId = id,
            symbol = symbol.uppercase(),
            condition = condition.lowercase(),
            targetPrice = targetPrice,
            note = note,
            createdAt = store.now(),
        )
        store.update { it.copy(alerts = it.alerts + alert) }
        store.audit(id, "user", "alert_created", mapOf("symbol" to alert.symbol, "condition" to alert.condition))
        return ApiResult.Success(toDto(alert))
    }

    override suspend fun delete(id: String): ApiResult<Unit> {
        val user = userId() ?: return fail("Sign in to continue.", "http_401")
        store.update { state ->
            state.copy(alerts = state.alerts.filterNot { it.id == id && it.userId == user })
        }
        return ApiResult.Success(Unit)
    }

    override suspend fun evaluate(): ApiResult<Unit> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        val alerts = store.state().alerts.filter { it.userId == id && it.status == "active" }
        alerts.forEach { alert ->
            val price = SampleMarket.price(alert.symbol)
            val target = alert.targetPrice?.toDoubleOrNull()
            val rsi = Indicators.rsi(SampleMarket.klines(alert.symbol, "1h", 120).map { it.close }, 14)
            val triggered = when (alert.condition) {
                "above" -> target != null && price >= target
                "below" -> target != null && price <= target
                "rsi_overbought" -> rsi != null && rsi >= 70.0
                "rsi_oversold" -> rsi != null && rsi <= 30.0
                else -> false
            }
            if (triggered) {
                store.update { state ->
                    state.copy(alerts = state.alerts.map {
                        if (it.id == alert.id) it.copy(status = "triggered", triggeredAt = store.now()) else it
                    })
                }
                store.notify(id, "alert", "Alert triggered", "${alert.symbol} met the ${alert.condition} condition.", "warning")
            }
        }
        return ApiResult.Success(Unit)
    }
}

// -------------------------------------------------------------- assistant
class OfflineAssistantRepository(
    private val store: OfflineStore,
    private val engine: OfflinePaperEngine,
    private val userId: () -> String?,
) : AssistantApi {

    override suspend fun ask(
        question: String,
        lang: String?,
        symbol: String?,
        timeframe: String?,
    ): ApiResult<AssistantAnswerDto> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        val language = if (lang == "si") "si" else "en"
        val target = symbol?.uppercase()?.takeIf { SampleMarket.isKnown(it) }
            ?: SampleMarket.defaultSymbols.first()
        val lowercaseQuestion = question.lowercase()
        val portfolio = engine.portfolio(id, "paper")
        val signal = OfflineSignalEngine.generate(target, timeframe ?: "1h")
        val facts = buildJsonObject {
            put("symbol", target)
            put("action", signal.action)
            put("price", signal.price)
            put("equity", portfolio.totalValueUsdt)
            put("data_source", SampleMarket.SOURCE)
        }
        val answer = when {
            lowercaseQuestion.contains("rsi") -> rsiAnswer(signal, language)
            lowercaseQuestion.contains("portfolio") || lowercaseQuestion.contains("balance") ||
                lowercaseQuestion.contains("p&l") || lowercaseQuestion.contains("pnl") -> portfolioAnswer(portfolio, language)
            lowercaseQuestion.contains("risk") || lowercaseQuestion.contains("stop") -> riskAnswer(language)
            lowercaseQuestion.contains("order") -> orderAnswer(language)
            lowercaseQuestion.contains("signal") || lowercaseQuestion.contains("buy") ||
                lowercaseQuestion.contains("sell") || lowercaseQuestion.contains("trend") -> signalAnswer(signal, language)
            lowercaseQuestion.contains("app") || lowercaseQuestion.contains("how") -> appAnswer(language)
            else -> signalAnswer(signal, language)
        }
        val entry = LocalChatEntry(
            id = OfflineStore.newId(),
            userId = id,
            question = question,
            answer = answer,
            lang = language,
            intent = "on-device",
            createdAt = store.now(),
        )
        store.update { it.copy(chat = (it.chat + entry).takeLast(100)) }
        return ApiResult.Success(
            AssistantAnswerDto(
                id = entry.id,
                question = question,
                answer = answer,
                lang = language,
                intent = "on-device",
                facts = facts,
                limitations = listOf(
                    "Answers use simulated on-device data, not live Binance data.",
                    "The assistant cannot place, change or cancel orders.",
                    "It cannot bypass risk checks or the manual confirmation step.",
                ),
                dataAsOf = store.now(),
                refused = false,
                disclaimer = "Educational explanation only. Not financial advice.",
            ),
        )
    }

    override suspend fun history(limit: Int): ApiResult<List<AssistantHistoryDto>> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(
            store.state().chat.filter { it.userId == id }.takeLast(limit).map {
                AssistantHistoryDto(
                    id = it.id,
                    question = it.question,
                    answer = it.answer,
                    lang = it.lang,
                    intent = it.intent,
                    createdAt = it.createdAt,
                    dataAsOf = it.createdAt,
                )
            },
        )
    }

    private fun rsiAnswer(signal: SignalDto, lang: String): String {
        val rsi = signal.indicators["rsi_14"]?.toString()
        return if (lang == "si") {
            "RSI (14) දැන් $rsi. RSI 70ට වඩා ඉහළ නම් ඕවර්බෝට්, 30ට වඩා පහළ නම් ඕවර්සෝල්ඩ්. " +
                "RSI එකක් තනිව ගනුදෙනුවක් තීරණය කරන්න එපා — ${signal.symbol} ${signal.timeframe} මත දැන් තීරණය ${signal.action}. " +
                "මේ ගණනය සිමියුලේට් කළ දත්ත මතයි."
        } else {
            "RSI(14) on ${signal.symbol} ${signal.timeframe} is $rsi. Above 70 is usually read as overbought, below 30 as oversold. " +
                "RSI alone is not a signal — the current rule-based verdict is ${signal.action}. " +
                "Computed from simulated on-device candles."
        }
    }

    private fun signalAnswer(signal: SignalDto, lang: String): String {
        val reasons = signal.reasons.take(3).joinToString(" ")
        return if (lang == "si") {
            "${signal.symbol} (${signal.timeframe}) සඳහා දැනට තීරණය ${signal.action}. හේතු: $reasons " +
                "මිල ${signal.price}. මේ තීරණය සිමියුලේට් දත්ත මත ගණනය කළ රීති මත පදනම්ව, ගැරන්ටියක් නොවේ."
        } else {
            "For ${signal.symbol} (${signal.timeframe}) the engine says ${signal.action} at ${signal.price}. Reasons: $reasons " +
                "Evidence grade: ${signal.evidenceGrade}. This is a rule-based read of simulated candles, not a prediction or a guarantee."
        }
    }

    private fun portfolioAnswer(portfolio: PortfolioDto, lang: String): String = if (lang == "si") {
        "ඔබේ paper ගිණුමේ මුළු වටිනාකම ${portfolio.totalValueUsdt} USDT. ලාභය ${portfolio.realizedPnl} " +
            "(සිදු වූ) සහ ${portfolio.unrealizedPnl} (විවෘත). ගාස්තු ${portfolio.feesPaid}. මේ සියල්ල සිමියුලේට්."
    } else {
        "Your paper account is worth ${portfolio.totalValueUsdt} USDT, with ${portfolio.availableUsdt} USDT free. " +
            "Realised P&L ${portfolio.realizedPnl}, unrealised ${portfolio.unrealizedPnl}, fees ${portfolio.feesPaid}. " +
            "These are simulated balances, not exchange balances."
    }

    private fun riskAnswer(lang: String): String = if (lang == "si") {
        "අවදානම් සීමා තීරණය වන්නේ යෙදුම තුළමයි: උපරිම ගනුදෙනු වටිනාකම, දෛනික අලාභ සීමාව, විවෘත ඇණවුම්/ස්ථාන සීමාව, " +
            "අනිවාර්ය stop-loss. එක් පරීක්ෂාවක් අසාර්ථක වුණොත් ඇණවුම ප්‍රතික්ෂේප වේ. Stop-loss කියන්නේ සාමාන්‍ය ඇණවුමක් — ගැරන්ටි එකක් නොවේ."
    } else {
        "Risk limits are enforced by the trading engine: max notional per trade, daily loss limit, max open orders and " +
            "positions, and a required stop-loss on new buys. One failed check rejects the order. A stop-loss is an " +
            "ordinary order — in a fast market it can slip, so it is not guaranteed protection."
    }

    private fun orderAnswer(lang: String): String = if (lang == "si") {
        "ඇණවුමක් දැමීමට පෙර preview එකක් අවශ්‍යයි; එය සියලු පරීක්ෂා පෙන්වයි. ඉන්පසු ඔබ තහවුරු කළ පසු පමණක් " +
            "ඇණවුම යවනු ලැබේ. Live ඇණවුම් මේ build එකේ කළ නොහැක — server එකක් අවශ්‍යයි."
    } else {
        "Every order is previewed first, and nothing is sent until you confirm it. Paper orders fill instantly at the " +
            "simulated price plus fee and slippage. Live orders are impossible in this on-device build: signed exchange " +
            "requests require the backend."
    }

    private fun appAnswer(lang: String): String = if (lang == "si") {
        "ඔබ දැන් පාවිච්චි කරන්නේ යෙදුම තුළම ධාවනය වන engine එකක්: මිල, කැන්ඩල්, සංඥා, paper ගිණුම සහ admin panel " +
            "සියල්ල දුරකථනයේ. Binance API key එකක් අවශ්‍ය නැහැ. Live trading සඳහා backend එකක් සම්බන්ධ කරන්න."
    } else {
        "You are using the on-device engine: prices, candles, signals, the paper account and the admin panel all run " +
            "inside the app with no server and no Binance key. Switch to a backend under Settings → Data source to use " +
            "live/testnet exchange data."
    }
}

// ------------------------------------------------------------ credentials
class OfflineCredentialRepository : CredentialApi {

    override suspend fun list(): ApiResult<CredentialListDto> = ApiResult.Success(
        CredentialListDto(
            environment = "on-device",
            credentials = emptyList(),
            guidance = buildJsonObject {
                put(
                    "message",
                    "This build runs without a backend, so it deliberately refuses to store exchange API keys on the device.",
                )
                put("why", "A key stored in an APK's private storage can be extracted from a rooted or backed-up phone.")
                put("how_to_trade_live", "Deploy the backend from /backend, connect it to Binance with least-privilege keys, then point the app at it in Settings → Data source.")
                put("permissions", "Enable spot trading only. Never enable withdrawals; restrict the key to your server IP.")
            },
        ),
    )

    override suspend fun add(apiKey: String, apiSecret: String, label: String): ApiResult<CredentialDto> =
        fail(
            "On-device mode does not accept API keys. Keys belong in the backend's encrypted store — " +
                "connect a server under Settings → Data source first.",
            "live_requires_server",
        )

    override suspend fun verify(id: String): ApiResult<JsonElement> = fail("No keys are stored on this device.", "not_found")

    override suspend fun revoke(id: String): ApiResult<Unit> = fail("No keys are stored on this device.", "not_found")
}

// ---------------------------------------------------------- notifications
class OfflineNotificationRepository(
    private val store: OfflineStore,
    private val userId: () -> String?,
) : NotificationApi {

    override suspend fun list(): ApiResult<List<NotificationDto>> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        return ApiResult.Success(
            store.state().notifications.filter { it.userId == id }
                .sortedByDescending { it.createdAt }
                .map {
                    NotificationDto(
                        id = it.id,
                        kind = it.kind,
                        title = it.title,
                        body = it.body,
                        severity = it.severity,
                        read = it.read,
                        createdAt = it.createdAt,
                    )
                },
        )
    }

    override suspend fun markRead(): ApiResult<Unit> {
        val id = userId() ?: return fail("Sign in to continue.", "http_401")
        store.update { state ->
            state.copy(notifications = state.notifications.map { if (it.userId == id) it.copy(read = true) else it })
        }
        return ApiResult.Success(Unit)
    }
}

// ------------------------------------------------------------------ admin
class OfflineAdminRepository(
    private val store: OfflineStore,
    private val engine: OfflinePaperEngine,
    private val userId: () -> String?,
) : AdminApi {

    override suspend fun users(search: String?): ApiResult<AdminUsersResponse> {
        val accounts = store.state().accounts
        val filtered = accounts.filter {
            search.isNullOrBlank() ||
                it.email.contains(search, true) ||
                it.displayName.contains(search, true)
        }
        val orders = store.state().orders
        return ApiResult.Success(
            AdminUsersResponse(
                total = filtered.size,
                users = filtered.map { account ->
                    AdminUserDto(
                        id = account.id,
                        email = account.email,
                        displayName = account.displayName,
                        role = account.role,
                        status = account.status,
                        createdAt = account.createdAt,
                        lastLoginAt = account.lastLoginAt,
                        hasExchangeKey = false,
                    )
                },
                note = "Accounts stored on this device. The unlock code gates this panel; it is not a server role.",
            ),
        )
    }

    override suspend fun health(): ApiResult<AdminHealthDto> {
        val state = store.state()
        return ApiResult.Success(
            AdminHealthDto(
                database = "on-device file store",
                market = MarketHealthDto(provider = SampleMarket.SOURCE, synthetic = true, marketStaleAfterSeconds = 180),
                config = buildJsonObject {
                    put("mode", "on-device")
                    put("pairs", state.settings.enabledSymbols.size)
                    put("paper_trading", state.settings.paperTradingEnabled)
                    put("assistant", state.settings.assistantEnabled)
                },
                tradingControl = TradingControlDto(
                    killSwitch = state.killSwitch.engaged,
                    reason = state.killSwitch.reason,
                    activatedAt = state.killSwitch.activatedAt,
                ),
                counts = AdminCountsDto(
                    users = state.accounts.size,
                    activeUsers = state.accounts.count { it.status == "active" },
                    paperOrders = state.orders.count { it.mode == "paper" },
                    liveOrders = 0,
                    signals = 0,
                    auditEvents = state.audit.size,
                ),
                time = store.now(),
            ),
        )
    }

    override suspend fun audit(): ApiResult<List<AuditEventDto>> = ApiResult.Success(
        store.state().audit.asReversed().map { event ->
            AuditEventDto(
                id = event.id,
                user_id = event.userId,
                actor_role = event.actorRole,
                action = event.action,
                outcome = event.outcome,
                detail = buildJsonObject { event.detail.forEach { (key, value) -> put(key, value) } },
                createdAt = event.createdAt,
            )
        },
    )

    override suspend fun settings(): ApiResult<AdminSettingsResponse> {
        val state = store.state()
        return ApiResult.Success(
            AdminSettingsResponse(
                settings = listOf(
                    AdminSettingDto(
                        key = "paper_trading_enabled",
                        value = kotlinx.serialization.json.JsonPrimitive(state.settings.paperTradingEnabled),
                        description = "Allow new paper orders",
                        updatedAt = store.now(),
                    ),
                    AdminSettingDto(
                        key = "assistant_enabled",
                        value = kotlinx.serialization.json.JsonPrimitive(state.settings.assistantEnabled),
                        description = "Show the assistant entry point",
                        updatedAt = store.now(),
                    ),
                    AdminSettingDto(
                        key = "live_trading_enabled",
                        value = kotlinx.serialization.json.JsonPrimitive(false),
                        description = "Locked to false on-device: live trading needs the backend",
                        updatedAt = store.now(),
                    ),
                ),
            ),
        )
    }

    override suspend fun updateSetting(key: String, value: JsonElement): ApiResult<JsonElement> {
        val enabled = value.toString().trim('"').toBooleanStrictOrNull()
        store.update { state ->
            when (key) {
                "paper_trading_enabled" -> state.copy(
                    settings = state.settings.copy(paperTradingEnabled = enabled ?: state.settings.paperTradingEnabled),
                )
                "assistant_enabled" -> state.copy(
                    settings = state.settings.copy(assistantEnabled = enabled ?: state.settings.assistantEnabled),
                )
                else -> state
            }
        }
        store.audit(userId(), "admin", "setting_updated", mapOf("key" to key, "value" to value.toString()))
        return if (key == "live_trading_enabled") {
            fail("Live trading cannot be enabled on the device.", "live_requires_server")
        } else {
            ApiResult.Success(
                buildJsonObject {
                    put("key", key)
                    put("value", value.toString())
                },
            )
        }
    }

    override suspend fun pairs(): ApiResult<List<PairDto>> {
        val enabled = store.state().settings.enabledSymbols
        return ApiResult.Success(
            SampleMarket.specs.map { spec ->
                PairDto(
                    symbol = spec.symbol,
                    enabled = enabled.contains(spec.symbol),
                    baseAsset = spec.symbol.removeSuffix("USDT"),
                    quoteAsset = "USDT",
                    status = "TRADING",
                )
            },
        )
    }

    override suspend fun syncPairs(): ApiResult<JsonElement> = ApiResult.Success(
        buildJsonObject {
            put("synced", SampleMarket.specs.size)
            put("note", "Symbol filters are built into the app; there is no exchange to sync from in on-device mode.")
        },
    )

    override suspend fun togglePair(symbol: String, enabled: Boolean): ApiResult<JsonElement> {
        store.update { state ->
            val current = state.settings.enabledSymbols
            val next = if (enabled) (current + symbol.uppercase()).distinct() else current - symbol.uppercase()
            state.copy(settings = state.settings.copy(enabledSymbols = next))
        }
        store.audit(userId(), "admin", "pair_toggled", mapOf("symbol" to symbol, "enabled" to enabled.toString()))
        return ApiResult.Success(
            buildJsonObject {
                put("symbol", symbol.uppercase())
                put("enabled", enabled)
            },
        )
    }

    override suspend fun killSwitch(engage: Boolean, reason: String): ApiResult<JsonElement> {
        engine.setKillSwitch(engage, reason)
        store.audit(userId(), "admin", if (engage) "kill_switch_engaged" else "kill_switch_released", mapOf("reason" to reason))
        return ApiResult.Success(
            buildJsonObject {
                put("kill_switch", engage)
                put("reason", reason)
            },
        )
    }

    override suspend fun updateUser(id: String, status: String?, role: String?): ApiResult<UserDto> {
        val account = store.state().accounts.firstOrNull { it.id == id }
            ?: return fail("User not found.", "not_found")
        val updated = account.copy(status = status ?: account.status, role = role ?: account.role)
        store.update { state ->
            state.copy(accounts = state.accounts.map { if (it.id == id) updated else it })
        }
        store.audit(userId(), "admin", "user_updated", mapOf("user" to id, "role" to updated.role, "status" to updated.status))
        return ApiResult.Success(
            UserDto(
                id = updated.id,
                email = updated.email,
                displayName = updated.displayName,
                role = updated.role,
                status = updated.status,
                language = updated.language,
                createdAt = updated.createdAt,
                lastLoginAt = updated.lastLoginAt,
            ),
        )
    }
}
