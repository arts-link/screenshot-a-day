import { fileURLToPath } from "node:url";

export const supportedNodeMajor = 24;

export function validateRuntime(version) {
  const major = Number.parseInt(version.split(".")[0], 10);
  if (major !== supportedNodeMajor) {
    throw new Error(
      `Screenshot-a-Day source development requires Node.js ${supportedNodeMajor} LTS; found ${version}. ` +
        "After reviewing `.mise.toml`, use mise or nvm to select Node 24, run `corepack enable`, then reinstall or rebuild native dependencies.",
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    validateRuntime(process.versions.node);
    console.log(`Using supported Node.js ${process.versions.node}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
