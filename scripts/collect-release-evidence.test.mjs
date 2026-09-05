import { describe, expect, it } from "vitest";
import {
  assessPrGate,
  assessReleaseFiles,
  parseEvidenceOptions,
  parseSignoffLog,
  selectCiRun,
} from "./collect-release-evidence.mjs";

describe("release evidence options", () => {
  it("parses an explicit final evidence run", () => {
    expect(
      parseEvidenceOptions(
        [
          "--phase",
          "final",
          "--expected-sha",
          "a".repeat(40),
          "--validation-source",
          "ci",
          "--skip-containers",
        ],
        {},
        "/srv/sad",
      ),
    ).toMatchObject({
      phase: "final",
      expectedSha: "a".repeat(40),
      validationSource: "ci",
      skipContainers: true,
      outputRoot: "/srv/sad/release-evidence",
    });
  });

  it("accepts pnpm's forwarded option separator", () => {
    expect(parseEvidenceOptions(["--", "--phase", "pr"], {})).toMatchObject({ phase: "pr" });
  });

  it("requires a pinned full SHA for final evidence", () => {
    expect(() => parseEvidenceOptions(["--phase", "final"], {})).toThrow(/expected-sha/);
    expect(() =>
      parseEvidenceOptions(["--phase", "final", "--expected-sha", "be6d66a"], {}),
    ).toThrow(/40-character/);
  });

  it("rejects phase-specific options in a PR run", () => {
    expect(() => parseEvidenceOptions(["--phase", "pr", "--validation-source", "ci"], {})).toThrow(
      /only valid/,
    );
  });
});

describe("commit sign-off evidence", () => {
  it("requires a trailer matching the commit author", () => {
    const parsed = parseSignoffLog(
      `abc\u001fBen Example\u001fben@example.com\u001fBen Example <ben@example.com>\u001e` +
        `def\u001fAda Example\u001fada@example.com\u001fSomeone Else <else@example.com>\u001e`,
    );
    expect(parsed.map((commit) => commit.matching)).toEqual([true, false]);
  });
});

describe("pull-request gate assessment", () => {
  it("accepts the pinned head, required checks, review state, and sign-offs", () => {
    const statusCheckRollup = [
      "DCO",
      "validate",
      "container-smoke",
      "Analyze (actions)",
      "Analyze (javascript-typescript)",
    ].map((name) => ({ name, conclusion: "SUCCESS" }));
    const findings = assessPrGate({
      pullRequest: {
        headRefOid: "a".repeat(40),
        baseRefName: "main",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        statusCheckRollup,
      },
      reviewThreads: {
        nodes: [{ isResolved: true, isOutdated: false }],
        pageInfo: { hasNextPage: false },
      },
      signoffs: [{ matching: true }],
      currentHead: "a".repeat(40),
      observedHeadAfter: "a".repeat(40),
      worktreeStatus: "",
      requiredChecksExitCode: 0,
    });
    expect(findings.every((finding) => finding.passed)).toBe(true);
  });

  it("fails unresolved current threads and incomplete queries", () => {
    const findings = assessPrGate({
      pullRequest: {
        headRefOid: "a".repeat(40),
        baseRefName: "main",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [],
      },
      reviewThreads: {
        nodes: [{ isResolved: false, isOutdated: false }],
        pageInfo: { hasNextPage: true },
      },
      signoffs: [{ matching: false }],
      currentHead: "b".repeat(40),
      observedHeadAfter: "b".repeat(40),
      worktreeStatus: " M package.json",
      requiredChecksExitCode: 1,
    });
    expect(findings.filter((finding) => !finding.passed).length).toBeGreaterThan(4);
  });
});

describe("main CI selection", () => {
  it("selects only an exact-SHA push run", () => {
    const sha = "a".repeat(40);
    expect(
      selectCiRun(
        [
          { databaseId: 1, headSha: "b".repeat(40), event: "push", status: "completed" },
          {
            databaseId: 2,
            headSha: sha,
            event: "pull_request",
            status: "completed",
            conclusion: "success",
          },
          {
            databaseId: 3,
            headSha: sha,
            event: "push",
            status: "completed",
            conclusion: "success",
          },
        ],
        sha,
      )?.databaseId,
    ).toBe(3);
  });
});

describe("static release files", () => {
  const valid = {
    manifests: {
      "package.json": { private: true },
      "apps/api/package.json": { private: true },
    },
    compose: `
      image: ghcr.io/arts-link/screenshot-a-day-api:0.1.0
        SAD_VERSION: 0.1.0
        SAD_COMMIT: development
      image: ghcr.io/arts-link/screenshot-a-day-worker:0.1.0
    `,
    releaseWorkflow: `
      git cat-file -t refs/tags/v0.1.0
      node scripts/check-release.mjs
      git rev-parse FETCH_HEAD
      type=semver,pattern={{major}}.{{minor}}
    `,
  };

  it("accepts private packages, GHCR pins, build arguments, and guarded tags", () => {
    expect(assessReleaseFiles(valid).every((finding) => finding.passed)).toBe(true);
  });

  it("rejects public packages, Docker Hub images, and floating major tags", () => {
    const findings = assessReleaseFiles({
      ...valid,
      manifests: { "package.json": { private: false } },
      compose: valid.compose.replaceAll("ghcr.io/arts-link/", "docker.io/"),
      releaseWorkflow: `${valid.releaseWorkflow}\ntype=semver,pattern={{major}}`,
    });
    expect(findings.filter((finding) => !finding.passed).map((finding) => finding.name)).toEqual([
      "Workspace packages are private",
      "Compose pulls only versioned GHCR images",
      "Release workflow publishes no floating major tag",
    ]);
  });
});
