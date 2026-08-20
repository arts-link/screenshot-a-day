import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { PublicationBranding } from "@sad/contracts";
import type { AppDatabase, PublicationTargetRow } from "./database.js";
import type { BlobStore } from "./storage.js";

const execFileAsync = promisify(execFile);
const PAGE_SIZE = 24;

export async function cleanupStalePublicationDirectories(
  olderThanMs = 60 * 60_000,
  now = Date.now(),
): Promise<void> {
  const root = tmpdir();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("sad-publication-")) continue;
    const path = join(root, entry.name);
    if (now - (await stat(path)).mtimeMs > olderThanMs)
      await rm(path, { recursive: true, force: true });
  }
}

export interface ManagedFile {
  path: string;
  sha256: string;
  sha1: string;
  size: number;
}

export interface RenderedPublication {
  directory: string;
  files: ManagedFile[];
  cleanup(): Promise<void>;
}

export interface PublicationRenderer {
  readonly id: "hugo-ryder";
  verify(): Promise<{ available: boolean; error: string | null }>;
  render(target: PublicationTargetRow): Promise<RenderedPublication>;
}

interface RendererOptions {
  db: AppDatabase;
  blobs: BlobStore;
  hugoPath: string;
  ryderPath: string;
  templatePath: string;
  timeoutMs: number;
  runHugo?: (
    args: string[],
    options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv },
  ) => Promise<void>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeSegment(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error(`Unsafe static path segment: ${value}`);
  return value;
}

function extensionFor(key: string, fallback: string): string {
  const extension = extname(key).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
}

