import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

const body = Inter({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const label = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-label", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "ProofPick",
  description: "Find it. Check it. Try it on. Clothing recommendations that come with evidence.",
};

function Logo() {
  return (
    <Link href="/" aria-label="ProofPick home" className="flex items-center gap-2 rounded-lg">
      <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-ink text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span className="hidden text-[17px] font-semibold tracking-tight text-ink min-[420px]:inline">ProofPick</span>
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${body.variable} ${label.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <header className="sticky top-0 z-10 border-b border-line bg-paper/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Logo />
            <Nav />
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="mt-24 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted sm:px-6">
            <p><span className="font-medium text-ink">ProofPick</span> · Clothing recommendations that come with evidence.</p>
            <p>Demo catalog · fictional products and prices</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
