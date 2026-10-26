package com.rsaitrader.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.TradeTickDto
import com.rsaitrader.ui.components.CandleChart
import com.rsaitrader.ui.components.ConnectionPill
import com.rsaitrader.ui.components.DepthBars
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.KeyValueChip
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.RefreshBar
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StaleDataBanner
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.SymbolChips
import com.rsaitrader.ui.theme.MonoSmallStyle
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.ChartViewModel
import com.rsaitrader.ui.viewmodel.TIMEFRAMES

@Composable
fun ChartScreen(
    viewModel: ChartViewModel,
    symbols: List<String>,
    onBack: () -> Unit,
    onTrade: (String) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val stream by viewModel.streamStatus.collectAsStateWithLifecycle()
    val live by viewModel.liveTickers.collectAsStateWithLifecycle()

    val klines = state.klines.data
    val ticker = live[state.symbol] ?: state.ticker

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text(Fmt.pair(state.symbol), style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Binance Spot · ${state.interval} · ${klines?.source ?: "—"}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            ConnectionPill(connected = stream.connected, degraded = stream.degraded)
            IconButton(onClick = viewModel::loadAll) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh chart", tint = RsColors.TextSecondary)
            }
        }

        RefreshBar(visible = state.klines.loading && klines != null)

        if (ticker != null) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(Fmt.price(ticker.price), style = MaterialTheme.typography.displaySmall, color = RsColors.TextPrimary)
                Spacer(Modifier.width(8.dp))
                Text(
                    Fmt.signedPercent(ticker.changePercent24h),
                    style = MaterialTheme.typography.titleMedium,
                    color = pnlColor(ticker.changePercent24h.toString()),
                )
            }
            Text(
                "24h H ${Fmt.price(ticker.high24h)} · L ${Fmt.price(ticker.low24h)} · " +
                    "Vol ${Fmt.compactVolume(ticker.quoteVolume24h)} · ${Fmt.age(ticker.ageSeconds)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }

        Spacer(Modifier.height(8.dp))
        SymbolChips(
            symbols = (symbols + state.symbol).distinct().take(10),
            selected = state.symbol,
            onSelect = viewModel::setSymbol,
        )
        Spacer(Modifier.height(10.dp))
        SegmentedRow(
            options = TIMEFRAMES,
            selected = state.interval,
            onSelect = viewModel::setInterval,
        )

        StaleDataBanner(
            stale = klines?.stale ?: false,
            source = klines?.source,
            synthetic = klines?.synthetic ?: false,
            ageSeconds = klines?.ageSeconds,
        )

        state.klines.error?.let { ErrorBanner(message = it, code = state.klines.errorCode, onRetry = viewModel::loadAll) }

        Spacer(Modifier.height(8.dp))
        if (klines == null && state.klines.loading) {
            LoadingBox("Loading candles…")
        } else {
            CandleChart(candles = klines?.klines ?: emptyList(), height = 280)
        }
        if (klines != null) {
            Text(
                "Last candle closed ${Fmt.dateTime(klines.lastCandleClose)} · data ${Fmt.age(klines.ageSeconds)} old",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Order book", trailing = state.depth.data?.let { "spread ${Fmt.percent(it.spreadBps?.let { b -> b / 100.0 })}" }) {
            val depth = state.depth.data
            if (depth == null) {
                LoadingBox("Loading depth…")
            } else {
                DepthBars(bids = depth.bids, asks = depth.asks)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
                    KeyValueChip("Bid", Fmt.price(depth.bestBid), RsColors.Emerald)
                    KeyValueChip("Ask", Fmt.price(depth.bestAsk), RsColors.Danger)
                    KeyValueChip(
                        "Imbalance",
                        depth.imbalance?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—",
                    )
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Recent trades", trailing = state.trades.data?.firstOrNull()?.source) {
            val trades: List<TradeTickDto> = state.trades.data ?: emptyList()
            if (trades.isEmpty()) {
                LoadingBox("Loading trades…")
            } else {
                trades.take(12).forEach { trade ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                        Text(
                            Fmt.price(trade.price),
                            style = MonoStyle,
                            color = if (trade.buyerIsMaker) RsColors.Danger else RsColors.Emerald,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(Fmt.amount(trade.quantity), style = MonoSmallStyle, color = RsColors.TextSecondary)
                        Spacer(Modifier.width(10.dp))
                        Text(Fmt.time(trade.time), style = MonoSmallStyle, color = RsColors.TextMuted)
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        val signal = state.signal.data
        SectionCard(
            title = "AI analysis",
            accent = when (signal?.action) {
                "BUY" -> RsColors.Emerald
                "SELL" -> RsColors.Danger
                else -> RsColors.Border
            },
        ) {
            if (signal == null) {
                LoadingBox("Analysing…")
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        signal.action,
                        style = MaterialTheme.typography.headlineSmall,
                        color = when (signal.action) {
                            "BUY" -> RsColors.Emerald
                            "SELL" -> RsColors.Danger
                            else -> RsColors.TextSecondary
                        },
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "evidence: ${signal.evidenceGrade}",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.TextMuted,
                    )
                }
                Spacer(Modifier.height(6.dp))
                signal.reasons.take(4).forEach {
                    Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    KeyValueChip("Entry", "${Fmt.price(signal.entryLow)}–${Fmt.price(signal.entryHigh)}")
                    KeyValueChip("SL", Fmt.price(signal.stopLoss), RsColors.Danger)
                    KeyValueChip("TP", Fmt.price(signal.takeProfit), RsColors.Emerald)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "Generated ${Fmt.dateTime(signal.generatedAt)} · bars used ${signal.barsUsed ?: 0} · " +
                        "data age ${Fmt.age(signal.dataAgeSeconds)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Stop-loss and take-profit levels are not guaranteed to execute at those prices.",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(RsColors.Emerald.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
                .clickable { onTrade(state.symbol) }
                .padding(vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Text("Trade ${Fmt.pair(state.symbol)}", color = RsColors.Emerald, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(24.dp))
    }
}
