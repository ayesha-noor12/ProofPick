"use client";

import { useEffect, useState } from "react";
import { normalize } from "@/components/PhotoPicker";
import { Button, ErrorNote, Eyebrow, IconCamera, IconCheck, IconTrash, Notice, Spinner } from "@/components/ui";
import { api, Garment, NECKLINE_LABELS, SLEEVE_LABELS } from "@/lib/api";

const box = "mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-sm text-ink shadow-card focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10";
const label = "block text-sm font-medium text-ink";
const EMPTY = { name: "", color: "", price: "", sleeves: "", neckline: "", composition: "", description: "", tags: "" };

function Choice({ value, options, onChange, name }: { value: string; options: Record<string, string>; onChange: (v: string) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="mt-2 flex flex-wrap gap-1.5">
      {[["", "Not recorded"], ...Object.entries(options)].map(([k, v]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${value === k ? "bg-ink text-white" : "bg-sand text-ink hover:bg-line"}`}>
          {v}
        </button>
      ))}
    </div>
  );
}

function PhotoField({ title, hint, file, onFile }: { title: string; hint: string; file: File | null; onFile: (f: File | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <label className="flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-line-strong p-3 transition hover:border-ink/30">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="size-20 flex-none rounded-lg object-cover" />
        : <span className="grid size-20 flex-none place-items-center rounded-lg bg-sand text-muted"><IconCamera className="size-6" /></span>}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-[13px] text-muted">{file ? file.name : hint}</span>
      </span>
      <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

export default function GarmentsPage() {
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [editable, setEditable] = useState(true);
  const [demoCount, setDemoCount] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [labelPhoto, setLabelPhoto] = useState<File | null>(null);
  const [labelText, setLabelText] = useState("");
  const [labelConfirmed, setLabelConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [labelProblem, setLabelProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  async function load() {
    try {
      const r = await api.garments();
      setGarments(r.garments);
      setEditable(r.editable);
      setDemoCount(r.demo_count);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { void load(); }, []);

  function chooseLabel(file: File | null) {
    setLabelPhoto(file);
    setLabelText("");
    setLabelConfirmed(false);
    setLabelProblem(null);
  }

  async function readLabel() {
    if (!labelPhoto) return;
    setReading(true);
    setLabelProblem(null);
    try {
      const data = new FormData();
      data.set("label", await normalize(labelPhoto), "label.jpg");
      const r = await api.readLabel(data);
      setLabelText(r.composition ?? "");
      setLabelProblem(r.problem);
    } catch (e) {
      setLabelProblem((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) return setError("Add a photo of the garment.");
    if (labelPhoto && labelText.trim() && !labelConfirmed) return setError("Confirm the care-label text matches the label, or clear it.");
    setBusy(true);
    setError(null);
    setNotes([]);
    setAdded(null);
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => data.set(k, v));
      data.set("garment", await normalize(photo), "garment.jpg");
      if (labelPhoto && labelConfirmed && labelText.trim()) {
        data.set("label", await normalize(labelPhoto), "label.jpg");
        data.set("label_composition", labelText.trim());
      }
      const r = await api.addGarment(data);
      setNotes(r.notes);
      setAdded(r.garment.name);
      setForm(EMPTY);
      setPhoto(null);
      chooseLabel(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Garment) {
    if (!window.confirm(`Remove "${g.name}" from the catalog?`)) return;
    try {
      await api.deleteGarment(g.product_id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <Eyebrow>Catalog</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Real garments</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Photograph tops you own, flat and front-facing, plus their care label. The label is read by AI into composition evidence with the source
        &ldquo;Care label photo&rdquo;. Searches can then use only these garments. The demo catalog has {demoCount} fictional products alongside.
      </p>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-5">
        {editable ? (
          <form onSubmit={submit} className="space-y-5 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6 lg:col-span-2">
            <h2 className="font-semibold text-ink">Add a garment</h2>
            <div className="space-y-3">
              <PhotoField title="Garment photo (required)" hint="Flat, front-facing, one garment" file={photo} onFile={setPhoto} />
              <PhotoField title="Care label photo" hint="Close-up of the fabric composition" file={labelPhoto} onFile={chooseLabel} />
              {labelPhoto && (
                <div className="space-y-2 rounded-xl bg-sand p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">Care label says</span>
                    <Button type="button" variant="quiet" size="sm" disabled={reading} onClick={readLabel}>
                      {reading ? <><Spinner />Reading…</> : labelText ? "Read again" : "Read the label with AI"}
                    </Button>
                  </div>
                  <input aria-label="Care label composition" className={box} value={labelText} maxLength={140}
                    placeholder="e.g. 60% cotton, 40% polyester" onChange={(e) => { setLabelText(e.target.value); setLabelConfirmed(false); }} />
                  {labelProblem && <p className="text-[13px] text-warn">{labelProblem} You can type it from the label instead.</p>}
                  {labelText.trim() && (
                    <label className="flex items-start gap-2 text-[13px] text-ink">
                      <input type="checkbox" className="mt-0.5 size-4" checked={labelConfirmed} onChange={(e) => setLabelConfirmed(e.target.checked)} />
                      I checked this against the label. Save it as care-label evidence.
                    </label>
                  )}
                  <p className="text-[11px] text-muted">AI text is a suggestion. Nothing is saved as evidence until you confirm it.</p>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={label} htmlFor="g-name">Name</label><input id="g-name" required className={box} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Navy ribbed turtleneck" /></div>
              <div><label className={label} htmlFor="g-color">Color</label><input id="g-color" required className={box} value={form.color} onChange={(e) => set({ color: e.target.value })} placeholder="navy" /></div>
              <div><label className={label} htmlFor="g-price">Reference price (USD)</label><input id="g-price" required type="number" min="0" step="0.01" className={box} value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="35" /></div>
            </div>
            <div><span className={label}>Sleeves</span><Choice name="Sleeves" value={form.sleeves} options={SLEEVE_LABELS} onChange={(v) => set({ sleeves: v })} /></div>
            <div><span className={label}>Neckline</span><Choice name="Neckline" value={form.neckline} options={NECKLINE_LABELS} onChange={(v) => set({ neckline: v })} /></div>
            <div>
              <label className={label} htmlFor="g-comp">Composition typed by hand <span className="font-normal text-muted">optional, kept as a second source</span></label>
              <input id="g-comp" className={box} value={form.composition} onChange={(e) => set({ composition: e.target.value })} placeholder="95% cotton, 5% elastane" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={label} htmlFor="g-tags">Style tags</label><input id="g-tags" className={box} value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="work, casual" /></div>
              <div><label className={label} htmlFor="g-desc">Short description</label><input id="g-desc" className={box} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Fine rib knit" /></div>
            </div>
            <p className="text-xs text-muted">Leave a field as &ldquo;Not recorded&rdquo; to test how ProofPick handles missing information. Never enter fit, stock or exact color claims.</p>
            {error && <ErrorNote>{error}</ErrorNote>}
            {added && <Notice tone="info">Added &ldquo;{added}&rdquo;.</Notice>}
            {notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? <><Spinner />Reading the label and saving…</> : "Add to catalog"}</Button>
          </form>
        ) : (
          <Notice tone="info" className="lg:col-span-2">Adding garments is turned off on this server.</Notice>
        )}

        <section className="space-y-4 lg:col-span-3">
          <h2 className="font-semibold text-ink">In the catalog <span className="font-normal text-muted">({garments?.length ?? 0})</span></h2>
          {!garments && <p className="flex items-center gap-2 text-muted"><Spinner className="size-4 text-brand" />Loading…</p>}
          {garments?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
              No real garments yet. Add 4–6 tops, including one with no care label and one blend, to show every outcome.
            </div>
          )}
          {garments?.map((g) => (
            <article key={g.product_id} className="flex gap-4 rounded-2xl border border-line bg-card p-4 shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.image_url} alt={g.name} className="size-24 flex-none rounded-xl bg-sand object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{g.name}</h3>
                    <p className="text-[13px] capitalize text-muted">{g.color} · ${g.price.toFixed(2)} reference · added {g.collected_at}</p>
                  </div>
                  {editable && <Button variant="ghost" size="sm" onClick={() => remove(g)} aria-label={`Remove ${g.name}`}><IconTrash /></Button>}
                </div>
                <ul className="mt-2 space-y-1">
                  {g.evidence.filter((e) => e.field !== "price").map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-[13px]">
                      <IconCheck className="mt-0.5 size-3.5 flex-none text-ok" />
                      <span><span className="capitalize text-ink">{e.field}:</span> <span className="text-ink">{e.quote}</span> <span className="text-muted">· {e.source}</span></span>
                    </li>
                  ))}
                  {!g.evidence.some((e) => e.field === "composition") && <li className="text-[13px] text-warn">Composition: not recorded</li>}
                </ul>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
