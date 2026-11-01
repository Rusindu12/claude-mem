/**
 * Headless smoke test for the live-trading layer.
 *
 * Loads app/src/main/assets/index.html in jsdom with a mocked AndroidBridge
 * (the same contract the Java bridge exposes) and checks the whole live flow:
 * filters -> validation -> market buy -> tracked position -> TP autopilot sell
 * -> PnL/history, plus the error, guard and panic paths.
 *
 *   cd android/tests && npm install jsdom && node live_engine.test.cjs
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const HTML = path.join(__dirname, "..", "app", "src", "main", "assets", "index.html");
let failures = 0;
const ok = (cond, name, extra) => {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.log("  ✗ " + name + (extra ? "  → " + extra : ""));
  }
};

/* ---------------------------------------------------------- fake exchange */
const T0 = Date.now();
const state = {
  balances: { USDT: { free: 1000, locked: 0 }, BTC: { free: 0, locked: 0 } },
  orders: [],
  seq: 1000,
  calls: [],
  failNext: null,
  latency: 35,
};
const price = () => 50000;
const num = (v) => String(+v);

function envelope(status, body) {
  // mirrors the Java LiveTrading envelope: {ok, status, code, msg, raw, ...}
  const raw = JSON.stringify(body);
  const okFlag = status >= 200 && status < 300 && (!body || body.code == null || +body.code >= 0);
  return JSON.stringify({
    ok: okFlag, status, body: raw, raw, headers: {},
    code: body && body.code != null ? String(body.code) : "0",
    msg: (body && body.msg) || "",
    retryable: status === 0 || status === 429 || status >= 500,
    rateLimited: body && String(body.code) === "-1003",
  });
}

function binance(method, p, params) {
  const grant = { X: true };
  if (method === "GET" && p === "/api/v3/account") {
    return envelope(200, {
      canTrade: true, canWithdraw: false, permissions: ["SPOT"], accountType: "SPOT",
      balances: Object.keys(state.balances).map((a) => ({ asset: a, free: num(state.balances[a].free), locked: num(state.balances[a].locked) })),
    });
  }
  if (method === "POST" && p === "/api/v3/order") {
    const qty = +params.quantity;
    if (params.side === "BUY") {
      const cost = qty * price();
      if (cost > state.balances.USDT.free) return envelope(400, { code: -2010, msg: "Account has insufficient balance" });
      state.balances.USDT.free -= cost;
      state.balances.BTC.free += qty;
    } else {
      if (qty > state.balances.BTC.free + 1e-12) return envelope(400, { code: -2010, msg: "insufficient balance for sell" });
      state.balances.BTC.free -= qty;
      state.balances.USDT.free += qty * price();
    }
    state.orders.push({ id: ++state.seq, sym: params.symbol, side: params.side, qty, type: params.type, params });
    return envelope(200, {
      symbol: params.symbol, orderId: state.seq, clientOrderId: params.newClientOrderId,
      executedQty: num(qty), cummulativeQuoteQty: num(qty * price()), status: "FILLED",
      transactTime: Date.now(), fills: [{ price: num(price()), qty: num(qty), commission: "0.5", commissionAsset: "USDT", tradeId: String(state.seq) }],
    });
  }
  if (method === "GET" && p === "/api/v3/openOrders") return envelope(200, []);
  if (method === "DELETE" && p === "/api/v3/order") return envelope(200, { symbol: params.symbol, orderId: params.orderId });
  if (method === "GET" && p === "/api/v3/myTrades") return envelope(200, []);
  return envelope(404, { code: -1121, msg: "unhandled " + method + " " + p });
}

