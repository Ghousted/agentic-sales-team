"use client";
// Animated dot-matrix background from the design (a canvas port of its WebGL
// dot shader). Dots ripple in from the centre, then twinkle at ~8fps.
import { useEffect, useRef } from "react";

const OP = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1];
const CELL = 12, DOT = 3, FREQ = 2.4, SPEED = 3;
const hash = (x: number, y: number, k: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); };

export default function DotField({ strength = 0.3, color = "#ffffff", style }: { strength?: number; color?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = -1;
    const fit = () => {
      const d = window.devicePixelRatio || 1;
      cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d);
      ctx.setTransform(d, 0, 0, d, 0, 0); last = -1;
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(cv);
    const t0 = performance.now();
    const k = Math.max(0, Math.min(1, strength));
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = reduce ? 99 : (performance.now() - t0) / 1000;
      if (t > 2.5 && t - last < 0.1) return; // full rate during the intro, then ~8fps
      last = t;
      const w = cv.clientWidth, h = cv.clientHeight, cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
      const ox = Math.floor((w - cols * CELL + (CELL - DOT)) / 2), oy = Math.floor((h - rows * CELL + (CELL - DOT)) / 2);
      const cx = cols / 2, cy = rows / 2;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = color;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const off = hash(i, j, 0), start = Math.hypot(i - cx, j - cy) * 0.01 + off * 0.15, at = t * SPEED;
        if (at < start) continue;
        let a = OP[Math.floor(hash(i, j, Math.floor(t / FREQ + off + FREQ)) * 10)];
        if (at < start + 0.1) a = Math.min(1, a * 1.25);
        ctx.globalAlpha = a * k; ctx.fillRect(ox + i * CELL, oy + j * CELL, DOT, DOT);
      }
      ctx.globalAlpha = 1;
      if (reduce) cancelAnimationFrame(raf);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [strength, color]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none", ...style }} />;
}
