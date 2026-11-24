'use client';

export default function CandlestickChart({ candles = [], strikePrice = 95000, spotPrice = 95000 }) {
  const width = 640;
  const height = 210;
  const padL = 12;
  const padR = 72;
  const padT = 16;
  const padB = 22;

  const visible = candles.slice(-45);
  if (visible.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-xs text-slate-400">
        Waiting for BTC spot ticks...
      </div>
    );
  }

  let minP = strikePrice;
  let maxP = strikePrice;
  for (const c of visible) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }
  const range = Math.max(15, maxP - minP);
  const yMin = minP - range * 0.12;
  const yMax = maxP + range * 0.12;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const toY = (p) => padT + ((yMax - p) / (yMax - yMin)) * plotH;
  const stepX = plotW / Math.max(1, visible.length);
  const candleW = Math.max(3, Math.min(10, stepX * 0.65));

  const strikeY = toY(strikePrice);
  const spotY = toY(spotPrice);
  const isUp = spotPrice >= strikePrice;

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52 select-none">
        {/* Horizontal grid lines */}
        {[0.2, 0.5, 0.8].map((frac, idx) => {
          const y = padT + frac * plotH;
          const p = yMax - frac * (yMax - yMin);
          return (
            <g key={idx}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth="1"
              />
              <text
                x={width - padR + 6}
                y={y + 3}
                className="fill-slate-400 text-[10px] font-mono"
              >
                {p.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Candles */}
        {visible.map((c, i) => {
          const x = padL + i * stepX + stepX / 2;
          const bull = c.close >= c.open;
          const color = bull ? '#0d9488' : '#dc2626';
          const yHigh = toY(c.high);
          const yLow = toY(c.low);
          const yOpen = toY(c.open);
          const yClose = toY(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

          return (
            <g key={c.time + '-' + i}>
              <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
              <rect
                x={x - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                rx="1"
              />
            </g>
          );
        })}

        {/* Strike line */}
        <line
          x1={padL}
          y1={strikeY}
          x2={width - padR}
          y2={strikeY}
          stroke="#0284c7"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <rect x={width - padR + 2} y={strikeY - 9} width={66} height={18} rx="3" fill="#0284c7" />
        <text
          x={width - padR + 35}
          y={strikeY + 3}
          textAnchor="middle"
          className="fill-white text-[10px] font-mono font-semibold"
        >
          {strikePrice.toFixed(1)}
        </text>

        {/* Live spot marker */}
        <line
          x1={padL}
          y1={spotY}
          x2={width - padR}
          y2={spotY}
          stroke={isUp ? '#0d9488' : '#ea580c'}
          strokeWidth="1"
          strokeOpacity="0.6"
        />
        <rect
          x={width - padR + 2}
          y={spotY - 9}
          width={66}
          height={18}
          rx="3"
          fill={isUp ? '#0d9488' : '#ea580c'}
        />
        <text
          x={width - padR + 35}
          y={spotY + 3}
          textAnchor="middle"
          className="fill-white text-[10px] font-mono font-bold"
        >
          {spotPrice.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}