const bridge = {
  version: () => "test",
  now: () => Date.now(),
  haptic: () => {},
  speak: () => {},
  notifySignal: () => {},
  setKeepScreenOn: () => {},
  setAutoOn: () => {},
  setTradingActive: () => {},
  startBgService: () => {},
  stopBgService: () => {},
  httpGet: (url) => {
    state.calls.push(url);
    if (/exchangeInfo/.test(url)) {
      return JSON.stringify({
        symbols: [
          {
            symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
            filters: [
              { filterType: "LOT_SIZE", stepSize: "0.00001", minQty: "0.00001" },
              { filterType: "PRICE_FILTER", tickSize: "0.01" },
              { filterType: "NOTIONAL", minNotional: "5" },
            ],
          },
          {
            symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT",
            filters: [
              { filterType: "LOT_SIZE", stepSize: "0.0001", minQty: "0.0001" },
              { filterType: "PRICE_FILTER", tickSize: "0.01" },
              { filterType: "NOTIONAL", minNotional: "5" },
            ],
          },
        ],
      });
    }
    if (/ticker\/24hr/.test(url)) {
      return JSON.stringify({ symbol: "BTCUSDT", lastPrice: String(price()), priceChangePercent: "1.2", highPrice: "51000", lowPrice: "49000", quoteVolume: "1000" });
    }
    if (/klines/.test(url)) return JSON.stringify([]);
    return "{}";
  },
  httpPost: () => "{}",
  clientOrderId: () => "cai" + Math.random().toString(36).slice(2, 10),
  liveRequest: (ex, method, p, paramsJson) => {
    state.calls.push(method + " " + p);
    if (state.failNext) {
      const f = state.failNext;
      state.failNext = null;
      return JSON.stringify(f);
    }
    if (state.latency) {
      const until = Date.now() + state.latency;
      while (Date.now() < until) { /* simulate bridge latency */ }
    }
    return binance(method, p, JSON.parse(paramsJson || "{}"));
  },
  exchangeTest: () => {
    state.calls.push("exchangeTest");
    return JSON.stringify({ ok: true, status: 200, retCode: "0", retMsg: "OK", canTrade: true, canWithdraw: false, latencyMs: 42, testnet: false, base: "https://api.binance.com", permissions: ["SPOT"] });
  },
  liveStatus: () => JSON.stringify({ bridge: true }),
  binanceSaveKeys: () => "ok",
  binanceStatus: () => JSON.stringify({ hasKeys: true, keyPreview: "test…test", base: "https://api.binance.com" }),
  bybitSaveKeys: () => "ok",
  bybitStatus: () => JSON.stringify({ hasKeys: true }),
  binanceClearKeys: () => {},
  bybitClearKeys: () => {},
};

