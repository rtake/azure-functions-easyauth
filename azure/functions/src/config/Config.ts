/**
 * Centralized configuration management
 * All environment variables are validated and loaded at startup
 */
export class Config {
  readonly oboClientId: string;
  readonly oboTenantId: string;
  readonly miClientId: string;
  readonly graphScope: string;
  readonly graphEndpoint: string;

  constructor() {
    this.oboClientId = this.getRequired("OBO_CLIENT_ID");
    this.oboTenantId = this.getRequired("OBO_TENANT_ID");
    this.miClientId = this.getRequired(
      "OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID",
    );
    this.graphScope = this.getOptional(
      "GRAPH_SCOPE",
      "https://graph.microsoft.com/User.Read",
    );
    this.graphEndpoint = this.getOptional(
      "GRAPH_ENDPOINT",
      "https://graph.microsoft.com/v1.0",
    );
  }

  private getRequired(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  private getOptional(name: string, fallback: string): string {
    return process.env[name] ?? fallback;
  }
}
