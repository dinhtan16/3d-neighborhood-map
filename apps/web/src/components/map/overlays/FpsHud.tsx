'use client';
import { useEffect, useRef, useState } from 'react';
import { useWorldStatus } from '@/features/map/world-status';
import { fpsInput } from '../FirstPersonController';

/** First-person HUD: crosshair, location, controls help, pointer-lock prompt, touch joystick. */
export function FpsHud() {
  const loc = useWorldStatus((s) => s.location);
  const [locked, setLocked] = useState(false);
  const [ride, setRide] = useState(false);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    setTouch(typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
    const id = setInterval(() => { setLocked(fpsInput.locked); setRide(fpsInput.ride); }, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fps-hud">
      <div className="crosshair" aria-hidden />
      <div className="fps-location">
        <strong>{loc?.road ?? 'Đang đi…'}</strong>
        <span>{loc?.town ? `${loc.town} · ` : ''}{loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : ''}</span>
        {ride && <span className="badge">🛵 Đi xe máy</span>}
      </div>
      {!touch && !locked && (
        <button id="fps-lock" className="fps-lock">
          <strong>Bấm để bắt đầu đi bộ</strong>
          <span>W A S D / mũi tên: di chuyển · Chuột: nhìn · Shift: chạy · R: xe máy · Click: xem cửa hàng · Esc: thoát chuột</span>
        </button>
      )}
      {touch && <TouchControls />}
    </div>
  );
}

function TouchControls() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const lookStart = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <>
      <div
        ref={base}
        className="joystick"
        onPointerDown={(e) => (e.target as HTMLElement).setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (!e.buttons && e.pointerType === 'mouse') return;
          const r = base.current!.getBoundingClientRect();
          let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          const l = Math.hypot(dx, dy);
          if (l > 1) { dx /= l; dy /= l; }
          fpsInput.joyX = dx; fpsInput.joyY = dy;
          fpsInput.run = l > 0.95;
          setKnob([dx, dy]);
        }}
        onPointerUp={() => { fpsInput.joyX = fpsInput.joyY = 0; fpsInput.run = false; setKnob([0, 0]); }}
      >
        <div className="knob" style={{ transform: `translate(${knob[0] * 32}px, ${knob[1] * 32}px)` }} />
      </div>
      <div
        className="look-pad"
        onPointerDown={(e) => { lookStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const s = lookStart.current;
          if (!s || s.id !== e.pointerId) return;
          fpsInput.lookDX += (e.clientX - s.x) * 1.6;
          fpsInput.lookDY += (e.clientY - s.y) * 1.6;
          s.x = e.clientX; s.y = e.clientY;
        }}
        onPointerUp={() => { lookStart.current = null; }}
      />
      <button className="ride-btn" onClick={() => { fpsInput.ride = !fpsInput.ride; }}>🛵</button>
    </>
  );
}
