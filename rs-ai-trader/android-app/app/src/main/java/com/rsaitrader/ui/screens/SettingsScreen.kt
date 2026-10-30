package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.remember
import com.rsaitrader.BuildConfig
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.DangerButton
import com.rsaitrader.data.AdminUnlock
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.RsPasswordField
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AppSettingsViewModel

@Composable
fun SettingsScreen(
    viewModel: AppSettingsViewModel,
    isAdmin: Boolean,
    onNavigate: (String) -> Unit,
    onLogout: () -> Unit,
    deviceMode: Boolean = true,
    onSwitchEngine: (Boolean) -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val config = state.config.data
    val server = remember { ServiceLocator.server }
    val adminUnlock = remember { ServiceLocator.adminUnlock }
    val unread = state.notifications.data?.count { !it.read } ?: 0

    var showUnlockDialog by remember { mutableStateOf(false) }
    var unlockInput by remember { mutableStateOf("") }
    var unlockError by remember { mutableStateOf<String?>(null) }
    var showChangeCodeDialog by remember { mutableStateOf(false) }
    var currentCode by remember { mutableStateOf("") }
    var newCode by remember { mutableStateOf("") }
    var codeChangeMessage by remember { mutableStateOf<String?>(null) }
    var unlockTick by remember { mutableIntStateOf(0) }
    val adminAllowed = isAdmin || (remember(unlockTick) { adminUnlock.isUnlocked })

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Settings", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    state.profile?.email ?: "",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            if (unread > 0) {
                androidx.compose.material3.Badge { Text(unread.toString()) }
                Spacer(Modifier.size(6.dp))
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        if (showUnlockDialog) {
            AlertDialog(
                onDismissRequest = { showUnlockDialog = false },
                containerColor = RsColors.Navy,
                title = { Text("Admin unlock") },
                text = {
                    Column {
                        Text(
                            "Enter the on-device admin code. It is hashed with PBKDF2 and checked on the phone; " +
                                "five wrong tries lock the gate for a while.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextSecondary,
                        )
                        Spacer(Modifier.height(10.dp))
                        RsPasswordField(
                            value = unlockInput,
                            onValueChange = { unlockInput = it; unlockError = null },
                            label = "Admin code",
                            error = unlockError,
                            imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        when (val result = adminUnlock.unlock(unlockInput)) {
                            is AdminUnlock.Result.Unlocked -> {
                                unlockTick++
                                unlockInput = ""
                                showUnlockDialog = false
                                onNavigate("admin")
                            }
                            is AdminUnlock.Result.Wrong ->
                                unlockError = "Wrong code. ${result.attemptsLeft} attempt(s) left."
                            is AdminUnlock.Result.Locked ->
                                unlockError = "Too many attempts. Try again in ${result.seconds}s."
                        }
                    }) { Text("Unlock", color = RsColors.Emerald) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        adminUnlock.lock()
                        unlockTick++
                        showUnlockDialog = false
                    }) { Text("Lock", color = RsColors.TextMuted) }
                },
            )
        }

        if (showChangeCodeDialog) {
            AlertDialog(
                onDismissRequest = { showChangeCodeDialog = false },
                containerColor = RsColors.Navy,
                title = { Text("Change admin code") },
                text = {
                    Column {
                        Text(
                            if (adminUnlock.isUsingDefaultCode) {
                                "You are still using the default unlock code. Replace it now."
                            } else {
                                "Choose a new code of at least 6 characters."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (adminUnlock.isUsingDefaultCode) RsColors.Warning else RsColors.TextSecondary,
                        )
                        Spacer(Modifier.height(10.dp))
                        RsPasswordField(
                            value = currentCode,
                            onValueChange = { currentCode = it; codeChangeMessage = null },
                            label = "Current code",
                        )
                        Spacer(Modifier.height(10.dp))
                        RsPasswordField(
                            value = newCode,
                            onValueChange = { newCode = it; codeChangeMessage = null },
                            label = "New code",
                        )
                        codeChangeMessage?.let {
                            Spacer(Modifier.height(8.dp))
                            Text(it, style = MaterialTheme.typography.bodySmall, color = RsColors.Danger)
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        val error = adminUnlock.changeCode(currentCode, newCode)
                        if (error == null) {
                            codeChangeMessage = null
                            currentCode = ""
                            newCode = ""
                            showChangeCodeDialog = false
                        } else {
                            codeChangeMessage = error
                        }
                    }) { Text("Save", color = RsColors.Emerald) }
                },
                dismissButton = {
                    TextButton(onClick = { showChangeCodeDialog = false }) {
                        Text("Cancel", color = RsColors.TextMuted)
                    }
                },
            )
        }

        Spacer(Modifier.height(8.dp))
        SectionCard(
            title = "Data source",
            trailing = if (deviceMode) "on this device" else "server",
        ) {
            SegmentedRow(
                options = listOf("device", "server"),
                selected = if (deviceMode) "device" else "server",
                onSelect = { option -> onSwitchEngine(option == "device") },
                labels = { option -> if (option == "device") "This device" else "Server" },
            )
            Spacer(Modifier.height(6.dp))
            Text(
                if (deviceMode) {
                    "Accounts, prices, signals, paper trading and the admin panel all run inside the app. " +
                        "Prices are simulated and labelled as such, no Binance key is stored, and live trading is " +
                        "impossible in this mode."
                } else {
                    "The app talks to your backend, which holds the Binance key and is the only component that can " +
                        "sign a real order. URL: ${server.baseUrl()}"
                },
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Switching engine signs you out, because a session belongs to one engine.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }

        Spacer(Modifier.height(10.dp))
        SettingsRow(
            icon = Icons.Filled.AdminPanelSettings,
            title = if (adminAllowed) "Admin dashboard" else "Admin dashboard (locked)",
            subtitle = if (adminAllowed) {
                "Users, audit log, symbol filters, global kill switch"
            } else {
                if (isAdmin) "Server role: admin" else "Unlock with the on-device admin code"
            },
            accent = RsColors.Violet,
        ) {
            if (adminAllowed) onNavigate("admin") else showUnlockDialog = true
        }
        Spacer(Modifier.height(4.dp))
        SettingsRow(
            icon = Icons.Filled.Shield,
            title = "Admin unlock code",
            subtitle = if (adminUnlock.isUsingDefaultCode) {
                "Still using the first-run code — change it"
            } else {
                "Hashed on this device (PBKDF2), 15-minute session"
            },
            accent = RsColors.Warning,
        ) { showChangeCodeDialog = true }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Trading & analysis") {
            SettingsRow(Icons.Filled.Key, "API connection", "Store a Binance key on the server", RsColors.Emerald) { onNavigate("apiSettings") }
            Divider2(Modifier.padding(vertical = 4.dp))
            SettingsRow(Icons.Filled.Shield, "Risk settings", "Limits, live opt-in, emergency stop", RsColors.Warning) { onNavigate("risk") }
            Divider2(Modifier.padding(vertical = 4.dp))
            SettingsRow(Icons.Filled.CandlestickChart, "Backtesting", "Simulate the strategy on past candles", RsColors.Info) { onNavigate("backtest") }
            Divider2(Modifier.padding(vertical = 4.dp))
            SettingsRow(Icons.Filled.Insights, "Analytics", "Performance, drawdown and win rate", RsColors.Emerald) { onNavigate("analytics") }
            Divider2(Modifier.padding(vertical = 4.dp))
            SettingsRow(Icons.Filled.Receipt, "Orders & history", "Open orders, fills and CSV export", RsColors.TextSecondary) { onNavigate("orders") }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Assistant & alerts") {
            SettingsRow(Icons.Filled.AutoAwesome, "AI assistant", "Sinhala / English explanations", RsColors.Emerald) { onNavigate("assistant") }
            Divider2(Modifier.padding(vertical = 4.dp))
            SettingsRow(Icons.Filled.NotificationsActive, "Price alerts", "Price, RSI and signal alerts", RsColors.Warning) { onNavigate("alerts") }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Assistant language") {
            SegmentedRow(
                options = listOf("en", "si"),
                selected = state.language,
                onSelect = viewModel::setLanguage,
                labels = { if (it == "en") "English" else "සිංහල" },
            )
            Text(
                "Changing this also saves the preference to your account.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Security") {
            SettingsRow(Icons.Filled.Security, "Sessions & password", "Revoke devices, change password, delete account", RsColors.Danger) {
                onNavigate("security")
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Notifications", trailing = unread.toString()) {
            val notifications = state.notifications.data ?: emptyList()
            if (notifications.isEmpty()) {
                Text(
                    "No notifications yet. Order fills, alerts, API disconnects and suspicious logins appear here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextMuted,
                )
            } else {
                notifications.take(8).forEachIndexed { index, notification ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                        Icon(
                            Icons.Filled.Notifications,
                            contentDescription = null,
                            tint = when (notification.severity) {
                                "critical", "error" -> RsColors.Danger
                                "warning" -> RsColors.Warning
                                else -> RsColors.Info
                            },
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.size(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                notification.title,
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (notification.read) RsColors.TextSecondary else RsColors.TextPrimary,
                            )
                            Text(
                                notification.body,
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                            Text(
                                Fmt.dateTime(notification.createdAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                        }
                    }
                    if (index != notifications.take(8).lastIndex) Divider2()
                }
                TextButton(onClick = viewModel::markNotificationsRead) {
                    Text("Mark all as read", color = RsColors.Emerald)
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        HelpCard()

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "About") {
            StatRow("App version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            StatRow("Data source", if (deviceMode) "on this device (simulated)" else "backend", mono = false)
            StatRow("Backend", server.baseUrl(), mono = false)
            StatRow(
                "Backend source",
                if (server.isOverridden) "overridden in the app" else "set at build time (${BuildConfig.API_BASE_URL})",
                mono = false,
            )
            StatRow("Exchange environment", config?.binanceEnvironment ?: "—")
            StatRow("Paper trading", if (config?.paperTradingEnabled != false) "Enabled" else "Disabled")
            StatRow("Live trading (server)", if (config?.liveTradingEnabled == true) "Enabled" else "Disabled")
            StatRow("Automation", if (config?.automationEnabled == true) "Enabled" else "Disabled")
            StatRow("Server time", Fmt.dateTime(config?.serverTime))
            config?.disclaimer?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted, modifier = Modifier.padding(top = 6.dp))
            }
        }

        Spacer(Modifier.height(12.dp))
        DangerButton(text = "Sign out", onClick = onLogout, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Icon(Icons.Filled.Logout, contentDescription = null, tint = RsColors.TextMuted, modifier = Modifier.size(14.dp))
            Spacer(Modifier.size(6.dp))
            Text(
                "Signing out clears the encrypted session on this device.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    accent: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(32.dp).background(accent.copy(alpha = 0.14f), RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
        }
        Text("›", style = MaterialTheme.typography.titleLarge, color = RsColors.TextMuted)
    }
}

@Composable
private fun HelpCard() {
    var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
        shape = RoundedCornerShape(16.dp),
        color = RsColors.Navy,
        border = BorderStroke(1.dp, RsColors.Border),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.HelpOutline, contentDescription = null, tint = RsColors.Info, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Help & how it works", style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                Spacer(Modifier.weight(1f))
                Text(if (expanded) "−" else "+", style = MaterialTheme.typography.titleLarge, color = RsColors.TextMuted)
            }
            if (expanded) {
                Spacer(Modifier.height(8.dp))
                val faq = listOf(
                    "Paper trading simulates fills with fees and slippage. It is not a guarantee of live results.",
                    "Live spot trading is opt-in, requires manual approval per order and server-side risk checks. " +
                        "Futures, margin, leverage and borrowing are not supported.",
                    "Stop-loss and take-profit are ordinary orders. In fast markets they can slip or fail to fill — " +
                        "they are not guaranteed protection.",
                    "Signals show BUY/SELL/HOLD with reasons and levels. There is no invented confidence score; when " +
                        "evidence is weak the engine returns HOLD or insufficient data.",
                    "API keys are encrypted on the backend. The APK never contains exchange secrets and the app never " +
                        "calls Binance directly.",
                    "If market data is stale or the risk engine fails a check, trading is blocked until it recovers.",
                )
                faq.forEach {
                    Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Full documentation: README.md, docs/API.md, docs/SECURITY.md, docs/DEPLOYMENT.md and " +
                        "docs/LIVE_TRADING_SAFETY.md in the project repository.",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }
    }
}
