import test from "node:test";
import assert from "node:assert/strict";
import { RETURN_TO_SIGNING_NOTE_START, exitFormNote, exitFormSource, latestReturnToSigning, plannedMethod } from "../src/exit-form-source.mjs";

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

// Stored corrected values (#203).
const F = {
  federal: { method: "paper", result: "refund", amount: "1250.00", refundBy: "direct_deposit" },
  state: { method: "efile", result: "refund", amount: "85.00", refundBy: "check" },
  local: [{ type: "NPT", method: "paper", result: "none" }],
};
const withValues = (over = {}, row = {}) =>
  refiled({
    internalHistory: [{ ...RTS, detail: { exitFormId: "x1" } }],
    returnToSigningExitForms: [{ id: "x1", exitForm: F, remarks: "Corrected dependent SSN", ...row }],
    ...over,
  });
const STORED = "The return was corrected after this review (Return to signing). This form was filled from the corrected values recorded on November 2, 2026.";

test("stored values are printed", () => {
  const source = exitFormSource(withValues(), REVIEW);
  assert.deepEqual(source.questionnaire.exitForm.federal, F.federal);
  assert.equal(source.questionnaire.exitForm.state.method, "efile");
  assert.deepEqual(source.questionnaire.exitForm.local, F.local);
  assert.equal(source.questionnaire.remarks, "Corrected dependent SSN");
  assert.equal(source.corrected, true);
  assert.deepEqual(source.fillByHand, []);
  assert.equal(source.recordedAt, RTS.createdAt);
  assert.equal(exitFormNote(source), STORED);
});

test("the case's method wins once settled", () => {
  const source = exitFormSource(withValues({ federalMethod: "efile", federalResult: null }), REVIEW);
  assert.equal(source.questionnaire.exitForm.federal.method, "efile");
  assert.equal(source.questionnaire.exitForm.federal.amount, "1250.00");
});

test("the latest Return to signing decides", () => {
  const later = { action: "RETURN_TO_SIGNING", createdAt: "2026-11-20T15:00:00.000Z", detail: {} };
  const source = exitFormSource(
    withValues({ internalHistory: [{ ...RTS, detail: { exitFormId: "x1" } }, later] }),
    REVIEW,
  );
  assert.deepEqual(source.questionnaire, { exitForm: { federal: null, state: { method: "efile" }, local: [] }, remarks: "" });
  assert.deepEqual(source.fillByHand, ["the federal filing method", ...REST]);
  assert.equal(source.recordedAt, null);
});

test("only the gaps are listed", () => {
  const source = exitFormSource(withValues({}, { exitForm: { federal: F.federal, state: null, local: [] }, remarks: "" }), REVIEW);
  assert.deepEqual(source.fillByHand, ["the Pennsylvania refund or amount owed and how it is paid", "Remarks"]);
  assert.equal(
    exitFormNote(source),
    `${STORED} Fill in by hand: the Pennsylvania refund or amount owed and how it is paid; Remarks.`,
  );
});

test("remarks only: every return with a method lists its gaps, in order", () => {
  const source = exitFormSource(
    withValues({ federalMethod: "efile", federalResult: "rejected" }, { exitForm: { federal: null, state: null, local: [] }, remarks: "x" }),
    REVIEW,
  );
  assert.deepEqual(source.fillByHand, [
    "the federal filing method",
    "the federal refund or amount owed and how it is paid",
    "the Pennsylvania refund or amount owed and how it is paid",
  ]);
});

test("rejected return without a group lists its method and amount", () => {
  const source = exitFormSource(withValues({}, { exitForm: { federal: null, state: F.state, local: [] } }), REVIEW);
  assert.deepEqual(source.fillByHand.slice(0, 2), [
    "the federal filing method",
    "the federal refund or amount owed and how it is paid",
  ]);
});

test("nothing missing: no fill-by-hand sentence", () => {
  assert.doesNotMatch(exitFormNote(exitFormSource(withValues(), REVIEW)), /Fill in by hand/);
});

test("a federal-only case never lists Pennsylvania", () => {
  const source = exitFormSource(
    withValues({ stateMethod: null, stateResult: null }, { exitForm: { federal: F.federal, state: null, local: [] }, remarks: "" }),
    REVIEW,
  );
  assert.deepEqual(source.fillByHand, ["Remarks"]);
  assert.ok(!source.fillByHand.some((i) => /Pennsylvania/.test(i)));
});

test("missing returnToSigningExitForms counts as none", () => {
  const record = refiled({ internalHistory: [{ ...RTS, detail: { exitFormId: "x1" } }] });
  const source = exitFormSource(record, REVIEW);
  assert.deepEqual(source.fillByHand, ["the federal filing method", ...REST]);
  assert.equal(latestReturnToSigning(record).values, null);
});

test("plannedMethod", () => {
  assert.equal(plannedMethod(withValues(), "federal"), "paper");
  assert.equal(plannedMethod(withValues(), "state"), null);
  assert.equal(plannedMethod(refiled(), "federal"), null);
});
