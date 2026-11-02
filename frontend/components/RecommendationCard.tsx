"use client";

import { Card, Check, Evidence, exampleLabel, Preview, requirementLabel, SOURCE_LABELS } from "@/lib/api";
import { CompareSlider } from "./CompareSlider";
import { DemoBadge, ListingLink, SourceIcon } from "./SourceBadge";
import { Button, CheckPill, ErrorNote, IconCamera, IconCheck, IconRefresh, IconSparkle, Notice, PreviewPill, Spinner } from "./ui";

/** Requirement checks as compact rows: label, verdict, then the reason. Each opens its evidence. */
export function CheckRows({ checks, onOpen }: { checks: Check[]; onOpen: (check: Check) => void }) {
  return (
    <ul className="divide-y divide-line">
      {checks.map((check) => (
        <li key={check.requirement}>
          <button onClick={() => onOpen(check)} className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-2 text-left transition hover:bg-sand">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{requirementLabel(check.requirement)}</span>
              <CheckPill status={check.status} />
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-snug text-muted">
              {check.evidence[0]?.quote
                ? <><SourceIcon type={check.evidence[0].source_type} /><span className="truncate">&ldquo;{check.evidence[0].quote}&rdquo; · {SOURCE_LABELS[check.evidence[0].source_type]}</span></>
                : check.explanation}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type PreviewProps = {
  card: Card; hasPhoto: boolean; retriesRemaining: number; busy: boolean;
  onRetry: () => void; onReinspect: () => void; onOpen: (preview: Preview) => void;
};

function PreviewBlock({ card, hasPhoto, retriesRemaining, busy, onRetry, onReinspect, onOpen }: PreviewProps) {
  if (!hasPhoto) return <p className="text-sm text-muted">Add a photo to your next search to try this on.</p>;
  const latest = card.previews.at(-1);
  if (!latest) return <p className="text-sm text-muted">No preview requested.</p>;
  const shown = latest.image_url ? latest : card.previews.findLast((p) => p.image_url);
  const inProgress = ["pending", "running", "inspecting"].includes(latest.status);
  const notInspected = latest.status === "done" && latest.inspection?.method === "unavailable";
  const canRetry = retriesRemaining > 0 && !inProgress && latest.status !== "skipped"
    && latest.inspection?.status !== "no_visible_mismatch_detected" && !notInspected;
  return (
    <div className="space-y-3">
      {inProgress && !shown && <div className="skeleton aspect-[3/4] w-full rounded-xl" />}
      {inProgress && (
        <p className="flex items-center gap-2 text-sm text-ink" role="status">
          <Spinner className="size-4 text-brand" />{latest.status === "inspecting" ? "Checking the preview kept the garment's details…" : "Creating your try-on (about a minute)…"}
        </p>
      )}
      {latest.status === "failed" && <ErrorNote>{latest.error ?? "This preview could not be created."}</ErrorNote>}
      {latest.status === "skipped" && <Notice tone="warn">{latest.error}</Notice>}
      {shown?.image_url && <CompareSlider before={card.image_url} after={shown.image_url} />}
      {shown && exampleLabel(shown) && <p className="rounded-lg bg-warn-bg px-2.5 py-1.5 text-[12px] font-medium text-warn">{exampleLabel(shown)}</p>}
      {shown?.inspection && (
        <div className="space-y-1.5">
          <PreviewPill status={shown.inspection.status} />
          <p className="text-[13px] text-muted">
            {shown.inspection.method === "unavailable" ? "The AI check was busy, so this preview hasn't been compared with the original yet." : shown.inspection.summary}
          </p>
          <button onClick={() => onOpen(shown)} className="text-[13px] font-medium text-brand hover:underline">See the detail-by-detail check</button>
        </div>
      )}
      {notInspected && (
        <Button variant="quiet" size="sm" disabled={busy} onClick={onReinspect}>
          {busy ? <><Spinner />Checking…</> : <><IconRefresh />Check again</>}
        </Button>
      )}
      {canRetry && (
        <Button variant="quiet" size="sm" disabled={busy} onClick={onRetry}>
          {busy ? <><Spinner />Requesting…</> : <><IconRefresh />New preview (1 per session)</>}
        </Button>
      )}
    </div>
  );
}

/** Why this rank: lines built by the server from check results and preference matches, not model prose. */
export function WhyRanked({ card, rank }: { card: Card; rank?: number }) {
  if (!card.why?.length) return null;
  return (
    <div className="mt-3 rounded-xl bg-brand-soft px-3.5 py-2.5 text-[13px] leading-snug text-ink">
      <p className="font-semibold text-brand">{rank ? `Why ranked #${rank}` : "Why it's listed here"}</p>
      <ul className="mt-1 space-y-0.5">
        {card.why.map((line) => <li key={line} className="flex gap-1.5"><span aria-hidden="true" className="text-brand">•</span>{line}</li>)}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted">Ranking never changes eligibility.</p>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = { composition: "Fabric", sleeves: "Sleeves", neckline: "Neckline", color: "Color" };

/** What the sources document about the garment, each line with its source. Only collected facts, no ratings. */
function Documented({ items, tags }: { items: Evidence[]; tags: string[] }) {
  if (!items.length && !tags.length) return null;
  return (
    <section className="mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">What the sources document</h4>
      <dl className="mt-2 space-y-1.5">
        {items.map((e) => (
          <div key={e.id} className="grid grid-cols-[5.5rem_1fr] items-start gap-2 text-[13px]">
            <dt className="text-muted">{FIELD_LABELS[e.field] ?? e.field}</dt>
            <dd className="flex min-w-0 items-start gap-1.5 text-ink"><span className="mt-0.5 text-muted"><SourceIcon type={e.source_type} /></span><span>{e.quote}</span></dd>
          </div>
        ))}
        {tags.length > 0 && (
          <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2 text-[13px]">
            <dt className="text-muted">Occasion</dt>
            <dd className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded-md bg-sand px-1.5 py-0.5 capitalize text-ink">{t}</span>)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-1.5 text-[11px] text-muted">Occasion tags come from the seller. Fit, comfort and exact color are not assessed.</p>
    </section>
  );
}

export function RecommendationCard({ card, rank, hasPhoto, retriesRemaining, busy, onRetry, onReinspect, onOpenCheck, onOpenPreview }: {
  card: Card; rank: number; hasPhoto: boolean; retriesRemaining: number; busy: boolean;
  onRetry: () => void; onReinspect: () => void; onOpenCheck: (check: Check) => void; onOpenPreview: (preview: Preview) => void;
}) {
  const supported = card.checks.filter((c) => c.status === "meets_documented_requirements").length;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card transition duration-300 hover:shadow-lift">
      <div className="relative bg-sand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image_url} alt={card.name} className="aspect-[4/3] w-full object-contain p-6" />
        <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-card ${rank === 1 ? "bg-ink text-white" : "bg-white text-ink"}`}>
          {rank === 1 && <IconSparkle className="size-3.5" />}{rank === 1 ? "Best match" : `#${rank}`}
        </span>
        {card.is_owned && <span className="absolute bottom-3 left-3 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink shadow-card">Real garment</span>}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ok-bg px-2.5 py-1 text-xs font-medium text-ok ring-1 ring-ok/20">
          <IconCheck className="size-3.5" />{supported}/{card.checks.length} verified
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-tight text-ink">{card.name}</h3>
            <p className="mt-0.5 text-sm capitalize text-muted">{card.brand} · {card.variant}</p>
          </div>
          <p className="text-lg font-semibold tabular-nums text-ink">${card.price.toFixed(2)}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">{card.is_demo ? <DemoBadge /> : <ListingLink card={card} />}</div>
        <WhyRanked card={card} rank={rank} />
        <h4 className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Requirement checks</h4>
        <div className="mt-1"><CheckRows checks={card.checks} onOpen={onOpenCheck} /></div>
        <Documented items={card.documented} tags={card.tags} />
        <section className="mt-auto border-t border-line pt-4">
          <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted"><IconCamera className="size-3.5" />Try-on</h4>
          <PreviewBlock card={card} hasPhoto={hasPhoto} retriesRemaining={retriesRemaining} busy={busy}
            onRetry={onRetry} onReinspect={onReinspect} onOpen={onOpenPreview} />
        </section>
      </div>
      <p className="border-t border-line bg-sand/60 px-5 py-2.5 text-[11px] text-muted">{card.data_label}. Collected {card.collected_at}. Physical fit is not assessed.</p>
    </article>
  );
}

/** A compact try-on for products outside the top picks: one button to create it, then the slider. */
export function MiniTryOn({ card, busy, onTryOn, onOpen }: { card: Card; busy: boolean; onTryOn: () => void; onOpen: (preview: Preview) => void }) {
  const latest = card.previews.at(-1);
  if (!latest) {
    return (
      <Button variant="quiet" size="sm" disabled={busy} onClick={onTryOn}>
        {busy ? <><Spinner />Requesting…</> : <><IconCamera />Try it on anyway</>}
      </Button>
    );
  }
  if (["pending", "running", "inspecting"].includes(latest.status)) {
    return <p className="flex items-center gap-2 text-[13px] text-ink" role="status"><Spinner className="size-3.5 text-brand" />Creating try-on…</p>;
  }
  if (!latest.image_url) return <ErrorNote>{latest.error ?? "This preview could not be created."}</ErrorNote>;
  return (
    <div className="space-y-1.5">
      <CompareSlider before={card.image_url} after={latest.image_url} className="max-w-56" />
      {latest.inspection && <button onClick={() => onOpen(latest)} className="block"><PreviewPill status={latest.inspection.status} /></button>}
      {exampleLabel(latest) && <p className="text-[11px] font-medium text-warn">Pre-generated example{latest.cached === 2 && ", not your photo"}</p>}
    </div>
  );
}
