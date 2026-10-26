package com.rsaitrader.ui.state

import com.rsaitrader.core.ApiResult

/**
 * Generic async UI state. Every screen can therefore render four honest states:
 * loading, error (with a retry), empty and content.
 */
data class Loadable<T>(
    val data: T? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val errorCode: String? = null,
    val lastUpdated: Long? = null,
) {
    val isEmpty: Boolean get() = data == null && error == null && !loading

    fun loading(): Loadable<T> = copy(loading = true, error = null, errorCode = null)

    fun success(value: T): Loadable<T> = Loadable(
        data = value,
        loading = false,
        error = null,
        errorCode = null,
        lastUpdated = System.currentTimeMillis(),
    )

    fun failure(message: String, code: String?): Loadable<T> =
        copy(loading = false, error = message, errorCode = code)

    fun clearError(): Loadable<T> = copy(error = null, errorCode = null)

    companion object {
        fun <T> idle(): Loadable<T> = Loadable()
    }
}

fun <T> ApiResult<T>.toLoadable(previous: Loadable<T> = Loadable.idle()): Loadable<T> = when (this) {
    is ApiResult.Success -> previous.success(data)
    is ApiResult.Failure -> previous.failure(message, code)
}
