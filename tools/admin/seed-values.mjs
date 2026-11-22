// The fictional values the local seed sends through the public RPCs. The
// shapes are copied from the database suites (tests/support/database-fixture.mjs,
// tests/database-filing.mjs, tests/database-hold.mjs); tools never import tests.
import { makeSampleAnswers } from "../../src/sample-data.mjs";

// One fictional client name per seeded case.
const CLIENT_NAMES = Object.freeze([
  ["Lena", "Okafor"],
  ["Marcus", "Delgado"],
  ["Priya", "Sandoval"],
  ["Theo", "Nakamura"],
  ["Ines", "Whitford"],
  ["Gabriel", "Osei"],
  ["Hana", "Kowalski"],
  ["Rafael", "Lindqvist"],
  ["Nora", "Achterberg"],
  ["Diego", "Fairbanks"],
  ["Yuki", "Morrow"],
]);

// The sample answers, renamed so each seeded case reads as its own client.
export function caseAnswers(index) {
  const [first, last] = CLIENT_NAMES[index % CLIENT_NAMES.length];
  const answers = makeSampleAnswers({ seed: index });
  return {
    ...answers,
    tp_first_name: first,
    tp_last_name: last,
    hh: answers.hh.map((member) => ({ ...member, last_name: last })),
    vc_tp_signature: `${first} ${last}`,
  };
}

// The screening checks the office records: three for every case, and
// identity only for an online one.
export const screeningChecks = (service) => ({
  phone: true,
  documents: true,
  in_scope: true,
  ...(service === "online" ? { identity: true } : {}),
});

const TODAY = () => new Date().toISOString().slice(0, 10);
export const PREPARER_QUESTIONNAIRE = Object.freeze({
  confirmedBy: "client",
  confirmedMethod: "phone",
  shadedPartsCompleted: true,
  stateForgivenessSet: true,
  readyForReviewOn: TODAY(),
});
export const REVIEWER_QUESTIONNAIRE = Object.freeze({
  completedOn: TODAY(),
  paForgiveness: "eligible",
  wentOver: true,
  wentOverOn: TODAY(),
  wentOverHow: "phone",
  signMethod: "portal",
  exitForm: Object.freeze({ federal: null, state: null, local: [] }),
});

export const DOCUMENT_REQUEST = Object.freeze({
  title: "Mileage record",
  message: "Please send the fictional mileage log.",
});
export const ESCALATION_REASON = "No response to the document request.";
export const CORRECTION_FINDINGS = "Recheck the fictional mileage entry.";

export const FILING_METHODS = Object.freeze({ federal: "efile", state: "efile" });
export const REJECT_CODE = "IND-031-04";
// RECORD_FILING_RESULT's `results`, for a result date (YYYY-MM-DD, New York).
export const acceptedResults = (date) => ({
  federal: { result: "accepted", date },
  state: { result: "accepted", date },
});
export const stateRejectedResults = (date) => ({
  federal: { result: "accepted", date },
  state: { result: "rejected", date, code: REJECT_CODE },
});

export const INTAKE_REQUESTS = Object.freeze([
  Object.freeze({ title: "Photo ID", message: "A fictional note." }),
]);
export const HOLD = Object.freeze({ confirmed: true });

// The one help request. No action creates help requests, so it is inserted.
export const HELP_REQUEST = Object.freeze({
  title: "Client needs help completing intake forms",
  language: "Mandarin",
  contactPreference: "Prefers calls from the main office",
});

// The starter labels the seed puts on rehearsal cases, by scenario. Only open
// cases: a closed case (rejected, accepted, withdrawn) refuses label changes.
export const CASE_LABEL_ASSIGNMENTS = Object.freeze([
  Object.freeze({ scenario: "preparation_ready", labels: Object.freeze(["City Tax"]) }),
  Object.freeze({
    scenario: "waiting_documents",
    labels: Object.freeze(["MFS", "Multi-state"]),
  }),
  Object.freeze({ scenario: "review_ready", labels: Object.freeze(["Multi-state"]) }),
]);

// The four role accounts' clearance, which `npm run seed:local` saves before
// anything acts as one of them: the current-season role, its confirmed
// certificates, and not new. The Site Coordinator is a site coordinator
// (add-season-settings), so it needs SC as well to be cleared (design D6).
export const ROLE_ACCOUNT_CLEARANCE = Object.freeze({
  site_coordinator: Object.freeze({ roles: ["admin"], certificates: ["vsc", "itqr", "sc"], isNew: false }),
  preparer: Object.freeze({ roles: ["preparer"], certificates: ["vsc", "itqr", "basic"], isNew: false }),
  reviewer: Object.freeze({ roles: ["reviewer"], certificates: ["vsc", "itqr", "advanced"], isNew: false }),
  intaker: Object.freeze({ roles: ["intaker"], certificates: ["vsc", "itqr"], isNew: false }),
});

