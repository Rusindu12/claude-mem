'use client';

export default function ModelVsMarketChart({ series = [] }) {
  const width = 380;
  const height = 165;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 22;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const toY = (p) => padT + (1 - Math.max(0, Math.min(1, p))) * plotH;

  if (series.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-slate-400">
        Collecting window probability history...
      </div>
    );
  }

  const toX = (i) => padL + (i / Math.max(1, series.length - 1)) * plotW;
  const modelPoints = series.map((d, i) => `${toX(i)},${toY(d.modelProbUp)}`).join(' ');
  const marketPoints = series.map((d, i) => `${toX(i)},${toY(d.marketProbUp)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40 select-none">
      {[0, 0.5, 1].map((v) => {
        const y = toY(v);
        return (
          <g key={v}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeDasharray={v === 0.5 ? '3 3' : undefined}
            />
            <text x={padL - 5} y={y + 3} textAnchor="end" className="fill-slate-400 text-[9px] font-mono">
              {Math.round(v * 100)}%
            </text>
          </g>
        );
      })}
      <polyline fill="none" stroke="#ea580c" strokeWidth="1.8" strokeDasharray="4 2" points={marketPoints} />
      <polyline fill="none" stroke="#0d9488" strokeWidth="2.2" points={modelPoints} />
      <text x={padL} y={height - 4} className="fill-slate-400 text-[9px] font-mono">
        {series[0]?.time}
      </text>
      <text x={width - padR} y={height - 4} textAnchor="end" className="fill-slate-400 text-[9px] font-mono">
        {series[series.length - 1]?.time}
      </text>
    </svg>
  );
}
