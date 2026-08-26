import { describe, expect, it } from "vitest";
import type { StaticPublication } from "../src/api";
import { publicationInFlight, publicationStatus } from "../src/publication-status";

function fixture(overrides: Partial<StaticPublication> = {}): StaticPublication {
  return {
    targetId: "target-1",
    targetName: "Gallery host",
    targetAdapter: "vercel",
    url: "https://history.example.com/p/example/",
    state: "active",
    pending: false,
    active: true,
    lastPublishedAt: "2026-08-26T00:00:00.000Z",
    lastSuccessfulRevision: 2,
    lastError: null,
    removalWarning: null,
    latestJob: null,
    ...overrides,
  };
}

describe("publication status", () => {
  it("describes active publication and private synchronization", () => {
    expect(publicationStatus(fixture(), "indexable")).toMatchObject({
      value: "active",
      message: "Live on Gallery host",
    });
    expect(publicationStatus(fixture({ active: false }), "private")).toMatchObject({
      value: "ready",
      message: "Private and synchronized with Gallery host",
    });
  });

  it("keeps polling and reports each publishing phase", () => {
    const publication = fixture({
      latestJob: {
        id: "job-1",
        operation: "publish",
        status: "deploying",
        error: null,
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:01.000Z",
      },
    });
    expect(publicationInFlight(publication)).toBe(true);
    expect(publicationStatus(publication, "indexable")).toMatchObject({
      busy: true,
      value: "deploying",
      message: "Deploying to Gallery host",
    });
  });

  it("uses removal copy for pending and failed cleanup", () => {
    const publication = fixture({
      state: "removal_failed",
      active: false,
      latestJob: {
        id: "job-2",
        operation: "remove",
        status: "failed",
        error: "Invalid token",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:01.000Z",
      },
    });
    expect(publicationInFlight(publication)).toBe(false);
    expect(
      publicationInFlight(fixture({ state: "pending", latestJob: publication.latestJob })),
    ).toBe(false);
    expect(publicationStatus(publication, "private")).toMatchObject({
      value: "failed",
      message: "Remote removal failed",
    });
  });
});
