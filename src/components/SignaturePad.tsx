'use client';
import { useEffect, useRef, useState } from 'react';

/** Sign with a finger (or mouse). Calls onChange with a PNG data URL once there's a real mark, or null when cleared. */
export function SignaturePad({ onChange, label = 'Sign here with your finger', height = 170, resetKey }: {
  onChange: (png: string | null) => void; label?: string; height?: number; resetKey?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0);
  const [empty, setEmpty] = useState(true);

  const setup = () => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1a5c';
    ink.current = 0; setEmpty(true);
  };
  useEffect(() => { setup(); onChange(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [resetKey]);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e), ctx = ref.current!.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    // A real signature, not a tap.
    if (ink.current > 40) { setEmpty(false); onChange(trimmed(ref.current!)); }
  };

  return (
    <div className="sigpad">
      <div className="sigpad-box" style={{ height }}>
        <canvas ref={ref} style={{ width: '100%', height, touchAction: 'none', display: 'block' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label={label} role="img" />
        {empty && <span className="sigpad-hint">{label}</span>}
        <span className="sigpad-line" />
      </div>
      <button type="button" className="btn ghost small" onClick={() => { setup(); onChange(null); }}>Clear</button>
    </div>
  );
}

/** Crops the drawing to the ink, keeps it small, and returns a PNG data URL. */
function trimmed(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (px[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) return c.toDataURL('image/png');
  const pad = 8;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  const scale = Math.min(1, 600 / (x1 - x0), 200 / (y1 - y0));
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round((x1 - x0) * scale)); o.height = Math.max(1, Math.round((y1 - y0) * scale));
  o.getContext('2d')!.drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}
