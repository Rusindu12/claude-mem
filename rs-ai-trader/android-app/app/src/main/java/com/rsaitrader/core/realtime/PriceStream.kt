package com.rsaitrader.core.realtime

import com.rsaitrader.core.network.TickerDto
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/** Anything that can push ticker frames: the backend socket, or the on-device simulator. */
interface PriceSource {
    fun stream(symbols: List<String>): Flow<StreamEvent>
}

sealed interface StreamEvent {
    data object Connecting : StreamEvent
    data class Connected(val symbols: List<String>, val serverTime: String?) : StreamEvent
    data class Tickers(
        val tickers: List<TickerDto>,
        val source: String,
        val synthetic: Boolean,
        val degraded: Boolean,
        val staleAfterSeconds: Int,
        val serverTime: String?,
    ) : StreamEvent

    data class ServerError(val message: String) : StreamEvent
    data object Unauthorized : StreamEvent
    data class Reconnecting(val inMillis: Long, val attempt: Int) : StreamEvent
}

/**
 * Realtime price feed from the RS AI TRADER backend (`/api/v1/stream/prices`).
 *
 * Design notes:
 *  * the access token is sent as a query parameter because browser/WS clients
 *    cannot easily set headers before the handshake;
 *  * the socket only carries market snapshots — orders are always placed over
 *    REST so a dropped socket can never duplicate a trade;
 *  * reconnects use exponential backoff (1s → 30s) and stop retrying if the
 *    server closes with 4401 (revoked/expired session).
 */
class PriceStream(
    private val baseUrl: String,
    private val tokenProvider: () -> String?,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // no inactivity timeout on a live socket
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
) : PriceSource {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    override fun stream(symbols: List<String>): Flow<StreamEvent> = flow {
        if (symbols.isEmpty()) {
            emit(StreamEvent.ServerError("Select at least one market."))
            return@flow
        }
        var attempt = 0
        var unauthorized = false
        while (true) {
            var sawFrame = false
            emit(StreamEvent.Connecting)
            singleConnection(symbols).collect { event ->
                when (event) {
                    is StreamEvent.Tickers, is StreamEvent.Connected -> sawFrame = true
                    StreamEvent.Unauthorized -> unauthorized = true
                    else -> Unit
                }
                emit(event)
            }
            if (unauthorized) {
                emit(StreamEvent.Unauthorized)
                return@flow
            }
            attempt = if (sawFrame) 1 else attempt + 1
            if (attempt > 8) {
                emit(StreamEvent.ServerError("Live prices unavailable. Tap refresh to retry."))
                return@flow
            }
            val backoff = minOf(30_000L, 1_000L * (1L shl (attempt - 1).coerceAtLeast(0)))
            emit(StreamEvent.Reconnecting(backoff, attempt))
            delay(backoff)
        }
    }

    private fun singleConnection(symbols: List<String>): Flow<StreamEvent> = channelFlow {
        val token = tokenProvider()
        if (token.isNullOrBlank()) {
            trySend(StreamEvent.Unauthorized)
            close()
            return@channelFlow
        }
        val query = symbols.take(8).joinToString(",") { it.uppercase() }
        val url = "${baseUrl.trimEnd('/')}/api/v1/stream/prices?symbols=$query&token=$token"
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                trySend(StreamEvent.Connected(symbols, null))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                parse(text)?.let { trySend(it) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val code = response?.code
                when {
                    response?.code == 401 || response?.code == 403 ->
                        trySend(StreamEvent.Unauthorized)
                    else -> trySend(StreamEvent.ServerError(t.message ?: "price stream closed"))
                }
                close()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                if (code == 4401) trySend(StreamEvent.Unauthorized) else close()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                close()
            }
        }
        val socket = http.newWebSocket(Request.Builder().url(url).build(), listener)
        awaitClose { socket.close(1000, "client closing") }
    }

    internal fun parse(text: String): StreamEvent? {
        val obj: JsonObject = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val status = obj["status"]?.jsonPrimitive?.contentOrNull ?: return null
        val serverTime = obj["server_time"]?.jsonPrimitive?.contentOrNull
        return when (status) {
            "connected" -> StreamEvent.Connected(
                symbols = obj["symbols"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
                serverTime = serverTime,
            )
            "streaming", "degraded" -> {
                val tickers = obj["tickers"]?.jsonArray?.mapNotNull { element ->
                    runCatching { json.decodeFromJsonElement(TickerDto.serializer(), element) }.getOrNull()
                } ?: emptyList()
                StreamEvent.Tickers(
                    tickers = tickers,
                    source = obj["source"]?.jsonPrimitive?.contentOrNull ?: "unknown",
                    synthetic = obj["synthetic"]?.jsonPrimitive?.contentOrNull?.toBoolean() ?: false,
                    degraded = status == "degraded",
                    staleAfterSeconds = obj["stale_after_seconds"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 180,
                    serverTime = serverTime,
                )
            }
            "unauthenticated" -> StreamEvent.Unauthorized
            "error" -> StreamEvent.ServerError(
                obj["message"]?.jsonPrimitive?.contentOrNull ?: "Market data is temporarily unavailable.",
            )
            else -> null
        }
    }
}
