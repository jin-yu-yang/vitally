import test from "node:test";
import assert from "node:assert/strict";
import { senderFromEnv, FROM } from "../supabase/functions/accounts/sender.mjs";

const MAIL = {
  to: "ada@example.org",
  subject: "Subject line",
  text: "Plain body",
  html: "<p>Html body</p>",
  idempotencyKey: "action-1",
};

function envOf(values) {
  return (name) => values[name];
}

function recorder(answer) {
  const calls = [];
  const logs = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return typeof answer === "function" ? answer(url, options) : answer;
  };
  return { calls, logs, fetch, log: (...args) => logs.push(args.join(" ")) };
}

function resendSender(rec, extra = {}) {
  const mail = senderFromEnv(
    envOf({ RESEND_API_KEY: "re_secret", VITALLY_SITE_URL: "https://govitally.org" }),
    { fetch: rec.fetch, log: rec.log, ...extra },
  );
  assert.equal(mail.ok, true);
  return mail;
}

function catcherSender(rec, url = "http://catcher.test") {
  const mail = senderFromEnv(
    envOf({ VITALLY_MAIL_CATCHER_URL: url, VITALLY_SITE_URL: "https://govitally.org" }),
    { fetch: rec.fetch, log: rec.log },
  );
  assert.equal(mail.ok, true);
  return mail;
}

const json = (status, body) => new Response(JSON.stringify(body), { status });

test("guard: neither sender set", () => {
  const result = senderFromEnv(envOf({ VITALLY_SITE_URL: "https://govitally.org" }));
  assert.deepEqual(result, { ok: false, missing: ["RESEND_API_KEY or VITALLY_MAIL_CATCHER_URL"] });
});

test("guard: both senders set, and no value leaks", () => {
  const result = senderFromEnv(envOf({
    RESEND_API_KEY: "re_secret",
    VITALLY_MAIL_CATCHER_URL: "http://catcher.test",
    VITALLY_SITE_URL: "https://govitally.org",
  }));
  assert.deepEqual(result, { ok: false, missing: ["only one of RESEND_API_KEY and VITALLY_MAIL_CATCHER_URL"] });
  assert.ok(!JSON.stringify(result).includes("re_secret"));
  assert.ok(!JSON.stringify(result).includes("catcher.test"));
});

test("guard: site URL missing, alone or with the others; blank counts as unset", () => {
  assert.deepEqual(senderFromEnv(envOf({ RESEND_API_KEY: "re_secret" })), {
    ok: false,
    missing: ["VITALLY_SITE_URL"],
  });
  assert.deepEqual(senderFromEnv(envOf({ RESEND_API_KEY: "re_secret", VITALLY_SITE_URL: "  " })), {
    ok: false,
    missing: ["VITALLY_SITE_URL"],
  });
  assert.deepEqual(senderFromEnv(envOf({ RESEND_API_KEY: "  ", VITALLY_MAIL_CATCHER_URL: "" })), {
    ok: false,
    missing: ["RESEND_API_KEY or VITALLY_MAIL_CATCHER_URL", "VITALLY_SITE_URL"],
  });
});

test("guard: success returns the site URL", () => {
  const result = senderFromEnv(envOf({ RESEND_API_KEY: "re_secret", VITALLY_SITE_URL: "https://govitally.org/" }));
  assert.equal(result.ok, true);
  assert.equal(result.siteUrl, "https://govitally.org/");
  assert.equal(typeof result.sendInvitation, "function");
});

test("resend: request shape", async () => {
  const rec = recorder(json(200, { id: "abc" }));
  const result = await resendSender(rec).sendInvitation(MAIL);
  assert.deepEqual(result, { sent: true });
  assert.equal(rec.calls.length, 1);
  const { url, options } = rec.calls[0];
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.authorization, "Bearer re_secret");
  assert.equal(options.headers["idempotency-key"], "action-1");
  assert.deepEqual(JSON.parse(options.body), {
    from: FROM,
    to: ["ada@example.org"],
    subject: MAIL.subject,
    text: MAIL.text,
    html: MAIL.html,
  });
  assert.ok(options.signal instanceof AbortSignal);
});

