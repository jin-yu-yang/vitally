import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// Migration 035: the stages after E-filed (rejected, accepted), the cases'
// filing columns, and the three staff-only filing tables.

test("filing results schema against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const setStage = (caseId, stage) =>
      f.sql("update public.cases set stage=$2 where id=$1", [caseId, stage]);
    const setColumns = (caseId, set) =>
      f.sql(`update public.cases set ${set} where id=$1`, [caseId]);

    await t.test("the stage check accepts rejected and accepted", async () => {
      const { caseId } = await f.submittedClientCase();
      await setStage(caseId, "rejected");
      await setStage(caseId, "accepted");
      await assert.rejects(() => setStage(caseId, "acknowledged"));
    });

    await t.test("method and result constraints", async () => {
      const { caseId } = await f.submittedClientCase();
      for (const set of [
        "federal_method='efile'",
        "state_method='efile'",
        "federal_method='efile', state_method='efile', federal_result='given_to_client'",
        "federal_method='efile', state_method='paper', state_result='mailed'",
        "federal_method='paper', state_method='paper', federal_result='accepted'",
        "federal_result='accepted'",
        "state_result='rejected'",
      ])
        await assert.rejects(() => setColumns(caseId, set), set);
      for (const set of [
        "federal_method='efile', state_method='efile'",
        "federal_method='efile', state_method='paper'",
        "federal_method='paper', state_method='efile'",
        "federal_method='paper', state_method='paper'",
        "federal_method='paper', state_method='paper', federal_result='given_to_client', state_result='given_to_client'",
        "federal_method='efile', state_method='efile', federal_result='accepted', state_result='rejected'",
      ])
        await setColumns(caseId, set);
    });

    await t.test("filing tables are staff-only", async () => {
      const { caseId } = await f.submittedClientCase();
      const inserts = {
        filing_attempts:
          "insert into public.filing_attempts(workspace_id,case_id,attempt,filed_by) values($1,$2,1,$3)",
        filing_returns:
          "insert into public.filing_returns(workspace_id,case_id,attempt,return_kind,method) values($1,$2,1,'federal','efile')",
        filing_notes:
          "insert into public.filing_notes(workspace_id,case_id,attempt,note,recorded_by) values($1,$2,1,'Fictional fix note.',$3)",
      };
      await f.sql(inserts.filing_attempts, [f.workspaceId, caseId, f.siteCoordinatorId]);
      await f.sql(inserts.filing_returns, [f.workspaceId, caseId]);
      await f.sql(inserts.filing_notes, [f.workspaceId, caseId, f.siteCoordinatorId]);
      for (const table of Object.keys(inserts)) {
        const applicant = await f.applicantA.from(table).select("*").eq("case_id", caseId);
        assert.equal(applicant.error, null, table);
        assert.deepEqual(applicant.data, [], table);
        const staff = await f.presenter.from(table).select("*").eq("case_id", caseId);
        assert.equal(staff.error, null, table);
        assert.equal(staff.data.length, 1, table);
        // A complete, otherwise-valid row, so only the missing insert grant can refuse it.
        const row = {
          filing_attempts: { attempt: 2, filed_by: f.siteCoordinatorId },
          filing_returns: { attempt: 1, return_kind: "state", method: "efile" },
          filing_notes: { attempt: 1, note: "Fictional second note.", recorded_by: f.siteCoordinatorId },
        }[table];
        for (const client of [f.applicantA, f.presenter]) {
          const { error } = await client
            .from(table)
            .insert({ workspace_id: f.workspaceId, case_id: caseId, ...row });
          assert.ok(error, `${table} insert`);
          assert.equal(error.code, "42501", `${table} insert is a permission refusal: ${error.message}`);
        }
        const total = await f.sql(`select count(*)::int n from public.${table} where case_id=$1`, [caseId]);
        assert.equal(total.rows[0].n, 1, `${table} unchanged`);
      }
    });

    await t.test("fix notes are append-only", async () => {
      const { caseId } = await f.submittedClientCase();
      await f.sql("insert into public.filing_attempts(workspace_id,case_id,attempt,filed_by) values($1,$2,1,$3)", [
        f.workspaceId,
        caseId,
        f.siteCoordinatorId,
      ]);
      await f.sql(
        "insert into public.filing_notes(workspace_id,case_id,attempt,note,recorded_by) values($1,$2,1,'Fictional fix note.',$3)",
        [f.workspaceId, caseId, f.siteCoordinatorId],
      );
      await assert.rejects(() =>
        f.sql("update public.filing_notes set note='Changed' where case_id=$1", [caseId]),
      );
      await assert.rejects(() => f.sql("delete from public.filing_notes where case_id=$1", [caseId]));
      const update = await f.presenter.from("filing_notes").update({ note: "Changed" }).eq("case_id", caseId);
      const del = await f.presenter.from("filing_notes").delete().eq("case_id", caseId);
      const after = await f.sql("select note from public.filing_notes where case_id=$1", [caseId]);
      assert.ok(update.error || after.rows[0].note === "Fictional fix note.");
      assert.ok(del.error || after.rows.length === 1);
      assert.deepEqual(after.rows, [{ note: "Fictional fix note." }]);
    });
  } finally {
    await f.close();
  }
});

