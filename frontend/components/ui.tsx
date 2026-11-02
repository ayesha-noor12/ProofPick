import type { PreviewStatus, ProductStatus } from "@/lib/api";

type IconProps = { className?: string };
const svg = (path: React.ReactNode) => function Icon({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {path}
    </svg>
  );
};

export const IconCheck = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconX = svg(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const IconQuestion = svg(<><path d="M9.3 9a2.8 2.8 0 015.4 1c0 1.9-2.7 2.4-2.7 4" /><path d="M12 18h.01" /></>);
export const IconAlert = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>);
export const IconInfo = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></>);
export const IconArrowRight = svg(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconArrowLeft = svg(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IconChevronDown = svg(<path d="M6 9l6 6 6-6" />);
export const IconCamera = svg(<><path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IconSparkle = svg(<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />);
export const IconTrash = svg(<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />);
export const IconMic = svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" /></>);
export const IconUpload = svg(<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15" />);
export const IconHistory = svg(<><path d="M3.5 12a8.5 8.5 0 103-6.5L3.5 8" /><path d="M3.5 3.5V8H8M12 8v4.5l3 2" /></>);
export const IconRefresh = svg(<path d="M19.5 12a7.5 7.5 0 01-13 5.1M4.5 12a7.5 7.5 0 0113-5.1M17.5 3v4h-4M6.5 21v-4h4" />);
export const IconEdit = svg(<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 8.5l3 3" />);
export const IconLink = svg(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>);
export const IconTag = svg(<><path d="M3.5 12.5V5a1.5 1.5 0 011.5-1.5h7.5l8 8-9 9z" /><circle cx="8" cy="8" r="1.4" /></>);
export const IconEye = svg(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconFlask = svg(<path d="M9.5 3.5h5M10 3.5v6L4.8 18a1.8 1.8 0 001.6 2.5h11.2a1.8 1.8 0 001.6-2.5L14 9.5v-6M7 15h10" />);
export const IconExternal = svg(<path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" />);
export const IconShield = svg(<><path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" /><path d="M9 12l2 2 4-4" /></>);

const TONES = {
  ok: "bg-ok-bg text-ok ring-ok/20",
  bad: "bg-bad-bg text-bad ring-bad/20",
  warn: "bg-warn-bg text-warn ring-warn/25",
};
const TONE_ICONS = { ok: IconCheck, bad: IconX, warn: IconQuestion };

export function Pill({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      <Icon className="size-3" />{children}
    </span>
  );
}

export function CheckPill({ status }: { status: ProductStatus }) {
  if (status === "meets_documented_requirements") return <Pill tone="ok">Verified</Pill>;
  if (status === "conflicts_with_requirement") return <Pill tone="bad">Conflict</Pill>;
  return <Pill tone="warn">Unknown</Pill>;
}

export function PreviewPill({ status }: { status: PreviewStatus }) {
  if (status === "no_visible_mismatch_detected") return <Pill tone="ok">No visible difference</Pill>;
  if (status === "possible_mismatch") return <Pill tone="bad">Possible difference</Pill>;
  return <Pill tone="warn">Not assessable</Pill>;
}

type ButtonVariant = "primary" | "quiet" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

/** Shared button look, also used for links that act as buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  const look = {
    primary: "bg-ink text-white shadow-card hover:bg-black",
    quiet: "border border-line-strong bg-card text-ink shadow-card hover:border-ink/40 hover:bg-sand",
    ghost: "text-muted hover:bg-sand hover:text-ink",
  }[variant];
  const scale = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" }[size];
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 ${scale} ${look}`;
}

export function Button({ variant = "primary", size = "md", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function Spinner({ className = "size-4" }: IconProps) {
  return <span aria-hidden="true" className={`inline-block flex-none animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

/** Small uppercase label above a heading. */
export function Eyebrow({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.12em] text-brand ${className}`}>{children}</p>;
}

/** Numbered progress steps. Earlier steps show a check. */
export function Steps({ steps, current, decorative = false }: { steps: string[]; current: number; decorative?: boolean }) {
  return (
    <ol aria-hidden={decorative || undefined} className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} aria-current={now ? "step" : undefined} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className={`h-px w-6 sm:w-10 ${done || now ? "bg-ink" : "bg-line-strong"}`} />}
            <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold transition ${done ? "bg-ink text-white" : now ? "bg-brand text-white ring-4 ring-brand/15" : "bg-sand text-muted ring-1 ring-line"}`}>
              {done ? <IconCheck className="size-3.5" /> : i + 1}
            </span>
            <span className={now ? "font-medium text-ink" : "hidden text-muted sm:inline"}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

const NOTICE_TONES = {
  warn: { look: "border-warn/25 bg-warn-bg text-warn", Icon: IconAlert },
  info: { look: "border-line bg-card text-ink", Icon: IconInfo },
};

export function Notice({ tone = "warn", className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { tone?: keyof typeof NOTICE_TONES }) {
  const { look, Icon } = NOTICE_TONES[tone];
  return (
    <p className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${look} ${className}`} {...props}>
      <Icon className="mt-0.5 size-4 flex-none" /><span>{children}</span>
    </p>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-bad/25 bg-bad-bg px-3.5 py-3 text-sm text-bad">
      <IconAlert className="mt-0.5 size-4 flex-none" /><span>{children}</span>
    </p>
  );
}
