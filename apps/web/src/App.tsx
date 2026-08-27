import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { CaptureProfileInput, CaptureRecord } from "@sad/contracts";
import { api, type Comparison } from "./api";
import { activeCaptureRun, captureActionDetail, captureActionLabel } from "./capture-action";
import {
  AccentRule,
  Badge,
  Button,
  Card,
  Empty,
  ErrorNotice,
  Eyebrow,
  Field,
  Grain,
  Spinner,
  Status,
} from "./components";
import { publicationInFlight, publicationStatus } from "./publication-status";
import { PublicationSettings } from "./publication-settings";

const ARTS_LINK_URL = "https://www.arts-link.com/";

function ArtsLinkCredit() {
  return (
    <a
      className="arts-link-credit"
      href={ARTS_LINK_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="arts-link (opens in a new tab)"
    >
      arts-link
    </a>
  );
}

function Shell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const version = useQuery({ queryKey: ["version"], queryFn: api.version });
  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand-lockup">
          <Link to="/" className="brand">
            Screenshot-a-Day
          </Link>
          <span className="header-divider" aria-hidden="true" />
          <ArtsLinkCredit />
        </div>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end>
            Projects
          </NavLink>
          <a href="/docs/api" target="_blank">
            API
          </a>
          <NavLink to="/settings">Settings</NavLink>
          <a href="https://github.com/arts-link/screenshot-a-day" target="_blank" rel="noreferrer">
            Source ↗
          </a>
          <span className="header-divider" aria-hidden="true" />
          <span>v{version.data?.version ?? "0.1.0"}</span>
          <button
            className="sign-out"
            onClick={() =>
              api.logout().then(() => {
                queryClient.clear();
                navigate("/login");
              })
            }
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="workspace">
        <Outlet />
      </main>
    </div>
  );
}

function RequireAuth() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const location = useLocation();
  if (me.isLoading) return <Splash />;
  return me.data ? <Shell /> : <Navigate to="/login" state={{ from: location }} replace />;
}

function Splash() {
  return (
    <div className="splash">
      <AccentRule />
      <p>Bringing the past into focus…</p>
    </div>
  );
}

function AuthPage({ setup = false }: { setup?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      if (setup)
        await api.setup({
          token: String(data.get("token")),
          email: String(data.get("email")),
          password: String(data.get("password")),
        });
      else
        await api.login({
          email: String(data.get("email")),
          password: String(data.get("password")),
        });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <div className="auth-page">
      <Card className="auth-card">
        <AccentRule />
        <Eyebrow tone="muted">Screenshot-a-Day</Eyebrow>
        <h1>{setup ? "Set the first frame" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Use the one-time token printed by the API container to establish the administrator."
            : "Sign in to see how your sites have changed."}
        </p>
        <ErrorNotice error={error} />
        <form onSubmit={submit}>
          {setup && (
            <Field label="Setup token">
              <input name="token" required autoComplete="one-time-code" />
            </Field>
          )}
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" hint={setup ? "At least 12 characters" : undefined}>
            <input
              name="password"
              type="password"
              minLength={setup ? 12 : 1}
              required
              autoComplete={setup ? "new-password" : "current-password"}
            />
          </Field>
          <Button type="submit">{setup ? "Create administrator →" : "Sign in →"}</Button>
        </form>
        <div className="source-note">
          Open source under AGPL-3.0 ·
          <a href="https://github.com/arts-link/screenshot-a-day" target="_blank" rel="noreferrer">
            view source ↗
          </a>
        </div>
      </Card>
    </div>
  );
}

