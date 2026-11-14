// The accounts Edge Function's request handler (OpenSpec change
// add-account-invitations, design D4). Plain ES module: it imports nothing and
// reads no Deno or process globals, so Node's test runner can import it and
// index.ts supplies the clients.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Copy of SQLSTATE_ERROR_CODES in src/contracts.mjs (a unit test keeps them equal).
export const SQLSTATE_ERROR_CODES = Object.freeze({
  VT001: "FORBIDDEN",
  VT002: "NOT_FOUND",
  VT003: "CONFLICT",
  VT004: "INVALID_TRANSITION",
  VT005: "SELF_REVIEW",
  VT006: "INELIGIBLE",
  VT007: "VALIDATION",
  VT009: "NOT_CLEARED",
});

const STATUS_FOR = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400, INVALID_TRANSITION: 400 };
const OPS = ["create", "invite", "resend"];

const reply = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  });

const isAuthFailure = (error) =>
  error?.status === 401 || error?.code === "PGRST301" || error?.code === "PGRST303";

// A database error as a response. Unknown errors are a server error.
function refusal(error) {
  if (isAuthFailure(error)) return reply(401, { code: "FORBIDDEN" });
  const code = SQLSTATE_ERROR_CODES[error?.code];
  if (!code) return reply(500, { code: "SERVER_ERROR" });
  const body = { code };
  if ((code === "VALIDATION" || code === "INVALID_TRANSITION") && error.details) body.reason = error.details;
  return reply(STATUS_FOR[code] ?? 500, body);
}

const text = (value) => (typeof value === "string" ? value.trim() : "");

export async function handleAccountRequest(request, deps) {
  if (request.method === "OPTIONS") return reply(204);
  if (request.method !== "POST") return reply(405, { code: "METHOD_NOT_ALLOWED" });
  try {
    const jwt = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!jwt) return reply(401, { code: "FORBIDDEN" });

    let body;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const op = body?.op;
    const actionId = text(body?.actionId);
    const volunteerId = text(body?.volunteerId);
    const email = text(body?.email);
    if (!OPS.includes(op) || (op !== "resend" && !actionId)) {
      return reply(400, { code: "VALIDATION", reason: "BAD_REQUEST" });
    }
    // create and a volunteer's resend name the volunteer; invite and a client's resend, the email.
    const target = op === "create" || (op === "resend" && volunteerId) ? { volunteerId } : { email };

    const user = deps.userClient(jwt);
    // Verify the caller first: a valid JWT that is not a user (the anon key) stops here.
    const who = await user.auth.getUser(jwt);
    if (who.error || !who.data?.user) return reply(401, { code: "FORBIDDEN" });

    const prepare = () =>
      user.rpc("vitally_prepare_account", {
        p_action_id: op === "resend" ? null : actionId,
        p_op: op,
        p_target: target,
      });
    // A repeated action: answer its stored result and do nothing else.
    const replayed = (checked) =>
      reply(200, {
        status: checked.replay.status,
        emailSent: false,
        accountRevision: checked.replay.accountRevision,
        replay: true,
      });

    let prepared = await prepare();
    if (prepared.error) return refusal(prepared.error);
    let checked = prepared.data;
    if (checked?.replay) return replayed(checked);

    let accountRevision = checked.accountRevision;
    if (op !== "resend") {
      let userId = checked.reusableUserId;
      if (!userId) {
        const created = await deps.adminClient.auth.admin.createUser({ email: checked.email, email_confirm: true });
        if (created.error?.code === "email_exists" || created.error?.status === 422) {
          // Another request just created the user: check again, once.
          prepared = await prepare();
          if (prepared.error) return refusal(prepared.error);
          checked = prepared.data;
          if (checked?.replay) return replayed(checked);
          userId = checked.reusableUserId;
          if (!userId) return reply(500, { code: "SERVER_ERROR" });
        } else if (created.error || !created.data?.user?.id) {
          return reply(500, { code: "SERVER_ERROR" });
        } else {
          userId = created.data.user.id;
        }
      }
      const recorded = await user.rpc("vitally_record_account", {
        p_action_id: actionId,
        p_op: op,
        p_target: target,
        p_user_id: userId,
      });
      if (recorded.error) return refusal(recorded.error);
      accountRevision = recorded.data.accountRevision;
    }

    // The record stands even if the email fails (rate limit, cooldown): the admin can Resend.
    let emailSent = false;
    try {
      const sent = await deps.anonClient.auth.signInWithOtp({
        email: checked.email,
        options: { shouldCreateUser: false },
      });
      emailSent = !sent.error;
    } catch {
      emailSent = false;
    }
    return reply(200, { status: "invited", emailSent, accountRevision });
  } catch {
    return reply(500, { code: "SERVER_ERROR" });
  }
}
