package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.ui.components.DangerButton
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.RiskViewModel

@Composable
fun RiskScreen(viewModel: RiskViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val status = state.status.data

    if (state.optInDialog) {
        AlertDialog(
            onDismissRequest = viewModel::closeOptIn,
            containerColor = RsColors.Navy,
            title = { Text("Enable LIVE spot trading", color = RsColors.Danger) },
            text = {
                Column {
                    Text(
                        "Live trading sends real orders to Binance with real money. Before enabling:",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextPrimary,
                    )
                    Spacer(Modifier.height(8.dp))
                    listOf(
                        "Use an API key with spot trading enabled, withdrawals DISABLED and an IP allow-list.",
                        "Test the same strategy in paper mode first.",
                        "Every order still requires manual approval inside the app.",
                        "Stop-loss orders are not guaranteed protection; markets can gap.",
                    ).forEach {
                        Text("• $it", style = MaterialTheme.typography.labelSmall, color = RsColors.TextSecondary)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Type ENABLE LIVE TRADING to confirm",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Warning,
                    )
                    RsTextField(
                        value = state.confirmationText,
                        onValueChange = viewModel::setConfirmationText,
                        label = "Confirmation phrase",
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = state.acknowledgeRisk,
                            onCheckedChange = { viewModel.setAcknowledge(it) },
                        )
                        Text(
                            "I understand I can lose real money.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextPrimary,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = viewModel::enableLive, enabled = !state.working) {
                    Text("Enable live trading", color = RsColors.Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = { TextButton(onClick = viewModel::closeOptIn) { Text("Cancel") } },
        )
    }

    if (state.emergencyConfirm) {
        AlertDialog(
            onDismissRequest = viewModel::closeEmergency,
            containerColor = RsColors.Navy,
            title = { Text("Emergency stop", color = RsColors.Danger) },
            text = {
                Text(
                    "This disables live trading, clears automation and cancels every open order (paper and live). " +
                        "It does not close existing positions — check Binance and manage them manually.",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = viewModel::emergencyStop) {
                    Text("Engage emergency stop", color = RsColors.Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = { TextButton(onClick = viewModel::closeEmergency) { Text("Cancel") } },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Risk settings", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Enforced server-side for every order",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        when {
            state.status.loading && status == null -> LoadingBox("Loading risk status…")
            status == null -> ErrorBanner(
                message = state.status.error ?: "Risk status unavailable.",
                onRetry = viewModel::load,
            )
            else -> {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = RsColors.Navy,
                    border = BorderStroke(
                        1.dp,
                        when {
                            status.control.killSwitch -> RsColors.Danger
                            status.canTradeLive -> RsColors.Warning
                            else -> RsColors.Border
                        },
                    ),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("TRADING STATE", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                            Spacer(Modifier.weight(1f))
                            StatusPill(
                                text = when {
                                    status.control.killSwitch -> "KILL SWITCH"
                                    status.canTradeLive -> "LIVE ENABLED"
                                    status.policy.liveOptIn -> "OPTED IN"
                                    else -> "PAPER ONLY"
                                },
                                color = when {
                                    status.control.killSwitch -> RsColors.Danger
                                    status.canTradeLive -> RsColors.Warning
                                    status.policy.liveOptIn -> RsColors.Info
                                    else -> RsColors.Emerald
                                },
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        StatRow("Live trading (server)", if (status.server.liveTradingEnabled) "Enabled" else "Disabled")
                        StatRow("Live opt-in (this account)", if (status.policy.liveOptIn) "Yes" else "No",
                            valueColor = if (status.policy.liveOptIn) RsColors.Warning else RsColors.TextSecondary)
                        StatRow("Automation", if (status.policy.automationOptIn) "On" else "Off")
                        StatRow("Manual approval", if (status.server.requireManualApproval) "Required" else "OFF")
                        StatRow("Binance environment", status.server.binanceEnvironment)
                        StatRow("Market data", status.market.provider + if (status.market.synthetic) " (simulated)" else "",
                            valueColor = if (status.market.synthetic) RsColors.Warning else RsColors.TextPrimary)
                        StatRow("Daily realised P&L", Fmt.usdt(status.usage.dailyRealizedPnl),
                            valueColor = pnlColor(status.usage.dailyRealizedPnl))
                        StatRow("Daily loss limit", Fmt.usdt(status.usage.dailyLossLimit))
                        StatRow("Open live orders", status.usage.openLiveOrders.toString())
                        StatRow("Unreconciled orders", status.usage.unreconciledOrders.toString(),
                            valueColor = if (status.usage.unreconciledOrders > 0) RsColors.Violet else RsColors.TextPrimary)
                        if (status.usage.cooldownActive) {
                            Text(
                                "Cooldown active after consecutive losses — new orders are blocked until it expires.",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.Warning,
                            )
                        }
                        if (status.control.killSwitch) {
                            Text(
                                "Global kill switch is engaged: ${status.control.reason ?: "no reason given"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = RsColors.Danger,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Limits") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RsTextField(
                            value = state.maxTradeNotional,
                            onValueChange = viewModel::setMaxTradeNotional,
                            label = "Max trade (USDT)",
                            keyboardType = KeyboardType.Decimal,
                            modifier = Modifier.weight(1f),
                        )
                        RsTextField(
                            value = state.maxExposurePct,
                            onValueChange = viewModel::setMaxExposurePct,
                            label = "Max exposure %",
                            keyboardType = KeyboardType.Decimal,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RsTextField(
                            value = state.maxDailyLoss,
                            onValueChange = viewModel::setMaxDailyLoss,
                            label = "Daily loss (USDT)",
                            keyboardType = KeyboardType.Decimal,
                            modifier = Modifier.weight(1f),
                        )
                        RsTextField(
                            value = state.maxRiskPerTradePct,
                            onValueChange = viewModel::setMaxRiskPerTradePct,
                            label = "Risk / trade %",
                            keyboardType = KeyboardType.Decimal,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RsTextField(
                            value = state.maxOpenOrders,
                            onValueChange = viewModel::setMaxOpenOrders,
                            label = "Max open orders",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        )
                        RsTextField(
                            value = state.maxOpenPositions,
                            onValueChange = viewModel::setMaxOpenPositions,
                            label = "Max positions",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RsTextField(
                            value = state.cooldownAfterLosses,
                            onValueChange = viewModel::setCooldownAfterLosses,
                            label = "Cooldown after N losses",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        )
                        RsTextField(
                            value = state.cooldownMinutes,
                            onValueChange = viewModel::setCooldownMinutes,
                            label = "Cooldown minutes",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Require stop-loss", style = MaterialTheme.typography.bodyMedium, color = RsColors.TextPrimary)
                            Text(
                                "Orders without SL/TP are rejected when this is on.",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                        }
                        Switch(checked = state.stopLossRequired, onCheckedChange = viewModel::setStopLossRequired)
                    }
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton(
                        text = if (state.saving) "Saving…" else "Save limits",
                        onClick = viewModel::save,
                        modifier = Modifier.fillMaxWidth(),
                        loading = state.saving,
                    )
                }

                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Live trading consent", accent = RsColors.Warning) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = RsColors.Warning)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Saving an API key never enables live trading. Live spot orders are off unless you explicitly " +
                            "opt in here, and each order still requires manual approval. Futures, margin and leverage " +
                            "are not supported.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    if (status.policy.liveOptIn) {
                        PrimaryButton(
                            text = "Disable live trading",
                            onClick = viewModel::disableLive,
                            modifier = Modifier.fillMaxWidth(),
                            container = RsColors.SurfaceHigh,
                            contentColor = RsColors.TextPrimary,
                        )
                    } else {
                        PrimaryButton(
                            text = "Opt in to live spot trading",
                            onClick = viewModel::openOptIn,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = status.server.liveTradingEnabled,
                            container = RsColors.Danger.copy(alpha = 0.8f),
                            contentColor = androidx.compose.ui.graphics.Color.White,
                        )
                        if (!status.server.liveTradingEnabled) {
                            Text(
                                "Live trading is disabled on the server (LIVE_TRADING_ENABLED=false). Ask the operator " +
                                    "to enable it only after the safety checklist is complete.",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Emergency stop", accent = RsColors.Danger) {
                    Text(
                        "Immediately disables live trading and cancels open orders. Positions are not closed " +
                            "automatically — close them manually on Binance if needed.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    DangerButton(
                        text = "Engage emergency stop",
                        onClick = viewModel::openEmergency,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.working,
                    )
                }
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}
