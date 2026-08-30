import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { api, type Comparison, type ExportArtifact, type ProjectDetail, type Webhook } from "./api";
import { activeCaptureRun, captureActionDetail, captureActionLabel } from "./capture-action";
import { projectGalleryUrl } from "./gallery-url";
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
import {
  projectPublicationActionLabel,
  publicationInFlight,
  publicationStatus,
} from "./publication-status";
import { PUBLICATION_PHASES, usePublicationElapsed } from "./publication-progress";
import { PublicationSettings } from "./publication-settings";
import {
  CAPTURES_PER_PAGE,
  changeComparisonSlot,
  emptyComparisonSelection,
  removeComparisonSlot,
  selectCapture,
  selectionRole,
  validComparisonPair,
  type ComparisonSelection,
  type ComparisonSlot,
} from "./comparison-selection";

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
          {projects.data.map((project) => {
            const compareUrl = `/projects/${project.id}/compare`;
            const galleryUrl = projectGalleryUrl(project, location.origin);
            return (
              <article className="project-card" key={project.id}>
                <Link className="project-card-main" to={compareUrl}>
                  {project.latestThumbnailUrl ? (
                    <div className="project-card-preview">
                      <img
                        src={project.latestThumbnailUrl}
                        alt={`Latest capture of ${project.name}`}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="project-card-preview empty">
                      <span>No captures yet</span>
                    </div>
                  )}
                  <div className="project-card-body">
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
                  </div>
                </Link>
                <div className="project-card-actions">
                  <Link to={compareUrl}>Open project →</Link>
                  {galleryUrl && (
                    <a
                      className="project-gallery-link"
                      href={galleryUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open gallery ↗
                    </a>
                  )}
                </div>
              </article>
            );
          })}
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

function ProjectHeader({
  project,
  action,
  galleryUrl,
}: {
  project: ProjectDetail;
  action?: ReactNode;
  galleryUrl?: string | null;
}) {
  return (
    <>
      <header className="page-head project-header">
        <div>
          <Link to="/" className="back-link">
            ← All projects
          </Link>
          <Eyebrow>{project.publishMode} timeline</Eyebrow>
          <h1>{project.name}</h1>
          <div className="project-header-links">
            <a href={project.url} target="_blank" rel="noreferrer">
              {project.url} ↗
            </a>
            {galleryUrl && (
              <a
                className="project-gallery-link"
                href={galleryUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open gallery ↗
              </a>
            )}
          </div>
        </div>
        {action}
      </header>
      <nav className="project-tabs" aria-label="Project workspace">
        <NavLink to={`/projects/${project.id}/compare`}>Compare</NavLink>
        <NavLink to={`/projects/${project.id}/configuration`}>Configuration</NavLink>
      </nav>
    </>
  );
}

function ComparisonTray({
  selection,
  onChange,
  onRemove,
}: {
  selection: ComparisonSelection<CaptureRecord>;
  onChange: (slot: ComparisonSlot) => void;
  onRemove: (slot: ComparisonSlot) => void;
}) {
  return (
    <div className="comparison-tray" aria-label="Comparison selection">
      {(["earlier", "later"] as const).map((slot) => {
        const capture = selection[slot];
        const active = selection.active === slot;
        return (
          <div
            className={`compare-slot ${active ? "active" : ""} ${capture ? "filled" : ""}`}
            key={slot}
          >
            <div>
              <span>{slot}</span>
              <strong>
                {capture
                  ? new Date(capture.capturedAt).toLocaleString()
                  : `Choose the ${slot} frame`}
              </strong>
            </div>
            {capture ? (
              <div className="slot-actions">
                <button type="button" onClick={() => onChange(slot)}>
                  Change
                </button>
                <button type="button" onClick={() => onRemove(slot)}>
                  Remove
                </button>
              </div>
            ) : (
              <small>{active ? "Select a capture below" : "Waiting for the first choice"}</small>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AutomaticComparison({
  selection,
  compare,
  scope,
}: {
  selection: ComparisonSelection<CaptureRecord>;
  compare: (first: string, second: string) => Promise<Comparison>;
  scope: string;
}) {
  const pair = validComparisonPair(selection);
  const comparison = useQuery({
    queryKey: ["comparison", scope, pair?.[0].id, pair?.[1].id],
    queryFn: () => compare(pair![0].id, pair![1].id),
    enabled: Boolean(pair),
  });
  return (
    <div className="comparison-output" aria-live="polite">
      {!pair ? (
        <div className="comparison-placeholder">
          Choose Earlier and Later to generate a pixel comparison automatically.
        </div>
      ) : comparison.isLoading ? (
        <div className="comparison-placeholder">
          <Spinner /> Comparing pixels…
        </div>
      ) : comparison.error ? (
        <ErrorNotice error={comparison.error} />
      ) : comparison.data ? (
        <ComparisonResult comparison={comparison.data} />
      ) : null}
    </div>
  );
}

function exportStatusText(item: ExportArtifact | undefined, busy: boolean): string {
  if (busy && item?.status === "processing")
    return `Encoding ${item.requestedFrameCount} frames on the worker…`;
  if (busy)
    return `Queued${item?.requestedFrameCount ? ` · ${item.requestedFrameCount} frames` : ""}`;
  if (item?.status === "failed")
    return item.available ? "Update failed · previous export still available" : "Generation failed";
  if (item?.available)
    return `${item.frameCount} frames · ready${item.updatedAt ? ` ${new Date(item.updatedAt).toLocaleString()}` : ""}`;
  return "Not generated yet";
}

function ExportControls({
  projectId,
  profileId,
  captureCount,
}: {
  projectId: string;
  profileId: string;
  captureCount: number;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const exportsQuery = useQuery({
    queryKey: ["exports", projectId, profileId],
    queryFn: () => api.exports(projectId, profileId),
    refetchInterval: (query) =>
      query.state.data?.some((item) => ["queued", "processing"].includes(item.status))
        ? 1500
        : false,
  });
  const generation = useMutation({
    mutationFn: (format: "gif" | "webm") => api.createExport(projectId, profileId, format),
    onSuccess: async () => {
      setError(undefined);
      await client.invalidateQueries({ queryKey: ["exports", projectId, profileId] });
    },
    onError: setError,
  });
  const formats = (["gif", "webm"] as const).map((format) => ({
    format,
    item: exportsQuery.data?.find((candidate) => candidate.format === format),
  }));
  const available = formats.filter(({ item }) => item?.available && item.downloadUrl);
  const active = formats.filter(
    ({ item }) => item?.status === "queued" || item?.status === "processing",
  );
  return (
    <div className="export-panel">
      <div className="export-downloads">
        <span>Animations</span>
        {available.length ? (
          available.map(({ format, item }) => (
            <a
              className="button button-secondary button-sm"
              href={item!.downloadUrl!}
              download
              key={format}
              aria-label={`Download ${format.toUpperCase()}`}
            >
              {format.toUpperCase()} ↓
            </a>
          ))
        ) : (
          <small>No downloads yet</small>
        )}
      </div>
      <details className="export-generation">
        <summary>
          {active.length
            ? `Generating ${active.map(({ format }) => format.toUpperCase()).join(" + ")}…`
            : "Generate / update"}
        </summary>
        <div className="export-generation-body">
          <p className="export-help">
            Uses FFmpeg on the worker and up to 90 captures. Large histories may take tens of
            seconds; you can leave this page while they run.
          </p>
          <div className="export-actions">
            {formats.map(({ format, item }) => {
              const pending = generation.isPending && generation.variables === format;
              const busy = pending || item?.status === "queued" || item?.status === "processing";
              const name = format.toUpperCase();
              const action = busy
                ? item?.status === "processing"
                  ? `Building ${name}…`
                  : `Queueing ${name}…`
                : item?.status === "failed"
                  ? `Retry ${name}`
                  : item?.available
                    ? `Regenerate ${name}`
                    : `Generate ${name}`;
              return (
                <div className="export-control" key={format}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || exportsQuery.isLoading || captureCount < 2}
                    aria-busy={busy}
                    onClick={() => {
                      setError(undefined);
                      generation.mutate(format);
                    }}
                  >
                    {busy && <Spinner />}
                    {action}
                  </Button>
                  <small role="status" aria-live="polite">
                    {captureCount < 2 ? "Needs two captures" : exportStatusText(item, busy)}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      </details>
      <ErrorNotice error={error ?? exportsQuery.error} />
      {exportsQuery.data?.map((item) =>
        item.status === "failed" && item.error ? (
          <div className="error-notice" role="alert" key={item.format}>
            <span aria-hidden="true">×</span>
            {item.format.toUpperCase()} generation failed: {item.error}
          </div>
        ) : null,
      )}
    </div>
  );
}

function ProjectComparePage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const [profileId, setProfileId] = useState<string>();
  const [page, setPage] = useState(0);
  const [selection, setSelection] =
    useState<ComparisonSelection<CaptureRecord>>(emptyComparisonSelection);
  const [error, setError] = useState<unknown>();
  const [requestedRunId, setRequestedRunId] = useState<string>();
  const captureLock = useRef(false);
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id) });
  const activeProfile =
    project.data?.profiles.find((profile) => profile.id === profileId) ??
    project.data?.profiles.find((profile) => profile.settings.enabled) ??
    project.data?.profiles[0];
  const captures = useQuery({
    queryKey: ["captures", id, activeProfile?.id, page],
    queryFn: () => api.captures(id, activeProfile!.id, CAPTURES_PER_PAGE, page * CAPTURES_PER_PAGE),
    enabled: Boolean(activeProfile),
    refetchInterval: 5000,
  });
  const runs = useQuery({
    queryKey: ["runs", id],
    queryFn: () => api.runs(id),
    refetchInterval: 1500,
  });
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

  if (project.isLoading) return <Splash />;
  if (!project.data) return <ErrorNotice error={project.error} />;
  const successful = captures.data?.captures ?? [];
  const failedCount = captures.data?.failedCount ?? 0;
  const successfulCount = captures.data?.successfulCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(successfulCount / CAPTURES_PER_PAGE));
  const visible = successful;
  const requestCapture = () => {
    if (captureLock.current || captureBusy) return;
    captureLock.current = true;
    setError(undefined);
    trigger.mutate(crypto.randomUUID());
  };
  const changeProfile = (nextProfileId: string) => {
    setProfileId(nextProfileId);
    setPage(0);
    setSelection(emptyComparisonSelection());
  };
  return (
    <>
      <ProjectHeader
        project={project.data}
        galleryUrl={projectGalleryUrl(project.data, location.origin)}
        action={
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
        }
      />
      <ErrorNotice error={error ?? captures.error ?? runs.error} />
      {activeProfile ? (
        <section className="comparison-workspace">
          <div className="workspace-toolbar">
            <div>
              <Eyebrow>Pixel comparison</Eyebrow>
              <h2>Compare two captures</h2>
              <p>Choose a profile, then pick an earlier and later moment from its history.</p>
            </div>
            <div className="workspace-actions">
              <Field label="Capture profile">
                <select
                  value={activeProfile.id}
                  onChange={(event) => changeProfile(event.target.value)}
                >
                  {project.data.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.settings.enabled ? "" : " · disabled"}
                    </option>
                  ))}
                </select>
              </Field>
              <ExportControls
                projectId={id}
                profileId={activeProfile.id}
                captureCount={successfulCount}
              />
            </div>
          </div>
          <ComparisonTray
            selection={selection}
            onChange={(slot) => setSelection((current) => changeComparisonSlot(current, slot))}
            onRemove={(slot) => setSelection((current) => removeComparisonSlot(current, slot))}
          />
          <AutomaticComparison selection={selection} compare={api.compare} scope={`admin:${id}`} />
          <div className="capture-browser-heading">
            <div>
              <Eyebrow tone="muted">{activeProfile.browser}</Eyebrow>
              <h2>{activeProfile.name} history</h2>
            </div>
            <div className="capture-browser-meta">
              <span>{successfulCount} comparable captures</span>
              {failedCount > 0 && (
                <span>
                  {failedCount} failed {failedCount === 1 ? "attempt is" : "attempts are"}{" "}
                  unavailable
                </span>
              )}
            </div>
          </div>
          {captures.isLoading ? (
            <div className="comparison-placeholder">
              <Spinner /> Loading captures…
            </div>
          ) : visible.length ? (
            <div className="capture-grid">
              {visible.map((capture) => {
                const role = selectionRole(selection, capture.id);
                return (
                  <CaptureCard
                    key={capture.id}
                    capture={capture}
                    role={role}
                    disabled={!role && !selection.active}
                    onSelect={() =>
                      role
                        ? setSelection((current) => removeComparisonSlot(current, role))
                        : setSelection((current) => selectCapture(current, capture))
                    }
                  />
                );
              })}
            </div>
          ) : (
            <Empty title="No comparable captures">
              Successful captures for this profile will appear here.
            </Empty>
          )}
          {successfulCount > CAPTURES_PER_PAGE && (
            <nav className="capture-pagination" aria-label="Capture history pages">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                ← Newer
              </Button>
              <span>
                Page {Math.min(page, pageCount - 1) + 1} of {pageCount}
              </span>
              <Button
                variant="secondary"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              >
                Older →
              </Button>
            </nav>
          )}
        </section>
      ) : (
        <Empty title="No capture profiles">
          Add a profile in Configuration before comparing captures.
        </Empty>
      )}
    </>
  );
}

function ProjectPublicationProgress({
  status,
  startedAt,
  queueing,
}: {
  status: ReturnType<typeof publicationStatus> | null;
  startedAt: string | number | undefined;
  queueing?: "attach" | "publish" | undefined;
}) {
  const active = Boolean(queueing || status?.busy);
  const elapsed = usePublicationElapsed(startedAt, active);
  const phase =
    status?.busy && PUBLICATION_PHASES.includes(status.value as (typeof PUBLICATION_PHASES)[number])
      ? (status.value as (typeof PUBLICATION_PHASES)[number])
      : "queued";
  const activePhase = PUBLICATION_PHASES.indexOf(phase);
  const headline =
    queueing === "attach"
      ? "Attaching destination"
      : queueing === "publish"
        ? "Queueing publication"
        : status?.headline;
  const detail =
    queueing === "attach"
      ? "Linking this project to the destination and starting its first publication."
      : queueing === "publish"
        ? "Sending this publication to the queue."
        : status?.detail;
  return (
    <div
      className="target-publication-progress project-publication-progress"
      role="status"
      aria-live="polite"
    >
      <div className="target-publication-progress-head">
        <span>
          <Spinner />
          <strong>{headline}</strong>
        </span>
        <span>{elapsed}</span>
      </div>
      <div className="target-publication-steps" aria-label="Publication progress">
        {PUBLICATION_PHASES.map((candidate, index) => (
          <span
            key={candidate}
            className={index < activePhase ? "complete" : index === activePhase ? "active" : ""}
          >
            {candidate}
          </span>
        ))}
      </div>
      <p>
        {detail} <strong>You can leave this page; progress is saved.</strong>
      </p>
    </div>
  );
}

function ProjectConfigurationPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.project(id),
    refetchInterval: (query) =>
      publicationInFlight(query.state.data?.staticPublication) ? 1500 : false,
  });
  const publicationTargets = useQuery({
    queryKey: ["publication-targets"],
    queryFn: api.publicationTargets,
  });
  const [error, setError] = useState<unknown>();
  const [publicationAction, setPublicationAction] = useState<string>();
  const [detachDialog, setDetachDialog] = useState<"remote" | "force">();
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
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
  if (project.isLoading) return <Splash />;
  if (!project.data) return <ErrorNotice error={project.error} />;
  const p = project.data;
  const shareUrl = projectGalleryUrl(p, location.origin);
  const staticStatus = p.staticPublication
    ? publicationStatus(p.staticPublication, p.publishMode)
    : null;
  const publicationBusy = Boolean(publicationAction || staticStatus?.busy);
  const publishing = Boolean(
    publicationAction === "publish" ||
    (staticStatus?.busy && p.staticPublication?.latestJob?.operation === "publish"),
  );
  const publicationElapsedFrom =
    staticStatus?.busy && p.staticPublication?.latestJob
      ? p.staticPublication.latestJob.createdAt
      : undefined;
  return (
    <>
      <ProjectHeader project={p} />
      <ErrorNotice error={error ?? publicationTargets.error} />
      <div className="metric-row">
        <div className="metric">
          <span>Profiles</span>
          <strong>{p.profiles.length}</strong>
        </div>
        <div className="metric">
          <span>Visibility</span>
          <strong>{p.publishMode}</strong>
        </div>
        <div className="metric">
          <span>Schedule</span>
          <strong>{p.scheduleEnabled ? "Active" : "Paused"}</strong>
        </div>
        <div className="metric">
          <span>Retention</span>
          <strong>{p.retentionCount ?? p.retentionDays ?? "All"}</strong>
        </div>
      </div>
      <Card className="publishing-card">
        <div className="publishing-card-head">
          <div className="publishing-title">
            <AccentRule />
            <div>
              <Eyebrow tone="muted">01 · Visibility and delivery</Eyebrow>
              <h2>Publishing and visibility</h2>
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
            <>
              <small>Anyone with this secret URL can view and share the gallery.</small>
              <Button
                variant="secondary"
                size="sm"
                disabled={publicationBusy}
                onClick={() =>
                  void runPublicationAction("rotate-token", () =>
                    api.publication(id, "unlisted", true),
                  )
                }
              >
                {publicationAction === "rotate-token" && <Spinner />}
                Rotate secret URL
              </Button>
            </>
          )}
        </div>
        <div className="publishing-destination" aria-busy={publicationBusy}>
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
              {publicationAction === "publish" || staticStatus?.busy ? (
                <ProjectPublicationProgress
                  status={staticStatus}
                  startedAt={publicationElapsedFrom}
                  queueing={publicationAction === "publish" ? "publish" : undefined}
                />
              ) : (
                <div
                  className={`target-publication-result project-publication-result${staticStatus?.value === "failed" ? " failed" : ""}`}
                  role={staticStatus?.value === "failed" ? "alert" : "status"}
                  aria-live="polite"
                >
                  <strong>{staticStatus?.headline}</strong>
                  <span>
                    {staticStatus?.detail}
                    {p.staticPublication.lastPublishedAt && staticStatus?.value === "active"
                      ? ` Completed ${new Date(p.staticPublication.lastPublishedAt).toLocaleString()}.`
                      : ""}
                  </span>
                </div>
              )}
              <a
                className="destination-url"
                href={p.staticPublication.url}
                target="_blank"
                rel="noreferrer"
              >
                {p.staticPublication.url} ↗
              </a>
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
                  {publishing && <Spinner />}
                  {projectPublicationActionLabel(
                    publicationAction === "publish",
                    publishing ? staticStatus : null,
                  )}
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
                {publicationAction === "attach" ? "Attaching…" : "Attach and publish →"}
              </Button>
              {publicationAction === "attach" && (
                <ProjectPublicationProgress
                  status={null}
                  startedAt={publicationElapsedFrom}
                  queueing="attach"
                />
              )}
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
      <section className="configuration-section">
        <div className="configuration-heading">
          <div>
            <Eyebrow tone="muted">02</Eyebrow>
            <h2>Capture profiles</h2>
          </div>
          <p>Define the browser and viewport contexts captured for this project.</p>
        </div>
        <div className="profile-config-list">
          {p.profiles.map((profile) => (
            <ProfileSettings
              key={profile.id}
              projectId={id}
              profile={profile}
              canDelete={p.profiles.length > 1}
              onChanged={() => client.invalidateQueries({ queryKey: ["project", id] })}
            />
          ))}
        </div>
        <AddProfileForm
          projectId={id}
          onChanged={() => client.invalidateQueries({ queryKey: ["project", id] })}
        />
      </section>
      <ProjectControls
        project={p}
        onChanged={() => client.invalidateQueries({ queryKey: ["project", id] })}
      />
      <section className="configuration-section project-danger-zone">
        <div className="configuration-heading">
          <div>
            <Eyebrow tone="muted">Danger zone</Eyebrow>
            <h2>Delete project</h2>
          </div>
          <p>Permanently remove the project, retained captures, exports, and webhook history.</p>
        </div>
        <Button variant="danger" onClick={() => setDeleteProjectOpen(true)}>
          Delete {p.name}
        </Button>
      </section>
      <ConfirmationDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        title="Delete this project?"
        confirmLabel="Delete project permanently"
        phrase={p.name}
        busy={publicationAction === "delete-project"}
        onConfirm={() => {
          setPublicationAction("delete-project");
          setError(undefined);
          void api
            .deleteProject(id)
            .then(async () => {
              await client.invalidateQueries({ queryKey: ["projects"] });
              navigate("/");
            })
            .catch(setError)
            .finally(() => setPublicationAction(undefined));
        }}
      >
        <p>
          This permanently deletes <strong>{p.name}</strong>, its local images, exports, profiles,
          webhooks, and delivery history. Static publication must be detached first.
        </p>
      </ConfirmationDialog>
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
  canDelete,
  onChanged,
}: {
  projectId: string;
  profile: Awaited<ReturnType<typeof api.project>>["profiles"][number];
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      <summary>Edit {profile.name}</summary>
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
        <div className="profile-form-actions">
          <Button type="submit" variant="secondary">
            Save profile
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!canDelete}
            title={canDelete ? undefined : "A project must retain at least one profile"}
            onClick={() => setDeleteOpen(true)}
          >
            Delete profile
          </Button>
        </div>
      </form>
      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${profile.name}?`}
        confirmLabel="Delete profile"
        busy={deleting}
        onConfirm={() => {
          setDeleting(true);
          setError(undefined);
          void api
            .deleteProfile(projectId, profile.id)
            .then(() => {
              setDeleteOpen(false);
              onChanged();
            })
            .catch(setError)
            .finally(() => setDeleting(false));
        }}
      >
        <p>Its retained captures and exports will also be removed permanently.</p>
      </ConfirmationDialog>
    </details>
  );
}

function WebhookCard({
  projectId,
  hook,
  onChanged,
  onNotice,
  onError,
}: {
  projectId: string;
  hook: Webhook;
  onChanged: () => Promise<unknown>;
  onNotice: (notice: string) => void;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string>();
  const [secretCopied, setSecretCopied] = useState(false);
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", projectId, hook.id],
    queryFn: () => api.webhookDeliveries(projectId, hook.id),
    refetchInterval: (query) =>
      query.state.data?.some((delivery) => ["queued", "sending"].includes(delivery.status))
        ? 1500
        : false,
  });
  const run = async (name: string, action: () => Promise<unknown>, notice: string) => {
    setBusy(name);
    onError(undefined);
    try {
      await action();
      onNotice(notice);
      await Promise.all([onChanged(), deliveries.refetch()]);
      setDeleteOpen(false);
    } catch (caught) {
      onError(caught);
    } finally {
      setBusy(undefined);
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      "save",
      () =>
        api.updateWebhook(projectId, hook.id, {
          url: String(data.get("url")),
          threshold: Number(data.get("threshold")),
          events: ["capture.changed", "capture.failed"].filter((eventName) => data.has(eventName)),
        }),
      "Webhook settings saved.",
    );
  };
  return (
    <article className="webhook-card">
      <form onSubmit={save}>
        <div className="webhook-card-heading">
          <h4>{hook.enabled ? "Active webhook" : "Paused webhook"}</h4>
          <Status value={hook.enabled ? "active" : "paused"} />
        </div>
        <Field label="HTTPS endpoint">
          <input name="url" type="url" required defaultValue={hook.url} />
        </Field>
        <Field label="Change threshold (%)">
          <input
            name="threshold"
            type="number"
            min="0"
            max="100"
            step="0.001"
            defaultValue={hook.threshold}
          />
        </Field>
        <div className="webhook-events">
          {(["capture.changed", "capture.failed"] as const).map((eventName) => (
            <label className="check-line" key={eventName}>
              <input
                type="checkbox"
                name={eventName}
                defaultChecked={hook.events.includes(eventName)}
              />
              {eventName}
            </label>
          ))}
        </div>
        <div className="webhook-actions">
          <Button type="submit" variant="secondary" size="sm" disabled={Boolean(busy)}>
            {busy === "save" && <Spinner />} Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                "toggle",
                () => api.updateWebhook(projectId, hook.id, { enabled: !hook.enabled }),
                hook.enabled ? "Webhook paused." : "Webhook enabled.",
              )
            }
          >
            {busy === "toggle" && <Spinner />} {hook.enabled ? "Pause" : "Enable"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={Boolean(busy) || !hook.enabled}
            onClick={() =>
              void run(
                "test",
                () => api.testWebhook(projectId, hook.id),
                "Signed test delivery queued.",
              )
            }
          >
            {busy === "test" && <Spinner />} Send test
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => {
              setBusy("rotate");
              void api
                .rotateWebhookSecret(projectId, hook.id)
                .then(({ secret }) => {
                  setRevealedSecret(secret);
                  setSecretCopied(false);
                  onNotice("Webhook secret rotated. Copy the new value from this webhook now.");
                })
                .catch(onError)
                .finally(() => setBusy(undefined));
            }}
          >
            {busy === "rotate" && <Spinner />} Rotate secret
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
        {revealedSecret && (
          <div className="token-reveal webhook-secret-reveal" role="status" aria-live="polite">
            <div className="token-reveal-head">
              <div>
                <strong>New signing secret ready</strong>
                <span>Update the receiver now. It cannot be shown again.</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRevealedSecret(undefined)}
              >
                Dismiss
              </Button>
            </div>
            <div className="token-reveal-value">
              <code>{revealedSecret}</code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(revealedSecret)
                    .then(() => setSecretCopied(true))
                    .catch(() =>
                      onError(
                        new Error(
                          "The secret could not be copied. Select it and copy it manually.",
                        ),
                      ),
                    );
                }}
              >
                {secretCopied ? "Copied ✓" : "Copy secret"}
              </Button>
            </div>
          </div>
        )}
      </form>
      <div className="webhook-deliveries">
        <strong>Recent deliveries</strong>
        {deliveries.data?.length ? (
          deliveries.data.slice(0, 5).map((delivery) => (
            <span key={delivery.id}>
              <Status value={delivery.status} /> {delivery.event} · attempts {delivery.attempts}
              {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ""}
              {delivery.error ? ` · ${delivery.error}` : ""}
            </span>
          ))
        ) : (
          <span>No deliveries yet.</span>
        )}
      </div>
      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this webhook?"
        confirmLabel="Delete webhook"
        busy={busy === "delete"}
        onConfirm={() =>
          void run(
            "delete",
            () => api.deleteWebhook(projectId, hook.id),
            "Webhook and delivery history deleted.",
          )
        }
      >
        <p>Queued deliveries and retained delivery history will also be deleted.</p>
      </ConfirmationDialog>
    </article>
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
  return (
    <>
      <ErrorNotice error={error} />
      {notice && <div className="success-notice">{notice}</div>}
      <section className="configuration-section">
        <div className="configuration-heading">
          <div>
            <Eyebrow tone="muted">03</Eyebrow>
            <h2>Schedule and retention</h2>
          </div>
          <p>Control when captures run and how much history remains available.</p>
        </div>
        <div className="control-columns single">
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
              <Field label="Retention period (days)">
                <input
                  name="retentionDays"
                  type="number"
                  min="1"
                  defaultValue={project.retentionDays ?? ""}
                />
              </Field>
              <Field label="Retained captures per profile">
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
        </div>
      </section>
      <section className="configuration-section">
        <div className="configuration-heading">
          <div>
            <Eyebrow tone="muted">04</Eyebrow>
            <h2>Webhooks and target credentials</h2>
          </div>
          <p>Send change events and authenticate captures of protected pages.</p>
        </div>
        <div className="control-columns">
          <div>
            <form onSubmit={addWebhook}>
              <h3>Change webhook</h3>
              <Field label="HTTPS endpoint">
                <input name="url" type="url" required placeholder="https://example.com/hooks/sad" />
              </Field>
              <Field label="Change threshold (%)">
                <input
                  name="threshold"
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  defaultValue="0"
                />
              </Field>
              <Button type="submit" variant="secondary">
                Add signed webhook
              </Button>
            </form>
            <div className="hook-list">
              {hooks.data?.map((hook) => (
                <WebhookCard
                  key={hook.id}
                  projectId={project.id}
                  hook={hook}
                  onChanged={() => hooks.refetch()}
                  onNotice={setNotice}
                  onError={setError}
                />
              ))}
            </div>
          </div>
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
        </div>
      </section>
    </>
  );
}

function AddProfileForm({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const addProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api.addProfile(projectId, {
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
      setNotice("Profile added. Edit it above, then run a test capture.");
      setError(undefined);
      form.reset();
      onChanged();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <form className="add-profile-form" onSubmit={addProfile}>
      <div>
        <h3>Add profile</h3>
        <p>Start with a standard desktop viewport, then refine it above.</p>
      </div>
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
      <ErrorNotice error={error} />
      {notice && <div className="success-notice">{notice}</div>}
    </form>
  );
}

function CaptureCard({
  capture,
  role,
  disabled,
  onSelect,
}: {
  capture: CaptureRecord;
  role: ComparisonSlot | null;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`capture-card ${role ? `selected selected-${role}` : ""}`}>
      <button
        onClick={onSelect}
        aria-pressed={Boolean(role)}
        disabled={disabled || capture.status !== "succeeded"}
      >
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
          <span className="capture-check">{role ? role : "+"}</span>
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
  const [page, setPage] = useState(0);
  const [selection, setSelection] =
    useState<ComparisonSelection<CaptureRecord>>(emptyComparisonSelection);
  const gallery = useQuery({
    queryKey: ["public", mode, value, profileId, page],
    queryFn: () => api.publicGallery(mode, value, profileId, page + 1),
    refetchInterval: (query) =>
      query.state.data?.exports.some((item) => ["queued", "processing"].includes(item.status))
        ? 1500
        : false,
  });
  if (gallery.isLoading) return <Splash />;
  if (!gallery.data)
    return (
      <div className="public-error">
        <ErrorNotice error={gallery.error} />
      </div>
    );
  const activeProfile =
    gallery.data.project.profiles.find((profile) => profile.id === profileId) ??
    gallery.data.project.profiles.find((profile) => profile.id === gallery.data.profileId) ??
    gallery.data.project.profiles.find((profile) => profile.settings.enabled) ??
    gallery.data.project.profiles[0];
  const successful = gallery.data.captures;
  const failedCount = gallery.data.failedCount;
  const pageCount = gallery.data.pageCount;
  const currentPage = gallery.data.page - 1;
  const visible = successful;
  const changeProfile = (nextProfileId: string) => {
    setProfileId(nextProfileId);
    setPage(0);
    setSelection(emptyComparisonSelection());
  };
  return (
    <div className="public-page">
      <header>
        <AccentRule />
        <Eyebrow>Visual record</Eyebrow>
        <h1>{gallery.data.project.name}</h1>
        <p>
          {gallery.data.successfulCount} comparable moments in this view.{" "}
          {gallery.data.project.profiles.length} capture profile
          {gallery.data.project.profiles.length === 1 ? "" : "s"} available.
        </p>
      </header>
      <div className="public-tools">
        <div className="segmented" aria-label="Capture profile">
          {gallery.data.project.profiles.map((profile) => (
            <button
              key={profile.id}
              className={activeProfile?.id === profile.id ? "active" : ""}
              onClick={() => changeProfile(profile.id)}
            >
              {profile.name}
            </button>
          ))}
        </div>
        <div className="public-export-panel">
          <div className="public-actions">
            {gallery.data.exports.map((item) => {
              const name = item.format.toUpperCase();
              const busy = item.status === "queued" || item.status === "processing";
              return (
                <div className="public-export-control" key={item.format}>
                  {item.available && item.downloadUrl ? (
                    <a
                      className="button button-secondary button-sm"
                      href={item.downloadUrl}
                      download
                      aria-label={`Download latest ${name}`}
                    >
                      {name} ↓
                    </a>
                  ) : (
                    <button
                      className="button button-secondary button-sm"
                      disabled
                      aria-label={busy ? `Preparing ${name}` : `${name} unavailable`}
                    >
                      {name} {busy ? "…" : "—"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <details className="public-export-details">
            <summary>Animation details</summary>
            <div>
              {gallery.data.exports.map((item) => {
                const busy = item.status === "queued" || item.status === "processing";
                return (
                  <span key={item.format} role="status" aria-live="polite">
                    <strong>{item.format.toUpperCase()}</strong>
                    {busy
                      ? ` · ${item.requestedFrameCount} frames · generating`
                      : item.available
                        ? ` · ${item.frameCount} frames${item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString()}` : ""}`
                        : " · not generated"}
                  </span>
                );
              })}
              <p>Server-generated downloads; nothing is encoded in your browser.</p>
            </div>
          </details>
        </div>
      </div>
      <section className="public-comparison-workspace">
        <div className="capture-browser-heading">
          <div>
            <Eyebrow>Pixel comparison</Eyebrow>
            <h2>{activeProfile?.name ?? "Capture history"}</h2>
          </div>
          <div className="capture-browser-meta">
            <span>{gallery.data.successfulCount} comparable captures</span>
            {failedCount > 0 && <span>{failedCount} failed unavailable</span>}
          </div>
        </div>
        <ComparisonTray
          selection={selection}
          onChange={(slot) => setSelection((current) => changeComparisonSlot(current, slot))}
          onRemove={(slot) => setSelection((current) => removeComparisonSlot(current, slot))}
        />
        <AutomaticComparison
          selection={selection}
          compare={(first, second) => api.publicCompare(mode, value, first, second)}
          scope={`public:${mode}:${value}`}
        />
      </section>
      <div className="public-grid capture-grid">
        {visible.map((capture) => (
          <article
            key={capture.id}
            className={`public-frame ${selectionRole(selection, capture.id) ? `selected selected-${selectionRole(selection, capture.id)}` : ""}`}
          >
            <a href={capture.imageUrl ?? "#"}>
              <img
                src={capture.thumbnailUrl ?? ""}
                alt={`Capture from ${new Date(capture.capturedAt).toLocaleString()}`}
              />
            </a>
            <time>{new Date(capture.capturedAt).toLocaleString()}</time>
            <span>
              {capture.changePercent == null
                ? "Opening frame"
                : `${capture.changePercent.toFixed(3)}% changed`}
            </span>
            <button
              disabled={!selectionRole(selection, capture.id) && !selection.active}
              onClick={() => {
                const role = selectionRole(selection, capture.id);
                setSelection((current) =>
                  role ? removeComparisonSlot(current, role) : selectCapture(current, capture),
                );
              }}
            >
              {selectionRole(selection, capture.id) ?? "Select to compare"}
            </button>
          </article>
        ))}
      </div>
      {gallery.data.successfulCount > CAPTURES_PER_PAGE && (
        <nav className="capture-pagination" aria-label="Capture history pages">
          <Button
            variant="secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            ← Newer
          </Button>
          <span>
            Page {currentPage + 1} of {pageCount}
          </span>
          <Button
            variant="secondary"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
          >
            Older →
          </Button>
        </nav>
      )}
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
  const [copied, setCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [error, setError] = useState<unknown>();
  const mcpUrl = `${window.location.origin}/mcp`;
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await api.createToken({
        name: String(data.get("name")),
        scopes: ["read", "capture:trigger"],
        projectIds: null,
      });
      setRevealed(result.token);
      setCopied(false);
      setError(undefined);
      form.reset();
      await tokens.refetch();
    } catch (caught) {
      setError(caught);
    }
  };
  const copyRevealedToken = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setError(undefined);
    } catch {
      setError(new Error("The token could not be copied. Select it and copy it manually."));
    }
  };
  const copyMcpUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setMcpCopied(true);
      setError(undefined);
    } catch {
      setError(new Error("The MCP URL could not be copied. Select it and copy it manually."));
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
      <div className="settings-grid">
        <PublicationSettings />
        <Card className="api-access-card">
          <AccentRule />
          <h2>API access</h2>
          <p>
            Tokens are hashed at rest and work with REST automation and the experimental MCP server.
            This quick form creates the recommended read and capture-trigger access.
          </p>
          <div className="mcp-access-note">
            <div className="mcp-access-head">
              <Badge tone="accent">Experimental MCP</Badge>
              <strong>Connect remote agents with an API token</strong>
            </div>
            <div className="mcp-endpoint">
              <code aria-label="MCP server URL">{mcpUrl}</code>
              <Button size="sm" variant="secondary" onClick={copyMcpUrl}>
                {mcpCopied ? "Copied ✓" : "Copy MCP URL"}
              </Button>
            </div>
            <p>
              <code>read</code> lists projects and captures; <code>capture:trigger</code> queues new
              captures. Project-limited tokens keep the same boundary.
            </p>
            <a
              href="https://github.com/arts-link/screenshot-a-day/blob/main/docs/api/README.md#experimental-mcp-server"
              target="_blank"
              rel="noreferrer"
            >
              MCP setup and tool reference →
            </a>
          </div>
          {revealed && (
            <div className="token-reveal" role="status" aria-live="polite">
              <div className="token-reveal-head">
                <div>
                  <strong>New token ready</strong>
                  <span>Copy it now. It cannot be shown again.</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRevealed(undefined)}>
                  Dismiss
                </Button>
              </div>
              <div className="token-reveal-value">
                <code>{revealed}</code>
                <Button size="sm" variant="secondary" onClick={copyRevealedToken}>
                  {copied ? "Copied ✓" : "Copy token"}
                </Button>
              </div>
            </div>
          )}
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
          <Route path="projects/:id" element={<Navigate to="compare" replace />} />
          <Route path="projects/:id/compare" element={<ProjectComparePage />} />
          <Route path="projects/:id/configuration" element={<ProjectConfigurationPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
