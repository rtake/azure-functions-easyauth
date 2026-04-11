import type { IGraphApiService } from "./IGraphApiService.js";
import type { GraphMeResponse } from "./types.js";
import { GraphApiError } from "./errors/GraphApiError.js";

/**
 * Microsoft Graph API との通信を管理するサービス
 */
export class GraphApiService implements IGraphApiService {
  constructor(private readonly endpoint: string) {}

  /**
   * Microsoft Graph の /me エンドポイントを呼び出し、
   * 認証済みユーザーの情報を取得する
   *
   * @param accessToken Graph API 用のアクセストークン
   * @returns ユーザー情報
   * @throws GraphApiError Graph API との通信に失敗した場合
   */
  async getMe(accessToken: string): Promise<GraphMeResponse> {
    const url = `${this.endpoint}/me`;
    const headers = {
      authorization: `Bearer ${accessToken}`,
    };

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const text = await response.text();
        throw GraphApiError.fromHttpError(
          response.status,
          `Graph API error: ${response.status} - ${text}`,
        );
      }

      return (await response.json()) as GraphMeResponse;
    } catch (error) {
      if (error instanceof GraphApiError) {
        throw error;
      }

      throw new GraphApiError(
        500,
        error instanceof Error
          ? `Failed to call Graph API: ${error.message}`
          : "Failed to call Graph API",
        false,
      );
    }
  }
}
