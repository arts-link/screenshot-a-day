import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { createHash } from "node:crypto";
import { resolveSafeUrl } from "@sad/core";
import SftpClient from "ssh2-sftp-client";
import type { PublicationTargetRow } from "./database.js";
import type { ManagedFile, RenderedPublication } from "./publication-renderer.js";

export interface DeploymentResult {
  deploymentId: string | null;
  deploymentUrl: string;
}

export interface PublicationAdapter {
  verify(target: PublicationTargetRow, credentials: unknown): Promise<void>;
  deploy(
    target: PublicationTargetRow,
    credentials: unknown,
    site: RenderedPublication,
    previousFiles: ManagedFile[],
    signal?: AbortSignal,
  ): Promise<DeploymentResult>;
}

interface VercelConfig {
  projectId: string;
  teamId: string | null;
}
interface NetlifyConfig {
  siteId: string;
}
interface TokenCredentials {
  token: string;
}
interface SftpConfig {
  host: string;
  port: number;
  root: string;
  username: string;
  hostKeySha256: string;
}
type SftpCredentials =
  | { kind: "password"; password: string }
  | { kind: "private_key"; privateKey: string; passphrase: string | null };

function authHeaders(credentials: TokenCredentials): Record<string, string> {
  if (!credentials?.token) throw new Error("Publication credentials are missing");
  return { authorization: `Bearer ${credentials.token}` };
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deployment API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}

async function responseOk(response: Response): Promise<void> {
  if (!response.ok) await responseJson(response);
}

async function fileBytes(site: RenderedPublication, file: ManagedFile): Promise<Buffer> {
  return readFile(join(site.directory, ...file.path.split("/")));
}

async function requestBody(site: RenderedPublication, file: ManagedFile): Promise<ArrayBuffer> {
  const bytes = await fileBytes(site, file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class VercelAdapter implements PublicationAdapter {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async verify(target: PublicationTargetRow, credentials: unknown): Promise<void> {
    const config = JSON.parse(target.adapter_config_json) as VercelConfig;
    const token = credentials as TokenCredentials;
    const query = config.teamId ? `?teamId=${encodeURIComponent(config.teamId)}` : "";
    await responseJson(
      await this.fetcher(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(config.projectId)}${query}`,
        {
          headers: authHeaders(token),
        },
      ),
    );
  }

  async deploy(
    target: PublicationTargetRow,
    credentials: unknown,
    site: RenderedPublication,
    _previousFiles: ManagedFile[],
    signal?: AbortSignal,
  ): Promise<DeploymentResult> {
    const config = JSON.parse(target.adapter_config_json) as VercelConfig;
    const token = credentials as TokenCredentials;
    const headers = authHeaders(token);
    const query = config.teamId ? `?teamId=${encodeURIComponent(config.teamId)}` : "";
    for (const file of site.files) {
      const response = await this.fetcher(`https://api.vercel.com/v2/files${query}`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "content-length": String(file.size),
          "x-vercel-digest": file.sha1,
        },
        body: await requestBody(site, file),
        signal: signal ?? null,
      });
      if (!response.ok && response.status !== 409) await responseJson(response);
    }
    const deployment = await responseJson<{ id: string; url: string }>(
      await this.fetcher(`https://api.vercel.com/v13/deployments${query}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: config.projectId,
          project: config.projectId,
          target: "production",
          files: site.files.map((file) => ({ file: file.path, sha: file.sha1, size: file.size })),
          projectSettings: { framework: null },
        }),
        signal: signal ?? null,
      }),
    );
    return { deploymentId: deployment.id, deploymentUrl: `https://${deployment.url}` };
  }
}

export class NetlifyAdapter implements PublicationAdapter {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async verify(target: PublicationTargetRow, credentials: unknown): Promise<void> {
    const config = JSON.parse(target.adapter_config_json) as NetlifyConfig;
    await responseJson(
      await this.fetcher(
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.siteId)}`,
        {
          headers: authHeaders(credentials as TokenCredentials),
        },
      ),
    );
  }

  async deploy(
    target: PublicationTargetRow,
    credentials: unknown,
    site: RenderedPublication,
    _previousFiles: ManagedFile[],
    signal?: AbortSignal,
  ): Promise<DeploymentResult> {
    const config = JSON.parse(target.adapter_config_json) as NetlifyConfig;
    const headers = authHeaders(credentials as TokenCredentials);
    const digest = Object.fromEntries(site.files.map((file) => [`/${file.path}`, file.sha1]));
    const deployment = await responseJson<{
      id: string;
      url?: string;
      ssl_url?: string;
      required?: string[];
    }>(
      await this.fetcher(
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(config.siteId)}/deploys`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ files: digest, draft: false }),
          signal: signal ?? null,
        },
      ),
    );
    const required = new Set(deployment.required ?? []);
    for (const file of site.files) {
      if (!required.has(file.sha1)) continue;
      await responseOk(
        await this.fetcher(
          `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployment.id)}/files/${file.path.split("/").map(encodeURIComponent).join("/")}`,
          {
            method: "PUT",
            headers: { ...headers, "content-type": "application/octet-stream" },
            body: await requestBody(site, file),
            signal: signal ?? null,
          },
        ),
      );
    }
    return {
      deploymentId: deployment.id,
      deploymentUrl: deployment.ssl_url ?? deployment.url ?? target.base_url,
    };
  }
}

