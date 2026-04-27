// Variant components for FundCal redesign
// Each exports a full calculator screen at 1440x900.

const { useState, useEffect, useRef, useMemo } = React;

// ────────────────────────────────────────────────────────────
// Shared: mini chart that draws cumulative fee curves with animation
// ────────────────────────────────────────────────────────────
function FeeChart({ funds, width = 720, height = 360, theme, maxDay = 730, showGrid = true, discount = 0.1, animate = true }) {
  const canvasRef = useRef(null);
  const [progress, setProgress] = useState(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) { setProgress(1); return; }
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / 1200);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [funds.map(f => f.code).join(','), discount, animate]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = width + 'px'; c.style.height = height + 'px';
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pad = { t: 20, r: 20, b: 32, l: 48 };
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;

    // Compute series
    const series = funds.map(f => ({
      fund: f,
      pts: window.curve(f, 0, maxDay, 5, discount),
    }));
    const allY = series.flatMap(s => s.pts.map(p => p.y));
    const yMax = Math.max(...allY, 1) * 1.1;
    const yMin = 0;
    const xMin = 0, xMax = maxDay;
    const xp = x => pad.l + (x - xMin) / (xMax - xMin) * iw;
    const yp = y => pad.t + (1 - (y - yMin) / (yMax - yMin)) * ih;

    // grid
    if (showGrid) {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let i = 0; i <= 5; i++) {
        const y = pad.t + ih * i / 5;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // axes labels
    ctx.fillStyle = theme.axis;
    ctx.font = theme.axisFont || '11px ui-monospace, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const v = yMax - (yMax - yMin) * i / 5;
      const y = pad.t + ih * i / 5;
      ctx.fillText(v.toFixed(2) + '%', pad.l - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xTicks = [0, 30, 90, 180, 365, 730].filter(x => x <= maxDay);
    xTicks.forEach(x => {
      ctx.fillText(x + 'd', xp(x), pad.t + ih + 8);
    });

    // curves (animated up to progress)
    series.forEach((s, si) => {
      const endIdx = Math.floor(s.pts.length * progress);
      if (endIdx < 2) return;
      ctx.strokeStyle = s.fund.color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = theme.glow ? s.fund.color : 'transparent';
      ctx.shadowBlur = theme.glow ? 8 : 0;
      ctx.beginPath();
      for (let i = 0; i < endIdx; i++) {
        const p = s.pts[i];
        const x = xp(p.x), y = yp(p.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // end dot
      if (progress > 0.95) {
        const last = s.pts[s.pts.length - 1];
        ctx.fillStyle = s.fund.color;
        ctx.beginPath();
        ctx.arc(xp(last.x), yp(last.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Crossovers
    if (progress > 0.9) {
      for (let i = 0; i < series.length; i++) {
        for (let j = i + 1; j < series.length; j++) {
          const xs = window.findCrossovers(series[i].pts, series[j].pts);
          xs.forEach(pt => {
            ctx.strokeStyle = theme.crossStroke || '#000';
            ctx.fillStyle = theme.crossFill || '#fff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(xp(pt.x), yp(pt.y), 5, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
          });
        }
      }
    }
  }, [funds, width, height, progress, theme, maxDay, showGrid, discount]);

  return <canvas ref={canvasRef} />;
}

// Animated number ticker
function Ticker({ value, dp = 2, suffix = '%', dur = 700 }) {
  const [v, setV] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(dp)}{suffix}</span>;
}

window.FeeChart = FeeChart;
window.Ticker = Ticker;
