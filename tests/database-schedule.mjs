import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-volunteer-schedule (design D1, D3, D5, D10), migration 058:
// the shifts and schedule_settings tables, the site hours validator, who reads
// which rows directly (for realtime), the publication, the site hours and
// targets save, saving and removing shifts, the schedule day read and the
// caller's own week (vitally_my_shifts). Usual days are main's (057_my_profile,
// text[] mon..sun), set here through main's vitally_save_volunteer.
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
    const clearUsualDays = (personId) =>
      f.sql("update public.volunteer_profiles set usual_days='{}' where person_id=$1", [personId]);
    // The Roster payload for a person as stored, so an admin save changes nothing else.
    const payloadOf = async (personId, extra = {}) => {
      const row = await one(
        f,
        `select p.name,v.email,v.phone,v.works,v.languages,v.other_language,v.revision::int as revision,r.roles,r.is_new,
           r.photo_id_checked_at is not null as photo,
           array(select c.certificate from public.certificates c where c.workspace_id=p.workspace_id
             and c.person_id=p.id and c.season=r.season and c.status='confirmed' order by 1) as certificates
          from public.people p
          join public.volunteer_profiles v on v.workspace_id=p.workspace_id and v.person_id=p.id
          join public.workspaces w on w.id=p.workspace_id
          join public.roster_entries r on r.workspace_id=p.workspace_id and r.person_id=p.id and r.season=w.current_season
          where p.id=$1`,
        [personId],
      );
      return {
        revision: row.revision,
        volunteer: {
          name: row.name,
          email: row.email,
          phone: row.phone,
          works: row.works,
          languages: row.languages,
          otherLanguage: row.other_language,
          roles: row.roles,
          certificates: row.certificates,
          isNew: row.is_new,
          photoIdChecked: row.photo,
          ...extra,
        },
      };
    };
    // Usual days as an admin sets them on the Roster: main's vitally_save_volunteer.
    const saveUsualDays = async (personId, usualDays) => {
      const { revision, volunteer } = await payloadOf(personId, { usualDays });
      return rpc(f.siteCoordinator, "vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: personId,
        p_expected_revision: revision,
        p_volunteer: volunteer,
      });
    };

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

    await t.test("the schedule day read, flags and counts", async () => {
      const sc = f.siteCoordinator;
      const { saturday } = await one(
        f,
        `select to_char(d,'YYYY-MM-DD') as saturday from (
           select (now() at time zone 'America/New_York')::date + ((6 - extract(isodow from (now() at time zone 'America/New_York')::date)::int + 7) % 7 + 7) as d) x`,
      );
      const monday = (await one(f, "select to_char($1::date + 2,'YYYY-MM-DD') as d", [saturday])).d;
      const personKey = async (key) =>
        (await one(f, "select id from public.people where workspace_id=$1 and person_key=$2", [f.workspaceId, key])).id;
      const day = (client, date = saturday) => rpc(client, "vitally_schedule_day", { p_date: date });
      const refusedDay = async (client, label) => {
        const { error } = await client.rpc("vitally_schedule_day", { p_date: saturday });
        assert.equal(error?.code, "VT001", `${label}: ${error?.code} ${error?.message}`);
      };
      const settingsAt = async (siteHours) => {
        const { revision } = await one(
          f,
          "select coalesce(max(revision),0)::int as revision from public.schedule_settings where workspace_id=$1",
          [f.workspaceId],
        );
        return rpc(sc, "vitally_save_schedule_settings", {
          p_action_id: randomUUID(),
          p_expected_revision: revision,
          p_settings: { siteHours, targets: { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 } },
        });
      };
      const addShift = (volunteerId, startHour, endHour, role) =>
        rpc(sc, "vitally_save_shift", {
          p_action_id: randomUUID(),
          p_shift_id: null,
          p_expected_revision: null,
          p_shift: { volunteerId, date: saturday, startHour, endHour, role },
        });
      const byName = (answer, name) => answer.shifts.find((shift) => shift.name === name);
      const setWorks = (personId, works) =>
        f.sql(
          `insert into public.volunteer_profiles(workspace_id,person_id,email,works)
            values($1,$2,$3,$4)
            on conflict (workspace_id,person_id) do update set works=excluded.works`,
          [f.workspaceId, personId, `v-${randomUUID()}@example.org`, works],
        );

      const ada = await f.staff({ key: "ada_day_admin", name: "Ada Hartley", capabilities: ["admin"] });
      const iris = await f.staff({ key: "iris_intaker", name: "Iris Calloway", capabilities: ["assist"] });
      const ulla = await f.staff({ key: "ulla_uncleared", name: "Ulla Prewitt", capabilities: ["prepare"] });
      const dana = await f.staff({ key: "dana_deactivated", name: "Dana Whitlock", capabilities: ["prepare"] });
      const ned = await f.staff({ key: "ned_no_roles", name: "Ned Larkin", capabilities: ["prepare"] });
      await f.sql("update public.roster_entries set roles='{}' where person_id=$1", [ned.personId]);
      // Ulla is on the roster with an active account and a preparer's certificates, but is a new
      // volunteer whose photo ID is unchecked, so she is not cleared.
      await f.sql("update public.roster_entries set is_new=true,photo_id_checked_at=null where person_id=$1", [ulla.personId]);
      await setWorks(iris.personId, "remote");
      await saveUsualDays(noSignInId, ["sat"]);
      const averyId = await personKey("site_coordinator");
      const shifts = {};
      try {
        await settingsAt({ 6: { open: 10, close: 17 } });
        shifts.casey = await addShift(noSignInId, 10, 13, "greeter");
        shifts.taylor = await addShift(f.preparerId, 10, 13, "preparer");
        shifts.ulla = await addShift(ulla.personId, 11, 14, "preparer");
        shifts.iris = await addShift(iris.personId, 10, 12, "intaker");
        shifts.avery = await addShift(averyId, 12, 15, "admin");
        shifts.late = await addShift(f.preparerId, 14, 17, "preparer");
        await rpc(sc, "vitally_deactivate_account", {
          p_action_id: randomUUID(),
          p_volunteer_id: dana.personId,
          p_expected_revision: (
            await one(f, "select revision from public.accounts where workspace_id=$1 and person_id=$2", [
              f.workspaceId,
              dana.personId,
            ])
          ).revision,
        });

        // The admin answer.
        const admin = await day(sc);
        assert.equal(admin.date, saturday);
        assert.equal(admin.weekday, 6);
        assert.deepEqual(admin.hours, { open: 10, close: 17 });
        assert.equal(admin.anyOpen, true);
        assert.deepEqual(admin.targets, { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 });
        assert.equal(typeof admin.settingsRevision, "number");
        assert.equal(admin.canEdit, true);
        assert.equal(admin.canEditSettings, true);
        assert.deepEqual(Object.keys(byName(admin, "Casey Morrow")).sort(), [
          "counts", "endHour", "flags", "name", "revision", "role", "shiftId", "startHour", "volunteerId",
        ]);
        const names = admin.shifts.map((shift) => [shift.name, shift.startHour]);
        assert.deepEqual(
          names,
          [...names].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
          "ordered by name, then start",
        );
        assert.equal(admin.shifts.length, 6);
        assert.deepEqual(byName(admin, "Casey Morrow").flags, ["notCleared", "noSignIn"]);
        assert.equal(byName(admin, "Casey Morrow").counts, null);
        assert.deepEqual(byName(admin, "Taylor Brooks").flags, []);
        assert.equal(byName(admin, "Taylor Brooks").counts, "preparer");
        assert.deepEqual(byName(admin, "Ulla Prewitt").flags, ["notCleared"]);
        assert.equal(byName(admin, "Ulla Prewitt").counts, null, "an uncleared preparer counts nowhere");
        assert.equal(byName(admin, "Avery Lin").counts, null, "an Admin shift counts nowhere");
        assert.deepEqual(byName(admin, "Avery Lin").flags, []);
        assert.equal(byName(admin, "Iris Calloway").counts, null, "a remote Intaker counts nowhere");
        await setWorks(iris.personId, "on_site_and_remote");
        assert.equal(byName(await day(sc), "Iris Calloway").counts, "onSite");
        await setWorks(iris.personId, "on_site");
        assert.equal(byName(await day(sc), "Iris Calloway").counts, "onSite");

        // A reviewer counts as reviewer.
        const reviewerShift = await addShift(await personKey("reviewer"), 15, 16, "reviewer");
        assert.equal(byName(await day(sc), "Jamie Ellis").counts, "reviewer");
        await rpc(sc, "vitally_remove_shift", {
          p_action_id: randomUUID(),
          p_shift_id: reviewerShift.shiftId,
          p_expected_revision: reviewerShift.revision,
        });
        assert.equal(byName(await day(sc), "Jamie Ellis"), undefined, "a removed shift is not listed");

        // Candidates.
        const candidateNames = admin.candidates.map((candidate) => candidate.name);
        assert.ok(candidateNames.includes("Casey Morrow"), "a no-sign-in volunteer is a candidate");
        assert.ok(!candidateNames.includes("Ned Larkin"), "no roles");
        assert.ok(!candidateNames.includes("Dana Whitlock"), "deactivated");
        assert.ok(!candidateNames.includes("Nora Quill"), "not on the roster");
        assert.deepEqual(admin.candidates.find((candidate) => candidate.name === "Casey Morrow"), {
          volunteerId: noSignInId,
          name: "Casey Morrow",
          roles: ["greeter"],
          usualDays: ["sat"],
          cleared: false,
          works: "on_site",
          signedIn: false,
        });
        const taylor = admin.candidates.find((candidate) => candidate.name === "Taylor Brooks");
        assert.deepEqual([taylor.roles, taylor.usualDays, taylor.cleared, taylor.signedIn], [["preparer"], [], true, true]);
        assert.equal(admin.candidates.find((candidate) => candidate.name === "Ulla Prewitt").cleared, false);

        // Non-admins: names, roles and hours only, and no no-sign-in shifts.
        const plain = await day(f.preparer);
        assert.equal(plain.canEdit, false);
        assert.equal(plain.canEditSettings, false);
        assert.equal("candidates" in plain, false);
        assert.equal(byName(plain, "Casey Morrow"), undefined, "no-sign-in shift hidden");
        assert.equal(plain.shifts.length, 5);
        for (const shift of plain.shifts)
          assert.deepEqual(Object.keys(shift).sort(), ["endHour", "name", "revision", "role", "shiftId", "startHour", "volunteerId"]);
        assert.deepEqual(plain.hours, admin.hours);

        // M1.5: an uncleared rostered volunteer with an active account is a viewer.
        const fromUlla = await day(ulla.client);
        assert.equal(fromUlla.shifts.length, 5);
        const own = byName(fromUlla, "Ulla Prewitt");
        assert.deepEqual([own.role, own.startHour, own.endHour], ["preparer", 11, 14]);

        // M1.4: an Admin who is not a site coordinator reads the no-sign-in shift, by RPC and directly.
        const fromAda = await day(ada.client);
        assert.equal(fromAda.canEdit, true);
        assert.equal(fromAda.canEditSettings, false);
        assert.deepEqual(byName(fromAda, "Casey Morrow").flags, ["notCleared", "noSignIn"]);
        const { data: direct, error: directError } = await ada.client
          .from("shifts")
          .select("id")
          .eq("id", shifts.casey.shiftId);
        assert.equal(directError, null);
        assert.equal(direct.length, 1);

        // Refusals.
        await refusedDay(f.applicantA, "a client");
        await refusedDay(nora.client, "no roster entry");
        await refusedDay(dana.client, "a deactivated account");

        // Hours shrink: 14-17 falls outside 10-15, and so no longer counts.
        await settingsAt({ 6: { open: 10, close: 15 } });
        const shrunk = await day(sc);
        const taylorShifts = shrunk.shifts.filter((shift) => shift.name === "Taylor Brooks");
        assert.deepEqual(
          taylorShifts.map((shift) => [shift.startHour, shift.flags, shift.counts]),
          [
            [10, [], "preparer"],
            [14, ["outsideSiteHours"], null],
          ],
        );
        // A closed weekday: the shift stays, flagged.
        await settingsAt({ 2: { open: 10, close: 15 } });
        const closed = await day(sc);
        assert.equal(closed.hours, null);
        assert.equal(closed.anyOpen, true);
        assert.deepEqual(byName(closed, "Avery Lin").flags, ["outsideSiteHours"]);
        assert.equal(byName(closed, "Avery Lin").counts, null);

        // Role removed: through the Roster save, the shift is flagged and counts nowhere.
        await settingsAt({ 6: { open: 10, close: 17 } });
        const profile = await one(
          f,
          "select email,revision::int as revision from public.volunteer_profiles where person_id=$1",
          [iris.personId],
        );
        await rpc(sc, "vitally_save_volunteer", {
          p_action_id: randomUUID(),
          p_volunteer_id: iris.personId,
          p_expected_revision: profile.revision,
          p_volunteer: {
            name: "Iris Calloway",
            email: profile.email,
            phone: null,
            works: "on_site",
            languages: ["english"],
            otherLanguage: null,
            roles: ["greeter"],
            certificates: ["vsc", "itqr"],
            isNew: false,
            photoIdChecked: false,
          },
        });
        const removedRole = byName(await day(sc), "Iris Calloway");
        assert.deepEqual(removedRole.flags, ["roleRemoved"]);
        assert.equal(removedRole.counts, null);

        // No site hours saved: hours null, anyOpen false.
        await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
        const empty = await day(sc, monday);
        assert.equal(empty.hours, null);
        assert.equal(empty.anyOpen, false);
        assert.deepEqual(empty.shifts, []);
        assert.equal(empty.settingsRevision, 0);
      } finally {
        await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
        await clearUsualDays(noSignInId);
      }
    });

    await t.test("ny_week", async () => {
      // Week bounds: still Sunday in New York, and the spring-forward Sunday.
      const week = async (at) => {
        const row = await one(
          f,
          "select to_char(monday,'YYYY-MM-DD') as monday,to_char(sunday,'YYYY-MM-DD') as sunday from vitally_private.ny_week($1::timestamptz)",
          [at],
        );
        return [row.monday, row.sunday];
      };
      assert.deepEqual(await week("2026-11-02 03:30+00"), ["2026-10-26", "2026-11-01"]);
      assert.deepEqual(await week("2027-03-14 12:00-04"), ["2027-03-08", "2027-03-14"]);
      assert.deepEqual(await week("2026-11-02 05:30+00"), ["2026-11-02", "2026-11-08"]);
    });

    await t.test("vitally_my_shifts: the caller's own week", async () => {
      const sc = f.siteCoordinator;
      const preparer = f.preparer;
      const refused = async (client, label) => {
        const { data, error } = await client.rpc("vitally_my_shifts");
        assert.equal(error?.code, "VT001", `${label}: ${error?.code} ${error?.message}`);
        assert.equal(error?.message, "FORBIDDEN", label);
        assert.equal(data, null, label);
      };
      const { monday } = await one(
        f,
        "select to_char(monday,'YYYY-MM-DD') as monday from vitally_private.ny_week(now())",
      );
      const plus = async (days) => (await one(f, "select to_char($1::date+$2::int,'YYYY-MM-DD') as d", [monday, days])).d;
      const [tuesday, saturday, nextMonday, lastSunday] = [await plus(1), await plus(5), await plus(7), await plus(-1)];
      const { revision: settingsRevision } = await one(
        f,
        "select coalesce(max(revision),0)::int as revision from public.schedule_settings where workspace_id=$1",
        [f.workspaceId],
      );
      const addShift = (volunteerId, date, startHour, endHour, role = "preparer") =>
        rpc(sc, "vitally_save_shift", {
          p_action_id: randomUUID(),
          p_shift_id: null,
          p_expected_revision: null,
          p_shift: { volunteerId, date, startHour, endHour, role },
        });
      // Ula is a preparer whose photo ID is unchecked as a new volunteer, so she is not cleared.
      const ula = await f.staff({ key: "ula_my_shifts", name: "Ula Brandt", capabilities: ["prepare"] });
      await f.sql("update public.roster_entries set is_new=true,photo_id_checked_at=null where person_id=$1", [ula.personId]);
      assert.equal((await one(f, "select vitally_private.cleared($1,$2) as c", [f.workspaceId, ula.personId])).c, false);
      try {
        const everyDay = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { open: 8, close: 20 }]));
        await rpc(sc, "vitally_save_schedule_settings", {
          p_action_id: randomUUID(),
          p_expected_revision: settingsRevision,
          p_settings: { siteHours: everyDay, targets: { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 } },
        });
        const empty = await rpc(preparer, "vitally_my_shifts");
        assert.deepEqual(empty, { weekStart: monday, weekEnd: await plus(6), shifts: [] });

        const sat = await addShift(f.preparerId, saturday, 10, 14);
        const pastSeason = await addShift(f.preparerId, tuesday, 17, 20);
        await addShift(f.preparerId, nextMonday, 9, 12);
        await addShift(f.preparerId, lastSunday, 9, 12);
        const gone = await addShift(f.preparerId, tuesday, 9, 11);
        // Another volunteer's shift the same week.
        const other = await addShift(f.reviewerId, tuesday, 9, 12, "reviewer");
        // A shift of another season is left out.
        await f.sql("update public.shifts set season=season-1 where id=$1", [pastSeason.shiftId]);
        const answer = await rpc(preparer, "vitally_my_shifts");
        assert.deepEqual(Object.keys(answer).sort(), ["shifts", "weekEnd", "weekStart"]);
        assert.deepEqual(
          answer.shifts.map((s) => [s.date, s.startHour, s.endHour, s.role]),
          [
            [tuesday, 9, 11, "preparer"],
            [saturday, 10, 14, "preparer"],
          ],
          "this week only, current season, by date then start",
        );
        assert.deepEqual(Object.keys(answer.shifts[0]).sort(), ["date", "endHour", "role", "shiftId", "startHour"]);
        assert.equal(answer.shifts[1].shiftId, sat.shiftId);
        assert.ok(!JSON.stringify(answer).includes(other.shiftId), "no other volunteer's shift");
        assert.ok(!JSON.stringify(answer).includes(f.reviewerId), "no other volunteer's id");
        await rpc(sc, "vitally_remove_shift", {
          p_action_id: randomUUID(),
          p_shift_id: gone.shiftId,
          p_expected_revision: gone.revision,
        });
        assert.deepEqual(
          (await rpc(preparer, "vitally_my_shifts")).shifts.map((s) => s.startHour),
          [10],
          "a removed shift is left out",
        );
        // The reviewer sees only theirs.
        assert.deepEqual(
          (await rpc(f.reviewer, "vitally_my_shifts")).shifts.map((s) => s.shiftId),
          [other.shiftId],
        );

        // Not gated by clearance, nor by the roster: an uncleared volunteer and a staff member
        // with no roster entry are answered.
        await addShift(ula.personId, saturday, 9, 10);
        assert.deepEqual((await rpc(ula.client, "vitally_my_shifts")).shifts.map((s) => s.startHour), [9]);
        assert.deepEqual((await rpc(nora.client, "vitally_my_shifts")).shifts, []);

        // Refusals: a client, and an invited account.
        await refused(f.applicantA, "a client");
        const setStatus = (status) =>
          f.sql("update public.accounts set status=$3 where workspace_id=$1 and user_id=$2", [
            f.workspaceId,
            ula.userId,
            status,
          ]);
        await setStatus("invited");
        try {
          await refused(ula.client, "an invited account");
        } finally {
          await setStatus("active");
        }
      } finally {
        await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      }
    });

    await t.test("usual days stay with admins", async () => {
      // Privacy: no non-admin answer carries another volunteer's usual days.
      await saveUsualDays(f.preparerId, ["tue", "sat"]);
      try {
        const reviewerDay = await rpc(f.reviewer, "vitally_schedule_day", { p_date: "2027-02-06" });
        assert.ok(!JSON.stringify(reviewerDay).includes("usualDays"), "schedule day");
        const reviewerShifts = await rpc(f.reviewer, "vitally_my_shifts");
        assert.ok(!JSON.stringify(reviewerShifts).includes("usualDays"), "my shifts");
        assert.ok(!JSON.stringify(reviewerShifts).includes(f.preparerId), "my shifts");
        // An admin's candidates carry them, as main's strings.
        const adminDay = await rpc(f.siteCoordinator, "vitally_schedule_day", { p_date: "2027-02-06" });
        assert.deepEqual(
          adminDay.candidates.find((candidate) => candidate.volunteerId === f.preparerId).usualDays,
          ["tue", "sat"],
        );
      } finally {
        await clearUsualDays(f.preparerId);
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