function remotePath(root: string, path: string): string {
  if (
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe managed path: ${path}`);
  const value = posix.join(root, path);
  if (value !== root && !value.startsWith(`${root}/`))
    throw new Error(`Managed path escapes SFTP root: ${path}`);
  return value;
}

async function ensureRemoteDirectory(
  client: SftpClient,
  root: string,
  file: string,
): Promise<void> {
  const parent = dirname(remotePath(root, file)).split("\\").join("/");
  await client.mkdir(parent, true);
}

async function assertRemoteParentWithin(
  client: SftpClient,
  canonicalRoot: string,
  root: string,
  file: string,
): Promise<void> {
  const parent = dirname(remotePath(root, file)).split("\\").join("/");
  const realParent = await client.realPath(parent);
  if (realParent !== canonicalRoot && !realParent.startsWith(`${canonicalRoot}/`))
    throw new Error(`SFTP path resolves outside the managed root: ${file}`);
}

export class SftpAdapter implements PublicationAdapter {
  constructor(
    private readonly privateTargetAllowlist: string[],
    private readonly createClient: () => SftpClient = () => new SftpClient(),
    private readonly resolver: typeof resolveSafeUrl = resolveSafeUrl,
  ) {}

  private async connect(
    target: PublicationTargetRow,
    credentials: SftpCredentials,
  ): Promise<{ client: SftpClient; config: SftpConfig }> {
    const config = JSON.parse(target.adapter_config_json) as SftpConfig;
    const resolved = await this.resolver(`https://${config.host}`, this.privateTargetAllowlist);
    const address = resolved.addresses[0];
    if (!address) throw new Error("SFTP host did not resolve");
    const client = this.createClient();
    const expected = config.hostKeySha256.replace(/^SHA256:/, "").replace(/=$/, "");
    await client.connect({
      host: address.address,
      port: config.port,
      username: config.username,
      hostVerifier: (key: Buffer) =>
        createHash("sha256").update(key).digest("base64").replace(/=$/, "") === expected,
      ...(credentials.kind === "password"
        ? { password: credentials.password }
        : {
            privateKey: credentials.privateKey,
            ...(credentials.passphrase ? { passphrase: credentials.passphrase } : {}),
          }),
      readyTimeout: 20_000,
    });
    return { client, config };
  }

  async verify(target: PublicationTargetRow, credentials: unknown): Promise<void> {
    const { client, config } = await this.connect(target, credentials as SftpCredentials);
    try {
      const exists = await client.exists(config.root);
      if (!exists) await client.mkdir(config.root, true);
      await client.realPath(config.root);
      const entries = await client.list(config.root);
      const markerPath = posix.join(config.root, ".screenshot-a-day-target.json");
      if (entries.length && !(await client.exists(markerPath)))
        throw new Error("SFTP root is not empty and has no Screenshot-a-Day target marker");
      if (await client.exists(markerPath)) {
        const marker = JSON.parse((await client.get(markerPath)).toString("utf8")) as {
          targetId?: string;
        };
        if (marker.targetId !== target.id)
          throw new Error("SFTP root belongs to a different publication target");
      }
    } finally {
      await client.end();
    }
  }

  async deploy(
    target: PublicationTargetRow,
    credentials: unknown,
    site: RenderedPublication,
    previousFiles: ManagedFile[],
    signal?: AbortSignal,
  ): Promise<DeploymentResult> {
    const { client, config } = await this.connect(target, credentials as SftpCredentials);
    const markerPath = posix.join(config.root, ".screenshot-a-day-target.json");
    const abort = () => void client.end();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      if (!(await client.exists(config.root))) await client.mkdir(config.root, true);
      const canonicalRoot = await client.realPath(config.root);
      const entries = await client.list(config.root);
      if (entries.length && !(await client.exists(markerPath)))
        throw new Error("Refusing to deploy into a non-empty unmarked SFTP root");
      if (await client.exists(markerPath)) {
        const marker = JSON.parse((await client.get(markerPath)).toString("utf8")) as {
          targetId?: string;
        };
        if (marker.targetId !== target.id) throw new Error("SFTP target marker mismatch");
      } else {
        await client.put(
          Buffer.from(JSON.stringify({ targetId: target.id, version: 1 })),
          markerPath,
        );
      }

      const pageFiles = site.files.filter(
        (file) =>
          file.path.endsWith(".html") || file.path.endsWith(".xml") || file.path.endsWith(".txt"),
      );
      const immutableFiles = site.files.filter((file) => !pageFiles.includes(file));
      for (const file of immutableFiles) {
        signal?.throwIfAborted();
        const destination = remotePath(config.root, file.path);
        await ensureRemoteDirectory(client, config.root, file.path);
        await assertRemoteParentWithin(client, canonicalRoot, config.root, file.path);
        if (!(await client.exists(destination)))
          await client.put(await fileBytes(site, file), destination);
      }
      const rootIndex = pageFiles.find((file) => file.path === "index.html");
      for (const file of pageFiles.filter((candidate) => candidate !== rootIndex)) {
        signal?.throwIfAborted();
        const destination = remotePath(config.root, file.path);
        const temporary = `${destination}.sad-${file.sha256.slice(0, 10)}.tmp`;
        await ensureRemoteDirectory(client, config.root, file.path);
        await assertRemoteParentWithin(client, canonicalRoot, config.root, file.path);
        await client.put(await fileBytes(site, file), temporary);
        await client.posixRename(temporary, destination);
      }
      const current = new Set(site.files.map((file) => file.path));
      for (const stale of previousFiles.filter((file) => !current.has(file.path))) {
        signal?.throwIfAborted();
        const destination = remotePath(config.root, stale.path);
        await assertRemoteParentWithin(client, canonicalRoot, config.root, stale.path);
        if (await client.exists(destination)) await client.delete(destination);
      }
      if (rootIndex) {
        signal?.throwIfAborted();
        const destination = remotePath(config.root, rootIndex.path);
        const temporary = `${destination}.sad-${rootIndex.sha256.slice(0, 10)}.tmp`;
        await assertRemoteParentWithin(client, canonicalRoot, config.root, rootIndex.path);
        await client.put(await fileBytes(site, rootIndex), temporary);
        await client.posixRename(temporary, destination);
      }
      return {
        deploymentId: createHash("sha256")
          .update(site.files.map((file) => file.sha256).join(""))
          .digest("hex"),
        deploymentUrl: target.base_url,
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      await client.end();
    }
  }
}

export function publicationAdapterFor(
  target: PublicationTargetRow,
  allowlist: string[],
): PublicationAdapter {
  if (target.adapter === "vercel") return new VercelAdapter();
  if (target.adapter === "netlify") return new NetlifyAdapter();
  return new SftpAdapter(allowlist);
}
