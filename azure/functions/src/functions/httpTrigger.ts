import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

type GraphMeResponse = {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

type EasyAuthIdentity = {
  access_token?: string;
  id_token?: string;
  provider_name?: string;
  user_claims?: Array<{
    typ?: string;
    val?: string;
  }>;
};

function getRequiredSetting(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required app setting: ${name}`);
  }

  return value;
}

function getUserAssertionFromHeaders(req: HttpRequest): string | undefined {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return (
    req.headers.get("x-ms-token-aad-access-token") ??
    req.headers.get("x-ms-token-aad-id-token") ??
    undefined
  );
}

async function getUserAssertionFromEasyAuth(
  req: HttpRequest,
): Promise<string | undefined> {
  const sessionCookie = req.headers.get("cookie");
  const host = req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    req.headers.get("x-appservice-proto") ??
    "https";

  if (!sessionCookie?.includes("AppServiceAuthSession=") || !host) {
    return undefined;
  }

  const meResponse = await fetch(`${proto}://${host}/.auth/me`, {
    headers: {
      cookie: sessionCookie,
    },
  });

  if (!meResponse.ok) {
    throw new Error(
      `Easy Auth /.auth/me call failed (${meResponse.status}): ${await meResponse.text()}`,
    );
  }

  const identities = (await meResponse.json()) as EasyAuthIdentity[];
  for (const identity of identities) {
    if (identity.access_token) {
      return identity.access_token;
    }

    if (identity.id_token) {
      return identity.id_token;
    }
  }

  return undefined;
}

async function exchangeTokenOnBehalfOf(userAssertion: string): Promise<string> {
  const tenantId = getRequiredSetting("OBO_TENANT_ID");
  const clientId = getRequiredSetting("OBO_CLIENT_ID");
  const clientSecret = getRequiredSetting("OBO_CLIENT_SECRET");
  const scope =
    process.env.GRAPH_SCOPE ?? "https://graph.microsoft.com/User.Read";
  const authorityHost =
    process.env.OBO_AUTHORITY_HOST ?? "https://login.microsoftonline.com";

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    requested_token_use: "on_behalf_of",
    scope,
    assertion: userAssertion,
  });

  const tokenResponse = await fetch(
    `${authorityHost}/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(
      `OBO token exchange failed (${tokenResponse.status}): ${errorBody}`,
    );
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error(
      "OBO token exchange succeeded but access_token was missing",
    );
  }

  return tokenJson.access_token;
}

async function fetchGraphMe(accessToken: string): Promise<GraphMeResponse> {
  const graphEndpoint =
    process.env.GRAPH_ENDPOINT ?? "https://graph.microsoft.com/v1.0/me";

  const graphResponse = await fetch(graphEndpoint, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!graphResponse.ok) {
    const errorBody = await graphResponse.text();
    throw new Error(
      `Microsoft Graph call failed (${graphResponse.status}): ${errorBody}`,
    );
  }

  return (await graphResponse.json()) as GraphMeResponse;
}

async function httpTrigger(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    context.log("req.headers", req.headers);

    const userAssertion =
      getUserAssertionFromHeaders(req) ??
      (await getUserAssertionFromEasyAuth(req));
    if (!userAssertion) {
      return {
        status: 401,
        jsonBody: {
          error:
            "Authorization bearer token, Easy Auth token header, or AppServiceAuthSession-backed /.auth/me token is required.",
        },
      };
    }

    const graphAccessToken = await exchangeTokenOnBehalfOf(userAssertion);
    const me = await fetchGraphMe(graphAccessToken);

    context.log("OBO Graph call succeeded", {
      userId: me.id,
      upn: me.userPrincipalName,
    });

    return {
      status: 200,
      jsonBody: {
        message: "Microsoft Graph call succeeded via OBO.",
        me,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error occurred";
    context.error("OBO Graph call failed", { message });
    return {
      status: 500,
      jsonBody: {
        error: message,
      },
    };
  }
}

app.http("httpTrigger", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: httpTrigger,
});
