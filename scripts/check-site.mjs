import { access, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, "site");
const canonical = "https://arts-link.github.io/screenshot-a-day/";
export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const requiredFiles = [
  "index.html",
  "privacy.html",
  "styles.css",
  "assets/fonts/dm-sans-latin-ext.woff2",
  "assets/fonts/dm-sans-latin.woff2",
  "assets/fonts/fraunces-normal-latin-ext.woff2",
  "assets/fonts/fraunces-normal-latin.woff2",
  "assets/fonts/fraunces-italic-latin-ext.woff2",
  "assets/fonts/fraunces-italic-latin.woff2",
  "script.js",
  "analytics.js",
  "og.png",
  "robots.txt",
  "sitemap.xml",
  ".nojekyll",
];

for (const file of requiredFiles) await access(resolve(site, file));

const html = await readFile(resolve(site, "index.html"), "utf8");
const privacy = await readFile(resolve(site, "privacy.html"), "utf8");
const styles = await readFile(resolve(site, "styles.css"), "utf8");
const analytics = await readFile(resolve(site, "analytics.js"), "utf8");
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
requireMatch(/href="\.\/privacy\.html"/i, "site/index.html must link to its privacy notice");
requireMatch(
  /href="https:\/\/screenshots\.arts-link\.com\/"/i,
  "site/index.html must link to the live demo",
);
requireMatch(/releases\/tag\/v0\.1\.0/i, "site/index.html must link to the v0.1.0 release");
requireMatch(/Open source[\s\S]*v0\.1\.0/i, "site/index.html must show the stable version");

for (const [file, contents] of [
  ["site/index.html", html],
  ["site/privacy.html", privacy],
  ["site/styles.css", styles],
]) {
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(contents)) {
    throw new Error(`${file} must not depend on Google-hosted fonts`);
  }
}
for (const font of [
  "dm-sans-latin-ext.woff2",
  "dm-sans-latin.woff2",
  "fraunces-normal-latin-ext.woff2",
  "fraunces-normal-latin.woff2",
  "fraunces-italic-latin-ext.woff2",
  "fraunces-italic-latin.woff2",
]) {
  if (!styles.includes(`./assets/fonts/${font}`)) {
    throw new Error(`site/styles.css must load local font asset ${font}`);
  }
}
if (!/font-display:\s*swap/i.test(styles)) {
  throw new Error("site/styles.css must allow fallback text while local fonts load");
}

if (!/<html\s+lang="en"/i.test(privacy))
  throw new Error("site/privacy.html must declare its language");
if (!/self-hosted[\s\S]*no product telemetry/i.test(privacy))
  throw new Error("site/privacy.html must preserve the product telemetry boundary");
for (const disclosure of [
  /cookieless/i,
  /PostHog/i,
  /session replay/i,
  /Do Not Track/i,
  /Global Privacy Control/i,
]) {
  if (!disclosure.test(privacy))
    throw new Error(`site/privacy.html is missing disclosure ${disclosure}`);
}

for (const requirement of [
  /arts-link\.github\.io/,
  /\/screenshot-a-day\//,
  /https:\/\/g\.arts-link\.com/,
  /cookieless_mode:\s*"always"/,
  /person_profiles:\s*"never"/,
  /autocapture:\s*false/,
  /disable_session_recording:\s*true/,
  /disable_surveys:\s*true/,
  /advanced_disable_flags:\s*true/,
  /respect_dnt:\s*true/,
  /navigator\.globalPrivacyControl/,
  /before_send:\s*sanitizeEvent/,
]) {
  if (!requirement.test(analytics))
    throw new Error(`site/analytics.js is missing privacy guard ${requirement}`);
}
for (const event of ["$pageview", "marketing_cta_clicked", "install_command_copied"]) {
  if (!analytics.includes(`"${event}"`))
    throw new Error(`site/analytics.js is missing allowed event ${event}`);
}
for (const forbidden of [/startSessionRecording/, /posthog\.identify\s*\(/, /posthog\.people/]) {
  if (forbidden.test(analytics))
    throw new Error(`site/analytics.js contains forbidden tracking behavior ${forbidden}`);
}

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
if (!sitemap.includes(`<loc>${canonical}privacy.html</loc>`))
  throw new Error("site/sitemap.xml omits the privacy notice");

const png = await readFile(resolve(site, "og.png"));
if (extname("og.png") !== ".png" || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
  throw new Error("site/og.png must be a 1200×630 PNG");
}

console.log(
  `Validated ${requiredFiles.length} site files, links, metadata, sitemap, robots, and 1200×630 social image.`,
);
