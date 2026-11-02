"use client";

import { useState } from "react";

/** Drag to wipe between the original garment (left) and the try-on preview (right). */
export function CompareSlider({ before, after, beforeLabel = "Original", afterLabel = "Try-on", className = "" }: {
  before: string; after: string; beforeLabel?: string; afterLabel?: string; className?: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className={`relative select-none overflow-hidden rounded-xl bg-sand ring-1 ring-line ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={afterLabel} className="block aspect-[3/4] w-full object-cover" draggable={false} />
      <div className="absolute inset-0 bg-sand" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={beforeLabel} className="block aspect-[3/4] w-full object-contain p-6" draggable={false} />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-lift">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
        </span>
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-ink shadow-card">{beforeLabel}</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-ink/80 px-2 py-0.5 text-[11px] font-medium text-white">{afterLabel}</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))}
        aria-label={`Compare ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()}`}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  );
}
