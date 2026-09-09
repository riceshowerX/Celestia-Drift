import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import {
  assertSameSiteRequest,
  CrossSiteRequestError,
} from "../auth/isolation.server.ts";
import { env, isWorkspacePreview } from "../env.server.ts";
import { assertAppDataServerOnly } from "./server-only.ts";
import {
  CONNECTOR_TOKEN_HEADER,
  CONNECTOR_TOKEN_PENDING_CODE,
  ConnectorType,
  type CallToolOptions,
  type CallToolResult,
  type ToolArgs,
} from "./types.ts";

assertAppDataServerOnly("app-data/client.server");

export const CONNECTORS_HOST_STAGING = "connectors.app-builder-testing.com";
export const CONNECTORS_HOST_PROD = "connectors.grok.me";

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

type InboundContext = {
  token: string | null;
  publicHost: string | null;
  connectorsBase: string | null;
};

function connectorsBaseFor(publicHost: string | null): string | null {
  const explicit = env("GROK_CONNECTORS_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = publicHost?.toLowerCase();
  if (!host || isLoopbackHost(host)) return null;
  if (
    host === "app-builder-testing.com" ||
    host.endsWith(".app-builder-testing.com")
  ) {
    return `https://${CONNECTORS_HOST_STAGING}`;
  }
  if (host === "grok.me" || host.endsWith(".grok.me")) {
    return `https://${CONNECTORS_HOST_PROD}`;
  }
  return null;
}

function tryGetRequest(): Request | null {
  try {
    return getRequest() ?? null;
  } catch {
    return null;
  }
}

/**
 * Header-host validation (#66): `x-forwarded-host` / `host` are forwarded to
 * the gate and used to derive `publicHost` (which also feeds `gateSigninUrl`).
 * Unvalidated, a crafted header could smuggle arbitrary content into the
 * gate's view of "which app is calling". Allow only plausible hostname
 * characters (alnum, dot, hyphen, colon for ports, brackets for IPv6);
 * anything else is treated as absent.
 */
function sanitizeHeaderHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase();
  if (!host || !/^[a-z0-9.:\-[\]]+$/.test(host)) return null;
  return host;
}

function inboundContext(): InboundContext {
  const req = tryGetRequest();
  const xf = sanitizeHeaderHost(
    req?.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
  );
  const publicHost =
    (xf || sanitizeHeaderHost(req?.headers.get("host")))?.split(":")[0]?.trim() ||
    null;
  const headerToken = req?.headers.get(CONNECTOR_TOKEN_HEADER)?.trim() || null;
  const envToken =
    process.env.NODE_ENV === "production"
      ? null
      : (env("GROK_CONNECTOR_ACCESS_TOKEN") ?? null);
  return {
    token: headerToken ?? envToken,
    publicHost,
    connectorsBase: connectorsBaseFor(publicHost),
  };
}

export function resolveGateAppDataBase(): string | null {
  return inboundContext().connectorsBase;
}

export function getConnectorAccessToken(): string | null {
  return inboundContext().token;
}

export { isWorkspacePreview } from "../env.server.ts";

// Digests of preview tokens the gate answered 401 for, with an expiry (#62).
// Previously a SINGLE module-level digest: two tenants alternating 401s would
// overwrite each other's entry, letting a still-rejected token look ready
// again. A Map keyed by token digest with a short TTL keeps tenants isolated
// and self-cleans.
const REJECTED_TOKEN_TTL_MS = 60_000;
const rejectedTokens = new Map<string, number>();

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function pruneRejectedTokens(): void {
  const now = Date.now();
  for (const [digest, expiry] of rejectedTokens) {
    if (expiry <= now) rejectedTokens.delete(digest);
  }
}

function noteTokenRejected(token: string): void {
  pruneRejectedTokens();
  rejectedTokens.set(tokenDigest(token), Date.now() + REJECTED_TOKEN_TTL_MS);
}

function noteTokenAccepted(token: string): void {
  rejectedTokens.delete(tokenDigest(token));
}

/**
 * True when the inbound request carries a connector token the gate has not
 * rejected. This is what the preview readiness probe reports; it never calls
 * the gate.
 */
export function isConnectorTokenReady(): boolean {
  const token = inboundContext().token;
  if (token === null) return false;
  pruneRejectedTokens();
  return !rejectedTokens.has(tokenDigest(token));
}

type GateJson = {
  ok?: boolean;
  data?: unknown;
  errorMessage?: string;
  loginUrl?: string;
};

