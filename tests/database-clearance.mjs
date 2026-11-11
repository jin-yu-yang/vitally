import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createDatabaseFixture,
  rejected,
  SAMPLE_CONTACT,
  PREPARER,
  applyArgs,
  assistanceArgs,
  contactArgs,
  editContactArgs,
} from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";

// OpenSpec change add-volunteer-clearance (design D1-D2), migration 045: a
// role exists only once its certificates are confirmed, the role helpers, the
// photo ID columns, and the migration's guard and strip. Spec:
// volunteer-clearance. The file shares one fixture; every staff member below
// has a person key of their own, since `add_staff_member` refuses changed
// values for an existing key.

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/045_volunteer_clearance.sql", import.meta.url),
  "utf8",
);
const SECTION_1 = MIGRATION.split("-- 045 §1 begin")[1].split("-- 045 §1 end")[0];

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
// The role check's refusal: VALIDATION (VT007) with ROLE_NEEDS, naming the role.
const roleNeeds = (detail) => (error) =>
  rejected("VALIDATION")(error) &&
  error.cause?.code === "VT007" &&
  error.cause?.message === "ROLE_NEEDS" &&
  (detail === undefined || error.cause?.detail === detail);
// 045's own refusal: VT008, which no application code maps.
const refused045 = (error) =>
  rejected("VT008")(error) && /^045 refused/.test(error.cause?.message ?? "");

async function inTransaction(f, body) {
  await f.sql("begin");
  try {
    return await body();
  } finally {
    await f.sql("rollback");
  }
}

