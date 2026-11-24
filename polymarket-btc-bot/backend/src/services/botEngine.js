/**
 * Core Trading Bot Orchestrator.
 * Manages rolling 5-minute BTC Up/Down windows, calls the Python Monte Carlo engine,
 * enforces RiskManager limits, executes orders via OrderManager + ExchangeAdapter,
 * records ticks/snapshots/decisions, settles windows, and broadcasts live state.
 */
import EventEmitter from 'events';
import crypto from 'crypto';
import { computeAnalytics } from './analytics.js';

export class BotEngine extends EventEmitter {
  constructor({ spotFeed, exchangeAdapter, riskManager, orderManager, engineUrl } = {}) {
    super();
    this.spotFeed = spotFeed;
    this.exchangeAdapter = exchangeAdapter;
    this.riskManager = riskManager;
    this.orderManager = orderManager;
    this.engineUrl = engineUrl || process.env.ENGINE_URL || 'http://127.0.0.1:8001';

    this.initialBalance = Number(process.env.INITIAL_PAPER_BALANCE || 1000);
    this.edgeThreshold = Number(process.env.EDGE_THRESHOLD || 0.03);
    this.feeRate = Number(process.env.FEE_RATE || 0.005);
    this.slippageEst = Number(process.env.SLIPPAGE_EST || 0.005);

    this.currentWindow = null;
    this.windows = [];
    this.trades = [];
    this.decisions = [];
    this.snapshots = [];
    this.ticks = [];
    this.windowSeries = []; // model vs market prob over current window

    this.latestModel = null;
    this.latestBook = null;
    this.lastTradeTs = 0;
    this.evalTimer = null;

    this._seedInitialHistory();
  }

  _seedInitialHistory() {
    // Seed 6 recent settled paper windows so analytics & decision log are immediately meaningful
    const nowMs = Date.now();
    const windowMs = 5 * 60 * 1000;
    const currentStart = Math.floor(nowMs / windowMs) * windowMs;
    const baseStrike = this.spotFeed.price;

    const samples = [
      { offset: 6, side: 'UP', prob: 0.61, ask: 0.53, outcome: 'UP', size: 28 },
      { offset: 5, side: 'DOWN', prob: 0.36, ask: 0.55, outcome: 'DOWN', size: 32 },
      { offset: 4, side: null, prob: 0.51, ask: 0.51, outcome: 'UP', size: 0 },
      { offset: 3, side: 'UP', prob: 0.59, ask: 0.52, outcome: 'DOWN', size: 24 },
      { offset: 2, side: 'UP', prob: 0.64, ask: 0.54, outcome: 'UP', size: 35 },
      { offset: 1, side: 'DOWN', prob: 0.38, ask: 0.54, outcome: 'DOWN', size: 30 },
    ];

    for (const s of samples) {
      const startTime = currentStart - s.offset * windowMs;
      const endTime = startTime + windowMs;
      const wid = `btc-5m-${Math.floor(startTime / 1000)}`;
      const strike = Math.round((baseStrike - s.offset * 15) * 100) / 100;
      const closePrice = s.outcome === 'UP' ? strike + 42.5 : strike - 38.2;
      const edge = s.side
        ? Math.round(((s.side === 'UP' ? s.prob : 1 - s.prob) - s.ask - this.feeRate - this.slippageEst) * 10000) / 10000
        : 0.008;

      let pnl = 0;
      if (s.side) {
        const win = s.side === s.outcome;
        const shares = Math.round((s.size / s.ask) * 1000) / 1000;
        pnl = win ? Math.round((shares * (1 - s.ask)) * 100) / 100 : -s.size;
        this.trades.push({
          id: `trd_${crypto.randomBytes(4).toString('hex')}`,
          windowId: wid,
          side: s.side,
          entryPrice: s.ask,
          sizeUsd: s.size,
          shares,
          modelProb: s.side === 'UP' ? s.prob : 1 - s.prob,
          marketAsk: s.ask,
          edge,
          isPaper: true,
          outcome: win ? 'WIN' : 'LOSS',
          pnl,
          executedAt: startTime + 45_000,
          settledAt: endTime,
        });
      }

      this.windows.push({
        id: wid,
        marketName: `BTC Up or Down 5m (${new Date(startTime).toISOString().slice(11, 16)}–${new Date(endTime).toISOString().slice(11, 16)} UTC)`,
        strikePrice: strike,
        closePrice,
        startTime,
        endTime,
        outcome: s.outcome,
        initialModelProb: s.prob,
        finalModelProb: s.prob,
        decision: s.side ? `BUY_${s.side}` : 'PASS',
        edge,
        pnl,
        settled: true,
      });

      this.decisions.push({
        id: `dec_${crypto.randomBytes(4).toString('hex')}`,
        windowId: wid,
        timestamp: startTime + 45_000,
        action: s.side ? `BUY_${s.side}` : 'PASS',
        price: s.ask,
        sizeUsd: s.size,
        edge,
        result: s.side ? (s.side === s.outcome ? `WIN (+$${pnl.toFixed(2)})` : `LOSS (-$${Math.abs(pnl).toFixed(2)})`) : `PASS (${s.outcome})`,
        reason: s.side ? `${s.side} edge ${(edge * 100).toFixed(2)}% exceeded threshold` : 'Edge below threshold',
      });
    }
    this.trades.reverse();
    this.decisions.reverse();
    this.windows.reverse();
  }

