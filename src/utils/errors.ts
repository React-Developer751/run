/** Error with an HTTP status; the API server turns it into a JSON reply. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** For 429: seconds until the client may try again (sent as Retry-After). */
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}
