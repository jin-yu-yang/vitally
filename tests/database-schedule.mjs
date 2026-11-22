import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-volunteer-schedule (design D1, D3, D10), migration 056
// sections 1 to 4: the shifts and schedule_settings tables, the usual days on
// the volunteer profile, the site hours validator, who reads which rows
// directly (for realtime), and the publication, the site hours and targets save, and (section 5) saving and removing shifts. The other RPCs come in later tasks.
// One shared fixture; fictional people only.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];

test("Volunteer schedule against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const rejects = (text, values, label) =>
      assert.rejects(
        f.sql(text, values),
        (error) => {
          assert.ok(error.code, `${label}: ${error.message}`);
          return true;
        },
        label,
      );
    const insertShift = (personId, { start = 9, end = 12, role = "greeter", date = "2027-02-06" } = {}) =>
      one(
        f,
        `insert into public.shifts(workspace_id,season,person_id,shift_date,start_hour,end_hour,role)
          values($1,$2,$3,$4,$5,$6,$7) returning id`,
        [f.workspaceId, season, personId, date, start, end, role],
      );
    const rpc = async (client, fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      assert.equal(error, null, `${fn}: ${error?.code} ${error?.message}`);
      return data;
    };
    const ids = async (client) => {
      const { data, error } = await client.from("shifts").select("id");
      assert.equal(error, null, `shifts read: ${error?.message}`);
      return data.map((row) => row.id).sort();
    };
    const setUsualDays = (personId, days) =>
      f.sql("update public.volunteer_profiles set usual_days=$2::smallint[] where person_id=$1", [personId, days]);

    // A volunteer with no sign-in, as a site coordinator adds one.
    const added = await rpc(f.siteCoordinator, "vitally_save_volunteer", {
      p_action_id: randomUUID(),
      p_volunteer_id: null,
      p_expected_revision: null,
      p_volunteer: {
        name: "Casey Morrow",
        email: `v-${randomUUID()}@example.org`,
        phone: null,
        works: "on_site",
        languages: ["english"],
        otherLanguage: null,
        roles: ["greeter"],
        certificates: ["vsc"],
        isNew: false,
        photoIdChecked: false,
      },
    });
    const noSignInId = added.personId;
    const nora = await f.staff({ key: "nora_no_entry", name: "Nora Quill", capabilities: [], cleared: false });
    await f.sql("delete from public.roster_entries where person_id=$1", [nora.personId]);

    await t.test("storage checks", async () => {
      const shift = (start, end, role) =>
        rejects(
          `insert into public.shifts(workspace_id,season,person_id,shift_date,start_hour,end_hour,role)
            values($1,$2,$3,'2027-02-06',$4,$5,$6)`,
          [f.workspaceId, season, f.preparerId, start, end, role],
          `shift ${start}-${end} ${role}`,
        );
      await shift(5, 5, "greeter");
      await shift(20, 25, "greeter");
      await shift(9, 12, "host");
      for (const bad of ["{8}", "{6,6}", "{6,2}", "{0}"])
        await rejects(
          "update public.volunteer_profiles set usual_days=$2::smallint[] where person_id=$1",
          [noSignInId, bad],
          `usual_days ${bad}`,
        );
      await setUsualDays(noSignInId, "{2,6}");
      assert.deepEqual(
        (await one(f, "select usual_days from public.volunteer_profiles where person_id=$1", [noSignInId])).usual_days,
        [2, 6],
      );
      await setUsualDays(noSignInId, "{}");
    });

    await t.test("site hours validator", async () => {
      const valid = async (json) =>
        (await one(f, "select vitally_private.valid_site_hours($1::jsonb) as ok", [json])).ok;
      assert.equal(await valid('{"6":{"open":10,"close":16}}'), true);
      assert.equal(await valid("{}"), true);
      for (const bad of [
        '{"6":{"open":16,"close":10}}',
        '{"8":{"open":1,"close":2}}',
        '{"6":{"open":-1,"close":2}}',
        '{"6":{"open":10}}',
      ])
        assert.equal(await valid(bad), false, bad);
      await rejects(
        `insert into public.schedule_settings(workspace_id,site_hours) values($1,'{"6":{"open":16,"close":10}}')`,
        [f.workspaceId],
        "settings with bad hours",
      );
    });

    await t.test("schedule settings save", async () => {
      const sc = f.siteCoordinator;
      const settingsRow = () =>
        one(f, "select site_hours,revision::int as revision from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      const args = (revision, settings, actionId = randomUUID()) => ({
        p_action_id: actionId,
        p_expected_revision: revision,
        p_settings: settings,
      });
      const targets = { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 0 };
      const refused = async (client, input, code, detail, label) => {
        const { error } = await client.rpc("vitally_save_schedule_settings", input);
        assert.equal(error?.code, code, `${label}: ${error?.code} ${error?.message}`);
        if (detail !== undefined) assert.equal(error.details, detail, `${label} detail`);
        assert.equal(await f.receiptsFor(input.p_action_id), 0, `${label} receipt`);
      };
      const before = await rpc(sc, "vitally_season_settings");
      assert.equal(before.schedule.revision, 0);
      assert.equal(await settingsRow(), undefined);
      try {
        const ada = await f.staff({ key: "ada_admin", name: "Ada Fenwick", capabilities: ["admin"] });
        await refused(ada.client, args(0, { siteHours: {}, targets }), "VT001", undefined, "admin who is not a site coordinator");

        const settings = {
          siteHours: { 2: { open: 17, close: 20 }, 4: { open: 17, close: 20 }, 6: { open: 10, close: 16 } },
          targets,
        };
        const first = await rpc(sc, "vitally_save_schedule_settings", args(0, settings));
        assert.deepEqual(first, { ...settings, revision: 1 });
        assert.deepEqual((await rpc(sc, "vitally_season_settings")).schedule, first);
        assert.deepEqual((await rpc(ada.client, "vitally_season_settings")).schedule, first);

        await refused(sc, args(1, { siteHours: { 6: { open: 16, close: 10 } }, targets }), "VT007", "siteHours.6", "close before open");
        await refused(sc, args(1, { siteHours: { 6: { open: 99999999999, close: 1 } }, targets }), "VT007", "siteHours.6", "huge hour");
        await refused(sc, args(1, { siteHours: { 8: { open: 1, close: 2 } }, targets }), "VT007", "siteHours.8", "weekday 8");
        await refused(sc, args(1, { siteHours: {}, targets: { ...targets, onSiteNeeded: 10 } }), "VT007", "onSiteNeeded", "target 10");
        await refused(sc, args(1, { siteHours: {}, targets: { ...targets, preparersNeeded: 1.5 } }), "VT007", "preparersNeeded", "fraction");
        await refused(sc, args(1, { siteHours: {}, targets: { ...targets, reviewersNeeded: "2" } }), "VT007", "reviewersNeeded", "string target");
        await refused(sc, args(1, { targets }), "VT007", "siteHours", "no site hours");
        await refused(sc, args(1, []), "VT007", undefined, "settings not an object");
        await refused(sc, args(null, settings), "VT007", undefined, "no revision");
        await refused(sc, args(0, settings), "VT003", undefined, "stale revision");
        assert.equal((await settingsRow()).revision, 1, "refusals changed nothing");

        // A day is stored as open and close only.
        const padded = await rpc(
          sc,
          "vitally_save_schedule_settings",
          args(1, { siteHours: { 6: { open: 9, close: 12, x: 1 } }, targets: { preparersNeeded: 3, reviewersNeeded: 2, onSiteNeeded: 1 } }),
        );
        assert.deepEqual(padded, {
          siteHours: { 6: { open: 9, close: 12 } },
          targets: { preparersNeeded: 3, reviewersNeeded: 2, onSiteNeeded: 1 },
          revision: 2,
        });
        assert.deepEqual((await settingsRow()).site_hours, { 6: { open: 9, close: 12 } });

        // The same action id twice: the same answer, one revision.
        const again = args(2, settings);
        const one1 = await rpc(sc, "vitally_save_schedule_settings", again);
        const one2 = await rpc(sc, "vitally_save_schedule_settings", again);
        assert.deepEqual(one2, one1);
        assert.equal(one1.revision, 3);
        assert.equal((await settingsRow()).revision, 3);
      } finally {
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      }
    });

    await t.test("a huge hour is not valid, not an overflow", async () => {
      const { ok } = await one(f, "select vitally_private.valid_site_hours($1::jsonb) as ok", [
        '{"6":{"open":99999999999,"close":1}}',
      ]);
      assert.equal(ok, false);
    });

    await t.test("who reads shifts directly", async () => {
      const first = await insertShift(f.preparerId, { role: "preparer" });
      const second = await insertShift(noSignInId, { start: 13, end: 16 });
      try {
        assert.deepEqual(await ids(f.siteCoordinator), [first.id, second.id].sort(), "workspace admin sees both");
        assert.deepEqual(await ids(f.preparer), [first.id], "a non-admin sees only people with a sign-in");
        assert.deepEqual(await ids(nora.client), [], "no roster entry");
        assert.deepEqual(await ids(f.applicantA), [], "a client");
      } finally {
        await f.sql("delete from public.shifts where id in ($1,$2)", [first.id, second.id]);
      }
    });

    await t.test("schedule_settings reads", async () => {
      await f.sql(
        `insert into public.schedule_settings(workspace_id,site_hours) values($1,'{"6":{"open":10,"close":16}}')`,
        [f.workspaceId],
      );
      try {
        for (const client of [f.siteCoordinator, f.preparer]) {
          const { data, error } = await client.from("schedule_settings").select("workspace_id,site_hours");
          assert.equal(error, null);
          assert.equal(data.length, 1);
        }
        for (const client of [f.applicantA, nora.client]) {
          const { data, error } = await client.from("schedule_settings").select("workspace_id");
          assert.equal(error, null);
          assert.deepEqual(data, []);
        }
      } finally {
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      }
    });

    await t.test("no direct writes", async () => {
      const own = await insertShift(f.preparerId);
      try {
        const sc = f.siteCoordinator;
        const row = {
          workspace_id: f.workspaceId,
          season,
          person_id: f.preparerId,
          shift_date: "2027-02-07",
          start_hour: 9,
          end_hour: 10,
          role: "greeter",
        };
        const failures = [
          await sc.from("shifts").insert(row),
          await sc.from("shifts").update({ end_hour: 11 }).eq("id", own.id),
          await sc.from("shifts").delete().eq("id", own.id),
          await sc.from("schedule_settings").insert({ workspace_id: f.workspaceId }),
          await sc.from("schedule_settings").update({ preparers_needed: 3 }).eq("workspace_id", f.workspaceId),
          await sc.from("schedule_settings").delete().eq("workspace_id", f.workspaceId),
        ];
        failures.forEach((result, index) => assert.ok(result.error, `write ${index} must fail`));
        assert.equal((await one(f, "select count(*)::int n from public.shifts where id=$1", [own.id])).n, 1);
      } finally {
        await f.sql("delete from public.shifts where id=$1", [own.id]);
      }
    });

    await t.test("saving and removing shifts", async () => {
      const sc = f.siteCoordinator;
      const { saturday } = await one(
        f,
        `select to_char(d,'YYYY-MM-DD') as saturday from (
           select (now() at time zone 'America/New_York')::date + ((6 - extract(isodow from (now() at time zone 'America/New_York')::date)::int + 7) % 7 + 7) as d) x`,
      );
      const monday = (await one(f, "select to_char($1::date + 2,'YYYY-MM-DD') as d", [saturday])).d;
      assert.equal((await one(f, "select extract(isodow from $1::date)::int as n", [saturday])).n, 6);
      const body = (volunteerId, start, end, role, date = saturday) => ({
        volunteerId,
        date,
        startHour: start,
        endHour: end,
        role,
      });
      const save = (shiftId, revision, shift, actionId = randomUUID()) => ({
        p_action_id: actionId,
        p_shift_id: shiftId,
        p_expected_revision: revision,
        p_shift: shift,
      });
      const refused = async (client, fn, input, code, detail, label) => {
        const { error } = await client.rpc(fn, input);
        assert.equal(error?.code, code, `${label}: ${error?.code} ${error?.message}`);
        if (detail !== undefined) assert.equal(error.details, detail, `${label} detail`);
        assert.equal(await f.receiptsFor(input.p_action_id), 0, `${label} receipt`);
      };
      const refusedSave = (client, shift, code, detail, label, ids = [null, null]) =>
        refused(client, "vitally_save_shift", save(ids[0], ids[1], shift), code, detail, label);
      const removal = (shiftId, revision) => ({
        p_action_id: randomUUID(),
        p_shift_id: shiftId,
        p_expected_revision: revision,
      });
      const liveShifts = async () =>
        (await f.sql("select id from public.shifts where workspace_id=$1 and removed_at is null", [f.workspaceId])).rows.length;

      await rpc(sc, "vitally_save_schedule_settings", {
        p_action_id: randomUUID(),
        p_expected_revision: 0,
        p_settings: {
          siteHours: { 6: { open: 10, close: 16 } },
          targets: { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 },
        },
      });
      const ada = await f.staff({ key: "ada_shift_admin", name: "Ada Fenwick", capabilities: ["admin"] });
      const ben = await f.staff({ key: "ben_shift_admin", name: "Ben Hollis", capabilities: ["admin"] });
      const gone = await f.staff({ key: "gail_gone", name: "Gail Ormond", capabilities: ["prepare"] });
      try {
        // A valid add, for a volunteer with no sign-in.
        const casey = await rpc(sc, "vitally_save_shift", save(null, null, body(noSignInId, 10, 13, "greeter")));
        assert.equal(casey.revision, 1);
        const row = await one(f, "select * from public.shifts where id=$1", [casey.shiftId]);
        assert.equal(row.season, season);
        assert.equal(row.removed_at, null);

        // Domain refusals, each with its reason and no receipt.
        await refusedSave(sc, body(f.preparerId, 10, 13, "reviewer"), "VT007", "ROLE_NOT_HELD", "role not held");
        await refusedSave(sc, body(f.preparerId, 9, 12, "preparer"), "VT007", "OUTSIDE_SITE_HOURS", "starts before opening");
        await refusedSave(sc, body(f.preparerId, 14, 17, "preparer"), "VT007", "OUTSIDE_SITE_HOURS", "ends after closing");
        await refusedSave(sc, body(f.preparerId, 10, 13, "preparer", monday), "VT007", "SITE_CLOSED", "a Monday");
        await refusedSave(sc, body(nora.personId, 10, 13, "preparer"), "VT007", "NOT_ON_ROSTER", "not on the roster");
        await refusedSave(sc, body(randomUUID(), 10, 13, "preparer"), "VT007", "NOT_ON_ROSTER", "unknown person");
        await refusedSave(sc, body(noSignInId, 12, 15, "greeter"), "VT007", "OVERLAP", "overlaps 10-13");
        assert.equal(await liveShifts(), 1);
        const adjacent = await rpc(sc, "vitally_save_shift", save(null, null, body(noSignInId, 13, 15, "greeter")));
        assert.equal(adjacent.revision, 1);

        // Deactivated.
        const account = await one(f, "select revision from public.accounts where workspace_id=$1 and person_id=$2", [
          f.workspaceId,
          gone.personId,
        ]);
        await rpc(sc, "vitally_deactivate_account", {
          p_action_id: randomUUID(),
          p_volunteer_id: gone.personId,
          p_expected_revision: account.revision,
        });
        await refusedSave(sc, body(gone.personId, 10, 13, "preparer"), "VT007", "DEACTIVATED", "deactivated");

        // Shape validation.
        await refusedSave(sc, body(f.preparerId, 10, 13, "host"), "VT007", "role", "unknown role");
        await refusedSave(sc, body(f.preparerId, 13, 10, "preparer"), "VT007", "endHour", "end before start");
        await refusedSave(sc, body(f.preparerId, 10, 25, "preparer"), "VT007", "endHour", "end after 24");
        await refusedSave(sc, body(f.preparerId, 10.5, 13, "preparer"), "VT007", "startHour", "fractional hour");
        await refusedSave(sc, body(f.preparerId, "10", 13, "preparer"), "VT007", "startHour", "string hour");
        await refusedSave(sc, body(f.preparerId, 10, 13, "preparer", "2027-02-30"), "VT007", "date", "impossible date");
        await refusedSave(sc, body(f.preparerId, 10, 13, "preparer", "next saturday"), "VT007", "date", "malformed date");
        await refusedSave(sc, { ...body(f.preparerId, 10, 13, "preparer"), volunteerId: "x" }, "VT007", "volunteerId", "bad id");
        await refusedSave(sc, [], "VT007", undefined, "not an object");
        await refused(sc, "vitally_save_shift", save(casey.shiftId, null, body(noSignInId, 10, 13, "greeter")), "VT007", undefined, "edit without revision");
        await refused(sc, "vitally_save_shift", save(null, 1, body(noSignInId, 10, 13, "greeter")), "VT007", undefined, "add with revision");
        assert.equal(await liveShifts(), 2);

        // Only a workspace admin, cleared or not; a bad shape never reaches a non-admin's validation.
        await refusedSave(f.preparer, body(f.preparerId, 10, 13, "preparer"), "VT001", undefined, "a preparer");
        await refusedSave(f.preparer, body(f.preparerId, 10, 13, "host"), "VT001", undefined, "a preparer, bad shape");
        await refused(f.preparer, "vitally_remove_shift", removal(casey.shiftId, 1), "VT001", undefined, "a preparer removing");
        await refusedSave(f.applicantA, body(f.preparerId, 10, 13, "preparer"), "VT001", undefined, "a client");
        const uncleared = await f.staff({
          key: "uma_uncleared_sc",
          name: "Uma Finch",
          capabilities: ["admin"],
          cleared: false,
          siteCoordinator: true,
        });
        const byUncleared = await rpc(uncleared.client, "vitally_save_shift", save(null, null, body(f.preparerId, 10, 13, "preparer")));
        assert.equal(byUncleared.revision, 1);

        // Edit, and a second admin at the old revision is refused.
        const edited = await rpc(ada.client, "vitally_save_shift", save(byUncleared.shiftId, 1, body(f.preparerId, 11, 14, "preparer")));
        assert.equal(edited.revision, 2);
        assert.equal(edited.shiftId, byUncleared.shiftId);
        const editedRow = await one(f, "select start_hour,end_hour from public.shifts where id=$1", [edited.shiftId]);
        assert.deepEqual([editedRow.start_hour, editedRow.end_hour], [11, 14]);
        await refusedSave(ben.client, body(f.preparerId, 12, 15, "preparer"), "VT003", undefined, "stale revision", [byUncleared.shiftId, 1]);
        await refusedSave(ada.client, body(noSignInId, 11, 14, "greeter"), "VT007", "volunteerId", "edit names another person", [byUncleared.shiftId, 2]);
        // A shift does not overlap itself when edited.
        const same = await rpc(ada.client, "vitally_save_shift", save(byUncleared.shiftId, 2, body(f.preparerId, 12, 15, "preparer")));
        assert.equal(same.revision, 3);

        // A replay of the same action id leaves one row.
        const replay = save(null, null, body(f.preparerId, 15, 16, "preparer"));
        const r1 = await rpc(sc, "vitally_save_shift", replay);
        const r2 = await rpc(sc, "vitally_save_shift", replay);
        assert.deepEqual(r2, r1);
        assert.equal(
          (await one(f, "select count(*)::int n from public.shifts where person_id=$1 and start_hour=15", [f.preparerId])).n,
          1,
        );

        // Unknown shift.
        await refused(sc, "vitally_save_shift", save(randomUUID(), 1, body(noSignInId, 10, 13, "greeter")), "VT002", undefined, "unknown shift");
        await refused(sc, "vitally_remove_shift", removal(randomUUID(), 1), "VT002", undefined, "removing an unknown shift");
        await refused(sc, "vitally_remove_shift", removal(null, 1), "VT007", undefined, "remove without an id");

        // Remove: removed_at set, revision up.
        await refused(sc, "vitally_remove_shift", removal(r1.shiftId, 9), "VT003", undefined, "remove at a stale revision");
        const removeArgs = removal(r1.shiftId, 1);
        const removed = await rpc(sc, "vitally_remove_shift", removeArgs);
        assert.deepEqual(removed, { shiftId: r1.shiftId, revision: 2, removed: true });
        assert.deepEqual(await rpc(sc, "vitally_remove_shift", removeArgs), removed, "a replay answers the same");
        const removedRow = await one(f, "select removed_at,revision::int as revision from public.shifts where id=$1", [r1.shiftId]);
        assert.ok(removedRow.removed_at);
        assert.equal(removedRow.revision, 2);

        // M1.3: a removed row stays readable to a viewer who could read it before (design D2).
        const { data: viewed, error: viewError } = await f.preparer
          .from("shifts")
          .select("id,removed_at,revision")
          .eq("id", r1.shiftId);
        assert.equal(viewError, null);
        assert.equal(viewed.length, 1, "removed shift still read by a viewer");
        assert.ok(viewed[0].removed_at);
        assert.equal(viewed[0].revision, 2);

        // Remove, then edit or remove the removed shift: NOT_FOUND, even with the old revision.
        await refusedSave(sc, body(f.preparerId, 15, 16, "preparer"), "VT002", undefined, "edit a removed shift", [r1.shiftId, 1]);
        await refusedSave(sc, body(f.preparerId, 15, 16, "preparer"), "VT002", undefined, "edit a removed shift, fresh revision", [r1.shiftId, 2]);
        await refused(sc, "vitally_remove_shift", removal(r1.shiftId, 2), "VT002", undefined, "remove again");
        // Its hours are free again.
        const reuse = await rpc(sc, "vitally_save_shift", save(null, null, body(f.preparerId, 15, 16, "preparer")));
        assert.equal(reuse.revision, 1);
      } finally {
        await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      }
    });

    await t.test("published", async () => {
      const { rows } = await f.sql(
        "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'",
      );
      const names = rows.map((row) => row.tablename);
      assert.ok(names.includes("shifts"));
      assert.ok(names.includes("schedule_settings"));
    });
  } finally {
    await f.close();
  }
});
