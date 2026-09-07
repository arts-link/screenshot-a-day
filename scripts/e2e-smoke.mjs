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
    error:
      status === "failed"
        ? 'Readiness selector "#missing-release-marker" was not visible within 1,000 ms.'
        : null,
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
  db.createWebhook(
    indexable.id,
    "https://hooks.example.com/screenshot-a-day",
    "unused-e2e-encrypted-secret",
    0,
    ["capture.changed", "capture.failed"],
  );
  const unlisted = await createProject("E2E unlisted", "e2e-unlisted", "unlisted");
  await seedCapture(unlisted.id, unlisted.profiles[0].id, 0);
  await seedCapture(unlisted.id, unlisted.profiles[0].id, 1);

  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ headless: true });

  const authContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const authPage = await authContext.newPage();
  let setupConfigured = false;
  const authBrowserErrors = [];
  authPage.on("console", (message) => {
    if (message.type() === "error") authBrowserErrors.push(message.text());
  });
  authPage.on("pageerror", (error) => authBrowserErrors.push(error.message));
  await authPage.route("**/api/v1/setup/status", async (route) => {
    if (setupConfigured) await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: setupConfigured }),
    });
  });
  await authPage.route("**/api/v1/setup", async (route) => {
    assert.equal(route.request().method(), "POST");
    setupConfigured = true;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ email: "first-admin@example.com" }),
    });
  });
  await authPage.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await authPage.route("**/api/v1/projects", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await authPage.route("**/api/v1/auth/logout", async (route) => {
    assert.equal(route.request().method(), "POST");
    await route.fulfill({ status: 204, body: "" });
  });

  await authPage.goto(`${baseUrl}/setup`);
  await authPage.getByLabel("Setup token").fill("e2e-initial-setup-token");
  await authPage.getByLabel("Email").fill("first-admin@example.com");
  await authPage.getByLabel("Password").fill("correct-horse-battery-staple");
  await authPage.getByRole("button", { name: "Create administrator" }).click();
  await authPage.getByRole("heading", { name: "Your projects" }).waitFor();
  await authPage.evaluate(() => {
    globalThis.__sadSawSetupAfterLogout = false;
    const checkForSetup = () => {
      if (globalThis.document.querySelector('input[name="token"]'))
        globalThis.__sadSawSetupAfterLogout = true;
    };
    new globalThis.MutationObserver(checkForSetup).observe(globalThis.document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
  await authPage.getByRole("button", { name: "Sign out" }).click();
  await authPage.waitForURL(`${baseUrl}/login`);
  await authPage.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(await authPage.getByLabel("Setup token").count(), 0);
  assert.equal(await authPage.evaluate(() => globalThis.__sadSawSetupAfterLogout), false);

  await authPage.reload();
  await authPage.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(new URL(authPage.url()).pathname, "/login");
  assert.equal(await authPage.getByLabel("Setup token").count(), 0);
  await authPage.goBack();
  await authPage.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(new URL(authPage.url()).pathname, "/login");
  assert.equal(await authPage.getByLabel("Setup token").count(), 0);
  await authPage.goForward();
  await authPage.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.equal(new URL(authPage.url()).pathname, "/login");
  assert.equal(await authPage.getByLabel("Setup token").count(), 0);
  assert.deepEqual(authBrowserErrors, []);
  await authContext.close();

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
    `/api/v1/captures/${captureIds.at(-1)}/thumbnail?v=2`,
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
  await page.getByText("Review 1 failed attempt", { exact: true }).click();
  await page
    .getByText('Readiness selector "#missing-release-marker" was not visible within 1,000 ms.', {
      exact: true,
    })
    .waitFor();
  await page.getByText("Terminal failure after retries", { exact: true }).waitFor();
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

  const webhookCreateEndpoint = `**/api/v1/projects/${indexable.id}/webhooks`;
  const webhookCreateForm = page.locator(".webhook-create-form");
  const webhookUrl = webhookCreateForm.getByLabel("HTTPS endpoint");
  const webhookThreshold = webhookCreateForm.getByLabel("Change threshold (%)");
  const addWebhook = webhookCreateForm.getByRole("button", { name: "Add signed webhook" });
  const createdSecretValue = "e2e-created-webhook-signing-secret";
  await page.route(webhookCreateEndpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-created-webhook",
        url: "https://hooks.example.com/created",
        threshold: 1.25,
        events: ["capture.changed", "capture.failed"],
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        secret: createdSecretValue,
      }),
    });
  });
  await webhookUrl.fill("https://hooks.example.com/created");
  await webhookThreshold.fill("1.25");
  await addWebhook.click();
  const addingWebhook = webhookCreateForm.getByRole("button", { name: "Adding…" });
  await addingWebhook.waitFor();
  assert.equal(await addingWebhook.isDisabled(), true);
  const createdSecret = webhookCreateForm.getByLabel("New webhook signing secret");
  await createdSecret.waitFor();
  assert.equal(await createdSecret.inputValue(), createdSecretValue);
  await webhookCreateForm
    .getByText("Copy this signing secret now. It cannot be shown again.", { exact: true })
    .waitFor();
  await addWebhook.waitFor();
  assert.equal(await webhookUrl.inputValue(), "");
  assert.equal(await webhookThreshold.inputValue(), "0");
  assert.equal(await page.locator(".error-notice").count(), 0);
  await webhookCreateForm.getByRole("button", { name: "Dismiss" }).click();
  assert.equal(await createdSecret.count(), 0);
  await page.unroute(webhookCreateEndpoint);

  await webhookUrl.fill("https://127.0.0.1/rejected");
  await webhookThreshold.fill("7.5");
  await addWebhook.scrollIntoViewIfNeeded();
  const webhookScrollPosition = await page.evaluate(() => globalThis.scrollY);
  await page.route(webhookCreateEndpoint, async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Webhook endpoint is not allowed" }),
      });
    return route.continue();
  });
  await addWebhook.click();
  const webhookCreateError = webhookCreateForm.locator(".webhook-create-feedback .error-notice");
  await webhookCreateError.waitFor();
  assert.match(await webhookCreateError.innerText(), /Webhook endpoint is not allowed/);
  assert.equal(await webhookUrl.inputValue(), "https://127.0.0.1/rejected");
  assert.equal(await webhookThreshold.inputValue(), "7.5");
  assert.equal(await page.evaluate(() => globalThis.scrollY), webhookScrollPosition);
  assert.match(browserErrors.pop() ?? "", /status of 400/);
  assert.deepEqual(browserErrors, []);
  await page.unroute(webhookCreateEndpoint);

  await webhookUrl.fill("https://hooks.example.com/network-failure");
  await webhookThreshold.fill("12.5");
  await page.route(webhookCreateEndpoint, async (route) => {
    if (route.request().method() === "POST") return route.abort("internetdisconnected");
    return route.continue();
  });
  await addWebhook.click();
  await page.waitForFunction(() => {
    const notice = globalThis.document.querySelector(
      ".webhook-create-form .webhook-create-feedback .error-notice",
    );
    return notice && !notice.textContent?.includes("Webhook endpoint is not allowed");
  });
  assert.match(await webhookCreateError.innerText(), /fetch|network/i);
  assert.equal(await webhookUrl.inputValue(), "https://hooks.example.com/network-failure");
  assert.equal(await webhookThreshold.inputValue(), "12.5");
  assert.equal(await page.evaluate(() => globalThis.scrollY), webhookScrollPosition);
  assert.match(browserErrors.pop() ?? "", /ERR_INTERNET_DISCONNECTED/);
  assert.deepEqual(browserErrors, []);
  await page.unroute(webhookCreateEndpoint);

  const profileSettings = page.locator(".profile-settings").filter({ hasText: "Edit Desktop" });
  await profileSettings.getByText("Edit Desktop", { exact: true }).click();
  const readinessSelector = profileSettings.getByLabel("Readiness selector");
  const saveProfile = profileSettings.getByRole("button", { name: "Save profile" });
  const profileEndpoint = `**/api/v1/projects/${indexable.id}/profiles/${profileId}`;
  await readinessSelector.fill("#release-ready");
  await saveProfile.scrollIntoViewIfNeeded();
  const profileScrollPosition = await page.evaluate(() => globalThis.scrollY);
  await page.route(profileEndpoint, async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    await route.continue();
  });
  await saveProfile.click();
  const savingProfile = profileSettings.getByRole("button", { name: "Saving…" });
  await savingProfile.waitFor();
  assert.equal(await savingProfile.isDisabled(), true);
  await profileSettings
    .getByText("Profile saved; run a test capture before scheduling.", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => globalThis.scrollY), profileScrollPosition);
  await page.unroute(profileEndpoint);

  assert.deepEqual(browserErrors, []);
  await readinessSelector.fill("#preserved-after-validation");
  await page.route(profileEndpoint, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Readiness selector is invalid" }),
    });
  });
  await saveProfile.click();
  const profileSaveError = profileSettings.locator(".profile-save-feedback .error-notice");
  await profileSaveError.waitFor();
  assert.match(await profileSaveError.innerText(), /Readiness selector is invalid/);
  assert.equal(await readinessSelector.inputValue(), "#preserved-after-validation");
  assert.equal(await page.evaluate(() => globalThis.scrollY), profileScrollPosition);
  assert.match(browserErrors.pop() ?? "", /status of 400/);
  assert.deepEqual(browserErrors, []);
  await page.unroute(profileEndpoint);

  await readinessSelector.fill("#preserved-after-network-error");
  await page.route(profileEndpoint, async (route) => route.abort("internetdisconnected"));
  await saveProfile.click();
  await page.waitForFunction(() => {
    const notice = globalThis.document.querySelector(
      ".profile-settings[open] .profile-save-feedback .error-notice",
    );
    return notice && !notice.textContent?.includes("Readiness selector is invalid");
  });
  assert.match(await profileSaveError.innerText(), /fetch|network/i);
  assert.equal(await readinessSelector.inputValue(), "#preserved-after-network-error");
  assert.equal(await page.evaluate(() => globalThis.scrollY), profileScrollPosition);
  assert.match(browserErrors.pop() ?? "", /ERR_INTERNET_DISCONNECTED/);
  assert.deepEqual(browserErrors, []);
  await page.unroute(profileEndpoint);

  const webhookCard = page.locator(".webhook-card").first();
  const rotateSecret = webhookCard.getByRole("button", { name: "Rotate secret" });
  await rotateSecret.waitFor();
  await page.evaluate(() => {
    globalThis.__sadCopiedValue = undefined;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          globalThis.__sadCopiedValue = value;
        },
      },
    });
  });
  await rotateSecret.click();
  const revealedSecret = webhookCard.getByLabel("Webhook signing secret");
  await revealedSecret.waitFor();
  const firstSecret = await revealedSecret.inputValue();
  await webhookCard.getByRole("button", { name: "Copy secret" }).click();
  await webhookCard.getByText("Signing secret copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__sadCopiedValue), firstSecret);

  await page.evaluate(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      },
    });
  });
  await rotateSecret.click();
  await page.waitForFunction((previous) => {
    const input = globalThis.document.querySelector(".webhook-secret-reveal input");
    return input instanceof globalThis.HTMLInputElement && input.value !== previous;
  }, firstSecret);
  const secondSecret = await revealedSecret.inputValue();
  await webhookCard.getByRole("button", { name: "Copy secret" }).click();
  await webhookCard.getByRole("button", { name: "Select secret" }).waitFor();
  await webhookCard.getByText(/complete signing secret is selected/i).waitFor();
  assert.deepEqual(
    await revealedSecret.evaluate((input) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    })),
    { start: 0, end: secondSecret.length, length: secondSecret.length },
  );

  await page.evaluate(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await rotateSecret.click();
  await page.waitForFunction((previous) => {
    const input = globalThis.document.querySelector(".webhook-secret-reveal input");
    return input instanceof globalThis.HTMLInputElement && input.value !== previous;
  }, secondSecret);
  const thirdSecret = await revealedSecret.inputValue();
  await webhookCard.getByRole("button", { name: "Copy secret" }).click();
  await webhookCard.getByRole("button", { name: "Select secret" }).waitFor();
  assert.deepEqual(
    await revealedSecret.evaluate((input) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    })),
    { start: 0, end: thirdSecret.length, length: thirdSecret.length },
  );
  await webhookCard.getByRole("button", { name: "Dismiss" }).click();
  assert.equal(await webhookCard.getByLabel("Webhook signing secret").count(), 0);
  assert.deepEqual(browserErrors, []);

  assert.match(
    await page.getByRole("status").filter({ hasText: "Automatic scheduled captures" }).innerText(),
    /Disabled/,
  );
  await page.route(`**/api/v1/projects/${indexable.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    await route.continue();
  });
  await page.getByLabel("Enable automatic scheduled captures").check();
  await page.getByLabel("Explicitly allow scheduling untested profiles").check();
  await page.getByRole("button", { name: "Save policy" }).click();
  await page.getByRole("button", { name: "Saving…" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Saving…" }).isDisabled(), true);
  await page.getByText("Capture policy saved.", { exact: true }).waitFor();
  assert.match(
    await page.getByRole("status").filter({ hasText: "Automatic scheduled captures" }).innerText(),
    /Enabled[\s\S]*Next capture[\s\S]*UTC/,
  );
  await page.getByText(/Each enabled profile must complete a successful capture/).waitFor();
  await page.unroute(`**/api/v1/projects/${indexable.id}`);
  await page.getByRole("button", { name: `Delete ${indexable.name}` }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${baseUrl}/settings`);
  await page.getByRole("heading", { name: "API access" }).waitFor();
  await page.getByRole("heading", { name: "Storage" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Secrets" }).count(), 0);

  const addTarget = page.getByRole("button", { name: /Add target/ });
  await addTarget.click();
  const targetDialog = page.getByRole("dialog");
  await targetDialog.waitFor();
  await page.locator(".dialog-overlay").click({ position: { x: 5, y: 5 } });
  await targetDialog.waitFor({ state: "detached" });
  assert.equal(
    await addTarget.evaluate((button) => button === globalThis.document.activeElement),
    true,
  );

  await addTarget.click();
  await page.getByLabel("Target name").fill("Unsaved destination");
  await page.getByRole("button", { name: "Discard changes", exact: true }).waitFor();
  page.once("dialog", async (confirmation) => {
    assert.match(confirmation.message(), /Discard the unsaved destination changes/);
    await confirmation.dismiss();
  });
  await page.locator(".dialog-overlay").click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByLabel("Target name").inputValue(), "Unsaved destination");

  page.once("dialog", async (confirmation) => {
    assert.match(confirmation.message(), /Discard the unsaved destination changes/);
    await confirmation.dismiss();
  });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByLabel("Target name").inputValue(), "Unsaved destination");

  page.once("dialog", async (confirmation) => {
    assert.match(confirmation.message(), /Discard the unsaved destination changes/);
    await confirmation.accept();
  });
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await targetDialog.waitFor({ state: "detached" });
  assert.equal(
    await addTarget.evaluate((button) => button === globalThis.document.activeElement),
    true,
  );

  const apiAccessCard = page.locator(".api-access-card");
  const tokenName = apiAccessCard.getByLabel("Token name");
  const createToken = apiAccessCard.getByRole("button", { name: "Create token" });
  const revealedToken = apiAccessCard.getByLabel("New API token");
  const dismissToken = apiAccessCard.getByRole("button", { name: "Dismiss" });

  await page.evaluate(() => {
    globalThis.__sadCopiedValue = undefined;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          globalThis.__sadCopiedValue = value;
        },
      },
    });
  });
  await tokenName.fill("E2E copied token");
  await createToken.click();
  await revealedToken.waitFor();
  const copiedToken = await revealedToken.inputValue();
  await apiAccessCard.getByRole("button", { name: "Copy token" }).click();
  await apiAccessCard.getByText("API token copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__sadCopiedValue), copiedToken);
  assert.equal(await page.locator(".error-notice").count(), 0);
  await dismissToken.click();
  assert.equal(await revealedToken.count(), 0);

  await page.evaluate(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      },
    });
  });
  await tokenName.fill("E2E manually copied token");
  await createToken.click();
  await revealedToken.waitFor();
  const selectedToken = await revealedToken.inputValue();
  await apiAccessCard.getByRole("button", { name: "Copy token" }).click();
  await apiAccessCard.getByRole("button", { name: "Select token" }).waitFor();
  await apiAccessCard.getByText(/complete API token is selected/i).waitFor();
  assert.deepEqual(
    await revealedToken.evaluate((input) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    })),
    { start: 0, end: selectedToken.length, length: selectedToken.length },
  );
  assert.equal(await page.locator(".error-notice").count(), 0);
  await dismissToken.click();

  await page.evaluate(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await tokenName.fill("E2E unavailable clipboard token");
  await createToken.click();
  await revealedToken.waitFor();
  const unavailableToken = await revealedToken.inputValue();
  await apiAccessCard.getByRole("button", { name: "Copy token" }).click();
  await apiAccessCard.getByRole("button", { name: "Select token" }).waitFor();
  assert.deepEqual(
    await revealedToken.evaluate((input) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    })),
    { start: 0, end: unavailableToken.length, length: unavailableToken.length },
  );
  await dismissToken.click();
  assert.equal(await revealedToken.count(), 0);
  assert.deepEqual(browserErrors, []);

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
