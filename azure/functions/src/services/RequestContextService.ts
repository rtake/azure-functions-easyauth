import { HttpRequest } from "@azure/functions";

/**
 * Handles request-specific context and validation
 */
export class RequestContextService {
  constructor(private req: HttpRequest) {}

  /**
   * Resolves the request host from various header sources
   */
  getHost(): string | undefined {
    return (
      this.req.headers.get("x-forwarded-host") ??
      this.req.headers.get("x-original-host") ??
      this.req.headers.get("host") ??
      new URL(this.req.url).host ??
      undefined
    );
  }

  /**
   * Retrieves the cookie header
   */
  getCookie(): string | undefined {
    return this.req.headers.get("cookie") ?? undefined;
  }

  /**
   * Validates if the request has AppServiceAuthSession
   */
  hasAuthSession(): boolean {
    const cookie = this.getCookie();
    return cookie?.includes("AppServiceAuthSession=") ?? false;
  }

  /**
   * Checks if the request is authorized (has both session and host)
   */
  isAuthorized(): boolean {
    return this.hasAuthSession() && this.getHost() !== undefined;
  }
}
