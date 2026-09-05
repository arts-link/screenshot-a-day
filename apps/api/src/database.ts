import DatabaseConstructor from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  CaptureProfileInput,
  ProjectInput,
  ProjectSummary,
  PublicationAdapter,
  PublicationBranding,
  PublicationScheduleMode,
  PublicationTargetInput,
} from "@sad/contracts";
import { randomToken } from "@sad/core";

type Sqlite = InstanceType<typeof DatabaseConstructor>;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}
export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  url: string;
  publish_mode: "private" | "unlisted" | "indexable";
  share_token: string | null;
  schedule_expression: string;
  schedule_timezone: string;
  schedule_enabled: number;
  next_run_at: string | null;
  retention_days: number | null;
  retention_count: number | null;
  secrets_encrypted: string;
  created_at: string;
  updated_at: string;
}
export interface ProfileRow {
  id: string;
  project_id: string;
  name: string;
  browser: "chromium" | "firefox" | "webkit";
  enabled: number;
  settings_json: string;
  test_succeeded_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface JobRow {
  id: string;
  run_id: string;
  project_id: string;
  profile_id: string | null;
  type: "capture" | "export";
  status: "queued" | "leased" | "succeeded" | "failed";
  payload_json: string;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  available_at: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface CaptureRow {
  id: string;
  project_id: string;
  profile_id: string;
  run_id: string;
  job_id: string;
  status: "succeeded" | "failed";
  captured_at: string;
  final_url: string | null;
  http_status: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  change_percent: number | null;
  image_key: string | null;
  thumbnail_key: string | null;
  diff_key: string | null;
  error: string | null;
  duration_ms: number | null;
}
export interface ApiTokenRow {
  id: string;
  name: string;
  token_hash: string;
  scopes_json: string;
  project_ids_json: string | null;
  last_used_at: string | null;
  created_at: string;
}
export interface WebhookRow {
  id: string;
  project_id: string;
  url: string;
  secret_encrypted: string;
  threshold: number;
  events_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}
export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload_json: string;
  status: "queued" | "sending" | "succeeded" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ExportRow {
  id: string;
  project_id: string;
  profile_id: string;
  format: "gif" | "webm";
  status: string;
  blob_key: string | null;
  frame_count: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface PublicationTargetRow {
  id: string;
  name: string;
  adapter: PublicationAdapter;
  base_url: string;
  branding_json: string;
  schedule_mode: PublicationScheduleMode;
  schedule_expression: string | null;
  schedule_timezone: string;
  adapter_config_json: string;
  credentials_encrypted: string;
  dirty_revision: number;
  published_revision: number;
  next_run_at: string | null;
  last_verified_at: string | null;
  last_verification_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ProjectPublicationRow {
  project_id: string;
  target_id: string;
  state: "pending" | "active" | "removal_pending" | "removal_failed";
  detach_after_removal: number;
  gallery_url: string;
  last_successful_revision: number;
  last_published_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface PublicationJobRow {
  id: string;
  target_id: string;
  status: "queued" | "building" | "deploying" | "succeeded" | "failed";
  operation: "publish" | "remove";
  desired_revision: number;
  attempts: number;
  max_attempts: number;
  available_at: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  deployment_id: string | null;
  deployment_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface PublicationManifestRow {
  id: string;
  target_id: string;
  revision: number;
  deployment_id: string | null;
  deployment_url: string;
  manifest_json: string;
  created_at: string;
}

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL, project_ids_json TEXT, last_used_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
  publish_mode TEXT NOT NULL CHECK (publish_mode IN ('private','unlisted','indexable')),
  share_token TEXT UNIQUE, schedule_expression TEXT NOT NULL, schedule_timezone TEXT NOT NULL,
  schedule_enabled INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, retention_days INTEGER, retention_count INTEGER,
  secrets_encrypted TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
  browser TEXT NOT NULL CHECK (browser IN ('chromium','firefox','webkit')), enabled INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL, test_succeeded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual','api','scheduled')), status TEXT NOT NULL,
  idempotency_key TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(project_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('capture','export')), status TEXT NOT NULL DEFAULT 'queued', payload_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, lease_token TEXT, lease_expires_at TEXT,
  available_at TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, available_at, lease_expires_at);
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE, status TEXT NOT NULL, captured_at TEXT NOT NULL,
  final_url TEXT, http_status INTEGER, width INTEGER, height INTEGER, sha256 TEXT, change_percent REAL,
  image_key TEXT, thumbnail_key TEXT, diff_key TEXT, error TEXT, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS captures_history_idx ON captures(profile_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, format TEXT NOT NULL,
  status TEXT NOT NULL, blob_key TEXT, frame_count INTEGER NOT NULL DEFAULT 0, settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(profile_id, format)
);
CREATE TABLE IF NOT EXISTS blob_deletions (
  key TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL, threshold REAL NOT NULL DEFAULT 0, events_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT, response_status INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

const MIGRATION_2 = `
CREATE TABLE publication_targets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, adapter TEXT NOT NULL CHECK (adapter IN ('vercel','netlify','sftp')),
  base_url TEXT NOT NULL,
  branding_json TEXT NOT NULL, schedule_mode TEXT NOT NULL CHECK (schedule_mode IN ('manual','on_change','hourly','daily','weekly','custom')),
  schedule_expression TEXT, schedule_timezone TEXT NOT NULL, adapter_config_json TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL, dirty_revision INTEGER NOT NULL DEFAULT 0, published_revision INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT, last_verified_at TEXT, last_verification_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE project_publications (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  target_id TEXT NOT NULL REFERENCES publication_targets(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('pending','active','removal_pending','removal_failed')),
  gallery_url TEXT NOT NULL, detach_after_removal INTEGER NOT NULL DEFAULT 0, last_successful_revision INTEGER NOT NULL DEFAULT 0,
  last_published_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX project_publications_target_idx ON project_publications(target_id);
CREATE TABLE publication_jobs (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES publication_targets(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','building','deploying','succeeded','failed')),
  operation TEXT NOT NULL CHECK (operation IN ('publish','remove')), desired_revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, available_at TEXT NOT NULL,
  lease_token TEXT, lease_expires_at TEXT, deployment_id TEXT, deployment_url TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX publication_jobs_claim_idx ON publication_jobs(status,available_at,lease_expires_at);
CREATE UNIQUE INDEX publication_jobs_one_queued_target_idx ON publication_jobs(target_id) WHERE status='queued';
CREATE TABLE publication_manifests (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES publication_targets(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, deployment_id TEXT, deployment_url TEXT NOT NULL,
  manifest_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX publication_manifests_target_idx ON publication_manifests(target_id,created_at DESC);
`;

const MIGRATION_3 = `
CREATE INDEX IF NOT EXISTS captures_profile_status_history_idx
ON captures(profile_id, status, captured_at DESC);
`;

export class AppDatabase {
  readonly raw: Sqlite;

  constructor(path: string) {
    this.raw = new DatabaseConstructor(path);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("busy_timeout = 5000");
    this.migrate();
  }

  migrate(): void {
    this.raw.exec(MIGRATION_1);
    const apply = this.raw.transaction((version: number, sql: string) => {
      const present = this.raw
        .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
        .get(version);
      if (present) return;
      this.raw.exec(sql);
      this.raw
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
    });
    apply(1, "");
    apply(2, MIGRATION_2);
    apply(3, MIGRATION_3);
  }

  close(): void {
    this.raw.close();
  }
  userCount(): number {
    return (this.raw.prepare("SELECT count(*) AS count FROM users").get() as { count: number })
      .count;
  }
  getUserByEmail(email: string): UserRow | undefined {
    return this.raw
      .prepare("SELECT id,email,password_hash FROM users WHERE lower(email)=lower(?)")
      .get(email) as UserRow | undefined;
  }
  createUser(email: string, passwordHash: string): UserRow {
    const row = { id: randomUUID(), email: email.toLowerCase(), password_hash: passwordHash };
    this.raw
      .prepare(
        "INSERT INTO users(id,email,password_hash,created_at) VALUES (@id,@email,@password_hash,@created_at)",
      )
      .run({ ...row, created_at: new Date().toISOString() });
    return row;
  }
  updateAdministratorPassword(passwordHash: string): void {
    const update = this.raw.transaction(() => {
      const administrator = this.raw
        .prepare("SELECT id FROM users ORDER BY created_at LIMIT 1")
        .get() as { id: string } | undefined;
      if (!administrator) return;
      this.raw
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(passwordHash, administrator.id);
      this.raw.prepare("DELETE FROM sessions WHERE user_id=?").run(administrator.id);
    });
    update();
  }

  createSession(userId: string, idHash: string, expiresAt: Date): void {
    this.raw
      .prepare("INSERT INTO sessions(id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
      .run(idHash, userId, expiresAt.toISOString(), new Date().toISOString());
  }
  getSession(idHash: string): { user_id: string } | undefined {
    return this.raw
      .prepare("SELECT user_id FROM sessions WHERE id_hash=? AND expires_at>?")
      .get(idHash, new Date().toISOString()) as { user_id: string } | undefined;
  }
  deleteSession(idHash: string): void {
    this.raw.prepare("DELETE FROM sessions WHERE id_hash=?").run(idHash);
  }
  getSetting(key: string): string | undefined {
    return (
      this.raw.prepare("SELECT value FROM settings WHERE key=?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string): void {
    this.raw
      .prepare(
        "INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(key, value, new Date().toISOString());
  }
  deleteSetting(key: string): void {
    this.raw.prepare("DELETE FROM settings WHERE key=?").run(key);
  }
  createApiToken(
    name: string,
    tokenHash: string,
    scopes: string[],
    projectIds: string[] | null,
  ): string {
    const id = randomUUID();
    this.raw
      .prepare(
        "INSERT INTO api_tokens(id,name,token_hash,scopes_json,project_ids_json,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        name,
        tokenHash,
        JSON.stringify(scopes),
        projectIds ? JSON.stringify(projectIds) : null,
        new Date().toISOString(),
      );
    return id;
  }
  getApiToken(tokenHash: string): ApiTokenRow | undefined {
    const token = this.raw.prepare("SELECT * FROM api_tokens WHERE token_hash=?").get(tokenHash) as
      ApiTokenRow | undefined;
    if (token)
      this.raw
        .prepare("UPDATE api_tokens SET last_used_at=? WHERE id=?")
        .run(new Date().toISOString(), token.id);
    return token;
  }
  listApiTokens(): Array<Omit<ApiTokenRow, "token_hash">> {
    return this.raw
      .prepare(
        "SELECT id,name,scopes_json,project_ids_json,last_used_at,created_at FROM api_tokens ORDER BY created_at DESC",
      )
      .all() as Array<Omit<ApiTokenRow, "token_hash">>;
  }
  deleteApiToken(id: string): boolean {
    return this.raw.prepare("DELETE FROM api_tokens WHERE id=?").run(id).changes > 0;
  }

  createProject(input: ProjectInput, secretsEncrypted: string, nextRunAt: string): ProjectRow {
    const now = new Date().toISOString();
    const project: ProjectRow = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      url: input.url,
      publish_mode: input.publishMode,
      share_token: input.publishMode === "unlisted" ? randomToken(24) : null,
      schedule_expression: input.scheduleExpression,
      schedule_timezone: input.scheduleTimezone,
      schedule_enabled: input.scheduleEnabled ? 1 : 0,
      next_run_at: input.scheduleEnabled ? nextRunAt : null,
      retention_days: input.retentionDays,
      retention_count: input.retentionCount,
      secrets_encrypted: secretsEncrypted,
      created_at: now,
      updated_at: now,
    };
    const transaction = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO projects(id,name,slug,url,publish_mode,share_token,schedule_expression,schedule_timezone,schedule_enabled,next_run_at,retention_days,retention_count,secrets_encrypted,created_at,updated_at)
        VALUES (@id,@name,@slug,@url,@publish_mode,@share_token,@schedule_expression,@schedule_timezone,@schedule_enabled,@next_run_at,@retention_days,@retention_count,@secrets_encrypted,@created_at,@updated_at)`,
        )
        .run(project);
      for (const profile of input.profiles) this.createProfile(project.id, profile, now);
    });
    transaction();
    return project;
  }

  private createProfile(
    projectId: string,
    input: CaptureProfileInput,
    now = new Date().toISOString(),
  ): void {
    this.raw
      .prepare(
        "INSERT INTO profiles(id,project_id,name,browser,enabled,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        projectId,
        input.name,
        input.browser,
        input.enabled ? 1 : 0,
        JSON.stringify(input),
        now,
        now,
      );
  }

  listProjects(): ProjectSummary[] {
    return this.raw
      .prepare(
        `SELECT p.*, count(DISTINCT pr.id) profile_count,
          latest.id latest_capture_id,
          latest.captured_at latest_capture_at,
          latest.thumbnail_key latest_thumbnail_key
        FROM projects p
        LEFT JOIN profiles pr ON pr.project_id=p.id
        LEFT JOIN captures latest ON latest.id=(
          SELECT candidate.id FROM captures candidate
          WHERE candidate.project_id=p.id AND candidate.status='succeeded'
          ORDER BY candidate.captured_at DESC, candidate.id DESC LIMIT 1
        )
        GROUP BY p.id ORDER BY p.created_at DESC`,
      )
      .all()
      .map((value) => {
        const row = value as ProjectRow & {
          profile_count: number;
          latest_capture_id: string | null;
          latest_capture_at: string | null;
          latest_thumbnail_key: string | null;
        };
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          url: row.url,
          publishMode: row.publish_mode,
          shareToken: row.share_token,
          scheduleEnabled: Boolean(row.schedule_enabled),
          scheduleExpression: row.schedule_expression,
          scheduleTimezone: row.schedule_timezone,
          profileCount: row.profile_count,
          latestCaptureAt: row.latest_capture_at,
          latestThumbnailUrl:
            row.latest_capture_id && row.latest_thumbnail_key
              ? `/api/v1/captures/${row.latest_capture_id}/thumbnail`
              : null,
          createdAt: row.created_at,
        };
      });
  }
  getProject(id: string): ProjectRow | undefined {
    return this.raw.prepare("SELECT * FROM projects WHERE id=?").get(id) as ProjectRow | undefined;
  }
  getPublishedProject(kind: "slug" | "token", value: string): ProjectRow | undefined {
    return this.raw
      .prepare(
        kind === "slug"
          ? `SELECT * FROM projects p WHERE slug=? AND publish_mode='indexable'
            AND NOT EXISTS (SELECT 1 FROM project_publications pp WHERE pp.project_id=p.id AND pp.state='active')`
          : `SELECT * FROM projects p WHERE share_token=? AND publish_mode='unlisted'
            AND NOT EXISTS (SELECT 1 FROM project_publications pp WHERE pp.project_id=p.id AND pp.state='active')`,
      )
      .get(value) as ProjectRow | undefined;
  }
  updatePublication(
    id: string,
    publishMode: "private" | "unlisted" | "indexable",
    rotate = false,
  ): ProjectRow | undefined {
    const current = this.getProject(id);
    if (!current) return undefined;
    const token =
      publishMode === "unlisted"
        ? rotate || !current.share_token
          ? randomToken(24)
          : current.share_token
        : null;
    this.raw
      .prepare("UPDATE projects SET publish_mode=?,share_token=?,updated_at=? WHERE id=?")
      .run(publishMode, token, new Date().toISOString(), id);
    const publication = this.getProjectPublication(id);
    if (publication) {
      const target = this.getPublicationTarget(publication.target_id);
      if (target) {
        const path = publishMode === "unlisted" ? `/s/${token}/` : `/p/${current.slug}/`;
        this.raw
          .prepare("UPDATE project_publications SET gallery_url=?,updated_at=? WHERE project_id=?")
          .run(`${target.base_url}${path}`, new Date().toISOString(), id);
      }
    }
    return this.getProject(id);
  }
  deleteProject(id: string): boolean {
    return this.raw.transaction(() => {
      if (!this.getProject(id)) return false;
      const captures = this.raw
        .prepare("SELECT image_key,thumbnail_key,diff_key FROM captures WHERE project_id=?")
        .all(id) as Array<{
        image_key: string | null;
        thumbnail_key: string | null;
        diff_key: string | null;
      }>;
      const exports = this.raw
        .prepare("SELECT blob_key FROM exports WHERE project_id=?")
        .all(id) as Array<{ blob_key: string | null }>;
      this.queueBlobDeletions([
        ...captures.flatMap((capture) => [
          capture.image_key,
          capture.thumbnail_key,
          capture.diff_key,
        ]),
        ...exports.map((exported) => exported.blob_key),
      ]);
      this.raw.prepare("DELETE FROM projects WHERE id=?").run(id);
      return true;
    })();
  }
  updateProject(
    id: string,
    input: {
      name?: string | undefined;
      url?: string | undefined;
      scheduleExpression?: string | undefined;
      scheduleTimezone?: string | undefined;
      scheduleEnabled?: boolean | undefined;
      nextRunAt?: string | undefined;
      retentionDays?: number | null | undefined;
      retentionCount?: number | null | undefined;
    },
  ): ProjectRow | undefined {
    const project = this.getProject(id);
    if (!project) return undefined;
    const next = {
      name: input.name ?? project.name,
      url: input.url ?? project.url,
      schedule_expression: input.scheduleExpression ?? project.schedule_expression,
      schedule_timezone: input.scheduleTimezone ?? project.schedule_timezone,
      schedule_enabled:
        input.scheduleEnabled == null ? project.schedule_enabled : input.scheduleEnabled ? 1 : 0,
      next_run_at:
        input.scheduleEnabled === false ? null : (input.nextRunAt ?? project.next_run_at),
      retention_days:
        input.retentionDays === undefined ? project.retention_days : input.retentionDays,
      retention_count:
        input.retentionCount === undefined ? project.retention_count : input.retentionCount,
      updated_at: new Date().toISOString(),
      id,
    };
    this.raw
      .prepare(
        `UPDATE projects SET name=@name,url=@url,schedule_expression=@schedule_expression,schedule_timezone=@schedule_timezone,
      schedule_enabled=@schedule_enabled,next_run_at=@next_run_at,retention_days=@retention_days,retention_count=@retention_count,updated_at=@updated_at WHERE id=@id`,
      )
      .run(next);
    return this.getProject(id);
  }
  updateProjectSecrets(id: string, secretsEncrypted: string): boolean {
    return (
      this.raw
        .prepare("UPDATE projects SET secrets_encrypted=?,updated_at=? WHERE id=?")
        .run(secretsEncrypted, new Date().toISOString(), id).changes > 0
    );
  }
  listProfiles(projectId: string): ProfileRow[] {
    return this.raw
      .prepare("SELECT * FROM profiles WHERE project_id=? ORDER BY created_at")
      .all(projectId) as ProfileRow[];
  }
  getProfile(id: string): ProfileRow | undefined {
    return this.raw.prepare("SELECT * FROM profiles WHERE id=?").get(id) as ProfileRow | undefined;
  }
  addProfile(projectId: string, input: CaptureProfileInput): ProfileRow {
    this.createProfile(projectId, input);
    return this.raw
      .prepare("SELECT * FROM profiles WHERE project_id=? AND name=?")
      .get(projectId, input.name) as ProfileRow;
  }
  updateProfile(id: string, input: CaptureProfileInput): ProfileRow | undefined {
    const current = this.getProfile(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    this.raw
      .prepare(
        "UPDATE profiles SET name=?,browser=?,enabled=?,settings_json=?,test_succeeded_at=NULL,updated_at=? WHERE id=?",
      )
      .run(input.name, input.browser, input.enabled ? 1 : 0, JSON.stringify(input), now, id);
    return this.getProfile(id);
  }
  deleteProfile(id: string): boolean {
    return this.raw.transaction(() => {
      const profile = this.getProfile(id);
      if (!profile) return false;
      const captures = this.raw
        .prepare("SELECT image_key,thumbnail_key,diff_key FROM captures WHERE profile_id=?")
        .all(id) as Array<{
        image_key: string | null;
        thumbnail_key: string | null;
        diff_key: string | null;
      }>;
      const exports = this.raw
        .prepare("SELECT blob_key FROM exports WHERE profile_id=?")
        .all(id) as Array<{ blob_key: string | null }>;
      this.queueBlobDeletions([
        ...captures.flatMap((capture) => [
          capture.image_key,
          capture.thumbnail_key,
          capture.diff_key,
        ]),
        ...exports.map((exported) => exported.blob_key),
      ]);
      this.raw.prepare("DELETE FROM profiles WHERE id=?").run(id);
      return true;
    })();
  }

  queueBlobDeletion(key: string): void {
    this.queueBlobDeletions([key]);
  }

  private queueBlobDeletions(keys: Array<string | null>): void {
    const insert = this.raw.prepare(
      "INSERT OR IGNORE INTO blob_deletions(key,created_at) VALUES (?,?)",
    );
    const now = new Date().toISOString();
    for (const key of new Set(keys.filter((value): value is string => Boolean(value))))
      insert.run(key, now);
  }

  pendingBlobDeletions(limit = 100): string[] {
    return (
      this.raw
        .prepare("SELECT key FROM blob_deletions ORDER BY created_at,key LIMIT ?")
        .all(limit) as Array<{ key: string }>
    ).map(({ key }) => key);
  }

  finishBlobDeletion(key: string): void {
    this.raw.prepare("DELETE FROM blob_deletions WHERE key=?").run(key);
  }

  enqueueRun(
    projectId: string,
    source: "manual" | "api" | "scheduled",
    profileIds?: string[],
    idempotencyKey?: string,
  ): string {
    if (idempotencyKey) {
      const existing = this.raw
        .prepare("SELECT id FROM runs WHERE project_id=? AND idempotency_key=?")
        .get(projectId, idempotencyKey) as { id: string } | undefined;
      if (existing) return existing.id;
    }
    if (source === "scheduled") {
      const active = this.raw
        .prepare(
          "SELECT id FROM runs WHERE project_id=? AND source='scheduled' AND status IN ('queued','running') LIMIT 1",
        )
        .get(projectId) as { id: string } | undefined;
      if (active) return active.id;
    }
    const selected = this.listProfiles(projectId).filter(
      (profile) => profile.enabled && (!profileIds || profileIds.includes(profile.id)),
    );
    if (selected.length === 0) throw new Error("No enabled capture profiles selected");
    const now = new Date().toISOString();
    const runId = randomUUID();
    this.raw.transaction(() => {
      this.raw
        .prepare(
          "INSERT INTO runs(id,project_id,source,status,idempotency_key,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(runId, projectId, source, "queued", idempotencyKey ?? null, now);
      const insert = this.raw.prepare(
        "INSERT INTO jobs(id,run_id,project_id,profile_id,type,status,payload_json,available_at,created_at,updated_at) VALUES (?,?,?,?,?,'queued','{}',?,?,?)",
      );
      for (const profile of selected)
        insert.run(randomUUID(), runId, projectId, profile.id, "capture", now, now, now);
    })();
    return runId;
  }

  claimJob(leaseSeconds = 120): JobRow | undefined {
    return this.raw.transaction(() => {
      const now = new Date();
      const row = this.raw
        .prepare(
          `SELECT * FROM jobs WHERE attempts < max_attempts AND available_at <= ?
        AND (status='queued' OR (status='leased' AND lease_expires_at < ?)) ORDER BY created_at LIMIT 1`,
        )
        .get(now.toISOString(), now.toISOString()) as JobRow | undefined;
      if (!row) return undefined;
      const leaseToken = randomToken(24);
      const expires = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      this.raw
        .prepare(
          "UPDATE jobs SET status='leased', attempts=attempts+1, lease_token=?, lease_expires_at=?, updated_at=? WHERE id=?",
        )
        .run(leaseToken, expires, now.toISOString(), row.id);
      this.raw
        .prepare("UPDATE runs SET status='running', started_at=coalesce(started_at,?) WHERE id=?")
        .run(now.toISOString(), row.run_id);
      return {
        ...row,
        status: "leased" as const,
        attempts: row.attempts + 1,
        lease_token: leaseToken,
        lease_expires_at: expires,
      };
    })();
  }

  validateLease(jobId: string, leaseToken: string): JobRow {
    const row = this.raw
      .prepare(
        "SELECT * FROM jobs WHERE id=? AND status='leased' AND lease_token=? AND lease_expires_at>?",
      )
      .get(jobId, leaseToken, new Date().toISOString()) as JobRow | undefined;
    if (!row) throw new Error("Invalid or expired job lease");
    return row;
  }

  renewLease(
    jobId: string,
    leaseToken: string,
    leaseSeconds = 120,
    now = new Date(),
  ): string | null {
    const expires = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const result = this.raw
      .prepare(
        `UPDATE jobs SET lease_expires_at=?,updated_at=?
        WHERE id=? AND status='leased' AND lease_token=? AND lease_expires_at>?`,
      )
      .run(expires, now.toISOString(), jobId, leaseToken, now.toISOString());
    return result.changes === 1 ? expires : null;
  }

  recordCapture(
    job: JobRow,
    input: Omit<CaptureRow, "id" | "project_id" | "profile_id" | "run_id" | "job_id">,
  ): CaptureRow {
    if (!job.profile_id) throw new Error("Capture job has no profile");
    const capture: CaptureRow = {
      id: randomUUID(),
      project_id: job.project_id,
      profile_id: job.profile_id,
      run_id: job.run_id,
      job_id: job.id,
      ...input,
    };
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO captures(id,project_id,profile_id,run_id,job_id,status,captured_at,final_url,http_status,width,height,sha256,change_percent,image_key,thumbnail_key,diff_key,error,duration_ms)
        VALUES (@id,@project_id,@profile_id,@run_id,@job_id,@status,@captured_at,@final_url,@http_status,@width,@height,@sha256,@change_percent,@image_key,@thumbnail_key,@diff_key,@error,@duration_ms)`,
        )
        .run(capture);
      this.raw
        .prepare(
          "UPDATE jobs SET status=?, error=?, lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?",
        )
        .run(
          input.status === "succeeded" ? "succeeded" : "failed",
          input.error,
          new Date().toISOString(),
          job.id,
        );
      if (input.status === "succeeded")
        this.raw
          .prepare(
            "UPDATE profiles SET test_succeeded_at=coalesce(test_succeeded_at,?), updated_at=? WHERE id=?",
          )
          .run(input.captured_at, input.captured_at, job.profile_id);
      this.finishRun(job.run_id);
    })();
    return capture;
  }

  private finishRun(runId: string): void {
    const counts = this.raw
      .prepare("SELECT status,count(*) count FROM jobs WHERE run_id=? GROUP BY status")
      .all(runId) as Array<{ status: string; count: number }>;
    if (counts.some((item) => item.status === "queued" || item.status === "leased")) return;
    const succeeded = counts.find((item) => item.status === "succeeded")?.count ?? 0;
    const failed = counts.find((item) => item.status === "failed")?.count ?? 0;
    const status = succeeded && failed ? "partial" : failed ? "failed" : "succeeded";
    this.raw
      .prepare("UPDATE runs SET status=?, finished_at=? WHERE id=?")
      .run(status, new Date().toISOString(), runId);
  }

  latestSuccessfulCapture(profileId: string, before?: string): CaptureRow | undefined {
    return this.raw
      .prepare(
        `SELECT * FROM captures WHERE profile_id=? AND status='succeeded' ${before ? "AND captured_at < ?" : ""} ORDER BY captured_at DESC LIMIT 1`,
      )
      .get(...(before ? [profileId, before] : [profileId])) as CaptureRow | undefined;
  }
  listCaptures(
    projectId: string,
    profileId?: string,
    limit = 100,
    options: { status?: "all" | "succeeded" | "failed"; offset?: number } = {},
  ): CaptureRow[] {
    const status = options.status ?? "all";
    const offset = options.offset ?? 0;
    const values: Array<string | number> = [projectId];
    if (profileId) values.push(profileId);
    if (status !== "all") values.push(status);
    values.push(limit, offset);
    return this.raw
      .prepare(
        `SELECT * FROM captures WHERE project_id=? ${profileId ? "AND profile_id=?" : ""} ${status === "all" ? "" : "AND status=?"} ORDER BY captured_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...values) as CaptureRow[];
  }
  captureCounts(
    projectId: string,
    profileId?: string,
  ): {
    total: number;
    succeeded: number;
    failed: number;
  } {
    const row = this.raw
      .prepare(
        `SELECT count(*) total,
          sum(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
          sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
        FROM captures WHERE project_id=? ${profileId ? "AND profile_id=?" : ""}`,
      )
      .get(...(profileId ? [projectId, profileId] : [projectId])) as {
      total: number;
      succeeded: number | null;
      failed: number | null;
    };
    return { total: row.total, succeeded: row.succeeded ?? 0, failed: row.failed ?? 0 };
  }
  getCapture(id: string): CaptureRow | undefined {
    return this.raw.prepare("SELECT * FROM captures WHERE id=?").get(id) as CaptureRow | undefined;
  }
  retentionVictims(projectId: string, profileId: string, now = new Date()): CaptureRow[] {
    const project = this.getProject(projectId);
    if (!project || (!project.retention_count && !project.retention_days)) return [];
    const captures = this.listCaptures(projectId, profileId, 100_000);
    const victims = new Map<string, CaptureRow>();
    if (project.retention_count)
      for (const capture of captures.slice(project.retention_count))
        victims.set(capture.id, capture);
    if (project.retention_days) {
      const cutoff = now.getTime() - project.retention_days * 86_400_000;
      for (const capture of captures)
        if (new Date(capture.captured_at).getTime() < cutoff) victims.set(capture.id, capture);
    }
    return [...victims.values()];
  }
  deleteCapture(id: string): void {
    this.raw.prepare("DELETE FROM captures WHERE id=?").run(id);
  }

  retryJob(job: JobRow, error: string): boolean {
    const now = new Date();
    if (job.attempts >= job.max_attempts) {
      this.raw
        .prepare(
          "UPDATE jobs SET status='failed',error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
        )
        .run(error, now.toISOString(), job.id);
      if (job.type === "export" && job.profile_id) {
        const format = (JSON.parse(job.payload_json) as { format: "gif" | "webm" }).format;
        if (this.latestExportJob(job.profile_id, format)?.id === job.id)
          this.raw
            .prepare(
              "UPDATE exports SET status='failed',updated_at=? WHERE profile_id=? AND format=?",
            )
            .run(now.toISOString(), job.profile_id, format);
      }
      this.finishRun(job.run_id);
      return false;
    }
    const available = new Date(
      now.getTime() + Math.min(60_000, 2 ** job.attempts * 2_000),
    ).toISOString();
    this.raw
      .prepare(
        "UPDATE jobs SET status='queued',error=?,lease_token=NULL,lease_expires_at=NULL,available_at=?,updated_at=? WHERE id=?",
      )
      .run(error, available, now.toISOString(), job.id);
    return true;
  }
  listRuns(projectId: string, limit = 50): Array<Record<string, unknown>> {
    return this.raw
      .prepare(
        `SELECT r.*, count(j.id) job_count,
      sum(CASE WHEN j.type='capture' THEN 1 ELSE 0 END) capture_job_count,
      sum(CASE WHEN j.status='succeeded' THEN 1 ELSE 0 END) succeeded_count,
      sum(CASE WHEN j.status='failed' THEN 1 ELSE 0 END) failed_count
      FROM runs r LEFT JOIN jobs j ON j.run_id=r.id WHERE r.project_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as Array<Record<string, unknown>>;
  }

  enqueueExport(
    projectId: string,
    profileId: string,
    format: "gif" | "webm",
    payload: unknown,
  ): string {
    const now = new Date().toISOString();
    return this.raw.transaction(() => {
      const queued = (
        this.raw
          .prepare(
            `SELECT * FROM jobs WHERE profile_id=? AND type='export' AND status='queued'
            ORDER BY rowid DESC`,
          )
          .all(profileId) as JobRow[]
      ).find((job) => (JSON.parse(job.payload_json) as { format?: string }).format === format);
      if (queued) {
        this.raw
          .prepare("UPDATE jobs SET payload_json=?,available_at=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(payload), now, now, queued.id);
        this.raw
          .prepare(
            "UPDATE exports SET status='queued',settings_json=?,updated_at=? WHERE profile_id=? AND format=?",
          )
          .run(JSON.stringify(payload), now, profileId, format);
        return queued.id;
      }

      const runId = randomUUID();
      const jobId = randomUUID();
      this.raw
        .prepare(
          "INSERT INTO runs(id,project_id,source,status,created_at) VALUES (?,?,'manual','queued',?)",
        )
        .run(runId, projectId, now);
      this.raw
        .prepare(
          "INSERT INTO jobs(id,run_id,project_id,profile_id,type,status,payload_json,available_at,created_at,updated_at) VALUES (?,?,?,?, 'export','queued',?,?,?,?)",
        )
        .run(jobId, runId, projectId, profileId, JSON.stringify(payload), now, now, now);
      this.raw
        .prepare(
          `INSERT INTO exports(id,project_id,profile_id,format,status,settings_json,created_at,updated_at)
        VALUES (?,?,?,?, 'queued',?,?,?) ON CONFLICT(profile_id,format) DO UPDATE SET status='queued',settings_json=excluded.settings_json,updated_at=excluded.updated_at`,
        )
        .run(randomUUID(), projectId, profileId, format, JSON.stringify(payload), now, now);
      return jobId;
    })();
  }
  saveExport(
    job: JobRow,
    blobKey: string,
    frameCount: number,
  ): { exported: ExportRow; published: boolean } {
    if (!job.profile_id) throw new Error("Export job has no profile");
    const format = (JSON.parse(job.payload_json) as { format: "gif" | "webm" }).format;
    const now = new Date().toISOString();
    const published = this.raw.transaction(() => {
      const current = this.raw.prepare("SELECT rowid FROM jobs WHERE id=?").get(job.id) as
        { rowid: number } | undefined;
      if (!current) throw new Error("Export job no longer exists");
      const newer = (
        this.raw
          .prepare("SELECT payload_json FROM jobs WHERE profile_id=? AND type='export' AND rowid>?")
          .all(job.profile_id, current.rowid) as Array<{ payload_json: string }>
      ).some(
        (candidate) =>
          (JSON.parse(candidate.payload_json) as { format?: string }).format === format,
      );
      if (!newer) {
        const previous = this.getExport(job.profile_id!, format);
        this.raw
          .prepare(
            "UPDATE exports SET status='succeeded',blob_key=?,frame_count=?,updated_at=? WHERE profile_id=? AND format=?",
          )
          .run(blobKey, frameCount, now, job.profile_id, format);
        if (previous?.blob_key && previous.blob_key !== blobKey)
          this.queueBlobDeletions([previous.blob_key]);
      }
      this.raw
        .prepare(
          "UPDATE jobs SET status='succeeded',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
        )
        .run(now, job.id);
      this.finishRun(job.run_id);
      return !newer;
    })();
    return { exported: this.getExport(job.profile_id, format)!, published };
  }
  getExport(profileId: string, format: "gif" | "webm"): ExportRow | undefined {
    return this.raw
      .prepare("SELECT * FROM exports WHERE profile_id=? AND format=?")
      .get(profileId, format) as ExportRow | undefined;
  }
  latestExportJob(profileId: string, format: "gif" | "webm"): JobRow | undefined {
    return this.raw
      .prepare(
        `SELECT * FROM jobs
        WHERE profile_id=? AND type='export' AND json_extract(payload_json, '$.format')=?
        ORDER BY rowid DESC LIMIT 1`,
      )
      .get(profileId, format) as JobRow | undefined;
  }

  createPublicationTarget(
    input: PublicationTargetInput,
    credentialsEncrypted: string,
    nextRunAt: string | null,
  ): PublicationTargetRow {
    const now = new Date().toISOString();
    const row: PublicationTargetRow = {
      id: randomUUID(),
      name: input.name,
      adapter: input.target.adapter,
      base_url: input.baseUrl,
      branding_json: JSON.stringify(input.branding),
      schedule_mode: input.scheduleMode,
      schedule_expression: input.scheduleExpression,
      schedule_timezone: input.scheduleTimezone,
      adapter_config_json: JSON.stringify(input.target.config),
      credentials_encrypted: credentialsEncrypted,
      dirty_revision: 0,
      published_revision: 0,
      next_run_at: nextRunAt,
      last_verified_at: null,
      last_verification_error: null,
      created_at: now,
      updated_at: now,
    };
    this.raw
      .prepare(
        `INSERT INTO publication_targets(id,name,adapter,base_url,branding_json,schedule_mode,schedule_expression,schedule_timezone,adapter_config_json,credentials_encrypted,dirty_revision,published_revision,next_run_at,last_verified_at,last_verification_error,created_at,updated_at)
        VALUES (@id,@name,@adapter,@base_url,@branding_json,@schedule_mode,@schedule_expression,@schedule_timezone,@adapter_config_json,@credentials_encrypted,@dirty_revision,@published_revision,@next_run_at,@last_verified_at,@last_verification_error,@created_at,@updated_at)`,
      )
      .run(row);
    return row;
  }

  listPublicationTargets(): PublicationTargetRow[] {
    return this.raw
      .prepare("SELECT * FROM publication_targets ORDER BY created_at")
      .all() as PublicationTargetRow[];
  }

  getPublicationTarget(id: string): PublicationTargetRow | undefined {
    return this.raw.prepare("SELECT * FROM publication_targets WHERE id=?").get(id) as
      PublicationTargetRow | undefined;
  }

  updatePublicationTarget(
    id: string,
    input: {
      name?: string | undefined;
      baseUrl?: string | undefined;
      branding?: PublicationBranding | undefined;
      scheduleMode?: PublicationScheduleMode | undefined;
      scheduleExpression?: string | null | undefined;
      scheduleTimezone?: string | undefined;
      adapter?: PublicationAdapter | undefined;
      adapterConfig?: unknown;
      nextRunAt?: string | null | undefined;
    },
  ): PublicationTargetRow | undefined {
    const current = this.getPublicationTarget(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const baseUrl = input.baseUrl ?? current.base_url;
    const adapter = input.adapter ?? current.adapter;
    const adapterConfigJson =
      input.adapterConfig === undefined
        ? current.adapter_config_json
        : JSON.stringify(input.adapterConfig);
    const connectionChanged =
      baseUrl !== current.base_url ||
      adapter !== current.adapter ||
      adapterConfigJson !== current.adapter_config_json;
    this.raw
      .prepare(
        `UPDATE publication_targets SET name=?,base_url=?,branding_json=?,schedule_mode=?,schedule_expression=?,
        schedule_timezone=?,adapter=?,adapter_config_json=?,next_run_at=?,last_verified_at=?,last_verification_error=?,
        dirty_revision=dirty_revision+1,updated_at=? WHERE id=?`,
      )
      .run(
        input.name ?? current.name,
        baseUrl,
        input.branding ? JSON.stringify(input.branding) : current.branding_json,
        input.scheduleMode ?? current.schedule_mode,
        input.scheduleExpression === undefined
          ? current.schedule_expression
          : input.scheduleExpression,
        input.scheduleTimezone ?? current.schedule_timezone,
        adapter,
        adapterConfigJson,
        input.nextRunAt === undefined ? current.next_run_at : input.nextRunAt,
        connectionChanged ? null : current.last_verified_at,
        connectionChanged ? null : current.last_verification_error,
        now,
        id,
      );
    if (input.baseUrl) {
      for (const publication of this.listTargetProjectPublications(id)) {
        const project = this.getProject(publication.project_id);
        if (!project) continue;
        const path =
          project.publish_mode === "unlisted"
            ? `/s/${project.share_token}/`
            : `/p/${project.slug}/`;
        this.raw
          .prepare("UPDATE project_publications SET gallery_url=?,updated_at=? WHERE project_id=?")
          .run(`${input.baseUrl}${path}`, now, project.id);
      }
    }
    if ((input.scheduleMode ?? current.schedule_mode) === "on_change")
      this.enqueuePublication(id, "publish", false, new Date(Date.now() + 60_000).toISOString());
    return this.getPublicationTarget(id);
  }

  replacePublicationCredentials(id: string, credentialsEncrypted: string): boolean {
    return (
      this.raw
        .prepare(
          "UPDATE publication_targets SET credentials_encrypted=?,last_verified_at=NULL,last_verification_error=NULL,updated_at=? WHERE id=?",
        )
        .run(credentialsEncrypted, new Date().toISOString(), id).changes === 1
    );
  }

  recordPublicationVerification(id: string, error: string | null): void {
    this.raw
      .prepare(
        "UPDATE publication_targets SET last_verified_at=?,last_verification_error=?,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), error, new Date().toISOString(), id);
  }

  deletePublicationTarget(id: string): boolean {
    const linked = this.raw
      .prepare("SELECT 1 FROM project_publications WHERE target_id=? LIMIT 1")
      .get(id);
    if (linked) throw new Error("Detach every project before deleting this target");
    return this.raw.prepare("DELETE FROM publication_targets WHERE id=?").run(id).changes === 1;
  }

  getProjectPublication(projectId: string): ProjectPublicationRow | undefined {
    return this.raw
      .prepare("SELECT * FROM project_publications WHERE project_id=?")
      .get(projectId) as ProjectPublicationRow | undefined;
  }

  listTargetProjectPublications(targetId: string): ProjectPublicationRow[] {
    return this.raw
      .prepare("SELECT * FROM project_publications WHERE target_id=? ORDER BY created_at")
      .all(targetId) as ProjectPublicationRow[];
  }

  attachProjectToTarget(projectId: string, targetId: string): ProjectPublicationRow {
    const project = this.getProject(projectId);
    const target = this.getPublicationTarget(targetId);
    if (!project || !target) throw new Error("Project or publication target not found");
    if (this.getProjectPublication(projectId))
      throw new Error("Project already has a static target");
    const now = new Date().toISOString();
    const path =
      project.publish_mode === "unlisted" ? `/s/${project.share_token}/` : `/p/${project.slug}/`;
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO project_publications(project_id,target_id,state,gallery_url,detach_after_removal,last_successful_revision,last_published_at,last_error,created_at,updated_at)
          VALUES (?,?,'pending',?,0,0,NULL,NULL,?,?)`,
        )
        .run(projectId, targetId, `${target.base_url}${path}`, now, now);
      this.markPublicationTargetDirty(targetId, true);
    })();
    return this.getProjectPublication(projectId)!;
  }

  requestProjectDetachment(projectId: string): ProjectPublicationRow | undefined {
    const project = this.getProject(projectId);
    const publication = this.getProjectPublication(projectId);
    if (!project || !publication) return undefined;
    this.raw.transaction(() => {
      this.raw
        .prepare(
          "UPDATE projects SET publish_mode='private',share_token=NULL,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), projectId);
      this.raw
        .prepare(
          "UPDATE project_publications SET state='removal_pending',detach_after_removal=1,last_error=NULL,updated_at=? WHERE project_id=?",
        )
        .run(new Date().toISOString(), projectId);
      this.markPublicationTargetDirty(publication.target_id, true, "remove");
    })();
    return this.getProjectPublication(projectId);
  }

  forceProjectDetachment(projectId: string): ProjectPublicationRow | undefined {
    const publication = this.getProjectPublication(projectId);
    if (!this.getProject(projectId) || !publication) return undefined;
    this.raw.transaction(() => {
      const now = new Date().toISOString();
      this.raw
        .prepare(
          "UPDATE projects SET publish_mode='private',share_token=NULL,updated_at=? WHERE id=?",
        )
        .run(now, projectId);
      this.raw.prepare("DELETE FROM project_publications WHERE project_id=?").run(projectId);
    })();
    return publication;
  }

  requestProjectPublicationRemoval(
    projectId: string,
    detach = false,
  ): ProjectPublicationRow | undefined {
    const publication = this.getProjectPublication(projectId);
    if (!publication) return undefined;
    this.raw.transaction(() => {
      this.raw
        .prepare(
          "UPDATE project_publications SET state='removal_pending',detach_after_removal=?,last_error=NULL,updated_at=? WHERE project_id=?",
        )
        .run(detach ? 1 : 0, new Date().toISOString(), projectId);
      this.markPublicationTargetDirty(publication.target_id, true, "remove");
    })();
    return this.getProjectPublication(projectId);
  }

  requestProjectPublicationPublish(projectId: string): ProjectPublicationRow | undefined {
    const publication = this.getProjectPublication(projectId);
    if (!publication) return undefined;
    this.raw.transaction(() => {
      this.raw
        .prepare(
          "UPDATE project_publications SET state=CASE WHEN last_successful_revision=0 THEN 'pending' ELSE 'active' END,detach_after_removal=0,last_error=NULL,updated_at=? WHERE project_id=?",
        )
        .run(new Date().toISOString(), projectId);
      this.markPublicationTargetDirty(publication.target_id, true, "publish");
    })();
    return this.getProjectPublication(projectId);
  }

  markProjectPublicationDirty(projectId: string, immediate = false): void {
    const publication = this.getProjectPublication(projectId);
    if (publication) this.markPublicationTargetDirty(publication.target_id, immediate);
  }

  markPublicationTargetDirty(
    targetId: string,
    immediate = false,
    operation: "publish" | "remove" = "publish",
  ): number {
    return this.raw.transaction(() => {
      const now = new Date();
      this.raw
        .prepare(
          "UPDATE publication_targets SET dirty_revision=dirty_revision+1,updated_at=? WHERE id=?",
        )
        .run(now.toISOString(), targetId);
      const target = this.getPublicationTarget(targetId);
      if (!target) throw new Error("Publication target not found");
      if (immediate || target.schedule_mode === "on_change") {
        const available = immediate ? now : new Date(now.getTime() + 60_000);
        this.enqueuePublication(targetId, operation, immediate, available.toISOString());
      }
      return target.dirty_revision;
    })();
  }

  enqueuePublication(
    targetId: string,
    operation: "publish" | "remove" = "publish",
    immediate = true,
    availableAt = new Date().toISOString(),
  ): string {
    const target = this.getPublicationTarget(targetId);
    if (!target) throw new Error("Publication target not found");
    return this.raw.transaction(() => {
      const existing = this.raw
        .prepare("SELECT * FROM publication_jobs WHERE target_id=? AND status='queued'")
        .get(targetId) as PublicationJobRow | undefined;
      const now = new Date().toISOString();
      if (existing) {
        const availability = immediate
          ? availableAt
          : existing.available_at < availableAt
            ? availableAt
            : existing.available_at;
        this.raw
          .prepare(
            "UPDATE publication_jobs SET operation=?,desired_revision=?,available_at=?,error=NULL,updated_at=? WHERE id=?",
          )
          .run(operation, target.dirty_revision, availability, now, existing.id);
        return existing.id;
      }
      const id = randomUUID();
      this.raw
        .prepare(
          `INSERT INTO publication_jobs(id,target_id,status,operation,desired_revision,attempts,max_attempts,available_at,created_at,updated_at)
          VALUES (?,?,'queued',?,?,0,5,?,?,?)`,
        )
        .run(id, targetId, operation, target.dirty_revision, availableAt, now, now);
      return id;
    })();
  }

  claimPublicationJob(leaseSeconds = 300, now = new Date()): PublicationJobRow | undefined {
    return this.raw.transaction(() => {
      this.raw
        .prepare(
          "UPDATE publication_jobs SET status='queued',lease_token=NULL,lease_expires_at=NULL,available_at=?,updated_at=? WHERE status IN ('building','deploying') AND lease_expires_at<=?",
        )
        .run(now.toISOString(), now.toISOString(), now.toISOString());
      const candidate = this.raw
        .prepare(
          `SELECT pj.* FROM publication_jobs pj WHERE pj.status='queued' AND pj.available_at<=?
          AND NOT EXISTS (SELECT 1 FROM project_publications pp JOIN jobs j ON j.project_id=pp.project_id
            WHERE pp.target_id=pj.target_id AND j.status IN ('queued','leased'))
          ORDER BY CASE pj.operation WHEN 'remove' THEN 0 ELSE 1 END,pj.available_at LIMIT 1`,
        )
        .get(now.toISOString()) as PublicationJobRow | undefined;
      if (!candidate) return undefined;
      const token = randomToken(24);
      const expires = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      this.raw
        .prepare(
          "UPDATE publication_jobs SET status='building',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=?",
        )
        .run(token, expires, now.toISOString(), candidate.id);
      return this.raw
        .prepare("SELECT * FROM publication_jobs WHERE id=?")
        .get(candidate.id) as PublicationJobRow;
    })();
  }

  setPublicationJobDeploying(id: string, leaseToken: string): boolean {
    return (
      this.raw
        .prepare(
          "UPDATE publication_jobs SET status='deploying',updated_at=? WHERE id=? AND lease_token=?",
        )
        .run(new Date().toISOString(), id, leaseToken).changes === 1
    );
  }

  renewPublicationLease(id: string, leaseToken: string, leaseSeconds = 300): boolean {
    const now = new Date();
    return (
      this.raw
        .prepare(
          "UPDATE publication_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_token=? AND status IN ('building','deploying')",
        )
        .run(
          new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
          now.toISOString(),
          id,
          leaseToken,
        ).changes === 1
    );
  }

  completePublicationJob(
    job: PublicationJobRow,
    result: { deploymentId: string | null; deploymentUrl: string; manifest: unknown },
  ): void {
    this.raw.transaction(() => {
      const now = new Date().toISOString();
      this.raw
        .prepare(
          "UPDATE publication_jobs SET status='succeeded',deployment_id=?,deployment_url=?,lease_token=NULL,lease_expires_at=NULL,error=NULL,updated_at=? WHERE id=?",
        )
        .run(result.deploymentId, result.deploymentUrl, now, job.id);
      this.raw
        .prepare(
          "UPDATE publication_targets SET published_revision=max(published_revision,?),updated_at=? WHERE id=?",
        )
        .run(job.desired_revision, now, job.target_id);
      this.raw
        .prepare(
          "INSERT INTO publication_manifests(id,target_id,revision,deployment_id,deployment_url,manifest_json,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          job.target_id,
          job.desired_revision,
          result.deploymentId,
          result.deploymentUrl,
          JSON.stringify(result.manifest),
          now,
        );
      this.raw
        .prepare(
          "UPDATE project_publications SET state='active',last_successful_revision=?,last_published_at=?,last_error=NULL,updated_at=? WHERE target_id=? AND state NOT IN ('removal_pending','removal_failed')",
        )
        .run(job.desired_revision, now, now, job.target_id);
      this.raw
        .prepare("DELETE FROM project_publications WHERE target_id=? AND detach_after_removal=1")
        .run(job.target_id);
      this.raw
        .prepare(
          "UPDATE project_publications SET state='active',last_error=NULL,updated_at=? WHERE target_id=? AND state='removal_pending'",
        )
        .run(now, job.target_id);
      const target = this.getPublicationTarget(job.target_id)!;
      if (target.dirty_revision > job.desired_revision)
        this.enqueuePublication(job.target_id, "publish", true, now);
    })();
  }

  failPublicationJob(job: PublicationJobRow, error: string): boolean {
    const now = new Date();
    if (job.attempts >= job.max_attempts) {
      this.raw
        .prepare(
          "UPDATE publication_jobs SET status='failed',error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
        )
        .run(error, now.toISOString(), job.id);
      this.raw
        .prepare(
          "UPDATE project_publications SET state=CASE WHEN state='removal_pending' THEN 'removal_failed' ELSE state END,last_error=?,updated_at=? WHERE target_id=?",
        )
        .run(error, now.toISOString(), job.target_id);
      return false;
    }
    const delay = Math.min(15 * 60_000, 2 ** Math.max(0, job.attempts - 1) * 5_000);
    this.raw
      .prepare(
        "UPDATE publication_jobs SET status='queued',error=?,available_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
      )
      .run(error, new Date(now.getTime() + delay).toISOString(), now.toISOString(), job.id);
    return true;
  }

  listPublicationJobs(targetId: string, limit = 50): PublicationJobRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM publication_jobs WHERE target_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?",
      )
      .all(targetId, limit) as PublicationJobRow[];
  }

  latestPublicationManifest(targetId: string): PublicationManifestRow | undefined {
    return this.raw
      .prepare(
        "SELECT * FROM publication_manifests WHERE target_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(targetId) as PublicationManifestRow | undefined;
  }

  listDuePublicationTargets(now = new Date().toISOString()): PublicationTargetRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM publication_targets WHERE schedule_mode IN ('hourly','daily','weekly','custom')
        AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at`,
      )
      .all(now) as PublicationTargetRow[];
  }

  setPublicationNextRun(targetId: string, nextRunAt: string | null): void {
    this.raw
      .prepare("UPDATE publication_targets SET next_run_at=?,updated_at=? WHERE id=?")
      .run(nextRunAt, new Date().toISOString(), targetId);
  }

  hasActiveProjectJobsForTarget(targetId: string): boolean {
    return Boolean(
      this.raw
        .prepare(
          `SELECT 1 FROM project_publications pp JOIN jobs j ON j.project_id=pp.project_id
          WHERE pp.target_id=? AND j.status IN ('queued','leased') LIMIT 1`,
        )
        .get(targetId),
    );
  }

  createWebhook(
    projectId: string,
    url: string,
    secretEncrypted: string,
    threshold: number,
    events: string[],
  ): WebhookRow {
    const now = new Date().toISOString();
    const row: WebhookRow = {
      id: randomUUID(),
      project_id: projectId,
      url,
      secret_encrypted: secretEncrypted,
      threshold,
      events_json: JSON.stringify(events),
      enabled: 1,
      created_at: now,
      updated_at: now,
    };
    this.raw
      .prepare(
        "INSERT INTO webhooks(id,project_id,url,secret_encrypted,threshold,events_json,enabled,created_at,updated_at) VALUES (@id,@project_id,@url,@secret_encrypted,@threshold,@events_json,@enabled,@created_at,@updated_at)",
      )
      .run(row);
    return row;
  }
  listWebhooks(projectId: string): WebhookRow[] {
    return this.raw
      .prepare("SELECT * FROM webhooks WHERE project_id=? ORDER BY created_at")
      .all(projectId) as WebhookRow[];
  }
  getWebhook(id: string): WebhookRow | undefined {
    return this.raw.prepare("SELECT * FROM webhooks WHERE id=?").get(id) as WebhookRow | undefined;
  }
  updateWebhook(
    id: string,
    input: Partial<Pick<WebhookRow, "url" | "threshold" | "events_json" | "enabled">>,
  ): WebhookRow | undefined {
    const current = this.getWebhook(id);
    if (!current) return undefined;
    this.raw
      .prepare(
        "UPDATE webhooks SET url=?,threshold=?,events_json=?,enabled=?,updated_at=? WHERE id=?",
      )
      .run(
        input.url ?? current.url,
        input.threshold ?? current.threshold,
        input.events_json ?? current.events_json,
        input.enabled ?? current.enabled,
        new Date().toISOString(),
        id,
      );
    return this.getWebhook(id);
  }
  rotateWebhookSecret(id: string, secretEncrypted: string): boolean {
    return (
      this.raw
        .prepare("UPDATE webhooks SET secret_encrypted=?,updated_at=? WHERE id=?")
        .run(secretEncrypted, new Date().toISOString(), id).changes > 0
    );
  }
  deleteWebhook(id: string): boolean {
    return this.raw.prepare("DELETE FROM webhooks WHERE id=?").run(id).changes > 0;
  }
  enqueueWebhookTest(webhookId: string, payload: unknown): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.raw
      .prepare(
        "INSERT INTO webhook_deliveries(id,webhook_id,event,payload_json,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?, 'webhook.test',?, 'queued',0,?,?,?)",
      )
      .run(id, webhookId, JSON.stringify(payload), now, now, now);
    return id;
  }
  listWebhookDeliveries(webhookId: string, limit = 20): WebhookDeliveryRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM webhook_deliveries WHERE webhook_id=? ORDER BY created_at DESC LIMIT ?",
      )
      .all(webhookId, limit) as WebhookDeliveryRow[];
  }
  enqueueWebhookDeliveries(
    projectId: string,
    event: string,
    payload: unknown,
    changePercent: number | null,
  ): void {
    const hooks = this.listWebhooks(projectId).filter(
      (hook) =>
        hook.enabled &&
        JSON.parse(hook.events_json).includes(event) &&
        (event !== "capture.changed" || (changePercent ?? 0) >= hook.threshold),
    );
    const now = new Date().toISOString();
    const insert = this.raw.prepare(
      "INSERT INTO webhook_deliveries(id,webhook_id,event,payload_json,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?, 'queued',0,?,?,?)",
    );
    for (const hook of hooks)
      insert.run(randomUUID(), hook.id, event, JSON.stringify(payload), now, now, now);
  }
  claimWebhookDelivery():
    | {
        id: string;
        webhook_id: string;
        event: string;
        payload_json: string;
        attempts: number;
        url: string;
        secret_encrypted: string;
      }
    | undefined {
    const row = this.raw
      .prepare(
        `SELECT d.id,d.webhook_id,d.event,d.payload_json,d.attempts,w.url,w.secret_encrypted
      FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
      WHERE d.status='queued' AND d.attempts<5 AND d.next_attempt_at<=? AND w.enabled=1 ORDER BY d.created_at LIMIT 1`,
      )
      .get(new Date().toISOString()) as
      | {
          id: string;
          webhook_id: string;
          event: string;
          payload_json: string;
          attempts: number;
          url: string;
          secret_encrypted: string;
        }
      | undefined;
    if (row)
      this.raw
        .prepare(
          "UPDATE webhook_deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), row.id);
    return row;
  }
  finishWebhookDelivery(
    id: string,
    ok: boolean,
    responseStatus: number | null,
    error: string | null,
    attempts: number,
  ): void {
    const now = new Date();
    if (ok || attempts + 1 >= 5) {
      this.raw
        .prepare(
          "UPDATE webhook_deliveries SET status=?,response_status=?,error=?,updated_at=? WHERE id=?",
        )
        .run(ok ? "succeeded" : "failed", responseStatus, error, now.toISOString(), id);
    } else {
      const next = new Date(
        now.getTime() + Math.min(3_600_000, 2 ** attempts * 30_000),
      ).toISOString();
      this.raw
        .prepare(
          "UPDATE webhook_deliveries SET status='queued',response_status=?,error=?,next_attempt_at=?,updated_at=? WHERE id=?",
        )
        .run(responseStatus, error, next, now.toISOString(), id);
    }
  }

  listDueProjects(now = new Date().toISOString()): ProjectRow[] {
    return this.raw
      .prepare("SELECT * FROM projects WHERE schedule_enabled=1 AND next_run_at<=?")
      .all(now) as ProjectRow[];
  }
  setNextRun(projectId: string, next: string): void {
    this.raw
      .prepare("UPDATE projects SET next_run_at=?,updated_at=? WHERE id=?")
      .run(next, new Date().toISOString(), projectId);
  }
}
