import type { CaptureRecord } from "@sad/contracts";
import type { AppDatabase, CaptureRow, ProjectRow, PublicationJobRow } from "./database.js";

export function captureDto(row: CaptureRow): CaptureRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    profileId: row.profile_id,
    runId: row.run_id,
    status: row.status,
    capturedAt: row.captured_at,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    changePercent: row.change_percent,
    imageUrl: row.image_key ? `/api/v1/captures/${row.id}/image` : null,
    thumbnailUrl: row.thumbnail_key ? `/api/v1/captures/${row.id}/thumbnail` : null,
    error: row.error,
  };
}

export function publicProject(project: ProjectRow, db: AppDatabase) {
  const profiles = db.listProfiles(project.id).map((profile) => ({
    id: profile.id,
    name: profile.name,
    browser: profile.browser,
    settings: JSON.parse(profile.settings_json),
  }));
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    publishMode: project.publish_mode,
    profiles,
  };
}

function publicationJobSummary(job: PublicationJobRow) {
  return {
    id: job.id,
    status: job.status,
    operation: job.operation,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export function projectPublicationDto(project: ProjectRow, db: AppDatabase) {
  const publication = db.getProjectPublication(project.id);
  if (!publication) return null;
  const target = db.getPublicationTarget(publication.target_id);
  const latestJob = db.listPublicationJobs(publication.target_id, 1)[0];
  return {
    targetId: publication.target_id,
    targetName: target?.name ?? "Unknown target",
    targetAdapter: target?.adapter ?? "vercel",
    url: publication.gallery_url,
    state: publication.state,
    pending: publication.state !== "active",
    active: publication.state === "active" && project.publish_mode !== "private",
    lastPublishedAt: publication.last_published_at,
    lastSuccessfulRevision: publication.last_successful_revision,
    lastError: publication.last_error,
    removalWarning:
      publication.state === "removal_pending" || publication.state === "removal_failed"
        ? "Remote files may remain available until removal succeeds."
        : null,
    latestJob: latestJob ? publicationJobSummary(latestJob) : null,
  };
}
