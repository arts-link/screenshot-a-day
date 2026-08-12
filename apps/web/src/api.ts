import type {
  CaptureProfileInput,
  CaptureRecord,
  ProjectSummary,
  VersionInfo,
} from "@sad/contracts";

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
  runs: (id: string) => request<Array<Record<string, unknown>>>(`/api/v1/projects/${id}/runs`),
  trigger: (id: string) =>
    request<{ runId: string }>(`/api/v1/projects/${id}/runs`, { method: "POST", body: "{}" }),
  publication: (id: string, publishMode: string, rotate = false) =>
    request<{ publishMode: string; shareToken: string | null }>(
      `/api/v1/projects/${id}/publication`,
      { method: "PATCH", body: JSON.stringify({ publishMode, rotate }) },
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
