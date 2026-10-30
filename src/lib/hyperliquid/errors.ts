/**
 * Hyperliquid answered and refused the request (e.g. "Insufficient margin").
 * Any other error from an exchange call means the outcome is unknown: the
 * request may or may not have reached Hyperliquid.
 */
export class HlRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HlRejectedError";
  }
}
