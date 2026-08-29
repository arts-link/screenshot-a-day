import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../apps/worker/node_modules/playwright/index.mjs";
import sharp from "../apps/worker/node_modules/sharp/dist/index.mjs";
import { buildApp } from "../apps/api/dist/app.js";
import { AppDatabase } from "../apps/api/dist/database.js";
import { LocalBlobStore } from "../apps/api/dist/storage.js";
import { hashToken } from "../packages/core/dist/index.js";

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

const directory = await mkdtemp(join(tmpdir(), "sad-e2e-"));
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionToken = "e2e-administrator-session-token";
const db = new AppDatabase(join(directory, "sad.sqlite"));
const blobs = new LocalBlobStore(join(directory, "blobs"));
const user = db.createUser("admin@example.com", "unused-e2e-hash");
db.createSession(user.id, hashToken(sessionToken), new Date(Date.now() + 60 * 60_000));
const config = {
  host: "127.0.0.1",
  port,
  dataDir: directory,
  publicUrl: baseUrl,
  encryptionKey: Buffer.alloc(32, 1).toString("base64"),
  sessionSecret: "e2e-session-secret".padEnd(32, "1"),
  workerToken: "e2e-worker-token".padEnd(32, "2"),
  privateTargetAllowlist: ["localhost"],
  trustProxy: false,
  buildCommit: "e2e",
  publicationDeployTimeoutMs: 30_000,
  logLevel: "silent",
};
const app = await buildApp({ config, db, blobs });
const cookie = `sad_session=${sessionToken}`;

function projectPayload(name, slug, publishMode) {
  return {
    name,
    slug,
    url: "http://localhost:9999",
    publishMode,
    scheduleExpression: "0 0 * * *",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    retentionDays: 30,
    retentionCount: 100,
    headers: {},
    cookies: [],
    profiles: [
      {
        name: "Desktop",
        browser: "chromium",
        enabled: true,
        deviceName: null,
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        extent: "viewport",
        colorScheme: "light",
        locale: "en-US",
        timezone: "UTC",
        reducedMotion: "reduce",
        delayMs: 0,
        waitForSelector: null,
        timeoutMs: 30_000,
      },
    ],
  };
}

async function createProject(name, slug, publishMode) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { cookie },
    payload: projectPayload(name, slug, publishMode),
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

async function seedCapture(projectId, profileId, index, status = "succeeded") {
  db.enqueueRun(projectId, "manual", [profileId]);
  const job = db.claimJob();
  assert(job);
  const image = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: index % 2 ? "#ffffff" : "#111827",
    },
  })
    .png()
    .toBuffer();
  const thumbnail = await sharp(image).webp().toBuffer();
  const imageKey = `e2e/${job.id}.png`;
  const thumbnailKey = `e2e/${job.id}.webp`;
  await Promise.all([blobs.put(imageKey, image), blobs.put(thumbnailKey, thumbnail)]);
  return db.recordCapture(job, {
    status,
    captured_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    final_url: "http://localhost:9999",
    http_status: status === "succeeded" ? 200 : null,
    width: 120,
    height: 80,
    sha256: status === "succeeded" ? `${job.id}-sha` : null,
    change_percent: status === "succeeded" ? (index ? 100 : null) : null,
    image_key: imageKey,
    thumbnail_key: thumbnailKey,
    diff_key: null,
    error: status === "failed" ? "e2e failure" : null,
    duration_ms: 5,
  });
}

async function seedExport(projectId, profileId, format, captureIds) {
  const jobId = db.enqueueExport(projectId, profileId, format, {
    format,
    captureIds,
    frameDurationMs: 750,
    canvasWidth: 1280,
    canvasHeight: 720,
    timestampOverlay: true,
    background: "#111827",
    frameLimit: 90,
  });
  const job = db.claimJob();
  assert.equal(job?.id, jobId);
  const key = `e2e/latest.${format}`;
  await blobs.put(key, Buffer.from(`e2e-${format}`));
  db.saveExport(job, key, captureIds.length);
}

