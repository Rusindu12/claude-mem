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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.AlertDto
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.components.SymbolChips
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.ALERT_CONDITIONS
import com.rsaitrader.ui.viewmodel.AlertsViewModel
import com.rsaitrader.ui.viewmodel.alertConditionLabel

@Composable
fun AlertsScreen(viewModel: AlertsViewModel, symbols: List<String>, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val needsTarget = state.condition.startsWith("price_") || state.condition.startsWith("rsi_")

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Price alerts", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Notifications never contain API keys or secrets",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            IconButton(onClick = viewModel::evaluateNow) {
                Icon(Icons.Filled.NotificationsActive, contentDescription = "Evaluate now", tint = RsColors.TextSecondary)
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        SectionCard(title = "New alert") {
            SymbolChips(
                symbols = (symbols + state.symbol).distinct().take(10),
                selected = state.symbol,
                onSelect = viewModel::setSymbol,
            )
            Spacer(Modifier.height(10.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(ALERT_CONDITIONS.size) { index ->
                    val condition = ALERT_CONDITIONS[index]
                    val selected = condition == state.condition
                    androidx.compose.material3.Surface(
                        modifier = Modifier
                            .clickable { viewModel.setCondition(condition) },
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(9.dp),
                        color = if (selected) RsColors.Emerald.copy(alpha = 0.16f) else RsColors.Navy,
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            if (selected) RsColors.Emerald else RsColors.Border,
                        ),
                    ) {
                        Text(
                            alertConditionLabel(condition),
                            style = MaterialTheme.typography.labelLarge,
                            color = if (selected) RsColors.Emerald else RsColors.TextSecondary,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            if (needsTarget) {
                RsTextField(
                    value = state.targetPrice,
                    onValueChange = viewModel::setTarget,
                    label = if (state.condition.startsWith("rsi")) "RSI threshold" else "Target price (USDT)",
                    keyboardType = KeyboardType.Decimal,
                )
                Spacer(Modifier.height(8.dp))
            }
            RsTextField(
                value = state.note,
                onValueChange = viewModel::setNote,
                label = "Note (optional)",
                placeholder = "Why this level matters",
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = if (state.saving) "Creating…" else "Create alert",
                onClick = viewModel::create,
                modifier = Modifier.fillMaxWidth(),
                loading = state.saving,
            )
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Active alerts", trailing = state.alerts.data?.size?.toString()) {
            when {
                state.alerts.loading && state.alerts.data == null -> LoadingBox("Loading alerts…")
                state.alerts.data.isNullOrEmpty() -> EmptyState(
                    title = "No alerts yet",
                    body = "Alerts trigger on price levels, RSI thresholds and AI BUY/SELL signals.",
                )
                else -> {
                    state.alerts.data?.forEachIndexed { index, alert ->
                        AlertRow(alert, onDelete = { viewModel.delete(alert.id) })
                        if (index != (state.alerts.data?.lastIndex ?: 0)) Divider2(Modifier.padding(vertical = 6.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun AlertRow(alert: AlertDto, onDelete: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    Fmt.pair(alert.symbol),
                    style = MaterialTheme.typography.titleMedium,
                    color = RsColors.TextPrimary,
                )
                Spacer(Modifier.width(6.dp))
                StatusPill(
                    alert.status.uppercase(),
                    when (alert.status) {
                        "active" -> RsColors.Emerald
                        "triggered" -> RsColors.Info
                        else -> RsColors.TextMuted
                    },
                )
            }
            Text(
                alertConditionLabel(alert.condition) + (alert.targetPrice?.let { " @ ${Fmt.price(it)}" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = RsColors.TextSecondary,
            )
            alert.note?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
            }
            Text(
                "created ${Fmt.dateTime(alert.createdAt)}" +
                    (alert.triggeredAt?.let { " · triggered ${Fmt.dateTime(it)}" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Filled.Delete, contentDescription = "Delete alert", tint = RsColors.Danger)
        }
    }
}
