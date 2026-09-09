export function isGrokEmbedderOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "grok.com" || host.endsWith(".grok.com")) return true;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
    return false;
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function isSandboxPreviewGuestHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}

function isRemintPreviewPair(guestHost: string, parentHost: string): boolean {
  const guest = guestHost.toLowerCase();
  const parent = parentHost.toLowerCase();
  const sep = ".preview.";
  const i = guest.indexOf(sep);
  if (i <= 0) return false;
  const label = guest.slice(0, i);
  const rest = guest.slice(i + sep.length);
  if (label.includes(".") || !rest.includes(".")) return false;
  return parent === rest || parent === `grok.${rest}`;
}

/**
 * Resolve the origin allowed to frame this page (and to postMessage it), or
 * null when no candidate is trusted.
 *
 * ⚠️ SECURITY: being EMBEDDED does not make the embedder trusted. Every
 * candidate parent origin must pass a strict allowlist:
 *   1. a parent on a `grok.com` domain (the real host panel);
 *   2. the exact sandbox/remint preview pairing derived from OUR guest host
 *      (`isRemintPreviewPair` — structural, label-checked);
 *   3. a loopback parent, but ONLY when the guest itself is loopback
 *      (local-dev embedding).
 * A sandbox guest host on its own authorizes nothing: without this rule any
 * website could iframe a `*.grok-sandbox.com` preview and drive its
 * navigation while receiving location/route reports (origin-spoof by
 * construction).
 */
export function resolveParentEmbedderOrigin(
  parentIsSelf: boolean,
  referrer: string,
  ancestorOrigin?: string | null,
  guestHostname: string = "",
): string | null {
  if (parentIsSelf) return null;
  for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) {
    try {
      const url = new URL(
        candidate.includes("://") ? candidate : `https://${candidate}`,
      );
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const parentHost = url.hostname.toLowerCase();
      if (parentHost === "grok.com" || parentHost.endsWith(".grok.com")) {
        return url.origin;
      }
      if (isRemintPreviewPair(guestHostname, parentHost)) return url.origin;
      if (isLoopbackHost(parentHost) && isLoopbackHost(guestHostname)) {
        return url.origin;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
