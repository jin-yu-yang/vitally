import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertTestTarget } from "../tools/admin/test-target.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import { createDatabaseFixture } from "./support/database-fixture.mjs";
import { latestCode } from "./support/mail-catcher.mjs";

// OpenSpec change add-account-invitations (design D4): the accounts Edge
// Function against the local stack. CI runs it (test:database); the function
// needs the edge runtime, which docs/setup.md describes.

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const SETUP = "The accounts Edge Function did not answer. Check that the Supabase edge runtime is running and the function is served (docs/setup.md).";

test("accounts Edge Function against real Supabase", async (t) => {
  const target = await assertTestTarget();
  const mailUrl = process.env.VITALLY_TEST_MAIL_URL;
  assert.ok(mailUrl, "VITALLY_TEST_MAIL_URL is required (tools/admin/write-test-env.mjs writes it).");
  const f = await createDatabaseFixture();
  const service = createClient(target.apiUrl, target.adminKey, clientOptions);
  const createdEmails = [];
  let passed = false;
  try {
    const endpoint = `${target.apiUrl}/functions/v1/accounts`;
    const tokenOf = async (client) => (await client.auth.getSession()).data.session.access_token;
    let warm = false;
    const call = async (client, body) => {
      const token = await tokenOf(client);
      const send = async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, apikey: target.publishableKey, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
      };
      if (warm) return send();
      // The first call can meet a cold edge runtime: retry once on 5xx or a connection error.
      let result;
      try {
        result = await send();
      } catch {
        result = { status: 599 };
      }
      if (result.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          result = await send();
        } catch {
          assert.fail(SETUP);
        }
        if (result.status >= 500) assert.fail(`${SETUP} Last answer: ${result.status} ${JSON.stringify(result.body)}`);
      }
      warm = true;
      return result;
    };
    const newEmail = () => {
      const email = `${randomUUID()}@example.org`;
      createdEmails.push(email);
      return email;
    };
    const addVolunteer = async (email) => {
      const { data, error } = await f.siteCoordinator.rpc("vitally_save_volunteer", {
        p_action_id: randomUUID(),
        p_volunteer_id: null,
        p_expected_revision: null,
        p_volunteer: {
          name: "Rowan Pike", email, phone: null, works: "on_site", languages: ["english"],
          otherLanguage: null, roles: [], certificates: [], isNew: false, photoIdChecked: false,
        },
      });
      assert.equal(error, null, `vitally_save_volunteer: ${error?.message}`);
      return data.personId;
    };
    const accountStatus = async (personId) =>
      (await f.sql("select status from public.accounts where workspace_id=$1 and person_id=$2", [f.workspaceId, personId])).rows[0]?.status;
    const authUserExists = async (email) =>
      (await f.sql("select 1 from auth.users where lower(email)=$1", [email])).rowCount > 0;

    await t.test("create account sends a code that signs the volunteer in", async () => {
      const email = newEmail();
      const volunteerId = await addVolunteer(email);
      const after = new Date(Date.now() - 2000);
      const result = await call(f.siteCoordinator, { op: "create", actionId: randomUUID(), volunteerId });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.status, "invited");
      assert.equal(result.body.emailSent, true);
      assert.equal(await accountStatus(volunteerId), "invited");
      const code = await latestCode(mailUrl, email, { after });
      const signedIn = createClient(target.apiUrl, target.publishableKey, clientOptions);
      const { error } = await signedIn.auth.verifyOtp({ email, token: code, type: "email" });
      assert.equal(error, null, `verifyOtp: ${error?.message}`);
      await signedIn.auth.signOut({ scope: "local" });
      assert.equal(await accountStatus(volunteerId), "active");
    });

    await t.test("invite then resend sends a second code", async () => {
      const email = newEmail();
      const first = new Date(Date.now() - 2000);
      const invited = await call(f.siteCoordinator, { op: "invite", actionId: randomUUID(), email });
      assert.equal(invited.status, 200, JSON.stringify(invited.body));
      assert.equal(invited.body.emailSent, true);
      const firstCode = await latestCode(mailUrl, email, { after: first });
      // Supabase refuses a second code inside its resend cooldown (60 s by default).
      await new Promise((resolve) => setTimeout(resolve, 61000));
      const second = new Date(Date.now() - 2000);
      const resent = await call(f.siteCoordinator, { op: "resend", email });
      assert.equal(resent.status, 200, JSON.stringify(resent.body));
      assert.equal(resent.body.emailSent, true);
      const secondCode = await latestCode(mailUrl, email, { after: second });
      assert.match(secondCode, /^\d{6}$/);
      assert.match(firstCode, /^\d{6}$/);
    });

    await t.test("a non-admin is refused 403 and no auth user exists", async () => {
      const member = await f.staff({ key: "plain_preparer", name: "Pat Reed", capabilities: ["prepare"] });
      const email = newEmail();
      const volunteerId = await addVolunteer(email);
      const result = await call(member.client, { op: "create", actionId: randomUUID(), volunteerId });
      assert.equal(result.status, 403, JSON.stringify(result.body));
      assert.equal(result.body.code, "FORBIDDEN");
      assert.equal(await authUserExists(email), false);
    });
    passed = true;
  } finally {
    // Close first, in a finally nothing can skip: closing deletes the workspace, which
    // cascades its memberships, people and accounts. Then remove the Auth users the
    // function created and the fixture does not track.
    const failures = [];
    const userIds = [];
    for (const email of createdEmails) {
      try {
        const row = (await f.sql("select id from auth.users where lower(email)=$1", [email])).rows[0];
        if (row) userIds.push([email, row.id]);
      } catch (error) {
        failures.push(`${email}: ${error.message}`);
      }
    }
    try {
      await f.close();
    } catch (error) {
      failures.push(`close: ${error.message}`);
    }
    // The fixture's connection is closed now: use one of our own for any membership left.
    const cleanup = await openDatabase({ kind: "test" });
    try {
      for (const [email, id] of userIds) {
        try {
          await cleanup.query("delete from public.memberships where user_id=$1", [id]);
          const { error } = await service.auth.admin.deleteUser(id);
          if (error) failures.push(`${email}: ${error.message}`);
        } catch (error) {
          failures.push(`${email}: ${error.message}`);
        }
      }
    } finally {
      await cleanup.end();
    }
    if (failures.length && passed) throw new Error(`Cleanup failed: ${failures.join("; ")}`);
  }
});
