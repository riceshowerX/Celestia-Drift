import {
  importJWK,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { env, isWorkspacePreview } from "../env.server.ts";

export const GATE_IDENTITY_HEADER = "x-grok-identity";
export const GATE_JWKS_PATH = "/__gate/identity-key";

const JWKS_CACHE_TTL_MS = 300_000;
// Negative cache: when a fetched JWKS still does not contain the token's kid,
// block further JWKS fetches for this window. Without it, an attacker can send
// tokens with random kids and get one outbound JWKS fetch PER REQUEST — a
// 1:1 amplification into an outbound DoS against the gate (see #35).
const JWKS_NEGATIVE_TTL_MS = 30_000;
const PREVIEW_AUDIENCE = "preview";
export const PREVIEW_GATE_ORIGIN = "http://127.0.0.1:6014";
const FALLBACK_EMAIL_DOMAIN = "viewer.grok.invalid";
const FALLBACK_NAME = "Grok user";

export type GateIdentity = {
  sub: string;
  email: string | null;
  name: string | null;
  teamId: string | null;
};

export type GateJwks = { keys: JWK[] };

export type JwksFetch = (url: string) => Promise<GateJwks | null>;

export function gateIdentityEnabled(): boolean {
  // NOTE (#48): `VITE_*` on the server is a known wart (see server.ts) — kept
  // because the deployer provisions auth with exactly this key.
  return env("VITE_AUTH_ENABLED") !== "false";
}

export function gateTokenAudience(): string {
  if (isWorkspacePreview()) return PREVIEW_AUDIENCE;
  return `app:${env("GROK_PROJECT_ID")}`;
}

async function defaultJwksFetch(url: string): Promise<GateJwks | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as GateJwks;
    return Array.isArray(body?.keys) ? body : null;
  } catch {
    return null;
  }
}

const jwksCache = new Map<string, { jwks: GateJwks; fetchedAt: number }>();
/** url -> timestamp until which JWKS fetches are suppressed (negative cache). */
const jwksNegativeUntil = new Map<string, number>();
/** url -> in-flight JWKS fetch, so concurrent misses share one request. */
const jwksInflight = new Map<string, Promise<GateJwks | null>>();

/**
 * Fetch the JWKS with in-flight merging (no cache stampede under concurrency)
 * and negative-cache suppression (no unbounded outbound fetch amplification
 * from attacker-chosen token kids).
 */
function loadJwks(url: string, jwksFetch: JwksFetch): Promise<GateJwks | null> {
  const blockedUntil = jwksNegativeUntil.get(url) ?? 0;
  if (Date.now() < blockedUntil) return Promise.resolve(null);
  let pending = jwksInflight.get(url);
  if (!pending) {
    pending = jwksFetch(url).finally(() => {
      jwksInflight.delete(url);
    });
    jwksInflight.set(url, pending);
  }
  return pending;
}

export function gateKeyResolver(
  url: string,
  jwksFetch: JwksFetch = defaultJwksFetch,
): JWTVerifyGetKey {
  return async (protectedHeader) => {
    const kid =
      typeof protectedHeader.kid === "string" ? protectedHeader.kid : undefined;
    const findKey = (jwks: GateJwks): JWK | undefined =>
      jwks.keys.find(
        (k) =>
          k.kty === "OKP" && k.crv === "Ed25519" && (!kid || k.kid === kid),
      );

    let entry = jwksCache.get(url);
    if (!entry || Date.now() - entry.fetchedAt > JWKS_CACHE_TTL_MS) {
      const jwks = await loadJwks(url, jwksFetch);
      if (jwks) {
        entry = { jwks, fetchedAt: Date.now() };
        jwksCache.set(url, entry);
      }
    }

    let key = entry ? findKey(entry.jwks) : undefined;
    if (!key) {
      // kid miss: one forced refresh (key rotation window). If the refreshed
      // JWKS still lacks the kid, arm the negative cache so subsequent
      // requests with attacker-chosen kids stop hitting the network.
      const jwks = await loadJwks(url, jwksFetch);
      if (jwks) {
        entry = { jwks, fetchedAt: Date.now() };
        jwksCache.set(url, entry);
        key = findKey(jwks);
      }
      if (key) {
        jwksNegativeUntil.delete(url);
      } else {
        jwksNegativeUntil.set(url, Date.now() + JWKS_NEGATIVE_TTL_MS);
      }
    }
    if (!key) {
      throw new Error("no gate identity key matches the token kid");
    }
    return importJWK(key, "EdDSA");
  };
}

