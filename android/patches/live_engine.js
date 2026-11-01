/* ============================================================================
 * LIVE TRADING ENGINE v2 — signed on-device by the Android bridge
 *   - one normalised request layer for Binance spot + Bybit v5 spot
 *   - exchange filters (step / tick / min notional) enforced before submit
 *   - idempotent submits (client order id), rate-limit aware retries
 *   - live spot positions with local entry price, TP/SL autopilot, fees & PnL
 *   - risk guards: max order size, daily loss stop, panic close-all
 *   - request log + latency + permission / clock-drift diagnostics
 * ========================================================================== */
const liveEx = () => (state.settings.exchange === "bybit" ? "bybit" : "binance");
const canTradeLive = () => hasBridge() && (state.settings.exchange === "binance" || state.settings.exchange === "bybit");
const liveOn = () => state.settings.liveMode === "live";

const LIVE = {
  filters: {},          // sym -> {step, dp, minQty, tick, priceDp, minNotional, base, quote}
  balances: null,       // {USDT:{free,locked}, BTC:{...}}
  positions: [],        // tracked live spot positions
  history: [],          // fills recorded by the app
  openOrders: [],
  log: [],              // {at, kind, msg, code, ms, ok}
  status: { ok: false, msg: "not connected", latency: 0, testnet: false, base: "", canTrade: null, canWithdraw: null, perms: null },
  weightUsed: 0,
  clockSkew: 0,
  busy: false,
  queue: Promise.resolve(),
  dayPnl: 0,
  dayKey: "",
  stats: { trades: 0, wins: 0, fees: 0, pnl: 0 },
  lastSync: 0,
};

function liveDefaults() {
  const s = state.settings;
  if (s.liveMaxUsdt == null) s.liveMaxUsdt = 100;
  if (s.liveDailyLoss == null) s.liveDailyLoss = 50;
  if (s.liveFeePct == null) s.liveFeePct = 0.1;
  if (s.liveAutoTpSl == null) s.liveAutoTpSl = true;
  if (s.liveConfirm == null) s.liveConfirm = true;
  if (s.liveTestnetWarn == null) s.liveTestnetWarn = true;
}

/* ------------------------------------------------------------- plumbing */
function liveLog(kind, msg, extra) {
  const row = Object.assign({ at: now(), kind, msg }, extra || {});
  LIVE.log.unshift(row);
  if (LIVE.log.length > 60) LIVE.log.pop();
  if (state.tab === "trade") paintLiveLog();
}

function liveParse(raw) {
  if (raw == null) return { ok: false, status: 0, code: "no_bridge", msg: t("live.unsupported") };
  let j = null;
  try { j = JSON.parse(String(raw)); } catch (e) { return { ok: false, status: 0, code: "bad_json", msg: String(raw).slice(0, 160) }; }
  if (j && j.error === true && !j.status) j.ok = false;
  return j || { ok: false, status: 0, code: "empty", msg: "empty reply" };
}

/** Human readable, actionable text for exchange errors. */
function liveErrText(e) {
  const code = String((e && e.code) || "");
  const ex = liveEx();
  const map = {
    "-2015": "API key / permission / IP problem — check the key's IP whitelist and enable Spot Trading",
    "-2010": "Order rejected by the exchange (balance, filters or duplicate)",
    "-1013": "Order below the exchange minimum notional",
    "-1021": "Device clock is out of sync — enable automatic date & time",
    "-1003": "Rate limited by the exchange — slowing down",
    "-1121": "Invalid symbol for this exchange",
    "-1100": "Bad order parameter",
    "10003": "Invalid API key for Bybit",
    "10004": "Signature error — re-save the API secret",
    "10006": "Rate limited by Bybit — slowing down",
    "10018": "Rate limited by Bybit",
    "110001": "Order not found (already filled or cancelled)",
    "170131": "Insufficient balance for this order",
    "170193": "Order quantity below the minimum",
    "170136": "Order value below the minimum",
  };
  const hint = map[code];
  const base = (e && (e.msg || e.message)) || "exchange error";
  return hint ? base + " · " + hint : base + (code ? " (code " + code + ")" : "");
}

async function liveRequest(method, path, params, opts) {
  const o = opts || {};
  const ex = liveEx();
  const t0 = now();
  let attempt = 0;
  let last = null;
  while (attempt < (o.retries == null ? 2 : o.retries) + 1) {
    const devNow = B && B.now ? Number(B.now()) : now();
    LIVE.clockSkew = devNow - now();
    const raw = bc("liveRequest", ex, method, path, JSON.stringify(params || {}));
    const r = liveParse(raw);
    const ms = now() - t0;
    LIVE.weightUsed = +(r.rateLimit || LIVE.weightUsed) || LIVE.weightUsed;
    last = r;
    if (r.ok) {
      if (!o.quiet) liveLog("ok", method + " " + path, { ms, code: r.code || "0" });
      return r;
    }
    const retryable = method === "GET" && (r.retryable || r.rateLimited || r.status === 0);
    liveLog("bad", method + " " + path + " · " + (r.msg || r.code || "error"), { ms, code: String(r.code || r.status || ""), ok: false });
    if (!retryable || attempt >= (o.retries == null ? 2 : o.retries)) break;
    const wait = Math.min(4000, (r.retryAfterMs > 0 ? r.retryAfterMs : 400 * Math.pow(2, attempt)) + Math.random() * 250);
    await sleep(wait);
    attempt++;
  }
  const err = new Error(liveErrText(last));
  Object.assign(err, last || {});
  throw err;
}

