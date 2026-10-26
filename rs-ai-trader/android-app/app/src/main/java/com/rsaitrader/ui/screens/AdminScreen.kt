package com.rsaitrader.ui.screens

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import com.rsaitrader.ui.components.DangerButton
import com.rsaitrader.ui.components.Divider2
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.LoadingBox
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SectionCard
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.components.StatRow
import com.rsaitrader.ui.components.StatusPill
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AdminViewModel

@Composable
fun AdminScreen(viewModel: AdminViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val health = state.health.data

    state.confirmUser?.let { user ->
        AlertDialog(
            onDismissRequest = viewModel::cancelEditUser,
            containerColor = RsColors.Navy,
            title = { Text("Edit ${user.email}", style = MaterialTheme.typography.titleMedium) },
            text = {
                Column {
                    Text("Status", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                    SegmentedRow(
                        options = listOf("active", "suspended"),
                        selected = state.confirmStatus,
                        onSelect = viewModel::setConfirmStatus,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("Role", style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                    SegmentedRow(
                        options = listOf("user", "admin"),
                        selected = state.confirmRole,
                        onSelect = viewModel::setConfirmRole,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Roles are assigned server-side only. Promoting a user grants access to every account's " +
                            "metadata and the global kill switch.",
                        style = MaterialTheme.typography.labelSmall,
                        color = RsColors.Warning,
                    )
                }
            },
            confirmButton = { TextButton(onClick = viewModel::saveUser) { Text("Save", color = RsColors.Emerald) } },
            dismissButton = { TextButton(onClick = viewModel::cancelEditUser) { Text("Cancel") } },
        )
    }

    if (state.killSwitchDialog) {
        AlertDialog(
            onDismissRequest = viewModel::closeKillSwitch,
            containerColor = RsColors.Navy,
            title = { Text("Global kill switch", color = RsColors.Danger) },
            text = {
                Column {
                    Text(
                        "Engaging blocks new live orders for every user until the operator releases it. Reason is " +
                            "written to the audit log.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextSecondary,
                    )
                    Spacer(Modifier.height(8.dp))
                    RsTextField(
                        value = state.killReason,
                        onValueChange = viewModel::setKillReason,
                        label = "Reason",
                        placeholder = "e.g. exchange outage",
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.setKillSwitch(true) }) {
                    Text("ENGAGE", color = RsColors.Danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.setKillSwitch(false) }) {
                    Text("Release", color = RsColors.Emerald)
                }
            },
        )
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = RsColors.TextSecondary)
            }
            Column(Modifier.weight(1f)) {
                Text("Admin", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                Text(
                    "Operator tools · every action is audited",
                    style = MaterialTheme.typography.labelSmall,
                    color = RsColors.TextMuted,
                )
            }
            IconButton(onClick = viewModel::load) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh", tint = RsColors.TextSecondary)
            }
        }

        state.error?.let { ErrorBanner(message = it, onDismiss = viewModel::clearMessages) }
        state.message?.let {
            Text(it, color = RsColors.EmeraldGlow, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
        }

        SectionCard(title = "System health") {
            if (health == null) {
                LoadingBox("Loading health…")
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StatusPill(
                        "DB ${health.database.uppercase()}",
                        if (health.database == "ok") RsColors.Emerald else RsColors.Danger,
                    )
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    StatusPill(
                        if (health.market.synthetic) "SIMULATED DATA" else "MARKET ${health.market.provider.uppercase()}",
                        if (health.market.synthetic) RsColors.Warning else RsColors.Emerald,
                    )
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    if (health.tradingControl.killSwitch) StatusPill("KILL SWITCH", RsColors.Danger)
                }
                Spacer(Modifier.height(8.dp))
                StatRow("Users", health.counts.users.toString())
                StatRow("Active users", health.counts.activeUsers.toString())
                StatRow("Paper orders", health.counts.paperOrders.toString())
                StatRow("Live orders", health.counts.liveOrders.toString())
                StatRow("Signals stored", health.counts.signals.toString())
                StatRow("Market degraded", if (health.market.degraded) "Yes: ${health.market.degradedReason ?: ""}" else "No")
                StatRow("Server time", Fmt.dateTime(health.time))
                health.config.forEach { (key, value) ->
                    StatRow(key.replace('_', ' '), value.toString().replace("\"", ""))
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Global kill switch", accent = RsColors.Danger) {
            Text(
                (health?.tradingControl?.killSwitch == true)
                    .let { if (it) "ENGAGED: ${health?.tradingControl?.reason ?: "no reason"}" else "Not engaged." },
                style = MaterialTheme.typography.bodyMedium,
                color = if (health?.tradingControl?.killSwitch == true) RsColors.Danger else RsColors.TextSecondary,
            )
            Spacer(Modifier.height(8.dp))
            DangerButton(
                text = if (health?.tradingControl?.killSwitch == true) "Manage kill switch" else "Engage kill switch",
                onClick = viewModel::openKillSwitch,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Users", trailing = state.users.data?.total?.toString()) {
            RsTextField(
                value = state.search,
                onValueChange = viewModel::setSearch,
                label = "Search email",
                keyboardType = KeyboardType.Email,
            )
            Spacer(Modifier.height(8.dp))
            val users = state.users.data?.users ?: emptyList()
            if (users.isEmpty()) {
                Text("No users found.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
            } else {
                users.take(20).forEachIndexed { index, user ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(user.email, style = MaterialTheme.typography.bodyMedium, color = RsColors.TextPrimary)
                            Text(
                                "${user.displayName} · ${user.role} · ${if (user.hasExchangeKey) "key stored" else "no key"}",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                            Text(
                                "last login ${Fmt.dateTime(user.lastLoginAt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                        }
                        StatusPill(
                            user.status.uppercase(),
                            if (user.status == "active") RsColors.Emerald else RsColors.Danger,
                        )
                        TextButton(onClick = { viewModel.editUser(user) }) { Text("Edit") }
                    }
                    if (index != users.take(20).lastIndex) Divider2()
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Symbol filters", trailing = state.pairs.data?.size?.toString()) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton(
                    text = if (state.working) "Syncing…" else "Sync from Binance",
                    onClick = viewModel::syncPairs,
                    modifier = Modifier.weight(1f),
                    loading = state.working,
                )
            }
            Spacer(Modifier.height(8.dp))
            val pairs = state.pairs.data ?: emptyList()
            if (pairs.isEmpty()) {
                Text(
                    "No pairs cached. Sync to pull exchangeInfo filters (tick/step/minNotional).",
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.TextMuted,
                )
            } else {
                pairs.take(25).forEach { pair ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(pair.symbol, style = MaterialTheme.typography.bodyMedium, color = RsColors.TextPrimary)
                            Text(
                                "tick ${pair.tickSize ?: "—"} · step ${pair.stepSize ?: "—"} · min ${pair.minNotional ?: "—"}",
                                style = MaterialTheme.typography.labelSmall,
                                color = RsColors.TextMuted,
                            )
                        }
                        Switch(
                            checked = pair.enabled,
                            onCheckedChange = { viewModel.togglePair(pair.symbol, it) },
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Settings") {
            val settings = state.settings.data?.settings ?: emptyList()
            if (settings.isEmpty()) {
                Text("No runtime settings stored.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
            } else {
                settings.forEach { setting ->
                    StatRow(setting.key, setting.value?.toString()?.replace("\"", "") ?: "—", mono = false)
                    setting.description?.let {
                        Text(it, style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        SectionCard(title = "Audit log", trailing = state.audit.data?.size?.toString()) {
            val events = state.audit.data ?: emptyList()
            if (events.isEmpty()) {
                Text("No audit events yet.", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
            } else {
                events.take(30).forEach { event ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        Text(
                            event.action,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (event.outcome == "success") RsColors.TextPrimary else RsColors.Danger,
                        )
                        Text(
                            "${event.actor_role}${event.user_id?.let { " · user ${it.take(8)}" } ?: ""} · " +
                                Fmt.dateTime(event.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = RsColors.TextMuted,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}
