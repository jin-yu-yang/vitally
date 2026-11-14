// The payload rules for every workflow action a control can dispatch, as one
// pure function (Ruling R50). The wiring layer reads a control's dataset and
// its form's values and hands them here; nothing in this file touches the DOM,
// the controller or the store, so the payload contract can be tested on its
// own and cannot drift into an event handler.
//
// The table below is `contracts-excerpt.md`'s payload table, in the same order.
// Lengths and related-record membership are the database's to enforce — this
// file refuses only what it can know by itself: an unknown action, a missing
// related id, an empty required field and an outcome outside its own list.

import { CASE_ACTIONS, CLOSING_REASONS } from "./contracts.mjs";
import {
  MATERIALS_ITEMS,
  checkValue,
  findQuestion,
  isAnswered,
} from "./intake-catalogue.mjs";
import { preparerQuestionnaire, reviewerQuestionnaire } from "./questionnaires.mjs";

// The one fictional file the demo ever sends (Ruling R18); the database accepts
// no other name.
export const SAMPLE_DOCUMENT_FILENAME = "demo-mileage-record-2025.pdf";

// The review conversation's outcome, and the subset that may resolve an office
// task. (A follow-up contact is logged in the contact log instead.)
export const CONTACT_OUTCOMES = Object.freeze([
  "no_answer",
  "reached",
  "no_further_contact",
  "closure_requested",
]);
export const FOLLOWUP_RESOLUTION_OUTCOMES = Object.freeze([
  "reached",
  "no_further_contact",
]);

// The office's screening checks: what a volunteer really confirms before the
// case goes to preparation. The database accepts exactly these keys, all true.
// Identity is asked only for an online case; any other service, or none, gets
// the three.
const BASE_SCREENING_KEYS = Object.freeze(["phone", "documents", "in_scope"]);
const ONLINE_SCREENING_KEYS = Object.freeze([...BASE_SCREENING_KEYS, "identity"]);
export const screeningCheckKeys = (service) =>
  service === "online" ? ONLINE_SCREENING_KEYS : BASE_SCREENING_KEYS;

export const SCREENING_CHECK_LABELS = Object.freeze({
  phone: "The client can be reached at the phone number on the application.",
  documents:
    "The basic documents are present (photo ID, Social Security or ITIN cards, the income documents on the list).",
  in_scope: "The return is within VITA scope.",
  identity:
    "Identity confirmed: the client's face matches their photo ID (in person or on video), checked by a certified volunteer.",
});

function validation(message) {
  return Object.assign(new Error(message), { code: "VALIDATION" });
}

// A required free-text field. Blank is the same as absent: the database would
// refuse it, and saying so here keeps an empty envelope from being sent.
function text(values, key, label) {
  const value = String(values?.[key] ?? "").trim();
  if (!value) throw validation(`${label} is required.`);
  return value;
}

// A related record's id. The button carries it in its dataset (`data-request-id`
// → `dataset.requestId`); a form may carry it in a hidden field instead.
function relatedId(dataset, values, key, label) {
  const value = String(dataset?.[key] ?? values?.[key] ?? "").trim();
  if (!value) throw validation(`This ${label} is no longer on screen.`);
  return value;
}

function outcome(values, allowed) {
  const value = String(values?.outcome ?? "").trim();
  if (!allowed.includes(value))
    throw validation("Choose what happened on the call.");
  return value;
}

// A ticked checkbox. An unticked one is simply absent from a form's values, but
// a stale or hand-made value must not read as a tick either, so only the three
// spellings a real checkbox produces count.
const TICKED = Object.freeze([true, "true", "on"]);
const ticked = (values, key) => TICKED.includes(values?.[key]);

// Every shown check, or none: the payload has exactly the keys the service
// calls for, all true. A tick left over from a hidden check (identity on a
// case that is not online) is never sent.
function checks(values, service) {
  const result = {};
  for (const key of screeningCheckKeys(service)) {
    if (!ticked(values, key))
      throw validation("Tick every check before recording them.");
    result[key] = true;
  }
  return result;
}

