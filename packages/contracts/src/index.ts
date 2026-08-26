import { z } from "zod";

export const PRODUCT_VERSION = "0.1.0";
export const API_VERSION = "v1";
export const WEBHOOK_SCHEMA_VERSION = "1";

export const browserNameSchema = z.enum(["chromium", "firefox", "webkit"]);
export const captureExtentSchema = z.enum(["viewport", "fullPage"]);
export const publishModeSchema = z.enum(["private", "unlisted", "indexable"]);
export const colorSchemeSchema = z.enum(["light", "dark", "no-preference"]);
export const reducedMotionSchema = z.enum(["reduce", "no-preference"]);

export const publicationAdapterSchema = z.enum(["vercel", "netlify", "sftp"]);
export const publicationScheduleModeSchema = z.enum([
  "manual",
  "on_change",
  "hourly",
  "daily",
  "weekly",
  "custom",
]);
const colorTokenSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const publicationBrandingSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  logoText: z.string().trim().max(80).nullable().default(null),
  logoUrl: z.url().max(2048).nullable().default(null),
  tagline: z.string().trim().max(160).default(""),
  accentColor: colorTokenSchema.default("#dbff53"),
  backgroundColor: colorTokenSchema.default("#10151d"),
  darkMode: z.boolean().default(true),
  supplementalFooter: z.string().trim().max(300).default(""),
  analytics: z
    .discriminatedUnion("provider", [
      z.object({ provider: z.literal("none") }),
      z.object({ provider: z.literal("plausible"), domain: z.string().trim().min(1).max(253) }),
      z.object({
        provider: z.literal("posthog"),
        apiKey: z.string().trim().min(1).max(200),
        host: z.url().max(2048).default("https://us.i.posthog.com"),
      }),
    ])
    .default({ provider: "none" }),
});

const vercelTargetSchema = z.object({
  adapter: z.literal("vercel"),
  config: z.object({
    projectId: z.string().trim().min(1).max(200),
    teamId: z.string().trim().max(200).nullable().default(null),
  }),
  credentials: z.object({ token: z.string().trim().min(1).max(1000) }),
});
const netlifyTargetSchema = z.object({
  adapter: z.literal("netlify"),
  config: z.object({ siteId: z.string().trim().min(1).max(200) }),
  credentials: z.object({ token: z.string().trim().min(1).max(1000) }),
});
const sftpTargetSchema = z.object({
  adapter: z.literal("sftp"),
  config: z.object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(22),
    root: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/),
    username: z.string().trim().min(1).max(128),
    hostKeySha256: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/),
  }),
  credentials: z.union([
    z.object({ kind: z.literal("password"), password: z.string().min(1).max(2000) }),
    z.object({
      kind: z.literal("private_key"),
      privateKey: z.string().min(1).max(100_000),
      passphrase: z.string().max(2000).nullable().default(null),
    }),
  ]),
});

const publicationTargetBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z
    .url()
    .max(2048)
    .transform((value) => value.replace(/\/$/, "")),
  branding: publicationBrandingSchema,
  scheduleMode: publicationScheduleModeSchema.default("manual"),
  scheduleExpression: z.string().trim().min(1).max(120).nullable().default(null),
  scheduleTimezone: z.string().trim().min(1).max(80).default("UTC"),
  target: z.discriminatedUnion("adapter", [
    vercelTargetSchema,
    netlifyTargetSchema,
    sftpTargetSchema,
  ]),
});
export const publicationTargetInputSchema = publicationTargetBaseSchema.superRefine(
  (value, context) => {
    if (value.scheduleMode === "custom" && !value.scheduleExpression)
      context.addIssue({
        code: "custom",
        message: "Custom schedules require a cron expression",
        path: ["scheduleExpression"],
      });
    const base = new URL(value.baseUrl);
    if ((base.pathname && base.pathname !== "/") || base.search || base.hash)
      context.addIssue({
        code: "custom",
        message: "The canonical base URL must be an origin without a path, query, or fragment",
        path: ["baseUrl"],
      });
  },
);

export const publicationTargetUpdateSchema = publicationTargetBaseSchema
  .omit({ target: true })
  .partial()
  .extend({
    target: z
      .discriminatedUnion("adapter", [
        vercelTargetSchema.omit({ credentials: true }),
        netlifyTargetSchema.omit({ credentials: true }),
        sftpTargetSchema.omit({ credentials: true }),
      ])
      .optional(),
  });

