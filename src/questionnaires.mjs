// The preparer and reviewer questionnaires: their vocabulary, the payload
// builders and the contact-log prefill (design D3, D4, D6, D9).
//
// Pure: no DOM, no store. The builders apply the database's own rules first so
// the volunteer reads a sentence instead of a refused call; the database stays
// the authority. Hidden answers that do not apply are dropped, never sent.
// May import contact-log.mjs (the New York clock), never staff-views.mjs.

import { nyLocalInput } from "./contact-log.mjs";

const pairs = (list) => Object.freeze(list.map((p) => Object.freeze(p)));

// [stored value, label]
export const CONFIRMED_BY = pairs([["client", "Client"], ["spouse", "Spouse"], ["other", "Other"]]);
export const CONFIRMED_METHODS = pairs([
  ["phone", "Phone"], ["in_person", "In person"], ["text", "Text"], ["email", "Email"], ["video", "Video"],
]);
export const WENT_OVER_HOW = pairs([["in_person", "In person"], ["phone", "Phone"], ["video", "Video"], ["other", "Other"]]);
export const SIGN_METHODS = pairs([["portal", "E-sign in the TaxSlayer Customer Portal"], ["in_person", "In person"]]);
export const PA_FORGIVENESS = pairs([["eligible", "Eligible"], ["not_eligible", "Not eligible"]]);
export const FILING_METHODS = pairs([["efile", "E-file"], ["paper", "Paper"]]);
export const RESULTS = pairs([["refund", "Refund"], ["owe", "Owe"], ["none", "None"]]);
export const REFUND_BY = pairs([["direct_deposit", "Direct deposit"], ["check", "Check"]]);
export const OWE_BY = pairs([["direct_debit", "Direct debit"], ["mail_check", "Mail check"]]);
export const LOCAL_TYPES = pairs([
  ["NPT", "NPT"], ["BIRT", "BIRT"], ["EET", "EET"], ["SIT", "SIT"],
  ["PAIBWTR", "PAIBWTR (Philadelphia Wage Tax refund petition)"],
]);

const AMOUNT = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$/;
const TICKED = Object.freeze([true, "true", "on", "yes"]);

function validation(message) {
  return Object.assign(new Error(message), { code: "VALIDATION" });
}

const str = (values, key) => String(values?.[key] ?? "").trim();
const has = (list, value) => list.some(([v]) => v === value);
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Dates and small helpers
// ---------------------------------------------------------------------------

// The browser's local date as YYYY-MM-DD (design D6).
export const todayIso = (now = Date.now()) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const realDate = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

const realDateTime = (value) => {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(m) && realDate(m[1]);
};

const date = (values, key, sentence) => {
  const value = str(values, key);
  if (!realDate(value)) throw validation(sentence);
  return value;
};

// Reviewer 4's starting choice follows the service (design D6).
export const signDefault = (service) =>
  service === "same_day" ? "in_person" : service === "online" ? "portal" : "";

// Only an in-person signing on a case that is not same-day needs an
// appointment; an unknown service counts as not same-day.
export const needsAppointment = (service, signMethod) =>
  signMethod === "in_person" && service !== "same_day";

// ---------------------------------------------------------------------------
// The contact-log prefill (design D9)
// ---------------------------------------------------------------------------

const PREFILL_HOW = Object.freeze({
  in_person: "in_person", phone: "phone", video: "video", text: "other", email: "other",
});

export function goOverPrefill(contacts) {
  let latest = null;
  let latestTime = -Infinity;
  for (const entry of contacts ?? []) {
    if (entry?.purpose !== "go_over_return" || entry?.outcome !== "reached") continue;
    const time = Date.parse(entry.contactedAt);
    if (Number.isNaN(time) || time <= latestTime) continue;
    latest = entry;
    latestTime = time;
  }
  if (!latest) return null;
  return {
    wentOver: "yes",
    wentOverOn: nyLocalInput(latest.contactedAt).slice(0, 10),
    wentOverHow: PREFILL_HOW[latest.method] ?? "other",
  };
}

// ---------------------------------------------------------------------------
// Preparer
// ---------------------------------------------------------------------------

export function preparerQuestionnaire(values) {
  const confirmedBy = str(values, "confirmedBy");
  if (!has(CONFIRMED_BY, confirmedBy)) throw validation("Choose who confirmed the return.");
  const payload = { confirmedBy };
  if (confirmedBy === "other") {
    const name = str(values, "confirmedByName");
    if (!name) throw validation("Enter the name of the person who confirmed the return.");
    if (name.length > 120) throw validation("Keep the name to 120 characters or fewer.");
    payload.confirmedByName = name;
  }
  const confirmedMethod = str(values, "confirmedMethod");
  if (!has(CONFIRMED_METHODS, confirmedMethod))
    throw validation("Choose how the return was confirmed.");
  payload.confirmedMethod = confirmedMethod;
  if (!TICKED.includes(values?.shadedPartsCompleted))
    throw validation("Tick that the shaded parts of the return are completed.");
  payload.shadedPartsCompleted = true;
  if (!TICKED.includes(values?.stateForgivenessSet))
    throw validation("Tick that the state forgiveness is set.");
  payload.stateForgivenessSet = true;
  payload.readyForReviewOn = date(values, "readyForReviewOn", "Enter the date the return was ready for review.");
  return payload;
}

