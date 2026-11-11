import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";
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
        const member = await f.staff({ key: "tae_preparer", name: "Tae Lindqvist", capabilities: ["prepare"] });
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
        const member = await f.staff({ key: "rue_in_order", name: "Rue Okafor", capabilities: ["prepare"] });
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
        const member = await f.staff({ key: "ines_intaker", name: "Ines Varga", capabilities: ["assist"] });
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
        const member = await f.staff({ key: "uma_uploaded", name: "Uma Castell", capabilities: [] });
        await inTransaction(f, async () => {
          await confirm(member.personId, ["vsc"], { status: "uploaded" });
          await setRoles(member.personId, ["greeter"]);
          await assert.rejects(() => f.sql("set constraints all immediate"), roleNeeds("greeter: VSC"));
        });
      });

      await t.test("another season's certificates do not count", async () => {
        const member = await f.staff({ key: "lev_last_season", name: "Lev Achebe", capabilities: [] });
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
        const member = await f.staff({ key: "kit_concurrent", name: "Kit Arden", capabilities: [] });
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
      const member = await f.staff({ key: "sol_signed_in", name: "Sol Brandt", capabilities: ["prepare"] });
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
      const member = await f.staff({ key: "dee_defaults", name: "Dee Marlowe", capabilities: ["prepare"] });
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
