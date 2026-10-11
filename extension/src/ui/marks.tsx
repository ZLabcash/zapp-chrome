// ZApp's drawn marks: the shield, the ZEC coin, the Flipper Zero, the Kindle, rings, the
// hourglass, flags and QR codes (same geometry as Theme.swift and HomeView.swift).

import { useEffect, useRef, useState } from "preact/hooks";
import qrcode from "qrcode-generator";

/**
 * The ZScan mark: a yellow shield, a Z in ink and the green dashed scan line (32×32 viewBox).
 * `progress` 0…1 draws it in (shield to 0.6, Z to 0.9, then the scan line).
 */
export function Shield({ size = 34, progress = 1 }: { size?: number; progress?: number }) {
  const shield = Math.min(1, progress / 0.6);
  const z = Math.max(0, Math.min(1, (progress - 0.6) / 0.3));
  const scan = Math.max(0, Math.min(1, (progress - 0.85) / 0.15));
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0, direction: "ltr" }}>
      <path d="M16 2.5 27.5 7v8.6c0 7-4.8 11.9-11.5 13.9C9.3 27.5 4.5 22.6 4.5 15.6V7Z" stroke="var(--zcash)" stroke-width="2" pathLength={1} stroke-dasharray="1 1" stroke-dashoffset={1 - shield} />
      <path d="M11 11h10L11 21h10" stroke="var(--ink)" stroke-width="2.2" pathLength={1} stroke-dasharray="1 1" stroke-dashoffset={1 - z} />
      {scan > 0 && <path d={`M7.5 16h${17 * scan}`} stroke="var(--scan)" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.85" stroke-linecap="butt" />}
    </svg>
  );
}

/** The shield drawing itself in, once (the welcome animation). */
export function DrawingShield({ size, onDone, duration = 1000 }: { size: number; onDone?: () => void; duration?: number }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const x = Math.min(1, (t - t0) / duration);
      setP(x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
      if (x < 1) raf = requestAnimationFrame(step);
      else onDone?.();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <Shield size={size} progress={p} />;
}

/** The shield forging itself, back and forth (while working). */
export function ForgingShield({ size = 110 }: { size?: number }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const step = (t: number) => {
      const x = (t / 1600) % 2;
      const k = x < 1 ? x : 2 - x;
      setP(k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <Shield size={size} progress={p} />;
}

/** The ZEC coin: the yellow disc and its Z with the two bars. */
export function ZecLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0, direction: "ltr" }}>
      <circle cx="16" cy="16" r="16" fill="var(--zcash)" />
      <path d="M16 5.5V9M10 10h12L10 22h12M16 23v3.5" stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="square" stroke-linejoin="miter" />
    </svg>
  );
}

/** The Flipper Zero, front view; `light` is the status light's colour. */
export function FlipperIcon({ width = 52, light = "var(--scan)", pulsing = false }: { width?: number; light?: string; pulsing?: boolean }) {
  const w = 100;
  const h = 42;
  return (
    <svg width={width} height={(width * h) / w} viewBox={`-1 -1 ${w + 2} ${h + 2}`} style={{ flexShrink: 0, direction: "ltr", overflow: "visible" }}>
      <path d={`M${h * 0.28} 0H${w - h / 2}A${h / 2} ${h / 2} 0 0 1 ${w - h / 2} ${h}H${h * 0.28}A${h * 0.28} ${h * 0.28} 0 0 1 0 ${h * 0.72}V${h * 0.28}A${h * 0.28} ${h * 0.28} 0 0 1 ${h * 0.28} 0Z`} fill="#f2f2f2" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
      <rect x={w * 0.1} y={h * 0.19} width={w * 0.46} height={h * 0.62} rx={h * 0.08} fill="#333" />
      <rect x={w * 0.13} y={h * 0.26} width={w * 0.4} height={h * 0.48} rx={h * 0.04} fill="#ff8c1a" />
      <g transform={`translate(${w * 0.33 - h * 0.17} ${h * 0.5 - h * 0.17}) scale(${(h * 0.34) / 32})`}>
        <path d="M16 2.5 27.5 7v8.6c0 7-4.8 11.9-11.5 13.9C9.3 27.5 4.5 22.6 4.5 15.6V7Z" stroke="#000" stroke-width="2.4" fill="none" stroke-linejoin="round" />
        <path d="M11 11h10L11 21h10" stroke="#000" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </g>
      <circle cx={w * 0.68 + h * 0.28} cy={h * 0.22 + h * 0.28} r={h * 0.28 - h * 0.035} stroke="#8c8c8c" stroke-width={h * 0.07} fill="none" />
      <circle cx={w * 0.68 + h * 0.28} cy={h * 0.5} r={h * 0.1} fill="#b3b3b3" />
      <circle cx={w * 0.9 + h * 0.08} cy={h * 0.76} r={h * 0.08} fill="#b3b3b3" />
      <circle cx={w * 0.04 + h * 0.065} cy={h * 0.12 + h * 0.065} r={h * 0.065} fill={light} style={pulsing ? { transformOrigin: `${w * 0.04 + h * 0.065}px ${h * 0.185}px`, animation: "pulse 0.8s ease-in-out infinite" } : undefined} />
    </svg>
  );
}

