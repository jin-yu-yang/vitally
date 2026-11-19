// Invitation email senders (design D2, D6): Resend on the hosted project, the
// local mail catcher (Mailpit's HTTP send API) on test stacks and CI. A plain
// module: fetch, log and the clock-free timeout are injected so Node can test it.
export const DEFAULT_TIMEOUT_MS = 10000;
export const FROM = "ViTally <help@govitally.org>";

const RESEND_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "help@govitally.org";
const FROM_NAME = "ViTally";

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export function senderFromEnv(
  get,
  { fetch = globalThis.fetch, log = console.error, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const resendKey = clean(get("RESEND_API_KEY"));
  const catcherUrl = clean(get("VITALLY_MAIL_CATCHER_URL"));
  const siteUrl = clean(get("VITALLY_SITE_URL"));

  // Names only, never values.
  const missing = [];
  if (!resendKey && !catcherUrl) missing.push("RESEND_API_KEY or VITALLY_MAIL_CATCHER_URL");
  if (resendKey && catcherUrl) missing.push("only one of RESEND_API_KEY and VITALLY_MAIL_CATCHER_URL");
  if (!siteUrl) missing.push("VITALLY_SITE_URL");
  const isHttp = (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  };
  if (catcherUrl && !resendKey && !isHttp(catcherUrl)) missing.push("VITALLY_MAIL_CATCHER_URL (not an http(s) URL)");
  if (siteUrl && !isHttp(siteUrl)) missing.push("VITALLY_SITE_URL (not an http(s) URL)");
  if (missing.length) return { ok: false, missing };

  const request = ({ to, subject, text, html, idempotencyKey }) => {
    if (resendKey) {
      const headers = { authorization: `Bearer ${resendKey}`, "content-type": "application/json" };
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      return [RESEND_URL, { headers, body: JSON.stringify({ from: FROM, to: [to], subject, text, html }) }];
    }
    return [
      `${catcherUrl.replace(/\/+$/, "")}/api/v1/send`,
      {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: to }],
          Subject: subject,
          Text: text,
          HTML: html,
        }),
      },
    ];
  };

  // Never rejects. Logs a failure once, with an error name and status only:
  // never the address, a key or a response body.
  const sendInvitation = async (mail) => {
    let status;
    try {
      const [url, init] = request(mail);
      const response = await fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
      // A bare 2xx is acceptance, whatever the body.
      if (response.ok) return { sent: true };
      let body;
      try {
        body = JSON.parse(await response.text());
      } catch {
        body = undefined; // non-JSON (an HTML error page) or empty
      }
      const name = body && typeof body.name === "string" && /^[a-z_]{1,64}$/i.test(body.name)
        ? body.name
        : undefined;
      if (status === 409 && name === "invalid_idempotent_request") return { sent: true };
      log(`accounts function: invitation email not sent (${name ?? "error"}, status ${status})`);
      return { sent: false };
    } catch (error) {
      const kind = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network";
      log(`accounts function: invitation email not sent (${kind}${status ? `, status ${status}` : ""})`);
      return { sent: false };
    }
  };

  return { ok: true, siteUrl, sendInvitation };
}
