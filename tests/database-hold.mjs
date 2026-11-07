import test from "node:test";
import assert from "node:assert/strict";
import { applyArgs, createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// Migration 036: Waiting for documents and Hold (the stage check, the origin
// columns) and the office's documents at intake.

test("documents at intake against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const asSiteCoordinator = (caseId, type, payload = {}) => f.act(f.siteCoordinator, caseId, type, payload);
    const columns = async (caseId) =>
      (
        await f.sql(
          "select stage, documents_origin, hold_origin, closing_reason from public.cases where id=$1",
          [caseId],
        )
      ).rows[0];
    const requests = async (caseId) =>
      (
        await f.sql(
          "select id, title, status, requested_by_person_id from public.document_requests where case_id=$1 order by created_at, title",
          [caseId],
        )
      ).rows;
    const atScreening = async () => {
      const { caseId } = await f.submittedClientCase();
      await asSiteCoordinator(caseId, "START_SCREENING");
      return caseId;
    };
    const ask = (caseId, titles, client = f.siteCoordinator) =>
      f.act(
        client,
        caseId,
        "REQUEST_DOCUMENTS_AT_INTAKE",
        { requests: titles.map((title) => ({ title, message: "A fictional note." })) },
      );
    const answer = (caseId, requestId) =>
      f.act(f.applicantA, caseId, "RESPOND_DOCUMENT", { requestId, filename: f.sampleFilename });

    await t.test("the stage check and origin constraints", async () => {
      const { caseId } = await f.submittedClientCase();
      const set = (sql) => f.sql(`update public.cases set ${sql} where id=$1`, [caseId]);
      await set("stage='awaiting_documents', documents_origin='screening'");
      await assert.rejects(() => set("stage='awaiting_documents', documents_origin=null"));
      await assert.rejects(() => set("stage='on_hold', hold_origin=null, documents_origin=null"));
      await assert.rejects(() => set("stage='screening', documents_origin='screening'"));
      await assert.rejects(() => set("stage='screening', closing_reason='duplicate'"));
      await set("stage='on_hold', hold_origin='awaiting_documents', documents_origin='screening'");
      await set("stage='on_hold', hold_origin='review_approved', documents_origin=null");
      await assert.rejects(() => set("stage='on_hold', hold_origin='review_approved', documents_origin='screening'"));
      await set("stage='closed', hold_origin=null, documents_origin=null, closing_reason='duplicate'");
      await assert.rejects(() => set("closing_reason='nonsense'"));
    });

    await t.test("asking for documents at screening", async () => {
      const caseId = await atScreening();
      await ask(caseId, ["Photo ID"]);
      assert.deepEqual(await columns(caseId), {
        stage: "awaiting_documents",
        documents_origin: "screening",
        hold_origin: null,
        closing_reason: null,
      });
      const rows = await requests(caseId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "open");
      assert.equal(rows[0].requested_by_person_id, f.siteCoordinatorId);
      assert.ok((await f.clientMessages(caseId)).includes("PCDC asked for these documents: Photo ID."));
    });

    await t.test("asking from pending intake and with two titles in one move", async () => {
      const caseId = await f.readyCase();
      assert.equal((await columns(caseId)).stage, "preparation_ready");
      const before = (await f.clientMessages(caseId)).length;
      await ask(caseId, ["W-2", "Photo ID"]);
      assert.equal((await columns(caseId)).documents_origin, "preparation_ready");
      assert.equal((await requests(caseId)).length, 2);
      const lines = (await f.clientMessages(caseId)).slice(before);
      assert.deepEqual(lines, ["PCDC asked for these documents: W-2, Photo ID."]);
      const events = await f.sql(
        "select detail from public.case_events where case_id=$1 and action='REQUEST_DOCUMENTS_AT_INTAKE'",
        [caseId],
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0].detail.requestIds.length, 2);
      // A later move adds a request and a line, and the stage stays.
      await ask(caseId, ["Prior-year return"]);
      assert.equal((await columns(caseId)).stage, "awaiting_documents");
      assert.equal((await columns(caseId)).documents_origin, "preparation_ready");
      assert.equal((await requests(caseId)).length, 3);
    });

    await t.test("refusals", async () => {
      const caseId = await atScreening();
      for (const [client, code] of [
        [f.preparer, "FORBIDDEN"],
        [f.reviewer, "FORBIDDEN"],
        [f.presenter, "FORBIDDEN"],
        [f.applicantA, "FORBIDDEN"],
      ])
        await assert.rejects(() => ask(caseId, ["Photo ID"], client), rejected(code));
      const valid = { title: "Photo ID", message: "A fictional note." };
      for (const requests of [
        [],
        Array.from({ length: 6 }, (_, i) => ({ ...valid, title: `Doc ${i}` })),
        [{ ...valid, title: "  " }],
        [{ ...valid, extra: "x" }],
      ])
        await assert.rejects(
          () => asSiteCoordinator(caseId, "REQUEST_DOCUMENTS_AT_INTAKE", { requests }),
          rejected("VALIDATION"),
        );
      await assert.rejects(
        () => asSiteCoordinator(caseId, "REQUEST_DOCUMENTS_AT_INTAKE", { requests: [valid], extra: 1 }),
        rejected("VALIDATION"),
      );
      assert.equal((await columns(caseId)).stage, "screening");
      assert.equal((await requests(caseId)).length, 0);
      const preparing = await f.assistedCase();
      assert.equal((await columns(preparing)).stage, "preparing");
      await assert.rejects(() => ask(preparing, ["Photo ID"]), rejected("INVALID_TRANSITION"));
    });

    await t.test("the client answers and the office verifies", async () => {
      const caseId = await atScreening();
      await ask(caseId, ["Photo ID"]);
      const [request] = await requests(caseId);
      await answer(caseId, request.id);
      assert.equal((await requests(caseId))[0].status, "awaiting_verification");
      await assert.rejects(
        () => f.act(f.preparer, caseId, "VERIFY_DOCUMENT", { requestId: request.id }),
        rejected("FORBIDDEN"),
      );
      await asSiteCoordinator(caseId, "VERIFY_DOCUMENT", { requestId: request.id });
      assert.deepEqual(await columns(caseId), {
        stage: "screening",
        documents_origin: null,
        hold_origin: null,
        closing_reason: null,
      });
      const lines = await f.clientMessages(caseId);
      assert.equal(lines.at(-1), "PCDC is working on your application again.");
      assert.equal(lines.at(-2), "A volunteer verified your document. No further action is needed for this request.");
    });

    await t.test("a second request keeps it waiting", async () => {
      const caseId = await atScreening();
      await ask(caseId, ["Photo ID"]);
      await ask(caseId, ["W-2"]);
      const rows = await requests(caseId);
      const first = rows.find((r) => r.title === "Photo ID");
      await answer(caseId, first.id);
      await asSiteCoordinator(caseId, "VERIFY_DOCUMENT", { requestId: first.id });
      assert.equal((await columns(caseId)).stage, "awaiting_documents");
      assert.equal((await f.clientMessages(caseId)).includes("PCDC is working on your application again."), false);
    });

    await t.test("the preparer's loop is unchanged", async () => {
      const caseId = await f.assistedCase();
      assert.equal((await columns(caseId)).stage, "preparing");
      await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", {
        title: "Second fictional document",
        message: "A fictional note.",
      });
      assert.equal((await columns(caseId)).stage, "preparing");
    });

    const hold = (caseId, payload = { confirmed: true }, client = f.siteCoordinator) =>
      f.act(client, caseId, "PUT_ON_HOLD", payload);
    const resume = (caseId, payload = { confirmed: true }, client = f.siteCoordinator) =>
      f.act(client, caseId, "RESUME_FROM_HOLD", payload);
    const waitingCase = async (titles = ["Photo ID"]) => {
      const caseId = await atScreening();
      await ask(caseId, titles);
      return caseId;
    };

    await t.test("a documents hold", async () => {
      const caseId = await waitingCase();
      const before = (await f.clientMessages(caseId)).length;
      await hold(caseId);
      assert.deepEqual(await columns(caseId), {
        stage: "on_hold",
        documents_origin: "screening",
        hold_origin: "awaiting_documents",
        closing_reason: null,
      });
      assert.deepEqual((await f.clientMessages(caseId)).slice(before), ["PCDC is trying to reach you."]);
      await resume(caseId);
      assert.deepEqual(await columns(caseId), {
        stage: "awaiting_documents",
        documents_origin: "screening",
        hold_origin: null,
        closing_reason: null,
      });
      assert.equal((await f.clientMessages(caseId)).at(-1), "PCDC is working on your application again.");
    });

    await t.test("the upload ends the hold", async () => {
      const caseId = await waitingCase();
      await hold(caseId, { confirmed: true, note: "Left a fictional voicemail." });
      const [request] = await requests(caseId);
      await answer(caseId, request.id);
      await asSiteCoordinator(caseId, "VERIFY_DOCUMENT", { requestId: request.id });
      assert.deepEqual(await columns(caseId), {
        stage: "screening",
        documents_origin: null,
        hold_origin: null,
        closing_reason: null,
      });
    });

    await t.test("an admin records a received document at the documents stages", async () => {
      const created = await f.draftCase(f.siteCoordinator, { mode: "assisted" });
      const caseId = created.caseId;
      await asSiteCoordinator(caseId, "SUBMIT", { confirmed: true });
      await asSiteCoordinator(caseId, "VERIFY_INTAKE", { checks: await f.checksFor(caseId) });
      await ask(caseId, ["Photo ID", "W-2"]);
      const [first, second] = await requests(caseId);
      await asSiteCoordinator(caseId, "RECORD_DOCUMENT_RESPONSE", { requestId: first.id, filename: f.sampleFilename });
      assert.equal((await requests(caseId)).find((r) => r.id === first.id).status, "awaiting_verification");
      await hold(caseId);
      await asSiteCoordinator(caseId, "RECORD_DOCUMENT_RESPONSE", { requestId: second.id, filename: f.sampleFilename });
      assert.equal((await requests(caseId)).find((r) => r.id === second.id).status, "awaiting_verification");
      assert.equal((await columns(caseId)).stage, "on_hold");
    });

    await t.test("a signing hold", async () => {
      const caseId = await f.approvedCase();
      await hold(caseId);
      assert.deepEqual(await columns(caseId), {
        stage: "on_hold",
        documents_origin: null,
        hold_origin: "review_approved",
        closing_reason: null,
      });
      await assert.rejects(
        () => asSiteCoordinator(caseId, "MARK_READY_TO_EFILE", { confirmed: true }),
        rejected("INVALID_TRANSITION"),
      );
      await resume(caseId);
      assert.deepEqual(await columns(caseId), {
        stage: "review_approved",
        documents_origin: null,
        hold_origin: null,
        closing_reason: null,
      });
    });

    await t.test("hold refusals", async () => {
      const preparing = await f.assistedCase();
      await assert.rejects(() => hold(preparing), rejected("INVALID_TRANSITION"));
      const screening = await atScreening();
      await assert.rejects(() => hold(screening), rejected("INVALID_TRANSITION"));
      await assert.rejects(() => resume(screening), rejected("INVALID_TRANSITION"));
      const waiting = await waitingCase();
      for (const client of [f.preparer, f.reviewer])
        await assert.rejects(() => hold(waiting, { confirmed: true }, client), rejected("FORBIDDEN"));
      await assert.rejects(() => hold(waiting, { confirmed: true }, f.applicantA), rejected("FORBIDDEN"));
      for (const payload of [
        { confirmed: true, note: "x".repeat(1001) },
        { confirmed: true, note: "  " },
        {},
        { note: "A fictional note." },
        { confirmed: true, extra: 1 },
      ])
        await assert.rejects(() => hold(waiting, payload), rejected("VALIDATION"));
      assert.equal((await columns(waiting)).stage, "awaiting_documents");
      await hold(waiting);
      await assert.rejects(() => resume(waiting, {}), rejected("VALIDATION"));
      await assert.rejects(() => resume(waiting, { confirmed: true }, f.preparer), rejected("FORBIDDEN"));
      await assert.rejects(() => hold(waiting), rejected("INVALID_TRANSITION"));
    });

    await t.test("the hold note stays with staff", async () => {
      const caseId = await waitingCase();
      const note = "Fictional note <b>called twice</b>.";
      await hold(caseId, { confirmed: true, note });
      const events = await f.sql(
        "select detail from public.case_events where case_id=$1 and action='PUT_ON_HOLD'",
        [caseId],
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0].detail.note, note);
      for (const line of await f.clientMessages(caseId)) assert.equal(line.includes("called twice"), false);
      // Without a note the detail carries none.
      const other = await waitingCase();
      await hold(other);
      const bare = await f.sql(
        "select detail from public.case_events where case_id=$1 and action='PUT_ON_HOLD'",
        [other],
      );
      assert.equal("note" in bare.rows[0].detail, false);
    });

    const close = (caseId, payload, client = f.siteCoordinator) =>
      f.act(client, caseId, "CLOSE_CASE", payload);
    const CLOSED_LINES = {
      out_of_scope:
        "This application was closed because the return is outside what VITA volunteers can prepare. Your return was not filed by PCDC.",
      no_need_to_file:
        "A PCDC volunteer confirmed with you that you don't need to file a return this year, so this application was closed.",
      duplicate: "This application was closed. Your return continues under your other application with PCDC.",
      dismissed: "PCDC could not reach you, so this application was closed. Your return was not filed.",
      withdrawn: "You withdrew this application. Your return was not filed.",
      other:
        "Your application was closed by the office. This does not change any return filed elsewhere. Contact PCDC if you have questions.",
    };

    await t.test("each reason closes and tells the client", async () => {
      for (const [reason, line] of Object.entries(CLOSED_LINES)) {
        const caseId = await atScreening();
        await close(caseId, reason === "other" ? { confirmed: true, reason, note: "A fictional note." } : { confirmed: true, reason });
        assert.equal((await columns(caseId)).stage, "closed");
        assert.equal((await columns(caseId)).closing_reason, reason);
        assert.equal((await f.clientMessages(caseId)).at(-1), line);
        const fn = await f.sql("select vitally_private.closed_line($1) as line", [reason]);
        assert.equal(fn.rows[0].line, line);
      }
    });

    await t.test("other needs a note", async () => {
      const caseId = await atScreening();
      await assert.rejects(() => close(caseId, { confirmed: true, reason: "other" }), rejected("VALIDATION"));
      assert.equal((await columns(caseId)).stage, "screening");
      const note = "Client chose another preparer";
      await close(caseId, { confirmed: true, reason: "other", note });
      const events = await f.sql(
        "select detail from public.case_events where case_id=$1 and action='CLOSE_CASE'",
        [caseId],
      );
      assert.equal(events.rows[0].detail.note, note);
      assert.equal(events.rows[0].detail.reason, "other");
      for (const line of await f.clientMessages(caseId)) assert.equal(line.includes("another preparer"), false);
    });

    await t.test("close refusals", async () => {
      const caseId = await atScreening();
      for (const payload of [
        { confirmed: true },
        { confirmed: true, reason: "nonsense" },
        { confirmed: true, reason: "duplicate", note: "x".repeat(1001) },
        { confirmed: true, reason: "duplicate", note: "  " },
        { confirmed: true, reason: "duplicate", extra: 1 },
        { reason: "duplicate" },
      ])
        await assert.rejects(() => close(caseId, payload), rejected("VALIDATION"));
      assert.equal((await columns(caseId)).stage, "screening");
    });

    await t.test("close from the new stages", async () => {
      const waiting = await waitingCase();
      await close(waiting, { confirmed: true, reason: "dismissed" });
      assert.deepEqual(await columns(waiting), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: "dismissed",
      });
      assert.deepEqual((await requests(waiting)).map((r) => r.status), ["cancelled"]);

      const heldDocs = await waitingCase();
      await hold(heldDocs);
      await close(heldDocs, { confirmed: true, reason: "withdrawn" });
      assert.deepEqual(await columns(heldDocs), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: "withdrawn",
      });
      assert.deepEqual((await requests(heldDocs)).map((r) => r.status), ["cancelled"]);

      const heldSigning = await f.approvedCase();
      await hold(heldSigning);
      await close(heldSigning, { confirmed: true, reason: "dismissed" });
      assert.deepEqual(await columns(heldSigning), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: "dismissed",
      });
      assert.equal(
        (await f.clientMessages(heldSigning)).at(-1),
        "PCDC could not reach you, so this application was closed. Your return was not filed.",
      );
    });

    await t.test("older closed cases", async () => {
      const caseId = await atScreening();
      await f.sql("update public.cases set stage='closed' where id=$1", [caseId]);
      assert.deepEqual(await columns(caseId), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: null,
      });
    });
    const withdraw = (caseId, payload = { confirmed: true }, client = f.applicantA) =>
      f.act(client, caseId, "WITHDRAW", payload);
    const notices = async (caseId) =>
      (
        await f.sql(
          "select id, status, request_id, assignee_person_id, resolution_outcome from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
          [caseId],
        )
      ).rows;
    const WITHDREW = "You withdrew your application. Your return was not filed.";
    const preparingCase = async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      return caseId;
    };
    const reviewingCase = async () => {
      const caseId = await f.preparedCase();
      await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
      return caseId;
    };

    await t.test("withdraw before preparation", async () => {
      const caseId = await f.readyCase();
      assert.equal((await columns(caseId)).stage, "preparation_ready");
      await withdraw(caseId);
      assert.deepEqual(await columns(caseId), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: "withdrawn",
      });
      assert.equal((await f.clientMessages(caseId)).at(-1), WITHDREW);
      assert.deepEqual(await notices(caseId), []);
      const events = await f.sql("select detail from public.case_events where case_id=$1 and action='WITHDRAW'", [caseId]);
      assert.equal(events.rows.length, 1);
    });

    await t.test("withdraw while waiting for documents or on a documents hold", async () => {
      const waiting = await waitingCase();
      await withdraw(waiting);
      assert.equal((await columns(waiting)).closing_reason, "withdrawn");
      assert.deepEqual((await requests(waiting)).map((r) => r.status), ["cancelled"]);
      const held = await waitingCase();
      await hold(held);
      await withdraw(held);
      assert.deepEqual(await columns(held), {
        stage: "closed",
        documents_origin: null,
        hold_origin: null,
        closing_reason: "withdrawn",
      });
      const received = (await f.submittedClientCase()).caseId;
      await withdraw(received);
      assert.equal((await columns(received)).stage, "closed");
    });

    await t.test("withdraw during preparation", async () => {
      const caseId = await preparingCase();
      assert.equal((await columns(caseId)).stage, "preparing");
      await withdraw(caseId);
      assert.equal((await columns(caseId)).stage, "closed");
      assert.equal((await f.clientMessages(caseId)).at(-1), WITHDREW);
      const rows = await notices(caseId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "open");
      assert.equal(rows[0].request_id, null);
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId: rows[0].id,
        outcome: "reached",
        note: "Fictional: told the volunteer to stop.",
      });
      const after = await notices(caseId);
      assert.equal(after[0].status, "resolved");
      assert.equal(after[0].resolution_outcome, "reached");
      assert.equal((await columns(caseId)).stage, "closed");
    });

    await t.test("an admin close does not cancel a notice", async () => {
      const caseId = await preparingCase();
      await withdraw(caseId);
      assert.equal((await notices(caseId))[0].status, "open");
      const other = await preparingCase();
      await close(other, { confirmed: true, reason: "dismissed" });
      assert.deepEqual(await notices(other), []);
    });

    await t.test("withdraw at review", async () => {
      const reviewing = await reviewingCase();
      assert.equal((await columns(reviewing)).stage, "reviewing");
      await withdraw(reviewing);
      const rows = await notices(reviewing);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "open");
      const ready = await f.preparedCase();
      assert.equal((await columns(ready)).stage, "review_ready");
      await withdraw(ready);
      assert.equal((await columns(ready)).stage, "closed");
      assert.deepEqual(await notices(ready), []);
    });

    await t.test("withdraw at corrections names the stop-work text; at screening there is no notice", async () => {
      const caseId = await preparingCase();
      await f.sql("update public.cases set stage='corrections_required' where id=$1", [caseId]);
      await withdraw(caseId);
      assert.equal((await columns(caseId)).stage, "closed");
      const rows = await f.sql(
        "select status, reason from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
        [caseId],
      );
      assert.deepEqual(rows.rows, [
        { status: "open", reason: "The client withdrew the application: tell the volunteer to stop work." },
      ]);
      const screening = await atScreening();
      await withdraw(screening);
      assert.equal((await columns(screening)).closing_reason, "withdrawn");
      assert.deepEqual(await notices(screening), []);
    });

    const TRANSMIT = "The client withdrew; make sure the return is not transmitted in TaxSlayer.";
    const noticeReasons = async (caseId) =>
      (
        await f.sql(
          "select status, reason, request_id, assignee_person_id, created_by_person_id from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
          [caseId],
        )
      ).rows;
    const readyToEfile = async () => {
      const caseId = await f.approvedCase();
      await asSiteCoordinator(caseId, "MARK_READY_TO_EFILE", { confirmed: true });
      assert.equal((await columns(caseId)).stage, "ready_to_efile");
      return caseId;
    };

    await t.test("a withdrawn close before filing opens the TaxSlayer notice", async () => {
      const signing = await f.approvedCase();
      const assignee = (
        await f.sql(
          "select w.default_followup_person_id as id from public.workspaces w join public.cases c on c.workspace_id=w.id where c.id=$1",
          [signing],
        )
      ).rows[0].id;
      const held = await f.approvedCase();
      await hold(held);
      for (const caseId of [await readyToEfile(), signing, held]) {
        await close(caseId, { confirmed: true, reason: "withdrawn" });
        assert.equal((await columns(caseId)).closing_reason, "withdrawn");
        assert.equal((await f.clientMessages(caseId)).at(-1), CLOSED_LINES.withdrawn);
        const rows = await noticeReasons(caseId);
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], {
          status: "open",
          reason: TRANSMIT,
          request_id: null,
          assignee_person_id: assignee,
          created_by_person_id: assignee,
        });
      }
    });

    await t.test("any close of a signing hold opens the TaxSlayer notice, worded by reason", async () => {
      const held = await f.approvedCase();
      await hold(held);
      await close(held, { confirmed: true, reason: "dismissed" });
      assert.equal((await columns(held)).stage, "closed");
      assert.equal((await columns(held)).closing_reason, "dismissed");
      assert.equal((await f.clientMessages(held)).at(-1), CLOSED_LINES.dismissed);
      const rows = await noticeReasons(held);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "open");
      assert.equal(rows[0].request_id, null);
      assert.equal(
        rows[0].reason,
        "The case was closed before filing; make sure the return is not transmitted in TaxSlayer.",
      );
      // A documents hold has no reviewed return: closing it opens no notice.
      const documentsHold = await atScreening();
      await asSiteCoordinator(documentsHold, "REQUEST_DOCUMENTS_AT_INTAKE", { requests: [{ title: "Photo ID", message: "A fictional note." }] });
      await hold(documentsHold);
      await close(documentsHold, { confirmed: true, reason: "dismissed" });
      assert.deepEqual(await noticeReasons(documentsHold), []);
    });

    await t.test("only a withdrawn close is allowed before filing, and none after", async () => {
      const ready = await readyToEfile();
      await assert.rejects(() => close(ready, { confirmed: true, reason: "duplicate" }), rejected("INVALID_TRANSITION"));
      const signing = await f.approvedCase();
      await assert.rejects(() => close(signing, { confirmed: true, reason: "dismissed" }), rejected("INVALID_TRANSITION"));
      assert.equal((await columns(ready)).stage, "ready_to_efile");
      assert.deepEqual(await noticeReasons(ready), []);
      await asSiteCoordinator(ready, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
      await assert.rejects(() => close(ready, { confirmed: true, reason: "withdrawn" }), rejected("INVALID_TRANSITION"));
      assert.equal((await columns(ready)).stage, "efiled");
    });

    await t.test("a withdrawn close at preparing opens no notice", async () => {
      const caseId = await preparingCase();
      await close(caseId, { confirmed: true, reason: "withdrawn" });
      assert.equal((await columns(caseId)).closing_reason, "withdrawn");
      assert.deepEqual(await noticeReasons(caseId), []);
    });

    await t.test("withdraw refusals", async () => {
      const draft = (await f.draftCase(f.applicantA)).caseId;
      await assert.rejects(() => withdraw(draft), rejected("INVALID_TRANSITION"));
      const approved = await f.approvedCase();
      await assert.rejects(() => withdraw(approved), rejected("INVALID_TRANSITION"));
      const signingHold = await f.approvedCase();
      await hold(signingHold);
      await assert.rejects(() => withdraw(signingHold), rejected("INVALID_TRANSITION"));
      const ready = await f.approvedCase();
      await asSiteCoordinator(ready, "MARK_READY_TO_EFILE", { confirmed: true });
      await assert.rejects(() => withdraw(ready), rejected("INVALID_TRANSITION"));
      await asSiteCoordinator(ready, "MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
      assert.equal((await columns(ready)).stage, "efiled");
      await assert.rejects(() => withdraw(ready), rejected("INVALID_TRANSITION"));
      const closed = await f.readyCase();
      await withdraw(closed);
      await assert.rejects(() => withdraw(closed), rejected("INVALID_TRANSITION"));

      const target = await f.readyCase();
      for (const client of [f.presenter, f.siteCoordinator, f.preparer])
        await assert.rejects(() => withdraw(target, { confirmed: true }, client), rejected("FORBIDDEN"));
      // Another client cannot see the case at all.
      await assert.rejects(() => withdraw(target, { confirmed: true }, f.applicantB), rejected("NOT_FOUND"));
      for (const payload of [{}, { confirmed: false }, { confirmed: true, extra: 1 }, { reason: "x" }])
        await assert.rejects(() => withdraw(target, payload), rejected("VALIDATION"));
      assert.equal((await columns(target)).stage, "preparation_ready");
    });

    await t.test("withdraw races a hold", async () => {
      const caseId = await waitingCase();
      const { revision } = await f.readStaffCase(caseId);
      const results = await Promise.all([
        f.applicantA.rpc("vitally_apply_action", applyArgs({ caseId, revision, type: "WITHDRAW", payload: { confirmed: true } })),
        f.siteCoordinator.rpc(
          "vitally_apply_action",
          applyArgs({ caseId, revision, type: "PUT_ON_HOLD", payload: { confirmed: true } }),
        ),
      ]);
      assert.equal(results.filter((r) => !r.error).length, 1);
      const lost = results.find((r) => r.error);
      assert.equal(lost.error.code, "VT003");
    });

    await t.test("a close note with HTML", async () => {
      const caseId = await atScreening();
      const note = "<b>x</b>";
      await close(caseId, { confirmed: true, reason: "other", note });
      const events = await f.sql("select detail from public.case_events where case_id=$1 and action='CLOSE_CASE'", [caseId]);
      assert.equal(events.rows[0].detail.note, note);
      for (const line of await f.clientMessages(caseId)) assert.equal(line.includes("<b>"), false);
    });
  } finally {
    await f.close();
  }
});
