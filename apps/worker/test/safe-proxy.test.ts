import { createServer, get } from "node:http";
import { connect, createServer as createTcpServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeProxy } from "../src/safe-proxy.js";

const closeables: Array<{ close: (callback: (error?: Error) => void) => void }> = [];

afterEach(async () => {
  while (closeables.length) {
    const server = closeables.pop();
    if (!server) continue;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe("safe capture proxy", () => {
  it("connects to the vetted address without performing a second lookup", async () => {
    const target = createServer((_request, response) => response.end("pinned"));
    closeables.push(target);
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const port = (target.address() as AddressInfo).port;
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]);
    const proxy = await SafeProxy.start(["target.test"], lookup);

    try {
      const proxyUrl = new URL(proxy.url);
      const body = await new Promise<string>((resolve, reject) => {
        get(
          {
            hostname: proxyUrl.hostname,
            port: proxyUrl.port,
            path: `http://target.test:${port}/fixture`,
          },
          (response) => {
            let value = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => (value += chunk));
            response.on("end", () => resolve(value));
          },
        ).on("error", reject);
      });

      expect(body).toBe("pinned");
      expect(lookup).toHaveBeenCalledOnce();
    } finally {
      await proxy.close();
    }
  });

  it("pins CONNECT tunnels to the vetted address", async () => {
    const target = createTcpServer((socket) =>
      socket.on("data", (chunk) => socket.write(`echo:${chunk.toString()}`)),
    );
    closeables.push(target);
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const port = (target.address() as AddressInfo).port;
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]);
    const proxy = await SafeProxy.start(["target.test"], lookup);
    const proxyUrl = new URL(proxy.url);
    const client = connect(Number(proxyUrl.port), proxyUrl.hostname);

    try {
      const body = await new Promise<string>((resolve, reject) => {
        let response = "";
        client.on("error", reject);
        client.on("connect", () =>
          client.write(`CONNECT target.test:${port} HTTP/1.1\r\nHost: target.test:${port}\r\n\r\n`),
        );
        client.on("data", (chunk) => {
          response += chunk.toString();
          if (response.endsWith("\r\n\r\n")) client.write("ping");
          if (response.includes("echo:ping")) resolve(response);
        });
      });

      expect(body).toContain("200 Connection Established");
      expect(body).toContain("echo:ping");
      expect(lookup).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
      await proxy.close();
    }
  });

  it("refuses a destination whose resolved address is blocked", async () => {
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]);
    const proxy = await SafeProxy.start([], lookup);

    try {
      const proxyUrl = new URL(proxy.url);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get(
          {
            hostname: proxyUrl.hostname,
            port: proxyUrl.port,
            path: "http://target.test/fixture",
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        ).on("error", reject);
      });

      expect(status).toBe(403);
      expect(lookup).toHaveBeenCalledOnce();
    } finally {
      await proxy.close();
    }
  });
});
