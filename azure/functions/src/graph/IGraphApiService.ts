import type { GraphMeResponse } from "./types.js";

/**
 * Graph API サービスのインターフェース
 * テスト時のmock化やIoC対応を可能にする
 */
export interface IGraphApiService {
  /**
   * Microsoft Graph の /me エンドポイントを呼び出し、
   * 認証済みユーザーの情報を取得する
   *
   * @param accessToken Graph API 用のアクセストークン
   * @returns ユーザー情報
   */
  getMe(accessToken: string): Promise<GraphMeResponse>;
}
