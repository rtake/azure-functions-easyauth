/**
 * Graph API 固有のエラークラス
 */
export class GraphApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "GraphApiError";
  }

  static fromHttpError(statusCode: number, message: string): GraphApiError {
    const retryable = statusCode >= 500 || statusCode === 429; // 5xx or rate limit
    return new GraphApiError(statusCode, message, retryable);
  }
}
