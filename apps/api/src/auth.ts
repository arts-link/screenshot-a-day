import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken, randomToken, safeTokenEqual } from "@sad/core";
import type { AppDatabase } from "./database.js";

export const SESSION_COOKIE = "sad_session";
export type ApiScope = "read" | "capture:trigger" | "manage";

export interface Identity {
  kind: "session" | "token";
  tokenId?: string;
  userId?: string;
  scopes: ApiScope[];
  projectIds: string[] | null;
}

export function authenticateBearer(db: AppDatabase, token: string): Identity | null {
  const stored = db.getApiToken(hashToken(token));
  if (!stored) return null;
  return {
    kind: "token",
    tokenId: stored.id,
    scopes: JSON.parse(stored.scopes_json) as ApiScope[],
    projectIds: stored.project_ids_json ? (JSON.parse(stored.project_ids_json) as string[]) : null,
  };
}

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization || authorization.length < 8 || authorization.length > 8192) return null;
  if (authorization.slice(0, 6).toLowerCase() !== "bearer") return null;

  let tokenStart = 6;
  if (authorization[tokenStart] !== " " && authorization[tokenStart] !== "\t") return null;
  while (authorization[tokenStart] === " " || authorization[tokenStart] === "\t") tokenStart++;
  if (tokenStart === authorization.length) return null;

  for (let index = tokenStart; index < authorization.length; index++) {
    const code = authorization.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return authorization.slice(tokenStart);
}

export class SetupManager {
  private tokenHash: string | null = null;
  private expiresAt = 0;

  issue(): string {
    const token = randomToken(32);
    this.tokenHash = hashToken(token);
    this.expiresAt = Date.now() + 15 * 60_000;
    return token;
  }

  consume(token: string): boolean {
    if (!this.tokenHash || Date.now() > this.expiresAt || !safeTokenEqual(token, this.tokenHash))
      return false;
    this.tokenHash = null;
    return true;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createSession(db: AppDatabase, userId: string): { token: string; expiresAt: Date } {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  db.createSession(userId, hashToken(token), expiresAt);
  return { token, expiresAt };
}

export function authenticate(db: AppDatabase, request: FastifyRequest): Identity | null {
  const bearer = parseBearerToken(request.headers.authorization);
  if (bearer) return authenticateBearer(db, bearer);
  const sessionToken = request.cookies[SESSION_COOKIE];
  if (!sessionToken) return null;
  const session = db.getSession(hashToken(sessionToken));
  return session
    ? {
        kind: "session",
        userId: session.user_id,
        scopes: ["read", "capture:trigger", "manage"],
        projectIds: null,
      }
    : null;
}

export function requireIdentity(
  db: AppDatabase,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: ApiScope,
  projectId?: string,
): Identity | null {
  const identity = authenticate(db, request);
  if (
    !identity ||
    !identity.scopes.includes(scope) ||
    (projectId && identity.projectIds && !identity.projectIds.includes(projectId))
  ) {
    void reply.code(401).send({ error: "Authentication with the required scope is needed" });
    return null;
  }
  return identity;
}

export function requireInstanceIdentity(
  db: AppDatabase,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: ApiScope,
): Identity | null {
  const identity = requireIdentity(db, request, reply, scope);
  if (!identity) return null;
  if (identity.kind === "token" && identity.projectIds) {
    void reply.code(401).send({ error: "Instance-level authentication is required" });
    return null;
  }
  return identity;
}
