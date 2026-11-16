import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { describeStage, CLOSED_AFTER_FILING_NOTICE_REASON } from "../src/domain.mjs";
import { sentence, SENTENCES } from "../src/client-text.mjs";

// Issue #170: a case closed after a return was filed must say what was filed.
// Subtests 1-10 close a real case (Close, or the season-end close) and compare
// the whole stored history line with the expected text, so the arguments both
// call sites pass to closed_line are checked, not only the absence of "not
// filed". The expected lines are literals, not built from src/.
//
// The realistic case comes first: TaxSlayer sends the Pennsylvania return only
// after the federal one is accepted, so what happens is federal accepted,
// Pennsylvania rejected, the client can't be reached to re-sign, and the case
// is closed as Dismissed or by the season-end close. The federal rejected /
// Pennsylvania accepted case (5) proves the two returns aren't swapped.

const REASON = {
  dismissed: "PCDC could not reach you, so this application was closed.",
  withdrawn: "You withdrew this application.",
  out_of_scope: "This application was closed because the return is outside what VITA volunteers can prepare.",
};
const FEDERAL = {
  accepted: "Your federal return was filed and accepted. Do not file it again.",
  not_filed: "Your federal return was not filed.",
};
const STATE = {
  accepted: "Your Pennsylvania return was filed and accepted. Do not file it again.",
  waiting: "Your Pennsylvania return was e-filed and is waiting for an answer. Do not file it again.",
  paper: "PCDC gave you your Pennsylvania return on paper. It is filed only after you mail it.",
  not_filed: "Your Pennsylvania return was not filed.",
};
const expected = (reason, federal, state) => `${REASON[reason]} ${FEDERAL[federal]} ${STATE[state]}`;
const BOTH_EFILED = { federal: "efile", state: "efile" };
const FEDERAL_ACCEPTED_STATE_REJECTED = { federal: "accepted", state: "rejected" };
const FEDERAL_REJECTED_STATE_ACCEPTED = { federal: "rejected", state: "accepted" };

