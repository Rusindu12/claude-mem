'use client';

export default function LandingCurveChart({
  curve = [],
  strikePrice = 95000,
  probUp = 0.5,
}) {
  const width = 380;
  const height = 165;
  const padL = 12;
  const padR = 12;
  const padT = 18;
  const padB = 24;

  if (curve.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-slate-400">
        Running Monte Carlo landing distribution...
      </div>
    );
  }

  const maxD = Math.max(...curve.map((b) => b.density), 0.01);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const barW = plotW / curve.length;

  const minP = curve[0].price;
  const maxP = curve[curve.length - 1].price;
  const strikeFrac = Math.max(0, Math.min(1, (strikePrice - minP) / Math.max(1, maxP - minP)));
  const strikeX = padL + strikeFrac * plotW;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-mono font-semibold text-red-600 dark:text-orange-400">
          DOWN {((1 - probUp) * 100).toFixed(1)}%
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          Strike ${strikePrice.toFixed(1)}
        </span>
        <span className="font-mono font-semibold text-teal-600 dark:text-teal-400">
          UP {(probUp * 100).toFixed(1)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36 select-none">
        {curve.map((b, i) => {
          const h = (b.density / maxD) * plotH;
          const x = padL + i * barW;
          const y = padT + (plotH - h);
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, barW - 1)}
              height={Math.max(1, h)}
              fill={b.is_up ? '#0d9488' : '#ea580c'}
              fillOpacity="0.82"
              rx="1"
            />
          );
        })}
        <line
          x1={strikeX}
          y1={padT - 4}
          x2={strikeX}
          y2={padT + plotH}
          stroke="#0284c7"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />
        <text x={padL} y={height - 5} className="fill-slate-400 text-[9px] font-mono">
          ${minP.toFixed(0)}
        </text>
        <text x={width - padR} y={height - 5} textAnchor="end" className="fill-slate-400 text-[9px] font-mono">
          ${maxP.toFixed(0)}
        </text>
      </svg>
    </div>
  );
}
