import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const files = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/data-model.md",
  "docs/versioning.md",
  "docs/webhooks.md",
  "docs/security.md",
  "docs/api/README.md",
  "docs/guides/deployment.md",
  "docs/guides/backups.md",
  "docs/guides/troubleshooting.md",
  "docs/launch/announcement-copy.md",
  "docs/launch/asset-brief.md",
  "docs/launch/promotion-v0.1.0.md",
  "docs/plans/release-v0.1.0.md",
  "docs/releases/v0.1.0.md",
];
for (const file of files) {
  const body = await readFile(file, "utf8");
  for (const match of body.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target)
      await access(resolve(dirname(file), target)).catch(() => {
        throw new Error(`${file} links to missing ${target}`);
      });
  }
}
console.log(`Checked ${files.length} documentation files.`);

const envExample = await readFile(".env.example", "utf8");
const compose = await readFile("compose.yaml", "utf8");
const composeVariables = [
  "SAD_HOST_PORT",
  "SAD_PUBLIC_URL",
  "SAD_ENCRYPTION_KEY",
  "SAD_SESSION_SECRET",
  "SAD_WORKER_TOKEN",
  "SAD_PRIVATE_TARGET_ALLOWLIST",
  "SAD_TRUST_PROXY",
  "SAD_WORKER_CONCURRENCY",
  "SAD_WORKER_POLL_MS",
  "SAD_FFMPEG_PATH",
  "SAD_LOG_LEVEL",
  "SAD_PUBLICATION_DEPLOY_TIMEOUT_MS",
  "SAD_BUILD_COMMIT",
];
for (const variable of composeVariables) {
  if (!envExample.includes(`${variable}=`))
    throw new Error(`.env.example omits Compose variable ${variable}`);
  if (!compose.includes(`\${${variable}`))
    throw new Error(`compose.yaml does not interpolate documented variable ${variable}`);
}
for (const directOnly of ["SAD_PORT", "SAD_DATA_DIR"])
  if (envExample.match(new RegExp(`^${directOnly}=`, "m")))
    throw new Error(`.env.example must not advertise direct-only ${directOnly} for Compose`);
console.log(`Checked ${composeVariables.length} Compose environment variables.`);
