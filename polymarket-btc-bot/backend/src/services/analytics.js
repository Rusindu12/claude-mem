/**
 * Analytics & Calibration Engine.
 * Computes win rate, average edge, ROI, Brier score, calibration buckets,
 * and supports threshold replay over recorded snapshots.
 */

export function computeAnalytics({ trades = [], windows = [], initialBalance = 1000 }) {
  const settledTrades = trades.filter((t) => t.outcome === 'WIN' || t.outcome === 'LOSS');
  const wins = settledTrades.filter((t) => t.outcome === 'WIN').length;
  const totalTrades = trades.length;
  const winRate = settledTrades.length > 0 ? wins / settledTrades.length : 0;

  const totalPnl = settledTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const totalStaked = settledTrades.reduce((acc, t) => acc + (t.sizeUsd || 0), 0);
  const roi = totalStaked > 0 ? totalPnl / totalStaked : 0;
  const avgEdge =
    trades.length > 0
      ? trades.reduce((acc, t) => acc + (t.edge || 0), 0) / trades.length
      : 0;

  // Brier score & calibration over settled windows with a recorded model probability
  const settledWindows = windows.filter(
    (w) => w.settled && (w.outcome === 'UP' || w.outcome === 'DOWN') && typeof w.initialModelProb === 'number'
  );

  let brierSum = 0;
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i * 10}-${(i + 1) * 10}%`,
    min: i / 10,
    max: (i + 1) / 10,
    count: 0,
    predictedSum: 0,
    actualSum: 0,
  }));

  for (const w of settledWindows) {
    const p = Math.max(0, Math.min(1, w.initialModelProb));
    const y = w.outcome === 'UP' ? 1 : 0;
    brierSum += Math.pow(p - y, 2);
    const idx = Math.min(9, Math.floor(p * 10));
    buckets[idx].count += 1;
    buckets[idx].predictedSum += p;
    buckets[idx].actualSum += y;
  }

  const brierScore = settledWindows.length > 0 ? brierSum / settledWindows.length : null;
  const calibration = buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      bucket: b.bucket,
      count: b.count,
      avgPredicted: Math.round((b.predictedSum / b.count) * 1000) / 1000,
      actualFreq: Math.round((b.actualSum / b.count) * 1000) / 1000,
    }));

  return {
    balance: Math.round((initialBalance + totalPnl) * 100) / 100,
    initialBalance,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalTrades,
    settledTrades: settledTrades.length,
    wins,
    losses: settledTrades.length - wins,
    winRate: Math.round(winRate * 10000) / 10000,
    avgEdge: Math.round(avgEdge * 10000) / 10000,
    roi: Math.round(roi * 10000) / 10000,
    brierScore: brierScore !== null ? Math.round(brierScore * 10000) / 10000 : null,
    settledWindowsCount: settledWindows.length,
    calibration,
  };
}

/**
 * Replay stored snapshots with a candidate edge threshold to evaluate what
 * decisions and PnL would have been achieved.
 */
export function replaySnapshots(snapshots = [], { edgeThreshold = 0.03, feeRate = 0.005, slippageEst = 0.005 } = {}) {
  let buyUp = 0;
  let buyDown = 0;
  let pass = 0;

  for (const s of snapshots) {
    const pUp = s.modelProbUp ?? 0.5;
    const edgeUp = pUp - (s.upAsk ?? 0.5) - feeRate - slippageEst;
    const edgeDown = (1 - pUp) - (s.downAsk ?? 0.5) - feeRate - slippageEst;
    if (edgeUp >= edgeThreshold && edgeUp >= edgeDown) buyUp++;
    else if (edgeDown >= edgeThreshold && edgeDown > edgeUp) buyDown++;
    else pass++;
  }

  return {
    totalSnapshots: snapshots.length,
    edgeThreshold,
    buyUp,
    buyDown,
    pass,
  };
}
