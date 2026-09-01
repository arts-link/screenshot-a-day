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

function seedPublicationTarget(projectId) {
  const target = db.createPublicationTarget(
    {
      name: "E2E static host",
      baseUrl: "https://history.example.com",
      scheduleMode: "manual",
      scheduleExpression: null,
      scheduleTimezone: "UTC",
      branding: {
        title: "E2E visual history",
        description: "",
        logoText: null,
        logoUrl: null,
        tagline: "",
        accentColor: "#dbff53",
        backgroundColor: "#10151d",
        darkMode: true,
        supplementalFooter: "",
        analytics: { provider: "none" },
      },
      target: {
        adapter: "vercel",
        config: { projectId: "e2e-static-host", teamId: null },
        credentials: { token: "unused-e2e-token" },
      },
    },
    "unused-e2e-encrypted-credentials",
    null,
  );
  db.attachProjectToTarget(projectId, target.id);
  return target;
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
  seedPublicationTarget(indexable.id);
  const unlisted = await createProject("E2E unlisted", "e2e-unlisted", "unlisted");
  await seedCapture(unlisted.id, unlisted.profiles[0].id, 0);
  await seedCapture(unlisted.id, unlisted.profiles[0].id, 1);

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
  await page.evaluate(() =>
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole("button", { name: /Capture now/ }).click();
  await page.getByRole("button", { name: /Capture queued/ }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Open gallery" }).getAttribute("href"),
    `${baseUrl}/p/e2e-indexable`,
  );
  assert.equal(await page.locator(".capture-card").count(), 12);
  assert.match(await page.locator(".capture-browser-meta").innerText(), /13 comparable captures/i);
  assert.match(await page.locator(".capture-browser-meta").innerText(), /1 failed attempt/i);
  await page.getByText("Generate / update", { exact: true }).click();
  await page.getByRole("button", { name: "Regenerate GIF" }).waitFor();
  await page.getByRole("link", { name: "Download GIF" }).waitFor();
  await page.locator(".capture-card button").nth(1).click();
  await page.locator(".capture-card button").nth(0).click();
  await page.locator(".comparison-result").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Side by side", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator('[data-comparison-view="side-by-side"] figure').count(), 2);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const adminSplit = page.getByRole("slider", { name: "Comparison split" });
  await adminSplit.press("ArrowRight");
  assert.equal(await adminSplit.inputValue(), "51");
  assert.match((await page.locator(".split-frame-later").getAttribute("style")) ?? "", /49%/);
  await page.getByRole("button", { name: "Overlay", exact: true }).click();
  await page.getByRole("slider", { name: "Overlay opacity" }).waitFor();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("img", { name: "Pixel difference heatmap" }).waitFor();
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
  await page.getByRole("status").filter({ hasText: "Publication queued" }).waitFor();
  await page.getByText("You can leave this page; progress is saved.").waitFor();
  assert.deepEqual(await page.locator(".target-publication-steps span").allTextContents(), [
    "queued",
    "building",
    "deploying",
  ]);
  await page.getByRole("button", { name: "Queued…" }).waitFor();
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
  await page.locator(".public-frame button").nth(1).click();
  await page.locator(".public-frame button").nth(0).click();
  await page.locator('[data-comparison-view="side-by-side"]').waitFor();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.getByRole("slider", { name: "Comparison split" }).waitFor();
  await page.getByRole("button", { name: /Older/ }).click();
  await page.locator(".public-frame").first().waitFor();
  assert.equal(await page.locator(".public-frame").count(), 1);

  await page.goto(`${baseUrl}/s/${unlisted.shareToken}`);
  await page.getByRole("heading", { name: "E2E unlisted" }).waitFor();
  await page.locator(".public-frame button").nth(1).click();
  await page.locator(".public-frame button").nth(0).click();
  await page.getByRole("button", { name: "Side by side", exact: true }).waitFor();
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
  await page.locator(".capture-card button").nth(1).click();
  await page.locator(".capture-card button").nth(0).click();
  await page.locator('[data-comparison-view="side-by-side"]').waitFor();
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
  );
  await page.goto(`${baseUrl}/p/e2e-indexable`);
  await page.getByRole("heading", { name: "E2E indexable" }).waitFor();

  const galleryScript = await readFile(
    new URL("../apps/api/static-gallery/assets/gallery.js", import.meta.url),
    "utf8",
  );
  const galleryStyles = await readFile(
    new URL("../apps/api/static-gallery/assets/gallery.css", import.meta.url),
    "utf8",
  );
  const staticMarkup = (id, date) => `
    <section data-comparison-workspace data-comparison-scope="e2e:profile">
      <div data-slot="earlier"><span data-slot-value></span><button data-slot-change="earlier"></button><button data-slot-remove="earlier"></button></div>
      <div data-slot="later"><span data-slot-value></span><button data-slot-change="later"></button><button data-slot-remove="later"></button></div>
      <div class="comparison-modes"><button class="active" aria-pressed="true" data-comparison-mode="side-by-side">Side by side</button><button aria-pressed="false" data-comparison-mode="split">Split</button></div>
      <div data-comparison-empty></div>
      <div class="side-by-side-result" data-side-by-side-result hidden><figure><img data-side-before><figcaption><span data-side-before-date></span></figcaption></figure><figure><img data-side-after><figcaption><span data-side-after-date></span></figcaption></figure></div>
      <div class="split-result" data-split-result hidden><div class="split-frame"><img data-before><div class="split-frame-later" data-split-later><img data-after></div><span class="split-divider" data-split-divider></span></div><label class="split-control"><span>Comparison split</span><input type="range" min="0" max="100" value="50"><output>50% later</output></label></div>
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
  await page.addStyleTag({ content: galleryStyles });
  await page.addScriptTag({ content: galleryScript });
  await page.locator("[data-compare-id=later]").click();
  await page.waitForFunction(() => {
    const result = globalThis.document.querySelector("[data-side-by-side-result]");
    return result instanceof globalThis.HTMLElement && !result.hidden;
  });
  assert.match(await page.locator("[data-side-before]").getAttribute("src"), /earlier\.png$/);
  assert.match(await page.locator("[data-side-after]").getAttribute("src"), /later\.png$/);
  await page.locator('[data-comparison-mode="split"]').click();
  await page.locator("[data-split-result]").waitFor();
  const staticSplit = page.getByRole("slider", { name: "Comparison split" });
  await staticSplit.press("ArrowRight");
  assert.equal(await staticSplit.inputValue(), "51");
  assert.match((await page.locator("[data-split-later]").getAttribute("style")) ?? "", /49%/);
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
  );

  assert.deepEqual(browserErrors, []);
  console.log(
    "Playwright smoke passed: insecure-context capture fallback, admin, API tokens, public, unlisted, mobile, and static cross-page selection.",
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
