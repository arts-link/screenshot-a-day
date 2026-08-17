import { describe, expect, it } from "vitest";
import { headersForCaptureRequest } from "../src/capture.js";

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
