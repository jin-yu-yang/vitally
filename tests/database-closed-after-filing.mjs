import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { describeStage, CLOSED_AFTER_FILING_NOTICE_REASON } from "../src/domain.mjs";
import { sentence, SENTENCES } from "../src/client-text.mjs";

// Issue #170: a case closed after a return was filed must not tell the client
// that the return was not filed. One subtest per close path that can reach a
// case with a filed return (accepted, still waiting for its answer, or given to
// the client on paper). Each asserts only the negative, so it holds whatever
// wording the fix chooses.

const NOT_FILED = /Your return was not filed|您的报税表未递交/;
const NOT_FILED_REASONS = ["dismissed", "withdrawn", "out_of_scope"];

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
    // Federal rejected, the state return accepted, then Return to signing:
    // the case is back at Ready to exit with an accepted return.
    const returnedToSigning = async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "accepted" });
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      assert.equal(await stage(caseId), "review_approved");
      return caseId;
    };
    const assertFiledLine = async (caseId, label) => {
      assert.equal(await stage(caseId), "closed", label);
      const line = await lastMessage(caseId);
      assert.ok(!NOT_FILED.test(line), `${label}: the client reads "${line}"`);
    };

    for (const reason of NOT_FILED_REASONS)
      await t.test(`1. Close at Rejected, other return accepted, reason ${reason}`, async () => {
        const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "accepted" });
        await act(caseId, "CLOSE_CASE", { confirmed: true, reason });
        await assertFiledLine(caseId, reason);
      });

    for (const reason of NOT_FILED_REASONS)
      await t.test(`2. Close at Rejected, other return still waiting, reason ${reason}`, async () => {
        const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected" });
        await act(caseId, "CLOSE_CASE", { confirmed: true, reason });
        await assertFiledLine(caseId, reason);
      });

    for (const reason of NOT_FILED_REASONS)
      await t.test(`3. Close at Rejected, other return given to the client on paper, reason ${reason}`, async () => {
        const caseId = await answeredCase({ federal: "efile", state: "paper" }, { federal: "rejected" });
        await act(caseId, "CLOSE_CASE", { confirmed: true, reason });
        await assertFiledLine(caseId, reason);
      });

    await t.test("4. Return to signing, then close at Ready to exit (withdrawn)", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      await assertFiledLine(caseId, "withdrawn");
    });

    await t.test("5. Return to signing, then close at Ready to e-file (withdrawn)", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal(await stage(caseId), "ready_to_efile");
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      await assertFiledLine(caseId, "withdrawn");
    });

    for (const reason of NOT_FILED_REASONS)
      await t.test(`6. Return to signing, Hold, then close the Hold, reason ${reason}`, async () => {
        const caseId = await returnedToSigning();
        await act(caseId, "PUT_ON_HOLD", { confirmed: true });
        await act(caseId, "CLOSE_CASE", { confirmed: true, reason });
        await assertFiledLine(caseId, reason);
      });

    await t.test("7. Return to signing, then the season-end close at Ready to exit", async () => {
      const caseId = await returnedToSigning();
      await f.closeUnsigned(f.siteCoordinator, [{ caseId, revision: await revision(caseId) }]);
      await assertFiledLine(caseId, "season-end");
    });

    await t.test("8. Return to signing, Hold, then the season-end close", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await f.closeUnsigned(f.siteCoordinator, [{ caseId, revision: await revision(caseId) }]);
      await assertFiledLine(caseId, "season-end from Hold");
    });

    const noticeReason = async (caseId) =>
      (await f.sql("select reason from public.admin_followups where case_id=$1 and purpose='withdrawal_notice' and status='open'", [caseId])).rows[0]?.reason;

    await t.test("9. Both returns rejected keep today's line", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "rejected" });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await lastMessage(caseId), "PCDC could not reach you, so this application was closed. Your return was not filed.");
    });

    await t.test("10. The staff notice after a filing", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await noticeReason(caseId), CLOSED_AFTER_FILING_NOTICE_REASON);
    });

    await t.test("11. The staff notice with nothing filed", async () => {
      const caseId = await f.approvedCase();
      await act(caseId, "PUT_ON_HOLD", { confirmed: true });
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "dismissed" });
      assert.equal(await noticeReason(caseId), "The case was closed before filing; make sure the return is not transmitted in TaxSlayer.");
    });

    await t.test("12. The withdrawn notice after a filing is unchanged", async () => {
      const caseId = await returnedToSigning();
      await act(caseId, "CLOSE_CASE", { confirmed: true, reason: "withdrawn" });
      assert.equal(await noticeReason(caseId), "The client withdrew; make sure the return is not transmitted in TaxSlayer.");
    });

    await t.test("13. Every combination matches the status panel", async () => {
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
