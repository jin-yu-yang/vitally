// Reads the sign-in code out of the local stack's mail catcher. The catcher is
// Mailpit (Supabase CLI 2.117.0; the container is still named "inbucket"), whose
// URL `supabase status` reports as MAILPIT_URL / INBUCKET_URL and
// tools/admin/write-test-env.mjs writes to .env.test as VITALLY_TEST_MAIL_URL.
// An Inbucket catcher (older CLIs) is read too, if Mailpit's API answers 404.
// The sign-in template is `<p>Your ViTally code is {{ .Token }}</p>`, so the
// code is the first run of six digits in the body.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJson = async (url) => {
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The mail catcher answered ${response.status} for ${new URL(url).pathname}.`);
  return response.json();
};

const codeIn = (body) => /\b\d{6}\b/.exec(String(body ?? ""))?.[0];

// Mailpit: newest first. `Created` is an ISO timestamp.
async function fromMailpit(base, email, after) {
  const found = await getJson(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!found) return { missing: true };
  for (const item of found.messages ?? []) {
    if (new Date(item.Created) <= after) continue;
    const message = await getJson(`${base}/api/v1/message/${encodeURIComponent(item.ID)}`);
    const code = codeIn(message?.Text) ?? codeIn(message?.HTML);
    if (code) return { code };
  }
  return {};
}

// Inbucket: the mailbox is the part of the address before the "@".
async function fromInbucket(base, email, after) {
  const name = encodeURIComponent(email.split("@")[0]);
  const list = await getJson(`${base}/api/v1/mailbox/${name}`);
  if (!list) return {};
  const newest = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const item of newest) {
    if (new Date(item.date) <= after) continue;
    const message = await getJson(`${base}/api/v1/mailbox/${name}/${encodeURIComponent(item.id)}`);
    const code = codeIn(message?.body?.text) ?? codeIn(message?.body?.html);
    if (code) return { code };
  }
  return {};
}

/**
 * The 6-digit code in the newest message to `email` that arrived after `after`.
 * Polls until one arrives; throws after `timeoutMs`.
 */
export async function latestCode(mailUrl, email, { after = new Date(0), timeoutMs = 15000 } = {}) {
  const base = String(mailUrl).replace(/\/+$/, "");
  const address = String(email).trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let useInbucket = false;
  for (;;) {
    let result;
    if (!useInbucket) {
      result = await fromMailpit(base, address, after);
      if (result.missing) useInbucket = true;
    }
    if (useInbucket) result = await fromInbucket(base, address, after);
    if (result.code) return result.code;
    if (Date.now() >= deadline)
      throw new Error(`No sign-in code arrived for ${address} within ${timeoutMs} ms.`);
    await sleep(250);
  }
}
