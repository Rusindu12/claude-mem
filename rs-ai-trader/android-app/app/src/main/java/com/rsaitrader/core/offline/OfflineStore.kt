package com.rsaitrader.core.offline

import android.content.Context
import com.rsaitrader.core.network.RiskPolicyDto
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant

// --------------------------------------------------------------- data records
@Serializable
data class LocalAccount(
    val id: String,
    val email: String,
    val displayName: String,
    val role: String = "user",
    val status: String = "active",
    val language: String = "en",
    val salt: String,
    val passwordHash: String,
    val createdAt: String,
    val lastLoginAt: String? = null,
)

@Serializable
data class LocalOrder(
    val id: String,
    val userId: String,
    val mode: String = "paper",
    val symbol: String,
    val side: String,
    val orderType: String,
    val quantity: String,
    val price: String? = null,
    val stopLoss: String? = null,
    val takeProfit: String? = null,
    val status: String = "NEW",
    val filledQuantity: String = "0",
    val averageFillPrice: String? = null,
    val feePaid: String = "0",
    val realizedPnl: String? = null,
    val idempotencyKey: String? = null,
    val createdAt: String,
    val closedAt: String? = null,
    val rejectReason: String? = null,
)

@Serializable
data class LocalPosition(
    val id: String,
    val userId: String,
    val symbol: String,
    val quantity: String,
    val entryPrice: String,
    val stopLoss: String? = null,
    val takeProfit: String? = null,
    val openedAt: String,
)

@Serializable
data class LocalAlert(
    val id: String,
    val userId: String,
    val symbol: String,
    val condition: String,
    val targetPrice: String? = null,
    val note: String? = null,
    val status: String = "active",
    val createdAt: String,
    val triggeredAt: String? = null,
)

@Serializable
data class LocalNotification(
    val id: String,
    val userId: String,
    val kind: String,
    val title: String,
    val body: String,
    val severity: String = "info",
    val read: Boolean = false,
    val createdAt: String,
)

@Serializable
data class LocalAuditEvent(
    val id: String,
    val userId: String?,
    val actorRole: String,
    val action: String,
    val outcome: String = "success",
    val detail: Map<String, String> = emptyMap(),
    val createdAt: String,
)

@Serializable
data class LocalChatEntry(
    val id: String,
    val userId: String,
    val question: String,
    val answer: String,
    val lang: String = "en",
    val intent: String = "app",
    val createdAt: String,
)

@Serializable
data class LocalPaperAccount(
    val userId: String,
    val startingEquity: String = "10000",
    val quoteBalance: String = "10000",
    val feesPaid: String = "0",
    val realizedPnl: String = "0",
    val resetAt: String,
)

@Serializable
data class LocalKillSwitch(
    val engaged: Boolean = false,
    val reason: String? = null,
    val activatedAt: String? = null,
)

@Serializable
data class LocalSettings(
    val enabledSymbols: List<String> = SampleMarket.defaultSymbols,
    val paperTradingEnabled: Boolean = true,
    val assistantEnabled: Boolean = true,
)

@Serializable
data class OfflineState(
    val accounts: List<LocalAccount> = emptyList(),
    val orders: List<LocalOrder> = emptyList(),
    val positions: List<LocalPosition> = emptyList(),
    val alerts: List<LocalAlert> = emptyList(),
    val notifications: List<LocalNotification> = emptyList(),
    val audit: List<LocalAuditEvent> = emptyList(),
    val chat: List<LocalChatEntry> = emptyList(),
    val paper: Map<String, LocalPaperAccount> = emptyMap(),
    val riskPolicies: Map<String, RiskPolicyDto> = emptyMap(),
    val killSwitch: LocalKillSwitch = LocalKillSwitch(),
    val settings: LocalSettings = LocalSettings(),
)

/**
 * Persistent store for the on-device engine.
 *
 * Everything the app needs (accounts, paper orders, positions, alerts, chat,
 * audit) lives in one JSON file inside the app's private directory. Only salted
 * PBKDF2 password hashes are stored — never a password, never a Binance key.
 *
 * Writes are atomic (temp file + rename) so a crash mid-save cannot corrupt the
 * state, and every accessor is synchronized because the paper engine is called
 * from several coroutines.
 */
class OfflineStore private constructor(private val file: File) {

    /** App-private state file used by the shipping app. */
    constructor(context: Context) : this(
        File(context.applicationContext.filesDir, "rsai_offline_state.json"),
    )
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }

    private var cached: OfflineState? = null

    @Synchronized
    fun state(): OfflineState {
        cached?.let { return it }
        val loaded = runCatching {
            if (!file.exists()) OfflineState() else json.decodeFromString(OfflineState.serializer(), file.readText())
        }.getOrElse { OfflineState() }
        cached = loaded
        return loaded
    }

    @Synchronized
    fun update(block: (OfflineState) -> OfflineState) {
        val next = block(state())
        cached = next
        runCatching {
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeText(json.encodeToString(OfflineState.serializer(), next))
            if (file.exists()) file.delete()
            tmp.renameTo(file)
        }
    }

    @Synchronized
    fun clear() {
        cached = OfflineState()
        runCatching { file.delete() }
    }

    // ------------------------------------------------------------- helpers
    fun now(): String = Instant.now().toString()

    fun audit(userId: String?, role: String, action: String, detail: Map<String, String> = emptyMap()) {
        update { current ->
            current.copy(
                audit = (current.audit + LocalAuditEvent(
                    id = newId(),
                    userId = userId,
                    actorRole = role,
                    action = action,
                    detail = detail,
                    createdAt = now(),
                )).takeLast(300),
            )
        }
    }

    fun notify(
        userId: String,
        kind: String,
        title: String,
        body: String,
        severity: String = "info",
    ) {
        update { current ->
            current.copy(
                notifications = (current.notifications + LocalNotification(
                    id = newId(),
                    userId = userId,
                    kind = kind,
                    title = title,
                    body = body,
                    severity = severity,
                    createdAt = now(),
                )).takeLast(200),
            )
        }
    }

    companion object {
        fun newId(): String = java.util.UUID.randomUUID().toString()

        /** Test/JVM entry point: backed by any file, no Android framework needed. */
        fun forFile(file: File): OfflineStore = OfflineStore(file)
    }
}
