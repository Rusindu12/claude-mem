package com.rsaitrader.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.rsaitrader.ui.theme.RsColors

@Composable
fun RsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    error: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    suffix: String? = null,
    imeAction: ImeAction = ImeAction.Next,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label, style = MaterialTheme.typography.bodySmall) },
        placeholder = placeholder?.let { { Text(it, style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted) } },
        isError = error != null,
        supportingText = error?.let { { Text(it, color = RsColors.Danger, style = MaterialTheme.typography.bodySmall) } },
        singleLine = singleLine,
        enabled = enabled,
        suffix = suffix?.let { { Text(it, style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        shape = RoundedCornerShape(12.dp),
        textStyle = MaterialTheme.typography.bodyLarge,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = RsColors.Emerald,
            unfocusedBorderColor = RsColors.Border,
            focusedContainerColor = RsColors.Navy,
            unfocusedContainerColor = RsColors.Navy,
            focusedTextColor = RsColors.TextPrimary,
            unfocusedTextColor = RsColors.TextPrimary,
            cursorColor = RsColors.Emerald,
            focusedLabelColor = RsColors.Emerald,
            unfocusedLabelColor = RsColors.TextMuted,
        ),
    )
}

@Composable
fun RsPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    imeAction: ImeAction = ImeAction.Next,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label, style = MaterialTheme.typography.bodySmall) },
        isError = error != null,
        supportingText = error?.let { { Text(it, color = RsColors.Danger, style = MaterialTheme.typography.bodySmall) } },
        singleLine = true,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                    contentDescription = if (visible) "Hide password" else "Show password",
                    tint = RsColors.TextMuted,
                    modifier = Modifier.size(18.dp),
                )
            }
        },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = RsColors.Emerald,
            unfocusedBorderColor = RsColors.Border,
            focusedContainerColor = RsColors.Navy,
            unfocusedContainerColor = RsColors.Navy,
            focusedTextColor = RsColors.TextPrimary,
            unfocusedTextColor = RsColors.TextPrimary,
            cursorColor = RsColors.Emerald,
            focusedLabelColor = RsColors.Emerald,
            unfocusedLabelColor = RsColors.TextMuted,
        ),
    )
}

/** Horizontal segmented selector (timeframes, sort order, modes). */
@Composable
fun SegmentedRow(
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    labels: (String) -> String = { it },
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(option) },
                shape = RoundedCornerShape(10.dp),
                color = if (isSelected) RsColors.Emerald.copy(alpha = 0.16f) else RsColors.Navy,
                border = BorderStroke(1.dp, if (isSelected) RsColors.Emerald else RsColors.Border),
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        labels(option),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (isSelected) RsColors.Emerald else RsColors.TextSecondary,
                    )
                }
            }
        }
    }
}

/** Trading-mode selector with explicit LIVE styling (never the default). */
@Composable
fun ModeToggle(mode: String, onSelect: (String) -> Unit, liveAllowed: Boolean = true) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        ModeChip("PAPER", mode == "paper", RsColors.Emerald) { onSelect("paper") }
        ModeChip("LIVE SPOT", mode == "live", RsColors.Danger, enabled = liveAllowed) { onSelect("live") }
    }
}

@Composable
fun RowScope.ModeChip(
    label: String,
    selected: Boolean,
    color: Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.weight(1f).clickable(enabled = enabled) { onClick() },
        shape = RoundedCornerShape(10.dp),
        color = if (selected) color.copy(alpha = 0.16f) else RsColors.Navy,
        border = BorderStroke(1.dp, if (selected) color else RsColors.Border),
    ) {
        Row(
            modifier = Modifier.padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = when {
                    !enabled -> RsColors.TextMuted
                    selected -> color
                    else -> RsColors.TextSecondary
                },
            )
        }
    }
}

/** Symbol chip row used above charts and the terminal. */
@Composable
fun SymbolChips(symbols: List<String>, selected: String, onSelect: (String) -> Unit) {
    androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        items(symbols.size) { index ->
            val symbol = symbols[index]
            val isSelected = symbol == selected
            Surface(
                modifier = Modifier.clickable { onSelect(symbol) },
                shape = RoundedCornerShape(9.dp),
                color = if (isSelected) RsColors.Emerald.copy(alpha = 0.16f) else RsColors.Navy,
                border = BorderStroke(1.dp, if (isSelected) RsColors.Emerald else RsColors.Border),
            ) {
                Text(
                    symbol.removeSuffix("USDT"),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isSelected) RsColors.Emerald else RsColors.TextSecondary,
                    modifier = Modifier
                        .background(Color.Transparent)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}

/** Thin horizontal progress line used while a background refresh runs. */
@Composable
fun RefreshBar(visible: Boolean, color: Color = RsColors.Emerald) {
    if (!visible) return
    androidx.compose.material3.LinearProgressIndicator(
        modifier = Modifier.fillMaxWidth(),
        color = color,
        trackColor = RsColors.Border,
    )
}
