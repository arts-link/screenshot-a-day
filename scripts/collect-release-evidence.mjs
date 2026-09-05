import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(root, "release-evidence");
const defaultRepository = "arts-link/screenshot-a-day";
const defaultPullRequest = 29;
const successfulCheckStates = new Set(["SUCCESS"]);
const requiredReleaseChecks = [
  "DCO",
  "validate",
  "container-smoke",
  "Analyze (actions)",
  "Analyze (javascript-typescript)",
];

const manualAcceptance = [
  "Review every final-SHA commit and decide whether any conversation is release-blocking.",
  "Confirm the release notes accurately describe the final behavior.",
  "Complete administrator setup; verify login, logout, session expiry, and recovery.",
  "Complete real Chromium, Firefox, and WebKit manual and scheduled batches.",
  "Exercise queue-state feedback, retention, gallery visibility, sharing rotation, and removal.",
  "Publish and republish a portable static gallery; verify its URL, headers, views, and pagination.",
  "Generate and decode chronological GIF and WebM timelines.",
  "Exercise the webhook lifecycle and verify a real delivery signature.",
  "Exercise scoped REST tokens and both documented MCP token scopes.",
  "Check desktop and mobile keyboard navigation with no browser-console errors.",
];

function usage() {
  return `Usage:
  pnpm release:evidence -- --phase pr [options]
  pnpm release:evidence -- --phase final --expected-sha <40-character-sha> [options]

Options:
  --phase <pr|final>               Evidence phase to collect (required)
  --pr <number>                   Release pull request (default: ${defaultPullRequest})
  --repo <owner/name>             GitHub repository (default: ${defaultRepository})
  --expected-sha <sha>            Exact merged main SHA (required for final)
  --validation-source <local|ci>  Run validation locally or reuse exact-SHA main CI
                                   (default: local)
  --skip-containers               Skip Section 4 container smoke and mark it incomplete
  --help                          Show this help

The command never merges, tags, pushes, deploys, or edits GitHub settings.`;
}

export function parseEvidenceOptions(args, env = process.env) {
  const options = {
    phase: null,
    pullRequest: Number(env.SAD_RELEASE_PR ?? defaultPullRequest),
    repository: env.SAD_RELEASE_REPO ?? defaultRepository,
    expectedSha: env.SAD_RELEASE_SHA ?? null,
    validationSource: "local",
    skipContainers: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = () => {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      return next;
    };

    if (argument === "--") continue;
    if (argument === "--phase") options.phase = value();
    else if (argument === "--pr") options.pullRequest = Number(value());
    else if (argument === "--repo") options.repository = value();
    else if (argument === "--expected-sha") options.expectedSha = value();
    else if (argument === "--validation-source") options.validationSource = value();
    else if (argument === "--skip-containers") options.skipContainers = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }

  if (options.help) return options;
  if (!new Set(["pr", "final"]).has(options.phase)) {
    throw new Error("--phase must be either pr or final");
  }
  if (!Number.isSafeInteger(options.pullRequest) || options.pullRequest < 1) {
    throw new Error("--pr must be a positive integer");
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
    throw new Error("--repo must use owner/name format");
  }
  if (!new Set(["local", "ci"]).has(options.validationSource)) {
    throw new Error("--validation-source must be either local or ci");
  }
  if (options.phase === "pr" && options.expectedSha) {
    throw new Error("--expected-sha is only valid with --phase final");
  }
  if (options.phase === "pr" && options.validationSource !== "local") {
    throw new Error("--validation-source is only valid with --phase final");
  }
  if (options.phase === "final" && !/^[0-9a-f]{40}$/i.test(options.expectedSha ?? "")) {
    throw new Error("--phase final requires --expected-sha with a full 40-character commit SHA");
  }
  return options;
}

export function parseSignoffLog(output) {
  return output
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authorName, authorEmail, trailers = ""] = record.split("\u001f");
      const signoffs = trailers
        .split("\u001d")
        .map((value) => value.trim())
        .filter(Boolean);
      const expected = `${authorName} <${authorEmail}>`.toLocaleLowerCase();
      return {
        sha,
        authorName,
        authorEmail,
        signoffs,
        matching: signoffs.some((signoff) => signoff.toLocaleLowerCase() === expected),
      };
    });
}

