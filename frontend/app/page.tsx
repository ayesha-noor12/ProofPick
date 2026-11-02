"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PhotoPicker } from "@/components/PhotoPicker";
import { RequirementEditor } from "@/components/RequirementEditor";
import { Button, ErrorNote, Eyebrow, IconArrowRight, IconMic, IconShield, IconSparkle, Notice, Spinner, Steps } from "@/components/ui";
import { api, AppConfig, Scope } from "@/lib/api";
import { clearDraft, Draft, EMPTY_DRAFT, loadDraft, saveDraft } from "@/lib/draft";

const EXAMPLE = "I need a long-sleeved, high-neck top under $60, without polyester. Something suitable for work.";
const STEPS = ["Describe", "Confirm", "Compare"];
const SCOPES: [Scope, string][] = [["real", "Real listings"], ["demo", "Demo catalog"], ["all", "Both"]];
// Example requests, each shown with a demo garment illustration from our own catalog (no retailer images).
const IDEAS = [
  { text: "A short-sleeved crew-neck tee under $30 for casual days", image: "top_011.png", tint: "bg-[#efece6]" },
  { text: "Three-quarter sleeves and a boat neck, under $50, polished for work", image: "top_013.png", tint: "bg-[#e9eef3]" },
  { text: "A high-neck top up to $60 in black or forest, no polyester", image: "top_002.png", tint: "bg-[#ece9ef]" },
];

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };

/** Dictation through the browser's speech recognition, where available (Chrome, Edge, Safari). */
function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const ref = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  function toggle() {
    if (listening) return ref.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(""));
    rec.onend = () => setListening(false);
    ref.current = rec;
    rec.start();
    setListening(true);
  }
  return { listening, supported, toggle };
}

