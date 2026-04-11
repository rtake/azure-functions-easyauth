import { ManagedIdentityCredential } from "@azure/identity";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Config } from "../config/Config.js";

/**
 * Handles On-Behalf-Of (OBO) token exchange
 */
export class OboTokenService {
  constructor(private config: Config) {}

  /**
   * Exchanges a user assertion for a token on behalf of the user
   * @param userAssertion The user's assertion from Easy Auth
   * @returns The OBO access token
   */
  async exchangeTokenOnBehalfOf(userAssertion: string): Promise<string> {
    const miCredential = new ManagedIdentityCredential({
      clientId: this.config.miClientId,
    });

    const confidentialClientApplication = new ConfidentialClientApplication({
      auth: {
        clientAssertion: async () => {
          const token = await miCredential.getToken(
            "api://AzureADTokenExchange/.default",
          );
          return token.token;
        },
        clientId: this.config.oboClientId,
        authority: `https://login.microsoftonline.com/${this.config.oboTenantId}`,
      },
    });

    const result = await confidentialClientApplication.acquireTokenOnBehalfOf({
      oboAssertion: userAssertion,
      scopes: [this.config.graphScope],
    });

    if (!result?.accessToken) {
      throw new Error("OBO token exchange failed: no accessToken in response");
    }

    return result.accessToken;
  }
}
