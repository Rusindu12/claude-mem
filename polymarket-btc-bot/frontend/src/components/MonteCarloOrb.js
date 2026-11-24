'use client';

import { useEffect, useRef } from 'react';

/**
 * Upgraded Animated Monte Carlo "Orb" of simulated price paths.
 * Features a radial UP/DOWN probability perimeter arc, glowing path tips,
 * strike equator, and smooth collapse toward a single outcome as timeLeftSec -> 0.
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
      t += 0.022;
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
      const maxR = Math.min(w, h) * 0.44;

      ctx.clearRect(0, 0, w, h);

      const collapse = Math.max(0.2, Math.min(1.0, timeLeftSec / 60));
      const r = maxR * (0.48 + 0.52 * collapse);
      const isUpFavored = probUp >= 0.5;

      // Ambient radial aura
      const grad = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r * 1.24);
      if (isUpFavored) {
        grad.addColorStop(0, dark ? 'rgba(20,184,166,0.34)' : 'rgba(13,148,136,0.22)');
        grad.addColorStop(0.55, dark ? 'rgba(2,132,199,0.14)' : 'rgba(2,132,199,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        grad.addColorStop(0, dark ? 'rgba(239,68,68,0.34)' : 'rgba(220,38,38,0.22)');
        grad.addColorStop(0.55, dark ? 'rgba(234,88,12,0.14)' : 'rgba(234,88,12,0.08)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.24, 0, Math.PI * 2);
      ctx.fill();

      // Subtle concentric radar rings
      [0.65, 0.85].forEach((mult) => {
        ctx.strokeStyle = dark ? 'rgba(148,163,184,0.10)' : 'rgba(100,116,139,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * mult, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Perimeter Probability Arc (UP = teal/blue, DOWN = red/orange)
      const startAngle = -Math.PI / 2;
      const upSweep = Math.PI * 2 * Math.max(0.01, Math.min(0.99, probUp));
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';

      ctx.strokeStyle = dark ? '#2dd4bf' : '#0d9488';
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + upSweep);
      ctx.stroke();

      ctx.strokeStyle = dark ? '#fb923c' : '#dc2626';
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle + upSweep + 0.05, startAngle + Math.PI * 2 - 0.05);
      ctx.stroke();

      // Strike equator line
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = dark ? 'rgba(148,163,184,0.38)' : 'rgba(71,85,105,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.94, cy);
      ctx.lineTo(cx + r * 0.94, cy);
      ctx.stroke();
      ctx.restore();

      // Simulated paths + glowing terminal particles
      const paths = orbPaths.length > 0 ? orbPaths : Array.from({ length: 30 }, (_, i) => {
        const dir = i / 30 < probUp ? 1 : -1;
        return Array.from({ length: 12 }, (_, step) => strikePrice + dir * step * 10 * (0.5 + (i % 5) * 0.2));
      });

      const scaleY = Math.max(40, strikePrice * 0.0022);

      paths.forEach((path, idx) => {
        const endPrice = path[path.length - 1] ?? strikePrice;
        const isUp = endPrice >= strikePrice;
        ctx.beginPath();
        const n = path.length;
        let lastX = cx;
        let lastY = cy;
        for (let i = 0; i < n; i++) {
          const frac = i / Math.max(1, n - 1);
          const x = cx - r * 0.84 + frac * (r * 1.68);
          const normDiff = (path[i] - strikePrice) / scaleY;
          const wave = Math.sin(t * 1.5 + idx * 0.55 + i * 0.4) * 3.2 * collapse;
          const yOffset = Math.max(-r * 0.78, Math.min(r * 0.78, -normDiff * r * 0.44 * collapse + wave));
          const y = cy + yOffset;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          lastX = x;
          lastY = y;
        }
        ctx.strokeStyle = isUp
          ? dark ? 'rgba(45,212,191,0.44)' : 'rgba(13,148,136,0.46)'
          : dark ? 'rgba(251,146,60,0.44)' : 'rgba(220,38,38,0.40)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Glowing tip dot
        ctx.fillStyle = isUp ? (dark ? '#5eead4' : '#0d9488') : (dark ? '#fdba74' : '#dc2626');
        ctx.beginPath();
        ctx.arc(lastX, lastY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });

      // Center glassmorphic core badge
      const coreR = r * 0.37;
      ctx.fillStyle = dark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.94)';
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isUpFavored ? '#0d9488' : '#dc2626';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      ctx.fillStyle = isUpFavored ? (dark ? '#2dd4bf' : '#0f766e') : (dark ? '#f87171' : '#b91c1c');
      ctx.font = '700 21px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${(probUp * 100).toFixed(1)}%`, cx, cy - 8);

      ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
      ctx.font = '600 9.5px ui-sans-serif, system-ui, sans-serif';
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
