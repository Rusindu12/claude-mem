package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AssistantViewModel
import com.rsaitrader.ui.viewmodel.ChatMessage

@Composable
fun AssistantScreen(viewModel: AssistantViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().imePadding().padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("AI assistant", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Explains indicators, signals and risk — using real data only",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            IconButton(onClick = viewModel::clear) {
                Icon(Icons.Filled.DeleteSweep, contentDescription = "Clear conversation", tint = RsColors.TextSecondary)
            }
        }

        SegmentedRow(
            options = listOf("en", "si"),
            selected = state.lang,
            onSelect = viewModel::setLanguage,
            labels = { if (it == "en") "English" else "සිංහල" },
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Context: ${state.symbol ?: "no symbol"} ${state.timeframe ?: ""}".trim(),
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
        )

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::dismissError) }

        if (state.messages.isEmpty()) {
            Column(Modifier.weight(1f)) {
                Spacer(Modifier.height(24.dp))
                Text(
                    "Ask about indicators, market conditions, your signals, portfolio maths or how the app works.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = RsColors.TextSecondary,
                )
                Spacer(Modifier.height(14.dp))
                viewModel.suggestions().forEach { suggestion ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clickable { viewModel.ask(suggestion) },
                        shape = RoundedCornerShape(12.dp),
                        color = RsColors.Navy,
                        border = BorderStroke(1.dp, RsColors.Border),
                    ) {
                        Text(
                            suggestion,
                            style = MaterialTheme.typography.bodyMedium,
                            color = RsColors.TextSecondary,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    "The assistant cannot place, cancel or modify orders and cannot bypass risk limits, permissions " +
                        "or confirmations. It will not invent balances or order statuses.",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.messages, key = { it.id }) { message -> MessageBubble(message) }
                item { Spacer(Modifier.height(6.dp)) }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            RsTextField(
                value = state.input,
                onValueChange = viewModel::setInput,
                label = if (state.lang == "si") "ඔබේ ප්‍රශ්නය" else "Your question",
                placeholder = if (state.lang == "si") "උදා: RSI කියන්නේ මොකක්ද?" else "e.g. Summarise BTCUSDT 1h",
                modifier = Modifier.weight(1f),
                imeAction = ImeAction.Send,
                singleLine = false,
            )
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = { viewModel.ask() },
                enabled = !state.asking && state.input.isNotBlank(),
                modifier = Modifier
                    .size(48.dp)
                    .background(RsColors.Emerald.copy(alpha = if (state.asking) 0.3f else 1f), RoundedCornerShape(12.dp)),
            ) {
                if (state.asking) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = RsColors.Black,
                    )
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = RsColors.Black,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.92f),
            shape = RoundedCornerShape(14.dp),
            color = RsColors.SurfaceHigh,
            border = BorderStroke(1.dp, RsColors.Border),
        ) {
            Text(
                message.question,
                style = MaterialTheme.typography.bodyMedium,
                color = RsColors.TextPrimary,
                modifier = Modifier.padding(12.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = RsColors.Navy,
            border = BorderStroke(1.dp, if (message.refused) RsColors.Warning.copy(alpha = 0.5f) else RsColors.Border),
        ) {
            Column(Modifier.padding(12.dp)) {
                if (message.pending) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                            color = RsColors.Emerald,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Thinking…", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
                    }
                } else {
                    Text(
                        message.answer,
                        style = MaterialTheme.typography.bodyMedium,
                        color = RsColors.TextPrimary,
                    )
                    if (message.limitations.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        message.limitations.forEach {
                            Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.Warning)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "data as of ${Fmt.dateTime(message.dataAsOf)} · ${if (message.lang == "si") "සිංහල" else "English"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.TextMuted,
                    )
                }
            }
        }
    }
}
