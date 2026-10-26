package com.rsaitrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rsaitrader.core.network.PairDto
import com.rsaitrader.core.network.PairsResponse
import com.rsaitrader.core.network.TickerDto
import com.rsaitrader.core.realtime.StreamStatus
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.state.Loadable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WatchlistState(
    val pairs: Loadable<PairsResponse> = Loadable.idle(),
    val tickers: Map<String, TickerDto> = emptyMap(),
    val favorites: List<String> = emptyList(),
    val search: String = "",
    val showFavoritesOnly: Boolean = true,
    val sortBy: String = "favorite",
) {
    private fun pairFor(symbol: String): PairDto? =
        pairs.data?.symbols?.firstOrNull { it.symbol == symbol }

    val visible: List<TickerDto>
        get() {
            val all = tickers.values.filter { symbolFilter(it.symbol) }
            return when (sortBy) {
                "change" -> all.sortedByDescending { it.changePercent24h }
                "volume" -> all.sortedByDescending { it.quoteVolume24h }
                "az" -> all.sortedBy { it.symbol }
                else -> all.sortedBy {
                    val idx = favorites.indexOf(it.symbol)
                    if (idx >= 0) idx else favorites.size + it.symbol.hashCode().rem(1000)
                }
            }
        }

    val quoteAssets: List<String>
        get() = pairs.data?.symbols?.map { it.quoteAsset }?.distinct()?.sorted() ?: listOf("USDT")

    fun filters(symbol: String) = pairFor(symbol)

    private fun symbolFilter(symbol: String): Boolean {
        if (showFavoritesOnly && favorites.isNotEmpty() && !favorites.contains(symbol)) return false
        if (search.isBlank()) return true
        return symbol.contains(search.trim().uppercase())
    }
}

class WatchlistViewModel : ViewModel() {

    private val market = ServiceLocator.market
    private val favorites = ServiceLocator.favorites
    private val feed = ServiceLocator.feed

    private val _state = MutableStateFlow(
        WatchlistState(favorites = favorites.favorites(), search = ""),
    )
    val state: StateFlow<WatchlistState> = _state.asStateFlow()

    val streamStatus: StateFlow<StreamStatus> = feed.status
    val liveTickers: StateFlow<Map<String, TickerDto>> = feed.tickers

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(pairs = it.pairs.loading()) }
            when (val result = market.pairs()) {
                is com.rsaitrader.core.ApiResult.Success -> {
                    _state.update { it.copy(pairs = it.pairs.success(result.data)) }
                    val symbols = result.data.symbols.filter { it.enabled }.map { it.symbol }
                    watchFeed(symbols)
                    refreshTickers(symbols)
                }
                is com.rsaitrader.core.ApiResult.Failure -> _state.update {
                    it.copy(pairs = it.pairs.failure(result.message, result.code))
                }
            }
        }
    }

    private fun watchFeed(symbols: List<String>) {
        val favourites = _state.value.favorites
        val ordered = (favourites.filter { symbols.contains(it) } + symbols)
            .distinct()
            .take(8)
        feed.watch(ordered)
        // Kick a REST snapshot immediately: the socket's first frame is 2s away and
        // we do not want an empty screen.
        viewModelScope.launch { refreshTickers(ordered) }
    }

    private suspend fun refreshTickers(symbols: List<String>) {
        if (symbols.isEmpty()) return
        when (val result = market.tickers(symbols.take(60))) {
            is com.rsaitrader.core.ApiResult.Success ->
                _state.update { it.copy(tickers = it.tickers + result.data.associateBy { t -> t.symbol }) }
            is com.rsaitrader.core.ApiResult.Failure -> Unit // stream/screen error banner covers it
        }
    }

    fun toggleFavorite(symbol: String) {
        val updated = favorites.toggle(symbol)
        _state.update { it.copy(favorites = updated) }
        watchFeed(_state.value.pairs.data?.symbols?.filter { it.enabled }?.map { it.symbol } ?: listOf(symbol))
    }

    fun selectQuote(quote: String) {
        val all = _state.value.pairs.data?.symbols ?: return
        val symbols = all.filter { it.enabled && it.quoteAsset == quote }.map { it.symbol }
        feed.watch((_state.value.favorites + symbols).distinct().take(8))
        viewModelScope.launch { refreshTickers(symbols.take(60)) }
    }

    fun setSearch(text: String) = _state.update { it.copy(search = text) }

    fun toggleFavoritesOnly() = _state.update { it.copy(showFavoritesOnly = !it.showFavoritesOnly) }

    fun setSort(sort: String) = _state.update { it.copy(sortBy = sort) }

    fun refreshAll() {
        load()
        val symbols = _state.value.pairs.data?.symbols?.filter { it.enabled }?.map { it.symbol } ?: return
        viewModelScope.launch { refreshTickers(symbols.take(60)) }
    }
}
