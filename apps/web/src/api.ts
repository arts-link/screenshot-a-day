import type {
  CaptureProfileInput,
  CaptureRecord,
  ProjectSummary,
  VersionInfo,
} from "@sad/contracts";
import type { CaptureRun } from "./capture-action";

export interface Profile {
  id: string;
  name: string;
  browser: string;
  settings: CaptureProfileInput;
}
export interface ProjectDetail extends ProjectSummary {
  profiles: Profile[];
  publishMode: "private" | "unlisted" | "indexable";
  scheduleExpression: string;
  scheduleTimezone: string;
  retentionDays: number | null;
  retentionCount: number | null;
  staticPublication: StaticPublication | null;
}
export interface StaticPublication {
  targetId: string;
  targetName: string;
  targetAdapter: "vercel" | "netlify" | "sftp";
  url: string;
  state: "pending" | "active" | "removal_pending" | "removal_failed";
  pending: boolean;
  active: boolean;
  lastPublishedAt: string | null;
  lastSuccessfulRevision: number;
  lastError: string | null;
  removalWarning: string | null;
  latestJob: PublicationJobSummary | null;
}
export type PublicationJobStatus = "queued" | "building" | "deploying" | "succeeded" | "failed";
export interface PublicationJobSummary {
  id: string;
  status: PublicationJobStatus;
  operation: "publish" | "remove";
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PublicationTarget {
  id: string;
  name: string;
  adapter: "vercel" | "netlify" | "sftp";
  baseUrl: string;
  branding: {
    title: string;
    description: string;
    logoText: string | null;
    logoUrl: string | null;
    tagline: string;
    accentColor: string;
    backgroundColor: string;
    darkMode: boolean;
    supplementalFooter: string;
    analytics:
      | { provider: "none" }
      | { provider: "plausible"; domain: string }
      | { provider: "posthog"; apiKey: string; host: string };
  };
  scheduleMode: "manual" | "on_change" | "hourly" | "daily" | "weekly" | "custom";
  scheduleExpression: string | null;
  scheduleTimezone: string;
  adapterConfig: Record<string, unknown>;
  credentialConfigured: boolean;
  dirtyRevision: number;
  publishedRevision: number;
  nextRunAt: string | null;
  lastVerifiedAt: string | null;
  lastVerificationError: string | null;
  state: string;
  latestJob: PublicationJobSummary | null;
  projectCount: number;
  createdAt: string;
}
export interface PublicGallery {
  project: { id: string; name: string; slug: string; publishMode: string; profiles: Profile[] };
  captures: CaptureRecord[];
}
export interface Comparison {
  first: CaptureRecord;
  second: CaptureRecord;
  changePercent: number;
  exactMatch: boolean;
  diffDataUrl: string;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  setupStatus: () => request<{ configured: boolean }>("/api/v1/setup/status"),
  setup: (input: { token: string; email: string; password: string }) =>
    request("/api/v1/setup", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<{ authenticated: boolean }>("/api/v1/auth/me"),
  version: () => request<VersionInfo>("/version"),
  projects: () => request<ProjectSummary[]>("/api/v1/projects"),
  project: (id: string) => request<ProjectDetail>(`/api/v1/projects/${id}`),
  createProject: (input: unknown) =>
    request<ProjectDetail>("/api/v1/projects", { method: "POST", body: JSON.stringify(input) }),
  captures: (id: string) => request<CaptureRecord[]>(`/api/v1/projects/${id}/captures?limit=200`),
  runs: (id: string) => request<CaptureRun[]>(`/api/v1/projects/${id}/runs`),
  trigger: (id: string, idempotencyKey: string) =>
    request<{ runId: string }>(`/api/v1/projects/${id}/runs`, {
      method: "POST",
      body: "{}",
      headers: { "idempotency-key": idempotencyKey },
    }),
  publication: (id: string, publishMode: string, rotate = false) =>
    request<{ publishMode: string; shareToken: string | null }>(
      `/api/v1/projects/${id}/publication`,
      { method: "PATCH", body: JSON.stringify({ publishMode, rotate }) },
    ),
  publicationStatus: () =>
    request<{ available: boolean; error: string | null }>("/api/v1/publication/status"),
  publicationTargets: () => request<PublicationTarget[]>("/api/v1/publication-targets"),
  createPublicationTarget: (input: unknown) =>
    request<PublicationTarget>("/api/v1/publication-targets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePublicationTarget: (id: string, input: unknown) =>
    request<PublicationTarget>(`/api/v1/publication-targets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  replacePublicationTargetCredentials: (id: string, input: unknown) =>
    request(`/api/v1/publication-targets/${id}/credentials`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deletePublicationTarget: (id: string) =>
    request(`/api/v1/publication-targets/${id}`, { method: "DELETE" }),
  verifyPublicationTarget: (id: string) =>
    request<{ verified: boolean; verifiedAt: string }>(`/api/v1/publication-targets/${id}/verify`, {
      method: "POST",
    }),
  publishTarget: (id: string) =>
    request<{ jobId: string }>(`/api/v1/publication-targets/${id}/publish`, { method: "POST" }),
  publicationHistory: (id: string) =>
    request<
      Array<{
        id: string;
        status: string;
        operation: string;
        error: string | null;
        createdAt: string;
      }>
    >(`/api/v1/publication-targets/${id}/history`),
  attachStaticPublication: (projectId: string, targetId: string) =>
    request<StaticPublication>(`/api/v1/projects/${projectId}/static-publication`, {
      method: "PUT",
      body: JSON.stringify({ targetId }),
    }),
  detachStaticPublication: (projectId: string, force = false) =>
    request<{ state?: string; detached?: boolean; warning: string }>(
      `/api/v1/projects/${projectId}/static-publication${force ? "?force=true" : ""}`,
      { method: "DELETE" },
    ),
  compare: (firstId: string, secondId: string) =>
    request<Comparison>("/api/v1/comparisons", {
      method: "POST",
      body: JSON.stringify({ firstId, secondId }),
    }),
  createExport: (projectId: string, profileId: string, format: "gif" | "webm") =>
    request(`/api/v1/projects/${projectId}/profiles/${profileId}/exports`, {
      method: "POST",
      body: JSON.stringify({ format }),
    }),
  updateProject: (id: string, input: unknown) =>
    request<ProjectDetail>(`/api/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  replaceCredentials: (id: string, input: unknown) =>
    request(`/api/v1/projects/${id}/credentials`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  addProfile: (projectId: string, input: CaptureProfileInput) =>
    request<Profile>(`/api/v1/projects/${projectId}/profiles`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProfile: (projectId: string, profileId: string, input: CaptureProfileInput) =>
    request<Profile>(`/api/v1/projects/${projectId}/profiles/${profileId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  tokens: () =>
    request<Array<{ id: string; name: string; scopes: string[]; created_at: string }>>(
      "/api/v1/tokens",
    ),
  createToken: (input: unknown) =>
    request<{ id: string; token: string }>("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteToken: (id: string) => request(`/api/v1/tokens/${id}`, { method: "DELETE" }),
  storage: () =>
    request<{ bytes: number; files: number; databaseBytes: number }>("/api/v1/storage"),
  webhooks: (projectId: string) =>
    request<Array<{ id: string; url: string; threshold: number; events: string[] }>>(
      `/api/v1/projects/${projectId}/webhooks`,
    ),
  createWebhook: (projectId: string, input: unknown) =>
    request<{ id: string; secret: string }>(`/api/v1/projects/${projectId}/webhooks`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  publicGallery: (mode: "p" | "s", value: string) =>
    request<PublicGallery>(`/api/public/${mode}/${value}`),
  publicCompare: (mode: "p" | "s", value: string, firstId: string, secondId: string) =>
    request<Comparison>(`/api/public/${mode}/${value}/comparisons`, {
      method: "POST",
      body: JSON.stringify({ firstId, secondId }),
    }),
};
