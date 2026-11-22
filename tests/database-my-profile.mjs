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

      await t.test("the pair check refuses a reviewed time with no reason", async () => {
        const member = await unclearedMember("mp_half_time", "Rhys Calloway");
        await assert.rejects(
          () => setEntry(member, "form_13615_reviewed_at=now()"),
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

// 057 §4: vitally_save_volunteer accepts usualDays (design D5).
test("usual days on the admin save", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const admin = await f.staff({
      key: "ud_admin",
      name: "Rhea Valdez",
      capabilities: ["admin"],
      siteCoordinator: true,
    });
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    const profileOf = async (m) =>
      (await f.sql("select * from public.volunteer_profiles where person_id=$1", [m.personId])).rows[0];
    const certsOf = async (m) =>
      (
        await f.sql(
          "select certificate from public.certificates where workspace_id=$1 and person_id=$2 and season=$3 and status='confirmed' order by 1",
          [f.workspaceId, m.personId, season],
        )
      ).rows.map((r) => r.certificate);
    // The ten keys of the stored state of the volunteer, plus `change`.
    const payload = async (m, change = {}) => {
      const profile = await profileOf(m);
      const entry = (
        await f.sql("select * from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
          f.workspaceId,
          m.personId,
          season,
        ])
      ).rows[0];
      return {
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
    };
    const save = async (m, change) =>
      admin.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: Number((await profileOf(m)).revision),
        p_volunteer: await payload(m, change),
      });
    const savedOk = async (m, change) => {
      const { error } = await save(m, change);
      assert.equal(error, null, `save: ${error?.code} ${error?.message} ${error?.details}`);
    };

    await t.test("usualDays are stored in week order", async () => {
      const m = await f.staff({ key: "ud_order", name: "Sol Abernathy", capabilities: ["prepare"] });
      await savedOk(m, { usualDays: ["sat", "tue"] });
      assert.deepEqual((await profileOf(m)).usual_days, ["tue", "sat"]);
    });

    await t.test("a save without usualDays keeps them", async () => {
      const m = await f.staff({ key: "ud_keep", name: "Tess Whitmore", capabilities: ["prepare"] });
      await f.sql("update public.volunteer_profiles set usual_days='{mon}' where person_id=$1", [m.personId]);
      await savedOk(m, {});
      assert.deepEqual((await profileOf(m)).usual_days, ["mon"]);
    });

    await t.test("a new volunteer added without usualDays has none", async () => {
      const { data, error } = await admin.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: {
          name: "Uri Danforth",
          email: `ud_new_${randomUUID().slice(0, 8)}@example.org`,
          phone: null,
          works: "remote",
          languages: ["english"],
          otherLanguage: null,
          roles: [],
          certificates: [],
          isNew: false,
          photoIdChecked: false,
        },
      });
      assert.equal(error, null, `add: ${error?.code} ${error?.message} ${error?.details}`);
      const { rows } = await f.sql("select usual_days from public.volunteer_profiles where person_id=$1", [data.personId]);
      assert.deepEqual(rows[0].usual_days, []);
    });

    await t.test("a new volunteer can be added with usualDays", async () => {
      const { data, error } = await admin.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: {
          name: "Vera Lindgren",
          email: `ud_new2_${randomUUID().slice(0, 8)}@example.org`,
          phone: null,
          works: "remote",
          languages: ["english"],
          otherLanguage: null,
          roles: [],
          certificates: [],
          isNew: false,
          photoIdChecked: false,
          usualDays: ["fri", "mon"],
        },
      });
      assert.equal(error, null, `add: ${error?.code} ${error?.message} ${error?.details}`);
      const { rows } = await f.sql("select usual_days from public.volunteer_profiles where person_id=$1", [data.personId]);
      assert.deepEqual(rows[0].usual_days, ["mon", "fri"]);
    });

    await t.test("an unknown or repeated day is refused", async () => {
      const m = await f.staff({ key: "ud_bad", name: "Wade Okonkwo", capabilities: ["prepare"] });
      await f.sql("update public.volunteer_profiles set usual_days='{wed}' where person_id=$1", [m.personId]);
      const before = await profileOf(m);
      for (const usualDays of [["monday"], ["mon", "mon"]]) {
        const { error } = await save(m, { usualDays });
        assert.equal(error?.code, "VT007", JSON.stringify(usualDays));
      }
      const after = await profileOf(m);
      assert.deepEqual(after.usual_days, ["wed"]);
      assert.equal(String(after.revision), String(before.revision));
    });

    await t.test("a name of only a line break is refused, and a padded one is trimmed", async () => {
      const m = await f.staff({ key: "ud_blank", name: "Tove Marchetti", capabilities: ["prepare"] });
      const before = await profileOf(m);
      for (const name of ["\n", "\t\r\n "]) {
        const { error } = await save(m, { name });
        assert.equal(error?.code, "VT007", JSON.stringify(name));
      }
      assert.equal(String((await profileOf(m)).revision), String(before.revision));
      await savedOk(m, { name: "\tTove Marchetti\n" });
      const { rows } = await f.sql("select name from public.people where id=$1", [m.personId]);
      assert.equal(rows[0].name, "Tove Marchetti");
    });

    await t.test("an eleventh unknown key is still refused", async () => {
      const m = await f.staff({ key: "ud_key", name: "Xena Fairbanks", capabilities: ["prepare"] });
      const { error } = await save(m, { colour: "x" });
      assert.equal(error?.code, "VT007");
    });

    await t.test("a non-admin reads no other profile's usual days", async () => {
      const other = await f.staff({ key: "ud_other", name: "Yan Castellano", capabilities: ["prepare"] });
      await f.sql("update public.volunteer_profiles set usual_days='{thu}' where person_id=$1", [other.personId]);
      const { data, error } = await f.preparer.from("volunteer_profiles").select("usual_days").eq("person_id", other.personId);
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });
  } finally {
    await f.close();
  }
});

