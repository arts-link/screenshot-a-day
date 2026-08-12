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
