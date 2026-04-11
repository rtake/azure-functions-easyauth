/**
 * Handles Easy Auth token fetching
 */
export class AuthTokenService {
  /**
   * Fetches the access token from Easy Auth
   * @param cookie The AppServiceAuthSession cookie
   * @param host The request host
   * @returns The access token or undefined
   */
  async getAccessTokenFromEasyAuth(
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

    const data = (await res.json()) as Array<{ access_token?: string }>;
    return data[0]?.access_token ?? undefined;
  }
}
