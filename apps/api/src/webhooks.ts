import { assertSafeUrl, decryptJson, signWebhook } from "@sad/core";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";

async function postWithValidatedRedirects(
  url: string,
  body: string,
  headers: Record<string, string>,
  allowlist: string[],
): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeUrl(current.toString(), allowlist);
    const response = await fetch(current, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Webhook redirect omitted the Location header");
    if (redirects === 5) throw new Error("Webhook exceeded five redirects");
    current = new URL(location, current);
  }
  throw new Error("Webhook redirect validation failed");
}

export function startWebhookDispatcher(
  db: AppDatabase,
  config: AppConfig,
  log: FastifyBaseLogger,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const delivery = db.claimWebhookDelivery();
      if (!delivery) return;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = decryptJson<{ secret: string }>(
        delivery.secret_encrypted,
        config.encryptionKey,
      ).secret;
      try {
        const response = await postWithValidatedRedirects(
          delivery.url,
          delivery.payload_json,
          {
            "content-type": "application/json",
            "user-agent": "Screenshot-a-Day/0.1.0",
            "x-sad-event": delivery.event,
            "x-sad-timestamp": timestamp,
            "x-sad-signature": `sha256=${signWebhook(secret, timestamp, delivery.payload_json)}`,
          },
          config.privateTargetAllowlist,
        );
        db.finishWebhookDelivery(
          delivery.id,
          response.ok,
          response.status,
          response.ok ? null : `HTTP ${response.status}`,
          delivery.attempts,
        );
      } catch (error) {
        db.finishWebhookDelivery(
          delivery.id,
          false,
          null,
          error instanceof Error ? error.message : "request failed",
          delivery.attempts,
        );
      }
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "webhook dispatcher failed",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
