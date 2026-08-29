import {
  captureProfileInputSchema,
  loginInputSchema,
  projectInputSchema,
  publicationTargetInputSchema,
  publicationTargetUpdateSchema,
  runTriggerSchema,
  setupInputSchema,
} from "@sad/contracts";
import type { FastifySchema, RouteOptions } from "fastify";
import { z } from "zod";

const emptyObject = { type: "object", additionalProperties: false, example: {} } as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    issues: { type: "array", items: anyObject },
  },
  example: { error: "Validation failed" },
} as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const openApiSchemas = {
  Error: errorResponse,
  Capture: {
    type: "object",
    required: ["id", "projectId", "profileId", "runId", "status", "capturedAt"],
    properties: {
      id: { type: "string" },
      projectId: { type: "string" },
      profileId: { type: "string" },
      runId: { type: "string" },
      status: { type: "string", enum: ["succeeded", "failed"] },
      capturedAt: { type: "string", format: "date-time" },
      finalUrl: nullableString,
      httpStatus: { anyOf: [{ type: "integer" }, { type: "null" }] },
      width: { anyOf: [{ type: "integer" }, { type: "null" }] },
      height: { anyOf: [{ type: "integer" }, { type: "null" }] },
      sha256: nullableString,
      changePercent: { anyOf: [{ type: "number" }, { type: "null" }] },
      imageUrl: nullableString,
      thumbnailUrl: nullableString,
      error: nullableString,
    },
  },
  Project: {
    type: "object",
    required: ["id", "name", "slug", "publishMode", "profiles"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      slug: { type: "string" },
      publishMode: { type: "string", enum: ["private", "unlisted", "indexable"] },
      profiles: { type: "array", items: anyObject },
    },
    additionalProperties: true,
  },
  Webhook: {
    type: "object",
    required: ["id", "url", "threshold", "events", "enabled", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      url: { type: "string", format: "uri" },
      threshold: { type: "number", minimum: 0, maximum: 100 },
      events: {
        type: "array",
        items: { type: "string", enum: ["capture.changed", "capture.failed"] },
      },
      enabled: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  WebhookDelivery: {
    type: "object",
    required: ["id", "event", "status", "attempts", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      event: { type: "string" },
      status: { type: "string", enum: ["queued", "sending", "succeeded", "failed"] },
      attempts: { type: "integer" },
      responseStatus: { anyOf: [{ type: "integer" }, { type: "null" }] },
      error: nullableString,
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  Comparison: {
    type: "object",
    required: ["first", "second", "changePercent", "exactMatch", "diffDataUrl"],
    properties: {
      first: { $ref: "#/components/schemas/Capture" },
      second: { $ref: "#/components/schemas/Capture" },
      changePercent: { type: "number" },
      exactMatch: { type: "boolean" },
      width: { type: "integer" },
      height: { type: "integer" },
      diffDataUrl: { type: "string" },
    },
  },
  Export: {
    type: "object",
    required: [
      "format",
      "status",
      "available",
      "frameCount",
      "requestedFrameCount",
      "updatedAt",
      "error",
      "downloadUrl",
    ],
    properties: {
      format: { type: "string", enum: ["gif", "webm"] },
      status: {
        type: "string",
        enum: ["unavailable", "queued", "processing", "succeeded", "failed"],
      },
      available: { type: "boolean" },
      frameCount: { type: "integer", minimum: 0 },
      requestedFrameCount: { type: "integer", minimum: 0 },
      updatedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
      error: nullableString,
      downloadUrl: nullableString,
    },
  },
  PublicGallery: {
    type: "object",
    required: [
      "project",
      "profileId",
      "page",
      "pageSize",
      "pageCount",
      "successfulCount",
      "failedCount",
      "captures",
      "exports",
    ],
    properties: {
      project: { $ref: "#/components/schemas/Project" },
      profileId: { type: "string" },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", const: 12 },
      pageCount: { type: "integer", minimum: 1 },
      successfulCount: { type: "integer", minimum: 0 },
      failedCount: { type: "integer", minimum: 0 },
      captures: { type: "array", items: { $ref: "#/components/schemas/Capture" } },
      exports: { type: "array", items: { $ref: "#/components/schemas/Export" } },
    },
  },
} as const;
const idParams = (names: string[]) => ({
  type: "object",
  required: names,
  properties: Object.fromEntries(names.map((name) => [name, { type: "string", minLength: 1 }])),
});
const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });

const projectUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.url().max(2048).optional(),
  scheduleExpression: z.string().min(1).max(120).optional(),
  scheduleTimezone: z.string().min(1).max(80).optional(),
  scheduleEnabled: z.boolean().optional(),
  confirmUntestedProfiles: z.boolean().optional(),
  retentionDays: z.number().int().positive().nullable().optional(),
  retentionCount: z.number().int().positive().nullable().optional(),
});
const webhookInputSchema = z.object({
  url: z.url(),
  threshold: z.number().min(0).max(100).default(0),
  events: z.array(z.enum(["capture.changed", "capture.failed"])).min(1),
  secret: z.string().min(16).optional(),
});
const webhookUpdateSchema = webhookInputSchema
  .omit({ secret: true })
  .partial()
  .extend({ enabled: z.boolean().optional() });
const tokenInputSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(["read", "capture:trigger", "manage"])).min(1),
  projectIds: z.array(z.string()).nullable().default(null),
});
const exportInputSchema = z.object({
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
});

const bodies: Record<string, object> = {
  "POST /api/v1/setup": json(setupInputSchema),
  "POST /api/v1/auth/login": json(loginInputSchema),
  "POST /api/v1/auth/logout": emptyObject,
  "POST /api/v1/auth/recover": json(
    z.object({ token: z.string().min(20), password: z.string().min(12).max(256) }),
  ),
  "POST /api/v1/projects": json(projectInputSchema),
  "PATCH /api/v1/projects/:id": json(projectUpdateSchema),
  "PUT /api/v1/projects/:id/credentials": json(
    projectInputSchema.pick({ headers: true, cookies: true }),
  ),
  "PATCH /api/v1/projects/:id/publication": json(
    z.object({
      publishMode: z.enum(["private", "unlisted", "indexable"]),
      rotate: z.boolean().default(false),
    }),
  ),
  "PUT /api/v1/projects/:id/static-publication": json(z.object({ targetId: z.string() })),
  "POST /api/v1/publication-targets": json(publicationTargetInputSchema),
  "PATCH /api/v1/publication-targets/:id": json(publicationTargetUpdateSchema),
  "PUT /api/v1/publication-targets/:id/credentials": anyObject,
  "POST /api/v1/publication-targets/:id/verify": emptyObject,
  "POST /api/v1/publication-targets/:id/publish": emptyObject,
  "POST /api/v1/projects/:id/profiles": json(captureProfileInputSchema),
  "PUT /api/v1/projects/:id/profiles/:profileId": json(captureProfileInputSchema),
  "POST /api/v1/projects/:id/runs": json(runTriggerSchema),
  "POST /api/v1/comparisons": json(
    z.object({ firstId: z.string().min(1), secondId: z.string().min(1) }),
  ),
  "POST /api/v1/tokens": json(tokenInputSchema),
  "POST /api/v1/projects/:id/webhooks": json(webhookInputSchema),
  "PATCH /api/v1/projects/:id/webhooks/:webhookId": json(webhookUpdateSchema),
  "POST /api/v1/projects/:id/webhooks/:webhookId/rotate-secret": emptyObject,
  "POST /api/v1/projects/:id/webhooks/:webhookId/test": emptyObject,
  "POST /api/v1/projects/:id/profiles/:profileId/exports": json(exportInputSchema),
  "POST /api/public/:kind/:value/comparisons": json(
    z.object({ firstId: z.string().min(1), secondId: z.string().min(1) }),
  ),
};

const summaries: Record<string, string> = {
  "/api/v1/projects/:id/captures": "List project captures",
  "/api/v1/comparisons": "Compare two successful captures",
  "/api/public/:kind/:value/comparisons": "Compare two captures in a public gallery",
  "/api/v1/projects/:id/webhooks/:webhookId/test": "Queue a signed webhook test delivery",
};

const successCodes: Record<string, number> = {
  "POST /api/v1/auth/login": 200,
  "POST /api/v1/auth/logout": 204,
  "POST /api/v1/auth/recover": 204,
  "PUT /api/v1/projects/:id/credentials": 204,
  "PATCH /api/v1/projects/:id/publication": 200,
  "PUT /api/v1/projects/:id/static-publication": 201,
  "DELETE /api/v1/projects/:id/static-publication": 202,
  "POST /api/v1/publication-targets/:id/publish": 202,
  "PUT /api/v1/publication-targets/:id/credentials": 204,
  "POST /api/v1/publication-targets/:id/verify": 200,
  "POST /api/v1/projects/:id/runs": 202,
  "POST /api/v1/comparisons": 200,
  "POST /api/v1/projects/:id/webhooks/:webhookId/rotate-secret": 200,
  "POST /api/v1/projects/:id/webhooks/:webhookId/test": 202,
  "POST /api/v1/projects/:id/profiles/:profileId/exports": 202,
  "POST /api/public/:kind/:value/comparisons": 200,
};