test("volunteer clearance against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const setRoles = (personId, roles, forSeason = season) =>
      f.sql(
        "update public.roster_entries set roles=$3::text[] where workspace_id=$1 and person_id=$2 and season=$4",
        [f.workspaceId, personId, roles, forSeason],
      );
    const confirm = (personId, certificates, { status = "confirmed", forSeason = season } = {}) =>
      f.sql(
        `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at)
          select $1::uuid,$2::uuid,$4::smallint,c,$5::text,case when $5::text='confirmed' then now() end
           from unnest($3::text[]) c`,
        [f.workspaceId, personId, certificates, forSeason, status],
      );
    const rolesOf = async (personId) =>
      (
        await one(
          f,
          "select roles from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, personId, season],
        )
      ).roles;
    const certificatesOf = async (personId) =>
      (
        await f.sql(
          "select season,certificate,status from public.certificates where workspace_id=$1 and person_id=$2 order by season,certificate",
          [f.workspaceId, personId],
        )
      ).rows;
    // A person with no sign-in and a current-season entry, by direct SQL.
    const volunteer = async (key, name, roles) => {
      const { id } = await one(
        f,
        "insert into public.people(workspace_id,person_key,name,capabilities) values($1,$2,$3,'{}') returning id",
        [f.workspaceId, key, name],
      );
      await f.sql(
        "insert into public.roster_entries(workspace_id,person_id,season,roles) values($1,$2,$3,$4::text[])",
        [f.workspaceId, id, season, roles],
      );
      return id;
    };

    await t.test("fixture staff are cleared with matching effective capabilities", async () => {
      const effective = async (personId) =>
        one(
          f,
          "select vitally_private.effective_capabilities($1,$2) as effective,vitally_private.cleared($1,$2) as cleared",
          [f.workspaceId, personId],
        );
      for (const [role, { personId }] of Object.entries(f.roleAccounts)) {
        const { capabilities } = await one(
          f,
          "select capabilities from public.people where workspace_id=$1 and id=$2",
          [f.workspaceId, personId],
        );
        const answer = await effective(personId);
        assert.deepEqual([...answer.effective].sort(), [...capabilities].sort(), role);
        assert.equal(answer.cleared, true, role);
      }
      const uncleared = await f.staff({
        key: "una_uncleared",
        name: "Una Hartley",
        capabilities: ["prepare"],
        cleared: false,
      });
      assert.equal((await effective(uncleared.personId)).cleared, false);
    });

    await t.test("last season only does not clear", async () => {
      const member = await f.staff({
        key: "lars_last_season",
        name: "Lars Ostrom",
        capabilities: ["prepare"],
        cleared: false,
      });
      await inTransaction(f, async () => {
        await f.sql(
          "insert into public.roster_entries(workspace_id,person_id,season,roles) values($1,$2,$3,'{preparer}')",
          [f.workspaceId, member.personId, season - 1],
        );
        await confirm(member.personId, ["vsc", "itqr", "basic"], { forSeason: season - 1 });
        const answer = await one(
          f,
          "select vitally_private.effective_capabilities($1,$2) as effective,vitally_private.cleared($1,$2) as cleared",
          [f.workspaceId, member.personId],
        );
        assert.deepEqual(answer, { effective: [], cleared: false });
      });
    });

    await t.test("role helpers", async () => {
      const value = async (text, values) => (await one(f, `select ${text} as v`, values)).v;
      assert.deepEqual(
        await value("vitally_private.missing_certificates('preparer','{vsc}')"),
        ["IT&QR", "Basic or Advanced"],
      );
      assert.deepEqual(
        await value("vitally_private.missing_certificates('reviewer','{vsc,itqr,advanced}')"),
        [],
      );
      assert.deepEqual(
        await value("vitally_private.missing_certificates('greeter','{}')"),
        ["VSC"],
      );
      assert.deepEqual(
        await value("vitally_private.missing_certificates('admin','{vsc,basic}')"),
        ["IT&QR"],
      );
      assert.deepEqual(
        await value("vitally_private.role_capabilities('{reviewer,intaker}')"),
        ["assist", "prepare", "receive_documents", "review"],
      );
      assert.deepEqual(await value("vitally_private.role_capabilities('{greeter}')"), []);
      assert.deepEqual(
        await value("vitally_private.role_capabilities('{admin}')"),
        ["admin", "assist", "followup", "receive_documents"],
      );
    });

    await t.test("effective capabilities and cleared", async () => {
      const member = await f.staff({
        key: "cora_helpers",
        name: "Cora Nilsen",
        capabilities: ["prepare", "review"],
        cleared: false,
      });
      const answers = async () =>
        one(
          f,
          "select vitally_private.effective_capabilities($1,$2) as effective,vitally_private.cleared($1,$2) as cleared",
          [f.workspaceId, member.personId],
        );
      assert.deepEqual(await answers(), { effective: [], cleared: false });
      await inTransaction(f, async () => {
        await setRoles(member.personId, ["preparer"]);
        await confirm(member.personId, ["vsc", "itqr", "basic"]);
        // The ceiling has review; the Preparer role doesn't give it.
        assert.deepEqual(await answers(), { effective: ["prepare"], cleared: true });
        await f.sql(
          "update public.roster_entries set is_new=true where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, member.personId, season],
        );
        assert.equal((await answers()).cleared, false, "new with no photo ID check");
        await f.sql(
          "update public.roster_entries set photo_id_checked_at=now() where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, member.personId, season],
        );
        assert.equal((await answers()).cleared, true, "new with the photo ID checked");
      });
      assert.deepEqual(
        (
          await one(f, "select vitally_private.effective_capabilities($1,gen_random_uuid()) as v", [
            f.workspaceId,
          ])
        ).v,
        [],
        "no entry",
      );
    });

    await t.test("the role trigger", async (t) => {
      await t.test("a role without its certificates is refused", async () => {
        const member = await f.staff({ key: "tae_preparer", name: "Tae Lindqvist", capabilities: ["prepare"], cleared: false });
        await inTransaction(f, async () => {
          await setRoles(member.personId, ["preparer"]);
          await confirm(member.personId, ["vsc"]);
          await assert.rejects(
            () => f.sql("set constraints all immediate"),
            roleNeeds("preparer: IT&QR, Basic or Advanced"),
          );
        });
        assert.deepEqual(await rolesOf(member.personId), []);
        assert.deepEqual(await certificatesOf(member.personId), []);
      });

      await t.test("roles first, then the certificates, commits", async () => {
        const member = await f.staff({ key: "rue_in_order", name: "Rue Okafor", capabilities: ["prepare"], cleared: false });
        await f.sql("begin");
        try {
          await setRoles(member.personId, ["preparer"]);
          await confirm(member.personId, ["vsc", "itqr", "basic"]);
          await f.sql("commit");
        } catch (error) {
          await f.sql("rollback");
          throw error;
        }
        assert.deepEqual(await rolesOf(member.personId), ["preparer"]);
      });

      await t.test("deleting a needed certificate is refused at commit", async () => {
        const member = await f.staff({ key: "ines_intaker", name: "Ines Varga", capabilities: ["assist"], cleared: false });
        await f.sql("begin");
        await setRoles(member.personId, ["intaker"]);
        await confirm(member.personId, ["vsc", "itqr"]);
        await f.sql("commit");
        await f.sql("begin");
        try {
          await f.sql(
            "delete from public.certificates where workspace_id=$1 and person_id=$2 and certificate='itqr'",
            [f.workspaceId, member.personId],
          );
          await assert.rejects(() => f.sql("commit"), roleNeeds("intaker: IT&QR"));
        } finally {
          await f.sql("rollback"); // only a warning once the failed commit has ended it
        }
        assert.deepEqual(
          (await certificatesOf(member.personId)).map((row) => row.certificate),
          ["itqr", "vsc"],
        );
      });

      await t.test("an uploaded certificate does not count", async () => {
        const member = await f.staff({ key: "uma_uploaded", name: "Uma Castell", capabilities: [], cleared: false });
        await inTransaction(f, async () => {
          await confirm(member.personId, ["vsc"], { status: "uploaded" });
          await setRoles(member.personId, ["greeter"]);
          await assert.rejects(() => f.sql("set constraints all immediate"), roleNeeds("greeter: VSC"));
        });
      });

      await t.test("another season's certificates do not count", async () => {
        const member = await f.staff({ key: "lev_last_season", name: "Lev Achebe", capabilities: [], cleared: false });
        await inTransaction(f, async () => {
          await f.sql(
            "insert into public.roster_entries(workspace_id,person_id,season) values($1,$2,$3)",
            [f.workspaceId, member.personId, season - 1],
          );
          await confirm(member.personId, ["vsc"], { forSeason: season - 1 });
          await setRoles(member.personId, ["greeter"]);
          await assert.rejects(() => f.sql("set constraints all immediate"), roleNeeds("greeter: VSC"));
        });
      });

      // Two connections. A adds Greeter and holds the entry's row lock; B
      // deletes the VSC that Greeter needs, and its commit-time check waits
      // on that lock. Once A commits, B's check reads Greeter and refuses.
      // Without the lock B's check would not wait; the test asserts the wait.
      await t.test("a role added and its certificate deleted concurrently: one commits", async () => {
        const member = await f.staff({ key: "kit_concurrent", name: "Kit Arden", capabilities: [], cleared: false });
        await confirm(member.personId, ["vsc"]); // autocommit: VSC, no roles
        const other = await openDatabase({ kind: "test" });
        try {
          const { pid } = (await other.query("select pg_backend_pid() as pid")).rows[0];
          await f.sql("begin");
          let committedA = false;
          try {
            await setRoles(member.personId, ["greeter"]);
            await other.query("begin");
            await other.query(
              "delete from public.certificates where workspace_id=$1 and person_id=$2 and certificate='vsc'",
              [f.workspaceId, member.personId],
            );
            const commitB = other.query("commit").then(
              () => null,
              (error) => error,
            );
            let waiting = false;
            for (let i = 0; i < 100 && !waiting; i += 1) {
              waiting = (
                await one(
                  f,
                  "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') as w",
                  [pid],
                )
              ).w;
              if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.equal(waiting, true, "B's check waits on the entry's row lock");
            await f.sql("commit");
            committedA = true;
            const errorB = await commitB;
            assert.equal(errorB?.code, "VT007", "B is refused");
            assert.equal(errorB?.message, "ROLE_NEEDS");
            assert.equal(errorB?.detail, "greeter: VSC");
          } finally {
            if (!committedA) await f.sql("rollback");
          }
          assert.deepEqual(await rolesOf(member.personId), ["greeter"]);
          assert.deepEqual(
            (await certificatesOf(member.personId)).map((row) => [row.certificate, row.status]),
            [["vsc", "confirmed"]],
          );
        } finally {
          await other.query("rollback").catch(() => {});
          await other.end();
        }
      });
    });

    // The role check is deferred to commit, and each of these transactions is
    // rolled back, so the unsupported roles below can stand while §1 runs: the
    // state before 045's trigger existed.
    await t.test("045 §1 strips unsupported roles from people with no sign-in", async () => {
      await inTransaction(f, async () => {
        const preparer = await volunteer("strip_preparer", "Noa Fell", ["preparer"]);
        await confirm(preparer, ["vsc"]);
        const pair = await volunteer("strip_pair", "Ezra Quint", ["intaker", "greeter"]);
        const reviewer = await volunteer("strip_reviewer", "Mina Sato", ["reviewer"]);
        await confirm(reviewer, ["vsc", "itqr", "advanced"]);
        const before = {
          preparer: await certificatesOf(preparer),
          pair: await certificatesOf(pair),
          reviewer: await certificatesOf(reviewer),
        };
        await f.sql(SECTION_1);
        assert.deepEqual(await rolesOf(preparer), []);
        assert.deepEqual(await rolesOf(pair), []);
        assert.deepEqual(await rolesOf(reviewer), ["reviewer"]);
        assert.deepEqual(
          {
            preparer: await certificatesOf(preparer),
            pair: await certificatesOf(pair),
            reviewer: await certificatesOf(reviewer),
          },
          before,
        );
      });
    });

    await t.test("045 §1 refuses when a signed-in person would lose a role", async () => {
      const member = await f.staff({ key: "sol_signed_in", name: "Sol Brandt", capabilities: ["prepare"], cleared: false });
      await inTransaction(f, async () => {
        await setRoles(member.personId, ["preparer"]);
        await confirm(member.personId, ["vsc"]);
        await assert.rejects(() => f.sql(SECTION_1), refused045);
      });
      assert.deepEqual(await rolesOf(member.personId), []);
    });

    await t.test("existing entries are not new", async () => {
      const { n } = await one(
        f,
        "select count(*)::int n from public.roster_entries where workspace_id<>$1 and (is_new or photo_id_checked_at is not null)",
        [f.workspaceId],
      );
      assert.equal(n, 0);
      // A new entry takes the defaults.
      const member = await f.staff({ key: "dee_defaults", name: "Dee Marlowe", capabilities: ["prepare"], cleared: false });
      const { is_new, photo_id_checked_at } = await one(
        f,
        "select is_new,photo_id_checked_at from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3",
        [f.workspaceId, member.personId, season],
      );
      assert.deepEqual({ is_new, photo_id_checked_at }, { is_new: false, photo_id_checked_at: null });
    });
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// The read gate (design D3): the 21 case-data policies read only for a cleared
// staff member, through the no-argument InitPlan helper
// `vitally_policy.cleared_workspace_id()`. `people` is not gated.

const CASE_TABLES = Object.freeze([
  "admin_followups",
  "assistance_items",
  "case_contacts",
  "case_document_cards",
  "case_events",
  "case_materials",
  "cases",
  "client_events",
  "contact_attempts",
  "contact_log",
  "contact_log_versions",
  "document_requests",
  "documents",
  "filing_attempts",
  "filing_notes",
  "filing_returns",
  "preparation_participants",
  "preparer_questionnaires",
  "preparer_shaded_fields",
  "reviewer_questionnaires",
  "reviews",
]);

// What a staff member reads of one table, by the policies' own rule and over
// the privileged connection: the workspace's rows, less those of a private
// client draft. An assistance item with no case is staff work too.
const PRIVATE_DRAFT = "c.origin='client' and c.stage='draft'";
const staffCountSql = (table) =>
  table === "cases"
    ? `select count(*)::int n from public.cases c where c.workspace_id=$1 and not (${PRIVATE_DRAFT})`
    : table === "assistance_items"
      ? `select count(*)::int n from public.assistance_items t where t.workspace_id=$1
          and (t.case_id is null or exists(select 1 from public.cases c
           where c.workspace_id=t.workspace_id and c.id=t.case_id and not (${PRIVATE_DRAFT})))`
      : `select count(*)::int n from public.${table} t join public.cases c on c.workspace_id=t.workspace_id and c.id=t.case_id
          where t.workspace_id=$1 and not (${PRIVATE_DRAFT})`;

// The tables the setup below must fill, so that an empty read is the gate's
// doing and not an empty table's.
const FILLED = Object.freeze([
  "admin_followups",
  "assistance_items",
  "case_events",
  "cases",
  "client_events",
  "contact_log",
  "contact_log_versions",
  "document_requests",
  "filing_attempts",
  "preparation_participants",
  "preparer_questionnaires",
  "reviewer_questionnaires",
  "reviews",
]);

test("the read gate against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const readAll = async (client, table) => {
      const { data, error } = await client.from(table).select("*");
      assert.equal(error, null, `${table} read`);
      return data;
    };
    const staffCount = async (table) => (await one(f, staffCountSql(table), [f.workspaceId])).n;

    // Case data in as many tables as the public actions reach: a private draft
    // staff must never read, an assisted case with a document request, a logged
    // and edited contact, an assistance request, an approved case with the
    // office's go-over follow-up, and a filed case with a rejected return.
    await f.draftCase(f.applicantA);
    const assisted = await f.assistedCase();
    const { contactId } = await f.logContact(f.preparer, assisted, SAMPLE_CONTACT());
    await f.editContact(f.preparer, contactId, { ...SAMPLE_CONTACT(), note: "Fictional corrected note." });
    await f.seedAssistance();
    await f.approvedCase({ wentOver: false });
    const filed = await f.approvedCase();
    const act = (type, payload) => f.act(f.siteCoordinator, filed, type, payload);
    await act("MARK_READY_TO_EFILE", { confirmed: true });
    await act("MARK_EFILED", { confirmed: true, methods: { federal: "efile", state: "efile" } });
    const { d: day } = await one(f, "select (now() at time zone 'America/New_York')::date::text d");
    await act("RECORD_FILING_RESULT", {
      confirmed: true,
      results: {
        federal: { result: "accepted", date: day },
        state: { result: "rejected", date: day, code: "IND-031-04" },
      },
      fixNote: "Fictional note: correct the dependent's SSN.",
    });
    // A client case with a document request, for the client's own reads.
    const clientCase = await f.readyCase();
    await f.act(f.preparer, clientCase, "CLAIM_PREPARATION", {});
    await f.act(f.preparer, clientCase, "REQUEST_DOCUMENT", f.sampleRequest);
    for (const table of FILLED) assert.ok((await staffCount(table)) > 0, `the setup fills ${table}`);

    await t.test("an uncleared staff member reads no case data", async () => {
      const member = await f.staff({
        key: "ulla_uncleared",
        name: "Ulla Brenner",
        capabilities: ["prepare"],
        cleared: false,
      });
      for (const table of CASE_TABLES)
        assert.deepEqual(await readAll(member.client, table), [], table);
      // `people` is not gated: their own row and the default follow-up person.
      const ids = (await readAll(member.client, "people")).map((row) => row.id);
      const { default_followup_person_id: followup } = await one(
        f,
        "select default_followup_person_id from public.workspaces where id=$1",
        [f.workspaceId],
      );
      assert.ok(ids.includes(member.personId), "their own row");
      assert.ok(ids.includes(followup), "the default follow-up person");
    });

    await t.test("a cleared staff member reads as before", async () => {
      for (const table of CASE_TABLES)
        assert.equal((await readAll(f.preparer, table)).length, await staffCount(table), table);
    });

    await t.test("clients are unchanged", async () => {
      const own = async () => {
        const out = {};
        for (const table of ["cases", "documents", "document_requests"])
          out[table] = (await readAll(f.applicantA, table)).map((row) => row.id).sort();
        return out;
      };
      const before = await own();
      assert.ok(before.cases.length > 0, "the client reads their cases");
      assert.ok(before.document_requests.length > 0, "the client reads their requests");
      // A cleared staff member loses their roles, and so their clearance.
      const member = await f.staff({ key: "cleo_cleared", name: "Cleo Varga", capabilities: ["prepare"] });
      assert.ok((await readAll(member.client, "cases")).length > 0, "cleared, the member reads cases");
      await f.sql(
        `update public.roster_entries r set roles='{}' from public.workspaces w
          where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
        [f.workspaceId, member.personId],
      );
      assert.deepEqual(await readAll(member.client, "cases"), [], "uncleared, the member reads none");
      assert.deepEqual(await own(), before);
    });

    await t.test("every case-data policy is gated", async () => {
      const { rows } = await f.sql(
        `select tablename,policyname,qual from pg_policies
          where schemaname='public' and qual like '%access = ''staff''%' and tablename<>'people'
          order by tablename`,
      );
      assert.equal(rows.length, 21);
      assert.deepEqual(rows.map((row) => row.tablename), [...CASE_TABLES]);
      for (const row of rows)
        assert.ok(row.qual.includes("cleared_workspace_id"), `${row.tablename}.${row.policyname}`);
      const people = await f.sql("select qual from pg_policies where schemaname='public' and tablename='people'");
      for (const row of people.rows) assert.equal(row.qual.includes("cleared_workspace_id"), false, "people");
    });

    await t.test("the helper runs once per statement", async () => {
      const plan = await inTransaction(f, async () => {
        await f.sql("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: f.preparerUserId, role: "authenticated" }),
        ]);
        await f.sql("set local role authenticated");
        const { rows } = await f.sql("explain (format json, verbose) select * from public.cases");
        const value = rows[0]["QUERY PLAN"];
        return (typeof value === "string" ? JSON.parse(value) : value)[0].Plan;
      });
      const CALL = "cleared_workspace_id(";
      // A node's own text: every field but its children.
      const text = (node) =>
        Object.entries(node)
          .filter(([key]) => key !== "Plans")
          .map(([, value]) => (Array.isArray(value) ? value.join(" ") : String(value)))
          .join(" ");
      const subtree = (node) => [text(node), ...(node.Plans ?? []).map(subtree)].join(" ");
      const initPlans = [];
      const outside = [];
      const visit = (node, inInitPlan) => {
        const isInitPlan = String(node["Subplan Name"] ?? "").startsWith("InitPlan");
        if (isInitPlan) initPlans.push(node);
        const within = inInitPlan || isInitPlan;
        if (!within && text(node).includes(CALL)) outside.push(node["Node Type"]);
        for (const child of node.Plans ?? []) visit(child, within);
      };
      visit(plan, false);
      const shown = JSON.stringify(plan);
      assert.ok(initPlans.some((node) => subtree(node).includes(CALL)), `an InitPlan calls the helper: ${shown}`);
      assert.deepEqual(outside, [], `no node outside an InitPlan calls the helper: ${shown}`);
    });
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// The action gate (design D4): the six case RPCs refuse an uncleared staff
// member with NOT_CLEARED (VT009) before any lookup or receipt, and a staff
// caller acts with their effective capabilities. VT009 is not mapped yet
// (src/contracts.mjs), so the raw SQLSTATE and message are checked.

const ALL_CAPABILITIES = Object.freeze(["prepare", "review", "admin", "followup", "assist", "receive_documents"]);
const notCleared = (error) => error?.code === "VT009" && error?.message === "NOT_CLEARED";
const setCurrentRoles = (f, personId, roles) =>
  f.sql(
    `update public.roster_entries r set roles=$3::text[] from public.workspaces w
      where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
    [f.workspaceId, personId, roles],
  );

test("the action gate against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const revisionOf = async (caseId) =>
      Number((await one(f, "select revision from public.cases where id=$1", [caseId])).revision);
    const refusedNotCleared = async (client, fn, args) => {
      const { error } = await client.rpc(fn, args);
      assert.ok(notCleared(error), `${fn}: ${error?.code} ${error?.message}`);
      assert.equal(await f.receiptsFor(args.p_action_id), 0, `${fn} stored a receipt`);
    };

    await t.test("each case RPC refuses an uncleared staff member", async () => {
      const member = await f.staff({
        key: "nell_uncleared",
        name: "Nell Ashby",
        capabilities: [...ALL_CAPABILITIES],
        cleared: false,
      });
      // Real targets that the member's ceiling would otherwise reach.
      const ready = await f.readyCase();
      const { itemId } = await f.seedAssistance();
      const approved = await f.approvedCase();
      const prepared = await f.preparedCase();
      const { contactId } = await f.logContact(f.preparer, prepared, SAMPLE_CONTACT());
      const calls = [
        [
          "vitally_apply_action",
          applyArgs({ caseId: ready, revision: await revisionOf(ready), type: "CLAIM_PREPARATION" }),
        ],
        ["vitally_assistance_action", assistanceArgs({ itemId, revision: 1, type: "CLAIM" })],
        [
          "vitally_close_unsigned",
          {
            p_action_id: randomUUID(),
            p_cases: [{ caseId: approved, revision: await revisionOf(approved) }],
            p_confirmed: true,
          },
        ],
        ["vitally_create_case", { p_action_id: randomUUID(), p_mode: "assisted", p_answers: {} }],
        ["vitally_log_contact", contactArgs({ caseId: prepared, entry: SAMPLE_CONTACT() })],
        ["vitally_edit_contact", editContactArgs({ contactId, revision: 1, entry: SAMPLE_CONTACT() })],
      ];
      const before = await f.stateSnapshot();
      for (const [fn, args] of calls) await refusedNotCleared(member.client, fn, args);
      assert.deepEqual(await f.stateSnapshot(), before, "nothing changes");
    });

    await t.test("unknown id gets NOT_CLEARED", async () => {
      const member = await f.staff({
        key: "uri_unknown",
        name: "Uri Castane",
        capabilities: ["prepare"],
        cleared: false,
      });
      await refusedNotCleared(
        member.client,
        "vitally_apply_action",
        applyArgs({ caseId: randomUUID(), revision: 1, type: "CLAIM_PREPARATION" }),
      );
    });

    await t.test("a replay after losing clearance", async () => {
      const member = await f.staff({ key: "pia_replay", name: "Pia Lindgren", capabilities: ["prepare"] });
      const caseId = await f.readyCase();
      const args = applyArgs({ caseId, revision: await revisionOf(caseId), type: "CLAIM_PREPARATION" });
      const claimed = await member.client.rpc("vitally_apply_action", args);
      assert.equal(claimed.error, null, "the cleared claim");
      try {
        await setCurrentRoles(f, member.personId, []);
        const { error } = await member.client.rpc("vitally_apply_action", args);
        assert.ok(notCleared(error), `replay: ${error?.code} ${error?.message}`);
      } finally {
        await f.clearStaff(member.personId, ["prepare"]);
      }
    });

    await t.test("clients are not checked", async () => {
      const { caseId } = await f.submittedClientCase();
      assert.equal((await one(f, "select stage from public.cases where id=$1", [caseId])).stage, "received");
    });

    await t.test("effective capabilities", async (t) => {
      // Each member's ceiling is wider than the roles f.clearStaff gives them.
      const member = async (key, name, ceiling, roleCapabilities) => {
        const made = await f.staff({ key, name, capabilities: ceiling, cleared: false });
        await f.clearStaff(made.personId, roleCapabilities);
        return made;
      };

      await t.test("a Preparer with review in the ceiling cannot claim a review", async () => {
        const prep = await member("pax_preparer", "Pax Moreau", ["prepare", "review"], ["prepare"]);
        const caseId = await f.preparedCase();
        await assert.rejects(() => f.act(prep.client, caseId, "CLAIM_REVIEW", {}), rejected("INELIGIBLE"));
      });

      await t.test("a Reviewer with only review in the ceiling cannot claim preparation", async () => {
        const reviewer = await member("rhea_reviewer", "Rhea Duval", ["review"], ["review"]);
        const caseId = await f.readyCase();
        await assert.rejects(
          () => f.act(reviewer.client, caseId, "CLAIM_PREPARATION", {}),
          rejected("INELIGIBLE"),
        );
      });

      await t.test("an Intaker with admin in the ceiling cannot create an assisted case", async () => {
        const intaker = await member("ida_intaker", "Ida Brandt", ["admin"], ["assist"]);
        const actionId = randomUUID();
        await assert.rejects(
          () => f.createCase(intaker.client, actionId, { mode: "assisted" }),
          rejected("FORBIDDEN"),
        );
        assert.equal(await f.receiptsFor(actionId), 0);
      });

      // Review Focus 1: losing the Preparer role mid-case. The person holds the
      // case, so the role is set directly; as a Greeter they stay cleared.
      await t.test("a Preparer made a Greeter mid-case cannot keep preparing", async () => {
        const prep = await f.staff({ key: "gus_greeter", name: "Gus Halloran", capabilities: ["prepare"] });
        const caseId = await f.readyCase();
        await f.act(prep.client, caseId, "CLAIM_PREPARATION", {});
        await setCurrentRoles(f, prep.personId, ["greeter"]);
        await assert.rejects(
          () => f.act(prep.client, caseId, "REQUEST_DOCUMENT", f.sampleRequest),
          rejected("INELIGIBLE"),
        );
        const { n } = await one(f, "select count(*)::int n from public.document_requests where case_id=$1", [caseId]);
        assert.equal(n, 0);
      });
    });

    await t.test("self-review still holds for a Reviewer", async () => {
      const reviewer = await f.staff({ key: "sky_reviewer", name: "Sky Okonjo", capabilities: ["prepare", "review"] });
      const caseId = await f.readyCase();
      await f.act(reviewer.client, caseId, "CLAIM_PREPARATION", {});
      await f.act(reviewer.client, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
      await assert.rejects(() => f.act(reviewer.client, caseId, "CLAIM_REVIEW", {}), rejected("SELF_REVIEW"));
    });

    // The Roster stays on the ceiling: an uncleared admin still saves.
    await t.test("an uncleared admin can save a volunteer", async () => {
      const lead = await f.staff({
        key: "ada_uncleared_admin",
        name: "Ada Whitcombe",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      const { data, error } = await lead.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: {
          name: "Bea Lowell",
          email: `v-${randomUUID()}@example.org`,
          phone: null,
          works: "on_site",
          languages: ["english"],
          otherLanguage: null,
          roles: ["greeter"],
          certificates: ["vsc"],
        },
      });
      assert.equal(error, null, `vitally_save_volunteer: ${error?.code}`);
      assert.equal(data.revision, 1);
    });
  } finally {
    await f.close();
  }
});

test("vitally_my_clearance against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const myClearance = async (client) => {
      const { data, error } = await client.rpc("vitally_my_clearance");
      assert.equal(error, null, `vitally_my_clearance: ${error?.code} ${error?.message}`);
      return data;
    };

    await t.test("an uncleared staff member sees their Form 13615 missing", async () => {
      const member = await f.staff({
        key: "una_my_clearance",
        name: "Una Pryce",
        capabilities: ["prepare"],
        cleared: false,
      });
      assert.deepEqual(await myClearance(member.client), {
        cleared: false,
        missing: [{ kind: "form13615" }],
        capabilities: [],
        isAdmin: false,
        siteCoordinatorName: "Avery Lin",
      });
    });

    await t.test("a cleared preparer sees nothing missing", async () => {
      assert.deepEqual(await myClearance(f.preparer), {
        cleared: true,
        missing: [],
        capabilities: ["prepare"],
        isAdmin: false,
        siteCoordinatorName: "Avery Lin",
      });
    });

    await t.test("the answer has exactly five keys", async () => {
      const result = await myClearance(f.preparer);
      assert.deepEqual(Object.keys(result).sort(), [
        "capabilities",
        "cleared",
        "isAdmin",
        "missing",
        "siteCoordinatorName",
      ]);
    });

    await t.test("a new volunteer without a photo ID check is not cleared", async () => {
      const member = await f.staff({ key: "nia_new", name: "Nia Tolliver", capabilities: ["prepare"] });
      const setNew = (checked) =>
        f.sql(
          `update public.roster_entries r set is_new=true,photo_id_checked_at=case when $3::boolean then now() end
            from public.workspaces w
            where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
          [f.workspaceId, member.personId, checked],
        );
      await setNew(false);
      const unchecked = await myClearance(member.client);
      assert.equal(unchecked.cleared, false);
      assert.deepEqual(unchecked.missing, [{ kind: "photoId" }]);
      // The capabilities are the roles' (effective_capabilities); the read gate
      // and the action gate, not this list, hold an uncleared person back.
      assert.deepEqual(unchecked.capabilities, ["prepare"]);
      await setNew(true);
      const checked = await myClearance(member.client);
      assert.equal(checked.cleared, true);
      assert.deepEqual(checked.missing, []);
      assert.deepEqual(checked.capabilities, ["prepare"]);
    });

    await t.test("an uncleared admin still reports the admin ceiling", async () => {
      const lead = await f.staff({
        key: "ada_my_clearance",
        name: "Ada Brandt",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      const result = await myClearance(lead.client);
      assert.equal(result.cleared, false);
      assert.equal(result.isAdmin, true);
      assert.deepEqual(result.capabilities, []);
    });

    await t.test("a role whose certificates are gone lists what it lacks", async () => {
      const member = await f.staff({ key: "rex_my_clearance", name: "Rex Dunmore", capabilities: ["prepare"] });
      // The role check would refuse this state, so it is switched off while the
      // certificates are removed; the function must still describe it.
      await f.sql("alter table public.certificates disable trigger certificates_role_certificates");
      try {
        await f.sql(
          "delete from public.certificates where workspace_id=$1 and person_id=$2 and certificate in ('itqr','basic','advanced')",
          [f.workspaceId, member.personId],
        );
        const result = await myClearance(member.client);
        assert.deepEqual(result.missing, [
          { kind: "role", role: "preparer", certificates: ["IT&QR", "Basic or Advanced"] },
        ]);
      } finally {
        await f.sql("alter table public.certificates enable trigger certificates_role_certificates");
      }
    });

    await t.test("a client is refused with FORBIDDEN", async () => {
      const { data, error } = await f.applicantA.rpc("vitally_my_clearance");
      assert.equal(data, null);
      assert.equal(error?.code, "VT001");
      assert.equal(error?.message, "FORBIDDEN");
    });
  } finally {
    await f.close();
  }
});

// Task 5b: assigning work only to a cleared person (design D13).
test("assignees must be cleared against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("require_cleared_assignee", async () => {
      const uncleared = await f.staff({
        key: "ugo_assignee",
        name: "Ugo Maren",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      const cleared = await f.staff({ key: "cleo_assignee", name: "Cleo Vance", capabilities: ["admin", "followup"] });
      await assert.rejects(
        () => f.sql("select vitally_private.require_cleared_assignee($1,$2)", [f.workspaceId, uncleared.personId]),
        (error) => error.cause?.code === "VT006" && error.cause?.message === "INELIGIBLE",
      );
      await f.sql("select vitally_private.require_cleared_assignee($1,$2)", [f.workspaceId, cleared.personId]);
      const { rows } = await f.sql(
        `select has_function_privilege('anon',p.oid,'EXECUTE') anon,
                has_function_privilege('authenticated',p.oid,'EXECUTE') browser,
                has_function_privilege('service_role',p.oid,'EXECUTE') service
           from pg_proc p where p.proname='require_cleared_assignee' and p.pronamespace='vitally_private'::regnamespace`,
      );
      assert.deepEqual(rows, [{ anon: false, browser: false, service: false }]);
    });

    await t.test("today's assigning functions", async () => {
      const { rows } = await f.sql(
        `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('vitally_private','public') and p.prokind='f'
            and p.prosrc ~* $1
          order by p.proname`,
        [
          "(set|,)\\s*(assignee_person_id|preparer_id|reviewer_id|default_followup_person_id)\\s*=|insert into public\\.(admin_followups|assistance_items|reviews|preparation_participants)",
        ],
      );
      assert.deepEqual(
        rows.map((row) => row.proname),
        [
          "act_approve_review",
          "act_assistance_claim",
          "act_claim_preparation",
          "act_claim_review",
          "act_close_case",
          "act_escalate_contact",
          "act_request_corrections",
          "act_withdraw",
          "hand_to_review",
          "set_default_followup",
        ],
        "a new assigning function must call vitally_private.require_cleared_assignee or be classified as system-assigned (design D13)",
      );
    });

    await t.test("an uncleared default follow-up person still receives work", async () => {
      const coordinatorId = f.roleAccounts.siteCoordinator.personId;
      // The setup needs the coordinator, who reads nothing once uncleared.
      const requested = await f.readyCase();
      await f.act(f.preparer, requested, "CLAIM_PREPARATION", {});
      await f.act(f.preparer, requested, "REQUEST_DOCUMENT", f.sampleRequest);
      const { id: requestId } = await one(f, "select id from public.document_requests where case_id=$1", [requested]);
      const withdrawn = await f.readyCase();
      await f.act(f.preparer, withdrawn, "CLAIM_PREPARATION", {});
      await setCurrentRoles(f, coordinatorId, []);
      try {
        await f.act(f.preparer, requested, "ESCALATE_CONTACT", {
          requestId,
          reason: "No response to the document request.",
        });
        const followups = (
          await f.sql("select status,assignee_person_id from public.admin_followups where case_id=$1", [requested])
        ).rows;
        assert.deepEqual(followups, [{ status: "open", assignee_person_id: coordinatorId }]);

        await f.act(f.applicantA, withdrawn, "WITHDRAW", { confirmed: true });
        const notice = (
          await f.sql(
            "select assignee_person_id from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
            [withdrawn],
          )
        ).rows;
        assert.deepEqual(notice, [{ assignee_person_id: coordinatorId }]);
      } finally {
        await f.clearStaff(coordinatorId, ["admin", "followup", "assist", "receive_documents"]);
      }
    });
  } finally {
    await f.close();
  }
});
