import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

// Migration 053 §3: vitally_mark_upload_sent, a volunteer marks their own
// document sent (design D2).
test("vitally_mark_upload_sent against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const send = (client, document, actionId = randomUUID()) =>
      client.rpc("vitally_mark_upload_sent", { p_action_id: actionId, p_document: document });
    const sent = async (client, document, actionId) => {
      const { data, error } = await send(client, document, actionId);
      assert.equal(error, null, `send ${document}: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };
    const refused = async (client, document, code, detail) => {
      const actionId = randomUUID();
      const { error } = await send(client, document, actionId);
      assert.ok(error, "expected a refusal");
      assert.equal(error.code, code, `${error.code} ${error.message} ${error.details}`);
      if (detail !== undefined) assert.equal(error.details, detail);
      assert.equal(await f.receiptsFor(actionId), 0, "a refusal stores no receipt");
    };
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    const entryOf = async (member) =>
      (
        await f.sql(
          "select * from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, member.personId, season],
        )
      ).rows[0];
    const setEntry = (member, set) =>
      f.sql(`update public.roster_entries set ${set} where workspace_id=$1 and person_id=$2 and season=$3`, [
        f.workspaceId,
        member.personId,
        season,
      ]);
    const revisionOf = async (member) =>
      Number(
        (await f.sql("select revision from public.volunteer_profiles where person_id=$1", [member.personId])).rows[0]
          .revision,
      );
    const unclearedMember = (key, name) => f.staff({ key, name, capabilities: [], cleared: false });
    const myClearance = async (client) => {
      const { data, error } = await client.rpc("vitally_my_clearance");
      assert.equal(error, null, `vitally_my_clearance: ${error?.code}`);
      return data;
    };

    await t.test("marks only the caller's own entry", async () => {
      const a = await unclearedMember("snd_a", "Ari Castellan");
      const b = await unclearedMember("snd_b", "Bea Tolliver");
      const answer = await sent(a.client, "form13615");
      assert.equal(answer.document, "form13615");
      assert.ok((await entryOf(a)).form_13615_sent_at);
      assert.equal((await entryOf(b)).form_13615_sent_at, null);
      assert.equal((await entryOf(a)).photo_id_sent_at, null);
    });

    await t.test("sending again updates the date", async () => {
      const m = await unclearedMember("snd_again", "Cory Delacroix");
      await sent(m.client, "form13615");
      const first = (await entryOf(m)).form_13615_sent_at;
      await sent(m.client, "form13615");
      assert.ok((await entryOf(m)).form_13615_sent_at > first);
    });

    await t.test("a repeated action id returns the same answer", async () => {
      const m = await unclearedMember("snd_replay", "Dara Whitlock");
      const id = randomUUID();
      const one = await sent(m.client, "form13615", id);
      const two = await sent(m.client, "form13615", id);
      assert.deepEqual(two, one);
      assert.equal((await entryOf(m)).form_13615_sent_at.getTime(), Date.parse(one.sentAt));
      assert.equal(await f.receiptsFor(id), 1);
    });

    await t.test("photoId is refused when the entry is not new", async () => {
      const m = await unclearedMember("snd_notnew", "Emil Farraday");
      await setEntry(m, "is_new=false,photo_id_checked_at=null");
      await refused(m.client, "photoId", "VT007", "PHOTO_ID_NOT_NEEDED");
      assert.equal((await entryOf(m)).photo_id_sent_at, null);
    });

    await t.test("photoId is refused when already checked", async () => {
      const m = await unclearedMember("snd_checked", "Fern Ostrander");
      await setEntry(m, "is_new=true,photo_id_checked_at=now()");
      await refused(m.client, "photoId", "VT007", "PHOTO_ID_NOT_NEEDED");
    });

    await t.test("photoId is accepted for a new unchecked entry and shows in vitally_my_clearance", async () => {
      const m = await unclearedMember("snd_photo", "Gus Hallward");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      const answer = await sent(m.client, "photoId");
      assert.equal(answer.document, "photoId");
      const stored = (await entryOf(m)).photo_id_sent_at;
      assert.equal(stored.getTime(), Date.parse(answer.sentAt));
      const item = (await myClearance(m.client)).missing.find((i) => i.kind === "photoId");
      assert.equal(new Date(item.sentAt).getTime(), stored.getTime());
    });

    await t.test("refused with no current-season entry", async () => {
      const m = await unclearedMember("snd_noentry", "Hana Lockridge");
      await f.sql("delete from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
        f.workspaceId,
        m.personId,
        season,
      ]);
      await refused(m.client, "form13615", "VT007", "NO_ROSTER_ENTRY");
    });

    await t.test("an unknown document is refused", async () => {
      const m = await unclearedMember("snd_unknown", "Ivo Brandt");
      await refused(m.client, "w9", "VT007");
    });

    await t.test("a client is refused", async () => {
      await refused(f.applicantA, "form13615", "VT001");
    });

    await t.test("a cleared caller may send a 13615", async () => {
      const m = await f.staff({ key: "snd_cleared", name: "Jory Kessler", capabilities: ["prepare"] });
      const answer = await sent(m.client, "form13615");
      assert.equal(answer.document, "form13615");
      assert.ok((await entryOf(m)).form_13615_sent_at);
    });

    await t.test("the send appears in vitally_my_clearance", async () => {
      const m = await unclearedMember("snd_appears", "Kai Montrose");
      const answer = await sent(m.client, "form13615");
      const item = (await myClearance(m.client)).missing.find((i) => i.kind === "form13615");
      assert.equal(new Date(item.sentAt).getTime(), Date.parse(answer.sentAt));
    });

    await t.test("the send raises the volunteer revision", async () => {
      const m = await unclearedMember("snd_revision", "Lia Penhallow");
      const before = await revisionOf(m);
      await sent(m.client, "form13615");
      assert.equal(await revisionOf(m), before + 1);
    });

    await t.test("an admin's stale save is refused", async () => {
      const m = await unclearedMember("snd_stale", "Milo Ashgrove");
      const stale = await revisionOf(m);
      await sent(m.client, "form13615");
      const { error } = await f.siteCoordinator.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: stale,
        p_volunteer: {
          name: "Milo Ashgrove",
          email: "milo.ashgrove@example.org",
          phone: null,
          works: "on_site",
          languages: ["english"],
          otherLanguage: null,
          roles: ["greeter"],
          certificates: [],
          isNew: false,
          photoIdChecked: false,
        },
      });
      assert.equal(error?.code, "VT003");
    });
  } finally {
    await f.close();
  }
});
