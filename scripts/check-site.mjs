import { access, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "site");
const canonical = "https://arts-link.github.io/screenshot-a-day/";
export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const requiredFiles = [
  "index.html",
  "styles.css",
  "script.js",
  "og.png",
  "robots.txt",
  "sitemap.xml",
  ".nojekyll",
];

for (const file of requiredFiles) await access(resolve(site, file));

const html = await readFile(resolve(site, "index.html"), "utf8");
const requireMatch = (pattern, message) => {
  if (!pattern.test(html)) throw new Error(message);
};

requireMatch(/<html\s+lang="en"/i, "site/index.html must declare its language");
requireMatch(/<meta\s+name="viewport"[^>]+>/i, "site/index.html is missing a viewport meta tag");
requireMatch(
  /<meta\s+name="description"[\s\S]*?content="[^"]+"/i,
  "site/index.html is missing a description",
);
requireMatch(
  new RegExp(`<link\\s+rel="canonical"\\s+href="${escapeRegExp(canonical)}"`),
  "site/index.html has the wrong canonical URL",
);
requireMatch(/<meta\s+property="og:title"[^>]+>/i, "site/index.html is missing og:title");
requireMatch(
  /<meta\s+property="og:description"[^>]+>/i,
  "site/index.html is missing og:description",
);
requireMatch(
  /<meta\s+property="og:image"[^>]+content="https:\/\/arts-link\.github\.io\/screenshot-a-day\/og\.png"/i,
  "site/index.html has the wrong Open Graph image",
);
requireMatch(
  /<meta\s+name="twitter:card"\s+content="summary_large_image"/i,
  "site/index.html is missing the Twitter card type",
);
requireMatch(
  /no product telemetry/i,
  "site/index.html must state that the product has no telemetry",
);

const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
if (!jsonLdMatch) throw new Error("site/index.html is missing JSON-LD metadata");
const jsonLd = JSON.parse(jsonLdMatch[1]);
if (jsonLd["@context"] !== "https://schema.org" || jsonLd["@type"] !== "SoftwareApplication") {
  throw new Error("site JSON-LD must describe a schema.org SoftwareApplication");
}
if (jsonLd.url !== canonical || jsonLd.softwareVersion !== "0.1.0") {
  throw new Error("site JSON-LD URL or software version is incorrect");
}

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (value.startsWith("#")) {
    const anchor = decodeURIComponent(value.slice(1));
    if (anchor && !ids.has(anchor)) throw new Error(`site/index.html links to missing #${anchor}`);
    continue;
  }
  if (/^(?:[a-z]+:|\/\/)/i.test(value)) continue;
  const path = decodeURIComponent(value.split(/[?#]/)[0]);
  if (!path) continue;
  const target = resolve(site, path);
  if (!target.startsWith(`${site}/`) && target !== site)
    throw new Error(`site link escapes site/: ${value}`);
  await access(target).catch(() => {
    throw new Error(`site/index.html links to missing ${value}`);
  });
}

const robots = await readFile(resolve(site, "robots.txt"), "utf8");
if (!robots.includes("User-agent: *") || !robots.includes(`Sitemap: ${canonical}sitemap.xml`)) {
  throw new Error("site/robots.txt must allow crawlers and name the canonical sitemap");
}

const sitemap = await readFile(resolve(site, "sitemap.xml"), "utf8");
if (!sitemap.includes(`<loc>${canonical}</loc>`))
  throw new Error("site/sitemap.xml has the wrong canonical URL");

const png = await readFile(resolve(site, "og.png"));
if (extname("og.png") !== ".png" || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
  throw new Error("site/og.png must be a 1200×630 PNG");
}

console.log(
  `Validated ${requiredFiles.length} site files, links, metadata, sitemap, robots, and 1200×630 social image.`,
);