test("fix notes go only with their case", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const withNote = async () => {
      const { caseId } = await f.submittedClientCase();
      await f.sql("insert into public.filing_attempts(workspace_id,case_id,attempt,filed_by) values($1,$2,1,$3)", [
        f.workspaceId,
        caseId,
        f.siteCoordinatorId,
      ]);
      await f.sql(
        "insert into public.filing_notes(workspace_id,case_id,attempt,note,recorded_by) values($1,$2,1,'Fictional fix note.',$3)",
        [f.workspaceId, caseId, f.siteCoordinatorId],
      );
      return caseId;
    };
    const noteCount = async (caseId) =>
      (await f.sql("select count(*)::int n from public.filing_notes where case_id=$1", [caseId])).rows[0].n;

    // A fix note made the way staff make one: Record filing result on a rejection.
    const withRecordedNote = async (fixture) => {
      const caseId = await fixture.approvedCase();
      const act = (type, payload) => fixture.act(fixture.siteCoordinator, caseId, type, payload);
      await act("MARK_READY_TO_EFILE", { confirmed: true });
      await act("MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
      const day = (await fixture.sql("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
      await act("RECORD_FILING_RESULT", {
        confirmed: true,
        results: {
          federal: { result: "accepted", date: day },
          state: { result: "rejected", date: day, code: "IND-031-04" },
        },
        fixNote: "Fictional note: correct the dependent's SSN.",
      });
      return caseId;
    };

    await t.test("deleting a filing attempt alone is refused and keeps the note", async () => {
      const caseId = await withNote();
      await assert.rejects(
        () => f.sql("delete from public.filing_attempts where case_id=$1", [caseId]),
        rejected("VALIDATION"),
      );
      assert.equal(await noteCount(caseId), 1);
    });

    await t.test("a filing note can't be deleted on its own", async () => {
      const caseId = await withRecordedNote(f);
      await assert.rejects(
        () => f.sql("delete from public.filing_notes where case_id=$1", [caseId]),
        rejected("VALIDATION"),
      );
      assert.equal(await noteCount(caseId), 1);
    });

    await t.test("deleting the case removes its notes", async () => {
      const caseId = await withNote();
      await f.sql("delete from public.cases where id=$1", [caseId]);
      assert.equal(await noteCount(caseId), 0);
    });

    await t.test("deleting a case with filing notes succeeds", async () => {
      const caseId = await withRecordedNote(f);
      assert.equal(await noteCount(caseId), 1);
      await f.sql("delete from public.cases where id=$1", [caseId]);
      assert.equal(await noteCount(caseId), 0);
      const left = await f.sql(
        "select (select count(*) from public.filing_attempts where case_id=$1)::int attempts, (select count(*) from public.filing_returns where case_id=$1)::int returns",
        [caseId],
      );
      assert.deepEqual(left.rows, [{ attempts: 0, returns: 0 }]);
    });

    await t.test("a workspace teardown with filing notes succeeds", async () => {
      // A second fixture's own cleanup path deletes its workspace, notes included.
      const other = await createDatabaseFixture();
      let caseId;
      try {
        caseId = await withRecordedNote(other);
        assert.equal(await noteCount(caseId), 1);
      } finally {
        await other.close();
      }
      assert.equal(await noteCount(caseId), 0);
      const gone = await f.sql("select count(*)::int n from public.workspaces where id=$1", [other.workspaceId]);
      assert.equal(gone.rows[0].n, 0);
    });

    await t.test("deleting the workspace removes its notes", async () => {
      const caseId = await withNote();
      await f.sql("delete from public.workspaces where id=$1", [f.workspaceId]);
      assert.equal(await noteCount(caseId), 0);
    });
  } finally {
    await f.close();
  }
});

// Task 2: Mark e-filed records each return's method (first filing).
test("mark e-filed records the methods", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const readyCase = async () => {
      const caseId = await f.approvedCase();
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      return caseId;
    };
    const filed = async (caseId, methods) =>
      f.act(f.siteCoordinator, caseId, "MARK_EFILED", { confirmed: true, methods });
    const columns = async (caseId) =>
      (
        await f.sql(
          "select stage, federal_method, state_method, federal_result, state_result from public.cases where id=$1",
          [caseId],
        )
      ).rows[0];

    for (const [federal, state, line] of [
      ["efile", "efile", "PCDC e-filed your return."],
      ["efile", "paper", "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."],
      ["paper", "efile", "PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."],
      ["paper", "paper", "PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them."],
    ])
      await t.test(`${federal}/${state} is recorded and told`, async () => {
        const caseId = await readyCase();
        await filed(caseId, { federal, state });
        const given = (m) => (m === "paper" ? "given_to_client" : null);
        assert.deepEqual(await columns(caseId), {
          stage: federal === "paper" && state === "paper" ? "accepted" : "efiled",
          federal_method: federal,
          state_method: state,
          federal_result: given(federal),
          state_result: given(state),
        });
        const attempts = await f.sql("select attempt, filed_by from public.filing_attempts where case_id=$1", [caseId]);
        assert.deepEqual(attempts.rows, [{ attempt: 1, filed_by: f.siteCoordinatorId }]);
        const returns = await f.sql(
          "select return_kind, method, result from public.filing_returns where case_id=$1 and attempt=1 order by return_kind",
          [caseId],
        );
        assert.deepEqual(returns.rows, [
          { return_kind: "federal", method: federal, result: given(federal) },
          { return_kind: "state", method: state, result: given(state) },
        ]);
        assert.equal((await f.clientMessages(caseId)).at(-1), line);
        const staff = await f.readStaffCase(caseId);
        assert.deepEqual(staff.internalHistory.at(-1).detail, {
          attempt: 1,
          methods: { federal, state },
        });
      });

    await t.test("methods are required, paired and closed", async () => {
      const caseId = await readyCase();
      for (const payload of [
        { confirmed: true },
        { confirmed: true, methods: { federal: "efile" } },
        { confirmed: true, methods: { state: "efile" } },
        { confirmed: true, methods: {} },
        { confirmed: true, methods: { federal: "fax", state: "efile" } },
        { confirmed: true, methods: { federal: "efile", state: "efile", extra: "efile" } },
        { confirmed: true, methods: { federal: "efile", state: "efile" }, extra: 1 },
      ])
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "MARK_EFILED", payload),
          rejected("VALIDATION"),
          JSON.stringify(payload),
        );
      assert.equal((await columns(caseId)).stage, "ready_to_efile");
      const attempts = await f.sql("select count(*)::int n from public.filing_attempts where case_id=$1", [caseId]);
      assert.equal(attempts.rows[0].n, 0);
    });

    await t.test("the line helpers", async () => {
      const line = async (sql, params) => (await f.sql(sql, params)).rows[0].l;
      const filing = (a, b) =>
        line("select vitally_private.filing_line($1::text,$2::text) l", [a, b]);
      assert.equal(await filing("waiting", "waiting"), "Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted.");
      assert.equal(await filing("accepted", "accepted"), "The IRS and Pennsylvania accepted your returns.");
      assert.equal(await filing("rejected", "rejected"), "Your federal and Pennsylvania returns need a correction before they can be accepted.");
      assert.equal(await filing("given_to_client", "given_to_client"), "PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.");
      assert.equal(await filing("accepted", null), "The IRS accepted your federal return.");
      assert.equal(await filing(null, "accepted"), "Pennsylvania accepted your Pennsylvania return.");
      assert.equal(await filing("waiting", null), "Your federal return was e-filed. The IRS will confirm whether it is accepted.");
      assert.equal(await filing(null, "rejected"), "Your Pennsylvania return needs a correction before it can be accepted.");
      assert.equal(await filing(null, "given_to_client"), "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      assert.equal(
        await filing("accepted", "rejected"),
        "The IRS accepted your federal return. Your Pennsylvania return needs a correction before it can be accepted.",
      );
      assert.equal(await filing(null, null), null);
      const efiled = (a, b, second) =>
        line("select vitally_private.efiled_line($1::text,$2::text,$3::boolean) l", [a, b, second]);
      assert.equal(await efiled("efile", "efile", true), "PCDC e-filed your return.");
      assert.equal(await efiled("efile", null, true), "PCDC e-filed your federal return.");
      assert.equal(await efiled("paper", null, true), "PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      assert.equal(await efiled(null, "efile", true), "PCDC e-filed your Pennsylvania return.");
      assert.equal(await efiled(null, "paper", true), "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      assert.equal(await efiled("efile", "paper", false), "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      assert.equal(await efiled("paper", "efile", false), "PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      assert.equal(await efiled("paper", "paper", false), "PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.");
      // Second filings of one return, and the combinations no filing produces.
      assert.equal(await efiled("efile", null, true), "PCDC e-filed your federal return.");
      assert.equal(await efiled(null, null, false), null);
    });
  } finally {
    await f.close();
  }
});

