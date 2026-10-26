package com.rsaitrader.core.network

import android.content.Context
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.rsaitrader.BuildConfig
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.networkMessage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response as HttpCallResponse
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(
    val statusCode: Int,
    message: String?,
    val code: String = "http_$statusCode",
    val details: JsonObject = JsonObject(emptyMap()),
    val retryable: Boolean = statusCode >= 500 || statusCode == 429,
) : Exception(message)

/**
 * Builds the retrofit stack.
 *
 * Security notes:
 *  * only the backend base URL is compiled in — no exchange secrets;
 *  * logging is BASIC in debug (method/path/status only) and NONE in release,
 *    so tokens and request bodies never reach logcat;
 *  * a 401 triggers exactly one silent refresh, then the request is retried.
 */
class ApiClient(context: Context, baseUrl: String = BuildConfig.API_BASE_URL) {

    val tokenStore = TokenStore(context)

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = true
        coerceInputValues = true
    }

    private val logging = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        redactHeader("Authorization")
    }

    private val refreshClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val refreshRetrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(refreshClient)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    private val refreshApi: ApiService = refreshRetrofit.create(ApiService::class.java)

    private val authInterceptor = Interceptor { chain ->
        val original = chain.request()
        val access = tokenStore.accessToken()
        val request = if (access.isNullOrBlank()) {
            original
        } else {
            original.newBuilder().header("Authorization", "Bearer $access").build()
        }
        val response = chain.proceed(request)
        if (response.code != 401 || access.isNullOrBlank() || original.url.encodedPath.contains("/auth/refresh")) {
            return@Interceptor response
        }
        response.close()
        val refreshed = synchronized(this) { refreshSession() }
        if (!refreshed) return@Interceptor chain.proceed(request)
        val newAccess = tokenStore.accessToken() ?: return@Interceptor chain.proceed(request)
        chain.proceed(request.newBuilder().header("Authorization", "Bearer $newAccess").build())
    }

    private fun refreshSession(): Boolean {
        val refreshToken = tokenStore.refreshToken() ?: return false
        return runCatching {
            runBlocking {
                val response = refreshApi.refresh(RefreshRequest(refreshToken))
                val body = response.body()
                if (response.isSuccessful && body != null) {
                    tokenStore.updateAccess(body.accessToken, body.refreshToken)
                    tokenStore.saveUser(body.user)
                    true
                } else {
                    if (response.code() == 401) tokenStore.clear() // session revoked
                    false
                }
            }
        }.getOrDefault(false)
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .addInterceptor(logging)
        .addInterceptor(authInterceptor)
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val api: ApiService = retrofit.create(ApiService::class.java)

    val websocketBaseUrl: String = BuildConfig.WEBSOCKET_BASE_URL

    /** Decode the backend's uniform error envelope, falling back to HTTP status text. */
    fun parseError(response: HttpCallResponse<*>): ApiException {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull()
        if (!raw.isNullOrBlank()) {
            runCatching {
                val parsed = json.decodeFromString(ApiErrorBody.serializer(), raw)
                val error = parsed.error
                if (error != null) {
                    return ApiException(
                        statusCode = response.code(),
                        message = error.message,
                        code = error.code,
                        details = error.details,
                        retryable = response.code() >= 500 || response.code() == 429,
                    )
                }
            }
        }
        return ApiException(
            statusCode = response.code(),
            message = when (response.code()) {
                401 -> "Please sign in again."
                403 -> "You do not have permission for this action."
                404 -> "Not found."
                429 -> "Too many requests. Please wait a moment."
                in 500..599 -> "The server had a problem. Try again shortly."
                else -> "Request failed (${response.code()})."
            },
        )
    }
}

/** Convert a retrofit call into a typed [ApiResult] without throwing. */
suspend fun <T> safeCall(block: suspend () -> HttpCallResponse<T>): ApiResult<T> = try {
    val response = block()
    val body = response.body()
    if (response.isSuccessful && body != null) {
        ApiResult.Success(body)
    } else if (response.isSuccessful) {
        @Suppress("UNCHECKED_CAST")
        ApiResult.Success(Unit as T)
    } else {
        val error = response.errorBody()?.string()
        val apiError = parseErrorString(response.code(), error)
        ApiResult.Failure(apiError.message ?: "Request failed (${response.code()}).", apiError.code, apiError.details, apiError.retryable)
    }
} catch (io: IOException) {
    ApiResult.Failure(networkMessage(io), code = "network_error")
} catch (t: Throwable) {
    ApiResult.Failure(t.message ?: "Unexpected error", code = "client_error", retryable = false)
}

private val errorJson = Json { ignoreUnknownKeys = true }

internal fun parseErrorString(status: Int, raw: String?): ApiException {
    if (!raw.isNullOrBlank()) {
        runCatching {
            val parsed = errorJson.decodeFromString(ApiErrorBody.serializer(), raw)
            parsed.error?.let {
                return ApiException(status, it.message, it.code, it.details, status >= 500 || status == 429)
            }
        }
    }
    return ApiException(
        status,
        when (status) {
            401 -> "Please sign in again."
            403 -> "You do not have permission for this action."
            422 -> "Some details were rejected by the server."
            in 500..599 -> "The server had a problem. Try again shortly."
            else -> "Request failed ($status)."
        },
    )
}
