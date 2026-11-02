export type Requirements = {
  product: "top";
  max_price_usd: number | null;
  price_inclusive: boolean;
  sleeves: string | null;
  neckline: string | null;
  excluded_materials: string[];
  preferences: string[];
  preferred_colors: string[];
  colors_required?: boolean;
};

export type SourceType = "listing_text" | "care_label_photo" | "size_chart" | "seller_title" | "owner_inspection" | "demo";

export const SOURCE_LABELS: Record<SourceType, string> = {
  listing_text: "Listing text",
  care_label_photo: "Care-label photo",
  size_chart: "Size chart",
  seller_title: "Seller title",
  owner_inspection: "Owner inspection",
  demo: "Demo data",
};

export type Evidence = {
  id: string;
  field: string;
  kind: "text" | "image";
  source: string;
  source_type: SourceType;
  source_url: string | null;
  quote: string | null;
  image_url: string | null;
  collected_at: string;
};

export type Check = {
  requirement: string;
  status: ProductStatus;
  observed: string;
  method: string;
  action: string;
  explanation: string;
  reason: string;
  evidence: Evidence[];
};

export type ProductStatus = "meets_documented_requirements" | "conflicts_with_requirement" | "insufficient_evidence";
export type PreviewStatus = "no_visible_mismatch_detected" | "possible_mismatch" | "not_assessable";

export type FeatureStatus = "consistent" | "possible_difference" | "not_assessable";
export type Feature = { feature: string; status: FeatureStatus | "altered" | "hidden" | "unclear"; why_not_assessable?: string | null; observation: string };

/** Maps inspections saved before the three-status scheme onto it. */
export function featureStatus(f: Feature): { status: FeatureStatus; why: string | null } {
  if (f.status === "altered") return { status: "possible_difference", why: null };
  if (f.status === "hidden") return { status: "not_assessable", why: "hidden_by_pose_or_cropping" };
  if (f.status === "unclear") return { status: "not_assessable", why: "image_too_unclear" };
  return { status: f.status, why: f.why_not_assessable ?? null };
}

export type Preview = {
  id: string;
  attempt: number;
  status: "pending" | "running" | "inspecting" | "done" | "failed" | "skipped";
  error: string | null;
  /** 0 live; 1 pre-generated example for the sample model; 2 pre-generated example shown because live try-on was unavailable. */
  cached: 0 | 1 | 2;
  image_url: string | null;
  inspection: { status: PreviewStatus; features: Feature[]; summary: string; method: string } | null;
};

export type Card = {
  product_id: string;
  name: string;
  brand: string;
  variant: string;
  color: string;
  price: number;
  currency: string;
  description: string;
  image_url: string;
  data_label: string;
  collected_at: string;
  is_demo: boolean;
  is_owned: boolean;
  retailer_name: string | null;
  product_url: string | null;
  tags: string[];
  status: ProductStatus;
  checks: Check[];
  explanation: string | null;
  previews: Preview[];
  preferences: PreferenceMatch[];
  why: string[];
  documented: Evidence[];
};

export type PreferenceMatch = { preference: string; kind: "style" | "color"; status: "matched" | "different" | "not_documented"; source: string };

export type Run = {
  run_id: string;
  state: "queued" | "checking" | "ranking" | "previewing" | "complete" | "failed";
  error: string | null;
  requirements: Requirements;
  original_text: string;
  has_photo: boolean;
  photo_id: string | null;
  scope: Scope;
  ranking_method?: "model" | "rules";
  recommendations?: Card[];
  needs_information?: Card[];
  excluded?: Card[];
  other_eligible?: Card[];
  no_match?: {
    message: string;
    blockers: { requirement: string; conflicts: number; unknown: number; would_unlock: number }[];
  } | null;
  preview_notice?: string | null;
  retries_remaining?: number;
};

export type RunSummary = {
  run_id: string;
  state: Run["state"];
  original_text: string;
  requirements: Requirements;
  created_at: string;
  has_photo: boolean;
  matches: number;
  top_images: string[];
};

export type Scope = "all" | "real" | "demo";

export type Garment = {
  product_id: string;
  name: string;
  color: string;
  price: number;
  description: string;
  image_url: string;
  collected_at: string;
  tags: string[];
  evidence: Evidence[];
};