/** Serialise order submits so two trades can never race on the same symbol. */
function liveQueue(fn) {
  const run = LIVE.queue.then(fn, fn);
  LIVE.queue = run.catch(() => { });
  return run;
}

/* ---------------------------------------------------- instruments/filters */
const FILTER_TTL = 6 * 3600 * 1000;
async function loadFilters(symbols) {
  const ex = liveEx();
  const cache = LIVE.filterCache && LIVE.filterCache[ex];
  if (cache && now() - cache.at < FILTER_TTL) { LIVE.filters = cache.map; return LIVE.filters; }
  const map = {};
  try {
    if (ex === "binance") {
      const j = JSON.parse(await httpGet("https://api.binance.com/api/v3/exchangeInfo"));
      (j.symbols || []).forEach((s) => {
        if (s.status !== "TRADING" || !s.quoteAsset) return;
        if (!/USDT$/.test(s.symbol)) return;
        const lot = (s.filters || []).find((f) => f.filterType === "LOT_SIZE") || {};
        const pf = (s.filters || []).find((f) => f.filterType === "PRICE_FILTER") || {};
        const nt = (s.filters || []).find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") || {};
        const step = +(lot.stepSize || 0.000001);
        const tick = +(pf.tickSize || 0.000001);
        map[s.symbol] = {
          step, minQty: +(lot.minQty || 0), tick,
          minNotional: +(nt.minNotional || 0),
          dp: Math.max(0, Math.round(-Math.log10(step))),
          priceDp: Math.max(0, Math.round(-Math.log10(tick))),
          base: s.baseAsset, quote: s.quoteAsset,
        };
      });
    } else {
      let cursor = "";
      for (let page = 0; page < 4; page++) {
        const j = JSON.parse(await httpGet("https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000" + (cursor ? "&cursor=" + cursor : "")));
        const list = ((j.result || {}).list) || [];
        list.forEach((s) => {
          if (!/USDT$/.test(s.symbol)) return;
          const lot = s.lotSizeFilter || {};
          const pf = s.priceFilter || {};
          const step = +lot.basePrecision ? Math.pow(10, -+lot.basePrecision) : +(lot.qtyStep || 0.000001);
          const tick = +pf.tickSize || 0.000001;
          map[s.symbol] = {
            step, minQty: +(lot.minOrderQty || 0),
            minNotional: +(lot.minOrderAmt || 0),
            tick, dp: Math.max(0, Math.round(-Math.log10(step))),
            priceDp: Math.max(0, Math.round(-Math.log10(tick))),
            base: s.baseCoin, quote: s.quoteCoin,
          };
        });
        cursor = (j.result || {}).nextPageCursor || "";
        if (!cursor || list.length < 1000) break;
      }
    }
  } catch (e) {
    liveLog("bad", "instrument filters unavailable — using safe defaults", {});
  }
  if (!symbols) symbols = [state.sym].concat(WATCHLIST);
  symbols.forEach((s) => {
    if (!map[s]) {
      const base = s.replace(/USDT$/, "");
      map[s] = { step: 0.000001, minQty: 0, tick: 0.000001, minNotional: 5, dp: 6, priceDp: 6, base, quote: "USDT" };
    }
  });
  LIVE.filterCache = LIVE.filterCache || {};
  LIVE.filterCache[ex] = { at: now(), map };
  LIVE.filters = map;
  return map;
}

function liveFilter(sym) {
  return LIVE.filters[sym] || { step: 0.000001, minQty: 0, tick: 0.000001, minNotional: 5, dp: 6, priceDp: 6, base: sym.replace(/USDT$/, ""), quote: "USDT" };
}
function liveRoundQty(qty, f) {
  const s = f.step || 0.000001;
  const v = Math.floor((qty + 1e-12) / s) * s;
  return +v.toFixed(f.dp);
}
function liveRoundPrice(p, f) {
  const ts = f.tick || 0.000001;
  const v = Math.round(p / ts) * ts;
  return +v.toFixed(f.priceDp);
}
function liveFeePct() { return Math.max(0, Math.min(2, Number(state.settings.liveFeePct) || 0)) / 100; }

/* -------------------------------------------------------------- balances */
function liveFree(asset) {
  const b = LIVE.balances && LIVE.balances[asset];
  return b ? +b.free || 0 : 0;
}

