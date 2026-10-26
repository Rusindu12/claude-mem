package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.AnalyticsDto
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LineChart
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.ModeToggle
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AnalyticsViewModel
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

@Composable
fun AnalyticsScreen(viewModel: AnalyticsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val analytics = state.analytics.data

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Analytics", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Performance net of fees where available",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        ModeToggle(mode = state.mode, onSelect = viewModel::setMode)
        Spacer(Modifier.height(8.dp))
        SegmentedRow(
            options = listOf("7", "30", "90", "365"),
            selected = state.days.toString(),
            onSelect = { viewModel.setDays(it.toInt()) },
            labels = { "${it}d" },
        )
        Spacer(Modifier.height(12.dp))

        state.analytics.error?.let { ErrorBanner(message = it, onRetry = viewModel::load) }

        when {
            state.analytics.loading && analytics == null -> LoadingBox("Crunching performance…")
            analytics == null -> EmptyState(title = "No analytics yet", body = "Place some paper trades first.")
            else -> AnalyticsBody(analytics)
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun AnalyticsBody(analytics: AnalyticsDto) {
    val summary = analytics.summary
    val curve = analytics.daily.mapNotNull { row ->
        row["cumulative_pnl"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = RsColors.Navy,
        border = BorderStroke(1.dp, RsColors.Border),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("EQUITY", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
            Text(Fmt.usdt(summary.equity), style = MaterialTheme.typography.displaySmall, color = RsColors.TextPrimary)
            Text(
                "Return ${Fmt.percent(summary.returnPct)} over ${analytics.windowDays} days",
                style = MaterialTheme.typography.bodySmall,
                color = pnlColor(summary.returnPct),
            )
            Spacer(Modifier.height(10.dp))
            StatRow("Realised P&L", Fmt.usdtSigned(summary.realizedPnl), valueColor = pnlColor(summary.realizedPnl))
            StatRow("Unrealised P&L", Fmt.usdtSigned(summary.unrealizedPnl), valueColor = pnlColor(summary.unrealizedPnl))
            StatRow("Fees paid", Fmt.usdt(summary.feesPaid))
            StatRow("Closed trades", summary.tradeCount?.toString() ?: "0")
            StatRow("Win rate", summary.winRatePct?.let { Fmt.percent(it) } ?: "—")
            StatRow("Profit factor", summary.profitFactor ?: "—")
            StatRow("Max drawdown", summary.maxDrawdownPct?.let { Fmt.percent(it) } ?: "—", valueColor = RsColors.Danger)
        }
    }

    Spacer(Modifier.height(12.dp))
    SectionCard(title = "Cumulative P&L") {
        if (curve.size < 2) {
            Text(
                "Not enough closed trades to draw a curve yet. The chart appears after at least two trading days with results.",
                style = MaterialTheme.typography.bodySmall,
                color = RsColors.TextMuted,
            )
        } else {
            LineChart(points = curve, color = if ((curve.lastOrNull() ?: 0.0) >= 0) RsColors.Emerald else RsColors.Danger)
        }
    }

    Spacer(Modifier.height(12.dp))
    SectionCard(title = "Daily breakdown", trailing = "${analytics.daily.size} days") {
        if (analytics.daily.isEmpty()) {
            Text("No trading days in this window.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
        } else {
            analytics.daily.takeLast(14).forEach { row ->
                DailyRow(row)
            }
        }
    }

    Spacer(Modifier.height(12.dp))
    SectionCard(title = "Assumptions") {
        analytics.costAssumptions?.let {
            StatRow("Taker fee", "${it.takerFeeBps} bps")
            StatRow("Slippage", "${it.slippageBps} bps")
        }
        analytics.note?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
        }
        Text(
            "Simulated and live results are shown separately; figures are not combined and do not predict future returns.",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun DailyRow(row: JsonObject) {
    val date = row["date"]?.jsonPrimitive?.contentOrNull ?: "—"
    val pnl = row["realized_pnl"]?.jsonPrimitive?.contentOrNull
    val trades = row["trades"]?.jsonPrimitive?.contentOrNull ?: "0"
    val drawdown = row["drawdown_pct"]?.jsonPrimitive?.contentOrNull

    Row(
        modifier = Modifier.fillMaxWidth().clickable(enabled = false) { }.padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(date, style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
        Spacer(Modifier.weight(1f))
        Text(
            "$trades trades",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Text(
            drawdown?.let { "DD ${Fmt.percent(it)}" } ?: "",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Text(Fmt.usdtSigned(pnl), style = MaterialTheme.typography.bodyMedium, color = pnlColor(pnl))
    }
}
