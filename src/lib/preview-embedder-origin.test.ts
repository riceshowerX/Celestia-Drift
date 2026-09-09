import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isGrokEmbedderOrigin,
  isSandboxPreviewGuestHost,
  resolveParentEmbedderOrigin,
} from "./preview-embedder-origin.ts";

describe("resolveParentEmbedderOrigin", () => {
  it("returns null when the page is top-level (parent is self)", () => {
    assert.equal(
      resolveParentEmbedderOrigin(true, "https://grok.com", "https://grok.com", "grok-sandbox.com"),
      null,
    );
  });

  it("allows a parent on grok.com via referrer", () => {
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://grok.com/panel", null, "grok-sandbox.com"),
      "https://grok.com",
    );
  });

  it("allows a parent on a grok.com subdomain via ancestorOrigins", () => {
    assert.equal(
      resolveParentEmbedderOrigin(false, "", "https://app.grok.com", "abc.preview.grok-sandbox.com"),
      "https://app.grok.com",
    );
  });

  it("allows the exact remint preview pairing derived from the guest host", () => {
    // guest = "<label>.preview.<rest>"; parent must be <rest> or grok.<rest>.
    assert.equal(
      resolveParentEmbedderOrigin(
        false,
        "https://grok.grok-sandbox.com",
        null,
        "abc.preview.grok-sandbox.com",
      ),
      "https://grok.grok-sandbox.com",
    );
    assert.equal(
      resolveParentEmbedderOrigin(
        false,
        "",
        "https://grok-sandbox.com",
        "abc.preview.grok-sandbox.com",
      ),
      "https://grok-sandbox.com",
    );
  });

  it("rejects a lookalike parent that does not match the remint pairing", () => {
    // Wrong label count / wrong rest: not the structural pair.
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://evil.com", null, "abc.preview.grok-sandbox.com"),
      null,
    );
    assert.equal(
      resolveParentEmbedderOrigin(
        false,
        "https://grok-sandbox.com.evil.com",
        null,
        "abc.preview.grok-sandbox.com",
      ),
      null,
    );
    // A sandbox guest on its own authorizes nothing.
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://grok-sandbox.com", null, "grok-sandbox.com"),
      null,
    );
  });

  it("rejects an arbitrary malicious parent origin", () => {
    assert.equal(resolveParentEmbedderOrigin(false, "https://evil.com", null, ""), null);
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://evil.com", null, "abc.preview.grok-sandbox.com"),
      null,
    );
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://attacker.grok.com.evil.io", null, ""),
      null,
    );
  });

  it("allows a loopback parent only when the guest itself is loopback", () => {
    assert.equal(
      resolveParentEmbedderOrigin(false, "http://localhost:3000", null, "localhost"),
      "http://localhost:3000",
    );
    assert.equal(
      resolveParentEmbedderOrigin(false, "http://127.0.0.1:5173", null, "127.0.0.1"),
      "http://127.0.0.1:5173",
    );
    // Loopback parent framing a remote sandbox guest is NOT trusted.
    assert.equal(
      resolveParentEmbedderOrigin(false, "http://localhost:3000", null, "grok-sandbox.com"),
      null,
    );
  });

  it("prefers referrer and falls back to ancestorOrigins", () => {
    // Malicious referrer, trusted ancestor: the loop iterates both candidates.
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://evil.com", "https://grok.com", ""),
      "https://grok.com",
    );
    // Trusted referrer wins even when ancestor is junk.
    assert.equal(
      resolveParentEmbedderOrigin(false, "https://grok.com", "https://evil.com", ""),
      "https://grok.com",
    );
  });

  it("returns null for garbage or empty candidates", () => {
    assert.equal(resolveParentEmbedderOrigin(false, "", null, "localhost"), null);
    assert.equal(resolveParentEmbedderOrigin(false, "not a url", null, "localhost"), null);
    assert.equal(resolveParentEmbedderOrigin(false, "javascript:alert(1)", null, "localhost"), null);
    assert.equal(resolveParentEmbedderOrigin(false, "ftp://grok.com", null, "localhost"), null);
  });

  it("accepts scheme-less candidates by assuming https", () => {
    assert.equal(
      resolveParentEmbedderOrigin(false, "grok.com", null, "grok-sandbox.com"),
      "https://grok.com",
    );
  });
});

describe("isGrokEmbedderOrigin", () => {
  it("accepts grok.com and its subdomains over https/http", () => {
    assert.equal(isGrokEmbedderOrigin("https://grok.com"), true);
    assert.equal(isGrokEmbedderOrigin("https://app.grok.com"), true);
    assert.equal(isGrokEmbedderOrigin("http://localhost:8080"), true);
  });

  it("rejects lookalikes, other schemes and garbage", () => {
    assert.equal(isGrokEmbedderOrigin("https://grok.com.evil.io"), false);
    assert.equal(isGrokEmbedderOrigin("https://evil-grok.com"), false);
    assert.equal(isGrokEmbedderOrigin("javascript:alert(1)"), false);
    assert.equal(isGrokEmbedderOrigin("not a url"), false);
    assert.equal(isGrokEmbedderOrigin(""), false);
  });
});

describe("isSandboxPreviewGuestHost", () => {
  it("matches the sandbox host and its subdomains", () => {
    assert.equal(isSandboxPreviewGuestHost("grok-sandbox.com"), true);
    assert.equal(isSandboxPreviewGuestHost("abc.preview.grok-sandbox.com"), true);
  });

  it("rejects lookalikes", () => {
    assert.equal(isSandboxPreviewGuestHost("grok-sandbox.com.evil.io"), false);
    assert.equal(isSandboxPreviewGuestHost("evilsandbox.com"), false);
    assert.equal(isSandboxPreviewGuestHost(""), false);
  });
});
