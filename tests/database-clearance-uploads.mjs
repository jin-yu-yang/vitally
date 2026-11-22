import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";

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
        assert.deepEqual(result.missing, [{ kind: "form13615", sentAt: null, reviewedAt: null, reviewReason: null }]);
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
        assert.deepEqual(result.missing, [{ kind: "photoId", sentAt: null, reviewedAt: null, reviewReason: null }]);
        assert.deepEqual(result.capabilities, []);
      });

      await t.test("a past season's sent date is not reported", async () => {
        const member = await f.staff({ key: "upl_past", name: "Odell Marsh", capabilities: [], cleared: false });
        await f.sql(
          "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new,form_13615_sent_at) values($1,$2,$3,'{}',false,now())",
          [f.workspaceId, member.personId, season - 1],
        );
        const result = await myClearance(member.client);
        assert.deepEqual(result.missing, [{ kind: "form13615", sentAt: null, reviewedAt: null, reviewReason: null }]);
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

    await t.test("an action id used for form13615 is refused for photoId, with no extra receipt", async () => {
      const m = await unclearedMember("snd_reuse", "Dov Lancaster");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      const id = randomUUID();
      await sent(m.client, "form13615", id);
      const { error } = await send(m.client, "photoId", id);
      assert.equal(error?.code, "VT007");
      assert.equal(await f.receiptsFor(id), 1);
      assert.equal((await entryOf(m)).photo_id_sent_at, null);
    });

    await t.test("a retry after the photo ID was checked returns the stored answer", async () => {
      const m = await unclearedMember("snd_retry", "Edda Wolverton");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      const id = randomUUID();
      const one = await sent(m.client, "photoId", id);
      await setEntry(m, "photo_id_checked_at=now()");
      const two = await sent(m.client, "photoId", id);
      assert.deepEqual(two, one);
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

    // The shared lock order (Save, Mark reviewed, the send): the volunteer's
    // profile row, then the roster entry. Another connection holds the
    // profile; the send waits on it holding nothing of the entry, so a third
    // connection can still lock the entry at once.
    await t.test("the send locks the profile before the roster entry", async () => {
      const m = await unclearedMember("snd_lockorder", "Nell Quarrington");
      const holder = await openDatabase({ kind: "test" });
      const prober = await openDatabase({ kind: "test" });
      let open = false;
      try {
        await holder.query("begin");
        open = true;
        await holder.query(
          "select 1 from public.volunteer_profiles where workspace_id=$1 and person_id=$2 for update",
          [f.workspaceId, m.personId],
        );
        // A PostgREST builder is lazy: `then` sends it now.
        const pending = send(m.client, "form13615").then((answer) => answer);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i += 1) {
          waiting = (
            await f.sql(
              "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%vitally_mark_upload_sent%' and pid<>pg_backend_pid()) as w",
            )
          ).rows[0].w;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(waiting, true, "the send waits on the profile's row lock");
        await prober.query("begin");
        const probe = await prober
          .query(
            "select 1 from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3 for update nowait",
            [f.workspaceId, m.personId, season],
          )
          .then(
            () => null,
            (error) => error,
          );
        await prober.query("rollback");
        assert.equal(probe, null, `the entry is free while the send waits: ${probe?.code} ${probe?.message}`);
        await holder.query("commit");
        open = false;
        const { error } = await pending;
        assert.equal(error, null, `the send lands once the profile is free: ${error?.code}`);
        assert.ok((await entryOf(m)).form_13615_sent_at);
      } finally {
        if (open) await holder.query("rollback");
        await holder.end();
        await prober.end();
      }
    });
  } finally {
    await f.close();
  }
});

// Migration 053 §4 and §5: Save clears the sent dates it acts on (design D4),
// and vitally_mark_upload_reviewed clears one on an admin's say-so (design D3).
test("reviewing sent uploads against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const admin = await f.staff({
      key: "rev_admin",
      name: "Rhea Valdez",
      capabilities: ["admin"],
      siteCoordinator: true,
    });
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    const entryOf = async (m) =>
      (
        await f.sql("select * from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
          f.workspaceId,
          m.personId,
          season,
        ])
      ).rows[0];
    const setEntry = (m, set) =>
      f.sql(`update public.roster_entries set ${set} where workspace_id=$1 and person_id=$2 and season=$3`, [
        f.workspaceId,
        m.personId,
        season,
      ]);
    const certsOf = async (m) =>
      (
        await f.sql(
          "select certificate from public.certificates where workspace_id=$1 and person_id=$2 and season=$3 and status='confirmed' order by 1",
          [f.workspaceId, m.personId, season],
        )
      ).rows.map((r) => r.certificate);
    const revisionOf = async (m) =>
      Number((await f.sql("select revision from public.volunteer_profiles where person_id=$1", [m.personId])).rows[0].revision);
    const send = async (m, document) => {
      const { error } = await m.client.rpc("vitally_mark_upload_sent", { p_action_id: randomUUID(), p_document: document });
      assert.equal(error, null, `send ${document}: ${error?.code} ${error?.message}`);
    };
    const uncleared = (key, name) => f.staff({ key, name, capabilities: [], cleared: false });
    // Save as the admin with the stored state of the volunteer, plus `change`.
    const save = async (m, change = {}) => {
      const profile = (await f.sql("select * from public.volunteer_profiles where person_id=$1", [m.personId])).rows[0];
      const entry = await entryOf(m);
      const volunteer = {
        name: "Fictional Person",
        email: profile.email,
        phone: profile.phone,
        works: profile.works,
        languages: profile.languages,
        otherLanguage: profile.other_language,
        roles: entry.roles,
        certificates: await certsOf(m),
        isNew: entry.is_new,
        photoIdChecked: entry.photo_id_checked_at !== null,
        ...change,
      };
      const { data, error } = await admin.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: Number(profile.revision),
        p_volunteer: volunteer,
      });
      assert.equal(error, null, `save: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };
    const review = (m, document, { actionId = randomUUID(), revision, reason = "Not signed" } = {}) =>
      admin.client.rpc("vitally_mark_upload_reviewed", {
        p_action_id: actionId,
        p_volunteer_id: m.personId,
        p_expected_revision: revision,
        p_document: document,
        p_reason: reason,
      });
    const reviewed = async (m, document, opts) => {
      const revision = opts?.revision ?? (await revisionOf(m));
      const { data, error } = await review(m, document, { ...opts, revision });
      assert.equal(error, null, `review: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };

    await t.test("a role change clears the 13615 date", async () => {
      const m = await f.staff({ key: "rev_role", name: "Sol Abernathy", capabilities: ["prepare"] });
      await send(m, "form13615");
      assert.ok((await entryOf(m)).form_13615_sent_at);
      await save(m, { roles: ["greeter", "preparer"] });
      assert.equal((await entryOf(m)).form_13615_sent_at, null);
    });

    await t.test("a certificate change clears the 13615 date: tick VSC only", async () => {
      const m = await uncleared("rev_cert", "Tess Whitmore");
      await send(m, "form13615");
      await save(m, { certificates: ["vsc"] });
      assert.equal((await entryOf(m)).form_13615_sent_at, null);
    });

    await t.test("confirming an uploaded certificate clears it", async () => {
      const m = await uncleared("rev_uploaded", "Uri Danforth");
      await f.sql(
        "insert into public.certificates(workspace_id,person_id,season,certificate,status) values($1,$2,$3,'vsc','uploaded')",
        [f.workspaceId, m.personId, season],
      );
      await send(m, "form13615");
      await save(m, { certificates: ["vsc"] });
      assert.equal((await entryOf(m)).form_13615_sent_at, null);
      assert.deepEqual(await certsOf(m), ["vsc"]);
    });

    await t.test("reordering the roles keeps the 13615 date", async () => {
      const m = await uncleared("rev_order", "Ines Whitcombe");
      await f.sql(
        "insert into public.certificates(workspace_id,person_id,season,certificate,status,confirmed_at) values($1,$2,$3,'vsc','confirmed',now()),($1,$2,$3,'itqr','confirmed',now())",
        [f.workspaceId, m.personId, season],
      );
      await setEntry(m, "roles='{greeter,intaker}'");
      await send(m, "form13615");
      const before = (await entryOf(m)).form_13615_sent_at;
      assert.ok(before);
      await save(m, { roles: ["intaker", "greeter"] });
      assert.deepEqual((await entryOf(m)).form_13615_sent_at, before);
    });

    await t.test("a phone-only save keeps it", async () => {
      const m = await f.staff({ key: "rev_phone", name: "Vera Lindgren", capabilities: ["prepare"] });
      await send(m, "form13615");
      const before = (await entryOf(m)).form_13615_sent_at;
      await save(m, { phone: "555-0142" });
      assert.deepEqual((await entryOf(m)).form_13615_sent_at, before);
    });

    await t.test("ticking Photo ID checked clears the photo ID date", async () => {
      const m = await uncleared("rev_photo", "Wade Okonkwo");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      await send(m, "photoId");
      assert.ok((await entryOf(m)).photo_id_sent_at);
      await save(m, { isNew: true, photoIdChecked: true });
      const entry = await entryOf(m);
      assert.equal(entry.photo_id_sent_at, null);
      assert.ok(entry.photo_id_checked_at);
    });

    await t.test("unticking New volunteer clears the photo ID date", async () => {
      const m = await uncleared("rev_notnew", "Xena Fairbanks");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      await send(m, "photoId");
      await save(m, { isNew: false, photoIdChecked: false });
      assert.equal((await entryOf(m)).photo_id_sent_at, null);
    });

    await t.test("a save that keeps Photo ID checked keeps a later photo date", async () => {
      const m = await uncleared("rev_keep", "Yan Castellano");
      await setEntry(m, "is_new=true,photo_id_checked_at=now(),photo_id_sent_at='2026-11-18T15:30:00Z'");
      await save(m, { isNew: true, photoIdChecked: true, phone: "555-0143" });
      assert.equal((await entryOf(m)).photo_id_sent_at.getTime(), Date.parse("2026-11-18T15:30:00Z"));
    });

    await t.test("Mark reviewed clears the Form 13615 date and keeps roles and certificates", async () => {
      const m = await f.staff({ key: "rev_m13", name: "Zora Pemberton", capabilities: ["prepare"] });
      await send(m, "form13615");
      const rolesBefore = (await entryOf(m)).roles;
      const certsBefore = await certsOf(m);
      await reviewed(m, "form13615");
      const entry = await entryOf(m);
      assert.equal(entry.form_13615_sent_at, null);
      assert.deepEqual(entry.roles, rolesBefore);
      assert.deepEqual(await certsOf(m), certsBefore);
    });

    await t.test("Mark reviewed clears the photo ID date", async () => {
      const m = await uncleared("rev_mphoto", "Abel Rosenthal");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      await send(m, "photoId");
      await reviewed(m, "photoId");
      assert.equal((await entryOf(m)).photo_id_sent_at, null);
    });

    await t.test("Mark reviewed raises the revision", async () => {
      const m = await uncleared("rev_mrev", "Bryn Hollister");
      await send(m, "form13615");
      const before = await revisionOf(m);
      const answer = await reviewed(m, "form13615");
      assert.equal(answer.personId, m.personId);
      assert.equal(answer.revision, before + 1);
      assert.equal(await revisionOf(m), before + 1);
    });

    await t.test("Mark reviewed with nothing waiting succeeds and changes nothing", async () => {
      const m = await uncleared("rev_nothing", "Cade Whitlow");
      const before = await revisionOf(m);
      const answer = await reviewed(m, "form13615");
      assert.equal(answer.revision, before);
      assert.equal(await revisionOf(m), before);
    });

    await t.test("Mark reviewed stores the reason and time", async () => {
      const m = await uncleared("rev_reason", "Cora Eastwick");
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "Can't read it" });
      const entry = await entryOf(m);
      assert.equal(entry.form_13615_sent_at, null);
      assert.equal(entry.form_13615_review_reason, "Can't read it");
      assert.ok(Math.abs(entry.form_13615_reviewed_at.getTime() - Date.now()) < 60_000);
    });

    await t.test("Mark reviewed trims the reason", async () => {
      const m = await uncleared("rev_trim", "Dara Quillfeather");
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "  Wrong form  " });
      assert.equal((await entryOf(m)).form_13615_review_reason, "Wrong form");
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "\n\tNot signed\r\n" });
      assert.equal((await entryOf(m)).form_13615_review_reason, "Not signed");
    });

    await t.test("Mark reviewed with no reason is refused VALIDATION with no receipt", async () => {
      const m = await uncleared("rev_noreason", "Emil Strand");
      await send(m, "form13615");
      // Tabs and line breaks are blanks too, as in 049.
      for (const reason of [null, "   ", "\n\t"]) {
        const actionId = randomUUID();
        const { error } = await review(m, "form13615", { actionId, revision: await revisionOf(m), reason });
        assert.equal(error?.code, "VT007", `reason ${JSON.stringify(reason)}`);
        assert.ok((await entryOf(m)).form_13615_sent_at, "a refusal changes nothing");
        assert.equal(await f.receiptsFor(actionId), 0);
      }
    });

    await t.test("a 121-character reason is refused; 120 is accepted", async () => {
      const m = await uncleared("rev_long", "Fern Oyelaran");
      await send(m, "form13615");
      const { error } = await review(m, "form13615", { revision: await revisionOf(m), reason: "x".repeat(121) });
      assert.equal(error?.code, "VT007");
      assert.ok((await entryOf(m)).form_13615_sent_at);
      await reviewed(m, "form13615", { reason: "x".repeat(120) });
      assert.equal((await entryOf(m)).form_13615_review_reason, "x".repeat(120));
    });

    await t.test("nothing waiting keeps the first reason", async () => {
      const m = await uncleared("rev_first", "Gus Lindholm");
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "Not signed" });
      await reviewed(m, "form13615", { reason: "Wrong form" });
      assert.equal((await entryOf(m)).form_13615_review_reason, "Not signed");
    });

    await t.test("a non-admin with no reason is refused FORBIDDEN, not VALIDATION", async () => {
      const m = await uncleared("rev_forbid_noreason", "Hana Wexford");
      await send(m, "form13615");
      const { error } = await f.preparer.rpc("vitally_mark_upload_reviewed", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: await revisionOf(m),
        p_document: "form13615",
        p_reason: null,
      });
      assert.equal(error?.code, "VT001");
    });

    await t.test("the four-argument call is gone", async () => {
      const m = await uncleared("rev_four", "Ivo Castellane");
      await send(m, "form13615");
      const { error } = await admin.client.rpc("vitally_mark_upload_reviewed", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: await revisionOf(m),
        p_document: "form13615",
      });
      assert.equal(error?.code, "PGRST202");
    });

    await t.test("a role change clears the review pair", async () => {
      const m = await f.staff({ key: "rev_pair_role", name: "Joss Merriweather", capabilities: ["prepare"] });
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "Missing a certification" });
      assert.equal((await entryOf(m)).form_13615_review_reason, "Missing a certification");
      await save(m, { certificates: [...(await certsOf(m)), "advanced"] });
      const entry = await entryOf(m);
      assert.equal(entry.form_13615_reviewed_at, null);
      assert.equal(entry.form_13615_review_reason, null);
    });

    await t.test("Photo ID checked clears the photo review pair", async () => {
      const m = await uncleared("rev_pair_photo", "Kit Aldercott");
      await setEntry(m, "is_new=true,photo_id_checked_at=null");
      await send(m, "photoId");
      await reviewed(m, "photoId", { reason: "Expired" });
      assert.equal((await entryOf(m)).photo_id_review_reason, "Expired");
      await save(m, { isNew: true, photoIdChecked: true });
      const entry = await entryOf(m);
      assert.equal(entry.photo_id_reviewed_at, null);
      assert.equal(entry.photo_id_review_reason, null);
    });

    await t.test("a phone-only save keeps the review pair", async () => {
      const m = await uncleared("rev_pair_keep", "Lior Vandenberg");
      await send(m, "form13615");
      await reviewed(m, "form13615", { reason: "Not signed" });
      await save(m, { phone: "555-0144" });
      const entry = await entryOf(m);
      assert.ok(entry.form_13615_reviewed_at);
      assert.equal(entry.form_13615_review_reason, "Not signed");
    });

    await t.test("Mark reviewed with a stale revision is refused CONFLICT", async () => {
      const m = await uncleared("rev_stale", "Dina Marchetti");
      await send(m, "form13615");
      const stale = await revisionOf(m);
      await send(m, "form13615");
      await f.sql("update public.volunteer_profiles set revision=revision+1 where person_id=$1", [m.personId]);
      const actionId = randomUUID();
      const { error } = await review(m, "form13615", { actionId, revision: stale });
      assert.equal(error?.code, "VT003");
      assert.ok((await entryOf(m)).form_13615_sent_at, "a refusal changes nothing");
      assert.equal(await f.receiptsFor(actionId), 0);
    });

    await t.test("Mark reviewed for an unknown volunteer is refused NOT_FOUND", async () => {
      const { error } = await admin.client.rpc("vitally_mark_upload_reviewed", {
        p_action_id: randomUUID(),
        p_volunteer_id: randomUUID(),
        p_expected_revision: 1,
        p_document: "form13615",
        p_reason: "Not signed",
      });
      assert.equal(error?.code, "VT002");
    });

    await t.test("Mark reviewed by a non-admin is refused FORBIDDEN with no receipt", async () => {
      const m = await uncleared("rev_forbid", "Eli Thackeray");
      await send(m, "form13615");
      const actionId = randomUUID();
      const { error } = await f.preparer.rpc("vitally_mark_upload_reviewed", {
        p_action_id: actionId,
        p_volunteer_id: m.personId,
        p_expected_revision: await revisionOf(m),
        p_document: "form13615",
        p_reason: "Not signed",
      });
      assert.equal(error?.code, "VT001");
      assert.ok((await entryOf(m)).form_13615_sent_at);
      assert.equal(await f.receiptsFor(actionId), 0);
    });

    // Spec: a workspace admin marks reviewed cleared or not. The uncleared
    // admin is a site coordinator with no roles (as in the volunteer-roster tests).
    await t.test("an uncleared workspace admin may mark reviewed", async () => {
      const lead = await f.staff({
        key: "rev_uncleared_admin",
        name: "Gale Okonkwo",
        capabilities: [],
        cleared: false,
        siteCoordinator: true,
      });
      const { data: clearance, error: clearanceError } = await lead.client.rpc("vitally_my_clearance");
      assert.equal(clearanceError, null);
      assert.equal(clearance.cleared, false, "the admin is not cleared");
      assert.equal(clearance.isAdmin, true, "but is a workspace admin");
      const m = await uncleared("rev_by_uncleared", "Hollis Brennan");
      await send(m, "form13615");
      const before = await revisionOf(m);
      const { data, error } = await lead.client.rpc("vitally_mark_upload_reviewed", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: before,
        p_document: "form13615",
        p_reason: "Not signed",
      });
      assert.equal(error, null, `review: ${error?.code} ${error?.message} ${error?.details}`);
      assert.equal(data.personId, m.personId);
      assert.equal(data.revision, before + 1);
      assert.equal((await entryOf(m)).form_13615_sent_at, null);
    });

    await t.test("Mark reviewed with a repeated action id returns the same answer", async () => {
      const m = await uncleared("rev_replay", "Faye Underhill");
      await send(m, "form13615");
      const actionId = randomUUID();
      const revision = await revisionOf(m);
      const one = await reviewed(m, "form13615", { actionId, revision });
      const two = await reviewed(m, "form13615", { actionId, revision });
      assert.deepEqual(two, one);
      assert.equal(await f.receiptsFor(actionId), 1);
      assert.equal(await revisionOf(m), revision + 1);
    });

    await t.test("Mark reviewed with an unknown document is refused VALIDATION", async () => {
      const m = await uncleared("rev_unknown", "Gil Ashworth");
      const actionId = randomUUID();
      const { error } = await review(m, "w9", { actionId, revision: await revisionOf(m) });
      assert.equal(error?.code, "VT007");
      assert.equal(await f.receiptsFor(actionId), 0);
    });

    await t.test("a non-admin reads no roster entries", async () => {
      const { data, error } = await f.preparer.from("roster_entries").select("*");
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });

    await t.test("the count ignores other seasons", async () => {
      const m = await uncleared("rev_season", "Hale Ingram");
      await f.sql(
        "insert into public.roster_entries(workspace_id,person_id,season,roles,is_new,photo_id_sent_at) values($1,$2,$3,'{}',true,now())",
        [f.workspaceId, m.personId, season - 1],
      );
      const waiting = "form_13615_sent_at.not.is.null,photo_id_sent_at.not.is.null";
      const { count, error } = await admin.client
        .from("roster_entries")
        .select("person_id", { count: "exact", head: true })
        .eq("season", season)
        .or(waiting);
      assert.equal(error, null);
      const countWhere = async (extra, params) =>
        Number(
          (
            await f.sql(
              `select count(*) c from public.roster_entries where workspace_id=$1 and (form_13615_sent_at is not null or photo_id_sent_at is not null)${extra}`,
              [f.workspaceId, ...params],
            )
          ).rows[0].c,
        );
      const all = await countWhere("", []);
      const current = await countWhere(" and season=$2", [season]);
      assert.equal(count, current);
      assert.ok(all > current, "the past-season entry is in the table but not in the count");
    });
  } finally {
    await f.close();
  }
});
