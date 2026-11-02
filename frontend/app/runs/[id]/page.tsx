"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EvidencePanel, PanelContent } from "@/components/EvidencePanel";
import { EvidenceMatrix, MatrixColumn } from "@/components/EvidenceMatrix";
import { FittingRoom, RoomItem } from "@/components/FittingRoom";
import { CheckRows, MiniTryOn, RecommendationCard } from "@/components/RecommendationCard";
import { Button, buttonClass, ErrorNote, Eyebrow, IconArrowLeft, IconArrowRight, IconChevronDown, IconEdit, IconSparkle, IconTrash, Notice, Spinner, Steps } from "@/components/ui";
import { api, Card, relaxed, requirementLabel, Run, summarize } from "@/lib/api";
import { clearDraft, saveDraft } from "@/lib/draft";

const STAGE_TEXT: Record<string, string> = {
  queued: "Starting your search…",
  checking: "Checking every product against your must-haves…",
  ranking: "Ranking the eligible tops by your preferences…",
  previewing: "Creating your try-on previews…",
};
const STAGES = ["queued", "checking", "ranking", "previewing"];
const STAGE_LABELS = ["Start", "Check", "Rank", "Try on"];

function CompactCard({ card, onOpen, footer }: { card: Card; onOpen: (content: PanelContent) => void; footer?: React.ReactNode }) {
  const failing = card.checks.filter((c) => c.status !== "meets_documented_requirements");
  return (
    <article className="flex gap-4 rounded-2xl border border-line bg-card p-4 shadow-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={card.image_url} alt={card.name} className="size-20 flex-none self-start rounded-xl bg-sand object-contain p-2" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h4 className="font-semibold leading-tight text-ink">{card.name}</h4>
          <span className="text-sm font-medium tabular-nums text-ink">${card.price.toFixed(2)}</span>
        </div>
        <p className="text-[13px] capitalize text-muted">{card.variant}</p>
        <div className="mt-1"><CheckRows checks={failing.length ? failing : card.checks} onOpen={(check) => onOpen({ type: "check", card, check })} /></div>
        {footer && <div className="mt-3 border-t border-line pt-3">{footer}</div>}
      </div>
    </article>
  );
}

