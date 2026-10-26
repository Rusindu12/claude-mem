package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AppConfigDto
import com.rsaitrader.core.network.CredentialDto
import com.rsaitrader.core.network.NotificationDto
import com.rsaitrader.core.network.SessionDto
import com.rsaitrader.core.network.UserDto
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// --------------------------------------------------------------- API settings
data class ApiSettingsState(
    val credentials: Loadable<com.rsaitrader.core.network.CredentialListDto> = Loadable.idle(),
    val apiKey: String = "",
    val apiSecret: String = "",
    val label: String = "Binance",
    val environment: String? = null,
    val saving: Boolean = false,
    val verifyingId: String? = null,
    val message: String? = null,
    val error: String? = null,
    val confirmRevoke: CredentialDto? = null,
) {
    val canSubmit: Boolean get() = apiKey.trim().length >= 16 && apiSecret.trim().length >= 16
}

class ApiSettingsViewModel : ViewModel() {

    private val repo get() = ServiceLocator.credentials

    private val _state = MutableStateFlow(ApiSettingsState())
    val state: StateFlow<ApiSettingsState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(credentials = it.credentials.loading()) }
            _state.update { it.copy(credentials = repo.list().toLoadable(it.credentials)) }
        }
    }

    fun setApiKey(v: String) = _state.update { it.copy(apiKey = v.trim(), error = null) }
    fun setApiSecret(v: String) = _state.update { it.copy(apiSecret = v.trim(), error = null) }
    fun setLabel(v: String) = _state.update { it.copy(label = v.take(40)) }
    fun setEnvironment(v: String?) = _state.update { it.copy(environment = v) }

    fun save() {
        val s = _state.value
        if (!s.canSubmit) {
            _state.update { it.copy(error = "Enter both the API key and the secret (at least 16 characters each).") }
            return
        }
        _state.update { it.copy(saving = true, error = null, message = null) }
        viewModelScope.launch {
            when (val result = repo.add(s.apiKey, s.apiSecret, s.label.ifBlank { "Binance" })) {
                is ApiResult.Success -> _state.update {
                    it.copy(
                        saving = false,
                        // Clear the secret from memory immediately after it is stored server-side.
                        apiKey = "",
                        apiSecret = "",
                        message = "Key stored on the server. Saving a key never enables live trading.",
                    )
                }
                is ApiResult.Failure -> _state.update { it.copy(saving = false, error = result.message) }
            }
            load()
        }
    }

    fun verify(id: String) {
        _state.update { it.copy(verifyingId = id, error = null) }
        viewModelScope.launch {
            when (val result = repo.verify(id)) {
                is ApiResult.Success -> _state.update { it.copy(verifyingId = null, message = "Key verified against Binance.") }
                is ApiResult.Failure -> _state.update { it.copy(verifyingId = null, error = result.message) }
            }
            load()
        }
    }

    fun requestRevoke(credential: CredentialDto) = _state.update { it.copy(confirmRevoke = credential) }
    fun cancelRevoke() = _state.update { it.copy(confirmRevoke = null) }

    fun revoke(id: String) {
        _state.update { it.copy(confirmRevoke = null) }
        viewModelScope.launch {
            when (val result = repo.revoke(id)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(message = "Key revoked and deleted from the backend.") }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

// ------------------------------------------------------------------- security
data class SecurityState(
    val sessions: Loadable<List<SessionDto>> = Loadable.idle(),
    val profile: Loadable<UserDto> = Loadable.idle(),
    val revokingId: String? = null,
    val deleting: Boolean = false,
    val deletePassword: String = "",
    val deleteConfirmText: String = "",
    val showDelete: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class SecurityViewModel : ViewModel() {

    private val session get() = ServiceLocator.session

    private val _state = MutableStateFlow(SecurityState())
    val state: StateFlow<SecurityState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(sessions = it.sessions.loading()) }
            _state.update { it.copy(sessions = session.sessions().toLoadable(it.sessions)) }
            when (val me = session.restore()) {
                is ApiResult.Success -> _state.update { it.copy(profile = it.profile.success(me.data)) }
                is ApiResult.Failure -> _state.update { it.copy(profile = it.profile.failure(me.message, me.code)) }
            }
        }
    }

    fun revoke(id: String) {
        _state.update { it.copy(revokingId = id, error = null) }
        viewModelScope.launch {
            when (val result = session.revokeSession(id)) {
                is ApiResult.Success -> {
                    _state.update { it.copy(revokingId = null, message = "Session revoked.") }
                    load()
                }
                is ApiResult.Failure -> _state.update { it.copy(revokingId = null, error = result.message) }
            }
        }
    }

    fun logoutEverywhere() {
        viewModelScope.launch {
            when (val result = session.logoutEverywhere()) {
                is ApiResult.Success -> _state.update { it.copy(message = "All sessions revoked. Sign in again.") }
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun showDeleteDialog() = _state.update { it.copy(showDelete = true, deletePassword = "", deleteConfirmText = "") }
    fun hideDeleteDialog() = _state.update { it.copy(showDelete = false) }
    fun setDeletePassword(v: String) = _state.update { it.copy(deletePassword = v) }
    fun setDeleteConfirmText(v: String) = _state.update { it.copy(deleteConfirmText = v) }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

// ---------------------------------------------------------- settings / help
data class AppSettingsState(
    val config: Loadable<AppConfigDto> = Loadable.idle(),
    val notifications: Loadable<List<NotificationDto>> = Loadable.idle(),
    val profile: UserDto? = null,
    val language: String = "en",
    val saving: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class AppSettingsViewModel : ViewModel() {

    private val market get() = ServiceLocator.market
    private val notificationsRepo get() = ServiceLocator.notifications
    private val session get() = ServiceLocator.session
    private val favorites get() = ServiceLocator.favorites

    private val _state = MutableStateFlow(AppSettingsState(language = favorites.language()))
    val state: StateFlow<AppSettingsState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(config = it.config.loading()) }
            _state.update { it.copy(config = market.config().toLoadable(it.config)) }
            _state.update { it.copy(notifications = notificationsRepo.list().toLoadable(it.notifications)) }
            session.restore().let { result ->
                if (result is ApiResult.Success) _state.update { it.copy(profile = result.data) }
            }
        }
    }

    fun setLanguage(lang: String) {
        favorites.setLanguage(lang)
        _state.update { it.copy(language = lang) }
        viewModelScope.launch {
            when (val result = session.updateProfile(null, lang)) {
                is ApiResult.Success -> _state.update { it.copy(profile = result.data, message = "Language preference saved.") }
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun markNotificationsRead() {
        viewModelScope.launch {
            when (val result = notificationsRepo.markRead()) {
                is ApiResult.Success -> load()
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

// ---------------------------------------------------------------------- admin
data class AdminState(
    val users: Loadable<com.rsaitrader.core.network.AdminUsersResponse> = Loadable.idle(),
    val health: Loadable<com.rsaitrader.core.network.AdminHealthDto> = Loadable.idle(),
    val audit: Loadable<List<com.rsaitrader.core.network.AuditEventDto>> = Loadable.idle(),
    val settings: Loadable<com.rsaitrader.core.network.AdminSettingsResponse> = Loadable.idle(),
    val pairs: Loadable<List<com.rsaitrader.core.network.PairDto>> = Loadable.idle(),
    val search: String = "",
    val working: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val killSwitchDialog: Boolean = false,
    val killReason: String = "",
    val confirmUser: com.rsaitrader.core.network.AdminUserDto? = null,
    val confirmRole: String = "user",
    val confirmStatus: String = "active",
)

class AdminViewModel : ViewModel() {

    private val repo get() = ServiceLocator.admin

    private val _state = MutableStateFlow(AdminState())
    val state: StateFlow<AdminState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update {
                it.copy(
                    health = it.health.loading(),
                    audit = it.audit.loading(),
                    settings = it.settings.loading(),
                    pairs = it.pairs.loading(),
                )
            }
            _state.update { it.copy(users = repo.users(_state.value.search.ifBlank { null }).toLoadable(it.users)) }
            _state.update { it.copy(health = repo.health().toLoadable(it.health)) }
            _state.update { it.copy(audit = repo.audit().toLoadable(it.audit)) }
            _state.update { it.copy(settings = repo.settings().toLoadable(it.settings)) }
            _state.update { it.copy(pairs = repo.pairs().toLoadable(it.pairs)) }
        }
    }

    fun setSearch(value: String) {
        _state.update { it.copy(search = value) }
        viewModelScope.launch {
            _state.update { it.copy(users = repo.users(value.ifBlank { null }).toLoadable(it.users)) }
        }
    }

    fun syncPairs() {
        _state.update { it.copy(working = true, message = null, error = null) }
        viewModelScope.launch {
            when (val result = repo.syncPairs()) {
                is ApiResult.Success -> _state.update { it.copy(working = false, message = "Symbol filters refreshed from Binance.") }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    fun togglePair(symbol: String, enabled: Boolean) {
        viewModelScope.launch {
            when (val result = repo.togglePair(symbol, enabled)) {
                is ApiResult.Success -> load()
                is ApiResult.Failure -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun editUser(user: com.rsaitrader.core.network.AdminUserDto) =
        _state.update { it.copy(confirmUser = user, confirmRole = user.role, confirmStatus = user.status) }

    fun cancelEditUser() = _state.update { it.copy(confirmUser = null) }
    fun setConfirmRole(role: String) = _state.update { it.copy(confirmRole = role) }
    fun setConfirmStatus(status: String) = _state.update { it.copy(confirmStatus = status) }

    fun saveUser() {
        val user = _state.value.confirmUser ?: return
        val role = _state.value.confirmRole
        val status = _state.value.confirmStatus
        _state.update { it.copy(confirmUser = null, working = true) }
        viewModelScope.launch {
            when (val result = repo.updateUser(user.id, status, role)) {
                is ApiResult.Success -> _state.update { it.copy(working = false, message = "User updated.") }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    fun openKillSwitch() = _state.update { it.copy(killSwitchDialog = true, killReason = "") }
    fun closeKillSwitch() = _state.update { it.copy(killSwitchDialog = false) }
    fun setKillReason(v: String) = _state.update { it.copy(killReason = v) }

    fun setKillSwitch(engage: Boolean) {
        val reason = _state.value.killReason.ifBlank { if (engage) "Engaged by admin" else "Released by admin" }
        _state.update { it.copy(killSwitchDialog = false, working = true, error = null) }
        viewModelScope.launch {
            when (val result = repo.killSwitch(engage, reason)) {
                is ApiResult.Success -> _state.update {
                    it.copy(working = false, message = if (engage) "Global kill switch ENGAGED." else "Global kill switch released.")
                }
                is ApiResult.Failure -> _state.update { it.copy(working = false, error = result.message) }
            }
            load()
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}
