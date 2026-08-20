import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { clsx } from "clsx";

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button className={clsx("button", `button-${variant}`, className)} {...props}>
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
export function Empty({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="empty">
      <div className="empty-orbit" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const good = ["succeeded", "ready", "active", "published"].includes(value);
  const bad = value === "failed" || value === "removal_failed";
  return (
    <span className={clsx("status", good ? "status-good" : bad ? "status-bad" : "status-wait")}>
      {good ? (
        <CheckCircle2 size={13} />
      ) : bad ? (
        <AlertTriangle size={13} />
      ) : (
        <LoaderCircle size={13} />
      )}{" "}
      {value}
    </span>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div className="error-notice" role="alert">
      <AlertTriangle size={18} />
      {error instanceof Error ? error.message : "Something went wrong"}
    </div>
  ) : null;
}
