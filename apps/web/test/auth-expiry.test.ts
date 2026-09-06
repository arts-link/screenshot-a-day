import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../src/api";
import {
  AUTH_EXPIRED_EVENT,
  AUTH_EXPIRED_MESSAGE,
  authMessageFromState,
  redirectAfterSessionExpiry,
} from "../src/auth-expiry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session expiry handling", () => {
  it("redirects to Login with an actionable message and clears cached data", () => {
    const clear = vi.fn();
    const navigate = vi.fn();
    const from = { pathname: "/projects/project-1/compare", search: "?page=2", hash: "#latest" };

    redirectAfterSessionExpiry(navigate, clear, from);

    expect(clear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/login", {
      replace: true,
      state: { from, message: AUTH_EXPIRED_MESSAGE },
    });
    expect(authMessageFromState({ message: AUTH_EXPIRED_MESSAGE })).toBe(AUTH_EXPIRED_MESSAGE);
  });

  it("notifies the router when a protected request receives 401", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Authentication is required" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(request("/api/v1/projects")).rejects.toThrow("Authentication is required");
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: AUTH_EXPIRED_EVENT });
  });

  it("keeps bad login credentials on the Login route", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(request("/api/v1/auth/login", { method: "POST" })).rejects.toThrow(
      "Invalid email or password",
    );
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
