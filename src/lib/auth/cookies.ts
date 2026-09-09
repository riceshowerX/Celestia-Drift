/**
 * Shared `Cookie` header parsing for the auth layer (#45/#46).
 *
 * Previously `popup.server.ts` and `gate-session.server.ts` each hand-rolled
 * their own splitting of the `Cookie` header with subtly different edge-case
 * behavior (quoting, `=` inside values, duplicates). Both now go through this
 * single parser.
 *
 * Values are returned RAW (no decode) — call sites decide whether/how to
 * decode, so this stays behavior-preserving for callers that must rebuild or
 * compare raw header bytes.
 */
export function parseCookieHeader(
  header: string | null | undefined,
): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue; // no value / empty name — not a usable pair
    const name = trimmed.slice(0, eq);
    const raw = trimmed.slice(eq + 1);
    // RFC 6265: first occurrence of a name wins.
    if (cookies.has(name)) continue;
    cookies.set(name, raw);
  }
  return cookies;
}

/**
 * Read one cookie from a raw `Cookie` header, percent-decoded, or null.
 * Replacement for the per-file `readCookie` implementations.
 */
export function readCookieValue(
  header: string | null | undefined,
  name: string,
): string | null {
  const raw = parseCookieHeader(header).get(name);
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // keep the raw value when it is not valid percent-encoding
  }
}
