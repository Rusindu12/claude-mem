package com.rsaitrader.ui.screens

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rsaitrader.ui.components.ErrorBanner
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.components.RsPasswordField
import com.rsaitrader.ui.components.RsTextField
import com.rsaitrader.ui.components.SegmentedRow
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AuthViewModel

private enum class AuthMode(val label: String) {
    LOGIN("Sign in"),
    REGISTER("Register"),
    RECOVER("Reset password"),
}

/**
 * Login / registration / password-recovery.
 *
 * There is no "admin code" field and no hardcoded credential: administrators are
 * created server-side with `python -m app.cli create-admin`.
 */
@Composable
fun AuthScreen(viewModel: AuthViewModel) {
    val form by viewModel.form.collectAsStateWithLifecycle()
    var mode by remember { mutableStateOf(AuthMode.LOGIN) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var language by remember { mutableStateOf("en") }
    var showResetConfirm by remember { mutableStateOf(false) }
    var resetToken by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(RsColors.Black, RsColors.Navy, RsColors.Black))),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                LogoMark(size = 52)
                Spacer(Modifier.size(4.dp))
                Column {
                    Text("RS AI TRADER", style = MaterialTheme.typography.titleLarge, color = RsColors.TextPrimary)
                    Text(
                        "Binance Spot · AI analysis · Paper trading",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextMuted,
                    )
                }
            }
            Spacer(Modifier.height(28.dp))

            SegmentedRow(
                options = AuthMode.entries.map { it.name },
                selected = mode.name,
                onSelect = { name ->
                    mode = AuthMode.valueOf(name)
                    viewModel.clearMessages()
                },
                labels = { name -> AuthMode.valueOf(name).label },
            )
            Spacer(Modifier.height(18.dp))

            when (mode) {
                AuthMode.LOGIN -> {
                    RsTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = "Email",
                        placeholder = "you@example.com",
                        error = form.fieldErrors["email"],
                        keyboardType = KeyboardType.Email,
                    )
                    Spacer(Modifier.height(12.dp))
                    RsPasswordField(
                        value = password,
                        onValueChange = { password = it },
                        label = "Password",
                        error = form.fieldErrors["password"],
                        imeAction = ImeAction.Done,
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryButton(
                        text = "Sign in",
                        onClick = { viewModel.login(email, password) },
                        modifier = Modifier.fillMaxWidth(),
                        loading = form.busy,
                    )
                }

                AuthMode.REGISTER -> {
                    RsTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        label = "Display name",
                        placeholder = "Trader",
                        error = form.fieldErrors["name"],
                    )
                    Spacer(Modifier.height(12.dp))
                    RsTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = "Email",
                        placeholder = "you@example.com",
                        error = form.fieldErrors["email"],
                        keyboardType = KeyboardType.Email,
                    )
                    Spacer(Modifier.height(12.dp))
                    RsPasswordField(
                        value = password,
                        onValueChange = { password = it },
                        label = "Password (min. 10 characters recommended)",
                        error = form.fieldErrors["password"],
                    )
                    Spacer(Modifier.height(12.dp))
                    RsPasswordField(
                        value = confirm,
                        onValueChange = { confirm = it },
                        label = "Confirm password",
                        error = form.fieldErrors["confirm"],
                        imeAction = ImeAction.Done,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Assistant language", style = MaterialTheme.typography.bodySmall, color = RsColors.TextMuted)
                    Spacer(Modifier.height(6.dp))
                    SegmentedRow(
                        options = listOf("en", "si"),
                        selected = language,
                        onSelect = { language = it },
                        labels = { if (it == "en") "English" else "සිංහල" },
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryButton(
                        text = "Create account",
                        onClick = { viewModel.register(email, password, confirm, displayName, language) },
                        modifier = Modifier.fillMaxWidth(),
                        loading = form.busy,
                    )
                }

                AuthMode.RECOVER -> {
                    RsTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = "Account email",
                        placeholder = "you@example.com",
                        error = form.fieldErrors["email"],
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Done,
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryButton(
                        text = "Send reset link",
                        onClick = { viewModel.requestPasswordReset(email) },
                        modifier = Modifier.fillMaxWidth(),
                        loading = form.busy,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Have a reset token from your email? Paste it below.",
                        style = MaterialTheme.typography.bodySmall,
                        color = RsColors.TextMuted,
                        modifier = Modifier.clickable { showResetConfirm = !showResetConfirm },
                    )
                    if (showResetConfirm) {
                        Spacer(Modifier.height(10.dp))
                        RsTextField(
                            value = resetToken,
                            onValueChange = { resetToken = it },
                            label = "Reset token",
                        )
                        Spacer(Modifier.height(10.dp))
                        RsPasswordField(
                            value = newPassword,
                            onValueChange = { newPassword = it },
                            label = "New password",
                            imeAction = ImeAction.Done,
                        )
                        Spacer(Modifier.height(12.dp))
                        PrimaryButton(
                            text = "Set new password",
                            onClick = {
                                viewModel.confirmReset(resetToken, newPassword)
                                mode = AuthMode.LOGIN
                            },
                            modifier = Modifier.fillMaxWidth(),
                            loading = form.busy,
                        )
                    }
                }
            }

            form.error?.let {
                Spacer(Modifier.height(8.dp))
                ErrorBanner(message = it, onDismiss = viewModel::clearMessages)
            }
            form.info?.let {
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(RsColors.Emerald.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                        .padding(12.dp),
                ) {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = RsColors.EmeraldGlow)
                }
            }
            Spacer(Modifier.height(24.dp))
            Text(
                "Your Binance API keys are never entered here. They are added later under Settings → API connection " +
                    "and stored encrypted on the backend.",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
            )
        }
    }
}
