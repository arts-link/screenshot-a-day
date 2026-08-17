import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function validateRelease({ tag, version, objectType, taggedCommit, mainCommit }) {
  if (!semver.test(version)) throw new Error(`VERSION is not semantic versioning: ${version}`);
  if (tag !== `v${version}`) throw new Error(`tag ${tag} must exactly equal v${version}`);
  if (objectType !== "tag")
    throw new Error(`tag ${tag} is lightweight; releases require an annotated tag`);
  if (taggedCommit !== mainCommit) {
    throw new Error(
      `tag ${tag} points to ${taggedCommit}, but current origin/main is ${mainCommit}`,
    );
  }
}

async function main() {
  const [, , tag, objectType, taggedCommit, mainCommit] = process.argv;
  if (![tag, objectType, taggedCommit, mainCommit].every(Boolean)) {
    throw new Error("usage: check-release.mjs <tag> <object-type> <tagged-commit> <main-commit>");
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const version = (await readFile(resolve(root, "VERSION"), "utf8")).trim();
  validateRelease({ tag, version, objectType, taggedCommit, mainCommit });
  console.log(`${tag} is an annotated tag for VERSION ${version} at the current main tip.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