function successSchema(url: string, method: string): object {
  if (url.endsWith("/captures") && method === "GET")
    return {
      type: "array",
      items: { $ref: "#/components/schemas/Capture" },
      headers: {
        "X-Total-Count": {
          type: "integer",
          minimum: 0,
          description: "Captures matching the requested status filter",
        },
        "X-Successful-Count": {
          type: "integer",
          minimum: 0,
          description: "All successful captures in the selected project/profile",
        },
        "X-Failed-Count": {
          type: "integer",
          minimum: 0,
          description: "All failed captures in the selected project/profile",
        },
      },
    };
  if (url === "/api/v1/setup/status")
    return {
      type: "object",
      required: ["configured"],
      properties: { configured: { type: "boolean" } },
      example: { configured: true },
    };
  if (["/api/v1/setup", "/api/v1/auth/login"].includes(url))
    return {
      type: "object",
      required: ["email"],
      properties: { email: { type: "string", format: "email" } },
      example: { email: "admin@example.com" },
    };
  if (url === "/api/v1/auth/me")
    return {
      type: "object",
      required: ["authenticated", "kind", "scopes"],
      properties: {
        authenticated: { type: "boolean", const: true },
        kind: { type: "string", enum: ["session", "token"] },
        scopes: { type: "array", items: { type: "string" } },
      },
    };
  if (url === "/api/v1/projects" && method === "GET")
    return { type: "array", items: { $ref: "#/components/schemas/Project" } };
  if (url === "/api/v1/projects" || url === "/api/v1/projects/:id")
    return { $ref: "#/components/schemas/Project" };
  if (url.endsWith("/webhooks") && method === "GET")
    return { type: "array", items: { $ref: "#/components/schemas/Webhook" } };
  if (url.endsWith("/webhooks") || (url.includes("/webhooks/:webhookId") && method === "PATCH"))
    return { $ref: "#/components/schemas/Webhook" };
  if (url.endsWith("/deliveries"))
    return { type: "array", items: { $ref: "#/components/schemas/WebhookDelivery" } };
  if (url.endsWith("/comparisons")) return { $ref: "#/components/schemas/Comparison" };
  if (url.endsWith("/exports") && method === "GET")
    return { type: "array", items: { $ref: "#/components/schemas/Export" } };
  if (url === "/api/public/p/:slug" || url === "/api/public/s/:token")
    return { $ref: "#/components/schemas/PublicGallery" };
  if (
    url === "/api/v1/publication-targets" ||
    url.endsWith("/history") ||
    url.endsWith("/runs") ||
    url === "/api/v1/tokens"
  )
    return { type: "array", items: anyObject };
  return anyObject;
}

function routeMethod(route: RouteOptions): string {
  const method = Array.isArray(route.method) ? route.method[0] : route.method;
  return String(method).toUpperCase();
}

export function openApiTransform({
  schema,
  url,
  route,
}: {
  schema: FastifySchema | undefined;
  url: string;
  route: RouteOptions;
}): { schema: FastifySchema; url: string } {
  const original = schema ?? {};
  const supported =
    url.startsWith("/api/v1/") ||
    url.startsWith("/api/public/") ||
    url === "/version" ||
    url.startsWith("/health/");
  if (!supported) return { schema: { ...original, hide: true }, url };

  const method = routeMethod(route);
  const key = `${method} ${url}`;
  const params = [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
  const isPublic =
    url.startsWith("/api/public/") ||
    url.startsWith("/health/") ||
    url === "/version" ||
    [
      "/api/v1/setup/status",
      "/api/v1/setup",
      "/api/v1/auth/login",
      "/api/v1/auth/recovery",
    ].includes(url);
  const querystring =
    url === "/api/v1/projects/:id/captures"
      ? json(
          z.object({
            profileId: z.string().optional(),
            status: z.enum(["all", "succeeded", "failed"]).default("all"),
            limit: z.coerce.number().int().min(1).max(500).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        )
      : url === "/api/public/p/:slug" || url === "/api/public/s/:token"
        ? json(
            z.object({
              profileId: z.string().optional(),
              page: z.coerce.number().int().min(1).default(1),
            }),
          )
        : url.endsWith("/deliveries")
          ? json(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }))
          : url === "/api/v1/projects/:id/static-publication" && method === "DELETE"
            ? json(z.object({ force: z.enum(["true", "false"]).optional() }))
            : original.querystring;
  const successCode =
    successCodes[key] ?? (method === "DELETE" ? 204 : method === "POST" ? 201 : 200);
  const retryableError = {
    ...errorResponse,
    headers: {
      "Retry-After": {
        type: "integer",
        minimum: 1,
        description: "Seconds before the client should retry",
      },
    },
  };
  const comparisonLimitError = {
    ...errorResponse,
    properties: {
      ...errorResponse.properties,
      pixels: { type: "integer", minimum: 16_000_001 },
    },
  };
  const isComparison = url.endsWith("/comparisons");
  const response =
    url.endsWith("/image") ||
    url.endsWith("/thumbnail") ||
    url.endsWith("/exports/:format") ||
    url.includes("/latest.")
      ? { 200: { type: "string", format: "binary" }, 404: errorResponse }
      : {
          [successCode]: successCode === 204 ? { type: "null" } : successSchema(url, method),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: isComparison ? comparisonLimitError : errorResponse,
          429: retryableError,
          503: retryableError,
        };
  return {
    url,
    schema: {
      ...original,
      tags: [
        url.startsWith("/api/public/")
          ? "Public galleries"
          : url.startsWith("/health/")
            ? "Health"
            : "API v1",
      ],
      summary: summaries[url] ?? `${method} ${url}`,
      security: isPublic ? [] : [{ sessionCookie: [] }, { bearerToken: [] }],
      params: params.length ? idParams(params) : original.params,
      querystring,
      body:
        bodies[key] ?? (["POST", "PUT", "PATCH"].includes(method) ? emptyObject : original.body),
      response,
    },
  };
}
