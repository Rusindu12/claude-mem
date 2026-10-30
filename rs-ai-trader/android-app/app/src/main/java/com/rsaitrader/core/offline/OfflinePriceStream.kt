package com.rsaitrader.core.offline

import com.rsaitrader.core.realtime.PriceSource
import com.rsaitrader.core.realtime.StreamEvent
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.isActive
import java.time.Instant

/**
 * Realtime ticker flow with no socket.
 *
 * Mirrors what the backend would push so every screen behaves the same, but the
 * prices come from [SampleMarket]. Every frame is tagged `synthetic = true` and
 * `source = simulator`, which the connection pill and banners surface to the
 * user.
 */
class OfflinePriceStream(private val intervalMillis: Long = 2_500L) : PriceSource {

    override fun stream(symbols: List<String>): Flow<StreamEvent> = flow {
        if (symbols.isEmpty()) {
            emit(StreamEvent.ServerError("Select at least one market."))
            return@flow
        }
        emit(StreamEvent.Connected(symbols = symbols.map { it.uppercase() }, serverTime = Instant.now().toString()))
        while (currentCoroutineContext().isActive) {
            emit(
                StreamEvent.Tickers(
                    tickers = SampleMarket.tickers(symbols),
                    source = SampleMarket.SOURCE,
                    synthetic = true,
                    degraded = false,
                    staleAfterSeconds = 180,
                    serverTime = Instant.now().toString(),
                ),
            )
            delay(intervalMillis)
        }
    }
}
