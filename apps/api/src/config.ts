import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  SAD_HOST: z.string().default("0.0.0.0"),
  SAD_PORT: z.coerce.number().int().min(1).max(65_535).default(4400),
  SAD_DATA_DIR: z.string().default("./data"),
  SAD_PUBLIC_URL: z.url().default("http://localhost:4400"),
  SAD_ENCRYPTION_KEY: z.string().min(43),
  SAD_SESSION_SECRET: z.string().min(32),
  SAD_WORKER_TOKEN: z.string().min(32),
  SAD_PRIVATE_TARGET_ALLOWLIST: z.string().default(""),
  SAD_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  SAD_BUILD_COMMIT: z.string().default("development"),
  SAD_HUGO_PATH: z.string().default("hugo"),
  SAD_RYDER_PATH: z.string().default("/opt/sad/ryder"),
  SAD_PUBLICATION_BUILD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(30 * 60_000)
    .default(300_000),
  SAD_PUBLICATION_DEPLOY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(60 * 60_000)
    .default(600_000),
  SAD_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  publicUrl: string;
  encryptionKey: string;
  sessionSecret: string;
  workerToken: string;
  privateTargetAllowlist: string[];
  trustProxy: boolean;
  buildCommit: string;
  hugoPath: string;
  ryderPath: string;
  publicationBuildTimeoutMs: number;
  publicationDeployTimeoutMs: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  return {
    host: parsed.SAD_HOST,
    port: parsed.SAD_PORT,
    dataDir: resolve(parsed.SAD_DATA_DIR),
    publicUrl: parsed.SAD_PUBLIC_URL.replace(/\/$/, ""),
    encryptionKey: parsed.SAD_ENCRYPTION_KEY,
    sessionSecret: parsed.SAD_SESSION_SECRET,
    workerToken: parsed.SAD_WORKER_TOKEN,
    privateTargetAllowlist: parsed.SAD_PRIVATE_TARGET_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    trustProxy: parsed.SAD_TRUST_PROXY === "true",
    buildCommit: parsed.SAD_BUILD_COMMIT,
    hugoPath: parsed.SAD_HUGO_PATH,
    ryderPath: parsed.SAD_RYDER_PATH,
    publicationBuildTimeoutMs: parsed.SAD_PUBLICATION_BUILD_TIMEOUT_MS,
    publicationDeployTimeoutMs: parsed.SAD_PUBLICATION_DEPLOY_TIMEOUT_MS,
    logLevel: parsed.SAD_LOG_LEVEL,
  };
}

export function developmentSecrets(): Pick<
  AppConfig,
  "encryptionKey" | "sessionSecret" | "workerToken"
> {
  return {
    encryptionKey: randomBytes(32).toString("base64"),
    sessionSecret: randomBytes(32).toString("base64url"),
    workerToken: randomBytes(32).toString("base64url"),
  };
}
