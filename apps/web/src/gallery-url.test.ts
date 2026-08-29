import { describe, expect, it } from "vitest";
import { projectGalleryUrl, type GalleryLinkProject } from "./gallery-url";

function fixture(overrides: Partial<GalleryLinkProject> = {}): GalleryLinkProject {
  return {
    slug: "example",
    publishMode: "indexable",
    shareToken: null,
    staticPublication: null,
    ...overrides,
  };
}

describe("project gallery URL", () => {
  it("does not link private projects", () => {
    expect(
      projectGalleryUrl(fixture({ publishMode: "private" }), "https://screens.example"),
    ).toBeNull();
  });

  it("links the built-in indexable gallery", () => {
    expect(projectGalleryUrl(fixture(), "https://screens.example")).toBe(
      "https://screens.example/p/example",
    );
  });

  it("links the built-in secret gallery for unlisted projects", () => {
    expect(
      projectGalleryUrl(
        fixture({ publishMode: "unlisted", shareToken: "secret-token" }),
        "https://screens.example",
      ),
    ).toBe("https://screens.example/s/secret-token");
  });

  it("prefers an active static gallery", () => {
    expect(
      projectGalleryUrl(
        fixture({
          staticPublication: { active: true, url: "https://history.example/p/example/" },
        }),
        "https://screens.example",
      ),
    ).toBe("https://history.example/p/example/");
  });
});