async function liveFetchBalances() {
  const ex = liveEx();
  const out = {};
  if (ex === "binance") {
    const j = await liveRequest("GET", "/api/v3/account", {}, { quiet: true });
    (j.raw ? (JSON.parse(j.raw).balances || []) : []).forEach((b) => {
      if (+b.free || +b.locked) out[b.asset] = { free: +b.free, locked: +b.locked };
    });
    try {
      const acc = JSON.parse(j.raw);
      LIVE.status.canTrade = acc.canTrade;
      LIVE.status.canWithdraw = acc.canWithdraw;
      LIVE.status.perms = acc.permissions || null;
    } catch (e) { }
  } else {
    let j = await liveRequest("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" }, { quiet: true });
    let list = (((j.raw ? JSON.parse(j.raw) : {}).result || {}).list || [])[0];
    if (!list) {
      j = await liveRequest("GET", "/v5/account/wallet-balance", { accountType: "SPOT" }, { quiet: true });
      list = (((j.raw ? JSON.parse(j.raw) : {}).result || {}).list || [])[0];
    }
    ((list || {}).coin || []).forEach((c) => {
      const free = +(c.availableToWithdraw || c.walletBalance || 0);
      const total = +c.walletBalance || free;
      if (total || free) out[c.coin] = { free: free || total, locked: Math.max(0, total - (free || total)) };
    });
    try { LIVE.status.perms = ((list || {}).permissions) || null; } catch (e) { }
  }
  LIVE.balances = out;
  return out;
}

