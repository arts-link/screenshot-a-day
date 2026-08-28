import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import type { PublicationBranding } from "@sad/contracts";
import type { AppDatabase, PublicationTargetRow } from "./database.js";
import type { BlobStore } from "./storage.js";
import {
  contentSecurityPolicy,
  galleryPage,
  homePage,
  notFoundPage,
  profilePage,
  robotsTxt,
  rssFeed,
  sitemapXml,
  type CaptureFrame,
  type Gallery,
  type ProfilePage,
  type ProfileSummary,
  type SiteContext,
} from "./publication-templates.js";

export const STATIC_GALLERY_PAGE_SIZE = 12;
const FONT_FILES = [
  "dm-sans-latin-ext.woff2",
  "dm-sans-latin.woff2",
  "fraunces-italic-latin-ext.woff2",
  "fraunces-italic-latin.woff2",
  "fraunces-normal-latin-ext.woff2",
  "fraunces-normal-latin.woff2",
] as const;

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
  readonly id: "static-gallery";
  verify(): Promise<{ available: boolean; error: string | null }>;
  render(target: PublicationTargetRow): Promise<RenderedPublication>;
}

interface RendererOptions {
  db: AppDatabase;
  blobs: BlobStore;
  templatePath: string;
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

async function writeOutput(root: string, path: string, contents: string | Uint8Array) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

/**
 * Renders every attached gallery to a self-contained static site in a temporary
 * directory. Output is produced in-process: there is no external site generator, no
 * subprocess, and therefore no environment to leak into one.
 */
export class StaticGalleryRenderer implements PublicationRenderer {
  readonly id = "static-gallery" as const;

  constructor(private readonly options: RendererOptions) {}

  private asset(...segments: string[]): string {
    return join(this.options.templatePath, ...segments);
  }

