// Error codes for tool failures. The model pattern-matches on the bracketed
// code at the start of an error string to pick a recovery action. Recovery
// guidance lives in the emitted message (paid only on failure), not the system
// prompt, so a new code's message must state how to fix it.
export const ErrorCode = {
  NOT_READ_RECENTLY: "NOT_READ_RECENTLY",
  STALE_READ: "STALE_READ",
  FIND_NOT_UNIQUE: "FIND_NOT_UNIQUE",
  FIND_NOT_FOUND: "FIND_NOT_FOUND",
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  INVALID_VALUE_TYPE: "INVALID_VALUE_TYPE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  DRAFT_HANDLE_EXPIRED: "DRAFT_HANDLE_EXPIRED",
  SPINDLE_ERROR: "SPINDLE_ERROR",
  INVALID_INPUT: "INVALID_INPUT",
  REFUSED_BY_EXTENSION: "REFUSED_BY_EXTENSION",
  NO_TARGET: "NO_TARGET",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function codedError(code: ErrorCode, message: string): string {
  return `Error: [${code}] ${message}`;
}
