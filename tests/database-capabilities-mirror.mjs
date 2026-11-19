import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// OpenSpec change add-season-settings (design D1, D8), migration 052:
// people.capabilities mirror the person's current-season role capabilities
// while they have a sign-in, and are empty otherwise; the migration's guard
// refuses when someone with a sign-in would lose admin. Spec:
// volunteer-clearance. The file shares one fixture; every staff member below
// has a person key of their own.

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/052_season_settings.sql", import.meta.url),
  "utf8",
);
const SECTION_1 = MIGRATION.split("-- 052 §1 begin")[1].split("-- 052 §1 end")[0];
// §1's count, copied from the section: the guard reads every workspace, so the
// guard tests compare against this baseline, taken in the same snapshot,
// rather than assume no other workspace has an offender.
const OFFENDERS = `select count(*)::int as n
  from public.memberships m
  join public.people p on p.workspace_id=m.workspace_id and p.user_id=m.user_id
  where m.active and m.access='staff' and 'admin'=any(p.capabilities)
   and not exists(select 1 from public.workspaces w
    join public.roster_entries r on r.workspace_id=w.id and r.season=w.current_season
    where w.id=p.workspace_id and r.person_id=p.id and 'admin'=any(r.roles))`;

const REPEATABLE_READ = "begin isolation level repeatable read";
const REALTIME_DEADLINE_MS = 15_000;
const CONTROL_ATTEMPT_MS = 2_500;

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
// 052's own refusal: VT008, which no application code maps, naming the count.
const refused052 = (count) => (error) =>
  rejected("VT008")(error) &&
  /^052 refused: .*\(\d+\)$/.test(error.cause?.message ?? "") &&
  error.cause.message.endsWith(`(${count})`);

async function inTransaction(f, body, begin = "begin") {
  await f.sql(begin);
  try {
    return await body();
  } finally {
    await f.sql("rollback");
  }
}

