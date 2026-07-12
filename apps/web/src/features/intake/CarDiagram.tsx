"use client";

import type { Marker, MarkerType } from "./damage";
import { markerMeta } from "./damage";

/** Top-view car condition diagram. Editable: tap to place a marker of `activeType`,
 *  tap a marker to remove it. Read-only: renders the marker dots only. Markers are
 *  stored as % coordinates so they scale with any diagram size. */
export function CarDiagram({
  markers,
  editable = false,
  activeType,
  onAdd,
  onRemove,
  maxWidth = 300,
}: {
  markers: Marker[];
  editable?: boolean;
  activeType?: MarkerType;
  onAdd?: (x: number, y: number) => void;
  onRemove?: (i: number) => void;
  maxWidth?: number;
}) {
  function tap(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || !onAdd) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    if (x < 5 || x > 95 || y < 2 || y > 98) return; // ignore edge taps
    onAdd(x, y);
  }

  return (
    <div
      onClick={tap}
      className="relative mx-auto select-none"
      style={{ aspectRatio: "260 / 520", width: "100%", maxWidth, cursor: editable ? "crosshair" : "default" }}
    >
      <svg viewBox="0 0 260 520" style={{ width: "100%", height: "100%", display: "block" }}>
        <rect x="30" y="84" width="20" height="72" rx="10" fill="#AEBAC6" />
        <rect x="210" y="84" width="20" height="72" rx="10" fill="#AEBAC6" />
        <rect x="30" y="368" width="20" height="72" rx="10" fill="#AEBAC6" />
        <rect x="210" y="368" width="20" height="72" rx="10" fill="#AEBAC6" />
        <path
          d="M130 14 C176 14 199 30 203 62 L209 116 C213 152 215 198 215 252 L215 356 C215 404 211 446 204 472 C197 499 168 508 130 508 C92 508 63 499 56 472 C49 446 45 404 45 356 L45 252 C45 198 47 152 51 116 L57 62 C61 30 84 14 130 14 Z"
          fill="#E7EBF0" stroke="rgba(15,26,36,.40)" strokeWidth="2"
        />
        <path d="M72 108 C102 96 158 96 188 108" fill="none" stroke="rgba(15,26,36,.18)" strokeWidth="1.6" />
        <path d="M76 134 C104 122 156 122 184 134 L174 178 C146 169 114 169 86 178 Z" fill="rgba(70,120,160,.18)" stroke="rgba(15,26,36,.25)" strokeWidth="1.6" />
        <path d="M84 188 L81 328 M176 188 L179 328" fill="none" stroke="rgba(15,26,36,.12)" strokeWidth="1.6" />
        <path d="M86 340 C114 350 146 350 174 340 L182 378 C152 390 108 390 78 378 Z" fill="rgba(70,120,160,.18)" stroke="rgba(15,26,36,.25)" strokeWidth="1.6" />
        <path d="M76 452 C108 462 152 462 184 452" fill="none" stroke="rgba(15,26,36,.18)" strokeWidth="1.6" />
        <path d="M45 146 L28 154 L28 170 L45 175 Z" fill="#E7EBF0" stroke="rgba(15,26,36,.35)" strokeWidth="1.6" />
        <path d="M215 146 L232 154 L232 170 L215 175 Z" fill="#E7EBF0" stroke="rgba(15,26,36,.35)" strokeWidth="1.6" />
      </svg>

      {markers.map((m, i) => {
        const meta = markerMeta(m.type);
        // Tablet rows saved before 2026-07-12 stored fractions (0–1). A web tap can
        // never produce x/y ≤ 1.5 (the edge guard rejects them), so scale on sight.
        const frac = m.x <= 1.5 && m.y <= 1.5;
        const mx = frac ? m.x * 100 : m.x;
        const my = frac ? m.y * 100 : m.y;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); if (editable && onRemove) onRemove(i); }}
            title={editable ? "Tap to remove" : meta.label}
            style={{
              position: "absolute",
              left: `${mx}%`,
              top: `${my}%`,
              transform: "translate(-50%, -50%)",
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: meta.color,
              color: "#0B0D0F",
              font: "700 12px system-ui, sans-serif",
              border: "2px solid rgba(255,255,255,.85)",
              boxShadow: "0 2px 10px rgba(0,0,0,.45)",
              cursor: editable ? "pointer" : "default",
            }}
          >
            {meta.letter}
          </button>
        );
      })}
    </div>
  );
}
