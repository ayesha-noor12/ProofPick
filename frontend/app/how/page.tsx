import Link from "next/link";
import { buttonClass, Eyebrow, IconArrowRight, IconCamera, IconCheck, IconEdit, IconShield, IconSparkle, IconX } from "@/components/ui";

const STEPS = [
  { Icon: IconEdit, title: "Describe", text: "Type or speak what you need. AI turns it into editable must-haves (budget, sleeves, neckline, materials to avoid) and nice-to-haves. Nothing is searched until you confirm." },
  { Icon: IconShield, title: "Check", text: "Deterministic rules compare each must-have with the product's own evidence: the price, the composition text, the description. Each one is supported, a conflict, or unknown. Unknown never counts as a pass." },
  { Icon: IconSparkle, title: "Rank", text: "AI orders only the eligible tops by your nice-to-haves and explains each placement. It can't change eligibility, and any product or evidence it invents is rejected." },
  { Icon: IconCamera, title: "Try on", text: "Your top three picks are sent to the YouCam virtual try-on with your photo." },
  { Icon: IconCheck, title: "Inspect", text: "AI compares each try-on with the original garment, feature by feature, and flags previews that changed the neckline, sleeves or pattern, so a misleading image can't sell you the wrong thing." },
];

const NOT_CLAIMED = ["Physical fit or sizing", "Comfort or opacity in real light", "Exact color on your screen", "Anything about your body or appearance"];

export default function HowPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <Eyebrow>How it works</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">Recommendations you can verify.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Shopping assistants often say a product &ldquo;matches&rdquo; when the listing never mentions it. ProofPick separates evidence from opinion: every must-have links to the exact text it came from, and missing information is shown as missing.
      </p>

      <ol className="mt-12 space-y-4">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex gap-4 rounded-2xl border border-line bg-card p-5 shadow-card">
            <span className="grid size-10 flex-none place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
            <div>
              <h2 className="font-semibold text-ink"><span className="text-muted">{i + 1}.</span> {title}</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-line bg-card p-5 shadow-card">
          <h2 className="font-semibold text-ink">Two systems, kept apart</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Product checks and try-on inspection never influence each other. A bad preview can&apos;t make a suitable top look unsuitable, and a good preview can&apos;t make an unsuitable one look suitable.
          </p>
        </section>
        <section className="rounded-2xl border border-line bg-card p-5 shadow-card">
          <h2 className="font-semibold text-ink">What ProofPick doesn&apos;t claim</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {NOT_CLAIMED.map((n) => <li key={n} className="flex items-center gap-2"><IconX className="size-3.5 text-bad" />{n}</li>)}
          </ul>
        </section>
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link href="/" className={buttonClass("primary", "lg")}>Try it now<IconArrowRight /></Link>
        <Link href="/history" className={buttonClass("quiet", "lg")}>My searches</Link>
      </div>
    </main>
  );
}