export const captureProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  browser: browserNameSchema.default("chromium"),
  enabled: z.boolean().default(true),
  deviceName: z.string().trim().max(120).nullable().default(null),
  viewportWidth: z.number().int().min(320).max(7680).default(1440),
  viewportHeight: z.number().int().min(240).max(4320).default(900),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
  extent: captureExtentSchema.default("viewport"),
  colorScheme: colorSchemeSchema.default("light"),
  locale: z.string().trim().min(2).max(35).default("en-US"),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  reducedMotion: reducedMotionSchema.default("reduce"),
  delayMs: z.number().int().min(0).max(60_000).default(1000),
  waitForSelector: z.string().trim().max(500).nullable().default(null),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.url().max(2048),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  publishMode: publishModeSchema.default("private"),
  scheduleExpression: z.string().trim().min(1).max(120).default("0 0 * * *"),
  scheduleTimezone: z.string().trim().min(1).max(80).default("UTC"),
  scheduleEnabled: z.boolean().default(false),
  retentionDays: z.number().int().positive().nullable().default(null),
  retentionCount: z.number().int().positive().nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  cookies: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.string(),
        domain: z.string().min(1),
        path: z.string().default("/"),
        secure: z.boolean().default(true),
        httpOnly: z.boolean().default(true),
        sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
      }),
    )
    .default([]),
  profiles: z
    .array(captureProfileInputSchema)
    .min(1)
    .default([
      {
        name: "Desktop",
        browser: "chromium",
        enabled: true,
        deviceName: null,
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        extent: "viewport",
        colorScheme: "light",
        locale: "en-US",
        timezone: "UTC",
        reducedMotion: "reduce",
        delayMs: 1000,
        waitForSelector: null,
        timeoutMs: 30_000,
      },
    ]),
});

export const setupInputSchema = z.object({
  token: z.string().min(20),
  email: z.email().max(254),
  password: z.string().min(12).max(256),
});

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export const runTriggerSchema = z.object({
  profileIds: z.array(z.string()).optional(),
  force: z.boolean().default(false),
});

export const workerProfileSchema = captureProfileInputSchema.extend({ id: z.string() });

export const captureJobSchema = z.object({
  id: z.string(),
  leaseToken: z.string(),
  attempt: z.number().int().positive(),
  type: z.literal("capture"),
  projectId: z.string(),
  runId: z.string(),
  profile: workerProfileSchema,
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  cookies: projectInputSchema.shape.cookies,
  privateTargetAllowlist: z.array(z.string()),
});

export const exportJobSchema = z.object({
  id: z.string(),
  leaseToken: z.string(),
  attempt: z.number().int().positive(),
  type: z.literal("export"),
  projectId: z.string(),
  profileId: z.string(),
  format: z.enum(["gif", "webm"]),
  frames: z
    .array(z.object({ url: z.url(), capturedAt: z.string() }))
    .min(1)
    .max(500),
  frameDurationMs: z.number().int().min(100).max(10_000),
  canvasWidth: z.number().int().min(320).max(3840),
  canvasHeight: z.number().int().min(240).max(2160),
  timestampOverlay: z.boolean(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const workerJobSchema = z.discriminatedUnion("type", [captureJobSchema, exportJobSchema]);

export type BrowserName = z.infer<typeof browserNameSchema>;
export type CaptureProfileInput = z.infer<typeof captureProfileInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type PublishMode = z.infer<typeof publishModeSchema>;
export type WorkerJob = z.infer<typeof workerJobSchema>;
export type PublicationAdapter = z.infer<typeof publicationAdapterSchema>;
export type PublicationScheduleMode = z.infer<typeof publicationScheduleModeSchema>;
export type PublicationBranding = z.infer<typeof publicationBrandingSchema>;
export type PublicationTargetInput = z.infer<typeof publicationTargetInputSchema>;

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  url: string;
  publishMode: PublishMode;
  shareToken: string | null;
  scheduleEnabled: boolean;
  scheduleExpression: string;
  scheduleTimezone: string;
  profileCount: number;
  latestCaptureAt: string | null;
  createdAt: string;
}

export interface CaptureRecord {
  id: string;
  projectId: string;
  profileId: string;
  runId: string;
  status: "succeeded" | "failed";
  capturedAt: string;
  finalUrl: string | null;
  httpStatus: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  changePercent: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
}

export interface VersionInfo {
  version: string;
  commit: string;
  apiVersion: string;
}
