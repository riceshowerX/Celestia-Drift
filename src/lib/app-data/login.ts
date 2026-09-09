import type { CallToolResult } from "./types.ts";

export function isLoginRequired(result: CallToolResult): boolean {
  return result.ok === false && result.loginRequired === true;
}

export function isConnectorPending(result: CallToolResult): boolean {
  return result.ok === false && result.pending === true;
}

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Client-side deep defense for navigation targets (the server already applies
 * the strict host allowlist in `client.server.ts`). Rejects non-http(s)
 * schemes — notably `javascript:` (XSS) — and non-loopback `http:`.
 */
function isSafeLoginTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const loopback =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback);
  } catch {
    return false;
  }
}

export function redirectToLoginIfRequired(result: CallToolResult): boolean {
  if (!isLoginRequired(result)) return false;
  const url = result.loginUrl;
  if (!url) return false;
  // Never navigate to an unvalidated remote URL — see `isSafeLoginTarget`.
  if (!isSafeLoginTarget(url)) return false;
  if (typeof window === "undefined") return false;
  if (isFramed()) {
    const opened = window.open(url, "_blank");
    if (opened) {
      opened.opener = null;
      return true;
    }
  }
  window.location.assign(url);
  return true;
}
