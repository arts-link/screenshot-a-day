import type { PublicationJobSummary, StaticPublication } from "./api";

const IN_FLIGHT = new Set(["queued", "building", "deploying"]);

export function publicationInFlight(publication?: StaticPublication | null): boolean {
  return publicationJobInFlight(publication?.latestJob);
}

export function publicationJobInFlight(job?: PublicationJobSummary | null): boolean {
  return Boolean(job && IN_FLIGHT.has(job.status));
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
