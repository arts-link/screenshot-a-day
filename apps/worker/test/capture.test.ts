import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { WorkerJob } from "@sad/contracts";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkerApi } from "../src/api.js";
import { runCapture } from "../src/capture.js";

describe("Playwright capture profiles", () => {
  let server: Server;
  let origin: string;
  let sawCredentials = false;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/fixture" }).end();
        return;
      }
      sawCredentials =
        request.headers["x-fixture"] === "present" && request.headers.cookie === "session=test";
      response
        .writeHead(sawCredentials ? 200 : 403, { "content-type": "text/html" })
        .end(
          "<!doctype html><style>html,body{margin:0}body{min-height:1200px;background:#123456}</style><main id=ready>fixture</main>",
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it.each(["chromium", "firefox", "webkit"] as const)(
    "captures a deterministic full page with %s",
    async (browser) => {
      sawCredentials = false;
      const upload = vi.fn();
      const fail = vi.fn();
      const api = { upload, fail } as unknown as WorkerApi;
      const job: Extract<WorkerJob, { type: "capture" }> = {
        id: `job-${browser}`,
        leaseToken: "lease",
        attempt: 1,
        type: "capture",
        projectId: "project",
        runId: "run",
        url: `${origin}/redirect`,
        headers: { "x-fixture": "present" },
        cookies: [
          {
            name: "session",
            value: "test",
            domain: "127.0.0.1",
            path: "/",
            secure: false,
            httpOnly: true,
            sameSite: "Lax",
          },
        ],
        privateTargetAllowlist: ["127.0.0.1"],
        profile: {
          id: `profile-${browser}`,
          name: browser,
          browser,
          enabled: true,
          deviceName: null,
          viewportWidth: 800,
          viewportHeight: 600,
          deviceScaleFactor: 1,
          extent: "fullPage",
          colorScheme: "dark",
          locale: "en-US",
          timezone: "UTC",
          reducedMotion: "reduce",
          delayMs: 0,
          waitForSelector: "#ready",
          timeoutMs: 30_000,
        },
      };

      await runCapture(job, api);

      expect(fail).not.toHaveBeenCalled();
      expect(upload).toHaveBeenCalledOnce();
      const [, screenshot, metadata] = upload.mock.calls[0] as [
        WorkerJob,
        Buffer,
        { finalUrl: string; httpStatus: number; width: number; height: number },
      ];
      expect(sawCredentials).toBe(true);
      expect(metadata).toMatchObject({
        finalUrl: `${origin}/fixture`,
        httpStatus: 200,
        width: 800,
        height: 1200,
      });
      expect(await sharp(screenshot).metadata()).toMatchObject({
        format: "png",
        width: 800,
        height: 1200,
      });
    },
    60_000,
  );
});
