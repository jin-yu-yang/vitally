// Reads ViTally's emails out of the local stack's mail catcher. The catcher is
// Mailpit (Supabase CLI 2.117.0; the container is still named "inbucket"), whose
// URL `supabase status` reports as MAILPIT_URL / INBUCKET_URL and
// tools/admin/write-test-env.mjs writes to .env.test as VITALLY_TEST_MAIL_URL.
// An Inbucket catcher (older CLIs) is read too, if Mailpit's API answers 404.
// Two kinds of mail arrive here (change send-invitation-emails):
//   - "Your ViTally code" from Auth: `<p>Your ViTally code is {{ .Token }}</p>`,
//     so the code is the first run of six digits in the body (latestCode);
//   - "You're invited to ViTally..." from the accounts function, sent through
//     the catcher's send API. It has no code (latestInvitation, assertInvitation).

import assert from "node:assert/strict";

const INVITATION_SUBJECT = "You're invited to ViTally";
const CODE_SUBJECT = "Your ViTally code";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJson = async (url) => {
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The mail catcher answered ${response.status} for ${new URL(url).pathname}.`);
  return response.json();
};

const codeIn = (body) => /\b\d{6}\b/.exec(String(body ?? ""))?.[0];

// Each picker takes { subject, text, html } and returns a result or undefined.
const forCode = (message) => {
  if (message.subject !== CODE_SUBJECT) return undefined;
  const code = codeIn(message.text) ?? codeIn(message.html);
  return code ? { code } : undefined;
};
const forInvitation = (message) =>
  String(message.subject ?? "").startsWith(INVITATION_SUBJECT)
    ? { message: { subject: message.subject, text: message.text, html: message.html } }
    : undefined;

// Mailpit: newest first. `Created` is an ISO timestamp.
async function fromMailpit(base, email, after, pick) {
  const found = await getJson(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!found) return { missing: true };
  for (const item of found.messages ?? []) {
    if (new Date(item.Created) <= after) continue;
    const message = await getJson(`${base}/api/v1/message/${encodeURIComponent(item.ID)}`);
    const picked = pick({ subject: message?.Subject, text: message?.Text, html: message?.HTML });
    if (picked) return picked;
  }
  return {};
}

// Inbucket: the mailbox is the part of the address before the "@".
async function fromInbucket(base, email, after, pick) {
  const name = encodeURIComponent(email.split("@")[0]);
  const list = await getJson(`${base}/api/v1/mailbox/${name}`);
  if (!list) return {};
  const newest = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const item of newest) {
    if (new Date(item.date) <= after) continue;
    const message = await getJson(`${base}/api/v1/mailbox/${name}/${encodeURIComponent(item.id)}`);
    const picked = pick({ subject: message?.subject, text: message?.body?.text, html: message?.body?.html });
    if (picked) return picked;
  }
  return {};
}

async function poll(mailUrl, email, { after, timeoutMs }, pick, what) {
  const base = String(mailUrl).replace(/\/+$/, "");
  const address = String(email).trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let useInbucket = false;
  for (;;) {
    let result;
    if (!useInbucket) {
      result = await fromMailpit(base, address, after, pick);
      if (result.missing) useInbucket = true;
    }
    if (useInbucket) result = await fromInbucket(base, address, after, pick);
    if (result.code || result.message) return result;
    if (Date.now() >= deadline) throw new Error(`No ${what} arrived for ${address} within ${timeoutMs} ms.`);
    await sleep(250);
  }
}

/**
 * The 6-digit code in the newest "Your ViTally code" message to `email` that
 * arrived after `after`. Polls until one arrives; throws after `timeoutMs`.
 */
export async function latestCode(mailUrl, email, { after = new Date(0), timeoutMs = 15000 } = {}) {
  return (await poll(mailUrl, email, { after, timeoutMs }, forCode, "sign-in code")).code;
}

/**
 * The newest invitation to `email` that arrived after `after`: its subject
 * starts with "You're invited to ViTally". Returns { subject, text, html }.
 */
export async function latestInvitation(mailUrl, email, { after = new Date(0), timeoutMs = 15000 } = {}) {
  return (await poll(mailUrl, email, { after, timeoutMs }, forInvitation, "invitation")).message;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric",
  day: "numeric", hour: "numeric", minute: "numeric",
});

// "Wednesday, November 25, 2026 at 3:00 PM" read as New York time -> the instant.
// In the fall-back hour (1:00-2:00 AM, twice) it returns the first (EDT) instant.
export function parseNewYorkTime(text) {
  const m = /(\w+) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)/.exec(text);
  assert.ok(m, `Not a New York date and time: ${text}`);
  const month = MONTHS.indexOf(m[1].toLowerCase());
  assert.ok(month >= 0, `Unknown month in: ${text}`);
  const hour = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
  const wall = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
  // The New York wall clock at instant t, read back as if it were UTC.
  const wallAt = (t) => {
    const v = Object.fromEntries(NEW_YORK.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute));
  };
  let t = wall;
  for (let i = 0; i < 3; i += 1) t = wall - (wallAt(t) - t);
  return new Date(t);
}

/**
 * An invitation has the site link (also as an href), no run of six digits, no
 * recipient address, and an English expiry line within a minute of `expiresAt`
 * (the account row's expires_at).
 */
export function assertInvitation(message, { email, siteUrl, expiresAt }) {
  const { text, html } = message;
  assert.ok(String(text).includes(siteUrl), `The invitation does not contain ${siteUrl}.`);
  assert.ok(String(html).includes(`href="${siteUrl}"`), `The invitation html has no link to ${siteUrl}.`);
  assert.ok(email, "assertInvitation needs the recipient's email.");
  const address = String(email).trim().toLowerCase();
  assert.ok(!String(text).toLowerCase().includes(address), "The invitation text contains the recipient's address.");
  assert.ok(!String(html).toLowerCase().includes(address), "The invitation html contains the recipient's address.");
  assert.ok(!/\b\d{6}\b/.test(`${text}${html ?? ""}`), "The invitation contains a run of six digits.");
  const shown = /valid until (.+?) \(New York time\)/.exec(text);
  assert.ok(shown, "The invitation has no English expiry line.");
  const gap = Math.abs(parseNewYorkTime(shown[1]).getTime() - new Date(expiresAt).getTime());
  assert.ok(gap <= 60_000, `The invitation's expiry is ${gap} ms from the account's expires_at.`);
}
