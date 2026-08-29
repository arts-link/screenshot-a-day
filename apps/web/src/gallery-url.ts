export interface GalleryLinkProject {
  slug: string;
  publishMode: "private" | "unlisted" | "indexable";
  shareToken: string | null;
  staticPublication: { active: boolean; url: string } | null;
}

export function projectGalleryUrl(project: GalleryLinkProject, origin: string): string | null {
  if (project.publishMode === "private") return null;
  if (project.staticPublication?.active) return project.staticPublication.url;
  const base = origin.replace(/\/+$/, "");
  if (project.publishMode === "unlisted")
    return project.shareToken ? `${base}/s/${encodeURIComponent(project.shareToken)}` : null;
  return `${base}/p/${encodeURIComponent(project.slug)}`;
}
