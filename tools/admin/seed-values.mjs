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
