package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.ApiResult
import com.rsaitrader.core.network.AssistantAnswerDto
import com.rsaitrader.core.network.AssistantHistoryDto
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import com.rsaitrader.ui.state.toLoadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChatMessage(
    val id: String,
    val question: String,
    val answer: String,
    val lang: String,
    val refused: Boolean,
    val limitations: List<String>,
    val dataAsOf: String?,
    val pending: Boolean = false,
)

data class AssistantState(
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val lang: String = "en",
    val symbol: String? = null,
    val timeframe: String? = null,
    val asking: Boolean = false,
    val error: String? = null,
    val history: Loadable<List<AssistantHistoryDto>> = Loadable.idle(),
)

class AssistantViewModel : ViewModel() {

    private val repo get() = ServiceLocator.assistant
    private val favorites get() = ServiceLocator.favorites

    private val _state = MutableStateFlow(
        AssistantState(lang = favorites.language(), symbol = favorites.lastSymbol()),
    )
    val state: StateFlow<AssistantState> = _state.asStateFlow()

    init {
        loadHistory()
    }

    fun setInput(value: String) = _state.update { it.copy(input = value) }

    fun setLanguage(lang: String) {
        favorites.setLanguage(lang)
        _state.update { it.copy(lang = lang) }
    }

    fun setSymbol(symbol: String?) = _state.update { it.copy(symbol = symbol) }

    fun setTimeframe(timeframe: String?) = _state.update { it.copy(timeframe = timeframe) }

    fun loadHistory() {
        viewModelScope.launch {
            _state.update { it.copy(history = it.history.loading()) }
            _state.update { it.copy(history = repo.history().toLoadable(it.history)) }
        }
    }

    /** Suggestion chips shown on the empty chat. */
    fun suggestions(): List<String> = if (_state.value.lang == "si") {
        listOf(
            "RSI කියන්නේ මොකක්ද?",
            "දැන් BTCUSDT තත්ත්වය කියන්න",
            "මගේ portfolio එක ගැන කියන්න",
            "මේ සංඥාවේ අවදානම් මොනවද?",
        )
    } else {
        listOf(
            "Explain RSI in simple terms",
            "Summarise BTCUSDT 1h right now",
            "How is my portfolio doing?",
            "What are the risks of this signal?",
            "How do I enable live trading?",
        )
    }

    fun ask(question: String = _state.value.input) {
        val text = question.trim()
        if (text.isBlank()) return
        val localId = java.util.UUID.randomUUID().toString()
        val current = _state.value
        _state.update {
            it.copy(
                asking = true,
                input = "",
                error = null,
                messages = it.messages + ChatMessage(
                    id = localId,
                    question = text,
                    answer = "",
                    lang = current.lang,
                    refused = false,
                    limitations = emptyList(),
                    dataAsOf = null,
                    pending = true,
                ),
            )
        }
        viewModelScope.launch {
            when (val result = repo.ask(text, current.lang, current.symbol, current.timeframe)) {
                is ApiResult.Success -> {
                    val answer: AssistantAnswerDto = result.data
                    _state.update { state ->
                        state.copy(
                            asking = false,
                            messages = state.messages.map { message ->
                                if (message.id != localId) {
                                    message
                                } else {
                                    ChatMessage(
                                        id = if (answer.id.isBlank()) localId else answer.id,
                                        question = text,
                                        answer = answer.answer,
                                        lang = answer.lang,
                                        refused = answer.refused,
                                        limitations = answer.limitations,
                                        dataAsOf = answer.dataAsOf,
                                    )
                                }
                            },
                        )
                    }
                }
                is ApiResult.Failure -> _state.update { state ->
                    state.copy(
                        asking = false,
                        error = result.message,
                        messages = state.messages.filterNot { it.id == localId },
                    )
                }
            }
        }
    }

    fun clear() = _state.update { it.copy(messages = emptyList(), error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }
}
