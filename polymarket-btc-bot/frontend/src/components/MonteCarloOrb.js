'use client';

import { useEffect, useRef } from 'react';

/**
 * Animated Monte Carlo "Orb" of simulated price paths.
 * Paths radiate and oscillate around the strike equator, colored teal/blue (UP)
 * and red/orange (DOWN), and collapse toward a single outcome as timeLeftSec -> 0.
 */
export default function MonteCarloOrb({
  orbPaths = [],
  strikePrice = 95000,
  probUp = 0.5,
  timeLeftSec = 150,
  dark = false,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let t = 0;

    const render = () => {
      t += 0.025;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.43;

      ctx.clearRect(0, 0, w, h);

      // Collapse factor: 1.0 when plenty of time left, collapses toward 0.18 near window close
      const collapse = Math.max(0.18, Math.min(1.0, timeLeftSec / 60));
      const r = maxR * (0.45 + 0.55 * collapse);

      // Outer ambient glow
      const isUpFavored = probUp >= 0.5;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.18);
      if (isUpFavored) {
        grad.addColorStop(0, dark ? 'rgba(13,148,136,0.32)' : 'rgba(13,148,136,0.22)');
        grad.addColorStop(0.65, dark ? 'rgba(2,132,199,0.12)' : 'rgba(2,132,199,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        grad.addColorStop(0, dark ? 'rgba(220,38,38,0.32)' : 'rgba(220,38,38,0.22)');
        grad.addColorStop(0.65, dark ? 'rgba(234,88,12,0.12)' : 'rgba(234,88,12,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
      ctx.fill();

      // Orb ring
      ctx.strokeStyle = dark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.22)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Strike equator line
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = dark ? 'rgba(148,163,184,0.4)' : 'rgba(71,85,105,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();
      ctx.restore();

      // Draw simulated paths inside the orb
      const paths = orbPaths.length > 0 ? orbPaths : Array.from({ length: 28 }, (_, i) => {
        const dir = i / 28 < probUp ? 1 : -1;
        return Array.from({ length: 12 }, (_, step) => strikePrice + dir * step * 10 * (0.5 + (i % 5) * 0.2));
      });

      const scaleY = Math.max(40, strikePrice * 0.0022);

      paths.forEach((path, idx) => {
        const endPrice = path[path.length - 1] ?? strikePrice;
        const isUp = endPrice >= strikePrice;
        ctx.beginPath();
        const n = path.length;
        for (let i = 0; i < n; i++) {
          const frac = i / Math.max(1, n - 1);
          const x = cx - r * 0.85 + frac * (r * 1.7);
          const normDiff = (path[i] - strikePrice) / scaleY;
          const wave = Math.sin(t * 1.6 + idx * 0.5 + i * 0.4) * 3.5 * collapse;
          const yOffset = Math.max(-r * 0.82, Math.min(r * 0.82, -normDiff * r * 0.45 * collapse + wave));
          const y = cy + yOffset;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isUp
          ? dark ? 'rgba(45,212,191,0.42)' : 'rgba(13,148,136,0.45)'
          : dark ? 'rgba(251,146,60,0.42)' : 'rgba(220,38,38,0.40)';
        ctx.lineWidth = 1.15;
        ctx.stroke();
      });

      // Center core badge
      const coreR = r * 0.36;
      ctx.fillStyle = dark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isUpFavored ? '#0d9488' : '#dc2626';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Center text
      ctx.fillStyle = isUpFavored ? (dark ? '#2dd4bf' : '#0f766e') : (dark ? '#f87171' : '#b91c1c');
      ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${(probUp * 100).toFixed(1)}%`, cx, cy - 7);

      ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(timeLeftSec <= 5 ? 'COLLAPSING' : 'P(UP) · 20K PATHS', cx, cy + 12);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [orbPaths, strikePrice, probUp, timeLeftSec, dark]);

  return (
    <div className="relative w-full h-56 sm:h-64 flex items-center justify-center">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
