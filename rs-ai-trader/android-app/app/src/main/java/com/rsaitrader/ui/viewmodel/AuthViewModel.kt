package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.UserDto
import com.rsaitrader.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface AuthState {
    data object Booting : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val user: UserDto) : AuthState
}

data class AuthFormState(
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
)

class AuthViewModel : ViewModel() {

    private val repo get() = ServiceLocator.session

    private val _authState = MutableStateFlow<AuthState>(AuthState.Booting)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _form = MutableStateFlow(AuthFormState())
    val form: StateFlow<AuthFormState> = _form.asStateFlow()

    init {
        bootstrap()
    }

    /** Validate the stored session against the backend so a revoked token fails fast. */
    fun bootstrap() {
        val cached = repo.user
        if (!repo.isSignedIn) {
            _authState.value = AuthState.SignedOut
            return
        }
        if (cached != null) _authState.value = AuthState.SignedIn(cached)
        viewModelScope.launch {
            when (val result = repo.restore()) {
                is ApiResult.Success -> _authState.value = AuthState.SignedIn(result.data)
                is ApiResult.Failure -> {
                    if (result.code.startsWith("http_401") || result.code == "unauthorized") {
                        repo.logout()
                        _authState.value = AuthState.SignedOut
                    } else if (cached != null) {
                        // Offline start: keep the cached session, screens will show
                        // their own connection errors instead of logging the user out.
                        _authState.value = AuthState.SignedIn(cached)
                    } else {
                        _authState.value = AuthState.SignedOut
                    }
                }
            }
        }
    }

    fun login(email: String, password: String) {
        val errors = validateCredentials(email, password)
        if (errors.isNotEmpty()) {
            _form.update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.login(email, password)) {
                is ApiResult.Success -> {
                    _form.value = AuthFormState()
                    _authState.value = AuthState.SignedIn(result.data.user)
                }
                is ApiResult.Failure -> _form.value = AuthFormState(
                    error = result.message,
                    fieldErrors = if (result.code.startsWith("http_401")) mapOf("password" to "Incorrect email or password.") else emptyMap(),
                )
            }
        }
    }

    fun register(email: String, password: String, confirm: String, displayName: String, language: String) {
        val errors = validateCredentials(email, password).toMutableMap()
        if (confirm != password) errors["confirm"] = "Passwords do not match."
        if (errors.isNotEmpty()) {
            _form.update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.register(email, password, displayName.ifBlank { "Trader" }, language)) {
                is ApiResult.Success -> {
                    _form.value = AuthFormState()
                    _authState.value = AuthState.SignedIn(result.data.user)
                }
                is ApiResult.Failure -> _form.value = AuthFormState(
                    error = result.message,
                    fieldErrors = if (result.code.contains("exists") || result.message.contains("exists", true)) {
                        mapOf("email" to "That email is already registered.")
                    } else {
                        emptyMap()
                    },
                )
            }
        }
    }

    fun requestPasswordReset(email: String) {
        if (!email.contains("@")) {
            _form.update { it.copy(fieldErrors = mapOf("email" to "Enter a valid email address.")) }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.requestPasswordReset(email)) {
                is ApiResult.Success -> _form.value = AuthFormState(
                    info = "If that email exists, a reset link has been sent. Check your inbox.",
                )
                is ApiResult.Failure -> _form.value = AuthFormState(error = result.message)
            }
        }
    }

    fun confirmReset(token: String, newPassword: String) {
        val errors = mutableMapOf<String, String>()
        if (token.isBlank()) errors["token"] = "Paste the reset token from your email."
        if (newPassword.length < 10) errors["new"] = "Use at least 10 characters."
        if (errors.isNotEmpty()) {
            _form.update { it.copy(fieldErrors = errors) }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.confirmPasswordReset(token.trim(), newPassword)) {
                is ApiResult.Success -> _form.value = AuthFormState(
                    info = "Password updated. Sign in with your new password.",
                )
                is ApiResult.Failure -> _form.value = AuthFormState(error = result.message)
            }
        }
    }

    fun changePassword(current: String, newPassword: String, confirm: String) {
        val errors = mutableMapOf<String, String>()
        if (current.isBlank()) errors["current"] = "Enter your current password."
        if (newPassword.length < 10) errors["new"] = "Use at least 10 characters."
        if (confirm != newPassword) errors["confirm"] = "Passwords do not match."
        if (errors.isNotEmpty()) {
            _form.update { it.copy(fieldErrors = errors) }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.changePassword(current, newPassword)) {
                is ApiResult.Success -> {
                    _form.value = AuthFormState(
                        info = "Password changed. All sessions were revoked — sign in again.",
                    )
                    _authState.value = AuthState.SignedOut
                }
                is ApiResult.Failure -> _form.value = AuthFormState(error = result.message)
            }
        }
    }

    fun deleteAccount(password: String, confirmation: String, onDeleted: () -> Unit) {
        if (password.isBlank() || confirmation.trim() != "DELETE") {
            _form.update { it.copy(error = "Confirm by typing DELETE and entering your password.") }
            return
        }
        _form.value = AuthFormState(busy = true)
        viewModelScope.launch {
            when (val result = repo.deleteAccount(password, confirmation.trim())) {
                is ApiResult.Success -> {
                    _form.value = AuthFormState()
                    onDeleted()
                    _authState.value = AuthState.SignedOut
                }
                is ApiResult.Failure -> _form.value = AuthFormState(error = result.message)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repo.logout()
            _authState.value = AuthState.SignedOut
            _form.value = AuthFormState()
        }
    }

    fun logoutEverywhere() {
        viewModelScope.launch {
            when (val result = repo.logoutEverywhere()) {
                is ApiResult.Success -> {
                    _authState.value = AuthState.SignedOut
                    _form.value = AuthFormState(info = "Signed out on all devices.")
                }
                is ApiResult.Failure -> _form.value = AuthFormState(error = result.message)
            }
        }
    }

    fun clearMessages() {
        _form.update { it.copy(error = null, info = null, fieldErrors = emptyMap()) }
    }

    fun forceSignOut() {
        _authState.value = AuthState.SignedOut
    }

    private fun validateCredentials(email: String, password: String): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (!email.contains("@") || !email.contains(".")) errors["email"] = "Enter a valid email address."
        if (password.length < 8) errors["password"] = "Password must be at least 8 characters."
        return errors
    }
}
