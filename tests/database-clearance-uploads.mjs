import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-clearance-uploads (design D1, D5), migration 053: the
// sent dates on roster entries and the clearance answer's sentAt, uploadUrl and
// empty capabilities when uncleared. Spec: volunteer-clearance. Every row here
// belongs to the fixture's own workspace.

const LINK = "https://example.org/certificates";

test("vitally_my_clearance uploads against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const myClearance = async (client) => {
      const { data, error } = await client.rpc("vitally_my_clearance");
      assert.equal(error, null, `vitally_my_clearance: ${error?.code} ${error?.message}`);
      return data;
    };
    const setLink = (url) =>
      f.sql(
        "insert into public.season_settings(workspace_id,certificate_upload_url) values($1,$2) on conflict(workspace_id) do update set certificate_upload_url=excluded.certificate_upload_url",
        [f.workspaceId, url],
      );
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    // An uncleared member who does have a current-season entry (no roles).
    const withEmptyEntry = async (key, name) => {
      const member = await f.staff({ key, name, capabilities: [], cleared: false });
      await f.sql(
        "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new) values($1,$2,$3,'{}',false) on conflict do nothing",
        [f.workspaceId, member.personId, season],
      );
      return member;
    };

    try {
      await setLink(LINK);

      await t.test("an uncleared volunteer's items carry a null sentAt", async () => {
        const member = await f.staff({ key: "upl_none", name: "Ula Prentiss", capabilities: [], cleared: false });
        const result = await myClearance(member.client);
        assert.deepEqual(result.missing, [{ kind: "form13615", sentAt: null }]);
      });

      await t.test("a set sent date is reported", async () => {
        const member = await withEmptyEntry("upl_sent", "Sam Okafor");
        await f.sql(
          "update public.roster_entries set form_13615_sent_at='2026-11-18T15:30:00Z' where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, member.personId, season],
        );
        const result = await myClearance(member.client);
        assert.equal(result.missing[0].kind, "form13615");
        assert.equal(new Date(result.missing[0].sentAt).getTime(), Date.parse("2026-11-18T15:30:00Z"));
      });

      await t.test("uploadUrl is the certificate link for a rostered caller", async () => {
        const member = await withEmptyEntry("upl_link", "Lena Voss");
        assert.equal((await myClearance(member.client)).uploadUrl, LINK);
        const cleared = await f.staff({ key: "upl_cleared", name: "Cal Rivera", capabilities: ["prepare"] });
        const result = await myClearance(cleared.client);
        assert.equal(result.cleared, true);
        assert.equal(result.uploadUrl, LINK);
      });

      await t.test("uploadUrl is null with no link", async () => {
        const member = await withEmptyEntry("upl_nolink", "Mia Hartley");
        await setLink(null);
        try {
          assert.equal((await myClearance(member.client)).uploadUrl, null);
        } finally {
          await setLink(LINK);
        }
      });

      await t.test("uploadUrl is null with no current-season entry", async () => {
        const member = await f.staff({ key: "upl_noentry", name: "Noel Baptiste", capabilities: [], cleared: false });
        await f.sql("delete from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
          f.workspaceId,
          member.personId,
          season,
        ]);
        const result = await myClearance(member.client);
        assert.equal(result.uploadUrl, null);
      });

      await t.test("roles but not cleared reports no capabilities", async () => {
        const member = await f.staff({ key: "upl_photo", name: "Pia Lindqvist", capabilities: ["prepare"] });
        await f.sql(
          "update public.roster_entries set is_new=true,photo_id_checked_at=null where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, member.personId, season],
        );
        const result = await myClearance(member.client);
        assert.equal(result.cleared, false);
        assert.deepEqual(result.missing, [{ kind: "photoId", sentAt: null }]);
        assert.deepEqual(result.capabilities, []);
      });

      await t.test("a past season's sent date is not reported", async () => {
        const member = await f.staff({ key: "upl_past", name: "Odell Marsh", capabilities: [], cleared: false });
        await f.sql(
          "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new,form_13615_sent_at) values($1,$2,$3,'{}',false,now())",
          [f.workspaceId, member.personId, season - 1],
        );
        const result = await myClearance(member.client);
        assert.deepEqual(result.missing, [{ kind: "form13615", sentAt: null }]);
      });
    } finally {
      await setLink(null);
    }
  } finally {
    await f.close();
  }
});
