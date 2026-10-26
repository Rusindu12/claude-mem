package com.rsaitrader.di

import android.content.Context
import com.rsaitrader.core.network.ApiClient
import com.rsaitrader.core.realtime.MarketFeed
import com.rsaitrader.core.realtime.PriceStream
import com.rsaitrader.data.AdminRepository
import com.rsaitrader.data.AlertRepository
import com.rsaitrader.data.AssistantRepository
import com.rsaitrader.data.CredentialRepository
import com.rsaitrader.data.FavoritesStore
import com.rsaitrader.data.MarketRepository
import com.rsaitrader.data.NotificationRepository
import com.rsaitrader.data.PortfolioRepository
import com.rsaitrader.data.RiskRepository
import com.rsaitrader.data.SessionRepository
import com.rsaitrader.data.SignalRepository
import com.rsaitrader.data.TradingRepository

/**
 * Minimal manual dependency container.
 *
 * Deliberately not Hilt: the graph is tiny, and a hand-written locator keeps the
 * build reproducible without annotation processing. Everything is created once
 * per process so the in-memory token refresh and OkHttp pools are shared.
 */
object ServiceLocator {

    private lateinit var apiClient: ApiClient

    lateinit var session: SessionRepository
        private set
    lateinit var market: MarketRepository
        private set
    lateinit var signals: SignalRepository
        private set
    lateinit var trading: TradingRepository
        private set
    lateinit var portfolio: PortfolioRepository
        private set
    lateinit var risk: RiskRepository
        private set
    lateinit var alerts: AlertRepository
        private set
    lateinit var assistant: AssistantRepository
        private set
    lateinit var credentials: CredentialRepository
        private set
    lateinit var notifications: NotificationRepository
        private set
    lateinit var admin: AdminRepository
        private set

    lateinit var feed: MarketFeed
        private set

    lateinit var favorites: FavoritesStore
        private set

    val tokenStore get() = apiClient.tokenStore

    fun init(context: Context) {
        if (this::session.isInitialized) return
        apiClient = ApiClient(context.applicationContext)
        val api = apiClient.api
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
        feed = MarketFeed(PriceStream(apiClient.websocketBaseUrl) { apiClient.tokenStore.accessToken() })
        favorites = FavoritesStore(context.applicationContext)
    }

    val websocketBaseUrl: String
        get() = apiClient.websocketBaseUrl
}