async function gatePost(
  ctx: InboundContext,
  body: Record<string, unknown>,
  token: string,
): Promise<{ status: number; json: GateJson }> {
  const base = ctx.connectorsBase;
  if (!base) {
    throw new Error(
      "cannot resolve gate host (missing x-forwarded-host/host on the server request); " +
        "open the app through the gated public URL so the gate can proxy and inject credentials",
    );
  }

  if (!/^https?:\/\//i.test(base)) {
    throw new Error(
      `gate base must be absolute http(s) URL (got ${base}); refusing relative fetch`,
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${token}`,
  };
  if (ctx.publicHost) {
    headers["x-forwarded-host"] = ctx.publicHost;
  }

  const res = await fetch(`${base}/call-tool`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
    // Hard ceiling: a hung gate (half-open TCP, stalled response) must not pin
    // this server function until the platform timeout — a few concurrent
    // hangs would exhaust function concurrency and take down the whole app.
    signal: AbortSignal.timeout(15_000),
  });

  let json: GateJson = {};
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as GateJson;
    } catch {
      json = {
        ok: false,
        errorMessage: `gate non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`,
      };
    }
  }

  return { status: res.status, json };
}

function gateSigninUrl(ctx: InboundContext): string | undefined {
  const base = ctx.connectorsBase;
  if (!base) return undefined;
  try {
    const connectorsHost = new URL(base).host.toLowerCase();
    const gateHost = connectorsHost.replace(/^connectors\./, "gate.");
    if (gateHost === connectorsHost) return undefined;
    const publicHost = ctx.publicHost?.toLowerCase();
    const gated =
      publicHost && !isLoopbackHost(publicHost)
        ? `https://${publicHost}`
        : undefined;
    const signin = `https://${gateHost}/__gate/signin`;
    return gated
      ? `${signin}?return_to=${encodeURIComponent(gated)}`
      : signin;
  } catch {
    return undefined;
  }
}

/**
 * Validate a gate-supplied `loginUrl` BEFORE it can reach a browser navigation.
 *
 * ⚠️ SECURITY: `json.loginUrl` is a remote gate response field, i.e. input from
 * outside the trust boundary. Without this check a polluted/tampered gate (or
 * simply a misbehaving one) could hand the client a `javascript:` URL (XSS) or
 * an arbitrary `https://evil.example` redirect (open redirect / phishing).
 * Rules: `https:` only — except `http:` on a loopback host (local dev) — and
 * the host MUST be this app's own gate host (derived from the resolved
 * connectors base, same derivation as `gateSigninUrl`). Anything else is
 * dropped: the caller falls back to a login-required result without a URL.
 */
function safeLoginUrl(raw: string, ctx: InboundContext): string | undefined {
  const base = ctx.connectorsBase;
  if (!base) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const loopback = isLoopbackHost(host);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      return undefined;
    }
    const connectorsHost = new URL(base).hostname.toLowerCase();
    const gateHost = connectorsHost.replace(/^connectors\./, "gate.");
    if (!gateHost || gateHost === connectorsHost) return undefined;
    if (host !== gateHost) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const PENDING_TOKEN_MISSING =
  "the preview has not received the connector token yet; it arrives once " +
  "the connector grant is approved";
const PENDING_TOKEN_REJECTED =
  "the gate rejected the current preview token; the preview panel pushes a " +
  "fresh one on its own schedule";

function pendingTokenResult(reason: string): CallToolResult {
  return {
    ok: false,
    data: null,
    pending: true,
    errorMessage: `${CONNECTOR_TOKEN_PENDING_CODE}: ${reason}`,
  };
}

// Deployed apps only reach here when the request bypassed the gate (the gate
// injects the token on every proxied request), so a sign-in redirect cannot
// fix it: no loginRequired / loginUrl.
function missingAuthResult(): CallToolResult {
  if (isWorkspacePreview()) return pendingTokenResult(PENDING_TOKEN_MISSING);
  return {
    ok: false,
    data: null,
    errorMessage:
      "missing_connector_token: open this app through the edge gate " +
      "(the server must receive x-connector-access-token on the inbound request)",
  };
}

function unauthorizedResult(
  ctx: InboundContext,
  json: GateJson,
  token: string,
): CallToolResult {
  if (isWorkspacePreview()) {
    noteTokenRejected(token);
    return pendingTokenResult(PENDING_TOKEN_REJECTED);
  }
  const loginUrl =
    gateSigninUrl(ctx) ??
    (typeof json.loginUrl === "string" && json.loginUrl
      ? safeLoginUrl(json.loginUrl, ctx)
      : undefined);
  return {
    ok: false,
    data: null,
    loginRequired: true,
    errorMessage: json.errorMessage ?? "login required",
    ...(loginUrl ? { loginUrl } : {}),
  };
}

function crossSiteBlockedResult(): CallToolResult | null {
  try {
    assertSameSiteRequest();
    return null;
  } catch (e) {
    if (e instanceof CrossSiteRequestError) {
      return { ok: false, data: null, errorMessage: e.message };
    }
    return null;
  }
}

const FAILURE_MEMO_TTL_MS = 5_000;
// Hard cap (#65): entries are otherwise evicted only lazily on read/write of
// the same or newer keys; a burst of unique failures (e.g. token churn) could
// grow the map unbounded between sweeps. Past the cap, drop the oldest
// entries (Map preserves insertion order) — failures are a safety net, not
// state worth defending.
const FAILURE_MEMO_MAX_ENTRIES = 1_000;
const failureMemo = new Map<string, { at: number; result: CallToolResult }>();

function tokenIdentityKey(token: string): string {
  const payload = token.split(".")[1];
  if (payload) {
    // ⚠️ UNVERIFIED JWT PARSE (#63): the payload is decoded WITHOUT signature
    // verification and MUST NEVER be trusted for authorization. The extracted
    // (sub, team_id) feed a one-way SHA-256 that is used ONLY as a cache/memo
    // key (and never logged or returned) — authenticity comes exclusively
    // from the gate verifying the token server-side. Any new use of these
    // claims must go through a verified signature check instead.
    try {
      const claims: unknown = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      if (claims && typeof claims === "object" && !Array.isArray(claims)) {
        const { sub, team_id: teamId } = claims as {
          sub?: unknown;
          team_id?: unknown;
        };
        if (typeof sub === "string" && sub) {
          return createHash("sha256")
            .update(
              JSON.stringify([sub, typeof teamId === "string" ? teamId : null]),
            )
            .digest("base64url");
        }
      }
    } catch {
      // Malformed payload b64/JSON: fall through to the opaque digest below.
    }
  }
  return createHash("sha256").update(token).digest("base64url");
}

function memoizedFailure(key: string | null): CallToolResult | null {
  if (!key) return null;
  const hit = failureMemo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > FAILURE_MEMO_TTL_MS) {
    failureMemo.delete(key);
    return null;
  }
  return hit.result;
}

