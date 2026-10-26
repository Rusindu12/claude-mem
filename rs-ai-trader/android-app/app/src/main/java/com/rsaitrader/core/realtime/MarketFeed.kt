package com.rsaitrader.core.realtime

import com.rsaitrader.core.network.TickerDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

data class StreamStatus(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val degraded: Boolean = false,
    val message: String? = null,
    val lastFrameAt: Instant? = null,
    val source: String? = null,
    val synthetic: Boolean = false,
) {
    fun ageSeconds(): Double? = lastFrameAt?.let {
        java.time.Duration.between(it, Instant.now()).toMillis() / 1000.0
    }

    val stale: Boolean
        get() = connected && (ageSeconds() ?: 0.0) > 15.0
}

/**
 * One shared websocket subscription for the whole app.
 *
 * Screens call [watch] with the symbols they care about; the latest call wins so
 * we never hold more than one socket open. Tickers are exposed as a map so a
 * price update repaints every visible row without extra network calls.
 */
class MarketFeed(
    private val stream: PriceStream,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _status = MutableStateFlow(StreamStatus())
    val status: StateFlow<StreamStatus> = _status.asStateFlow()

    private val _tickers = MutableStateFlow<Map<String, TickerDto>>(emptyMap())
    val tickers: StateFlow<Map<String, TickerDto>> = _tickers.asStateFlow()

    private var job: Job? = null
    private var currentSymbols: List<String> = emptyList()

    fun watch(symbols: List<String>) {
        val cleaned = symbols.map { it.uppercase() }.distinct().take(8)
        if (cleaned.isEmpty()) return
        if (cleaned == currentSymbols && job?.isActive == true) return
        currentSymbols = cleaned
        restart()
    }

    fun restart() {
        job?.cancel()
        if (currentSymbols.isEmpty()) return
        _status.update { it.copy(connecting = true, message = null) }
        job = scope.launch {
            stream.stream(currentSymbols).collect { event ->
                when (event) {
                    is StreamEvent.Connecting -> _status.update {
                        it.copy(connecting = true, connected = false)
                    }
                    is StreamEvent.Connected -> _status.update {
                        it.copy(connecting = false, connected = true, message = null)
                    }
                    is StreamEvent.Tickers -> {
                        _tickers.update { existing ->
                            existing + event.tickers.associateBy { it.symbol }
                        }
                        _status.update {
                            it.copy(
                                connected = true,
                                connecting = false,
                                degraded = event.degraded,
                                source = event.source,
                                synthetic = event.synthetic,
                                lastFrameAt = Instant.now(),
                                message = if (event.degraded) "Exchange degraded — using cached data." else null,
                            )
                        }
                    }
                    is StreamEvent.ServerError -> _status.update {
                        it.copy(message = event.message, connecting = false)
                    }
                    is StreamEvent.Reconnecting -> _status.update {
                        it.copy(
                            connected = false,
                            connecting = true,
                            message = "Reconnecting in ${event.inMillis / 1000}s (attempt ${event.attempt})…",
                        )
                    }
                    StreamEvent.Unauthorized -> {
                        _status.update {
                            StreamStatus(message = "Session expired — sign in again.", connected = false)
                        }
                        job?.cancel()
                    }
                }
            }
        }
    }

    /** Close the socket but remember the subscription so [resume] can restore it. */
    fun pause() {
        job?.cancel()
        job = null
        _status.update { it.copy(connected = false, connecting = false, message = "Paused") }
    }

    /** Reopen the socket after the app returns to the foreground. */
    fun resume() {
        if (currentSymbols.isNotEmpty() && job?.isActive != true) restart()
    }

    fun stop() {
        job?.cancel()
        job = null
        currentSymbols = emptyList()
        _status.value = StreamStatus()
    }

    fun clearTickers() = _tickers.update { emptyMap() }
}
