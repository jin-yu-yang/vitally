import test from "node:test";
import assert from "node:assert/strict";
import { handleAccountRequest, SQLSTATE_ERROR_CODES } from "../supabase/functions/accounts/handler.mjs";
import { SQLSTATE_ERROR_CODES as CONTRACT_CODES } from "../src/contracts.mjs";

// OpenSpec change add-account-invitations, design D4: the accounts Edge
// Function's handler, with fake clients that record their calls.

const ACTION = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function fakes({ prepare, record, createUser, otp, getUser } = {}) {
  const calls = [];
  const userClient = (jwt) => {
    calls.push(`userClient:${jwt}`);
    return {
      auth: {
        getUser: async (token) => {
          calls.push({ getUser: token });
          return getUser ?? { data: { user: { id: "44444444-4444-4444-8444-444444444444" } }, error: null };
        },
      },
      rpc: async (fn, args) => {
        calls.push({ rpc: fn, args });
        if (fn === "vitally_prepare_account") {
          const next = Array.isArray(prepare) ? prepare.shift() : prepare;
          return (
            next ?? {
              data: { op: args.p_op, email: "ada@example.org", reusableUserId: null, volunteerId: VOLUNTEER, accountRevision: 0 },
              error: null,
            }
          );
        }
        return (
          record ?? {
            data: { actionId: ACTION, status: "invited", email: "ada@example.org", accountRevision: 1 },
            error: null,
          }
        );
      },
    };
  };
  const adminClient = {
    auth: {
      admin: {
        createUser: async (args) => {
          calls.push({ createUser: args });
          return createUser ?? { data: { user: { id: USER } }, error: null };
        },
      },
    },
  };
  const anonClient = {
    auth: {
      signInWithOtp: async (args) => {
        calls.push({ signInWithOtp: args });
        return otp ?? { data: {}, error: null };
      },
    },
  };
  return { calls, deps: { userClient, adminClient, anonClient } };
}

const post = (body, headers = { authorization: "Bearer jwt-1" }) =>
  new Request("https://x.test/functions/v1/accounts", { method: "POST", headers, body: JSON.stringify(body) });
const names = (calls) => calls.filter((c) => typeof c !== "string").map((c) => c.rpc ?? Object.keys(c)[0]);

test("options answers 204 with CORS", async () => {
  const { deps } = fakes();
  const response = await handleAccountRequest(new Request("https://x.test/", { method: "OPTIONS" }), deps);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, x-client-info, apikey, content-type");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
});

test("no bearer token is 401", async () => {
  const { deps, calls } = fakes();
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }, {}), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "FORBIDDEN" });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(calls, []);
});

test("a bad token is 401", async () => {
  const { deps } = fakes({ prepare: { data: null, error: { status: 401, code: "PGRST301", message: "JWT" } } });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "FORBIDDEN" });
});

test("create runs prepare, createUser, record, then signInWithOtp with shouldCreateUser false", async () => {
  const { deps, calls } = fakes();
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "invited", emailSent: true, accountRevision: 1 });
  assert.deepEqual(names(calls), ["getUser", "vitally_prepare_account", "createUser", "vitally_record_account", "signInWithOtp"]);
  const rpc = (fn) => calls.find((c) => c.rpc === fn).args;
  assert.deepEqual(rpc("vitally_prepare_account"), { p_action_id: ACTION, p_op: "create", p_target: { volunteerId: VOLUNTEER } });
  assert.deepEqual(calls.find((c) => c.createUser).createUser, { email: "ada@example.org", email_confirm: true });
  assert.deepEqual(rpc("vitally_record_account"), {
    p_action_id: ACTION,
    p_op: "create",
    p_target: { volunteerId: VOLUNTEER },
    p_user_id: USER,
  });
  assert.deepEqual(calls.find((c) => c.signInWithOtp).signInWithOtp, {
    email: "ada@example.org",
    options: { shouldCreateUser: false },
  });
  assert.ok(calls.includes("userClient:jwt-1"));
});