/** A Kindle: a black frame and a pale e-ink page. */
export function KindleIcon({ width = 30 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 40) / 30} viewBox="0 0 30 40" style={{ flexShrink: 0 }}>
      <rect width="30" height="40" rx="4.8" fill="#2e2e2e" />
      <rect x="3.3" y="3.2" width="23.4" height="30.4" rx="2" fill="#e0e0e0" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="6.75" y={11 + i * 3.6} width="16.5" height="1.2" rx="0.6" fill="#999" />
      ))}
    </svg>
  );
}

/** The Bluetooth rune. */
export function BluetoothGlyph({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={(size * 10) / 16} height={size} viewBox="0 0 10 16" fill="none" stroke={color} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 4.3 9 11.7 5 15V1l4 3.3L1 11.7" />
    </svg>
  );
}

/** A progress ring in the Zcash yellow. */
export function Ring({ progress, size = 12, width = 2.5 }: { progress: number; size?: number; width?: number }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0.02, Math.min(1, progress));
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--soft)" stroke-width={width} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--zcash)"
        stroke-width={width}
        stroke-linecap="round"
        stroke-dasharray={`${c * p} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.4s ease" }}
      />
    </svg>
  );
}

/** An hourglass that drains and turns over, again and again. */
export function Hourglass({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 600);
    return () => clearInterval(id);
  }, []);
  const top = step === 0 ? 1 : step === 1 ? 0.5 : 0;
  const bottom = 1 - top;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${step === 3 ? 180 : 0}deg)`, transition: "transform 0.35s ease", flexShrink: 0 }}>
      <path d="M6 2h12M6 22h12M7 2v4.5c0 2 5 4 5 5.5s-5 3.5-5 5.5V22M17 2v4.5c0 2-5 4-5 5.5s5 3.5 5 5.5V22" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" />
      <path d={`M8.5 ${4 + (1 - top) * 5}h7c0 1-2 2.8-3.5 3.6C10.5 ${6.8 + (1 - top) * 5} 8.5 ${5 + (1 - top) * 5} 8.5 ${4 + (1 - top) * 5}z`} fill={color} opacity={top > 0 ? 1 : 0} />
      <path d={`M7.8 20.5h8.4c0-${(bottom * 3).toFixed(2)}-2.6-${(bottom * 3.5).toFixed(2)}-4.2-${(bottom * 3.5).toFixed(2)}S7.8 ${(20.5 - bottom * 3).toFixed(2)} 7.8 20.5z`} fill={color} opacity={bottom > 0 ? 1 : 0} />
    </svg>
  );
}

/** Confirming: a check in the circle and a short arc running around it. */
export function ConfirmingRing({ color, size }: { color: string; size: number }) {
  const ring = Math.max(2, size * 0.08);
  const r = (size - ring) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, direction: "ltr" }}>
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={color} opacity="0.35" />
      <path
        d={`M${size * 0.32} ${size * 0.52}l${size * 0.12} ${size * 0.12} ${size * 0.24}-${size * 0.26}`}
        fill="none"
        stroke="var(--ink)"
        stroke-width={size * 0.08}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" stroke-opacity="0.25" stroke-width={ring} />
      <g class="spin" style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--zcash)" stroke-opacity="0.9" stroke-width={ring} stroke-linecap="round" stroke-dasharray={`${c * 0.12} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </g>
    </svg>
  );
}

/** A flag (4:3, flag-icons), softly rounded. */
export function Flag({ name, height = 16 }: { name: string; height?: number }) {
  return (
    <img
      src={`flags/${name}.svg`}
      alt=""
      style={{ width: (height * 4) / 3, height, objectFit: "cover", borderRadius: height * 0.18, boxShadow: "0 0 0 0.5px var(--line)", flexShrink: 0 }}
    />
  );
}

/** A QR code (error correction M), crisp at any size. */
export function QRCode({ text, size = 228 }: { text: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    ref.current!.innerHTML = `<svg viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
  }, [text, size]);
  return <div ref={ref} style={{ width: size, height: size }} />;
}
