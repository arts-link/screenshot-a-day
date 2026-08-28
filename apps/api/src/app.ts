import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  API_VERSION,
  PRODUCT_VERSION,
  WEBHOOK_SCHEMA_VERSION,
  captureProfileInputSchema,
  loginInputSchema,
  projectInputSchema,
  publicationTargetInputSchema,
  publicationTargetUpdateSchema,
  runTriggerSchema,
  setupInputSchema,
  type CaptureRecord,
  type WorkerJob,
} from "@sad/contracts";
import {
  assertSafeUrl,
  decryptJson,
  encryptJson,
  hashToken,
  nextSchedule,
  randomToken,
  TargetPolicyError,
} from "@sad/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authenticate,
  createSession,
  hashPassword,
  requireIdentity,
  requireInstanceIdentity,
  SESSION_COOKIE,
  SetupManager,
  verifyPassword,
} from "./auth.js";
import type { AppConfig } from "./config.js";
import {
  AppDatabase,
  type CaptureRow,
  type ProjectRow,
  type PublicationJobRow,
  type PublicationTargetRow,
  type WebhookDeliveryRow,
  type WebhookRow,
} from "./database.js";
import { ComparisonCapacityError, ComparisonService } from "./comparisons.js";
import { ComparisonTooLargeError, compareImages, thumbnail } from "./images.js";
import { startScheduler } from "./scheduler.js";
import { LocalBlobStore, type BlobStore } from "./storage.js";
import { startWebhookDispatcher } from "./webhooks.js";
import {
  cleanupStalePublicationDirectories,
  StaticGalleryRenderer,
  type PublicationRenderer,
} from "./publication-renderer.js";
import { nextPublicationRun, PublicationService } from "./publication-service.js";
import { openApiSchemas, openApiTransform } from "./openapi.js";

interface Dependencies {
  config: AppConfig;
  db?: AppDatabase;
  blobs?: BlobStore;
  publicationRenderer?: PublicationRenderer;
}

