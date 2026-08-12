import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { WorkerJob } from "@sad/contracts";
import sharp from "sharp";
import type { WorkerApi } from "./api.js";
import type { WorkerConfig } from "./config.js";

type ExportJob = Extract<WorkerJob, { type: "export" }>;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error = `${error}${String(chunk)}`.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${error}`)),
    );
  });
}

function timestampSvg(text: string, width: number, height: number): Buffer {
  const safe = text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
  );
  return Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="20" y="${height - 62}" width="310" height="38" rx="7" fill="#000" fill-opacity=".68"/><text x="34" y="${height - 36}" fill="#fff" font-size="18" font-family="sans-serif">${safe}</text></svg>`,
  );
}

export async function runExport(
  job: ExportJob,
  api: WorkerApi,
  config: WorkerConfig,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sad-export-"));
  try {
    for (let index = 0; index < job.frames.length; index++) {
      const frame = job.frames[index]!;
      const bytes = await api.download(frame.url);
      let pipeline = sharp(bytes).resize(job.canvasWidth, job.canvasHeight, {
        fit: "contain",
        background: job.background,
      });
      if (job.timestampOverlay)
        pipeline = pipeline.composite([
          {
            input: timestampSvg(
              new Date(frame.capturedAt).toLocaleString("en-US", {
                timeZone: "UTC",
                dateStyle: "medium",
                timeStyle: "short",
              }) + " UTC",
              job.canvasWidth,
              job.canvasHeight,
            ),
          },
        ]);
      await writeFile(
        join(directory, `frame-${String(index).padStart(5, "0")}.png`),
        await pipeline.png().toBuffer(),
      );
    }
    const fps = (1000 / job.frameDurationMs).toFixed(6);
    const pattern = join(directory, "frame-%05d.png");
    const output = join(directory, `output.${job.format}`);
    if (job.format === "gif") {
      const palette = join(directory, "palette.png");
      await run(config.ffmpegPath, [
        "-y",
        "-framerate",
        fps,
        "-i",
        pattern,
        "-vf",
        "palettegen=stats_mode=diff",
        palette,
      ]);
      await run(config.ffmpegPath, [
        "-y",
        "-framerate",
        fps,
        "-i",
        pattern,
        "-i",
        palette,
        "-lavfi",
        "paletteuse=dither=sierra2_4a",
        "-loop",
        "0",
        output,
      ]);
    } else {
      await run(config.ffmpegPath, [
        "-y",
        "-framerate",
        fps,
        "-i",
        pattern,
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        "32",
        "-pix_fmt",
        "yuv420p",
        "-an",
        output,
      ]);
    }
    await api.upload(job, await readFile(output), { frameCount: job.frames.length });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
