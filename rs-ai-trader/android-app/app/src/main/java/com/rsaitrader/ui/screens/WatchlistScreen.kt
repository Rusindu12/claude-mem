package com.rsaitrader.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.ui.components.ConnectionPill
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.ScreenScaffold
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StaleDataBanner
import com.rsaitrader.ui.theme.MonoSmallStyle
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.WatchlistViewModel

@Composable
fun WatchlistScreen(viewModel: WatchlistViewModel, onOpenChart: (String) -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val stream by viewModel.streamStatus.collectAsStateWithLifecycle()
    val live by viewModel.liveTickers.collectAsStateWithLifecycle()

    val merged = if (live.isEmpty()) state.tickers else live

    ScreenScaffold(
        title = "Markets",
        subtitle = "Binance Spot · ${state.pairs.data?.symbols?.count { it.enabled } ?: 0} pairs enabled",
        actions = {
            ConnectionPill(connected = stream.connected, degraded = stream.degraded)
            IconButton(onClick = viewModel::refreshAll) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh markets", tint = RsColors.TextSecondary)
            }
        },
    ) {
        RsTextField(
            value = state.search,
            onValueChange = viewModel::setSearch,
            label = "Search symbol",
            placeholder = "BTC, ETH, SOL…",
        )
        Spacer(Modifier.height(10.dp))
        SegmentedRow(
            options = listOf("favorite", "change", "volume", "az"),
            selected = state.sortBy,
            onSelect = viewModel::setSort,
            labels = {
                when (it) {
                    "change" -> "24h %"
                    "volume" -> "Volume"
                    "az" -> "A–Z"
                    else -> "Watchlist"
                }
            },
        )
        Spacer(Modifier.height(10.dp))

        StaleDataBanner(
            stale = state.pairs.data?.let { !it.synthetic && stream.stale } ?: false,
            source = state.pairs.data?.source,
            synthetic = state.pairs.data?.synthetic ?: false,
            ageSeconds = stream.ageSeconds(),
        )

        state.pairs.error?.let {
            ErrorBanner(message = it, code = state.pairs.errorCode, onRetry = viewModel::load)
        }

        val rows = state.visible.mapNotNull { t -> merged[t.symbol] ?: t }.distinctBy { it.symbol }

        when {
            state.pairs.loading && rows.isEmpty() -> LoadingBox("Loading markets…")
            rows.isEmpty() -> EmptyState(
                title = "No markets match",
                body = "Clear the search or turn off the watchlist filter.",
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(rows, key = { it.symbol }) { ticker ->
                    WatchRow(
                        ticker = ticker,
                        favorite = state.favorites.contains(ticker.symbol),
                        onToggleFavorite = { viewModel.toggleFavorite(ticker.symbol) },
                        onClick = { onOpenChart(ticker.symbol) },
                    )
                    Divider2()
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun WatchRow(
    ticker: TickerDto,
    favorite: Boolean,
    onToggleFavorite: () -> Unit,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onToggleFavorite, modifier = Modifier.size(34.dp)) {
            Icon(
                if (favorite) Icons.Filled.Star else Icons.Outlined.StarOutline,
                contentDescription = if (favorite) "Remove from watchlist" else "Add to watchlist",
                tint = if (favorite) RsColors.Warning else RsColors.TextMuted,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 4.dp),
        ) {
            Text(Fmt.pair(ticker.symbol), style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
            Row {
                Text(
                    "H ${Fmt.price(ticker.high24h)}  L ${Fmt.price(ticker.low24h)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
                if (ticker.stale) {
                    Text("  · STALE", style = MaterialTheme.typography.labelSmall, color = RsColors.Warning)
                }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Fmt.price(ticker.price), style = MonoStyle, color = RsColors.TextPrimary)
            Text(
                Fmt.signedPercent(ticker.changePercent24h),
                style = MonoSmallStyle,
                color = pnlColor(ticker.changePercent24h.toString()),
            )
            Text(
                "Vol ${Fmt.compactVolume(ticker.quoteVolume24h)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
        Spacer(Modifier.size(6.dp))
        Text(
            "›",
            style = MaterialTheme.typography.titleLarge,
            color = RsColors.TextMuted,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}
