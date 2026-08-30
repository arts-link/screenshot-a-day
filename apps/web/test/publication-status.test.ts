import { describe, expect, it } from "vitest";
import type { PublicationTarget, StaticPublication } from "../src/api";
import {
  formatPublicationElapsed,
  projectPublicationActionLabel,
  publicationInFlight,
  publicationStatus,
  publicationTargetActionLabel,
  publicationTargetStatus,
  publicationVerificationStatus,
} from "../src/publication-status";

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

function targetFixture(overrides: Partial<PublicationTarget> = {}): PublicationTarget {
  return {
    id: "target-1",
    name: "Gallery host",
    adapter: "vercel",
    baseUrl: "https://history.example.com",
    branding: {
      title: "History",
      description: "",
      logoText: null,
      logoUrl: null,
      tagline: "",
      accentColor: "#dbff53",
      backgroundColor: "#10151d",
      darkMode: true,
      supplementalFooter: "",
      analytics: { provider: "none" },
    },
    scheduleMode: "manual",
    scheduleExpression: null,
    scheduleTimezone: "UTC",
    adapterConfig: {},
    credentialConfigured: true,
    dirtyRevision: 2,
    publishedRevision: 1,
    nextRunAt: null,
    lastVerifiedAt: null,
    lastVerificationError: null,
    state: "dirty",
    latestJob: null,
    projectCount: 2,
    createdAt: "2026-08-26T00:00:00.000Z",
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

  it.each([
    ["queued", "Publication queued", "Queued…"],
    ["building", "Building static gallery", "Building…"],
    ["deploying", "Deploying to Gallery host", "Deploying…"],
  ] as const)("keeps polling and describes the %s phase", (phase, headline, actionLabel) => {
    const publication = fixture({
      latestJob: {
        id: "job-1",
        operation: "publish",
        status: phase,
        error: null,
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:01.000Z",
      },
    });
    const status = publicationStatus(publication, "indexable");
    expect(publicationInFlight(publication)).toBe(true);
    expect(status).toMatchObject({ busy: true, value: phase, headline });
    expect(projectPublicationActionLabel(false, status)).toBe(actionLabel);
  });

  it("keeps a publication failure visible and offers a retry", () => {
    const status = publicationStatus(
      fixture({
        active: false,
        state: "failed",
        latestJob: {
          id: "job-2",
          operation: "publish",
          status: "failed",
          error: "Destination timed out",
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:05:00.000Z",
        },
      }),
      "indexable",
    );
    expect(status).toMatchObject({
      value: "failed",
      headline: "Static publication failed",
      detail: "Destination timed out",
    });
    expect(projectPublicationActionLabel(false, status)).toBe("Retry publish →");
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

describe("publication target status", () => {
  it("calls a revision gap unpublished changes instead of dirty", () => {
    expect(publicationTargetStatus(targetFixture())).toMatchObject({
      phase: "changes",
      label: "Unpublished changes",
      headline: "Changes ready to publish",
    });
  });

  it.each([
    ["queued", "Publication queued", "Queued…"],
    ["building", "Building static gallery", "Building…"],
    ["deploying", "Deploying to Vercel", "Deploying…"],
  ] as const)("describes the %s phase", (phase, headline, actionLabel) => {
    const status = publicationTargetStatus(
      targetFixture({
        latestJob: {
          id: "job-1",
          operation: "publish",
          status: phase,
          error: null,
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:00:01.000Z",
        },
      }),
    );
    expect(status).toMatchObject({ phase, headline, busy: true });
    expect(publicationTargetActionLabel(false, status)).toBe(actionLabel);
  });

  it("keeps failure detail visible and offers a retry", () => {
    const status = publicationTargetStatus(
      targetFixture({
        latestJob: {
          id: "job-2",
          operation: "publish",
          status: "failed",
          error: "Destination timed out",
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:05:00.000Z",
        },
      }),
    );
    expect(status).toMatchObject({
      phase: "failed",
      label: "Publish failed",
      detail: "Destination timed out",
    });
    expect(publicationTargetActionLabel(false, status)).toBe("Retry publish →");
  });

  it("formats elapsed time without implying a false completion estimate", () => {
    expect(formatPublicationElapsed(5)).toBe("5s elapsed");
    expect(formatPublicationElapsed(125)).toBe("2m 5s elapsed");
    expect(formatPublicationElapsed(3_725)).toBe("1h 2m elapsed");
  });
});

describe("publication target verification", () => {
  it("keeps a successful verification readable with its checked time", () => {
    expect(
      publicationVerificationStatus(targetFixture(), false, {
        ok: true,
        checkedAt: "2026-08-29T08:00:00.000Z",
      }),
    ).toEqual({
      phase: "verified",
      headline: "Destination verified",
      detail: "Vercel accepted the saved credentials and the published URL responded successfully.",
      checkedAt: "2026-08-29T08:00:00.000Z",
    });
  });

  it("shows an explicit in-progress state until verification finishes", () => {
    expect(publicationVerificationStatus(targetFixture(), true)).toMatchObject({
      phase: "checking",
      headline: "Checking destination",
      detail: "Testing the saved credentials and opening https://history.example.com.",
    });
  });

  it("keeps failure detail available for the next action", () => {
    expect(
      publicationVerificationStatus(targetFixture(), false, {
        ok: false,
        checkedAt: "2026-08-29T08:00:00.000Z",
        message: "Invalid access token",
      }),
    ).toMatchObject({
      phase: "failed",
      headline: "Destination could not be verified",
      detail: "Invalid access token",
    });
  });
});
