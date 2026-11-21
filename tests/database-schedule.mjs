import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-volunteer-schedule (design D1, D3, D10), migration 056
// sections 1 to 4: the shifts and schedule_settings tables, the usual days on
// the volunteer profile, the site hours validator, who reads which rows
// directly (for realtime), and the publication, and the site hours and targets save. The other RPCs come in later tasks.
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