// The Roster volunteers `npm run seed:local` adds for a rehearsal. All fictional;
// the fourth and seventh have no phone. Every role is backed by its
// certificates. Priya Venkat is new with the photo ID check recorded, Jordan
// Reyes is new without it, and Lucy Fong has no roles and no certificates (she
// is waiting for her Form 13615).
export const SEED_VOLUNTEERS = Object.freeze([
  Object.freeze({
    name: "Maya Lindgren",
    usualDays: [2, 4],
    email: "volunteer-01@example.org",
    phone: "(215) 555-0141",
    works: "on_site",
    languages: ["english"],
    otherLanguage: null,
    roles: ["preparer"],
    certificates: ["vsc", "itqr", "basic"],
    isNew: false,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Tomas Abara",
    usualDays: [6],
    email: "volunteer-02@example.org",
    phone: "(215) 555-0142",
    works: "remote",
    languages: ["english", "other"],
    otherLanguage: "Spanish",
    roles: ["reviewer"],
    certificates: ["vsc", "itqr", "advanced"],
    isNew: false,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Wen Tao Liu",
    usualDays: [2, 6],
    email: "volunteer-03@example.org",
    phone: "(215) 555-0143",
    works: "on_site",
    languages: ["mandarin", "english"],
    otherLanguage: null,
    roles: ["preparer", "reviewer"],
    certificates: ["vsc", "itqr", "basic", "advanced"],
    isNew: false,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Priya Venkat",
    usualDays: [4],
    email: "volunteer-04@example.org",
    phone: null,
    works: "on_site_and_remote",
    languages: ["english"],
    otherLanguage: null,
    roles: ["intaker"],
    certificates: ["vsc", "itqr"],
    isNew: true,
    photoIdChecked: true,
  }),
  Object.freeze({
    name: "Jordan Reyes",
    email: "volunteer-05@example.org",
    phone: "(215) 555-0145",
    works: "on_site",
    languages: ["english"],
    otherLanguage: null,
    roles: ["greeter"],
    certificates: ["vsc"],
    isNew: true,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Hana Moretti",
    usualDays: [6],
    email: "volunteer-06@example.org",
    phone: "(215) 555-0146",
    works: "remote",
    languages: ["cantonese", "mandarin"],
    otherLanguage: null,
    roles: ["preparer"],
    certificates: ["vsc", "itqr", "basic"],
    isNew: false,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Samir Haddad",
    email: "volunteer-07@example.org",
    phone: null,
    works: "on_site",
    languages: ["english", "other"],
    otherLanguage: "Arabic",
    roles: ["admin"],
    certificates: ["vsc", "itqr", "sc"],
    isNew: false,
    photoIdChecked: false,
  }),
  Object.freeze({
    name: "Lucy Fong",
    email: "volunteer-08@example.org",
    phone: "(215) 555-0148",
    works: "on_site_and_remote",
    languages: ["cantonese", "english"],
    otherLanguage: null,
    roles: [],
    certificates: [],
    isNew: false,
    photoIdChecked: false,
  }),
]);

// The schedule `npm run seed:local` fills (change add-volunteer-schedule,
// design D12). Site hours are ISO weekday keys ("2" is Tuesday), saved only
// when the workspace never saved any; the targets are the defaults.
export const SEED_SITE_HOURS = Object.freeze({
  2: Object.freeze({ open: 17, close: 20 }),
  4: Object.freeze({ open: 17, close: 20 }),
  6: Object.freeze({ open: 10, close: 16 }),
});
export const SEED_SCHEDULE_TARGETS = Object.freeze({
  preparersNeeded: 2,
  reviewersNeeded: 1,
  onSiteNeeded: 1,
});

// About six shifts in the current New York week. `who` is a role account's
// person key or a SEED_VOLUNTEERS email (no sign-in); `weekday` is the
// preferred ISO weekday, with another open day used when it is closed. A shift
// covers the whole open day, except a Saturday's, which covers only the first
// half so a later Saturday hour is left with a gap.
export const SEED_SHIFTS = Object.freeze([
  Object.freeze({ who: "preparer", role: "preparer", weekday: 2 }),
  Object.freeze({ who: "reviewer", role: "reviewer", weekday: 2 }),
  Object.freeze({ who: "volunteer-01@example.org", role: "preparer", weekday: 4 }),
  Object.freeze({ who: "intaker", role: "intaker", weekday: 4 }),
  Object.freeze({ who: "preparer", role: "preparer", weekday: 6 }),
  Object.freeze({ who: "volunteer-03@example.org", role: "reviewer", weekday: 6 }),
]);
