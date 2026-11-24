'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  Sun,
  Moon,
  Power,
  Shield,
  TrendingUp,
  TrendingDown,
  Clock,
  Sliders,
} from 'lucide-react';

import MonteCarloOrb from '../components/MonteCarloOrb';
import CandlestickChart from '../components/CandlestickChart';
import ModelVsMarketChart from '../components/ModelVsMarketChart';
import LandingCurveChart from '../components/LandingCurveChart';
import SafetyModal from '../components/SafetyModal';
import RiskAndReplayBar from '../components/RiskAndReplayBar';

function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);
  const [clock, setClock] = useState('');
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [authToken, setAuthToken] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const updateClock = () => setClock(new Date().toISOString().slice(11, 19) + ' UTC');
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Initial HTTP fetch for instant first paint
    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => setState(data))
      .catch(() => {});

    // Real-time Socket.io stream (relative URL proxied through Next.js)
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (nextState) => setState(nextState));
    return () => socket.disconnect();
  }, []);

  const toggleKillSwitch = async () => {
    const active = !state?.risk?.killSwitchActive;
    await fetch('/api/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, reason: active ? 'Triggered from Dashboard Top Bar' : null }),
    });
  };

  const win = state?.window;
  const spot = state?.spot;
  const book = state?.orderBook;
  const model = state?.model;
  const risk = state?.risk;
  const analytics = state?.analytics;

  const probUp = model?.signals?.adjusted_prob_up ?? 0.5;
  const decision = model?.decision ?? { action: 'PASS', edge: 0, edge_up: 0, edge_down: 0, reason: 'Waiting...' };
  const contributions = model?.signals?.contributions ?? {};

  const signalRows = [
    { key: 'momentum', label: 'Momentum' },
    { key: 'orderbook_imbalance', label: 'Orderbook Imbalance' },
    { key: 'spot_polymarket_lag', label: 'Spot vs Poly Lag' },
    { key: 'volatility_regime', label: 'Volatility Regime' },
    { key: 'time_left', label: 'Time Left' },
  ];

  const isUpSpot = (spot?.price ?? 0) >= (win?.strikePrice ?? 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* TOP BAR */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-2.5">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-sky-600 flex items-center justify-center text-white font-bold text-sm">
              5m
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-sm sm:text-base tracking-tight">
                  {win?.marketName || 'BTC Up or Down 5m'}
                </h1>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 uppercase">
                  {state?.activeExchange || 'polymarket'}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                    risk?.liveModeActive
                      ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      : 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
                  }`}
                >
                  {risk?.liveModeActive ? 'LIVE' : 'PAPER · DRY_RUN'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${connected ? 'bg-teal-500 animate-pulse' : 'bg-amber-500'}`} />
                  {connected ? 'Live' : 'Reconnecting'}
                </span>
                <span>·</span>
                <span className="truncate max-w-[260px]">{win?.priceSource || 'Binance BTC/USDT'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              <Clock className="w-3.5 h-3.5" />
              <span>{clock}</span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800">
              <span className="text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300 font-semibold">
                Window
              </span>
              <span className="num font-bold text-sm text-sky-700 dark:text-sky-300">
                {formatCountdown(win?.timeLeftSec)}
              </span>
            </div>

            <button
              onClick={() => setSafetyOpen(true)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Security, 2FA & Live Trading Gate"
            >
              <Shield className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </button>

            <button
              onClick={() => setDark((d) => !d)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Toggle light/dark theme"
            >
              {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>

            <button
              onClick={toggleKillSwitch}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                risk?.killSwitchActive
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 animate-pulse'
                  : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{risk?.killSwitchActive ? 'KILL ACTIVE' : 'KILL SWITCH'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN GRID */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 space-y-4">
        <RiskAndReplayBar
          risk={risk}
          analytics={analytics}
          timeLeftSec={win?.timeLeftSec ?? 300}
        />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT COLUMN: Balance/PnL, Metrics, Signal Stack, Live Trade Log */}
          <section className="lg:col-span-3 space-y-4">
            {/* Balance & KPIs */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500">Paper Balance</span>
                <span
                  className={`num text-xs font-semibold ${
                    (analytics?.totalPnl ?? 0) >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'
                  }`}
                >
                  {(analytics?.totalPnl ?? 0) >= 0 ? '+' : ''}${(analytics?.totalPnl ?? 0).toFixed(2)} P&L
                </span>
              </div>
              <div className="num text-2xl font-bold tracking-tight">
                ${(analytics?.balance ?? 1000).toFixed(2)}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <div className="text-[11px] text-slate-500">Trades</div>
                  <div className="num text-sm font-semibold">{analytics?.totalTrades ?? 0}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Win Rate</div>
                  <div className="num text-sm font-semibold text-teal-600 dark:text-teal-400">
                    {((analytics?.winRate ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Avg Edge</div>
                  <div className="num text-sm font-semibold text-sky-600 dark:text-sky-400">
                    {((analytics?.avgEdge ?? 0) * 100).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Brier Score</div>
                  <div className="num text-sm font-semibold">
                    {analytics?.brierScore !== null && analytics?.brierScore !== undefined
                      ? analytics.brierScore.toFixed(3)
                      : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Signal Stack Bars */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-sky-600" /> Signal Stack
                </span>
                <span className="num text-[11px] text-slate-500">
                  Δ {((model?.signals?.total_prob_shift ?? 0) * 100).toFixed(2)}%
                </span>
              </div>

              <div className="space-y-2">
                {signalRows.map((row) => {
                  const item = contributions[row.key] || { raw: 0, prob_delta: 0 };
                  const delta = item.prob_delta || 0;
                  const pctWidth = Math.min(100, Math.abs(delta) * 1200);
                  const pos = delta >= 0;
                  return (
                    <div key={row.key} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-300">{row.label}</span>
                        <span className={`num font-medium ${pos ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'}`}>
                          {pos ? '+' : ''}{(delta * 100).toFixed(2)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                        <div className="w-1/2 flex justify-end">
                          {!pos && (
                            <div
                              className="h-full bg-red-500 dark:bg-orange-500 rounded-l-full"
                              style={{ width: `${pctWidth}%` }}
                            />
                          )}
                        </div>
                        <div className="w-1/2 flex justify-start">
                          {pos && (
                            <div
                              className="h-full bg-teal-500 dark:bg-teal-400 rounded-r-full"
                              style={{ width: `${pctWidth}%` }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Trade Log */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs font-semibold mb-2">Live Trade Log</div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {(state?.recentTrades || []).slice(0, 12).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-[11px] py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                          t.side === 'UP'
                            ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-orange-300'
                        }`}
                      >
                        {t.side}
                      </span>
                      <span className="num text-slate-600 dark:text-slate-300">
                        ${t.sizeUsd.toFixed(0)} @ {t.entryPrice.toFixed(2)}
                      </span>
                    </div>
                    <span
                      className={`num font-semibold ${
                        t.outcome === 'WIN'
                          ? 'text-teal-600 dark:text-teal-400'
                          : t.outcome === 'LOSS'
                          ? 'text-red-600 dark:text-orange-400'
                          : 'text-sky-600'
                      }`}
                    >
                      {t.outcome ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : 'OPEN'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CENTER & RIGHT: Monte Carlo Orb + Input/Output Cards + Spot Candlestick Panel */}
          <section className="lg:col-span-9 space-y-4">
            {/* Orb + Input Cards (left) + Output Cards (right) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* Input Cards */}
                <div className="md:col-span-3 space-y-2.5">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Inputs
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] text-slate-500">BTC Spot</div>
                    <div className={`num text-base font-bold ${isUpSpot ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'}`}>
                      ${(spot?.price ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="num text-[10px] text-slate-400">
                      Strike ${(win?.strikePrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] text-slate-500">Realized Vol (Ann.)</div>
                    <div className="num text-base font-bold">
                      {((model?.realized_vol ?? 0.55) * 100).toFixed(1)}%
                    </div>
                    <div className="num text-[10px] text-slate-400">
                      Regime {(model?.volatility_regime ?? 1).toFixed(2)}x
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] text-slate-500">Momentum</div>
                    <div className={`num text-base font-bold ${(spot?.momentum ?? 0) >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'}`}>
                      {(spot?.momentum ?? 0) >= 0 ? '+' : ''}{(spot?.momentum ?? 0).toFixed(3)}
                    </div>
                  </div>
                </div>

                {/* Center Animated Orb */}
                <div className="md:col-span-6 flex flex-col items-center">
                  <MonteCarloOrb
                    orbPaths={model?.monte_carlo?.orb_paths}
                    strikePrice={win?.strikePrice ?? 95000}
                    probUp={probUp}
                    timeLeftSec={win?.timeLeftSec ?? 150}
                    dark={dark}
                  />
                  <div className="flex items-center gap-4 text-xs mt-1">
                    <span className="num text-teal-600 dark:text-teal-400 font-semibold">
                      UP Ask: {(book?.upAsk ?? 0.5).toFixed(3)}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <span className="num text-red-600 dark:text-orange-400 font-semibold">
                      DOWN Ask: {(book?.downAsk ?? 0.5).toFixed(3)}
                    </span>
                  </div>
                </div>

                {/* Output Cards */}
                <div className="md:col-span-3 space-y-2.5">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Outputs
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] text-slate-500">Model P(UP)</div>
                    <div className={`num text-base font-bold ${probUp >= 0.5 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'}`}>
                      {(probUp * 100).toFixed(2)}%
                    </div>
                    <div className="num text-[10px] text-slate-400">
                      MC Raw {((model?.monte_carlo?.mc_prob_up ?? 0.5) * 100).toFixed(2)}%
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] text-slate-500">Best Net Edge</div>
                    <div className={`num text-base font-bold ${decision.edge > 0 ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500'}`}>
                      {decision.edge >= 0 ? '+' : ''}{(decision.edge * 100).toFixed(2)}%
                    </div>
                    <div className="num text-[10px] text-slate-400">
                      Time Left {formatCountdown(win?.timeLeftSec)}
                    </div>
                  </div>

                  <div
                    className={`p-3 rounded-lg border font-semibold ${
                      decision.action === 'BUY_UP'
                        ? 'bg-teal-50 dark:bg-teal-950/50 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-300'
                        : decision.action === 'BUY_DOWN'
                        ? 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-800 dark:text-orange-300'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider opacity-75">Decision</div>
                    <div className="num text-base font-bold flex items-center gap-1.5">
                      {decision.action === 'BUY_UP' && <TrendingUp className="w-4 h-4" />}
                      {decision.action === 'BUY_DOWN' && <TrendingDown className="w-4 h-4" />}
                      {decision.action.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Spot Panel: BTC Candlestick Chart with Strike Line */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-600" />
                  <h2 className="text-xs font-semibold">BTC/USDT Spot (10s Candles) & Window Strike</h2>
                </div>
                <span className="num text-xs text-slate-500">
                  Feed: {state?.feedMode || 'connecting'}
                </span>
              </div>
              <CandlestickChart
                candles={spot?.candles || []}
                strikePrice={win?.strikePrice ?? 95000}
                spotPrice={spot?.price ?? 95000}
              />
            </div>
          </section>
        </div>

        {/* BOTTOM ROW: Decision Log, Model-vs-Market Chart, Landing Curve */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Decision Log */}
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold mb-2.5">Decision Log</h2>
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-400 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900">
                  <tr>
                    <th className="py-1.5 pr-2">Time</th>
                    <th className="py-1.5 pr-2">Action</th>
                    <th className="py-1.5 pr-2">Price</th>
                    <th className="py-1.5 pr-2">Size</th>
                    <th className="py-1.5 pr-2">Edge</th>
                    <th className="py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {(state?.recentDecisions || []).slice(0, 20).map((d) => (
                    <tr key={d.id}>
                      <td className="py-1.5 pr-2 num text-slate-500">
                        {new Date(d.timestamp).toISOString().slice(11, 19)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            d.action === 'BUY_UP'
                              ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
                              : d.action === 'BUY_DOWN'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-orange-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {d.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 num">{(d.price ?? 0).toFixed(3)}</td>
                      <td className="py-1.5 pr-2 num">{d.sizeUsd > 0 ? `$${d.sizeUsd.toFixed(0)}` : '—'}</td>
                      <td className="py-1.5 pr-2 num">{((d.edge ?? 0) * 100).toFixed(2)}%</td>
                      <td className="py-1.5 num text-slate-600 dark:text-slate-300">{d.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Model vs Market Chart */}
          <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold">Model vs Market P(UP)</h2>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-teal-600 font-semibold">— Model</span>
                <span className="text-orange-600 font-semibold">-- Market</span>
              </div>
            </div>
            <ModelVsMarketChart series={state?.windowSeries || []} />
          </div>

          {/* Landing Curve */}
          <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-semibold mb-2">Landing Curve (Close vs Strike)</h2>
            <LandingCurveChart
              curve={model?.monte_carlo?.landing_curve || []}
              strikePrice={win?.strikePrice ?? 95000}
              probUp={probUp}
            />
          </div>
        </section>
      </main>

      <SafetyModal
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        risk={risk}
        activeExchange={state?.activeExchange}
        authToken={authToken}
        onAuthSuccess={(token) => setAuthToken(token)}
      />
    </div>
  );
}