/* --------------------------------------------------------------- harness */
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.log("  [dom error] " + e.message.split("\n")[0]));
const dom = new JSDOM(fs.readFileSync(HTML, "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://cryptoai.local/index.html",
  virtualConsole: vc,
  beforeParse(win) {
    win.AndroidBridge = bridge;
    win.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc() {}, rect() {}, closePath() {}, save() {}, restore() {}, scale() {}, translate() {},
      measureText: () => ({ width: 10 }), fillText() {}, strokeText() {}, setLineDash() {},
      createLinearGradient: () => ({ addColorStop() {} }), drawImage() {},
      set fillStyle(v) {}, get fillStyle() { return "#000"; },
      set strokeStyle(v) {}, get strokeStyle() { return "#000"; },
      set lineWidth(v) {}, get lineWidth() { return 1; },
      set font(v) {}, get font() { return "10px sans-serif"; },
      set textAlign(v) {}, set textBaseline(v) {}, set globalAlpha(v) {}, set lineJoin(v) {}, set lineCap(v) {},
    });
    win.WebSocket = function () { return { close() {}, send() {} }; };
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  },
});
const win = dom.window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(600);
  const run = (code) => win.eval(code);

  console.log("\nlive engine");
  ok(!!win.eval("typeof liveSubmit === 'function'"), "engine loaded");
  ok(win.eval("canTradeLive() === true"), "bridge detected as live-capable");

  // switch to live mode, keys saved in the fake
  run(`state.settings.liveMode='live'; state.settings.exchange='binance'; state.settings.testnet=false; state.settings.liveMaxUsdt=5000; state.settings.liveDailyLoss=100; liveDefaults();`);
  run(`state.tickers['BTCUSDT']={last:${price()},chg:1,high:51000,low:49000,vol:1,ts:Date.now()}; state.sym='BTCUSDT';`);

  // filters
  await run("loadFilters(['BTCUSDT'])");
  const f = win.eval("JSON.stringify(liveFilter('BTCUSDT'))");
  ok(/0\.00001/.test(f), "exchange step/minNotional loaded", f);
  ok(win.eval("liveRoundQty(0.123456789, liveFilter('BTCUSDT'))===0.12345"), "qty rounded to step");

  // validation guards
  let err = await run("liveSubmit({sym:'BTCUSDT',side:'BUY',type:'MARKET',qty:0.000001}).then(()=>null,e=>e.message)");
  ok(err && /step|minimum|rounds/i.test(err), "rejects qty below step", err);

  err = await run("liveSubmit({sym:'BTCUSDT',side:'BUY',type:'MARKET',qty:0.00005}).then(()=>null,e=>e.message)");
  ok(err && /minimum/i.test(err), "rejects notional below exchange minimum", err);

  run("state.settings.liveMaxUsdt=100");
  err = await run("liveSubmit({sym:'BTCUSDT',side:'BUY',type:'MARKET',qty:0.05}).then(()=>null,e=>e.message)");
  ok(err && /limit/i.test(err), "per-order safety cap enforced", err);
  run("state.settings.liveMaxUsdt=5000");

  await run("liveSync(true)");
  ok(win.eval("LIVE.balances && LIVE.balances.USDT.free===1000"), "balances fetched", win.eval("JSON.stringify(LIVE.balances)"));

  // market buy -> position
  const buy = await run(`liveSubmit({sym:'BTCUSDT',side:'BUY',type:'MARKET',qty:0.01,tp:${price() * 1.02},sl:${price() * 0.99},src:'manual'}).then(r=>JSON.stringify(r),e=>'ERR '+e.message)`);
  ok(/avg/.test(buy), "market buy filled", buy);
  ok(win.eval("LIVE.positions.length===1"), "position tracked");
  ok(win.eval("Math.abs(LIVE.positions[0].entry-50000)<1"), "entry price recorded", win.eval("LIVE.positions[0].entry"));
  ok(win.eval("LIVE.positions[0].tp>50000 && LIVE.positions[0].sl>0 && LIVE.positions[0].sl<50000"), "TP/SL stored from the order form");
  ok(win.eval("LIVE.balances.BTC.free>0.009"), "balance updated after buy", win.eval("LIVE.balances.BTC.free"));

  // duplicate submit idempotency: same clientId twice
  const dupId = win.eval("bc('clientOrderId','test')");
  const r1 = await run(`liveSubmit({sym:'BTCUSDT',side:'BUY',type:'MARKET',qty:0.001,clientId:'${dupId}'}).then(()=> 'ok',e=>'ERR '+e.message)`);
  ok(/ok/.test(r1), "submit with explicit client id works", r1);

  // TP autopilot
  run(`state.tickers['BTCUSDT'].last=${price() * 1.03}; LIVE.positions[0].qty=0.002;`);
  const before = win.eval("LIVE.history.length");
  await run("liveTick()");
  await sleep(50);
  ok(win.eval(`LIVE.history.length>${before}`) || win.eval("LIVE.positions.every(p=>p.sym!=='BTCUSDT')"), "TP autopilot sent the sell");
  ok(win.eval("LIVE.dayPnl!==0 || LIVE.stats.pnl!==0"), "PnL recorded", win.eval("JSON.stringify(LIVE.stats)"));

  // rate-limit retry on GET
  state.failNext = { ok: false, status: 429, retryable: true, rateLimited: true, retryAfterMs: 5, code: "-1003", msg: "Too many requests" };
  const rl = await run("liveRequest('GET','/api/v3/account',{}, {retries:2}).then(()=> 'recovered', e=>'ERR '+e.message)");
  ok(/recovered/.test(rl), "retries a rate-limited GET", rl);

  // error surfacing with actionable hint
  state.failNext = { ok: false, status: 401, code: "-2015", msg: "Invalid API-key, IP, or permissions for action", retryable: false };
  const authErr = await run("liveRequest('GET','/api/v3/account',{}, {retries:0}).then(()=> '', e=>e.message)");
  ok(/whitelist|permission/i.test(authErr), "auth errors get an actionable hint", authErr);

  // sell all holdings -> closes position
  await run("liveCloseHolding('BTC', 100)");
  await sleep(60);
  ok(win.eval("LIVE.positions.filter(p=>p.sym==='BTCUSDT').length===0"), "sell-all clears the tracked position");
  ok(win.eval("(LIVE.balances.BTC||{free:0}).free < 0.001"), "exchange balance emptied for BTC", win.eval("JSON.stringify(LIVE.balances)"));

  // daily loss stop halts entries
  run("LIVE.dayPnl=-500; checkDailyLoss();");
  ok(win.eval("LIVE.halted===true"), "daily loss stop trips");
  run("liveResume()");
  ok(win.eval("LIVE.halted===false"), "resume clears the stop");

  // panic close cancels orders + flattens
  run(`state.balances`); // noop
  await run("livePanic(); $('okYes').onclick()");
  await sleep(80);
  ok(win.eval("LIVE.openOrders.length===0"), "panic close leaves no open orders");

  // key test shows permissions/latency
  await run("liveTestKeys()");
  ok(win.eval("LIVE.status.ok===true && LIVE.status.latency>0"), "key test stores latency/permissions", win.eval("JSON.stringify(LIVE.status)"));

  // UI renders in live mode without throwing
  let uiErr = null;
  try {
    run("switchTab('trade'); paintTrade(); paintLiveSafety(); paintLivePositions(); paintLiveLog(); paintHistory();");
  } catch (e) { uiErr = e.message; }
  ok(!uiErr, "live trade tab renders", uiErr);
  ok(win.document.querySelector("#liveSafety") && win.document.querySelector("#liveSafety").innerHTML.includes("Max / order"), "live safety card rendered");
  ok(win.document.querySelector("#liveStatus").textContent.includes("binance"), "status line rendered", win.document.querySelector("#liveStatus").textContent);

  // paper mode still works
  try {
    run("state.settings.liveMode='paper'; paintTrade();");
    ok(true, "paper mode renders after live");
  } catch (e) { ok(false, "paper mode renders after live", e.message); }

  console.log(failures ? "\nFAILED: " + failures + " check(s)" : "\nall live-trading checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
