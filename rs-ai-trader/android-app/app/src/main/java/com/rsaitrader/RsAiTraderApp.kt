package com.rsaitrader

import android.app.Application
import com.rsaitrader.di.ServiceLocator

/**
 * Application entry point.
 *
 * Initialises the dependency container once per process. No secrets are read
 * here: the backend URL comes from BuildConfig and Binance keys live only on
 * the server.
 */
class RsAiTraderApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
