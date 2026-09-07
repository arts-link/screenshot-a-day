import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  ComparisonTooLargeError,
  MAX_COMPARISON_PIXELS,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  compareImages,
  thumbnail,
} from "../src/images.js";

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

  it("makes a sharp top-of-page crop from a tall screenshot", async () => {
    const screenshot = await sharp({
      create: { width: 1200, height: 2400, channels: 3, background: "#0000ff" },
    })
      .composite([
        {
          input: {
            create: { width: 1200, height: 800, channels: 3, background: "#ff0000" },
          },
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const preview = await thumbnail(screenshot);
    const metadata = await sharp(preview).metadata();
    const { data, info } = await sharp(preview).raw().toBuffer({ resolveWithObject: true });
    const bottomLeft = (info.height - 1) * info.width * info.channels;

    expect(metadata).toMatchObject({
      format: "webp",
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
    });
    expect(data[bottomLeft]).toBeGreaterThan(200);
    expect(data[bottomLeft + 2]).toBeLessThan(40);
  });

  it("rejects comparisons above the decoded pixel budget", async () => {
    const width = 4001;
    const height = 4000;
    expect(width * height).toBeGreaterThan(MAX_COMPARISON_PIXELS);
    const oversized = await sharp({
      create: { width, height, channels: 3, background: "#000000" },
    })
      .png()
      .toBuffer();
    await expect(compareImages(oversized, oversized)).rejects.toBeInstanceOf(
      ComparisonTooLargeError,
    );
  });
});