test("people.capabilities mirror this season's roles against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const setRoles = (personId, roles) =>
      f.sql(
        "update public.roster_entries set roles=$3::text[] where workspace_id=$1 and person_id=$2 and season=$4",
        [f.workspaceId, personId, roles, season],
      );
    const confirm = (personId, certificates) =>
      f.sql(
        `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at)
          select $1::uuid,$2::uuid,$4::smallint,c,'confirmed',now() from unnest($3::text[]) c
          on conflict (workspace_id,person_id,season,certificate) do update set status='confirmed',confirmed_at=now()`,
        [f.workspaceId, personId, certificates, season],
      );
    const capabilitiesOf = async (personId) =>
      (
        await one(f, "select capabilities from public.people where workspace_id=$1 and id=$2", [
          f.workspaceId,
          personId,
        ])
      ).capabilities;
    // The people write the mirror would replace, with the triggers off for the
    // rest of the statement: only inside a transaction the test rolls back.
    const writeAround = async (text, values) => {
      await f.sql("set local session_replication_role=replica");
      await f.sql(text, values);
      await f.sql("set local session_replication_role=origin");
    };

    await t.test("the 052 guard refuses an admin without the Admin role", async () => {
      await inTransaction(
        f,
        async () => {
          // The copy above still counts what §1 counts.
          const squash = (text) => text.replace(/\s+/g, " ");
          assert.ok(squash(SECTION_1).includes(squash(OFFENDERS.split("as n")[1])));
          const { n: baseline } = await one(f, OFFENDERS);
          await setRoles(f.siteCoordinatorId, []);
          await writeAround(
            "update public.people set capabilities='{admin,assist,followup,receive_documents}' where workspace_id=$1 and id=$2",
            [f.workspaceId, f.siteCoordinatorId],
          );
          await assert.rejects(() => f.sql(SECTION_1), refused052(baseline + 1));
        },
        REPEATABLE_READ,
      );
    });

    await t.test("the guard ignores people with no sign-in", async () => {
      await inTransaction(
        f,
        async () => {
          const { n: baseline } = await one(f, OFFENDERS);
          await writeAround(
            "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'gus_guard','Gus Mendel','{admin,assist,followup,receive_documents}')",
            [f.workspaceId],
          );
          // Unchanged by the admin with no sign-in: passes when nobody else
          // offends, and otherwise refuses with the same count.
          if (baseline === 0) await f.sql(SECTION_1);
          else await assert.rejects(() => f.sql(SECTION_1), refused052(baseline));
        },
        REPEATABLE_READ,
      );
    });

    await t.test("the mirror follows role changes", async () => {
      const member = await f.staff({ key: "mira_mirror", name: "Mira Okafor", capabilities: ["prepare"] });
      assert.deepEqual(await capabilitiesOf(member.personId), ["prepare"]);
      await f.sql("begin");
      try {
        await confirm(member.personId, ["advanced"]);
        await setRoles(member.personId, ["preparer", "reviewer"]);
        await f.sql("commit");
      } catch (error) {
        await f.sql("rollback").catch(() => {});
        throw error;
      }
      assert.deepEqual(await capabilitiesOf(member.personId), ["prepare", "review"]);
      await setRoles(member.personId, []);
      assert.deepEqual(await capabilitiesOf(member.personId), []);
    });

    await t.test("a direct write is replaced", async () => {
      const member = await f.staff({ key: "greta_greeter", name: "Greta Lund", capabilities: [] });
      assert.deepEqual(
        (
          await one(f, "select roles from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
            f.workspaceId,
            member.personId,
            season,
          ])
        ).roles,
        ["greeter"],
      );
      await f.sql("update public.people set capabilities='{prepare}' where workspace_id=$1 and id=$2", [
        f.workspaceId,
        member.personId,
      ]);
      assert.deepEqual(await capabilitiesOf(member.personId), []);
    });

    await t.test("no sign-in means no capabilities", async () => {
      // A Roster volunteer with no sign-in, the Preparer role and its
      // certificates, whose address an account will later sign in with.
      const account = await f.provision();
      const { id: personId } = await one(
        f,
        "insert into public.people(workspace_id,person_key,name,capabilities) values($1,'roster_noor','Noor Halvorsen','{}') returning id",
        [f.workspaceId],
      );
      await f.sql("insert into public.volunteer_profiles(workspace_id,person_id,email) values($1,$2,$3)", [
        f.workspaceId,
        personId,
        account.email.toLowerCase(),
      ]);
      await f.sql("begin");
      try {
        await f.sql(
          "insert into public.roster_entries(workspace_id,person_id,season,roles) values($1,$2,$3,'{preparer}')",
          [f.workspaceId, personId, season],
        );
        await confirm(personId, ["vsc", "itqr", "basic"]);
        await f.sql("commit");
      } catch (error) {
        await f.sql("rollback").catch(() => {});
        throw error;
      }
      assert.deepEqual(await capabilitiesOf(personId), []);
      const read = async () => {
        const { data, error } = await f.preparer.from("people").select("id,capabilities").eq("id", personId);
        assert.equal(error, null);
        return data;
      };
      assert.deepEqual(await read(), []);
      // The account path links the account to the volunteer (add_staff_member's
      // roster link), and the mirror then gives them their role's capabilities.
      await f.withSetupLock(() =>
        f.sql("select vitally_private.add_staff_member($1,$2,$3,$4,$5::text[])", [
          f.workspaceId,
          account.userId,
          "noor_nosignin",
          "Noor Halvorsen",
          ["prepare"],
        ]),
      );
      assert.deepEqual(await capabilitiesOf(personId), ["prepare"]);
      assert.deepEqual(await read(), [{ id: personId, capabilities: ["prepare"] }]);
    });

    await t.test("the people realtime message carries the mirror", async () => {
      const member = await f.staff({ key: "rhea_realtime", name: "Rhea Castillo", capabilities: ["prepare"] });
      await confirm(member.personId, ["advanced"]);
      const payloads = [];
      const errors = [];
      let stopped = false;
      const channel = f.siteCoordinator.channel(`vitally-test:${randomUUID()}`);
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "people" }, (payload) =>
        payloads.push(payload),
      );
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`the admin channel never subscribed within ${REALTIME_DEADLINE_MS}ms`)),
            REALTIME_DEADLINE_MS,
          );
          channel.subscribe((status, error) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(timer);
              resolve();
            } else if (status !== "CLOSED" || !stopped)
              errors.push(`${status}${error ? ` (${error.message})` : ""}`);
          });
        });
        // Realtime restarts streaming lazily, so the role change is repeated
        // until its people row arrives; each repeat touches the row again.
        const matches = (payload) =>
          payload.new?.id === member.personId &&
          JSON.stringify(payload.new?.capabilities) === JSON.stringify(["prepare", "review"]);
        const deadline = Date.now() + REALTIME_DEADLINE_MS;
        let seen = null;
        do {
          await setRoles(member.personId, ["reviewer"]);
          const until = Date.now() + Math.max(500, Math.min(CONTROL_ATTEMPT_MS, deadline - Date.now()));
          while (!(seen = payloads.find(matches)) && Date.now() < until)
            await new Promise((resolve) => setTimeout(resolve, 100));
        } while (!seen && Date.now() < deadline);
        assert.ok(seen, `the people change never arrived within ${REALTIME_DEADLINE_MS}ms`);
        assert.deepEqual(seen.new.capabilities, ["prepare", "review"]);
        assert.deepEqual(errors, []);
      } finally {
        stopped = true;
        f.siteCoordinator.removeChannel(channel);
      }
    });
  } finally {
    await f.close();
  }
});