/* ------------------------------------------------------------- holdings */
function liveHoldings() {
  const bal = LIVE.balances || {};
  return Object.keys(bal)
    .filter((a) => a !== "USDT" && (+bal[a].free > 0 || +bal[a].locked > 0))
    .map((a) => {
      const sym = a + "USDT";
      const tk = state.tickers[sym] || {};
      const tracked = LIVE.positions.find((p) => p.sym === sym);
      const qty = +bal[a].free + +bal[a].locked;
      return {
        asset: a, sym, qty, free: +bal[a].free, locked: +bal[a].locked,
        entry: tracked ? tracked.entry : 0,
        tp: tracked ? tracked.tp : 0, sl: tracked ? tracked.sl : 0,
        id: tracked ? tracked.id : null,
        value: (tk.last || 0) * qty,
        pnl: tracked && tracked.entry ? (tk.last - tracked.entry) * qty : null,
        pnlPct: tracked && tracked.entry ? ((tk.last - tracked.entry) / tracked.entry) * 100 : null,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------ trade flow */
async function liveSubmit(order) {
  return liveQueue(async () => {
    liveDefaults();
    const ex = liveEx();
    const sym = order.sym;
    const side = order.side;
    const type = (order.type || "MARKET").toUpperCase();
    await loadFilters([sym]);
    const f = liveFilter(sym);
    const price = type === "LIMIT" ? liveRoundPrice(+order.price, f) : (state.tickers[sym] || {}).last || 0;
    const qty = liveRoundQty(+order.qty, f);
    if (!(qty > 0)) throw new Error("amount rounds to 0 — exchange step is " + f.step);
    if (f.minQty && qty < f.minQty) throw new Error("minimum quantity is " + f.minQty + " " + f.base);
    const notional = qty * (price || 1);
    if (f.minNotional && notional < f.minNotional) throw new Error("order value " + fmtUsd(notional) + " is below the " + f.minNotional + " USDT minimum");
    const maxUsdt = +state.settings.liveMaxUsdt || 0;
    if (maxUsdt > 0 && notional > maxUsdt) throw new Error("order " + fmtUsd(notional) + " exceeds your per-order limit (" + fmtUsd(maxUsdt) + ") — raise it in Live safety");

    if (side === "BUY") {
      const need = notional * (1 + liveFeePct());
      const freeU = liveFree("USDT");
      if (LIVE.balances && freeU && need > freeU) throw new Error("not enough USDT: need " + fmtUsd(need) + ", free " + fmtUsd(freeU));
    } else {
      const held = liveFree(f.base);
      if (LIVE.balances && held && qty > held + 1e-12) throw new Error("only " + fmtQty(held) + " " + f.base + " available to sell");
    }

    const clientId = order.clientId || (bc("clientOrderId", "cai") || uid());
    const params = ex === "binance"
      ? {
        symbol: sym, side, type, quantity: String(qty),
        newOrderRespType: "FULL", newClientOrderId: clientId,
      }
      : {
        category: "spot", symbol: sym, side: side === "BUY" ? "Buy" : "Sell",
        orderType: type === "LIMIT" ? "Limit" : "Market",
        qty: String(qty), orderLinkId: clientId,
      };
    if (type === "LIMIT") {
      if (ex === "binance") { params.price = String(price); params.timeInForce = "GTC"; }
      else { params.price = String(price); params.timeInForce = "GTC"; }
    }

    let res;
    try {
      res = await liveRequest("POST", ex === "binance" ? "/api/v3/order" : "/v5/order/create", params, { retries: 0 });
    } catch (e) {
      // a duplicate client id means our earlier retry actually went through — look it up
      if (/duplicate|already exists/i.test(e.message || "")) {
        const found = await liveFindByClientId(ex, sym, clientId);
        if (found) { res = found; liveLog("ok", "recovered duplicate order " + clientId, {}); }
        else throw e;
      } else throw e;
    }

    const filledQty = +res.execQty || qty;
    const avg = +(res.avgPrice || 0) || (res.cumQuote && filledQty ? res.cumQuote / filledQty : price) || price;
    const fee = (res.fills || []).reduce((sum, x) => sum + (x.commissionAsset === "USDT" ? +x.commission || 0 : 0), 0) || avg * filledQty * liveFeePct();

    LIVE.stats.trades++;
    LIVE.stats.fees += fee;
    if (!LIVE.dayKey || LIVE.dayKey !== dayKey()) { LIVE.dayKey = dayKey(); LIVE.dayPnl = 0; }

    if (side === "BUY" && (type === "MARKET" || res.orderStatus === "FILLED")) {
      const existing = LIVE.positions.find((p) => p.sym === sym);
      if (existing) {
        const totalQty = existing.qty + filledQty;
        existing.entry = (existing.entry * existing.qty + avg * filledQty) / totalQty;
        existing.qty = totalQty;
        existing.fees += fee;
      } else {
        LIVE.positions.push({
          id: clientId, sym, base: f.base, qty: filledQty, entry: avg,
          tp: order.tp ? liveRoundPrice(order.tp, f) : 0,
          sl: order.sl ? liveRoundPrice(order.sl, f) : 0,
          src: order.src || "manual", ts: now(), fees: fee, orderId: res.orderId || clientId,
        });
      }
    } else if (side === "SELL") {
      const pos = LIVE.positions.find((p) => p.sym === sym);
      if (pos) {
        const pnl = (avg - pos.entry) * filledQty - fee;
        const closed = pos.qty - filledQty;
        LIVE.history.unshift({
          at: now(), sym, side: "SELL", qty: filledQty, price: avg, pnl,
          notional: avg * filledQty, fee, orderId: res.orderId || clientId,
          reason: order.reason || "manual", mode: "live",
        });
        LIVE.stats.pnl += pnl;
        LIVE.dayPnl += pnl;
        if (pnl > 0) LIVE.stats.wins++;
        if (closed > 1e-9) pos.qty = closed; else LIVE.positions = LIVE.positions.filter((p) => p !== pos);
      } else {
        LIVE.history.unshift({ at: now(), sym, side: "SELL", qty: filledQty, price: avg, pnl: null, notional: avg * filledQty, fee, orderId: res.orderId || clientId, reason: order.reason || "manual", mode: "live" });
      }
    }
    if (LIVE.history.length > 80) LIVE.history.length = 80;
    save(); saveLive();
    liveLog("ok", `${side} ${type} ${fmtQty(filledQty)} ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(avg)}`, { ms: 0 });
    liveFetchBalances().catch(() => { });
    checkDailyLoss();
    return { res, qty: filledQty, avg, fee, notional: avg * filledQty };
  });
}

async function liveFindByClientId(ex, sym, clientId) {
  try {
    const j = ex === "binance"
      ? await liveRequest("GET", "/api/v3/order", { symbol: sym, origClientOrderId: clientId }, { quiet: true })
      : await liveRequest("GET", "/v5/order/history", { category: "spot", symbol: sym, orderLinkId: clientId }, { quiet: true });
    if (!j || !j.raw) return null;
    const raw = JSON.parse(j.raw);
    if (ex === "bybit") {
      const o = (((raw.result || {}).list) || [])[0];
      if (!o) return null;
      return { ok: true, orderId: o.orderId, execQty: o.cumExecQty, avgPrice: o.avgPrice, orderStatus: o.orderStatus, fills: [] };
    }
    return { ok: true, orderId: raw.orderId, execQty: raw.executedQty, avgPrice: raw.avgPrice, cumQuote: raw.cummulativeQuoteQty, orderStatus: raw.status, fills: raw.fills || [] };
  } catch (e) { return null; }
}

function checkDailyLoss() {
  const limit = +state.settings.liveDailyLoss || 0;
  if (!limit || LIVE.dayPnl > -Math.abs(limit)) return false;
  if (LIVE.halted) return true;
  LIVE.halted = true;
  if (state.bot && state.bot.running) botStop();
  notify("Daily loss limit reached", "-" + fmtUsd(Math.abs(LIVE.dayPnl)) + " today — live entries are paused. Review Live safety to resume.", "bad");
  liveLog("bad", "daily loss stop triggered (" + fmtUsd(LIVE.dayPnl) + ")", {});
  return true;
}
function liveResume() { LIVE.halted = false; LIVE.dayPnl = 0; LIVE.dayKey = dayKey(); saveLive(); paintLiveSafety(); }

/* ------------------------------------------------------------ cancel/sync */
async function liveCancel(sym, id) {
  const ex = liveEx();
  const params = ex === "binance" ? { symbol: sym, orderId: id } : { category: "spot", symbol: sym, orderId: id };
  await liveRequest(ex === "binance" ? "DELETE" : "POST", ex === "binance" ? "/api/v3/order" : "/v5/order/cancel", params, { retries: 0 });
  liveLog("ok", "cancel " + sym + " #" + id, {});
  await liveSyncOrders();
}

async function liveSyncOrders() {
  const ex = liveEx();
  const j = ex === "binance"
    ? await liveRequest("GET", "/api/v3/openOrders", {}, { quiet: true })
    : await liveRequest("GET", "/v5/order/realtime", { category: "spot", limit: "50" }, { quiet: true });
  let list = [];
  try {
    const raw = JSON.parse(j.raw);
    list = ex === "binance" ? (raw || []) : (((raw.result || {}).list) || []);
    if (!Array.isArray(list)) list = [];
  } catch (e) { list = []; }
  LIVE.openOrders = list.map((o) => ({
    id: ex === "binance" ? o.orderId : o.orderId,
    sym: o.symbol,
    side: ex === "binance" ? o.side : (o.side === "Buy" ? "BUY" : "SELL"),
    type: ex === "binance" ? o.type : o.orderType,
    qty: +(ex === "binance" ? o.origQty : o.qty),
    filled: +(ex === "binance" ? o.executedQty : o.cumExecQty) || 0,
    price: +(ex === "binance" ? o.price : o.price) || 0,
    ts: +(ex === "binance" ? o.time : o.createdTime) || now(),
  }));
  state.toOpenOrders = LIVE.openOrders;
  if (state.tab === "trade") paintOrders();
  return LIVE.openOrders;
}

async function liveSyncHistory() {
  const ex = liveEx();
  const syms = Array.from(new Set(LIVE.positions.map((p) => p.sym).concat([state.sym])));
  let added = 0;
  for (const sym of syms.slice(0, 4)) {
    try {
      const j = ex === "binance"
        ? await liveRequest("GET", "/api/v3/myTrades", { symbol: sym, limit: "50" }, { quiet: true })
        : await liveRequest("GET", "/v5/execution/list", { category: "spot", symbol: sym, limit: "50" }, { quiet: true });
      const raw = JSON.parse(j.raw);
      const fills = ex === "binance" ? (raw || []) : (((raw.result || {}).list) || []);
      if (!Array.isArray(fills)) continue;
      fills.forEach((x) => {
        const id = ex === "binance" ? String(x.id) : String(x.execId);
        if (LIVE.history.some((h) => h.tradeId === id)) return;
        LIVE.history.unshift({
          at: +(ex === "binance" ? x.time : x.execTime) || now(),
          sym, side: ex === "binance" ? x.side : (x.side === "Buy" ? "BUY" : "SELL"),
          qty: +(ex === "binance" ? x.qty : x.execQty),
          price: +(ex === "binance" ? x.price : x.execPrice),
          fee: +(ex === "binance" ? x.commission : (x.execFee || 0)) || 0,
          pnl: null, notional: 0, tradeId: id, mode: "live", reason: "exchange",
        });
        added++;
      });
    } catch (e) { /* symbol may not have trades */ }
  }
  LIVE.history.sort((a, b) => b.at - a.at);
  LIVE.history = LIVE.history.slice(0, 80);
  saveLive();
  if (state.tab === "trade") paintHistory();
  toast(added ? "+" + added + " fills synced" : "history up to date", added ? "ok" : "");
}

async function livePing() {
  const t0 = now();
  try {
    const ex = liveEx();
    const r = await liveRequest("GET", ex === "binance" ? "/api/v3/account" : "/v5/account/wallet-balance",
      ex === "binance" ? {} : { accountType: "UNIFIED" }, { quiet: true, retries: 0 });
    LIVE.status = Object.assign(LIVE.status, {
      ok: true, msg: "connected", latency: now() - t0, testnet: !!state.settings.testnet,
      base: state.settings.testnet ? "testnet" : "mainnet", canTrade: r.canTrade != null ? r.canTrade : LIVE.status.canTrade,
    });
    if (ex === "binance" && LIVE.status.canWithdraw) {
      liveLog("bad", "this API key can withdraw — remove the withdrawal permission", {});
    }
    return true;
  } catch (e) {
    LIVE.status = Object.assign(LIVE.status, { ok: false, msg: e.message || "not connected", latency: 0 });
    return false;
  } finally {
    if (state.tab === "trade") paintLiveStatus();
  }
}

async function liveSync(force) {
  if (!liveOn() || !canTradeLive()) return;
  if (!force && now() - LIVE.lastSync < 12000) return;
  LIVE.lastSync = now();
  try {
    await liveFetchBalances();
    await liveSyncOrders();
    LIVE.status.ok = true;
    LIVE.status.msg = "connected";
    if (!LIVE.filters[state.sym]) await loadFilters([state.sym]);
  } catch (e) {
    LIVE.status.ok = false;
    LIVE.status.msg = e.message || "sync failed";
  }
  if (state.tab === "trade") { paintBalances(); paintPositions(); paintOrders(); paintLiveStatus(); paintLiveSafety(); }
}

/* -------------------------------------------------- TP/SL autopilot tick */
async function liveTick() {
  if (!liveOn() || !canTradeLive() || LIVE.busy) return;
  LIVE.busy = true;
  try {
    if (!LIVE.balances || now() - LIVE.lastSync > 20000) await liveSync(true).catch(() => { });
    if (!state.settings.liveAutoTpSl) return;
    for (const p of LIVE.positions.slice()) {
      const tk = state.tickers[p.sym] || {};
      const price = +tk.last;
      if (!price) continue;
      const hitTp = p.tp && price >= p.tp;
      const hitSl = p.sl && price <= p.sl;
      if (!hitTp && !hitSl) continue;
      if (p.locked) continue;
      p.locked = true;
      try {
        const out = await liveSubmit({ sym: p.sym, side: "SELL", type: "MARKET", qty: p.qty, reason: hitTp ? "tp" : "sl" });
        notify(hitTp ? t("trade.tp") : t("trade.sl"),
          `LIVE SELL ${fmtQty(out.qty)} ${p.sym.replace("USDT", "/USDT")} @ ${fmtPrice(out.avg)}`, hitTp ? "ok" : "bad");
        liveLog(hitTp ? "ok" : "bad", (hitTp ? "TP" : "SL") + " closed " + p.sym + " @ " + fmtPrice(out.avg), {});
      } catch (e) {
        p.locked = false;
        liveLog("bad", "auto close failed: " + e.message, {});
        notify("Auto close failed", p.sym + " · " + e.message, "bad");
      }
    }
  } finally {
    LIVE.busy = false;
    if (state.tab === "trade") { paintPositions(); paintBalancesThrottled(); }
  }
}

async function liveCloseHolding(asset, pct) {
  const sym = asset + "USDT";
  const f = liveFilter(sym);
  const free = liveFree(asset);
  if (!(free > 0)) { toast(t("trade.none"), "bad"); return; }
  const qty = liveRoundQty(free * (pct / 100), f);
  if (!(qty > 0)) { toast("amount rounds to 0", "bad"); return; }
  try {
    const out = await liveSubmit({ sym, side: "SELL", type: "MARKET", qty, reason: "close" });
    toast("SELL " + fmtQty(out.qty) + " " + asset + " @ " + fmtPrice(out.avg), "ok");
    haptic(40);
    await liveSync(true);
  } catch (e) {
    toast(t("error") + ": " + e.message, "bad");
  }
}

async function livePanic() {
  openOk("Close everything?",
    "<b>This sends real market orders.</b><br>All open orders are cancelled, every tracked position and spot holding is sold to USDT.<br><br>Exchange: <b>" + liveEx() + "</b> · " + (state.settings.testnet ? "testnet" : "<span class='dn'>MAINNET</span>"),
    async () => {
      LIVE.halted = true;
      try {
        await liveSyncOrders().catch(() => { });
        for (const o of LIVE.openOrders.slice()) {
          await liveCancel(o.sym, o.id).catch(() => { });
        }
        const assets = Object.keys(LIVE.balances || {}).filter((a) => a !== "USDT" && liveFree(a) > 0);
        for (const a of assets) await liveCloseHolding(a, 100);
        LIVE.positions = [];
        saveLive();
        toast("panic close done", "ok");
        liveLog("bad", "panic close executed", {});
        await liveSync(true);
      } catch (e) {
        toast("panic close: " + e.message, "bad");
      }
    });
}

/* ------------------------------------------------------------- persistence */
function saveLive() {
  try {
    localStorage.setItem(LSKEY + ".live", JSON.stringify({
      positions: LIVE.positions, history: LIVE.history, stats: LIVE.stats,
      dayPnl: LIVE.dayPnl, dayKey: LIVE.dayKey, halted: !!LIVE.halted,
    }));
  } catch (e) { }
}
function loadLive() {
  try {
    const raw = localStorage.getItem(LSKEY + ".live");
    if (!raw) return;
    const o = JSON.parse(raw);
    LIVE.positions = o.positions || [];
    LIVE.history = o.history || [];
    LIVE.stats = o.stats || LIVE.stats;
    LIVE.dayPnl = o.dayPnl || 0;
    LIVE.dayKey = o.dayKey || dayKey();
    LIVE.halted = !!o.halted;
    if (LIVE.dayKey !== dayKey()) { LIVE.dayPnl = 0; LIVE.dayKey = dayKey(); }
  } catch (e) { }
}

/* -------------------------------------------------------------- test keys */
async function liveTestKeys() {
  const box = $("setKeyStatus");
  if (box) box.innerHTML = '<span class="spinner"></span> …';
  const t0 = now();
  try {
    if (!B) throw new Error(t("live.unsupported"));
    const raw = bc("exchangeTest", liveEx());
    const r = liveParse(raw);
    if (!r || r.ok === false) throw Object.assign(new Error(liveErrText(r)), r || {});
    const lat = r.latencyMs != null ? r.latencyMs : now() - t0;
    LIVE.status = Object.assign(LIVE.status, {
      ok: true, msg: "connected", latency: lat, testnet: !!r.testnet, base: r.base || "",
      canTrade: r.canTrade != null ? r.canTrade : LIVE.status.canTrade,
      canWithdraw: r.canWithdraw != null ? r.canWithdraw : LIVE.status.canWithdraw,
      perms: r.permissions || LIVE.status.perms,
    });
    const mode = r.testnet ? '<span class="gold">testnet</span>' : '<span class="up">mainnet</span>';
    const perm = LIVE.status.canTrade === false
      ? '<div class="dn mt">Spot trading permission is OFF for this key — orders will be rejected.</div>' : "";
    const wd = LIVE.status.canWithdraw
      ? '<div class="dn mt">⚠ Withdrawal permission is enabled — remove it on the exchange.</div>' : "";
    const perms = LIVE.status.perms ? '<div class="mut mt">permissions: ' + esc(JSON.stringify(LIVE.status.perms)) + "</div>" : "";
    if (box) box.innerHTML = '<span class="up">● ' + t("set.keyOk") + "</span> · " + mode + " · " + lat + " ms · " + esc(liveEx()) + perm + wd + perms;
    liveLog("ok", "key test · " + liveEx() + " · " + lat + " ms", { ms: lat });
    if (liveOn()) liveSync(true);
    return true;
  } catch (e) {
    LIVE.status = Object.assign(LIVE.status, { ok: false, msg: e.message || "failed", latency: now() - t0 });
    if (box) box.innerHTML = '<span class="dn">● ' + t("set.keyFail") + ": " + esc(e.message || "") + "</span>";
    liveLog("bad", "key test failed · " + (e.message || ""), {});
    return false;
  }
}

/* ------------------------------------------------------------------- view */
function paintLiveStatus() {
  const el2 = $("liveStatus");
  if (!el2) return;
  if (!canTradeLive()) { el2.innerHTML = '<span class="mut">' + t("trade.browserNote") + "</span>"; return; }
  const s = LIVE.status;
  const cls = s.ok ? "up" : "dn";
  const mode = state.settings.testnet ? '<span class="gold">testnet</span>' : '<span class="dn">MAINNET</span>';
  el2.innerHTML = `<span class="${cls}">● ${esc(s.msg)}</span> · ${esc(liveEx())} · ${mode}` +
    (s.latency ? ` · ${s.latency} ms` : "") +
    (LIVE.halted ? ' · <span class="dn">risk stop</span>' : "");
}

function paintLiveSafety() {
  const box = $("liveSafety");
  if (!box) return;
  liveDefaults();
  const s = state.settings;
  const day = LIVE.dayPnl || 0;
  const lim = +s.liveDailyLoss || 0;
  const used = lim ? clamp((Math.abs(Math.min(0, day)) / lim) * 100, 0, 100) : 0;
  box.innerHTML = `
    <div class="grid3">
      <label class="f" style="margin:0"><span class="lb">Max / order (USDT)</span>
        <input id="lvMax" type="number" inputmode="decimal" value="${s.liveMaxUsdt}"></label>
      <label class="f" style="margin:0"><span class="lb">Daily loss stop</span>
        <input id="lvLoss" type="number" inputmode="decimal" value="${s.liveDailyLoss}"></label>
      <label class="f" style="margin:0"><span class="lb">Fee %</span>
        <input id="lvFee" type="number" inputmode="decimal" step="0.01" value="${s.liveFeePct}"></label>
    </div>
    <div class="switchrow"><span>Auto TP/SL on positions</span><div class="sw ${s.liveAutoTpSl ? "on" : ""}" id="lvTpSl"><i></i></div></div>
    <div class="switchrow"><span>Confirm before live orders</span><div class="sw ${s.liveConfirm ? "on" : ""}" id="lvConfirm"><i></i></div></div>
    <div class="row between mt tiny ${day < 0 ? "dn" : "mut"}">
      <span>today <b>${fmtUsd(day)}</b> / stop ${lim ? fmtUsd(lim) : "—"}</span>
      <span>${LIVE.stats.trades} trades · win ${LIVE.stats.trades ? Math.round((LIVE.stats.wins / LIVE.stats.trades) * 100) : 0}% · fees ${fmtUsd(LIVE.stats.fees)}</span>
    </div>
    <div class="pbar mt" style="height:4px"><span style="left:0;width:${used}%;background:var(--dn);height:4px"></span></div>
    <div class="row mt">
      <button class="btn ghost sm" id="lvSync">⟳ Sync</button>
      <button class="btn ghost sm" id="lvHist">⬇ Fills</button>
      ${LIVE.halted ? '<button class="btn primary sm" id="lvResume">Resume trading</button>' : '<button class="btn ghost sm" id="lvPanic">⛔ Close all</button>'}
    </div>`;
  $("lvMax").onchange = (e) => { state.settings.liveMaxUsdt = Math.max(0, +e.target.value || 0); save(); paintLiveSafety(); };
  $("lvLoss").onchange = (e) => { state.settings.liveDailyLoss = Math.max(0, +e.target.value || 0); save(); };
  $("lvFee").onchange = (e) => { state.settings.liveFeePct = clamp(+e.target.value || 0, 0, 2); save(); };
  $("lvTpSl").onclick = () => { state.settings.liveAutoTpSl = !state.settings.liveAutoTpSl; save(); paintLiveSafety(); };
  $("lvConfirm").onclick = () => { state.settings.liveConfirm = !state.settings.liveConfirm; save(); paintLiveSafety(); };
  $("lvSync").onclick = () => { LIVE.lastSync = 0; liveSync(true); toast("syncing…", ""); };
  $("lvHist").onclick = () => liveSyncHistory();
  if ($("lvPanic")) $("lvPanic").onclick = () => livePanic();
  if ($("lvResume")) $("lvResume").onclick = () => { liveResume(); toast("live trading resumed", "ok"); };
}

function paintLiveLog() {
  const box = $("liveLog");
  if (!box) return;
  if (!LIVE.log.length) { box.innerHTML = '<div class="empty">No live requests yet.</div>'; return; }
  box.innerHTML = LIVE.log.slice(0, 12).map((r) => `
    <div class="row between small" style="padding:4px 0;border-bottom:1px dashed rgba(31,42,66,.6)">
      <span class="${r.kind === "bad" ? "dn" : "up"}">${r.kind === "bad" ? "✕" : "✓"}</span>
      <span class="mono mut" style="flex:1;text-align:left;padding:0 8px;word-break:break-word">${esc(r.msg)}</span>
      <span class="tiny dim">${fmtClock(r.at)}${r.ms ? " · " + r.ms + "ms" : ""}</span>
    </div>`).join("");
}

/* --------------------------------------------------- live positions view */
function paintLivePositions() {
  const box = $("posList");
  if (!canTradeLive()) { box.innerHTML = '<div class="hint">' + t("trade.browserNote") + "</div>"; return; }
  const hold = liveHoldings().filter((h) => h.qty > 0);
  if (!hold.length) {
    box.innerHTML = '<div class="empty">' + t("trade.none") + "</div>";
    return;
  }
  box.innerHTML = hold.map((h) => {
    const pnl = h.pnl;
    return `<div class="pos">
      <div class="hd"><span>${esc(h.asset)} <span class="tiny dim">spot</span>
        ${h.id ? '<span class="tiny gold">tracked</span>' : '<span class="tiny dim">untracked</span>'}</span>
        <span class="pnl ${pnl == null ? "dim" : pnl >= 0 ? "up" : "dn"}">${pnl == null ? "—" : fmtUsd(pnl) + " (" + fmtPct(h.pnlPct) + ")"}</span></div>
      <table class="kv"><tr>
        <td>qty <b>${fmtQty(h.qty)}</b></td>
        <td>free <b>${fmtQty(h.free)}</b></td>
        <td>${t("pos.now")} <b>${fmtPrice((state.tickers[h.sym] || {}).last || 0)}</b></td>
        <td>value <b>${fmtUsd(h.value)}</b></td>
      </tr></table>
      ${h.entry ? `<div class="row between mt tiny dim"><span>${t("pos.entry")} ${fmtPrice(h.entry)}</span>
        <span>SL ${h.sl ? fmtPrice(h.sl) : "—"} · TP ${h.tp ? fmtPrice(h.tp) : "—"}</span></div>` : ""}
      <div class="grid3 mt">
        <button class="btn ghost sm" data-livesell="25" data-asset="${h.asset}">Sell 25%</button>
        <button class="btn ghost sm" data-livesell="50" data-asset="${h.asset}">Sell 50%</button>
        <button class="btn ghost sm" data-livesell="100" data-asset="${h.asset}">Sell all</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-livesell]").forEach((b) => b.onclick = () => {
    const pct = +b.dataset.livesell;
    if (pct === 100) openOk("Sell 100% of " + b.dataset.asset + "?", "Market sell to USDT on " + liveEx() + " (" + (state.settings.testnet ? "testnet" : "MAINNET") + ").", () => liveCloseHolding(b.dataset.asset, 100));
    else liveCloseHolding(b.dataset.asset, pct);
  });
}
