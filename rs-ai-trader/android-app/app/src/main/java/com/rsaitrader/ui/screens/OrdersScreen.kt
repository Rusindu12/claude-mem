package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.OrderDto
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.ModeToggle
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.OrdersViewModel

private val OPEN_STATUSES = setOf("NEW", "PARTIALLY_FILLED", "PENDING", "UNKNOWN")

@Composable
fun OrdersScreen(viewModel: OrdersViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Orders", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Open orders, fills and history",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            IconButton(onClick = viewModel::load) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh orders", tint = RsColors.TextSecondary)
            }
            IconButton(onClick = viewModel::reconcile) {
                Icon(Icons.Filled.Sync, contentDescription = "Reconcile with exchange", tint = RsColors.TextSecondary)
            }
        }

        ModeToggle(mode = state.mode, onSelect = viewModel::setMode)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
            Text("Open orders only", style = MaterialTheme.typography.bodyMedium, color = RsColors.TextSecondary)
            Spacer(Modifier.weight(1f))
            Switch(
                checked = state.openOnly,
                onCheckedChange = { viewModel.toggleOpenOnly() },
            )
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                color = RsColors.Emerald.copy(alpha = 0.12f),
                border = BorderStroke(1.dp, RsColors.Emerald.copy(alpha = 0.4f)),
            ) {
                Text(
                    it,
                    color = RsColors.EmeraldGlow,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }

        when {
            state.orders.loading && state.orders.data == null -> LoadingBox("Loading orders…")
            state.orders.data.isNullOrEmpty() -> EmptyState(
                title = "No orders yet",
                body = if (state.mode == "paper") "Paper orders appear here once placed." else "Live orders appear here after Binance confirms them.",
            )
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(state.orders.data ?: emptyList(), key = { it.id }) { order ->
                    OrderRow(
                        order = order,
                        expanded = expanded == order.id,
                        cancelling = state.cancellingId == order.id,
                        onToggle = { expanded = if (expanded == order.id) null else order.id },
                        onCancel = { viewModel.cancel(order) },
                    )
                    Divider2()
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun OrderRow(
    order: OrderDto,
    expanded: Boolean,
    cancelling: Boolean,
    onToggle: () -> Unit,
    onCancel: () -> Unit,
) {
    val statusColor = when (order.status.uppercase()) {
        "FILLED" -> RsColors.Emerald
        "PARTIALLY_FILLED" -> RsColors.Info
        "NEW", "PENDING" -> RsColors.Warning
        "CANCELED", "EXPIRED" -> RsColors.TextMuted
        "REJECTED" -> RsColors.Danger
        "UNKNOWN" -> RsColors.Violet
        else -> RsColors.TextMuted
    }
    val isOpen = order.status.uppercase() in OPEN_STATUSES

    Column(modifier = Modifier.fillMaxWidth().clickable { onToggle() }.padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                order.side,
                style = MaterialTheme.typography.labelLarge,
                color = if (order.side.equals("BUY", true)) RsColors.Emerald else RsColors.Danger,
            )
            Spacer(Modifier.size(8.dp))
            Column(Modifier.weight(1f)) {
                Text(Fmt.pair(order.symbol), style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                Text(
                    "${Fmt.amount(order.quantity)} @ ${order.price?.let { Fmt.price(it) } ?: "market"} · ${order.orderType}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                StatusPill(order.status.uppercase(), statusColor)
                Text(
                    Fmt.dateTime(order.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            SectionCard {
                StatRow("Order id", order.id, mono = false)
                StatRow("Status", order.status)
                StatRow("Filled", "${Fmt.amount(order.filledQuantity)} @ ${Fmt.price(order.averageFillPrice)}")
                StatRow("Fee paid", Fmt.usdt(order.feePaid))
                StatRow("Mode", Fmt.modeLabel(order.mode) + if (order.simulated) " (simulated)" else "")
                StatRow("Environment", order.environment)
                StatRow("Manual approval", if (order.approved) "Yes" else "No")
                StatRow("Stop loss", order.stopLoss?.let { Fmt.price(it) } ?: "—")
                StatRow("Take profit", order.takeProfit?.let { Fmt.price(it) } ?: "—")
                if (order.idempotentReplay) {
                    Text(
                        "This response was an idempotent replay of an earlier request — no second order was sent.",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Info,
                    )
                }
                if (isOpen) {
                    Spacer(Modifier.height(6.dp))
                    TextButton(onClick = onCancel, enabled = !cancelling) {
                        Text(
                            if (cancelling) "Cancelling…" else "Cancel order",
                            color = RsColors.Danger,
                        )
                    }
                }
                if (order.status.equals("UNKNOWN", true)) {
                    Text(
                        "Exchange state unknown. Reconciliation will retry the status query before more orders are allowed.",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Violet,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        Row {
            Text(
                if (expanded) "Hide details" else "Show details",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.Emerald,
            )
            Spacer(Modifier.weight(1f))
            Text(
                "${Fmt.usdt(order.averageFillPrice?.toBigDecimalOrNull()?.multiply(order.filledQuantity.toBigDecimalOrNull() ?: java.math.BigDecimal.ZERO)?.toPlainString())} filled",
                style = MonoStyle,
                color = RsColors.TextMuted,
            )
        }
    }
}
