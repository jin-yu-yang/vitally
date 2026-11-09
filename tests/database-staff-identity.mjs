import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createDatabaseFixture,
  applyArgs,
  assistanceArgs,
  contactArgs,
  editContactArgs,
  rejected,
  PREPARER,
  REVIEWER,
  SAMPLE_CONTACT,
} from "./support/database-fixture.mjs";
import { SUBSCRIBED_TABLES } from "../src/supabase-store.mjs";
import { initializeWorkspace } from "../tools/admin/workspace-setup.mjs";

// OpenSpec change add-staff-identity (design D2-D6): a `staff` membership is
// linked to one person, so the database, not the browser, decides who is
// acting. Specs: sign-in and staff-case-work. The file shares one fixture, and
// `add_staff_member` refuses changed values for an existing key, so every staff
// member below has a person key of their own.

const ALL_CAPABILITIES = ["prepare", "review", "admin", "followup", "receive_documents", "assist"];
const FORBIDDEN = "VT001";
// The tables the staff screens read: what staff subscribe to, plus the
// filing tables staff read but do not subscribe to.
const STAFF_READ_TABLES = [
  ...new Set([
    ...SUBSCRIBED_TABLES.staff,
    "filing_attempts",
    "filing_returns",
    "filing_notes",
  ]),
];
const REALTIME_DEADLINE_MS = 15_000;
const CONTROL_ATTEMPT_MS = 2_500;

// One refused raw call: the SQLSTATE and no receipt behind it.
async function refuse(f, client, fn, args) {
  const { error } = await client.rpc(fn, args);
  assert.equal(error?.code, FORBIDDEN, `${fn} refused`);
  assert.equal(await f.receiptsFor(args.p_action_id), 0, `${fn} stored a receipt`);
}

const caseRow = async (f, caseId) =>
  (await f.sql("select * from public.cases where id=$1", [caseId])).rows[0];
const receiptActor = async (f, actionId) =>
  (
    await f.sql("select actor_person_id from public.action_receipts where action_id=$1", [
      actionId,
    ])
  ).rows[0]?.actor_person_id;
const historyOf = async (f, caseId) =>
  (
    await f.sql(
      "select action,actor_person_id,actor_user_id from public.case_events where case_id=$1 order by created_at,id",
      [caseId],
    )
  ).rows;
const personRow = async (f, key) =>
  (
    await f.sql(
      "select id,name,capabilities from public.people where workspace_id=$1 and person_key=$2",
      [f.workspaceId, key],
    )
  ).rows[0];
// The roster function the fixture's `f.staff` uses, called directly.
const addStaffMember = (f, userId, key, name, capabilities) =>
  f.withSetupLock(() =>
    f.sql("select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[]) as person_id", [
      f.workspaceId,
      userId,
      key,
      name,
      capabilities,
    ]),
  );
const revisionOf = async (f, caseId) =>
  Number((await caseRow(f, caseId)).revision);