// 057 §6-§7: the caller's own profile read and save (design D1, D2).
test("my profile RPCs against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = (
      await f.sql("select current_season from public.workspaces where id=$1", [f.workspaceId])
    ).rows[0];
    const admin = await f.staff({
      key: "mp_admin",
      name: "Rhea Valdez",
      capabilities: ["admin"],
      siteCoordinator: true,
    });
    const profileOf = async (m) =>
      (await f.sql("select * from public.volunteer_profiles where person_id=$1", [m.personId])).rows[0];
    const nameOf = async (m) => (await f.sql("select name from public.people where id=$1", [m.personId])).rows[0].name;
    const entryOf = async (m) =>
      (
        await f.sql("select * from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
          f.workspaceId,
          m.personId,
          season,
        ])
      ).rows[0];
    const certsOf = async (m) =>
      (
        await f.sql(
          "select certificate from public.certificates where workspace_id=$1 and person_id=$2 and season=$3 and status='confirmed' order by 1",
          [f.workspaceId, m.personId, season],
        )
      ).rows.map((r) => r.certificate);
    const receiptCount = async (m) =>
      Number(
        (
          await f.sql(
            "select count(*) as n from public.action_receipts where workspace_id=$1 and actor_user_id=$2 and operation='SAVE_MY_PROFILE'",
            [f.workspaceId, m.userId],
          )
        ).rows[0].n,
      );
    const preparer = (key, name) => f.staff({ key, name, capabilities: ["prepare"] });
    const read = async (m) => {
      const { data, error } = await m.client.rpc("vitally_my_profile");
      assert.equal(error, null, `vitally_my_profile: ${error?.code} ${error?.message}`);
      return data;
    };
    const profileFor = async (m, change = {}) => {
      const p = await profileOf(m);
      return {
        name: await nameOf(m),
        phone: p.phone,
        works: p.works,
        languages: p.languages,
        otherLanguage: p.other_language,
        usualDays: p.usual_days,
        ...change,
      };
    };
    const save = async (m, change = {}, { actionId = randomUUID(), revision } = {}) =>
      m.client.rpc("vitally_save_my_profile", {
        p_action_id: actionId,
        p_expected_revision: revision ?? Number((await profileOf(m)).revision),
        p_profile: await profileFor(m, change),
      });
    // The admin save of a volunteer, changing only the phone.
    const adminSave = async (m, phone, revision) => {
      const p = await profileOf(m);
      const entry = await entryOf(m);
      return admin.client.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: m.personId,
        p_expected_revision: revision ?? Number(p.revision),
        p_volunteer: {
          name: await nameOf(m),
          email: p.email,
          phone,
          works: p.works,
          languages: p.languages,
          otherLanguage: p.other_language,
          roles: entry.roles,
          certificates: await certsOf(m),
          isNew: entry.is_new,
          photoIdChecked: entry.photo_id_checked_at !== null,
        },
      });
    };
    const setLink = (url) =>
      f.sql(
        "insert into public.season_settings(workspace_id,certificate_upload_url) values($1,$2) on conflict(workspace_id) do update set certificate_upload_url=excluded.certificate_upload_url",
        [f.workspaceId, url],
      );

    try {
      await setLink(LINK);

      await t.test("a cleared Preparer reads their own profile", async () => {
        const m = await preparer("mp_read", "Ines Calloway");
        const profile = await read(m);
        assert.deepEqual(Object.keys(profile).sort(), [
          "accountStatus",
          "certificates",
          "email",
          "form13615",
          "languages",
          "name",
          "otherLanguage",
          "personId",
          "phone",
          "revision",
          "roles",
          "siteCoordinatorName",
          "uploadUrl",
          "usualDays",
          "works",
        ]);
        const stored = await profileOf(m);
        assert.equal(profile.personId, m.personId);
        assert.equal(profile.name, "Ines Calloway");
        assert.equal(profile.email, stored.email);
        assert.deepEqual(profile.roles, ["preparer"]);
        assert.deepEqual(profile.certificates, await certsOf(m));
        assert.equal(profile.accountStatus, "active");
        assert.deepEqual(profile.form13615, { sentAt: null, reviewedAt: null, reviewReason: null });
        assert.equal(String(profile.revision), String(stored.revision));
        assert.equal(profile.siteCoordinatorName, "Avery Lin");
      });

      await t.test("a came-back 13615 is reported", async () => {
        const m = await preparer("mp_back", "Joss Whitaker");
        await f.sql(
          "update public.roster_entries set form_13615_reviewed_at='2026-11-18T15:30:00Z',form_13615_review_reason='Already on file' where workspace_id=$1 and person_id=$2 and season=$3",
          [f.workspaceId, m.personId, season],
        );
        const { form13615 } = await read(m);
        assert.equal(form13615.sentAt, null);
        assert.equal(new Date(form13615.reviewedAt).getTime(), Date.parse("2026-11-18T15:30:00Z"));
        assert.equal(form13615.reviewReason, "Already on file");
      });

      const setStatus = (m, status) =>
        f.sql("update public.accounts set status=$3 where workspace_id=$1 and user_id=$2", [
          f.workspaceId,
          m.userId,
          status,
        ]);

      await t.test("vitally_my_profile refuses an invited account before the site check", async () => {
        const m = await preparer("mp_site", "Kirra Beaumont");
        await setStatus(m, "invited");
        try {
          const owed = await m.client.rpc("vitally_my_profile");
          assert.equal(owed.error?.code, "VT001");
          assert.equal(owed.error?.message, "FORBIDDEN");
        } finally {
          await setStatus(m, "active");
        }
        const open = await read(m);
        assert.equal(open.accountStatus, "active");
        assert.equal(open.uploadUrl, LINK);
      });

      await t.test("vitally_save_my_profile refuses an invited account before the site check (no receipt)", async () => {
        const m = await preparer("mp_site_save", "Ines Calloway");
        const before = await profileOf(m);
        const nameBefore = await nameOf(m);
        const receipts = await receiptCount(m);
        await setStatus(m, "invited");
        try {
          const saved = await save(m, { phone: "555-0199" });
          assert.equal(saved.error?.code, "VT001");
          assert.equal(saved.error?.message, "FORBIDDEN");
        } finally {
          await setStatus(m, "active");
        }
        assert.deepEqual(await profileOf(m), before);
        assert.equal(await nameOf(m), nameBefore);
        assert.equal(await receiptCount(m), receipts);
      });

      await t.test("a client is refused FORBIDDEN, and the save stores no receipt", async () => {
        const profile = await f.applicantA.rpc("vitally_my_profile");
        assert.equal(profile.error?.code, "VT001");
        assert.equal(profile.error?.message, "FORBIDDEN");
        const before = await receiptCount({ userId: f.applicantAUserId });
        const saved = await f.applicantA.rpc("vitally_save_my_profile", {
          p_action_id: randomUUID(),
          p_expected_revision: 1,
          p_profile: {
            name: "Nobody Atall",
            phone: null,
            works: "remote",
            languages: ["english"],
            otherLanguage: null,
            usualDays: [],
          },
        });
        assert.equal(saved.error?.code, "VT001");
        assert.equal(saved.error?.message, "FORBIDDEN");
        assert.equal(await receiptCount({ userId: f.applicantAUserId }), before);
      });

      await t.test("a staff member with no volunteer profile is refused FORBIDDEN, and the save stores no receipt", async () => {
        const m = await preparer("mp_noprofile", "Orla Hendry");
        const row = (await f.sql("select to_jsonb(v) as r from public.volunteer_profiles v where person_id=$1", [m.personId]))
          .rows[0].r;
        const receiptsBefore = await receiptCount(m);
        const profile = await f.sql("delete from public.volunteer_profiles where person_id=$1", [m.personId]);
        assert.equal(profile.rowCount, 1);
        try {
          const read = await m.client.rpc("vitally_my_profile");
          assert.equal(read.error?.code, "VT001");
          assert.equal(read.error?.message, "FORBIDDEN");
          const saved = await m.client.rpc("vitally_save_my_profile", {
            p_action_id: randomUUID(),
            p_expected_revision: 1,
            p_profile: {
              name: "Nobody Atall",
              phone: null,
              works: "remote",
              languages: ["english"],
              otherLanguage: null,
              usualDays: [],
            },
          });
          assert.equal(saved.error?.code, "VT001");
          assert.equal(saved.error?.message, "FORBIDDEN");
          assert.equal(await receiptCount(m), receiptsBefore);
        } finally {
          await f.sql("insert into public.volunteer_profiles select * from jsonb_populate_record(null::public.volunteer_profiles, $1::jsonb)", [
            JSON.stringify(row),
          ]);
        }
        assert.equal((await profileOf(m)).email, row.email);
      });

      await t.test("saving details writes only the caller", async () => {
        const m = await preparer("mp_save", "Lowell Ashby");
        const other = await preparer("mp_save_other", "Maren Doyle");
        const otherBefore = await profileOf(other);
        const otherName = await nameOf(other);
        const before = await profileOf(m);
        const entryBefore = await entryOf(m);
        const certsBefore = await certsOf(m);
        const { data, error } = await save(m, {
          name: "Fictional Preparer",
          phone: "555-0142",
          languages: ["english", "cantonese"],
          usualDays: ["sat", "mon"],
        });
        assert.equal(error, null, `save: ${error?.code} ${error?.message} ${error?.details}`);
        assert.equal(data.personId, m.personId);
        assert.equal(String(data.revision), String(BigInt(before.revision) + 1n));
        const profile = await read(m);
        assert.equal(profile.name, "Fictional Preparer");
        assert.equal(profile.phone, "555-0142");
        assert.deepEqual(profile.languages, ["english", "cantonese"]);
        assert.deepEqual(profile.usualDays, ["mon", "sat"]);
        assert.equal(await nameOf(m), "Fictional Preparer");
        assert.equal(String(profile.revision), String(data.revision));
        assert.equal(profile.email, before.email);
        assert.deepEqual(profile.roles, entryBefore.roles);
        assert.deepEqual(await certsOf(m), certsBefore);
        assert.deepEqual(await entryOf(m), entryBefore);
        assert.deepEqual(await profileOf(other), otherBefore);
        assert.equal(await nameOf(other), otherName);
      });

      await t.test("another key is refused", async () => {
        const m = await preparer("mp_keys", "Neve Sorensen");
        const before = await profileOf(m);
        for (const extra of [{ email: "new@example.org" }, { roles: ["admin"] }]) {
          const { error } = await save(m, extra);
          assert.equal(error?.code, "VT007", JSON.stringify(extra));
        }
        const after = await profileOf(m);
        assert.equal(String(after.revision), String(before.revision));
        assert.equal(after.email, before.email);
      });

      await t.test("invalid fields are refused", async () => {
        const m = await preparer("mp_bad", "Osei Brandt");
        const before = await profileOf(m);
        const cases = [
          { name: "x".repeat(81) },
          { name: "   " },
          // Tabs and line breaks are blanks too, as in 049.
          { name: "\n" },
          { name: "\t\r\n" },
          { works: "sometimes" },
          { otherLanguage: "Welsh" },
          { languages: ["other"], otherLanguage: null },
          { languages: ["english", "english"] },
          { phone: "5".repeat(31) },
          { usualDays: ["monday"] },
          { usualDays: ["mon", "mon"] },
        ];
        for (const change of cases) {
          const { error } = await save(m, change);
          assert.equal(error?.code, "VT007", JSON.stringify(change));
        }
        assert.equal(String((await profileOf(m)).revision), String(before.revision));
        assert.equal(await receiptCount(m), 0);
      });

      await t.test("a volunteer's stale save is refused and the admin's phone stays", async () => {
        const m = await preparer("mp_stale_v", "Pru Lindqvist");
        const stale = Number((await profileOf(m)).revision);
        const { error: adminError } = await adminSave(m, "555-0199");
        assert.equal(adminError, null, `admin save: ${adminError?.code} ${adminError?.message} ${adminError?.details}`);
        const { error } = await save(m, { phone: "555-0100" }, { revision: stale });
        assert.equal(error?.code, "VT003");
        assert.equal((await profileOf(m)).phone, "555-0199");
      });

      await t.test("an admin's stale save is refused", async () => {
        const m = await preparer("mp_stale_a", "Quill Harrow");
        const stale = Number((await profileOf(m)).revision);
        const { error: saveError } = await save(m, { phone: "555-0123" });
        assert.equal(saveError, null);
        const { error } = await adminSave(m, "555-0188", stale);
        assert.equal(error?.code, "VT003");
        assert.equal((await profileOf(m)).phone, "555-0123");
      });

      await t.test("a repeated action id returns the same answer and raises the revision once", async () => {
        const m = await preparer("mp_repeat", "Rafe Tolliver");
        const before = Number((await profileOf(m)).revision);
        const actionId = randomUUID();
        const first = await save(m, { phone: "555-0155" }, { actionId, revision: before });
        assert.equal(first.error, null);
        const second = await save(m, { phone: "555-0155" }, { actionId, revision: before });
        assert.equal(second.error, null, `repeat: ${second.error?.code} ${second.error?.message}`);
        assert.deepEqual(second.data, first.data);
        assert.equal(Number((await profileOf(m)).revision), before + 1);
        assert.equal(await receiptCount(m), 1);
      });

      await t.test("no action id or no revision is refused VALIDATION", async () => {
        const m = await preparer("mp_missing", "Sunniva Kerr");
        const before = await profileOf(m);
        const profile = await profileFor(m);
        const noAction = await m.client.rpc("vitally_save_my_profile", {
          p_action_id: null,
          p_expected_revision: Number(before.revision),
          p_profile: profile,
        });
        assert.equal(noAction.error?.code, "VT007");
        const noRevision = await m.client.rpc("vitally_save_my_profile", {
          p_action_id: randomUUID(),
          p_expected_revision: null,
          p_profile: profile,
        });
        assert.equal(noRevision.error?.code, "VT007");
        assert.equal(String((await profileOf(m)).revision), String(before.revision));
        assert.equal(await receiptCount(m), 0);
      });
    } finally {
      await setLink(null);
    }
  } finally {
    await f.close();
  }
});