function SectionHead({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{title}</h2>
        <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-medium text-muted">{count}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelContent | null>(null);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [relaxing, setRelaxing] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "matrix">("cards");

  const load = useCallback(async () => {
    try {
      setRun(await api.run(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  const active = !run || !["complete", "failed"].includes(run.state);
  useEffect(() => {
    void load();
    if (!active) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [active, load]);

  async function previewAction(productId: string, action: (id: string, productId: string) => Promise<unknown>) {
    setBusyProduct(productId);
    setActionError(null);
    try {
      await action(id, productId);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyProduct(null);
    }
  }

  function editSearch() {
    if (!run) return;
    saveDraft({ text: run.original_text, requirements: run.requirements, parser: null, notes: [], photoId: run.photo_id, scope: run.scope });
    router.push("/");
  }

  async function searchWithout(requirement: string) {
    const next = run && relaxed(run.requirements, requirement);
    if (!run || !next) return;
    setRelaxing(requirement);
    setActionError(null);
    try {
      const { run_id } = await api.start(run.original_text, next, run.photo_id, run.scope);
      router.push(`/runs/${run_id}`);
    } catch (e) {
      setActionError((e as Error).message);
      setRelaxing(null);
    }
  }

  async function deleteData() {
    if (!window.confirm("Delete this session's photos, previews and results from ProofPick?")) return;
    try {
      const { session_id } = await api.session();
      const { note } = await api.deleteSession(session_id);
      clearDraft();
      window.alert(`Deleted from ProofPick. ${note}`);
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const close = useCallback(() => setPanel(null), []);

  if (error && !run) {
    return (
      <main className="mx-auto max-w-xl space-y-5 px-4 py-20">
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Link href="/history" className={buttonClass("quiet")}>My searches</Link>
          <Link href="/" className={buttonClass("primary")}>New search</Link>
        </div>
      </main>
    );
  }
  if (!run) {
    return <main className="mx-auto flex max-w-xl items-center justify-center gap-3 px-4 py-24 text-muted" role="status"><Spinner className="size-5 text-brand" />Loading…</main>;
  }

  const recommendations = run.recommendations ?? [];
  const usedRules = run.ranking_method === "rules" && recommendations.length > 1;
  const chips = [...summarize(run.requirements), ...run.requirements.preferences, ...run.requirements.preferred_colors];
  const tally = [
    { id: "picks", label: "Top picks", n: recommendations.length },
    { id: "eligible", label: "Also eligible", n: run.other_eligible?.length ?? 0 },
    { id: "needs-info", label: "Missing info", n: run.needs_information?.length ?? 0 },
    { id: "excluded", label: "Ruled out", n: run.excluded?.length ?? 0 },
  ];
  const failCount = (c: Card) => c.checks.filter((k) => k.status !== "meets_documented_requirements").length;
  const nearMisses = run.no_match
    ? [...(run.needs_information ?? []), ...(run.excluded ?? [])].sort((a, b) => failCount(a) - failCount(b) || a.price - b.price).slice(0, 3)
    : [];
  const compact = (c: Card) => (
    <CompactCard key={c.product_id} card={c} onOpen={setPanel}
      footer={run.has_photo && <MiniTryOn card={c} busy={busyProduct === c.product_id} onTryOn={() => previewAction(c.product_id, api.tryOn)}
        onOpen={(preview) => setPanel({ type: "preview", card: c, preview })} />} />
  );
  // Picks first, then other eligible tops, then anything else the shopper chose to try on (or near misses when nothing matched).
  const roomItems: RoomItem[] = [];
  const addRoom = (card: Card, recommended: boolean, rank?: number) => {
    if (!roomItems.some((i) => i.card.product_id === card.product_id)) roomItems.push({ card, recommended, rank });
  };
  recommendations.forEach((c, i) => addRoom(c, true, i + 1));
  (run.other_eligible ?? []).forEach((c) => addRoom(c, true));
  [...(run.needs_information ?? []), ...(run.excluded ?? [])].filter((c) => c.previews.length).forEach((c) => addRoom(c, false));
  nearMisses.forEach((c) => addRoom(c, false));
  // Shortlist first, so the default four columns are the products worth comparing.
  const matrixColumns: MatrixColumn[] = [];
  const addColumn = (card: Card, group: string) => {
    if (!matrixColumns.some((c) => c.card.product_id === card.product_id)) matrixColumns.push({ card, group });
  };
  recommendations.forEach((c, i) => addColumn(c, `Pick #${i + 1}`));
  (run.other_eligible ?? []).forEach((c) => addColumn(c, "Also eligible"));
  nearMisses.forEach((c) => addColumn(c, "Closest match"));
  (run.needs_information ?? []).forEach((c) => addColumn(c, "Missing info"));
  (run.excluded ?? []).forEach((c) => addColumn(c, "Ruled out"));
  const openExcluded = () => document.getElementById("excluded-details")?.setAttribute("open", "");
  return (
    <main className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-12">
      <section className="animate-rise">
        <Link href="/history" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><IconArrowLeft />My searches</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-3xl">
            <Eyebrow>Step 3 · Compare</Eyebrow>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Your results</h1>
            {run.original_text && <p className="mt-2 text-lg text-muted">“{run.original_text}”</p>}
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => <span key={c} className="rounded-md bg-sand px-2 py-0.5 text-[13px] text-ink ring-1 ring-line first-letter:uppercase">{c}</span>)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" onClick={editSearch}><IconEdit />Edit this search</Button>
            <Button variant="ghost" onClick={deleteData}><IconTrash />Delete my data</Button>
          </div>
        </div>
        {active && (
          <div className="mt-8 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
            <p role="status" className="flex items-center gap-3 font-medium text-ink"><Spinner className="size-4 text-brand" />{STAGE_TEXT[run.state]}</p>
            <div className="mt-4"><Steps steps={STAGE_LABELS} current={Math.max(0, STAGES.indexOf(run.state))} decorative /></div>
          </div>
        )}
        <div className="mt-6 space-y-3 empty:hidden">
          {run.state === "failed" && <ErrorNote>{run.error}</ErrorNote>}
          {run.preview_notice && <Notice tone="info">{run.preview_notice}</Notice>}
          {actionError && <ErrorNote>{actionError}</ErrorNote>}
          {usedRules && <Notice tone="info">The AI ranker was unavailable, so results are ordered with simple preference rules. Requirement checks are unaffected.</Notice>}
        </div>
        {run.state === "complete" && (
          <nav aria-label="Result summary" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tally.map((t) => {
              const body = (
                <>
                  <span className="block text-3xl font-semibold tabular-nums text-ink">{t.n}</span>
                  <span className="mt-0.5 block text-sm text-muted">{t.label}</span>
                </>
              );
              const look = "rounded-2xl border border-line bg-card px-4 py-3.5 shadow-card";
              return t.n > 0
                ? <a key={t.id} href={`#${t.id}`} onClick={t.id === "excluded" ? openExcluded : undefined} className={`${look} transition hover:border-ink/30 hover:shadow-lift`}>{body}</a>
                : <div key={t.id} className={`${look} opacity-60`}>{body}</div>;
            })}
          </nav>
        )}
        {run.state === "complete" && (
          <div role="tablist" aria-label="Results view" className="mt-6 inline-flex rounded-lg bg-sand p-1">
            {([["cards", "Cards"], ["matrix", "Evidence matrix"]] as const).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${view === v ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </section>

      {view === "matrix" && run.state === "complete" && (
        <section className="animate-rise">
          <SectionHead title="Evidence matrix" count={Math.min(4, matrixColumns.length)}>
            Your shortlist against every requirement. Click a must-have cell to see its snippet, source and date.
          </SectionHead>
          <EvidenceMatrix columns={matrixColumns} onOpen={(card, check) => setPanel({ type: "check", card, check })} />
        </section>
      )}

      {active && !recommendations.length && (
        <div aria-hidden="true" className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`skeleton h-[30rem] rounded-2xl ${["", "hidden md:block", "hidden lg:block"][i]}`} style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      )}

      {run.no_match && (
        <section className="animate-rise rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">No top matches every must-have</h2>
          <p className="mt-1.5 text-muted">{run.no_match.message} Here&apos;s what is blocking results, and what dropping each one would unlock:</p>
          <ul className="mt-5 space-y-2.5">
            {run.no_match.blockers.map((b) => {
              const canRelax = relaxed(run.requirements, b.requirement) !== null;
              return (
                <li key={b.requirement} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                  <div className="text-sm">
                    <p className="font-medium text-ink">{requirementLabel(b.requirement)}</p>
                    <p className="text-muted">
                      {b.conflicts} conflict{b.conflicts === 1 ? "" : "s"}, {b.unknown} unknown
                      {b.would_unlock > 0
                        ? <> · <span className="font-medium text-ok">dropping it alone unlocks {b.would_unlock}</span></>
                        : <> · dropping it alone isn&apos;t enough</>}
                    </p>
                  </div>
                  {canRelax && (
                    <Button variant="quiet" size="sm" disabled={relaxing !== null} onClick={() => searchWithout(b.requirement)}>
                      {relaxing === b.requirement ? <><Spinner />Searching…</> : <>Search without it<IconArrowRight /></>}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button className="mt-6" onClick={editSearch}><IconEdit />Change my requirements</Button>
        </section>
      )}

      {view === "cards" && run.has_photo && run.photo_id && run.state !== "failed" && roomItems.length > 0 && (
        <section className="animate-rise">
          <SectionHead title="Fitting room" count={roomItems.length}>
            Pick a top on the left to see it on you. Try-ons are AI previews: they don&apos;t show fit, and color on screen may differ.
          </SectionHead>
          <FittingRoom items={roomItems} photoId={run.photo_id} busyProduct={busyProduct}
            onTryOn={(pid) => previewAction(pid, api.tryOn)} onReinspect={(pid) => previewAction(pid, api.reinspect)}
            onOpen={(card, preview) => setPanel({ type: "preview", card, preview })} />
        </section>
      )}

      {view === "cards" && nearMisses.length > 0 && (
        <section className="animate-rise">
          <SectionHead title="Closest matches" count={nearMisses.length}>Not recommended, because each one misses a must-have. Shown so you can decide what you&apos;d trade off.</SectionHead>
          <div className="grid gap-4 md:grid-cols-3">{nearMisses.map(compact)}</div>
        </section>
      )}

      {view === "cards" && recommendations.length > 0 && (
        <section id="picks" className="scroll-mt-20">
          <SectionHead title="Top picks" count={recommendations.length}>
            {run.ranking_method === "model" && recommendations.length > 1
              ? <span className="inline-flex items-center gap-1.5"><IconSparkle className="size-3.5 text-brand" />Every must-have is backed by evidence. Ordered by AI from your nice-to-haves.</span>
              : "Every must-have is backed by evidence. Tap any check to see its source."}
          </SectionHead>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((card, i) => (
              <div key={card.product_id} className="animate-rise" style={{ animationDelay: `${i * 80}ms` }}>
                <RecommendationCard card={card} rank={i + 1} hasPhoto={run.has_photo}
                  retriesRemaining={run.retries_remaining ?? 0} busy={busyProduct === card.product_id}
                  onRetry={() => previewAction(card.product_id, api.retry)}
                  onReinspect={() => previewAction(card.product_id, api.reinspect)}
                  onOpenCheck={(check) => setPanel({ type: "check", card, check })}
                  onOpenPreview={(preview) => setPanel({ type: "preview", card, preview })} />
              </div>
            ))}
          </div>
        </section>
      )}

      {view === "cards" && !!run.other_eligible?.length && (
        <section id="eligible" className="scroll-mt-20">
          <SectionHead title="Also eligible" count={run.other_eligible.length}>These also meet every must-have. Try-on previews are limited to the top three.</SectionHead>
          <div className="grid gap-4 md:grid-cols-2">{run.other_eligible.map(compact)}</div>
        </section>
      )}
      {view === "cards" && !!run.needs_information?.length && (
        <section id="needs-info" className="scroll-mt-20">
          <SectionHead title="Missing information" count={run.needs_information.length}>The listing doesn&apos;t say enough to confirm a must-have, so ProofPick won&apos;t guess or recommend these.</SectionHead>
          <div className="grid gap-4 md:grid-cols-2">{run.needs_information.map(compact)}</div>
        </section>
      )}
      {view === "cards" && !!run.excluded?.length && (
        <section id="excluded" className="scroll-mt-20">
          <details id="excluded-details" className="group rounded-2xl border border-line bg-card shadow-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 transition hover:bg-sand/60 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="text-xl font-semibold tracking-tight text-ink">Ruled out <span className="text-muted">({run.excluded.length})</span></span>
                <span className="block text-sm text-muted">Evidence shows these conflict with a must-have.</span>
              </span>
              <IconChevronDown className="size-5 flex-none text-muted transition duration-300 group-open:rotate-180" />
            </summary>
            <div className="grid gap-4 border-t border-line p-5 md:grid-cols-2 sm:p-6">
              {run.excluded.map(compact)}
            </div>
          </details>
        </section>
      )}
      <EvidencePanel content={panel} onClose={close} />
    </main>
  );
}
