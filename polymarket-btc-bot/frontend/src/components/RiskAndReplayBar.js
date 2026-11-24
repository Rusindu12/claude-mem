'use client';

import { useEffect, useState } from 'react';
import { Gauge, SlidersHorizontal } from 'lucide-react';

export default function RiskAndReplayBar({ risk, analytics, timeLeftSec = 300 }) {
  const [thresholdPct, setThresholdPct] = useState(3.0);
  const [replay, setReplay] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/replay?edgeThreshold=${(thresholdPct / 100).toFixed(4)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => setReplay(d))
      .catch(() => {});
    return () => controller.abort();
  }, [thresholdPct]);

  const dailyLossLimit = risk?.dailyLossLimitUsd || 250;
  const dailyPnl = risk?.dailyPnl || 0;
  const lossUsedPct = dailyPnl < 0 ? Math.min(100, (Math.abs(dailyPnl) / dailyLossLimit) * 100) : 0;

  const maxExposure = risk?.maxOpenExposureUsd || 200;
  const openExposure = risk?.openExposureUsd || 0;
  const expPct = Math.min(100, (openExposure / maxExposure) * 100);

  const windowPct = Math.max(0, Math.min(100, (timeLeftSec / 300) * 100));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
      {/* Risk Telemetry Strip */}
      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Gauge className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          <span>Risk Controls</span>
        </div>

        <div className="flex-1 min-w-[130px] space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Open Exposure</span>
            <span className="num font-semibold text-slate-700 dark:text-slate-300">
              ${openExposure.toFixed(0)} / ${maxExposure}
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-500"
              style={{ width: `${expPct}%` }}
            />
          </div>
        </div>

        <div className="flex-1 min-w-[130px] space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Daily Loss Limit</span>
            <span className="num font-semibold text-slate-700 dark:text-slate-300">
              {dailyPnl >= 0 ? `+$${dailyPnl.toFixed(2)}` : `-$${Math.abs(dailyPnl).toFixed(2)}`} / -${dailyLossLimit}
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                lossUsedPct > 70 ? 'bg-red-500' : 'bg-teal-500'
              }`}
              style={{ width: `${Math.max(4, lossUsedPct)}%` }}
            />
          </div>
        </div>

        <div className="flex-1 min-w-[120px] space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>5m Window</span>
            <span className="num font-semibold text-sky-600 dark:text-sky-400">
              {Math.round(windowPct)}% left
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-teal-500 to-sky-500 rounded-full transition-all duration-500"
              style={{ width: `${windowPct}%` }}
            />
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-slate-400">ROI</div>
          <div
            className={`num text-xs font-bold ${
              (analytics?.roi ?? 0) >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-orange-400'
            }`}
          >
            {(analytics?.roi ?? 0) >= 0 ? '+' : ''}
            {((analytics?.roi ?? 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Interactive Threshold Replay Mini-Panel */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl px-4 py-2.5 shadow-sm flex flex-col justify-center gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
            <SlidersHorizontal className="w-3.5 h-3.5 text-sky-600" />
            Threshold Replay
          </span>
          <span className="num font-bold text-sky-600 dark:text-sky-400">
            Edge ≥ {thresholdPct.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(Number(e.target.value))}
            className="flex-1 accent-teal-600 h-1.5 cursor-pointer"
          />
          <div className="flex items-center gap-2 text-[10px] num">
            <span className="text-teal-600 dark:text-teal-400 font-semibold">
              UP:{replay?.buyUp ?? 0}
            </span>
            <span className="text-red-600 dark:text-orange-400 font-semibold">
              DN:{replay?.buyDown ?? 0}
            </span>
            <span className="text-slate-400">P:{replay?.pass ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