// Closing a case is deliberate: a written reason and an explicit confirmation.
// The flag that leaves is always the literal `true` the contract names — a form
// can withhold the confirmation, never redefine it.
function confirmation(values, message = "Confirm that you want to close this case.") {
  if (!ticked(values, "confirmed")) throw validation(message);
  return true;
}

// A multi-select as a form reports it: one ticked box is a string, several are
// an array, none is absent.
const list = (value) =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

// UPDATE_CONTACT's two keys and the catalogue fields whose rules they follow.
// A phone is never one of them: phones change only through the form.
const CONTACT_KEYS = Object.freeze({
  bestContactTime: "best_contact_time",
  bestContactNote: "best_contact_note",
});

// Only the keys the form carries are sent, so a form with just the note leaves
// the best time alone. Each value passes its catalogue field's own check; a
// blank note or an empty list is sent as null, which clears that field.
function contactUpdate(values) {
  const payload = {};
  for (const [key, fieldId] of Object.entries(CONTACT_KEYS)) {
    if (!Object.hasOwn(values ?? {}, key)) continue;
    const raw = key === "bestContactTime" ? list(values[key]) : values[key];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (!isAnswered(value)) {
      payload[key] = null;
      continue;
    }
    const problem = checkValue(findQuestion(2, fieldId), value);
    if (problem) throw validation(problem);
    payload[key] = value;
  }
  if (!Object.keys(payload).length)
    throw validation("Choose a best time or add a note first.");
  return payload;
}

// The whole set of materials now received, from the catalogue's list. No
// ticked box is the empty set; a repeated item is sent once.
const MATERIAL_IDS = Object.freeze(MATERIALS_ITEMS.map((item) => item.id));
function materialsReceived(values) {
  const received = [...new Set(list(values?.received))];
  if (!received.every((item) => MATERIAL_IDS.includes(item)))
    throw validation("That is not one of the materials on the list.");
  return received;
}

// How the return was filed. A first filing picks one of the
// combinations (the one `filing-combination` radio); filing again offers only
// the returns that were rejected, one `method-federal` / `method-state` choice
// each, and exactly those that arrive are sent. Whether a combination is one
// the office uses is the database's to say.
const FILING_COMBINATIONS = Object.freeze({
  both_efile: { federal: "efile", state: "efile" },
  efile_and_paper: { federal: "efile", state: "paper" },
  paper_and_efile: { federal: "paper", state: "efile" },
  both_paper: { federal: "paper", state: "paper" },
});
const FILING_METHODS = Object.freeze(["efile", "paper"]);
const CHOOSE_METHODS = "Choose how each return was filed.";

function filingMethods(values) {
  const combination = String(values?.["filing-combination"] ?? "").trim();
  if (combination) {
    if (!Object.hasOwn(FILING_COMBINATIONS, combination)) throw validation(CHOOSE_METHODS);
    return { ...FILING_COMBINATIONS[combination] };
  }
  const methods = {};
  for (const kind of ["federal", "state"]) {
    const value = String(values?.[`method-${kind}`] ?? "").trim();
    if (!value) continue;
    if (!FILING_METHODS.includes(value)) throw validation(CHOOSE_METHODS);
    methods[kind] = value;
  }
  if (!Object.keys(methods).length) throw validation(CHOOSE_METHODS);
  return methods;
}

// The answers to the returns waiting. A return left on "no answer yet" (or on a
// value outside the list) is not sent; a rejection needs its reject code; every
// answer needs its date. The date window and who may record are the database's.
const FILING_RESULTS = Object.freeze(["accepted", "rejected"]);

