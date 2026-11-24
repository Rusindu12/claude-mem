/**
 * Real-time BTC/USDT Spot Feed.
 * Connects to Binance WebSocket (wss://stream.binance.com:9443/ws/btcusdt@trade) when
 * ENABLE_LIVE_MARKET_FETCH=true, and seamlessly falls back to a realistic GBM+jump
 * simulator so paper trading and the dashboard run smoothly in offline/sandboxed environments.
 */
import EventEmitter from 'events';
import WebSocket from 'ws';

export class SpotFeed extends EventEmitter {
  constructor(options = {}) {
    super();
    this.symbol = options.symbol || 'BTCUSDT';
    this.enableLiveWs = options.enableLiveWs ?? process.env.ENABLE_LIVE_MARKET_FETCH === 'true';
    this.price = options.initialPrice || 95240.0;
    this.recentPrices = [];
    this.candles = [];
    this.candleIntervalSec = options.candleIntervalSec || 10;
    this.currentCandle = null;
    this.mode = 'initializing';
    this.ws = null;
    this.simTimer = null;
    this._seedHistory();
  }

  _seedHistory() {
    const nowSec = Math.floor(Date.now() / 1000);
    let p = this.price - 120;
    for (let i = 45; i >= 1; i--) {
      const ts = (nowSec - i * this.candleIntervalSec) * 1000;
      const open = p;
      let high = open;
      let low = open;
      for (let k = 0; k < 5; k++) {
        p += (Math.random() - 0.49) * 18;
        high = Math.max(high, p);
        low = Math.min(low, p);
      }
      const close = p;
      this.candles.push({
        time: Math.floor(ts / 1000),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round((0.5 + Math.random() * 4.5) * 100) / 100,
      });
      this.recentPrices.push(Math.round(close * 100) / 100);
    }
    this.price = Math.round(p * 100) / 100;
  }

  start() {
    if (this.enableLiveWs) {
      this._connectBinanceWs();
    } else {
      this._startSimulator();
    }
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
  }

  _connectBinanceWs() {
    try {
      this.mode = 'binance-ws';
      const url = `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@trade`;
      this.ws = new WebSocket(url);
      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const p = parseFloat(msg.p);
          const q = parseFloat(msg.q) || 0;
          if (Number.isFinite(p) && p > 0) {
            this._onTick(p, q, msg.T || Date.now());
          }
        } catch {
          // ignore malformed frames
        }
      });
      this.ws.on('error', () => {
        this._startSimulator();
      });
      this.ws.on('close', () => {
        if (!this.simTimer) this._startSimulator();
      });
    } catch {
      this._startSimulator();
    }
  }

  _startSimulator() {
    if (this.simTimer) return;
    this.mode = 'simulated-binance';
    let momentumBias = 0;
    this.simTimer = setInterval(() => {
      // Mean-reverting micro-momentum + occasional volatility burst
      momentumBias = momentumBias * 0.92 + (Math.random() - 0.5) * 0.45;
      const shock = Math.random() < 0.04 ? (Math.random() - 0.5) * 65 : 0;
      const step = (Math.random() - 0.5) * 24 + momentumBias * 12 + shock;
      const nextPrice = Math.max(10000, Math.round((this.price + step) * 100) / 100);
      const volume = Math.round((0.05 + Math.random() * 1.8) * 1000) / 1000;
      this._onTick(nextPrice, volume, Date.now());
    }, 1000);
  }

  _onTick(price, volume, ts) {
    this.price = price;
    this.recentPrices.push(price);
    if (this.recentPrices.length > 300) {
      this.recentPrices.shift();
    }

    const bucket = Math.floor(ts / 1000 / this.candleIntervalSec) * this.candleIntervalSec;
    if (!this.currentCandle || this.currentCandle.time !== bucket) {
      if (this.currentCandle) {
        this.candles.push(this.currentCandle);
        if (this.candles.length > 80) this.candles.shift();
      }
      this.currentCandle = {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
      this.currentCandle.volume = Math.round((this.currentCandle.volume + volume) * 1000) / 1000;
    }

    this.emit('tick', { price, volume, ts, mode: this.mode });
  }

  getCandles() {
    return this.currentCandle ? [...this.candles, this.currentCandle] : [...this.candles];
  }

  /**
   * Normalized short-term momentum in [-1, 1].
   */
  getMomentum() {
    const n = this.recentPrices.length;
    if (n < 10) return 0;
    const shortAvg = this.recentPrices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const medAvg = this.recentPrices.slice(-25).reduce((a, b) => a + b, 0) / Math.min(25, n);
    const rel = (shortAvg - medAvg) / Math.max(1, medAvg);
    return Math.max(-1, Math.min(1, Math.round((rel / 0.0012) * 1000) / 1000));
  }
}