test("invite targets the trimmed email", async () => {
  const { deps, calls } = fakes();
  const response = await handleAccountRequest(post({ op: "invite", actionId: ACTION, email: " Ada@Example.org " }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find((c) => c.rpc === "vitally_prepare_account").args.p_target, { email: "Ada@Example.org" });
});

test("a reusable user id skips createUser", async () => {
  const { deps, calls } = fakes({
    prepare: {
      data: { op: "create", email: "ada@example.org", reusableUserId: USER, volunteerId: VOLUNTEER, accountRevision: 0 },
      error: null,
    },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(names(calls), ["getUser", "vitally_prepare_account", "vitally_record_account", "signInWithOtp"]);
  assert.equal(calls.find((c) => c.rpc === "vitally_record_account").args.p_user_id, USER);
});

test("resend runs prepare and signInWithOtp only", async () => {
  const { deps, calls } = fakes({
    prepare: {
      data: { op: "resend", email: "ada@example.org", reusableUserId: null, volunteerId: VOLUNTEER, accountRevision: 4 },
      error: null,
    },
  });
  const response = await handleAccountRequest(post({ op: "resend", volunteerId: VOLUNTEER }), deps);
  assert.deepEqual(await response.json(), { status: "invited", emailSent: true, accountRevision: 4 });
  assert.deepEqual(names(calls), ["getUser", "vitally_prepare_account", "signInWithOtp"]);
  assert.deepEqual(calls.find((c) => c.rpc === "vitally_prepare_account").args, {
    p_action_id: null,
    p_op: "resend",
    p_target: { volunteerId: VOLUNTEER },
  });
});

test("a refusal maps VT007 detail to 400 {code:'VALIDATION', reason}", async () => {
  const { deps, calls } = fakes({
    prepare: { data: null, error: { code: "VT007", message: "VALIDATION", details: "NO_EMAIL" } },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "VALIDATION", reason: "NO_EMAIL" });
  assert.ok(!names(calls).includes("createUser"));
});

test("other refusals map to their statuses", async () => {
  for (const [sqlstate, status, code] of [
    ["VT001", 403, "FORBIDDEN"],
    ["VT002", 404, "NOT_FOUND"],
    ["VT003", 409, "CONFLICT"],
  ]) {
    const { deps } = fakes({ prepare: { data: null, error: { code: sqlstate, message: code, details: null } } });
    const response = await handleAccountRequest(post({ op: "resend", volunteerId: VOLUNTEER }), deps);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  }
  const { deps } = fakes({ prepare: { data: null, error: { code: "XX000", message: "boom" } } });
  const response = await handleAccountRequest(post({ op: "resend", volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: "SERVER_ERROR" });
});

test("a record refusal maps to its status and sends no email", async () => {
  const { deps, calls } = fakes({
    record: { data: null, error: { code: "VT007", message: "VALIDATION", details: "EMAIL_IN_USE" } },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "VALIDATION", reason: "EMAIL_IN_USE" });
  assert.ok(!names(calls).includes("signInWithOtp"));
});

test("email failure still answers 200 with emailSent false", async () => {
  const { deps } = fakes({ otp: { data: null, error: { status: 429, message: "rate limit" } } });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "invited", emailSent: false, accountRevision: 1 });
});

test("createUser failure is 500 and nothing is recorded", async () => {
  const { deps, calls } = fakes({ createUser: { data: null, error: { message: "down" } } });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: "SERVER_ERROR" });
  assert.ok(!names(calls).includes("vitally_record_account"));
  assert.ok(!names(calls).includes("signInWithOtp"));
});

test("a replayed action answers its stored result without side effects", async () => {
  const { deps, calls } = fakes({
    prepare: {
      data: { replay: { actionId: ACTION, status: "invited", email: "ada@example.org", accountRevision: 1 } },
      error: null,
    },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "invited", emailSent: false, accountRevision: 1, replay: true });
  assert.deepEqual(names(calls), ["getUser", "vitally_prepare_account"]);
});

test("a bad body is 400 VALIDATION", async () => {
  const { deps, calls } = fakes();
  const response = await handleAccountRequest(post({ op: "delete" }), deps);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "VALIDATION");
  assert.deepEqual(names(calls), []);
});

test("the handler's SQLSTATE map equals the one in contracts.mjs", () => {
  assert.deepEqual({ ...SQLSTATE_ERROR_CODES }, { ...CONTRACT_CODES });
});

test("a token getUser rejects is 401 and no rpc runs", async () => {
  for (const getUser of [{ data: { user: null }, error: { status: 401, message: "bad jwt" } }, { data: { user: null }, error: null }]) {
    const { deps, calls } = fakes({ getUser });
    const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { code: "FORBIDDEN" });
    assert.deepEqual(names(calls), ["getUser"]);
  }
});

test("email_exists from createUser re-checks and continues with the reusable user", async () => {
  const first = { data: { op: "create", email: "ada@example.org", reusableUserId: null, volunteerId: VOLUNTEER, accountRevision: 0 }, error: null };
  const second = { data: { op: "create", email: "ada@example.org", reusableUserId: USER, volunteerId: VOLUNTEER, accountRevision: 0 }, error: null };
  const { deps, calls } = fakes({
    prepare: [first, second],
    createUser: { data: null, error: { code: "email_exists", status: 422, message: "exists" } },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(names(calls), ["getUser", "vitally_prepare_account", "createUser", "vitally_prepare_account", "vitally_record_account", "signInWithOtp"]);
  assert.equal(calls.find((c) => c.rpc === "vitally_record_account").args.p_user_id, USER);
});

test("email_exists then a replay answers the replay", async () => {
  const first = { data: { op: "create", email: "ada@example.org", reusableUserId: null, volunteerId: VOLUNTEER, accountRevision: 0 }, error: null };
  const replay = { data: { replay: { actionId: ACTION, status: "invited", email: "ada@example.org", accountRevision: 1 } }, error: null };
  const { deps, calls } = fakes({
    prepare: [first, replay],
    createUser: { data: null, error: { code: "email_exists", status: 422, message: "exists" } },
  });
  const response = await handleAccountRequest(post({ op: "create", actionId: ACTION, volunteerId: VOLUNTEER }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "invited", emailSent: false, accountRevision: 1, replay: true });
  assert.ok(!names(calls).includes("vitally_record_account"));
  assert.ok(!names(calls).includes("signInWithOtp"));
});
