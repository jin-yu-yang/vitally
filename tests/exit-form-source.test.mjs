import test from "node:test";
import assert from "node:assert/strict";
import { RETURN_TO_SIGNING_NOTE_START, exitFormNote, exitFormSource } from "../src/exit-form-source.mjs";

// Fictional data only.
const REVIEW = { id: "review-1", status: "approved", decidedAt: "2026-10-17T15:00:00.000Z" };
const Q = {
  reviewId: "review-1",
  exitForm: {
    federal: { method: "efile", result: "refund", amount: "120.00", refundBy: "direct_deposit" },
    state: { method: "efile", result: "owe", amount: "45.50", oweBy: "direct_debit", debitOn: "2027-04-15" },
    local: [{ type: "NPT", method: "paper", result: "owe", amount: "10.00", oweBy: "check" }],
  },
  remarks: "Looks right.",
};
const RTS = { action: "RETURN_TO_SIGNING", createdAt: "2026-11-02T15:00:00.000Z" };
const caseWith = (over = {}) => ({
  reviews: [REVIEW],
  reviewerQuestionnaires: [Q],
  internalHistory: [],
  federalMethod: "efile",
  stateMethod: "efile",
  federalResult: "accepted",
  stateResult: "accepted",
  ...over,
});
const refiled = (over = {}) =>
  caseWith({ federalResult: "rejected", stateResult: "accepted", internalHistory: [RTS], ...over });
const noteFor = (items) => `${RETURN_TO_SIGNING_NOTE_START}${items.join("; ")}.`;
const REST = ["the federal and Pennsylvania refund or amount owed and how it is paid", "Other Tax", "Remarks"];

test("no Return to signing: the stored questionnaire, no note", () => {
  const source = exitFormSource(caseWith(), REVIEW);
  assert.deepEqual(source, { questionnaire: Q, corrected: false, fillByHand: [] });
  assert.equal(exitFormNote(source), "");
});

test("note prefix is the fixed sentence", () => {
  assert.equal(
    RETURN_TO_SIGNING_NOTE_START,
    "The return was corrected after this review (Return to signing). This form prints only what ViTally holds. Fill in by hand: ",
  );
});

test("returned to signing, federal rejected: state method only", () => {
  const source = exitFormSource(refiled(), REVIEW);
  assert.deepEqual(source.questionnaire, { exitForm: { federal: null, state: { method: "efile" }, local: [] }, remarks: "" });
  assert.equal(source.corrected, true);
  assert.deepEqual(source.fillByHand, ["the federal filing method", ...REST]);
  assert.equal(exitFormNote(source), noteFor(["the federal filing method", ...REST]));
});

test("refiled e-file awaiting an answer is ticked", () => {
  const source = exitFormSource(refiled({ federalResult: null }), REVIEW);
  assert.deepEqual(source.questionnaire.exitForm.federal, { method: "efile" });
  assert.equal(source.fillByHand[0], REST[0]);
});

test("refiled on paper is ticked", () => {
  const source = exitFormSource(refiled({ federalMethod: "paper", federalResult: "given_to_client" }), REVIEW);
  assert.deepEqual(source.questionnaire.exitForm.federal, { method: "paper" });
});

test("a return with no method gets nothing", () => {
  const source = exitFormSource(refiled({ federalMethod: null, stateMethod: null }), REVIEW);
  assert.equal(source.questionnaire.exitForm.federal, null);
  assert.equal(source.questionnaire.exitForm.state, null);
  assert.deepEqual(source.fillByHand, ["the federal filing method", "the Pennsylvania filing method", ...REST]);
});

test("two Returns to signing use the current columns", () => {
  const later = { action: "RETURN_TO_SIGNING", createdAt: "2026-11-20T15:00:00.000Z" };
  const source = exitFormSource(refiled({ internalHistory: [RTS, later], stateResult: "rejected" }), REVIEW);
  assert.equal(source.questionnaire.exitForm.state, null);
});

test("a Return to signing before the approval is ignored", () => {
  const early = { action: "RETURN_TO_SIGNING", createdAt: "2026-10-01T15:00:00.000Z" };
  const source = exitFormSource(caseWith({ internalHistory: [early] }), REVIEW);
  assert.equal(source.corrected, false);
});

test("fail-safe: an approval with no decidedAt counts any Return to signing as later (#173, keep: guards against old values)", () => {
  const review = { ...REVIEW, decidedAt: null };
  const source = exitFormSource(caseWith({ reviews: [review], internalHistory: [RTS] }), review);
  assert.equal(source.corrected, true);
});

test("fail-safe: a record without staff history offers no Exit Form (#173, keep: guards against old values)", () => {
  assert.equal(exitFormSource(caseWith({ internalHistory: undefined }), REVIEW), null);
});

test("null cases", () => {
  assert.equal(exitFormSource(caseWith({ reviewerQuestionnaires: [] }), REVIEW), null);
  assert.equal(exitFormSource(caseWith(), { ...REVIEW, status: "corrections_requested" }), null);
  assert.equal(exitFormSource(caseWith(), null), null);
});
