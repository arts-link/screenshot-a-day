import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compareImages, thumbnail } from "../src/images.js";

describe("derived image artifacts", () => {
  it("generates bounded thumbnails and deterministic visual differences", async () => {
    const black = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#000000" },
    })
      .png()
      .toBuffer();
    const white = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const same = await compareImages(black, black);
    const changed = await compareImages(black, white);
    expect(same.changePercent).toBe(0);
    expect(changed.changePercent).toBe(100);
    expect((await sharp(await thumbnail(black)).metadata()).format).toBe("webp");
  });
});
