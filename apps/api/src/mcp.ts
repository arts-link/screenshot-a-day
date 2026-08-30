import { hostHeaderValidation } from "@modelcontextprotocol/fastify";
import { toNodeHandler, type NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { PRODUCT_VERSION } from "@sad/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticateBearer, parseBearerToken, type ApiScope, type Identity } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";
import { captureDto, projectPublicationDto, publicProject } from "./presenters.js";

interface McpDependencies {
  config: AppConfig;
  db: AppDatabase;
}

interface SadAuthInfo extends AuthInfo {
  extra: {
    identity: Identity;
  };
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const projectSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    url: z.string(),
    publishMode: z.enum(["private", "unlisted", "indexable"]),
    scheduleEnabled: z.boolean(),
    profileCount: z.number().int(),
    latestCaptureAt: z.string().nullable(),
    latestThumbnailUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough();

const projectDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    url: z.string(),
    publishMode: z.enum(["private", "unlisted", "indexable"]),
    profiles: z.array(z.record(z.string(), z.unknown())),
    scheduleExpression: z.string(),
    scheduleTimezone: z.string(),
    scheduleEnabled: z.boolean(),
  })
  .passthrough();

const captureSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  profileId: z.string(),
  runId: z.string(),
  status: z.enum(["succeeded", "failed"]),
  capturedAt: z.string(),
  finalUrl: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sha256: z.string().nullable(),
  changePercent: z.number().nullable(),
  imageUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  error: z.string().nullable(),
});

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function authorized(identity: Identity | null, scope: ApiScope, projectId?: string): boolean {
  return Boolean(
    identity?.kind === "token" &&
    identity.scopes.includes(scope) &&
    (!projectId || !identity.projectIds || identity.projectIds.includes(projectId)),
  );
}

function identityFrom(authInfo: AuthInfo | undefined): Identity | null {
  const identity = authInfo?.extra?.identity;
  return identity && typeof identity === "object" ? (identity as Identity) : null;
}