const captureQuerySchema = z.object({
  profileId: z.string().optional(),
  status: z.enum(["all", "succeeded", "failed"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const comparisonInputSchema = z.object({
  firstId: z.string().min(1),
  secondId: z.string().min(1),
});

function comparisonRows(
  db: AppDatabase,
  firstId: string,
  secondId: string,
  projectId?: string,
): [CaptureRow, CaptureRow] | null {
  if (firstId === secondId) return null;
  const first = db.getCapture(firstId);
  const second = db.getCapture(secondId);
  if (
    !first?.image_key ||
    !second?.image_key ||
    first.status !== "succeeded" ||
    second.status !== "succeeded" ||
    first.project_id !== second.project_id ||
    first.profile_id !== second.profile_id ||
    (projectId && first.project_id !== projectId)
  )
    return null;
  return Date.parse(first.captured_at) <= Date.parse(second.captured_at)
    ? [first, second]
    : [second, first];
}

export async function drainBlobDeletions(
  db: AppDatabase,
  blobs: BlobStore,
  log?: Pick<FastifyInstance["log"], "warn">,
): Promise<void> {
  for (;;) {
    const keys = db.pendingBlobDeletions();
    if (keys.length === 0) return;
    let deleted = 0;
    for (const key of keys) {
      try {
        await blobs.delete(key);
        db.finishBlobDeletion(key);
        deleted++;
      } catch (error) {
        log?.warn(
          { key, error: error instanceof Error ? error.message : "unknown" },
          "blob deletion will be retried",
        );
      }
    }
    if (deleted < keys.length) return;
  }
}

function captureDto(row: CaptureRow): CaptureRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    profileId: row.profile_id,
    runId: row.run_id,
    status: row.status,
    capturedAt: row.captured_at,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    changePercent: row.change_percent,
    imageUrl: row.image_key ? `/api/v1/captures/${row.id}/image` : null,
    thumbnailUrl: row.thumbnail_key ? `/api/v1/captures/${row.id}/thumbnail` : null,
    error: row.error,
  };
}

function publicProject(project: ProjectRow, db: AppDatabase) {
  const profiles = db.listProfiles(project.id).map((profile) => ({
    id: profile.id,
    name: profile.name,
    browser: profile.browser,
    settings: JSON.parse(profile.settings_json),
  }));
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    publishMode: project.publish_mode,
    profiles,
  };
}

function projectPublicationDto(project: ProjectRow, db: AppDatabase) {
  const publication = db.getProjectPublication(project.id);
  if (!publication) return null;
  const target = db.getPublicationTarget(publication.target_id);
  const latestJob = db.listPublicationJobs(publication.target_id, 1)[0];
  return {
    targetId: publication.target_id,
    targetName: target?.name ?? "Unknown target",
    targetAdapter: target?.adapter ?? "vercel",
    url: publication.gallery_url,
    state: publication.state,
    pending: publication.state !== "active",
    active: publication.state === "active" && project.publish_mode !== "private",
    lastPublishedAt: publication.last_published_at,
    lastSuccessfulRevision: publication.last_successful_revision,
    lastError: publication.last_error,
    removalWarning:
      publication.state === "removal_pending" || publication.state === "removal_failed"
        ? "Remote files may remain available until removal succeeds."
        : null,
    latestJob: latestJob ? publicationJobSummary(latestJob) : null,
  };
}

function publicationJobSummary(job: PublicationJobRow) {
  return {
    id: job.id,
    status: job.status,
    operation: job.operation,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

function publicationTargetDto(target: PublicationTargetRow, db: AppDatabase) {
  const jobs = db.listPublicationJobs(target.id, 1);
  const latest = jobs[0];
  const state =
    latest?.status === "building" || latest?.status === "deploying"
      ? "publishing"
      : latest?.status === "queued"
        ? "queued"
        : latest?.status === "failed"
          ? "failed"
          : target.dirty_revision > target.published_revision
            ? "dirty"
            : "published";
  return {
    id: target.id,
    name: target.name,
    adapter: target.adapter,
    baseUrl: target.base_url,
    branding: JSON.parse(target.branding_json),
    scheduleMode: target.schedule_mode,
    scheduleExpression: target.schedule_expression,
    scheduleTimezone: target.schedule_timezone,
    adapterConfig: JSON.parse(target.adapter_config_json),
    credentialConfigured: Boolean(target.credentials_encrypted),
    dirtyRevision: target.dirty_revision,
    publishedRevision: target.published_revision,
    nextRunAt: target.next_run_at,
    lastVerifiedAt: target.last_verified_at,
    lastVerificationError: target.last_verification_error,
    state,
    latestJob: latest ? publicationJobSummary(latest) : null,
    projectCount: db.listTargetProjectPublications(target.id).length,
    createdAt: target.created_at,
  };
}

function webhookDto(hook: WebhookRow) {
  return {
    id: hook.id,
    url: hook.url,
    threshold: hook.threshold,
    events: JSON.parse(hook.events_json) as string[],
    enabled: Boolean(hook.enabled),
    createdAt: hook.created_at,
    updatedAt: hook.updated_at,
  };
}

function webhookDeliveryDto(delivery: WebhookDeliveryRow) {
  return {
    id: delivery.id,
    event: delivery.event,
    status: delivery.status,
    attempts: delivery.attempts,
    responseStatus: delivery.response_status,
    error: delivery.error,
    createdAt: delivery.created_at,
    updatedAt: delivery.updated_at,
  };
}

function workerAuthorized(request: FastifyRequest, config: AppConfig): boolean {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(bearer && hashToken(bearer) === hashToken(config.workerToken));
}

export async function buildApp(dependencies: Dependencies): Promise<FastifyInstance> {
  const { config } = dependencies;
  await mkdir(config.dataDir, { recursive: true });
  const db = dependencies.db ?? new AppDatabase(`${config.dataDir}/sad.sqlite`);
  const blobs = dependencies.blobs ?? new LocalBlobStore(`${config.dataDir}/blobs`);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "headers",
        "cookies",
        "credentials",
        "token",
        "privateKey",
        "passphrase",
      ],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 30 * 1024 * 1024,
  });
  const setup = new SetupManager();
  const publicationRenderer =
    dependencies.publicationRenderer ??
    new StaticGalleryRenderer({
      db,
      blobs,
      templatePath: fileURLToPath(new URL("../static-gallery", import.meta.url)),
    });
  const publications = new PublicationService({
    db,
    config,
    renderer: publicationRenderer,
    log: app.log,
  });
  const comparisons = new ComparisonService();
  void cleanupStalePublicationDirectories().catch((error) =>
    app.log.warn(
      { error: error instanceof Error ? error.message : "unknown" },
      "stale publication workspace cleanup failed",
    ),
  );
  let deletionDrain: Promise<void> | undefined;
  const drainDeletions = () => {
    deletionDrain ??= drainBlobDeletions(db, blobs, app.log).finally(() => {
      deletionDrain = undefined;
    });
    return deletionDrain;
  };
  void drainDeletions();
  const deletionTimer = setInterval(() => void drainDeletions(), 30_000);
  deletionTimer.unref();

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false, max: 10, timeWindow: "1 minute" });
  await app.register(multipart);
  await app.register(swagger, {
    openapi: {
      info: { title: "Screenshot-a-Day API", version: PRODUCT_VERSION },
      servers: [{ url: config.publicUrl }],
      components: {
        schemas: openApiSchemas as never,
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
          bearerToken: { type: "http", scheme: "bearer" },
        },
      },
    },
    hideUntagged: true,
    transform: openApiTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs/api" });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    if (error instanceof TargetPolicyError) return reply.code(400).send({ error: error.message });
    if (error instanceof ComparisonTooLargeError)
      return reply.code(422).send({ error: error.message, pixels: error.pixels });
    if (error instanceof ComparisonCapacityError)
      return reply.header("retry-after", "5").code(503).send({ error: error.message });
    const message = error instanceof Error ? error.message : "Unknown error";
    const statusCode =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    app.log.error({ error: message }, "request failed");
    return reply
      .code(statusCode)
      .send({ error: statusCode < 500 ? message : "Internal server error" });
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (request.url.startsWith("/internal/")) return;
    const identity = authenticate(db, request);
    if (identity?.kind !== "session") return;
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== new URL(config.publicUrl).host) {
      return reply.code(403).send({ error: "Cross-origin state changes are not allowed" });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "same-origin")
      .header("x-frame-options", "DENY")
      .header("cross-origin-opener-policy", "same-origin")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()")
      .header(
        "content-security-policy",
        request.url.startsWith("/docs/api")
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
    if (config.publicUrl.startsWith("https://"))
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    return payload;
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      db.raw.prepare("SELECT 1").get();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
  app.get("/version", async () => ({
    version: PRODUCT_VERSION,
    commit: config.buildCommit,
    apiVersion: API_VERSION,
  }));

  if (db.userCount() === 0) {
    const token = setup.issue();
    app.log.warn(
      { setupToken: token, expiresInMinutes: 15 },
      "Screenshot-a-Day requires initial setup",
    );
  }

  app.get("/api/v1/setup/status", async () => ({ configured: db.userCount() > 0 }));
  app.post(
    "/api/v1/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (db.userCount() > 0) return reply.code(409).send({ error: "Setup is already complete" });
      const input = setupInputSchema.parse(request.body);
      if (!setup.consume(input.token))
        return reply.code(401).send({ error: "Setup token is invalid or expired" });
      const user = db.createUser(input.email, await hashPassword(input.password));
      const session = createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.publicUrl.startsWith("https://"),
        path: "/",
        expires: session.expiresAt,
      });
      return reply.code(201).send({ email: user.email });
    },
  );

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginInputSchema.parse(request.body);
      const user = db.getUserByEmail(input.email);
      if (!user || !(await verifyPassword(user.password_hash, input.password)))
        return reply.code(401).send({ error: "Invalid email or password" });
      const session = createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.publicUrl.startsWith("https://"),
        path: "/",
        expires: session.expiresAt,
      });
      return { email: user.email };
    },
  );
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) db.deleteSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
  app.post(
    "/api/v1/auth/recover",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z
        .object({ token: z.string().min(20), password: z.string().min(12).max(256) })
        .parse(request.body);
      const stored = db.getSetting("admin_recovery");
      if (!stored) return reply.code(401).send({ error: "Recovery token is invalid or expired" });
      const recovery = JSON.parse(stored) as { tokenHash: string; expiresAt: string };
      if (
        new Date(recovery.expiresAt).getTime() <= Date.now() ||
        hashToken(body.token) !== recovery.tokenHash
      )
        return reply.code(401).send({ error: "Recovery token is invalid or expired" });
      db.updateAdministratorPassword(await hashPassword(body.password));
      db.deleteSetting("admin_recovery");
      return reply.code(204).send();
    },
  );
  app.get("/api/v1/auth/me", async (request, reply) => {
    const identity = requireIdentity(db, request, reply, "read");
    return identity
      ? { authenticated: true, kind: identity.kind, scopes: identity.scopes }
      : undefined;
  });

  app.get("/api/v1/projects", async (request, reply) => {
    const identity = requireIdentity(db, request, reply, "read");
    if (!identity) return;
    const projects = db.listProjects().map((project) => ({
      ...project,
      staticPublication: projectPublicationDto(db.getProject(project.id)!, db),
    }));
    return identity.projectIds
      ? projects.filter((project) => identity.projectIds!.includes(project.id))
      : projects;
  });
  app.post("/api/v1/projects", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    const input = projectInputSchema.parse(request.body);
    await assertSafeUrl(input.url, config.privateTargetAllowlist);
    const next = nextSchedule(input.scheduleExpression, input.scheduleTimezone).toISOString();
    const project = db.createProject(
      input,
      encryptJson({ headers: input.headers, cookies: input.cookies }, config.encryptionKey),
      next,
    );
    return reply.code(201).send({
      ...publicProject(project, db),
      shareToken: project.share_token,
      scheduleEnabled: Boolean(project.schedule_enabled),
      staticPublication: null,
    });
  });
  app.get<{ Params: { id: string } }>("/api/v1/projects/:id", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "read", request.params.id)) return;
    const project = db.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    return {
      ...publicProject(project, db),
      url: project.url,
      shareToken: project.share_token,
      scheduleExpression: project.schedule_expression,
      scheduleTimezone: project.schedule_timezone,
      scheduleEnabled: Boolean(project.schedule_enabled),
      retentionDays: project.retention_days,
      retentionCount: project.retention_count,
      staticPublication: projectPublicationDto(project, db),
    };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/projects/:id", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
    if (db.getProjectPublication(request.params.id))
      return reply.code(409).send({
        error: "Make the project private and complete remote detachment before deleting it",
      });
    if (!db.deleteProject(request.params.id))
      return reply.code(404).send({ error: "Project not found" });
    await drainDeletions();
    return reply.code(204).send();
  });
  app.patch<{ Params: { id: string } }>("/api/v1/projects/:id", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
    const input = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        url: z.url().max(2048).optional(),
        scheduleExpression: z.string().min(1).max(120).optional(),
        scheduleTimezone: z.string().min(1).max(80).optional(),
        scheduleEnabled: z.boolean().optional(),
        confirmUntestedProfiles: z.boolean().default(false),
        retentionDays: z.number().int().positive().nullable().optional(),
        retentionCount: z.number().int().positive().nullable().optional(),
      })
      .parse(request.body);
    const current = db.getProject(request.params.id);
    if (!current) return reply.code(404).send({ error: "Project not found" });
    if (input.url) await assertSafeUrl(input.url, config.privateTargetAllowlist);
    const expression = input.scheduleExpression ?? current.schedule_expression;
    const timezone = input.scheduleTimezone ?? current.schedule_timezone;
    const nextRunAt = nextSchedule(expression, timezone).toISOString();
    if (input.scheduleEnabled && !input.confirmUntestedProfiles) {
      const untested = db
        .listProfiles(current.id)
        .filter((profile) => profile.enabled && !profile.test_succeeded_at);
      if (untested.length)
        return reply.code(409).send({
          error: "Every enabled profile needs a successful test capture before scheduling",
        });
    }
    const updated = db.updateProject(current.id, { ...input, nextRunAt });
    db.markProjectPublicationDirty(current.id);
    return {
      ...publicProject(updated!, db),
      url: updated!.url,
      shareToken: updated!.share_token,
      scheduleExpression: updated!.schedule_expression,
      scheduleTimezone: updated!.schedule_timezone,
      scheduleEnabled: Boolean(updated!.schedule_enabled),
      retentionDays: updated!.retention_days,
      retentionCount: updated!.retention_count,
      staticPublication: projectPublicationDto(updated!, db),
    };
  });
  app.put<{ Params: { id: string } }>(
    "/api/v1/projects/:id/credentials",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const input = projectInputSchema.pick({ headers: true, cookies: true }).parse(request.body);
      const updated = db.updateProjectSecrets(
        request.params.id,
        encryptJson({ headers: input.headers, cookies: input.cookies }, config.encryptionKey),
      );
      if (updated) db.markProjectPublicationDirty(request.params.id);
      return updated
        ? reply.code(204).send()
        : reply.code(404).send({ error: "Project not found" });
    },
  );
  app.patch<{ Params: { id: string } }>(
    "/api/v1/projects/:id/publication",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const body = z
        .object({
          publishMode: z.enum(["private", "unlisted", "indexable"]),
          rotate: z.boolean().default(false),
        })
        .parse(request.body);
      const current = db.getProject(request.params.id);
      const project = db.updatePublication(request.params.id, body.publishMode, body.rotate);
      if (project && db.getProjectPublication(project.id)) {
        const changed = current?.publish_mode !== body.publishMode;
        if (body.publishMode === "private" && changed)
          db.requestProjectPublicationRemoval(project.id);
        else if (changed || body.rotate) db.requestProjectPublicationPublish(project.id);
      }
      return project
        ? {
            publishMode: project.publish_mode,
            shareToken: project.share_token,
            staticPublication: projectPublicationDto(project, db),
          }
        : reply.code(404).send({ error: "Project not found" });
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/v1/projects/:id/static-publication",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const body = z.object({ targetId: z.string().min(1) }).parse(request.body);
      try {
        const publication = db.attachProjectToTarget(request.params.id, body.targetId);
        const project = db.getProject(request.params.id)!;
        return reply.code(201).send(projectPublicationDto(project, db) ?? publication);
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "Unable to attach project" });
      }
    },
  );
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/api/v1/projects/:id/static-publication",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      try {
        const force = request.query.force === "true";
        const publication = force
          ? db.forceProjectDetachment(request.params.id)
          : db.requestProjectDetachment(request.params.id);
        return publication
          ? force
            ? reply.code(200).send({
                detached: true,
                warning:
                  "Local management was removed without confirming remote cleanup. Deployed files may remain publicly accessible.",
              })
            : reply.code(202).send({
                state: publication.state,
                warning: "Detachment completes only after remote removal succeeds",
              })
          : reply.code(404).send({ error: "Static publication is not attached" });
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "Unable to detach project" });
      }
    },
  );

  app.get("/api/v1/publication/status", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    return publications.rendererStatus();
  });
  app.get("/api/v1/publication-targets", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    return db.listPublicationTargets().map((target) => publicationTargetDto(target, db));
  });
  app.post("/api/v1/publication-targets", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    const input = publicationTargetInputSchema.parse(request.body);
    if (input.target.adapter !== "sftp" && !input.baseUrl.startsWith("https://"))
      return reply.code(400).send({ error: "Vercel and Netlify publication URLs must use HTTPS" });
    let nextRunAt: string | null;
    try {
      nextRunAt = nextPublicationRun(
        input.scheduleMode,
        input.scheduleExpression,
        input.scheduleTimezone,
      );
    } catch {
      return reply.code(400).send({ error: "Publication schedule or timezone is invalid" });
    }
    const target = db.createPublicationTarget(
      input,
      encryptJson(input.target.credentials, config.encryptionKey),
      nextRunAt,
    );
    return reply.code(201).send(publicationTargetDto(target, db));
  });
  app.patch<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      const current = db.getPublicationTarget(request.params.id);
      if (!current) return reply.code(404).send({ error: "Publication target not found" });
      const input = publicationTargetUpdateSchema.parse(request.body);
      if (input.baseUrl) {
        const base = new URL(input.baseUrl);
        if (current.adapter !== "sftp" && base.protocol !== "https:")
          return reply
            .code(400)
            .send({ error: "Vercel and Netlify publication URLs must use HTTPS" });
        if ((base.pathname && base.pathname !== "/") || base.search || base.hash)
          return reply.code(400).send({
            error: "The canonical base URL must be an origin without a path, query, or fragment",
          });
      }
      if (input.target && input.target.adapter !== current.adapter)
        return reply.code(409).send({ error: "Create a new target to change adapter type" });
      const mode = input.scheduleMode ?? current.schedule_mode;
      const expression =
        input.scheduleExpression === undefined
          ? current.schedule_expression
          : input.scheduleExpression;
      const timezone = input.scheduleTimezone ?? current.schedule_timezone;
      if (mode === "custom" && !expression)
        return reply.code(400).send({ error: "Custom schedules require a cron expression" });
      let nextRunAt: string | null;
      try {
        nextRunAt = nextPublicationRun(mode, expression, timezone);
      } catch {
        return reply.code(400).send({ error: "Publication schedule or timezone is invalid" });
      }
      const target = db.updatePublicationTarget(current.id, {
        ...input,
        ...(input.target
          ? { adapter: input.target.adapter, adapterConfig: input.target.config }
          : {}),
        nextRunAt,
      });
      return publicationTargetDto(target!, db);
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id/credentials",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      const target = db.getPublicationTarget(request.params.id);
      if (!target) return reply.code(404).send({ error: "Publication target not found" });
      const credentials =
        target.adapter === "sftp"
          ? z
              .union([
                z.object({ kind: z.literal("password"), password: z.string().min(1).max(2000) }),
                z.object({
                  kind: z.literal("private_key"),
                  privateKey: z.string().min(1).max(100_000),
                  passphrase: z.string().max(2000).nullable().default(null),
                }),
              ])
              .parse(request.body)
          : z.object({ token: z.string().min(1).max(1000) }).parse(request.body);
      db.replacePublicationCredentials(target.id, encryptJson(credentials, config.encryptionKey));
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id/verify",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      const target = db.getPublicationTarget(request.params.id);
      if (!target) return reply.code(404).send({ error: "Publication target not found" });
      await publications.verifyTarget(target);
      return { verified: true, verifiedAt: db.getPublicationTarget(target.id)!.last_verified_at };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id/publish",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      if (!db.getPublicationTarget(request.params.id))
        return reply.code(404).send({ error: "Publication target not found" });
      return reply.code(202).send({ jobId: publications.publishNow(request.params.id) });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id/history",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      if (!db.getPublicationTarget(request.params.id))
        return reply.code(404).send({ error: "Publication target not found" });
      return db.listPublicationJobs(request.params.id).map((job) => ({
        id: job.id,
        status: job.status,
        operation: job.operation,
        desiredRevision: job.desired_revision,
        attempts: job.attempts,
        availableAt: job.available_at,
        deploymentId: job.deployment_id,
        deploymentUrl: job.deployment_url,
        error: job.error,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      }));
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/publication-targets/:id",
    async (request, reply) => {
      if (!requireInstanceIdentity(db, request, reply, "manage")) return;
      try {
        return db.deletePublicationTarget(request.params.id)
          ? reply.code(204).send()
          : reply.code(404).send({ error: "Publication target not found" });
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "Unable to delete target" });
      }
    },
  );
  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/runs", async (request, reply) =>
    requireIdentity(db, request, reply, "read", request.params.id)
      ? db.listRuns(request.params.id)
      : undefined,
  );
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/profiles", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
    if (!db.getProject(request.params.id))
      return reply.code(404).send({ error: "Project not found" });
    const profile = db.addProfile(request.params.id, captureProfileInputSchema.parse(request.body));
    db.markProjectPublicationDirty(request.params.id);
    return reply.code(201).send({
      id: profile.id,
      name: profile.name,
      browser: profile.browser,
      settings: JSON.parse(profile.settings_json),
    });
  });
  app.put<{ Params: { id: string; profileId: string } }>(
    "/api/v1/projects/:id/profiles/:profileId",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const current = db.getProfile(request.params.profileId);
      if (!current || current.project_id !== request.params.id)
        return reply.code(404).send({ error: "Profile not found" });
      const profile = db.updateProfile(current.id, captureProfileInputSchema.parse(request.body))!;
      db.markProjectPublicationDirty(request.params.id);
      return {
        id: profile.id,
        name: profile.name,
        browser: profile.browser,
        settings: JSON.parse(profile.settings_json),
      };
    },
  );
  app.delete<{ Params: { id: string; profileId: string } }>(
    "/api/v1/projects/:id/profiles/:profileId",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const current = db.getProfile(request.params.profileId);
      if (!current || current.project_id !== request.params.id)
        return reply.code(404).send({ error: "Profile not found" });
      if (db.listProfiles(request.params.id).length === 1)
        return reply.code(409).send({ error: "A project must retain at least one profile" });
      db.deleteProfile(current.id);
      db.markProjectPublicationDirty(request.params.id);
      await drainDeletions();
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/runs", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "capture:trigger", request.params.id)) return;
    if (!db.getProject(request.params.id))
      return reply.code(404).send({ error: "Project not found" });
    const body = runTriggerSchema.parse(request.body ?? {});
    const key =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : undefined;
    const runId = db.enqueueRun(
      request.params.id,
      authenticate(db, request)?.kind === "token" ? "api" : "manual",
      body.profileIds,
      key,
    );
    return reply.code(202).send({ runId });
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/v1/projects/:id/captures",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "read", request.params.id)) return;
      if (!db.getProject(request.params.id))
        return reply.code(404).send({ error: "Project not found" });
      const query = captureQuerySchema.parse(request.query);
      if (query.profileId) {
        const profile = db.getProfile(query.profileId);
        if (!profile || profile.project_id !== request.params.id)
          return reply.code(404).send({ error: "Profile not found" });
      }
      const counts = db.captureCounts(request.params.id, query.profileId);
      const total = query.status === "all" ? counts.total : counts[query.status];
      reply
        .header("x-total-count", String(total))
        .header("x-successful-count", String(counts.succeeded))
        .header("x-failed-count", String(counts.failed));
      return db
        .listCaptures(request.params.id, query.profileId, query.limit, {
          status: query.status,
          offset: query.offset,
        })
        .map(captureDto);
    },
  );

  async function sendCaptureBlob(
    request: FastifyRequest<{ Params: { id: string; kind: string } }>,
    reply: FastifyReply,
  ) {
    const capture = db.getCapture(request.params.id);
    if (!capture) {
      if (!requireIdentity(db, request, reply, "read")) return;
      return reply.code(404).send({ error: "Capture not found" });
    }
    if (!requireIdentity(db, request, reply, "read", capture.project_id)) return;
    const key = request.params.kind === "thumbnail" ? capture.thumbnail_key : capture.image_key;
    if (!key) return reply.code(404).send({ error: "Artifact not available" });
    reply
      .type(request.params.kind === "thumbnail" ? "image/webp" : "image/png")
      .header("cache-control", "private, max-age=3600");
    return reply.send(await blobs.get(key));
  }
  app.get<{ Params: { id: string } }>("/api/v1/captures/:id/image", async (request, reply) =>
    sendCaptureBlob(
      Object.assign(request, { params: { ...request.params, kind: "image" } }),
      reply,
    ),
  );
  app.get<{ Params: { id: string } }>("/api/v1/captures/:id/thumbnail", async (request, reply) =>
    sendCaptureBlob(
      Object.assign(request, { params: { ...request.params, kind: "thumbnail" } }),
      reply,
    ),
  );

  app.post(
    "/api/v1/comparisons",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "read")) return;
      const { firstId, secondId } = comparisonInputSchema.parse(request.body);
      const pair = comparisonRows(db, firstId, secondId);
      if (!pair)
        return reply
          .code(400)
          .send({ error: "Two distinct successful captures from one profile are required" });
      const [first, second] = pair;
      if (!requireIdentity(db, request, reply, "read", first.project_id)) return;
      const result = await comparisons.run(`${first.id}:${second.id}`, async () => [
        await blobs.get(first.image_key!),
        await blobs.get(second.image_key!),
      ]);
      return {
        first: captureDto(first),
        second: captureDto(second),
        changePercent: result.changePercent,
        exactMatch: first.sha256 === second.sha256,
        width: result.width,
        height: result.height,
        diffDataUrl: `data:image/png;base64,${result.diff.toString("base64")}`,
      };
    },
  );

  app.get("/api/v1/tokens", async (request, reply) =>
    requireInstanceIdentity(db, request, reply, "manage")
      ? db.listApiTokens().map((token) => ({
          ...token,
          scopes: JSON.parse(token.scopes_json),
          projectIds: token.project_ids_json ? JSON.parse(token.project_ids_json) : null,
        }))
      : undefined,
  );
  app.get("/api/v1/storage", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    const usage = blobs.usage ? await blobs.usage() : { bytes: null, files: null };
    const databaseBytes = await import("node:fs/promises").then(({ stat }) =>
      stat(`${config.dataDir}/sad.sqlite`)
        .then((value) => value.size)
        .catch(() => 0),
    );
    return { ...usage, databaseBytes };
  });
  app.post("/api/v1/tokens", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    const input = z
      .object({
        name: z.string().min(1).max(80),
        scopes: z.array(z.enum(["read", "capture:trigger", "manage"])).min(1),
        projectIds: z.array(z.string()).nullable().default(null),
      })
      .parse(request.body);
    const token = randomToken(32);
    const id = db.createApiToken(input.name, hashToken(token), input.scopes, input.projectIds);
    return reply.code(201).send({ id, token });
  });
  app.delete<{ Params: { id: string } }>("/api/v1/tokens/:id", async (request, reply) => {
    if (!requireInstanceIdentity(db, request, reply, "manage")) return;
    return db.deleteApiToken(request.params.id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "API token not found" });
  });

  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/webhooks", async (request, reply) =>
    requireIdentity(db, request, reply, "manage", request.params.id)
      ? db.listWebhooks(request.params.id).map(webhookDto)
      : undefined,
  );
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/webhooks", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
    const input = z
      .object({
        url: z.url(),
        threshold: z.number().min(0).max(100).default(0),
        events: z.array(z.enum(["capture.changed", "capture.failed"])).min(1),
        secret: z.string().min(16).optional(),
      })
      .parse(request.body);
    await assertSafeUrl(input.url, config.privateTargetAllowlist);
    const secret = input.secret ?? randomToken(32);
    const hook = db.createWebhook(
      request.params.id,
      input.url,
      encryptJson({ secret }, config.encryptionKey),
      input.threshold,
      input.events,
    );
    return reply.code(201).send({
      ...webhookDto(hook),
      secret,
    });
  });
  app.patch<{ Params: { id: string; webhookId: string } }>(
    "/api/v1/projects/:id/webhooks/:webhookId",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const hook = db.getWebhook(request.params.webhookId);
      if (!hook || hook.project_id !== request.params.id)
        return reply.code(404).send({ error: "Webhook not found" });
      const input = z
        .object({
          url: z.url().optional(),
          threshold: z.number().min(0).max(100).optional(),
          events: z
            .array(z.enum(["capture.changed", "capture.failed"]))
            .min(1)
            .optional(),
          enabled: z.boolean().optional(),
        })
        .refine((value) => Object.keys(value).length > 0, "At least one change is required")
        .parse(request.body);
      if (input.url) await assertSafeUrl(input.url, config.privateTargetAllowlist);
      const updated = db.updateWebhook(hook.id, {
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
        ...(input.events === undefined ? {} : { events_json: JSON.stringify(input.events) }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled ? 1 : 0 }),
      });
      return webhookDto(updated!);
    },
  );
  app.delete<{ Params: { id: string; webhookId: string } }>(
    "/api/v1/projects/:id/webhooks/:webhookId",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const hook = db.getWebhook(request.params.webhookId);
      if (!hook || hook.project_id !== request.params.id)
        return reply.code(404).send({ error: "Webhook not found" });
      db.deleteWebhook(hook.id);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string; webhookId: string } }>(
    "/api/v1/projects/:id/webhooks/:webhookId/rotate-secret",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const hook = db.getWebhook(request.params.webhookId);
      if (!hook || hook.project_id !== request.params.id)
        return reply.code(404).send({ error: "Webhook not found" });
      const secret = randomToken(32);
      db.rotateWebhookSecret(hook.id, encryptJson({ secret }, config.encryptionKey));
      return { id: hook.id, secret };
    },
  );
  app.post<{ Params: { id: string; webhookId: string } }>(
    "/api/v1/projects/:id/webhooks/:webhookId/test",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const hook = db.getWebhook(request.params.webhookId);
      if (!hook || hook.project_id !== request.params.id)
        return reply.code(404).send({ error: "Webhook not found" });
      if (!hook.enabled)
        return reply.code(409).send({ error: "Enable the webhook before testing" });
      const deliveryId = db.enqueueWebhookTest(hook.id, {
        schemaVersion: WEBHOOK_SCHEMA_VERSION,
        productVersion: PRODUCT_VERSION,
        event: "webhook.test",
        projectId: request.params.id,
        webhookId: hook.id,
        createdAt: new Date().toISOString(),
      });
      return reply.code(202).send({ deliveryId });
    },
  );
  app.get<{
    Params: { id: string; webhookId: string };
    Querystring: Record<string, unknown>;
  }>("/api/v1/projects/:id/webhooks/:webhookId/deliveries", async (request, reply) => {
    if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
    const hook = db.getWebhook(request.params.webhookId);
    if (!hook || hook.project_id !== request.params.id)
      return reply.code(404).send({ error: "Webhook not found" });
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(request.query);
    return db.listWebhookDeliveries(hook.id, limit).map(webhookDeliveryDto);
  });

  app.post<{ Params: { id: string; profileId: string } }>(
    "/api/v1/projects/:id/profiles/:profileId/exports",
    async (request, reply) => {
      if (!requireIdentity(db, request, reply, "manage", request.params.id)) return;
      const input = z
        .object({
          format: z.enum(["gif", "webm"]),
          frameDurationMs: z.number().int().min(100).max(10_000).default(750),
          canvasWidth: z.number().int().min(320).max(3840).default(1280),
          canvasHeight: z.number().int().min(240).max(2160).default(720),
          timestampOverlay: z.boolean().default(true),
          background: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .default("#111827"),
          frameLimit: z.number().int().min(2).max(500).default(90),
          captureIds: z.array(z.string()).min(2).max(500).optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        })
        .parse(request.body);
      if (input.from && input.to && input.from > input.to)
        return reply.code(400).send({ error: "Export range start must precede its end" });
      const requestedIds = input.captureIds ? new Set(input.captureIds) : null;
      const captures = db
        .listCaptures(
          request.params.id,
          request.params.profileId,
          requestedIds || input.from || input.to ? 500 : input.frameLimit,
        )
        .filter(
          (capture) =>
            capture.status === "succeeded" &&
            capture.image_key &&
            (!requestedIds || requestedIds.has(capture.id)) &&
            (!input.from || capture.captured_at >= input.from) &&
            (!input.to || capture.captured_at <= input.to),
        )
        .reverse();
      if (requestedIds && captures.length !== requestedIds.size)
        return reply.code(400).send({ error: "Every selected capture must belong to the profile" });
      if (captures.length < 2)
        return reply.code(400).send({ error: "At least two successful captures are required" });
      const jobId = db.enqueueExport(request.params.id, request.params.profileId, input.format, {
        ...input,
        captureIds: captures.map((capture) => capture.id),
      });
      return reply.code(202).send({ jobId });
    },
  );

  app.post("/internal/v1/jobs/claim", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const job = db.claimJob();
    if (!job) return reply.code(204).send();
    if (job.type === "capture") {
      const project = db.getProject(job.project_id)!;
      const profile = db.getProfile(job.profile_id!)!;
      const secrets = decryptJson<{
        headers: Record<string, string>;
        cookies: Array<Record<string, unknown>>;
      }>(project.secrets_encrypted, config.encryptionKey);
      const response: WorkerJob = {
        id: job.id,
        leaseToken: job.lease_token!,
        attempt: job.attempts,
        type: "capture",
        projectId: job.project_id,
        runId: job.run_id,
        profile: { id: profile.id, ...JSON.parse(profile.settings_json) },
        url: project.url,
        headers: secrets.headers,
        cookies: secrets.cookies as never,
        privateTargetAllowlist: config.privateTargetAllowlist,
      };
      return response;
    }
    const payload = JSON.parse(job.payload_json) as {
      format: "gif" | "webm";
      captureIds: string[];
      frameDurationMs: number;
      canvasWidth: number;
      canvasHeight: number;
      timestampOverlay: boolean;
      background: string;
    };
    const response: WorkerJob = {
      id: job.id,
      leaseToken: job.lease_token!,
      attempt: job.attempts,
      type: "export",
      projectId: job.project_id,
      profileId: job.profile_id!,
      format: payload.format,
      frames: payload.captureIds.map((id) => {
        const capture = db.getCapture(id)!;
        return {
          url: `${request.protocol}://${request.host}/internal/v1/captures/${id}/image`,
          capturedAt: capture.captured_at,
        };
      }),
      frameDurationMs: payload.frameDurationMs,
      canvasWidth: payload.canvasWidth,
      canvasHeight: payload.canvasHeight,
      timestampOverlay: payload.timestampOverlay,
      background: payload.background,
    };
    return response;
  });

  app.get<{ Params: { id: string } }>("/internal/v1/captures/:id/image", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const capture = db.getCapture(request.params.id);
    if (!capture?.image_key) return reply.code(404).send({ error: "Capture not found" });
    return reply.type("image/png").send(await blobs.get(capture.image_key));
  });

  app.post<{ Params: { id: string } }>("/internal/v1/jobs/:id/renew", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const { leaseToken } = z.object({ leaseToken: z.string() }).parse(request.body);
    const leaseExpiresAt = db.renewLease(request.params.id, leaseToken);
    if (!leaseExpiresAt) return reply.code(409).send({ error: "Invalid or expired job lease" });
    return { leaseExpiresAt };
  });

  app.post<{ Params: { id: string } }>("/internal/v1/jobs/:id/artifact", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const lease = request.headers["x-sad-lease"];
    const encoded = request.headers["x-sad-metadata"];
    if (typeof lease !== "string" || typeof encoded !== "string")
      return reply.code(400).send({ error: "Lease and metadata headers are required" });
    const job = db.validateLease(request.params.id, lease);
    const metadata = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const bytes = request.body as Buffer;
    if (job.type === "export") {
      const format = (JSON.parse(job.payload_json) as { format: "gif" | "webm" }).format;
      const key = `exports/${job.project_id}/${job.profile_id}/${job.id}.${format}`;
      await blobs.put(key, bytes);
      const { exported, published } = db.saveExport(job, key, Number(metadata.frameCount ?? 0));
      if (!published) {
        db.queueBlobDeletion(key);
      } else db.markProjectPublicationDirty(job.project_id);
      await drainDeletions();
      return reply.code(201).send({ id: exported.id, published });
    }
    const capturedAt = String(metadata.capturedAt ?? new Date().toISOString());
    const imageKey = `captures/${job.project_id}/${job.profile_id}/${job.id}.png`;
    const thumbnailKey = `thumbnails/${job.project_id}/${job.profile_id}/${job.id}.webp`;
    const digest = createHash("sha256").update(bytes).digest("hex");
    await Promise.all([
      blobs.put(imageKey, bytes),
      blobs.put(thumbnailKey, await thumbnail(bytes)),
    ]);
    let changePercent: number | null = null;
    let diffKey: string | null = null;
    const previous = db.latestSuccessfulCapture(job.profile_id!, capturedAt);
    if (previous?.image_key) {
      const comparison = await compareImages(await blobs.get(previous.image_key), bytes);
      changePercent = comparison.changePercent;
      diffKey = `diffs/${job.project_id}/${job.profile_id}/${job.id}.png`;
      await blobs.put(diffKey, comparison.diff);
    }
    const capture = db.recordCapture(job, {
      status: "succeeded",
      captured_at: capturedAt,
      final_url: String(metadata.finalUrl ?? ""),
      http_status: metadata.httpStatus == null ? null : Number(metadata.httpStatus),
      width: Number(metadata.width),
      height: Number(metadata.height),
      sha256: digest,
      change_percent: changePercent,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      diff_key: diffKey,
      error: null,
      duration_ms: Number(metadata.durationMs ?? 0),
    });
    const payload = {
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      productVersion: PRODUCT_VERSION,
      event: "capture.changed",
      projectId: job.project_id,
      profileId: job.profile_id,
      runId: job.run_id,
      captureId: capture.id,
      previousCaptureId: previous?.id ?? null,
      changePercent,
      capturedAt,
      publicUrl: config.publicUrl,
    };
    db.enqueueWebhookDeliveries(job.project_id, "capture.changed", payload, changePercent);
    await enforceRetention(db, blobs, job.project_id, job.profile_id!);
    db.markProjectPublicationDirty(job.project_id);
    const project = db.getProject(job.project_id);
    if (project && project.publish_mode !== "private") {
      const frames = db
        .listCaptures(job.project_id, job.profile_id!, 90)
        .filter((item) => item.status === "succeeded" && item.image_key)
        .reverse();
      if (frames.length >= 2)
        for (const format of ["gif", "webm"] as const)
          db.enqueueExport(job.project_id, job.profile_id!, format, {
            format,
            captureIds: frames.map((item) => item.id),
            frameDurationMs: 750,
            canvasWidth: 1280,
            canvasHeight: 720,
            timestampOverlay: true,
            background: "#111827",
            frameLimit: 90,
          });
    }
    return reply.code(201).send(captureDto(capture));
  });

  app.post<{ Params: { id: string } }>("/internal/v1/jobs/:id/failure", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const body = z
      .object({
        leaseToken: z.string(),
        capturedAt: z.string(),
        error: z.string().max(4000),
        finalUrl: z.string().nullable().default(null),
        durationMs: z.number().int().nonnegative().default(0),
        screenshotBase64: z.string().max(25_000_000).nullable().default(null),
        width: z.number().int().positive().nullable().default(null),
        height: z.number().int().positive().nullable().default(null),
      })
      .parse(request.body);
    const job = db.validateLease(request.params.id, body.leaseToken);
    if (job.type !== "capture")
      return reply.code(400).send({ error: "Only capture jobs may report this failure" });
    if (job.attempts < job.max_attempts) {
      db.retryJob(job, body.error);
      return reply.code(202).send({ retrying: true });
    }
    let imageKey: string | null = null;
    let thumbnailKey: string | null = null;
    if (body.screenshotBase64) {
      const bytes = Buffer.from(body.screenshotBase64, "base64");
      imageKey = `failures/${job.project_id}/${job.profile_id}/${job.id}.png`;
      thumbnailKey = `failure-thumbnails/${job.project_id}/${job.profile_id}/${job.id}.webp`;
      await Promise.all([
        blobs.put(imageKey, bytes),
        blobs.put(thumbnailKey, await thumbnail(bytes)),
      ]);
    }
    const capture = db.recordCapture(job, {
      status: "failed",
      captured_at: body.capturedAt,
      final_url: body.finalUrl,
      http_status: null,
      width: body.width,
      height: body.height,
      sha256: null,
      change_percent: null,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      diff_key: null,
      error: body.error,
      duration_ms: body.durationMs,
    });
    db.enqueueWebhookDeliveries(
      job.project_id,
      "capture.failed",
      {
        schemaVersion: WEBHOOK_SCHEMA_VERSION,
        productVersion: PRODUCT_VERSION,
        event: "capture.failed",
        projectId: job.project_id,
        profileId: job.profile_id,
        runId: job.run_id,
        captureId: capture.id,
        error: body.error,
        capturedAt: body.capturedAt,
      },
      null,
    );
    await enforceRetention(db, blobs, job.project_id, job.profile_id!);
    return reply.code(201).send(captureDto(capture));
  });

  app.post<{ Params: { id: string } }>("/internal/v1/jobs/:id/error", async (request, reply) => {
    if (!workerAuthorized(request, config))
      return reply.code(401).send({ error: "Worker authentication required" });
    const body = z
      .object({ leaseToken: z.string(), error: z.string().max(4000) })
      .parse(request.body);
    const job = db.validateLease(request.params.id, body.leaseToken);
    const retrying = db.retryJob(job, body.error);
    return reply.code(retrying ? 202 : 201).send({ retrying });
  });

  async function publicGallery(
    kind: "slug" | "token",
    value: string,
    queryInput: Record<string, unknown>,
    reply: FastifyReply,
  ) {
    const project = db.getPublishedProject(kind, value);
    if (!project) return reply.code(404).send({ error: "Gallery not found" });
    if (kind === "token") reply.header("x-robots-tag", "noindex, nofollow");
    const query = z
      .object({
        profileId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(queryInput);
    const profiles = db.listProfiles(project.id);
    const profile = query.profileId
      ? profiles.find((candidate) => candidate.id === query.profileId)
      : (profiles.find((candidate) => candidate.enabled) ?? profiles[0]);
    if (!profile) return reply.code(404).send({ error: "Capture profile not found" });
    const counts = db.captureCounts(project.id, profile.id);
    const pageSize = 12;
    const pageCount = Math.max(1, Math.ceil(counts.succeeded / pageSize));
    const page = Math.min(query.page, pageCount);
    return {
      project: publicProject(project, db),
      profileId: profile.id,
      page,
      pageSize,
      pageCount,
      successfulCount: counts.succeeded,
      failedCount: counts.failed,
      captures: db
        .listCaptures(project.id, profile.id, pageSize, {
          status: "succeeded",
          offset: (page - 1) * pageSize,
        })
        .map((capture) => ({
          ...captureDto(capture),
          imageUrl: `/${kind === "slug" ? "p" : "s"}/${value}/captures/${capture.id}/image`,
          thumbnailUrl: `/${kind === "slug" ? "p" : "s"}/${value}/captures/${capture.id}/thumbnail`,
        })),
    };
  }
  app.get<{ Params: { slug: string }; Querystring: Record<string, unknown> }>(
    "/api/public/p/:slug",
    async (request, reply) => publicGallery("slug", request.params.slug, request.query, reply),
  );
  app.get<{ Params: { token: string }; Querystring: Record<string, unknown> }>(
    "/api/public/s/:token",
    async (request, reply) => publicGallery("token", request.params.token, request.query, reply),
  );
  app.post<{ Params: { kind: "p" | "s"; value: string } }>(
    "/api/public/:kind/:value/comparisons",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.params.kind !== "p" && request.params.kind !== "s")
        return reply.code(404).send({ error: "Gallery not found" });
      const kind = request.params.kind === "p" ? "slug" : "token";
      const project = db.getPublishedProject(kind, request.params.value);
      if (!project) return reply.code(404).send({ error: "Gallery not found" });
      if (kind === "token") reply.header("x-robots-tag", "noindex, nofollow");
      const { firstId, secondId } = comparisonInputSchema.parse(request.body);
      const pair = comparisonRows(db, firstId, secondId, project.id);
      if (!pair)
        return reply
          .code(400)
          .send({ error: "Two distinct successful captures from one profile are required" });
      const [first, second] = pair;
      const comparison = await comparisons.run(`${first.id}:${second.id}`, async () => [
        await blobs.get(first.image_key!),
        await blobs.get(second.image_key!),
      ]);
      const prefix = `/${request.params.kind}/${request.params.value}/captures`;
      const publicDto = (capture: CaptureRow) => ({
        ...captureDto(capture),
        imageUrl: `${prefix}/${capture.id}/image`,
        thumbnailUrl: `${prefix}/${capture.id}/thumbnail`,
      });
      return {
        first: publicDto(first),
        second: publicDto(second),
        changePercent: comparison.changePercent,
        exactMatch: first.sha256 === second.sha256,
        diffDataUrl: `data:image/png;base64,${comparison.diff.toString("base64")}`,
      };
    },
  );

  async function publicCapture(
    kind: "slug" | "token",
    value: string,
    captureId: string,
    artifact: "image" | "thumbnail",
    reply: FastifyReply,
  ) {
    const project = db.getPublishedProject(kind, value);
    const capture = db.getCapture(captureId);
    if (!project || !capture || capture.project_id !== project.id)
      return reply.code(404).send({ error: "Capture not found" });
    const key = artifact === "image" ? capture.image_key : capture.thumbnail_key;
    if (!key) return reply.code(404).send({ error: "Artifact not found" });
    if (kind === "token") reply.header("x-robots-tag", "noindex, nofollow");
    return reply
      .type(artifact === "image" ? "image/png" : "image/webp")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(await blobs.get(key));
  }
  app.get<{ Params: { slug: string; id: string; artifact: "image" | "thumbnail" } }>(
    "/p/:slug/captures/:id/:artifact",
    async (request, reply) =>
      publicCapture("slug", request.params.slug, request.params.id, request.params.artifact, reply),
  );
  app.get<{ Params: { token: string; id: string; artifact: "image" | "thumbnail" } }>(
    "/s/:token/captures/:id/:artifact",
    async (request, reply) =>
      publicCapture(
        "token",
        request.params.token,
        request.params.id,
        request.params.artifact,
        reply,
      ),
  );

  async function publicExport(
    kind: "slug" | "token",
    value: string,
    profileId: string,
    format: "gif" | "webm",
    reply: FastifyReply,
  ) {
    const project = db.getPublishedProject(kind, value);
    const profile = db.getProfile(profileId);
    const exported = db.getExport(profileId, format);
    if (!project || !profile || profile.project_id !== project.id || !exported?.blob_key)
      return reply.code(404).send({ error: "Export not found" });
    if (kind === "token") reply.header("x-robots-tag", "noindex, nofollow");
    return reply
      .type(format === "gif" ? "image/gif" : "video/webm")
      .header("cache-control", "public, max-age=300")
      .send(await blobs.get(exported.blob_key));
  }
  app.get<{ Params: { slug: string; profileId: string; format: "gif" | "webm" } }>(
    "/p/:slug/:profileId/latest.:format",
    async (request, reply) =>
      publicExport(
        "slug",
        request.params.slug,
        request.params.profileId,
        request.params.format,
        reply,
      ),
  );
  app.get<{ Params: { token: string; profileId: string; format: "gif" | "webm" } }>(
    "/s/:token/:profileId/latest.:format",
    async (request, reply) =>
      publicExport(
        "token",
        request.params.token,
        request.params.profileId,
        request.params.format,
        reply,
      ),
  );

  const stopScheduler = startScheduler(db, app.log);
  const stopWebhooks = startWebhookDispatcher(db, config, app.log);
  const stopPublications = publications.start();
  app.addHook("onClose", async () => {
    stopScheduler();
    stopWebhooks();
    stopPublications();
    clearInterval(deletionTimer);
    await deletionDrain;
    db.close();
  });

  const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
  try {
    await access(webRoot);
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        !request.url.startsWith("/internal/")
      ) {
        const publicRoute = new URL(request.url, config.publicUrl).pathname.match(
          /^\/(p|s)\/([^/]+)\/?$/,
        );
        if (publicRoute) {
          const kind = publicRoute[1] === "p" ? "slug" : "token";
          const value = publicRoute[2]!;
          if (!db.getPublishedProject(kind, value))
            return reply.code(404).send({ error: "Gallery not found" });
        }
        if (request.url.startsWith("/s/")) reply.header("x-robots-tag", "noindex, nofollow");
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  } catch {
    app.log.debug("Web build not found; API-only development mode enabled");
  }

  return app;
}

async function enforceRetention(
  db: AppDatabase,
  blobs: BlobStore,
  projectId: string,
  profileId: string,
): Promise<void> {
  const victims = db.retentionVictims(projectId, profileId);
  for (const capture of victims) {
    await Promise.all(
      [capture.image_key, capture.thumbnail_key, capture.diff_key]
        .filter((key): key is string => Boolean(key))
        .map((key) => blobs.delete(key)),
    );
    db.deleteCapture(capture.id);
  }
  if (victims.length) db.markProjectPublicationDirty(projectId);
}
