import { describe, expect, it } from "vitest";
import { captureFailureMessage, headersForCaptureRequest } from "../src/capture.js";

describe("capture request headers", () => {
  const browserHeaders = {
    accept: "text/html",
    "user-agent": "playwright",
  };
  const captureHeaders = {
    Authorization: "Bearer capture-secret",
    "X-Capture-Key": "secret",
  };

  it("adds configured headers to requests on the capture origin", () => {
    expect(
      headersForCaptureRequest(
        "https://example.com/assets/app.js",
        "https://example.com",
        browserHeaders,
        captureHeaders,
      ),
    ).toEqual({
      ...browserHeaders,
      authorization: "Bearer capture-secret",
      "x-capture-key": "secret",
    });
  });

  it.each([
    "https://cdn.example.com/app.js",
    "https://example.com.evil.test/collect",
    "http://example.com/collect",
    "https://example.com:8443/collect",
  ])("does not add configured headers to another origin: %s", (requestUrl) => {
    expect(
      headersForCaptureRequest(requestUrl, "https://example.com", browserHeaders, captureHeaders),
    ).toBeUndefined();
  });

  it("overrides browser headers case-insensitively on the capture origin", () => {
    expect(
      headersForCaptureRequest(
        "https://example.com/",
        "https://example.com",
        { authorization: "browser-value" },
        { Authorization: "Bearer capture-secret" },
      ),
    ).toEqual({ authorization: "Bearer capture-secret" });
  });
});

describe("capture failure messages", () => {
  const profile = { waitForSelector: "#ready", timeoutMs: 30_000 };

  it("explains readiness selector timeouts", () => {
    expect(
      captureFailureMessage(new Error("Timeout 30000ms exceeded"), "readiness selector", profile),
    ).toBe('Readiness selector "#ready" was not visible within 30,000 ms.');
  });

  it("turns common navigation failures into actionable reasons", () => {
    expect(
      captureFailureMessage(
        new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://bad.test/?token=secret"),
        "navigation",
        profile,
      ),
    ).toBe("Navigation failed because the target hostname could not be resolved.");
  });

  it("redacts query strings from safe stage details", () => {
    expect(
      captureFailureMessage(
        new Error("unexpected response from https://example.com/private?token=secret"),
        "result upload",
        profile,
      ),
    ).toBe("Result upload failed: unexpected response from https://example.com/private");
  });
});
