/* ============================================================================
 * CryptoAI PRO — TA engine v3
 * Pure technical-analysis + signal scoring + backtester + walk-forward tuner.
 * No DOM, no network. Works in the WebView, in a browser, and in Node tests.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- helpers */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, d) => {
    if (!isFinite(v)) return 0;
    const f = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * f) / f;
  };
  const last = (a) => (a && a.length ? a[a.length - 1] : null);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  function sma(values, p) {
    const out = new Array(values.length).fill(null);
    if (p <= 0) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= p) sum -= values[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  function ema(values, p) {
    const out = new Array(values.length).fill(null);
    if (!values.length || p <= 0) return out;
    const k = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isFinite(v)) continue;
      if (i < p - 1) continue;
      if (prev === null) {
        let s = 0;
        for (let j = i - p + 1; j <= i; j++) s += values[j];
        prev = s / p;
      } else prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(values, p) {
    p = p || 14;
    const out = new Array(values.length).fill(null);
    if (values.length <= p) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= p; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let ag = gain / p, al = loss / p;
    out[p] = al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al);
    for (let i = p + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (p - 1) + g) / p;
      al = (al * (p - 1) + l) / p;
      out[i] = al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  function macd(values, fast, slow, signalP) {
    fast = fast || 12; slow = slow || 26; signalP = signalP || 9;
    const ef = ema(values, fast), es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const sig = new Array(values.length).fill(null);
    const hist = new Array(values.length).fill(null);
    const first = line.findIndex((v) => v != null);
    if (first >= 0) {
      const dense = line.slice(first);
      const s = ema(dense, signalP);
      for (let i = 0; i < dense.length; i++) {
        if (s[i] != null) {
          sig[first + i] = s[i];
          hist[first + i] = dense[i] - s[i];
        }
      }
    }
    return { line, signal: sig, hist };
  }

  function bollinger(values, p, k) {
    p = p || 20; k = k || 2;
    const mid = sma(values, p);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    const width = new Array(values.length).fill(null);
    const pctB = new Array(values.length).fill(null);
    for (let i = p - 1; i < values.length; i++) {
      let v = 0;
      for (let j = i - p + 1; j <= i; j++) v += Math.pow(values[j] - mid[i], 2);
      const sd = Math.sqrt(v / p);
      upper[i] = mid[i] + k * sd;
      lower[i] = mid[i] - k * sd;
      width[i] = mid[i] ? ((upper[i] - lower[i]) / mid[i]) * 100 : null;
      pctB[i] = upper[i] !== lower[i] ? ((values[i] - lower[i]) / (upper[i] - lower[i])) * 100 : 50;
    }
    return { mid, upper, lower, width, pctB };
  }

  function atr(candles, p) {
    p = p || 14;
    const out = new Array(candles.length).fill(null);
    if (!candles.length) return out;
    const tr = candles.map((c, i) => {
      if (i === 0) return c.h - c.l;
      const pc = candles[i - 1].c;
      return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
    });
    let prev = null;
    for (let i = 0; i < candles.length; i++) {
      if (i < p - 1) continue;
      if (prev === null) {
        let s = 0;
        for (let j = i - p + 1; j <= i; j++) s += tr[j];
        prev = s / p;
      } else prev = (prev * (p - 1) + tr[i]) / p;
      out[i] = prev;
    }
    return out;
  }

  function stochastic(candles, p, smooth) {
    p = p || 14; smooth = smooth || 3;
    const raw = new Array(candles.length).fill(null);
    for (let i = p - 1; i < candles.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++) {
        hi = Math.max(hi, candles[j].h);
        lo = Math.min(lo, candles[j].l);
      }
      raw[i] = hi === lo ? 50 : ((candles[i].c - lo) / (hi - lo)) * 100;
    }
    const idx = raw.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const dense = idx.map((i) => raw[i]);
    const sm = sma(dense, smooth);
    const K = new Array(candles.length).fill(null);
    idx.forEach((i, n) => { K[i] = sm[n]; });
    const dIdx = K.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const Dsm = sma(dIdx.map((i) => K[i]), 3);
    const D = new Array(candles.length).fill(null);
    dIdx.forEach((i, n) => { D[i] = Dsm[n]; });
    return { k: K, d: D };
  }

  /* Wilder ADX + directional indicators */
  function adx(candles, p) {
    p = p || 14;
    const n = candles.length;
    const outA = new Array(n).fill(null), outP = new Array(n).fill(null), outM = new Array(n).fill(null);
    if (n <= p * 2) return { adx: outA, pdi: outP, mdi: outM };
    const tr = [], pdm = [], mdm = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { tr.push(candles[0].h - candles[0].l); pdm.push(0); mdm.push(0); continue; }
      const up = candles[i].h - candles[i - 1].h;
      const dn = candles[i - 1].l - candles[i].l;
      tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
      pdm.push(up > dn && up > 0 ? up : 0);
      mdm.push(dn > up && dn > 0 ? dn : 0);
    }
    let sTr = 0, sP = 0, sM = 0;
    for (let i = 1; i <= p; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }
    let aTr = sTr / p, aP = sP / p, aM = sM / p;
    let pdi = aTr ? (100 * aP) / aTr : 0;
    let mdi = aTr ? (100 * aM) / aTr : 0;
    let dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    let adxV = dx;
    outA[p] = adxV; outP[p] = pdi; outM[p] = mdi;
    for (let i = p + 1; i < n; i++) {
      aTr = aTr - aTr / p + tr[i];
      aP = aP - aP / p + pdm[i];
      aM = aM - aM / p + mdm[i];
      pdi = aTr ? (100 * aP) / aTr : 0;
      mdi = aTr ? (100 * aM) / aTr : 0;
      dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
      adxV = (adxV * (p - 1) + dx) / p;
      outA[i] = adxV; outP[i] = pdi; outM[i] = mdi;
    }
    return { adx: outA, pdi: outP, mdi: outM };
  }

  function obv(candles) {
    const out = new Array(candles.length).fill(0);
    let s = 0;
    for (let i = 0; i < candles.length; i++) {
      if (i > 0) {
        const d = candles[i].c - candles[i - 1].c;
        if (d > 0) s += candles[i].v || 0;
        else if (d < 0) s -= candles[i].v || 0;
      }
      out[i] = s;
    }
    return out;
  }

  function vwap(candles, p) {
    p = p || 20;
    const out = new Array(candles.length).fill(null);
    let pv = 0, vv = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const tp = (c.h + c.l + c.c) / 3;
      pv += tp * (c.v || 0);
      vv += c.v || 0;
      if (i >= p) {
        const old = candles[i - p];
        pv -= ((old.h + old.l + old.c) / 3) * (old.v || 0);
        vv -= old.v || 0;
      }
      out[i] = vv ? pv / vv : null;
    }
    return out;
  }

  function rollingStd(values, p) {
    const out = new Array(values.length).fill(null);
    for (let i = p - 1; i < values.length; i++) {
      let s = 0, s2 = 0;
      for (let j = i - p + 1; j <= i; j++) { s += values[j]; s2 += values[j] * values[j]; }
      const m = s / p;
      out[i] = Math.sqrt(Math.max(0, s2 / p - m * m));
    }
    return out;
  }

  function rollingHigh(highs, p) {
    const out = new Array(highs.length).fill(null);
    for (let i = p; i < highs.length; i++) {
      let m = -Infinity;
      for (let j = i - p; j < i; j++) m = Math.max(m, highs[j]);
      out[i] = m;
    }
    return out;
  }
  function rollingLow(lows, p) {
    const out = new Array(lows.length).fill(null);
    for (let i = p; i < lows.length; i++) {
      let m = Infinity;
      for (let j = i - p; j < i; j++) m = Math.min(m, lows[j]);
      out[i] = m;
    }
    return out;
  }

  function efficiencyRatio(closes, p) {
    p = p || 20;
    const out = new Array(closes.length).fill(null);
    for (let i = p; i < closes.length; i++) {
      const net = Math.abs(closes[i] - closes[i - p]);
      let sum = 0;
      for (let j = i - p + 1; j <= i; j++) sum += Math.abs(closes[j] - closes[j - 1]);
      out[i] = sum ? net / sum : 0;
    }
    return out;
  }

  function roc(values, n) {
    const out = new Array(values.length).fill(null);
    for (let i = n; i < values.length; i++) {
      const a = values[i - n];
      out[i] = a ? ((values[i] - a) / a) * 100 : 0;
    }
    return out;
  }

  /* swing pivots (last 120 bars), used for structure + stops */
  function swings(k, w) {
    w = w || 3;
    const highs = [], lows = [];
    const start = Math.max(w, k.length - 160);
    for (let i = start; i < k.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        if (k[j].h > k[i].h) isH = false;
        if (k[j].l < k[i].l) isL = false;
      }
      if (isH) highs.push({ i, p: k[i].h });
      if (isL) lows.push({ i, p: k[i].l });
    }
    const dedupe = (arr, better) => {
      const out = [];
      for (const x of arr) {
        const pr = out[out.length - 1];
        if (pr && x.i - pr.i <= w) { if (better(x.p, pr.p)) out[out.length - 1] = x; }
        else out.push(x);
      }
      return out;
    };
    return { highs: dedupe(highs, (a, b) => a > b), lows: dedupe(lows, (a, b) => a < b) };
  }

  /* ---------------------------------------------------------------- weights */
  const WEIGHTS = {
    trend:   { trend: 0.32, momentum: 0.26, volume: 0.12, structure: 0.22, meanRev: 0.00, pattern: 0.08 },
    range:   { trend: 0.10, momentum: 0.14, volume: 0.08, structure: 0.16, meanRev: 0.38, pattern: 0.14 },
    mix:     { trend: 0.24, momentum: 0.22, volume: 0.10, structure: 0.20, meanRev: 0.16, pattern: 0.08 },
  };

  /* ---------------------------------------------------------------- prepare */
  function prepare(candles, opts) {
    opts = opts || {};
    const n = candles.length;
    const closes = candles.map((c) => c.c);
    const vols = candles.map((c) => c.v || 0);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const pre = {
      n, candles, closes, vols, highs, lows,
      e9: ema(closes, 9), e21: ema(closes, 21), e50: ema(closes, 50),
      e100: ema(closes, 100), e200: ema(closes, 200),
      rsi: rsi(closes, 14),
      macd: macd(closes, 12, 26, 9),
      adx: adx(candles, 14),
      atr: atr(candles, 14),
      bb: bollinger(closes, 20, 2),
      stoch: stochastic(candles, 14, 3),
      vwap: vwap(candles, 20),
      volSma: sma(vols, 20),
      er: efficiencyRatio(closes, 20),
      roc10: roc(closes, 10),
      hi20: rollingHigh(highs, 20),
      lo20: rollingLow(lows, 20),
      patBull: new Array(n).fill(0),
      patBear: new Array(n).fill(0),
      patHit: new Array(n).fill(null),
    };
    pre.obv = obv(candles);
    pre.obvEma = ema(pre.obv, 20);
    pre.obvStd = rollingStd(pre.obv, 20);
    pre.volStd = rollingStd(vols, 20);
    pre.volZ = vols.map((v, i) => {
      const sd = pre.volStd[i], m = pre.volSma[i];
      return sd ? (v - m) / sd : 0;
    });
    const sw = swings(candles, 3);
    pre.highs = sw.highs;
    pre.lows = sw.lows;

    /* candlestick + chart patterns — precomputed for fast backtests */
    if (typeof Patterns !== "undefined" && Patterns && Patterns.detect) {
      for (let i = 50; i < n; i++) {
        try {
          const s = Math.max(0, i - 170);
          const p = Patterns.detect(candles.slice(s, i + 1));
          pre.patBull[i] = p.bull || 0;
          pre.patBear[i] = p.bear || 0;
          pre.patHit[i] = p.hit || [];
        } catch (e) { /* keep zeros */ }
      }
    }
    return pre;
  }

  /* --------------------------------------------------------------- evaluate */
  function evaluate(pre, i, opts) {
    opts = opts || {};
    if (!pre || i < 50 || i >= pre.n) {
      return { ok: false, error: "not enough candles", score: 0, verdict: "NEUTRAL", confidence: 0, reasons: [], components: {} };
    }
    const c = pre.closes[i];
    const atr = pre.atr[i] || c * 0.01;
    const atrPct = (atr / c) * 100;
    const eF = pre[opts.emaFast || "e21"][i];
    const eFprev = pre[opts.emaFast || "e21"][i - 5];
    const eM = pre[opts.emaMid || "e50"][i];
    const eS = pre.e200[i];
    const R = pre.rsi[i];
    const H = pre.macd.hist[i];
    const Hp = pre.macd.hist[i - 1];
    const adx = pre.adx.adx[i], pdi = pre.adx.pdi[i], mdi = pre.adx.mdi[i];
    const pctB = pre.bb.pctB[i];
    const K = pre.stoch.k[i], D = pre.stoch.d[i];
    const vz = pre.volZ[i] || 0;
    const er = pre.er[i];
    const roc10 = pre.roc10[i] || 0;
    const patB = pre.patBull ? pre.patBull[i] : 0;
    const patS = pre.patBear ? pre.patBear[i] : 0;
    const dir = i > 0 ? (c >= pre.closes[i - 1] ? 1 : -1) : 1;

    const avg = (pairs) => {
      let s = 0, w = 0;
      for (const [v, ww] of pairs) { s += v * ww; w += ww; }
      return w ? s / w : 0;
    };

    /* ---- trend ---- */
    const tp = [];
    if (eF != null && eM != null) tp.push([eF > eM ? 1 : eF < eM ? -1 : 0, 1.0]);
    if (eM != null && eS != null) tp.push([eM > eS ? 1 : eM < eS ? -1 : 0, 0.8]);
    if (eF != null) tp.push([c > eF ? 1 : c < eF ? -1 : 0, 0.5]);
    if (eF != null && eFprev != null) tp.push([clamp(((eF - eFprev) / (atr * 5)) * 4, -1, 1), 0.7]);
    if (adx != null) tp.push([clamp((pdi - mdi) / 30, -1, 1) * clamp(adx / 45, 0, 1), 0.9]);
    const trend = clamp(avg(tp), -1, 1);

    /* ---- momentum ---- */
    const mp = [];
    if (H != null) {
      mp.push([clamp(H / (0.6 * atr), -1, 1), 1.0]);
      if (Hp != null) mp.push([H > Hp ? 1 : -1, 0.45]);
    }
    if (R != null) mp.push([clamp((R - 50) / 25, -1, 1), 0.9]);
    if (K != null && D != null) mp.push([clamp((K - D) / 25, -1, 1), 0.5]);
    mp.push([clamp(roc10 / (atrPct * 4 + 1e-9), -1, 1), 0.45]);
    const momentum = clamp(avg(mp), -1, 1);

    /* ---- volume ---- */
    const vp = [[clamp(vz / 2.2, -1, 1) * dir, 1.0]];
    if (pre.obvEma[i] != null && i >= 5 && pre.obvEma[i - 5] != null && pre.obvStd[i])
      vp.push([clamp((pre.obvEma[i] - pre.obvEma[i - 5]) / (pre.obvStd[i] * 6 + 1e-9), -1, 1), 0.6]);
    if (pre.volSma[i]) vp.push([clamp(pre.vols[i] / pre.volSma[i] - 1, -1, 1) * dir, 0.4]);
    const volume = clamp(avg(vp), -1, 1);

    /* ---- structure ---- */
    let st = 0;
    const hs = (pre.highs || []).filter((p) => p.i <= i && p.i > i - 90).slice(-5);
    const ls = (pre.lows || []).filter((p) => p.i <= i && p.i > i - 90).slice(-5);
    let hh = 0, hl = 0, lh = 0, ll = 0;
    for (let k = 1; k < hs.length; k++) { if (hs[k].p > hs[k - 1].p) hh++; else lh++; }
    for (let k = 1; k < ls.length; k++) { if (ls[k].p > ls[k - 1].p) hl++; else ll++; }
    st += clamp((hh + hl - lh - ll) / Math.max(1, hs.length + ls.length - 2), -1, 1) * 0.7;
    const hi20 = pre.hi20[i], lo20 = pre.lo20[i];
    let breakout = 0;
    if (hi20 != null && lo20 != null) {
      if (c > hi20) { st += 0.8; breakout = 1; }
      else if (c < lo20) { st -= 0.8; breakout = -1; }
      if (hi20 > lo20) st += ((c - lo20) / (hi20 - lo20) * 2 - 1) * 0.25;
    }
    const structure = clamp(st, -1, 1);

    /* ---- mean reversion (contrarian) ---- */
    let mrv = 0;
    const vw = pre.vwap[i];
    if (vw != null) mrv -= clamp((c - vw) / (1.5 * atr), -1, 1) * 0.65;
    if (pctB != null) mrv -= ((pctB - 50) / 50) * 0.45;
    if (R != null) { if (R < 30) mrv += 0.8; else if (R > 70) mrv -= 0.8; }
    if (K != null && D != null) {
      if (K < 25 && K > D) mrv += 0.45;
      else if (K > 75 && K < D) mrv -= 0.45;
    }
    const meanRev = clamp(mrv, -1, 1);

    /* ---- patterns ---- */
    const pattern = clamp(patB - patS, -1, 1);

    /* ---- regime ---- */
    let regime = "mix";
    if (adx != null) {
      if (adx >= 23 && (er == null || er >= 0.2)) regime = "trend";
      else if (adx <= 20 && (er == null || er <= 0.18)) regime = "range";
      if (adx <= 14) regime = "range";
    }

    const W = opts.weights || WEIGHTS[regime] || WEIGHTS.mix;
    const comps = { trend, momentum, volume, structure, meanRev, pattern };
    let score = 0;
    for (const k in comps) score += comps[k] * (W[k] || 0);
    score = clamp(score, -1, 1);

    /* agreement: how much of the active weight points the same way */
    let aw = 0, tw = 0;
    for (const k in comps) {
      const w = W[k] || 0;
      if (w <= 0) continue;
      tw += w;
      if (Math.sign(comps[k]) === Math.sign(score) && Math.abs(comps[k]) > 0.08) aw += w;
    }
    const agree = tw ? aw / tw : 0;

    let conflict = false;
    if (Math.abs(trend) > 0.5 && Math.abs(meanRev) > 0.5 && trend * meanRev < 0) {
      conflict = true;
      score *= 0.72;
    }
    if (agree < 0.5) score *= 0.65;

    /* volume divergence: price and OBV disagree on the last 5 bars */
    if (i >= 5 && pre.obvEma[i] != null && pre.obvEma[i - 5] != null) {
      const pUp = pre.closes[i] > pre.closes[i - 5];
      const oUp = pre.obvEma[i] > pre.obvEma[i - 5];
      if (pUp !== oUp && Math.abs(volume) < 0.15) score *= 0.82;
    }

    /* higher-timeframe filter */
    const htf = opts.htf || null;
    if (htf && htf.trend) {
      if (Math.sign(score) !== 0 && Math.sign(score) === htf.trend) score *= 1.12;
      else if (Math.sign(score) !== 0 && Math.sign(score) === -htf.trend) score *= 0.4;
    }

    /* BTC context (alts follow BTC) */
    if (opts.btcChg != null && opts.isAlt && Math.abs(opts.btcChg) > 3 && Math.sign(score) !== 0 && Math.sign(opts.btcChg) !== Math.sign(score)) {
      score *= 0.65;
    }

    /* learned brain ensemble */
    if (opts.brainP != null && opts.brainReady) {
      const bs = clamp((opts.brainP - 0.5) * 2, -1, 1);
      score = score * 0.65 + bs * 0.35;
    }
    score = clamp(score, -1, 1);

    let verdict = "NEUTRAL";
    if (score >= 0.42) verdict = "STRONG BUY";
    else if (score >= 0.2) verdict = "BUY";
    else if (score <= -0.42) verdict = "STRONG SELL";
    else if (score <= -0.2) verdict = "SELL";

    const patAlign = Math.sign(pattern) === Math.sign(score) && Math.abs(pattern) > 0.2;
    const confidence = Math.round(clamp(
      50 + Math.abs(score) * 55 + (agree - 0.5) * 28 + (patAlign ? 5 : 0)
      - (conflict ? 14 : 0) - (htf && htf.trend && Math.sign(score) === -htf.trend ? 10 : 0),
      4, 97));

    /* ---- trade levels ---- */
    const isBuy = verdict === "BUY" || verdict === "STRONG BUY";
    const isSell = verdict === "SELL" || verdict === "STRONG SELL";
    let levels = null;
    if (isBuy || isSell) {
      const d = isBuy ? 1 : -1;
      let swing = null;
      if (isBuy) {
        const arr = (pre.lows || []).filter((p) => p.i < i && p.i >= i - 12);
        if (arr.length) swing = Math.min.apply(null, arr.map((p) => p.p));
      } else {
        const arr = (pre.highs || []).filter((p) => p.i < i && p.i >= i - 12);
        if (arr.length) swing = Math.max.apply(null, arr.map((p) => p.p));
      }
      let slDist = (opts.slAtr || 1.6) * atr;
      if (swing != null) slDist = Math.abs(c - swing) + 0.15 * atr;
      slDist = clamp(slDist, 0.7 * atr, 2.8 * atr);
      const tpR = opts.tpR || 2.0;
      levels = {
        entry: c,
        sl: isBuy ? c - slDist : c + slDist,
        tp: isBuy ? c + tpR * slDist : c - tpR * slDist,
        rr: tpR,
        riskPct: (slDist / c) * 100,
        rewardPct: (tpR * slDist / c) * 100,
        timeStopBars: opts.timeStopBars || 30,
        stopType: swing != null ? "structure" : "atr",
      };
    }

    /* ---- reasons ---- */
    const reasons = [];
    const addR = (p, en, si, tag) => {
      if (Math.abs(p) >= 0.08) reasons.push({ p: round(p, 2), en, si, tag: tag || "" });
    };
    if (eF != null && eM != null) {
      if (eF > eM && c > eF) addR(trend * 2.2, "Uptrend: price above EMA21 and EMA21 above EMA50", "ඉහළ ප්‍රවණතාව: මිල EMA21 ට ඉහළින්, EMA21 EMA50 ට ඉහළින්", "trend");
      else if (eF < eM && c < eF) addR(trend * 2.2, "Downtrend: price below EMA21 and EMA21 below EMA50", "පහළ ප්‍රවණතාව: මිල EMA21 ට පහළින්, EMA21 EMA50 ට පහළින්", "trend");
      else addR(trend * 1.2, "Trend is mixed around the moving averages", "චලන සාමාන්‍යයන් වටේ ප්‍රවණතාව මිශ්‍රයි", "trend");
    }
    if (eM != null && eS != null) addR((eM > eS ? 1 : -1) * 1.1, eM > eS ? "EMA50 above EMA200 — long-term trend up" : "EMA50 below EMA200 — long-term trend down", eM > eS ? "EMA50 EMA200 ට ඉහළින් — දිගු කාලීන ප්‍රවණතාව ඉහළට" : "EMA50 EMA200 ට පහළින් — දිගු කාලීන ප්‍රවණතාව පහළට", "trend");
    if (adx != null) addR(clamp((pdi - mdi) / 30, -1, 1) * 1.6, `ADX ${round(adx, 0)} · +DI ${round(pdi, 0)} / −DI ${round(mdi, 0)} — ${adx >= 25 ? "strong trend" : adx >= 20 ? "developing trend" : "weak trend"}`, `ADX ${round(adx, 0)} · +DI ${round(pdi, 0)} / −DI ${round(mdi, 0)} — ${adx >= 25 ? "ශක්තිමත් ප්‍රවණතාවක්" : adx >= 20 ? "ගොඩනැගෙන ප්‍රවණතාවක්" : "දුර්වල ප්‍රවණතාවක්"}`, "trend");
    if (H != null) addR(clamp(H / (0.6 * atr), -1, 1) * 1.6, `MACD histogram ${H >= 0 ? "positive" : "negative"}${Hp != null ? (H > Hp ? " and rising" : " and falling") : ""}`, `MACD histogram ${H >= 0 ? "ධනාත්මක" : "සෘණාත්මක"}${Hp != null ? (H > Hp ? " සහ ඉහළ යමින්" : " සහ පහළ යමින්") : ""}`, "momentum");
    if (R != null) addR(clamp((R - 50) / 25, -1, 1) * 1.2, `RSI ${round(R, 1)}${R < 30 ? " — oversold" : R > 70 ? " — overbought" : ""}`, `RSI ${round(R, 1)}${R < 30 ? " — oversold" : R > 70 ? " — overbought" : ""}`, "momentum");
    if (K != null && D != null) addR(clamp((K - D) / 25, -1, 1) * 0.9, `Stochastic %K ${round(K, 0)} / %D ${round(D, 0)}`, `Stochastic %K ${round(K, 0)} / %D ${round(D, 0)}`, "momentum");
    addR(clamp(vz / 2.2, -1, 1) * 1.2, `Volume ${vz > 1 ? "spike" : vz < -1 ? "drying up" : "normal"} (z-score ${round(vz, 1)})`, `පරිමාව ${vz > 1 ? "ඉහළ යයි" : vz < -1 ? "අඩුවෙයි" : "සාමාන්‍යයි"} (z-score ${round(vz, 1)})`, "volume");
    if (pre.obvEma[i] != null && i >= 5 && pre.obvEma[i - 5] != null) {
      const os = pre.obvEma[i] - pre.obvEma[i - 5];
      addR(clamp(os / (Math.abs(pre.obvEma[i]) * 0.02 + 1e-9), -1, 1) * 1.0, os > 0 ? "OBV rising — accumulation" : "OBV falling — distribution", os > 0 ? "OBV ඉහළ යමින් — එකතු කිරීම" : "OBV පහළ යමින් — බෙදා හැරීම", "volume");
    }
    addR(structure * 1.4, breakout > 0 ? `Breakout above the 20-bar high (${round(hi20, 6)})` : breakout < 0 ? `Breakdown below the 20-bar low (${round(lo20, 6)})` : `Structure: ${hh} higher highs / ${hl} higher lows vs ${lh} lower highs / ${ll} lower lows`, breakout > 0 ? "20-bar ඉහළට බිඳීම" : breakout < 0 ? "20-bar පහළට බිඳීම" : `ව්‍යුහය: ඉහළ මිටි ${hh} / ඉහළ පහළ ${hl} එදිරිව පහළ මිටි ${lh} / පහළ පහළ ${ll}`, "structure");
    if (vw != null) addR(-clamp((c - vw) / (1.5 * atr), -1, 1) * 1.0, c > vw ? `Price above VWAP (${round(vw, 6)})` : `Price below VWAP (${round(vw, 6)})`, c > vw ? `මිල VWAP ට ඉහළින් (${round(vw, 6)})` : `මිල VWAP ට පහළින් (${round(vw, 6)})`, "meanRev");
    if (pctB != null) addR(-((pctB - 50) / 50) * 0.8, `Bollinger %B ${round(pctB, 0)}%`, `Bollinger %B ${round(pctB, 0)}%`, "meanRev");
    if (patB || patS) {
      const names = (pre.patHit[i] || []).filter((x) => x.v >= 0.35).slice(0, 3).map((x) => x.name);
      if (names.length) addR((patB - patS) * 1.1, `📚 ${names.join(" + ")}`, `📚 ${names.join(" + ")}`, "pattern");
    }
    if (conflict) addR(0, "Trend and mean-reversion disagree — edge is weak", "ප්‍රවණතාව සහ mean-reversion එකිනෙකට විරුද්ධයි — වාසිය දුර්වලයි", "warn");
    if (htf && htf.trend && Math.sign(score) !== 0 && Math.sign(score) === -htf.trend) addR(0, `Higher timeframe (${htf.label || "HTF"}) trend is against this signal`, `ඉහළ timeframe (${htf.label || "HTF"}) ප්‍රවණතාව මෙම සංඥාවට විරුද්ධයි`, "warn");
    if (agree < 0.5) addR(0, "Only some blocks agree — low-quality setup", "සමහර block පමණක් එකඟයි — දුර්වල setup එකක්", "warn");
    reasons.sort((a, b) => Math.abs(b.p) - Math.abs(a.p));

    return {
      ok: true,
      price: c,
      verdict,
      score: round(score, 3),
      confidence,
      regime,
      agree: round(agree, 2),
      conflict,
      breakout,
      components: {
        trend: { v: round(trend, 2), label: "Trend" },
        momentum: { v: round(momentum, 2), label: "Momentum" },
        volume: { v: round(volume, 2), label: "Volume" },
        structure: { v: round(structure, 2), label: "Structure" },
        meanRev: { v: round(meanRev, 2), label: "Mean reversion" },
        pattern: { v: round(pattern, 2), label: "Patterns" },
      },
      reasons,
      metrics: {
        rsi: R == null ? null : round(R, 1),
        macdHist: H == null ? null : round(H, 8),
        macdUp: H != null && Hp != null ? H > Hp : null,
        adx: adx == null ? null : round(adx, 1),
        pdi: pdi == null ? null : round(pdi, 1),
        mdi: mdi == null ? null : round(mdi, 1),
        atr: round(atr, 8),
        atrPct: round(atrPct, 2),
        bbUpper: pre.bb.upper[i] == null ? null : round(pre.bb.upper[i], 8),
        bbLower: pre.bb.lower[i] == null ? null : round(pre.bb.lower[i], 8),
        bbMid: pre.bb.mid[i] == null ? null : round(pre.bb.mid[i], 8),
        pctB: pctB == null ? null : round(pctB, 1),
        stochK: K == null ? null : round(K, 1),
        stochD: D == null ? null : round(D, 1),
        roc10: round(roc10, 2),
        volZ: round(vz, 2),
        volRatio: pre.volSma[i] ? round(pre.vols[i] / pre.volSma[i], 2) : null,
        vwap: vw == null ? null : round(vw, 8),
        ema21: eF == null ? null : round(eF, 8),
        ema50: eM == null ? null : round(eM, 8),
        ema200: eS == null ? null : round(eS, 8),
        er: er == null ? null : round(er, 2),
        patternBull: round(patB, 2),
        patternBear: round(patS, 2),
        patternNames: (pre.patHit[i] || []).filter((x) => x.v >= 0.35).slice(0, 4).map((x) => x.name),
        trend: eF != null && eM != null ? (c > eF && eF > eM ? "UP" : c < eF && eF < eM ? "DOWN" : "RANGE") : "RANGE",
      },
      levels,
      htf: htf || null,
      brainP: opts.brainP != null ? round(opts.brainP, 3) : null,
    };
  }

  function analyze(candles, opts) {
    opts = opts || {};
    if (!candles || candles.length < 60) {
      return { ok: false, error: "not enough candles", score: 0, verdict: "NEUTRAL", confidence: 0, reasons: [], components: {} };
    }
    const pre = opts.pre || prepare(candles, opts);
    return evaluate(pre, candles.length - 1, opts);
  }

  /* --------------------------------------------------------------- backtest */
  function backtestPre(pre, start, end, opts) {
    opts = opts || {};
    const fee = (opts.feePct != null ? opts.feePct : 0.1) / 100;
    const slip = (opts.slippagePct != null ? opts.slippagePct : 0.05) / 100;
    const minScore = opts.minScore != null ? opts.minScore : 0.22;
    const allowShort = opts.allowShort !== false;
    const timeStop = opts.timeStopBars || 30;
    const startAt = Math.max(60, start || 60);
    const endAt = Math.min(pre.n, end || pre.n);

    let equity = 1, peak = 1, maxDD = 0, pos = null;
    const trades = [];
    const eq = [];
    let barsInPos = 0;

    for (let i = startAt; i < endAt; i++) {
      const b = pre.candles[i];
      if (pos) {
        barsInPos++;
        let exit = null, reason = "";
        const hitSL = pos.dir > 0 ? b.l <= pos.sl : b.h >= pos.sl;
        const hitTP = pos.dir > 0 ? b.h >= pos.tp : b.l <= pos.tp;
        if (hitSL) { exit = pos.sl; reason = "SL"; }
        else if (hitTP) { exit = pos.tp; reason = "TP"; }
        else if (i - pos.i >= timeStop) { exit = b.c; reason = "time"; }
        else {
          const r = Math.abs(pos.entry - pos.sl);
          const profit = pos.dir > 0 ? b.c - pos.entry : pos.entry - b.c;
          if (profit >= r && pos.trail == null) pos.trail = pos.entry + pos.dir * r * 0.1;
          if (pos.trail != null) {
            if (pos.dir > 0) pos.sl = Math.max(pos.sl, pos.trail);
            else pos.sl = Math.min(pos.sl, pos.trail);
          }
        }
        if (exit != null) {
          const gross = pos.dir > 0 ? (exit - pos.entry) / pos.entry : (pos.entry - exit) / pos.entry;
          const net = (gross - fee * 2 - slip * 2) * pos.leverage;
          equity *= 1 + net;
          trades.push({ dir: pos.dir, entry: pos.entry, exit, pct: net * 100, reason, bars: i - pos.i });
          pos = null;
        }
      }
      if (!pos && i > startAt + 2) {
        const rep = evaluate(pre, i - 1, opts);
        if (rep.ok && Math.abs(rep.score) >= minScore && (rep.agree || 0) >= 0.5) {
          const dir = rep.score > 0 ? 1 : -1;
          if (dir > 0 || allowShort) {
            const lv = rep.levels;
            if (lv) {
              const entry = pre.candles[i].o * (1 + dir * slip);
              const slDist = Math.abs(entry - lv.sl);
              const riskPct = (opts.riskPct != null ? opts.riskPct : 1) / 100;
              const leverage = Math.min(1, riskPct / Math.max(1e-8, slDist / entry));
              pos = { dir, entry, sl: entry - dir * slDist, tp: entry + dir * lv.rr * slDist, i, trail: null, leverage };
            }
          }
        }
      }
      const uv = pos ? equity * (1 + pos.dir * ((pre.closes[i] - pos.entry) / pos.entry) * pos.leverage) : equity;
      eq.push(uv);
      peak = Math.max(peak, uv);
      maxDD = Math.max(maxDD, (peak - uv) / peak);
    }
    if (pos) {
      const exit = pre.closes[endAt - 1];
      const gross = pos.dir > 0 ? (exit - pos.entry) / pos.entry : (pos.entry - exit) / pos.entry;
      const net = (gross - fee * 2 - slip * 2) * pos.leverage;
      equity *= 1 + net;
      trades.push({ dir: pos.dir, entry: pos.entry, exit, pct: net * 100, reason: "close", bars: endAt - 1 - pos.i });
    }

    const wins = trades.filter((t) => t.pct > 0);
    const losses = trades.filter((t) => t.pct <= 0);
    const grossWin = wins.reduce((s, t) => s + t.pct, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pct, 0));
    const avgPct = trades.length ? trades.reduce((s, t) => s + t.pct, 0) / trades.length : 0;
    const variance = trades.length > 1 ? trades.reduce((s, t) => s + Math.pow(t.pct - avgPct, 2), 0) / (trades.length - 1) : 0;
    const sharpe = variance > 0 ? (avgPct / Math.sqrt(variance)) * Math.sqrt(trades.length) : 0;
    const buyHold = endAt > startAt ? ((pre.closes[endAt - 1] - pre.closes[startAt]) / pre.closes[startAt]) * 100 : 0;

    /* downsample equity curve for the UI */
    const curve = [];
    const step = Math.max(1, Math.floor(eq.length / 140));
    for (let i = 0; i < eq.length; i += step) curve.push(round(eq[i], 5));
    if (eq.length && curve[curve.length - 1] !== round(eq[eq.length - 1], 5)) curve.push(round(eq[eq.length - 1], 5));

    return {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
      profitFactor: grossLoss ? round(Math.min(99, grossWin / grossLoss), 2) : (grossWin > 0 ? 99 : 0),
      avgWin: wins.length ? round(grossWin / wins.length, 2) : 0,
      avgLoss: losses.length ? round(-grossLoss / losses.length, 2) : 0,
      expectancy: round(avgPct, 2),
      pnlPct: round((equity - 1) * 100, 2),
      maxDD: round(maxDD * 100, 2),
      sharpe: round(sharpe, 2),
      buyHoldPct: round(buyHold, 2),
      exposure: endAt > startAt ? round((barsInPos / (endAt - startAt)) * 100, 0) : 0,
      last: trades.slice(-8),
      curve,
    };
  }

  function backtest(candles, opts) {
    opts = opts || {};
    const pre = opts.pre || prepare(candles, opts);
    return backtestPre(pre, opts.warmup || 60, pre.n, opts);
  }

  /* --------------------------------------------------------------- optimize */
  function optimize(candles, base) {
    base = base || {};
    const pre = base.pre || prepare(candles, base);
    const n = pre.n;
    const split = Math.max(90, Math.floor(n * 0.7));
    const grid = [];
    const fast = [9, 21], mid = [50, 100], minScore = [0.16, 0.24, 0.32], slAtr = [1.2, 1.8], tpR = [1.5, 2.2];
    for (const ef of fast) for (const em of mid) for (const ms of minScore) for (const sa of slAtr) for (const tr of tpR) {
      grid.push(Object.assign({}, base, { emaFast: "e" + ef, emaMid: "e" + em, minScore: ms, slAtr: sa, tpR: tr, pre }));
    }
    const results = [];
    for (const g of grid) {
      const tr = backtestPre(pre, 60, split, g);
      const obj = (Math.min(8, tr.profitFactor || 0)) * Math.sqrt(tr.trades) * (1 - Math.min(0.6, tr.maxDD / 100));
      results.push({ params: { emaFast: g.emaFast, emaMid: g.emaMid, minScore: g.minScore, slAtr: g.slAtr, tpR: g.tpR }, train: tr, obj: round(obj, 3) });
    }
    results.sort((a, b) => b.obj - a.obj);
    const best = results[0].params;
    const test = backtestPre(pre, split, n, Object.assign({}, base, best, { pre }));
    const baseTest = backtestPre(pre, split, n, Object.assign({}, base, { pre }));
    return {
      best,
      train: results[0].train,
      test,
      baseTest,
      split,
      tested: n - split,
      top: results.slice(0, 6),
    };
  }

  return {
    sma, ema, rsi, macd, bollinger, atr, stochastic, adx, obv, vwap,
    prepare, evaluate, analyze, backtest, backtestPre, optimize,
    swings, efficiencyRatio, rollingStd, clamp, round, WEIGHTS,
    version: "3.0.0",
  };
});