function checkName(check) {
  return check.name ?? check.context ?? "";
}

function checkState(check) {
  return String(check.conclusion ?? check.state ?? check.status ?? "").toUpperCase();
}

export function assessPrGate({
  pullRequest,
  reviewThreads,
  signoffs,
  currentHead,
  observedHeadAfter,
  worktreeStatus,
  requiredChecksExitCode,
}) {
  const findings = [];
  const add = (name, passed, detail) => findings.push({ name, passed, detail });
  const rollup = pullRequest.statusCheckRollup ?? [];
  const threads = reviewThreads?.nodes ?? [];

  add(
    "Current checkout matches PR head",
    currentHead === pullRequest.headRefOid,
    `checkout ${currentHead}; PR ${pullRequest.headRefOid}`,
  );
  add(
    "PR head stayed pinned during collection",
    observedHeadAfter === pullRequest.headRefOid,
    `initial ${pullRequest.headRefOid}; final ${observedHeadAfter}`,
  );
  add("Release-candidate worktree is clean", worktreeStatus === "", worktreeStatus || "clean");
  add("PR targets main", pullRequest.baseRefName === "main", `base ${pullRequest.baseRefName}`);
  add(
    "PR is mergeable",
    pullRequest.mergeable === "MERGEABLE",
    `mergeable ${pullRequest.mergeable}; state ${pullRequest.mergeStateStatus}`,
  );
  add(
    "Required checks command passed",
    requiredChecksExitCode === 0,
    `gh pr checks exit ${requiredChecksExitCode}`,
  );

  for (const expectedName of requiredReleaseChecks) {
    const matching = rollup.find((check) =>
      checkName(check).toLocaleLowerCase().includes(expectedName.toLocaleLowerCase()),
    );
    add(
      `${expectedName} succeeded`,
      Boolean(matching && successfulCheckStates.has(checkState(matching))),
      matching ? `${checkName(matching)}: ${checkState(matching)}` : "check not found",
    );
  }

  const unresolved = threads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  add(
    "Review-thread query is complete",
    !reviewThreads?.pageInfo?.hasNextPage,
    "first 100 threads",
  );
  add("No unresolved current review threads", unresolved.length === 0, `${unresolved.length} open`);
  const unsigned = signoffs.filter((commit) => !commit.matching);
  add(
    "Every PR commit has a matching sign-off",
    signoffs.length > 0 && unsigned.length === 0,
    `${signoffs.length} commits; ${unsigned.length} missing`,
  );
  return findings;
}

export function selectCiRun(runs, expectedSha) {
  const exact = runs.filter((run) => run.headSha === expectedSha && run.event === "push");
  return (
    exact.find((run) => run.status !== "completed") ??
    exact.find((run) => run.conclusion === "success")
  );
}

