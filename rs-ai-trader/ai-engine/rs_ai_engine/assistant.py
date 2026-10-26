"""Grounded bilingual (English / Sinhala) market assistant.

Why rule-based first
--------------------
A free-form LLM will happily invent a balance or a fill. The default assistant
therefore builds every answer from *structured facts supplied by the backend*
(signal, portfolio snapshot, performance metrics, app help). Numbers are
inserted from those facts, never generated.

An optional LLM polish step exists (:class:`LlmPolisher`) but it is:
* disabled unless ``ASSISTANT_LLM_ENABLED=true`` and an API key is configured;
* given only the already-computed fact block;
* rejected unless every number in the reply appears in the fact block.

Language handling: the caller passes an explicit ``lang`` (``en``/``si``) from
the app's locale, or we detect Sinhala script / transliterated keywords. The
Sinhala strings live in :data:`SI` so translators can review them in one place.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


@dataclass
class AssistantContext:
    # ``None`` means "detect from the question"; pass "en"/"si" to force.
    lang: str | None = None
    symbol: str | None = None
    timeframe: str | None = None
    signal: dict[str, Any] | None = None
    indicators: dict[str, Any] | None = None
    regime: dict[str, Any] | None = None
    portfolio: dict[str, Any] | None = None
    performance: dict[str, Any] | None = None
    market_status: dict[str, Any] | None = None
    data_timestamp: str | None = None
    data_is_stale: bool = False
    allowed_topics: tuple[str, ...] = (
        "indicators",
        "market",
        "signal",
        "portfolio",
        "performance",
        "app",
        "risk",
        "safety",
        "orders",
    )
    extra_facts: dict[str, Any] = field(default_factory=dict)


@dataclass
class AssistantAnswer:
    intent: str
    lang: str
    text: str
    facts_used: dict[str, Any]
    data_as_of: str | None
    limitations: list[str]
    refused: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "lang": self.lang,
            "text": self.text,
            "facts_used": self.facts_used,
            "data_as_of": self.data_as_of,
            "limitations": self.limitations,
            "refused": self.refused,
        }


SI = {
    "stale": "අවසන් වූ මිල දත්ත පැරණි බැවින් මෙම පිළිතුර සීමිතය. නැවුම් දත්ත සඳහා නැවත උත්සාහ කරන්න.",
    "no_data": "මට එම තොරතුරු ලබාගත නොහැක. ගිණුම් ශේෂ හෝ ඇණවුම් මම නිර්මාණය නොකරමි.",
    "indicator_intro": "තාක්ෂණික දර්ශක මිල චලනය විස්තර කිරීමට උපකාරී වේ, නමුත් අනාගතය පුරෝකථනය කළ නොහැක.",
    "rsi": "RSI 70 ට වැඩි නම් අධික මිලදී ගැනීමක් (overbought), 30 ට අඩු නම් අධික විකිණීමක් (oversold) ලෙස සැලකේ.",
    "macd": "MACD රේඛාව සංඥා රේඛාවට ඉහළින් තිබීම ධනාත්මක චලනයක් පෙන්වයි; එය සහතිකයක් නොවේ.",
    "signal": "සංඥාව පදනම් වන්නේ දර්ශක කිහිපයක එකඟතාවය මත ය. දත්ත ප්‍රමාණවත් නොවේ නම් HOLD ලෙස පවසනු ලැබේ.",
    "risk": "ලාභය සහතික නොවේ. stop-loss හිමිකම් සුරක්ෂිතභාවයක් නොවේ; slippage නිසා ඊට වඩා අලාභ විය හැක.",
    "disclaimer": "මෙය මූල්‍ය උපදෙස් නොවේ.",
    "no_orders": "මගේ AI සහායකයාට ඇණවුම් තැබීමට හෝ අවලංගු කිරීමට නොහැක. ඔබ එය අතින් අනුමත කළ යුතුය.",
}

EN = {
    "stale": "Market data is stale, so this answer is limited. Refresh for current numbers.",
    "no_data": "I do not have that information. I never invent balances or orders.",
    "indicator_intro": "Technical indicators describe past price behaviour; they do not predict the future.",
    "rsi": "RSI above 70 is usually read as overbought, below 30 as oversold. Both can persist in strong trends.",
    "macd": "MACD above its signal line suggests positive momentum, but it is not a guarantee.",
    "signal": "The signal needs several indicators to agree. When evidence is weak the engine says HOLD.",
    "risk": "Profit is not guaranteed. A stop-loss is not a guarantee: slippage and gaps can exceed it.",
    "disclaimer": "This is not financial advice.",
    "no_orders": "I cannot place or cancel orders. You must approve every trade yourself.",
}

SINHALA_RE = re.compile(r"[\u0D80-\u0DFF]")

# Requests to actually execute something. The assistant never does; it says so
# explicitly instead of quietly answering a different question.
ORDER_ACTION_RE = re.compile(
    r"(?i)(\b(buy|sell)\b[^.?!]{0,24}\bfor me\b)"
    r"|(\b(place|submit|execute|cancel)\b[^.?!]{0,24}\border\b)"
    r"|(\b(buy|sell)\s+(now|it|some)\b)"
    r"|(\b(ඇණවුම\w*\s*(දමන්න|කරන්න)))"
)
SI_KEYWORDS = ("සංඥා", "මිල", "ගිණුම", "අවදානම", "RSI", "දර්ශක", "ලාභ", "පාඩු")


@dataclass
class _Intent:
    name: str
    patterns: tuple[str, ...]


INTENTS: tuple[_Intent, ...] = (
    _Intent("signal", ("signal", "buy", "sell", "hold", "should i", "trade idea", "සංඥා", "මිලදී", "විකිණීම")),
    _Intent("indicators", ("rsi", "macd", "ema", "sma", "bollinger", "atr", "adx", "indicator", "දර්ශක")),
    _Intent("market", ("market", "price", "trend", "regime", "volatility", "මිල", "වෙළඳපොල")),
    _Intent("portfolio", ("balance", "portfolio", "holdings", "position", "ගිණුම", "ශේෂ")),
    _Intent("performance", ("performance", "pnl", "profit", "loss", "drawdown", "win rate", "ලාභ", "පාඩු")),
    _Intent("orders", ("order", "fill", "cancel", "execution", "ඇණවුම")),
    _Intent("risk", ("risk", "stop", "slippage", "safety", "අවදානම", "stop loss")),
    _Intent("app", ("how do i", "where is", "app", "screen", "setting", "enable", "paper", "testnet")),
)


def detect_lang(question: str, requested: str | None = None) -> str:
    if requested in ("en", "si"):
        return requested
    if SINHALA_RE.search(question):
        return "si"
    if any(k in question for k in SI_KEYWORDS) and not re.search(r"[a-zA-Z]{4,}", question or ""):
        return "si"
    return "en"


def classify_intent(question: str) -> str:
    lowered = (question or "").lower()
    best, best_hits = "app", 0
    for intent in INTENTS:
        hits = sum(1 for pattern in intent.patterns if pattern in lowered)
        if hits > best_hits:
            best, best_hits = intent.name, hits
    return best if best_hits else "app"


def _t(lang: str, key: str) -> str:
    return (SI if lang == "si" else EN)[key]


def _fmt(value: Any, digits: int = 4, suffix: str = "") -> str:
    if value is None:
        return "n/a"
    if isinstance(value, (int, float)):
        return f"{value:,.{digits}f}{suffix}"
    return str(value)


def _signal_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    facts: dict[str, Any] = {}
    limits: list[str] = []
    if not ctx.signal:
        limits.append("no signal is available for this pair/timeframe yet")
        return _t(lang, "no_data"), facts, limits
    signal = ctx.signal
    facts.update(
        {
            "symbol": signal.get("symbol"),
            "timeframe": signal.get("timeframe"),
            "action": signal.get("action"),
            "score": signal.get("score"),
            "price": signal.get("price"),
            "model_status": signal.get("model_status"),
            "probability_up": signal.get("probability_up"),
        }
    )
    reasons = signal.get("reasons") or []
    top_reasons = "; ".join(reasons[:4]) if reasons else "no factors listed"
    if lang == "si":
        text = (
            f"{signal.get('symbol')} ({signal.get('timeframe')}) සඳහා වත්මන් විශ්ලේෂණය: "
            f"{signal.get('action')}. මිල {_fmt(signal.get('price'))}. "
            f"ප්‍රධාන හේතු: {top_reasons}. "
            f"{_t(lang, 'signal')}"
        )
    else:
        text = (
            f"Current read for {signal.get('symbol')} on {signal.get('timeframe')}: "
            f"{signal.get('action')} at {_fmt(signal.get('price'))}. "
            f"Main evidence: {top_reasons}. "
            f"Timestamps: signal generated {signal.get('generated_at')}."
        )
    probability = signal.get("probability_up")
    if probability is None:
        limits.append(
            f"no calibrated probability is shown (model status: {signal.get('model_status')}); "
            "only rule-based evidence is available"
        )
    if signal.get("action") in ("BUY", "SELL"):
        text += (
            f" Entry {_fmt(signal.get('entry_low'))}–{_fmt(signal.get('entry_high'))}, "
            f"stop {_fmt(signal.get('stop_loss'))}, target {_fmt(signal.get('take_profit'))}, "
            f"R:R {_fmt(signal.get('risk_reward'), 2)}."
        )
    text += " " + _t(lang, "risk")
    return text, facts, limits


def _indicators_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    snap = ctx.indicators or (ctx.signal or {}).get("indicators") or {}
    if not snap:
        return _t(lang, "no_data"), {}, ["indicator snapshot unavailable"]
    facts = {
        key: snap.get(key)
        for key in ("price", "rsi_14", "macd", "macd_signal", "macd_hist", "ema_21", "sma_50", "atr_14", "adx_14", "bb_percent_b")
    }
    rsi_value = snap.get("rsi_14")
    if lang == "si":
        text = (
            f"{_t(lang, 'indicator_intro')} RSI {_fmt(rsi_value, 1)}, "
            f"MACD {_fmt(snap.get('macd'))} සහ සංඥා රේඛාව {_fmt(snap.get('macd_signal'))}, "
            f"ADX {_fmt(snap.get('adx_14'), 1)}, ATR {_fmt(snap.get('atr_14'))}. "
            f"{_t(lang, 'rsi')}"
        )
    else:
        text = (
            f"{_t(lang, 'indicator_intro')} RSI(14) is {_fmt(rsi_value, 1)}, "
            f"MACD {_fmt(snap.get('macd'))} versus signal {_fmt(snap.get('macd_signal'))}, "
            f"ADX {_fmt(snap.get('adx_14'), 1)}, ATR(14) {_fmt(snap.get('atr_14'))} "
            f"(Bollinger %B {_fmt(snap.get('bb_percent_b'), 2)}). {_t(lang, 'rsi')} {_t(lang, 'macd')}"
        )
    return text, facts, []


def _market_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    regime = ctx.regime or {}
    if not regime:
        return _t(lang, "no_data"), {}, ["regime classification unavailable"]
    facts = {"regime": regime.get("label"), "volatility_state": regime.get("volatility_state"), "trend_strength": regime.get("trend_strength")}
    reasons = "; ".join(regime.get("reasons") or []) or "no regime reasons recorded"
    if lang == "si":
        text = (
            f"වත්මන් තත්ත්වය {regime.get('label')} ලෙස වර්ගීකරණය වේ. "
            f"අවදානම් මට්ටම {regime.get('volatility_state')}. විස්තර: {reasons}."
        )
    else:
        text = (
            f"The regime is classified as {regime.get('label')} with {regime.get('volatility_state')} volatility. "
            f"Reasons: {reasons}."
        )
    return text, facts, []


def _portfolio_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    if not ctx.portfolio:
        return _t(lang, "no_data"), {}, ["portfolio data not supplied to the assistant"]
    p = ctx.portfolio
    facts = {
        "mode": p.get("mode"),
        "total_value_usdt": p.get("total_value_usdt"),
        "available_usdt": p.get("available_usdt"),
        "realized_pnl": p.get("realized_pnl"),
        "unrealized_pnl": p.get("unrealized_pnl"),
    }
    mode_label = p.get("mode") or "unknown"
    if lang == "si":
        text = (
            f"{mode_label} මුදල් පසුම්බියේ මුළු වටිනාකම {_fmt(p.get('total_value_usdt'), 2)} USDT. "
            f"ලබාගත හැකි මුදල {_fmt(p.get('available_usdt'), 2)} USDT. "
            f"අවබෝධ කරගත් ලාභ/පාඩුව {_fmt(p.get('realized_pnl'), 2)} USDT."
        )
    else:
        text = (
            f"The {mode_label} portfolio is worth {_fmt(p.get('total_value_usdt'), 2)} USDT with "
            f"{_fmt(p.get('available_usdt'), 2)} USDT available. Realised P/L is "
            f"{_fmt(p.get('realized_pnl'), 2)} USDT and unrealised P/L is "
            f"{_fmt(p.get('unrealized_pnl'), 2)} USDT."
        )
    if mode_label != "live":
        text += (
            " මෙය අනුකරණය කළ දත්තයකි." if lang == "si" else " These numbers are simulated, not exchange balances."
        )
    return text, facts, []


def _performance_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    if not ctx.performance:
        return _t(lang, "no_data"), {}, ["performance data not supplied"]
    m = ctx.performance
    facts = {k: m.get(k) for k in ("total_return_pct", "max_drawdown_pct", "win_rate_pct", "trade_count", "profit_factor", "fees_and_slippage_paid")}
    limits: list[str] = []
    if (m.get("trade_count") or 0) < 10:
        limits.append("fewer than 10 trades: these statistics are not statistically meaningful")
    text = (
        f"Performance: net return {_fmt(m.get('total_return_pct'), 2, '%')}, "
        f"max drawdown {_fmt(m.get('max_drawdown_pct'), 2, '%')}, win rate "
        f"{_fmt(m.get('win_rate_pct'), 1, '%')} across {m.get('trade_count')} trades, "
        f"fees and slippage {_fmt(m.get('fees_and_slippage_paid'), 2)} USDT. "
        "All figures are net of the stated costs."
    )
    if lang == "si":
        text = (
            f"කාර්ය සාධනය: ශුද්ධ ප්‍රතිලාභය {_fmt(m.get('total_return_pct'), 2, '%')}, "
            f"උපරිම අවපාතය {_fmt(m.get('max_drawdown_pct'), 2, '%')}, "
            f"ජයග්‍රහණ අනුපාතය {_fmt(m.get('win_rate_pct'), 1, '%')} (වෙළඳාම් {m.get('trade_count')}). "
            "මේවා ගාස්තු ඇතුළත් ශුද්ධ සංඛ්‍යා වේ."
        )
    return text, facts, limits


def _orders_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    text = _t(lang, "no_orders")
    orders = ctx.extra_facts.get("open_orders")
    facts: dict[str, Any] = {}
    if isinstance(orders, list):
        facts["open_orders"] = len(orders)
        text += (
            f" ඔබට විවෘත ඇණවුම් {len(orders)} ක් ඇත." if lang == "si" else f" You currently have {len(orders)} open order(s)."
        )
    return text, facts, ["order data is read-only in the assistant"]


def _risk_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    if lang == "si":
        text = (
            f"{_t(lang, 'risk')} අවදානම් සීමා: උපරිම වෙළඳාම් ප්‍රමාණය, දෛනික අලාභ සීමාව සහ "
            "නව ඇණවුම් නතර කරන kill switch backend තුළ ක්‍රියාත්මක වේ."
        )
    else:
        text = (
            f"{_t(lang, 'risk')} Risk limits (max trade size, daily loss cap, exposure cap, "
            "duplicate-order prevention and a kill switch) are enforced by the backend, "
            "not by the phone, so a modified app cannot bypass them."
        )
    return text, {"limits_enforced_server_side": True}, []


APP_HELP = {
    "paper": "Open the Trading Terminal and switch the mode selector to Paper. Simulated fills use live prices with the configured fee and slippage model.",
    "live": "Live Spot trading is off by default. Settings → Live trading requires an explicit opt-in, a typed confirmation phrase, configured risk limits, and an exchange key with withdrawals disabled.",
    "testnet": "Set BINANCE_ENV=testnet in the backend .env and add Testnet keys. The app shows a TESTNET badge whenever the backend is pointed at the sandbox.",
    "alerts": "Price alerts are created from the Alerts screen. They are evaluated server-side against the live websocket price feed.",
    "language": "The assistant follows your app language. Switch EN/සිංහල in the assistant header.",
}


def _app_text(ctx: AssistantContext, lang: str) -> tuple[str, dict, list[str]]:
    facts = {"topics": list(ctx.allowed_topics), "help_topics": list(APP_HELP)}
    if lang == "si":
        text = (
            "RS AI TRADER යෙදුමේ මෙනුවෙන් Dashboard, Markets, Chart, Signals, Trade, Portfolio, "
            "Backtest, Risk, Alerts සහ Settings තිබේ. Live trading සාමාන්‍යයෙන් අක්‍රීයයි. "
            "Paper trading සහ analysis-only ආකාර භාවිතා කර ආරක්ෂිතව පරීක්ෂා කරන්න."
        )
    else:
        text = (
            "RS AI TRADER has Dashboard, Markets, Chart, Signals, Trade, Portfolio, Backtest, Risk, "
            "Alerts and Settings screens. Analysis-only and paper modes are safe to explore; live Spot "
            "trading stays disabled until you opt in and confirm, and every order needs your approval."
        )
    return text, facts, []


_HANDLERS: dict[str, Callable[[AssistantContext, str], tuple[str, dict, list[str]]]] = {
    "signal": _signal_text,
    "indicators": _indicators_text,
    "market": _market_text,
    "portfolio": _portfolio_text,
    "performance": _performance_text,
    "orders": _orders_text,
    "risk": _risk_text,
    "app": _app_text,
}


class LlmPolisher(Protocol):
    """Optional interface: takes facts + draft, returns polished text."""

    def __call__(self, question: str, lang: str, facts: dict[str, Any], draft: str) -> str: ...


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def answer_question(
    question: str,
    ctx: AssistantContext | None = None,
    *,
    polisher: LlmPolisher | None = None,
) -> AssistantAnswer:
    ctx = ctx or AssistantContext()
    lang = detect_lang(question, ctx.lang)
    intent = classify_intent(question)
    limitations: list[str] = []

    if ctx.data_is_stale:
        limitations.append(_t(lang, "stale"))
    if intent not in ctx.allowed_topics:
        return AssistantAnswer(
            intent=intent,
            lang=lang,
            text=_t(lang, "no_data"),
            facts_used={},
            data_as_of=ctx.data_timestamp,
            limitations=limitations + [f"topic '{intent}' is outside this assistant's data scope"],
            refused=True,
        )

    handler = _HANDLERS.get(intent, _app_text)
    text, facts, extra_limits = handler(ctx, lang)
    limitations.extend(extra_limits)

    if ORDER_ACTION_RE.search(question):
        # Never imply the assistant can trade or bypass the approval flow.
        text = f"{text} {_t(lang, 'no_orders')}"
        limitations.append("the assistant cannot place, modify or cancel orders; approval is always manual")
    if ctx.data_timestamp:
        facts = dict(facts) | {"data_as_of": ctx.data_timestamp}

    if polisher is not None and facts:
        try:
            polished = polisher(question, lang, facts, text)
            allowed = _numbers(str(facts)) | _numbers(question) | _numbers(text)
            invented = _numbers(polished) - allowed
            if invented:
                limitations.append(
                    "A language-model rewrite was rejected because it introduced numbers not present in the data."
                )
            elif polished.strip():
                text = polished.strip()
        except Exception:  # pragma: no cover - never fail the request on polish
            limitations.append("Language-model rewrite failed; showing the data-grounded answer instead.")

    # Safety: never let generated prose claim a guaranteed profit.
    for banned in ("guaranteed profit", "risk-free profit", "sure win", "සහතික ලාභය"):
        if banned in text.lower():
            text = text.replace(banned, "")
            limitations.append("Unverifiable guarantee language was removed from the response.")

    text = f"{text} {_t(lang, 'disclaimer')}".strip()
    return AssistantAnswer(
        intent=intent,
        lang=lang,
        text=text,
        facts_used=facts,
        data_as_of=ctx.data_timestamp,
        limitations=limitations,
    )
