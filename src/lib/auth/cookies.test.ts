import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCookieHeader, readCookieValue } from "./cookies.ts";

describe("parseCookieHeader", () => {
  it("returns an empty map for missing or empty headers", () => {
    assert.equal(parseCookieHeader(null).size, 0);
    assert.equal(parseCookieHeader(undefined).size, 0);
    assert.equal(parseCookieHeader("").size, 0);
    assert.equal(parseCookieHeader("   ").size, 0);
  });

  it("parses simple pairs", () => {
    const cookies = parseCookieHeader("a=b; c=d");
    assert.equal(cookies.get("a"), "b");
    assert.equal(cookies.get("c"), "d");
    assert.equal(cookies.size, 2);
  });

  it("trims whitespace around each cookie segment", () => {
    // Only the segment edges are trimmed: the first '=' splits, and the name
    // / value are kept RAW beyond that (a header "a = b" yields name "a "
    // and value " b") — callers must not rely on inner-space stripping.
    const cookies = parseCookieHeader("  a=b  ;  c=d  ");
    assert.equal(cookies.get("a"), "b");
    assert.equal(cookies.get("c"), "d");
  });

  it("keeps everything after the first '=' as the raw value", () => {
    const cookies = parseCookieHeader("token=abc=def; x=1");
    assert.equal(cookies.get("token"), "abc=def");
    assert.equal(cookies.get("x"), "1");
  });

  it("returns values RAW (no percent-decoding)", () => {
    const cookies = parseCookieHeader("enc=a%20b");
    assert.equal(cookies.get("enc"), "a%20b");
  });

  it("lets the first occurrence of a name win (RFC 6265)", () => {
    const cookies = parseCookieHeader("sid=first; sid=second");
    assert.equal(cookies.get("sid"), "first");
    assert.equal(cookies.size, 1);
  });

  it("skips unusable segments: empty name, missing '=', empty parts", () => {
    const cookies = parseCookieHeader("novalue; =orphan; a=b;; c=d; =");
    assert.equal(cookies.get("novalue"), undefined);
    assert.equal(cookies.get("a"), "b");
    assert.equal(cookies.get("c"), "d");
    assert.equal(cookies.size, 2);
  });

  it("keeps quoted values as-is (caller decides decoding)", () => {
    const cookies = parseCookieHeader('q="wrapped value"');
    assert.equal(cookies.get("q"), '"wrapped value"');
  });
});

describe("readCookieValue", () => {
  it("reads a cookie and percent-decodes it", () => {
    assert.equal(readCookieValue("sid=a%20b%2Fc", "sid"), "a b/c");
    assert.equal(readCookieValue("a=1; sid=xyz", "sid"), "xyz");
  });

  it("returns null when the cookie is absent or the header is missing", () => {
    assert.equal(readCookieValue("a=1", "sid"), null);
    assert.equal(readCookieValue("", "sid"), null);
    assert.equal(readCookieValue(null, "sid"), null);
    assert.equal(readCookieValue(undefined, "sid"), null);
  });

  it("falls back to the raw value when it is not valid percent-encoding", () => {
    // "%" alone is not decodable — must not throw.
    assert.equal(readCookieValue("bad=100%", "bad"), "100%");
    assert.equal(readCookieValue("bad=%zz", "bad"), "%zz");
  });

  it("decodes only the matched cookie's value", () => {
    assert.equal(readCookieValue("a=%2F; b=plain", "b"), "plain");
  });
});
