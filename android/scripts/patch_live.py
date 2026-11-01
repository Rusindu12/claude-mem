#!/usr/bin/env python3
"""Patch app/src/main/assets/index.html with the live-trading v2 upgrade.

Idempotent: running it twice changes nothing. It
  1. replaces the old LIVE TRADING section with ../patches/live_engine.js
  2. rewires placeOrder / bot live entries / paintTrade / settings buttons
  3. adds the Live safety + live positions + request log UI
  4. starts the live ticker in init()

Usage: python3 scripts/patch_live.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "app", "src", "main", "assets", "index.html")
ENGINE = os.path.join(ROOT, "patches", "live_engine.js")

START = "/* ============================================================================\n * LIVE TRADING"
END_MARKER = "/* ============================================================================\n * UI — trade tab"


def sub_once(text, old, new, label):
    if old not in text:
        sys.exit("patch anchor missing: " + label)
    return text.replace(old, new, 1)


def main():
    html = open(HTML, encoding="utf-8").read()
    if "LIVE TRADING ENGINE v2" in html:
        print("already patched — nothing to do")
        return
    engine = open(ENGINE, encoding="utf-8").read()

    # 1. swap the engine block
    i = html.index(START)
    j = html.index(END_MARKER)
    html = html[:i] + engine + "\n" + html[j:]

    # 2. trade tab markup ----------------------------------------------------
    html = sub_once(html,
        '''      <div class="card mt" id="balCard"><h3 data-i18n="trade.balance">Balance</h3><div id="balBody"></div></div>''',
        '''      <div class="card mt" id="balCard"><h3 data-i18n="trade.balance">Balance</h3>
        <div class="small mut" id="liveStatus" style="margin:-4px 0 8px"></div><div id="balBody"></div></div>''',
        "balance card")

    html = sub_once(html,
        '''      <div class="card"><h3 id="posTitle" data-i18n="trade.pos">Positions</h3><div id="posList"></div></div>''',
        '''      <div class="card" id="liveSafetyCard" style="display:none">
        <h3>🛡 Live safety</h3>
        <div id="liveSafety"></div>
      </div>
      <div class="card"><h3 id="posTitle" data-i18n="trade.pos">Positions</h3><div id="posList"></div></div>''',
        "positions card")

    html = sub_once(html,
        '''      <div class="card"><h3 data-i18n="trade.history">History</h3><div id="histList"></div></div>
    </section>''',
        '''      <div class="card"><h3 data-i18n="trade.history">History</h3><div id="histList"></div></div>
      <div class="card" id="liveLogCard" style="display:none">
        <div class="row between"><h3 style="margin:0">📡 Live requests</h3>
          <button class="btn ghost sm" id="liveLogClear">clear</button></div>
        <div id="liveLog" class="mt"></div>
      </div>
    </section>''',
        "history card")

    # 3. paintTrade tail -----------------------------------------------------
    html = sub_once(html,
        '''  paintBalances();
  paintPositions();
  paintOrders();
  paintHistory();
  updateOrderEst();
}''',
        '''  $("liveSafetyCard").style.display = live ? "block" : "none";
  $("liveLogCard").style.display = live ? "block" : "none";
  if (live) { liveDefaults(); paintLiveStatus(); paintLiveSafety(); paintLiveLog(); }
  paintBalances();
  paintPositions();
  paintOrders();
  paintHistory();
  updateOrderEst();
  if (live && canTradeLive()) liveSync(false);
}''',
        "paintTrade tail")

    # 4. throttled balance refresh -> live sync -----------------------------
    html = sub_once(html,
        '''function paintBalancesThrottled() {
  if (state.settings.liveMode !== "live") { paintBalances(); return; }
  if (now() - lastBalFetch < 15000) return;
  lastBalFetch = now();
  paintBalances();
}''',
        '''function paintBalancesThrottled() {
  if (state.settings.liveMode !== "live") { paintBalances(); return; }
  if (now() - lastBalFetch < 15000) return;
  lastBalFetch = now();
  liveSync(false);
}''',
        "balances throttled")

    # 5. live balances view --------------------------------------------------
    html = sub_once(html,
        '''  if (!canTradeLive()) { box.innerHTML = '<div class="hint">' + t("trade.browserNote") + "</div>"; return; }
  box.innerHTML = '<div class="hint"><span class="spinner"></span> …</div>';
  try {
    const bal = await liveBalances();
    const base = state.sym.replace("USDT", "");
    const usdt = bal.USDT || { free: 0, locked: 0 };
    const b = bal[base] || { free: 0, locked: 0 };
    box.innerHTML = `
      <div class="grid3">
        <div><div class="small dim">USDT</div><div class="bb">${fmtUsd(usdt.free)}</div></div>
        <div><div class="small dim">${esc(base)}</div><div class="bb">${fmtQty(b.free)}</div></div>
        <div><div class="small dim">${liveEx()}</div><div class="bb small">${state.settings.testnet ? "testnet" : "mainnet"}</div></div>
      </div>`;
  } catch (e) {
    box.innerHTML = '<div class="hint dn">' + esc(e.message || "error") + "</div>";
  }
}''',
        '''  if (!canTradeLive()) { box.innerHTML = '<div class="hint">' + t("trade.browserNote") + "</div>"; return; }
  if (!LIVE.balances && !box.querySelector(".spinner")) {
    box.innerHTML = '<div class="hint"><span class="spinner"></span> …</div>';
  }
  try {
    if (!LIVE.balances || now() - LIVE.lastSync > 15000) await liveFetchBalances();
    const base = state.sym.replace("USDT", "");
    const usdt = LIVE.balances.USDT || { free: 0, locked: 0 };
    const b = LIVE.balances[base] || { free: 0, locked: 0 };
    const tk = state.tickers[state.sym] || { last: 0 };
    const pos = LIVE.positions.find((p) => p.sym === state.sym);
    const unreal = pos && tk.last ? (tk.last - pos.entry) * pos.qty : 0;
    const equity = (usdt.free + usdt.locked) + liveHoldings().reduce((sum, h) => sum + h.value, 0);
    box.innerHTML = `
      <div class="grid3">
        <div><div class="small dim">USDT free</div><div class="bb">${fmtUsd(usdt.free)}</div></div>
        <div><div class="small dim">${esc(base)} free</div><div class="bb">${fmtQty(b.free)}</div></div>
        <div><div class="small dim">equity ≈</div><div class="bb">${fmtUsd(equity)}</div></div>
      </div>
      <div class="small mut mt">${pos ? `tracked ${fmtQty(pos.qty)} @ ${fmtPrice(pos.entry)} · uPnL <span class="${unreal >= 0 ? "up" : "dn"}">${fmtUsd(unreal)}</span>` : "no tracked position on " + esc(state.sym)}
        · <span class="${LIVE.dayPnl >= 0 ? "up" : "dn"}">today ${fmtUsd(LIVE.dayPnl)}</span></div>`;
  } catch (e) {
    box.innerHTML = '<div class="hint dn">' + esc(e.message || "error") + "</div>";
    paintLiveStatus();
  }
}''',
        "live balances")

    # 6. live positions ------------------------------------------------------
    html = sub_once(html,
        '''  if (live) { box.innerHTML = '<div class="hint">' + t("trade.liveNote") + ' <span class="mut">(' + t("trade.none") + ")</span></div>"; return; }''',
        '''  if (live) { paintLivePositions(); return; }''',
        "live positions")

    # 7. order flow ----------------------------------------------------------
    old_doit = '''  const doIt = async () => {
    try {
      if (live) {
        const r = await livePlaceOrder(state.sym, side, qty, price, isLimit ? "LIMIT" : "MARKET");
        toast(t("trade.placed") + " · " + (r.orderId ? "#" + String(r.orderId).slice(0, 8) : t("ok")), "ok");
        notify(t("trade.placed"), `${side} ${fmtQty(qty)} ${state.sym}`, "ok");
        setTimeout(() => { paintBalances(); refreshLiveOrders(); }, 900);
      } else if (isLimit) {'''
    new_doit = '''  const doIt = async () => {
    try {
      if (live) {
        const f = liveFilter(state.sym);
        const pctTp = tp ? price * (1 + tp / 100) : 0;
        const pctSl = sl ? price * (1 - sl / 100) : 0;
        const out = await liveSubmit({
          sym: state.sym, side, type: isLimit ? "LIMIT" : "MARKET",
          qty, price, tp: side === "BUY" ? pctTp : 0, sl: side === "BUY" ? pctSl : 0, src: "manual",
        });
        toast(t("trade.placed") + " · " + side + " " + fmtQty(out.qty) + " @ " + fmtPrice(out.avg) +
          (out.fee ? " · fee " + fmtUsd(out.fee) : ""), "ok");
        notify(t("trade.placed"), `${side} ${fmtQty(out.qty)} ${state.sym.replace("USDT", "/USDT")} @ ${fmtPrice(out.avg)}`, "ok");
        haptic(35);
        await liveSync(true).catch(() => { });
        paintTrade();
      } else if (isLimit) {'''
    html = sub_once(html, old_doit, new_doit, "placeOrder live branch")

    html = sub_once(html,
        '''  if (live) {
    openOk(t("trade.confirmLive"),
      `<b>${side}</b> ${fmtQty(qty)} ${esc(state.sym.replace("USDT", "/USDT"))}<br>${isLimit ? "limit" : "market"} · ≈ ${fmtUsd(qty * price)}<br>
       <span class="dn">${t("trade.liveNote")}</span>`, doIt);
  } else {
    doIt();
  }''',
        '''  if (live) {
    const f = liveFilter(state.sym);
    const details = `
      <b>${side}</b> ${fmtQty(liveRoundQty(qty, f))} ${esc(state.sym.replace("USDT", "/USDT"))}<br>
      ${isLimit ? "limit @" + fmtPrice(liveRoundPrice(price, f)) : "market"} · ≈ ${fmtUsd(qty * price)}<br>
      ${tp ? "TP " + fmtPrice(price * (1 + tp / 100)) + " · " : ""}${sl ? "SL " + fmtPrice(price * (1 - sl / 100)) + " · " : ""}
      fee ≈ ${fmtUsd(qty * price * liveFeePct())}<br>
      <span class="dn">${t("trade.liveNote")}</span> ${state.settings.testnet ? "<span class='gold'>(testnet)</span>" : "<b class='dn'>(MAINNET)</b>"}`;
    if (state.settings.liveConfirm === false) doIt();
    else openOk(t("trade.confirmLive"), details, doIt);
  } else {
    doIt();
  }''',
        "confirm sheet")

    # 8. live open orders ----------------------------------------------------
    html = sub_once(html,
        '''async function refreshLiveOrders() {
  if (state.settings.liveMode !== "live" || !canTradeLive()) return;
  try { state.toOpenOrders = await liveOpenOrders(); paintOrders(); } catch (e) { }
}''',
        '''async function refreshLiveOrders() {
  if (state.settings.liveMode !== "live" || !canTradeLive()) return;
  try { await liveSyncOrders(); } catch (e) { liveLog("bad", "orders: " + e.message, {}); }
}''',
        "refreshLiveOrders")

    # 9. live history --------------------------------------------------------
    html = sub_once(html,
        '''function paintHistory() {
  const box = $("histList");
  const h = paper().history.slice(0, 25);''',
        '''function paintHistory() {
  const box = $("histList");
  const live = state.settings.liveMode === "live";
  const h = (live ? LIVE.history : paper().history).slice(0, 25);''',
        "paintHistory head")
    html = sub_once(html,
        '''      <span class="mono mut">${fmtQty(x.qty)} @ ${fmtPrice(x.price)}</span>
      <span class="${x.pnl == null ? "dim" : x.pnl >= 0 ? "up" : "dn"} mono">${x.pnl == null ? "—" : fmtUsd(x.pnl)}</span>''',
        '''      <span class="mono mut">${fmtQty(x.qty)} @ ${fmtPrice(x.price)}${x.fee ? ' <span class="tiny dim">fee ' + fmtUsd(x.fee) + "</span>" : ""}</span>
      <span class="${x.pnl == null ? "dim" : x.pnl >= 0 ? "up" : "dn"} mono">${x.pnl == null ? "—" : fmtUsd(x.pnl)}</span>''',
        "paintHistory row")

    # 10. bot live branch ----------------------------------------------------
    old_bot = '''  if (state.settings.liveMode === "live" && canTradeLive()) {
    if (bias < 0) { logLine("spot live mode is long-only — short skipped", "warn"); return; }
    const qty = cfg.size / price;
    const res = await livePlaceOrder(sym, "BUY", qty, price, "MARKET");
    const f = await qtyFilter(sym);
    const q = roundQty(qty, f);
    (b.livePos = b.livePos || []).push({ sym, qty: q, entry: price, tp: price * (1 + cfg.tp / 100), sl: price * (1 - cfg.sl / 100), ts: now(), id: res.orderId || uid() });
    b.lastEntry[sym] = now();
    notify(t("trade.placed"), `LIVE BUY ${fmtQty(q)} ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(price)}`, "ok");
    logLine(`live buy ${fmtQty(q)} ${sym} @ ${fmtPrice(price)}`, "ok");
    return;
  }'''
    new_bot = '''  if (state.settings.liveMode === "live" && canTradeLive()) {
    if (bias < 0) { logLine("spot live mode is long-only — short skipped", "warn"); return; }
    if (LIVE.halted) { logLine("live trading paused by the daily loss stop", "warn"); return; }
    if (LIVE.positions.some((p) => p.sym === sym)) { logLine(sym + " already held live — waiting for TP/SL", ""); return; }
    const heldLive = LIVE.positions.length;
    if (heldLive >= cfg.maxPos) { logLine("live max positions reached (" + cfg.maxPos + ")", "warn"); return; }
    try {
      await liveSync(false);
      const out = await liveSubmit({
        sym, side: "BUY", type: "MARKET", qty: cfg.size / price,
        tp: price * (1 + cfg.tp / 100), sl: price * (1 - cfg.sl / 100), src: "bot",
      });
      b.lastEntry[sym] = now();
      notify(t("trade.placed"), `LIVE BUY ${fmtQty(out.qty)} ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(out.avg)}\\nTP ${fmtPrice(price * (1 + cfg.tp / 100))} · SL ${fmtPrice(price * (1 - cfg.sl / 100))}`, "ok");
      logLine(`live buy ${fmtQty(out.qty)} ${sym} @ ${fmtPrice(out.avg)}`, "ok");
    } catch (e) {
      logLine("live buy failed: " + e.message, "bad");
    }
    return;
  }'''
    html = sub_once(html, old_bot, new_bot, "bot live branch")

    # 11. bot tick exit (live TP/SL is handled by liveTick) ------------------
    html = sub_once(html,
        '''function botOnTick(sym, price) {
  const b = bot();
  if (!b.running || !b.livePos || !b.livePos.length) return;''',
        '''function botOnTick(sym, price) {
  const b = bot();
  if (state.settings.liveMode === "live") return; // live TP/SL runs in liveTick()
  if (!b.running || !b.livePos || !b.livePos.length) return;''',
        "botOnTick guard")

    # 12. key buttons --------------------------------------------------------
    html = sub_once(html,
        '''    $("setKey").value = ""; $("setSecret").value = "";
    toast(t("set.keySaved"), "ok"); paintKeyStatus();
  };
  $("setTestKeys").onclick = testKeys;
  $("setClearKeys").onclick = () => {
    bc(liveEx() + "ClearKeys"); toast(t("saved"), "ok"); paintKeyStatus();
  };''',
        '''    $("setKey").value = ""; $("setSecret").value = "";
    toast(t("set.keySaved"), "ok"); paintKeyStatus();
    LIVE.status = Object.assign(LIVE.status, { ok: false, msg: "keys saved — test the connection" });
    if (state.settings.liveMode === "live") { LIVE.lastSync = 0; liveResume(); liveTestKeys(); }
  };
  $("setTestKeys").onclick = () => liveTestKeys();
  $("setClearKeys").onclick = () => {
    bc(liveEx() + "ClearKeys"); toast(t("saved"), "ok"); paintKeyStatus();
    LIVE.balances = null; LIVE.positions = []; LIVE.status = { ok: false, msg: "keys deleted", latency: 0 };
    saveLive();
    if (state.tab === "trade") paintTrade();
  };
  if ($("setTestnet")) {
    $("setTestnet").addEventListener("click", () => {
      LIVE.balances = null; LIVE.filters = {};
      LIVE.status = Object.assign(LIVE.status, { ok: false, msg: "mode changed — test the connection" });
    });
  }''',
        "settings buttons")

    # 13. mode switch --------------------------------------------------------
    html = sub_once(html,
        '''    state.settings.liveMode = b.dataset.mode; save();''',
        '''    state.settings.liveMode = b.dataset.mode; save();
    if (state.settings.liveMode === "live") { liveDefaults(); LIVE.lastSync = 0; liveSync(true); }''',
        "mode switch")

    # 14. replace testKeys with the richer version ---------------------------
    old_test = re.search(r'async function testKeys\(\) \{.*?\n\}\n', html, re.S)
    if old_test:
        html = html[:old_test.start()] + "async function testKeys() { return liveTestKeys(); }\n" + html[old_test.end():]

    # 15. init wiring --------------------------------------------------------
    html = sub_once(html,
        '''  setInterval(paintTickerStrip, 4000);''',
        '''  setInterval(paintTickerStrip, 4000);
  loadLive(); liveDefaults(); paintLiveStatus();
  $("liveLogClear").onclick = () => { LIVE.log = []; paintLiveLog(); };
  // live position autopilot (TP/SL, balance + order sync)
  setInterval(() => { if (document.hidden) return; liveTick().catch(() => { }); }, 15000);
  // refresh the live trade view while it is open
  setInterval(() => {
    if (document.hidden || state.tab !== "trade" || !liveOn()) return;
    liveSync(false);
  }, 25000);''',
        "init interval")

    open(HTML, "w", encoding="utf-8").write(html)
    print("patched", HTML)


if __name__ == "__main__":
    main()
