package com.rsaitrader.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
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
import com.rsaitrader.core.network.SignalDto
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.KeyValueChip
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.components.SymbolChips
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.SignalsViewModel
import com.rsaitrader.ui.viewmodel.TIMEFRAMES
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

@Composable
fun SignalsScreen(
    viewModel: SignalsViewModel,
    symbols: List<String>,
    onBack: () -> Unit,
    onTrade: (String, String) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val signal = state.signal.data

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("AI signals", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Deterministic indicators + optional ML model",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = RsColors.Emerald, modifier = Modifier.size(20.dp))
        }

        SymbolChips(
            symbols = (symbols + state.symbol).distinct().take(10),
            selected = state.symbol,
            onSelect = viewModel::setSymbol,
        )
        Spacer(Modifier.height(10.dp))
        SegmentedRow(options = TIMEFRAMES, selected = state.timeframe, onSelect = viewModel::setTimeframe)
        Spacer(Modifier.height(12.dp))

        state.signal.error?.let {
            ErrorBanner(message = it, code = state.signal.errorCode, onRetry = viewModel::generate)
        }

        when {
            state.generating && signal == null -> LoadingBox("Computing indicators and analysing the trend…")
            signal == null -> EmptyState(title = "No signal available", body = "Tap generate to analyse this market.")
            else -> SignalBody(signal, onTrade = { onTrade(signal.symbol, signal.timeframe) })
        }

        Spacer(Modifier.height(10.dp))
        state.model.data?.let { model ->
            SectionCard(title = "Model information") {
                if (!model.available) {
                    Text(
                        model.note ?: "No trained model artifact is available on this server, so the model vote is withheld.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                } else {
                    StatRow("Model version", model.modelVersion ?: "—")
                    StatRow("Trained at", Fmt.dateTime(model.trainedAt))
                    model.evaluation?.forEach { (key, value) ->
                        StatRow(key.replace('_', ' '), displayValue(value))
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        PrimaryButton(
            text = if (state.generating) "Generating…" else "Generate new signal",
            onClick = viewModel::generate,
            modifier = Modifier.fillMaxWidth(),
            loading = state.generating,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "Signals are analytical output, not investment advice. A signal does not guarantee profit and stop-loss " +
                "orders are not guaranteed protection against gaps or slippage.",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SignalBody(signal: SignalDto, onTrade: () -> Unit) {
    val actionColor = when (signal.action) {
        "BUY" -> RsColors.Emerald
        "SELL" -> RsColors.Danger
        else -> RsColors.TextSecondary
    }
    SectionCard(title = "${signal.symbol} · ${signal.timeframe}", accent = actionColor) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                signal.action,
                style = MaterialTheme.typography.displaySmall,
                color = actionColor,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.size(12.dp))
            StatusPill(signal.evidenceGrade.uppercase(), actionColor)
            Spacer(Modifier.weight(1f))
            Text(Fmt.price(signal.price), style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
        }
        Text(
            "Generated ${Fmt.dateTime(signal.generatedAt)} · score ${String.format(java.util.Locale.US, "%.2f", signal.score)}",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            KeyValueChip("Entry low", Fmt.price(signal.entryLow))
            KeyValueChip("Entry high", Fmt.price(signal.entryHigh))
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            KeyValueChip("Stop loss", Fmt.price(signal.stopLoss), RsColors.Danger)
            KeyValueChip("Take profit", Fmt.price(signal.takeProfit), RsColors.Emerald)
            KeyValueChip("R:R", signal.riskReward?.let { String.format(java.util.Locale.US, "%.2f", it) } ?: "—")
        }
    }

    Spacer(Modifier.height(10.dp))
    SectionCard(title = "Why this call") {
        if (signal.reasons.isEmpty()) {
            Text("Not enough evidence for a directional call.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
        }
        signal.reasons.forEach { reason ->
            Text("• $reason", style = MaterialTheme.typography.bodyMedium, color = RsColors.TextSecondary)
        }
        if (signal.invalidation.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text("INVALIDATION", style = MaterialTheme.typography.labelSmall, color = RsColors.Warning)
            signal.invalidation.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.Warning)
            }
        }
    }

    Spacer(Modifier.height(10.dp))
    SectionCard(title = "Indicators") {
        val indicators: JsonObject = signal.indicators
        if (indicators.isEmpty()) {
            Text("No indicator values returned.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
        } else {
            indicators.entries.forEach { (key, value) ->
                StatRow(key.replace('_', ' '), displayValue(value))
            }
        }
    }

    Spacer(Modifier.height(10.dp))
    SectionCard(title = "Regime & data quality") {
        StatRow("Regime", signal.regime.label)
        StatRow("Volatility", signal.regime.volatilityState)
        StatRow("Bars used", (signal.barsUsed ?: signal.dataQuality.bars).toString())
        StatRow("Gaps", signal.dataQuality.gaps.toString())
        StatRow("Data age", Fmt.age(signal.dataAgeSeconds ?: signal.dataQuality.ageSeconds))
        StatRow("Sufficient data", if (signal.dataQuality.sufficient) "Yes" else "No")
        StatRow("Data source", (signal.dataSource ?: "—") + if (signal.synthetic) " (simulated)" else "")
        if (signal.dataQuality.issues.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            signal.dataQuality.issues.forEach {
                Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.Warning)
            }
        }
        signal.regime.reasons.take(3).forEach {
            Text("• $it", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
        }
    }

    Spacer(Modifier.height(10.dp))
    SectionCard(title = "Model vote") {
        StatRow("Model version", signal.modelVersion.ifBlank { "n/a" })
        StatRow("Model status", signal.modelStatus)
        signal.probabilityUp?.let { StatRow("P(up)", String.format(java.util.Locale.US, "%.3f", it)) }
        signal.probabilityDown?.let { StatRow("P(down)", String.format(java.util.Locale.US, "%.3f", it)) }
        Text(
            "Probabilities come from a validated model artifact. When no trusted artifact is available the vote is " +
                "withheld instead of showing invented confidence.",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            modifier = Modifier.padding(top = 6.dp),
        )
    }

    Spacer(Modifier.height(12.dp))
    PrimaryButton(
        text = "Open trading terminal with ${signal.symbol}",
        onClick = onTrade,
        modifier = Modifier.fillMaxWidth(),
    )
}

internal fun displayValue(value: kotlinx.serialization.json.JsonElement?): String = when (value) {
    null -> "—"
    is JsonPrimitive -> when {
        value.isString -> value.contentOrNull ?: "—"
        else -> {
            val raw = value.contentOrNull ?: "—"
            val number = raw.toDoubleOrNull()
            if (number == null) {
                raw
            } else if (kotlin.math.abs(number) >= 1000) {
                String.format(java.util.Locale.US, "%,.2f", number)
            } else {
                String.format(java.util.Locale.US, "%.4f", number).trimEnd('0').trimEnd('.')
            }
        }
    }
    else -> value.toString()
}