function filingResults(dataset, values) {
  const results = {};
  for (const kind of ["federal", "state"]) {
    const result = String(values?.[`result-${kind}`] ?? "").trim();
    if (!FILING_RESULTS.includes(result)) continue;
    const date = String(values?.[`date-${kind}`] ?? "").trim();
    if (!date) throw validation("A date is required.");
    const entry = { result, date };
    if (result === "rejected") {
      const code = String(values?.[`code-${kind}`] ?? "").trim();
      if (!code) throw validation("A reject code is required.");
      entry.code = code;
    }
    results[kind] = entry;
  }
  if (!Object.keys(results).length)
    throw validation("Record a result for at least one return.");
  const payload = { confirmed: true, results };
  const fixNote = String(values?.["fix-note"] ?? "").trim();
  if (fixNote) {
    // The submit control carries `data-stage`: a case already at Rejected may
    // take a note with a later answer; otherwise the note needs a rejection.
    const rejects = Object.values(results).some((entry) => entry.result === "rejected");
    if (!rejects && dataset?.stage !== "rejected") throw validation("A fix note goes with a rejection.");
    payload.fixNote = fixNote;
  }
  return payload;
}

// The documents the office asks for at intake: up to five title and message
// rows. A row with neither is skipped; a title with no message and a message with
// no title are refused (the database would). At least one row must remain.
function intakeRequests(values) {
  const requests = [];
  for (let n = 1; n <= 5; n += 1) {
    const title = String(values?.[`request-title-${n}`] ?? "").trim();
    if (!title) {
      if (String(values?.[`request-message-${n}`] ?? "").trim()) throw validation(`Add a title for document ${n}.`);
      continue;
    }
    requests.push({ title, message: text(values, `request-message-${n}`, "A message for the client") });
  }
  if (!requests.length) throw validation("Ask for at least one document.");
  return requests;
}