export type AppConfig = {
  youcam_configured: boolean;
  model_configured: boolean;
  sample_photo_available: boolean;
  catalog_size: number;
  real_garments: number;
  privacy: { providers: string[]; retention: string };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : "The request could not be completed.";
    throw new Error(detail);
  }
  return response.json();
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  config: () => request<AppConfig>("/api/config"),
  parse: (text: string) =>
    request<{ requirements: Requirements; parser: "model" | "rules"; notes: string[] }>("/api/requirements/parse", json({ text })),
  uploadPhoto: (form: FormData) => request<{ photo_id: string; is_sample: boolean }>("/api/photos", { method: "POST", body: form }),
  start: (original_text: string, requirements: Requirements, photo_id: string | null, scope: Scope = "all") =>
    request<{ run_id: string }>("/api/recommendations", json({ original_text, requirements, photo_id, scope })),
  tryOn: (id: string, product_id: string) => request(`/api/runs/${id}/try-on`, json({ product_id })),
  garments: () => request<{ garments: Garment[]; editable: boolean; demo_count: number }>("/api/garments", { cache: "no-store" }),
  addGarment: (form: FormData) => request<{ garment: Garment; notes: string[] }>("/api/garments", { method: "POST", body: form }),
  readLabel: (form: FormData) => request<{ composition: string | null; problem: string | null }>("/api/garments/read-label", { method: "POST", body: form }),
  deleteGarment: (id: string) => request(`/api/garments/${id}`, { method: "DELETE" }),
  run: (id: string) => request<Run>(`/api/runs/${id}`, { cache: "no-store" }),
  runs: () => request<{ runs: RunSummary[] }>("/api/runs", { cache: "no-store" }),
  retry: (id: string, product_id: string) => request(`/api/runs/${id}/retry-preview`, json({ product_id })),
  reinspect: (id: string, product_id: string) => request(`/api/runs/${id}/reinspect`, json({ product_id })),
  session: () => request<{ session_id: string }>("/api/session"),
  deleteSession: (id: string) => request<{ note: string }>(`/api/sessions/${id}`, { method: "DELETE" }),
};

/** The label every pre-generated example carries, so it is never mistaken for a live try-on. */
export function exampleLabel(p: Preview): string | null {
  if (p.cached === 1) return "Pre-generated example: a real try-on made earlier with the sample model.";
  if (p.cached === 2) return `Pre-generated example with the sample model, not your photo. ${p.error ?? "Live try-on is unavailable."}`;
  return null;
}

export const SLEEVE_LABELS: Record<string, string> = {
  long: "Long",
  three_quarter: "Three-quarter",
  short: "Short",
  sleeveless: "Sleeveless",
};

export const NECKLINE_LABELS: Record<string, string> = {
  high: "High",
  crew: "Crew",
  v_neck: "V-neck",
  scoop: "Scoop",
  boat: "Boat",
  collared: "Collared",
};

export function requirementLabel(requirement: string): string {
  if (requirement === "budget") return "Budget";
  if (requirement === "sleeves") return "Sleeves";
  if (requirement === "neckline") return "Neckline";
  if (requirement === "availability") return "Availability";
  if (requirement === "color") return "Color";
  if (requirement.startsWith("exclude_")) return `No ${requirement.slice(8).replaceAll("_", " ")}`;
  return requirement;
}

/** The requirements with one failing requirement removed, for "search again without it". Null if it cannot be relaxed. */
export function relaxed(req: Requirements, requirement: string): Requirements | null {
  if (requirement === "budget") return { ...req, max_price_usd: null };
  if (requirement === "sleeves") return { ...req, sleeves: null };
  if (requirement === "neckline") return { ...req, neckline: null };
  if (requirement === "color") return { ...req, colors_required: false };
  if (requirement.startsWith("exclude_")) {
    const material = requirement.slice(8).replaceAll("_", " ");
    return { ...req, excluded_materials: req.excluded_materials.filter((m) => m !== material) };
  }
  return null;
}

/** One-line summary of requirements, e.g. "Under $60 · Long sleeves · No polyester". */
export function summarize(req: Requirements): string[] {
  const parts: string[] = [];
  if (req.max_price_usd !== null) parts.push(`${req.price_inclusive ? "Up to" : "Under"} $${req.max_price_usd}`);
  if (req.sleeves) parts.push(req.sleeves === "sleeveless" ? "Sleeveless" : `${SLEEVE_LABELS[req.sleeves] ?? req.sleeves} sleeves`);
  if (req.neckline) parts.push(`${NECKLINE_LABELS[req.neckline] ?? req.neckline} neck`);
  for (const m of req.excluded_materials) parts.push(`No ${m}`);
  if (req.colors_required && req.preferred_colors.length) parts.push(`Only ${req.preferred_colors.join(" or ")}`);
  return parts;
}

export const METHOD_LABELS: Record<string, string> = {
  price_comparison: "Exact price comparison",
  material_rule: "Material rule applied to composition text",
  source_text_rule: "Rule applied to the product text",
  visual_assessment: "AI-assisted reading of the product photo",
  exact_lookup: "Exact lookup in the product record",
};