function Dashboard() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <header className="page-head">
        <div>
          <Eyebrow>Visual history</Eyebrow>
          <h1>Your projects</h1>
          <p>
            {projects.data?.length ? `${projects.data.length} sites` : "Sites"} under watch. Monitor
            the details that deployments and memory tend to blur.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New project →</Button>
      </header>
      <ErrorNotice error={projects.error} />
      {creating && <CreateProject onClose={() => setCreating(false)} />}
      {projects.data?.length ? (
        <div className="project-grid">
          {projects.data.map((project) => (
            <Link className="project-card" to={`/projects/${project.id}`} key={project.id}>
              <div className="project-top">
                <AccentRule />
                <Badge tone={project.publishMode === "indexable" ? "accent" : "neutral"}>
                  {project.publishMode}
                </Badge>
              </div>
              <h2>{project.name}</h2>
              <p>{project.url}</p>
              <div className="project-meta">
                {project.profileCount} profile{project.profileCount === 1 ? "" : "s"}
                <span aria-hidden="true">·</span>
                {project.latestCaptureAt
                  ? new Date(project.latestCaptureAt).toLocaleDateString()
                  : "No captures"}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        !projects.isLoading && (
          <Empty title="Nothing to compare yet">
            Create a project, run its first capture, and tomorrow will finally have a visual record.
          </Empty>
        )
      )}
    </>
  );
}

function CreateProject({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [browsers, setBrowsers] = useState(["chromium"]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name"));
    try {
      const project = await api.createProject({
        name,
        url: String(data.get("url")),
        slug: String(data.get("slug")),
        publishMode: "private",
        scheduleExpression: String(data.get("schedule")),
        scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        scheduleEnabled: false,
        retentionDays: null,
        retentionCount: null,
        headers: {},
        cookies: [],
        profiles: browsers.map((browser) => ({
          name: `${browser[0]!.toUpperCase()}${browser.slice(1)} desktop`,
          browser,
          enabled: true,
          deviceName: null,
          viewportWidth: 1440,
          viewportHeight: 900,
          deviceScaleFactor: 1,
          extent: "viewport",
          colorScheme: "light",
          locale: "en-US",
          timezone: "UTC",
          reducedMotion: "reduce",
          delayMs: 1000,
          waitForSelector: null,
          timeoutMs: 30000,
        })),
      });
      await client.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <Card className="modal">
        <div className="modal-title">
          <div>
            <Eyebrow tone="muted">New timeline</Eyebrow>
            <h2>Watch a website</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ErrorNotice error={error} />
        <form onSubmit={submit}>
          <div className="form-row">
            <Field label="Project name">
              <input
                name="name"
                required
                placeholder="Portfolio"
                onChange={(event) => {
                  const slug = event.currentTarget.form?.elements.namedItem(
                    "slug",
                  ) as HTMLInputElement;
                  if (slug && !slug.dataset.edited)
                    slug.value = event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "");
                }}
              />
            </Field>
            <Field label="Public slug">
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                onInput={(event) => (event.currentTarget.dataset.edited = "true")}
              />
            </Field>
          </div>
          <Field label="URL">
            <input name="url" type="url" required placeholder="https://example.com" />
          </Field>
          <Field label="Schedule" hint="Saved disabled until the first test succeeds">
            <select name="schedule" defaultValue="0 0 * * *">
              <option value="0 0 * * *">Every day</option>
              <option value="0 * * * *">Every hour</option>
              <option value="0 0 * * 1">Every week</option>
            </select>
          </Field>
          <fieldset>
            <legend>Browser profiles</legend>
            <div className="browser-options">
              {["chromium", "firefox", "webkit"].map((browser) => (
                <label key={browser}>
                  <input
                    type="checkbox"
                    checked={browsers.includes(browser)}
                    onChange={(event) =>
                      setBrowsers((current) =>
                        event.target.checked
                          ? [...current, browser]
                          : current.filter((item) => item !== browser),
                      )
                    }
                  />
                  <span>{browser}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="modal-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!browsers.length}>
              Create project →
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  phrase,
  busy,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  phrase?: string;
  busy: boolean;
  children: React.ReactNode;
  onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setConfirmation("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirm-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="confirm-copy">{children}</div>
          </Dialog.Description>
          {phrase && (
            <Field label={`Type “${phrase}” to confirm`}>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          )}
          <div className="modal-actions">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="danger"
              disabled={busy || Boolean(phrase && confirmation !== phrase)}
              onClick={onConfirm}
            >
              {busy && <Spinner />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.project(id),
    refetchInterval: (query) =>
      publicationInFlight(query.state.data?.staticPublication) ? 1500 : false,
  });
  const captures = useQuery({
    queryKey: ["captures", id],
    queryFn: () => api.captures(id),
    refetchInterval: 5000,
  });
  const runs = useQuery({
    queryKey: ["runs", id],
    queryFn: () => api.runs(id),
    refetchInterval: 1500,
  });
  const publicationTargets = useQuery({
    queryKey: ["publication-targets"],
    queryFn: api.publicationTargets,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<Comparison>();
  const [error, setError] = useState<unknown>();
  const [publicationAction, setPublicationAction] = useState<string>();
  const [detachDialog, setDetachDialog] = useState<"remote" | "force">();
  const [requestedRunId, setRequestedRunId] = useState<string>();
  const captureLock = useRef(false);
  const trigger = useMutation({
    mutationFn: (idempotencyKey: string) => api.trigger(id, idempotencyKey),
    onSuccess: async ({ runId }) => {
      setRequestedRunId(runId);
      await runs.refetch();
    },
    onError: (caught) => {
      captureLock.current = false;
      setError(caught);
    },
  });
  const requestedRun = runs.data?.find((run) => run.id === requestedRunId);
  const currentRun = requestedRun ?? activeCaptureRun(runs.data);
  const awaitingQueuedRun = Boolean(requestedRunId && !requestedRun);
  const captureBusy =
    trigger.isPending ||
    awaitingQueuedRun ||
    currentRun?.status === "queued" ||
    currentRun?.status === "running";
  const captureAcknowledging = Boolean(
    requestedRun && requestedRun.status !== "queued" && requestedRun.status !== "running",
  );
  const captureLabel = captureActionLabel(trigger.isPending || awaitingQueuedRun, currentRun);
  const captureDetail = captureActionDetail(trigger.isPending || awaitingQueuedRun, currentRun);

  useEffect(() => {
    if (!requestedRun || requestedRun.status === "queued" || requestedRun.status === "running")
      return;
    void client.invalidateQueries({ queryKey: ["captures", id] });
    void client.invalidateQueries({ queryKey: ["project", id] });
    const reset = window.setTimeout(() => {
      captureLock.current = false;
      setRequestedRunId(undefined);
    }, 4000);
    return () => window.clearTimeout(reset);
  }, [client, id, requestedRun]);

  const requestCapture = () => {
    if (captureLock.current || captureBusy) return;
    captureLock.current = true;
    setError(undefined);
    trigger.mutate(crypto.randomUUID());
  };
  const refreshPublication = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["project", id] }),
      client.invalidateQueries({ queryKey: ["publication-targets"] }),
    ]);
  };
  const runPublicationAction = async (name: string, action: () => Promise<unknown>) => {
    setError(undefined);
    setPublicationAction(name);
    try {
      await action();
      await refreshPublication();
      setDetachDialog(undefined);
    } catch (caught) {
      setError(caught);
    } finally {
      setPublicationAction(undefined);
    }
  };
  const grouped = useMemo(
    () =>
      project.data?.profiles.map((profile) => ({
        profile,
        captures: captures.data?.filter((capture) => capture.profileId === profile.id) ?? [],
      })) ?? [],
    [project.data, captures.data],
  );
  if (project.isLoading) return <Splash />;
  if (!project.data) return <ErrorNotice error={project.error} />;
  const p = project.data;
  const shareUrl =
    p.publishMode !== "private" && p.staticPublication?.active
      ? p.staticPublication.url
      : p.publishMode === "unlisted" && p.shareToken
        ? `${location.origin}/s/${p.shareToken}`
        : p.publishMode === "indexable"
          ? `${location.origin}/p/${p.slug}`
          : null;
  const staticStatus = p.staticPublication
    ? publicationStatus(p.staticPublication, p.publishMode)
    : null;
  const publicationBusy = Boolean(publicationAction || staticStatus?.busy);
  return (
    <>
      <header className="page-head project-header">
        <div>
          <Link to="/" className="back-link">
            ← All projects
          </Link>
          <Eyebrow>{p.publishMode} timeline</Eyebrow>
          <h1>{p.name}</h1>
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.url} ↗
          </a>
        </div>
        <div className="capture-action">
          <Button
            onClick={requestCapture}
            disabled={captureBusy || captureAcknowledging || runs.isLoading}
            aria-busy={captureBusy}
          >
            {captureBusy && <Spinner />}
            {runs.isLoading ? "Checking queue…" : `${captureLabel} →`}
          </Button>
          <span className="capture-action-status" role="status" aria-live="polite">
            {captureDetail ?? "Queues one batch across every enabled profile."}
          </span>
        </div>
      </header>
      <ErrorNotice error={error ?? captures.error ?? runs.error} />
      <div className="metric-row">
        <div className="metric">
          <span>Profiles</span>
          <strong>{p.profiles.length}</strong>
        </div>
        <div className="metric">
          <span>Captures</span>
          <strong>{captures.data?.length ?? 0}</strong>
        </div>
        <div className="metric">
          <span>Schedule</span>
          <strong>{p.scheduleEnabled ? "Active" : "Paused"}</strong>
        </div>
        <div className="metric">
          <span>Last change</span>
          <strong>
            {captures.data
              ?.find((capture) => capture.changePercent != null)
              ?.changePercent?.toFixed(2) ?? "—"}
            {captures.data?.some((capture) => capture.changePercent != null) ? "%" : ""}
          </strong>
        </div>
      </div>
      <Card className="publishing-card">
        <div className="publishing-card-head">
          <div className="publishing-title">
            <AccentRule />
            <div>
              <Eyebrow tone="muted">Visibility and delivery</Eyebrow>
              <h2>Publishing</h2>
            </div>
          </div>
          <div className="segmented" aria-label="Gallery visibility">
            {["private", "unlisted", "indexable"].map((mode) => (
              <button
                className={p.publishMode === mode ? "active" : ""}
                disabled={publicationBusy || p.publishMode === mode}
                key={mode}
                onClick={() =>
                  void runPublicationAction(`mode-${mode}`, () => api.publication(id, mode))
                }
              >
                {publicationAction === `mode-${mode}` && <Spinner />}
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div className="publishing-access">
          <span>Public access</span>
          {shareUrl ? (
            <a href={shareUrl} target="_blank" rel="noreferrer">
              {shareUrl} ↗
            </a>
          ) : (
            <strong>Administrator only</strong>
          )}
          {p.publishMode === "unlisted" && (
            <small>Anyone with this secret URL can view and share the gallery.</small>
          )}
        </div>
        <div className="publishing-destination">
          <div className="destination-head">
            <div>
              <span className="destination-label">Static destination</span>
              <h3>{p.staticPublication ? p.staticPublication.targetName : "No target attached"}</h3>
              {p.staticPublication && (
                <p>
                  {p.staticPublication.targetAdapter}
                  {p.staticPublication.lastPublishedAt
                    ? ` · deployed ${new Date(p.staticPublication.lastPublishedAt).toLocaleString()}`
                    : ""}
                </p>
              )}
            </div>
            {staticStatus && (
              <Badge tone={staticStatus.value === "active" ? "accent" : "neutral"}>
                {staticStatus.value === "active"
                  ? `Live on ${p.staticPublication?.targetName}`
                  : staticStatus.value.replaceAll("_", " ")}
              </Badge>
            )}
          </div>
          {p.staticPublication ? (
            <>
              <div className="publication-live-status" role="status" aria-live="polite">
                {staticStatus?.busy && <Spinner />}
                <span>
                  <strong>{staticStatus?.message}</strong>
                </span>
              </div>
              <a
                className="destination-url"
                href={p.staticPublication.url}
                target="_blank"
                rel="noreferrer"
              >
                {p.staticPublication.url} ↗
              </a>
              {p.staticPublication.lastError && (
                <ErrorNotice error={new Error(p.staticPublication.lastError)} />
              )}
              <div className="publishing-actions">
                <Button
                  variant="secondary"
                  disabled={publicationBusy || p.publishMode === "private"}
                  onClick={() =>
                    void runPublicationAction("publish", () =>
                      api.publishTarget(p.staticPublication!.targetId),
                    )
                  }
                >
                  {publicationAction === "publish" && <Spinner />}
                  Publish now →
                </Button>
                <Link
                  className="button button-secondary"
                  to={`/settings?target=${p.staticPublication.targetId}`}
                >
                  Manage target
                </Link>
                <Button
                  variant="danger"
                  disabled={publicationBusy}
                  onClick={() => setDetachDialog("remote")}
                >
                  {p.staticPublication.state === "removal_failed"
                    ? "Retry remote removal"
                    : "Remove and detach"}
                </Button>
              </div>
              <details className="publishing-danger">
                <summary>Danger zone</summary>
                <p>
                  Detach immediately without waiting for the destination to confirm that files were
                  removed.
                </p>
                <Button
                  variant="danger"
                  disabled={publicationBusy}
                  onClick={() => setDetachDialog("force")}
                >
                  Detach without remote cleanup
                </Button>
              </details>
            </>
          ) : publicationTargets.data?.length ? (
            <form
              className="attach-target-form"
              onSubmit={(event) => {
                event.preventDefault();
                const targetId = String(new FormData(event.currentTarget).get("targetId"));
                void runPublicationAction("attach", () =>
                  api.attachStaticPublication(id, targetId),
                );
              }}
            >
              <Field
                label="Static target"
                hint="Attaching starts the first synchronization immediately."
              >
                <select name="targetId" required>
                  {publicationTargets.data.map((target) => (
                    <option value={target.id} key={target.id}>
                      {target.name} · {target.adapter}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={publicationBusy}>
                {publicationAction === "attach" && <Spinner />}
                Attach and publish →
              </Button>
            </form>
          ) : (
            <div className="destination-empty">
              <p>Create a Vercel, Netlify, or SFTP target before publishing a portable site.</p>
              <Link className="button button-secondary" to="/settings?target=new">
                Add a target
              </Link>
            </div>
          )}
        </div>
      </Card>
      {p.staticPublication && (
        <>
          <ConfirmationDialog
            open={detachDialog === "remote"}
            onOpenChange={(open) => setDetachDialog(open ? "remote" : undefined)}
            title="Remove this static gallery?"
            confirmLabel={
              p.staticPublication.state === "removal_failed" ? "Retry removal" : "Remove and detach"
            }
            busy={publicationAction === "detach"}
            onConfirm={() =>
              void runPublicationAction("detach", () => api.detachStaticPublication(id))
            }
          >
            <p>
              Screenshot-a-Day will make <strong>{p.name}</strong> private, remove its files from{" "}
              <strong>{p.staticPublication.targetName}</strong>, and detach only after deployment
              succeeds.
            </p>
          </ConfirmationDialog>
          <ConfirmationDialog
            open={detachDialog === "force"}
            onOpenChange={(open) => setDetachDialog(open ? "force" : undefined)}
            title="Detach without remote cleanup?"
            confirmLabel="Detach immediately"
            phrase={p.name}
            busy={publicationAction === "force-detach"}
            onConfirm={() =>
              void runPublicationAction("force-detach", () => api.detachStaticPublication(id, true))
            }
          >
            <p>
              This makes the project private locally and removes its target connection immediately.
              Files at <strong>{p.staticPublication.url}</strong> may remain public and must be
              cleaned up at the provider or SFTP server. A later target deployment may also remove
              them as stale files.
            </p>
          </ConfirmationDialog>
        </>
      )}
      <ProjectControls
        project={p}
        onChanged={() => client.invalidateQueries({ queryKey: ["project", id] })}
      />
      {selected.length >= 2 && (
        <Card className="compare-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Comparison</p>
              <h2>Two moments, one surface</h2>
            </div>
            <Button
              variant="secondary"
              disabled={selected.length !== 2}
              onClick={() =>
                api.compare(selected[0]!, selected[1]!).then(setCompare).catch(setError)
              }
            >
              {selected.length === 2 ? "Generate diff" : "Choose two for diff"}
            </Button>
          </div>
          <div className="side-by-side">
            {selected.map((captureId) => {
              const capture = captures.data?.find((item) => item.id === captureId);
              return capture?.imageUrl ? (
                <figure key={capture.id}>
                  <img src={capture.imageUrl} alt="Selected capture" />
                  <figcaption>{new Date(capture.capturedAt).toLocaleString()}</figcaption>
                </figure>
              ) : null;
            })}
          </div>
          {compare && <ComparisonResult comparison={compare} />}
        </Card>
      )}
      {grouped.map(({ profile, captures: history }) => (
        <section className="history" key={profile.id}>
          <div className="section-title">
            <div>
              <p className="eyebrow">{profile.browser}</p>
              <h2>{profile.name}</h2>
            </div>
            <div className="export-actions">
              <Button
                variant="secondary"
                onClick={() => api.createExport(id, profile.id, "gif").catch(setError)}
              >
                GIF ↓
              </Button>
              <Button
                variant="secondary"
                onClick={() => api.createExport(id, profile.id, "webm").catch(setError)}
              >
                WebM ↓
              </Button>
            </div>
          </div>
          <ProfileSettings
            projectId={id}
            profile={profile}
            onChanged={() => client.invalidateQueries({ queryKey: ["project", id] })}
          />
          {history.length ? (
            <div className="capture-grid">
              {history.map((capture) => (
                <CaptureCard
                  key={capture.id}
                  capture={capture}
                  selected={selected.includes(capture.id)}
                  onSelect={() =>
                    setSelected((current) =>
                      current.includes(capture.id)
                        ? current.filter((item) => item !== capture.id)
                        : current.length >= 6
                          ? current
                          : [...current, capture.id],
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <Empty title="No frames yet">
              Run a capture to establish this profile’s first point in time.
            </Empty>
          )}
        </section>
      ))}
    </>
  );
}

function ComparisonResult({ comparison }: { comparison: Comparison }) {
  const [opacity, setOpacity] = useState(50);
  return (
    <div className="comparison-result">
      <div className="overlay-frame">
        <img src={comparison.first.imageUrl ?? ""} alt="Earlier capture" />
        <img
          src={comparison.second.imageUrl ?? ""}
          alt="Later capture overlay"
          style={{ opacity: opacity / 100 }}
        />
      </div>
      <label className="opacity-control">
        <span>Overlay opacity</span>
        <input
          type="range"
          min="0"
          max="100"
          value={opacity}
          onChange={(event) => setOpacity(Number(event.target.value))}
        />
        <output>{opacity}%</output>
      </label>
      <div className="diff-result">
        <img src={comparison.diffDataUrl} alt="Pixel difference heatmap" />
        <div>
          <strong>{comparison.changePercent.toFixed(4)}%</strong>
          <span>{comparison.exactMatch ? "Exact match" : "of pixels changed"}</span>
        </div>
      </div>
    </div>
  );
}

function profileFromForm(data: FormData): CaptureProfileInput {
  return {
    name: String(data.get("name")),
    browser: String(data.get("browser")) as CaptureProfileInput["browser"],
    enabled: data.get("enabled") === "on",
    deviceName: String(data.get("deviceName") || "").trim() || null,
    viewportWidth: Number(data.get("viewportWidth")),
    viewportHeight: Number(data.get("viewportHeight")),
    deviceScaleFactor: Number(data.get("deviceScaleFactor")),
    extent: String(data.get("extent")) as CaptureProfileInput["extent"],
    colorScheme: String(data.get("colorScheme")) as CaptureProfileInput["colorScheme"],
    locale: String(data.get("locale")),
    timezone: String(data.get("timezone")),
    reducedMotion: String(data.get("reducedMotion")) as CaptureProfileInput["reducedMotion"],
    delayMs: Number(data.get("delayMs")),
    waitForSelector: String(data.get("waitForSelector") || "").trim() || null,
    timeoutMs: Number(data.get("timeoutMs")),
  };
}

function ProfileSettings({
  projectId,
  profile,
  onChanged,
}: {
  projectId: string;
  profile: Awaited<ReturnType<typeof api.project>>["profiles"][number];
  onChanged: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const settings = profile.settings;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api.updateProfile(
        projectId,
        profile.id,
        profileFromForm(new FormData(event.currentTarget)),
      );
      setSaved(true);
      onChanged();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <details className="profile-settings">
      <summary>Edit capture profile</summary>
      <ErrorNotice error={error} />
      {saved && (
        <div className="success-notice">Profile saved; run a test capture before scheduling.</div>
      )}
      <form onSubmit={save}>
        <div className="form-row profile-basics">
          <Field label="Name">
            <input name="name" defaultValue={settings.name} required />
          </Field>
          <Field label="Browser">
            <select name="browser" defaultValue={settings.browser}>
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </Field>
          <Field label="Extent">
            <select name="extent" defaultValue={settings.extent}>
              <option value="viewport">Viewport</option>
              <option value="fullPage">Full page</option>
            </select>
          </Field>
        </div>
        <div className="form-row profile-dimensions">
          <Field label="Width">
            <input
              name="viewportWidth"
              type="number"
              min="320"
              max="7680"
              defaultValue={settings.viewportWidth}
            />
          </Field>
          <Field label="Height">
            <input
              name="viewportHeight"
              type="number"
              min="240"
              max="4320"
              defaultValue={settings.viewportHeight}
            />
          </Field>
          <Field label="Scale">
            <input
              name="deviceScaleFactor"
              type="number"
              min="0.5"
              max="4"
              step="0.25"
              defaultValue={settings.deviceScaleFactor}
            />
          </Field>
          <Field label="Device preset">
            <input
              name="deviceName"
              defaultValue={settings.deviceName ?? ""}
              placeholder="Optional Playwright device"
            />
          </Field>
        </div>
        <div className="form-row profile-environment">
          <Field label="Color scheme">
            <select name="colorScheme" defaultValue={settings.colorScheme}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="no-preference">No preference</option>
            </select>
          </Field>
          <Field label="Locale">
            <input name="locale" defaultValue={settings.locale} />
          </Field>
          <Field label="Timezone">
            <input name="timezone" defaultValue={settings.timezone} />
          </Field>
          <Field label="Reduced motion">
            <select name="reducedMotion" defaultValue={settings.reducedMotion}>
              <option value="reduce">Reduce</option>
              <option value="no-preference">No preference</option>
            </select>
          </Field>
        </div>
        <div className="form-row profile-timing">
          <Field label="Delay (ms)">
            <input
              name="delayMs"
              type="number"
              min="0"
              max="60000"
              defaultValue={settings.delayMs}
            />
          </Field>
          <Field label="Readiness selector">
            <input
              name="waitForSelector"
              defaultValue={settings.waitForSelector ?? ""}
              placeholder="Optional CSS selector"
            />
          </Field>
          <Field label="Timeout (ms)">
            <input
              name="timeoutMs"
              type="number"
              min="1000"
              max="120000"
              defaultValue={settings.timeoutMs}
            />
          </Field>
        </div>
        <label className="check-line">
          <input name="enabled" type="checkbox" defaultChecked={settings.enabled} />
          Capture this profile in project runs
        </label>
        <Button type="submit" variant="secondary">
          Save profile
        </Button>
      </form>
    </details>
  );
}

function ProjectControls({
  project,
  onChanged,
}: {
  project: Awaited<ReturnType<typeof api.project>>;
  onChanged: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [scheduleExpression, setScheduleExpression] = useState(project.scheduleExpression);
  const hooks = useQuery({
    queryKey: ["webhooks", project.id],
    queryFn: () => api.webhooks(project.id),
  });
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api.updateProject(project.id, {
        scheduleExpression,
        scheduleTimezone: String(data.get("scheduleTimezone")),
        scheduleEnabled: data.get("scheduleEnabled") === "on",
        confirmUntestedProfiles: data.get("confirmUntestedProfiles") === "on",
        retentionDays: data.get("retentionDays") ? Number(data.get("retentionDays")) : null,
        retentionCount: data.get("retentionCount") ? Number(data.get("retentionCount")) : null,
      });
      setNotice("Project policy saved.");
      onChanged();
    } catch (caught) {
      setError(caught);
    }
  };
  const addWebhook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api.createWebhook(project.id, {
        url: String(data.get("url")),
        threshold: Number(data.get("threshold")),
        events: ["capture.changed", "capture.failed"],
      });
      setNotice(`Webhook created. Copy its signing secret now: ${result.secret}`);
      await hooks.refetch();
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught);
    }
  };
  const replaceCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const headers = JSON.parse(String(data.get("headers") || "{}")) as unknown;
      const cookies = JSON.parse(String(data.get("cookies") || "[]")) as unknown;
      await api.replaceCredentials(project.id, { headers, cookies });
      setNotice("Encrypted target credentials replaced.");
    } catch (caught) {
      setError(
        caught instanceof SyntaxError
          ? new Error("Headers or cookies contain invalid JSON")
          : caught,
      );
    }
  };
  const addProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api.addProfile(project.id, {
        name: String(data.get("name")),
        browser: String(data.get("browser")) as CaptureProfileInput["browser"],
        enabled: true,
        deviceName: null,
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        extent: "viewport",
        colorScheme: "light",
        locale: "en-US",
        timezone: "UTC",
        reducedMotion: "reduce",
        delayMs: 1000,
        waitForSelector: null,
        timeoutMs: 30_000,
      });
      setNotice("Profile added. Edit it below, then run a test capture.");
      form.reset();
      onChanged();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <details className="control-panel">
      <summary>
        <span>Schedule, retention & webhooks</span>
        <span>Open →</span>
      </summary>
      <ErrorNotice error={error} />
      {notice && <div className="success-notice">{notice}</div>}
      <div className="control-columns">
        <form onSubmit={save}>
          <h3>Capture policy</h3>
          <Field label="Schedule preset">
            <select
              value={
                ["0 0 * * *", "0 */6 * * *", "0 9 * * 1", "custom"].includes(scheduleExpression)
                  ? scheduleExpression
                  : "custom"
              }
              onChange={(event) => {
                if (event.target.value !== "custom") setScheduleExpression(event.target.value);
              }}
            >
              <option value="0 0 * * *">Daily at midnight</option>
              <option value="0 */6 * * *">Every six hours</option>
              <option value="0 9 * * 1">Weekly on Monday</option>
              <option value="custom">Custom cron</option>
            </select>
          </Field>
          <Field label="Cron expression">
            <input
              name="scheduleExpression"
              value={scheduleExpression}
              onChange={(event) => setScheduleExpression(event.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <input name="scheduleTimezone" defaultValue={project.scheduleTimezone} />
          </Field>
          <div className="form-row">
            <Field label="Keep days">
              <input
                name="retentionDays"
                type="number"
                min="1"
                defaultValue={project.retentionDays ?? ""}
              />
            </Field>
            <Field label="Keep count">
              <input
                name="retentionCount"
                type="number"
                min="1"
                defaultValue={project.retentionCount ?? ""}
              />
            </Field>
          </div>
          <label className="check-line">
            <input
              name="scheduleEnabled"
              type="checkbox"
              defaultChecked={project.scheduleEnabled}
            />
            Enable schedule after every profile has succeeded
          </label>
          <label className="check-line">
            <input name="confirmUntestedProfiles" type="checkbox" />
            Explicitly allow scheduling untested profiles
          </label>
          <Button type="submit">Save policy</Button>
        </form>
        <form onSubmit={addWebhook}>
          <h3>Change webhook</h3>
          <Field label="HTTPS endpoint">
            <input name="url" type="url" required placeholder="https://example.com/hooks/sad" />
          </Field>
          <Field label="Change threshold (%)">
            <input name="threshold" type="number" min="0" max="100" step="0.001" defaultValue="0" />
          </Field>
          <Button type="submit" variant="secondary">
            Add signed webhook
          </Button>
          <div className="hook-list">
            {hooks.data?.map((hook) => (
              <span key={hook.id}>
                {hook.url} · {hook.threshold}%
              </span>
            ))}
          </div>
        </form>
        <form onSubmit={replaceCredentials}>
          <h3>Target authentication</h3>
          <p className="form-help">
            Values are write-only. Saving replaces every stored header and cookie.
          </p>
          <Field label="Headers (JSON object)">
            <textarea name="headers" rows={4} defaultValue="{}" spellCheck={false} />
          </Field>
          <Field label="Cookies (JSON array)">
            <textarea name="cookies" rows={4} defaultValue="[]" spellCheck={false} />
          </Field>
          <Button type="submit" variant="secondary">
            Replace credentials
          </Button>
        </form>
        <form onSubmit={addProfile}>
          <h3>Add profile</h3>
          <Field label="Profile name">
            <input name="name" required placeholder="Mobile dark" />
          </Field>
          <Field label="Browser">
            <select name="browser" defaultValue="chromium">
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </Field>
          <Button type="submit" variant="secondary">
            Add profile
          </Button>
        </form>
      </div>
    </details>
  );
}

function CaptureCard({
  capture,
  selected,
  onSelect,
}: {
  capture: CaptureRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`capture-card ${selected ? "selected" : ""}`}>
      <button onClick={onSelect} aria-pressed={selected} disabled={capture.status !== "succeeded"}>
        {capture.thumbnailUrl ? (
          <img
            src={capture.thumbnailUrl}
            alt={`Capture from ${new Date(capture.capturedAt).toLocaleString()}`}
          />
        ) : (
          <div className="capture-failed">
            <span>No image</span>
          </div>
        )}
        {capture.status === "succeeded" && (
          <span className="capture-check">{selected ? "✓" : "+"}</span>
        )}
      </button>
      <div>
        <time>{new Date(capture.capturedAt).toLocaleString()}</time>
        <Status value={capture.status} />
        <span className="change">
          {capture.status === "failed"
            ? "Capture failed"
            : capture.changePercent == null
              ? "First frame"
              : `${capture.changePercent.toFixed(3)}% change`}
        </span>
      </div>
    </article>
  );
}

function PublicGallery() {
  const params = useParams();
  const mode = params.token ? "s" : "p";
  const value = params.token ?? params.slug ?? "";
  const [profileId, setProfileId] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison>();
  const [error, setError] = useState<unknown>();
  const gallery = useQuery({
    queryKey: ["public", mode, value],
    queryFn: () => api.publicGallery(mode, value),
  });
  if (gallery.isLoading) return <Splash />;
  if (!gallery.data)
    return (
      <div className="public-error">
        <ErrorNotice error={gallery.error} />
      </div>
    );
  const visible = profileId
    ? gallery.data.captures.filter((capture) => capture.profileId === profileId)
    : gallery.data.captures;
  const choose = (capture: CaptureRecord) => {
    setComparison(undefined);
    setSelected((current) => {
      if (current.includes(capture.id)) return current.filter((id) => id !== capture.id);
      const currentProfile = gallery.data?.captures.find(
        (item) => item.id === current[0],
      )?.profileId;
      return currentProfile && currentProfile !== capture.profileId
        ? [capture.id]
        : [...current.slice(-1), capture.id];
    });
  };
  return (
    <div className="public-page">
      <header>
        <AccentRule />
        <Eyebrow>Visual record</Eyebrow>
        <h1>{gallery.data.project.name}</h1>
        <p>
          {gallery.data.captures.length} retained moments across{" "}
          {gallery.data.project.profiles.length} profile
          {gallery.data.project.profiles.length === 1 ? "" : "s"}.
        </p>
      </header>
      <div className="public-tools">
        <div className="segmented">
          <button
            className={!profileId ? "active" : ""}
            onClick={() => {
              setProfileId(undefined);
              setSelected([]);
              setComparison(undefined);
            }}
          >
            All profiles
          </button>
          {gallery.data.project.profiles.map((profile) => (
            <button
              key={profile.id}
              className={profileId === profile.id ? "active" : ""}
              onClick={() => {
                setProfileId(profile.id);
                setSelected([]);
                setComparison(undefined);
              }}
            >
              {profile.name}
            </button>
          ))}
        </div>
        <div className="public-actions">
          {profileId && (
            <>
              <a href={`/${mode}/${value}/${profileId}/latest.gif`}>Latest GIF</a>
              <a href={`/${mode}/${value}/${profileId}/latest.webm`}>Latest WebM</a>
            </>
          )}
          <Button
            variant="secondary"
            disabled={selected.length !== 2}
            onClick={() =>
              api
                .publicCompare(mode, value, selected[0]!, selected[1]!)
                .then(setComparison)
                .catch(setError)
            }
          >
            Compare selected
          </Button>
        </div>
      </div>
      <ErrorNotice error={error} />
      {comparison && (
        <Card className="compare-panel public-comparison">
          <ComparisonResult comparison={comparison} />
        </Card>
      )}
      <div className="public-grid">
        {visible.map((capture) => (
          <article
            key={capture.id}
            className={`public-frame ${selected.includes(capture.id) ? "selected" : ""}`}
          >
            <a href={capture.imageUrl ?? "#"}>
              <img src={capture.thumbnailUrl ?? ""} alt="" />
            </a>
            <time>{new Date(capture.capturedAt).toLocaleString()}</time>
            <span>
              {capture.changePercent == null
                ? "Opening frame"
                : `${capture.changePercent.toFixed(3)}% changed`}
            </span>
            <button onClick={() => choose(capture)}>
              {selected.includes(capture.id) ? "Selected" : "Select to compare"}
            </button>
          </article>
        ))}
      </div>
      <footer>
        <span>Recorded with Screenshot-a-Day · v0.1.0</span>
        <span aria-hidden="true"> · </span>
        <ArtsLinkCredit />
        <span aria-hidden="true"> · </span>
        <a href="https://github.com/arts-link/screenshot-a-day" target="_blank" rel="noreferrer">
          AGPL-3.0 source
        </a>
      </footer>
    </div>
  );
}

function Settings() {
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: api.tokens });
  const storage = useQuery({ queryKey: ["storage"], queryFn: api.storage });
  const [revealed, setRevealed] = useState<string>();
  const [error, setError] = useState<unknown>();
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api.createToken({
        name: String(data.get("name")),
        scopes: ["read", "capture:trigger"],
        projectIds: null,
      });
      setRevealed(result.token);
      await tokens.refetch();
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught);
    }
  };
  const format = (bytes = 0) =>
    new Intl.NumberFormat(undefined, {
      style: "unit",
      unit: bytes > 1_000_000_000 ? "gigabyte" : "megabyte",
      maximumFractionDigits: 1,
    }).format(bytes / (bytes > 1_000_000_000 ? 1_000_000_000 : 1_000_000));
  return (
    <>
      <header className="page-head">
        <div>
          <Eyebrow>Installation</Eyebrow>
          <h1>Settings</h1>
          <p>Security-sensitive values stay in environment configuration.</p>
        </div>
      </header>
      <ErrorNotice error={error} />
      {revealed && (
        <div className="token-reveal">
          <strong>Copy this token now</strong>
          <code>{revealed}</code>
          <span>It cannot be shown again.</span>
        </div>
      )}
      <div className="settings-grid">
        <PublicationSettings />
        <Card>
          <AccentRule />
          <h2>API access</h2>
          <p>Tokens are hashed at rest. This quick form creates read and capture-trigger access.</p>
          <form onSubmit={create}>
            <Field label="Token name">
              <input name="name" required placeholder="Deployment workflow" />
            </Field>
            <Button type="submit">Create token →</Button>
          </form>
          <div className="token-list">
            {tokens.data?.map((token) => (
              <span key={token.id}>
                <span>
                  {token.name} · {token.scopes.join(", ")}
                </span>
                <Button
                  variant="danger"
                  onClick={() =>
                    api
                      .deleteToken(token.id)
                      .then(() => tokens.refetch())
                      .catch(setError)
                  }
                >
                  Revoke
                </Button>
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <AccentRule />
          <h2>Storage</h2>
          <p>
            {format(storage.data?.bytes)} across {storage.data?.files ?? 0} artifacts, plus{" "}
            {format(storage.data?.databaseBytes)} of metadata.
          </p>
          <p>Configure retention per project and follow the backup procedure before upgrades.</p>
          <a
            href="https://github.com/arts-link/screenshot-a-day/blob/main/docs/guides/backups.md"
            target="_blank"
            rel="noreferrer"
          >
            Read backup guide →
          </a>
        </Card>
        <Card>
          <AccentRule />
          <h2>Secrets</h2>
          <p>
            Target headers and cookies are encrypted with the installation key and redacted from
            logs and responses.
          </p>
        </Card>
      </div>
    </>
  );
}

export default function App() {
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: api.setupStatus });
  if (setup.isLoading) return <Splash />;
  return (
    <>
      <Grain />
      <Routes>
        <Route
          path="/setup"
          element={setup.data?.configured ? <Navigate to="/login" /> : <AuthPage setup />}
        />
        <Route
          path="/login"
          element={!setup.data?.configured ? <Navigate to="/setup" /> : <AuthPage />}
        />
        <Route path="/p/:slug" element={<PublicGallery />} />
        <Route path="/s/:token" element={<PublicGallery />} />
        <Route element={<RequireAuth />}>
          <Route index element={<Dashboard />} />
          <Route path="projects/:id" element={<ProjectPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
