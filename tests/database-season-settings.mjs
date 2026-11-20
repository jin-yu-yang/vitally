import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture, TEST_SITE_NUMBER } from "./support/database-fixture.mjs";

// OpenSpec change add-season-settings (design D5), migration 052: the Season
// settings row (one per workspace, kept across seasons), its read for a
// workspace admin, the links save and the SIDN save for a site coordinator.
// Specs: season-settings, site-coordinators ("The Site coordinators card lists
// them, with history"). The file shares one fixture; every staff member below
// has a person key of their own, and every assertion reads this fixture
// workspace's rows only. The fixture's site number is restored at the end.

const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const FORBIDDEN = "VT001";
const CONFLICT = "VT003";
const VALIDATION = "VT007";
const HTTPS_MESSAGE_FIELDS = ["certificateUploadUrl", "clientDocumentsUrl"];

test("Season settings against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const { current_season: season } = await one(
      f,
      "select current_season from public.workspaces where id=$1",
      [f.workspaceId],
    );
    const sc = f.siteCoordinator;
    const rpc = async (client, fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      assert.equal(error, null, `${fn}: ${error?.code} ${error?.message} ${error?.details}`);
      return data;
    };
    const read = (client = sc) => rpc(client, "vitally_season_settings");
    const row = () =>
      one(
        f,
        `select certificate_upload_url,client_documents_url,revision::int as revision,updated_by_person_id
          from public.season_settings where workspace_id=$1`,
        [f.workspaceId],
      );
    const saveArgs = (revision, settings, actionId = randomUUID()) => ({
      p_action_id: actionId,
      p_expected_revision: revision,
      p_settings: settings,
    });
    const currentRevision = async () => (await row())?.revision ?? 0;
    const save = async (settings, client = sc) =>
      rpc(client, "vitally_save_season_settings", saveArgs(await currentRevision(), settings));
    const siteNumber = async () =>
      (await one(f, "select sidn,updated_at from vitally_private.site_numbers where workspace_id=$1", [f.workspaceId])) ??
      null;
    // A refusal: the SQLSTATE, the message or detail, and no receipt stored.
    const refused = async (client, fn, args, code, { message, detail } = {}, label = fn) => {
      const { error } = await client.rpc(fn, args);
      assert.equal(error?.code, code, `${label}: ${error?.code} ${error?.message} ${error?.details}`);
      if (message !== undefined) assert.equal(error.message, message, `${label} message`);
      if (detail !== undefined) assert.equal(error.details, detail, `${label} detail`);
      if (args?.p_action_id) assert.equal(await f.receiptsFor(args.p_action_id), 0, `${label} receipt`);
      return error;
    };
    const SETTINGS_KEYS = ["certificateUploadUrl", "clientDocumentsUrl", "revision", "season"];
    const READ_KEYS = [...SETTINGS_KEYS, "canEdit", "candidates", "history", "siteCoordinators", "siteNumber"];

    // A workspace admin by the Admin role who is not a site coordinator.
    const nadia = await f.staff({
      key: "nadia_settings",
      name: "Nadia Brennan",
      capabilities: ["admin", "assist", "followup", "receive_documents"],
    });

    try {
      await t.test("an absent row reads as nulls at revision 0", async () => {
        assert.equal(await row(), undefined, "no row yet");
        const answer = await read();
        assert.deepEqual(Object.keys(answer).sort(), [...READ_KEYS].sort());
        assert.equal(answer.season, season);
        assert.equal(answer.certificateUploadUrl, null);
        assert.equal(answer.clientDocumentsUrl, null);
        assert.equal(answer.revision, 0);
        assert.equal(answer.canEdit, true);
        assert.deepEqual(Object.keys(answer.siteNumber).sort(), ["set", "updatedAt"]);
        assert.equal(answer.siteNumber.set, true, "the fixture sets a site number");
        assert.ok(!Number.isNaN(Date.parse(answer.siteNumber.updatedAt)), "the update time");
      });

      await t.test("a workspace admin who is not a site coordinator reads without canEdit", async () => {
        const answer = await read(nadia.client);
        assert.equal(answer.canEdit, false);
        assert.equal(answer.season, season);
      });

      await t.test("refusal: anyone but a workspace admin cannot read", async () => {
        await refused(f.preparer, "vitally_season_settings", {}, FORBIDDEN, { message: "FORBIDDEN" }, "preparer");
        await refused(f.applicantA, "vitally_season_settings", {}, FORBIDDEN, { message: "FORBIDDEN" }, "applicant");
      });

      await t.test("saving the links", async () => {
        const answer = await save({
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "https://example.org/client-documents",
        });
        assert.deepEqual(answer, {
          season,
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "https://example.org/client-documents",
          revision: 1,
        });
        assert.deepEqual(await row(), {
          certificate_upload_url: "https://example.org/certificates",
          client_documents_url: "https://example.org/client-documents",
          revision: 1,
          updated_by_person_id: f.siteCoordinatorId,
        });
        const reread = await read();
        assert.equal(reread.certificateUploadUrl, "https://example.org/certificates");
        assert.equal(reread.clientDocumentsUrl, "https://example.org/client-documents");
        assert.equal(reread.revision, 1);
        // Another workspace admin reads the same values.
        const other = await read(nadia.client);
        assert.equal(other.certificateUploadUrl, "https://example.org/certificates");
      });

      await t.test("links trim and accept HTTPS", async () => {
        const answer = await save({
          certificateUploadUrl: "  HTTPS://Example.org/Certificates\t",
          clientDocumentsUrl: "\nhttps://example.org/client-documents ",
        });
        assert.equal(answer.certificateUploadUrl, "HTTPS://Example.org/Certificates");
        assert.equal(answer.clientDocumentsUrl, "https://example.org/client-documents");
        const stored = await row();
        assert.equal(stored.certificate_upload_url, "HTTPS://Example.org/Certificates");
        // 500 characters after trimming is the most.
        const longest = `https://example.org/${"a".repeat(480)}`;
        assert.equal(longest.length, 500);
        const kept = await save({ certificateUploadUrl: ` ${longest} `, clientDocumentsUrl: null });
        assert.equal(kept.certificateUploadUrl, longest);
        assert.equal(kept.clientDocumentsUrl, null);
      });

      await t.test("refusal: a link that isn't https names its field and stores nothing", async () => {
        const before = await row();
        const bad = [
          "http://example.org/certificates",
          "https://example.org/with space",
          "https://",
          "example.org",
          "ftp://example.org",
          `https://example.org/${"a".repeat(481)}`,
          42,
          { url: "https://example.org" },
        ];
        for (const field of HTTPS_MESSAGE_FIELDS)
          for (const value of bad) {
            const settings = {
              certificateUploadUrl: "https://example.org/certificates",
              clientDocumentsUrl: "https://example.org/client-documents",
              [field]: value,
            };
            await refused(
              sc,
              "vitally_save_season_settings",
              saveArgs(before.revision, settings),
              VALIDATION,
              { message: "VALIDATION", detail: field },
              `${field} ${JSON.stringify(value)}`,
            );
          }
        assert.deepEqual(await row(), before, "nothing stored");
        // Missing arguments.
        await refused(sc, "vitally_save_season_settings", saveArgs(before.revision, null), VALIDATION, {}, "null settings");
        await refused(sc, "vitally_save_season_settings", saveArgs(before.revision, []), VALIDATION, {}, "array settings");
        await refused(sc, "vitally_save_season_settings", saveArgs(null, {}), VALIDATION, {}, "null revision");
        assert.deepEqual(await row(), before, "nothing stored");
      });

      await t.test("clearing a link", async () => {
        await save({
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "https://example.org/client-documents",
        });
        const answer = await save({
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "   ",
        });
        assert.equal(answer.clientDocumentsUrl, null);
        assert.equal((await row()).client_documents_url, null);
        // A field left out is stored as empty too.
        const cleared = await save({});
        assert.equal(cleared.certificateUploadUrl, null);
        assert.equal(cleared.clientDocumentsUrl, null);
        await save({
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "https://example.org/client-documents",
        });
      });

      await t.test("two site coordinators save: the second gets CONFLICT", async () => {
        const second = await f.staff({
          key: "sid_second",
          name: "Sidney Okafor",
          capabilities: ["admin", "assist", "followup", "receive_documents"],
          siteCoordinator: true,
        });
        try {
          const opened = (await read(second.client)).revision;
          assert.equal((await read()).revision, opened);
          await save({ certificateUploadUrl: "https://example.org/first", clientDocumentsUrl: null });
          const before = await row();
          await refused(
            second.client,
            "vitally_save_season_settings",
            saveArgs(opened, { certificateUploadUrl: "https://example.org/second" }),
            CONFLICT,
            { message: "CONFLICT" },
          );
          assert.deepEqual(await row(), before);
          // A save with revision 0 once the row exists is a conflict as well.
          await refused(sc, "vitally_save_season_settings", saveArgs(0, {}), CONFLICT, {}, "revision 0");
          // Read again, then save.
          const fresh = await read(second.client);
          const answer = await rpc(
            second.client,
            "vitally_save_season_settings",
            saveArgs(fresh.revision, {
              certificateUploadUrl: "https://example.org/certificates",
              clientDocumentsUrl: "https://example.org/client-documents",
            }),
          );
          assert.equal(answer.revision, fresh.revision + 1);
          assert.equal((await row()).updated_by_person_id, second.personId);
        } finally {
          await rpc(sc, "vitally_set_site_coordinator", {
            p_action_id: randomUUID(),
            p_volunteer_id: second.personId,
            p_expected_revision: (
              await one(f, "select revision::int as revision from public.accounts where workspace_id=$1 and person_id=$2", [
                f.workspaceId,
                second.personId,
              ])
            ).revision,
            p_granted: false,
          });
        }
      });

      await t.test("a repeated save returns the stored result and raises the revision once", async () => {
        const start = await row();
        const args = saveArgs(start.revision, {
          certificateUploadUrl: "https://example.org/repeat",
          clientDocumentsUrl: "https://example.org/client-documents",
        });
        const first = await rpc(sc, "vitally_save_season_settings", args);
        const again = await rpc(sc, "vitally_save_season_settings", args);
        assert.deepEqual(again, first);
        assert.equal((await row()).revision, start.revision + 1);
        assert.equal(await f.receiptsFor(args.p_action_id), 1);
        // The same action id with another request is refused.
        const { error } = await sc.rpc("vitally_save_season_settings", {
          ...args,
          p_settings: { certificateUploadUrl: "https://example.org/other" },
        });
        assert.equal(error?.code, VALIDATION);
        assert.equal((await row()).certificate_upload_url, "https://example.org/repeat");
        await save({
          certificateUploadUrl: "https://example.org/certificates",
          clientDocumentsUrl: "https://example.org/client-documents",
        });
      });

      await t.test("refusal: an admin who is not a site coordinator saves links", async () => {
        const before = await row();
        await refused(
          nadia.client,
          "vitally_save_season_settings",
          saveArgs(before.revision, { certificateUploadUrl: "https://example.org/nadia" }),
          FORBIDDEN,
          { message: "FORBIDDEN" },
        );
        // FORBIDDEN comes before any other check.
        await refused(nadia.client, "vitally_save_season_settings", saveArgs(null, null), FORBIDDEN, {}, "before validation");
        await refused(
          f.preparer,
          "vitally_save_season_settings",
          saveArgs(before.revision, {}),
          FORBIDDEN,
          {},
          "preparer",
        );
        assert.deepEqual(await row(), before);
      });

      await t.test("links survive a season change", async () => {
        const stored = await row();
        await f.sql("begin");
        try {
          await f.sql("update public.workspaces set current_season=current_season+1 where id=$1", [f.workspaceId]);
          await f.sql("select set_config('request.jwt.claims',$1,true)", [
            JSON.stringify({ sub: f.siteCoordinatorUserId, role: "authenticated" }),
          ]);
          await f.sql("set local role authenticated");
          const { answer } = await one(f, "select public.vitally_season_settings() as answer");
          assert.equal(answer.season, season + 1);
          assert.equal(answer.certificateUploadUrl, stored.certificate_upload_url);
          assert.equal(answer.clientDocumentsUrl, stored.client_documents_url);
          assert.equal(answer.revision, stored.revision);
        } finally {
          await f.sql("rollback");
        }
        assert.equal((await read()).season, season);
      });

      await t.test("no direct access to the stored settings", async () => {
        const { rows } = await f.sql(
          `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
            where has_table_privilege('authenticated','public.season_settings',p)
               or has_table_privilege('anon','public.season_settings',p)`,
        );
        assert.deepEqual(rows, []);
        const { rows: security } = await f.sql(
          "select relrowsecurity from pg_class where oid='public.season_settings'::regclass",
        );
        assert.equal(security[0].relrowsecurity, true);
        const before = await row();
        const selected = await sc.from("season_settings").select("*").eq("workspace_id", f.workspaceId);
        assert.ok(selected.error || selected.data.length === 0, "read returns nothing or is refused");
        const updated = await sc
          .from("season_settings")
          .update({ certificate_upload_url: "https://example.org/direct" })
          .eq("workspace_id", f.workspaceId);
        assert.ok(updated.error, "update refused");
        const inserted = await sc.from("season_settings").insert({ workspace_id: f.workspaceId });
        assert.ok(inserted.error, "insert refused");
        const deleted = await sc.from("season_settings").delete().eq("workspace_id", f.workspaceId);
        assert.ok(deleted.error, "delete refused");
        assert.deepEqual(await row(), before);
      });

      // ---- The SIDN ---------------------------------------------------------
      const sidnArgs = (sidn, actionId = randomUUID()) => ({ p_action_id: actionId, p_sidn: sidn });

      await t.test("refusal: a malformed SIDN", async () => {
        const before = await siteNumber();
        for (const sidn of ["S1234", "S123456789", "12345678", "T12345678", "S1234567X", "", null])
          await refused(
            sc,
            "vitally_set_site_number",
            sidnArgs(sidn),
            VALIDATION,
            { message: "VALIDATION", detail: "SIDN_FORMAT" },
            `SIDN ${JSON.stringify(sidn)}`,
          );
        assert.deepEqual(await siteNumber(), before);
      });

      await t.test("refusal: an admin who is not a site coordinator sets the SIDN", async () => {
        const before = await siteNumber();
        await refused(nadia.client, "vitally_set_site_number", sidnArgs("S12345678"), FORBIDDEN, { message: "FORBIDDEN" });
        await refused(nadia.client, "vitally_set_site_number", sidnArgs("bad"), FORBIDDEN, {}, "before validation");
        await refused(f.preparer, "vitally_set_site_number", sidnArgs("S12345678"), FORBIDDEN, {}, "preparer");
        assert.deepEqual(await siteNumber(), before);
      });

      await t.test("setting the SIDN; the site check passes with it; no answer contains it", async () => {
        const before = await siteNumber();
        const actionId = randomUUID();
        const answer = await rpc(sc, "vitally_set_site_number", sidnArgs("s1234-5678", actionId));
        assert.deepEqual(Object.keys(answer).sort(), ["set", "updatedAt"]);
        assert.equal(answer.set, true);
        const stored = await siteNumber();
        assert.equal(stored.sidn, "S12345678");
        assert.ok(stored.updated_at >= before.updated_at, "the update time moves");
        assert.equal(Date.parse(answer.updatedAt), stored.updated_at.getTime());
        // A replay returns the stored answer and writes nothing more.
        assert.deepEqual(await rpc(sc, "vitally_set_site_number", sidnArgs("s1234-5678", actionId)), answer);
        assert.equal(await f.receiptsFor(actionId), 1);
        assert.equal((await siteNumber()).updated_at.getTime(), stored.updated_at.getTime());
        const reread = await read();
        assert.deepEqual(reread.siteNumber, { set: true, updatedAt: answer.updatedAt });

        // An invited volunteer who enters S12345678 at the site check passes it.
        const user = await f.provision();
        const { personId } = await rpc(sc, "vitally_save_volunteer", {
          p_action_id: randomUUID(),
          p_volunteer_id: null,
          p_expected_revision: null,
          p_volunteer: {
            name: "Marisol Quinlan", email: user.email.toLowerCase(), phone: null, works: "on_site",
            languages: ["english"], otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
          },
        });
        await rpc(sc, "vitally_record_account", {
          p_action_id: randomUUID(),
          p_op: "create",
          p_target: { volunteerId: personId },
          p_user_id: user.userId,
        });
        const checked = await rpc(user.client, "vitally_complete_site_check", {
          p_name: "Marisol Quinlan",
          p_sidn: "S12345678",
        });
        assert.equal(checked.status, "active");

        // No answer, and no row the site coordinator or another admin can
        // read, contains the number.
        const answers = [
          reread,
          await read(nadia.client),
          answer,
          await rpc(sc, "vitally_my_clearance"),
          await rpc(nadia.client, "vitally_my_clearance"),
          await rpc(user.client, "vitally_my_clearance"),
          checked,
        ];
        for (const client of [sc, nadia.client])
          for (const [table, column] of [
            ["accounts", "workspace_id"],
            ["workspaces", "id"],
            ["people", "workspace_id"],
            ["volunteer_profiles", "workspace_id"],
            ["season_settings", "workspace_id"],
          ]) {
            const { data, error } = await client.from(table).select("*").eq(column, f.workspaceId);
            answers.push(error ? { table, refused: error.code } : { table, data });
            if (table !== "season_settings") assert.equal(error, null, `${table} read`);
          }
        const text = JSON.stringify(answers);
        assert.ok(!text.includes("12345678"), "no answer contains the SIDN");
      });

      await t.test("the SIDN save is execute-granted to signed-in users only", async () => {
        const { rows } = await f.sql(
          `select r.role, has_function_privilege(r.role, p.oid, 'execute') as ok
             from pg_proc p cross join (values ('authenticated'),('anon'),('service_role')) r(role)
            where p.oid = any(array['public.vitally_season_settings()'::regprocedure,
              'public.vitally_save_season_settings(uuid,bigint,jsonb)'::regprocedure,
              'public.vitally_set_site_number(uuid,text)'::regprocedure])`,
        );
        assert.equal(rows.length, 9);
        for (const entry of rows) assert.equal(entry.ok, entry.role === "authenticated", entry.role);
      });

      // ---- The Site coordinators card ----------------------------------------
      await t.test("the list, the candidates and the history", async () => {
        const rio = await f.staff({
          key: "rio_offroster",
          name: "Rio Castellanos",
          capabilities: [],
          cleared: false,
          siteCoordinator: true,
        });
        const pat = await f.staff({ key: "pat_candidate", name: "Pat Delacroix", capabilities: ["prepare"] });
        try {
          // Rio has no current-season roster entry.
          await f.sql("delete from public.roster_entries where workspace_id=$1 and person_id=$2 and season=$3", [
            f.workspaceId,
            rio.personId,
            season,
          ]);
          const answer = await read(nadia.client);
          const byId = Object.fromEntries(answer.siteCoordinators.map((entry) => [entry.volunteerId, entry]));
          for (const entry of answer.siteCoordinators)
            assert.deepEqual(
              Object.keys(entry).sort(),
              ["accountRevision", "email", "name", "onRoster", "since", "volunteerId"],
            );
          const avery = byId[f.siteCoordinatorId];
          assert.equal(avery.name, "Avery Lin");
          assert.equal(avery.email, f.roleAccounts.siteCoordinator.email.toLowerCase());
          assert.equal(avery.onRoster, true);
          const rioEntry = byId[rio.personId];
          assert.equal(rioEntry.name, "Rio Castellanos");
          assert.equal(rioEntry.email, rio.email.toLowerCase());
          assert.equal(rioEntry.onRoster, false);
          const { latest } = await one(
            f,
            `select max(changed_at) as latest from public.site_coordinator_changes
              where workspace_id=$1 and person_id=$2 and granted`,
            [f.workspaceId, rio.personId],
          );
          assert.equal(Date.parse(rioEntry.since), latest.getTime());
          const { revision } = await one(
            f,
            "select revision::int as revision from public.accounts where workspace_id=$1 and person_id=$2",
            [f.workspaceId, rio.personId],
          );
          assert.equal(rioEntry.accountRevision, revision);
          assert.ok(!byId[nadia.personId], "an admin by role is not listed");

          // Candidates: active staff accounts who are not site coordinators.
          // Each carries its account revision, which the grant needs.
          for (const entry of answer.candidates)
            assert.deepEqual(Object.keys(entry).sort(), ["accountRevision", "name", "volunteerId"]);
          const patCandidate = answer.candidates.find((entry) => entry.volunteerId === pat.personId);
          const { revision: patRevision } = await one(
            f,
            "select revision::int as revision from public.accounts where workspace_id=$1 and person_id=$2",
            [f.workspaceId, pat.personId],
          );
          assert.equal(patCandidate.accountRevision, patRevision);
          const candidates = answer.candidates.map((entry) => entry.volunteerId);
          assert.ok(candidates.includes(pat.personId), "an active account");
          assert.ok(candidates.includes(nadia.personId), "an admin by role");
          assert.ok(!candidates.includes(rio.personId), "a site coordinator");
          assert.ok(!candidates.includes(f.siteCoordinatorId), "a site coordinator");

          // The picker offers only active accounts: not an invited volunteer.
          const invited = await f.provision();
          const { personId: invitedId } = await rpc(sc, "vitally_save_volunteer", {
            p_action_id: randomUUID(),
            p_volunteer_id: null,
            p_expected_revision: null,
            p_volunteer: {
              name: "Ingrid Solberg", email: invited.email.toLowerCase(), phone: null, works: "on_site",
              languages: ["english"], otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
            },
          });
          await rpc(sc, "vitally_record_account", {
            p_action_id: randomUUID(),
            p_op: "create",
            p_target: { volunteerId: invitedId },
            p_user_id: invited.userId,
          });
          // Nor a deactivated one.
          const gone = await f.staff({ key: "gone_deact", name: "Gwen Holloway", capabilities: ["prepare"] });
          await rpc(sc, "vitally_deactivate_account", {
            p_action_id: randomUUID(),
            p_volunteer_id: gone.personId,
            p_expected_revision: (
              await one(f, "select revision::int as revision from public.accounts where workspace_id=$1 and person_id=$2", [
                f.workspaceId,
                gone.personId,
              ])
            ).revision,
          });
          const picker = (await read()).candidates.map((entry) => entry.volunteerId);
          assert.ok(!picker.includes(invitedId), "an invited volunteer");
          assert.ok(!picker.includes(gone.personId), "a deactivated volunteer");
          assert.ok(picker.includes(pat.personId));

          // Adding from the picker, end to end: the candidate as the read gave
          // it, at its own account revision. History's first line says so.
          // (The finally below removes Pat again.)
          const pick = (await read()).candidates.find((entry) => entry.volunteerId === pat.personId);
          const granted = await rpc(sc, "vitally_set_site_coordinator", {
            p_action_id: randomUUID(),
            p_volunteer_id: pick.volunteerId,
            p_expected_revision: pick.accountRevision,
            p_granted: true,
          });
          assert.equal(granted.isSiteCoordinator, true);
          assert.equal(granted.accountRevision, pick.accountRevision + 1);
          const after = await read();
          assert.ok(after.siteCoordinators.some((entry) => entry.volunteerId === pat.personId));
          assert.ok(!after.candidates.some((entry) => entry.volunteerId === pat.personId));
          for (const entry of after.history)
            assert.deepEqual(Object.keys(entry).sort(), ["changedAt", "changedByName", "granted", "personName"]);
          assert.deepEqual(
            { ...after.history[0], changedAt: undefined },
            { personName: "Pat Delacroix", granted: true, changedByName: "Avery Lin", changedAt: undefined },
          );
          // The roster command's grants name nobody.
          const rioLine = after.history.find((entry) => entry.personName === "Rio Castellanos");
          assert.equal(rioLine.granted, true);
          assert.equal(rioLine.changedByName, null);
          // Newest first.
          const times = after.history.map((entry) => Date.parse(entry.changedAt));
          assert.deepEqual(times, [...times].sort((a, b) => b - a));
          assert.ok(after.history.length <= 50);
          const { count } = await one(
            f,
            "select count(*)::int as count from public.site_coordinator_changes where workspace_id=$1",
            [f.workspaceId],
          );
          assert.equal(after.history.length, Math.min(count, 50));
        } finally {
          for (const member of [rio, pat]) {
            const account = await one(
              f,
              "select revision::int as revision,is_site_coordinator from public.accounts where workspace_id=$1 and person_id=$2",
              [f.workspaceId, member.personId],
            );
            if (account.is_site_coordinator)
              await rpc(sc, "vitally_set_site_coordinator", {
                p_action_id: randomUUID(),
                p_volunteer_id: member.personId,
                p_expected_revision: account.revision,
                p_granted: false,
              });
          }
        }
      });

      await t.test("history keeps at most 50 lines", async () => {
        await f.sql(
          `insert into public.site_coordinator_changes(workspace_id,person_id,granted,changed_by_person_id,changed_at)
            select $1,$2,g%2=0,$2,now()-make_interval(days=>g) from generate_series(1,60) g`,
          [f.workspaceId, nadia.personId],
        );
        const { history } = await read();
        assert.equal(history.length, 50);
        const times = history.map((entry) => Date.parse(entry.changedAt));
        assert.deepEqual(times, [...times].sort((a, b) => b - a));
      });
    } finally {
      await f.sql("select vitally_private.set_site_number($1,$2)", [f.workspaceId, TEST_SITE_NUMBER]);
    }
  } finally {
    await f.close();
  }
});
