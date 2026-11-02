import type { Requirements, Scope } from "./api";

/** The request in progress, kept in this browser so Back, refresh and "Edit" never lose it. */
export type Draft = {
  text: string;
  requirements: Requirements | null;
  parser: "model" | "rules" | null;
  notes: string[];
  photoId: string | null;
  scope: Scope;
};

const KEY = "proofpick:draft";
export const EMPTY_DRAFT: Draft = { text: "", requirements: null, parser: null, notes: [], photoId: null, scope: "real" };

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY_DRAFT, ...JSON.parse(raw) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable (private mode); the form still works, it just isn't remembered.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See saveDraft.
  }
}
