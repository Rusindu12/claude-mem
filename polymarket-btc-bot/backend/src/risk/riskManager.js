/**
 * Risk Controls & Safety Gate Manager.
 * Enforces fractional Kelly sizing, per-trade/per-window caps, daily loss limits,
 * max open exposure, consecutive-loss cooldowns, kill switch, and live-trading safety gates.
 */

export class RiskManager {
  constructor(config = {}) {
    this.config = {
      kellyFraction: config.kellyFraction ?? 0.25,
      maxTradeUsd: config.maxTradeUsd ?? 50,
      maxWindowUsd: config.maxWindowUsd ?? 100,
      dailyLossLimitUsd: config.dailyLossLimitUsd ?? 250,
      maxOpenExposureUsd: config.maxOpenExposureUsd ?? 200,
      cooldownAfterLosses: config.cooldownAfterLosses ?? 3,
      cooldownDurationMs: config.cooldownDurationMs ?? 10 * 60 * 1000, // 10 minutes
      minTradeUsd: config.minTradeUsd ?? 5,
      dryRun: config.dryRun ?? process.env.DRY_RUN !== 'false',
      liveTradingEnvEnabled: config.liveTradingEnvEnabled ?? process.env.LIVE_TRADING === 'true',
    };

    this.killSwitchActive = false;
    this.killSwitchReason = null;
    this.uiLiveConfirmed = false;
    this.dailyPnl = 0;
    this.openExposureUsd = 0;
    this.windowExposureUsd = new Map();
    this.consecutiveLosses = 0;
    this.cooldownUntil = 0;
  }

  /**
   * Binary contract fractional Kelly sizing.
   * For a binary payout of $1 at ask price c with win probability p:
   * Full Kelly f* = (p - c) / (1 - c).
   */
  computeKellySizeUsd({ modelProb, marketAsk, bankrollUsd }) {
    if (bankrollUsd <= 0 || marketAsk <= 0 || marketAsk >= 1) return 0;
    const edge = modelProb - marketAsk;
    if (edge <= 0) return 0;
    const fullKelly = edge / (1 - marketAsk);
    const fractional = fullKelly * this.config.kellyFraction;
    const rawUsd = bankrollUsd * Math.max(0, Math.min(1, fractional));
    return Math.round(Math.min(rawUsd, this.config.maxTradeUsd) * 100) / 100;
  }

  /**
   * Check whether live execution is permitted.
   * Requires DRY_RUN=false, LIVE_TRADING=true, AND explicit UI confirmation.
   */
  isLiveExecutionAllowed() {
    return (
      !this.config.dryRun &&
      this.config.liveTradingEnvEnabled &&
      this.uiLiveConfirmed &&
      !this.killSwitchActive
    );
  }

  setUiLiveConfirmation(confirmed, confirmationPhrase = '') {
    if (confirmed) {
      if (!this.config.liveTradingEnvEnabled || this.config.dryRun) {
        return {
          ok: false,
          reason: 'Server must be started with DRY_RUN=false and LIVE_TRADING=true before enabling live mode.',
        };
      }
      if (confirmationPhrase !== 'I UNDERSTAND LIVE TRADING RISK') {
        return {
          ok: false,
          reason: 'Exact confirmation phrase required: "I UNDERSTAND LIVE TRADING RISK"',
        };
      }
      this.uiLiveConfirmed = true;
      return { ok: true, liveModeActive: this.isLiveExecutionAllowed() };
    }
    this.uiLiveConfirmed = false;
    return { ok: true, liveModeActive: false };
  }

  triggerKillSwitch(reason = 'Manual kill switch activated') {
    this.killSwitchActive = true;
    this.killSwitchReason = reason;
    this.uiLiveConfirmed = false;
  }

  resetKillSwitch() {
    this.killSwitchActive = false;
    this.killSwitchReason = null;
  }

