import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const expected = (await readFile(new URL("VERSION", root), "utf8")).trim();
const manifests = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/contracts/package.json",
  "packages/core/package.json",
];

for (const path of manifests) {
  const manifest = JSON.parse(await readFile(new URL(path, root), "utf8"));
  if (manifest.version !== expected) {
    throw new Error(`${path} is ${manifest.version}; expected ${expected}`);
  }
}

console.log(`All packages use Screenshot-a-Day ${expected}.`);

const compose = await readFile(new URL("compose.yaml", root), "utf8");
for (const image of ["screenshot-a-day-api", "screenshot-a-day-worker"]) {
  if (!compose.includes(`${image}:${expected}`))
    throw new Error(`compose.yaml does not pin ${image} to ${expected}`);
}
const contracts = await readFile(new URL("packages/contracts/src/index.ts", root), "utf8");
if (!contracts.includes(`PRODUCT_VERSION = "${expected}"`))
  throw new Error("Contract product version does not match VERSION");
console.log("Compose images and public contracts match the product version.");
