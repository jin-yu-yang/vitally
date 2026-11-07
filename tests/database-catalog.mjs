import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// Migration 040 (OpenSpec change remove-sample-case-tools): the sample-case
// machinery is gone from the catalog, nothing that stays depends on it, and
// the private functions stay out of every client's reach.

// The row-security policies at 039, one per table, by table and name. 040
// drops no policy and adds none; the catalog at 039 is the authority.
const POLICIES = Object.freeze([
  ["admin_followups", "presenter_admin_followups"],
  ["assistance_items", "presenter_assistance_items"],
  ["case_contacts", "visible_case_contacts"],
  ["case_document_cards", "visible_case_document_cards"],
  ["case_events", "presenter_case_events"],
  ["case_materials", "presenter_case_materials"],
  ["cases", "visible_cases"],
  ["client_events", "visible_client_events"],
  ["contact_attempts", "presenter_contact_attempts"],
  ["contact_log", "presenter_contact_log"],
  ["contact_log_versions", "presenter_contact_log_versions"],
  ["document_requests", "visible_document_requests"],
  ["documents", "visible_documents"],
  ["filing_attempts", "presenter_filing_attempts"],
  ["filing_notes", "presenter_filing_notes"],
  ["filing_returns", "presenter_filing_returns"],
  ["memberships", "own_membership"],
  ["people", "presenter_people"],
  ["preparation_participants", "presenter_preparation_participants"],
  ["preparer_questionnaires", "presenter_preparer_questionnaires"],
  ["preparer_shaded_fields", "presenter_preparer_shaded_fields"],
  ["reviewer_questionnaires", "presenter_reviewer_questionnaires"],
  ["reviews", "presenter_reviews"],
  ["workspaces", "member_workspace"],
]);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pairs = (rows) => rows.map((row) => `${row[0]} ${row[1]}`).sort(byText);
const REFERENCE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const reference = () => {
  const pick = () =>
    Array.from({ length: 4 }, () => REFERENCE_CHARS[Math.floor(Math.random() * REFERENCE_CHARS.length)]).join("");
  return `VT-${pick()}-${pick()}`;
};

test("the catalog after the sample-case tools are removed", async (t) => {
  const f = await createDatabaseFixture({ roleAccounts: false });
  try {
    await t.test("no function, constraint or view mentions the sample machinery", async () => {
      const functions = await f.sql(
        `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','vitally_private') and (p.prosrc ~* 'fixture' or p.proname ~* 'fixture')
          order by 1,2`,
      );
      assert.deepEqual(functions.rows, []);
      const constraints = await f.sql(
        "select conrelid::regclass::text as rel, conname from pg_constraint where pg_get_constraintdef(oid) ~* 'fixture' order by 1,2",
      );
      assert.deepEqual(constraints.rows, []);
      const views = await f.sql(
        "select schemaname, viewname from pg_views where definition ~* 'fixture' order by 1,2",
      );
      assert.deepEqual(views.rows, []);
    });

    await t.test("every table keeps exactly its RLS policies", async () => {
      const { rows } = await f.sql(
        "select polrelid::regclass::text as rel, polname from pg_policy order by 1,2",
      );
      assert.deepEqual(
        pairs(rows.map((row) => [row.rel, row.polname])),
        pairs(POLICIES),
      );
    });

    await t.test("the version-2-only check exists and allows only 2", async () => {
      const { rows } = await f.sql(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.cases'::regclass and conname='cases_intake_version_range'",
      );
      assert.deepEqual(
        rows.map((row) => row.def.replace(/\s+/g, " ").trim()),
        ["CHECK ((intake_version = 2))"],
      );
    });

    await t.test("a case's origin is client or assisted", async () => {
      for (const name of ["cases_origin_check", "cases_origin_owner"]) {
        const { rows } = await f.sql(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.cases'::regclass and conname=$1",
          [name],
        );
        assert.equal(rows.length, 1, name);
        assert.match(rows[0].def, /'client'/, name);
        assert.match(rows[0].def, /'assisted'/, name);
      }
      // Otherwise a valid client row, so only the origin check can refuse it.
      await assert.rejects(
        () =>
          f.sql(
            "insert into public.cases(reference,workspace_id,owner_user_id,origin,created_by_user_id) values($1,$2,$3,'fixture',$3)",
            [reference(), f.workspaceId, f.applicantAUserId],
          ),
        (error) => {
          assert.equal(error.code, "23514");
          assert.equal(error.cause?.constraint, "cases_origin_check");
          return true;
        },
      );
    });

    await t.test("no client can execute any private function", async () => {
      const { rows } = await f.sql(
        `select p.oid::regprocedure::text as signature, r.role
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           cross join (values ('public'),('anon'),('authenticated')) r(role)
          where n.nspname='vitally_private' and has_function_privilege(r.role, p.oid, 'execute')
          order by 1,2`,
      );
      assert.deepEqual(rows, []);
      const total = await f.sql(
        "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vitally_private'",
      );
      assert.ok(total.rows[0].n > 0, "the private schema has functions to check");
    });

    await t.test("workspace setup can run initialize_workspace and no client can", async () => {
      const signature = "vitally_private.initialize_workspace(uuid,uuid[],uuid[])";
      const { rows } = await f.sql(
        "select has_function_privilege(current_user, $1::regprocedure, 'execute') as ok",
        [signature],
      );
      assert.equal(rows[0].ok, true, "the tooling's own role");
      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows } = await f.sql(
          "select has_function_privilege($1, $2::regprocedure, 'execute') as ok",
          [role, signature],
        );
        assert.equal(rows[0].ok, false, role);
      }
      const old = await f.sql(
        "select to_regprocedure('vitally_private.initialize_workspace(uuid,uuid[],uuid[],jsonb)') is null as gone",
      );
      assert.equal(old.rows[0].gone, true);
    });
  } finally {
    await f.close();
  }
});
