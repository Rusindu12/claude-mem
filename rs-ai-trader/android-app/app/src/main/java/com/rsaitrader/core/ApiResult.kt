package com.rsaitrader.core

import kotlinx.serialization.json.JsonObject

/** Result type used by every repository call so the UI can render honest errors. */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>

    data class Failure(
        val message: String,
        val code: String = "unknown",
        val details: JsonObject = JsonObject(emptyMap()),
        val retryable: Boolean = true,
    ) : ApiResult<Nothing>

    val isSuccess: Boolean get() = this is Success

    fun dataOrNull(): T? = (this as? Success)?.data
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Success -> ApiResult.Success(transform(data))
    is ApiResult.Failure -> this
}

fun <T> ApiResult<T>.errorMessageOrNull(): String? = (this as? ApiResult.Failure)?.message

/** Human-readable, non-technical message for network failures. */
fun networkMessage(cause: Throwable): String = when (cause) {
    is java.net.UnknownHostException -> "No internet connection. Check your network and try again."
    is java.net.SocketTimeoutException -> "The server took too long to respond. Try again."
    is java.net.ConnectException -> "Cannot reach the RS AI TRADER server. Is the backend running?"
    is javax.net.ssl.SSLException -> "Secure connection failed. Check the server certificate."
    else -> cause.message ?: "Unexpected network error."
}
