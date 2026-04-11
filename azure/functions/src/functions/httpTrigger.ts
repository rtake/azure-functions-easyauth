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

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function resolveRequestHost(req: HttpRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-host") ??
    req.headers.get("x-original-host") ??
    req.headers.get("host") ??
    new URL(req.url).host ??
    undefined
  );
}

async function fetchAccessTokenFromEasyAuth(
  cookie: string,
  host: string,
): Promise<string | undefined> {
  const url = `https://${host}/.auth/me`;
  const res = await fetch(url, {
    headers: {
      cookie,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Easy Auth token: HTTP ${res.status}`);
  }

  const accessToken = (await res.json())[0]?.access_token as string | undefined;

  return accessToken;
}

async function resolveUserAssertion(
  req: HttpRequest,
): Promise<string | undefined> {
  const cookie = req.headers.get("cookie");
  const host = resolveRequestHost(req);

  if (!cookie?.includes("AppServiceAuthSession=") || !host) return;

  return await fetchAccessTokenFromEasyAuth(cookie, host);
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

const graphApiService = new GraphApiService(
  getOptionalEnv("GRAPH_ENDPOINT", "https://graph.microsoft.com/v1.0"),
);

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
