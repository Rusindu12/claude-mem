package com.rsaitrader.ui.screens

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.ui.components.ConnectionPill
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.KeyValueChip
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.ModeToggle
import com.rsaitrader.ui.components.RefreshBar
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StaleDataBanner
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.theme.MonoSmallStyle
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.DashboardViewModel

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    userName: String,
    onOpenChart: (String) -> Unit,
    onOpenTerminal: () -> Unit,
    onNavigate: (String) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val stream by viewModel.streamStatus.collectAsStateWithLifecycle()
    val live by viewModel.liveTickers.collectAsStateWithLifecycle()

    val config = state.config.data
    val overview = state.overview.data
    val portfolio = state.portfolio.data

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Good ${timeOfDay()}, ${userName.ifBlank { "Trader" }}",
                    style = MaterialTheme.typography.titleLarge,
                    color = RsColors.TextPrimary,
                )
                Text(
                    "Binance Spot · ${config?.binanceEnvironment ?: "testnet"} · ${config?.environment ?: ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextMuted,
                )
            }
            ConnectionPill(
                connected = stream.connected,
                degraded = stream.degraded || (overview?.connection?.degradedReason != null),
                label = when {
                    stream.connected && !stream.degraded -> "LIVE"
                    stream.connecting -> "CONNECTING"
                    else -> "OFFLINE"
                },
            )
            IconButton(onClick = viewModel::refresh) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh dashboard", tint = RsColors.TextSecondary)
            }
        }

        RefreshBar(visible = state.refreshing)

        if (config?.maintenanceMode == true) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .background(RsColors.Warning.copy(alpha = 0.14f), RoundedCornerShape(12.dp))
                    .padding(12.dp),
            ) {
                Text(
                    "Server maintenance mode: trading is paused by the operator.",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.Warning,
                )
            }
        }

        StaleDataBanner(
            stale = overview?.freshness?.anyStale ?: (state.overview.data?.connection?.degradedReason != null),
            source = overview?.connection?.provider,
            synthetic = overview?.connection?.synthetic ?: false,
            ageSeconds = overview?.freshness?.oldestAgeSeconds,
        )

        state.overview.error?.let {
            ErrorBanner(message = it, code = state.overview.errorCode, onRetry = viewModel::refresh)
        }

        // ------------------------------------------------------------ equity
        SectionCard(
            title = "Portfolio",
            trailing = Fmt.modeLabel(state.mode),
            accent = if (state.mode == "live") RsColors.Danger else RsColors.Emerald,
        ) {
            ModeToggle(mode = state.mode, onSelect = viewModel::setMode)
            Spacer(Modifier.height(12.dp))
            when {
                state.portfolio.loading && portfolio == null -> LoadingBox("Loading balances…")
                state.portfolio.error != null -> ErrorBanner(
                    message = state.portfolio.error ?: "",
                    code = state.portfolio.errorCode,
                    onRetry = viewModel::refresh,
                )
                portfolio != null -> {
                    Text(
                        Fmt.usdt(portfolio.totalValueUsdt),
                        style = MaterialTheme.typography.displaySmall,
                        color = RsColors.TextPrimary,
                    )
                    Text(
                        if (portfolio.simulated) "Simulated balance — no exchange funds involved"
                        else "Live exchange balance${portfolio.environment?.let { " · $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (portfolio.simulated) RsColors.Info else RsColors.Warning,
                    )
                    Spacer(Modifier.height(10.dp))
                    StatRow("Available USDT", Fmt.usdt(portfolio.availableUsdt))
                    StatRow("Holdings value", Fmt.usdt(portfolio.holdingsValue))
                    StatRow(
                        "Unrealised P&L",
                        Fmt.usdtSigned(portfolio.unrealizedPnl),
                        valueColor = pnlColor(portfolio.unrealizedPnl),
                    )
                    StatRow(
                        "Realised P&L",
                        Fmt.usdtSigned(portfolio.realizedPnl),
                        valueColor = pnlColor(portfolio.realizedPnl),
                    )
                    StatRow("Fees paid (net of)", Fmt.usdt(portfolio.feesPaid))
                    StatRow("Open positions", portfolio.positionCount.toString())
                }
                else -> EmptyState(
                    title = "No portfolio data",
                    body = "Pull to refresh or check the backend connection.",
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            QuickAction("New order", Icons.Filled.SwapVert, Modifier.weight(1f)) { onOpenTerminal() }
            QuickAction("AI signals", Icons.Filled.AutoAwesome, Modifier.weight(1f)) { onNavigate("signals") }
            QuickAction("Charts", Icons.Filled.ShowChart, Modifier.weight(1f)) {
                onOpenChart(viewModel.watchSymbols.firstOrNull() ?: "BTCUSDT")
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            QuickAction("Orders", Icons.Filled.Receipt, Modifier.weight(1f)) { onNavigate("orders") }
            QuickAction("Risk", Icons.Filled.Shield, Modifier.weight(1f)) { onNavigate("risk") }
            QuickAction("Alerts", Icons.Filled.NotificationsActive, Modifier.weight(1f)) { onNavigate("alerts") }
            QuickAction("More", Icons.Filled.Tune, Modifier.weight(1f)) { onNavigate("settings") }
        }

        Spacer(Modifier.height(12.dp))
        SignalCard(
            signal = state.signal.data,
            loading = state.signal.loading,
            error = state.signal.error,
            onOpenSignals = { onNavigate("signals") },
        )

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Markets", trailing = stream.source ?: overview?.connection?.provider) {
            val tickers: List<TickerDto> = viewModel.watchSymbols.mapNotNull { live[it] ?: overview?.tickers?.firstOrNull { t -> t.symbol == it } }
            if (tickers.isEmpty()) {
                LoadingBox("Waiting for market data…")
            } else {
                tickers.forEachIndexed { index, ticker ->
                    TickerRow(ticker) { onOpenChart(ticker.symbol) }
                    if (index != tickers.lastIndex) Divider2(Modifier.padding(vertical = 6.dp))
                }
            }
        }

        state.risk.data?.let { risk ->
            Spacer(Modifier.height(12.dp))
            SectionCard(title = "Risk & safety", accent = if (risk.canTradeLive) RsColors.Warning else RsColors.Border) {
                StatRow("Live trading", if (risk.server.liveTradingEnabled && risk.policy.liveOptIn) "ENABLED" else "DISABLED",
                    valueColor = if (risk.policy.liveOptIn) RsColors.Warning else RsColors.TextSecondary)
                StatRow("Manual approval", if (risk.server.requireManualApproval) "Required" else "Off")
                StatRow("Kill switch", if (risk.control.killSwitch) "ENGAGED" else "Clear",
                    valueColor = if (risk.control.killSwitch) RsColors.Danger else RsColors.Emerald)
                StatRow("Max trade size", "${Fmt.usdt(risk.policy.maxTradeNotional)}")
                StatRow("Daily loss limit", Fmt.usdt(risk.policy.maxDailyLoss))
                StatRow("Data source", risk.market.provider + if (risk.market.synthetic) " (simulated)" else "")
            }
        }

        state.config.error?.let {
            Spacer(Modifier.height(8.dp))
            ErrorBanner(message = it, code = state.config.errorCode, onRetry = viewModel::refresh)
        }

        config?.disclaimer?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun QuickAction(label: String, icon: ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .background(RsColors.Navy, RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = RsColors.Emerald, modifier = Modifier.size(20.dp))
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = RsColors.TextSecondary)
    }
}

