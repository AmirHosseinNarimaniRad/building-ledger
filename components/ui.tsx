import type { ComponentProps, ReactNode } from "react";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

export const buttonStyles = {
  primary: `${buttonBase} bg-primary text-background hover:opacity-90`,
  secondary: `${buttonBase} bg-neutral text-ink hover:opacity-80`,
  danger: `${buttonBase} bg-danger text-background hover:opacity-90`,
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export const inputStyles =
  "w-full rounded-xl border border-ink/15 bg-background px-3 py-2.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 aria-invalid:border-danger";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label font-semibold">{label}</span>
      {children}
      {error ? (
        <span className="text-small text-danger">{error}</span>
      ) : hint ? (
        <span className="text-small text-ink/60">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ invalid, className = "", ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={`${inputStyles} ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-2xl border border-ink/10 bg-background p-4 ${className}`} {...props} />;
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="text-title font-bold">{children}</h1>
      {action}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "good"; children: ReactNode }) {
  const color = tone === "danger" ? "border-danger/30 text-danger" : "border-good/30 text-good";
  return <div className={`rounded-xl border px-3 py-2 text-label ${color}`}>{children}</div>;
}

/** Wrap numbers inside Persian text so they stay where they belong in RTL lines. */
export function Num({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="num">
      {children}
    </span>
  );
}
