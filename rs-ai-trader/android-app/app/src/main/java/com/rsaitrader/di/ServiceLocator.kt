package com.rsaitrader.di

import android.content.Context
import com.rsaitrader.BuildConfig
import com.rsaitrader.core.network.ApiClient
import com.rsaitrader.core.offline.OfflineAdminRepository
import com.rsaitrader.core.offline.OfflineAlertRepository
import com.rsaitrader.core.offline.OfflineAssistantRepository
import com.rsaitrader.core.offline.OfflineCredentialRepository
import com.rsaitrader.core.offline.OfflineMarketRepository
import com.rsaitrader.core.offline.OfflineNotificationRepository
import com.rsaitrader.core.offline.OfflinePaperEngine
import com.rsaitrader.core.offline.OfflinePortfolioRepository
import com.rsaitrader.core.offline.OfflinePriceStream
import com.rsaitrader.core.offline.OfflineRiskRepository
import com.rsaitrader.core.offline.OfflineSessionRepository
import com.rsaitrader.core.offline.OfflineSignalRepository
import com.rsaitrader.core.offline.OfflineStore
import com.rsaitrader.core.offline.OfflineTradingRepository
import com.rsaitrader.core.realtime.MarketFeed
import com.rsaitrader.core.realtime.PriceSource
import com.rsaitrader.core.realtime.PriceStream
import com.rsaitrader.data.AdminApi
import com.rsaitrader.data.AdminRepository
import com.rsaitrader.data.AdminUnlock
import com.rsaitrader.data.AlertApi
import com.rsaitrader.data.AlertRepository
import com.rsaitrader.data.AssistantApi
import com.rsaitrader.data.AssistantRepository
import com.rsaitrader.data.CredentialApi
import com.rsaitrader.data.CredentialRepository
import com.rsaitrader.data.FavoritesStore
import com.rsaitrader.data.MarketApi
import com.rsaitrader.data.MarketRepository
import com.rsaitrader.data.NotificationApi
import com.rsaitrader.data.NotificationRepository
import com.rsaitrader.data.PortfolioApi
import com.rsaitrader.data.PortfolioRepository
import com.rsaitrader.data.RiskApi
import com.rsaitrader.data.RiskRepository
import com.rsaitrader.data.ServerConfig
import com.rsaitrader.data.SessionApi
import com.rsaitrader.data.SessionRepository
import com.rsaitrader.data.SignalApi
import com.rsaitrader.data.SignalRepository
import com.rsaitrader.data.TradingApi
import com.rsaitrader.data.TradingRepository

/**
 * Minimal manual dependency container.
 *
 * Deliberately not Hilt: the graph is small, and a hand-written locator keeps the
 * build reproducible without annotation processing.
 *
 * Two interchangeable engines back the same interfaces:
 *  * **DEVICE** — everything runs inside the APK (accounts, synthetic market,
 *    signals, paper trading, risk, admin). No server, no network, no Binance
 *    keys, live trading impossible by construction.
 *  * **SERVER** — the REST backend, which holds the exchange keys and is the
 *    only component allowed to sign real orders.
 *
 * The mode lives in [FavoritesStore] so it survives restarts, and switching it
 * drops the stored session because tokens are scoped to one engine.
 */
object ServiceLocator {

    const val MODE_DEVICE = "device"
    const val MODE_SERVER = "server"

    private lateinit var apiClient: ApiClient

    lateinit var session: SessionApi
        private set
    lateinit var market: MarketApi
        private set
    lateinit var signals: SignalApi
        private set
    lateinit var trading: TradingApi
        private set
    lateinit var portfolio: PortfolioApi
        private set
    lateinit var risk: RiskApi
        private set
    lateinit var alerts: AlertApi
        private set
    lateinit var assistant: AssistantApi
        private set
    lateinit var credentials: CredentialApi
        private set
    lateinit var notifications: NotificationApi
        private set
    lateinit var admin: AdminApi
        private set

    lateinit var feed: MarketFeed
        private set

    lateinit var favorites: FavoritesStore
        private set

    lateinit var server: ServerConfig
        private set

    lateinit var adminUnlock: AdminUnlock
        private set

    lateinit var offlineStore: OfflineStore
        private set

    lateinit var paperEngine: OfflinePaperEngine
        private set

    /** [MODE_DEVICE] or [MODE_SERVER]. */
    var dataSource: String = MODE_DEVICE
        private set

    val isDeviceMode: Boolean get() = dataSource == MODE_DEVICE

    val buildTimeBaseUrl: String get() = BuildConfig.API_BASE_URL

    val tokenStore get() = apiClient.tokenStore

    fun init(context: Context) {
        if (this::session.isInitialized) return
        val app = context.applicationContext
        favorites = FavoritesStore(app)
        server = ServerConfig(app)
        adminUnlock = AdminUnlock(app)
        offlineStore = OfflineStore(app)
        paperEngine = OfflinePaperEngine(offlineStore)
        dataSource = favorites.dataSource()
        build(app)
    }

    private fun build(context: Context) {
        apiClient = ApiClient(context, server.baseUrl())
        val api = apiClient.api
        val tokenStore = apiClient.tokenStore
        if (dataSource == MODE_DEVICE) {
            val store = offlineStore
            val engine = paperEngine
            val currentUserId: () -> String? = { tokenStore.user()?.id }
            session = OfflineSessionRepository(store, tokenStore)
            market = OfflineMarketRepository(store)
            signals = OfflineSignalRepository(store)
            trading = OfflineTradingRepository(store, engine, currentUserId)
            portfolio = OfflinePortfolioRepository(engine, currentUserId)
            risk = OfflineRiskRepository(store, engine, currentUserId)
            alerts = OfflineAlertRepository(store, currentUserId)
            assistant = OfflineAssistantRepository(store, engine, currentUserId)
            credentials = OfflineCredentialRepository()
            notifications = OfflineNotificationRepository(store, currentUserId)
            admin = OfflineAdminRepository(store, engine, currentUserId)
            val source: PriceSource = OfflinePriceStream()
            feed = MarketFeed(source)
        } else {
            session = SessionRepository(api, apiClient)
            market = MarketRepository(api)
            signals = SignalRepository(api)
            trading = TradingRepository(api)
            portfolio = PortfolioRepository(api)
            risk = RiskRepository(api)
            alerts = AlertRepository(api)
            assistant = AssistantRepository(api)
            credentials = CredentialRepository(api)
            notifications = NotificationRepository(api)
            admin = AdminRepository(api)
            val source: PriceSource = PriceStream(
                baseUrl = apiClient.websocketBaseUrl,
                tokenProvider = { apiClient.tokenStore.accessToken() },
            )
            feed = MarketFeed(source)
        }
    }

    /**
     * Rebuild the graph against the configured URL (server mode only).
     * Stored tokens belong to the previous endpoint, so they are dropped.
     */
    fun reconfigure(context: Context) {
        if (this::feed.isInitialized) feed.stop()
        if (this::apiClient.isInitialized) runCatching { apiClient.tokenStore.clear() }
        adminUnlock.lock()
        build(context.applicationContext)
    }

    /**
     * Switch engines. Device mode needs no server at all; server mode uses the
     * URL from [ServerConfig].
     */
    fun switchDataSource(context: Context, source: String) {
        if (source != MODE_DEVICE && source != MODE_SERVER) return
        favorites.setDataSource(source)
        dataSource = source
        reconfigure(context)
    }

    val websocketBaseUrl: String
        get() = apiClient.websocketBaseUrl
}