@Composable
fun TickerRow(ticker: TickerDto, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(30.dp).background(RsColors.SurfaceHigh, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                Fmt.base(ticker.symbol).take(3),
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.Emerald,
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(Fmt.pair(ticker.symbol), style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
            Text(
                "Vol ${Fmt.compactVolume(ticker.quoteVolume24h)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Fmt.price(ticker.price), style = MonoStyle, color = RsColors.TextPrimary)
            Text(
                Fmt.signedPercent(ticker.changePercent24h),
                style = MonoSmallStyle,
                color = pnlColor(ticker.changePercent24h.toString()),
            )
        }
        if (ticker.stale) {
            Spacer(Modifier.width(6.dp))
            StatusPill("STALE", RsColors.Warning)
        }
    }
}

@Composable
private fun SignalCard(signal: SignalDto?, loading: Boolean, error: String?, onOpenSignals: () -> Unit) {
    val actionColor = when (signal?.action) {
        "BUY" -> RsColors.Emerald
        "SELL" -> RsColors.Danger
        else -> RsColors.TextSecondary
    }
    SectionCard(
        title = "Latest AI signal",
        trailing = signal?.let { "${it.symbol} · ${it.timeframe}" },
        accent = actionColor.takeIf { signal != null },
    ) {
        when {
            loading && signal == null -> LoadingBox("Running analysis…")
            error != null -> ErrorBanner(message = error)
            signal == null -> EmptyState(title = "No signal yet", body = "Open AI signals to generate one.")
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        signal.action,
                        style = MaterialTheme.typography.headlineMedium,
                        color = actionColor,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.width(10.dp))
                    StatusPill(
                        text = signal.evidenceGrade.uppercase(),
                        color = when (signal.evidenceGrade) {
                            "strong" -> RsColors.Emerald
                            "moderate" -> RsColors.Info
                            "weak" -> RsColors.Warning
                            else -> RsColors.TextMuted
                        },
                    )
                    Spacer(Modifier.weight(1f))
                    Text(Fmt.price(signal.price), style = MonoStyle, color = RsColors.TextPrimary)
                }
                if (signal.dataQuality.stale || signal.synthetic) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Analysis based on ${if (signal.synthetic) "simulated" else "stale"} data. Treat with caution.",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Warning,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    KeyValueChip("Entry", "${Fmt.price(signal.entryLow)}–${Fmt.price(signal.entryHigh)}")
                    KeyValueChip("SL", Fmt.price(signal.stopLoss), RsColors.Danger)
                    KeyValueChip("TP", Fmt.price(signal.takeProfit), RsColors.Emerald)
                    KeyValueChip("R:R", signal.riskReward?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—")
                }
                Spacer(Modifier.height(8.dp))
                signal.reasons.take(3).forEach { reason ->
                    Text("• $reason", style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Updated ${Fmt.dateTime(signal.generatedAt)} · model ${signal.modelVersion.ifBlank { "n/a" }} " +
                        "(${signal.modelStatus})",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Open full analysis →",
                    style = MaterialTheme.typography.labelLarge,
                    color = RsColors.Emerald,
                    modifier = Modifier.clickable { onOpenSignals() },
                )
            }
        }
    }
}

fun pnlColor(value: String?): Color {
    val number = value?.toBigDecimalOrNull() ?: return RsColors.TextSecondary
    return when {
        number.signum() > 0 -> RsColors.Emerald
        number.signum() < 0 -> RsColors.Danger
        else -> RsColors.TextSecondary
    }
}

private fun timeOfDay(): String {
    val hour = java.time.LocalTime.now().hour
    return when {
        hour < 12 -> "morning"
        hour < 17 -> "afternoon"
        else -> "evening"
    }
}
