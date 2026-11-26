import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-volunteer-check-in (design D1, D2, D5, D9), migration 060:
// the check_ins table and its checks, who reads it, the publication, and the
// counted span (vitally_private.check_in_day_end and check_in_span).
// Rows are inserted as the superuser for the table and span cases; the self
// RPCs (vitally_my_check_in, vitally_check_in, vitally_check_out) are called
// as the signed-in people, and the admin RPCs (vitally_save_check_in,
// vitally_remove_check_in, vitally_hours_this_week and the checkIns of
// vitally_schedule_day) as the site coordinator.
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
        await t.test("span: DST Sunday, missed, derived end", async () => {
          await insertShift(f.preparerId, "2027-03-14", 10, 13);
          const c = await insertCheckIn(f.preparerId, "2027-03-14 10:00");
          const s = await span(c.id, "2027-03-15 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-03-14 13:00", 180]);
          // 13:00 EDT after the change is 17:00Z.
          const utc = await one(
            f,
            `select to_char(s.ends_at at time zone 'UTC','HH24:MI') as h
             from public.check_ins c, vitally_private.check_in_span(c,'2027-03-15 13:00Z') s where c.id=$1`,
            [c.id],
          );
          assert.equal(utc.h, "17:00");
          await cleanup();
        });
        await t.test("span: fall-back Sunday, missed, derived end", async () => {
          await insertShift(f.preparerId, "2027-11-07", 10, 13);
          const c = await insertCheckIn(f.preparerId, "2027-11-07 10:00");
          const s = await span(c.id, "2027-11-08 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-11-07 13:00", 180]);
          await cleanup();
        });
        await t.test("span: a day end of 24 is the next New York midnight", async () => {
          await insertShift(f.preparerId, "2027-02-06", 18, 24);
          const c = await insertCheckIn(f.preparerId, "2027-02-06 18:00");
          const s = await span(c.id, "2027-02-07 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-02-07 00:00", 360]);
          await cleanup();
        });
        await t.test("span: a day end of 24 on a DST Sunday", async () => {
          await insertShift(f.preparerId, "2027-03-14", 20, 24);
          const c = await insertCheckIn(f.preparerId, "2027-03-14 20:00");
          const s = await span(c.id, "2027-03-15 09:00");
          assert.deepEqual([s.state, s.ends, s.minutes], ["missed", "2027-03-15 00:00", 240]);
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

    await t.test("the self RPCs", async (t) => {
      const ok = async (client, fn, args = {}) => {
        const { data, error } = await client.rpc(fn, args);
        assert.equal(error, null, `${fn}: ${error?.code} ${error?.message}`);
        return data;
      };
      const refusal = async (client, fn, args, message, detail) => {
        const { data, error } = await client.rpc(fn, args);
        assert.equal(error?.message, message, `${fn}: ${error?.code} ${error?.message}`);
        if (detail !== undefined) assert.equal(error?.details, detail, `${fn} detail`);
        assert.equal(data, null);
      };
      const rows = async (personId) =>
        (
          await f.sql(
            "select * from public.check_ins where workspace_id=$1 and person_id=$2 order by created_at",
            [f.workspaceId, personId],
          )
        ).rows;
      const receipts = async (actionId) =>
        (
          await one(
            f,
            "select count(*)::int n from public.action_receipts where workspace_id=$1 and action_id=$2",
            [f.workspaceId, actionId],
          )
        ).n;
      // Nora is on the roster with no roles, so she is not cleared.
      const nora = await f.staff({ key: "nora_check_in", name: "Nora Ellis", capabilities: [] });
      await f.sql("update public.roster_entries set roles='{}' where person_id=$1", [nora.personId]);
      assert.equal(
        (await one(f, "select vitally_private.cleared($1,$2) as c", [f.workspaceId, nora.personId])).c,
        false,
      );
      const ula = await f.staff({ key: "ula_check_in", name: "Ula Brandt", capabilities: ["prepare"] });
      const setStatus = (status) =>
        f.sql("update public.accounts set status=$3 where workspace_id=$1 and user_id=$2", [
          f.workspaceId,
          ula.userId,
          status,
        ]);
      try {
        await t.test("check in: a cleared preparer checks in", async () => {
          const before = await ok(f.preparer, "vitally_my_check_in");
          assert.equal(before.canCheckIn, true);
          assert.equal(before.open, null);
          assert.match(before.today, /^\d{4}-\d{2}-\d{2}$/);
          const answer = await ok(f.preparer, "vitally_check_in", { p_action_id: randomUUID() });
          const mine = await ok(f.preparer, "vitally_my_check_in");
          assert.equal(mine.open.checkInId, answer.open.checkInId);
          assert.equal(mine.open.checkedInAt, answer.open.checkedInAt);
          const [row] = await rows(f.preparerId);
          assert.equal(row.id, answer.open.checkInId);
          assert.equal(row.created_by_person_id, f.preparerId);
          assert.equal(row.updated_by_person_id, f.preparerId);
          assert.equal(row.corrected_by_person_id, null);
          assert.equal(Number(row.revision), 1);
          await cleanup();
        });
        await t.test("check in: not cleared", async () => {
          const actionId = randomUUID();
          await refusal(nora.client, "vitally_check_in", { p_action_id: actionId }, "NOT_CLEARED");
          await refusal(nora.client, "vitally_check_out", { p_action_id: actionId }, "NOT_CLEARED");
          assert.equal((await rows(nora.personId)).length, 0);
          assert.equal(await receipts(actionId), 0);
        });
        await t.test("check in: forbidden for a client, and for an invited account", async () => {
          await refusal(f.applicantA, "vitally_check_in", { p_action_id: randomUUID() }, "FORBIDDEN");
          await refusal(f.applicantA, "vitally_check_out", { p_action_id: randomUUID() }, "FORBIDDEN");
          await refusal(f.applicantA, "vitally_my_check_in", {}, "FORBIDDEN");
          await setStatus("invited");
          try {
            await refusal(ula.client, "vitally_my_check_in", {}, "FORBIDDEN");
            await refusal(ula.client, "vitally_check_in", { p_action_id: randomUUID() }, "FORBIDDEN");
          } finally {
            await setStatus("active");
          }
          assert.equal((await rows(ula.personId)).length, 0);
        });
        await t.test("check in: replay", async () => {
          const actionId = randomUUID();
          const first = await ok(f.preparer, "vitally_check_in", { p_action_id: actionId });
          const second = await ok(f.preparer, "vitally_check_in", { p_action_id: actionId });
          assert.deepEqual(second, first);
          assert.equal((await rows(f.preparerId)).length, 1);
          await cleanup();
        });
        await t.test("check in: replay after checking out returns the stored answer", async () => {
          const actionId = randomUUID();
          const first = await ok(f.preparer, "vitally_check_in", { p_action_id: actionId });
          await f.sql("update public.check_ins set checked_in_at=checked_in_at-interval '1 second' where id=$1", [
            first.open.checkInId,
          ]);
          await ok(f.preparer, "vitally_check_out", { p_action_id: randomUUID() });
          const again = await ok(f.preparer, "vitally_check_in", { p_action_id: actionId });
          assert.deepEqual(again, first);
          const all = await rows(f.preparerId);
          assert.equal(all.length, 1, "no new row");
          assert.ok(all[0].checked_out_at, "still checked out");
          await cleanup();
        });
        await t.test("check in: ALREADY_CHECKED_IN stores no receipt", async () => {
          await ok(f.preparer, "vitally_check_in", { p_action_id: randomUUID() });
          const refusedId = randomUUID();
          await refusal(f.preparer, "vitally_check_in", { p_action_id: refusedId }, "VALIDATION", "ALREADY_CHECKED_IN");
          assert.equal(await receipts(refusedId), 0);
          await cleanup();
        });
        await t.test("check in: already checked in", async () => {
          await ok(f.preparer, "vitally_check_in", { p_action_id: randomUUID() });
          await refusal(f.preparer, "vitally_check_in", { p_action_id: randomUUID() }, "VALIDATION", "ALREADY_CHECKED_IN");
          assert.equal((await rows(f.preparerId)).length, 1);
          await cleanup();
        });
        await t.test("check out: closes the open one", async () => {
          const answer = await ok(f.preparer, "vitally_check_in", { p_action_id: randomUUID() });
          // Push the check-in back so the check-out is after it.
          await f.sql("update public.check_ins set checked_in_at=checked_in_at-interval '1 second' where id=$1", [
            answer.open.checkInId,
          ]);
          const actionId = randomUUID();
          const out = await ok(f.preparer, "vitally_check_out", { p_action_id: actionId });
          assert.equal(out.checkInId, answer.open.checkInId);
          assert.ok(out.checkedOutAt);
          assert.deepEqual(await ok(f.preparer, "vitally_check_out", { p_action_id: actionId }), out, "replay");
          const [row] = await rows(f.preparerId);
          assert.ok(row.checked_out_at);
          assert.equal(Number(row.revision), 2);
          assert.equal(row.corrected_by_person_id, null);
          assert.equal(row.updated_by_person_id, f.preparerId);
          assert.equal((await ok(f.preparer, "vitally_my_check_in")).open, null);
          await cleanup();
        });
        await t.test("check out: nothing open", async () => {
          await refusal(f.preparer, "vitally_check_out", { p_action_id: randomUUID() }, "VALIDATION", "NOT_CHECKED_IN");
        });
        await t.test("my check-in: yesterday's open row is not open", async () => {
          await f.sql(
            `insert into public.check_ins(workspace_id,season,person_id,check_in_date,checked_in_at)
              values($1,$2,$3,(now() at time zone '${NY}')::date-1,
                (((now() at time zone '${NY}')::date-1)::timestamp+interval '10 hours') at time zone '${NY}')`,
            [f.workspaceId, season, f.preparerId],
          );
          assert.equal((await ok(f.preparer, "vitally_my_check_in")).open, null);
          await refusal(f.preparer, "vitally_check_out", { p_action_id: randomUUID() }, "VALIDATION", "NOT_CHECKED_IN");
          await ok(f.preparer, "vitally_check_in", { p_action_id: randomUUID() });
          assert.equal((await rows(f.preparerId)).length, 2);
          await cleanup();
        });
        await t.test("my check-in: not gated by clearance", async () => {
          const answer = await ok(nora.client, "vitally_my_check_in");
          assert.equal(answer.canCheckIn, false);
          assert.equal(answer.open, null);
        });
      } finally {
        await cleanup();
      }
    });

    await t.test("admin corrections, the day read and the hours", async (t) => {
      const sc = f.siteCoordinator;
      // A case that fails still leaves the next one a clean day.
      const it = (name, fn) =>
        t.test(name, async (tc) => {
          try {
            await fn(tc);
          } finally {
            await cleanup();
          }
        });
      const ok = async (client, fn, args = {}) => {
        const { data, error } = await client.rpc(fn, args);
        assert.equal(error, null, `${fn}: ${error?.code} ${error?.message}`);
        return data;
      };
      // A refusal writes no receipt; `detail` is the VALIDATION reason.
      const refused = async (client, fn, args, message, detail, label) => {
        const { data, error } = await client.rpc(fn, args);
        assert.equal(error?.message, message, `${label}: ${error?.code} ${error?.message}`);
        if (detail !== undefined) assert.equal(error?.details, detail, `${label} detail`);
        assert.equal(data, null);
        if (args.p_action_id) assert.equal(await f.receiptsFor(args.p_action_id), 0, `${label}: no receipt`);
      };
      const save = (id, revision, body, actionId = randomUUID()) => ({
        p_action_id: actionId,
        p_check_in_id: id,
        p_expected_revision: revision,
        p_check_in: body,
      });
      const add = (volunteerId, date, checkedIn, checkedOut) => ({ volunteerId, date, checkedIn, checkedOut });
      const remove = (id, revision, actionId = randomUUID()) => ({
        p_action_id: actionId,
        p_check_in_id: id,
        p_expected_revision: revision,
      });
      const row = async (id) => one(f, "select * from public.check_ins where id=$1", [id]);
      const liveCount = async (personId) =>
        (
          await one(
            f,
            "select count(*)::int n from public.check_ins where workspace_id=$1 and person_id=$2 and removed_at is null",
            [f.workspaceId, personId],
          )
        ).n;
      const localTime = async (instant) =>
        (await one(f, `select to_char($1::timestamptz at time zone '${NY}','HH24:MI') as h`, [instant])).h;
      const adminName = (await one(f, "select name from public.people where id=$1", [f.siteCoordinatorId])).name;
      // New York dates relative to now. Each is in the past, except today and tomorrow.
      const d = await one(
        f,
        `select to_char(t,'YYYY-MM-DD') as today, to_char(t-1,'YYYY-MM-DD') as yesterday,
           to_char(t+1,'YYYY-MM-DD') as tomorrow, to_char(t-2,'YYYY-MM-DD') as day_before,
           to_char(t-1-((extract(isodow from t-1)::int-6+7)%7),'YYYY-MM-DD') as sat,
           to_char(t-1-(extract(isodow from t-1)::int-1),'YYYY-MM-DD') as mon
         from (select (now() at time zone '${NY}')::date as t) x`,
      );
      // Open Tuesday 17-20 and Saturday 10-16, so Monday is closed.
      await f.sql(
        `insert into public.schedule_settings(workspace_id,site_hours)
          values($1,'{"2":{"open":17,"close":20},"6":{"open":10,"close":16}}')`,
        [f.workspaceId],
      );
      // A volunteer with no sign-in, as a site coordinator adds one.
      const casey = await ok(sc, "vitally_save_volunteer", {
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
      const vera = await f.staff({ key: "vera_check_in", name: "Vera Holt", capabilities: ["prepare"] });
      await f.sql("delete from public.roster_entries where person_id=$1", [vera.personId]);
      const wes = await f.staff({ key: "wes_check_in", name: "Wes Archer", capabilities: ["prepare"] });
      try {
        await it("save: fixing a missed check-out", async () => {
          const missed = await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`);
          const answer = await ok(sc, "vitally_save_check_in", save(missed.id, 1, { checkedIn: "10:00", checkedOut: "12:30" }));
          assert.equal(answer.state, "out");
          assert.equal(answer.minutes, 150);
          assert.equal(answer.revision, 2);
          assert.equal(answer.flags.corrected, true);
          assert.equal(answer.flags.noCheckOut, false);
          assert.equal(answer.correctedByName, adminName);
          const stored = await row(missed.id);
          assert.equal(stored.corrected_by_person_id, f.siteCoordinatorId);
          assert.equal(stored.updated_by_person_id, f.siteCoordinatorId);
          assert.equal(Number(stored.revision), 2);
          assert.equal(await localTime(stored.checked_out_at), "12:30");
        });
        await it("save: reopening today", async () => {
          const closed = await insertCheckIn(f.preparerId, `${d.today} 00:00`, `${d.today} 00:01`);
          const answer = await ok(sc, "vitally_save_check_in", save(closed.id, 1, { checkedIn: "00:00", checkedOut: null }));
          assert.equal(answer.state, "open");
          assert.equal(answer.checkedOutAt, null);
          assert.equal((await row(closed.id)).checked_out_at, null);
          assert.ok((await ok(f.preparer, "vitally_my_check_in")).open, "the strip shows Check out");
        });
        await it("save: add yesterday 10:00-13:00", async () => {
          const answer = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, "10:00", "13:00")));
          assert.equal(answer.minutes, 180);
          assert.equal(answer.state, "out");
          assert.equal(answer.flags.corrected, true);
          assert.equal(answer.volunteerId, f.preparerId);
          const stored = await row(answer.checkInId);
          assert.equal(stored.created_by_person_id, f.siteCoordinatorId);
          assert.equal(stored.corrected_by_person_id, f.siteCoordinatorId);
          assert.equal(Number(stored.revision), 1);
        });
        await it("save: out before in", async () => {
          for (const [i, o] of [["14:00", "13:30"], ["14:00", "14:00"]])
            await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, i, o)), "VALIDATION", "OUT_BEFORE_IN", `${i}-${o}`);
          assert.equal(await liveCount(f.preparerId), 0);
        });
        await it("save: future", async () => {
          // Today to the coming midnight, and a check-in tomorrow.
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.today, "00:00", "24:00")), "VALIDATION", "IN_FUTURE", "out after now");
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.tomorrow, "10:00", null)), "VALIDATION", "IN_FUTURE", "in tomorrow");
          assert.equal(await liveCount(f.preparerId), 0);
          // Checked in at midnight with no check-out is not in the future.
          const open = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.today, "00:00", null)));
          assert.equal(open.state, "open");
        });
        await it("save: overlap and meeting spans", async () => {
          await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`, `${d.yesterday} 12:00`);
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, "11:30", "13:00")), "VALIDATION", "OVERLAP", "11:30-13:00");
          const meets = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, "12:00", "13:00")));
          assert.equal(meets.minutes, 60);
          // A check-in does not overlap itself when edited.
          await ok(sc, "vitally_save_check_in", save(meets.checkInId, 1, { checkedIn: "12:00", checkedOut: "12:30" }));
          assert.equal(await liveCount(f.preparerId), 2);
        });
        await it("save: overlap uses the derived end", async () => {
          await insertShift(f.preparerId, d.sat, 10, 13);
          await insertCheckIn(f.preparerId, `${d.sat} 10:00`);
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.sat, "12:00", "14:00")), "VALIDATION", "OVERLAP", "12:00-14:00");
          const after = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.sat, "13:00", "14:00")));
          assert.equal(after.minutes, 60);
        });
        // Today's layouts start at 10:00, or earlier when it is too early in the
        // New York day for them; null when even 00:00 is too late.
        const nyMinutesNow = async () =>
          (await one(f, `select (extract(hour from now() at time zone '${NY}')*60+extract(minute from now() at time zone '${NY}'))::int as m`)).m;
        const baseHour = async (needMinutes) => {
          const b = Math.min(10, Math.floor(((await nyMinutesNow()) - needMinutes) / 60));
          return b < 0 ? null : b;
        };
        const hh = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const openRows = async (personId) =>
          (
            await one(
              f,
              "select count(*)::int n from public.check_ins where workspace_id=$1 and person_id=$2 and removed_at is null and checked_out_at is null",
              [f.workspaceId, personId],
            )
          ).n;
        await it("save: adding beside an open check-in", async (t2) => {
          // Open since B:00 with a shift ending B+3, now after B+4:30. Add B+4:00 to B+4:30.
          const b = await baseHour(4 * 60 + 31);
          if (b === null) return t2.skip("too early in the New York day");
          await insertShift(f.preparerId, d.today, b, b + 3);
          await insertCheckIn(f.preparerId, `${d.today} ${hh(b)}`);
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.today, hh(b + 4), hh(b + 4, 30))), "VALIDATION", "OVERLAP", "beside an open check-in");
          // An open one added after the open one is refused too.
          await refused(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.today, hh(b + 4), null)), "VALIDATION", "OVERLAP", "a second open check-in");
          assert.equal(await liveCount(f.preparerId), 1);
          assert.equal(await openRows(f.preparerId), 1);
          // Before the open one is allowed: an open check-in runs on, not back.
          if (b >= 1) await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.today, hh(b - 1), hh(b))));
        });
        await it("save: reopening before a later check-in", async (t2) => {
          // B:00-B+2 and B+3-B+4, both past, with a shift ending B+2. Clear the first one's out.
          const b = await baseHour(4 * 60 + 1);
          if (b === null) return t2.skip("too early in the New York day");
          await insertShift(f.preparerId, d.today, b, b + 2);
          const first = await insertCheckIn(f.preparerId, `${d.today} ${hh(b)}`, `${d.today} ${hh(b + 2)}`);
          await insertCheckIn(f.preparerId, `${d.today} ${hh(b + 3)}`, `${d.today} ${hh(b + 4)}`);
          const before = await row(first.id);
          await refused(sc, "vitally_save_check_in", save(first.id, 1, { checkedIn: hh(b), checkedOut: null }), "VALIDATION", "OVERLAP", "reopening");
          const after = await row(first.id);
          assert.equal(Number(after.revision), 1);
          assert.equal(after.checked_out_at.getTime(), before.checked_out_at.getTime());
          assert.equal(after.corrected_by_person_id, null);
        });
        await it("save: outside site hours and no sign-in are allowed", async () => {
          const early = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.mon, "06:00", "07:00")));
          assert.equal(early.flags.outsideSiteHours, true);
          assert.equal(early.flags.notScheduled, true);
          const noSignIn = await ok(sc, "vitally_save_check_in", save(null, null, add(casey.personId, d.sat, "10:00", "11:00")));
          assert.equal(noSignIn.name, "Casey Morrow");
        });
        await it("save: a 24:00 check-out is the next New York midnight", async () => {
          const late = await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, "23:58", "24:00")));
          assert.equal(late.minutes, 2);
          const stored = await row(late.checkInId);
          assert.equal(
            (await one(f, `select $1::timestamptz = (($2::date+1)::timestamp at time zone '${NY}') as ok`, [stored.checked_out_at, d.yesterday])).ok,
            true,
          );
        });
        await it("save: not on the roster, deactivated", async () => {
          await refused(sc, "vitally_save_check_in", save(null, null, add(vera.personId, d.yesterday, "10:00", "11:00")), "VALIDATION", "NOT_ON_ROSTER", "no roster entry");
          await f.sql("update public.accounts set status='deactivated' where workspace_id=$1 and user_id=$2", [f.workspaceId, wes.userId]);
          try {
            await refused(sc, "vitally_save_check_in", save(null, null, add(wes.personId, d.yesterday, "10:00", "11:00")), "VALIDATION", "DEACTIVATED", "deactivated");
          } finally {
            await f.sql("update public.accounts set status='active' where workspace_id=$1 and user_id=$2", [f.workspaceId, wes.userId]);
          }
          assert.equal(await liveCount(vera.personId), 0);
          assert.equal(await liveCount(wes.personId), 0);
        });
        await it("save: forbidden for a preparer, no receipt", async () => {
          const body = add(f.preparerId, d.yesterday, "10:00", "11:00");
          await refused(f.preparer, "vitally_save_check_in", save(null, null, body), "FORBIDDEN", undefined, "preparer");
          await refused(f.applicantA, "vitally_save_check_in", save(null, null, body), "FORBIDDEN", undefined, "client");
          const seeded = await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`);
          await refused(f.preparer, "vitally_remove_check_in", remove(seeded.id, 1), "FORBIDDEN", undefined, "remove by preparer");
          assert.equal(await liveCount(f.preparerId), 1);
        });
        await it("save: stale revision is CONFLICT", async () => {
          const missed = await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`);
          await ok(sc, "vitally_save_check_in", save(missed.id, 1, { checkedIn: "10:00", checkedOut: "12:00" }));
          await refused(sc, "vitally_save_check_in", save(missed.id, 1, { checkedIn: "10:00", checkedOut: "13:00" }), "CONFLICT", undefined, "stale save");
          await refused(sc, "vitally_remove_check_in", remove(missed.id, 1), "CONFLICT", undefined, "stale remove");
          assert.equal(Number((await row(missed.id)).revision), 2);
        });
        await it("save: replay returns the stored answer", async () => {
          const actionId = randomUUID();
          const body = add(f.preparerId, d.yesterday, "10:00", "13:00");
          const first = await ok(sc, "vitally_save_check_in", save(null, null, body, actionId));
          const second = await ok(sc, "vitally_save_check_in", save(null, null, body, actionId));
          assert.deepEqual(second, first);
          assert.equal(await liveCount(f.preparerId), 1);
        });
        await it("save: shape errors", async () => {
          const bad = [
            ["a bad checkedIn", add(f.preparerId, d.yesterday, "9:00", null), "checkedIn"],
            ["a bad checkedOut", add(f.preparerId, d.yesterday, "10:00", "25:00"), "checkedOut"],
            ["24:00 is out-only", add(f.preparerId, d.yesterday, "24:00", null), "checkedIn"],
            ["a missing checkedOut", { volunteerId: f.preparerId, date: d.yesterday, checkedIn: "10:00" }, "checkedOut"],
            ["a missing volunteer", { date: d.yesterday, checkedIn: "10:00", checkedOut: null }, "volunteerId"],
            ["a bad date", add(f.preparerId, "2027-02-30", "10:00", null), "date"],
          ];
          for (const [label, body, detail] of bad)
            await refused(sc, "vitally_save_check_in", save(null, null, body), "VALIDATION", detail, label);
          await refused(sc, "vitally_save_check_in", save(randomUUID(), null, add(f.preparerId, d.yesterday, "10:00", null)), "VALIDATION", undefined, "id without revision");
          await refused(sc, "vitally_save_check_in", save(null, 1, add(f.preparerId, d.yesterday, "10:00", null)), "VALIDATION", undefined, "revision without id");
          await refused(sc, "vitally_save_check_in", save(null, null, null), "VALIDATION", undefined, "no body");
          await refused(sc, "vitally_save_check_in", save(randomUUID(), 1, { checkedIn: "10:00", checkedOut: null }), "NOT_FOUND", undefined, "unknown id");
          assert.equal(await liveCount(f.preparerId), 0);
        });
        await it("save: an edit keeps person and date", async () => {
          const c = await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`, `${d.yesterday} 11:00`);
          await refused(sc, "vitally_save_check_in", save(c.id, 1, add(wes.personId, d.yesterday, "10:00", "11:00")), "VALIDATION", "volunteerId", "another person");
          await refused(sc, "vitally_save_check_in", save(c.id, 1, add(f.preparerId, d.day_before, "10:00", "11:00")), "VALIDATION", "date", "another date");
          assert.equal(Number((await row(c.id)).revision), 1);
          // The same person and date, repeated, are accepted.
          await ok(sc, "vitally_save_check_in", save(c.id, 1, add(f.preparerId, d.yesterday, "10:00", "11:30")));
        });
        await it("save: an unchanged off-step minute is accepted", async () => {
          const c = await insertCheckIn(f.preparerId, `${d.yesterday} 09:52`, `${d.yesterday} 13:10`);
          const answer = await ok(sc, "vitally_save_check_in", save(c.id, 1, { checkedIn: "09:52", checkedOut: "13:20" }));
          assert.equal(answer.minutes, 208);
          assert.equal(await localTime((await row(c.id)).checked_in_at), "09:52");
        });
        await it("save: an unchanged minute keeps the stored seconds", async () => {
          const seconds = async (instant) =>
            (await one(f, `select to_char($1::timestamptz at time zone '${NY}','HH24:MI:SS') as s`, [instant])).s;
          // Checked out by mistake at 12:54:20, back in at 12:54:45.
          await insertCheckIn(f.preparerId, `${d.day_before} 12:00`, `${d.day_before} 12:54:20`);
          const second = await insertCheckIn(f.preparerId, `${d.day_before} 12:54:45`);
          await ok(sc, "vitally_save_check_in", save(second.id, 1, { checkedIn: "12:54", checkedOut: null }));
          assert.equal(await seconds((await row(second.id)).checked_in_at), "12:54:45", "both fields left alone");
          await ok(sc, "vitally_save_check_in", save(second.id, 2, { checkedIn: "12:54", checkedOut: "14:00" }));
          assert.equal(await seconds((await row(second.id)).checked_in_at), "12:54:45", "only a check-out added");
          // Moving the field does rebuild the instant.
          await ok(sc, "vitally_save_check_in", save(second.id, 3, { checkedIn: "12:55", checkedOut: "14:00" }));
          assert.equal(await seconds((await row(second.id)).checked_in_at), "12:55:00", "a changed minute");
          // A check-in and check-out inside one minute.
          const short = await insertCheckIn(f.preparerId, `${d.day_before} 15:55:10`, `${d.day_before} 15:55:40`);
          await ok(sc, "vitally_save_check_in", save(short.id, 1, { checkedIn: "15:55", checkedOut: "15:55" }));
          const stored = await row(short.id);
          assert.equal(await seconds(stored.checked_in_at), "15:55:10");
          assert.equal(await seconds(stored.checked_out_at), "15:55:40");
        });

        await it("remove: soft delete and later change refused", async () => {
          const c = await insertCheckIn(f.preparerId, `${d.yesterday} 10:00`, `${d.yesterday} 12:00`);
          const actionId = randomUUID();
          const answer = await ok(sc, "vitally_remove_check_in", remove(c.id, 1, actionId));
          assert.deepEqual(answer, { checkInId: c.id, revision: 2 });
          assert.deepEqual(await ok(sc, "vitally_remove_check_in", remove(c.id, 1, actionId)), answer, "replay");
          const stored = await row(c.id);
          assert.ok(stored.removed_at);
          assert.equal(Number(stored.revision), 2);
          await refused(sc, "vitally_save_check_in", save(c.id, 2, { checkedIn: "10:00", checkedOut: "13:00" }), "NOT_FOUND", undefined, "save on a removed row");
          await refused(sc, "vitally_remove_check_in", remove(c.id, 2), "NOT_FOUND", undefined, "second removal");
          const day = await ok(sc, "vitally_schedule_day", { p_date: d.yesterday });
          assert.deepEqual(day.checkIns, []);
          // Its time is free again.
          await ok(sc, "vitally_save_check_in", save(null, null, add(f.preparerId, d.yesterday, "11:00", "12:00")));
        });

        await it("day: admin gets checkIns with flags", async () => {
          await insertShift(f.preparerId, d.sat, 10, 13);
          const inShift = await insertCheckIn(f.preparerId, `${d.sat} 09:52`, `${d.sat} 13:10`);
          const unscheduled = await insertCheckIn(f.siteCoordinatorId, `${d.sat} 10:30`);
          const closedDay = await insertCheckIn(f.preparerId, `${d.mon} 10:00`, `${d.mon} 11:00`);
          await f.sql("update public.check_ins set corrected_by_person_id=$2 where id=$1", [inShift.id, f.siteCoordinatorId]);
          const sat = await ok(sc, "vitally_schedule_day", { p_date: d.sat });
          assert.equal(sat.checkIns.length, 2);
          const [first, second] = sat.checkIns;
          assert.equal(first.checkInId, inShift.id, "ordered by check-in time");
          assert.deepEqual(Object.keys(first).sort(), [
            "checkInId", "checkedInAt", "checkedOutAt", "correctedByName", "endsAt", "flags", "minutes", "name", "revision", "state", "volunteerId",
          ]);
          assert.deepEqual(first.flags, { noCheckOut: false, notScheduled: false, corrected: true, outsideSiteHours: true });
          assert.equal(first.minutes, 198);
          assert.equal(first.correctedByName, adminName);
          assert.equal(second.checkInId, unscheduled.id);
          assert.equal(second.state, "missed");
          assert.deepEqual(second.flags, { noCheckOut: true, notScheduled: true, corrected: false, outsideSiteHours: false });
          assert.equal(second.correctedByName, null);
          const monday = await ok(sc, "vitally_schedule_day", { p_date: d.mon });
          assert.equal(monday.checkIns.length, 1);
          assert.equal(monday.checkIns[0].checkInId, closedDay.id);
          assert.equal(monday.checkIns[0].flags.outsideSiteHours, true);
        });
        await it("day: non-admin answer is unchanged", async () => {
          await insertShift(f.preparerId, d.sat, 10, 13);
          const before = await ok(f.preparer, "vitally_schedule_day", { p_date: d.sat });
          assert.equal("checkIns" in before, false);
          await insertCheckIn(f.preparerId, `${d.sat} 10:00`, `${d.sat} 12:00`);
          const after = await ok(f.preparer, "vitally_schedule_day", { p_date: d.sat });
          assert.deepEqual(after, before);
        });

        await it("hours: 6.5 hours", async () => {
          const wk = await one(
            f,
            `select to_char(monday+1,'YYYY-MM-DD') as tue, to_char(monday+5,'YYYY-MM-DD') as sat,
               to_char(monday+7,'YYYY-MM-DD') as next_mon, to_char(monday,'YYYY-MM-DD') as monday,
               to_char(sunday,'YYYY-MM-DD') as sunday
             from vitally_private.ny_week(now())`,
          );
          await insertCheckIn(f.preparerId, `${wk.tue} 17:00`, `${wk.tue} 20:00`);
          await insertCheckIn(f.preparerId, `${wk.sat} 09:52`, `${wk.sat} 13:22`);
          await insertCheckIn(f.preparerId, `${wk.next_mon} 10:00`, `${wk.next_mon} 12:00`);
          const removed = await insertCheckIn(f.siteCoordinatorId, `${wk.tue} 10:00`, `${wk.tue} 12:00`);
          await f.sql("update public.check_ins set removed_at=now() where id=$1", [removed.id]);
          const answer = await ok(sc, "vitally_hours_this_week");
          assert.deepEqual(Object.keys(answer).sort(), ["hours", "weekEnd", "weekStart"]);
          assert.equal(answer.weekStart, wk.monday);
          assert.equal(answer.weekEnd, wk.sunday);
          assert.deepEqual(answer.hours, [{ volunteerId: f.preparerId, minutes: 390 }]);
        });
        await it("hours: forbidden for a preparer", async () => {
          await refused(f.preparer, "vitally_hours_this_week", {}, "FORBIDDEN", undefined, "preparer");
          await refused(f.applicantA, "vitally_hours_this_week", {}, "FORBIDDEN", undefined, "client");
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
