import { Card, Evidence, SOURCE_LABELS, SourceType } from "@/lib/api";
import { IconEye, IconExternal, IconFlask, IconLink, IconTag } from "./ui";

const ICONS: Record<SourceType, typeof IconLink> = {
  listing_text: IconLink, seller_title: IconLink, size_chart: IconLink,
  care_label_photo: IconTag, owner_inspection: IconEye, demo: IconFlask,
};

/** A small icon for where a fact came from. */
export function SourceIcon({ type, className = "size-3" }: { type: SourceType; className?: string }) {
  const Icon = ICONS[type] ?? IconLink;
  return <span title={SOURCE_LABELS[type]} aria-label={SOURCE_LABELS[type]} className="inline-flex"><Icon className={className} /></span>;
}

export function DemoBadge() {
  return <span className="inline-flex items-center gap-1 rounded-md bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn ring-1 ring-warn/25"><IconFlask className="size-3" />Demo data</span>;
}

/** "View listing on {retailer}" for real listings, a DEMO DATA badge for demo products, nothing for owned garments. */
export function ListingLink({ card, evidence }: { card: Card; evidence?: Evidence }) {
  if (card.is_demo) return <DemoBadge />;
  const url = evidence?.source_url || card.product_url;
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
      View listing on {card.retailer_name ?? "the retailer"}<IconExternal className="size-3.5" />
    </a>
  );
}