let browser;
try {
  const indexable = await createProject("E2E indexable", "e2e-indexable", "indexable");
  const profileId = indexable.profiles[0].id;
  const captureIds = [];
  for (let index = 0; index < 13; index++)
    captureIds.push((await seedCapture(indexable.id, profileId, index)).id);
  await seedCapture(indexable.id, profileId, 20, "failed");
  for (const format of ["gif", "webm"])
    await seedExport(indexable.id, profileId, format, captureIds);
  await app.inject({
    method: "POST",
    url: `/api/v1/projects/${indexable.id}/profiles`,
    headers: { cookie },
    payload: {
      ...projectPayload("", "", "private").profiles[0],
      name: "Mobile",
      viewportWidth: 390,
      viewportHeight: 844,
    },
  });
  const unlisted = await createProject("E2E unlisted", "e2e-unlisted", "unlisted");
  await seedCapture(unlisted.id, unlisted.profiles[0].id, 0);

  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    bypassCSP: true,
  });
  await context.addCookies([{ name: "sad_session", value: sessionToken, url: baseUrl }]);
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Your projects" }).waitFor();
  const indexableCard = page.locator(".project-card").filter({ hasText: indexable.name });
  assert.equal(
    await indexableCard
      .getByRole("img", { name: `Latest capture of ${indexable.name}` })
      .getAttribute("src"),
    `/api/v1/captures/${captureIds.at(-1)}/thumbnail`,
  );
  assert.equal(
    await indexableCard.getByRole("link", { name: "Open gallery" }).getAttribute("href"),
    `${baseUrl}/p/e2e-indexable`,
  );
  const unlistedCard = page.locator(".project-card").filter({ hasText: unlisted.name });
  assert.equal(
    await unlistedCard.getByRole("link", { name: "Open gallery" }).getAttribute("href"),
    `${baseUrl}/s/${unlisted.shareToken}`,
  );
  assert.equal(await page.locator(".project-card a a").count(), 0);

  await page.goto(`${baseUrl}/projects/${indexable.id}/compare`);
  await page.getByRole("heading", { name: "Compare two captures" }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Open gallery" }).getAttribute("href"),
    `${baseUrl}/p/e2e-indexable`,
  );
  assert.equal(await page.locator(".capture-card").count(), 12);
  assert.match(await page.locator(".capture-browser-meta").innerText(), /13 comparable captures/i);
  assert.match(await page.locator(".capture-browser-meta").innerText(), /1 failed attempt/i);
  await page.getByRole("button", { name: "Regenerate GIF" }).waitFor();
  await page.getByRole("link", { name: "Download GIF" }).waitFor();
  await page.locator(".capture-card button").nth(1).click();
  await page.locator(".capture-card button").nth(0).click();
  await page.locator(".comparison-result").waitFor();
  await page.getByRole("button", { name: /Older/ }).click();
  await page.locator(".capture-card").waitFor();
  assert.equal(await page.locator(".capture-card").count(), 1);
  assert.equal(await page.locator(".compare-slot.filled").count(), 2);
  await page.getByLabel("Capture profile").selectOption({ label: "Mobile" });
  await page
    .getByText("Choose Earlier and Later to generate a pixel comparison automatically.")
    .waitFor();
  assert.equal(await page.locator(".compare-slot.filled").count(), 0);

  await page.goto(`${baseUrl}/projects/${unlisted.id}/compare`);
  assert.equal(
    await page.getByRole("link", { name: "Open gallery" }).getAttribute("href"),
    `${baseUrl}/s/${unlisted.shareToken}`,
  );

  await page.goto(`${baseUrl}/projects/${indexable.id}/configuration`);
  for (const heading of [
    "Publishing and visibility",
    "Capture profiles",
    "Schedule and retention",
    "Webhooks and target credentials",
    "Delete project",
  ])
    await page.getByRole("heading", { name: heading }).waitFor();
  await page.getByRole("button", { name: `Delete ${indexable.name}` }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${baseUrl}/settings`);
  await page.getByRole("heading", { name: "API access" }).waitFor();
  await page.getByRole("heading", { name: "Storage" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Secrets" }).count(), 0);
  await page.getByLabel("Token name").fill("E2E release token");
  await page.getByRole("button", { name: "Create token" }).click();
  await page.getByText("New token ready").waitFor();
  assert.equal(await page.locator(".api-access-card .token-reveal").count(), 1);
  assert.equal(await page.locator(".error-notice").count(), 0);
  await page.getByRole("button", { name: "Dismiss" }).click();
  assert.equal(await page.locator(".token-reveal").count(), 0);

  await page.goto(`${baseUrl}/p/e2e-indexable`);
  await page.getByRole("heading", { name: "E2E indexable" }).waitFor();
  await page
    .getByText("13 comparable moments in this view. 2 capture profiles available.")
    .waitFor();
  for (const label of ["Latest GIF", "Latest WebM"]) {
    const link = page.getByRole("link", { name: new RegExp(label, "i") });
    await link.waitFor();
    assert.match((await link.getAttribute("class")) ?? "", /button-secondary/);
  }
  assert.equal(await page.locator(".public-frame").count(), 12);
  await page.getByRole("button", { name: /Older/ }).click();
  await page.locator(".public-frame").first().waitFor();
  assert.equal(await page.locator(".public-frame").count(), 1);

  await page.goto(`${baseUrl}/s/${unlisted.shareToken}`);
  await page.getByRole("heading", { name: "E2E unlisted" }).waitFor();
  await page.getByRole("button", { name: "GIF unavailable" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Your projects" }).waitFor();
  await page
    .locator(".project-card")
    .filter({ hasText: indexable.name })
    .getByRole("link", { name: "Open gallery" })
    .waitFor();
  await page.goto(`${baseUrl}/projects/${indexable.id}/compare`);
  await page.getByRole("heading", { name: "Compare two captures" }).waitFor();
  await page.goto(`${baseUrl}/p/e2e-indexable`);
  await page.getByRole("heading", { name: "E2E indexable" }).waitFor();

  const galleryScript = await readFile(
    new URL("../apps/api/static-gallery/assets/gallery.js", import.meta.url),
    "utf8",
  );
  const staticMarkup = (id, date) => `
    <section data-comparison-workspace data-comparison-scope="e2e:profile">
      <div data-slot="earlier"><span data-slot-value></span><button data-slot-change="earlier"></button><button data-slot-remove="earlier"></button></div>
      <div data-slot="later"><span data-slot-value></span><button data-slot-change="later"></button><button data-slot-remove="later"></button></div>
      <div data-comparison-empty></div>
      <div data-split-result hidden><img data-before><span><img data-after></span><input type="range"></div>
    </section>
    <article data-capture-card data-capture-id="${id}"><button data-compare-id="${id}" data-compare-image="/${id}.png" data-compare-date="${date}"></button></article>`;
  await page.goto(`${baseUrl}/health/live`);
  await page.evaluate(() =>
    sessionStorage.setItem(
      "sad:comparison:e2e:profile",
      JSON.stringify({
        earlier: {
          id: "earlier",
          image: "/earlier.png",
          date: "2026-01-01T00:00:00.000Z",
        },
        later: null,
      }),
    ),
  );
  await page.setContent(staticMarkup("later", "2026-01-02T00:00:00.000Z"));
  await page.addScriptTag({ content: galleryScript });
  await page.locator("[data-compare-id=later]").click();
  await page.waitForFunction(() => {
    const result = globalThis.document.querySelector("[data-split-result]");
    return result instanceof globalThis.HTMLElement && !result.hidden;
  });
  assert.match(await page.locator("[data-before]").getAttribute("src"), /earlier\.png$/);
  assert.match(await page.locator("[data-after]").getAttribute("src"), /later\.png$/);

  assert.deepEqual(browserErrors, []);
  console.log(
    "Playwright smoke passed: admin, API tokens, public, unlisted, mobile, and static cross-page selection.",
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