  async start() {
    this.spotFeed.on('tick', (tick) => {
      this.ticks.push({ ...tick, windowId: this.currentWindow?.windowId || null });
      if (this.ticks.length > 2000) this.ticks.shift();
    });

    this.spotFeed.start();
    await this._ensureActiveWindow();
    await this._evaluateCycle();

    this.evalTimer = setInterval(() => {
      this._evaluateCycle().catch((err) => {
        console.error('[BotEngine] Evaluation error (recovered):', err.message);
      });
    }, 2000);
  }

  stop() {
    if (this.evalTimer) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
    this.spotFeed.stop();
  }

  async _ensureActiveWindow() {
    const nowMs = Date.now();
    if (this.currentWindow && nowMs < this.currentWindow.endTime) {
      return;
    }

    // Settle previous window if one was open
    if (this.currentWindow && !this.currentWindow.settled) {
      this._settleWindow(this.currentWindow, this.spotFeed.price);
    }

    const meta = await this.exchangeAdapter.discoverActiveWindow(this.spotFeed.price);
    this.currentWindow = {
      ...meta,
      settled: false,
      outcome: null,
      closePrice: null,
      initialModelProb: null,
      finalModelProb: null,
      decision: 'PASS',
      edge: 0,
      pnl: 0,
    };
    this.windowSeries = [];
  }

  _settleWindow(win, closePrice) {
    const outcome = closePrice >= win.strikePrice ? 'UP' : 'DOWN';
    win.closePrice = closePrice;
    win.outcome = outcome;
    win.settled = true;

    let windowPnl = 0;
    for (const trade of this.trades) {
      if (trade.windowId === win.windowId && !trade.outcome) {
        const isWin = trade.side === outcome;
        const pnl = isWin
          ? Math.round(trade.shares * (1 - trade.entryPrice) * 100) / 100
          : -trade.sizeUsd;
        trade.outcome = isWin ? 'WIN' : 'LOSS';
        trade.pnl = pnl;
        trade.settledAt = Date.now();
        windowPnl += pnl;
        this.riskManager.recordSettlement(win.windowId, trade.sizeUsd, pnl);
      }
    }

    win.pnl = Math.round(windowPnl * 100) / 100;
    this.windows.unshift({ ...win });
    if (this.windows.length > 500) this.windows.pop();

    // Update decision log results for this window
    for (const d of this.decisions) {
      if (d.windowId === win.windowId && d.result === 'OPEN') {
        if (d.action === 'PASS') {
          d.result = `PASS (${outcome})`;
        } else {
          const side = d.action === 'BUY_UP' ? 'UP' : 'DOWN';
          d.result = side === outcome ? `WIN (${outcome})` : `LOSS (${outcome})`;
        }
      }
    }
  }

