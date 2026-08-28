import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/database.js";
import { STATIC_GALLERY_PAGE_SIZE, StaticGalleryRenderer } from "../src/publication-renderer.js";
import { contentSecurityPolicy } from "../src/publication-templates.js";
import { LocalBlobStore } from "../src/storage.js";

const templateRoot = fileURLToPath(new URL("../static-gallery", import.meta.url));

function emptyProjectInput(
  name: string,
  slug: string,
  publishMode: "private" | "unlisted" | "indexable",
) {
  return {
    name,
    slug,
    url: "https://example.com",
    publishMode,
    scheduleExpression: "0 0 * * *",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    retentionDays: null,
    retentionCount: null,
    headers: {},
    cookies: [],
    profiles: [
      {
        name: "Desktop",
        browser: "chromium" as const,
        enabled: true,
        deviceName: null,
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        extent: "viewport" as const,
        colorScheme: "light" as const,
        locale: "en-US",
        timezone: "UTC",
        reducedMotion: "reduce" as const,
        delayMs: 1000,
        waitForSelector: null,
        timeoutMs: 30_000,
      },
    ],
  };
}

describe("static gallery publication renderer", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("limits static CSP analytics exceptions to the configured provider origin", () => {
    const branding = {
      title: "Fixture",
      description: "Fixture history",
      logoText: "Fixture",
      logoUrl: null,
      tagline: "Recorded daily",
      accentColor: "#dbff53",
      backgroundColor: "#10151d",
      darkMode: true,
      supplementalFooter: "",
      analytics: {
        provider: "posthog" as const,
        host: "https://analytics.example.com/ingest",
        apiKey: "fixture",
      },
    };
    const policy = contentSecurityPolicy(branding);
    expect(policy).toContain("script-src 'self' https://analytics.example.com");
    expect(policy).toContain("connect-src 'self' https://analytics.example.com");
    expect(policy).not.toContain("/ingest");
  });

  it("renders deterministic, self-contained pages with permanent attribution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sad-renderer-test-"));
    directories.push(directory);
    const db = new AppDatabase(join(directory, "sad.sqlite"));
    const blobs = new LocalBlobStore(join(directory, "blobs"));
    const project = db.createProject(
      {
        name: "Escaped <Studio> & history",
        slug: "studio-history",
        url: "https://example.com",
        publishMode: "indexable",
        scheduleExpression: "0 0 * * *",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
        retentionDays: null,
        retentionCount: null,
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
            delayMs: 1000,
            waitForSelector: null,
            timeoutMs: 30_000,
          },
        ],
      },
      "unused",
      new Date().toISOString(),
    );
    const image = Buffer.from("fixture-image");
    const thumbnail = Buffer.from("fixture-thumbnail");
    expect(STATIC_GALLERY_PAGE_SIZE).toBe(12);
    for (let index = 0; index < 13; index += 1) {
      const runId = db.enqueueRun(project.id, "manual");
      const job = db.claimJob()!;
      const imageKey = `captures/fixture-${index}.png`;
      const thumbnailKey = `thumbnails/fixture-${index}.webp`;
      await blobs.put(imageKey, image);
      await blobs.put(thumbnailKey, thumbnail);
      db.recordCapture(job, {
        status: "succeeded",
        captured_at: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        final_url: "https://example.com",
        http_status: 200,
        width: 1440,
        height: 900,
        sha256: `fixture-${index}`,
        change_percent: index ? index / 10 : null,
        image_key: imageKey,
        thumbnail_key: thumbnailKey,
        diff_key: null,
        error: null,
        duration_ms: 100,
      });
      expect(runId).toBe(job.run_id);
    }
    const target = db.createPublicationTarget(
      {
        name: "Fixture target",
        baseUrl: "https://history.example.com",
        scheduleMode: "manual",
        scheduleExpression: null,
        scheduleTimezone: "UTC",
        branding: {
          title: "Fixture history",
          description: "Static screenshots",
          logoText: "Fixture",
          logoUrl: null,
          tagline: "Recorded daily",
          accentColor: "#dbff53",
          backgroundColor: "#10151d",
          darkMode: true,
          supplementalFooter: "Fixture studio",
          analytics: { provider: "none" },
        },
        target: {
          adapter: "vercel",
          config: { projectId: "fixture", teamId: null },
          credentials: { token: "unused" },
        },
      },
      "unused",
      null,
    );
    db.attachProjectToTarget(project.id, target.id);
    const renderer = new StaticGalleryRenderer({
      db,
      blobs,
      templatePath: templateRoot,
    });
    expect(await renderer.verify()).toEqual({ available: true, error: null });
    const first = await renderer.render(target);
    const second = await renderer.render(target);
    try {
      expect(second.files).toEqual(first.files);
      expect(first.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "index.html",
          "index.xml",
          "sitemap.xml",
          "p/studio-history/index.html",
          `p/studio-history/desktop/page/1/index.html`,
          `p/studio-history/desktop/page/2/index.html`,
        ]),
      );
      const htmlFiles = first.files.filter((file) => file.path.endsWith(".html"));
      for (const file of htmlFiles) {
        const html = await readFile(join(first.directory, file.path), "utf8");
        expect(html, file.path).toContain("https://www.arts-link.com/");
        expect(html, file.path).toContain("https://github.com/arts-link/screenshot-a-day");
        expect(html).not.toContain("/api/");
        expect(html).not.toContain("localhost:4400");
      }
      const root = await readFile(join(first.directory, "index.html"), "utf8");
      expect(root).toContain("Visual histories");
      expect(root).toContain("Escaped &lt;Studio&gt; &amp; history");
      expect(root).toContain("Recorded daily");
      expect(root).not.toContain("Latest stuff");
      const gallery = await readFile(join(first.directory, "p/studio-history/index.html"), "utf8");
      expect(gallery).toContain("Escaped &lt;Studio&gt; &amp; history");
      expect(gallery).toContain("media/");
      expect(gallery).not.toContain("noindex");
      // Attribute context: an unescaped project name here would break out of alt="".
      expect(gallery).not.toMatch(/alt="[^"]*<Studio>/);
      const profile = await readFile(
        join(first.directory, "p/studio-history/desktop/page/1/index.html"),
        "utf8",
      );
      expect(profile.match(/data-capture-card/g)).toHaveLength(12);
      expect(profile).toContain("Browser-only split");
      expect(profile).toContain("data-comparison-scope=");
      expect(profile).toContain('data-slot="earlier"');
      expect(profile).toContain('data-slot="later"');
      expect(profile).toContain("data-compare-id=");
      const secondPage = await readFile(
        join(first.directory, "p/studio-history/desktop/page/2/index.html"),
        "utf8",
      );
      expect(secondPage.match(/data-capture-card/g)).toHaveLength(1);
      expect(secondPage).toContain("← Newer");
      const robots = await readFile(join(first.directory, "robots.txt"), "utf8");
      expect(robots).toContain("Disallow: /s/");
      expect(robots).toContain("Sitemap: https://history.example.com/sitemap.xml");
      const headers = await readFile(join(first.directory, "_headers"), "utf8");
      expect(headers).toContain("X-Content-Type-Options: nosniff");
      expect(headers).toContain("X-Frame-Options: DENY");
      expect(headers).toContain("Referrer-Policy: same-origin");
      expect(headers).toContain(
        "Content-Security-Policy: default-src 'none'; img-src 'self' data:",
      );
      expect(headers).toContain("frame-ancestors 'none'");
      expect(headers).not.toContain("__SAD_CONTENT_SECURITY_POLICY__");
    } finally {
      await first.cleanup();
      await second.cleanup();
      db.close();
    }
  }, 60_000);

  it("omits private projects and keeps unlisted galleries out of indexes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sad-renderer-privacy-test-"));
    directories.push(directory);
    const db = new AppDatabase(join(directory, "sad.sqlite"));
    const blobs = new LocalBlobStore(join(directory, "blobs"));
    const unlisted = db.createProject(
      emptyProjectInput("Secret history", "secret-history", "unlisted"),
      "unused",
      new Date().toISOString(),
    );
    const privateProject = db.createProject(
      emptyProjectInput("Private history", "private-history", "private"),
      "unused",
      new Date().toISOString(),
    );
    const target = db.createPublicationTarget(
      {
        name: "Privacy fixture",
        baseUrl: "https://history.example.com",
        scheduleMode: "manual",
        scheduleExpression: null,
        scheduleTimezone: "UTC",
        branding: {
          title: "Fixture history",
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
          adapter: "netlify",
          config: { siteId: "fixture" },
          credentials: { token: "unused" },
        },
      },
      "unused",
      null,
    );
    db.attachProjectToTarget(unlisted.id, target.id);
    db.attachProjectToTarget(privateProject.id, target.id);
    const renderer = new StaticGalleryRenderer({
      db,
      blobs,
      templatePath: templateRoot,
    });
    const site = await renderer.render(target);
    try {
      const secretPath = `s/${unlisted.share_token}/index.html`;
      expect(site.files.map((file) => file.path)).toContain(secretPath);
      expect(site.files.map((file) => file.path)).not.toContain("p/private-history/index.html");
      const secretHtml = await readFile(join(site.directory, secretPath), "utf8");
      expect(secretHtml).toContain('content="noindex,nofollow,noarchive"');
      const root = await readFile(join(site.directory, "index.html"), "utf8");
      const sitemap = await readFile(join(site.directory, "sitemap.xml"), "utf8");
      const rss = await readFile(join(site.directory, "index.xml"), "utf8");
      expect(root).not.toContain("Secret history");
      expect(root).not.toContain("Private history");
      expect(sitemap).not.toContain(String(unlisted.share_token));
      expect(rss).not.toContain("Secret history");
    } finally {
      await site.cleanup();
      db.close();
    }
  }, 60_000);
});
