import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../tools/admin/database.mjs";

// Migrations 040 and 043 (OpenSpec changes remove-sample-case-tools and
// remove-presenter-access): the sample-case machinery and presenter access are
// gone from the catalog, nothing that stays depends on them, the public API is
// exactly the ten RPCs, and the private functions stay out of every client's
// reach. Every check reads the catalog over a plain connection; the refused
// inserts run in a transaction that is rolled back.

// The row-security policies at 051, by table and name. 043 renames the
// sixteen staff-only policies and drops or adds none; 044 adds the three
// admin-only Roster policies; 047 adds the admin-only accounts policy;
// 049 adds the two posted_updates policies (an admin's and the audience's).
// 051 adds the two staff-only case label policies. 056 adds the two schedule
// viewer policies (shifts and schedule_settings). update_reads has none.
const POLICIES = Object.freeze([
  ["accounts", "admin_accounts"],
  ["admin_followups", "staff_admin_followups"],
  ["assistance_items", "staff_assistance_items"],
  ["case_contacts", "visible_case_contacts"],
  ["case_label_links", "staff_read_case_label_links"],
  ["case_labels", "staff_read_case_labels"],
  ["certificates", "admin_certificates"],
  ["case_document_cards", "visible_case_document_cards"],
  ["case_events", "staff_case_events"],
  ["case_materials", "staff_case_materials"],
  ["cases", "visible_cases"],
  ["client_events", "visible_client_events"],
  ["contact_attempts", "staff_contact_attempts"],
  ["contact_log", "staff_contact_log"],
  ["contact_log_versions", "staff_contact_log_versions"],
  ["document_requests", "visible_document_requests"],
  ["documents", "visible_documents"],
  ["filing_attempts", "staff_filing_attempts"],
  ["filing_notes", "staff_filing_notes"],
  ["filing_returns", "staff_filing_returns"],
  ["memberships", "own_membership"],
  ["people", "staff_people"],
  ["posted_updates", "admin_posted_updates"],
  ["posted_updates", "audience_posted_updates"],
  ["preparation_participants", "staff_preparation_participants"],
  ["preparer_questionnaires", "staff_preparer_questionnaires"],
  ["preparer_shaded_fields", "staff_preparer_shaded_fields"],
  ["return_to_signing_exit_forms", "staff_return_to_signing_exit_forms"],
  ["reviewer_questionnaires", "staff_reviewer_questionnaires"],
  ["reviews", "staff_reviews"],
  ["roster_entries", "admin_roster_entries"],
  ["schedule_settings", "viewer_schedule_settings"],
  ["shifts", "viewer_shifts"],
  ["volunteer_profiles", "admin_volunteer_profiles"],
  ["workspaces", "member_workspace"],
]);
// The thirty-one public RPCs after 055, by name and identity arguments.
const RPCS = Object.freeze([
  "vitally_apply_action(p_action_id uuid, p_case_id uuid, p_expected_revision bigint, p_type text, p_payload jsonb)",
  "vitally_assistance_action(p_action_id uuid, p_item_id uuid, p_expected_revision bigint, p_type text, p_note text)",
  "vitally_close_unsigned(p_action_id uuid, p_cases jsonb, p_confirmed boolean)",
  "vitally_create_case(p_action_id uuid, p_mode text, p_answers jsonb)",
  "vitally_log_contact(p_action_id uuid, p_case_id uuid, p_followup_id uuid, p_entry jsonb)",
  "vitally_edit_contact(p_action_id uuid, p_contact_id uuid, p_expected_revision bigint, p_entry jsonb)",
  "vitally_save_volunteer(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_volunteer jsonb)",
  "vitally_save_label(p_action_id uuid, p_label_id uuid, p_expected_revision bigint, p_label jsonb)",
  "vitally_set_case_label(p_action_id uuid, p_case_id uuid, p_label_id uuid, p_on boolean)",
  "vitally_my_clearance()",
  "vitally_prepare_account(p_action_id uuid, p_op text, p_target jsonb)",
  "vitally_record_account(p_action_id uuid, p_op text, p_target jsonb, p_user_id uuid)",
  "vitally_deactivate_account(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)",
  "vitally_reactivate_account(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint)",
  "vitally_set_site_coordinator(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_granted boolean)",
  "vitally_client_invitations()",
  "vitally_cancel_invitation(p_action_id uuid, p_target jsonb, p_expected_revision bigint)",
  "vitally_expire_invitations()",
  "vitally_complete_site_check(p_name text, p_sidn text)",
  "vitally_activate_client_account()",
  "vitally_save_update(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_update jsonb)",
  "vitally_update_action(p_action_id uuid, p_update_id uuid, p_expected_revision bigint, p_type text)",
  "vitally_mark_updates(p_update_ids uuid[], p_confirm boolean)",
  "vitally_my_updates()",
  "vitally_posted_updates()",
  "vitally_client_documents_link()",
  "vitally_season_settings()",
  "vitally_save_season_settings(p_action_id uuid, p_expected_revision bigint, p_settings jsonb)",
  "vitally_save_schedule_settings(p_action_id uuid, p_expected_revision bigint, p_settings jsonb)",
  "vitally_save_shift(p_action_id uuid, p_shift_id uuid, p_expected_revision bigint, p_shift jsonb)",
  "vitally_remove_shift(p_action_id uuid, p_shift_id uuid, p_expected_revision bigint)",
  "vitally_schedule_day(p_date date)",
  "vitally_my_profile()",
  "vitally_save_my_usual_days(p_action_id uuid, p_expected_revision bigint, p_days integer[])",
  "vitally_set_site_number(p_action_id uuid, p_sidn text)",
  "vitally_mark_upload_sent(p_action_id uuid, p_document text)",
  "vitally_mark_upload_reviewed(p_action_id uuid, p_volunteer_id uuid, p_expected_revision bigint, p_document text)",
  "vitally_start_next_season(p_action_id uuid, p_expected_season smallint, p_typed_year smallint)",
]);
// The public RPCs that only read: no action id, no digest.
// The RPCs that take no action id and store no digest: the reads, and (047,
// design D11, D12, D15) the expiry sweep, the caller's own site check and a
// client's first-read activation, whose repeat is harmless or judged afresh.
// vitally_mark_updates (add-posted-updates) is naturally idempotent.
const READ_ONLY_RPCS = Object.freeze([
  "vitally_activate_client_account",
  "vitally_client_documents_link()",
  "vitally_client_documents_link",
  "vitally_client_invitations",
  "vitally_complete_site_check",
  "vitally_expire_invitations",
  "vitally_mark_updates",
  "vitally_my_clearance",
  "vitally_my_profile",
  "vitally_my_updates",
  "vitally_posted_updates",
  "vitally_prepare_account",
  "vitally_schedule_day",
  "vitally_season_settings",
]);
// The signatures 043 and 052 drop by name.
const OLD_SIGNATURES = Object.freeze([
  "public.vitally_apply_action(uuid,uuid,bigint,uuid,text,jsonb)",
  "public.vitally_assistance_action(uuid,uuid,bigint,uuid,text,text)",
  "public.vitally_close_unsigned(uuid,uuid,jsonb,boolean)",
  "public.vitally_create_case(uuid,text,uuid,jsonb)",
  "public.vitally_log_contact(uuid,uuid,uuid,uuid,jsonb)",
  "public.vitally_edit_contact(uuid,uuid,bigint,uuid,jsonb)",
  "vitally_private.acting_person(public.memberships,uuid)",
  "vitally_private.initialize_workspace(uuid,uuid[],uuid[])",
  "vitally_private.deactivate_account(uuid,uuid)",
]);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pairs = (rows) => rows.map((row) => `${row[0]} ${row[1]}`).sort(byText);
const REFERENCE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const reference = () => {
  const pick = () =>
    Array.from({ length: 4 }, () => REFERENCE_CHARS[Math.floor(Math.random() * REFERENCE_CHARS.length)]).join("");
  return `VT-${pick()}-${pick()}`;
};

