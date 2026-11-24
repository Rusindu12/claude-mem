import { describe, it, expect } from 'vitest';
import { RiskManager } from '../src/risk/riskManager.js';

describe('RiskManager', () => {
  it('computes fractional Kelly sizing capped at maxTradeUsd', () => {
    const rm = new RiskManager({ kellyFraction: 0.25, maxTradeUsd: 50 });
    const size = rm.computeKellySizeUsd({ modelProb: 0.65, marketAsk: 0.50, bankrollUsd: 1000 });
    // Full Kelly = (0.65 - 0.50) / (1 - 0.50) = 0.30; 0.25x = 0.075 -> $75, capped at $50
    expect(size).toBe(50);

    const smaller = rm.computeKellySizeUsd({ modelProb: 0.55, marketAsk: 0.50, bankrollUsd: 1000 });
    // Full Kelly = 0.10; 0.25x = 0.025 -> $25
    expect(smaller).toBe(25);
  });

  it('enforces kill switch immediately', () => {
    const rm = new RiskManager();
    rm.triggerKillSwitch('Emergency stop');
    const res = rm.evaluateOrder({ windowId: 'w1', modelProb: 0.70, marketAsk: 0.50, bankrollUsd: 1000 });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Kill switch active');
  });

  it('enforces daily loss limit and consecutive loss cooldown', () => {
    const rm = new RiskManager({
      dailyLossLimitUsd: 100,
      cooldownAfterLosses: 2,
      cooldownDurationMs: 60_000,
    });
    const now = 1_000_000;
    rm.recordSettlement('w1', 30, -30, now);
    rm.recordSettlement('w2', 30, -30, now + 1000);

    // Cooldown should block immediately
    const resCooldown = rm.evaluateOrder({
      windowId: 'w3',
      modelProb: 0.70,
      marketAsk: 0.50,
      bankrollUsd: 1000,
      nowMs: now + 5000,
    });
    expect(resCooldown.allowed).toBe(false);
    expect(resCooldown.reason).toContain('Loss cooldown active');

    // After cooldown, exceed daily loss limit
    rm.recordSettlement('w3', 50, -50, now + 70_000);
    const resDaily = rm.evaluateOrder({
      windowId: 'w4',
      modelProb: 0.70,
      marketAsk: 0.50,
      bankrollUsd: 1000,
      nowMs: now + 150_000,
    });
    expect(resDaily.allowed).toBe(false);
    expect(resDaily.reason).toContain('Daily loss limit reached');
  });

  it('enforces per-window and max open exposure caps', () => {
    const rm = new RiskManager({ maxTradeUsd: 40, maxWindowUsd: 60, maxOpenExposureUsd: 80 });
    rm.recordOpenOrder('w1', 55);
    const res = rm.evaluateOrder({ windowId: 'w1', modelProb: 0.70, marketAsk: 0.50, bankrollUsd: 1000 });
    expect(res.allowed).toBe(true);
    expect(res.sizeUsd).toBe(5);
  });

  it('enforces DRY_RUN default and LIVE_TRADING + UI confirmation gate', () => {
    const rmDefault = new RiskManager({ dryRun: true, liveTradingEnvEnabled: false });
    expect(rmDefault.isLiveExecutionAllowed()).toBe(false);
    const attempt = rmDefault.setUiLiveConfirmation(true, 'I UNDERSTAND LIVE TRADING RISK');
    expect(attempt.ok).toBe(false);

    const rmLive = new RiskManager({ dryRun: false, liveTradingEnvEnabled: true });
    expect(rmLive.isLiveExecutionAllowed()).toBe(false); // Still false until UI confirmed
    expect(rmLive.setUiLiveConfirmation(true, 'wrong phrase').ok).toBe(false);
    expect(rmLive.setUiLiveConfirmation(true, 'I UNDERSTAND LIVE TRADING RISK').ok).toBe(true);
    expect(rmLive.isLiveExecutionAllowed()).toBe(true);
  });
});
