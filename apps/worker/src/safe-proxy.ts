import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { resolveSafeUrl, type NetworkLookup } from "@sad/core";

function respondWithError(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export class SafeProxy {
  private constructor(
    private readonly server: Server,
    readonly url: string,
  ) {}

  static async start(allowlist: string[], lookup?: NetworkLookup): Promise<SafeProxy> {
    const server = createServer(async (request, response) => {
      try {
        if (!request.url) throw new Error("Proxy request omitted its URL");
        const target = await resolveSafeUrl(request.url, allowlist, lookup);
        if (target.url.protocol !== "http:") {
          response.writeHead(400).end();
          return;
        }
        const destination = target.addresses[0];
        if (!destination) throw new Error("Target hostname did not resolve");
        const upstream = httpRequest({
          hostname: destination.address,
          family: destination.family,
          port: target.url.port ? Number(target.url.port) : 80,
          method: request.method,
          path: `${target.url.pathname}${target.url.search}`,
          headers: { ...request.headers, host: target.url.host },
        });
        upstream.on("response", (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.statusMessage,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        });
        upstream.on("error", () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(upstream);
      } catch {
        response.writeHead(403).end();
      }
    });

    server.on("connect", async (request, client, head) => {
      try {
        if (!request.url) throw new Error("CONNECT request omitted its authority");
        const authority = new URL(`https://${request.url}`);
        const target = await resolveSafeUrl(authority.toString(), allowlist, lookup);
        const destination = target.addresses[0];
        if (!destination) throw new Error("Target hostname did not resolve");
        const upstream = connect({
          host: destination.address,
          family: destination.family,
          port: target.url.port ? Number(target.url.port) : 443,
        });
        upstream.once("connect", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.once("error", () => respondWithError(client, 502, "Bad Gateway"));
        client.once("error", () => upstream.destroy());
      } catch {
        respondWithError(client, 403, "Forbidden");
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    return new SafeProxy(server, `http://127.0.0.1:${address.port}`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
