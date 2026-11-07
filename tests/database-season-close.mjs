import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// Migration 037: the season-end close of unsigned cases.

const LINE =
  "PCDC could not reach you, so this application was closed. Your return was not filed.";

test("season-end close against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const row = async (caseId) =>
      (
        await f.sql(
          "select stage, closing_reason, hold_origin, revision from public.cases where id=$1",
          [caseId],
        )
      ).rows[0];
    const entry = async (caseId) => ({ caseId, revision: Number((await row(caseId)).revision) });
    const hold = (caseId) =>
      f.act(f.siteCoordinator, caseId, "PUT_ON_HOLD", { confirmed: true });
    const close = (cases, opts) => f.closeUnsigned(f.siteCoordinator, cases, opts);
    const events = async (caseId) =>
      (
        await f.sql(
          "select detail from public.case_events where case_id=$1 and action='CLOSE_CASE'",
          [caseId],
        )
      ).rows;
    const count = async (sql, caseId) => Number((await f.sql(sql, [caseId])).rows[0].count);

    await t.test("closes signing cases as dismissed", async () => {
      const ready = await f.approvedCase({ wentOver: false });
      const held = await f.approvedCase();
      await hold(held);
      await f.sql(
        "insert into public.document_requests(workspace_id,case_id,title,message,requested_by_person_id) values($1,$2,'Fictional paper','A fictional note.',$3)",
        [f.workspaceId, ready, f.preparerId],
      );
      assert.equal(
        await count("select count(*) from public.admin_followups where case_id=$1 and status='open'", ready),
        1,
      );
      assert.equal((await row(held)).hold_origin, "review_approved");
      await close([await entry(ready), await entry(held)]);
      for (const id of [ready, held]) {
        const r = await row(id);
        assert.equal(r.stage, "closed");
        assert.equal(r.closing_reason, "dismissed");
        assert.equal((await f.clientMessages(id)).at(-1), LINE);
        const ev = await events(id);
        assert.equal(ev.length, 1);
        assert.deepEqual(ev[0].detail, { reason: "dismissed", seasonEnd: true });
        assert.equal(
          await count(
            "select count(*) from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
            id,
          ),
          0,
        );
      }
      assert.equal(
        await count("select count(*) from public.admin_followups where case_id=$1 and status='open'", ready),
        0,
      );
      assert.equal(
        await count("select count(*) from public.document_requests where case_id=$1 and status='cancelled'", ready),
        1,
      );
    });

    await t.test("all or nothing", async () => {
      const wrongStages = {
        ready_to_efile: "update public.cases set stage='ready_to_efile' where id=$1",
        rejected: "update public.cases set stage='rejected' where id=$1",
        awaiting_documents:
          "update public.cases set stage='awaiting_documents', documents_origin='screening' where id=$1",
        hold_of_documents:
          "update public.cases set stage='on_hold', hold_origin='awaiting_documents', documents_origin='screening' where id=$1",
      };
      const good = await f.approvedCase();
      const heldGood = await f.approvedCase();
      await hold(heldGood);
      const stale = await f.approvedCase();
      const staleEntry = { ...(await entry(stale)), revision: 999 };
      await assert.rejects(
        async () => close([await entry(good), staleEntry]),
        rejected("CONFLICT"),
      );
      for (const [name, sql] of Object.entries(wrongStages)) {
        const bad = await f.approvedCase();
        await f.sql(sql, [bad]);
        const before = await row(bad);
        await assert.rejects(
          async () => close([await entry(good), await entry(heldGood), await entry(bad)]),
          rejected("CONFLICT"),
          name,
        );
        assert.deepEqual(await row(bad), before);
      }
      assert.equal((await row(good)).stage, "review_approved");
      assert.equal((await row(heldGood)).stage, "on_hold");
      assert.equal((await row(stale)).stage, "review_approved");
      assert.equal((await events(good)).length, 0);
      assert.equal((await f.clientMessages(good)).includes(LINE), false);
    });

    await t.test("refusals", async () => {
      const a = await f.approvedCase();
      const ea = await entry(a);
      await assert.rejects(() => close([]), rejected("VALIDATION"));
      await assert.rejects(() => close([ea, ea]), rejected("VALIDATION"));
      await assert.rejects(() => close([ea], { confirmed: false }), rejected("VALIDATION"));
      await assert.rejects(() => close([{ ...ea, extra: 1 }]), rejected("VALIDATION"));
      await assert.rejects(() => close([{ caseId: "nope", revision: 1 }]), rejected("VALIDATION"));
      await assert.rejects(() => f.closeUnsigned(f.preparer, [ea]), rejected("FORBIDDEN"));
      await assert.rejects(() => f.closeUnsigned(f.applicantA, [ea]), rejected("FORBIDDEN"));
      assert.equal((await row(a)).stage, "review_approved");
    });

    await t.test("replay", async () => {
      const a = await f.approvedCase();
      const b = await f.approvedCase();
      const cases = [await entry(a), await entry(b)];
      const actionId = randomUUID();
      const first = await close(cases, { actionId });
      const second = await close(cases, { actionId });
      assert.deepEqual(second, first);
      for (const id of [a, b]) assert.equal((await events(id)).length, 1);
    });

    await t.test("receipt", async () => {
      const a = await f.approvedCase();
      const b = await f.approvedCase();
      const cases = [await entry(a), await entry(b)];
      const actionId = randomUUID();
      const receipt = await close(cases, { actionId });
      assert.equal(receipt.actionId, actionId);
      assert.equal(receipt.cases.length, 2);
      for (const c of cases) {
        const got = receipt.cases.find((x) => x.caseId === c.caseId);
        const ref = (await f.sql("select reference from public.cases where id=$1", [c.caseId]))
          .rows[0].reference;
        assert.deepEqual(got, { caseId: c.caseId, reference: ref, revision: c.revision + 1 });
      }
    });

    await t.test("only listed cases", async () => {
      const a = await f.approvedCase();
      const left = await f.approvedCase();
      await close([await entry(a)]);
      assert.equal((await row(a)).stage, "closed");
      assert.equal((await row(left)).stage, "review_approved");
    });
  } finally {
    await f.close();
  }
});
