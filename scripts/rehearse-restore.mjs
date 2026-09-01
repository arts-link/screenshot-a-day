import { access, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

const VERSION_SCRIPT = String.raw`
const response = await fetch("http://127.0.0.1:4400/version");
if (!response.ok) throw new Error("version endpoint returned " + response.status);
console.log(JSON.stringify(await response.json()));
`;

const INTEGRITY_SCRIPT = String.raw`
import Database from "better-sqlite3";
const db = new Database("/data/sad.sqlite", { readonly: true });
console.log(db.pragma("integrity_check", { simple: true }));
db.close();
`;

const DIGEST_SCRIPT = String.raw`
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
const db = new Database("/data/sad.sqlite", { readonly: true });
const capture = db.prepare(
  "SELECT id, image_key AS imageKey, sha256 " +
  "FROM captures " +
  "WHERE status = 'succeeded' AND image_key IS NOT NULL AND sha256 IS NOT NULL " +
  "ORDER BY captured_at DESC LIMIT 1"
).get();
db.close();
if (!capture) throw new Error("the backup contains no successful retained PNG");
const bytes = await readFile(join("/data/blobs", capture.imageKey));
const actualSha256 = createHash("sha256").update(bytes).digest("hex");
console.log(JSON.stringify({
  captureId: capture.id,
  expectedSha256: capture.sha256,
  actualSha256,
  matches: actualSha256 === capture.sha256,
}));
`;

const FRESH_CAPTURE_SCRIPT = String.raw`
import Database from "better-sqlite3";
const since = process.argv[1];
const db = new Database("/data/sad.sqlite", { readonly: true });
const rows = db.prepare(
  "SELECT r.id AS runId, r.created_at AS createdAt, r.status, " +
  "p.browser, j.status AS jobStatus, " +
  "EXISTS(SELECT 1 FROM captures c WHERE c.job_id = j.id AND c.status = 'succeeded') AS captured " +
  "FROM runs r JOIN jobs j ON j.run_id = r.id JOIN profiles p ON p.id = j.profile_id " +
  "WHERE r.created_at >= ? ORDER BY r.created_at DESC"
).all(since);
db.close();
const runs = new Map();
for (const row of rows) {
  const run = runs.get(row.runId) ?? {
    runId: row.runId,
    createdAt: row.createdAt,
    status: row.status,
    browsers: [],
    allJobsSucceeded: true,
  };
  if (row.captured && !run.browsers.includes(row.browser)) run.browsers.push(row.browser);
  if (row.jobStatus !== "succeeded") run.allJobsSucceeded = false;
  runs.set(row.runId, run);
}
const required = ["chromium", "firefox", "webkit"];
const match = [...runs.values()].find(
  (run) => run.status === "succeeded" && run.allJobsSucceeded &&
    required.every((browser) => run.browsers.includes(browser)),
);
console.log(JSON.stringify(match ?? null));
`;

function usage() {
  return `Usage:
  pnpm release:restore-rehearsal -- \\
    --source-project <compose-project> \\
    --restore-project <disposable-restore-project> \\
    --source-port <port> \\
    --restore-port <unused-port> \\
    --restore-url <operator-facing-url> \\
    --backup-dir <new-absolute-directory> \\
    --expected-sha <restore-image-sha> \\
    [--source-sha <source-image-sha>] \\
    --key-custody-reference <non-secret-reference> \\
    [--capture-timeout-minutes 30] [--skip-capture] [--cleanup]

The source API and worker are stopped only while /data is copied, then restarted. The source
volume and backup are never deleted. The isolated restore is retained unless --cleanup is passed
after a successful fresh three-browser batch.`;
}

function requiredString(values, name) {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}

function numericOption(values, name, fallback) {
  const value = values[name] ?? fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

function validateProjectName(value, label) {
  if (!PROJECT_PATTERN.test(value))
    throw new Error(`${label} must contain only lowercase letters, digits, underscores, or dashes`);
}

function validateSha(value, label) {
  if (!SHA_PATTERN.test(value)) throw new Error(`${label} must be a 7-40 character Git SHA`);
}

export function parseRehearsalOptions(argv, context = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "source-project": { type: "string" },
      "restore-project": { type: "string" },
      "source-port": { type: "string" },
      "restore-port": { type: "string" },
      "restore-url": { type: "string" },
      "backup-dir": { type: "string" },
      "expected-sha": { type: "string" },
      "source-sha": { type: "string" },
      "key-custody-reference": { type: "string" },
      "capture-timeout-minutes": { type: "string" },
      "skip-capture": { type: "boolean", default: false },
      cleanup: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };

  const sourceProject = requiredString(values, "source-project");
  const restoreProject = requiredString(values, "restore-project");
  validateProjectName(sourceProject, "--source-project");
  validateProjectName(restoreProject, "--restore-project");
  if (sourceProject === restoreProject) throw new Error("source and restore projects must differ");
  if (!restoreProject.includes("restore"))
    throw new Error("--restore-project must include 'restore' to mark it as disposable");

  const sourcePort = numericOption(values, "source-port");
  const restorePort = numericOption(values, "restore-port");
  for (const [label, port] of [
    ["--source-port", sourcePort],
    ["--restore-port", restorePort],
  ]) {
    if (port < 1024 || port > 65535) throw new Error(`${label} must be between 1024 and 65535`);
  }
  if (sourcePort === restorePort) throw new Error("source and restore ports must differ");

  const restoreUrl = new URL(requiredString(values, "restore-url"));
  if (!["http:", "https:"].includes(restoreUrl.protocol))
    throw new Error("--restore-url must use http or https");
  if (restoreUrl.username || restoreUrl.password || restoreUrl.search || restoreUrl.hash)
    throw new Error("--restore-url cannot contain credentials, a query string, or a fragment");
  const urlPort = Number(restoreUrl.port || (restoreUrl.protocol === "https:" ? 443 : 80));
  if (urlPort !== restorePort) throw new Error("--restore-url must use --restore-port");

  const expectedSha = requiredString(values, "expected-sha").toLowerCase();
  const sourceSha = String(values["source-sha"] ?? expectedSha)
    .trim()
    .toLowerCase();
  validateSha(expectedSha, "--expected-sha");
  validateSha(sourceSha, "--source-sha");

  const custodyReference = requiredString(values, "key-custody-reference");
  if (
    custodyReference.length > 160 ||
    /[\r\n=]/.test(custodyReference) ||
    /[A-Za-z0-9+/]{32,}/.test(custodyReference)
  )
    throw new Error("--key-custody-reference must be a short non-secret location reference");

  const cwd = resolve(context.cwd ?? process.cwd());
  const home = resolve(context.home ?? homedir());
  const backupDir = normalize(requiredString(values, "backup-dir"));
  if (!isAbsolute(backupDir)) throw new Error("--backup-dir must be absolute");
  const root = parse(backupDir).root;
  const broadPaths = new Set([root, home, cwd, "/srv", "/var", "/tmp", "/private/tmp", "/Volumes"]);
  if (broadPaths.has(backupDir) || backupDir.split(sep).filter(Boolean).length < 3)
    throw new Error("--backup-dir is too broad; choose a new dedicated rehearsal directory");
  if (cwd.startsWith(`${backupDir}${sep}`) || home.startsWith(`${backupDir}${sep}`))
    throw new Error("--backup-dir cannot contain the working directory or home directory");

  const captureTimeoutMinutes = numericOption(values, "capture-timeout-minutes", "30");
  if (captureTimeoutMinutes < 1 || captureTimeoutMinutes > 240)
    throw new Error("--capture-timeout-minutes must be between 1 and 240");
  if (values.cleanup && values["skip-capture"])
    throw new Error("--cleanup cannot be combined with --skip-capture");

  return {
    help: false,
    sourceProject,
    restoreProject,
    sourcePort,
    restorePort,
    restoreUrl: restoreUrl.toString().replace(/\/$/, ""),
    backupDir,
    expectedSha,
    sourceSha,
    custodyReference,
    captureTimeoutMinutes,
    skipCapture: values["skip-capture"],
    cleanup: values.cleanup,
  };
}

function displayedCommand(command, args) {
  const safe = args.map((arg) => (/^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg)));
  console.log(`→ ${command} ${safe.join(" ")}`);
}

