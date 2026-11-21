import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// The corrected values a staff member enters at Return to signing (054) are
// staff work: only a cleared staff member reads them, and no client writes them.
const EMPTY_FORM = { federal: null, state: null, local: [] };

const insertRow = (f, caseId, overrides = {}) => {
  const row = {
    workspace_id: f.workspaceId,
    case_id: caseId,
    entered_by_person_id: f.reviewerId,
    exit_form: JSON.stringify(EMPTY_FORM),
    remarks: null,
    ...overrides,
  };
  const keys = Object.keys(row);
  return f.sql(
    `insert into public.return_to_signing_exit_forms(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((key) => row[key]),
  );
};
const read = (client, caseId) =>
  client.from("return_to_signing_exit_forms").select("*").eq("case_id", caseId);

test("return_to_signing_exit_forms access and checks", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.preparedCase();
    await insertRow(f, caseId);

    await t.test("an applicant reads no corrected values", async () => {
      const { data, error } = await read(f.applicantA, caseId);
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });

    await t.test("a cleared staff member reads them", async () => {
      const { data, error } = await read(f.siteCoordinator, caseId);
      assert.equal(error, null);
      assert.equal(data.length, 1);
    });

    await t.test("an uncleared staff member reads none", async () => {
      const member = await f.staff({
        key: "ulla_uncleared_exit",
        name: "Ulla Brenner",
        capabilities: ["prepare"],
        cleared: false,
      });
      const { data, error } = await read(member.client, caseId);
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });

    await t.test("staff can't insert directly", async () => {
      const { error } = await f.siteCoordinator.from("return_to_signing_exit_forms").insert({
        workspace_id: f.workspaceId,
        case_id: caseId,
        entered_by_person_id: f.reviewerId,
        exit_form: EMPTY_FORM,
      });
      assert.ok(error);
    });

    await t.test("exit_form must pass check_exit_form", async () => {
      await assert.rejects(
        insertRow(f, caseId, {
          exit_form: JSON.stringify({
            federal: {
              method: "efile",
              result: "refund",
              amount: "1.00",
              refundBy: "direct_deposit",
              accountNumber: "1",
            },
            state: null,
            local: [],
          }),
        }),
        rejected("23514"),
      );
    });

    await t.test("remarks over 2000 characters are refused", async () => {
      await assert.rejects(insertRow(f, caseId, { remarks: "x".repeat(2001) }), rejected("23514"));
      await assert.rejects(insertRow(f, caseId, { remarks: "" }), rejected("23514"));
    });
  } finally {
    await f.close();
  }
});

// The action itself (054): corrected values ride on RETURN_TO_SIGNING.
const FEDERAL = { method: "paper", result: "refund", amount: "1250.00", refundBy: "direct_deposit" };
const STATE = { method: "efile", result: "refund", amount: "85.00", refundBy: "check" };
const FILLED = {
  exitForm: { federal: FEDERAL, state: STATE, local: [{ type: "NPT", method: "paper", result: "none" }] },
  remarks: "Corrected dependent SSN",
};

test("RETURN_TO_SIGNING carries and stores corrected Exit Form values", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const nyDay = async () =>
      (await f.sql("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
    const act = (caseId, type, payload, client = f.siteCoordinator) => f.act(client, caseId, type, payload);
    // A case filed with `methods`, federal rejected and any other return accepted.
    const rejectedCase = async (methods) => {
      const caseId = await f.approvedCase();
      for (const task of (
        await f.sql(
          "select id from public.admin_followups where case_id=$1 and purpose='go_over_return' and status='open'",
          [caseId],
        )
      ).rows)
        await act(caseId, "RESOLVE_FOLLOWUP", {
          followupId: task.id,
          outcome: "reached",
          note: "Fictional: went over the return by phone.",
        });
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await act(caseId, "MARK_EFILED", { confirmed: true, methods });
      const day = await nyDay();
      const results = { federal: { result: "rejected", date: day, code: "C1" } };
      if (methods.state) results.state = { result: "accepted", date: day };
      await act(caseId, "RECORD_FILING_RESULT", { confirmed: true, results });
      return caseId;
    };
    const stage = async (caseId) =>
      (await f.sql("select stage from public.cases where id=$1", [caseId])).rows[0].stage;
    const rows = async (caseId) =>
      (await f.sql("select * from public.return_to_signing_exit_forms where case_id=$1", [caseId])).rows;
    const detail = async (caseId) =>
      (
        await f.sql(
          "select detail from public.case_events where case_id=$1 and action='RETURN_TO_SIGNING' order by created_at desc, id desc limit 1",
          [caseId],
        )
      ).rows[0].detail;
    const both = { federal: "efile", state: "efile" };

    await t.test("no values: nothing stored, detail empty", async () => {
      const caseId = await rejectedCase(both);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      assert.equal(await stage(caseId), "review_approved");
      assert.equal((await rows(caseId)).length, 0);
      assert.deepEqual(await detail(caseId), {});
    });

    await t.test("empty values store nothing", async () => {
      const caseId = await rejectedCase(both);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true, exitForm: EMPTY_FORM });
      assert.equal(await stage(caseId), "review_approved");
      assert.equal((await rows(caseId)).length, 0);
      assert.deepEqual(await detail(caseId), {});
    });

    await t.test("values are stored once and linked", async () => {
      const caseId = await rejectedCase(both);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true, ...FILLED });
      assert.equal(await stage(caseId), "review_approved");
      const stored = await rows(caseId);
      assert.equal(stored.length, 1);
      assert.deepEqual(stored[0].exit_form, FILLED.exitForm);
      assert.equal(stored[0].remarks, FILLED.remarks);
      assert.equal(stored[0].entered_by_person_id, f.siteCoordinatorId);
      assert.deepEqual(await detail(caseId), { exitFormId: stored[0].id });
    });

    await t.test("remarks are trimmed when stored", async () => {
      const caseId = await rejectedCase(both);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true, remarks: "  Corrected dependent SSN  " });
      const stored = await rows(caseId);
      assert.equal(stored[0].remarks, "Corrected dependent SSN");
    });

    await t.test("remarks alone are stored", async () => {
      const caseId = await rejectedCase(both);
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true, remarks: "Only a note" });
      const stored = await rows(caseId);
      assert.equal(stored.length, 1);
      assert.deepEqual(stored[0].exit_form, EMPTY_FORM);
      assert.equal(stored[0].remarks, "Only a note");
    });

    await t.test("a settled method can't change", async () => {
      const caseId = await rejectedCase(both);
      await assert.rejects(
        () =>
          act(caseId, "RETURN_TO_SIGNING", {
            confirmed: true,
            exitForm: { ...FILLED.exitForm, state: { ...STATE, method: "paper" } },
          }),
        rejected("VALIDATION"),
      );
      assert.equal(await stage(caseId), "rejected");
      assert.equal((await rows(caseId)).length, 0);
    });

    await t.test("no group for a missing return", async () => {
      // The methods are paired, so no filed case lacks a return; the guard is
      // defensive, and a rejected case with no filing is set up directly.
      const caseId = await rejectedCase(both);
      await f.sql(
        "update public.cases set federal_method=null, state_method=null, federal_result=null, state_result=null where id=$1",
        [caseId],
      );
      await assert.rejects(
        () => act(caseId, "RETURN_TO_SIGNING", { confirmed: true, exitForm: { ...FILLED.exitForm, federal: null } }),
        rejected("VALIDATION"),
      );
      assert.equal(await stage(caseId), "rejected");
      assert.equal((await rows(caseId)).length, 0);
    });

    await t.test("banking details, bad amounts and unknown keys are refused", async () => {
      const caseId = await rejectedCase(both);
      const bad = [
        { exitForm: { ...FILLED.exitForm, federal: { ...FEDERAL, accountNumber: "1" } } },
        { exitForm: { ...FILLED.exitForm, federal: { ...FEDERAL, amount: "12.345" } } },
        { ...FILLED, extra: 1 },
        { ...FILLED, remarks: "x".repeat(2001) },
      ];
      for (const extra of bad)
        await assert.rejects(() => act(caseId, "RETURN_TO_SIGNING", { confirmed: true, ...extra }), rejected("VALIDATION"));
      assert.equal(await stage(caseId), "rejected");
      assert.equal((await rows(caseId)).length, 0);
    });

    await t.test("a volunteer can't return to signing", async () => {
      const caseId = await rejectedCase(both);
      await assert.rejects(
        () => act(caseId, "RETURN_TO_SIGNING", { confirmed: true, ...FILLED }, f.preparer),
        rejected("FORBIDDEN"),
      );
      assert.equal(await stage(caseId), "rejected");
      assert.equal((await rows(caseId)).length, 0);
    });
  } finally {
    await f.close();
  }
});
