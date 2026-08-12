import { mkdir } from "node:fs/promises";
import { hashToken, randomToken } from "@sad/core";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./database.js";

const command = process.argv[2];
if (command !== "recovery-token") throw new Error("Usage: admin recovery-token");
const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const db = new AppDatabase(`${config.dataDir}/sad.sqlite`);
try {
  if (db.userCount() === 0) throw new Error("Initial setup has not been completed");
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  db.setSetting("admin_recovery", JSON.stringify({ tokenHash: hashToken(token), expiresAt }));
  console.log(`Recovery token (expires ${expiresAt}): ${token}`);
} finally {
  db.close();
}
