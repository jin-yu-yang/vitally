// A form whose capability is gone keeps its text and drops its submit (change
// recheck-clearance-while-cleared). Staff text, English only. Pure.
import { esc } from "./ui.mjs";

export const ROLES_CHANGED_TEXT = "Your roles changed, so you can't send this any more.";

export const rolesChangedLine = () =>
  `<p class="field-note roles-changed" role="note">${esc(ROLES_CHANGED_TEXT)}</p>`;

// The dialogs whose RPC checks an effective capability.
export const DIALOG_CAPABILITY = Object.freeze({
  assign: "admin",
  "close-unsigned": "admin",
  "close-case": "admin",
  "put-on-hold": "admin",
  "resume-from-hold": "admin",
  "mark-ready-to-efile": "admin",
  "mark-efiled": "admin",
  "record-filing-result": "admin",
  "return-to-signing": "admin",
  "request-documents": "admin",
  "log-call": "followup",
  "resolve-help": "assist",
  "request-corrections": "review",
});

// The workspace admin dialogs: never swapped.
export const WORKSPACE_ADMIN_DIALOGS = Object.freeze([
  "volunteer",
  "send-invitation",
  "cancel-invitation",
  "deactivate-account",
  "remove-from-roster",
  "update-people",
  "unpublish-update",
  "delete-update",
  "change-sidn",
  "start-season",
  "export-season",
  "notifications",
  // The Schedule's shift drawer and Remove shift (change add-volunteer-schedule).
  "shift",
  "remove-shift",
  // The check-in drawer and Remove check-in (change add-volunteer-check-in).
  "check-in",
  "remove-check-in",
]);

// Dialogs that need no capability: never swapped.
export const NO_CAPABILITY_DIALOGS = Object.freeze([
  "help",
  "regenerate",
  "print",
  "withdraw",
  "leave-add-case",
]);

// The signed-in person's own entry in `people`: what the clearance re-read
// rewrites. Null for a client, or before the roster has loaded.
const ownEntry = (state) => {
  const id = state?.principal?.personId;
  return id ? ((state.people ?? []).find((person) => person?.id === id) ?? null) : null;
};

// Their effective capabilities.
export const ownCapabilities = (state) => {
  const capabilities = ownEntry(state)?.capabilities;
  return Array.isArray(capabilities) ? capabilities : [];
};

// Locked only for a staff person whose own entry is known, so a client window
// and a roster not yet loaded never lose a submit.
export const dialogLocked = (state) => {
  const needed = Object.hasOwn(DIALOG_CAPABILITY, state?.dialog) ? DIALOG_CAPABILITY[state.dialog] : null;
  return needed !== null && ownEntry(state) !== null && !ownCapabilities(state).includes(needed);
};

export const addCaseLocked = (state) =>
  state?.principal?.access === "staff" && ownEntry(state) !== null && !ownCapabilities(state).includes("admin");
