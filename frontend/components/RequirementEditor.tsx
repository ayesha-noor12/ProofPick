"use client";

import { useState } from "react";
import { NECKLINE_LABELS, Requirements, SLEEVE_LABELS } from "@/lib/api";
import { IconX } from "./ui";

const label = "block text-sm font-medium text-ink";
const box = "mt-1.5 w-full rounded-lg border border-line-strong bg-card px-3 text-sm text-ink shadow-card transition hover:border-ink/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10";

/** Choice chips for a single optional value. "Any" clears it. */
function Choice({ id, value, options, onChange }: { id: string; value: string | null; options: Record<string, string>; onChange: (v: string | null) => void }) {
  const all: [string, string][] = [["", "Any"], ...Object.entries(options)];
  return (
    <div role="radiogroup" aria-labelledby={id} className="mt-2 flex flex-wrap gap-1.5">
      {all.map(([k, v]) => {
        const on = (value ?? "") === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onChange(k || null)}
            className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${on ? "bg-ink text-white" : "bg-sand text-ink hover:bg-line"}`}>
            {v}
          </button>
        );
      })}
    </div>
  );
}

/** A list edited as chips: type and press Enter or comma to add, click × to remove. */
function TagInput({ id, value, onChange, placeholder, lower = false }: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder: string; lower?: boolean }) {
  const [draft, setDraft] = useState("");
  function commit(text: string) {
    const items = text.split(",").map((t) => (lower ? t.trim().toLowerCase() : t.trim())).filter(Boolean);
    const next = [...value, ...items.filter((t) => !value.includes(t))];
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }
  return (
    <div className={`${box} flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10`}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-sand py-0.5 pl-2 pr-1 text-[13px] text-ink">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))} className="rounded p-0.5 text-muted hover:bg-line hover:text-ink">
            <IconX className="size-3" />
          </button>
        </span>
      ))}
      <input id={id} value={draft} placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(draft); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && commit(draft)}
        className="min-w-24 flex-1 border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted/70" />
    </div>
  );
}

export function RequirementEditor({ value, onChange }: { value: Requirements; onChange: (next: Requirements) => void }) {
  const set = (patch: Partial<Requirements>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <fieldset className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6 lg:col-span-3">
        <legend className="sr-only">Must-haves</legend>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-semibold text-ink">Must-haves</h3>
          <span className="text-xs text-muted">A top is only recommended if evidence supports all of these</span>
        </div>
        <div className="mt-5 space-y-5">
          <div>
            <label className={label} htmlFor="budget">Maximum price <span className="font-normal text-muted">USD, before shipping and tax</span></label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-36">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 mt-[3px] -translate-y-1/2 text-sm text-muted">$</span>
                <input id="budget" className={`${box} h-10 pl-7 tabular-nums`} type="number" min="0" step="1" placeholder="No limit" value={value.max_price_usd ?? ""}
                  onChange={(e) => set({ max_price_usd: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <label className="mt-1.5 flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="size-4" checked={value.price_inclusive} onChange={(e) => set({ price_inclusive: e.target.checked })} />
                Include this exact price
              </label>
            </div>
          </div>
          <div>
            <span className={label} id="sleeves">Sleeves</span>
            <Choice id="sleeves" value={value.sleeves} options={SLEEVE_LABELS} onChange={(v) => set({ sleeves: v })} />
          </div>
          <div>
            <span className={label} id="neckline">Neckline</span>
            <Choice id="neckline" value={value.neckline} options={NECKLINE_LABELS} onChange={(v) => set({ neckline: v })} />
          </div>
          <div>
            <label className={label} htmlFor="excluded">Materials to avoid</label>
            <TagInput id="excluded" lower value={value.excluded_materials} placeholder="e.g. polyester, wool" onChange={(v) => set({ excluded_materials: v })} />
          </div>
        </div>
      </fieldset>
      <fieldset className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6 lg:col-span-2">
        <legend className="sr-only">Nice-to-haves</legend>
        <h3 className="font-semibold text-ink">Nice-to-haves</h3>
        <p className="mt-1 text-xs text-muted">These change the order of results. They never override a must-have.</p>
        <div className="mt-5 space-y-5">
          <div>
            <label className={label} htmlFor="prefs">Occasion or style</label>
            <TagInput id="prefs" value={value.preferences} placeholder="e.g. work, casual" onChange={(v) => set({ preferences: v })} />
          </div>
          <div>
            <label className={label} htmlFor="colors">Colors you like</label>
            <TagInput id="colors" lower value={value.preferred_colors} placeholder="e.g. black, navy" onChange={(v) => set({ preferred_colors: v })} />
            <label className="mt-2.5 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 size-4" checked={!!value.colors_required} disabled={!value.preferred_colors.length}
                onChange={(e) => set({ colors_required: e.target.checked })} />
              <span>Only show these colors <span className="block text-xs text-muted">Makes color a must-have. Matched by color family from the listing (e.g. bottle green accepts forest), not exact shade.</span></span>
            </label>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
