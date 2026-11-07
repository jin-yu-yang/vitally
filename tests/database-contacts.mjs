import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseFixture,
  applyArgs,
  contactArgs,
  editContactArgs,
  rejected,
  SAMPLE_CONTACT,
} from "./support/database-fixture.mjs";
// OpenSpec change add-contact-log (design D1-D6, D11, D12): the contact log's
// two RPCs, its staff-only tables, the move of the old follow-up attempts and
// the refusal of RECORD_CONTACT.
const ESCALATION_REASON = "No response to the document request.";
const ENTRY_FIELDS = [
  "direction",
  "contacted_at",
  "with_whom",
  "other_name",
  "method",
  "purpose",
  "outcome",
  "note",
];
// One refused call: its SQLSTATE and no receipt behind it.
async function refuse(f, client, fn, args, code, label = "") {
  const { error } = await client.rpc(fn, args);
  assert.equal(error?.code, code, `${fn} ${label} ${JSON.stringify(args.p_entry)}`);
  assert.equal(await f.receiptsFor(args.p_action_id), 0);
}
// The ISO instant for a New York wall time `days` days from today, with the
// zone's offset for that date (daylight saving included).
function newYorkTime(days, hour, minute) {
  const day = new Date(Date.now() + days * 86_400_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(day)
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  const hh = String(hour).padStart(2, "0"),
    mm = String(minute).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${hh}:${mm}:00${offset}`;
}
const contactRow = async (f, contactId) =>
  (await f.sql("select * from public.contact_log where id=$1", [contactId])).rows[0];
const versionRows = async (f, contactId) =>
  (
    await f.sql(
      "select * from public.contact_log_versions where contact_id=$1 order by version",
      [contactId],
    )
  ).rows;
const caseCounts = async (f, caseId) => {
  const [row] = (
    await f.sql(
      `select c.revision,
        (select count(*) from public.case_events e where e.case_id=c.id) as events,
        (select count(*) from public.client_events e where e.case_id=c.id) as client_events
       from public.cases c where c.id=$1`,
      [caseId],
    )
  ).rows;
  return {
    revision: Number(row.revision),
    events: Number(row.events),
    clientEvents: Number(row.client_events),
  };
};
// A client case the Preparer prepares with one open document request and an
// open follow-up task assigned to the Site Coordinator (ESCALATE_CONTACT, as pendingCase does).
async function followupCase(f) {
  const caseId = await f.readyCase();
  await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
  await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", f.sampleRequest);
  await f.act(f.preparer, caseId, "ESCALATE_CONTACT", {
    reason: ESCALATION_REASON,
  });
  const [followup] = (
    await f.sql("select id from public.admin_followups where case_id=$1", [caseId])
  ).rows;
  return { caseId, followupId: followup.id };
}

test("the contact log", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("each staff persona logs a contact at any stage", async () => {
      for (const [caseId, account] of [
        [await f.readyCase(), f.roleAccounts.preparer],
        [await f.preparedCase(), f.roleAccounts.reviewer],
        [await f.assistedCase(), f.roleAccounts.siteCoordinator],
      ]) {
        const before = await caseCounts(f, caseId);
        const entry = SAMPLE_CONTACT();
        const args = contactArgs({ caseId, entry });
        const { data, error } = await account.client.rpc("vitally_log_contact", args);
        assert.equal(error, null);
        assert.equal(data.actionId, args.p_action_id);
        assert.equal(data.caseId, caseId);
        assert.equal(data.revision, 1);
        const row = await contactRow(f, data.contactId);
        assert.equal(row.case_id, caseId);
        assert.equal(row.workspace_id, f.workspaceId);
        assert.equal(Number(row.revision), 1);
        assert.equal(row.edited_at, null);
        assert.equal(row.followup_id, null);
        assert.equal(row.logged_by_person_id, account.personId);
        assert.equal(row.logged_by_user_id, account.userId);
        assert.ok(Math.abs(row.logged_at.getTime() - Date.now()) < 60_000);
        assert.equal(row.contacted_at.getTime(), new Date(entry.contactedAt).getTime());
        assert.equal(row.direction, "outgoing");
        assert.equal(row.with_whom, "client");
        assert.equal(row.other_name, null);
        assert.equal(row.method, "phone");
        assert.equal(row.purpose, "go_over_return");
        assert.equal(row.outcome, "reached");
        assert.equal(row.note, entry.note);
        const versions = await versionRows(f, data.contactId);
        assert.equal(versions.length, 1);
        const [first] = versions;
        assert.equal(Number(first.version), 1);
        assert.equal(first.workspace_id, row.workspace_id);
        assert.equal(first.case_id, row.case_id);
        assert.equal(first.edited_by_person_id, account.personId);
        assert.equal(first.edited_by_user_id, account.userId);
        assert.equal(first.created_at.getTime(), row.logged_at.getTime());
        for (const field of ENTRY_FIELDS)
          assert.deepEqual(first[field], row[field], field);
        assert.deepEqual(await caseCounts(f, caseId), before);
      }
    });

    await t.test("a past contact time is kept", async () => {
      const caseId = await f.readyCase();
      const contactedAt = newYorkTime(-1, 14, 10);
      const { contactId } = await f.logContact(f.preparer, caseId, {
        ...SAMPLE_CONTACT(),
        contactedAt,
      });
      const row = await contactRow(f, contactId);
      assert.equal(row.contacted_at.getTime(), new Date(contactedAt).getTime());
      assert.ok(Math.abs(row.logged_at.getTime() - Date.now()) < 60_000);
    });

    await t.test("outcomes follow the method", async () => {
      const caseId = await f.readyCase();
      const allowed = [
        ...["phone", "video"].flatMap((method) =>
          ["reached", "no_answer", "left_voicemail", "wrong_number"].map((outcome) => [
            "outgoing",
            method,
            outcome,
          ]),
        ),
        ...["text", "email"].flatMap((method) =>
          ["sent", "replied", "failed"].map((outcome) => ["outgoing", method, outcome]),
        ),
        ["outgoing", "in_person", "reached"],
        ...["phone", "text", "email", "in_person", "video"].map((method) => [
          "incoming",
          method,
          "reached",
        ]),
      ];
      for (const [direction, method, outcome] of allowed)
        await f.logContact(f.preparer, caseId, {
          ...SAMPLE_CONTACT(),
          direction,
          method,
          outcome,
        });
      for (const [direction, method, outcome] of [
        ["outgoing", "text", "no_answer"],
        ["outgoing", "phone", "sent"],
        ["outgoing", "in_person", "no_answer"],
        ["incoming", "phone", "no_answer"],
        ["incoming", "text", "sent"],
      ])
        await refuse(
          f,
          f.preparer,
          "vitally_log_contact",
          contactArgs({
            caseId,
            entry: { ...SAMPLE_CONTACT(), direction, method, outcome },
          }),
          "VT007",
        );
    });

    await t.test("an entry that breaks a rule is refused", async () => {
      const caseId = await f.readyCase();
      const base = SAMPLE_CONTACT();
      const { note: _note, ...missingNote } = base;
      for (const entry of [
        { ...base, withWhom: "other", otherName: null },
        { ...base, withWhom: "other", otherName: "  " },
        { ...base, withWhom: "client", otherName: "Pat Example" },
        { ...base, withWhom: "other", otherName: "x".repeat(81) },
        { ...base, note: "x".repeat(1001) },
        { ...base, method: "fax" },
        { ...base, purpose: "chat" },
        { ...base, direction: "sideways" },
        { ...base, extra: 1 },
        missingNote,
        { ...base, contactedAt: new Date(Date.now() + 10 * 60_000).toISOString() },
        { ...base, contactedAt: "yesterday" },
      ])
        await refuse(
          f,
          f.preparer,
          "vitally_log_contact",
          contactArgs({ caseId, entry }),
          "VT007",
        );
      // The positive control: a named other within the limit.
      const { contactId } = await f.logContact(f.preparer, caseId, {
        ...base,
        withWhom: "other",
        otherName: "  Pat Example ",
      });
      assert.equal((await contactRow(f, contactId)).other_name, "Pat Example");
      // A blank name with the client is no name, not a refusal.
      const blank = await f.logContact(f.preparer, caseId, {
        ...base,
        withWhom: "client",
        otherName: "  ",
      });
      assert.equal((await contactRow(f, blank.contactId)).other_name, null);
    });

    await t.test("an edit that breaks a rule is refused", async () => {
      const caseId = await f.readyCase();
      const { contactId } = await f.logContact(f.preparer, caseId, SAMPLE_CONTACT());
      const before = {
        row: await contactRow(f, contactId),
        versions: await versionRows(f, contactId),
      };
      for (const entry of [
        { ...SAMPLE_CONTACT(), method: "text", outcome: "reached" },
        { ...SAMPLE_CONTACT(), withWhom: "other", otherName: null },
        { ...SAMPLE_CONTACT(), contactedAt: "yesterday" },
        { ...SAMPLE_CONTACT(), extra: 1 },
      ])
        await refuse(
          f,
          f.preparer,
          "vitally_edit_contact",
          editContactArgs({ contactId, revision: 1, entry }),
          "VT007",
        );
      assert.deepEqual(
        { row: await contactRow(f, contactId), versions: await versionRows(f, contactId) },
        before,
      );
    });

    await t.test("a blank note is stored as no note", async () => {
      const caseId = await f.readyCase();
      for (const note of ["   ", "", null]) {
        const { contactId } = await f.logContact(f.preparer, caseId, {
          ...SAMPLE_CONTACT(),
          note,
        });
        assert.equal((await contactRow(f, contactId)).note, null);
        assert.equal((await versionRows(f, contactId))[0].note, null);
      }
    });

    await t.test("who may log", async () => {
      const caseId = await f.readyCase();
      for (const [client, personId] of [
        [f.applicantA, f.alex],
        [f.applicantA, null],
        [f.presenter, null],
        [f.presenter, f.foreignPeople.sam],
      ])
        await refuse(
          f,
          client,
          "vitally_log_contact",
          contactArgs({ caseId, personId, entry: SAMPLE_CONTACT() }),
          "VT001",
          String(personId),
        );
      const draft = await f.draftCase(f.applicantA);
      await refuse(
        f,
        f.preparer,
        "vitally_log_contact",
        contactArgs({ caseId: draft.caseId, entry: SAMPLE_CONTACT() }),
        "VT002",
      );
      const other = await f.sql("select count(*)::int as n from public.contact_log where case_id in ($1,$2)", [
        caseId,
        draft.caseId,
      ]);
      assert.equal(other.rows[0].n, 0);
    });

    await t.test("a contact linked to a task", async () => {
      const { caseId, followupId } = await followupCase(f);
      const entry = { ...SAMPLE_CONTACT(), outcome: "no_answer" };
      const { contactId } = await f.logContact(f.siteCoordinator, caseId, entry, followupId);
      assert.equal((await contactRow(f, contactId)).followup_id, followupId);
      await refuse(
        f,
        f.preparer,
        "vitally_log_contact",
        contactArgs({ caseId, followupId, entry }),
        "VT001",
      );
      const other = await followupCase(f);
      await refuse(
        f,
        f.siteCoordinator,
        "vitally_log_contact",
        contactArgs({ caseId, followupId: other.followupId, entry }),
        "VT001",
      );
      await f.act(f.siteCoordinator, caseId, "RESOLVE_FOLLOWUP", {
        followupId,
        outcome: "reached",
        note: "Spoke with the client.",
      });
      await refuse(
        f,
        f.siteCoordinator,
        "vitally_log_contact",
        contactArgs({ caseId, followupId, entry }),
        "VT004",
      );
      // Resolving creates no log entry of its own.
      const count = await f.sql("select count(*)::int as n from public.contact_log where case_id=$1", [caseId]);
      assert.equal(count.rows[0].n, 1);
    });

    await t.test("the logger and an admin edit, and every version is kept", async () => {
      const { caseId, followupId } = await followupCase(f);
      const first = newYorkTime(-1, 10, 0),
        second = newYorkTime(-1, 9, 30);
      const sent = {
        ...SAMPLE_CONTACT(),
        contactedAt: first,
        method: "text",
        outcome: "sent",
        purpose: "request_documents",
      };
      const { contactId } = await f.logContact(f.preparer, caseId, sent);
      const logged = await contactRow(f, contactId);
      const edited = await f.editContact(f.preparer, contactId, {
        ...sent,
        outcome: "replied",
      });
      assert.deepEqual(edited, {
        actionId: edited.actionId,
        contactId,
        caseId,
        revision: 2,
      });
      const corrected = await f.editContact(f.siteCoordinator, contactId, {
        ...sent,
        outcome: "replied",
        contactedAt: second,
      });
      assert.equal(corrected.revision, 3);
      const row = await contactRow(f, contactId);
      assert.equal(Number(row.revision), 3);
      assert.ok(row.edited_at);
      assert.equal(row.outcome, "replied");
      assert.equal(row.contacted_at.getTime(), new Date(second).getTime());
      assert.equal(row.logged_by_person_id, f.preparerId);
      assert.equal(row.logged_at.getTime(), logged.logged_at.getTime());
      assert.equal(row.followup_id, null);
      const versions = await versionRows(f, contactId);
      assert.deepEqual(
        versions.map((v) => [Number(v.version), v.outcome, v.contacted_at.getTime(), v.edited_by_person_id]),
        [
          [1, "sent", new Date(first).getTime(), f.preparerId],
          [2, "replied", new Date(first).getTime(), f.preparerId],
          [3, "replied", new Date(second).getTime(), f.siteCoordinatorId],
        ],
      );
      // The task link is fixed at logging: a linked entry stays linked.
      const linked = await f.logContact(
        f.siteCoordinator,
        caseId,
        { ...SAMPLE_CONTACT(), outcome: "no_answer" },
        followupId,
      );
      await f.editContact(f.siteCoordinator, linked.contactId, {
        ...SAMPLE_CONTACT(),
        outcome: "left_voicemail",
      });
      assert.equal((await contactRow(f, linked.contactId)).followup_id, followupId);
    });

    await t.test("another persona cannot edit", async () => {
      const caseId = await f.readyCase();
      const { contactId } = await f.logContact(f.reviewer, caseId, SAMPLE_CONTACT());
      for (const [client, personId, code] of [
        [f.preparer, null, "VT001"],
        [f.presenter, null, "VT001"],
        [f.presenter, f.foreignPeople.sam, "VT001"],
        [f.applicantA, null, "VT001"],
      ])
        await refuse(
          f,
          client,
          "vitally_edit_contact",
          editContactArgs({ contactId, revision: 1, personId, entry: SAMPLE_CONTACT() }),
          code,
          String(personId),
        );
      await refuse(
        f,
        f.siteCoordinator,
        "vitally_edit_contact",
        editContactArgs({
          contactId: crypto.randomUUID(),
          revision: 1,
          entry: SAMPLE_CONTACT(),
        }),
        "VT002",
      );
      assert.equal(Number((await contactRow(f, contactId)).revision), 1);
      // An admin corrects someone else's entry; the logger stays the Reviewer.
      await f.editContact(f.siteCoordinator, contactId, { ...SAMPLE_CONTACT(), note: "Corrected." });
      assert.equal((await contactRow(f, contactId)).logged_by_person_id, f.reviewerId);
    });

    await t.test("a stale edit is a conflict", async () => {
      const caseId = await f.readyCase();
      const { contactId } = await f.logContact(f.reviewer, caseId, SAMPLE_CONTACT());
      await f.editContact(f.reviewer, contactId, { ...SAMPLE_CONTACT(), note: "First." });
      await refuse(
        f,
        f.siteCoordinator,
        "vitally_edit_contact",
        editContactArgs({
          contactId,
          revision: 1,
          entry: { ...SAMPLE_CONTACT(), note: "Second." },
        }),
        "VT003",
      );
      assert.equal((await contactRow(f, contactId)).note, "First.");
      assert.equal((await versionRows(f, contactId)).length, 2);
    });

    await t.test("a replay returns the same receipt", async () => {
      const caseId = await f.readyCase();
      const args = contactArgs({ caseId, entry: SAMPLE_CONTACT() });
      const one = await f.preparer.rpc("vitally_log_contact", args);
      const two = await f.preparer.rpc("vitally_log_contact", args);
      assert.equal(one.error, null);
      assert.equal(two.error, null);
      assert.deepEqual(two.data, one.data);
      const count = await f.sql("select count(*)::int as n from public.contact_log where case_id=$1", [caseId]);
      assert.equal(count.rows[0].n, 1);
      const { error } = await f.preparer.rpc("vitally_log_contact", {
        ...args,
        p_entry: { ...args.p_entry, note: "Another note." },
      });
      assert.equal(error?.code, "VT007");
      const after = await f.sql("select count(*)::int as n from public.contact_log where case_id=$1", [caseId]);
      assert.equal(after.rows[0].n, 1);
      const editArgs = editContactArgs({
        contactId: one.data.contactId,
        revision: 1,
        entry: { ...args.p_entry, outcome: "no_answer" },
      });
      const e1 = await f.preparer.rpc("vitally_edit_contact", editArgs);
      const e2 = await f.preparer.rpc("vitally_edit_contact", editArgs);
      assert.equal(e1.error, null);
      assert.deepEqual(e2.data, e1.data);
      assert.equal((await versionRows(f, one.data.contactId)).length, 2);
    });

    await t.test("nobody deletes or writes the tables directly", async () => {
      const caseId = await f.readyCase();
      const { contactId } = await f.logContact(f.preparer, caseId, SAMPLE_CONTACT());
      const before = {
        row: await contactRow(f, contactId),
        versions: await versionRows(f, contactId),
      };
      for (const client of [f.presenter, f.applicantA]) {
        for (const [table, key] of [
          ["contact_log", "id"],
          ["contact_log_versions", "contact_id"],
        ]) {
          const deleted = await client.from(table).delete().eq(key, contactId).select();
          assert.ok(deleted.error || deleted.data.length === 0, `delete ${table}`);
          const updated = await client
            .from(table)
            .update({ note: "Overwritten." })
            .eq(key, contactId)
            .select();
          assert.ok(updated.error || updated.data.length === 0, `update ${table}`);
        }
        const inserted = await client.from("contact_log").insert({
          workspace_id: f.workspaceId,
          case_id: caseId,
          logged_by_user_id: f.presenterUserId,
          logged_by_person_id: f.preparerId,
          direction: "outgoing",
          contacted_at: new Date().toISOString(),
          with_whom: "client",
          method: "phone",
          purpose: "other",
          outcome: "reached",
        });
        assert.ok(inserted.error, "insert contact_log");
        const version = await client.from("contact_log_versions").insert({
          contact_id: contactId,
          version: 2,
          workspace_id: f.workspaceId,
          case_id: caseId,
          edited_by_user_id: f.presenterUserId,
          edited_by_person_id: f.preparerId,
          direction: "outgoing",
          contacted_at: new Date().toISOString(),
          with_whom: "client",
          method: "phone",
          purpose: "other",
          outcome: "reached",
        });
        assert.ok(version.error, "insert contact_log_versions");
      }
      assert.deepEqual(
        { row: await contactRow(f, contactId), versions: await versionRows(f, contactId) },
        before,
      );
      const count = await f.sql("select count(*)::int as n from public.contact_log where case_id=$1", [caseId]);
      assert.equal(count.rows[0].n, 1);
    });

    await t.test("a client reads nothing", async () => {
      const caseId = await f.readyCase();
      const { contactId } = await f.logContact(f.preparer, caseId, SAMPLE_CONTACT());
      const own = await f.applicantA.from("cases").select("id").eq("id", caseId);
      assert.deepEqual(own.data, [{ id: caseId }]);
      for (const table of ["contact_log", "contact_log_versions"]) {
        const client = await f.applicantA.from(table).select("*").eq("case_id", caseId);
        assert.equal(client.error, null);
        assert.deepEqual(client.data, [], table);
        const staff = await f.presenter.from(table).select("*").eq("case_id", caseId);
        assert.equal(staff.error, null);
        assert.equal(staff.data.length, 1, table);
      }
      const staff = await f.presenter.from("contact_log").select("id").eq("id", contactId);
      assert.deepEqual(staff.data, [{ id: contactId }]);
    });

    await t.test("the old attempts are moved once", async () => {
      const { caseId, followupId } = await followupCase(f);
      const attempts = [
        ["no_answer", "Left a fictional message.", "2026-03-02T09:15:00-05:00", "no_answer", "Left a fictional message."],
        ["reached", "Client will bring the record.", "2026-03-03T10:00:00-05:00", "reached", "Client will bring the record."],
        [
          "no_further_contact",
          "Has what she needs.",
          "2026-03-04T11:00:00-05:00",
          "reached",
          "Client asked for no further contact. Has what she needs.",
        ],
        [
          "closure_requested",
          "Will file elsewhere.",
          "2026-03-05T12:00:00-05:00",
          "reached",
          "Client asked to close the case. Will file elsewhere.",
        ],
      ];
      for (const [outcome, note, createdAt] of attempts)
        await f.sql(
          "insert into public.contact_attempts(workspace_id,case_id,followup_id,actor_user_id,actor_person_id,outcome,note,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [f.workspaceId, caseId, followupId, f.presenterUserId, f.sam, outcome, note, createdAt],
        );
      const moved = await f.sql("select vitally_private.move_contact_attempts() as n");
      assert.equal(moved.rows[0].n, 4);
      const left = await f.sql("select count(*)::int as n from public.contact_attempts where case_id=$1", [caseId]);
      assert.equal(left.rows[0].n, 0);
      const rows = (
        await f.sql("select * from public.contact_log where case_id=$1 order by contacted_at", [caseId])
      ).rows;
      assert.equal(rows.length, 4);
      for (const [index, [, , createdAt, outcome, note]] of attempts.entries()) {
        const row = rows[index];
        const at = new Date(createdAt).getTime();
        assert.equal(row.followup_id, followupId);
        assert.equal(row.direction, "outgoing");
        assert.equal(row.method, "phone");
        assert.equal(row.with_whom, "client");
        assert.equal(row.other_name, null);
        assert.equal(row.purpose, "request_documents");
        assert.equal(row.contacted_at.getTime(), at);
        assert.equal(row.logged_at.getTime(), at);
        assert.equal(row.logged_by_person_id, f.sam);
        assert.equal(row.logged_by_user_id, f.presenterUserId);
        assert.equal(Number(row.revision), 1);
        assert.equal(row.edited_at, null);
        assert.equal(row.outcome, outcome);
        assert.equal(row.note, note);
        const versions = await versionRows(f, row.id);
        assert.equal(versions.length, 1);
        assert.equal(Number(versions[0].version), 1);
        assert.equal(versions[0].created_at.getTime(), at);
        assert.equal(versions[0].edited_by_person_id, f.sam);
        assert.equal(versions[0].edited_by_user_id, f.presenterUserId);
        for (const field of ENTRY_FIELDS)
          assert.deepEqual(versions[0][field], row[field], field);
      }
      // Nothing left to move a second time.
      const again = await f.sql("select vitally_private.move_contact_attempts() as n");
      assert.equal(again.rows[0].n, 0);
    });

    await t.test("RECORD_CONTACT refuses new requests", async () => {
      const { caseId, followupId } = await followupCase(f);
      await assert.rejects(
        () =>
          f.act(f.siteCoordinator, caseId, "RECORD_CONTACT", {
            followupId,
            outcome: "no_answer",
            note: "Left a message.",
          }),
        rejected("VALIDATION"),
      );
      for (const table of ["contact_attempts", "contact_log"]) {
        const count = await f.sql(`select count(*)::int as n from public.${table} where case_id=$1`, [caseId]);
        assert.equal(count.rows[0].n, 0, table);
      }
      // A receipt accepted before the change still replays.
      const [{ revision }] = (await f.sql("select revision from public.cases where id=$1", [caseId])).rows;
      const args = applyArgs({
        caseId,
        revision: Number(revision),
        personId: f.sam,
        type: "RECORD_CONTACT",
        payload: { followupId, note: "Left a message.", outcome: "no_answer" },
      });
      const stored = { actionId: args.p_action_id, caseId, revision: Number(revision) + 1 };
      await f.sql(
        `insert into public.action_receipts(workspace_id,actor_user_id,action_id,operation,request_digest,actor_person_id,target_id,receipt)
         values($1,$2,$3,'RECORD_CONTACT',
          encode(extensions.digest(jsonb_build_object('operation','RECORD_CONTACT','caseId',$4::uuid,'expectedRevision',$5::bigint,'personId',$6::uuid,'payload',$7::jsonb)::text,'sha256'),'hex'),
          $6,$4,$8)`,
        [
          f.workspaceId,
          f.presenterUserId,
          args.p_action_id,
          caseId,
          args.p_expected_revision,
          f.sam,
          JSON.stringify(args.p_payload),
          JSON.stringify(stored),
        ],
      );
      const { data, error } = await f.presenter.rpc("vitally_apply_action", args);
      assert.equal(error, null);
      assert.deepEqual(data, stored);
    });

  } finally {
    await f.close();
  }
});
