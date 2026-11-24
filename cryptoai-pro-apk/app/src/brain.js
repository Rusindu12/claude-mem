/* ============================================================================
 * CryptoAI PRO — Brain v3 (self-learning model)
 * Online logistic regression on 15 standardized market features.
 *   • trained on walk-forward history (70% train / 30% out-of-sample test)
 *   • triple-barrier labels: +1.6 ATR target vs −1.6 ATR stop within N bars
 *   • every closed paper trade feeds one more lesson (online learning)
 * Pure JS, no dependencies.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ta.js"));
  else root.Brain = factory(root.TA);
})(typeof self !== "undefined" ? self : this, function (TA) {
  "use strict";

  const FEATURES = [
    ["trendEma", "EMA trend"],
    ["trendSlow", "Big trend"],
    ["priceEma", "Price vs EMA"],
    ["macd", "MACD momentum"],
    ["rsi", "RSI momentum"],
    ["stoch", "Stochastic"],
    ["bb", "Bollinger position"],
    ["volZ", "Volume z-score"],
    ["obv", "OBV slope"],
    ["atr", "Volatility"],
    ["structure", "Range position"],
    ["candle", "Candle strength"],
    ["btcCtx", "BTC context"],
    ["pattern", "Chart patterns"],
    ["regime", "ADX regime"],
  ];
  const FIDS = FEATURES.map((f) => f[0]);
  const LSKEY = "cryptoai.brain.v3";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function load() {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(LSKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function persist() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(LSKEY, JSON.stringify(S));
    } catch (e) { /* private mode */ }
  }

  const S = Object.assign({
    w: {}, b: 0, mu: {}, sd: {},
    n: 0, wins: 0, losses: 0,
    trainAcc: 0, testAcc: 0, precision: 0, recall: 0, brier: 1,
    samples: 0, trainedAt: 0, testPnl: 0,
  }, load() || {});
  FIDS.forEach((id) => {
    if (typeof S.w[id] !== "number") S.w[id] = 0;
    if (typeof S.mu[id] !== "number") S.mu[id] = 0;
    if (typeof S.sd[id] !== "number") S.sd[id] = 1;
  });

  /* ------------------------------------------------------------- features */
  function features(pre, i, ctx) {
    if (!pre || i < 50 || i >= pre.n) return null;
    const c = pre.closes[i];
    const atr = pre.atr[i] || c * 0.01;
    const e21 = pre.e21[i], e50 = pre.e50[i], e200 = pre.e200[i];
    const R = pre.rsi[i], H = pre.macd.hist[i];
    const K = pre.stoch.k[i], D = pre.stoch.d[i];
    const pctB = pre.bb.pctB[i];
    const adx = pre.adx.adx[i], pdi = pre.adx.pdi[i], mdi = pre.adx.mdi[i];
    const hi = pre.hi20[i], lo = pre.lo20[i];
    const vz = pre.volZ[i] || 0;
    const obvSlope = pre.obvEma[i] != null && i >= 5 && pre.obvEma[i - 5] != null && pre.obvStd[i]
      ? (pre.obvEma[i] - pre.obvEma[i - 5]) / (pre.obvStd[i] * 6 + 1e-9) : 0;
    let candle = 0;
    for (let k = Math.max(0, i - 2); k <= i; k++) {
      const r = pre.candles[k];
      const rng = (r.h - r.l) || 1;
      candle += (r.c - r.o) / rng;
    }
    const bc = ctx && ctx.btcChg != null ? Number(ctx.btcChg) : 0;
    const f = {
      trendEma: e21 != null && e50 != null ? clamp(((e21 - e50) / e50) * 100, -1, 1) : 0,
      trendSlow: e50 != null && e200 != null ? clamp(((e50 - e200) / e200) * 100, -1, 1) : 0,
      priceEma: e21 != null ? clamp((c - e21) / (atr * 2), -1, 1) : 0,
      macd: H != null ? clamp(H / (0.6 * atr), -1, 1) : 0,
      rsi: R != null ? clamp((R - 50) / 25, -1, 1) : 0,
      stoch: K != null && D != null ? clamp((K - D) / 25, -1, 1) : 0,
      bb: pctB != null ? clamp((pctB - 50) / 50, -1, 1) : 0,
      volZ: clamp(vz / 2.5, -1, 1),
      obv: clamp(obvSlope, -1, 1),
      atr: clamp(((atr / c) * 100 - 1.5) / 2, -1, 1),
      structure: hi != null && lo != null && hi > lo ? clamp(((c - lo) / (hi - lo)) * 2 - 1, -1, 1) : 0,
      candle: clamp(candle / 2, -1, 1),
      btcCtx: clamp(bc / 4, -1, 1),
      pattern: pre.patBull ? clamp(pre.patBull[i] - pre.patBear[i], -1, 1) : 0,
      regime: adx != null ? clamp((pdi - mdi) / 30, -1, 1) * clamp(adx / 40, 0, 1) : 0,
    };
    return f;
  }

  function standardize(f) {
    const x = {};
    for (const id of FIDS) {
      const v = f[id] || 0;
      const sd = S.sd[id] || 1;
      x[id] = clamp((v - (S.mu[id] || 0)) / sd, -4, 4);
    }
    return x;
  }

  /* --------------------------------------------------------------- predict */
  function predict(f) {
    if (!f) return 0.5;
    const x = standardize(f);
    let z = S.b;
    for (const id of FIDS) z += (S.w[id] || 0) * x[id];
    return 1 / (1 + Math.exp(-z));
  }

  /* ----------------------------------------------------------------- learn */
  function learn(f, y, lr) {
    if (!f) return;
    const x = standardize(f);
    const rate = lr || 0.08;
    let z = S.b;
    for (const id of FIDS) z += (S.w[id] || 0) * x[id];
    const p = 1 / (1 + Math.exp(-z));
    const g = p - (y > 0 ? 1 : 0);
    for (const id of FIDS) {
      const w = S.w[id] || 0;
      S.w[id] = w - rate * (g * x[id] + 1e-4 * w);
    }
    S.b -= rate * g;
    S.n++;
    if (y > 0) S.wins++; else S.losses++;
    persist();
  }

  /* --------------------------------------------------------- triple barrier */
  function labelFor(pre, i, horizon, k) {
    const c = pre.closes[i];
    const atr = pre.atr[i] || c * 0.01;
    const up = c + k * atr, dn = c - k * atr;
    const end = Math.min(pre.n - 1, i + horizon);
    for (let j = i + 1; j <= end; j++) {
      const b = pre.candles[j];
      if (b.h >= up && b.l <= dn) return 0;        // ambiguous bar — skip
      if (b.h >= up) return 1;
      if (b.l <= dn) return -1;
    }
    return 0;
  }

  /* ---------------------------------------------------------- train helper */
  function sgd(samples, epochs, lr) {
    let seed = (samples.length * 2654435761 + epochs * 1013904223) >>> 0;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    for (let e = 0; e < epochs; e++) {
      for (let i = samples.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const t = samples[i]; samples[i] = samples[j]; samples[j] = t;
      }
      for (const s of samples) {
        const x = standardize(s.f);
        let z = S.b;
        for (const id of FIDS) z += (S.w[id] || 0) * x[id];
        const p = 1 / (1 + Math.exp(-z));
        const g = p - (s.y > 0 ? 1 : 0);
        for (const id of FIDS) {
          const w = S.w[id] || 0;
          S.w[id] = w - lr * (g * x[id] + 1e-4 * w);
        }
        S.b -= lr * g;
      }
    }
  }

  function evaluateSamples(samples) {
    if (!samples.length) return { acc: 0, precision: 0, recall: 0, brier: 1, pnl: 0, trades: 0 };
    let tp = 0, fp = 0, tn = 0, fn = 0, brier = 0, pnl = 0, trades = 0;
    for (const s of samples) {
      const p = predict(s.f);
      brier += Math.pow(p - (s.y > 0 ? 1 : 0), 2);
      const pred = p >= 0.55 ? 1 : p <= 0.45 ? -1 : 0;
      if (pred === 1 && s.y > 0) tp++;
      else if (pred === 1 && s.y < 0) fp++;
      else if (pred === -1 && s.y < 0) tn++;
      else if (pred === -1 && s.y > 0) fn++;
      if (pred !== 0 && s.ret != null) { pnl += pred * s.ret * 100 - 0.2; trades++; }
    }
    const n = samples.length;
    return {
      acc: n ? (tp + tn) / n : 0,
      precision: tp + fp ? tp / (tp + fp) : 0,
      recall: tp + fn ? tp / (tp + fn) : 0,
      brier: n ? brier / n : 1,
      pnl: pnl,
      trades,
    };
  }

  /* -------------------------------------------------------- history trainer */
  function trainHistory(candles, opts) {
    opts = opts || {};
    if (!TA || !candles || candles.length < 120) return { ok: false, error: "not enough candles" };
    const pre = TA.prepare(candles, { emaFast: "e21", emaMid: "e50" });
    const n = pre.n;
    const split = Math.max(80, Math.floor(n * 0.7));
    const horizon = opts.horizon || 24;
    const k = opts.k || 1.6;
    const train = [], test = [];
    for (let i = 60; i < n - horizon - 1; i++) {
      const y = labelFor(pre, i, horizon, k);
      if (!y) continue;
      const f = features(pre, i, null);
      const ret = (pre.closes[i + horizon] - pre.closes[i]) / pre.closes[i];
      const s = { f, y, ret };
      if (i < split) train.push(s); else test.push(s);
    }
    if (train.length < 20) return { ok: false, error: "not enough labelled samples" };

    /* feature scaler from the training set only (no lookahead) */
    for (const id of FIDS) {
      let sum = 0, sum2 = 0;
      for (const s of train) { const v = s.f[id] || 0; sum += v; sum2 += v * v; }
      const m = sum / train.length;
      S.mu[id] = m;
      S.sd[id] = Math.max(1e-6, Math.sqrt(Math.max(0, sum2 / train.length - m * m)));
    }
    sgd(train, opts.epochs || 3, opts.lr || 0.08);

    const tr = evaluateSamples(train);
    const te = evaluateSamples(test);
    S.samples = train.length;
    S.trainAcc = tr.acc;
    S.testAcc = te.acc;
    S.precision = te.precision;
    S.recall = te.recall;
    S.brier = te.brier;
    S.testPnl = te.pnl;
    S.trainedAt = Date.now();
    persist();
    return {
      ok: true, samples: train.length, testSamples: test.length,
      trainAcc: round3(tr.acc), testAcc: round3(te.acc), precision: round3(te.precision),
      recall: round3(te.recall), brier: round3(te.brier), pnl: round3(te.pnl),
      trades: te.trades, horizon, split, tested: n - split,
    };
  }

  function round3(v) { return Math.round((v || 0) * 1000) / 1000; }

  function stats() {
    const total = S.wins + S.losses;
    return {
      n: S.n, wins: S.wins, losses: S.losses,
      winRate: total ? S.wins / total : null,
      samples: S.samples, trainAcc: S.trainAcc, testAcc: S.testAcc,
      precision: S.precision, recall: S.recall, brier: S.brier,
      testPnl: S.testPnl, trainedAt: S.trainedAt,
      w: snapshot().w,
    };
  }
  function snapshot() {
    const w = {};
    FIDS.forEach((id) => { w[id] = Math.round((S.w[id] || 0) * 1000) / 1000; });
    return { w, n: S.n, wins: S.wins, losses: S.losses };
  }
  function ready() {
    return (S.samples || 0) >= 40 && (S.testAcc || 0) >= 0.5 && (S.brier || 1) < 0.3;
  }
  function reset() {
    FIDS.forEach((id) => { S.w[id] = 0; S.mu[id] = 0; S.sd[id] = 1; });
    S.b = 0; S.n = 0; S.wins = 0; S.losses = 0;
    S.samples = 0; S.trainAcc = 0; S.testAcc = 0; S.precision = 0; S.recall = 0;
    S.brier = 1; S.testPnl = 0; S.trainedAt = 0;
    persist();
  }
  function importance() {
    return FIDS.map((id, i) => ({ id, label: FEATURES[i][1], w: S.w[id] || 0 }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  }

  return {
    FEATURES, features, predict, learn, trainHistory, stats, reset, ready, importance,
    get state() { return S; },
    version: "3.0.0",
  };
});