// Watch UPDATEs of `cases` on one client's channel and wait for one change,
// repeating the change until it arrives (Realtime restarts a tenant's streaming
// lazily), as tests/database-realtime.mjs does.
async function updateReaches(client, commit) {
  const rows = [];
  const errors = [];
  const channel = client.channel(`vitally-test:${randomUUID()}`);
  channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "cases" }, (payload) =>
    rows.push(payload.new),
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the channel never subscribed within ${REALTIME_DEADLINE_MS}ms`)),
        REALTIME_DEADLINE_MS,
      );
      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status !== "CLOSED") errors.push(`${status}${error ? ` (${error.message})` : ""}`);
      });
    });
    const deadline = Date.now() + REALTIME_DEADLINE_MS;
    while (Date.now() < deadline) {
      const change = await commit();
      const until = Date.now() + CONTROL_ATTEMPT_MS;
      while (Date.now() < until) {
        const seen = rows.find(
          (row) => row.id === change.id && Number(row.revision) === change.revision,
        );
        if (seen) {
          assert.deepEqual(errors, [], "channel errors");
          return seen;
        }
        await sleep(100);
      }
    }
    throw new Error(`the staff channel never received the change within ${REALTIME_DEADLINE_MS}ms`);
  } finally {
    client.removeChannel(channel);
  }
}

test("staff identity against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const made = [];
    const hire = async (spec) => {
      const member = await f.staff(spec);
      made.push(member);
      return member;
    };
    const riley = await hire({ key: "riley", name: "Riley Park", capabilities: ["prepare"] });
    const jordan = await hire({ key: "jordan", name: "Jordan Lee", capabilities: ["review"] });
    const robin = await hire({
      key: "robin",
      name: "Robin Hale",
      capabilities: ["prepare", "review"],
    });
    const casey = await hire({
      key: "casey",
      name: "Casey Moore",
      capabilities: ALL_CAPABILITIES,
    });

    await t.test("two access types; presenter is refused", async () => {
      // Replaces "the three access types".
      const access = async (userId) =>
        (
          await f.sql("select access from public.memberships where workspace_id=$1 and user_id=$2", [
            f.workspaceId,
            userId,
          ])
        ).rows.map((row) => row.access);
      assert.deepEqual(await access(riley.userId), ["staff"]);
      assert.deepEqual(await access(f.applicantAUserId), ["applicant"]);
      const linked = (
        await f.sql("select id,user_id from public.people where workspace_id=$1 and user_id is not null", [
          f.workspaceId,
        ])
      ).rows;
      const byUser = Object.fromEntries(linked.map((row) => [row.user_id, row.id]));
      assert.equal(byUser[riley.userId], riley.personId);
      assert.equal(byUser[f.applicantAUserId], undefined);
      await assert.rejects(
        () =>
          f.sql(
            "insert into public.memberships(workspace_id,user_id,access) values($1,$2,'presenter')",
            [f.workspaceId, f.unapprovedUserId],
          ),
        (error) => error.code === "23514",
      );
      assert.deepEqual(await f.readMembership(f.unapprovedUserId), []);
    });

    await t.test("another access value is refused", async () => {
      await assert.rejects(
        () =>
          f.sql(
            "insert into public.memberships(workspace_id,user_id,access) values($1,$2,'admin')",
            [f.workspaceId, f.unapprovedUserId],
          ),
        (error) => error.code === "23514",
      );
    });

    await t.test("a staff member cannot be saved without a person", async () => {
      try {
        await f.sql(
          "begin; insert into public.memberships(workspace_id,user_id,access) values('" +
            f.workspaceId +
            "','" +
            f.unapprovedUserId +
            "','staff')",
        );
        await assert.rejects(() => f.sql("commit"));
      } finally {
        await f.sql("rollback");
      }
      assert.deepEqual(await f.readMembership(f.unapprovedUserId), []);
    });

    await t.test("a person cannot be linked to a client", async () => {
      const person = (
        await f.sql(
          "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'unlinked_person','Unlinked Person',$2) returning id",
          [f.workspaceId, ["prepare"]],
        )
      ).rows[0].id;
      try {
        await f.sql(
          "begin; update public.people set user_id='" + f.applicantAUserId + "' where id='" + person + "'",
        );
        await assert.rejects(() => f.sql("commit"));
      } finally {
        await f.sql("rollback");
      }
      const { user_id } = (await f.sql("select user_id from public.people where id=$1", [person])).rows[0];
      assert.equal(user_id, null);
      await f.sql("delete from public.people where id=$1", [person]);
    });

    await t.test("a staff call with no person acts as its own person", async () => {
      const caseId = await f.readyCase();
      const receipt = await f.act(riley.client, caseId, "CLAIM_PREPARATION", {});
      assert.equal((await caseRow(f, caseId)).preparer_id, riley.personId);
      assert.equal(await receiptActor(f, receipt.actionId), riley.personId);
    });

    // Replaces "every entry point resolves the person": the half that names no
    // person, for all six RPCs.
    await t.test("every entry point records the staff member", async () => {
      const readyId = await f.readyCase();
      const unsignedId = await f.approvedCase({ wentOver: false });
      const { itemId } = await f.seedAssistance();
      const logCase = await f.readyCase();
      const { contactId } = await f.logContact(casey.client, logCase, SAMPLE_CONTACT());
      const editNote = "Edited fictional note.";
      const unsigned = [{ caseId: unsignedId, revision: await revisionOf(f, unsignedId) }];
      const readyRevision = await revisionOf(f, readyId);
      const entries = [
        {
          fn: "vitally_apply_action",
          args: () =>
            applyArgs({
              caseId: readyId,
              revision: readyRevision,
              type: "CLAIM_PREPARATION",
            }),
          verify: async () =>
            assert.equal((await caseRow(f, readyId)).preparer_id, casey.personId),
        },
        {
          fn: "vitally_close_unsigned",
          args: () => ({
            p_action_id: randomUUID(),
            p_cases: unsigned,
            p_confirmed: true,
          }),
          verify: async () => assert.equal((await caseRow(f, unsignedId)).stage, "closed"),
        },
        {
          fn: "vitally_assistance_action",
          args: () => assistanceArgs({ itemId, revision: 1, type: "CLAIM" }),
          verify: async () =>
            assert.equal(
              (
                await f.sql("select assignee_person_id from public.assistance_items where id=$1", [
                  itemId,
                ])
              ).rows[0].assignee_person_id,
              casey.personId,
            ),
        },
        {
          fn: "vitally_create_case",
          args: () => ({
            p_action_id: randomUUID(),
            p_mode: "assisted",
            p_answers: {},
          }),
          verify: async (data) =>
            assert.equal((await caseRow(f, data.caseId)).created_by_person_id, casey.personId),
        },
        {
          fn: "vitally_log_contact",
          args: () => contactArgs({ caseId: logCase, entry: SAMPLE_CONTACT() }),
          verify: async (data) =>
            assert.equal(
              (
                await f.sql("select logged_by_person_id from public.contact_log where id=$1", [
                  data.contactId,
                ])
              ).rows[0].logged_by_person_id,
              casey.personId,
            ),
        },
        {
          fn: "vitally_edit_contact",
          args: () =>
            editContactArgs({
              contactId,
              revision: 1,
              entry: { ...SAMPLE_CONTACT(), note: editNote },
            }),
          verify: async () =>
            assert.equal(
              (
                await f.sql(
                  "select edited_by_person_id from public.contact_log_versions where contact_id=$1 and version=2",
                  [contactId],
                )
              ).rows[0].edited_by_person_id,
              casey.personId,
            ),
        },
      ];
      for (const entry of entries) {
        const args = entry.args();
        const { data, error } = await casey.client.rpc(entry.fn, args);
        assert.equal(error, null, entry.fn);
        assert.equal(await receiptActor(f, args.p_action_id), casey.personId, entry.fn);
        await entry.verify(data);
      }
    });

    // Replaces staff-identity "a staff call naming its own person is the same
    // as null", "a staff call naming someone else is FORBIDDEN with no
    // receipt", "a client names a person" and "a tampered request", and
    // database-store "a client who forges a staff person": what they protected
    // still holds, the browser cannot choose its actor, because there is no
    // parameter to name one with.
    await t.test("a call carrying p_person_id matches no function and writes nothing", async () => {
      const readyId = await f.readyCase();
      const draft = await f.draftCase(f.applicantA);
      for (const [who, client, spec] of [
        ["a staff session", riley.client, { caseId: readyId, type: "CLAIM_PREPARATION" }],
        [
          "an applicant session",
          f.applicantA,
          {
            caseId: draft.caseId,
            type: "SAVE_ANSWERS",
            payload: { answers: { addr_city: "Pittsburgh" } },
          },
        ],
      ]) {
        const before = await f.stateSnapshot();
        const args = {
          ...applyArgs({ ...spec, revision: await revisionOf(f, spec.caseId) }),
          p_person_id: jordan.personId,
        };
        const { error } = await client.rpc("vitally_apply_action", args);
        assert.equal(error?.code, "PGRST202", who);
        assert.equal(await f.receiptsFor(args.p_action_id), 0, who);
        assert.deepEqual(await f.stateSnapshot(), before, who);
      }
      assert.equal((await caseRow(f, readyId)).preparer_id, null);
    });

    await t.test("a staff member's contact log entry: only its logger or an admin edits it", async () => {
      const logCase = await f.readyCase();
      const { contactId } = await f.logContact(riley.client, logCase, SAMPLE_CONTACT());
      const versions = async () =>
        (
          await f.sql(
            "select version,edited_by_person_id from public.contact_log_versions where contact_id=$1 order by version",
            [contactId],
          )
        ).rows;
      const before = await versions();
      assert.equal(before.length, 1);

      // Jordan has no `admin` capability and did not log it.
      const refused = editContactArgs({
        contactId,
        revision: 1,
        entry: { ...SAMPLE_CONTACT(), note: "Jordan's fictional edit." },
      });
      await refuse(f, jordan.client, "vitally_edit_contact", refused);
      assert.deepEqual(await versions(), before, "the entry changed");

      // A staff member with `admin` may, and the version names them.
      const dana = await hire({ key: "dana", name: "Dana Ortiz", capabilities: ["admin"] });
      const allowed = editContactArgs({
        contactId,
        revision: 1,
        entry: { ...SAMPLE_CONTACT(), note: "Dana's fictional edit." },
      });
      const { error } = await dana.client.rpc("vitally_edit_contact", allowed);
      assert.equal(error, null, "an admin's edit");
      assert.equal(await receiptActor(f, allowed.p_action_id), dana.personId);
      const after = await versions();
      assert.equal(after.length, 2);
      assert.equal(after[1].edited_by_person_id, dana.personId);
    });

    await t.test("capabilities still apply", async () => {
      const caseId = await f.readyCase();
      await f.act(riley.client, caseId, "CLAIM_PREPARATION", {});
      await assert.rejects(
        () => f.act(riley.client, caseId, "CLOSE_CASE", { confirmed: true, reason: "out_of_scope" }),
        rejected("FORBIDDEN"),
      );
      assert.notEqual((await caseRow(f, caseId)).stage, "closed");
    });

    // Replaces "a replay keeps its actor": the digest now holds the resolved
    // person, so an identical replay is the one replay left.
    await t.test("an identical replay keeps its actor", async () => {
      const caseId = await f.readyCase();
      const args = applyArgs({
        caseId,
        revision: await revisionOf(f, caseId),
        type: "CLAIM_PREPARATION",
      });
      const one = await riley.client.rpc("vitally_apply_action", args);
      assert.equal(one.error, null);
      const two = await riley.client.rpc("vitally_apply_action", args);
      assert.equal(two.error, null);
      assert.deepEqual(two.data, one.data);
      assert.equal(await f.receiptsFor(args.p_action_id), 1);
      assert.equal(await receiptActor(f, args.p_action_id), riley.personId);
      const claims = (await historyOf(f, caseId)).filter((row) => row.action === "CLAIM_PREPARATION");
      assert.equal(claims.length, 1);
    });

    // Receipts belong to the account that reserved them.
    await t.test("two staff accounts share one action id", async () => {
      const rileyCase = await f.readyCase();
      const robinCase = await f.readyCase();
      const actionId = randomUUID();
      const rileyCall = await riley.client.rpc(
        "vitally_apply_action",
        applyArgs({
          actionId,
          caseId: rileyCase,
          revision: await revisionOf(f, rileyCase),
          type: "CLAIM_PREPARATION",
        }),
      );
      assert.equal(rileyCall.error, null);
      const robinCall = await robin.client.rpc(
        "vitally_apply_action",
        applyArgs({
          actionId,
          caseId: robinCase,
          revision: await revisionOf(f, robinCase),
          type: "CLAIM_PREPARATION",
        }),
      );
      assert.equal(robinCall.error, null);
      assert.notDeepEqual(robinCall.data, rileyCall.data);
      assert.equal(robinCall.data.caseId, robinCase);
      assert.equal((await caseRow(f, rileyCase)).preparer_id, riley.personId);
      assert.equal((await caseRow(f, robinCase)).preparer_id, robin.personId);
      const receipts = (
        await f.sql(
          "select actor_user_id,actor_person_id from public.action_receipts where action_id=$1",
          [actionId],
        )
      ).rows;
      const byAccount = Object.fromEntries(receipts.map((row) => [row.actor_user_id, row.actor_person_id]));
      assert.equal(receipts.length, 2);
      assert.equal(byAccount[riley.userId], riley.personId);
      assert.equal(byAccount[robin.userId], robin.personId);
    });

    await t.test("two staff members share a case", async () => {
      const caseId = await f.readyCase();
      const receipts = [
        await f.act(riley.client, caseId, "CLAIM_PREPARATION", {}),
        await f.act(riley.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER }),
        await f.act(jordan.client, caseId, "CLAIM_REVIEW", {}),
        await f.act(jordan.client, caseId, "APPROVE_REVIEW", { questionnaire: REVIEWER }),
      ];
      const expected = [
        ["CLAIM_PREPARATION", riley],
        ["SUBMIT_REVIEW", riley],
        ["CLAIM_REVIEW", jordan],
        ["APPROVE_REVIEW", jordan],
      ];
      const history = await historyOf(f, caseId);
      for (const [index, [action, who]] of expected.entries()) {
        const event = history.find((row) => row.action === action);
        assert.equal(event.actor_person_id, who.personId, `${action} person`);
        assert.equal(event.actor_user_id, who.userId, `${action} account`);
        assert.equal(await receiptActor(f, receipts[index].actionId), who.personId, `${action} receipt`);
      }
      const row = await caseRow(f, caseId);
      assert.equal(row.preparer_id, riley.personId);
      assert.equal(row.reviewer_id, jordan.personId);
      assert.equal(row.stage, "review_approved");
    });

    await t.test("a preparer who can also review cannot claim the review", async () => {
      const caseId = await f.readyCase();
      await f.act(robin.client, caseId, "CLAIM_PREPARATION", {});
      await f.act(robin.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
      await assert.rejects(
        () => f.act(robin.client, caseId, "CLAIM_REVIEW", {}),
        rejected("SELF_REVIEW"),
      );
      assert.equal((await caseRow(f, caseId)).stage, "review_ready");
      assert.equal((await caseRow(f, caseId)).reviewer_id, null);
      // Another reviewer can claim it.
      await f.act(jordan.client, caseId, "CLAIM_REVIEW", {});
      assert.equal((await caseRow(f, caseId)).reviewer_id, jordan.personId);
    });

    // Every staff table's rows are exactly what a privileged read of the
    // workspace returns, minus the rows of a private client draft.
    await t.test("staff rows equal a privileged read minus private drafts", async () => {
      // Some rows in every part of the case: a prepared case with a request,
      // and a client's private draft that staff may not read.
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", f.sampleRequest);
      await f.logContact(f.preparer, caseId, SAMPLE_CONTACT());
      const draft = await f.draftCase(f.applicantA);
      // A submitted case in the foreign workspace, which a staff member of this
      // workspace must never read (nor its people, nor the workspace itself).
      const foreignCase = await f.draftCase(f.outsider);
      await f.act(f.outsider, foreignCase.caseId, "SUBMIT", { confirmed: true });
      const foreignRows = (
        await f.sql(
          `select (select count(*) from public.people where workspace_id=$1) as people,
            (select count(*) from public.cases where workspace_id=$1) as cases`,
          [f.foreignWorkspaceId],
        )
      ).rows[0];
      assert.ok(Number(foreignRows.people) > 0 && Number(foreignRows.cases) > 0, "foreign rows exist");
      const read = async (client, table) => {
        const { data, error } = await client.from(table).select("*");
        assert.equal(error, null, `${table} read`);
        return data;
      };
      const privileged = async (table) => {
        const owned = table === "workspaces" ? "t.id=$1" : "t.workspace_id=$1";
        const hasCaseId =
          (
            await f.sql(
              "select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='case_id'",
              [table],
            )
          ).rowCount === 1;
        const notDraft =
          table === "cases"
            ? " and (t.origin<>'client' or t.stage<>'draft')"
            : hasCaseId
              ? " and not exists(select 1 from public.cases c where c.id=t.case_id and c.origin='client' and c.stage='draft')"
              : "";
        return (
          await f.sql(`select to_jsonb(t.*) as record from public.${table} t where ${owned}${notDraft}`, [
            f.workspaceId,
          ])
        ).rows.map((row) => row.record);
      };
      // Sorted keys, because to_jsonb orders keys and PostgREST keeps column order.
      const canonical = (row) =>
        JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
      const asJson = (rows) => rows.map(canonical).sort();
      const workspaceOf = (table, row) => (table === "workspaces" ? row.id : row.workspace_id);
      for (const table of STAFF_READ_TABLES) {
        const expected = asJson(await privileged(table));
        const staffRows = await read(riley.client, table);
        assert.deepEqual(asJson(staffRows), expected, `${table} rows`);
        if (["cases", "case_events", "people", "document_requests", "contact_log"].includes(table))
          assert.ok(expected.length > 0, `${table} has rows to compare`);
        assert.ok(
          !expected.some((row) => row.includes(draft.caseId)),
          `${table} shows a private draft`,
        );
        // Nothing in another workspace: every row is this workspace's.
        for (const row of staffRows)
          assert.equal(workspaceOf(table, row), f.workspaceId, `${table} shows another workspace's row`);
      }
      const { data } = await riley.client.from("cases").select("id").eq("id", draft.caseId);
      assert.deepEqual(data, []);
    });

    await t.test("a staff channel receives a case update live", async () => {
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      const seen = await updateReaches(riley.client, async () => {
        const receipt = await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", {
          title: "Mileage record",
          message: `Marker-${randomUUID()}`,
        });
        return { id: caseId, revision: receipt.revision };
      });
      assert.equal(seen.id, caseId);
    });

    await t.test("add_staff_member repeated with identical values changes nothing", async () => {
      const again = await addStaffMember(f, riley.userId, "riley", "Riley Park", ["prepare"]);
      assert.equal(again.rows[0].person_id, riley.personId);
      assert.equal(
        (
          await f.sql("select count(*) as count from public.people where workspace_id=$1 and person_key='riley'", [
            f.workspaceId,
          ])
        ).rows[0].count,
        "1",
      );
    });

    await t.test("add_staff_member refuses what the roster must refuse", async () => {
      const refused = (userId, key, name, capabilities) =>
        assert.rejects(() => addStaffMember(f, userId, key, name, capabilities), rejected("VALIDATION"), key);
      // Different values for an existing key or account.
      await refused(riley.userId, "riley", "Riley Parker", ["prepare"]);
      await refused(riley.userId, "riley", "Riley Park", ["prepare", "review"]);
      // The same account under another key, and the key of another account.
      await refused(riley.userId, "riley_two", "Riley Park", ["prepare"]);
      await refused(f.unapprovedUserId, "riley", "Riley Park", ["prepare"]);
      // A key outside the person-key pattern, a name outside 1-80 characters.
      await refused(f.unapprovedUserId, "Quinn-Ross", "Quinn Ross", ["prepare"]);
      await refused(f.unapprovedUserId, "quinn", "", ["prepare"]);
      await refused(f.unapprovedUserId, "quinn", "Q".repeat(81), ["prepare"]);
      // A capability outside the known set, or a repeated one.
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["prepare", "teach"]);
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["prepare", "prepare"]);
      // Follow-up access without admin (042).
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["followup"]);
      await refused(f.unapprovedUserId, "quinn", "Quinn Ross", ["followup", "review"]);
      // Nothing was created for the account.
      assert.deepEqual(await f.readMembership(f.unapprovedUserId), []);
      // An account with an active membership in another workspace.
      await refused(f.outsiderUserId, "zed", "Zed Moss", ["prepare"]);
      const riley2 = await personRow(f, "riley");
      assert.equal(riley2.name, "Riley Park");
      assert.deepEqual(riley2.capabilities, ["prepare"]);
      for (const key of ["quinn", "zed"]) {
        const extra = await f.sql(
          "select id from public.people where workspace_id=$1 and person_key=$2 and user_id is not null",
          [f.workspaceId, key],
        );
        assert.equal(extra.rowCount, 0, `${key} was created`);
      }
    });

    await t.test("no follow-up-only person can be stored (042)", async () => {
      // f.sql wraps the pg error; the constraint name is on its cause.
      const byTheCheck = (error) =>
        error.code === "23514" && error.cause?.constraint === "people_followup_needs_admin";
      try {
        await assert.rejects(
          () => f.sql("update public.people set capabilities=$1 where id=$2", [["followup", "review"], riley.personId]),
          byTheCheck,
        );
        // The refused write leaves Riley's capabilities as they were.
        assert.deepEqual((await personRow(f, "riley")).capabilities, ["prepare"]);
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'quinn_direct','Quinn Direct',$2)",
              [f.workspaceId, ["followup"]],
            ),
          byTheCheck,
        );
        // Admin without follow-up is still a valid person.
        await f.sql("update public.people set capabilities=$1 where id=$2", [["admin", "prepare"], riley.personId]);
      } finally {
        // On 041 the refused writes succeed; put Riley back so later subtests are unaffected.
        await f.sql("update public.people set capabilities=$1 where id=$2", [["prepare"], riley.personId]);
        await f.sql("delete from public.people where workspace_id=$1 and person_key='quinn_direct'", [f.workspaceId]);
      }
      assert.deepEqual((await personRow(f, "riley")).capabilities, ["prepare"]);
    });

    let frankie;
    await t.test("a deactivated staff membership loses all access", async () => {
      const parker = await hire({ key: "parker", name: "Parker Quinn", capabilities: ALL_CAPABILITIES });
      const caseId = await f.readyCase();
      const revision = await revisionOf(f, caseId);
      assert.ok(
        (await parker.client.from("cases").select("id").eq("id", caseId)).data.length === 1,
        "an active staff member reads the case",
      );
      await f.sql("update public.memberships set active=false where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        parker.userId,
      ]);
      await refuse(
        f,
        parker.client,
        "vitally_apply_action",
        applyArgs({ caseId, revision, type: "CLAIM_PREPARATION" }),
      );
      await refuse(
        f,
        parker.client,
        "vitally_log_contact",
        contactArgs({ caseId, entry: SAMPLE_CONTACT() }),
      );
      await refuse(f, parker.client, "vitally_create_case", {
        p_action_id: randomUUID(),
        p_mode: "assisted",
        p_answers: {},
      });
      const { data, error } = await parker.client.from("cases").select("*");
      assert.equal(error, null);
      assert.deepEqual(data, []);
      assert.equal((await caseRow(f, caseId)).preparer_id, null);
    });

    await t.test("set_default_followup refuses a person without followup", async () => {
      // Riley lacks `followup`; the unlinked person has it but is no staff
      // member's person; and no person has the last key.
      const unlinked = (
        await f.sql(
          "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'unlinked_default','Unlinked Default',$2) returning id",
          [f.workspaceId, ["admin", "followup"]],
        )
      ).rows[0].id;
      for (const key of ["riley", "unlinked_default", "nobody"])
        await assert.rejects(
          () =>
            f.withSetupLock(() =>
              f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, key]),
            ),
          rejected("VALIDATION"),
          key,
        );
      await f.sql("delete from public.people where id=$1", [unlinked]);
      const { default_followup_person_id } = (
        await f.sql("select default_followup_person_id from public.workspaces where id=$1", [
          f.workspaceId,
        ])
      ).rows[0];
      assert.equal(default_followup_person_id, f.siteCoordinatorId);
    });

    await t.test("a staff member takes new follow-ups and withdrawal notices", async () => {
      const escalate = async () => {
        const caseId = await f.readyCase();
        await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
        await f.act(f.preparer, caseId, "REQUEST_DOCUMENT", f.sampleRequest);
        await f.act(f.preparer, caseId, "ESCALATE_CONTACT", {
          reason: "No response to the document request.",
        });
        return (
          await f.sql("select id,case_id,assignee_person_id from public.admin_followups where case_id=$1", [
            caseId,
          ])
        ).rows;
      };
      // The Site Coordinator's follow-up exists before the default moves.
      const [firstFollowup] = await escalate();
      assert.equal(firstFollowup.assignee_person_id, f.siteCoordinatorId);
      frankie = await hire({
        key: "frankie",
        name: "Frankie Doyle",
        capabilities: ["admin", "followup"],
      });
      await f.withSetupLock(() =>
        f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, "frankie"]),
      );
      const [fresh] = await escalate();
      assert.equal(fresh.assignee_person_id, frankie.personId);
      // Open follow-ups keep their assignee.
      const kept = (
        await f.sql("select assignee_person_id from public.admin_followups where id=$1", [firstFollowup.id])
      ).rows[0];
      assert.equal(kept.assignee_person_id, f.siteCoordinatorId);
      // Review Focus 5, changed by 042: the new default may work the Site
      // Coordinator's open task too, and the task keeps its assignee.
      const resolvePayload = {
        followupId: firstFollowup.id,
        outcome: "reached",
        note: "Spoke with the client.",
      };
      const statusOf = async () =>
        (
          await f.sql("select status,assignee_person_id from public.admin_followups where id=$1", [
            firstFollowup.id,
          ])
        ).rows[0];
      await f.act(frankie.client, firstFollowup.case_id, "RESOLVE_FOLLOWUP", resolvePayload);
      assert.deepEqual(await statusOf(), { status: "resolved", assignee_person_id: f.siteCoordinatorId });
      // A further escalation still goes to the new default.
      const [later] = await escalate();
      assert.equal(later.assignee_person_id, frankie.personId);
      // A withdrawal notice goes to the same person.
      const caseId = await f.readyCase();
      await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
      await f.act(f.applicantA, caseId, "WITHDRAW", { confirmed: true });
      const notice = (
        await f.sql(
          "select assignee_person_id from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
          [caseId],
        )
      ).rows;
      assert.deepEqual(notice, [{ assignee_person_id: frankie.personId }]);
    });

    await t.test("initialize_workspace runs again once staff exist", async () => {
      const before = (
        await f.sql("select person_key from public.people where workspace_id=$1 order by person_key", [
          f.workspaceId,
        ])
      ).rows;
      // No staff and no default here: the re-run alone must leave the default alone.
      await f.withSetupLock(() =>
        initializeWorkspace({ workspaceId: f.workspaceId, applicantUserIds: f.setup.applicantUserIds }),
      );
      const after = (
        await f.sql("select person_key from public.people where workspace_id=$1 order by person_key", [
          f.workspaceId,
        ])
      ).rows;
      assert.deepEqual(after, before);
      assert.ok(after.some((row) => row.person_key === "riley"));
      const staff = (
        await f.sql(
          "select count(*) as count from public.memberships where workspace_id=$1 and access='staff'",
          [f.workspaceId],
        )
      ).rows[0].count;
      assert.equal(Number(staff), made.length + Object.keys(f.roleAccounts).length);
      // The default follow-up person and every staff link survive the re-run.
      const workspace = (
        await f.sql("select default_followup_person_id from public.workspaces where id=$1", [
          f.workspaceId,
        ])
      ).rows[0];
      assert.equal(workspace.default_followup_person_id, frankie.personId);
      for (const member of made) {
        const link = (
          await f.sql(
            `select m.access,p.id as person_id from public.memberships m
             join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
             where m.workspace_id=$1 and m.user_id=$2`,
            [f.workspaceId, member.userId],
          )
        ).rows;
        assert.deepEqual(link, [{ access: "staff", person_id: member.personId }]);
      }
    });

    await t.test("a freed persona key can be added as staff", async () => {
      const sam = await hire({ key: "sam", name: "Sam Rivera", capabilities: ["prepare"] });
      const row = (
        await f.sql("select id,user_id from public.people where workspace_id=$1 and person_key='sam'", [
          f.workspaceId,
        ])
      ).rows[0];
      assert.deepEqual(row, { id: sam.personId, user_id: sam.userId });
      assert.deepEqual(await f.readMembership(sam.userId), [
        { workspace_id: f.workspaceId, user_id: sam.userId, access: "staff", active: true },
      ]);
    });

    await t.test("a kept persona's key is refused", async () => {
      // A workspace of its own, so the key is held by exactly the unlinked row.
      const workspaceId = randomUUID();
      await f.initializeOwned({ workspaceId, applicantUserIds: [] });
      await f.sql(
        "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'sam','Sam Rivera',$2)",
        [workspaceId, ["prepare"]],
      );
      const account = await f.provision();
      // Identical values: the refusal is about the unlinked row holding the key.
      await assert.rejects(
        () =>
          f.withSetupLock(() =>
            f.sql("select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[])", [
              workspaceId,
              account.userId,
              "sam",
              "Sam Rivera",
              ["prepare"],
            ]),
          ),
        rejected("VALIDATION"),
      );
      const row = (
        await f.sql("select user_id from public.people where workspace_id=$1 and person_key='sam'", [
          workspaceId,
        ])
      ).rows[0];
      assert.equal(row.user_id, null);
      assert.deepEqual(await f.readMembership(account.userId), []);
    });

    await t.test("a workspace set up with its own staff works for staff and clients", async () => {
      const workspaceId = randomUUID();
      const client = await f.provision();
      await f.initializeOwned({ workspaceId, applicantUserIds: [client.userId] });
      const lead = await f.staff({
        key: "lead",
        name: "Lee Adams",
        capabilities: ["admin", "followup"],
        workspaceId,
      });
      const preparer = await f.staff({
        key: "preparer",
        name: "Pat Rowe",
        capabilities: ["prepare"],
        workspaceId,
      });
      await f.withSetupLock(() =>
        f.sql("select vitally_private.set_default_followup($1,$2)", [workspaceId, "lead"]),
      );
      // A case worked by staff alone: the client submits, the lead screens it,
      // the preparer claims it and asks for a document.
      const started = async () => {
        const created = await f.draftCase(client.client);
        await f.act(client.client, created.caseId, "SUBMIT", { confirmed: true });
        await f.act(lead.client, created.caseId, "START_SCREENING", {});
        await f.act(lead.client, created.caseId, "VERIFY_INTAKE", {
          checks: await f.checksFor(created.caseId),
        });
        await f.act(preparer.client, created.caseId, "CLAIM_PREPARATION", {});
        return created.caseId;
      };
      const escalated = await started();
      await f.act(preparer.client, escalated, "REQUEST_DOCUMENT", f.sampleRequest);
      // The request is named explicitly: f.act's default lookup reads through
      // the fixture's Site Coordinator, who is not a member of this workspace.
      const [request] = (
        await f.sql("select id from public.document_requests where case_id=$1", [escalated])
      ).rows;
      await f.act(preparer.client, escalated, "ESCALATE_CONTACT", {
        requestId: request.id,
        reason: "No response to the document request.",
      });
      assert.equal((await caseRow(f, escalated)).preparer_id, preparer.personId);
      const followups = (
        await f.sql("select assignee_person_id from public.admin_followups where case_id=$1", [escalated])
      ).rows;
      assert.deepEqual(followups, [{ assignee_person_id: lead.personId }]);
      // A withdrawal notice goes to the staff default.
      const withdrawn = await started();
      await f.act(client.client, withdrawn, "WITHDRAW", { confirmed: true });
      const notices = (
        await f.sql(
          "select assignee_person_id from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
          [withdrawn],
        )
      ).rows;
      assert.deepEqual(notices, [{ assignee_person_id: lead.personId }]);
    });
  } finally {
    await f.close();
  }
});
