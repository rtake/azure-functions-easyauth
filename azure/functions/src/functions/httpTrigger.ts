import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { GraphApiService } from "../graph/GraphApiService.js";
import { GraphApiError } from "../graph/errors/GraphApiError.js";
import { Config } from "../config/Config.js";
import { RequestContextService } from "../services/RequestContextService.js";
import { AuthTokenService } from "../services/AuthTokenService.js";
import { OboTokenService } from "../services/OboTokenService.js";

// Initialize once at startup
const config = new Config();
const graphApiService = new GraphApiService(config.graphEndpoint);
const authTokenService = new AuthTokenService();
const oboTokenService = new OboTokenService(config);

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
    const requestContext = new RequestContextService(req);

    // Validate request authorization
    if (!requestContext.isAuthorized()) {
      return unauthorized();
    }

    // Resolve user assertion from Easy Auth
    const cookie = requestContext.getCookie()!;
    const host = requestContext.getHost()!;
    const userAssertion = await authTokenService.getAccessTokenFromEasyAuth(
      cookie,
      host,
    );

    if (!userAssertion) {
      return unauthorized();
    }

    // Exchange for OBO token
    const token = await oboTokenService.exchangeTokenOnBehalfOf(userAssertion);

    // Call Graph API
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
