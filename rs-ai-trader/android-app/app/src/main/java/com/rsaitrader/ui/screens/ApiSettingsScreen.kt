package com.rsaitrader.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.CredentialDto
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.EmptyState
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsPasswordField
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.ApiSettingsViewModel
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

@Composable
fun ApiSettingsScreen(viewModel: ApiSettingsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val list = state.credentials.data

    state.confirmRevoke?.let { credential ->
        AlertDialog(
            onDismissRequest = viewModel::cancelRevoke,
            containerColor = RsColors.Navy,
            title = { Text("Revoke this API key?") },
            text = {
                Text(
                    "The key and its secret are deleted from the backend immediately. Open live orders are not " +
                        "cancelled automatically — cancel them on Binance if needed.",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.revoke(credential.id) }) {
                    Text("Revoke key", color = RsColors.Danger)
                }
            },
            dismissButton = { TextButton(onClick = viewModel::cancelRevoke) { Text("Cancel") } },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("API connection", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Keys are stored encrypted on the server only",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            Icon(Icons.Filled.Lock, contentDescription = null, tint = RsColors.Emerald)
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = if (list?.environment == "live") RsColors.Danger.copy(alpha = 0.12f) else RsColors.Info.copy(alpha = 0.10f),
            border = BorderStroke(
                1.dp,
                if (list?.environment == "live") RsColors.Danger.copy(alpha = 0.5f) else RsColors.Info.copy(alpha = 0.4f),
            ),
        ) {
            Column(Modifier.padding(12.dp)) {
                Text(
                    "Server exchange environment: ${list?.environment?.uppercase() ?: "unknown"}",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (list?.environment == "live") RsColors.Danger else RsColors.Info,
                )
                Text(
                    "The app never contacts Binance directly and never stores the secret. Adding a key here does NOT " +
                        "enable live trading — that requires a separate opt-in under Risk settings.",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextSecondary,
                )
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Add a key") {
            RsTextField(
                value = state.apiKey,
                onValueChange = viewModel::setApiKey,
                label = "API key",
                placeholder = "Paste the key from Binance API Management",
            )
            Spacer(Modifier.height(8.dp))
            RsPasswordField(
                value = state.apiSecret,
                onValueChange = viewModel::setApiSecret,
                label = "API secret",
            )
            Spacer(Modifier.height(8.dp))
            RsTextField(
                value = state.label,
                onValueChange = viewModel::setLabel,
                label = "Label",
                placeholder = "My read-trade key",
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = if (state.saving) "Saving…" else "Store key on server",
                onClick = viewModel::save,
                modifier = Modifier.fillMaxWidth(),
                enabled = state.canSubmit,
                loading = state.saving,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Create the key with spot trading enabled and withdrawals DISABLED, restricted to your server IP. " +
                    "This app never requests withdrawal permission.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.Warning,
            )
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Stored credentials", trailing = list?.credentials?.size?.toString()) {
            when {
                state.credentials.loading && list == null -> LoadingBox("Loading keys…")
                list == null || list.credentials.isEmpty() -> EmptyState(
                    title = "No API key stored",
                    body = "Paper trading works without any key. A key is only needed for live balances and live orders.",
                )
                else -> list.credentials.forEachIndexed { index, credential ->
                    CredentialRow(
                        credential = credential,
                        verifying = state.verifyingId == credential.id,
                        onVerify = { viewModel.verify(credential.id) },
                        onRevoke = { viewModel.requestRevoke(credential) },
                    )
                    if (index != list.credentials.lastIndex) Divider2(Modifier.padding(vertical = 8.dp))
                }
            }
        }

        list?.guidance?.let { guidance ->
            if (guidance.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Exchange setup guidance") {
                    guidance.entries.forEach { (key, value) ->
                        val text = (value as? JsonPrimitive)?.contentOrNull ?: value.toString()
                        Text(
                            "• ${key.replace('_', ' ')}: $text",
                            style = MaterialTheme.typography.bodySmall,
                            color = RsColors.TextSecondary,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun CredentialRow(
    credential: CredentialDto,
    verifying: Boolean,
    onVerify: () -> Unit,
    onRevoke: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(credential.label, style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                Text(
                    "${credential.maskedKey} · ${credential.environment}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            StatusPill(
                credential.status.uppercase(),
                if (credential.status == "active") RsColors.Emerald else RsColors.Warning,
            )
        }
        Text(
            "Last verified ${Fmt.dateTime(credential.lastVerifiedAt)}" +
                (credential.lastError?.let { " · last error: $it" } ?: ""),
            style = MaterialTheme.typography.labelSmall,
            color = if (credential.lastError != null) RsColors.Warning else RsColors.TextMuted,
        )
        Text(
            "IP restricted: ${if (credential.ipRestricted) "yes" else "no — add an IP allow-list on Binance"}",
            style = MaterialTheme.typography.labelSmall,
            color = if (credential.ipRestricted) RsColors.Emerald else RsColors.Warning,
        )
        Row {
            TextButton(onClick = onVerify, enabled = !verifying) {
                Icon(Icons.Filled.Verified, contentDescription = null, tint = RsColors.Emerald, modifier = Modifier.padding(end = 4.dp))
                Text(if (verifying) "Verifying…" else "Verify", color = RsColors.Emerald)
            }
            TextButton(onClick = onRevoke) { Text("Revoke", color = RsColors.Danger) }
        }
    }
}
