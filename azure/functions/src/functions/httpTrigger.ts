import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { ManagedIdentityCredential } from "@azure/identity";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { GraphApiService } from "../graph/GraphApiService.js";
import { GraphApiError } from "../graph/errors/GraphApiError.js";

/* =========================
 * Types
 * ========================= */

type EasyAuthIdentity = {
  access_token?: string;
  id_token?: string;
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
  return await getEasyAuthCookie(req);
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

async function exchangeTokenOnBehalfOf(userAssertion: string): Promise<string> {
  const clientId = getEnv("OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID");
  const miCredential = new ManagedIdentityCredential({ clientId: clientId });
  const confidentialClientApplication = new ConfidentialClientApplication({
    auth: {
      clientAssertion: async () => {
        const token = await miCredential.getToken(
          "api://AzureADTokenExchange/.default",
        );
        return token.token;
      },
      clientId: getEnv("OBO_CLIENT_ID"),
      authority: `https://login.microsoftonline.com/${getEnv("OBO_TENANT_ID")}`,
    },
  });

  const result = await confidentialClientApplication.acquireTokenOnBehalfOf({
    oboAssertion: userAssertion,
    scopes: [
      getOptionalEnv("GRAPH_SCOPE", "https://graph.microsoft.com/User.Read"),
    ],
  });

  if (!result?.accessToken) {
    throw new Error("OBO token missing");
  }

  return result.accessToken;
}

/* =========================
 * Services
 * ========================= */

const graphApiService = new GraphApiService(
  getOptionalEnv("GRAPH_ENDPOINT", "https://graph.microsoft.com/v1.0"),
);

/* =========================
 * Response helpers
 * ========================= */

function ok(body: unknown): HttpResponseInit {
  return { status: 200, jsonBody: body };
}

function unauthorized(): HttpResponseInit {
  return {
    status: 401,
    jsonBody: {
      error: "AppServiceAuthSession or Easy Auth token required",
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

async function httpTrigger(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const assertion = await resolveUserAssertion(req);
    if (!assertion) return unauthorized();

    const token = await exchangeTokenOnBehalfOf(assertion);
    const me = await graphApiService.getMe(token);

    context.log("success", {
      userId: me.id,
      upn: me.userPrincipalName,
    });

    return ok({
      message: "Graph call succeeded via OBO",
      me,
    });
  } catch (e) {
    if (e instanceof GraphApiError) {
      context.warn(`Graph API error: ${e.statusCode}`, { message: e.message });
      return fail(e);
    }
    context.error("failed", e);
    return fail(e);
  }
}

app.http("profile", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "profile",
  handler: httpTrigger,
});
