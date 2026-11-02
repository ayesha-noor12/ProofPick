"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass, ErrorNote, Eyebrow, IconArrowRight, IconCamera, IconHistory, Spinner } from "@/components/ui";
import { api, RunSummary, summarize } from "@/lib/api";

const STATE_TEXT: Record<string, string> = { complete: "Done", failed: "Failed" };

function when(stamp: string) {
  return new Date(stamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs().then((r) => setRuns(r.runs)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <Eyebrow>Your session</Eyebrow>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">My searches</h1>
        <Link href="/" className={buttonClass("primary")}>New search<IconArrowRight /></Link>
      </div>
      <p className="mt-2 text-muted">Every search in this browser session. Open one to get back to its results and previews.</p>

      <div className="mt-8 space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!runs && !error && <p className="flex items-center gap-2 text-muted" role="status"><Spinner className="size-4 text-brand" />Loading…</p>}
        {runs?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
            <IconHistory className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-medium text-ink">No searches yet</p>
            <p className="mt-1 text-sm text-muted">Your searches will appear here so you can come back to them.</p>
          </div>
        )}
        {runs?.map((r) => (
          <Link key={r.run_id} href={`/runs/${r.run_id}`}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 shadow-card transition hover:border-ink/30 hover:shadow-lift">
            <div className="flex flex-none -space-x-3">
              {(r.top_images.length ? r.top_images : [null]).slice(0, 3).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                src ? <img key={i} src={src} alt="" className="size-14 rounded-xl bg-sand object-contain p-1 ring-2 ring-card" />
                  : <span key={i} className="grid size-14 place-items-center rounded-xl bg-sand text-xs text-muted ring-2 ring-card">—</span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{r.original_text || summarize(r.requirements).join(" · ") || "Untitled search"}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <span>{when(r.created_at)}</span>
                <span>·</span>
                <span>{STATE_TEXT[r.state] ? `${r.matches} match${r.matches === 1 ? "" : "es"}` : "In progress"}</span>
                {r.has_photo && <><span>·</span><span className="inline-flex items-center gap-1"><IconCamera className="size-3.5" />Try-on</span></>}
                {r.state === "failed" && <><span>·</span><span className="text-bad">Failed</span></>}
              </p>
            </div>
            <IconArrowRight className="size-4 flex-none text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
          </Link>
        ))}
      </div>
    </main>
  );
}