export default function RequestPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLElement>(null);
  const { text, requirements, parser, notes, photoId, scope } = draft;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dictation = useDictation((spoken) => update({ text: spoken }));

  useEffect(() => {
    setDraft(loadDraft());
    setLoaded(true);
    api.config().then(setConfig).catch(() => setError("The ProofPick service could not be reached. Is the backend running on port 8000?"));
  }, []);
  useEffect(() => {
    if (loaded) saveDraft(draft);
  }, [draft, loaded]);

  async function readRequest() {
    setBusy(true);
    setError(null);
    try {
      const parsed = await api.parse(text);
      update({ requirements: parsed.requirements, notes: parsed.notes, parser: parsed.parser });
      setRevision((r) => r + 1);
      setTimeout(() => confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!requirements) return;
    setBusy(true);
    setError(null);
    try {
      const { run_id } = await api.start(text, requirements, photoId, config?.real_garments ? scope : "demo");
      router.push(`/runs/${run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function startOver() {
    clearDraft();
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mx-auto max-w-3xl animate-rise text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted shadow-card">
          <IconShield className="size-3.5 text-brand" />Every claim linked to its source
        </span>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink sm:text-6xl">
          Find it. Check it. <span className="whitespace-nowrap text-brand">Try it on.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
          Tell ProofPick what a top has to be, and it shows which products the listing evidence actually supports, what it can&apos;t confirm, and how the best picks look on you.
        </p>
        <div className="mt-8 flex justify-center"><Steps steps={STEPS} current={requirements ? 1 : 0} /></div>
      </section>

      <section className="mx-auto mt-10 max-w-3xl animate-rise [animation-delay:80ms]">
        <div className="rounded-2xl border border-line bg-card p-2 shadow-lift transition focus-within:border-brand/50 focus-within:ring-4 focus-within:ring-brand/10">
          <label htmlFor="request" className="sr-only">Describe what you need</label>
          <textarea id="request" rows={3} value={text} placeholder={EXAMPLE}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void readRequest(); }}
            className="block w-full resize-none border-0 bg-transparent px-4 py-3 text-lg leading-relaxed text-ink outline-none placeholder:text-muted/60" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2">
            <div className="flex items-center gap-1">
              {dictation.supported && (
                <Button variant="ghost" size="sm" onClick={dictation.toggle} aria-pressed={dictation.listening}
                  className={dictation.listening ? "bg-bad-bg text-bad hover:bg-bad-bg hover:text-bad" : ""}>
                  <IconMic className={`size-4 ${dictation.listening ? "animate-pulse" : ""}`} />{dictation.listening ? "Listening… tap to stop" : "Speak"}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => update({ text: EXAMPLE })}>Use the example</Button>
              {(text || requirements) && <Button variant="ghost" size="sm" onClick={startOver}>Start over</Button>}
            </div>
            <Button disabled={!text.trim() || busy} onClick={readRequest}>
              {busy && !requirements ? <><Spinner />Reading…</> : <>{requirements ? "Read again" : "Read my request"}<IconArrowRight /></>}
            </Button>
          </div>
        </div>
        <p className="mt-6 text-center text-xs font-semibold uppercase tracking-[0.12em] text-muted">Try an example</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {IDEAS.map((idea) => (
            <button key={idea.text} onClick={() => update({ text: idea.text })} aria-label={`Use example: ${idea.text}`}
              className={`group flex items-center gap-3 overflow-hidden rounded-2xl p-2 pr-3 text-left ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lift hover:ring-ink/20 sm:flex-col sm:items-stretch sm:p-0 sm:pr-0 ${idea.tint}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/catalog-images/${idea.image}`} alt="" className="size-16 flex-none rounded-xl bg-white/60 object-contain p-1.5 sm:h-28 sm:w-full sm:rounded-none sm:bg-transparent sm:p-3" />
              <span className="text-[13px] leading-snug text-ink sm:px-3.5 sm:pb-3.5">&ldquo;{idea.text}&rdquo;</span>
            </button>
          ))}
        </div>
        {error && <div className="mt-6"><ErrorNote>{error}</ErrorNote></div>}
      </section>

      {requirements && (
        <section ref={confirmRef} className="mt-16 scroll-mt-20 animate-rise space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Eyebrow>Step 2 · Confirm</Eyebrow>
              <h2 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight text-ink">
                Is this right?
                {parser === "model" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                    <IconSparkle className="size-3.5" />Read by AI
                  </span>
                )}
              </h2>
              <p className="mt-1.5 text-sm text-muted">Edit anything below. Nothing is searched until you confirm. Your answers are saved as you go.</p>
            </div>
          </div>
          {notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
          {config && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-5 py-3.5 shadow-card">
              <span className="text-sm font-medium text-ink">Search in</span>
              <div role="radiogroup" aria-label="Which products to search" className="flex flex-wrap gap-1.5">
                {SCOPES.map(([value, label]) => {
                  const off = value !== "demo" && !config.real_garments;
                  const on = (config.real_garments ? scope : "demo") === value;
                  return (
                    <button key={value} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => update({ scope: value })}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-ink text-white" : "bg-sand text-ink hover:bg-line"}`}>
                      {label}{value === "real" && ` (${config.real_garments})`}{value === "demo" && ` (${config.catalog_size - config.real_garments})`}
                    </button>
                  );
                })}
              </div>
              {!config.real_garments && <span className="text-xs text-muted">No real listings yet. Add them in Catalog or backend/data/catalog_real.json.</span>}
            </div>
          )}
          <RequirementEditor key={revision} value={requirements} onChange={(r) => update({ requirements: r })} />
          <PhotoPicker config={config} photoId={photoId} onChange={(id) => update({ photoId: id })} />
          {config && !config.youcam_configured && (
            <Notice tone="warn">Try-on is not configured on this server, so previews will show as unavailable.</Notice>
          )}
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-card p-3 pl-5 shadow-card">
            <p className="hidden text-sm text-muted sm:block">
              {photoId ? "We'll check the catalog and make try-on previews for your top 3." : "We'll check every product in the catalog against your must-haves."}
            </p>
            <Button size="lg" className="w-full sm:w-auto" disabled={busy} onClick={search}>
              {busy ? <><Spinner />Starting…</> : <>Confirm and find tops<IconArrowRight /></>}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