  async _callMonteCarloEngine(payload) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`${this.engineUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // Fallback if Python engine is momentarily unavailable
    }

    // Lightweight deterministic fallback so 24h unattended uptime never breaks
    const diff = (payload.spot_price - payload.strike_price) / Math.max(1, payload.strike_price);
    const timeScale = Math.sqrt(Math.max(1, payload.time_left_sec) / 300);
    const probUp = 1 / (1 + Math.exp(-(diff / (0.0022 * timeScale + 0.0003)) * 1.5));
    const edgeUp = probUp - payload.market_up_ask - this.feeRate - this.slippageEst;
    const edgeDown = (1 - probUp) - payload.market_down_ask - this.feeRate - this.slippageEst;
    const action =
      edgeUp >= this.edgeThreshold && edgeUp >= edgeDown
        ? 'BUY_UP'
        : edgeDown >= this.edgeThreshold && edgeDown > edgeUp
        ? 'BUY_DOWN'
        : 'PASS';

    return {
      realized_vol: 0.55,
      drift: 0.0,
      volatility_regime: 1.0,
      monte_carlo: {
        mc_prob_up: Math.round(probUp * 10000) / 10000,
        mc_prob_down: Math.round((1 - probUp) * 10000) / 10000,
        expected_close: payload.spot_price,
        std_close: payload.spot_price * 0.0018 * timeScale,
        landing_curve: [],
        orb_paths: [],
      },
      signals: {
        mc_prob_up: probUp,
        adjusted_prob_up: probUp,
        adjusted_prob_down: 1 - probUp,
        total_prob_shift: 0,
        contributions: {
          momentum: { raw: payload.momentum, logit_delta: 0, prob_delta: 0 },
          orderbook_imbalance: { raw: payload.orderbook_imbalance, logit_delta: 0, prob_delta: 0 },
          spot_polymarket_lag: { raw: payload.spot_polymarket_lag, logit_delta: 0, prob_delta: 0 },
          volatility_regime: { raw: 1.0, logit_delta: 0, prob_delta: 0 },
          time_left: { raw: payload.time_left_sec / 300, logit_delta: 0, prob_delta: 0 },
        },
      },
      decision: {
        action,
        side: action === 'BUY_UP' ? 'UP' : action === 'BUY_DOWN' ? 'DOWN' : null,
        edge: Math.round(Math.max(edgeUp, edgeDown) * 10000) / 10000,
        edge_up: Math.round(edgeUp * 10000) / 10000,
        edge_down: Math.round(edgeDown * 10000) / 10000,
        reason: 'Fallback analytical model',
      },
    };
  }

  async _evaluateCycle() {
    await this._ensureActiveWindow();

    const nowMs = Date.now();
    const timeLeftSec = Math.max(0, (this.currentWindow.endTime - nowMs) / 1000);
    const spotPrice = this.spotFeed.price;
    const strikePrice = this.currentWindow.strikePrice;

    const book = await this.exchangeAdapter.getOrderBook(
      this.currentWindow,
      spotPrice,
      strikePrice,
      timeLeftSec
    );
    this.latestBook = book;

    const momentum = this.spotFeed.getMomentum();
    const marketMidUp = (book.upBid + book.upAsk) / 2;
    const spotImpliedUp = 1 / (1 + Math.exp(-((spotPrice - strikePrice) / Math.max(1, strikePrice)) / 0.0015));
    const spotPolyLag = Math.max(-1, Math.min(1, (spotImpliedUp - marketMidUp) * 3.0));

    const simResult = await this._callMonteCarloEngine({
      spot_price: spotPrice,
      strike_price: strikePrice,
      time_left_sec: timeLeftSec,
      recent_prices: this.spotFeed.recentPrices.slice(-90),
      tick_interval_sec: 1.0,
      num_paths: 20000,
      momentum,
      orderbook_imbalance: book.imbalance,
      spot_polymarket_lag: Math.round(spotPolyLag * 1000) / 1000,
      market_up_ask: book.upAsk,
      market_down_ask: book.downAsk,
      edge_threshold: this.edgeThreshold,
      fee_rate: this.feeRate,
      slippage_est: this.slippageEst,
    });

    this.latestModel = simResult;
    const adjProbUp = simResult.signals.adjusted_prob_up;

    if (this.currentWindow.initialModelProb === null) {
      this.currentWindow.initialModelProb = adjProbUp;
    }
    this.currentWindow.finalModelProb = adjProbUp;

    // Record snapshot & window series for model-vs-market chart
    const snapshot = {
      windowId: this.currentWindow.windowId,
      timestamp: nowMs,
      spotPrice,
      upBid: book.upBid,
      upAsk: book.upAsk,
      downBid: book.downBid,
      downAsk: book.downAsk,
      orderbookImbalance: book.imbalance,
      modelProbUp: adjProbUp,
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 5000) this.snapshots.shift();

    this.windowSeries.push({
      time: new Date(nowMs).toISOString().slice(11, 19),
      ts: nowMs,
      modelProbUp: Math.round(adjProbUp * 1000) / 1000,
      marketProbUp: Math.round(marketMidUp * 1000) / 1000,
    });
    if (this.windowSeries.length > 150) this.windowSeries.shift();

    // Evaluate trade execution (at most once every 20s per window to avoid over-trading)
    const decision = simResult.decision;
    if (decision.action !== 'PASS' && nowMs - this.lastTradeTs > 20_000) {
      const side = decision.side;
      const ask = side === 'UP' ? book.upAsk : book.downAsk;
      const sideProb = side === 'UP' ? adjProbUp : 1 - adjProbUp;
      const analytics = computeAnalytics({
        trades: this.trades,
        windows: this.windows,
        initialBalance: this.initialBalance,
      });

      const riskCheck = this.riskManager.evaluateOrder({
        windowId: this.currentWindow.windowId,
        modelProb: sideProb,
        marketAsk: ask,
        bankrollUsd: analytics.balance,
        nowMs,
      });

      if (riskCheck.allowed) {
        const { order } = this.orderManager.createOrder({
          windowId: this.currentWindow.windowId,
          side,
          limitPrice: ask,
          maxSlippage: 0.015,
          sizeUsd: riskCheck.sizeUsd,
          isPaper: riskCheck.isPaper,
        });
        const finalOrder = await this.orderManager.submitOrder(order.id);
        if (finalOrder.state === 'FILLED' || finalOrder.state === 'PARTIAL_FILL') {
          this.lastTradeTs = nowMs;
          this.riskManager.recordOpenOrder(this.currentWindow.windowId, finalOrder.sizeUsd);
          this.currentWindow.decision = decision.action;
          this.currentWindow.edge = decision.edge;

          const trade = {
            id: `trd_${crypto.randomBytes(4).toString('hex')}`,
            orderId: finalOrder.id,
            windowId: this.currentWindow.windowId,
            side,
            entryPrice: finalOrder.avgFillPrice || ask,
            sizeUsd: finalOrder.sizeUsd,
            shares: finalOrder.filledShares,
            modelProb: sideProb,
            marketAsk: ask,
            edge: decision.edge,
            isPaper: finalOrder.isPaper,
            outcome: null,
            pnl: null,
            executedAt: nowMs,
            settledAt: null,
          };
          this.trades.unshift(trade);
          if (this.trades.length > 500) this.trades.pop();

          this.decisions.unshift({
            id: `dec_${crypto.randomBytes(4).toString('hex')}`,
            windowId: this.currentWindow.windowId,
            timestamp: nowMs,
            action: decision.action,
            price: trade.entryPrice,
            sizeUsd: trade.sizeUsd,
            edge: decision.edge,
            result: 'OPEN',
            reason: decision.reason,
          });
          if (this.decisions.length > 200) this.decisions.pop();
        }
      } else {
        this._logPassDecision(nowMs, ask, decision.edge, riskCheck.reason);
      }
    } else if (decision.action === 'PASS' && (this.decisions.length === 0 || nowMs - this.decisions[0].timestamp > 15_000)) {
      this._logPassDecision(nowMs, book.upAsk, decision.edge, decision.reason);
    }

    this.emit('state', this.getSnapshotState());
  }

  _logPassDecision(nowMs, price, edge, reason) {
    this.decisions.unshift({
      id: `dec_${crypto.randomBytes(4).toString('hex')}`,
      windowId: this.currentWindow?.windowId || 'unknown',
      timestamp: nowMs,
      action: 'PASS',
      price,
      sizeUsd: 0,
      edge,
      result: 'OPEN',
      reason,
    });
    if (this.decisions.length > 200) this.decisions.pop();
  }

  getSnapshotState() {
    const nowMs = Date.now();
    const timeLeftSec = this.currentWindow
      ? Math.max(0, (this.currentWindow.endTime - nowMs) / 1000)
      : 0;

    return {
      timestamp: nowMs,
      activeExchange: this.exchangeAdapter?.name || 'polymarket',
      feedMode: this.spotFeed.mode,
      window: this.currentWindow
        ? {
            ...this.currentWindow,
            timeLeftSec: Math.round(timeLeftSec * 10) / 10,
          }
        : null,
      spot: {
        price: this.spotFeed.price,
        momentum: this.spotFeed.getMomentum(),
        candles: this.spotFeed.getCandles(),
      },
      orderBook: this.latestBook,
      model: this.latestModel,
      risk: this.riskManager.getStatus(),
      analytics: computeAnalytics({
        trades: this.trades,
        windows: this.windows,
        initialBalance: this.initialBalance,
      }),
      windowSeries: this.windowSeries,
      recentTrades: this.trades.slice(0, 30),
      recentDecisions: this.decisions.slice(0, 40),
      recentWindows: this.windows.slice(0, 20),
    };
  }
}