function runCommand(command, args, options = {}) {
  if (!options.quiet) displayedCommand(command, args);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function commandExists(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`${command} inspection failed: ${(result.stderr || result.stdout).trim()}`);
}

function compose(project, args, options = {}) {
  return runCommand("docker", ["compose", "--project-name", project, ...args], options);
}

async function assertNewBackupDirectory(backupDir) {
  try {
    await access(backupDir);
    throw new Error("--backup-dir already exists; choose a new directory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = await realpath(dirname(backupDir));
  if (!(await stat(parent)).isDirectory()) throw new Error("backup parent is not a directory");
}

async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  }).catch(() => {
    throw new Error(`restore port ${port} is already in use`);
  });
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
}

async function waitForReady(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) return;
    } catch {
      // The isolated API is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`restore API did not become ready on port ${port}`);
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output.split("\n").at(-1));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function commitMatches(actual, expected) {
  return (
    typeof actual === "string" &&
    (actual === expected || actual.startsWith(expected) || expected.startsWith(actual))
  );
}

async function writeEvidence(path, evidence) {
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

async function waitForFreshCapture(options, restoreEnv, since) {
  const deadline = Date.now() + options.captureTimeoutMinutes * 60_000;
  console.log(
    `\nOpen ${options.restoreUrl}, sign in, and run one batch with enabled Chromium, Firefox, and WebKit profiles.`,
  );
  console.log(`Waiting up to ${options.captureTimeoutMinutes} minutes for that successful batch…`);
  while (Date.now() < deadline) {
    const output = compose(
      options.restoreProject,
      ["exec", "-T", "api", "node", "--input-type=module", "-e", FRESH_CAPTURE_SCRIPT, since],
      { env: restoreEnv, quiet: true },
    );
    const match = parseJsonOutput(output, "fresh-capture check");
    if (match) return match;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  return null;
}

export async function runRehearsal(options) {
  const workingDirectory = process.cwd();
  const baseEnv = { ...process.env };
  const restoreEnv = {
    ...baseEnv,
    SAD_HOST_PORT: String(options.restorePort),
    SAD_PUBLIC_URL: options.restoreUrl,
  };

  console.log("Preflight: validating Compose configuration and isolation targets.");
  runCommand("docker", ["version", "--format", "{{.Server.Version}}"], { env: baseEnv });
  compose(options.sourceProject, ["config", "--quiet"], { env: baseEnv });
  compose(options.restoreProject, ["config", "--quiet"], { env: restoreEnv });
  await assertNewBackupDirectory(options.backupDir);
  await assertPortAvailable(options.restorePort);

  const sourceApi = compose(options.sourceProject, ["ps", "--quiet", "api"], {
    env: baseEnv,
    quiet: true,
  });
  const sourceWorker = compose(options.sourceProject, ["ps", "--quiet", "worker"], {
    env: baseEnv,
    quiet: true,
  });
  if (!sourceApi || !sourceWorker)
    throw new Error("source API and worker must both exist and be running");
  const restoreContainers = compose(options.restoreProject, ["ps", "--all", "--quiet"], {
    env: restoreEnv,
    quiet: true,
  });
  if (restoreContainers) throw new Error("restore Compose project already has containers");
  if (
    commandExists("docker", ["volume", "inspect", `${options.restoreProject}_sad-data`], {
      env: baseEnv,
    })
  )
    throw new Error("restore data volume already exists; choose a new restore project name");

  const sourceVersion = parseJsonOutput(
    compose(
      options.sourceProject,
      ["exec", "-T", "api", "node", "--input-type=module", "-e", VERSION_SCRIPT],
      { env: baseEnv, quiet: true },
    ),
    "source /version",
  );
  if (!commitMatches(sourceVersion.commit, options.sourceSha))
    throw new Error(`source API reports ${sourceVersion.commit}, expected ${options.sourceSha}`);

  await mkdir(options.backupDir, { mode: 0o700 });
  console.log("Backup: stopping writes and copying the complete data directory.");
  let sourceStopped = false;
  try {
    sourceStopped = true;
    compose(options.sourceProject, ["stop", "worker", "api"], { env: baseEnv });
    compose(options.sourceProject, ["cp", "api:/data/.", `${options.backupDir}/`], {
      env: baseEnv,
    });
  } finally {
    if (sourceStopped) {
      compose(options.sourceProject, ["start", "api", "worker"], { env: baseEnv });
      await waitForReady(options.sourcePort);
    }
  }
  await Promise.all([
    access(join(options.backupDir, "sad.sqlite")),
    access(join(options.backupDir, "blobs")),
  ]).catch(() => {
    throw new Error("backup must contain sad.sqlite and blobs/ directly");
  });

  console.log("Restore: creating an isolated empty volume and normalizing ownership.");
  compose(options.restoreProject, ["create", "api", "worker"], { env: restoreEnv });
  compose(options.restoreProject, ["cp", `${options.backupDir}/.`, "api:/data"], {
    env: restoreEnv,
  });
  compose(
    options.restoreProject,
    ["run", "--rm", "--no-deps", "--user", "root", "api", "chown", "-R", "node:node", "/data"],
    { env: restoreEnv },
  );
  const restoreStartedAt = new Date().toISOString();
  compose(options.restoreProject, ["start", "api"], { env: restoreEnv });
  await waitForReady(options.restorePort);

  const restoreVersion = await fetch(`http://127.0.0.1:${options.restorePort}/version`).then(
    async (response) => {
      if (!response.ok) throw new Error(`restore /version returned HTTP ${response.status}`);
      return response.json();
    },
  );
  if (!commitMatches(restoreVersion.commit, options.expectedSha))
    throw new Error(
      `restore API reports ${restoreVersion.commit}, expected ${options.expectedSha}`,
    );

  const integrity = compose(
    options.restoreProject,
    ["exec", "-T", "api", "node", "--input-type=module", "-e", INTEGRITY_SCRIPT],
    { env: restoreEnv, quiet: true },
  )
    .split("\n")
    .at(-1);
  if (integrity !== "ok") throw new Error(`SQLite integrity_check returned ${integrity}`);
  const retainedImage = parseJsonOutput(
    compose(
      options.restoreProject,
      ["exec", "-T", "api", "node", "--input-type=module", "-e", DIGEST_SCRIPT],
      { env: restoreEnv, quiet: true },
    ),
    "retained-image digest check",
  );
  if (!retainedImage.matches) throw new Error("retained PNG digest does not match the database");
  compose(options.restoreProject, ["start", "worker"], { env: restoreEnv });

  const timestamp = new Date().toISOString();
  const evidencePath = join(
    options.backupDir,
    `restore-rehearsal-${timestamp.replace(/[:.]/g, "-")}.json`,
  );
  const evidence = {
    schemaVersion: 1,
    status: options.skipCapture ? "manual-capture-pending" : "capture-pending",
    recordedAt: timestamp,
    workingDirectory,
    source: {
      composeProject: options.sourceProject,
      port: options.sourcePort,
      expectedCommit: options.sourceSha,
      reportedVersion: sourceVersion,
      volumeRetained: true,
    },
    backup: {
      directory: options.backupDir,
      encryptionKeyCustodyReference: options.custodyReference,
      containsDatabaseAndBlobs: true,
    },
    restore: {
      composeProject: options.restoreProject,
      port: options.restorePort,
      url: options.restoreUrl,
      expectedCommit: options.expectedSha,
      reportedVersion: restoreVersion,
      startedAt: restoreStartedAt,
      readiness: "passed",
      sqliteIntegrityCheck: integrity,
      retainedImage,
      freshThreeBrowserCapture: null,
      retainedForInspection: true,
    },
  };
  await writeEvidence(evidencePath, evidence);

  if (options.skipCapture) {
    console.log(
      `\nAutomated restore checks passed. Fresh capture remains pending: ${evidencePath}`,
    );
    console.log(`The isolated restore remains available at ${options.restoreUrl}.`);
    return { evidencePath, evidence };
  }

  const freshCapture = await waitForFreshCapture(options, restoreEnv, restoreStartedAt);
  if (!freshCapture) {
    evidence.status = "fresh-capture-timeout";
    evidence.restore.retainedForInspection = true;
    await writeEvidence(evidencePath, evidence);
    throw new Error(
      `no successful fresh three-browser batch was observed; evidence: ${evidencePath}`,
    );
  }
  evidence.status = "passed";
  evidence.restore.freshThreeBrowserCapture = freshCapture;
  await writeEvidence(evidencePath, evidence);

  if (options.cleanup) {
    console.log("Cleanup: removing only the validated disposable restore deployment and volume.");
    compose(options.restoreProject, ["down", "--volumes"], { env: restoreEnv });
    evidence.restore.retainedForInspection = false;
    await writeEvidence(evidencePath, evidence);
  }
  console.log(`\nRestore rehearsal passed. Evidence: ${evidencePath}`);
  if (!options.cleanup)
    console.log(`The isolated restore remains available at ${options.restoreUrl}.`);
  return { evidencePath, evidence };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = parseRehearsalOptions(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await runRehearsal(options);
  } catch (error) {
    console.error(
      `Restore rehearsal failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    console.error("The source volume and backup were not deleted. Run with --help for usage.");
    process.exitCode = 1;
  }
}
