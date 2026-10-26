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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.BacktestResultDto
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.SymbolChips
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.BacktestViewModel
import com.rsaitrader.ui.viewmodel.TIMEFRAMES

@Composable
fun BacktestScreen(viewModel: BacktestViewModel, symbols: List<String>, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Backtest", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Historical simulation · costs included",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        SymbolChips(
            symbols = (symbols + state.symbol).distinct().take(10),
            selected = state.symbol,
            onSelect = viewModel::setSymbol,
        )
        Spacer(Modifier.height(10.dp))
        SegmentedRow(options = TIMEFRAMES, selected = state.timeframe, onSelect = viewModel::setTimeframe)
        Spacer(Modifier.height(8.dp))
        SegmentedRow(
            options = listOf("7", "30", "90", "180"),
            selected = state.days.toString(),
            onSelect = { viewModel.setDays(it.toInt()) },
            labels = { "${it}d" },
        )
        Spacer(Modifier.height(12.dp))

        SectionCard(title = "Parameters") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RsTextField(
                    value = state.initialCapital,
                    onValueChange = viewModel::setCapital,
                    label = "Capital",
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
                RsTextField(
                    value = state.feeBps,
                    onValueChange = viewModel::setFee,
                    label = "Fee bps",
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
                RsTextField(
                    value = state.slippageBps,
                    onValueChange = viewModel::setSlippage,
                    label = "Slip bps",
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = if (state.running) "Simulating…" else "Run backtest",
                onClick = viewModel::run,
                modifier = Modifier.fillMaxWidth(),
                loading = state.running,
            )
        }

        state.result.error?.let {
            Spacer(Modifier.height(8.dp))
            ErrorBanner(message = it, code = state.result.errorCode, onRetry = viewModel::run)
        }

        Spacer(Modifier.height(10.dp))
        val result = state.result.data
        if (result == null) {
            EmptyState(
                title = "No results yet",
                body = "Run a backtest to see how the signal rules performed on past candles. Results are hypothetical " +
                    "and computed on unseen history only — no look-ahead.",
            )
        } else {
            ResultBody(result)
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun ResultBody(result: BacktestResultDto) {
    val metrics = result.metrics
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = RsColors.Navy,
        border = BorderStroke(1.dp, RsColors.Border),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "${result.symbol} · ${result.timeframe} · ${result.bars} bars",
                style = MaterialTheme.typography.titleMedium,
                color = RsColors.TextPrimary,
            )
            Text(
                "${Fmt.dateTime(result.start)} → ${Fmt.dateTime(result.end)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                Fmt.percent(metrics.totalReturnPct / 100.0),
                style = MaterialTheme.typography.displaySmall,
                color = pnlColor(metrics.totalReturnPct.toString()),
            )
            StatRow("Final equity", Fmt.usdt(metrics.finalEquity))
            StatRow("Max drawdown", Fmt.percent(metrics.maxDrawdownPct / 100.0), valueColor = RsColors.Danger)
            StatRow("Trades", metrics.tradeCount.toString())
            StatRow("Win rate", metrics.winRatePct?.let { Fmt.percent(it / 100.0) } ?: "—")
            StatRow("Profit factor", metrics.profitFactor?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—")
            StatRow("Sharpe (annualised)", metrics.sharpeAnnualised?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—")
            StatRow("Fees + slippage", Fmt.usdt(metrics.feesAndSlippagePaid))
            result.buyAndHold?.let { bh ->
                val value = bh["total_return_pct"]?.toString()
                StatRow("Buy & hold return", value?.toDoubleOrNull()?.let { Fmt.percent(it / 100.0) } ?: value ?: "—")
            }
        }
    }

    if (result.assumptions.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Assumptions") {
            result.assumptions.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
            }
        }
    }
    if (result.warnings.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Warnings", accent = RsColors.Warning) {
            result.warnings.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.Warning)
            }
        }
    }
}
