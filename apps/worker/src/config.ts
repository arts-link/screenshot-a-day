import { z } from "zod";

const schema = z.object({
  SAD_API_URL: z.url().default("http://localhost:4400"),
  SAD_WORKER_TOKEN: z.string().min(32),
  SAD_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  SAD_WORKER_POLL_MS: z.coerce.number().int().min(250).max(30_000).default(2000),
  SAD_FFMPEG_PATH: z.string().default("ffmpeg"),
});

export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(env);
  return {
    apiUrl: value.SAD_API_URL.replace(/\/$/, ""),
    token: value.SAD_WORKER_TOKEN,
    concurrency: value.SAD_WORKER_CONCURRENCY,
    pollMs: value.SAD_WORKER_POLL_MS,
    ffmpegPath: value.SAD_FFMPEG_PATH,
  };
}