// Task 4: Return to signing, the second filing, and Close.
test("return to signing and file again", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const nyDay = async () =>
      (await f.sql("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
    const act = (caseId, type, payload, client = f.siteCoordinator) =>
      f.act(client, caseId, type, payload);
    const columns = async (caseId) =>
      (
        await f.sql(
          "select stage, federal_method, state_method, federal_result, state_result from public.cases where id=$1",
          [caseId],
        )
      ).rows[0];
    const lastMessage = async (caseId) => (await f.clientMessages(caseId)).at(-1);
    // A case filed with `methods`, with the given results recorded.
    const answeredCase = async (methods, results, opts = {}) => {
      const caseId = await f.approvedCase(opts);
      // A "no" approval opens the office's go-over follow-up; signing waits for it.
      for (const task of (
        await f.sql(
          "select id, assignee_person_id from public.admin_followups where case_id=$1 and purpose='go_over_return' and status='open'",
          [caseId],
        )
      ).rows)
        await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
          followupId: task.id,
          outcome: "reached",
          note: "Fictional: went over the return by phone.",
        });
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await act(caseId, "MARK_EFILED", { confirmed: true, methods });
      const day = await nyDay();
      const body = {};
      for (const [kind, result] of Object.entries(results))
        body[kind] = result === "rejected" ? { result, date: day, code: "C1" } : { result, date: day };
      await act(caseId, "RECORD_FILING_RESULT", { confirmed: true, results: body });
      return caseId;
    };
    const back = async (caseId) => {
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
    };

    await t.test("return to signing waits for every answer", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected" });
      await assert.rejects(() => act(caseId, "RETURN_TO_SIGNING", { confirmed: true }), rejected("INVALID_TRANSITION"));
      assert.equal((await columns(caseId)).stage, "rejected");
      await act(caseId, "RECORD_FILING_RESULT", {
        confirmed: true,
        results: { state: { result: "accepted", date: await nyDay() } },
      });
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      assert.deepEqual(await columns(caseId), {
        stage: "review_approved",
        federal_method: "efile",
        state_method: "efile",
        federal_result: "rejected",
        state_result: "accepted",
      });
      assert.equal(await lastMessage(caseId), "PCDC corrected your return. You need to sign it again.");
      for (const payload of [{}, { confirmed: false }, { confirmed: true, extra: 1 }])
        await assert.rejects(() => act(caseId, "RETURN_TO_SIGNING", payload), rejected("VALIDATION"));
    });

    await t.test("only from rejected", async () => {
      const ready = await f.approvedCase();
      await assert.rejects(() => act(ready, "RETURN_TO_SIGNING", { confirmed: true }), rejected("INVALID_TRANSITION"));
      const accepted = await answeredCase(
        { federal: "efile", state: "efile" },
        { federal: "accepted", state: "accepted" },
      );
      await assert.rejects(
        () => act(accepted, "RETURN_TO_SIGNING", { confirmed: true }),
        rejected("INVALID_TRANSITION"),
      );
    });

    await t.test("the second signing is not held up", async () => {
      const caseId = await answeredCase(
        { federal: "efile", state: "efile" },
        { federal: "rejected", state: "accepted" },
        { wentOver: false },
      );
      // The go-over follow-up of the first signing, resolved before the first MARK_READY_TO_EFILE.
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await columns(caseId)).stage, "ready_to_efile");
    });

    await t.test("filing again", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "accepted", state: "rejected" });
      await back(caseId);
      await assert.rejects(
        () => act(caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } }),
        rejected("VALIDATION"),
      );
      for (const methods of [{}, { federal: "paper" }, { federal: "efile", state: "paper" }])
        await assert.rejects(
          () => act(caseId, "MARK_EFILED", { confirmed: true, methods }),
          rejected("VALIDATION"),
          JSON.stringify(methods),
        );
      assert.equal((await columns(caseId)).stage, "ready_to_efile");
      await act(caseId, "MARK_EFILED", { confirmed: true, methods: { state: "paper" } });
      assert.deepEqual(await columns(caseId), {
        stage: "accepted",
        federal_method: "efile",
        state_method: "paper",
        federal_result: "accepted",
        state_result: "given_to_client",
      });
      assert.equal(
        await lastMessage(caseId),
        "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
      );
      const attempts = await f.sql(
        "select attempt, filed_by from public.filing_attempts where case_id=$1 order by attempt",
        [caseId],
      );
      assert.deepEqual(attempts.rows, [
        { attempt: 1, filed_by: f.siteCoordinatorId },
        { attempt: 2, filed_by: f.siteCoordinatorId },
      ]);
      const returns = await f.sql(
        "select attempt, return_kind, method, result from public.filing_returns where case_id=$1 order by attempt, return_kind",
        [caseId],
      );
      assert.deepEqual(returns.rows, [
        { attempt: 1, return_kind: "federal", method: "efile", result: "accepted" },
        { attempt: 1, return_kind: "state", method: "efile", result: "rejected" },
        { attempt: 2, return_kind: "state", method: "paper", result: "given_to_client" },
      ]);
      assert.deepEqual((await f.readStaffCase(caseId)).internalHistory.at(-1).detail, {
        attempt: 2,
        methods: { state: "paper" },
      });
      // The case is Accepted with no return waiting, so nothing more is recorded.
      await assert.rejects(
        async () =>
          act(caseId, "RECORD_FILING_RESULT", {
            confirmed: true,
            results: { state: { result: "accepted", date: await nyDay() } },
          }),
        rejected("INVALID_TRANSITION"),
      );
    });

    await t.test("second filing on paper completes the case", async () => {
      const caseId = await answeredCase(
        { federal: "efile", state: "efile" },
        { federal: "accepted", state: "rejected" },
      );
      await back(caseId);
      await assert.rejects(
        () => act(caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "paper" } }),
        rejected("VALIDATION"),
      );
      await act(caseId, "MARK_EFILED", { confirmed: true, methods: { state: "paper" } });
      const c = await columns(caseId);
      assert.deepEqual([c.stage, c.federal_result, c.state_result], ["accepted", "accepted", "given_to_client"]);
      const lines = await f.clientMessages(caseId);
      assert.equal(
        lines.at(-1),
        "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.",
      );
      assert.equal(lines.filter((l) => l.startsWith("PCDC gave")).length, 1);
    });

    await t.test("both returns rejected are filed together", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "rejected" });
      await back(caseId);
      await assert.rejects(
        () => act(caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile" } }),
        rejected("VALIDATION"),
      );
      await act(caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
      assert.deepEqual(await columns(caseId), {
        stage: "efiled",
        federal_method: "efile",
        state_method: "efile",
        federal_result: null,
        state_result: null,
      });
      assert.equal(await lastMessage(caseId), "PCDC e-filed your return.");
    });

    for (const [name, first, results, methods, line] of [
      ["federal e-file", { federal: "efile", state: "efile" }, { federal: "rejected", state: "accepted" }, { federal: "efile" }, "PCDC e-filed your federal return."],
      ["federal paper", { federal: "efile", state: "paper" }, { federal: "rejected" }, { federal: "paper" }, "PCDC gave your federal return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."],
      ["state e-file", { federal: "efile", state: "efile" }, { federal: "accepted", state: "rejected" }, { state: "efile" }, "PCDC e-filed your Pennsylvania return."],
      ["state paper", { federal: "efile", state: "efile" }, { federal: "accepted", state: "rejected" }, { state: "paper" }, "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it."],
    ])
      await t.test(`second filing line: ${name}`, async () => {
        const caseId = await answeredCase(first, results);
        await back(caseId);
        await act(caseId, "MARK_EFILED", { confirmed: true, methods });
        assert.equal(await lastMessage(caseId), line);
      });

    await t.test("refiling an accepted return is refused", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "accepted" });
      await back(caseId);
      await assert.rejects(
        () => act(caseId, "MARK_EFILED", { confirmed: true, methods: { state: "paper" } }),
        rejected("VALIDATION"),
      );
      assert.deepEqual(await columns(caseId), {
        stage: "ready_to_efile",
        federal_method: "efile",
        state_method: "efile",
        federal_result: "rejected",
        state_result: "accepted",
      });
      const n = await f.sql("select count(*)::int n from public.filing_attempts where case_id=$1", [caseId]);
      assert.equal(n.rows[0].n, 1);
    });

    await t.test("close", async () => {
      const closing = { confirmed: true, reason: "withdrawn" };
      const rej = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected" });
      await act(rej, "CLOSE_CASE", closing);
      assert.equal((await columns(rej)).stage, "closed");
      const acc = await answeredCase({ federal: "efile", state: "efile" }, { federal: "accepted", state: "accepted" });
      await assert.rejects(() => act(acc, "CLOSE_CASE", closing), rejected("INVALID_TRANSITION"));
      assert.equal((await columns(acc)).stage, "accepted");
    });

    await t.test("admin only", async () => {
      const caseId = await answeredCase({ federal: "efile", state: "efile" }, { federal: "rejected", state: "accepted" });
      for (const client of [f.preparer, f.reviewer, f.presenter, f.applicantA])
        await assert.rejects(
          () => act(caseId, "RETURN_TO_SIGNING", { confirmed: true }, client),
          rejected("FORBIDDEN"),
        );
      assert.equal((await columns(caseId)).stage, "rejected");
    });
  } finally {
    await f.close();
  }
});

