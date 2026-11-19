import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, TEST_SITE_NUMBER } from "./support/database-fixture.mjs";

// OpenSpec change add-season-settings (design D2, D4, D6), migration 052: the
// site coordinator flag on accounts and its history, the workspace admin check
// (a site coordinator, or the Admin role this season), and the SC certificate
// in clearance. Specs: site-coordinators, volunteer-clearance, volunteer-roster.
// The file shares one fixture; every staff member below has a person key of
// their own, and every assertion reads this fixture workspace's rows only.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];

test("site coordinators, workspace admin and SC clearance against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const rpc = async (client, fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      assert.equal(error, null, `${fn}: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };
    const clearance = (client) => rpc(client, "vitally_my_clearance");
    const grant = (userId) =>
      f.sql("select vitally_private.grant_site_coordinator($1,$2)", [f.workspaceId, userId]);
    const confirm = (personId, certificates) =>
      f.sql(
        `insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at)
          select $1::uuid,$2::uuid,$4::smallint,c,'confirmed',now() from unnest($3::text[]) c
          on conflict (workspace_id,person_id,season,certificate) do update set status='confirmed',confirmed_at=now()`,
        [f.workspaceId, personId, certificates, season],
      );
    const history = async (personId) =>
      (
        await f.sql(
          `select granted,changed_by_person_id from public.site_coordinator_changes
            where workspace_id=$1 and person_id=$2 order by changed_at,id`,
          [f.workspaceId, personId],
        )
      ).rows;
    const profilesSeen = async (client) => {
      const { data, error } = await client
        .from("volunteer_profiles")
        .select("person_id")
        .eq("workspace_id", f.workspaceId);
      assert.equal(error, null);
      return data.length;
    };
    const SC_MISSING = { kind: "siteCoordinator", certificates: ["SC"] };

    await t.test("a site coordinator with no roles is a workspace admin", async () => {
      const member = await f.staff({ key: "sasha_sc", name: "Sasha Moreau", capabilities: [], cleared: false });
      const before = await clearance(member.client);
      assert.equal(before.isAdmin, false);
      assert.equal(before.isSiteCoordinator, false);
      assert.equal(await profilesSeen(member.client), 0, "no admin, no profiles");
      await grant(member.userId);
      const after = await clearance(member.client);
      assert.equal(after.isAdmin, true);
      assert.equal(after.isSiteCoordinator, true);
      assert.equal(after.cleared, false);
      assert.deepEqual(after.capabilities, []);
      assert.ok((await profilesSeen(member.client)) > 0, "the admin policy lets them read profiles");
    });

    await t.test("the Admin role makes an admin", async () => {
      const member = await f.staff({
        key: "adele_admin",
        name: "Adele Fontaine",
        capabilities: ["admin", "assist", "followup", "receive_documents"],
      });
      // New, with no photo ID check: not cleared.
      await f.sql(
        "update public.roster_entries set is_new=true,photo_id_checked_at=null where workspace_id=$1 and person_id=$2 and season=$3",
        [f.workspaceId, member.personId, season],
      );
      const answer = await clearance(member.client);
      assert.equal(answer.cleared, false);
      assert.equal(answer.isAdmin, true);
      assert.equal(answer.isSiteCoordinator, false);
      assert.ok(!answer.missing.some((item) => item.kind === "siteCoordinator"));
    });

    await t.test("an invited volunteer given the Admin role has admin", async () => {
      const admin = f.siteCoordinator;
      const user = await f.provision();
      const volunteer = (roles, certificates) => ({
        name: "Iris Calloway", email: user.email.toLowerCase(), phone: null, works: "on_site",
        languages: ["english"], otherLanguage: null, roles, certificates, isNew: false, photoIdChecked: false,
      });
      const { personId } = await rpc(admin, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: volunteer([], []),
      });
      await rpc(admin, "vitally_record_account", {
        p_action_id: randomUUID(),
        p_op: "create",
        p_target: { volunteerId: personId },
        p_user_id: user.userId,
      });
      const checked = await rpc(user.client, "vitally_complete_site_check", {
        p_name: "Iris Calloway",
        p_sidn: TEST_SITE_NUMBER,
      });
      assert.equal(checked.status, "active");
      const { revision } = await one(
        f,
        "select revision::int as revision from public.volunteer_profiles where workspace_id=$1 and person_id=$2",
        [f.workspaceId, personId],
      );
      await rpc(admin, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: personId,
        p_expected_revision: revision,
        p_volunteer: volunteer(["admin"], ["vsc", "itqr"]),
      });
      const person = await one(f, "select capabilities from public.people where workspace_id=$1 and id=$2", [
        f.workspaceId,
        personId,
      ]);
      assert.deepEqual(person.capabilities, ["admin", "assist", "followup", "receive_documents"]);
      const answer = await clearance(user.client);
      assert.equal(answer.isAdmin, true);
      assert.equal(answer.isSiteCoordinator, false);
    });

    await t.test("a site coordinator without SC is not cleared", async () => {
      const member = await f.staff({
        key: "simone_sc",
        name: "Simone Achterberg",
        capabilities: ["admin", "assist", "followup", "receive_documents"],
      });
      assert.equal((await clearance(member.client)).cleared, true, "cleared before the grant");
      await grant(member.userId);
      const missing = await clearance(member.client);
      assert.equal(missing.cleared, false);
      assert.equal(missing.isAdmin, true);
      assert.equal(missing.isSiteCoordinator, true);
      assert.deepEqual(missing.missing, [SC_MISSING]);
      await confirm(member.personId, ["sc"]);
      const cleared = await clearance(member.client);
      assert.equal(cleared.cleared, true);
      assert.deepEqual(cleared.missing, []);
    });

    await t.test("grant_site_coordinator refuses an invited account", async () => {
      const admin = f.siteCoordinator;
      const user = await f.provision();
      const { personId } = await rpc(admin, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: {
          name: "Omar Vance", email: user.email.toLowerCase(), phone: null, works: "on_site",
          languages: ["english"], otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
        },
      });
      await rpc(admin, "vitally_record_account", {
        p_action_id: randomUUID(),
        p_op: "create",
        p_target: { volunteerId: personId },
        p_user_id: user.userId,
      });
      const noActiveAccount = (error) =>
        error.code === "VALIDATION" && error.cause?.detail === "NO_ACTIVE_ACCOUNT";
      await assert.rejects(() => grant(user.userId), noActiveAccount, "invited");
      await assert.rejects(() => grant(randomUUID()), noActiveAccount, "no account");
      const flag = await one(
        f,
        "select is_site_coordinator from public.accounts where workspace_id=$1 and person_id=$2",
        [f.workspaceId, personId],
      );
      assert.equal(flag.is_site_coordinator, false);
      assert.deepEqual(await history(personId), []);

      // One history row per real change: a second grant changes nothing.
      const member = await f.staff({ key: "gideon_grant", name: "Gideon Marsh", capabilities: [], cleared: false });
      const revisionOf = async () =>
        (
          await one(
            f,
            "select revision::int as revision,is_site_coordinator from public.accounts where workspace_id=$1 and user_id=$2",
            [f.workspaceId, member.userId],
          )
        );
      const start = await revisionOf();
      assert.equal(start.is_site_coordinator, false);
      await grant(member.userId);
      await grant(member.userId);
      const end = await revisionOf();
      assert.equal(end.is_site_coordinator, true);
      assert.equal(end.revision, start.revision + 1, "the revision moves once");
      assert.deepEqual(await history(member.personId), [{ granted: true, changed_by_person_id: null }]);
    });
  } finally {
    await f.close();
  }
});
