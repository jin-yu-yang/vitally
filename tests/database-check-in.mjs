import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-volunteer-check-in (design D1, D2, D5, D9), migration 059:
// the check_ins table and its checks, who reads it, the publication, and the
// counted span (vitally_private.check_in_day_end and check_in_span).
// Rows are inserted as the superuser here; the RPCs come in later tasks.
// One shared fixture; fictional people only. Span tests pass p_now explicitly.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const NY = "America/New_York";

test("Volunteer check-in against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(f, "select current_season from public.workspaces where id=$1", [
      f.workspaceId,
    ]);
    const rejects = (text, values, label) =>
      assert.rejects(
        f.sql(text, values),
        (error) => {
          assert.ok(error.code, `${label}: ${error.message}`);
          return true;
        },
        label,
      );
    // Times are New York wall-clock strings ("2027-02-06 09:55"); a null out is an open row.
    const insertCheckIn = (personId, inLocal, outLocal = null) =>
      one(
        f,
        `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
          values($1,$2,$3,($4::timestamp)::date,$4::timestamp at time zone '${NY}',$5::timestamp at time zone '${NY}')
          returning id`,
        [f.workspaceId, season, personId, inLocal, outLocal],
      );
    const insertShift = (personId, date, start, end, removed = false) =>
      one(
        f,
        `insert into public.shifts(workspace_id,season,person_id,shift_date,start_hour,end_hour,role,removed_at)
          values($1,$2,$3,$4,$5,$6,'preparer',case when $7::boolean then now() end) returning id`,
        [f.workspaceId, season, personId, date, start, end, removed],
      );
    const span = async (id, nowLocal) =>
      one(
        f,
        `select s.state, to_char(s.ends_at at time zone '${NY}','YYYY-MM-DD HH24:MI') as ends, s.minutes,
           s.ends_at = c.checked_in_at as ends_at_in
         from public.check_ins c, vitally_private.check_in_span(c,$2::timestamp at time zone '${NY}') s
         where c.id=$1`,
        [id, nowLocal],
      );
    const cleanup = async () => {
      await f.sql("delete from public.check_ins where workspace_id=$1", [f.workspaceId]);
      await f.sql("delete from public.shifts where workspace_id=$1", [f.workspaceId]);
    };

    await t.test("table: out must be after in", async () => {
      await rejects(
        `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
          values($1,$2,$3,'2027-02-06','2027-02-06 15:00Z','2027-02-06 15:00Z')`,
        [f.workspaceId, season, f.preparerId],
        "out equals in",
      );
    });

    await t.test("table: a check-out after the following midnight is refused", async () => {
      await rejects(
        `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
          values($1,$2,$3,'2027-02-06','2027-02-06 15:00Z','2027-02-07 05:00:01Z')`,
        [f.workspaceId, season, f.preparerId],
        "out after the next midnight",
      );
      // Exactly the next NY midnight (05:00Z in February) is allowed.
      await f.sql(
        `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at,checked_out_at)
          values($1,$2,$3,'2027-02-06','2027-02-06 15:00Z','2027-02-07 05:00Z')`,
        [f.workspaceId, season, f.preparerId],
      );
      await cleanup();
    });

    await t.test("table: check_in_date must be the NY date of checked_in_at", async () => {
      await rejects(
        `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at)
          values($1,$2,$3,'2027-02-06','2027-02-06 03:00Z')`,
        [f.workspaceId, season, f.preparerId],
        "03:00Z is the evening of 02-05 in New York",
      );
    });

    await t.test("rls: an admin reads every row, a preparer only their own, a client none", async () => {
      const mine = await insertCheckIn(f.preparerId, "2027-02-06 10:00");
      const theirs = await insertCheckIn(f.siteCoordinatorId, "2027-02-06 10:05");
      try {
        const ids = async (client) => {
          const { data, error } = await client.from("check_ins").select("id");
          assert.equal(error, null, `check_ins read: ${error?.message}`);
          return data.map((row) => row.id).sort();
        };
        assert.deepEqual(await ids(f.siteCoordinator), [mine.id, theirs.id].sort(), "admin sees both");
        assert.deepEqual(await ids(f.preparer), [mine.id], "a preparer sees only their own");
        assert.deepEqual(await ids(f.applicantA), [], "a client sees none");
      } finally {
        await cleanup();
      }
    });

    await t.test("rls: no direct insert, update or delete", async () => {
      const own = await insertCheckIn(f.preparerId, "2027-02-06 10:00");
      try {
        for (const [who, client] of [
          ["admin", f.siteCoordinator],
          ["preparer", f.preparer],
        ]) {
          const failures = [
            await client.from("check_ins").insert({
              workspace_id: f.workspaceId,
              season,
              person_id: f.preparerId,
              check_in_date: "2027-02-07",
              checked_in_at: "2027-02-07T15:00:00Z",
            }),
            await client.from("check_ins").update({ checked_out_at: "2027-02-06T20:00:00Z" }).eq("id", own.id),
            await client.from("check_ins").delete().eq("id", own.id),
          ];
          failures.forEach((result, index) => assert.ok(result.error, `${who} write ${index} must fail`));
        }
        assert.equal((await one(f, "select count(*)::int n from public.check_ins where id=$1", [own.id])).n, 1);
      } finally {
        await cleanup();
      }
    });

    await t.test("realtime: check_ins is in supabase_realtime", async () => {
      const row = await one(
        f,
        "select 1 as ok from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='check_ins'",
      );
      assert.ok(row, "check_ins is published");
    });

    await t.test("the span", async (t) => {
      // Site hours: Saturday 10-16 and Tuesday 17-20, as the site coordinator saves them.
      const targets = { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 };
      const { error } = await f.siteCoordinator.rpc("vitally_save_schedule_settings", {
        p_action_id: randomUUID(),
        p_expected_revision: 0,
        p_settings: { siteHours: { 2: { open: 17, close: 20 }, 6: { open: 10, close: 16 } }, targets },
      });
      assert.equal(error, null, `settings: ${error?.message}`);
      try {
        await t.test("span: missed with a shift", async () => {
          await insertShift(f.preparerId, "2027-02-06", 10, 13);
          const c = await insertCheckIn(f.preparerId, "2027-02-06 09:55");
          const s = await span(c.id, "2027-02-07 12:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-02-06 13:00", 185]);
          await cleanup();
        });
        await t.test("span: missed with no shift", async () => {
          const c = await insertCheckIn(f.preparerId, "2027-02-09 17:30");
          const s = await span(c.id, "2027-02-10 12:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-02-09 20:00", 150]);
          await cleanup();
        });
        await t.test("span: check-in after the shift ended", async () => {
          await insertShift(f.preparerId, "2027-02-06", 10, 13);
          const c = await insertCheckIn(f.preparerId, "2027-02-06 14:10");
          const s = await span(c.id, "2027-02-07 12:00");
          assert.equal(s.state, "missed");
          assert.equal(s.minutes, 0);
          assert.equal(s.ends_at_in, true, "ends_at is checked_in_at");
          await cleanup();
        });
        await t.test("span: closed day no shift", async () => {
          const c = await insertCheckIn(f.preparerId, "2027-02-08 10:00");
          const s = await span(c.id, "2027-02-09 12:00");
          assert.equal(s.state, "missed");
          assert.equal(s.minutes, 0);
          await cleanup();
        });
        await t.test("span: open and capped", async () => {
          await insertShift(f.preparerId, "2027-02-09", 17, 20);
          const c = await insertCheckIn(f.preparerId, "2027-02-09 17:00");
          const s = await span(c.id, "2027-02-09 21:30");
          assert.deepEqual([s.state, s.ends, s.minutes], ["open", "2027-02-09 20:00", 180]);
          await cleanup();
        });
        await t.test("span: staying late", async () => {
          await insertShift(f.preparerId, "2027-02-09", 17, 20);
          const c = await insertCheckIn(f.preparerId, "2027-02-09 17:00", "2027-02-09 20:40");
          const s = await span(c.id, "2027-02-09 21:30");
          assert.deepEqual([s.state, s.ends, s.minutes], ["out", "2027-02-09 20:40", 220]);
          await cleanup();
        });
        await t.test("span: 11:58 pm and 24:00", async () => {
          const c = await insertCheckIn(f.preparerId, "2027-02-09 23:58", "2027-02-10 00:00");
          const s = await span(c.id, "2027-02-10 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["out", "2027-02-10 00:00", 2]);
          await cleanup();
        });
        await t.test("span: open becomes missed after midnight", async () => {
          await insertShift(f.preparerId, "2027-02-09", 17, 20);
          const c = await insertCheckIn(f.preparerId, "2027-02-09 17:00");
          assert.equal((await span(c.id, "2027-02-09 21:30")).state, "open");
          const later = await span(c.id, "2027-02-10 00:01");
          assert.deepEqual([later.state, later.ends, later.minutes], ["missed", "2027-02-09 20:00", 180]);
          await cleanup();
        });
        await t.test("span: DST Sunday", async () => {
          const c = await insertCheckIn(f.preparerId, "2027-03-14 10:00", "2027-03-14 13:00");
          const s = await span(c.id, "2027-03-15 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["out", "2027-03-14 13:00", 180]);
          // 13:00 EDT after the change is 17:00Z.
          const utc = await one(
            f,
            "select to_char(checked_out_at at time zone 'UTC','HH24:MI') as h from public.check_ins where id=$1",
            [c.id],
          );
          assert.equal(utc.h, "17:00");
          await cleanup();
        });
        await t.test("span: a removed shift does not set the end", async () => {
          await insertShift(f.preparerId, "2027-02-06", 10, 13, true);
          const c = await insertCheckIn(f.preparerId, "2027-02-06 09:55");
          const s = await span(c.id, "2027-02-07 12:00");
          // No live shift: the Saturday close of 16:00 sets the end.
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-02-06 16:00", 365]);
          await cleanup();
        });
      } finally {
        await cleanup();
        await f.sql("delete from public.schedule_settings where workspace_id=$1", [f.workspaceId]);
      }
    });
  } finally {
    await f.close();
  }
});
