import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-my-profile (design D3, D4), migration 057 §1-§3: the
// review columns, the clearance answer's reviewedAt, reviewReason and
// uploadUrl, and a send clearing the reviewed pair. Spec: volunteer-clearance.
// Later tasks add sections to this file. Every row belongs to the fixture's own
// workspace.

const LINK = "https://example.org/certificates";
const CHECK_VIOLATION = "23514";

test("057 clearance answer against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const myClearance = async (client) => {
      const { data, error } = await client.rpc("vitally_my_clearance");
      assert.equal(error, null, `vitally_my_clearance: ${error?.code} ${error?.message}`);
      return data;
    };
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    // An uncleared member with a current-season entry and no roles.
    const unclearedMember = async (key, name) => {
      const member = await f.staff({ key, name, capabilities: [], cleared: false });
      await f.sql(
        "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new) values($1,$2,$3,'{}',false) on conflict do nothing",
        [f.workspaceId, member.personId, season],
      );
      return member;
    };
    const setEntry = (member, set) =>
      f.sql(`update public.roster_entries set ${set} where workspace_id=$1 and person_id=$2 and season=$3`, [
        f.workspaceId,
        member.personId,
        season,
      ]);
    const entryOf = async (member) =>
      (
        await f.sql("select * from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
          f.workspaceId,
          member.personId,
          season,
        ])
      ).rows[0];
    const REVIEWED = "form_13615_reviewed_at='2026-11-18T15:30:00Z',form_13615_review_reason='Not signed'";
    const setLink = (url) =>
      f.sql(
        "insert into public.season_settings(workspace_id,certificate_upload_url) values($1,$2) on conflict(workspace_id) do update set certificate_upload_url=excluded.certificate_upload_url",
        [f.workspaceId, url],
      );

    try {
      await setLink(LINK);

      await t.test("items carry null reviewedAt and reviewReason", async () => {
        const member = await unclearedMember("mp_none", "Ula Prentiss");
        assert.deepEqual((await myClearance(member.client)).missing, [
          { kind: "form13615", sentAt: null, reviewedAt: null, reviewReason: null },
        ]);
      });

      await t.test("a reviewed item reports its time and reason", async () => {
        const member = await unclearedMember("mp_reviewed", "Sam Okafor");
        await setEntry(member, REVIEWED);
        const [item] = (await myClearance(member.client)).missing;
        assert.equal(item.kind, "form13615");
        assert.equal(new Date(item.reviewedAt).getTime(), Date.parse("2026-11-18T15:30:00Z"));
        assert.equal(item.reviewReason, "Not signed");
      });

      await t.test("uploadUrl is null while the site check is owed", async () => {
        const member = await unclearedMember("mp_site", "Lena Voss");
        await f.sql("update public.accounts set status='invited' where workspace_id=$1 and user_id=$2", [
          f.workspaceId,
          member.userId,
        ]);
        try {
          const owed = await myClearance(member.client);
          assert.equal(owed.siteCheck, true);
          assert.equal(owed.uploadUrl, null);
        } finally {
          await f.sql("update public.accounts set status='active' where workspace_id=$1 and user_id=$2", [
            f.workspaceId,
            member.userId,
          ]);
        }
        const active = await myClearance(member.client);
        assert.equal(active.siteCheck, false);
        assert.equal(active.uploadUrl, LINK);
      });

      await t.test("sending again clears the reviewed pair", async () => {
        const member = await unclearedMember("mp_resend", "Mia Hartley");
        await setEntry(member, REVIEWED);
        const { error } = await member.client.rpc("vitally_mark_upload_sent", {
          p_action_id: randomUUID(),
          p_document: "form13615",
        });
        assert.equal(error, null, `send: ${error?.code} ${error?.message}`);
        const entry = await entryOf(member);
        assert.ok(entry.form_13615_sent_at);
        assert.equal(entry.form_13615_reviewed_at, null);
        assert.equal(entry.form_13615_review_reason, null);
      });

      await t.test("sending a photo ID clears its reviewed pair", async () => {
        const member = await unclearedMember("mp_resend_photo", "Noel Baptiste");
        await setEntry(
          member,
          "is_new=true,photo_id_checked_at=null,photo_id_reviewed_at='2026-11-18T15:30:00Z',photo_id_review_reason='Expired'",
        );
        const { error } = await member.client.rpc("vitally_mark_upload_sent", {
          p_action_id: randomUUID(),
          p_document: "photoId",
        });
        assert.equal(error, null, `send: ${error?.code} ${error?.message}`);
        const entry = await entryOf(member);
        assert.ok(entry.photo_id_sent_at);
        assert.equal(entry.photo_id_reviewed_at, null);
        assert.equal(entry.photo_id_review_reason, null);
      });

      await t.test("the pair check refuses half a pair", async () => {
        const member = await unclearedMember("mp_half", "Pia Lindqvist");
        await assert.rejects(
          () => setEntry(member, "form_13615_review_reason='Not signed'"),
          (error) => (error.cause?.code ?? error.code) === CHECK_VIOLATION,
        );
        await assert.rejects(
          () => setEntry(member, "photo_id_reviewed_at=now()"),
          (error) => (error.cause?.code ?? error.code) === CHECK_VIOLATION,
        );
        await assert.rejects(
          () => setEntry(member, "form_13615_reviewed_at=now(),form_13615_review_reason='   '"),
          (error) => (error.cause?.code ?? error.code) === CHECK_VIOLATION,
        );
      });

      await t.test("usual_days refuses an unknown day", async () => {
        const member = await unclearedMember("mp_days", "Odell Marsh");
        const setDays = (days) =>
          f.sql("update public.volunteer_profiles set usual_days=$2 where workspace_id=$1 and person_id=$3", [
            f.workspaceId,
            days,
            member.personId,
          ]);
        await assert.rejects(
          () => setDays(["monday"]),
          (error) => (error.cause?.code ?? error.code) === CHECK_VIOLATION,
        );
        await assert.rejects(
          () => setDays(["mon", "mon"]),
          (error) => (error.cause?.code ?? error.code) === CHECK_VIOLATION,
        );
        await setDays(["mon", "sat"]);
      });
    } finally {
      await setLink(null);
    }
  } finally {
    await f.close();
  }
});