test("resend: no idempotency header without a key", async () => {
  const rec = recorder(json(200, { id: "abc" }));
  await resendSender(rec).sendInvitation({ ...MAIL, idempotencyKey: undefined });
  assert.ok(!("idempotency-key" in rec.calls[0].options.headers));
});

test("catcher: request shape, trailing slash tolerated", async () => {
  const rec = recorder(json(200, { ID: "m1" }));
  const result = await catcherSender(rec, "http://catcher.test/").sendInvitation(MAIL);
  assert.deepEqual(result, { sent: true });
  const { url, options } = rec.calls[0];
  assert.equal(url, "http://catcher.test/api/v1/send");
  assert.equal(options.method, "POST");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), {
    From: { Email: "help@govitally.org", Name: "ViTally" },
    To: [{ Email: "ada@example.org" }],
    Subject: MAIL.subject,
    Text: MAIL.text,
    HTML: MAIL.html,
  });
});

const RESULTS = [
  ["409 invalid_idempotent_request counts as sent", () => json(409, { name: "invalid_idempotent_request" }), true],
  ["409 concurrent_idempotent_requests is not sent", () => json(409, { name: "concurrent_idempotent_requests" }), false],
  ["429 daily_quota_exceeded is not sent", () => json(429, { name: "daily_quota_exceeded" }), false],
  ["502 with an HTML body is not sent", () => new Response("<html>Bad gateway</html>", { status: 502 }), false],
  ["an empty body is not sent", () => new Response("", { status: 500 }), false],
  ["a 200 with an empty body is sent", () => new Response("", { status: 200 }), true],
  ["a 200 with a non-JSON body is sent", () => new Response("OK", { status: 200 }), true],
];

for (const [name, answer, sent] of RESULTS) {
  test(`result: ${name}`, async () => {
    const rec = recorder(answer());
    assert.deepEqual(await resendSender(rec).sendInvitation(MAIL), { sent });
  });
}

test("result: fetch rejects", async () => {
  const rec = recorder(() => {
    throw new TypeError("connect ECONNREFUSED ada@example.org re_secret");
  });
  assert.deepEqual(await resendSender(rec).sendInvitation(MAIL), { sent: false });
  assert.equal(rec.logs.length, 1);
  assert.match(rec.logs[0], /network/);
});

test("result: abort after timeoutMs", async () => {
  const rec = recorder((url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason));
    }));
  assert.deepEqual(await resendSender(rec, { timeoutMs: 20 }).sendInvitation(MAIL), { sent: false });
  assert.equal(rec.logs.length, 1);
  assert.match(rec.logs[0], /timeout/);
});

test("log: a failure logs once with name and status, never the address or key", async () => {
  const rec = recorder(json(429, { name: "daily_quota_exceeded", message: "for ada@example.org re_secret" }));
  await resendSender(rec).sendInvitation(MAIL);
  assert.equal(rec.logs.length, 1);
  assert.match(rec.logs[0], /daily_quota_exceeded/);
  assert.match(rec.logs[0], /429/);
  assert.ok(!rec.logs[0].includes("ada@example.org"));
  assert.ok(!rec.logs[0].includes("re_secret"));
});

test("log: a non-JSON failure logs the status only", async () => {
  const rec = recorder(new Response("<html>ada@example.org</html>", { status: 502 }));
  await resendSender(rec).sendInvitation(MAIL);
  assert.equal(rec.logs.length, 1);
  assert.match(rec.logs[0], /502/);
  assert.ok(!rec.logs[0].includes("ada@example.org"));
});

test("success logs nothing", async () => {
  const rec = recorder(json(200, { id: "abc" }));
  await resendSender(rec).sendInvitation(MAIL);
  assert.equal(rec.logs.length, 0);
});
