import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  ManagedIdentityCredential,
  OnBehalfOfCredential,
} from "@azure/identity";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* =========================
 * Types
 * ========================= */

type GraphMeResponse = {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

type EasyAuthIdentity = {
  access_token?: string;
  id_token?: string;
};

type AuthEvidence = {
  hasBearerAuthorization: boolean;
  hasEasyAuthAccessTokenHeader: boolean;
  hasEasyAuthIdTokenHeader: boolean;
  hasClientPrincipalHeader: boolean;
  hasAppServiceAuthSessionCookie: boolean;
  requestHost?: string;
  requestProto?: string;
};

/* =========================
 * Config / Env
 * ========================= */

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/* =========================
 * HTTP helpers
 * ========================= */

async function httpGetJson<T>(
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/* =========================
 * Assertion Resolver
 * ========================= */

async function resolveUserAssertion(
  req: HttpRequest,
): Promise<string | undefined> {
  return (
    // getBearerToken(req) ?? getEasyAuthHeader(req) ?? (await getEasyAuthCookie(req))
    await getEasyAuthCookie(req)
  );
}

function getBearerToken(req: HttpRequest): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
}

function getEasyAuthHeader(req: HttpRequest): string | undefined {
  return (
    req.headers.get("x-ms-token-aad-access-token") ??
    req.headers.get("x-ms-token-aad-id-token") ??
    undefined
  );
}

function resolveRequestProto(req: HttpRequest): string {
  return (
    req.headers.get("x-forwarded-proto") ??
    req.headers.get("x-appservice-proto") ??
    safeParseUrl(req.url)?.protocol.replace(":", "") ??
    "https"
  );
}

function resolveRequestHost(req: HttpRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-host") ??
    req.headers.get("x-original-host") ??
    req.headers.get("host") ??
    safeParseUrl(req.url)?.host ??
    undefined
  );
}

function safeParseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function getAuthEvidence(req: HttpRequest): AuthEvidence {
  const cookie = req.headers.get("cookie") ?? "";

  return {
    hasBearerAuthorization: !!getBearerToken(req),
    hasEasyAuthAccessTokenHeader: !!req.headers.get(
      "x-ms-token-aad-access-token",
    ),
    hasEasyAuthIdTokenHeader: !!req.headers.get("x-ms-token-aad-id-token"),
    hasClientPrincipalHeader: !!req.headers.get("x-ms-client-principal"),
    hasAppServiceAuthSessionCookie: cookie.includes("AppServiceAuthSession="),
    requestHost: resolveRequestHost(req),
    requestProto: resolveRequestProto(req),
  };
}

async function getEasyAuthCookie(
  req: HttpRequest,
): Promise<string | undefined> {
  const cookie = req.headers.get("cookie");
  const host = resolveRequestHost(req);

  if (!cookie?.includes("AppServiceAuthSession=") || !host) return;

  const proto = resolveRequestProto(req);

  const identities = await httpGetJson<EasyAuthIdentity[]>(
    `${proto}://${host}/.auth/me`,
    { cookie },
  );

  return (
    identities.find((i) => i.access_token)?.access_token ??
    identities.find((i) => i.id_token)?.id_token
  );
}

/* =========================
 * Certificate (Key Vault)
 * ========================= */

const clinetId = getEnv("OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID");
const miCredential = new ManagedIdentityCredential({ clientId: clinetId });

let certificateCache: Promise<string>;

function getCertificatePath(): Promise<string> {
  certificateCache ??= loadCertificate();
  return certificateCache;
}

function normalizePemSecret(value: string): string {
  let normalized = value.trim();

  // Some Key Vault upload flows store PEM as a single-line string with literal \n.
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  normalized = normalized.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");

  if (!normalized.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "Key Vault secret does not contain a PEM certificate block",
    );
  }

  if (
    !normalized.includes("-----BEGIN PRIVATE KEY-----") &&
    !normalized.includes("-----BEGIN RSA PRIVATE KEY-----") &&
    !normalized.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")
  ) {
    throw new Error(
      "Key Vault secret does not contain a PEM private key block",
    );
  }

  return normalized;
}

async function loadCertificate(): Promise<string> {
  const secretUri = getEnv("OBO_CLIENT_CERTIFICATE_SECRET_URI");

  const token = await miCredential.getToken("https://vault.azure.net/.default");

  if (!token?.token) {
    throw new Error("Failed to acquire MI token");
  }

  const separator = secretUri.includes("?") ? "&" : "?";

  const secret = await httpGetJson<{ value?: string }>(
    `${secretUri}${separator}api-version=7.4`,
    {
      authorization: `Bearer ${token.token}`,
    },
  );

  if (!secret.value) {
    throw new Error("KeyVault secret missing value");
  }

  const pem = normalizePemSecret(secret.value);

  const hash = createHash("sha256").update(pem).digest("hex");

  const path = join(tmpdir(), `obo-cert-${hash}.pem`);

  await writeFile(path, pem, {
    encoding: "utf8",
    mode: 0o600,
  });

  return path;
}

/* =========================
 * OBO
 * ========================= */

async function exchangeTokenOnBehalfOf(userAssertion: string): Promise<string> {
  const credential = new OnBehalfOfCredential({
    tenantId: getEnv("OBO_TENANT_ID"),
    clientId: getEnv("OBO_CLIENT_ID"),
    certificatePath: await getCertificatePath(),
    userAssertionToken: userAssertion,
  });

  const token = await credential.getToken(
    getOptionalEnv("GRAPH_SCOPE", "https://graph.microsoft.com/User.Read"),
  );

  if (!token?.token) {
    throw new Error("OBO token missing");
  }

  return token.token;
}

/* =========================
 * Graph
 * ========================= */

async function fetchGraphMe(accessToken: string): Promise<GraphMeResponse> {
  return httpGetJson<GraphMeResponse>(
    getOptionalEnv("GRAPH_ENDPOINT", "https://graph.microsoft.com/v1.0/me"),
    {
      authorization: `Bearer ${accessToken}`,
    },
  );
}

/* =========================
 * Response helpers
 * ========================= */

function ok(body: unknown): HttpResponseInit {
  return { status: 200, jsonBody: body };
}

function unauthorized(req: HttpRequest): HttpResponseInit {
  return {
    status: 401,
    jsonBody: {
      error: "AppServiceAuthSession or Easy Auth token required",
      evidence: getAuthEvidence(req),
    },
  };
}

function fail(error: unknown): HttpResponseInit {
  const message = error instanceof Error ? error.message : "Unexpected error";

  return {
    status: 500,
    jsonBody: { error: message },
  };
}

/* =========================
 * Handler (薄くする)
 * ========================= */

async function httpTrigger(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const assertion = await resolveUserAssertion(req);
    if (!assertion) return unauthorized(req);

    const token = await exchangeTokenOnBehalfOf(assertion);
    const me = await fetchGraphMe(token);

    context.log("success", {
      userId: me.id,
      upn: me.userPrincipalName,
    });

    return ok({
      message: "Graph call succeeded via OBO",
      me,
    });
  } catch (e) {
    context.error("failed", e);
    return fail(e);
  }
}

/* =========================
 * Entry
 * ========================= */

app.http("profile", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "profile",
  handler: httpTrigger,
});
