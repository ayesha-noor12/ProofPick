"use client";

import { useState } from "react";
import { Card, Check, PreferenceMatch, requirementLabel } from "@/lib/api";
import { DemoBadge, SourceIcon } from "./SourceBadge";
import { IconCheck, IconQuestion, IconX } from "./ui";

const CELL = {
  meets_documented_requirements: { text: "Verified", look: "bg-ok-bg text-ok", Icon: IconCheck },
  conflicts_with_requirement: { text: "Conflict", look: "bg-bad-bg text-bad", Icon: IconX },
  insufficient_evidence: { text: "Unknown", look: "bg-warn-bg text-warn", Icon: IconQuestion },
};
const PREF = {
  matched: { text: "Matches", look: "bg-ok-bg text-ok", Icon: IconCheck },
  different: { text: "Different", look: "bg-sand text-muted", Icon: IconX },
  not_documented: { text: "Not documented", look: "bg-warn-bg text-warn", Icon: IconQuestion },
};
const SHORTLIST = 4;

export type MatrixColumn = { card: Card; group: string };

/** Must-haves and preferences as rows, shortlisted products as columns. Must-have cells open their source evidence. */
export function EvidenceMatrix({ columns, onOpen }: { columns: MatrixColumn[]; onOpen: (card: Card, check: Check) => void }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? columns : columns.slice(0, SHORTLIST);
  const musts = [...new Set(shown.flatMap(({ card }) => card.checks.map((c) => c.requirement)))];
  const prefs = [...new Set(shown.flatMap(({ card }) => card.preferences.map((p) => p.preference)))];
  if (!shown.length) return <p className="text-sm text-muted">There are no products to compare.</p>;

  const head = (label: string) => (
    <tr className="bg-sand/60">
      <th colSpan={shown.length + 1} scope="colgroup" className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</th>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-[1] min-w-36 bg-card px-4 py-3 text-left align-bottom text-xs font-semibold text-muted">Requirement</th>
              {shown.map(({ card, group }) => (
                <th key={card.product_id} scope="col" className="w-48 px-3 py-3 text-left align-bottom font-normal">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.image_url} alt="" className="mb-2 size-14 rounded-lg bg-sand object-contain p-1" />
                  <span className="block max-w-44 truncate font-semibold text-ink" title={card.name}>{card.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">${card.price.toFixed(2)} {card.is_demo && <DemoBadge />}</span>
                  <span className="block text-xs font-medium text-muted">{group}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {musts.length > 0 && head("Must-haves")}
            {musts.map((req) => (
              <tr key={req} className="border-b border-line">
                <th scope="row" className="sticky left-0 z-[1] bg-card px-4 py-2.5 text-left font-medium text-ink">{requirementLabel(req)}</th>
                {shown.map(({ card }) => {
                  const check = card.checks.find((c) => c.requirement === req);
                  if (!check) return <td key={card.product_id} className="px-3 py-2.5 text-xs text-muted">Not checked</td>;
                  const { text, look, Icon } = CELL[check.status];
                  const source = check.evidence[0];
                  return (
                    <td key={card.product_id} className="px-2 py-1.5 align-top">
                      <button onClick={() => onOpen(card, check)} title={check.reason} className="w-full rounded-lg p-1.5 text-left transition hover:bg-sand">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${look}`}><Icon className="size-3" />{text}</span>
                        <span className="mt-1 flex max-w-44 items-center gap-1 truncate text-[11px] text-muted">
                          {source ? <><SourceIcon type={source.source_type} />{source.collected_at}</> : "No source"}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {prefs.length > 0 && head("Preferences (order only)")}
            {prefs.map((pref) => (
              <tr key={pref} className="border-b border-line last:border-0">
                <th scope="row" className="sticky left-0 z-[1] bg-card px-4 py-2.5 text-left font-medium capitalize text-ink">{pref}</th>
                {shown.map(({ card }) => {
                  const match: PreferenceMatch | undefined = card.preferences.find((p) => p.preference === pref);
                  if (!match) return <td key={card.product_id} />;
                  const { text, look, Icon } = PREF[match.status];
                  return (
                    <td key={card.product_id} className="px-3.5 py-2.5 align-top" title={match.source}>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${look}`}><Icon className="size-3" />{text}</span>
                      <span className="mt-1 block max-w-44 truncate text-[11px] text-muted">{match.source}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {columns.length > SHORTLIST && (
        <button onClick={() => setShowAll((v) => !v)} className="text-sm font-medium text-brand hover:underline">
          {showAll ? `Show the shortlist only` : `Show all ${columns.length} products`}
        </button>
      )}
    </div>
  );
}