// SAVE_ANSWERS is deliberately absent: it is built by the controller from the
// draft it holds and the revision the edits started at, not from a form.
const BUILDERS = Object.freeze({
  SUBMIT: () => ({ confirmed: true }),
  // The submit control carries `data-service`, like the approve button: it
  // decides whether identity is one of the checks.
  VERIFY_INTAKE: (dataset, values) => ({ checks: checks(values, dataset?.service) }),
  START_SCREENING: () => ({}),
  CLAIM_PREPARATION: () => ({}),
  SUBMIT_REVIEW: (dataset, values) => ({ questionnaire: preparerQuestionnaire(values) }),
  CLAIM_REVIEW: () => ({}),
  // The database checks the slot and the person; only the two fields travel.
  ASSIGN_CASE: (dataset, values) => ({ slot: values?.slot, personId: values?.personId }),
  // The approve button carries `data-service`: the appointment rule needs it.
  APPROVE_REVIEW: (dataset, values) => ({
    questionnaire: reviewerQuestionnaire(values, dataset?.service),
  }),
  REMIND: () => ({}),
  REQUEST_DOCUMENT: (dataset, values) => ({
    title: text(values, "title", "A short title"),
    message: text(values, "message", "A message for the client"),
  }),
  RESPOND_DOCUMENT: (dataset, values) => ({
    requestId: relatedId(dataset, values, "requestId", "request"),
    filename: SAMPLE_DOCUMENT_FILENAME,
  }),
  RECORD_DOCUMENT_RESPONSE: (dataset, values) => ({
    requestId: relatedId(dataset, values, "requestId", "request"),
    filename: SAMPLE_DOCUMENT_FILENAME,
  }),
  VERIFY_DOCUMENT: (dataset, values) => ({
    requestId: relatedId(dataset, values, "requestId", "request"),
  }),
  ESCALATE_CONTACT: (dataset, values) => ({
    requestId: relatedId(dataset, values, "requestId", "request"),
    reason: text(values, "reason", "A reason for the office"),
  }),
  RESOLVE_FOLLOWUP: (dataset, values) => ({
    followupId: relatedId(dataset, values, "followupId", "task"),
    outcome: outcome(values, FOLLOWUP_RESOLUTION_OUTCOMES),
    note: text(values, "note", "A note"),
  }),
  REQUEST_CORRECTIONS: (dataset, values) => ({
    findings: text(values, "findings", "The corrections to make"),
  }),
  RESUBMIT_REVIEW: (dataset, values) => ({
    questionnaire: preparerQuestionnaire(values),
    resolution: text(values, "resolution", "What was corrected"),
  }),
  RECORD_REVIEW_CONTACT: (dataset, values) => ({
    outcome: outcome(values, CONTACT_OUTCOMES),
    note: text(values, "note", "A note"),
  }),
  MARK_READY_TO_EFILE: (dataset, values) => ({
    confirmed: confirmation(values, "Confirm that the client signed Form 8879, or the return will be given to the client on paper."),
  }),
  MARK_EFILED: (dataset, values) => ({
    confirmed: confirmation(values, "Confirm how each return was filed."),
    methods: filingMethods(values),
  }),
  RECORD_FILING_RESULT: (dataset, values) => filingResults(dataset, values),
  RETURN_TO_SIGNING: (dataset, values) => ({
    confirmed: confirmation(values, "Confirm that the fix is done."),
  }),
  REQUEST_DOCUMENTS_AT_INTAKE: (dataset, values) => ({ requests: intakeRequests(values) }),
  PUT_ON_HOLD: (dataset, values) => {
    const note = String(values?.["hold-note"] ?? "").trim();
    return {
      confirmed: confirmation(values, "Confirm that you want to put this case on hold."),
      ...(note ? { note } : {}),
    };
  },
  RESUME_FROM_HOLD: (dataset, values) => ({
    confirmed: confirmation(values, "Confirm that you got in touch with the client."),
  }),
  WITHDRAW: (dataset, values) => {
    if (!ticked(values, "withdraw-confirmed"))
      throw validation("Tick the box to withdraw this application.");
    return { confirmed: true };
  },
  CLOSE_CASE: (dataset, values) => {
    const reason = String(values?.["close-reason"] ?? "").trim();
    if (!CLOSING_REASONS.includes(reason)) throw validation("Choose a reason.");
    const note = String(values?.["close-note"] ?? "").trim();
    if (reason === "other" && !note) throw validation("Add a note for Other.");
    return { confirmed: confirmation(values), reason, ...(note ? { note } : {}) };
  },
  UPDATE_CONTACT: (dataset, values) => contactUpdate(values),
  RECORD_MATERIALS: (dataset, values) => ({ received: materialsReceived(values) }),
});

// Every action this function can build, for tests and for the wiring layer's
// own guard. `SAVE_ANSWERS`, `SET_DOCUMENT_CARD` and `SET_DOCUMENT_GROUP` are
// built by the controller, not by a form.
export const PAYLOAD_ACTIONS = Object.freeze(
  CASE_ACTIONS.filter((type) => Object.hasOwn(BUILDERS, type)),
);

/**
 * Build one action envelope's `{type, payload}` from a control's dataset and
 * the values of the form it sits in.
 *
 * @param {string} type       a canonical name from CASE_ACTIONS
 * @param {object} dataset    the control's `dataset` (camelCased data-* keys)
 * @param {object} formValues the form's named values, e.g. Object.fromEntries(new FormData(form))
 * @returns {{type: string, payload: object}}
 * @throws  {Error} with `code:'VALIDATION'` for an unknown type or a missing
 *          required field. Nothing is sent in that case.
 */
export function payloadFor(type, dataset = {}, formValues = {}) {
  // `hasOwn`, so an inherited property name ("toString") is an unknown action
  // rather than a function to call.
  if (!Object.hasOwn(BUILDERS, type))
    throw validation("This step is not available.");
  return { type, payload: BUILDERS[type](dataset ?? {}, formValues ?? {}) };
}
