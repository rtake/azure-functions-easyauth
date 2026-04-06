import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

async function httpTrigger(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a request.");
  context.log(req.headers);
  return { status: 200, body: "OK" };
}

app.http("httpTrigger", {
  methods: ["POST"],
  authLevel: "function",
  handler: httpTrigger,
});