  async verify(): Promise<{ available: boolean; error: string | null }> {
    try {
      await Promise.all([
        readFile(this.asset("assets", "gallery.css")),
        readFile(this.asset("assets", "gallery.js")),
        readFile(this.asset("static", "_headers")),
        ...FONT_FILES.map((file) => readFile(this.asset("assets", "fonts", file))),
      ]);
      return { available: true, error: null };
    } catch (error) {
      return {
        available: false,
        error: `Bundled gallery assets are missing: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  async render(target: PublicationTargetRow): Promise<RenderedPublication> {
    const workspace = await mkdtemp(join(tmpdir(), "sad-publication-"));
    const output = join(workspace, "public");
    try {
      await mkdir(output, { recursive: true });
      const branding = JSON.parse(target.branding_json) as PublicationBranding;
      const cssSource = await readFile(this.asset("assets", "gallery.css"), "utf8");
      const jsSource = await readFile(this.asset("assets", "gallery.js"));
      const headersSource = await readFile(this.asset("static", "_headers"), "utf8");
      const brandedCss = `:root{--accent:${branding.accentColor};--background:${branding.backgroundColor}}\n${cssSource}`;
      const cssPath = `assets/gallery.${sha256(Buffer.from(brandedCss)).slice(0, 16)}.css`;
      const jsPath = `assets/gallery.${sha256(jsSource).slice(0, 16)}.js`;
      await writeOutput(output, cssPath, brandedCss);
      await writeOutput(output, jsPath, jsSource);
      await mkdir(join(output, "assets", "fonts"), { recursive: true });
      await Promise.all(
        FONT_FILES.map((file) =>
          copyFile(this.asset("assets", "fonts", file), join(output, "assets", "fonts", file)),
        ),
      );
      await writeOutput(
        output,
        "_headers",
        headersSource.replaceAll(
          "__SAD_CONTENT_SECURITY_POLICY__",
          `${contentSecurityPolicy(branding)}; frame-ancestors 'none'`,
        ),
      );

      const site: SiteContext = { baseUrl: target.base_url, branding, cssPath, jsPath };

      const materialized = new Map<string, string>();
      const written = new Set<string>();
      const materialize = async (
        key: string | null,
        fallbackExtension: string,
      ): Promise<string | null> => {
        if (!key) return null;
        const existing = materialized.get(key);
        if (existing) return existing;
        const bytes = await this.options.blobs.get(key);
        const path = `media/${sha256(bytes)}${extensionFor(key, fallbackExtension)}`;
        if (!written.has(path)) {
          await writeOutput(output, path, bytes);
          written.add(path);
        }
        materialized.set(key, path);
        return path;
      };

      const galleries: Gallery[] = [];
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
        const profiles: ProfileSummary[] = [];
        const pages: Array<{ path: string; page: ProfilePage }> = [];
        const usedSlugs = new Map<string, number>();
        for (const profile of this.options.db.listProfiles(project.id)) {
          const history = captures.filter((capture) => capture.profile_id === profile.id);
          if (!history.length) continue;
          const base = safeSegment(
            profile.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "") || "profile",
          );
          // Two profiles can slugify identically ("Desktop 1" and "Desktop-1"); without
          // this the second would silently overwrite the first's published pages.
          const collisions = usedSlugs.get(base) ?? 0;
          usedSlugs.set(base, collisions + 1);
          const profileSlug = collisions === 0 ? base : `${base}-${collisions + 1}`;
          const pageCount = Math.ceil(history.length / STATIC_GALLERY_PAGE_SIZE);
          const profilePaths: string[] = [];
          for (let page = 1; page <= pageCount; page++) {
            const pagePath = `${path}${profileSlug}/page/${page}/`;
            const frames: CaptureFrame[] = [];
            for (const capture of history.slice(
              (page - 1) * STATIC_GALLERY_PAGE_SIZE,
              page * STATIC_GALLERY_PAGE_SIZE,
            )) {
              frames.push({
                id: capture.id,
                capturedAt: capture.captured_at,
                changePercent: capture.change_percent,
                image: await materialize(capture.image_key, ".png"),
                thumbnail: await materialize(capture.thumbnail_key, ".webp"),
                diff: await materialize(capture.diff_key, ".png"),
              });
            }
            pages.push({
              path: pagePath,
              page: {
                id: profile.id,
                name: profile.name,
                browser: profile.browser,
                page,
                pages: pageCount,
                captures: frames,
                previous: page > 1 ? `${path}${profileSlug}/page/${page - 1}/` : null,
                next: page < pageCount ? `${path}${profileSlug}/page/${page + 1}/` : null,
              },
            });
            profilePaths.push(pagePath);
          }
          profiles.push({
            id: profile.id,
            name: profile.name,
            browser: profile.browser,
            captureCount: history.length,
            latestThumbnail: await materialize(history[0]!.thumbnail_key, ".webp"),
            path: profilePaths[0],
            gif: await materialize(
              this.options.db.getExport(profile.id, "gif")?.blob_key ?? null,
              ".gif",
            ),
            webm: await materialize(
              this.options.db.getExport(profile.id, "webm")?.blob_key ?? null,
              ".webm",
            ),
          });
        }
        galleries.push({
          id: project.id,
          name: project.name,
          mode: project.publish_mode,
          indexable: project.publish_mode === "indexable",
          path,
          captureCount: captures.length,
          profileCount: profiles.length,
          latestThumbnail: await materialize(captures[0]?.thumbnail_key ?? null, ".webp"),
          updatedAt: captures[0]?.captured_at ?? project.updated_at,
          profiles,
          pages,
        });
      }

      for (const gallery of galleries) {
        await writeOutput(
          output,
          `${gallery.path.replace(/^\//, "")}index.html`,
          galleryPage(site, gallery),
        );
        for (const { path: pagePath, page } of gallery.pages) {
          await writeOutput(
            output,
            `${pagePath.replace(/^\//, "")}index.html`,
            profilePage(site, gallery, page),
          );
        }
      }
      await writeOutput(output, "index.html", homePage(site, galleries));
      await writeOutput(output, "404.html", notFoundPage(site));
      await writeOutput(output, "index.xml", rssFeed(site, galleries));
      await writeOutput(output, "sitemap.xml", sitemapXml(site, galleries));
      await writeOutput(output, "robots.txt", robotsTxt(site));

      const files = await listFiles(output);
      if (!files.some((file) => file.path === "index.html"))
        throw new Error("The renderer did not produce a root index");
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
