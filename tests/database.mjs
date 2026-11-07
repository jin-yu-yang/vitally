import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { REFERENCE_PATTERN } from "../src/contracts.mjs";
import { initializeWorkspace } from "../tools/admin/workspace-setup.mjs";
import { extendTestWorkspace } from "./support/workspace-overrides.mjs";
const rejected = (code) => (error) => error.code === code;
const CLIENT_VISIBLE_TABLES = [
  "document_requests",
  "documents",
  "client_events",
  "case_contacts",
  "case_document_cards",
];
const PRESENTER_ONLY_TABLES = [
  "preparation_participants",
  "admin_followups",
  "contact_log",
  "contact_log_versions",
  "case_events",
  "reviews",
  "assistance_items",
  "case_materials",
];
const WORKFLOW_TABLES = [...CLIENT_VISIBLE_TABLES, ...PRESENTER_ONLY_TABLES];
async function rows(client, table, filter = {}) {
  let q = client.from(table).select("*");
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  assert.equal(error, null);
  return data;
}
const normalized = (expression) => expression.replace(/\s+/g, " ").trim();
// The balanced parenthesized group starting at `marker`, so one predicate can be
// lifted out of a rendered policy expression without hand-counting brackets.
function parenthesized(expression, marker) {
  const start = expression.indexOf(marker);
  assert.ok(start >= 0, `Expression is missing ${marker}`);
  let depth = 0;
  for (let index = start; index < expression.length; index++) {
    if (expression[index] === "(") depth++;
    else if (expression[index] === ")" && --depth === 0)
      return expression.slice(start, index + 1);
  }
  throw new Error(`Unbalanced expression after ${marker}`);
}
// Every column of every workflow row, deterministically ordered, so a denied
// write cannot hide behind an unchanged row count.
async function workflowSnapshot(f) {
  const snapshot = {};
  for (const table of WORKFLOW_TABLES)
    snapshot[table] = (
      await f.sql(
        `select to_jsonb(t.*) as record from public.${table} t where t.workspace_id=$1 order by to_jsonb(t.*)::text`,
        [f.workspaceId],
      )
    ).rows.map((row) => row.record);
  return snapshot;
}
// Privileged seeding stands in for the Task 3B-3D actions that will create
// these rows; Task 3A owns the records and their visibility only.
async function seedWorkflow(f, caseId) {
  const seeded = Object.fromEntries(
    [
      "requestId",
      "documentId",
      "followupId",
      "contactId",
      "reviewId",
      "caseEventId",
      "clientEventId",
      "assistanceId",
      "standaloneAssistanceId",
    ].map((key) => [key, crypto.randomUUID()]),
  );
  await f.sql(
    "insert into public.preparation_participants(workspace_id,case_id,person_id) values($1,$2,$3)",
    [f.workspaceId, caseId, f.people.alex],
  );
  await f.sql(
    "insert into public.document_requests(id,workspace_id,case_id,title,message,requested_by_person_id) values($1,$2,$3,$4,$5,$6)",
    [
      seeded.requestId,
      f.workspaceId,
      caseId,
      "Mileage record",
      "Please add the fictional sample.",
      f.people.alex,
    ],
  );
  await f.sql(
    "insert into public.documents(id,workspace_id,case_id,request_id,filename,source,submitted_by_user_id) values($1,$2,$3,$4,$5,$6,$7)",
    [
      seeded.documentId,
      f.workspaceId,
      caseId,
      seeded.requestId,
      "mileage-sample.pdf",
      "client",
      f.applicantAUserId,
    ],
  );
  await f.sql(
    "insert into public.admin_followups(id,workspace_id,case_id,request_id,assignee_person_id,reason,created_by_person_id) values($1,$2,$3,$4,$5,$6,$7)",
    [
      seeded.followupId,
      f.workspaceId,
      caseId,
      seeded.requestId,
      f.people.sam,
      "Office contact needed",
      f.people.alex,
    ],
  );
  await f.sql(
    "insert into public.contact_log(id,workspace_id,case_id,followup_id,logged_by_user_id,logged_by_person_id,direction,contacted_at,with_whom,method,purpose,outcome,note) values($1,$2,$3,$4,$5,$6,'outgoing',now(),'client','phone','request_documents','no_answer',$7)",
    [
      seeded.contactId,
      f.workspaceId,
      caseId,
      seeded.followupId,
      f.presenterUserId,
      f.people.sam,
      "Left a fictional message.",
    ],
  );
  await f.sql(
    "insert into public.contact_log_versions(contact_id,version,workspace_id,case_id,edited_by_user_id,edited_by_person_id,created_at,direction,contacted_at,with_whom,method,purpose,outcome,note) select id,1,workspace_id,case_id,logged_by_user_id,logged_by_person_id,logged_at,direction,contacted_at,with_whom,method,purpose,outcome,note from public.contact_log where id=$1",
    [seeded.contactId],
  );
  await f.sql(
    "insert into public.reviews(id,workspace_id,case_id,preparation_version,reviewer_person_id) values($1,$2,$3,1,$4)",
    [seeded.reviewId, f.workspaceId, caseId, f.people.morgan],
  );
  await f.sql(
    "insert into public.case_events(id,workspace_id,case_id,actor_user_id,actor_person_id,action,detail) values($1,$2,$3,$4,$5,$6,$7)",
    [
      seeded.caseEventId,
      f.workspaceId,
      caseId,
      f.presenterUserId,
      f.people.alex,
      "REQUEST_DOCUMENT",
      {
        requestId: seeded.requestId,
        internalNote: "Mileage looks incomplete.",
      },
    ],
  );
  await f.sql(
    "insert into public.client_events(id,workspace_id,case_id,action,message) values($1,$2,$3,$4,$5)",
    [
      seeded.clientEventId,
      f.workspaceId,
      caseId,
      "REQUEST_DOCUMENT",
      "A volunteer asked for one more document.",
    ],
  );
  await f.sql(
    "insert into public.case_contacts(workspace_id,case_id,phone,best_contact_time) values($1,$2,$3,$4)",
    [f.workspaceId, caseId, "2155550100", ["weekday_morning"]],
  );
  await f.sql(
    "insert into public.case_document_cards(workspace_id,case_id,slot_id,status) values($1,$2,$3,$4)",
    [f.workspaceId, caseId, "w2.household", "later"],
  );
  await f.sql(
    "insert into public.case_materials(workspace_id,case_id,item,recorded_by_person_id) values($1,$2,$3,$4)",
    [f.workspaceId, caseId, "w2", f.people.sam],
  );
  await f.sql(
    "insert into public.assistance_items(id,workspace_id,case_id,title,language,contact_preference) values($1,$2,$3,$4,$5,$6)",
    [
      seeded.assistanceId,
      f.workspaceId,
      caseId,
      "Client needs help completing intake forms.",
      "Spanish",
      "Prefers calls from the main office.",
    ],
  );
  await f.sql(
    "insert into public.assistance_items(id,workspace_id,title) values($1,$2,$3)",
    [
      seeded.standaloneAssistanceId,
      f.workspaceId,
      "Seeded assistance example with no linked case.",
    ],
  );
  return seeded;
}
test("identity, references, ownership, and privileged setup on real Supabase", async (t) => {
  const f = await createDatabaseFixture({ roleAccounts: false });
  try {
    await t.test(
      "references are stable and unique; IDs and references do not authorize access",
      async () => {
        const actionId = crypto.randomUUID();
        const [first, retry] = await Promise.all([
          f.createCase(f.applicantA, actionId),
          f.createCase(f.applicantA, actionId),
        ]);
        assert.deepEqual(first, retry);
        assert.match(first.reference, REFERENCE_PATTERN);
        const many = await Promise.all(
          Array.from({ length: 12 }, () =>
            f.createCase(f.applicantA, crypto.randomUUID()),
          ),
        );
        assert.equal(
          new Set([first, ...many].map((x) => x.reference)).size,
          13,
        );
        assert.equal(new Set([first, ...many].map((x) => x.caseId)).size, 13);
        assert.deepEqual(
          await rows(f.applicantB, "cases", { id: first.caseId }),
          [],
        );
        assert.deepEqual(
          await rows(f.applicantB, "cases", { reference: first.reference }),
          [],
        );
        assert.equal(
          (await rows(f.applicantA, "cases", { id: first.caseId })).length,
          1,
        );
        await assert.rejects(
          () =>
            f.createCase(f.applicantA, actionId, {
              answers: { tp_first_name: "Changed" },
            }),
          rejected("VALIDATION"),
        );
        await assert.rejects(
          () =>
            f.createCase(f.applicantA, crypto.randomUUID(), {
              answers: { owner_user_id: f.applicantBUserId },
            }),
          rejected("VALIDATION"),
        );
        f.first = first;
        f.firstActionId = actionId;
      },
    );
    await t.test(
      "schema rejects cross-workspace ownership",
      async () => {
        await assert.rejects(
          () =>
            f.sql("update public.cases set owner_user_id=$1 where id=$2", [
              f.outsiderUserId,
              f.first.caseId,
            ]),
          (error) => error.code === "23503",
        );
        await assert.rejects(
          () =>
            f.sql("update public.cases set reference=$1 where id=$2", [
              "VT-0000-1111",
              f.first.caseId,
            ]),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          () =>
            f.createCase(f.applicantA, crypto.randomUUID(), {
              answers: { tp_first_name: 42 },
            }),
          rejected("VALIDATION"),
        );
      },
    );
    await t.test(
      "presenter sees staff-created and submitted cases, never private applicant drafts",
      async () => {
        assert.deepEqual(
          await rows(f.presenter, "cases", { id: f.first.caseId }),
          [],
        );
        await assert.rejects(
          () => f.createCase(f.presenter, crypto.randomUUID()),
          rejected("FORBIDDEN"),
        );
        await assert.rejects(
          () =>
            f.createCaseAsPersona(f.presenter, crypto.randomUUID(), {
              mode: "assisted",
              personId: f.people.alex,
            }),
          rejected("FORBIDDEN"),
        );
        await assert.rejects(
          () =>
            f.createCaseAsPersona(f.applicantA, crypto.randomUUID(), {
              personId: f.people.sam,
            }),
          rejected("FORBIDDEN"),
        );
        await assert.rejects(
          () =>
            f.createCaseAsPersona(f.applicantA, crypto.randomUUID(), {
              mode: "assisted",
              personId: f.people.sam,
            }),
          rejected("FORBIDDEN"),
        );
        await assert.rejects(
          () =>
            f.createCaseAsPersona(f.presenter, crypto.randomUUID(), {
              mode: "assisted",
              personId: f.foreignPeople.sam,
            }),
          rejected("FORBIDDEN"),
        );
        const assisted = await f.createCaseAsPersona(f.presenter, crypto.randomUUID(), {
          mode: "assisted",
          personId: f.people.sam,
        });
        const [staff] = await rows(f.presenter, "cases", {
          id: assisted.caseId,
        });
        assert.equal(staff.owner_user_id, null);
        assert.equal(staff.created_by_user_id, f.presenterUserId);
        assert.equal(staff.created_by_person_id, f.people.sam);
        assert.deepEqual(
          await rows(f.applicantA, "cases", { id: assisted.caseId }),
          [],
        );
        await f.sql("update public.cases set stage=$1 where id=$2", [
          "received",
          f.first.caseId,
        ]);
        assert.equal(
          (await rows(f.presenter, "cases", { id: f.first.caseId })).length,
          1,
        );
      },
    );
    await t.test(
      "direct writes, anonymous APIs, outsider and unapproved accounts fail closed",
      async () => {
        for (const actor of [f.applicantA, f.presenter])
          for (const table of [
            "workspaces",
            "memberships",
            "people",
            "cases",
            "action_receipts",
          ]) {
            const response = await actor
              .from(table)
              .delete()
              .eq(
                table === "memberships" ? "user_id" : "id",
                table === "memberships" ? f.applicantAUserId : f.workspaceId,
              );
            assert.ok(response.error, `${table} direct DELETE must fail`);
          }
        for (const table of [
          "workspaces",
          "memberships",
          "people",
          "cases",
          "action_receipts",
        ])
          assert.ok((await f.anonymous.from(table).select("*")).error);
        assert.ok(
          (
            await f.anonymous.rpc("vitally_create_case", {
              p_action_id: crypto.randomUUID(),
              p_mode: "client",
              p_person_id: null,
              p_answers: {},
            })
          ).error,
        );
        assert.deepEqual(
          await rows(f.outsider, "cases", { id: f.first.caseId }),
          [],
        );
        assert.deepEqual(await rows(f.unapproved, "cases"), []);
        await assert.rejects(
          () => f.createCase(f.unapproved, crypto.randomUUID()),
          rejected("FORBIDDEN"),
        );
        assert.equal((await rows(f.applicantA, "memberships")).length, 1);
        assert.deepEqual(await rows(f.applicantA, "people"), []);
        assert.equal((await rows(f.presenter, "people")).length, 3);
        assert.ok(
          (await f.applicantA.from("action_receipts").select("*")).error,
        );
        assert.ok((await f.presenter.rpc("initialize_workspace", {})).error);
      },
    );
    await t.test(
      "normal initializer preserves people, default and capabilities; adds roster only explicitly",
      async () => {
        const before = await f.snapshot();
        // One lock around the pair, not one each: the two calls must still race
        // each other, only not the other test files' setup (Ruling R26).
        const [result, concurrent] = await f.withSetupLock(() =>
          Promise.all([
            initializeWorkspace(f.setup),
            initializeWorkspace(f.setup),
          ]),
        );
        assert.deepEqual(result, concurrent);
        assert.deepEqual(result.people, f.people);
        assert.deepEqual(await f.snapshot(), before);
        const people = (
          await f.sql(
            "select person_key,capabilities from public.people where workspace_id=$1 order by person_key",
            [f.workspaceId],
          )
        ).rows;
        assert.deepEqual(people, [
          { person_key: "alex", capabilities: ["prepare"] },
          { person_key: "morgan", capabilities: ["review"] },
          {
            person_key: "sam",
            capabilities: ["admin", "assist", "followup", "receive_documents"],
          },
        ]);
        const workspace = (
          await f.sql(
            "select default_followup_person_id from public.workspaces where id=$1",
            [f.workspaceId],
          )
        ).rows[0];
        assert.equal(workspace.default_followup_person_id, f.people.sam);
        await assert.rejects(
          () =>
            f.sql(
              "update public.workspaces set default_followup_person_id=$1 where id=$2",
              [f.foreignPeople.sam, f.workspaceId],
            ),
          (error) => error.code === "23503",
        );
        const added = await f.withSetupLock(() =>
          initializeWorkspace({
            ...f.setup,
            applicantUserIds: [...f.setup.applicantUserIds, f.unapprovedUserId],
          }),
        );
        assert.deepEqual(added.people, f.people);
        assert.equal((await rows(f.unapproved, "memberships")).length, 1);
      },
    );
    await t.test(
      "explicit service role table grants work, and receipts survive target removal",
      async () => {
        const { data, error } = await f.service((admin) =>
          admin
            .from("cases")
            .update({ answers: { tp_first_name: "Service" } })
            .eq("id", f.first.caseId)
            .select(),
        );
        assert.equal(error, null);
        assert.equal(data.length, 1);
        const del = await f.service((admin) =>
          admin.from("cases").delete().eq("id", f.first.caseId),
        );
        assert.equal(del.error, null);
        const replay = await f.createCase(f.applicantA, f.firstActionId);
        assert.deepEqual(replay, f.first);
        assert.deepEqual(
          await rows(f.applicantA, "cases", { id: f.first.caseId }),
          [],
        );
        const receipt = (
          await f.sql(
            "select target_id,target_reference from public.action_receipts where action_id=$1",
            [f.firstActionId],
          )
        ).rows[0];
        assert.equal(receipt.target_id, f.first.caseId);
        assert.equal(receipt.target_reference, f.first.reference);
      },
    );
    await t.test(
      "revocation removes reads and accepted replay authority and cannot be silently reactivated",
      async () => {
        const acceptedId = crypto.randomUUID();
        await f.createCase(f.applicantB, acceptedId);
        await f.sql(
          "update public.memberships set active=false where user_id=$1",
          [f.applicantBUserId],
        );
        await assert.rejects(
          () => f.createCase(f.applicantB, acceptedId),
          rejected("FORBIDDEN"),
        );
        const old = await f
          .createCase(f.applicantB, crypto.randomUUID())
          .catch((error) => {
            assert.equal(error.code, "FORBIDDEN");
          });
        assert.equal(old, undefined);
        const before = await f.snapshot();
        await f.withSetupLock(() =>
          assert.rejects(
            () => initializeWorkspace(f.setup),
            rejected("VALIDATION"),
          ),
        );
        assert.deepEqual(await f.snapshot(), before);
        assert.deepEqual(await rows(f.applicantB, "workspaces"), []);
        assert.deepEqual(await rows(f.applicantB, "cases"), []);
        await assert.rejects(
          () => f.createCase(f.applicantB, crypto.randomUUID()),
          rejected("FORBIDDEN"),
        );
        await f.sql(
          "update public.memberships set active=true where user_id=$1",
          [f.applicantBUserId],
        );
      },
    );
    await t.test(
      "test enrichment is additive, idempotent, scoped and permanently blocks normal initializer",
      async () => {
        const addition = {
          runManifest: f.runManifest,
          workspaceId: f.workspaceId,
          addPeople: [
            { key: "casey", name: "Casey", capabilities: ["prepare"] },
          ],
          addCapabilities: [{ personId: f.people.alex, capability: "review" }],
        };
        const result = await extendTestWorkspace(addition);
        const before = await f.snapshot();
        assert.deepEqual(await extendTestWorkspace(addition), result);
        assert.deepEqual(await f.snapshot(), before);
        await assert.rejects(
          () =>
            extendTestWorkspace({
              ...addition,
              addCapabilities: [
                { personId: f.foreignPeople.sam, capability: "review" },
              ],
            }),
          rejected("VALIDATION"),
        );
        await assert.rejects(
          () =>
            extendTestWorkspace({
              ...addition,
              addPeople: [
                { key: "casey", name: "Wrong", capabilities: ["prepare"] },
              ],
            }),
          rejected("VALIDATION"),
        );
        await assert.rejects(
          () =>
            extendTestWorkspace({
              ...addition,
              addCapabilities: [
                { personId: f.people.alex, capability: "root" },
              ],
            }),
          rejected("VALIDATION"),
        );
        await f.withSetupLock(() =>
          assert.rejects(
            () => initializeWorkspace(f.setup),
            rejected("VALIDATION"),
          ),
        );
        assert.deepEqual(await f.snapshot(), before);
        await assert.rejects(
          () =>
            extendTestWorkspace({
              ...addition,
              workspaceId: crypto.randomUUID(),
            }),
          rejected("TARGET_REJECTED"),
        );
        await assert.rejects(
          () =>
            extendTestWorkspace({
              ...addition,
              runManifest: { runId: f.runManifest.runId },
            }),
          rejected("TARGET_REJECTED"),
        );
        await assert.rejects(
          () =>
            extendTestWorkspace({ ...addition, removePeople: [f.people.sam] }),
          rejected("VALIDATION"),
        );
        await f.sql(
          "update vitally_private.test_workspaces set run_id=$1 where workspace_id=$2",
          [crypto.randomUUID(), f.workspaceId],
        );
        try {
          await assert.rejects(
            () => extendTestWorkspace(addition),
            rejected("VALIDATION"),
          );
        } finally {
          await f.sql(
            "update vitally_private.test_workspaces set run_id=$1 where workspace_id=$2",
            [f.runManifest.runId, f.workspaceId],
          );
        }
      },
    );
    await t.test(
      "effective table, function, RLS, defaults and receipt foreign keys enforce the boundary",
      async () => {
        const tableNames = [
          "workspaces",
          "memberships",
          "people",
          "cases",
          "action_receipts",
        ];
        for (const table of tableNames) {
          const result = (
            await f.sql(
              "select relrowsecurity from pg_class where oid=$1::regclass",
              [`public.${table}`],
            )
          ).rows[0];
          assert.equal(result.relrowsecurity, true);
          for (const role of ["anon", "authenticated", "service_role"]) {
            const acl = (
              await f.sql(
                "select has_table_privilege($1,$2,'SELECT') as sel,has_table_privilege($1,$2,'INSERT') as can_insert,has_table_privilege($1,$2,'UPDATE') as can_update,has_table_privilege($1,$2,'DELETE') as can_delete",
                [role, `public.${table}`],
              )
            ).rows[0];
            assert.equal(acl.can_insert, role === "service_role");
            assert.equal(acl.can_update, role === "service_role");
            assert.equal(acl.can_delete, role === "service_role");
            assert.equal(
              acl.sel,
              role === "service_role" ||
                (role === "authenticated" && table !== "action_receipts"),
            );
          }
        }
        const functions = (
          await f.sql(
            "select n.nspname,p.oid::regprocedure::text as signature,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as browser,has_function_privilege('service_role',p.oid,'EXECUTE') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vitally_private' or (n.nspname='public' and p.proname like 'vitally_%')",
          )
        ).rows;
        assert.ok(functions.length >= 2);
        for (const fn of functions) {
          assert.equal(fn.anon, false);
          assert.equal(fn.browser, fn.nspname === "public");
          if (fn.nspname === "vitally_private") assert.equal(fn.service, false);
          assert.ok(fn.proconfig.includes('search_path=""'));
        }
        const fks = (
          await f.sql(
            "select confrelid::regclass::text as target from pg_constraint where conrelid='public.action_receipts'::regclass and contype='f'",
          )
        ).rows;
        assert.deepEqual(fks, [{ target: "workspaces" }]);
        await f.sql("begin");
        try {
          await f.sql(
            "create function vitally_private.default_acl_probe() returns int language sql as $$select 1$$",
          );
          const acl = (
            await f.sql(
              "select has_function_privilege('anon','vitally_private.default_acl_probe()','execute') as anon,has_function_privilege('authenticated','vitally_private.default_acl_probe()','execute') as browser,has_function_privilege('service_role','vitally_private.default_acl_probe()','execute') as service",
            )
          ).rows[0];
          assert.deepEqual(acl, {
            anon: false,
            browser: false,
            service: false,
          });
        } finally {
          await f.sql("rollback");
        }
      },
    );
  } finally {
    await f.close();
  }
});
test("workflow records stay owner-visible, presenter-only, and write-protected", async (t) => {
  const f = await createDatabaseFixture({ roleAccounts: false });
  try {
    const submitted = await f.createCase(f.applicantA, crypto.randomUUID());
    const draft = await f.createCase(f.applicantA, crypto.randomUUID());
    await f.sql("update public.cases set stage=$1 where id=$2", [
      "received",
      submitted.caseId,
    ]);
    const seeded = await seedWorkflow(f, submitted.caseId);
    await f.sql(
      "insert into public.client_events(workspace_id,case_id,action,message) values($1,$2,$3,$4)",
      [f.workspaceId, draft.caseId, "SAVE_ANSWERS", "Your answers are saved."],
    );
    await f.sql(
      "insert into public.case_events(workspace_id,case_id,actor_user_id,action) values($1,$2,$3,$4)",
      [f.workspaceId, draft.caseId, f.applicantAUserId, "SAVE_ANSWERS"],
    );
    await t.test(
      "the applicant reads their own requests, document metadata and progress",
      async () => {
        const [request] = await rows(f.applicantA, "document_requests", {
          case_id: submitted.caseId,
        });
        assert.equal(request.id, seeded.requestId);
        assert.equal(request.title, "Mileage record");
        assert.equal(request.status, "open");
        const [document] = await rows(f.applicantA, "documents", {
          case_id: submitted.caseId,
        });
        assert.equal(document.id, seeded.documentId);
        assert.equal(document.request_id, seeded.requestId);
        assert.equal(document.source, "client");
        assert.equal(document.submitted_by_user_id, f.applicantAUserId);
        assert.equal(document.submitted_by_person_id, null);
        assert.deepEqual(
          (await rows(f.applicantA, "client_events"))
            .map((event) => event.action)
            .sort(),
          ["REQUEST_DOCUMENT", "SAVE_ANSWERS"],
        );
      },
    );
    await t.test(
      "internal staff records are empty for applicants, never errors",
      async () => {
        for (const table of PRESENTER_ONLY_TABLES) {
          const internal = await f.applicantA.from(table).select("*");
          assert.equal(internal.error, null, `${table} must not error`);
          assert.deepEqual(internal.data, [], `${table} must be empty`);
        }
        for (const table of WORKFLOW_TABLES) {
          const other = await f.applicantB.from(table).select("*");
          assert.equal(other.error, null, `${table} must not error`);
          assert.deepEqual(other.data, [], `${table} must hide other owners`);
        }
        for (const actor of [f.applicantA, f.applicantB, f.presenter])
          assert.ok((await actor.from("action_receipts").select("*")).error);
      },
    );
    await t.test(
      "the presenter reads every workflow record except private applicant drafts",
      async () => {
        for (const table of CLIENT_VISIBLE_TABLES)
          assert.equal(
            (await rows(f.presenter, table, { case_id: submitted.caseId }))
              .length,
            1,
            `${table} must be visible to the presenter`,
          );
        const [participant] = await rows(
          f.presenter,
          "preparation_participants",
        );
        assert.equal(participant.person_id, f.people.alex);
        const [followup] = await rows(f.presenter, "admin_followups");
        assert.equal(followup.id, seeded.followupId);
        assert.equal(followup.request_id, seeded.requestId);
        assert.equal(followup.assignee_person_id, f.people.sam);
        assert.equal(followup.status, "open");
        assert.equal(followup.resolution_outcome, null);
        const [contact] = await rows(f.presenter, "contact_log");
        assert.equal(contact.followup_id, seeded.followupId);
        assert.equal(contact.outcome, "no_answer");
        assert.equal(contact.logged_by_person_id, f.people.sam);
        const [version] = await rows(f.presenter, "contact_log_versions");
        assert.equal(version.contact_id, seeded.contactId);
        assert.equal(version.version, 1);
        const [event] = await rows(f.presenter, "case_events", {
          case_id: submitted.caseId,
        });
        assert.equal(event.action, "REQUEST_DOCUMENT");
        assert.deepEqual(event.detail, {
          requestId: seeded.requestId,
          internalNote: "Mileage looks incomplete.",
        });
        const items = await rows(f.presenter, "assistance_items");
        assert.equal(items.length, 2);
        const item = items.find((row) => row.id === seeded.assistanceId);
        assert.equal(item.case_id, submitted.caseId);
        assert.equal(item.status, "open");
        assert.equal(item.revision, 1);
        assert.equal(item.assignee_person_id, null);
        assert.equal(
          item.contact_preference,
          "Prefers calls from the main office.",
        );
        const standalone = items.find(
          (row) => row.id === seeded.standaloneAssistanceId,
        );
        assert.equal(standalone.case_id, null);
        for (const table of ["client_events", "case_events"])
          assert.deepEqual(
            await rows(f.presenter, table, { case_id: draft.caseId }),
            [],
            `${table} on a private draft`,
          );
      },
    );
    await t.test(
      "anonymous, outsider and unapproved callers read no workflow record",
      async () => {
        for (const table of WORKFLOW_TABLES) {
          const denied = await f.anonymous.from(table).select("*");
          assert.ok(denied.error, `${table} anonymous SELECT must fail`);
          assert.equal(denied.error.code, "42501", `${table} anonymous code`);
          for (const actor of [f.outsider, f.unapproved])
            assert.deepEqual(await rows(actor, table), [], `${table} outside`);
        }
      },
    );
    await t.test(
      "revoked members read nothing until their membership is restored",
      async () => {
        const setActive = (userId, active) =>
          f.sql("update public.memberships set active=$1 where user_id=$2", [
            active,
            userId,
          ]);
        const readsNothing = async (actor, label) => {
          for (const table of WORKFLOW_TABLES) {
            const revoked = await actor.from(table).select("*");
            assert.equal(revoked.error, null, `${table} must not error`);
            assert.deepEqual(revoked.data, [], `${table} revoked ${label}`);
          }
        };
        try {
          await setActive(f.applicantAUserId, false);
          await readsNothing(f.applicantA, "applicant");
        } finally {
          await setActive(f.applicantAUserId, true);
        }
        for (const table of CLIENT_VISIBLE_TABLES)
          assert.equal(
            (await rows(f.applicantA, table, { case_id: submitted.caseId }))
              .length,
            1,
            `${table} must return after restoration`,
          );
        try {
          await setActive(f.presenterUserId, false);
          await readsNothing(f.presenter, "presenter");
        } finally {
          await setActive(f.presenterUserId, true);
        }
        for (const table of WORKFLOW_TABLES)
          assert.ok(
            (await rows(f.presenter, table)).length,
            `${table} must return after restoration`,
          );
      },
    );
    await t.test(
      "direct writes by applicants and presenters fail and change nothing",
      async () => {
        const before = await workflowSnapshot(f);
        for (const table of WORKFLOW_TABLES)
          assert.ok(before[table].length, `${table} must hold a seeded row`);
        const probes = {
          preparation_participants: {
            filter: ["case_id", submitted.caseId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              person_id: f.people.morgan,
            },
            update: { person_id: f.people.morgan },
          },
          document_requests: {
            filter: ["id", seeded.requestId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              title: "Direct request",
              message: "Written without an action.",
              requested_by_person_id: f.people.alex,
            },
            update: { status: "verified" },
          },
          documents: {
            filter: ["id", seeded.documentId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              request_id: seeded.requestId,
              filename: "direct.pdf",
              source: "client",
              submitted_by_user_id: f.applicantAUserId,
            },
            update: { filename: "renamed.pdf" },
          },
          admin_followups: {
            filter: ["id", seeded.followupId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              request_id: seeded.requestId,
              assignee_person_id: f.people.sam,
              reason: "Direct escalation",
              created_by_person_id: f.people.alex,
            },
            update: { status: "cancelled" },
          },
          contact_log: {
            filter: ["id", seeded.contactId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              logged_by_user_id: f.presenterUserId,
              logged_by_person_id: f.people.sam,
              direction: "outgoing",
              contacted_at: new Date().toISOString(),
              with_whom: "client",
              method: "phone",
              purpose: "other",
              outcome: "reached",
            },
            update: { outcome: "reached" },
          },
          contact_log_versions: {
            filter: ["contact_id", seeded.contactId],
            insert: {
              contact_id: seeded.contactId,
              version: 2,
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              edited_by_user_id: f.presenterUserId,
              edited_by_person_id: f.people.sam,
              direction: "outgoing",
              contacted_at: new Date().toISOString(),
              with_whom: "client",
              method: "phone",
              purpose: "other",
              outcome: "reached",
            },
            update: { outcome: "reached" },
          },
          reviews: {
            filter: ["id", seeded.reviewId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              preparation_version: 2,
              reviewer_person_id: f.people.morgan,
            },
            // Findings are internal: no browser role rewrites or reads them.
            update: { status: "approved", findings: "Direct finding." },
          },
          case_events: {
            filter: ["id", seeded.caseEventId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              action: "REMIND",
            },
            update: { action: "REMIND" },
          },
          client_events: {
            filter: ["id", seeded.clientEventId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              action: "REMIND",
              message: "Written without an action.",
            },
            update: { message: "Rewritten." },
          },
          case_contacts: {
            filter: ["case_id", submitted.caseId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: draft.caseId,
              phone: "2155550199",
            },
            update: { phone: "2155550199" },
          },
          case_document_cards: {
            filter: ["case_id", submitted.caseId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              slot_id: "ssn.tp",
              status: "later",
            },
            update: { status: "none" },
          },
          case_materials: {
            filter: ["case_id", submitted.caseId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              item: "photo_id",
              recorded_by_person_id: f.people.sam,
            },
            update: { item: "photo_id" },
          },
          assistance_items: {
            filter: ["id", seeded.assistanceId],
            insert: {
              workspace_id: f.workspaceId,
              case_id: submitted.caseId,
              title: "Direct assistance item",
            },
            update: { status: "resolved" },
          },
        };
        assert.deepEqual(
          Object.keys(probes).sort(),
          [...WORKFLOW_TABLES].sort(),
        );
        for (const actor of [f.applicantA, f.presenter])
          for (const [table, probe] of Object.entries(probes)) {
            assert.ok(
              (await actor.from(table).insert(probe.insert)).error,
              `${table} direct INSERT must fail`,
            );
            assert.ok(
              (
                await actor
                  .from(table)
                  .update(probe.update)
                  .eq(probe.filter[0], probe.filter[1])
              ).error,
              `${table} direct UPDATE must fail`,
            );
            assert.ok(
              (
                await actor
                  .from(table)
                  .delete()
                  .eq(probe.filter[0], probe.filter[1])
              ).error,
              `${table} direct DELETE must fail`,
            );
          }
        assert.deepEqual(await workflowSnapshot(f), before);
      },
    );
    await t.test(
      "related identifiers cannot cross workspaces or cases",
      async () => {
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.document_requests(workspace_id,case_id,title,message,requested_by_person_id) values($1,$2,$3,$4,$5)",
              [
                f.foreignWorkspaceId,
                submitted.caseId,
                "Cross-workspace",
                "Rejected.",
                f.foreignPeople.alex,
              ],
            ),
          (error) => error.code === "23503",
        );
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.document_requests(workspace_id,case_id,title,message,requested_by_person_id) values($1,$2,$3,$4,$5)",
              [
                f.workspaceId,
                submitted.caseId,
                "Cross-workspace person",
                "Rejected.",
                f.foreignPeople.alex,
              ],
            ),
          (error) => error.code === "23503",
        );
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.documents(workspace_id,case_id,request_id,filename,source,submitted_by_user_id) values($1,$2,$3,$4,$5,$6)",
              [
                f.workspaceId,
                draft.caseId,
                seeded.requestId,
                "cross-case.pdf",
                "client",
                f.applicantAUserId,
              ],
            ),
          (error) => error.code === "23503",
        );
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.documents(workspace_id,case_id,request_id,filename,source,submitted_by_user_id,submitted_by_person_id) values($1,$2,$3,$4,$5,$6,$7)",
              [
                f.workspaceId,
                submitted.caseId,
                seeded.requestId,
                "unattributed.pdf",
                "staff_recorded",
                f.presenterUserId,
                null,
              ],
            ),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          () =>
            f.sql(
              "insert into public.admin_followups(workspace_id,case_id,request_id,assignee_person_id,reason,created_by_person_id) values($1,$2,$3,$4,$5,$6)",
              [
                f.workspaceId,
                submitted.caseId,
                seeded.requestId,
                f.people.sam,
                "Duplicate escalation",
                f.people.alex,
              ],
            ),
          (error) => error.code === "23505",
        );
      },
    );
    await t.test(
      "effective privileges keep workflow tables select-only for browser roles",
      async () => {
        for (const table of WORKFLOW_TABLES) {
          const relation = (
            await f.sql(
              "select relrowsecurity from pg_class where oid=$1::regclass",
              [`public.${table}`],
            )
          ).rows[0];
          assert.equal(relation.relrowsecurity, true, `${table} RLS`);
          for (const role of ["anon", "authenticated", "service_role"]) {
            const acl = (
              await f.sql(
                "select has_table_privilege($1,$2,'SELECT') as sel,has_table_privilege($1,$2,'INSERT') as can_insert,has_table_privilege($1,$2,'UPDATE') as can_update,has_table_privilege($1,$2,'DELETE') as can_delete",
                [role, `public.${table}`],
              )
            ).rows[0];
            assert.equal(acl.sel, role !== "anon", `${table} SELECT ${role}`);
            assert.equal(
              acl.can_insert,
              role === "service_role",
              `${table} INSERT ${role}`,
            );
            assert.equal(
              acl.can_update,
              role === "service_role",
              `${table} UPDATE ${role}`,
            );
            assert.equal(
              acl.can_delete,
              role === "service_role",
              `${table} DELETE ${role}`,
            );
          }
        }
        const policies = (
          await f.sql(
            "select c.relname as name,p.polcmd,p.polroles::regrole[]::text[] as roles,pg_get_expr(p.polqual,p.polrelid) as expression from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname=any($1) order by c.relname",
            [WORKFLOW_TABLES],
          )
        ).rows;
        assert.deepEqual(
          policies.map((policy) => policy.name),
          [...WORKFLOW_TABLES].sort(),
        );
        // Each workflow policy inlines its own copy of the case-visibility
        // rule; derive both halves from 001's visible_cases so drift fails here.
        const visibleCases = normalized(
          (
            await f.sql(
              "select pg_get_expr(polqual,polrelid) as expression from pg_policy where polname=$1",
              ["visible_cases"],
            )
          ).rows[0].expression,
        );
        const ownerRule = parenthesized(
          visibleCases,
          "(((m.access = 'applicant'::text)",
        ).replaceAll("cases.", "c.");
        const nonDraftRule = parenthesized(
          visibleCases,
          "((cases.origin <> ",
        ).replaceAll("cases.", "c.");
        for (const policy of policies) {
          assert.equal(policy.polcmd, "r", `${policy.name} must be read-only`);
          assert.deepEqual(policy.roles, ["authenticated"], policy.name);
          const expression = normalized(policy.expression);
          assert.ok(
            expression.includes(nonDraftRule),
            `${policy.name} must reuse the visible_cases draft rule`,
          );
          assert.ok(
            expression.includes(
              "(m.access = ANY (ARRAY['presenter'::text, 'staff'::text]))",
            ),
            `${policy.name} must check presenter and staff access`,
          );
          const ownerReadable = CLIENT_VISIBLE_TABLES.includes(policy.name);
          assert.equal(
            expression.includes(ownerRule),
            ownerReadable,
            `${policy.name} must reuse the visible_cases owner rule only when client-visible`,
          );
          assert.equal(
            expression.includes("'applicant'::text"),
            ownerReadable,
            `${policy.name} must grant applicant access only when client-visible`,
          );
        }
      },
    );
  } finally {
    await f.close();
  }
});
test("failed workspace setup rolls back marker and workspace and cleans tracked Auth users", async () => {
  let proof;
  await assert.rejects(async () => {
    const unexpected = await createDatabaseFixture({
      afterInitialize: async (details) => {
        proof = details;
        throw Object.assign(new Error("Injected setup failure."), {
          code: "TEST_SETUP_FAILURE",
        });
      },
    });
    await unexpected.close();
  }, rejected("TEST_SETUP_FAILURE"));
  assert.ok(proof);
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(`.vitally-runs/${proof.runId}.json`, "utf8"),
  );
  assert.equal(manifest.active, false);
  assert.deepEqual(manifest.userIds, []);
  assert.deepEqual(manifest.workspaceIds, []);
  assert.deepEqual(manifest.pendingWorkspaceIds, []);
  const { openDatabase } = await import("../tools/admin/database.mjs");
  const client = await openDatabase();
  try {
    assert.equal(
      (
        await client.query("select id from public.workspaces where id=$1", [
          proof.workspaceId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "select id from auth.users where id=any($1::uuid[])",
          [proof.userIds],
        )
      ).rowCount,
      0,
    );
  } finally {
    await client.end();
  }
});
test("serializable setup retries the whole transaction and bounds exhaustion", async () => {
  const { openDatabase, serializable } =
    await import("../tools/admin/database.mjs");
  const client = await openDatabase();
  try {
    await client.query("create temporary table retry_probe(attempt integer)");
    let attempts = 0;
    const accepted = await serializable(client, async (connection) => {
      attempts++;
      await connection.query("insert into retry_probe values($1)", [attempts]);
      if (attempts < 3)
        await connection.query("do $$begin raise serialization_failure; end$$");
      return attempts;
    });
    assert.equal(accepted, 3);
    assert.deepEqual(
      (await client.query("select attempt from retry_probe")).rows,
      [{ attempt: 3 }],
    );
    await client.query("truncate retry_probe");
    attempts = 0;
    await assert.rejects(
      () =>
        serializable(client, async (connection) => {
          attempts++;
          await connection.query("insert into retry_probe values($1)", [
            attempts,
          ]);
          await connection.query(
            "do $$begin raise serialization_failure; end$$",
          );
        }),
      (error) => error.code === "40001",
    );
    assert.equal(attempts, 3);
    assert.deepEqual(
      (await client.query("select attempt from retry_probe")).rows,
      [],
    );
  } finally {
    await client.end();
  }
});
