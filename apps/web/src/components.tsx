import { clsx } from "clsx";
import type { PropsWithChildren, ReactNode } from "react";

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button className={clsx("button", `button-${variant}`, `button-${size}`, className)} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={clsx("card", className)}>{children}</section>;
}

export function Eyebrow({
  children,
  tone = "accent",
  wide = true,
  className,
}: PropsWithChildren<{
  tone?: "accent" | "muted" | "faint";
  wide?: boolean;
  className?: string;
}>) {
  return (
    <p className={clsx("eyebrow", `eyebrow-${tone}`, !wide && "eyebrow-narrow", className)}>
      {children}
    </p>
  );
}

export function AccentRule({ className }: { className?: string }) {
  return <span className={clsx("accent-rule", className)} aria-hidden="true" />;
}

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "accent" | "solid" | "neutral" }>) {
  return <span className={clsx("badge", `badge-${tone}`)}>{children}</span>;
}

export function Grain() {
  return <div className="grain" aria-hidden="true" />;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Empty({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="empty">
      <AccentRule />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const accent = ["succeeded", "ready", "active", "published"].includes(value);
  return <Badge tone={accent ? "accent" : "neutral"}>{value.replaceAll("_", " ")}</Badge>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div className="error-notice" role="alert">
      <span aria-hidden="true">×</span>
      {error instanceof Error ? error.message : "Something went wrong"}
    </div>
  ) : null;
}