test("the catalog after the sample-case tools and presenter access are removed", async (t) => {
  const db = await openDatabase();
  const sql = (text, values) => db.query(text, values);
  // A statement the database must refuse, run in a transaction that is rolled
  // back, after any setup statements. A check constraint is evaluated before
  // the foreign keys, so the row never needs a real account.
  const refused = async (text, values, constraint, setup = []) => {
    await sql("begin");
    try {
      for (const [setupText, setupValues] of setup) await sql(setupText, setupValues);
      await assert.rejects(
        () => sql(text, values),
        (error) => {
          assert.equal(error.code, "23514");
          assert.equal(error.constraint, constraint);
          return true;
        },
      );
    } finally {
      await sql("rollback");
    }
  };
  try {
    await t.test("no function, constraint or view mentions the sample machinery", async () => {
      const functions = await sql(
        `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','vitally_private') and (p.prosrc ~* 'fixture' or p.proname ~* 'fixture')
          order by 1,2`,
      );
      assert.deepEqual(functions.rows, []);
      const constraints = await sql(
        "select conrelid::regclass::text as rel, conname from pg_constraint where pg_get_constraintdef(oid) ~* 'fixture' order by 1,2",
      );
      assert.deepEqual(constraints.rows, []);
      const views = await sql(
        "select schemaname, viewname from pg_views where definition ~* 'fixture' order by 1,2",
      );
      assert.deepEqual(views.rows, []);
    });

    await t.test("no function, constraint, policy or view mentions presenter", async () => {
      const functions = await sql(
        `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','vitally_private') and p.prosrc ~* 'presenter'
          order by 1,2`,
      );
      assert.deepEqual(functions.rows, []);
      const constraints = await sql(
        "select conrelid::regclass::text as rel, conname from pg_constraint where pg_get_constraintdef(oid) ~* 'presenter' order by 1,2",
      );
      assert.deepEqual(constraints.rows, []);
      const policies = await sql(
        `select polrelid::regclass::text as rel, polname from pg_policy
          where polname ~* 'presenter' or pg_get_expr(polqual, polrelid) ~* 'presenter'
          order by 1,2`,
      );
      assert.deepEqual(policies.rows, []);
      const views = await sql(
        "select schemaname, viewname from pg_views where definition ~* 'presenter' order by 1,2",
      );
      assert.deepEqual(views.rows, []);
    });

    await t.test("every table keeps exactly its RLS policies", async () => {
      const { rows } = await sql(
        "select polrelid::regclass::text as rel, polname from pg_policy order by 1,2",
      );
      assert.deepEqual(
        pairs(rows.map((row) => [row.rel, row.polname])),
        pairs(POLICIES),
      );
    });

    await t.test("the public API is exactly thirty-one RPCs", async () => {
      const { rows } = await sql(
        `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
           from pg_proc p where p.pronamespace='public'::regnamespace`,
      );
      assert.deepEqual(rows.map((row) => row.signature).sort(byText), [...RPCS].sort(byText));
      const access = await sql(
        `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as ok
           from pg_proc p cross join (values ('authenticated'),('anon'),('service_role')) r(role)
          where p.pronamespace='public'::regnamespace
          order by 1,2`,
      );
      assert.equal(access.rows.length, RPCS.length * 3);
      for (const row of access.rows)
        assert.equal(row.ok, row.role === "authenticated", `${row.proname} ${row.role}`);
      const named = await sql(
        `select p.proname from pg_proc p
          where p.pronamespace='public'::regnamespace and 'p_person_id'=any(coalesce(p.proargnames, '{}'))`,
      );
      assert.deepEqual(named.rows, []);
    });

    await t.test("the old signatures are gone", async () => {
      for (const signature of OLD_SIGNATURES) {
        const { rows } = await sql("select to_regprocedure($1) is null as gone", [signature]);
        assert.equal(rows[0].gone, true, signature);
      }
    });

    // 047 (review round 2, design D15): membership_in_use and the first-use
    // trigger name the foreign keys to memberships by hand, so a new table that
    // refers to a membership must be added to both. The person's link and the
    // account are the two that an unclaimed invitation may have. Schemas named
    // test_hold_ are the accounts test's own, dropped when it ends.
    await t.test("membership_in_use and the first-use trigger cover every foreign key to memberships", async () => {
      const keys = await sql(
        `select c.conrelid::regclass::text as rel, a.attname as col
           from pg_constraint c
           join pg_class r on r.oid=c.conrelid
           join pg_namespace n on n.oid=r.relnamespace
           cross join lateral unnest(c.conkey) k(attnum)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
          where c.contype='f' and c.confrelid='public.memberships'::regclass
            and a.attname<>'workspace_id' and n.nspname not like 'test\\_hold\\_%'`,
      );
      const keyed = keys.rows.map((row) => `${row.rel}.${row.col}`).sort(byText);
      const unclaimed = ["accounts.user_id", "people.user_id"];
      for (const key of unclaimed) assert.ok(keyed.includes(key), key);
      const inUse = keyed.filter((key) => !unclaimed.includes(key));
      assert.equal(inUse.length, new Set(inUse).size, "one key per column");

      const source = await sql(
        "select prosrc from pg_proc where oid='vitally_private.membership_in_use(uuid,uuid)'::regprocedure",
      );
      const checked = [
        ...source.rows[0].prosrc.matchAll(/from public\.(\w+) where workspace_id=p_workspace_id and (\w+)=p_user_id/g),
      ].map(([, rel, col]) => `${rel}.${col}`);
      assert.deepEqual(checked.sort(byText), inUse, "membership_in_use");

      const triggers = await sql(
        `select tgrelid::regclass::text as rel, pg_get_triggerdef(oid) as def
           from pg_trigger where tgname='vitally_client_account_used'`,
      );
      const used = triggers.rows.map((row) => `${row.rel}.${row.def.match(/client_account_used\('(\w+)'\)/)?.[1]}`);
      assert.deepEqual(used.sort(byText), inUse, "vitally_client_account_used");
    });

    await t.test("private entry points are not callable by clients", async () => {
      for (const signature of [
        "vitally_private.acting_person(public.memberships)",
        "vitally_private.initialize_workspace(uuid,uuid[])",
      ])
        for (const role of ["anon", "authenticated", "service_role"]) {
          const { rows } = await sql(
            "select has_function_privilege($1, $2::regprocedure, 'execute') as ok",
            [role, signature],
          );
          assert.equal(rows[0].ok, false, `${signature} ${role}`);
        }
    });

    await t.test("the digest still records the resolved person", async () => {
      const { rows } = await sql(
        "select p.proname, p.prosrc from pg_proc p where p.pronamespace='public'::regnamespace order by 1",
      );
      assert.equal(rows.length, RPCS.length);
      for (const row of rows.filter((entry) => !READ_ONLY_RPCS.includes(entry.proname)))
        assert.match(row.prosrc, /'personId',\s*v_person\.id/, row.proname);
    });

    await t.test("the access check allows two values", async () => {
      const { rows } = await sql(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.memberships'::regclass and conname='memberships_access_check'",
      );
      assert.equal(rows.length, 1);
      assert.match(rows[0].def, /'applicant'/);
      assert.match(rows[0].def, /'staff'/);
      await refused(
        "insert into public.memberships(workspace_id,user_id,access) values($1,$2,'presenter')",
        [randomUUID(), randomUUID()],
        "memberships_access_check",
      );
    });

    await t.test("the version-2-only check exists and allows only 2", async () => {
      const { rows } = await sql(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.cases'::regclass and conname='cases_intake_version_range'",
      );
      assert.deepEqual(
        rows.map((row) => row.def.replace(/\s+/g, " ").trim()),
        ["CHECK ((intake_version = 2))"],
      );
    });

    await t.test("a case's origin is client or assisted", async () => {
      for (const name of ["cases_origin_check", "cases_origin_owner"]) {
        const { rows } = await sql(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.cases'::regclass and conname=$1",
          [name],
        );
        assert.equal(rows.length, 1, name);
        assert.match(rows[0].def, /'client'/, name);
        assert.match(rows[0].def, /'assisted'/, name);
      }
      // Otherwise a valid client row, so only the origin check can refuse it.
      // The workspace gives the row its intake version; the transaction is
      // rolled back.
      const workspaceId = randomUUID();
      await refused(
        "insert into public.cases(reference,workspace_id,owner_user_id,origin,created_by_user_id) values($1,$2,$3,'fixture',$3)",
        [reference(), workspaceId, randomUUID()],
        "cases_origin_check",
        [["insert into public.workspaces(id) values($1)", [workspaceId]]],
      );
    });

    await t.test("vitally_policy holds exactly the admin check, the clearance check, the update audience check, the schedule viewer check and the unpublished window, with exactly their grants", async () => {
      const { rows } = await sql(
        `select p.oid, p.oid::regprocedure::text as signature, p.prosecdef, p.provolatile, p.proconfig,
                p.proargnames, p.pronargs
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='vitally_policy' order by 2`,
      );
      assert.deepEqual(
        rows.map((row) => row.signature.replace(/^vitally_policy\./, "")),
        [
          "cleared_workspace_id()",
          "in_update_audience(uuid,text,text[])",
          "is_schedule_viewer(uuid)",
          "is_workspace_admin(uuid)",
          "unpublished_read_window()",
        ],
      );
      const [cleared, audience, viewer, admin, readWindow] = rows;
      assert.equal(cleared.proargnames, null);
      assert.equal(cleared.pronargs, 0);
      assert.deepEqual(viewer.proargnames, ["p_workspace_id"]); // 056
      assert.equal(viewer.pronargs, 1);
      assert.deepEqual(admin.proargnames, ["p_workspace_id"]);
      assert.equal(admin.pronargs, 1);
      assert.deepEqual(audience.proargnames, ["p_workspace_id", "p_audience", "p_roles"]);
      assert.equal(audience.pronargs, 3);
      // The unpublished window (049, design D7) is a constant: immutable, and
      // not security definer, because it reads nothing.
      assert.equal(readWindow.pronargs, 0);
      assert.equal(readWindow.prosecdef, false);
      assert.equal(readWindow.provolatile, "i");
      for (const helper of rows) {
        if (helper !== readWindow) {
          assert.equal(helper.prosecdef, true, helper.signature);
          assert.equal(helper.provolatile, "s", helper.signature);
        }
        assert.deepEqual(helper.proconfig, ['search_path=""'], helper.signature);
        for (const name of helper.proargnames ?? [])
          assert.doesNotMatch(name, /user|account|member|person/i, helper.signature);
        const grants = await sql(
          `select a.grantee, r.rolname, a.privilege_type
             from pg_proc p cross join lateral aclexplode(p.proacl) a
             left join pg_roles r on r.oid=a.grantee
            where p.oid=$1 and a.grantee<>p.proowner`,
          [helper.oid],
        );
        assert.deepEqual(
          grants.rows.map(({ rolname, privilege_type }) => [rolname, privilege_type]),
          [["authenticated", "EXECUTE"]],
          helper.signature,
        );
        assert.equal(grants.rows.some((row) => Number(row.grantee) === 0), false, `public ${helper.signature}`);
        for (const role of ["anon", "service_role"]) {
          const access = await sql("select has_function_privilege($1, $2::oid, 'execute') as ok", [role, helper.oid]);
          assert.equal(access.rows[0].ok, false, `${role} ${helper.signature}`);
        }
      }
      const schema = await sql(
        `select r.rolname, a.privilege_type
           from pg_namespace n cross join lateral aclexplode(n.nspacl) a
           left join pg_roles r on r.oid=a.grantee
          where n.nspname='vitally_policy' and a.grantee<>n.nspowner`,
      );
      assert.deepEqual(
        schema.rows.map(({ rolname, privilege_type }) => [rolname, privilege_type]),
        [["authenticated", "USAGE"]],
      );
    });

    await t.test("no client can execute any private function", async () => {
      const { rows } = await sql(
        `select p.oid::regprocedure::text as signature, r.role
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           cross join (values ('public'),('anon'),('authenticated')) r(role)
          where n.nspname='vitally_private' and has_function_privilege(r.role, p.oid, 'execute')
          order by 1,2`,
      );
      assert.deepEqual(rows, []);
      const total = await sql(
        "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vitally_private'",
      );
      assert.ok(total.rows[0].n > 0, "the private schema has functions to check");
    });

    await t.test("workspace setup can run initialize_workspace and no client can", async () => {
      const signature = "vitally_private.initialize_workspace(uuid,uuid[])";
      const { rows } = await sql(
        "select has_function_privilege(current_user, $1::regprocedure, 'execute') as ok",
        [signature],
      );
      assert.equal(rows[0].ok, true, "the tooling's own role");
      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows } = await sql(
          "select has_function_privilege($1, $2::regprocedure, 'execute') as ok",
          [role, signature],
        );
        assert.equal(rows[0].ok, false, role);
      }
      const old = await sql(
        "select to_regprocedure('vitally_private.initialize_workspace(uuid,uuid[],uuid[],jsonb)') is null as gone",
      );
      assert.equal(old.rows[0].gone, true);
    });
  } finally {
    await db.end();
  }
});
