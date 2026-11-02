"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Search", match: (p: string) => p === "/" },
  { href: "/history", label: "My searches", match: (p: string) => p.startsWith("/history") || p.startsWith("/runs") },
  { href: "/garments", label: "Catalog", match: (p: string) => p.startsWith("/garments") },
  { href: "/how", label: "How it works", match: (p: string) => p.startsWith("/how") },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
      {LINKS.map(({ href, label, match }) => {
        const active = match(path);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium transition sm:px-3 sm:text-sm ${active ? "bg-sand text-ink" : "text-muted hover:bg-sand hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
