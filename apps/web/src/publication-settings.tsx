import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Globe2, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type PublicationTarget } from "./api";
import { Button, Empty, ErrorNotice, Field, Status } from "./components";
import { publicationJobInFlight } from "./publication-status";

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
  const run = async (name: typeof action, work: () => Promise<unknown>) => {
    setAction(name);
    onError(undefined);
    try {
      await work();
      await onChanged();
    } catch (error) {
      onError(error);
    } finally {
      setAction(undefined);
    }
  };
  const busy = Boolean(action || publicationJobInFlight(target.latestJob));
  return (
    <article className="target-card">
      <div className="target-card-identity">
        <strong>{target.name}</strong>
        <span>
          {target.adapter} · {target.projectCount} project{target.projectCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="target-card-status">
        <Status value={target.state} />
        {target.lastVerificationError && (
          <span className="warning-copy">Connection needs attention</span>
        )}
      </div>
      <a className="target-card-url" href={target.baseUrl} target="_blank" rel="noreferrer">
        {target.baseUrl}
      </a>
      <span className="target-card-schedule">
        {target.scheduleMode}
        {target.nextRunAt ? ` · ${new Date(target.nextRunAt).toLocaleString()}` : ""}
      </span>
      <div className="target-card-actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run("verify", () => api.verifyPublicationTarget(target.id))}
        >
          {action === "verify" && <LoaderCircle className="spin" size={15} />}
          Verify
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run("publish", () => api.publishTarget(target.id))}
        >
          {action === "publish" && <LoaderCircle className="spin" size={15} />}
          Publish now
        </Button>
        <Button variant="secondary" disabled={Boolean(action)} onClick={onEdit}>
          <Pencil size={15} />
          Edit
        </Button>
      </div>
      {action && (
        <span className="target-action-status" role="status" aria-live="polite">
          {action === "verify" ? "Checking destination connection…" : "Queueing publication…"}
        </span>
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
              <p className="eyebrow">Static publishing</p>
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
                <X />
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
                  <Trash2 size={15} />
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
                {busy && <LoaderCircle className="spin" size={16} />}
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
          <Globe2 />
          <h2>Static publication targets</h2>
          <p>
            Manage destinations for portable static galleries. The home server only makes outbound
            connections.
          </p>
        </div>
        <Button onClick={() => setEditor("new")}>
          <Plus size={17} />
          Add target
        </Button>
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
