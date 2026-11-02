"use client";

import { useState } from "react";
import { Card, exampleLabel, Preview } from "@/lib/api";
import { Button, ErrorNote, IconCamera, IconCheck, IconRefresh, PreviewPill, Spinner } from "./ui";

export type RoomItem = { card: Card; recommended: boolean; rank?: number };

const ACTIVE = ["pending", "running", "inspecting"];

function Tag({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`absolute bottom-0 right-0 rounded-tl-2xl px-5 py-2 text-sm font-medium ${dark ? "bg-ink/85 text-white" : "bg-sand/95 text-ink"}`}>{children}</span>
  );
}

/** Side-by-side fitting room: pick a garment on the left, compare your photo with the try-on result. */
export function FittingRoom({ items, photoId, busyProduct, onTryOn, onReinspect, onOpen }: {
  items: RoomItem[]; photoId: string; busyProduct: string | null;
  onTryOn: (productId: string) => void; onReinspect: (productId: string) => void; onOpen: (card: Card, preview: Preview) => void;
}) {
  const firstReady = items.find((i) => i.card.previews.some((p) => p.image_url)) ?? items[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(firstReady?.card.product_id);
  const selected = items.find((i) => i.card.product_id === selectedId) ?? firstReady;
  if (!selected) return null;
  const { card } = selected;
  const latest = card.previews.at(-1);
  const shown = latest?.image_url ? latest : card.previews.findLast((p) => p.image_url);
  const working = !!latest && ACTIVE.includes(latest.status);
  const busy = busyProduct === card.product_id;
  const notInspected = latest?.status === "done" && latest.inspection?.method === "unavailable";

  return (
    <section aria-label="Fitting room" className="rounded-3xl border border-line bg-card p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row">
        {/* Garment rail */}
        <ul className="flex gap-2.5 overflow-x-auto p-1.5 md:max-h-[34rem] md:w-32 md:flex-none md:flex-col md:overflow-y-auto md:overflow-x-visible">
          {items.map(({ card: c, recommended }) => {
            const last = c.previews.at(-1);
            const ready = c.previews.some((p) => p.image_url);
            const on = c.product_id === card.product_id;
            return (
              <li key={c.product_id} className="flex-none">
                <button onClick={() => setSelectedId(c.product_id)} aria-pressed={on} aria-label={c.name}
                  className={`relative block size-24 overflow-hidden rounded-2xl bg-sand transition md:size-[6.5rem] ${on ? "ring-[3px] ring-brand ring-offset-2" : "ring-1 ring-line hover:ring-ink/30"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ready ? (c.previews.findLast((p) => p.image_url)!.image_url as string) : c.image_url} alt=""
                    className={`size-full ${ready ? "object-cover object-top" : "object-contain p-2"}`} />
                  {ready && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ok text-white"><IconCheck className="size-3" /></span>}
                  {last && ACTIVE.includes(last.status) && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-white"><Spinner className="size-3 text-brand" /></span>}
                  {!recommended && <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-white">Not a pick</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Original and result */}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
          <figure className="relative overflow-hidden rounded-2xl bg-sand ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${photoId}/image`} alt="Your photo" className="aspect-[3/4] w-full object-cover" />
            <Tag>Original</Tag>
          </figure>
          <figure className="relative overflow-hidden rounded-2xl bg-sand ring-1 ring-line">
            {shown?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown.image_url} alt={`You wearing ${card.name}`} className="aspect-[3/4] w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 p-6 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.image_url} alt="" className={`max-h-[45%] object-contain ${working ? "animate-pulse" : "opacity-80"}`} />
                {working ? (
                  <p className="flex items-center gap-2 text-sm text-ink" role="status"><Spinner className="size-4 text-brand" />Creating your try-on (about a minute)…</p>
                ) : latest?.status === "failed" || latest?.status === "skipped" ? (
                  <div className="max-w-xs text-left"><ErrorNote>{latest.error ?? "This preview could not be created."}</ErrorNote></div>
                ) : (
                  <Button disabled={busy} onClick={() => onTryOn(card.product_id)}>
                    {busy ? <><Spinner />Requesting…</> : <><IconCamera />Try it on</>}
                  </Button>
                )}
              </div>
            )}
            <span className="absolute right-3 top-3 rounded-lg bg-white/90 px-2.5 py-1 text-sm font-semibold text-ink shadow-card">Top</span>
            {shown?.cached ? <span className="absolute left-3 top-3 rounded-lg bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn shadow-card">Pre-generated example{shown.cached === 2 && " · not your photo"}</span> : null}
            <Tag dark>Result</Tag>
          </figure>
        </div>
      </div>

      {/* Details for the selected garment */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 md:ml-[8.75rem]">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{card.name} <span className="font-normal text-muted">· ${card.price.toFixed(2)}</span></p>
          <p className="text-[13px] text-muted">
            {selected.recommended ? `Pick #${selected.rank ?? "–"}: meets every must-have` : "Not recommended: misses a must-have. Shown because you asked to try it."}
            {shown && exampleLabel(shown) && <span className="mt-0.5 block font-medium text-warn">{exampleLabel(shown)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shown?.inspection && (
            <button onClick={() => onOpen(card, shown)} className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-sand">
              <PreviewPill status={shown.inspection.status} /><span className="text-[13px] font-medium text-brand">Detail check</span>
            </button>
          )}
          {notInspected && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => onReinspect(card.product_id)}>
              {busy ? <><Spinner />Checking…</> : <><IconRefresh />Check again</>}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
