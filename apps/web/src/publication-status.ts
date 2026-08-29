import type { PublicationJobSummary, PublicationTarget, StaticPublication } from "./api";

const IN_FLIGHT = new Set(["queued", "building", "deploying"]);

export function publicationInFlight(publication?: StaticPublication | null): boolean {
  return publicationJobInFlight(publication?.latestJob);
}

export function publicationJobInFlight(job?: PublicationJobSummary | null): boolean {
  return Boolean(job && IN_FLIGHT.has(job.status));
}

export type PublicationTargetPhase =
  "ready" | "changes" | "queued" | "building" | "deploying" | "published" | "failed";

export interface PublicationTargetStatus {
  phase: PublicationTargetPhase;
  label: string;
  busy: boolean;
  headline: string;
  detail: string;
}

export interface PublicationVerificationFeedback {
  ok: boolean;
  checkedAt: string;
  message?: string;
}

export interface PublicationVerificationStatus {
  phase: "checking" | "verified" | "failed";
  headline: string;
  detail: string;
  checkedAt: string | null;
}

function publicationAdapterLabel(adapter: PublicationTarget["adapter"]): string {
  return adapter === "sftp" ? "SFTP" : `${adapter.charAt(0).toUpperCase()}${adapter.slice(1)}`;
}

export function publicationVerificationStatus(
  target: PublicationTarget,
  checking: boolean,
  feedback?: PublicationVerificationFeedback,
): PublicationVerificationStatus | undefined {
  const destination = publicationAdapterLabel(target.adapter);
  if (checking) {
    return {
      phase: "checking",
      headline: "Checking destination",
      detail: `Testing the saved credentials and opening ${target.baseUrl}.`,
      checkedAt: null,
    };
  }
  if (feedback) {
    return feedback.ok
      ? {
          phase: "verified",
          headline: "Destination verified",
          detail: `${destination} accepted the saved credentials and the published URL responded successfully.`,
          checkedAt: feedback.checkedAt,
        }
      : {
          phase: "failed",
          headline: "Destination could not be verified",
          detail: feedback.message ?? `${destination} rejected the connection check.`,
          checkedAt: feedback.checkedAt,
        };
  }
  if (target.lastVerificationError) {
    return {
      phase: "failed",
      headline: "Destination needs attention",
      detail: target.lastVerificationError,
      checkedAt: null,
    };
  }
  if (target.lastVerifiedAt) {
    return {
      phase: "verified",
      headline: "Destination verified",
      detail: `${destination} accepted the saved credentials and the published URL responded successfully.`,
      checkedAt: target.lastVerifiedAt,
    };
  }
  return undefined;
}

export function publicationTargetStatus(target: PublicationTarget): PublicationTargetStatus {
  const job = target.latestJob;
  if (job && IN_FLIGHT.has(job.status)) {
    const destination = publicationAdapterLabel(target.adapter);
    const status = {
      queued: {
        headline: "Publication queued",
        detail: "Waiting for active capture work to finish and for the publisher to become free.",
      },
      building: {
        headline: "Building static gallery",
        detail: "Rendering gallery pages and preparing capture assets.",
      },
      deploying: {
        headline: `Deploying to ${destination}`,
        detail: `Sending the prepared gallery to ${destination}.`,
      },
    }[job.status as "queued" | "building" | "deploying"];
    return {
      phase: job.status as "queued" | "building" | "deploying",
      label: status.headline,
      busy: true,
      ...status,
    };
  }

  if (job?.status === "failed") {
    return {
      phase: "failed",
      label: "Publish failed",
      busy: false,
      headline: "Publication failed",
      detail: job.error ?? "The destination did not accept this publication.",
    };
  }

  if (target.dirtyRevision > target.publishedRevision) {
    return {
      phase: "changes",
      label: "Unpublished changes",
      busy: false,
      headline: "Changes ready to publish",
      detail: "The generated gallery differs from the last successful deployment.",
    };
  }

  if (job?.status === "succeeded") {
    return {
      phase: "published",
      label: "Published",
      busy: false,
      headline: "Publication complete",
      detail: "The destination is up to date.",
    };
  }

  return {
    phase: "ready",
    label: target.projectCount ? "Published" : "Ready",
    busy: false,
    headline: target.projectCount ? "Publication is current" : "Target ready",
    detail: target.projectCount
      ? "The destination is up to date."
      : "Attach a project when you are ready to publish.",
  };
}

export function publicationTargetActionLabel(
  submitting: boolean,
  status: PublicationTargetStatus,
): string {
  if (submitting) return "Queueing…";
  if (status.phase === "queued") return "Queued…";
  if (status.phase === "building") return "Building…";
  if (status.phase === "deploying") return "Deploying…";
  if (status.phase === "failed") return "Retry publish →";
  return "Publish now →";
}

export function formatPublicationElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m elapsed`;
}

export function publicationStatus(publication: StaticPublication, publishMode: string) {
  const job = publication.latestJob;
  const removing =
    publication.state === "removal_pending" || publication.state === "removal_failed";

  if (job && IN_FLIGHT.has(job.status)) {
    const messages = removing
      ? {
          queued: "Remote removal queued",
          building: "Preparing remote cleanup",
          deploying: `Removing gallery from ${publication.targetName}`,
        }
      : {
          queued: "Publish queued",
          building: "Building static gallery",
          deploying: `Deploying to ${publication.targetName}`,
        };
    return {
      busy: true,
      value: job.status,
      message: messages[job.status as keyof typeof messages],
    };
  }

  if (publication.state === "removal_failed" || job?.status === "failed") {
    return {
      busy: false,
      value: "failed",
      message: removing ? "Remote removal failed" : "Static publication failed",
    };
  }

  if (publishMode === "private") {
    return {
      busy: false,
      value: "ready",
      message: `Private and synchronized with ${publication.targetName}`,
    };
  }

  if (publication.active) {
    return { busy: false, value: "active", message: `Live on ${publication.targetName}` };
  }

  return { busy: false, value: "pending", message: "Waiting to publish" };
}