export function assessReleaseFiles({ manifests, compose, releaseWorkflow }) {
  const imageReferences = [...compose.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map(
    (match) => match[1],
  );
  return [
    {
      name: "Workspace packages are private",
      passed: Object.values(manifests).every((manifest) => manifest.private === true),
      detail: `${Object.keys(manifests).length} manifests checked`,
    },
    {
      name: "Compose pulls only versioned GHCR images",
      passed:
        imageReferences.length === 2 &&
        imageReferences.every(
          (image) => image.startsWith("ghcr.io/arts-link/") && image.endsWith(":0.1.0"),
        ),
      detail: imageReferences.join(", "),
    },
    {
      name: "Compose passes version and commit build arguments",
      passed: compose.includes("SAD_VERSION: 0.1.0") && compose.includes("SAD_COMMIT:"),
      detail: "SAD_VERSION and SAD_COMMIT",
    },
    {
      name: "Release workflow validates annotated tags at main",
      passed:
        releaseWorkflow.includes("git cat-file -t") &&
        releaseWorkflow.includes("scripts/check-release.mjs") &&
        releaseWorkflow.includes("git rev-parse FETCH_HEAD"),
      detail: ".github/workflows/release.yml",
    },
    {
      name: "Release workflow publishes no floating major tag",
      passed: !/pattern=\{\{major\}\}\s*(?:,|$)/m.test(releaseWorkflow),
      detail: "no {{major}}-only metadata tag",
    },
  ];
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function evidencePath(directory, name) {
  const normalizedDirectory = resolve(directory);
  const prefix = `${evidenceRoot}${sep}`;
  if (normalizedDirectory !== evidenceRoot && !normalizedDirectory.startsWith(prefix)) {
    throw new Error(`evidence path escapes ${evidenceRoot}`);
  }
  if (name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`invalid evidence filename: ${name}`);
  }
  const path = name === undefined ? normalizedDirectory : resolve(normalizedDirectory, name);
  if (path !== evidenceRoot && !path.startsWith(prefix)) {
    throw new Error(`evidence path escapes ${evidenceRoot}`);
  }
  return path;
}

async function createEvidenceDirectory() {
  await mkdir(evidenceRoot, { recursive: true });
  return evidencePath(await mkdtemp(`${evidenceRoot}${sep}v0.1.0-`));
}

function createRecorder(directory) {
  let sequence = 0;
  const commands = [];
  const checks = [];

  async function run(label, command, args = [], options = {}) {
    sequence += 1;
    const safeLabel = label
      .toLocaleLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const logName = `${String(sequence).padStart(2, "0")}-${safeLabel}.log`;
    const logPath = evidencePath(directory, logName);
    const stream = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
    const display = [command, ...args].map(quoteArgument).join(" ");
    const startedAt = new Date();
    stream.write(`$ ${display}\nstarted: ${startedAt.toISOString()}\n\n`);
    process.stdout.write(`\n[release:evidence] ${label}\n$ ${display}\n`);

    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      stream.write(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      stream.write(chunk);
      process.stderr.write(chunk);
    });
    let spawnError = null;
    const exitCode = await new Promise((resolvePromise) => {
      child.once("error", (error) => {
        spawnError = error;
        const message = `failed to start ${command}: ${error.message}\n`;
        stderr.push(Buffer.from(message));
        stream.write(message);
        process.stderr.write(message);
        resolvePromise(127);
      });
      child.once("close", (code) => resolvePromise(code ?? 1));
    });
    const finishedAt = new Date();
    stream.write(
      `\nfinished: ${finishedAt.toISOString()}\nexit: ${exitCode}\nduration_ms: ${finishedAt - startedAt}\n`,
    );
    await new Promise((resolvePromise) => stream.end(resolvePromise));
    const result = {
      label,
      command: display,
      log: logName,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - startedAt,
      exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
    commands.push({ ...result, stdout: undefined, stderr: undefined });
    if (exitCode !== 0 && !options.allowFailure) {
      const cause = spawnError ? ` (${spawnError.message})` : "";
      throw new Error(`${label} failed with exit ${exitCode}${cause}; see ${logName}`);
    }
    return result;
  }

  function addCheck(section, name, status, evidence, note = "") {
    checks.push({ section, name, status, evidence, note });
  }

  return { directory, run, addCheck, commands, checks };
}

async function writeJson(directory, name, value) {
  await writeFile(evidencePath(directory, name), `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  return name;
}

async function gitValue(recorder, label, args) {
  return (await recorder.run(label, "git", args)).stdout.trim();
}

async function collectRepositorySettings(options, recorder, directory) {
  const repository = await recorder.run("GitHub repository settings", "gh", [
    "api",
    `repos/${options.repository}`,
  ]);
  const protection = await recorder.run("Main branch protection", "gh", [
    "api",
    `repos/${options.repository}/branches/main/protection`,
  ]);
  const vulnerability = await recorder.run("Private vulnerability reporting", "gh", [
    "api",
    `repos/${options.repository}/private-vulnerability-reporting`,
  ]);
  const codeScanning = await recorder.run("CodeQL default setup", "gh", [
    "api",
    `repos/${options.repository}/code-scanning/default-setup`,
  ]);
  const repositoryJson = JSON.parse(repository.stdout);
  const protectionJson = JSON.parse(protection.stdout);
  const vulnerabilityJson = JSON.parse(vulnerability.stdout);
  const codeScanningJson = JSON.parse(codeScanning.stdout);
  const settings = {
    repository: repositoryJson,
    mainProtection: protectionJson,
    privateVulnerabilityReporting: vulnerabilityJson,
    codeScanningDefaultSetup: codeScanningJson,
  };
  const evidence = await writeJson(directory, "02-github-settings.json", settings);
  const security = repositoryJson.security_and_analysis ?? {};
  const contexts = protectionJson.required_status_checks?.contexts ?? [];
  const appChecks = protectionJson.required_status_checks?.checks ?? [];
  const allRequiredChecks = [...contexts, ...appChecks.map((check) => check.context ?? "")];
  const expectations = [
    ["Pull requests are required", Boolean(protectionJson.required_pull_request_reviews)],
    ["Strict status checks are required", protectionJson.required_status_checks?.strict === true],
    ["Linear history is required", protectionJson.required_linear_history?.enabled === true],
    ["DCO is required", allRequiredChecks.some((name) => name.toLocaleLowerCase().includes("dco"))],
    ["Web commits require sign-off", repositoryJson.web_commit_signoff_required === true],
    ["Secret scanning is enabled", security.secret_scanning?.status === "enabled"],
    [
      "Secret scanning push protection is enabled",
      security.secret_scanning_push_protection?.status === "enabled",
    ],
    [
      "Dependabot security updates are enabled",
      security.dependabot_security_updates?.status === "enabled",
    ],
    ["Private vulnerability reporting is enabled", vulnerabilityJson.enabled === true],
    ["CodeQL default setup is configured", codeScanningJson.state === "configured"],
  ];
  for (const [name, passed] of expectations) {
    recorder.addCheck("2", name, passed ? "passed" : "failed", evidence);
  }
  recorder.addCheck(
    "2",
    "Repository homepage recorded",
    "info",
    evidence,
    repositoryJson.homepage || "not set; set at cutover",
  );
  if (expectations.some(([, passed]) => !passed)) {
    throw new Error("one or more GitHub repository protection/security settings failed");
  }
}

async function collectLocalPreflight(recorder) {
  const version = await recorder.run("Version consistency", "pnpm", ["version:check"]);
  recorder.addCheck("2", "Version consistency", "passed", version.log);
  const occurrences = await recorder.run("Release version occurrences", "git", [
    "grep",
    "-n",
    "0\\.1\\.0",
    "--",
    "VERSION",
    "package.json",
    "apps",
    "packages",
    "compose.yaml",
    "CHANGELOG.md",
    "docs/releases/v0.1.0.md",
  ]);
  recorder.addCheck("2", "Release version surfaces recorded", "passed", occurrences.log);
  const manifestPaths = [
    "package.json",
    "apps/api/package.json",
    "apps/web/package.json",
    "apps/worker/package.json",
    "packages/contracts/package.json",
    "packages/core/package.json",
  ];
  const manifests = Object.fromEntries(
    await Promise.all(
      manifestPaths.map(async (path) => [
        path,
        JSON.parse(await readFile(resolve(root, path), "utf8")),
      ]),
    ),
  );
  const composeSource = await readFile(resolve(root, "compose.yaml"), "utf8");
  const releaseWorkflow = await readFile(resolve(root, ".github/workflows/release.yml"), "utf8");
  const releaseFileFindings = assessReleaseFiles({
    manifests,
    compose: composeSource,
    releaseWorkflow,
  });
  const releaseFilesEvidence = await writeJson(
    recorder.directory,
    "02-local-release-files.json",
    releaseFileFindings,
  );
  for (const finding of releaseFileFindings) {
    recorder.addCheck(
      "2",
      finding.name,
      finding.passed ? "passed" : "failed",
      releaseFilesEvidence,
      finding.detail,
    );
  }
  if (releaseFileFindings.some((finding) => !finding.passed)) {
    throw new Error("one or more local release-file checks failed");
  }
  const releaseTests = await recorder.run("Release guard unit tests", "pnpm", [
    "exec",
    "vitest",
    "run",
    "scripts/check-release.test.mjs",
  ]);
  recorder.addCheck("2", "Release guard unit tests", "passed", releaseTests.log);
  const compose = await recorder.run(
    "Compose configuration",
    "docker",
    ["compose", "config", "--quiet"],
    {
      env: {
        SAD_ENCRYPTION_KEY: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        SAD_SESSION_SECRET: "release-evidence-session-secret-111111",
        SAD_WORKER_TOKEN: "release-evidence-worker-token-222222222",
      },
    },
  );
  recorder.addCheck("2", "Compose configuration is valid", "passed", compose.log);
}

async function collectPrPhase(options, recorder, directory) {
  await recorder.run("Fetch release refs", "git", ["fetch", "--no-tags", "origin", "main"]);
  const prResult = await recorder.run("Release pull request", "gh", [
    "pr",
    "view",
    String(options.pullRequest),
    "--repo",
    options.repository,
    "--json",
    "number,url,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,commits,updatedAt",
  ]);
  const pullRequest = JSON.parse(prResult.stdout);
  try {
    await recorder.run("Fetch pull request head", "git", [
      "fetch",
      "--no-tags",
      "origin",
      `pull/${options.pullRequest}/head`,
    ]);
  } catch {
    await recorder.run("Verify local pull request object", "git", [
      "cat-file",
      "-e",
      `${pullRequest.headRefOid}^{commit}`,
    ]);
  }
  const currentHead = await gitValue(recorder, "Current release-candidate SHA", [
    "rev-parse",
    "HEAD",
  ]);
  const worktreeStatus = await gitValue(recorder, "Release-candidate worktree status", [
    "status",
    "--porcelain",
  ]);
  const requiredChecks = await recorder.run(
    "Required pull request checks",
    "gh",
    ["pr", "checks", String(options.pullRequest), "--repo", options.repository, "--required"],
    { allowFailure: true },
  );
  const [owner, name] = options.repository.split("/");
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:1){nodes{url author{login}}}}pageInfo{hasNextPage endCursor}}}}}`;
  const threadResult = await recorder.run("Pull request review threads", "gh", [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${options.pullRequest}`,
  ]);
  const reviewThreads = JSON.parse(threadResult.stdout).data.repository.pullRequest.reviewThreads;
  const signoffResult = await recorder.run("Pull request commit sign-offs", "git", [
    "log",
    `origin/main..${pullRequest.headRefOid}`,
    "--format=%H%x1f%an%x1f%ae%x1f%(trailers:key=Signed-off-by,valueonly,separator=%x1d)%x1e",
  ]);
  const signoffs = parseSignoffLog(signoffResult.stdout);
  const finalPrResult = await recorder.run("Recheck release pull request head", "gh", [
    "pr",
    "view",
    String(options.pullRequest),
    "--repo",
    options.repository,
    "--json",
    "headRefOid,updatedAt",
  ]);
  const observedHeadAfter = JSON.parse(finalPrResult.stdout).headRefOid;
  const findings = assessPrGate({
    pullRequest,
    reviewThreads,
    signoffs,
    currentHead,
    observedHeadAfter,
    worktreeStatus,
    requiredChecksExitCode: requiredChecks.exitCode,
  });
  const evidence = await writeJson(directory, "01-pr-gate.json", {
    pullRequest,
    reviewThreads,
    signoffs,
    findings,
  });
  for (const finding of findings) {
    recorder.addCheck(
      "1",
      finding.name,
      finding.passed ? "passed" : "failed",
      evidence,
      finding.detail,
    );
  }
  if (findings.some((finding) => !finding.passed)) {
    recorder.addCheck(
      "1",
      "Release pull-request gate",
      "failed",
      evidence,
      "one or more gate findings failed",
    );
  }
  const independentResults = await Promise.allSettled([
    collectLocalPreflight(recorder),
    collectRepositorySettings(options, recorder, directory),
  ]);
  const failures = independentResults
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? String(result.reason));
  if (findings.some((finding) => !finding.passed)) {
    failures.unshift("the release pull-request gate is not green");
  }
  if (failures.length) throw new Error(failures.join("; "));
}

async function collectLocalValidation(recorder) {
  const commands = [
    ["Runtime check", "pnpm", ["runtime:check"]],
    ["Frozen dependency installation", "pnpm", ["install", "--frozen-lockfile"]],
    [
      "Native API dependency rebuild",
      "pnpm",
      ["--filter", "@sad/api", "rebuild", "better-sqlite3"],
    ],
    [
      "Playwright browser installation",
      "pnpm",
      ["--filter", "@sad/worker", "exec", "playwright", "install", "chromium", "firefox", "webkit"],
    ],
    ["Full repository checks", "pnpm", ["check"]],
    ["Production build", "pnpm", ["build"]],
    ["End-to-end smoke", "pnpm", ["test:e2e"]],
    ["Production dependency audit", "pnpm", ["audit", "--prod", "--audit-level", "high"]],
  ];
  for (const [label, command, args] of commands) {
    const result = await recorder.run(label, command, args);
    recorder.addCheck("3", label, "passed", result.log);
  }
}

async function collectCiValidation(options, recorder, directory) {
  const listArgs = [
    "run",
    "list",
    "--repo",
    options.repository,
    "--workflow",
    "CI",
    "--commit",
    options.expectedSha,
    "--limit",
    "20",
    "--json",
    "databaseId,headSha,status,conclusion,url,workflowName,event,createdAt,updatedAt",
  ];
  let list = await recorder.run("Exact-SHA main CI lookup", "gh", listArgs);
  let run = selectCiRun(JSON.parse(list.stdout), options.expectedSha);
  if (!run) throw new Error(`no push CI run found for exact SHA ${options.expectedSha}`);
  if (run.status !== "completed") {
    await recorder.run("Wait for exact-SHA main CI", "gh", [
      "run",
      "watch",
      String(run.databaseId),
      "--repo",
      options.repository,
      "--exit-status",
    ]);
    list = await recorder.run("Refresh exact-SHA main CI", "gh", listArgs);
    run = selectCiRun(JSON.parse(list.stdout), options.expectedSha);
  }
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`exact-SHA main CI did not complete successfully for ${options.expectedSha}`);
  }
  const details = await recorder.run("Exact-SHA main CI details", "gh", [
    "run",
    "view",
    String(run.databaseId),
    "--repo",
    options.repository,
    "--json",
    "databaseId,headSha,status,conclusion,url,jobs,workflowName,createdAt,updatedAt",
  ]);
  await writeFile(evidencePath(directory, "03-ci-run.json"), details.stdout, { mode: 0o600 });
  const logs = await recorder.run("Exact-SHA main CI logs", "gh", [
    "run",
    "view",
    String(run.databaseId),
    "--repo",
    options.repository,
    "--log",
  ]);
  recorder.addCheck("3", "Exact-SHA main CI succeeded", "passed", logs.log, run.url);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error("failed to allocate a local acceptance-test port");
  return port;
}

async function waitForReady(url, attempts = 45) {
  const observations = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      observations.push({ attempt, status: response.status, at: new Date().toISOString() });
      if (response.ok) return observations;
    } catch (error) {
      observations.push({ attempt, error: error.message, at: new Date().toISOString() });
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw Object.assign(new Error(`readiness did not succeed at ${url}`), { observations });
}

async function collectContainerSmoke(options, recorder, directory) {
  const port = await availablePort();
  const project =
    `sad-release-${options.expectedSha.slice(0, 8)}-${process.pid}`.toLocaleLowerCase();
  const composeArgs = ["compose", "--project-name", project];
  const env = {
    SAD_BUILD_COMMIT: options.expectedSha,
    SAD_HOST_PORT: String(port),
    SAD_PUBLIC_URL: `http://localhost:${port}`,
    SAD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SAD_SESSION_SECRET: randomBytes(32).toString("hex"),
    SAD_WORKER_TOKEN: randomBytes(32).toString("hex"),
  };
  let started = false;
  let cleanupError = null;
  try {
    const build = await recorder.run(
      "Build exact-SHA source containers",
      "docker",
      [...composeArgs, "build", "--pull"],
      { env },
    );
    recorder.addCheck("4", "Exact-SHA source containers built", "passed", build.log);
    await recorder.run(
      "Start isolated API container",
      "docker",
      [...composeArgs, "up", "-d", "api"],
      {
        env,
      },
    );
    started = true;
    let observations;
    try {
      observations = await waitForReady(`http://127.0.0.1:${port}/health/ready`);
    } catch (error) {
      await writeJson(directory, "04-readiness.json", error.observations ?? []);
      throw error;
    }
    const readinessEvidence = await writeJson(directory, "04-readiness.json", observations);
    recorder.addCheck("4", "Isolated API became ready", "passed", readinessEvidence);
    await recorder.run(
      "Start isolated worker container",
      "docker",
      [...composeArgs, "up", "-d", "worker"],
      { env },
    );
    const services = await recorder.run(
      "Running acceptance services",
      "docker",
      [...composeArgs, "ps", "--services", "--status", "running"],
      { env },
    );
    const running = new Set(services.stdout.trim().split(/\s+/));
    if (!running.has("api") || !running.has("worker")) {
      throw new Error(`expected api and worker to be running; found ${[...running].join(", ")}`);
    }
    recorder.addCheck("4", "API and worker containers are running", "passed", services.log);
    const versionResult = await recorder.run("Container version endpoint", "curl", [
      "--fail",
      "--silent",
      "--show-error",
      `http://127.0.0.1:${port}/version`,
    ]);
    const version = JSON.parse(versionResult.stdout);
    if (version.version !== "0.1.0" || version.commit !== options.expectedSha) {
      throw new Error(
        `/version reported ${JSON.stringify(version)}; expected 0.1.0 at ${options.expectedSha}`,
      );
    }
    recorder.addCheck("4", "Container version and commit match", "passed", versionResult.log);
    const images = await recorder.run(
      "Acceptance container images",
      "docker",
      [...composeArgs, "images", "--format", "json"],
      { env },
    );
    recorder.addCheck("4", "Container image identities recorded", "passed", images.log);
  } finally {
    if (started) {
      await recorder.run(
        "Acceptance container logs",
        "docker",
        [...composeArgs, "logs", "--no-color"],
        {
          env,
          allowFailure: true,
        },
      );
    }
    const cleanup = await recorder.run(
      "Remove isolated acceptance stack",
      "docker",
      [...composeArgs, "down", "--volumes", "--remove-orphans"],
      { env, allowFailure: true },
    );
    recorder.addCheck(
      "4",
      "Disposable acceptance stack removed",
      cleanup.exitCode === 0 ? "passed" : "failed",
      cleanup.log,
    );
    if (cleanup.exitCode !== 0) {
      cleanupError = new Error(`failed to remove disposable Compose project ${project}`);
    }
  }
  if (cleanupError) throw cleanupError;
}

async function collectFinalPhase(options, recorder, directory) {
  await recorder.run("Fetch final main", "git", ["fetch", "--no-tags", "origin", "main"]);
  const head = await gitValue(recorder, "Final checkout SHA", ["rev-parse", "HEAD"]);
  const main = await gitValue(recorder, "Remote main SHA", ["rev-parse", "origin/main"]);
  const branch = await gitValue(recorder, "Final checkout branch", ["branch", "--show-current"]);
  const worktree = await gitValue(recorder, "Final worktree status", ["status", "--porcelain"]);
  const exact = [
    ["Checkout matches expected SHA", head === options.expectedSha, head],
    ["origin/main matches expected SHA", main === options.expectedSha, main],
    ["Final validation runs on main", branch === "main", branch || "detached"],
    ["Final worktree is clean", worktree === "", worktree || "clean"],
  ];
  for (const [name, passed, note] of exact) {
    recorder.addCheck("1", name, passed ? "passed" : "failed", "manifest.json", note);
  }
  if (exact.some(([, passed]) => !passed)) {
    throw new Error("final evidence must run from a clean main checkout at the exact expected SHA");
  }
  const preflightResults = await Promise.allSettled([
    collectLocalPreflight(recorder),
    collectRepositorySettings(options, recorder, directory),
  ]);
  const preflightFailures = preflightResults
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? String(result.reason));
  if (preflightFailures.length) throw new Error(preflightFailures.join("; "));

  if (options.validationSource === "ci") {
    const finalTasks = [collectCiValidation(options, recorder, directory)];
    if (options.skipContainers) {
      recorder.addCheck("4", "Source-container smoke", "skipped", "", "--skip-containers was used");
    } else {
      finalTasks.push(collectContainerSmoke(options, recorder, directory));
    }
    const finalResults = await Promise.allSettled(finalTasks);
    const finalFailures = finalResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message ?? String(result.reason));
    if (finalFailures.length) throw new Error(finalFailures.join("; "));
  } else {
    await collectLocalValidation(recorder);
    if (options.skipContainers) {
      recorder.addCheck("4", "Source-container smoke", "skipped", "", "--skip-containers was used");
    } else {
      await collectContainerSmoke(options, recorder, directory);
    }
  }
}

async function listFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = evidencePath(directory, entry.name);
    paths.push({ path, relative: relative(directory, path) });
  }
  return paths;
}