export type VerifyGateIdentityTokenOptions = {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
};

export async function verifyGateIdentityToken(
  token: string,
  options: VerifyGateIdentityTokenOptions,
): Promise<GateIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, options.getKey, {
      algorithms: ["EdDSA"],
      issuer: options.issuer,
      audience: options.audience,
      requiredClaims: ["sub", "iat", "exp"],
      maxTokenAge: "10 minutes",
    });
    // REPLAY WINDOW NOTE (#44): the gate does not issue a `jti`, so the same
    // token verifies for up to 10 minutes (maxTokenAge) and can mint multiple
    // local sessions within that window — "logout invalidates immediately"
    // does NOT hold for gate identities. The fix belongs at ISSUANCE: the gate
    // should add `jti: crypto.randomUUID()` per token; once it does, this
    // verifier can reject duplicate jti values via a short-TTL set. Not
    // enforced here because the gate currently may legitimately resend one
    // token across proxied requests.
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) return null;
    return {
      sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      teamId: typeof payload.team_id === "string" ? payload.team_id : null,
    };
  } catch {
    return null;
  }
}

type GateEndpoints = { issuer: string; jwksUrl: string };

/**
 * Host-suffix → gate issuer mapping for deployed apps. Data-driven (#42): a
 * new deployment domain needs exactly one entry here. Unknown hosts fail
 * CLOSED (null — no gate identity resolution), so a forgotten entry surfaces
 * as "gate sessions stop working on that domain" rather than a security
 * regression; add the entry before routing traffic through the new domain.
 */
const GATE_HOST_SUFFIXES: readonly { suffix: string; issuer: string }[] = [
  { suffix: "app-builder-testing.com", issuer: "https://gate.app-builder-testing.com" },
  { suffix: "grok.me", issuer: "https://gate.grok.me" },
];

export function resolveGateEndpoints(headers: Headers): GateEndpoints | null {
  const explicit = env("GROK_GATE_ORIGIN");
  if (explicit) {
    const origin = explicit.replace(/\/+$/, "");
    return { issuer: origin, jwksUrl: `${origin}${GATE_JWKS_PATH}` };
  }

  if (isWorkspacePreview()) {
    return {
      issuer: PREVIEW_GATE_ORIGIN,
      jwksUrl: `${PREVIEW_GATE_ORIGIN}${GATE_JWKS_PATH}`,
    };
  }

  const xf = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (xf || headers.get("host") || "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (!host) return null;

  for (const { suffix, issuer } of GATE_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return { issuer, jwksUrl: `${issuer}${GATE_JWKS_PATH}` };
    }
  }
  return null;
}

export type GateLinkedAccount = { providerId: string; accountId: string };

export function sessionBoundToGateIdentity(
  accounts: readonly GateLinkedAccount[],
  identitySub: string,
  gateProviderId: string,
): boolean {
  return accounts.some(
    (account) =>
      account.providerId === gateProviderId &&
      account.accountId === identitySub,
  );
}

export async function gateIdentityFromHeaders(
  headers: Headers,
  jwksFetch?: JwksFetch,
): Promise<GateIdentity | null> {
  if (!gateIdentityEnabled()) return null;
  const token = headers.get(GATE_IDENTITY_HEADER)?.trim();
  if (!token) return null;
  const endpoints = resolveGateEndpoints(headers);
  if (!endpoints) return null;
  return verifyGateIdentityToken(token, {
    issuer: endpoints.issuer,
    audience: gateTokenAudience(),
    getKey: gateKeyResolver(endpoints.jwksUrl, jwksFetch),
  });
}

export type GateUserInfo = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

export function gateIdentityUserInfo(identity: GateIdentity): GateUserInfo {
  return {
    id: identity.sub,
    email: (
      identity.email ?? `${identity.sub}@${FALLBACK_EMAIL_DOMAIN}`
    ).toLowerCase(),
    emailVerified: Boolean(identity.email),
    name: identity.name ?? FALLBACK_NAME,
  };
}
