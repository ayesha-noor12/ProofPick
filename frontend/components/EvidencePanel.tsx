"use client";

import { useEffect } from "react";
import { Card, Check, featureStatus, METHOD_LABELS, Preview, requirementLabel, SOURCE_LABELS } from "@/lib/api";
import { ListingLink, SourceIcon } from "./SourceBadge";
import { Button, CheckPill, IconCheck, IconInfo, IconQuestion, IconX, PreviewPill } from "./ui";

export type PanelContent =
  | { type: "check"; card: Card; check: Check }
  | { type: "preview"; card: Card; preview: Preview };

const FEATURE_LOOK = {
  consistent: { text: "Consistent", tone: "bg-ok-bg text-ok", Icon: IconCheck },
  possible_difference: { text: "Possible difference", tone: "bg-bad-bg text-bad", Icon: IconX },
  not_assessable: { text: "Not assessable", tone: "bg-warn-bg text-warn", Icon: IconQuestion },
};
const FEATURE_NAMES: Record<string, string> = {
  neckline: "Neckline", sleeves: "Sleeves", color: "Color appearance", silhouette: "Silhouette", details: "Visible details", pattern: "Visible details",
};
const WHY_TEXT: Record<string, string> = {
  hidden_by_pose_or_cropping: "Hidden by pose, hair, arms or framing.",
  image_too_unclear: "The preview is too unclear to compare.",
  not_visible_in_original: "Not visible in the original product image.",
};

function Rule({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{children}</h4>;
}

function CheckDetail({ card, check }: { card: Card; check: Check }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2.5"><h3 className="text-xl font-semibold text-ink">{requirementLabel(check.requirement)}</h3><CheckPill status={check.status} /></div>
      <p className="text-[15px] leading-relaxed text-ink">{check.explanation}</p>
      {check.reason && <p className="rounded-xl bg-sand px-3.5 py-2.5 text-sm text-ink">{check.reason}</p>}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
        <div className="bg-card px-4 py-3"><dt className="text-xs font-medium text-muted">Observed</dt><dd className="mt-1 text-ink">{check.observed}</dd></div>
        <div className="bg-card px-4 py-3"><dt className="text-xs font-medium text-muted">How this was checked</dt><dd className="mt-1 text-ink">{METHOD_LABELS[check.method] ?? check.method}</dd></div>
      </dl>
      <div>
        <Rule>Source evidence</Rule>
        {check.evidence.length === 0 && (
          <div className="mt-3 space-y-2 text-sm text-muted">
            <p>No collected source contains this information, so it is marked Unknown rather than guessed.</p>
            <ListingLink card={card} />
          </div>
        )}
        <ul className="mt-4 space-y-4">
          {check.evidence.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-card p-4 text-sm shadow-card">
              {e.quote && <blockquote className="border-l-2 border-brand pl-3 text-[15px] leading-snug text-ink">“{e.quote}”</blockquote>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.image_url && <img src={e.image_url} alt="Original product" className="max-h-64 rounded-lg bg-sand p-2" />}
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-muted">Source type</dt>
                <dd className="flex items-center gap-1.5 text-ink"><SourceIcon type={e.source_type} />{SOURCE_LABELS[e.source_type]}</dd>
                <dt className="text-muted">Source</dt><dd className="text-ink">{e.source}</dd>
                <dt className="text-muted">Collected</dt><dd className="text-ink">{e.collected_at}</dd>
              </dl>
              <div className="mt-3"><ListingLink card={card} evidence={e} /></div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PreviewDetail({ card, preview }: { card: Card; preview: Preview }) {
  const inspection = preview.inspection;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.image_url} alt={`Original ${card.name}`} className="aspect-[3/4] w-full rounded-xl bg-sand object-contain p-3 ring-1 ring-line" />
          <figcaption className="mt-1.5 text-center text-xs font-medium text-muted">Original garment</figcaption>
        </figure>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview.image_url && <img src={preview.image_url} alt={`Try-on preview of ${card.name}`} className="aspect-[3/4] w-full rounded-xl bg-sand object-cover ring-1 ring-line" />}
          <figcaption className="mt-1.5 text-center text-xs font-medium text-muted">{preview.cached ? "Pre-generated example" : "YouCam try-on"}</figcaption>
          {preview.cached === 2 && <p className="mt-1 text-center text-[11px] font-medium text-warn">Sample model, not your photo</p>}
        </figure>
      </div>
      {inspection && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Preview integrity: visible observations</h3>
            <PreviewPill status={inspection.status} />
          </div>
          {inspection.features.length === 0 && <p className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-sm text-warn">Not assessable: {inspection.summary}</p>}
          {inspection.features.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-sand text-xs text-muted">
                  <tr><th scope="col" className="px-3 py-2 font-medium">Feature</th><th scope="col" className="px-3 py-2 font-medium">Status</th><th scope="col" className="px-3 py-2 font-medium">Observation</th></tr>
                </thead>
                <tbody className="divide-y divide-line bg-card">
                  {inspection.features.map((f) => {
                    const { status, why } = featureStatus(f);
                    const { text, tone, Icon } = FEATURE_LOOK[status];
                    return (
                      <tr key={f.feature} className="align-top">
                        <th scope="row" className="px-3 py-2.5 font-medium text-ink">{FEATURE_NAMES[f.feature] ?? f.feature}</th>
                        <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}><Icon className="size-3" />{text}</span></td>
                        <td className="px-3 py-2.5 text-muted">{f.observation}{why && <span className="mt-0.5 block text-warn">{WHY_TEXT[why] ?? why}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <p className="flex gap-2.5 border-t border-line pt-4 text-xs text-muted">
        <IconInfo className="mt-px size-3.5 flex-none" />
        <span>
          These are AI-assisted visible observations, not guarantees, and there is no score. They do not cover physical fit, comfort,
          opacity or exact color, and they never change whether the product meets your requirements.
        </span>
      </p>
    </div>
  );
}

export function EvidencePanel({ content, onClose }: { content: PanelContent | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!content) return null;
  return (
    <div className="fixed inset-0 z-20 flex animate-fade justify-end bg-ink/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Evidence" onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-lg animate-sheet overflow-y-auto bg-paper shadow-lift">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand">{content.type === "check" ? "Product evidence" : "Try-on check"}</p>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-ink">{content.card.name}</h2>
          </div>
          <Button variant="quiet" size="sm" onClick={onClose} autoFocus><IconX />Close</Button>
        </div>
        <div className="p-5 sm:p-6">
          {content.type === "check" ? <CheckDetail card={content.card} check={content.check} /> : <PreviewDetail card={content.card} preview={content.preview} />}
        </div>
      </aside>
    </div>
  );
}