// Task 3: Admins record each return's filing result.
test("record filing result", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const nyDay = async (offset = 0) =>
      (
        await f.sql("select ((now() at time zone 'America/New_York')::date + $1::int)::text d", [offset])
      ).rows[0].d;
    const filedCase = async (methods = { federal: "efile", state: "efile" }) => {
      const caseId = await f.approvedCase();
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await f.act(f.siteCoordinator, caseId, "MARK_EFILED", { confirmed: true, methods });
      return caseId;
    };
    const record = (caseId, results, extra = {}, client = f.siteCoordinator) =>
      f.act(client, caseId, "RECORD_FILING_RESULT", { confirmed: true, results, ...extra });
    const columns = async (caseId) =>
      (
        await f.sql(
          "select stage, federal_method, state_method, federal_result, state_result from public.cases where id=$1",
          [caseId],
        )
      ).rows[0];
    const lastMessage = async (caseId) => (await f.clientMessages(caseId)).at(-1);
    const counts = async (caseId) =>
      (
        await f.sql(
          `select (select count(*)::int from public.filing_returns where case_id=$1 and result is not null) answered,
                  (select count(*)::int from public.filing_notes where case_id=$1) notes,
                  (select count(*)::int from public.case_events where case_id=$1 and action='RECORD_FILING_RESULT') events`,
          [caseId],
        )
      ).rows[0];

    await t.test("one answer at a time", async () => {
      const caseId = await filedCase();
      const today = await nyDay();
      await record(caseId, { federal: { result: "accepted", date: today } });
      const c = await columns(caseId);
      assert.equal(c.stage, "efiled");
      assert.equal(c.federal_result, "accepted");
      assert.equal(c.state_result, null);
      assert.equal(await lastMessage(caseId), "The IRS accepted your federal return.");
      await record(caseId, { state: { result: "accepted", date: today } });
      assert.equal((await columns(caseId)).stage, "accepted");
      assert.equal(await lastMessage(caseId), "Pennsylvania accepted your Pennsylvania return.");
    });

    await t.test("a rejection doesn't wait", async () => {
      const caseId = await filedCase();
      const today = await nyDay();
      await record(caseId, { federal: { result: "rejected", date: today, code: "IND-031-04" } });
      assert.equal((await columns(caseId)).stage, "rejected");
      assert.equal(await lastMessage(caseId), "Your federal return needs a correction before it can be accepted.");
      await record(caseId, { state: { result: "accepted", date: today } });
      assert.equal((await columns(caseId)).stage, "rejected");
    });

    await t.test("both in one move", async () => {
      const today = await nyDay();
      const both = await filedCase();
      await record(both, { federal: { result: "accepted", date: today }, state: { result: "accepted", date: today } });
      assert.equal((await columns(both)).stage, "accepted");
      assert.equal(await lastMessage(both), "The IRS and Pennsylvania accepted your returns.");
      const mixed = await filedCase();
      await record(mixed, {
        federal: { result: "accepted", date: today },
        state: { result: "rejected", date: today, code: "PA-REJ-1" },
      });
      assert.equal((await columns(mixed)).stage, "rejected");
      assert.equal(
        await lastMessage(mixed),
        "The IRS accepted your federal return. Your Pennsylvania return needs a correction before it can be accepted.",
      );
      const detail = (await f.readStaffCase(mixed)).internalHistory.at(-1).detail;
      assert.deepEqual(detail, { attempt: 1, results: { federal: "accepted", state: "rejected" }, noteAdded: false });
    });

    await t.test("paper is given to the client at Mark e-filed", async () => {
      const caseId = await filedCase({ federal: "efile", state: "paper" });
      const c = await columns(caseId);
      assert.equal(c.stage, "efiled");
      assert.equal(c.state_result, "given_to_client");
      const row = (await f.sql("select result, answered_on, recorded_by from public.filing_returns where case_id=$1 and return_kind='state'", [caseId])).rows[0];
      assert.deepEqual([row.result, row.answered_on, row.recorded_by], ["given_to_client", null, f.siteCoordinatorId]);
      assert.equal(await lastMessage(caseId),
        "PCDC e-filed your federal return and gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
      for (const result of ["accepted", "mailed", "given_to_client"])
        await assert.rejects(async () => record(caseId, { state: { result, date: await nyDay() } }), rejected("VALIDATION"));
      await record(caseId, { federal: { result: "accepted", date: await nyDay() } });
      assert.equal((await columns(caseId)).stage, "accepted");
    });
    await t.test("both paper goes straight to Accepted, with one line", async () => {
      const caseId = await filedCase({ federal: "paper", state: "paper" });
      assert.equal((await columns(caseId)).stage, "accepted");
      const lines = await f.clientMessages(caseId);
      assert.equal(lines.at(-1), "PCDC gave your returns on paper to you or the person you sent. If they aren't signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.");
      assert.equal(lines.filter((l) => l.startsWith("PCDC gave")).length, 1);
    });
    await t.test("federal paper with state e-file is accepted", async () => {
      const caseId = await filedCase({ federal: "paper", state: "efile" });
      const c = await columns(caseId);
      assert.deepEqual([c.stage, c.federal_result, c.state_result], ["efiled", "given_to_client", null]);
      assert.equal(await lastMessage(caseId),
        "PCDC gave your federal return on paper to you or the person you sent, and e-filed your Pennsylvania return. If the federal return isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.");
    });
    await t.test("a first filing missing a return is refused", async () => {
      const caseId = await f.approvedCase();
      await f.act(f.siteCoordinator, caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await assert.rejects(() => f.act(f.siteCoordinator, caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile" } }), rejected("VALIDATION"));
    });
    await t.test("stored mailed is renamed", async () => {
      // A 035-style row (the checks dropped, as before 037) holds mailed with a date;
      // 037's section 1 is run again and renames it, clearing the date.
      const { readFileSync } = await import("node:fs");
      const file = readFileSync(new URL("../supabase/migrations/037_adjust_filing_to_pcdc.sql", import.meta.url), "utf8");
      const section = file.split("-- 037 §1 begin")[1].split("-- 037 §1 end")[0];
      const { caseId } = await f.submittedClientCase();
      await f.sql("begin");
      try {
        await f.sql("alter table public.cases drop constraint if exists cases_filing_results");
        await f.sql("alter table public.filing_returns drop constraint if exists filing_returns_result_check");
        await f.sql("update public.cases set federal_method='paper',state_method='paper',federal_result='mailed',state_result='mailed' where id=$1", [caseId]);
        await f.sql("insert into public.filing_attempts(workspace_id,case_id,attempt,filed_by) values($1,$2,1,$3)", [f.workspaceId, caseId, f.siteCoordinatorId]);
        await f.sql("insert into public.filing_returns(workspace_id,case_id,attempt,return_kind,method,result,answered_on) values($1,$2,1,'federal','paper','mailed',current_date),($1,$2,1,'state','paper','mailed',current_date)", [f.workspaceId, caseId]);
        await f.sql("set constraints all immediate"); // the seed's deferred keys are checked before the ALTERs
        await f.sql(section);
        await f.sql(section); // and once more: re-applying changes nothing
        const c = (await f.sql("select federal_result, state_result from public.cases where id=$1", [caseId])).rows[0];
        assert.deepEqual(c, { federal_result: "given_to_client", state_result: "given_to_client" });
        const rows = (await f.sql("select result, answered_on from public.filing_returns where case_id=$1", [caseId])).rows;
        assert.deepEqual(rows, [{ result: "given_to_client", answered_on: null }, { result: "given_to_client", answered_on: null }]);
      } finally {
        await f.sql("rollback");
      }
    });

    await t.test("refusals", async () => {
      const today = await nyDay();
      const caseId = await filedCase();
      const ok = { result: "accepted", date: today };
      const bad = [
        ["empty results", { results: {} }],
        ["blank code", { results: { federal: { result: "rejected", date: today, code: "   " } } }],
        ["empty code", { results: { federal: { result: "rejected", date: today, code: "" } } }],
        ["missing code", { results: { federal: { result: "rejected", date: today } } }],
        ["41-char code", { results: { federal: { result: "rejected", date: today, code: "x".repeat(41) } } }],
        ["code on accepted", { results: { federal: { ...ok, code: "IND-1" } } }],
        ["tomorrow", { results: { federal: { ...ok, date: await nyDay(1) } } }],
        ["before filing", { results: { federal: { ...ok, date: await nyDay(-1) } } }],
        ["non-ISO date", { results: { federal: { ...ok, date: "03/04/2026" } } }],
        ["impossible date", { results: { federal: { ...ok, date: "2026-02-30" } } }],
        ["note at efiled", { results: { federal: ok }, fixNote: "Fictional note." }],
        ["note stays at accepted", { results: { federal: ok, state: ok }, fixNote: "Fictional note." }],
        ["long note", { results: { federal: { result: "rejected", date: today, code: "C1" } }, fixNote: "n".repeat(1001) }],
        ["unknown return", { results: { local: ok } }],
        ["unknown result", { results: { federal: { result: "pending", date: today } } }],
        ["extra key", { results: { federal: { ...ok, extra: 1 } } }],
      ];
      for (const [name, body] of bad)
        await assert.rejects(
          () => f.act(f.siteCoordinator, caseId, "RECORD_FILING_RESULT", { confirmed: true, ...body }),
          rejected("VALIDATION"),
          name,
        );
      await assert.rejects(
        () => f.act(f.siteCoordinator, caseId, "RECORD_FILING_RESULT", { results: { federal: ok } }),
        rejected("VALIDATION"),
        "no confirmed",
      );
      assert.deepEqual(await counts(caseId), { answered: 0, notes: 0, events: 0 });
      assert.deepEqual(await columns(caseId), {
        stage: "efiled",
        federal_method: "efile",
        state_method: "efile",
        federal_result: null,
        state_result: null,
      });
      // A return already answered (the second of two identical calls).
      await record(caseId, { federal: ok });
      await assert.rejects(() => record(caseId, { federal: ok }), rejected("VALIDATION"));
      await assert.rejects(() => record(caseId, { federal: ok, state: ok }), rejected("VALIDATION"));
      assert.deepEqual(await counts(caseId), { answered: 1, notes: 0, events: 1 });
      assert.equal((await columns(caseId)).state_result, null);
    });

    await t.test("only at efiled, or at rejected with a waiting return", async () => {
      const today = await nyDay();
      const ready = await f.approvedCase();
      await assert.rejects(
        () => record(ready, { federal: { result: "accepted", date: today } }),
        rejected("INVALID_TRANSITION"),
      );
      const caseId = await filedCase();
      await record(caseId, {
        federal: { result: "rejected", date: today, code: "C1" },
        state: { result: "rejected", date: today, code: "C2" },
      });
      await assert.rejects(
        () => record(caseId, { federal: { result: "accepted", date: today } }),
        rejected("INVALID_TRANSITION"),
      );
    });

    await t.test("the date window is PCDC's day", async () => {
      const src = (await f.sql("select prosrc from pg_proc where proname='act_record_filing_result'")).rows[0].prosrc;
      assert.ok(src.includes("(now() at time zone 'America/New_York')::date"));
    });

    await t.test("fix notes are appended", async () => {
      const today = await nyDay();
      const caseId = await filedCase();
      await record(
        caseId,
        { federal: { result: "rejected", date: today, code: "  IND-031-04 " } },
        { fixNote: "Fictional note one." },
      );
      let notes = await f.sql(
        "select note, attempt, recorded_by from public.filing_notes where case_id=$1 order by recorded_at",
        [caseId],
      );
      assert.deepEqual(notes.rows, [{ note: "Fictional note one.", attempt: 1, recorded_by: f.siteCoordinatorId }]);
      const row = await f.sql(
        "select answered_on::text d, reject_code, recorded_by, result from public.filing_returns where case_id=$1 and return_kind='federal'",
        [caseId],
      );
      assert.deepEqual(row.rows, [{ d: today, reject_code: "IND-031-04", recorded_by: f.siteCoordinatorId, result: "rejected" }]);
      assert.equal((await f.readStaffCase(caseId)).internalHistory.at(-1).detail.noteAdded, true);
      await record(caseId, { state: { result: "accepted", date: today } }, { fixNote: "Fictional note two." });
      notes = await f.sql("select note from public.filing_notes where case_id=$1 order by recorded_at", [caseId]);
      assert.deepEqual(notes.rows, [{ note: "Fictional note one." }, { note: "Fictional note two." }]);
      for (const message of await f.clientMessages(caseId)) {
        assert.ok(!message.includes("IND-031-04"), message);
        assert.ok(!message.includes("Fictional note"), message);
      }
      const history = JSON.stringify((await f.readStaffCase(caseId)).internalHistory);
      assert.ok(!history.includes("IND-031-04") && !history.includes("Fictional note"));
    });

    await t.test("admin only", async () => {
      const today = await nyDay();
      const caseId = await filedCase();
      const results = { federal: { result: "accepted", date: today } };
      for (const client of [f.preparer, f.reviewer, f.presenter, f.applicantA])
        await assert.rejects(() => record(caseId, results, {}, client), rejected("FORBIDDEN"));
      assert.deepEqual(await counts(caseId), { answered: 0, notes: 0, events: 0 });
    });

    await t.test("an older e-filed case", async () => {
      const today = await nyDay();
      const old = async () => {
        const caseId = await filedCase();
        await f.sql("delete from public.filing_attempts where case_id=$1", [caseId]);
        await f.sql("update public.cases set federal_method=null, state_method=null where id=$1", [caseId]);
        // Filed ten days ago, before 035.
        await f.sql(
          "update public.case_events set created_at=now()-interval '10 days' where case_id=$1 and action='MARK_EFILED'",
          [caseId],
        );
        return caseId;
      };
      const caseId = await old();
      // The filing is credited to whoever marked it E-filed, not to the admin recording the answer.
      await f.sql(
        "update public.case_events set actor_person_id=$2 where case_id=$1 and action='MARK_EFILED'",
        [caseId, f.preparerId],
      );
      await record(caseId, {
        federal: { result: "accepted", date: await nyDay(-5) },
        state: { result: "accepted", date: today },
      });
      assert.deepEqual(await columns(caseId), {
        stage: "accepted",
        federal_method: "efile",
        state_method: "efile",
        federal_result: "accepted",
        state_result: "accepted",
      });
      const attempt = await f.sql(
        "select attempt, filed_by, filed_at < now()-interval '9 days' old from public.filing_attempts where case_id=$1",
        [caseId],
      );
      assert.deepEqual(attempt.rows, [{ attempt: 1, filed_by: f.preparerId, old: true }]);
      // The bound still holds: an answer dated before the filing is refused.
      const other = await old();
      const eleven = await nyDay(-11);
      await assert.rejects(
        () => record(other, { federal: { result: "accepted", date: eleven } }),
        rejected("VALIDATION"),
      );
      assert.equal((await columns(other)).federal_method, null);
      const third = await old();
      await record(third, { state: { result: "rejected", date: today, code: "C9" } });
      assert.equal((await columns(third)).stage, "rejected");
    });

    await t.test("two admins recording the same return at once: one wins", async () => {
      const today = await nyDay();
      const caseId = await filedCase();
      const revision = (await f.sql("select revision from public.cases where id=$1", [caseId])).rows[0].revision;
      const call = () =>
        f.siteCoordinator.rpc("vitally_apply_action", {
          p_action_id: randomUUID(),
          p_case_id: caseId,
          p_expected_revision: Number(revision),
          p_person_id: null,
          p_type: "RECORD_FILING_RESULT",
          p_payload: { confirmed: true, results: { federal: { result: "accepted", date: today } } },
        });
      const settled = await Promise.all([call(), call()]);
      assert.equal(settled.filter((r) => !r.error).length, 1, JSON.stringify(settled.map((r) => r.error)));
      assert.equal(settled.filter((r) => r.error).length, 1);
      assert.deepEqual(await counts(caseId), { answered: 1, notes: 0, events: 1 });
    });

    await t.test("the history lines all translate", async () => {
      const { SENTENCES } = await import("../src/client-text.mjs");
      const states = [null, "waiting", "accepted", "rejected", "given_to_client"];
      const lines = new Set();
      for (const a of states)
        for (const b of states) {
          if (a === null && b === null) continue;
          lines.add((await f.sql("select vitally_private.filing_line($1::text,$2::text) l", [a, b])).rows[0].l);
        }
      for (const [a, b, second] of [
        ["efile", "efile", false],
        ["efile", "paper", false],
        ["paper", "efile", false],
        ["paper", "paper", false],
        ["efile", null, true],
        ["paper", null, true],
        [null, "efile", true],
        [null, "paper", true],
      ])
        lines.add(
          (await f.sql("select vitally_private.efiled_line($1::text,$2::text,$3::boolean) l", [a, b, second])).rows[0]
            .l,
        );
      for (const line of lines) assert.ok(line in SENTENCES, line);
    });
  } finally {
    await f.close();
  }
});

// Task 5: filing details stay with staff.
test("filing details stay with staff", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const CODE = "IND-031-04";
    const NOTE = "Fictional note: preparer to correct the dependent's SSN in TaxSlayer.";
    const nyDay = async () =>
      (await f.sql("select (now() at time zone 'America/New_York')::date::text d")).rows[0].d;
    const act = (caseId, type, payload) => f.act(f.siteCoordinator, caseId, type, payload);
    // A client's case, filed and rejected on the state return with a code and a note.
    const loop = async () => {
      const caseId = await f.approvedCase();
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await act(caseId, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
      const day = await nyDay();
      await act(caseId, "RECORD_FILING_RESULT", {
        confirmed: true,
        results: {
          federal: { result: "accepted", date: day },
          state: { result: "rejected", date: day, code: CODE },
        },
        fixNote: NOTE,
      });
      return caseId;
    };

    await t.test("a client reads the result columns only", async () => {
      const caseId = await loop();
      const mine = await f.applicantA
        .from("cases")
        .select("federal_method,state_method,federal_result,state_result")
        .eq("id", caseId);
      assert.equal(mine.error, null);
      assert.deepEqual(mine.data, [
        { federal_method: "efile", state_method: "efile", federal_result: "accepted", state_result: "rejected" },
      ]);
      for (const table of ["filing_attempts", "filing_returns", "filing_notes"]) {
        const read = await f.applicantA.from(table).select("*");
        assert.equal(read.error, null, table);
        assert.deepEqual(read.data, [], table);
      }
      // The presenter does read them, so the empty answers above are row security.
      const staff = await f.presenter.from("filing_notes").select("note").eq("case_id", caseId);
      assert.deepEqual(staff.data, [{ note: NOTE }]);
    });

    await t.test("naming a real case in the clearing setting frees none of its notes", async () => {
      // The setting freed a sample's notes before 040; it must free nothing now.
      const caseId = await loop();
      await assert.rejects(() =>
        f.sql(
          "with s as (select set_config('vitally.clearing_case',$1,true) v) delete from public.filing_notes where case_id=$1::uuid and (select count(*) from s)>=0",
          [caseId],
        ),
      );
      await assert.rejects(() =>
        f.sql(
          "with s as (select set_config('vitally.clearing_case',$1,true) v) update public.filing_notes set note='x' where case_id=$1::uuid and (select count(*) from s)>=0",
          [caseId],
        ),
      );
      const notes = await f.sql("select note from public.filing_notes where case_id=$1", [caseId]);
      assert.deepEqual(notes.rows, [{ note: NOTE }]);
    });

    await t.test("no event message holds a code or note", async () => {
      const caseId = await loop();
      const day = await nyDay();
      await act(caseId, "RETURN_TO_SIGNING", { confirmed: true });
      await act(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      await act(caseId, "MARK_EFILED", { confirmed: true, methods: { state: "efile" } });
      await act(caseId, "RECORD_FILING_RESULT", {
        confirmed: true,
        results: { state: { result: "accepted", date: day } },
      });
      const stage = (await f.sql("select stage from public.cases where id=$1", [caseId])).rows[0].stage;
      assert.equal(stage, "accepted");
      const messages = await f.clientMessages(caseId);
      assert.ok(messages.length > 5);
      for (const message of messages) {
        assert.ok(!message.includes(CODE), message);
        assert.ok(!message.includes("SSN") && !message.includes("TaxSlayer"), message);
      }
      const details = (
        await f.sql("select detail::text d from public.case_events where case_id=$1", [caseId])
      ).rows.map((row) => row.d);
      for (const d of details) assert.ok(!d.includes(CODE) && !d.includes("TaxSlayer"), d);
    });
  } finally {
    await f.close();
  }
});