async function writeChecksums(directory) {
  const lines = [];
  for (const file of (await listFiles(directory)).sort((left, right) =>
    left.relative.localeCompare(right.relative),
  )) {
    if (file.relative === "SHA256SUMS") continue;
    const digest = createHash("sha256")
      .update(await readFile(file.path))
      .digest("hex");
    lines.push(`${digest}  ${file.relative}`);
  }
  await writeFile(evidencePath(directory, "SHA256SUMS"), `${lines.join("\n")}\n`, {
    mode: 0o600,
  });
}

function renderSummary(metadata, checks, fatalError) {
  const escape = (value) =>
    String(value ?? "")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ");
  let overallResult = "PASSED";
  if (checks.some((check) => check.status === "skipped")) overallResult = "INCOMPLETE";
  if (fatalError) overallResult = "FAILED";
  const lines = [
    `# Screenshot-a-Day ${metadata.version} release evidence`,
    "",
    `- Phase: \`${metadata.phase}\``,
    `- Commit: \`${metadata.sha}\``,
    `- Repository: \`${metadata.repository}\``,
    `- Pull request: \`#${metadata.pullRequest}\``,
    `- Started: ${metadata.startedAt}`,
    `- Finished: ${metadata.finishedAt}`,
    `- Result: **${overallResult}**`,
    "",
    "## Automated checks",
    "",
    "| Section | Check | Result | Evidence | Note |",
    "| --- | --- | --- | --- | --- |",
    ...checks.map(
      (check) =>
        `| ${escape(check.section)} | ${escape(check.name)} | ${escape(check.status.toUpperCase())} | ${escape(check.evidence)} | ${escape(check.note)} |`,
    ),
  ];
  if (fatalError) lines.push("", "## Failure", "", `\`${escape(fatalError)}\``);
  lines.push("", "## Human acceptance still required", "");
  for (const item of manualAcceptance) lines.push(`- [ ] ${item}`);
  lines.push(
    "",
    "This collector deliberately does not merge, tag, push, deploy, or mark manual acceptance complete.",
    "",
  );
  return lines.join("\n");
}

