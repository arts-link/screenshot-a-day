import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type PublicationTarget } from "./api";
import {
  AccentRule,
  Button,
  Empty,
  ErrorNotice,
  Eyebrow,
  Field,
  Spinner,
  Status,
} from "./components";
import {
  publicationJobInFlight,
  publicationTargetActionLabel,
  publicationTargetStatus,
  publicationVerificationStatus,
  type PublicationVerificationFeedback,
} from "./publication-status";
import { PUBLICATION_PHASES, usePublicationElapsed } from "./publication-progress";

function TargetCard({
  target,
  onEdit,
  onChanged,
  onError,
}: {
  target: PublicationTarget;
  onEdit: () => void;
  onChanged: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [action, setAction] = useState<"verify" | "publish">();
  const [publishStartedAt, setPublishStartedAt] = useState<number>();
  const [verificationFeedback, setVerificationFeedback] =
    useState<PublicationVerificationFeedback>();
  const run = async (name: typeof action, work: () => Promise<unknown>) => {
    setAction(name);
    if (name === "publish") setPublishStartedAt(Date.now());
    if (name === "verify") setVerificationFeedback(undefined);
    onError(undefined);
    try {
      await work();
      await onChanged();
      if (name === "verify")
        setVerificationFeedback({ ok: true, checkedAt: new Date().toISOString() });
    } catch (error) {
      if (name === "verify") {
        setVerificationFeedback({
          ok: false,
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "Connection verification failed",
        });
        await onChanged().catch(() => undefined);
      } else onError(error);
    } finally {
      setAction(undefined);
    }
  };
  const status = publicationTargetStatus(target);
  const publishing = action === "publish" || status.busy;
  const busy = Boolean(action || status.busy);
  const verification = publicationVerificationStatus(
    target,
    action === "verify",
    verificationFeedback,
  );
  const elapsed = usePublicationElapsed(
    target.latestJob && publicationJobInFlight(target.latestJob)
      ? target.latestJob.createdAt
      : publishStartedAt,
    publishing,
  );
  const activePhase =
    status.busy && PUBLICATION_PHASES.includes(status.phase as (typeof PUBLICATION_PHASES)[number])
      ? PUBLICATION_PHASES.indexOf(status.phase as (typeof PUBLICATION_PHASES)[number])
      : 0;
  return (
    <article className="target-card" aria-busy={publishing}>
      <div className="target-card-identity">
        <strong>{target.name}</strong>
        <span>
          {target.adapter} · {target.projectCount} project{target.projectCount === 1 ? "" : "s"} ·{" "}
          {status.label}
        </span>
      </div>
      <div className="target-card-destination">
        <a className="target-card-url" href={target.baseUrl} target="_blank" rel="noreferrer">
          {target.baseUrl} ↗
        </a>
        <span className="target-card-schedule">
          {target.scheduleMode}
          {target.nextRunAt ? ` · next ${new Date(target.nextRunAt).toLocaleString()}` : ""}
        </span>
        {target.latestJob?.status === "succeeded" && !publishing && (
          <span className="target-card-published">
            Last published {new Date(target.latestJob.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className="target-card-actions">
        <Button
          variant="secondary"
          disabled={busy}
          aria-busy={action === "verify"}
          onClick={() => void run("verify", () => api.verifyPublicationTarget(target.id))}
        >
          {action === "verify" && <Spinner />}
          {action === "verify"
            ? "Checking…"
            : target.lastVerifiedAt
              ? "Check again"
              : "Verify destination"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          aria-busy={publishing}
          onClick={() => void run("publish", () => api.publishTarget(target.id))}
        >
          {publishing && <Spinner />}
          {publicationTargetActionLabel(action === "publish", status)}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
      </div>
      {verification && (
        <div
          className={`target-verification-result ${verification.phase}`}
          role={verification.phase === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="target-verification-mark" aria-hidden="true">
            {verification.phase === "checking" ? (
              <Spinner />
            ) : verification.phase === "verified" ? (
              "✓"
            ) : (
              "!"
            )}
          </span>
          <span>
            <strong>{verification.headline}</strong>
            <small>
              {verification.detail}
              {verification.checkedAt
                ? ` Checked ${new Date(verification.checkedAt).toLocaleString()}.`
                : " This result will remain here when the check finishes."}
            </small>
          </span>
        </div>
      )}
      {publishing && (
        <div className="target-publication-progress" role="status" aria-live="polite">
          <div className="target-publication-progress-head">
            <span>
              <Spinner />
              <strong>{action === "publish" ? "Queueing publication" : status.headline}</strong>
            </span>
            <span>{elapsed}</span>
          </div>
          <div className="target-publication-steps" aria-label="Publication progress">
            {PUBLICATION_PHASES.map((phase, index) => (
              <span
                key={phase}
                className={index < activePhase ? "complete" : index === activePhase ? "active" : ""}
              >
                {phase}
              </span>
            ))}
          </div>
          <p>
            {action === "publish" ? "Sending this publication to the queue." : status.detail}{" "}
            <strong>You can leave this page; progress is saved.</strong>
          </p>
        </div>
      )}
      {!publishing && status.phase === "failed" && (
        <div className="target-publication-result failed" role="alert">
          <strong>{status.headline}</strong>
          <span>{status.detail} Review the destination or retry the publication.</span>
        </div>
      )}
      {!publishing && status.phase === "changes" && (
        <div className="target-publication-result">
          <strong>{status.headline}</strong>
          <span>
            {status.detail}{" "}
            {target.scheduleMode === "manual"
              ? "Publish when you are ready."
              : target.scheduleMode === "on_change"
                ? "It will publish automatically after changes settle."
                : "It will publish at the next scheduled run."}
          </span>
        </div>
      )}
    </article>
  );
}

function TargetPanel({
  open,
  target,
  creating,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  target: PublicationTarget | undefined;
  creating: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (targetId?: string, close?: boolean) => Promise<void>;
}) {
  const [adapter, setAdapter] = useState<"vercel" | "netlify" | "sftp">(
    target?.adapter ?? "vercel",
  );
  const [credentialKind, setCredentialKind] = useState<"password" | "private_key">("password");
  const [scheduleMode, setScheduleMode] = useState(target?.scheduleMode ?? "manual");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const history = useQuery({
    queryKey: ["publication-history", target?.id],
    queryFn: () => api.publicationHistory(target!.id),
    enabled: Boolean(target && historyOpen),
  });
  const config = (name: string, fallback = "") => String(target?.adapterConfig[name] ?? fallback);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const targetConfig =
      adapter === "vercel"
        ? { projectId: value("projectId"), teamId: value("teamId") || null }
        : adapter === "netlify"
          ? { siteId: value("siteId") }
          : {
              host: value("host"),
              port: Number(value("port") || 22),
              root: value("root"),
              username: value("username"),
              hostKeySha256: value("hostKeySha256"),
            };
    const branding = {
      title: value("title"),
      description: value("description"),
      logoText: target?.branding.logoText ?? null,
      logoUrl: target?.branding.logoUrl ?? null,
      tagline: value("tagline"),
      accentColor: value("accentColor") || "#dbff53",
      backgroundColor: value("backgroundColor") || "#10151d",
      darkMode: target?.branding.darkMode ?? true,
      supplementalFooter: value("supplementalFooter"),
      analytics: target?.branding.analytics ?? ({ provider: "none" } as const),
    };
    const shared = {
      name: value("name"),
      baseUrl: value("baseUrl"),
      scheduleMode,
      scheduleExpression: scheduleMode === "custom" ? value("scheduleExpression") || null : null,
      scheduleTimezone: value("scheduleTimezone") || "UTC",
      branding,
    };
    setBusy(true);
    setError(undefined);
    try {
      if (target) {
        await api.updatePublicationTarget(target.id, {
          ...shared,
          target: { adapter, config: targetConfig },
        });
        const credential = value("credential");
        if (credential) {
          await api.replacePublicationTargetCredentials(
            target.id,
            adapter === "sftp"
              ? credentialKind === "password"
                ? { kind: "password", password: credential }
                : {
                    kind: "private_key",
                    privateKey: credential,
                    passphrase: value("passphrase") || null,
                  }
              : { token: credential },
          );
        }
        await onChanged(undefined, true);
      } else {
        const credential = value("credential");
        const created = await api.createPublicationTarget({
          ...shared,
          target: {
            adapter,
            config: targetConfig,
            credentials:
              adapter === "sftp"
                ? credentialKind === "password"
                  ? { kind: "password", password: credential }
                  : {
                      kind: "private_key",
                      privateKey: credential,
                      passphrase: value("passphrase") || null,
                    }
                : { token: credential },
          },
        });
        try {
          await api.verifyPublicationTarget(created.id);
          await onChanged(undefined, true);
        } catch (verificationError) {
          await onChanged(created.id, false);
          setError(
            new Error(
              `Target saved, but verification failed: ${
                verificationError instanceof Error
                  ? verificationError.message
                  : "connection verification failed"
              }`,
            ),
          );
        }
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const scheduled = ["hourly", "daily", "weekly", "custom"].includes(scheduleMode);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="target-panel">
          <header className="target-panel-head">
            <div>
              <Eyebrow tone="muted">Static publishing</Eyebrow>
              <Dialog.Title>
                {creating ? "Add a target" : `Edit ${target?.name ?? "target"}`}
              </Dialog.Title>
              <Dialog.Description>
                {creating
                  ? "Connect a destination, then Screenshot-a-Day will verify it before closing."
                  : "Update connection, site presentation, and publication cadence."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Close target editor">
                ×
              </button>
            </Dialog.Close>
          </header>
          <ErrorNotice
            error={
              error ??
              (target?.lastVerificationError
                ? new Error(`Connection verification failed: ${target.lastVerificationError}`)
                : undefined)
            }
          />
          <form className="target-panel-form" onSubmit={submit}>
            <fieldset className="target-form-section">
              <legend>Destination</legend>
              <p>Give this connection a recognizable name and choose where the site is deployed.</p>
              <div className="target-form-grid two">
                <Field label="Target name">
                  <input
                    name="name"
                    defaultValue={target?.name}
                    required
                    placeholder="Public galleries"
                  />
                </Field>
                <Field label="Provider">
                  <select
                    name="adapter"
                    value={adapter}
                    disabled={!creating}
                    onChange={(event) =>
                      setAdapter(event.target.value as "vercel" | "netlify" | "sftp")
                    }
                  >
                    <option value="vercel">Vercel</option>
                    <option value="netlify">Netlify</option>
                    <option value="sftp">SFTP</option>
                  </select>
                </Field>
                <Field
                  label="Canonical base URL"
                  hint="Use the public origin only, without a path or trailing slash."
                >
                  <input
                    name="baseUrl"
                    type="url"
                    defaultValue={target?.baseUrl}
                    required
                    placeholder="https://history.example.com"
                  />
                </Field>
                {adapter === "vercel" && (
                  <>
                    <Field label="Existing project ID or name">
                      <input name="projectId" defaultValue={config("projectId")} required />
                    </Field>
                    <Field label="Team ID" hint="Optional for personal Vercel projects.">
                      <input name="teamId" defaultValue={config("teamId")} />
                    </Field>
                  </>
                )}
                {adapter === "netlify" && (
                  <Field label="Existing site ID">
                    <input name="siteId" defaultValue={config("siteId")} required />
                  </Field>
                )}
                {adapter === "sftp" && (
                  <>
                    <Field label="Host">
                      <input name="host" defaultValue={config("host")} required />
                    </Field>
                    <Field label="Port">
                      <input
                        name="port"
                        type="number"
                        defaultValue={config("port", "22")}
                        required
                      />
                    </Field>
                    <Field label="Dedicated root">
                      <input
                        name="root"
                        defaultValue={config("root")}
                        required
                        placeholder="/srv/www/history"
                      />
                    </Field>
                    <Field label="Username">
                      <input name="username" defaultValue={config("username")} required />
                    </Field>
                    <Field label="Host key SHA-256">
                      <input
                        name="hostKeySha256"
                        defaultValue={config("hostKeySha256")}
                        required
                        placeholder="SHA256:…"
                      />
                    </Field>
                    <Field label="Authentication">
                      <select
                        value={credentialKind}
                        onChange={(event) =>
                          setCredentialKind(event.target.value as "password" | "private_key")
                        }
                      >
                        <option value="password">Password</option>
                        <option value="private_key">Private key</option>
                      </select>
                    </Field>
                  </>
                )}
                <Field
                  label={
                    adapter === "sftp" && credentialKind === "private_key"
                      ? "Private key"
                      : adapter === "sftp"
                        ? "Password"
                        : "Scoped access token"
                  }
                  hint={
                    target
                      ? "Leave blank to keep the encrypted credential already on file."
                      : "Encrypted at rest and never returned after save."
                  }
                >
                  {adapter === "sftp" && credentialKind === "private_key" ? (
                    <textarea name="credential" rows={5} required={!target} />
                  ) : (
                    <input
                      name="credential"
                      type="password"
                      required={!target}
                      autoComplete="new-password"
                    />
                  )}
                </Field>
                {adapter === "sftp" && credentialKind === "private_key" && (
                  <Field label="Private-key passphrase" hint="Optional">
                    <input name="passphrase" type="password" autoComplete="new-password" />
                  </Field>
                )}
              </div>
            </fieldset>
            <fieldset className="target-form-section">
              <legend>Site identity</legend>
              <p>These details appear on the generated gallery site.</p>
              <div className="target-form-grid">
                <Field label="Site title">
                  <input
                    name="title"
                    defaultValue={target?.branding.title}
                    required
                    placeholder="Visual history"
                  />
                </Field>
                <Field label="Description">
                  <input
                    name="description"
                    defaultValue={target?.branding.description}
                    placeholder="A record of our sites"
                  />
                </Field>
                <Field label="Tagline">
                  <input
                    name="tagline"
                    defaultValue={target?.branding.tagline}
                    placeholder="Captured over time"
                  />
                </Field>
              </div>
            </fieldset>
            <fieldset className="target-form-section">
              <legend>Publishing schedule</legend>
              <p>Publish manually, after changes, or on a recurring schedule.</p>
              <div className="target-form-grid two">
                <Field label="Cadence">
                  <select
                    name="scheduleMode"
                    value={scheduleMode}
                    onChange={(event) =>
                      setScheduleMode(event.target.value as PublicationTarget["scheduleMode"])
                    }
                  >
                    <option value="manual">Manual</option>
                    <option value="on_change">On change</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom cron</option>
                  </select>
                </Field>
                {scheduled && (
                  <Field label="IANA timezone">
                    <input
                      name="scheduleTimezone"
                      defaultValue={target?.scheduleTimezone ?? "UTC"}
                      required
                    />
                  </Field>
                )}
                {!scheduled && <input type="hidden" name="scheduleTimezone" value="UTC" />}
                {scheduleMode === "custom" && (
                  <Field label="Custom cron">
                    <input
                      name="scheduleExpression"
                      defaultValue={target?.scheduleExpression ?? ""}
                      required
                      placeholder="0 4 * * *"
                    />
                  </Field>
                )}
              </div>
            </fieldset>
            <details className="target-advanced">
              <summary>Appearance and footer</summary>
              <div className="target-form-grid two">
                <Field label="Accent color">
                  <input
                    name="accentColor"
                    defaultValue={target?.branding.accentColor ?? "#dbff53"}
                    pattern="#[0-9A-Fa-f]{6}"
                  />
                </Field>
                <Field label="Background color">
                  <input
                    name="backgroundColor"
                    defaultValue={target?.branding.backgroundColor ?? "#10151d"}
                    pattern="#[0-9A-Fa-f]{6}"
                  />
                </Field>
                <Field label="Supplemental footer">
                  <input
                    name="supplementalFooter"
                    defaultValue={target?.branding.supplementalFooter}
                    placeholder="Your organization"
                  />
                </Field>
              </div>
              <p className="field-note">
                Arts-Link and Screenshot-a-Day source attribution appears on every generated page.
              </p>
            </details>
            {target && (
              <details
                className="target-advanced"
                onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
              >
                <summary>Recent deployment history</summary>
                <div className="publication-history">
                  {history.isLoading && <span>Loading history…</span>}
                  {history.data?.slice(0, 8).map((job) => (
                    <span key={job.id}>
                      <Status value={job.status} /> {job.operation} ·{" "}
                      {new Date(job.createdAt).toLocaleString()}
                      {job.error ? ` · ${job.error}` : ""}
                    </span>
                  ))}
                </div>
              </details>
            )}
            {target && (
              <div className="target-panel-danger">
                <div>
                  <strong>Delete target</strong>
                  <p>Targets with attached projects cannot be deleted.</p>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy || target.projectCount > 0}
                  title={target.projectCount ? "Detach every project first" : undefined}
                  onClick={() => {
                    if (!window.confirm(`Delete ${target.name}? This cannot be undone.`)) return;
                    setBusy(true);
                    api
                      .deletePublicationTarget(target.id)
                      .then(() => onChanged(undefined, true))
                      .catch(setError)
                      .finally(() => setBusy(false));
                  }}
                >
                  Delete target
                </Button>
              </div>
            )}
            <footer className="target-panel-actions">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy
                  ? creating
                    ? "Saving and verifying…"
                    : "Saving…"
                  : creating
                    ? "Create target"
                    : "Save target"}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PublicationSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<unknown>();
  const publicationStatus = useQuery({
    queryKey: ["publication-status"],
    queryFn: api.publicationStatus,
  });
  const publicationTargets = useQuery({
    queryKey: ["publication-targets"],
    queryFn: api.publicationTargets,
    refetchInterval: (query) =>
      query.state.data?.some((target) => publicationJobInFlight(target.latestJob)) ? 1500 : 5000,
  });
  const editor = searchParams.get("target");
  const creating = editor === "new";
  const selectedTarget = publicationTargets.data?.find((target) => target.id === editor);
  const setEditor = (value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("target", value);
    else next.delete("target");
    setSearchParams(next, { replace: true });
  };
  const changed = async (targetId?: string, close = false) => {
    await publicationTargets.refetch();
    if (close) setEditor();
    else if (targetId) setEditor(targetId);
  };
  return (
    <section className="card publication-settings-card">
      <div className="publication-settings-head">
        <div>
          <AccentRule />
          <h2>Publication targets</h2>
          <p>
            Manage destinations for portable static galleries. The home server only makes outbound
            connections.
          </p>
        </div>
        <Button onClick={() => setEditor("new")}>Add target →</Button>
      </div>
      <ErrorNotice error={error ?? publicationTargets.error} />
      {publicationStatus.data && !publicationStatus.data.available && (
        <ErrorNotice
          error={new Error(publicationStatus.data.error ?? "Static renderer unavailable")}
        />
      )}
      {publicationTargets.data?.length ? (
        <div className="target-list">
          {publicationTargets.data.map((target) => (
            <TargetCard
              key={target.id}
              target={target}
              onEdit={() => setEditor(target.id)}
              onChanged={() => publicationTargets.refetch()}
              onError={setError}
            />
          ))}
        </div>
      ) : (
        !publicationTargets.isLoading && (
          <Empty title="No publication targets">
            Add a Vercel, Netlify, or SFTP destination to publish portable galleries.
          </Empty>
        )
      )}
      <TargetPanel
        key={editor ?? "closed"}
        open={Boolean(editor && (creating || selectedTarget))}
        target={selectedTarget}
        creating={creating}
        onOpenChange={(open) => {
          if (!open) setEditor();
        }}
        onChanged={changed}
      />
    </section>
  );
}