  evaluateOrder({ windowId, modelProb, marketAsk, bankrollUsd, nowMs = Date.now() }) {
    if (this.killSwitchActive) {
      return { allowed: false, sizeUsd: 0, reason: `Kill switch active: ${this.killSwitchReason}` };
    }

    if (nowMs < this.cooldownUntil) {
      const remSec = Math.ceil((this.cooldownUntil - nowMs) / 1000);
      return { allowed: false, sizeUsd: 0, reason: `Loss cooldown active (${remSec}s remaining)` };
    }

    if (this.dailyPnl <= -Math.abs(this.config.dailyLossLimitUsd)) {
      return {
        allowed: false,
        sizeUsd: 0,
        reason: `Daily loss limit reached ($${this.dailyPnl.toFixed(2)} <= -$${this.config.dailyLossLimitUsd})`,
      };
    }

    const currentWindowExp = this.windowExposureUsd.get(windowId) || 0;
    const remainingWindowCap = Math.max(0, this.config.maxWindowUsd - currentWindowExp);
    if (remainingWindowCap < this.config.minTradeUsd) {
      return {
        allowed: false,
        sizeUsd: 0,
        reason: `Per-window cap reached ($${currentWindowExp.toFixed(2)} / $${this.config.maxWindowUsd})`,
      };
    }

    const remainingOpenCap = Math.max(0, this.config.maxOpenExposureUsd - this.openExposureUsd);
    if (remainingOpenCap < this.config.minTradeUsd) {
      return {
        allowed: false,
        sizeUsd: 0,
        reason: `Max open exposure reached ($${this.openExposureUsd.toFixed(2)} / $${this.config.maxOpenExposureUsd})`,
      };
    }

    const kellyUsd = this.computeKellySizeUsd({ modelProb, marketAsk, bankrollUsd });
    const cappedUsd = Math.min(kellyUsd, remainingWindowCap, remainingOpenCap, this.config.maxTradeUsd);

    if (cappedUsd < this.config.minTradeUsd) {
      return {
        allowed: false,
        sizeUsd: 0,
        reason: `Computed Kelly size ($${cappedUsd.toFixed(2)}) below minimum trade ($${this.config.minTradeUsd})`,
      };
    }

    return {
      allowed: true,
      sizeUsd: Math.round(cappedUsd * 100) / 100,
      isPaper: !this.isLiveExecutionAllowed(),
      reason: 'Risk checks passed',
    };
  }

  recordOpenOrder(windowId, sizeUsd) {
    this.openExposureUsd += sizeUsd;
    this.windowExposureUsd.set(windowId, (this.windowExposureUsd.get(windowId) || 0) + sizeUsd);
  }

  recordSettlement(windowId, sizeUsd, pnl, nowMs = Date.now()) {
    this.openExposureUsd = Math.max(0, this.openExposureUsd - sizeUsd);
    this.dailyPnl += pnl;

    if (pnl < 0) {
      this.consecutiveLosses += 1;
      if (this.consecutiveLosses >= this.config.cooldownAfterLosses) {
        this.cooldownUntil = nowMs + this.config.cooldownDurationMs;
      }
    } else if (pnl > 0) {
      this.consecutiveLosses = 0;
    }
  }

  getStatus() {
    return {
      killSwitchActive: this.killSwitchActive,
      killSwitchReason: this.killSwitchReason,
      dryRun: this.config.dryRun,
      liveTradingEnvEnabled: this.config.liveTradingEnvEnabled,
      uiLiveConfirmed: this.uiLiveConfirmed,
      liveModeActive: this.isLiveExecutionAllowed(),
      dailyPnl: Math.round(this.dailyPnl * 100) / 100,
      dailyLossLimitUsd: this.config.dailyLossLimitUsd,
      openExposureUsd: Math.round(this.openExposureUsd * 100) / 100,
      maxOpenExposureUsd: this.config.maxOpenExposureUsd,
      consecutiveLosses: this.consecutiveLosses,
      cooldownUntil: this.cooldownUntil,
      config: this.config,
    };
  }
}
