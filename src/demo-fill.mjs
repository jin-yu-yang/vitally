// "Auto-fill fictional data": one button on each staff questionnaire and
// filing dialog that fills it with made-up answers the form's own rules
// accept, so a classroom demo can move a case along without typing.
//
// Fictional data only (project rule). Nothing is sent: the volunteer still
// presses the form's own submit button, and the database stays the authority.
// The values are pure (testable in node); fillForm is the only DOM code.

import { todayIso } from "./questionnaires.mjs";
import { isLoopbackUrl } from "./loopback.mjs";

export const DEMO_FILL_ACTION = "demo-fill";

/**
 * The demo-tools switch, computed once at start-up: the server must have sent
 * `demoTools: true` and the Supabase URL must be on this machine.
 */
export const demoToolsFromConfig = (config) =>
  config?.demoTools === true && isLoopbackUrl(config?.supabaseUrl);

/** Whether the controller's state has the demo tools switched on. */
export const demoToolsOn = (state) => state?.demoTools === true;

/**
 * The button, placed at the top of a form or dialog, only when the demo-tools
 * switch is on (`demoToolsOn(state)`). It follows the switch, not the account:
 * on a real deployment the switch is off, so a real preparer, reviewer or
 * office worker never gets a way to fill a case with made-up answers.
 */
export const demoFillButton = (enabled) =>
  enabled === true
    ? `<button type="button" class="btn secondary demo-fill" data-action="${DEMO_FILL_ACTION}">Auto-fill fictional data</button>`
    : "";

const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");

// A local date and time `days` from now, as a datetime-local input wants it.
const localDateTime = (now, days, hour) => {
  const d = new Date(now + days * DAY);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
};

/**
 * Field name → the value to fill. A string is a radio's or select's option or
 * a box's text; `true` ticks a checkbox. A name missing here is left alone,
 * so optional parts (a Local Exit Form entry, a reject code) stay empty.
 */
export function demoValues(now = Date.now()) {
  const today = todayIso(now);
  return Object.freeze({
    // Preparer questionnaire
    confirmedBy: "client",
    confirmedMethod: "phone",
    shadedPartsCompleted: true,
    stateForgivenessSet: true,
    readyForReviewOn: today,
    resolution: "Fixed the fictional W-2 box 12 entry and re-checked the totals.",
    // Reviewer questionnaire
    completedOn: today,
    paForgiveness: "eligible",
    wentOver: "yes",
    wentOverOn: today,
    wentOverHow: "phone",
    signMethod: "portal",
    signAppointmentAt: localDateTime(now, 1, 10),
    "federal.method": "efile",
    "federal.result": "refund",
    "federal.amount": "1234.56",
    "federal.refundBy": "direct_deposit",
    "state.method": "efile",
    "state.result": "owe",
    "state.amount": "87.00",
    "state.oweBy": "direct_debit",
    "state.debitOn": todayIso(now + 14 * DAY),
    remarks: "Fictional demo data, auto-filled.",
    findings: "Fictional finding: the dependent's birth date does not match the intake.",
    // Review contact
    outcome: "reached",
    note: "Fictional note: spoke with the client, who had no questions.",
    // Mark ready to e-file, Mark e-filed, Record filing result, Return to signing
    confirmed: true,
    "filing-combination": "both_efile",
    "method-federal": "efile",
    "method-state": "efile",
    "result-federal": "accepted",
    "result-state": "accepted",
    "date-federal": today,
    "date-state": today,
  });
}

// A choice the form already draws with a default (the signing method from the
// client's service) keeps it: the form knows better than a fixed value.
const KEEP_IF_CHOSEN = Object.freeze(["signMethod"]);

/**
 * Fills the form around `button` and reports each change as typed input, so
 * drafts survive a redraw and dependent parts show. Returns how many fields
 * were filled.
 */
export function fillForm(button, now = Date.now()) {
  const scope = button?.closest("form, .modal, [role=dialog]");
  if (!scope) return 0;
  const values = demoValues(now);
  const changed = [];
  for (const field of scope.querySelectorAll("input[name], select[name], textarea[name]")) {
    if (!Object.hasOwn(values, field.name) || field.disabled) continue;
    // A box drawn from state with its own action (the case page's "I have
    // checked" toggle) is not part of a form's answers.
    if (field.matches("[data-action], #field-confirmed")) continue;
    const want = values[field.name];
    if (field.type === "radio") {
      if (KEEP_IF_CHOSEN.includes(field.name) && scope.querySelector(`input[name="${field.name}"]:checked`)) continue;
      if (field.value !== want || field.checked) continue;
      field.checked = true;
    } else if (field.type === "checkbox") {
      if (field.checked) continue;
      field.checked = true;
    } else if (field.tagName === "SELECT") {
      if (![...field.options].some((option) => option.value === want)) continue;
      field.value = want;
    } else {
      if (field.value.trim()) continue; // never overwrite what someone typed
      field.value = String(want);
    }
    changed.push(field);
  }
  for (const field of changed) {
    field.closest("details")?.setAttribute("open", "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return changed.length;
}
