
/* Embedded from patterns.js */
/* ============================================================================
 * CryptoAI PRO — patterns.js · HUNTRADERS KNOWLEDGE ENGINE 📚
 * ---------------------------------------------------------------------------
 * Huntraders books (Candlestick patterns — 88 formations · Chart patterns —
 * 31 formations) වලින් ගත්ත දැනුම මත පදනම්ව — pattern recognition engine:
 *
 *   • Candlestick patterns (24): hammer, shooting star, engulfing, morning/
 *     evening star, three soldiers/crows, harami, piercing, dark cloud,
 *     tweezers, marubozu, three methods, kicking ...
 *   • Chart patterns (7): double top/bottom, head & shoulders, ascending/
 *     descending triangle, triple top/bottom
 *
 * හැම pattern එකකටම book එකේ reliability rating (High=1.0 / Moderate=0.75 /
 * Low=0.5) + trend context rules (reversal patterns වලට ප්‍රවණතාවක් ඕන)
 * එකතු වෙනවා — brain එකට features විදිහට යනවා, ඒත් live learning එකෙන්
 * කොයි pattern එකද මේ market එකේ ඇත්තටම වැඩ කරන්නේ කියලා brain එකම තීරණය කරනවා.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Patterns = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const REL = { High: 1.0, Moderate: 0.75, Low: 0.5 };

  /* ------------------------------------------------------------- catalog -- */
  const CATALOG = [
    /* candlesticks — bullish */
    { id: "hammer", name: "Hammer", side: 1, rel: REL.Moderate, role: "reversal", n: 1 },
    { id: "invhammer", name: "Inverted Hammer", side: 1, rel: REL.Moderate, role: "reversal", n: 1 },
    { id: "bullengulf", name: "Bullish Engulfing", side: 1, rel: REL.High, role: "reversal", n: 2 },
    { id: "piercing", name: "Piercing Line", side: 1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "bullharami", name: "Bullish Harami", side: 1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "tweezerbot", name: "Tweezer Bottom", side: 1, rel: REL.Low, role: "reversal", n: 2 },
    { id: "morningstar", name: "Morning Star", side: 1, rel: REL.High, role: "reversal", n: 3 },
    { id: "threewhitesoldiers", name: "Three White Soldiers", side: 1, rel: REL.High, role: "reversal", n: 3 },
    { id: "threeinsideup", name: "Three Inside Up", side: 1, rel: REL.Moderate, role: "reversal", n: 3 },
    { id: "rising3methods", name: "Rising Three Methods", side: 1, rel: REL.Moderate, role: "continuation", n: 5 },
    { id: "bullkicking", name: "Bullish Kicking", side: 1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "bullmarubozu", name: "White Marubozu", side: 1, rel: REL.Moderate, role: "continuation", n: 1 },
    /* candlesticks — bearish */
    { id: "hangingman", name: "Hanging Man", side: -1, rel: REL.Moderate, role: "reversal", n: 1 },
    { id: "shootingstar", name: "Shooting Star", side: -1, rel: REL.Moderate, role: "reversal", n: 1 },
    { id: "bearengulf", name: "Bearish Engulfing", side: -1, rel: REL.High, role: "reversal", n: 2 },
    { id: "darkcloud", name: "Dark Cloud Cover", side: -1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "bearharami", name: "Bearish Harami", side: -1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "tweezertop", name: "Tweezer Top", side: -1, rel: REL.Low, role: "reversal", n: 2 },
    { id: "eveningstar", name: "Evening Star", side: -1, rel: REL.High, role: "reversal", n: 3 },
    { id: "threeblackcrows", name: "Three Black Crows", side: -1, rel: REL.High, role: "reversal", n: 3 },
    { id: "threeinsidedown", name: "Three Inside Down", side: -1, rel: REL.Moderate, role: "reversal", n: 3 },
    { id: "falling3methods", name: "Falling Three Methods", side: -1, rel: REL.Moderate, role: "continuation", n: 5 },
    { id: "bearkicking", name: "Bearish Kicking", side: -1, rel: REL.Moderate, role: "reversal", n: 2 },
    { id: "bearmarubozu", name: "Black Marubozu", side: -1, rel: REL.Moderate, role: "continuation", n: 1 },
    /* chart patterns — bullish */
    { id: "doublebottom", name: "Double Bottom", side: 1, rel: REL.High, role: "reversal", chart: true },
    { id: "hsbottom", name: "Head & Shoulders Bottom", side: 1, rel: REL.Moderate, role: "reversal", chart: true },
    { id: "asctriangle", name: "Ascending Triangle", side: 1, rel: REL.Moderate, role: "continuation", chart: true },
    { id: "triplebottom", name: "Triple Bottom", side: 1, rel: REL.Moderate, role: "reversal", chart: true },
    /* chart patterns — bearish */
    { id: "doubletop", name: "Double Top", side: -1, rel: REL.High, role: "reversal", chart: true },
    { id: "hstop", name: "Head & Shoulders Top", side: -1, rel: REL.Moderate, role: "reversal", chart: true },
    { id: "desctriangle", name: "Descending Triangle", side: -1, rel: REL.Moderate, role: "continuation", chart: true },
    { id: "tripleTop", name: "Triple Top", side: -1, rel: REL.Moderate, role: "reversal", chart: true },
  ];

  /* --------------------------------------------------------------- utils -- */
  const last = (a) => a[a.length - 1];
  function avgRange(k, n) {
    let s = 0; const m = Math.min(n, k.length);
    for (let i = k.length - m; i < k.length; i++) s += k[i].h - k[i].l;
    return (s / m) || 1;
  }
  function trendDir(k, n) {
    if (k.length < n + 1) return 0;
    const a = k[k.length - 1 - n].c, b = last(k).c;
    const ch = (b - a) / a;
    return ch > 0.004 ? 1 : ch < -0.004 ? -1 : 0;
  }
  function swings(k, w) {
    const highs = [], lows = [];
    const start = Math.max(w, k.length - 120);
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
    /* merge duplicate pivots (same peak registered on adjacent bars) */
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

  /* --------------------------------------------------- candlestick logic -- */
  function detectCandles(k) {
    const out = [];
    if (k.length < 10) return out;
    const R = avgRange(k, 20);
    const c = (o, cl) => Math.abs(cl - o);              /* body */
    const up = (r) => r.h - Math.max(r.o, r.c);
    const lo = (r) => Math.min(r.o, r.c) - r.l;
    const bull = (r) => r.c > r.o, bear = (r) => r.c < r.o;
    const L1 = last(k), L2 = k[k.length - 2], L3 = k[k.length - 3], L4 = k[k.length - 4], L5 = k[k.length - 5];
    const down = trendDir(k.slice(0, -1), 8) < 0;       /* context before the pattern */
    const upT = trendDir(k.slice(0, -1), 8) > 0;

    /* single-candle */
    if (down && lo(L1) >= 2 * c(L1.o, L1.c) && up(L1) <= 0.35 * c(L1.o, L1.c) && c(L1.o, L1.c) < 0.4 * R)
      out.push({ id: "hammer", str: Math.min(1, lo(L1) / (2.5 * R)) });
    if (down && up(L1) >= 2 * c(L1.o, L1.c) && lo(L1) <= 0.35 * c(L1.o, L1.c) && c(L1.o, L1.c) < 0.4 * R)
      out.push({ id: "invhammer", str: Math.min(1, up(L1) / (2.5 * R)) });
    if (upT && up(L1) >= 2 * c(L1.o, L1.c) && lo(L1) <= 0.35 * c(L1.o, L1.c) && c(L1.o, L1.c) < 0.4 * R)
      out.push({ id: "shootingstar", str: Math.min(1, up(L1) / (2.5 * R)) });
    if (upT && lo(L1) >= 2 * c(L1.o, L1.c) && up(L1) <= 0.35 * c(L1.o, L1.c) && c(L1.o, L1.c) < 0.4 * R)
      out.push({ id: "hangingman", str: Math.min(1, lo(L1) / (2.5 * R)) });
    if (c(L1.o, L1.c) >= 0.85 * (L1.h - L1.l) && L1.h - L1.l >= 1.1 * R) {
      if (bull(L1)) out.push({ id: "bullmarubozu", str: Math.min(1, c(L1.o, L1.c) / R) });
      else out.push({ id: "bearmarubozu", str: Math.min(1, c(L1.o, L1.c) / R) });
    }

    /* two-candle */
    if (bear(L2) && bull(L1) && L1.c >= L2.o && L1.o <= L2.c && c(L1.o, L1.c) > c(L2.o, L2.c) && down)
      out.push({ id: "bullengulf", str: Math.min(1, c(L1.o, L1.c) / (R)) });
    if (bull(L2) && bear(L1) && L1.c <= L2.o && L1.o >= L2.c && c(L1.o, L1.c) > c(L2.o, L2.c) && upT)
      out.push({ id: "bearengulf", str: Math.min(1, c(L1.o, L1.c) / (R)) });
    if (bear(L2) && bull(L1) && L1.o < L2.l && L1.c > (L2.o + L2.c) / 2 && L1.c < L2.o && down)
      out.push({ id: "piercing", str: Math.min(1, (L1.c - (L2.o + L2.c) / 2) / (c(L2.o, L2.c) / 2 || 1)) });
    if (bull(L2) && bear(L1) && L1.o > L2.h && L1.c < (L2.o + L2.c) / 2 && L1.c > L2.o && upT)
      out.push({ id: "darkcloud", str: Math.min(1, ((L2.o + L2.c) / 2 - L1.c) / (c(L2.o, L2.c) / 2 || 1)) });
    if (bear(L2) && c(L2.o, L2.c) > R * 0.7 && bull(L1) && L1.o < L2.c && L1.c > L2.o && c(L1.o, L1.c) < c(L2.o, L2.c) * 0.7 && down)
      out.push({ id: "bullharami", str: 0.5 + 0.5 * (1 - c(L1.o, L1.c) / (c(L2.o, L2.c) || 1)) });
    if (bull(L2) && c(L2.o, L2.c) > R * 0.7 && bear(L1) && L1.o > L2.c && L1.c < L2.o && c(L1.o, L1.c) < c(L2.o, L2.c) * 0.7 && upT)
      out.push({ id: "bearharami", str: 0.5 + 0.5 * (1 - c(L1.o, L1.c) / (c(L2.o, L2.c) || 1)) });
    if (down && bear(L2) && bull(L1) && Math.abs(L1.l - L2.l) <= 0.0012 * L2.l)
      out.push({ id: "tweezerbot", str: 0.6 });
    if (upT && bull(L2) && bear(L1) && Math.abs(L1.h - L2.h) <= 0.0012 * L2.h)
      out.push({ id: "tweezertop", str: 0.6 });
    if (bear(L2) && c(L2.o, L2.c) > 0.7 * R && bull(L1) && c(L1.o, L1.c) > 0.7 * R && L1.o > L2.o && L1.c > L2.c && (L1.o / L2.c - 1) > 0.002)
      out.push({ id: "bullkicking", str: 0.8 });
    if (bull(L2) && c(L2.o, L2.c) > 0.7 * R && bear(L1) && c(L1.o, L1.c) > 0.7 * R && L1.o < L2.o && L1.c < L2.c && (L2.c / L1.o - 1) > 0.002)
      out.push({ id: "bearkicking", str: 0.8 });

    /* three-candle */
    const smallBody = (r) => c(r.o, r.c) < 0.35 * R;
    if (down && bear(L3) && c(L3.o, L3.c) > 0.6 * R && smallBody(L2) && bull(L1) && L1.c > (L3.o + L3.c) / 2)
      out.push({ id: "morningstar", str: Math.min(1, c(L1.o, L1.c) / R + 0.3) });
    if (upT && bull(L3) && c(L3.o, L3.c) > 0.6 * R && smallBody(L2) && bear(L1) && L1.c < (L3.o + L3.c) / 2)
      out.push({ id: "eveningstar", str: Math.min(1, c(L1.o, L1.c) / R + 0.3) });
    if (down && bull(L3) && bull(L2) && bull(L1) && c(L3.o, L3.c) > 0.6 * R && c(L2.o, L2.c) > 0.6 * R && c(L1.o, L1.c) > 0.6 * R &&
        L2.c > L3.c && L1.c > L2.c && L1.o > L3.o && lo(L1) < R * 0.4 && lo(L2) < R * 0.4 && lo(L3) < R * 0.4)
      out.push({ id: "threewhitesoldiers", str: 0.9 });
    if (upT && bear(L3) && bear(L2) && bear(L1) && c(L3.o, L3.c) > 0.6 * R && c(L2.o, L2.c) > 0.6 * R && c(L1.o, L1.c) > 0.6 * R &&
        L2.c < L3.c && L1.c < L2.c && L1.o < L3.o && up(L1) < R * 0.4 && up(L2) < R * 0.4 && up(L3) < R * 0.4)
      out.push({ id: "threeblackcrows", str: 0.9 });
    if (down && bear(L3) && bull(L2) && L2.o < L3.c && L2.c > L3.o && bull(L1) && L1.c > L3.h)
      out.push({ id: "threeinsideup", str: 0.75 });
    if (upT && bull(L3) && bear(L2) && L2.o > L3.c && L2.c < L3.o && bear(L1) && L1.c < L3.l)
      out.push({ id: "threeinsidedown", str: 0.75 });

    /* five-candle continuations */
    if (k.length >= 6) {
      const A = k[k.length - 6];
      if (bull(A) && c(A.o, A.c) > 0.8 * R && bull(L1) && c(L1.o, L1.c) > 0.8 * R) {
        const mids = [L5, L4, L3, L2];
        if (mids.every((r) => bear(r) && smallBody(r)) &&
            mids.every((r) => Math.min(r.o, r.c) > A.c * 0.985 && Math.max(r.o, r.c) < A.c * 1.03) &&
            L1.c > A.h)
          out.push({ id: "rising3methods", str: 0.8 });
      }
      if (bear(A) && c(A.o, A.c) > 0.8 * R && bear(L1) && c(L1.o, L1.c) > 0.8 * R) {
        const mids = [L5, L4, L3, L2];
        if (mids.every((r) => bull(r) && smallBody(r)) &&
            mids.every((r) => Math.max(r.o, r.c) < A.c * 1.015 && Math.min(r.o, r.c) > A.c * 0.97) &&
            L1.c < A.l)
          out.push({ id: "falling3methods", str: 0.8 });
      }
    }
    return out;
  }

  /* ------------------------------------------------------- chart patterns -- */
  function detectCharts(k) {
    const out = [];
    if (k.length < 60) return out;
    const px = last(k).c;
    const { highs, lows } = swings(k, 4);

    /* latest pivot + the extreme pivot before it (the real first peak/trough) */
    const h2 = highs.length ? highs[highs.length - 1] : null;
    let h1 = null;
    if (h2) for (let j = highs.length - 2; j >= 0; j--) if (h2.i - highs[j].i >= 6 && (!h1 || highs[j].p > h1.p)) h1 = highs[j];
    const l2 = lows.length ? lows[lows.length - 1] : null;
    let l1 = null;
    if (l2) for (let j = lows.length - 2; j >= 0; j--) if (l2.i - lows[j].i >= 6 && (!l1 || lows[j].p < l1.p)) l1 = lows[j];

    const recentHi = Math.max.apply(null, k.slice(-30).map((x) => x.h));
    const recentLo = Math.min.apply(null, k.slice(-30).map((x) => x.l));
    const maxPivotHi = highs.length ? Math.max.apply(null, highs.map((x) => x.p)) : 0;
    const minPivotLo = lows.length ? Math.min.apply(null, lows.map((x) => x.p)) : Infinity;

    /* Double Top — High reliability: two ~equal peaks after an uptrend, neckline break confirms */
    if (h2 && h1) {
      const sim = 1 - Math.abs(h2.p - h1.p) / h1.p;
      if (sim > 0.94 && h2.p >= maxPivotHi * 0.97 && h2.p >= recentHi * 0.97 && trendDir(k.slice(0, h1.i + 1), 20) > 0) {
        let trough = Infinity;
        for (let i = h1.i; i <= h2.i; i++) trough = Math.min(trough, k[i].l);
        if (trough > 0 && (h1.p - trough) / h1.p >= 0.02 && (h1.p - trough) / h1.p < 0.3 && px < trough)
          out.push({ id: "doubletop", str: Math.min(1, sim * 1.2) });
        /* triple top: a third ~equal peak also present */
        const h3 = highs.length >= 3 ? highs[highs.length - 3] : null;
        if (h3 && h2.i - h3.i >= 6 && Math.abs(h3.p - h1.p) / h1.p < 0.04 && px < trough)
          out.push({ id: "tripleTop", str: 0.85 });
      }
    }

    /* Double Bottom — mirror */
    if (l2 && l1) {
      const simB = 1 - Math.abs(l2.p - l1.p) / l1.p;
      if (simB > 0.94 && l2.p <= minPivotLo * 1.03 && l2.p >= minPivotLo * 0.97 && l2.p <= recentLo * 1.003 && trendDir(k.slice(0, l1.i + 1), 20) < 0) {
        let neck = -Infinity;
        for (let i = l1.i; i <= l2.i; i++) neck = Math.max(neck, k[i].h);
        if ((neck - l1.p) / l1.p >= 0.02 && (neck - l1.p) / l1.p < 0.3 && px > neck)
          out.push({ id: "doublebottom", str: Math.min(1, simB * 1.2) });
        const l3 = lows.length >= 3 ? lows[lows.length - 3] : null;
        if (l3 && l2.i - l3.i >= 6 && Math.abs(l3.p - l1.p) / l1.p < 0.04 && px > neck)
          out.push({ id: "triplebottom", str: 0.85 });
      }
    }

    /* Head & Shoulders Top — 3 distinct peaks, middle highest, neckline break */
    if (highs.length >= 3) {
      const p1 = highs[highs.length - 1], p2 = highs[highs.length - 2], p3 = highs[highs.length - 3];
      if (p2.i - p3.i >= 8 && p1.i - p2.i >= 8 && p2.p > p1.p && p2.p > p3.p && Math.abs(p1.p - p3.p) / p2.p < 0.06) {
        let neck = Infinity;
        for (let i = p3.i; i <= p1.i; i++) neck = Math.min(neck, k[i].l);
        if (px < neck) out.push({ id: "hstop", str: 0.7 + 0.3 * (1 - Math.abs(p1.p - p3.p) / p2.p / 0.06) });
      }
    }
    /* Head & Shoulders Bottom */
    if (lows.length >= 3) {
      const q1 = lows[lows.length - 1], q2 = lows[lows.length - 2], q3 = lows[lows.length - 3];
      if (q2.i - q3.i >= 8 && q1.i - q2.i >= 8 && q2.p < q1.p && q2.p < q3.p && Math.abs(q1.p - q3.p) / q3.p < 0.06) {
        let neck = -Infinity;
        for (let i = q3.i; i <= q1.i; i++) neck = Math.max(neck, k[i].h);
        if (px > neck) out.push({ id: "hsbottom", str: 0.7 + 0.3 * (1 - Math.abs(q1.p - q3.p) / q3.p / 0.06) });
      }
    }

    /* Triangles — flat resistance + rising lows (ascending, bullish on breakout),
       flat support + falling highs (descending, bearish on breakdown) */
    if (highs.length >= 2 && lows.length >= 2) {
      const hs = highs.slice(-3).map((x) => x.p);
      const ls = lows.slice(-3).map((x) => x.p);
      const flatHi = hs.length >= 2 && (Math.max.apply(null, hs) - Math.min.apply(null, hs)) / Math.max.apply(null, hs) < 0.015;
      const flatLo = ls.length >= 2 && (Math.max.apply(null, ls) - Math.min.apply(null, ls)) / Math.max.apply(null, ls) < 0.015;
      const risingLo = ls[ls.length - 1] > ls[ls.length - 2] * 1.004;
      const fallingHi = hs[hs.length - 1] < hs[hs.length - 2] * 0.996;
      if (flatHi && risingLo && px > Math.max.apply(null, hs))
        out.push({ id: "asctriangle", str: 0.8 });
      if (flatLo && fallingHi && px < Math.min.apply(null, ls))
        out.push({ id: "desctriangle", str: 0.8 });
    }
    return out;
  }

  /* ---------------------------------------------------------------- main -- */
  function detect(k) {
    const candles = detectCandles(k);
    const charts = detectCharts(k);
    const res = { bull: 0, bear: 0, chartBull: 0, chartBear: 0, hit: [] };
    const add = (d) => {
      const cat = CATALOG.find((x) => x.id === d.id);
      if (!cat) return;
      const v = Math.min(1, d.str) * cat.rel;
      res.hit.push({ id: d.id, name: cat.name, side: cat.side, rel: cat.rel, v });
      if (cat.chart) { if (cat.side > 0) res.chartBull = Math.max(res.chartBull, v); else res.chartBear = Math.max(res.chartBear, v); }
      else { if (cat.side > 0) res.bull = Math.max(res.bull, v); else res.bear = Math.max(res.bear, v); }
    };
    candles.forEach(add); charts.forEach(add);
    return res;
  }

  return { CATALOG, detect };
});