async function finishEvidence(directory, options, recorder, startedAt, sha, fatalError) {
  const finishedAt = new Date().toISOString();
  const metadata = {
    schemaVersion: 1,
    version: "0.1.0",
    phase: options.phase,
    repository: options.repository,
    pullRequest: options.pullRequest,
    sha,
    validationSource: options.validationSource,
    skipContainers: options.skipContainers,
    startedAt,
    finishedAt,
    host: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    commands: recorder.commands,
    fatalError,
  };
  await writeJson(directory, "checks.json", recorder.checks);
  await writeJson(directory, "manifest.json", metadata);
  await writeFile(
    evidencePath(directory, "summary.md"),
    renderSummary(metadata, recorder.checks, fatalError),
    {
      mode: 0o600,
    },
  );
  await writeChecksums(directory);
  await chmod(evidencePath(directory), 0o700);
}

async function initialGitSha() {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd: root });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(chunks).toString("utf8").trim())
        : reject(new Error("git rev-parse HEAD failed")),
    );
  });
}

async function main() {
  const options = parseEvidenceOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const initialSha = await initialGitSha();
  const evidenceDirectory = await createEvidenceDirectory();
  const recorder = createRecorder(evidenceDirectory);
  const startedAt = new Date().toISOString();
  let fatalError = null;
  try {
    if (packageJson.version !== "0.1.0") {
      throw new Error(`collector is for 0.1.0, but package.json reports ${packageJson.version}`);
    }
    if (options.phase === "pr") await collectPrPhase(options, recorder, evidenceDirectory);
    else await collectFinalPhase(options, recorder, evidenceDirectory);
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await finishEvidence(
      evidenceDirectory,
      options,
      recorder,
      startedAt,
      options.expectedSha ?? initialSha,
      fatalError,
    );
    console.log(`\nRelease evidence: ${evidenceDirectory}`);
    console.log(`Summary: ${evidencePath(evidenceDirectory, "summary.md")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
