import { assertSafeUrl } from "@sad/core";
import type { WorkerJob } from "@sad/contracts";
import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type { WorkerApi } from "./api.js";
import { SafeProxy } from "./safe-proxy.js";

type CaptureJob = Extract<WorkerJob, { type: "capture" }>;

export function headersForCaptureRequest(
  requestUrl: string,
  captureOrigin: string,
  requestHeaders: Record<string, string>,
  captureHeaders: Record<string, string>,
): Record<string, string> | undefined {
  if (new URL(requestUrl).origin !== captureOrigin) return undefined;

  const headers = { ...requestHeaders };
  for (const [name, value] of Object.entries(captureHeaders)) {
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "Capture failed";
  return message
    .replace(/https?:\/\/[^\s"']+/g, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .slice(0, 4000);
}

export async function runCapture(job: CaptureJob, api: WorkerApi): Promise<void> {
  const started = Date.now();
  const capturedAt = new Date().toISOString();
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let proxy: SafeProxy | undefined;
  try {
    await assertSafeUrl(job.url, job.privateTargetAllowlist);
    proxy = await SafeProxy.start(job.privateTargetAllowlist);
    const browserType = { chromium, firefox, webkit }[job.profile.browser];
    browser = await browserType.launch({ headless: true });
    const preset = job.profile.deviceName ? devices[job.profile.deviceName] : undefined;
    const captureOrigin = new URL(job.url).origin;
    context = await browser.newContext({
      ...preset,
      viewport: { width: job.profile.viewportWidth, height: job.profile.viewportHeight },
      deviceScaleFactor: job.profile.deviceScaleFactor,
      locale: job.profile.locale,
      timezoneId: job.profile.timezone,
      colorScheme: job.profile.colorScheme,
      reducedMotion: job.profile.reducedMotion,
      proxy: { server: proxy.url },
      ignoreHTTPSErrors: false,
    });
    if (job.cookies.length) await context.addCookies(job.cookies);
    page = await context.newPage();
    await page.route("**/*", async (route) => {
      try {
        const request = route.request();
        await assertSafeUrl(request.url(), job.privateTargetAllowlist);
        const headers = headersForCaptureRequest(
          request.url(),
          captureOrigin,
          request.headers(),
          job.headers,
        );
        await route.continue(headers ? { headers } : undefined);
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const response = await page.goto(job.url, {
      waitUntil: "domcontentloaded",
      timeout: job.profile.timeoutMs,
    });
    if (job.profile.waitForSelector)
      await page
        .locator(job.profile.waitForSelector)
        .waitFor({ state: "visible", timeout: job.profile.timeoutMs });
    if (job.profile.delayMs) await page.waitForTimeout(job.profile.delayMs);
    const screenshot = await page.screenshot({
      fullPage: job.profile.extent === "fullPage",
      type: "png",
      animations: "disabled",
    });
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    await api.upload(job, screenshot, {
      capturedAt,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      width: job.profile.extent === "fullPage" ? dimensions.width : job.profile.viewportWidth,
      height: job.profile.extent === "fullPage" ? dimensions.height : job.profile.viewportHeight,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    let screenshot: Buffer | undefined;
    let dimensions: { width: number; height: number } | undefined;
    try {
      if (page) {
        screenshot = await page.screenshot({ type: "png", animations: "disabled" });
        dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      }
    } catch {
      /* best effort diagnostic */
    }
    await api.fail(job, {
      capturedAt,
      error: redactError(error),
      finalUrl: page?.url() ?? null,
      durationMs: Date.now() - started,
      ...(screenshot ? { screenshot } : {}),
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    });
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await proxy?.close().catch(() => undefined);
  }
}