function memoizeFailure(
  key: string | null,
  result: CallToolResult,
): CallToolResult {
  if (!key) return result;
  const now = Date.now();
  // Time-based eviction (#65): sweep expired entries on every write, then
  // enforce the hard size cap by dropping oldest-first.
  for (const [staleKey, entry] of failureMemo) {
    if (now - entry.at > FAILURE_MEMO_TTL_MS) failureMemo.delete(staleKey);
  }
  while (failureMemo.size >= FAILURE_MEMO_MAX_ENTRIES) {
    const oldest = failureMemo.keys().next().value;
    if (oldest === undefined) break;
    failureMemo.delete(oldest);
  }
  failureMemo.set(key, { at: now, result });
  return result;
}

export function failureMemoSize(): number {
  return failureMemo.size;
}

function safeMemoKey(parts: unknown[]): string | null {
  try {
    return JSON.stringify(parts);
  } catch {
    return null;
  }
}

function nonPostBlockedResult(): CallToolResult | null {
  const req = tryGetRequest();
  if (!req || req.method === "POST") return null;
  return {
    ok: false,
    data: null,
    errorMessage:
      `blocked ${req.method} inbound request: connector calls must run inside ` +
      'a createServerFn({ method: "POST" }) handler',
  };
}

export async function callTool(
  toolName: string,
  args: ToolArgs,
  options: CallToolOptions,
): Promise<CallToolResult> {
  const blocked = crossSiteBlockedResult() ?? nonPostBlockedResult();
  if (blocked) return blocked;

  const ctx = inboundContext();
  const token = options.token ?? ctx.token;
  if (!token) {
    return missingAuthResult();
  }

  const connectorType = options.connectorType;
  if (!connectorType) {
    return {
      ok: false,
      data: null,
      errorMessage:
        "connectorType is required: pass the connector type granted to this app " +
        "(e.g. { connectorType: ConnectorType.GoogleDrive })",
    };
  }

  const memoKey = safeMemoKey([
    toolName,
    args,
    connectorType,
    options?.connectorCatalogId ?? null,
    tokenIdentityKey(token),
  ]);
  const memoized = memoizedFailure(memoKey);
  if (memoized) {
    return memoized;
  }
  const fail = (errorMessage: string): CallToolResult =>
    memoizeFailure(memoKey, { ok: false, data: null, errorMessage });
  if (connectorType === ConnectorType.Mcp && !options?.connectorCatalogId) {
    return {
      ok: false,
      data: null,
      errorMessage: "connectorCatalogId is required when connectorType is Mcp",
    };
  }

  try {
    const { status, json } = await gatePost(
      ctx,
      {
        host: ctx.publicHost ?? undefined,
        connector_type: connectorType,
        tool_name: toolName,
        arguments: args,
        connector_catalog_id: options.connectorCatalogId,
      },
      token,
    );

    if (status === 401) {
      return unauthorizedResult(ctx, json, token);
    }
    noteTokenAccepted(token);
    if (status === 403) {
      return fail(json.errorMessage ?? "access_denied");
    }
    if (json.errorMessage && json.ok === false) {
      return fail(json.errorMessage);
    }
    if (status >= 400 && json.ok !== true) {
      return fail(json.errorMessage ?? `HTTP ${status}`);
    }
    if (json.ok === false) {
      return fail(json.errorMessage ?? "tool error");
    }
    return { ok: true, data: json.data ?? null };
  } catch (e) {
    // Log before mapping: without this, network failures / bugs were invisible
    // in production (the client only sees a generic error message).
    console.warn("[app-data] gate call failed:", e);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export {
  ConnectorType,
  GoogleCalendarTools,
  GoogleDriveTools,
  CONNECTOR_TOKEN_HEADER,
} from "./types.ts";
export type {
  CallToolResult,
  CallToolOptions,
  ToolArgs,
  ConnectorTypeName,
} from "./types.ts";
export { isLoginRequired, redirectToLoginIfRequired } from "./login.ts";