test("closing after a filed return (issue #170)", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const act = (caseId, type, payload) => f.act(f.siteCoordinator, caseId, type, payload);
    const nyDay = async () =>
      (await f.sql("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
    const lastMessage = async (caseId) => (await f.clientMessages(caseId)).at(-1);
    const stage = async (caseId) =>
      (await f.sql("select stage from public.cases where id=$1", [caseId])).rows[0].stage;
    const revision = async (caseId) =>
      Number((await f.sql("select revision from public.cases where id=$1", [caseId])).rows[0].revision);
    // A case filed with `methods`, with the given results recorded (as in
    // database-filing.mjs).
    const answeredCase = async (methods, results) => {
      const caseId = await f.approvedCase();
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await act(caseId, "MARK_EFILED", { confirmed: true, methods });
      const day = await nyDay();
      const body = {};
      for (const [kind, result] of Object.entries(results))
        body[kind] = result === "rejected" ? { result, date: day, code: "C1" } : { result, date: day };
      await act(caseId, "RECORD_FILING_RESULT", { confirmed: true, results: body });
      return caseId;
    };
    // One return rejected and the other accepted, then Return to signing: the
    // case is back at Ready to exit with the accepted return on record.
    const returnedToSigning = async (results = FEDERAL_REJECTED_STATE_ACCEPTED) => {
      const caseId = await answeredCase(BOTH_EFILED, results);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      assert.equal(await stage(caseId), "review_approved");
      return caseId;
    };
    const seasonEndClose = async (caseId) =>
      f.closeUnsigned(f.siteCoordinator, [{ caseId, revision: await revision(caseId) }]);
    const assertFiledLine = async (caseId, want, label) => {
      assert.equal(await stage(caseId), "closed", label);
      assert.equal(await lastMessage(caseId), want, label);
    };

    const realistic = expected("dismissed", "accepted", "not_filed");

    await t.test("1. Federal accepted, Pennsylvania rejected: Dismissed at Rejected", async () => {
      const caseId = await answeredCase(BOTH_EFILED, FEDERAL_ACCEPTED_STATE_REJECTED);
      assert.equal(await stage(caseId), "rejected");
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      await assertFiledLine(caseId, realistic, "Close at Rejected");
    });

    await t.test("2. Federal accepted, Pennsylvania rejected: Return to signing, Hold, Dismissed", async () => {
      const caseId = await returnedToSigning(FEDERAL_ACCEPTED_STATE_REJECTED);
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      await assertFiledLine(caseId, realistic, "Close from Hold");
    });

    await t.test("3. Federal accepted, Pennsylvania rejected: Return to signing, season-end close", async () => {
      const caseId = await returnedToSigning(FEDERAL_ACCEPTED_STATE_REJECTED);
      await seasonEndClose(caseId);
      await assertFiledLine(caseId, realistic, "season-end at Ready to exit");
    });

    await t.test("4. Federal accepted, Pennsylvania rejected: Return to signing, Hold, season-end close", async () => {
      const caseId = await returnedToSigning(FEDERAL_ACCEPTED_STATE_REJECTED);
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await seasonEndClose(caseId);
      await assertFiledLine(caseId, realistic, "season-end from Hold");
    });

    await t.test("5. Federal rejected, Pennsylvania accepted: Withdrawn at Rejected (returns not swapped)", async () => {
      const caseId = await answeredCase(BOTH_EFILED, FEDERAL_REJECTED_STATE_ACCEPTED);
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      await assertFiledLine(caseId, expected("withdrawn", "not_filed", "accepted"), "Withdrawn");
    });

    await t.test("6. Federal rejected, Pennsylvania still waiting: Dismissed", async () => {
      const caseId = await answeredCase(BOTH_EFILED, { federal: "rejected" });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      await assertFiledLine(caseId, expected("dismissed", "not_filed", "waiting"), "waiting");
    });

    await t.test("7. Federal rejected, Pennsylvania on paper: Out of scope", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "paper" }, { federal: "rejected" });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "out_of_scope" });
      await assertFiledLine(caseId, expected("out_of_scope", "not_filed", "paper"), "paper");
    });

    await t.test("8. Federal rejected, Pennsylvania accepted: Return to signing, season-end close", async () => {
      const caseId = await returnedToSigning();
      await seasonEndClose(caseId);
      await assertFiledLine(caseId, expected("dismissed", "not_filed", "accepted"), "season-end");
    });

    await t.test("9. Return to signing, then Withdrawn at Ready to exit", async () => {
      const caseId = await returnedToSigning(FEDERAL_ACCEPTED_STATE_REJECTED);
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      await assertFiledLine(caseId, expected("withdrawn", "accepted", "not_filed"), "Ready to exit");
    });

    await t.test("10. Return to signing, then Withdrawn at Ready to e-file", async () => {
      const caseId = await returnedToSigning(FEDERAL_ACCEPTED_STATE_REJECTED);
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal(await stage(caseId), "ready_to_efile");
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      await assertFiledLine(caseId, expected("withdrawn", "accepted", "not_filed"), "Ready to e-file");
    });

    const noticeReason = async (caseId) =>
      (await f.sql("select reason from public.admin_followups where case_id=$1 and purpose='withdrawal_notice' and status='open'", [caseId])).rows[0]?.reason;

    await t.test("11. Both returns rejected keep today's line", async () => {
      const caseId = await answeredCase(BOTH_EFILED, { federal: "rejected", state: "rejected" });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await lastMessage(caseId), "PCDC could not reach you, so this application was closed. Your return was not filed.");
    });

    await t.test("12. The staff notice after a filing", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await noticeReason(caseId), CLOSED_AFTER_FILING_NOTICE_REASON);
    });

    await t.test("13. The staff notice with nothing filed", async () => {
      const caseId = await f.approvedCase();
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await noticeReason(caseId), "The case was closed before filing; make sure the return is not transmitted in TaxSlayer.");
    });

    await t.test("14. The withdrawn notice after a filing is unchanged", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      assert.equal(await noticeReason(caseId), "The client withdrew; make sure the return is not transmitted in TaxSlayer.");
    });

    await t.test("15. Every combination matches the status panel", async () => {
      const GENERIC = "Your application was closed by the office. This does not change any return filed elsewhere. Contact PCDC if you have questions.";
      const reasons = ["out_of_scope", "no_need_to_file", "duplicate", "dismissed", "withdrawn", "other", null];
      const returns = [["efile", "accepted"], ["efile", null], ["paper", "given_to_client"], ["efile", "rejected"]];
      const states = [[[null, null], [null, null]]];
      for (const fed of returns) for (const st of returns) states.push([fed, st]);
      let calls = 0;
      for (const reason of reasons)
        for (const [[fm, fr], [sm, sr]] of states) {
          const line = (await f.sql("select vitally_private.closed_line($1,$2,$3,$4,$5) as line", [reason, fm, fr, sm, sr])).rows[0].line;
          calls += 1;
          const label = `${reason} federal ${fm}/${fr} state ${sm}/${sr}`;
          if (reason === "other" || reason === null) {
            assert.equal(line, GENERIC, label);
            assert.ok(Object.hasOwn(SENTENCES, line), `${label}: no SENTENCES entry`);
            continue;
          }
          const record = { closingReason: reason, federalMethod: fm, federalResult: fr, stateMethod: sm, stateResult: sr };
          assert.equal(line, describeStage("closed", "en", record).clientMessage, label);
          const hans = sentence(line, "zh-Hans");
          assert.notEqual(hans, line, `${label}: not translated`);
          assert.equal(hans, describeStage("closed", "zh-Hans", record).clientMessage, label);
        }
      assert.equal(calls, 119);
    });
  } finally {
    await f.close();
  }
});
