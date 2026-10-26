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
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.BuildConfig
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.DangerButton
import com.rsaitrader.ui.components.ErrorBanner
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
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val config = state.config.data
    val unread = state.notifications.data?.count { !it.read } ?: 0

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

        if (isAdmin) {
            Spacer(Modifier.height(8.dp))
            SettingsRow(
                icon = Icons.Filled.AdminPanelSettings,
                title = "Admin dashboard",
                subtitle = "Users, audit log, symbol filters, global kill switch",
                accent = RsColors.Violet,
            ) { onNavigate("admin") }
        }

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
            StatRow("Backend", if (BuildConfig.DEBUG) BuildConfig.API_BASE_URL else "configured at build time")
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
