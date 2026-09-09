/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`). When the platform
 * injects `GROK_PREVIEW_CLIENT_SECRET` (or a per-app `GROK_AUTH_*` pair) the
 * live preview does REAL sign-in — no demo/mock users. When deployed the
 * deployer injects a per-app `GROK_AUTH_*` that overrides these (see
 * `server.ts`).
 *
 * SERVER-ONLY enforcement: the `.server.ts` suffix is the project convention for
 * modules that must never reach the client bundle. This module reads a client
 * secret, so it must only be imported from `./server.ts`, which itself is only
 * reached from server-only paths (`popup.server.ts`, `verify.server.ts`).
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/**
 * ⚠️ SECURITY — shared preview client secret.
 *
 * Read exclusively from `GROK_PREVIEW_CLIENT_SECRET`; this repository ships
 * NO baked-in credential (it is open source — anything committed here would be
 * public forever). When the variable is absent, `authConfigured` in
 * `./server.ts` is false and auth degrades gracefully to the dev-user mode.
 * Platform deployments inject the variable (or a per-app `GROK_AUTH_*` pair);
 * self-hosters should register their own OAuth client with their broker and
 * pass `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET` instead.
 */
export const PREVIEW_CLIENT_SECRET =
  process.env.GROK_PREVIEW_CLIENT_SECRET?.trim() || undefined;

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
