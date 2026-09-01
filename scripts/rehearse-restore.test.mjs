import { describe, expect, it } from "vitest";
import { parseRehearsalOptions } from "./rehearse-restore.mjs";

const valid = [
  "--source-project",
  "screenshot-a-day-v010-rc2",
  "--restore-project",
  "screenshot-a-day-v010-restore",
  "--source-port",
  "4400",
  "--restore-port",
  "4401",
  "--restore-url",
  "http://quinary-simulation-machine:4401",
  "--backup-dir",
  "/srv/backups/screenshot-a-day-v010-rc2-20260901",
  "--expected-sha",
  "be6d66a785e10ce6934b38ed9b06597bf8c57064",
  "--key-custody-reference",
  "Password manager item: Screenshot-a-Day RC2",
];

describe("restore rehearsal guardrails", () => {
  it("parses explicit isolated source and restore settings", () => {
    expect(
      parseRehearsalOptions(valid, { cwd: "/srv/git/sad", home: "/home/operator" }),
    ).toMatchObject({
      sourceProject: "screenshot-a-day-v010-rc2",
      restoreProject: "screenshot-a-day-v010-restore",
      sourcePort: 4400,
      restorePort: 4401,
      sourceSha: "be6d66a785e10ce6934b38ed9b06597bf8c57064",
      expectedSha: "be6d66a785e10ce6934b38ed9b06597bf8c57064",
      cleanup: false,
    });
  });

  it("refuses source reuse and restore names that do not look disposable", () => {
    const reused = valid.map((value) =>
      value === "screenshot-a-day-v010-restore" ? "screenshot-a-day-v010-rc2" : value,
    );
    expect(() => parseRehearsalOptions(reused)).toThrow(/must differ/);
    const permanent = valid.map((value) =>
      value === "screenshot-a-day-v010-restore" ? "screenshot-a-day-production" : value,
    );
    expect(() => parseRehearsalOptions(permanent)).toThrow(/include 'restore'/);
  });

  it("refuses port collisions, broad paths, and secret-like custody values", () => {
    const samePort = valid.map((value, index) =>
      valid[index - 1] === "--restore-port" ? "4400" : value,
    );
    expect(() => parseRehearsalOptions(samePort)).toThrow(/ports must differ/);
    const broadPath = valid.map((value, index) =>
      valid[index - 1] === "--backup-dir" ? "/srv" : value,
    );
    expect(() => parseRehearsalOptions(broadPath)).toThrow(/too broad/);
    const secret = valid.map((value, index) =>
      valid[index - 1] === "--key-custody-reference"
        ? "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
        : value,
    );
    expect(() => parseRehearsalOptions(secret)).toThrow(/non-secret/);
  });

  it("requires completed capture evidence before destructive cleanup", () => {
    expect(() => parseRehearsalOptions([...valid, "--skip-capture", "--cleanup"])).toThrow(
      /cannot be combined/,
    );
  });

  it("refuses to record credentials embedded in the restore URL", () => {
    const credentialUrl = valid.map((value, index) =>
      valid[index - 1] === "--restore-url"
        ? "http://operator:secret@quinary-simulation-machine:4401"
        : value,
    );
    expect(() => parseRehearsalOptions(credentialUrl)).toThrow(/cannot contain credentials/);
  });
});
