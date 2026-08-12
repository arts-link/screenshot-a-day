import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface EncryptedValue {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("SAD_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
}

export function encryptJson(value: unknown, encodedKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: EncryptedValue = {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptJson<T>(value: string, encodedKey: string): T {
  const envelope = JSON.parse(value) as EncryptedValue;
  if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported encrypted value");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(encodedKey),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeTokenEqual(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate));
  const expected = Buffer.from(expectedHash);
  return candidateHash.length === expected.length && timingSafeEqual(candidateHash, expected);
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
