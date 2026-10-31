export const DEFAULT_AUTO_RETRIES = 3;
export const MAX_AUTO_RETRIES = 10;

export function coerceAutoRetries(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_AUTO_RETRIES, Math.floor(value)))
    : DEFAULT_AUTO_RETRIES;
}

export function canRetryModelError(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { statusCode?: number } | null)?.statusCode;
  if (status && status >= 400 && status < 500) return [408, 409, 425, 429].includes(status);
  const message = error instanceof Error ? error.message : String(error);
  return !/(?:\b(?:http|status(?: code)?|error(?: code)?)\s*[:=(]?\s*|\()(?:400|401|403|404|422)\b|invalid (?:api key|json payload)|unauthorized|permission denied/i.test(message);
}