function createServer(db: AppDatabase, identity: Identity | null, app: FastifyInstance) {
  const server = new McpServer(
    { name: "screenshot-a-day", version: PRODUCT_VERSION },
    {
      instructions:
        "Experimental Screenshot-a-Day tools. Read tools require the read scope; capture triggering requires capture:trigger.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List Screenshot-a-Day projects visible to the authenticated API token.",
      inputSchema: z.object({}),
      outputSchema: z.object({ projects: z.array(projectSummarySchema) }),
      annotations: readAnnotations,
    },
    async () => {
      if (!authorized(identity, "read")) return toolError("The read scope is required.");
      const projects = db
        .listProjects()
        .filter((project) => !identity!.projectIds || identity!.projectIds.includes(project.id));
      const output = { projects };
      return {
        content: [
          {
            type: "text",
            text: projects.length === 1 ? "Found 1 project." : `Found ${projects.length} projects.`,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Get one project's profiles, capture schedule, and publication status.",
      inputSchema: z.object({ projectId: z.string().min(1) }),
      outputSchema: z.object({ project: projectDetailSchema }),
      annotations: readAnnotations,
    },
    async ({ projectId }) => {
      if (!authorized(identity, "read", projectId))
        return toolError("Project not found or not accessible.");
      const project = db.getProject(projectId);
      if (!project) return toolError("Project not found or not accessible.");
      const detail = {
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
      return {
        content: [{ type: "text", text: `Project: ${project.name}` }],
        structuredContent: { project: detail },
      };
    },
  );

  server.registerTool(
    "list_captures",
    {
      title: "List captures",
      description:
        "List newest-first capture metadata for a project. Image URLs use the authenticated REST API.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        profileId: z.string().min(1).optional(),
        status: z.enum(["all", "succeeded", "failed"]).default("all"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
      outputSchema: z.object({
        captures: z.array(captureSchema),
        pagination: z.object({
          limit: z.number().int(),
          offset: z.number().int(),
          total: z.number().int(),
          succeeded: z.number().int(),
          failed: z.number().int(),
        }),
      }),
      annotations: readAnnotations,
    },
    async ({ projectId, profileId, status, limit, offset }) => {
      if (!authorized(identity, "read", projectId))
        return toolError("Project not found or not accessible.");
      if (!db.getProject(projectId)) return toolError("Project not found or not accessible.");
      if (profileId) {
        const profile = db.getProfile(profileId);
        if (!profile || profile.project_id !== projectId)
          return toolError("Capture profile not found.");
      }
      const counts = db.captureCounts(projectId, profileId);
      const captures = db
        .listCaptures(projectId, profileId, limit, { status, offset })
        .map(captureDto);
      const output = {
        captures,
        pagination: {
          limit,
          offset,
          total: status === "all" ? counts.total : counts[status],
          succeeded: counts.succeeded,
          failed: counts.failed,
        },
      };
      return {
        content: [
          {
            type: "text",
            text: `Returned ${captures.length} of ${output.pagination.total} matching captures.`,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "trigger_capture_run",
    {
      title: "Trigger capture run",
      description:
        "Queue a capture run for all enabled profiles or an enabled subset. An idempotency key prevents duplicate runs within a project.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        profileIds: z.array(z.string().min(1)).min(1).optional(),
        idempotencyKey: z.string().min(1).max(200).optional(),
      }),
      outputSchema: z.object({ runId: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectId, profileIds, idempotencyKey }) => {
      if (!authorized(identity, "capture:trigger", projectId))
        return toolError("Project not found or not accessible with capture:trigger.");
      if (!db.getProject(projectId))
        return toolError("Project not found or not accessible with capture:trigger.");
      try {
        const runId = db.enqueueRun(projectId, "api", profileIds, idempotencyKey);
        return {
          content: [{ type: "text", text: `Capture run queued: ${runId}` }],
          structuredContent: { runId },
        };
      } catch (error) {
        if (error instanceof Error && error.message === "No enabled capture profiles selected")
          return toolError(error.message);
        app.log.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "MCP capture trigger failed",
        );
        return toolError("Unable to queue the capture run.");
      }
    },
  );

  return server;
}

export function registerMcpEndpoint(app: FastifyInstance, dependencies: McpDependencies) {
  const { config, db } = dependencies;
  const publicUrl = new URL(config.publicUrl);
  const validateHost = hostHeaderValidation([publicUrl.hostname]);
  const handler = createMcpHandler(
    ({ authInfo }) => createServer(db, identityFrom(authInfo), app),
    {
      onerror(error) {
        app.log.error({ error: error.message }, "MCP request failed");
      },
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror(error) {
      app.log.error({ error: error.message }, "MCP transport failed");
    },
  });

  async function validateOrigin(request: FastifyRequest, reply: FastifyReply) {
    const origin = request.headers.origin;
    if (!origin) return;
    try {
      if (new URL(origin).origin === publicUrl.origin) return;
    } catch {
      // Malformed origins are rejected below.
    }
    await reply.code(403).send({ error: "Origin is not allowed" });
  }

  app.all("/mcp", { onRequest: [validateHost, validateOrigin] }, async (request, reply) => {
    const bearer = parseBearerToken(request.headers.authorization);
    const identity = bearer ? authenticateBearer(db, bearer) : null;
    if (!bearer || !identity?.tokenId) {
      return reply
        .header("www-authenticate", "Bearer")
        .code(401)
        .send({ error: "A valid API bearer token is required" });
    }
    const auth: SadAuthInfo = {
      token: bearer,
      clientId: identity.tokenId,
      scopes: identity.scopes,
      extra: { identity },
    };
    Object.assign(request.raw, { auth });
    return nodeHandler(request.raw as unknown as NodeIncomingMessageLike, reply.raw, request.body);
  });

  return () => handler.close();
}
