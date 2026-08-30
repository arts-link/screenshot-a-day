import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToken } from "@sad/core";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { AppDatabase } from "../src/database.js";
import { LocalBlobStore } from "../src/storage.js";

interface JsonRpcResponse {
  id?: number;
  result?: {
    tools?: Array<{ name: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  error?: { code: number; message: string };
}

describe("experimental MCP endpoint", () => {
  let directory: string;
  let db: AppDatabase;
  let blobs: LocalBlobStore;
  let app: FastifyInstance;
  const sessionToken = "administrator-session-token";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sad-mcp-test-"));
    db = new AppDatabase(join(directory, "test.sqlite"));
    const user = db.createUser("admin@example.com", "unused-in-this-test");
    db.createSession(user.id, hashToken(sessionToken), new Date(Date.now() + 60_000));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      dataDir: directory,
      publicUrl: "http://localhost:4400",
      encryptionKey: randomBytes(32).toString("base64"),
      sessionSecret: "s".repeat(32),
      workerToken: "w".repeat(32),
      privateTargetAllowlist: ["localhost"],
      trustProxy: false,
      buildCommit: "test-commit",
      publicationDeployTimeoutMs: 30_000,
      logLevel: "silent",
    };
    blobs = new LocalBlobStore(join(directory, "blobs"));
    app = await buildApp({ config, db, blobs });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  function createToken(
    value: string,
    scopes: Array<"read" | "capture:trigger" | "manage">,
    projectIds: string[] | null = null,
  ) {
    return db.createApiToken("MCP test", hashToken(value), scopes, projectIds);
  }

  async function createProject(slug: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {
        name: `Fixture ${slug}`,
        slug,
        url: "http://localhost:9999",
        headers: {},
        cookies: [],
        profiles: [
          {
            name: "Desktop",
            browser: "chromium",
            enabled: true,
            viewportWidth: 1440,
            viewportHeight: 900,
            deviceScaleFactor: 1,
            extent: "viewport",
            colorScheme: "light",
            locale: "en-US",
            timezone: "UTC",
            reducedMotion: "reduce",
            delayMs: 1000,
            timeoutMs: 30000,
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string; profiles: Array<{ id: string }> }>();
  }

  async function seedCapture(projectId: string, profileId: string, status: "succeeded" | "failed") {
    db.enqueueRun(projectId, "manual", [profileId]);
    const job = db.claimJob()!;
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#335577" },
    })
      .png()
      .toBuffer();
    const imageKey = `test/${job.id}.png`;
    const thumbnailKey = `test/${job.id}.webp`;
    await Promise.all([blobs.put(imageKey, bytes), blobs.put(thumbnailKey, bytes)]);
    return db.recordCapture(job, {
      status,
      captured_at: new Date().toISOString(),
      final_url: "http://localhost:9999",
      http_status: status === "succeeded" ? 200 : null,
      width: 20,
      height: 20,
      sha256: status === "succeeded" ? `${job.id}-digest` : null,
      change_percent: status === "succeeded" ? 0 : null,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      diff_key: null,
      error: status === "failed" ? "fixture failure" : null,
      duration_ms: 1,
    });
  }

  function parseMcpResponse(body: string): JsonRpcResponse {
    if (!body.startsWith("event:")) return JSON.parse(body) as JsonRpcResponse;
    const events = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as JsonRpcResponse);
    return events.at(-1)!;
  }

  async function mcpRequest(token: string, method: string, params?: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
    });
    return { response, rpc: parseMcpResponse(response.body) };
  }

  async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
    return mcpRequest(token, "tools/call", { name, arguments: args });
  }

  it("requires bearer tokens and validates the public host and origin", async () => {
    const cookieOnly = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        cookie: `sad_session=${sessionToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(cookieOnly.statusCode).toBe(401);
    expect(cookieOnly.headers["www-authenticate"]).toBe("Bearer");

    const token = "mcp-auth-token";
    const tokenId = createToken(token, ["read"]);
    const badHost = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: "evil.example",
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(badHost.statusCode).toBe(403);

    const badOrigin = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        origin: "https://evil.example",
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(badOrigin.statusCode).toBe(403);

    db.deleteApiToken(tokenId);
    expect((await mcpRequest(token, "tools/list")).response.statusCode).toBe(401);
  });

  it("advertises exactly the four experimental tools", async () => {
    const token = "mcp-list-token";
    createToken(token, ["read"]);
    const { response, rpc } = await mcpRequest(token, "tools/list");
    expect(response.statusCode, response.body).toBe(200);
    expect(rpc.result?.tools?.map((tool) => tool.name)).toEqual([
      "list_projects",
      "get_project",
      "list_captures",
      "trigger_capture_run",
    ]);
  });

  it("enforces read scope and project boundaries across project and capture tools", async () => {
    const first = await createProject("mcp-first");
    const second = await createProject("mcp-second");
    await seedCapture(first.id, first.profiles[0]!.id, "succeeded");
    await seedCapture(first.id, first.profiles[0]!.id, "failed");
    const token = "mcp-scoped-read-token";
    createToken(token, ["read"], [first.id]);

    const listed = await callTool(token, "list_projects");
    expect(listed.rpc.result?.isError).not.toBe(true);
    expect(listed.rpc.result?.structuredContent).toMatchObject({
      projects: [{ id: first.id }],
    });

    const denied = await callTool(token, "get_project", { projectId: second.id });
    expect(denied.rpc.result?.isError).toBe(true);

    const captures = await callTool(token, "list_captures", {
      projectId: first.id,
      profileId: first.profiles[0]!.id,
      status: "succeeded",
      limit: 1,
      offset: 0,
    });
    expect(captures.rpc.result?.structuredContent).toMatchObject({
      captures: [{ projectId: first.id, status: "succeeded" }],
      pagination: { limit: 1, offset: 0, total: 1, succeeded: 1, failed: 1 },
    });
  });

  it("requires capture scope and honors trigger idempotency", async () => {
    const project = await createProject("mcp-trigger");
    const readToken = "mcp-read-only-token";
    createToken(readToken, ["read"], [project.id]);
    expect(
      (await callTool(readToken, "trigger_capture_run", { projectId: project.id })).rpc.result
        ?.isError,
    ).toBe(true);

    const triggerToken = "mcp-trigger-token";
    createToken(triggerToken, ["capture:trigger"], [project.id]);
    expect((await callTool(triggerToken, "list_projects")).rpc.result?.isError).toBe(true);
    const first = await callTool(triggerToken, "trigger_capture_run", {
      projectId: project.id,
      idempotencyKey: "agent-request-1",
    });
    const duplicate = await callTool(triggerToken, "trigger_capture_run", {
      projectId: project.id,
      idempotencyKey: "agent-request-1",
    });
    expect(first.rpc.result?.structuredContent).toEqual(duplicate.rpc.result?.structuredContent);
    expect(db.listRuns(project.id)).toHaveLength(1);
  });
});
