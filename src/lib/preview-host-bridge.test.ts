import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeBridgePath } from "./preview-host-bridge.ts";

/**
 * isSafeBridgePath is the FIRST gate of host-driven navigation (the second is
 * the same-origin check on the resolved URL). Any non-same-origin target —
 * absolute URLs, protocol-relative hosts, backslash trickery — must be
 * rejected so a compromised host panel cannot turn the guest into an open
 * redirector.
 */
describe("isSafeBridgePath", () => {
  it("accepts normal in-app relative paths", () => {
    assert.equal(isSafeBridgePath("/"), true);
    assert.equal(isSafeBridgePath("/dashboard"), true);
    assert.equal(isSafeBridgePath("/a/b/c"), true);
    assert.equal(isSafeBridgePath("/items?tab=2&page=1"), true);
    assert.equal(isSafeBridgePath("/items?tab=2#anchor"), true);
  });

  it("accepts encoded-but-same-origin paths", () => {
    // Percent-encoding inside the path never changes the ORIGIN.
    assert.equal(isSafeBridgePath("/a%20b"), true);
    assert.equal(isSafeBridgePath("/search/%E6%98%9F%E7%A9%BA"), true);
  });

  it("rejects absolute URLs", () => {
    assert.equal(isSafeBridgePath("https://evil.com"), false);
    assert.equal(isSafeBridgePath("http://evil.com/path"), false);
    assert.equal(isSafeBridgePath("https://grok.com"), false);
  });

  it("rejects protocol-relative hosts", () => {
    assert.equal(isSafeBridgePath("//evil.com"), false);
    assert.equal(isSafeBridgePath("//evil.com/path"), false);
  });

  it("rejects backslash and mixed-separator bypasses", () => {
    assert.equal(isSafeBridgePath("\\\\evil.com"), false);
    assert.equal(isSafeBridgePath("/\\evil.com"), false);
    assert.equal(isSafeBridgePath("/path\\..\\..\\evil"), false);
  });

  it("rejects scheme-relative and pseudo-scheme payloads", () => {
    assert.equal(isSafeBridgePath("javascript:alert(1)"), false);
    assert.equal(isSafeBridgePath("data:text/html,<script>"), false);
    assert.equal(isSafeBridgePath("javascript%3Aalert(1)"), false);
  });

  it("rejects anything that is not a rooted path", () => {
    assert.equal(isSafeBridgePath(""), false);
    assert.equal(isSafeBridgePath("relative/path"), false);
    assert.equal(isSafeBridgePath(" ../escape"), false);
    assert.equal(isSafeBridgePath("https:%2F%2Fevil.com"), false);
  });
});