const PREPARER_KEYS = Object.freeze([
  "confirmedBy", "confirmedByName", "confirmedMethod", "shadedPartsCompleted",
  "stateForgivenessSet", "readyForReviewOn",
]);

// The preparer keys whose stored answers differ between two versions.
export function changedAnswers(previous, current) {
  const changed = new Set();
  for (const key of PREPARER_KEYS)
    if ((previous?.[key] ?? null) !== (current?.[key] ?? null)) changed.add(key);
  return changed;
}

// ---------------------------------------------------------------------------
// Exit Form (design D3)
// ---------------------------------------------------------------------------

export const GROUP_FIELDS = Object.freeze(["method", "result", "amount", "refundBy", "oweBy", "debitOn"]);

// One group from "<prefix>.<field>" values; null when every field is blank.
function group(values, prefix, name) {
  const field = (key) => str(values, `${prefix}.${key}`);
  if (GROUP_FIELDS.every((key) => !field(key))) return null;
  const method = field("method");
  if (!has(FILING_METHODS, method)) throw validation(`${name}: choose E-file or Paper.`);
  const result = field("result");
  if (!has(RESULTS, result)) throw validation(`${name}: choose Refund, Owe or None.`);
  const out = { method, result };
  if (result === "none") return out;
  const amount = field("amount");
  if (!AMOUNT.test(amount))
    throw validation(`${name}: enter the amount from 0 to 999999.99, with at most two decimals.`);
  out.amount = amount;
  if (result === "refund") {
    const refundBy = field("refundBy");
    if (!has(REFUND_BY, refundBy)) throw validation(`${name}: choose Direct deposit or Check.`);
    out.refundBy = refundBy;
    return out;
  }
  const oweBy = field("oweBy");
  if (!has(OWE_BY, oweBy)) throw validation(`${name}: choose Direct debit or Mail check.`);
  out.oweBy = oweBy;
  if (oweBy === "direct_debit") {
    const debitOn = field("debitOn");
    if (!realDate(debitOn)) throw validation(`${name}: enter the debit date.`);
    out.debitOn = debitOn;
  }
  return out;
}

// Always the three keys the database requires: null for an empty Federal or
// State, [] for no Local entries.
export function exitFormFrom(values) {
  const local = [];
  for (const [type] of LOCAL_TYPES) {
    const entry = group(values, `local.${type}`, `Local ${type}`);
    if (entry) local.push({ type, ...entry });
  }
  return {
    federal: group(values, "federal", "Federal"),
    state: group(values, "state", "State"),
    local,
  };
}

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export function reviewerQuestionnaire(values, service) {
  const payload = {};
  payload.completedOn = date(values, "completedOn", "Enter the date the review was completed.");
  const paForgiveness = str(values, "paForgiveness");
  if (!has(PA_FORGIVENESS, paForgiveness)) throw validation("Choose whether PA forgiveness is eligible.");
  payload.paForgiveness = paForgiveness;

  const wentOver = str(values, "wentOver");
  if (wentOver !== "yes" && wentOver !== "no")
    throw validation("Say whether you went over the return with the client.");
  payload.wentOver = wentOver === "yes";
  if (payload.wentOver) {
    payload.wentOverOn = date(values, "wentOverOn", "Enter the date you went over the return.");
    const how = str(values, "wentOverHow");
    if (how) {
      if (!has(WENT_OVER_HOW, how)) throw validation("Choose how you went over the return.");
      payload.wentOverHow = how;
    }
  }

  const signMethod = str(values, "signMethod");
  if (!has(SIGN_METHODS, signMethod)) throw validation("Choose how the client will sign Form 8879.");
  payload.signMethod = signMethod;
  if (needsAppointment(service, signMethod)) {
    const at = str(values, "signAppointmentAt");
    if (!at) throw validation("Choose the appointment to sign.");
    if (!realDateTime(at)) throw validation("Enter a real date and time for the appointment.");
    payload.signAppointmentAt = at;
  }

  payload.exitForm = exitFormFrom(values);

  const remarks = str(values, "remarks");
  if (remarks) {
    if (remarks.length > 2000) throw validation("Keep the remarks to 2000 characters or fewer.");
    payload.remarks = remarks;
  }
  return payload;
}
