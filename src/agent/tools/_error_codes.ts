// Numeric error codes for tool failures. The model pattern-matches on the
// bracketed code at the start of an error string to pick a recovery action
// (re-read, switch tool, ask the user, etc.). Add a new code by listing it
// here AND describing it in tasks/general.ts so the agent knows what to do.
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
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function codedError(code: ErrorCode, message: string): string {
  return `Error: [${code}] ${message}`;
}
