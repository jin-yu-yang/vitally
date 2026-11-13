import { SQLSTATE_ERROR_CODES } from "./contracts.mjs";

// One short user-safe sentence per domain code. Database wording, SQL details and
// internal identifiers never reach the browser; the original stays on `.cause`.
const SAFE_MESSAGES = Object.freeze({
  FORBIDDEN: "You do not have access to this step.",
  NOT_FOUND: "This application is no longer available.",
  CONFLICT: "Someone else updated this application. Refresh and try again.",
  INVALID_TRANSITION: "This step is not available right now.",
  SELF_REVIEW: "A different volunteer has to review this application.",
  INELIGIBLE: "This volunteer is not qualified for this step.",
  VALIDATION: "Please check the information and try again.",
  NOT_CLEARED: "Finish your setup for this season first.",
  OFFLINE: "Network error. Please try again later.",
  SERVER_ERROR: "Something went wrong. Please try again.",
});

// Map by `error.code` alone: never a regex over messages and never an HTTP status.
function domainCode(error) {
  const code = error?.code;
  // A failed fetch never reaches PostgREST, so it carries no database code.
  if (!code) return "OFFLINE";
  if (SQLSTATE_ERROR_CODES[code]) return SQLSTATE_ERROR_CODES[code];
  if (code === "42501") return "FORBIDDEN";
  return "SERVER_ERROR";
}

export function createAppError(error) {
  const code = domainCode(error);
  return Object.assign(new Error(SAFE_MESSAGES[code], { cause: error }), {
    code,
  });
}
