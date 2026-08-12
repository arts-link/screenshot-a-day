import pixelmatch from "pixelmatch";
import sharp from "sharp";

export async function thumbnail(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .resize({ width: 560, height: 400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

export async function compareImages(
  first: Buffer,
  second: Buffer,
): Promise<{ changePercent: number; diff: Buffer; width: number; height: number }> {
  const firstMeta = await sharp(first).metadata();
  const secondMeta = await sharp(second).metadata();
  const width = Math.max(firstMeta.width ?? 0, secondMeta.width ?? 0);
  const height = Math.max(firstMeta.height ?? 0, secondMeta.height ?? 0);
  if (!width || !height || width * height > 80_000_000)
    throw new Error("Images are too large to compare safely");

  const normalize = (bytes: Buffer) =>
    sharp({ create: { width, height, channels: 4, background: "#ffffff" } })
      .composite([{ input: bytes, top: 0, left: 0 }])
      .raw()
      .toBuffer();
  const [a, b] = await Promise.all([normalize(first), normalize(second)]);
  const diff = Buffer.alloc(width * height * 4);
  const changed = pixelmatch(a, b, diff, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.55,
  });
  return {
    changePercent: Number(((changed / (width * height)) * 100).toFixed(4)),
    diff: await sharp(diff, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    width,
    height,
  };
}