async function listFiles(root: string, directory = root): Promise<ManagedFile[]> {
  const files: ManagedFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Generated publication contains a symbolic link");
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: sha256(bytes),
        sha1: createHash("sha1").update(bytes).digest("hex"),
        size: bytes.length,
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function removeAliasPages(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeAliasPages(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      const html = await readFile(path, "utf8");
      if (html.includes('<meta http-equiv="refresh"')) await rm(path);
    }
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function writePage(path: string, frontMatter: Record<string, unknown>): Promise<void> {
  await writeJson(path, frontMatter);
}

export class HugoRyderRenderer implements PublicationRenderer {
  readonly id = "hugo-ryder" as const;

  constructor(private readonly options: RendererOptions) {}

  async verify(): Promise<{ available: boolean; error: string | null }> {
    try {
      const { stdout } = await execFileAsync(this.options.hugoPath, ["version"], {
        timeout: 10_000,
      });
      if (!/v0\.146\.2\b/.test(stdout) || !/extended/i.test(stdout))
        return {
          available: false,
          error: `Publishing requires Hugo Extended 0.146.2; found ${stdout.trim()}`,
        };
      const theme = await readFile(join(this.options.ryderPath, "theme.toml"), "utf8");
      if (
        !/name\s*=\s*["']Ryder["']/i.test(theme) ||
        !/version\s*=\s*["']v0\.4\.1["']/i.test(theme)
      )
        return { available: false, error: "The pinned Ryder theme is missing or incompatible" };
      return { available: true, error: null };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Hugo is unavailable",
      };
    }
  }

  async render(target: PublicationTargetRow): Promise<RenderedPublication> {
    const workspace = await mkdtemp(join(tmpdir(), "sad-publication-"));
    const output = join(workspace, "public");
    try {
      await cp(this.options.templatePath, workspace, { recursive: true });
      const branding = JSON.parse(target.branding_json) as PublicationBranding;
      const cssSource = await readFile(join(workspace, "assets", "gallery.css"), "utf8");
      const jsSource = await readFile(join(workspace, "assets", "gallery.js"));
      const brandedCss = `:root{--accent:${branding.accentColor};--background:${branding.backgroundColor}}\n${cssSource}`;
      const cssName = `assets/gallery.${sha256(Buffer.from(brandedCss)).slice(0, 16)}.css`;
      const jsName = `assets/gallery.${sha256(jsSource).slice(0, 16)}.js`;
      await mkdir(join(workspace, "static", "assets"), { recursive: true });
      await writeFile(join(workspace, "static", cssName), brandedCss);
      await writeFile(join(workspace, "static", jsName), jsSource);
      await writeJson(join(workspace, "data", "assets.json"), { css: cssName, js: jsName });

      const galleryByKey: Record<string, unknown> = {};
      const galleries: Array<Record<string, unknown>> = [];
      const materialized = new Map<string, string>();
      const materialize = async (
        key: string | null,
        fallbackExtension: string,
      ): Promise<string | null> => {
        if (!key) return null;
        const existing = materialized.get(key);
        if (existing) return existing;
        const bytes = await this.options.blobs.get(key);
        const path = `media/${sha256(bytes)}${extensionFor(key, fallbackExtension)}`;
        if (![...materialized.values()].includes(path)) {
          await mkdir(dirname(join(workspace, "static", path)), { recursive: true });
          await writeFile(join(workspace, "static", path), bytes);
        }
        materialized.set(key, path);
        return path;
      };

      for (const publication of this.options.db.listTargetProjectPublications(target.id)) {
        const project = this.options.db.getProject(publication.project_id);
        if (!project || project.publish_mode === "private") continue;
        const path =
          project.publish_mode === "unlisted"
            ? `/s/${project.share_token}/`
            : `/p/${safeSegment(project.slug)}/`;
        const captures = this.options.db
          .listCaptures(project.id, undefined, 100_000)
          .filter(
            (capture) =>
              capture.status === "succeeded" && capture.image_key && capture.thumbnail_key,
          );
        const profileData: Array<Record<string, unknown>> = [];
        const profilePages: Record<string, unknown> = {};
        for (const profile of this.options.db.listProfiles(project.id)) {
          const history = captures.filter((capture) => capture.profile_id === profile.id);
          if (!history.length) continue;
          const profileSlug = safeSegment(
            profile.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "") || "profile",
          );
          const pageCount = Math.ceil(history.length / PAGE_SIZE);
          const pages = [];
          for (let page = 1; page <= pageCount; page++) {
            const pageKey = `${profile.id}-${page}`;
            const pagePath = `${path}${profileSlug}/page/${page}/`;
            const pageCaptures = [];
            for (const capture of history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
              pageCaptures.push({
                id: capture.id,
                captured_at: capture.captured_at,
                change_percent: capture.change_percent,
                width: capture.width,
                height: capture.height,
                image: await materialize(capture.image_key, ".png"),
                thumbnail: await materialize(capture.thumbnail_key, ".webp"),
                diff: await materialize(capture.diff_key, ".png"),
              });
            }
            profilePages[pageKey] = {
              name: profile.name,
              browser: profile.browser,
              page,
              pages: pageCount,
              captures: pageCaptures,
              previous: page > 1 ? `${path}${profileSlug}/page/${page - 1}/` : null,
              next: page < pageCount ? `${path}${profileSlug}/page/${page + 1}/` : null,
            };
            await writePage(join(workspace, "content", pagePath, "index.md"), {
              title: `${profile.name} · ${project.name}`,
              description: `${project.name} visual history for ${profile.name}`,
              layout: "profile",
              gallery_key: project.id,
              page_key: pageKey,
              noindex: project.publish_mode === "unlisted",
              sitemap: { disable: project.publish_mode === "unlisted" },
              outputs: ["HTML"],
            });
            pages.push(pagePath);
          }
          const gif = await materialize(
            this.options.db.getExport(profile.id, "gif")?.blob_key ?? null,
            ".gif",
          );
          const webm = await materialize(
            this.options.db.getExport(profile.id, "webm")?.blob_key ?? null,
            ".webm",
          );
          profileData.push({
            id: profile.id,
            name: profile.name,
            browser: profile.browser,
            settings: JSON.parse(profile.settings_json),
            capture_count: history.length,
            latest_thumbnail: await materialize(history[0]!.thumbnail_key, ".webp"),
            path: pages[0],
            gif,
            webm,
          });
        }
        const updatedAt = captures[0]?.captured_at ?? project.updated_at;
        const gallery = {
          id: project.id,
          name: project.name,
          mode: project.publish_mode,
          indexable: project.publish_mode === "indexable",
          path,
          capture_count: captures.length,
          profile_count: profileData.length,
          latest_thumbnail: await materialize(captures[0]?.thumbnail_key ?? null, ".webp"),
          updated_at: updatedAt,
          profiles: profileData,
          profile_pages: profilePages,
        };
        galleryByKey[project.id] = gallery;
        galleries.push(gallery);
        await writePage(join(workspace, "content", path, "_index.md"), {
          title: project.name,
          description: `${project.name} visual history`,
          layout: "gallery",
          gallery_key: project.id,
          noindex: project.publish_mode === "unlisted",
          sitemap: { disable: project.publish_mode === "unlisted" },
          outputs: ["HTML"],
        });
      }
      await writeJson(join(workspace, "data", "galleries.json"), galleries);
      await writeJson(join(workspace, "data", "gallery_by_key.json"), galleryByKey);
      await writeJson(join(workspace, "hugo.json"), {
        baseURL: `${target.base_url}/`,
        title: branding.title,
        theme: basename(this.options.ryderPath),
        disableKinds: ["taxonomy", "term"],
        disableAliases: true,
        disablePathToLower: true,
        enableRobotsTXT: true,
        outputs: { home: ["HTML", "RSS"] },
        params: {
          description: branding.description,
          logoText: branding.logoText,
          tagline: branding.tagline,
          darkMode: branding.darkMode,
          supplementalFooter: branding.supplementalFooter,
          analytics: branding.analytics,
        },
      });
      const runner =
        this.options.runHugo ??
        (async (args, options) => {
          await execFileAsync(this.options.hugoPath, args, options);
        });
      await runner(
        [
          "--source",
          workspace,
          "--destination",
          output,
          "--themesDir",
          dirname(this.options.ryderPath),
          "--environment",
          "production",
          "--cleanDestinationDir",
          "--noBuildLock",
        ],
        {
          cwd: workspace,
          timeout: this.options.timeoutMs,
          env: { ...process.env, SOURCE_DATE_EPOCH: "0" },
        },
      );
      await removeAliasPages(output);
      const files = await listFiles(output);
      if (!files.some((file) => file.path === "index.html"))
        throw new Error("Hugo did not produce a root index");
      return {
        directory: output,
        files,
        cleanup: () => rm(workspace, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }
}
