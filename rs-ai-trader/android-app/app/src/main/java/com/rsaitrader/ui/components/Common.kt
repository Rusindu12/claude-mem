package com.rsaitrader.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.rsaitrader.ui.theme.CardRadius
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.theme.ScreenPadding

@Composable
fun ScreenScaffold(
    title: String,
    subtitle: String? = null,
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = ScreenPadding),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.headlineSmall, color = RsColors.TextPrimary)
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                actions()
            }
        }
        content()
    }
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    trailing: String? = null,
    accent: Color? = null,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(CardRadius),
        colors = CardDefaults.cardColors(containerColor = RsColors.Navy),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent ?: RsColors.Border),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            if (title != null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        title.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = accent ?: RsColors.TextMuted,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    if (trailing != null) {
                        Text(trailing, style = MonoStyle, color = RsColors.TextSecondary)
                    }
                }
            }
            content()
        }
    }
}

@Composable
fun StatRow(label: String, value: String, valueColor: Color = RsColors.TextPrimary, mono: Boolean = true) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = RsColors.TextSecondary)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            style = if (mono) MonoStyle else MaterialTheme.typography.bodyMedium,
            color = valueColor,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
fun StatusPill(text: String, color: Color, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.14f),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.45f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(12.dp))
                Spacer(Modifier.width(4.dp))
            } else {
                Box(Modifier.size(6.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(5.dp))
            }
            Text(text, style = MaterialTheme.typography.labelSmall, color = color)
        }
    }
}

@Composable
fun ConnectionPill(connected: Boolean, label: String? = null, degraded: Boolean = false) {
    val color = when {
        degraded -> RsColors.Warning
        connected -> RsColors.Emerald
        else -> RsColors.Danger
    }
    StatusPill(
        text = label ?: when {
            degraded -> "DEGRADED"
            connected -> "LIVE"
            else -> "OFFLINE"
        },
        color = color,
    )
}

@Composable
fun StaleDataBanner(stale: Boolean, source: String?, synthetic: Boolean, ageSeconds: Double? = null) {
    AnimatedVisibility(visible = stale || synthetic || (ageSeconds ?: 0.0) > 180) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            shape = RoundedCornerShape(12.dp),
            color = RsColors.Warning.copy(alpha = 0.12f),
            border = androidx.compose.foundation.BorderStroke(1.dp, RsColors.Warning.copy(alpha = 0.4f)),
        ) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CloudOff, contentDescription = null, tint = RsColors.Warning, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    buildString {
                        if (synthetic) append("Simulated market data (no live exchange feed). ")
                        else if (stale) append("Market data is stale. ")
                        if (ageSeconds != null) append("Age ${com.rsaitrader.core.format.Fmt.age(ageSeconds)}. ")
                        append("Prices may not reflect the exchange.")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = RsColors.Warning,
                )
            }
        }
    }
}

@Composable
fun LoadingBox(message: String = "Loading…", modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = RsColors.Emerald, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
        Spacer(Modifier.height(12.dp))
        Text(message, style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
    }
}

@Composable
fun FullScreenLoading(message: String = "Loading…") {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingBox(message) }
}

@Composable
fun ErrorBanner(
    message: String,
    code: String? = null,
    onRetry: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        shape = RoundedCornerShape(12.dp),
        color = RsColors.Danger.copy(alpha = 0.12f),
        border = androidx.compose.foundation.BorderStroke(1.dp, RsColors.Danger.copy(alpha = 0.45f)),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ErrorOutline, contentDescription = null, tint = RsColors.Danger, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(message, style = MaterialTheme.typography.bodySmall, color = Color(0xFFFCA5A5), modifier = Modifier.weight(1f))
            }
            if (code != null || onRetry != null || onDismiss != null) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    if (code != null) {
                        Text(code, style = MaterialTheme.typography.labelSmall, color = RsColors.Danger.copy(alpha = 0.8f))
                    }
                    Spacer(Modifier.weight(1f))
                    if (onDismiss != null) {
                        TextButton(onClick = onDismiss) { Text("Dismiss", color = RsColors.TextSecondary) }
                    }
                    if (onRetry != null) {
                        TextButton(onClick = onRetry) {
                            Icon(Icons.Filled.Refresh, contentDescription = null, tint = RsColors.Emerald, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Retry", color = RsColors.Emerald)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun EmptyState(
    title: String,
    body: String? = null,
    icon: ImageVector = Icons.Filled.Inbox,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 36.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = RsColors.TextMuted, modifier = Modifier.size(30.dp))
        Spacer(Modifier.height(10.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = RsColors.TextSecondary, textAlign = TextAlign.Center)
        if (body != null) {
            Spacer(Modifier.height(4.dp))
            Text(body, style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    container: Color = RsColors.Emerald,
    contentColor: Color = Color(0xFF04180F),
) {
    Button(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        enabled = enabled && !loading,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = contentColor,
            disabledContainerColor = container.copy(alpha = 0.35f),
            disabledContentColor = contentColor.copy(alpha = 0.6f),
        ),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = contentColor,
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun DangerButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = RsColors.Danger.copy(alpha = 0.15f),
            contentColor = Color(0xFFFCA5A5),
        ),
        border = androidx.compose.foundation.BorderStroke(1.dp, RsColors.Danger.copy(alpha = 0.5f)),
    ) {
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun KeyValueChip(label: String, value: String, color: Color = RsColors.TextSecondary) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = RsColors.SurfaceHigh,
        border = androidx.compose.foundation.BorderStroke(1.dp, RsColors.Border),
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = RsColors.TextMuted)
            Text(value, style = MonoStyle, color = color)
        }
    }
}

@Composable
fun Divider2(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(RsColors.Border))
}
