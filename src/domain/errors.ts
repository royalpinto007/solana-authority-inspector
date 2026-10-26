export class InspectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 502,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "InspectorError";
  }
}
