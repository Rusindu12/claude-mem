package com.rsaitrader.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.SessionDto
import com.rsaitrader.ui.components.DangerButton
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
import com.rsaitrader.ui.viewmodel.AuthViewModel
import com.rsaitrader.ui.viewmodel.SecurityViewModel


@Composable
fun SecurityScreen(
    viewModel: SecurityViewModel,
    authViewModel: AuthViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val authForm by authViewModel.form.collectAsStateWithLifecycle()

    var currentPassword by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    var newPassword by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    var confirmPassword by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }

    if (state.showDelete) {
        AlertDialog(
            onDismissRequest = viewModel::hideDeleteDialog,
            containerColor = RsColors.Navy,
            title = { Text("Delete account?", color = RsColors.Danger) },
            text = {
                Column {
                    Text(
                        "This permanently deletes your account, paper trading history, alerts and stored API keys. " +
                            "It cannot be undone.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    RsPasswordField(
                        value = state.deletePassword,
                        onValueChange = viewModel::setDeletePassword,
                        label = "Password",
                    )
                    Spacer(Modifier.height(8.dp))
                    RsTextField(
                        value = state.deleteConfirmText,
                        onValueChange = viewModel::setDeleteConfirmText,
                        label = "Type DELETE to confirm",
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        authViewModel.deleteAccount(state.deletePassword, state.deleteConfirmText) {
                            viewModel.hideDeleteDialog()
                        }
                    },
                    enabled = state.deleteConfirmText == "DELETE" && state.deletePassword.isNotBlank(),
                ) { Text("Delete forever", color = RsColors.Danger) }
            },
            dismissButton = { TextButton(onClick = viewModel::hideDeleteDialog) { Text("Cancel") } },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Security", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Sessions, password and account",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }
        authForm.error?.let { ErrorBanner(message = it, onDismiss = authViewModel::clearMessages) }
        authForm.info?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        state.profile.data?.let { profile ->
            SectionCard(title = "Account") {
                Text(profile.email, style = MaterialTheme.typography.titleMedium, color = RsColors.TextPrimary)
                Text(
                    "${profile.displayName} · role ${profile.role} · ${profile.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextSecondary,
                )
                Text(
                    "Member since ${Fmt.dateTime(profile.createdAt)} · last login ${Fmt.dateTime(profile.lastLoginAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Active sessions", trailing = state.sessions.data?.size?.toString()) {
            when {
                state.sessions.loading && state.sessions.data == null -> LoadingBox("Loading sessions…")
                state.sessions.data.isNullOrEmpty() -> EmptyState(title = "No active sessions")
                else -> state.sessions.data?.forEachIndexed { index, session ->
                    SessionRow(
                        session = session,
                        revoking = state.revokingId == session.id,
                        onRevoke = { viewModel.revoke(session.id) },
                    )
                    if (index != (state.sessions.data?.lastIndex ?: 0)) Divider2(Modifier.padding(vertical = 6.dp))
                }
            }
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = "Sign out everywhere",
                onClick = viewModel::logoutEverywhere,
                modifier = Modifier.fillMaxWidth(),
                container = RsColors.SurfaceHigh,
                contentColor = RsColors.TextPrimary,
            )
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Change password") {
            RsPasswordField(
                value = currentPassword,
                onValueChange = { currentPassword = it },
                label = "Current password",
                error = authForm.fieldErrors["current"],
            )
            Spacer(Modifier.height(8.dp))
            RsPasswordField(
                value = newPassword,
                onValueChange = { newPassword = it },
                label = "New password",
                error = authForm.fieldErrors["new"],
            )
            Spacer(Modifier.height(8.dp))
            RsPasswordField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = "Confirm new password",
                error = authForm.fieldErrors["confirm"],
                imeAction = ImeAction.Done,
            )
            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = "Change password",
                onClick = { authViewModel.changePassword(currentPassword, newPassword, confirmPassword) },
                modifier = Modifier.fillMaxWidth(),
                loading = authForm.busy,
            )
            Text(
                "Changing your password revokes every session and signs you out.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        Spacer(Modifier.height(12.dp))
        SectionCard(title = "Danger zone", accent = RsColors.Danger) {
            Text(
                "Deleting the account removes all data tied to it. Audit records required for security are retained " +
                    "in anonymised form.",
                style = MaterialTheme.typography.bodySmall,
                color = RsColors.TextSecondary,
            )
            Spacer(Modifier.height(10.dp))
            DangerButton(
                text = "Delete account",
                onClick = viewModel::showDeleteDialog,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun SessionRow(session: SessionDto, revoking: Boolean, onRevoke: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    session.device,
                    style = MaterialTheme.typography.titleMedium,
                    color = RsColors.TextPrimary,
                )
                if (session.current) {
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    StatusPill("THIS DEVICE", RsColors.Emerald)
                }
            }
            Text(
                "${session.ipAddress ?: "unknown IP"} · created ${Fmt.dateTime(session.createdAt)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
            Text(
                "expires ${Fmt.dateTime(session.expiresAt)}",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
        if (!session.current) {
            TextButton(onClick = onRevoke, enabled = !revoking) {
                Text(if (revoking) "…" else "Revoke", color = RsColors.Danger)
            }
        }
    }
}
