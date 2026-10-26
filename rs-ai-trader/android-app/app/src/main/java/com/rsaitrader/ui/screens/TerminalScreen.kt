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
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
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
import com.rsaitrader.core.network.OrderPreviewDto
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.KeyValueChip
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.ModeToggle
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.SymbolChips
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.TerminalViewModel

@Composable
fun TerminalScreen(viewModel: TerminalViewModel, symbols: List<String>, onOpenOrders: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val live by viewModel.liveTickers.collectAsStateWithLifecycle()
    val ticker = live[state.symbol] ?: state.ticker

    var acknowledgeRisk by remember { mutableStateOf(false) }

    if (state.confirming) {
        PlaceConfirmationDialog(
            state = state,
            acknowledgeRisk = acknowledgeRisk,
            onAcknowledge = { acknowledgeRisk = it },
            onConfirm = {
                viewModel.confirmAndPlace()
                acknowledgeRisk = false
            },
            onDismiss = {
                viewModel.cancelConfirmation()
                acknowledgeRisk = false
            },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Spot terminal", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Binance Spot · no leverage · no futures",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            Text(
                Fmt.price(ticker?.price),
                style = MaterialTheme.typography.titleLarge,
                color = RsColors.TextPrimary,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(Modifier.height(10.dp))
        ModeToggle(
            mode = state.mode,
            onSelect = viewModel::setMode,
            liveAllowed = state.risk.data?.server?.liveTradingEnabled ?: false,
        )
        if (state.isLive) {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                shape = RoundedCornerShape(12.dp),
                color = RsColors.Danger.copy(alpha = 0.12f),
                border = BorderStroke(1.dp, RsColors.Danger.copy(alpha = 0.5f)),
            ) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = RsColors.Danger, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(
                        "LIVE SPOT: real funds. Every order needs manual approval and must pass server-side risk checks.",
                        style = MaterialTheme.typography.bodySmall,
                        color = androidx.compose.ui.graphics.Color(0xFFFCA5A5),
                    )
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SymbolChips(
            symbols = (symbols + state.symbol).distinct().take(10),
            selected = state.symbol,
            onSelect = viewModel::setSymbol,
        )

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Order") {
            SegmentedRow(
                options = listOf("BUY", "SELL"),
                selected = state.side,
                onSelect = viewModel::setSide,
            )
            Spacer(Modifier.height(8.dp))
            SegmentedRow(
                options = listOf("MARKET", "LIMIT"),
                selected = state.orderType,
                onSelect = viewModel::setOrderType,
            )
            Spacer(Modifier.height(12.dp))
            RsTextField(
                value = state.price,
                onValueChange = viewModel::setPrice,
                label = if (state.needsPrice) "Limit price (USDT)" else "Price (market)",
                placeholder = ticker?.price?.let { Fmt.price(it) } ?: "—",
                keyboardType = KeyboardType.Decimal,
                enabled = state.needsPrice,
                suffix = "USDT",
            )
            Spacer(Modifier.height(10.dp))
            RsTextField(
                value = state.quantity,
                onValueChange = viewModel::setQuantity,
                label = "Quantity (${Fmt.base(state.symbol)})",
                placeholder = "0.00",
                keyboardType = KeyboardType.Decimal,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                listOf(25, 50, 75, 100).forEach { pct ->
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { viewModel.percentOfBalance(pct.toDouble()) },
                        shape = RoundedCornerShape(9.dp),
                        color = RsColors.SurfaceHigh,
                        border = BorderStroke(1.dp, RsColors.Border),
                    ) {
                        Box(Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            Text("$pct%", style = MaterialTheme.typography.labelSmall, color = RsColors.TextSecondary)
                        }
                    }
                }
            }
            state.portfolio.data?.availableUsdt?.let {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Available: ${Fmt.usdt(it)} USDT (${if (state.isLive) "exchange wallet" else "simulated"})",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RsTextField(
                    value = state.stopLoss,
                    onValueChange = viewModel::setStopLoss,
                    label = "Stop loss",
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
                RsTextField(
                    value = state.takeProfit,
                    onValueChange = viewModel::setTakeProfit,
                    label = "Take profit",
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(10.dp))
            state.risk.data?.let { risk ->
                if (risk.policy.stopLossRequired) {
                    Text(
                        "Your risk settings require a stop-loss on every order.",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Warning,
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = if (state.preview.loading) "Checking…" else "Preview order",
                onClick = viewModel::preview,
                modifier = Modifier.fillMaxWidth(),
                enabled = state.canPreview,
                loading = state.preview.loading,
            )
        }

        state.error?.let {
            Spacer(Modifier.height(8.dp))
            ErrorBanner(message = it, code = null, onDismiss = viewModel::clearMessages)
        }
        state.message?.let {
            Spacer(Modifier.height(8.dp))
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                color = RsColors.Emerald.copy(alpha = 0.12f),
                border = BorderStroke(1.dp, RsColors.Emerald.copy(alpha = 0.4f)),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onOpenOrders) { Text("View orders", color = RsColors.Emerald) }
                }
            }
        }

        state.preview.data?.let { preview ->
            Spacer(Modifier.height(10.dp))
            PreviewCard(
                preview = preview,
                onPlace = viewModel::requestConfirmation,
                placing = state.placing,
            )
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "How this order is checked") {
            val checks = listOf(
                "Symbol filters from exchangeInfo: tick size, step size, min notional, permissions.",
                "Server-side risk engine: max trade size, exposure, daily loss, open orders, cooldown.",
                "Duplicate-order guard and idempotency key prevent double submission.",
                "Live status is confirmed with Binance before the order is reported as filled.",
                "A failed check rejects the order — no partial bypass.",
            )
            checks.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "Stop-loss and take-profit are normal orders: they can slip or fail to fill in fast markets.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.Warning,
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PreviewCard(preview: OrderPreviewDto, onPlace: () -> Unit, placing: Boolean) {
    SectionCard(
        title = "Preview",
        accent = if (preview.canPlace) RsColors.Emerald else RsColors.Danger,
        trailing = preview.mode.uppercase(),
    ) {
        StatRow("Side / type", "${preview.side} ${preview.orderType}")
        StatRow("Quantity", "${Fmt.amount(preview.quantity)} ${Fmt.base(preview.symbol)}")
        StatRow("Reference price", Fmt.price(preview.referencePrice))
        StatRow("Estimated notional", Fmt.usdt(preview.estimatedNotional))
        StatRow("Estimated fee", Fmt.usdt(preview.estimatedFeeUsdt))
        StatRow("Estimated slippage", Fmt.percent(preview.estimatedSlippageBps / 100.0, 3))
        if (preview.market.stale || preview.market.synthetic) {
            Text(
                "Preview uses ${if (preview.market.synthetic) "simulated" else "stale"} prices.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.Warning,
            )
        }
        if (preview.adjustments.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text("Normalised by the server", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
            preview.adjustments.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextSecondary)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("RISK CHECKS", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
        preview.risk.checks.forEach { check ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(
                    if (check.passed) "PASS" else "BLOCK",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (check.passed) RsColors.Emerald else RsColors.Danger,
                )
                Spacer(Modifier.size(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(check.name.replace('_', ' '), style = MaterialTheme.typography.bodySmall, color = RsColors.TextPrimary)
                    if (check.detail.isNotBlank()) {
                        Text(check.detail, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                    }
                }
            }
        }
        preview.risk.violations.forEach {
            Text("✕ ${it.message}", style = MaterialTheme.typography.bodySmall, color = RsColors.Danger)
        }
        preview.risk.warnings.forEach {
            Text("! $it", style = MaterialTheme.typography.bodySmall, color = RsColors.Warning)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            KeyValueChip("Can place", if (preview.canPlace) "YES" else "NO", if (preview.canPlace) RsColors.Emerald else RsColors.Danger)
            if (preview.risk.checks.isEmpty()) KeyValueChip("Checks", "none returned")
        }
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            text = if (placing) "Placing…" else if (preview.mode == "live") "Review & place LIVE order" else "Review & place paper order",
            onClick = onPlace,
            modifier = Modifier.fillMaxWidth(),
            enabled = preview.canPlace,
            loading = placing,
            container = if (preview.mode == "live") RsColors.Danger else RsColors.Emerald,
            contentColor = if (preview.mode == "live") androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color(0xFF04180F),
        )
    }
}

@Composable
private fun PlaceConfirmationDialog(
    state: com.rsaitrader.ui.viewmodel.TerminalState,
    acknowledgeRisk: Boolean,
    onAcknowledge: (Boolean) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val preview = state.preview.data
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = RsColors.Navy,
        title = {
            Text(
                if (state.isLive) "Confirm LIVE spot order" else "Confirm paper order",
                color = if (state.isLive) RsColors.Danger else RsColors.Emerald,
            )
        },
        text = {
            Column {
                Text(
                    "${state.side} ${Fmt.amount(preview?.quantity ?: state.quantity)} ${Fmt.base(state.symbol)} " +
                        "at ${if (state.orderType == "MARKET") "market price" else state.price + " USDT"}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = RsColors.TextPrimary,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Notional ≈ ${Fmt.usdt(preview?.estimatedNotional)} · fee ≈ ${Fmt.usdt(preview?.estimatedFeeUsdt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextSecondary,
                )
                Spacer(Modifier.height(8.dp))
                if (state.isLive) {
                    Text(
                        "This order will be sent to Binance and can execute with real money. The app only reports " +
                            "the order as filled after Binance confirms it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.Warning,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = acknowledgeRisk, onCheckedChange = { checked -> onAcknowledge(checked) })
                        Text(
                            "I understand this order uses real funds.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextPrimary,
                        )
                    }
                } else {
                    Text(
                        "Simulated order: nothing is sent to Binance.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.Info,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = !state.isLive || acknowledgeRisk,
            ) {
                Text(
                    if (state.isLive) "PLACE LIVE ORDER" else "Place paper order",
                    color = if (state.isLive) RsColors.Danger else RsColors.Emerald,
                    fontWeight = FontWeight.Bold,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = RsColors.TextSecondary) }
        },
    )
}
