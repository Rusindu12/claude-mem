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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.ui.components.DangerButton
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.ModeToggle
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.PortfolioViewModel

@Composable
fun PortfolioScreen(viewModel: PortfolioViewModel, onBack: () -> Unit, onOpenAnalytics: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val portfolio = state.portfolio.data
    var showReset by remember { mutableStateOf(false) }
    var startingEquity by remember { mutableStateOf("10000") }

    if (showReset) {
        AlertDialog(
            onDismissRequest = { showReset = false },
            containerColor = RsColors.Navy,
            title = { Text("Reset simulated account?") },
            text = {
                Column {
                    Text(
                        "This deletes all paper positions and orders and restores the simulated balance. " +
                            "Real exchange balances are never touched.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    RsTextField(
                        value = startingEquity,
                        onValueChange = { startingEquity = it.filter { c -> c.isDigit() || c == '.' } },
                        label = "Starting balance (USDT)",
                        keyboardType = KeyboardType.Decimal,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.resetPaper(startingEquity)
                    showReset = false
                }) { Text("Reset", color = RsColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { showReset = false }) { Text("Cancel") } },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Portfolio", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    if (state.mode == "live") "Real exchange balances" else "Simulated balances",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (state.mode == "live") RsColors.Warning else RsColors.Info,
                )
            }
            IconButton(onClick = viewModel::load) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh portfolio", tint = RsColors.TextSecondary)
            }
        }

        ModeToggle(mode = state.mode, onSelect = viewModel::setMode)
        Spacer(Modifier.height(10.dp))

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        when {
            state.portfolio.loading && portfolio == null -> LoadingBox("Loading balances…")
            portfolio == null -> EmptyState(title = "No portfolio data", body = state.portfolio.error)
            else -> {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = RsColors.Navy,
                    border = BorderStroke(1.dp, if (portfolio.simulated) RsColors.Border else RsColors.Warning.copy(alpha = 0.5f)),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            "TOTAL VALUE",
                            style = MaterialTheme.typography.labelSmall,
                            color = RsColors.TextMuted,
                        )
                        Text(
                            Fmt.usdt(portfolio.totalValueUsdt),
                            style = MaterialTheme.typography.displaySmall,
                            color = RsColors.TextPrimary,
                        )
                        Text(
                            if (portfolio.simulated) "Simulated — no real funds" else "Live exchange wallet · ${portfolio.environment ?: ""}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (portfolio.simulated) RsColors.Info else RsColors.Warning,
                        )
                        Spacer(Modifier.height(10.dp))
                        StatRow("Available USDT", Fmt.usdt(portfolio.availableUsdt))
                        StatRow("Holdings value", Fmt.usdt(portfolio.holdingsValue))
                        StatRow("Exposure", Fmt.usdt(portfolio.exposure))
                        StatRow("Realised P&L", Fmt.usdtSigned(portfolio.realizedPnl), valueColor = pnlColor(portfolio.realizedPnl))
                        StatRow("Unrealised P&L", Fmt.usdtSigned(portfolio.unrealizedPnl), valueColor = pnlColor(portfolio.unrealizedPnl))
                        StatRow("Fees paid", Fmt.usdt(portfolio.feesPaid))
                        portfolio.startingEquity?.let { starting ->
                            val start = starting.toBigDecimalOrNull()
                            val total = portfolio.totalValueUsdt.toBigDecimalOrNull()
                            if (start != null && start.signum() > 0 && total != null) {
                                val pct = (total - start) / start * java.math.BigDecimal(100)
                                StatRow(
                                    "Return on starting balance",
                                    Fmt.percent(pct.toPlainString()),
                                    valueColor = pnlColor(pct.toPlainString()),
                                )
                            }
                        }
                    }
                }

                portfolio.note?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                }

                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Open positions", trailing = portfolio.positionCount.toString()) {
                    val positions = portfolio.positions
                    if (positions.isEmpty()) {
                        Text(
                            "No open positions. Filled buys create a position here.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextMuted,
                        )
                    } else {
                        positions.forEachIndexed { index, position ->
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            Fmt.pair(position.symbol),
                                            style = MaterialTheme.typography.titleMedium,
                                            color = RsColors.TextPrimary,
                                        )
                                        Text(
                                            "${Fmt.amount(position.quantity)} @ ${Fmt.price(position.entryPrice)}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = RsColors.TextMuted,
                                        )
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            Fmt.usdt(position.marketValue),
                                            style = MaterialTheme.typography.titleMedium,
                                            color = RsColors.TextPrimary,
                                        )
                                        Text(
                                            Fmt.usdtSigned(position.unrealizedPnl),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = pnlColor(position.unrealizedPnl),
                                        )
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(
                                        "SL ${position.stopLoss?.let { Fmt.price(it) } ?: "—"}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = RsColors.Danger,
                                    )
                                    Text(
                                        "TP ${position.takeProfit?.let { Fmt.price(it) } ?: "—"}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = RsColors.Emerald,
                                    )
                                    Text(
                                        "since ${Fmt.dateTime(position.openedAt)}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = RsColors.TextMuted,
                                    )
                                }
                                if (index != positions.lastIndex) Divider2(Modifier.padding(vertical = 8.dp))
                            }
                        }
                    }
                }

                if (portfolio.balances.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    SectionCard(title = "Exchange balances") {
                        portfolio.balances.forEach { balance ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(balance.asset, style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                                Spacer(Modifier.weight(1f))
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        "free ${Fmt.amount(balance.free)} · locked ${Fmt.amount(balance.locked)}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = RsColors.TextMuted,
                                    )
                                    Text(
                                        if (balance.priced) Fmt.usdt(balance.usdtValue) else "no USDT price",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = RsColors.TextSecondary,
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = RsColors.Surface,
                    border = BorderStroke(1.dp, RsColors.Border),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text("Analytics & exports", style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                        Text(
                            "Daily/weekly/monthly performance, drawdown and win-rate statistics with CSV export are on " +
                                "the analytics screen. All figures are net of fees where available.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextMuted,
                        )
                        TextButton(onClick = onOpenAnalytics) { Text("Open analytics", color = RsColors.Emerald) }
                    }
                }

                if (portfolio.simulated) {
                    Spacer(Modifier.height(12.dp))
                    DangerButton(
                        text = "Reset simulated account",
                        onClick = { showReset = true },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}
