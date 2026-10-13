import type { ReactNode } from "react";
import type { DocState } from "@/lib/ledger";

const TONES = {
  good: "bg-good/15 text-good",
  warn: "bg-warn/15 text-warn",
  neutral: "bg-neutral text-ink/70",
  primary: "bg-primary/15 text-primary",
  danger: "bg-danger/15 text-danger",
};

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-small font-medium ${TONES[tone]}`}>{children}</span>;
}

/** The document label residents see too: green, yellow, or grey with the reason. */
export function DocBadge({ state }: { state: DocState }) {
  if (state === "documented") return <Badge tone="good">مستند</Badge>;
  if (state === "pending_doc") return <Badge tone="warn">سند بعداً می‌آید</Badge>;
  return <Badge tone="neutral">بدون سند</Badge>;
}
