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
type CaptureStage =
  | "target validation"
  | "capture proxy"
  | "browser launch"
  | "browser context"
  | "navigation"
  | "readiness selector"
  | "settling delay"
  | "screenshot"
  | "result upload";

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

function redactMessage(message: string): string {
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

export function captureFailureMessage(
  error: unknown,
  stage: CaptureStage,
  profile: Pick<CaptureJob["profile"], "waitForSelector" | "timeoutMs">,
): string {
  const raw = error instanceof Error ? error.message : "Capture failed without an error message";
  let message: string;
  if (stage === "readiness selector" && profile.waitForSelector) {
    message = `Readiness selector ${JSON.stringify(profile.waitForSelector)} was not visible within ${profile.timeoutMs.toLocaleString("en-US")} ms.`;
  } else if (raw.includes("ERR_NAME_NOT_RESOLVED")) {
    message = "Navigation failed because the target hostname could not be resolved.";
  } else if (raw.includes("ERR_CONNECTION_REFUSED")) {
    message = "Navigation failed because the target refused the connection.";
  } else if (stage === "navigation" && /timeout/i.test(raw)) {
    message = `Navigation did not finish within ${profile.timeoutMs.toLocaleString("en-US")} ms.`;
  } else {
    message = `${stage[0]!.toUpperCase()}${stage.slice(1)} failed: ${raw}`;
  }
  return redactMessage(message);
}

export async function runCapture(job: CaptureJob, api: WorkerApi): Promise<void> {
  const started = Date.now();
  const capturedAt = new Date().toISOString();
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let proxy: SafeProxy | undefined;
  let stage: CaptureStage = "target validation";
  try {
    await assertSafeUrl(job.url, job.privateTargetAllowlist);
    stage = "capture proxy";
    proxy = await SafeProxy.start(job.privateTargetAllowlist);
    const browserType = { chromium, firefox, webkit }[job.profile.browser];
    stage = "browser launch";
    browser = await browserType.launch({ headless: true });
    const preset = job.profile.deviceName ? devices[job.profile.deviceName] : undefined;
    const captureOrigin = new URL(job.url).origin;
    stage = "browser context";
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
    stage = "navigation";
    const response = await page.goto(job.url, {
      waitUntil: "domcontentloaded",
      timeout: job.profile.timeoutMs,
    });
    if (job.profile.waitForSelector) {
      stage = "readiness selector";
      await page
        .locator(job.profile.waitForSelector)
        .waitFor({ state: "visible", timeout: job.profile.timeoutMs });
    }
    stage = "settling delay";
    if (job.profile.delayMs) await page.waitForTimeout(job.profile.delayMs);
    stage = "screenshot";
    const screenshot = await page.screenshot({
      fullPage: job.profile.extent === "fullPage",
      type: "png",
      animations: "disabled",
    });
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    stage = "result upload";
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
      error: captureFailureMessage(error, stage, job.profile),
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
