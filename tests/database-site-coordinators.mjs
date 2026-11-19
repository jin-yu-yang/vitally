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

    // ---- Design D4: vitally_set_site_coordinator ---------------------------
    // Spec site-coordinators, "Only a site coordinator grants or removes site
    // coordinator" and "Every site coordinator change is recorded". The
    // fixture's site coordinator (Avery Lin) is the caller and the default
    // follow-up person; a test that changes Avery restores them, and every
    // extra site coordinator a test makes is removed again at its end.
    const FORBIDDEN = "VT001";
    const NOT_FOUND = "VT002";
    const CONFLICT = "VT003";
    const INVALID_TRANSITION = "VT004";
    const VALIDATION = "VT007";
    const sc = f.siteCoordinator;
    const accountOf = (personId, workspaceId = f.workspaceId) =>
      one(
        f,
        `select status,is_site_coordinator,revision::int as revision from public.accounts
          where workspace_id=$1 and person_id=$2`,
        [workspaceId, personId],
      );
    const setArgs = (volunteerId, revision, granted, actionId = randomUUID()) => ({
      p_action_id: actionId,
      p_volunteer_id: volunteerId,
      p_expected_revision: revision,
      p_granted: granted,
    });
    const setSC = async (client, personId, granted, workspaceId = f.workspaceId) =>
      rpc(
        client,
        "vitally_set_site_coordinator",
        setArgs(personId, (await accountOf(personId, workspaceId)).revision, granted),
      );
    // A refusal: the SQLSTATE, the message or detail, and no receipt stored.
    const refused = async (client, args, code, { message, detail } = {}, label = "refused") => {
      const { error } = await client.rpc("vitally_set_site_coordinator", args);
      assert.equal(error?.code, code, `${label}: ${error?.code} ${error?.message} ${error?.details}`);
      if (message !== undefined) assert.equal(error.message, message, `${label} message`);
      if (detail !== undefined) assert.equal(error.details, detail, `${label} detail`);
      assert.equal(await f.receiptsFor(args.p_action_id), 0, `${label} receipt`);
      return error;
    };
    const fullHistory = async (personId) =>
      (
        await f.sql(
          `select granted,changed_by_person_id,changed_at from public.site_coordinator_changes
            where workspace_id=$1 and person_id=$2 order by changed_at,id`,
          [f.workspaceId, personId],
        )
      ).rows;
    const volunteerArgs = (name, email) => ({
      p_action_id: randomUUID(),
      p_volunteer_id: null,
      p_expected_revision: null,
      p_volunteer: {
        name, email, phone: null, works: "on_site", languages: ["english"],
        otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
      },
    });

    await t.test("granting and removing are recorded", async () => {
      const dana = await f.staff({ key: "dana_wu", name: "Dana Wu", capabilities: ["prepare"] });
      const start = await accountOf(dana.personId);
      assert.equal(start.is_site_coordinator, false);
      const actionId = randomUUID();
      const granted = await rpc(
        sc,
        "vitally_set_site_coordinator",
        setArgs(dana.personId, start.revision, true, actionId),
      );
      assert.deepEqual(granted, {
        actionId,
        volunteerId: dana.personId,
        isSiteCoordinator: true,
        accountRevision: start.revision + 1,
      });
      assert.deepEqual(await accountOf(dana.personId), {
        ...start,
        is_site_coordinator: true,
        revision: start.revision + 1,
      });
      assert.equal((await clearance(dana.client)).isSiteCoordinator, true);
      // A replay returns the stored result and records nothing more.
      assert.deepEqual(
        await rpc(sc, "vitally_set_site_coordinator", setArgs(dana.personId, start.revision, true, actionId)),
        granted,
      );
      assert.equal(await f.receiptsFor(actionId), 1);
      assert.equal((await fullHistory(dana.personId)).length, 1);
      const removed = await setSC(sc, dana.personId, false);
      assert.equal(removed.isSiteCoordinator, false);
      assert.equal(removed.accountRevision, start.revision + 2);
      assert.equal((await accountOf(dana.personId)).is_site_coordinator, false);
      const rows = await fullHistory(dana.personId);
      assert.deepEqual(
        rows.map((row) => ({ granted: row.granted, by: row.changed_by_person_id })),
        [
          { granted: true, by: f.siteCoordinatorId },
          { granted: false, by: f.siteCoordinatorId },
        ],
      );
      for (const row of rows) assert.ok(row.changed_at instanceof Date, "the time");
    });

    await t.test("signed-in users have no grant on the history", async () => {
      const { rows } = await f.sql(
        `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
          where has_table_privilege('authenticated','public.site_coordinator_changes',p)`,
      );
      assert.deepEqual(rows, []);
      const before = await fullHistory(f.siteCoordinatorId);
      const deleted = await sc.from("site_coordinator_changes").delete().eq("workspace_id", f.workspaceId);
      assert.ok(deleted.error, "delete");
      const updated = await sc
        .from("site_coordinator_changes")
        .update({ granted: false })
        .eq("workspace_id", f.workspaceId);
      assert.ok(updated.error, "update");
      assert.deepEqual(await fullHistory(f.siteCoordinatorId), before);
    });

    await t.test("refusal: FORBIDDEN for anyone but a site coordinator", async () => {
      const nadia = await f.staff({
        key: "nadia_admin",
        name: "Nadia Brennan",
        capabilities: ["admin", "assist", "followup", "receive_documents"],
      });
      assert.equal((await clearance(nadia.client)).isAdmin, true, "an admin by role");
      const target = await f.staff({ key: "theo_target", name: "Theo Lindqvist", capabilities: ["prepare"] });
      const targetBefore = await accountOf(target.personId);
      const averyBefore = await accountOf(f.siteCoordinatorId);
      await refused(nadia.client, setArgs(target.personId, targetBefore.revision, true), FORBIDDEN, {}, "grant");
      await refused(nadia.client, setArgs(f.siteCoordinatorId, averyBefore.revision, false), FORBIDDEN, {}, "remove");
      await refused(f.preparer, setArgs(target.personId, targetBefore.revision, true), FORBIDDEN, {}, "preparer");
      // FORBIDDEN comes before every other check.
      await refused(nadia.client, setArgs(randomUUID(), 1, true), FORBIDDEN, {}, "before NOT_FOUND");
      assert.deepEqual(await accountOf(target.personId), targetBefore);
      assert.deepEqual(await accountOf(f.siteCoordinatorId), averyBefore);
      assert.deepEqual(await fullHistory(target.personId), []);
    });

    await t.test("refusal: NOT_FOUND outside the workspace", async () => {
      await refused(sc, setArgs(f.foreignStaffId, 1, true), NOT_FOUND, {}, "foreign");
      await refused(sc, setArgs(randomUUID(), 1, true), NOT_FOUND, {}, "unknown");
    });

    await t.test("refusal: NO_ACTIVE_ACCOUNT", async () => {
      // Not created: a Roster volunteer with no account.
      const plain = await f.provision();
      const { personId: none } = await rpc(
        sc,
        "vitally_save_volunteer",
        volunteerArgs("Lena Fairweather", plain.email.toLowerCase()),
      );
      // Invited: Create account, and no site check yet.
      const user = await f.provision();
      const { personId: invited } = await rpc(
        sc,
        "vitally_save_volunteer",
        volunteerArgs("Mika Sorensen", user.email.toLowerCase()),
      );
      await rpc(sc, "vitally_record_account", {
        p_action_id: randomUUID(),
        p_op: "create",
        p_target: { volunteerId: invited },
        p_user_id: user.userId,
      });
      // Deactivated.
      const gone = await f.staff({ key: "gus_gone", name: "Gus Halvorsen", capabilities: ["prepare"], cleared: false });
      await rpc(sc, "vitally_deactivate_account", {
        p_action_id: randomUUID(),
        p_volunteer_id: gone.personId,
        p_expected_revision: (await accountOf(gone.personId)).revision,
      });
      for (const [label, personId] of [
        ["not created", none],
        ["invited", invited],
        ["deactivated", gone.personId],
      ]) {
        const revision = (await accountOf(personId))?.revision ?? 1;
        await refused(
          sc,
          setArgs(personId, revision, true),
          VALIDATION,
          { message: "VALIDATION", detail: "NO_ACTIVE_ACCOUNT" },
          label,
        );
        assert.deepEqual(await fullHistory(personId), [], `${label} history`);
      }
    });

    await t.test("refusal: CONFLICT on a stale revision", async () => {
      const member = await f.staff({ key: "cass_stale", name: "Cass Holloway", capabilities: ["prepare"] });
      const read = (await accountOf(member.personId)).revision;
      await refused(sc, setArgs(member.personId, read - 1, true), CONFLICT, {}, "stale");
      await rpc(sc, "vitally_set_site_coordinator", setArgs(member.personId, read, true));
      await refused(sc, setArgs(member.personId, read, false), CONFLICT, {}, "read before the grant");
      await setSC(sc, member.personId, false);
    });

    await t.test("refusal: INVALID_TRANSITION for no change", async () => {
      const member = await f.staff({ key: "nico_nochange", name: "Nico Albrecht", capabilities: ["prepare"] });
      await refused(
        sc,
        setArgs(member.personId, (await accountOf(member.personId)).revision, false),
        INVALID_TRANSITION,
        { message: "INVALID_TRANSITION" },
        "remove from someone who isn't one",
      );
      await refused(
        sc,
        setArgs(f.siteCoordinatorId, (await accountOf(f.siteCoordinatorId)).revision, true),
        INVALID_TRANSITION,
        { message: "INVALID_TRANSITION" },
        "grant to a site coordinator",
      );
    });

    await t.test("refusal: DEFAULT_FOLLOWUP while another site coordinator remains", async () => {
      const bram = await f.staff({
        key: "bram_sc",
        name: "Bram Okonkwo",
        capabilities: ["prepare"],
        siteCoordinator: true,
      });
      const before = await accountOf(f.siteCoordinatorId);
      await refused(
        bram.client,
        setArgs(f.siteCoordinatorId, before.revision, false),
        INVALID_TRANSITION,
        { message: "DEFAULT_FOLLOWUP" },
        "default",
      );
      assert.deepEqual(await accountOf(f.siteCoordinatorId), before);
      await setSC(sc, bram.personId, false);
    });

    // Review Focus 1.
    await t.test("default moved: removing the old default then succeeds", async () => {
      // The Admin role gives followup, which set_default_followup still asks for.
      const remy = await f.staff({
        key: "remy_default",
        name: "Remy Castellanos",
        capabilities: ["admin", "followup"],
        siteCoordinator: true,
      });
      try {
        await f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, "remy_default"]);
        const removed = await setSC(remy.client, f.siteCoordinatorId, false);
        assert.equal(removed.isSiteCoordinator, false);
        assert.equal((await clearance(sc)).isSiteCoordinator, false);
        const last = (await fullHistory(f.siteCoordinatorId)).at(-1);
        assert.equal(last.granted, false);
        assert.equal(last.changed_by_person_id, remy.personId);
      } finally {
        if (!(await accountOf(f.siteCoordinatorId)).is_site_coordinator)
          await setSC(remy.client, f.siteCoordinatorId, true);
        await f.sql("select vitally_private.set_default_followup($1,$2)", [f.workspaceId, "site_coordinator"]);
      }
      assert.equal((await accountOf(f.siteCoordinatorId)).is_site_coordinator, true);
      await setSC(sc, remy.personId, false);
    });

    // Review Focus 3.
    await t.test("removing yourself while another remains", async () => {
      const cleo = await f.staff({
        key: "cleo_self",
        name: "Cleo Vantongeren",
        capabilities: ["prepare"],
        siteCoordinator: true,
      });
      const removed = await setSC(cleo.client, cleo.personId, false);
      assert.equal(removed.isSiteCoordinator, false);
      assert.equal((await clearance(cleo.client)).isSiteCoordinator, false);
      assert.equal((await fullHistory(cleo.personId)).at(-1).changed_by_person_id, cleo.personId);
      // No longer a site coordinator: the next call is refused first.
      await refused(cleo.client, setArgs(cleo.personId, removed.accountRevision, true), FORBIDDEN, {}, "after");
    });

    await t.test("refusal: LAST_SITE_COORDINATOR", async () => {
      // A workspace of this test's own: one site coordinator (Lou), who is not
      // the default follow-up person (Mae, an admin by role).
      const lou = await f.provision();
      const mae = await f.provision();
      const workspaceId = randomUUID();
      await f.initializeOwned({
        workspaceId,
        staff: [
          { userId: lou.userId, personKey: "lou_last", name: "Lou Ferreira", capabilities: ["prepare"], siteCoordinator: true },
          { userId: mae.userId, personKey: "mae_default", name: "Mae Turnbull", capabilities: ["admin", "followup"] },
        ],
        defaultFollowup: "mae_default",
      });
      const { id: louId } = await one(
        f,
        "select id from public.people where workspace_id=$1 and person_key='lou_last'",
        [workspaceId],
      );
      const before = await accountOf(louId, workspaceId);
      assert.equal(before.is_site_coordinator, true);
      await refused(
        lou.client,
        setArgs(louId, before.revision, false),
        INVALID_TRANSITION,
        { message: "LAST_SITE_COORDINATOR" },
        "the only one",
      );
      assert.deepEqual(await accountOf(louId, workspaceId), before);
    });

    // Spec site-coordinators, "Not on this season's roster".
    await t.test("a site coordinator with no current-season entry", async () => {
      const ines = await f.staff({
        key: "ines_offroster",
        name: "Ines Larkspur",
        capabilities: [],
        cleared: false,
        siteCoordinator: true,
      });
      await f.sql("delete from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
        f.workspaceId,
        ines.personId,
        season,
      ]);
      const { n } = await one(
        f,
        "select count(*)::int as n from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3",
        [f.workspaceId, ines.personId, season],
      );
      assert.equal(n, 0, "no current-season entry");
      const answer = await clearance(ines.client);
      assert.equal(answer.isSiteCoordinator, true);
      assert.equal(answer.isAdmin, true);
      assert.equal(answer.cleared, false);
      assert.ok((await profilesSeen(ines.client)) > 0, "the admin policy lets them read profiles");
      await setSC(sc, ines.personId, false);
    });
  } finally {
    await f.close();
  }
});
