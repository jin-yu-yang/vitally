import test from "node:test";
import assert from "node:assert/strict";
import { invitationEmail, INVITATION_DAYS } from "../supabase/functions/accounts/invitation-email.mjs";

const SITE = "https://govitally.org";
const EXPIRES = new Date("2026-11-25T20:00:00Z");
const build = (kind, extra = {}) => invitationEmail({ kind, siteUrl: SITE, expiresAt: EXPIRES, ...extra });

test("invitation lasts seven days", () => {
  assert.equal(INVITATION_DAYS, 7);
});

test("client email is English then 简体", () => {
  const { subject, text } = build("client");
  assert.equal(subject, "You're invited to ViTally · 邀请您使用 ViTally");
  const en = text.indexOf("has invited you to ViTally, where you can answer the questions");
  const zh = text.indexOf("邀请您使用 ViTally");
  assert.ok(en >= 0 && zh > en);
  assert.equal(text.split(SITE).length - 1, 2);
  assert.ok(text.includes("ViTally will never ask for your password"));
  assert.ok(text.includes("ViTally 绝不会通过电子邮件索取"));
  assert.ok(!text.includes("PCDC will never"));
  assert.ok(!text.includes("和 PCDC"));
});

test("volunteer email is English with the site check and setup lines", () => {
  const { subject, text, html } = build("volunteer");
  assert.equal(subject, "You're invited to ViTally as a PCDC VITA volunteer");
  assert.ok(text.includes("volunteer roster"));
  assert.ok(text.includes("confirm your site with your name and the site's SIDN"));
  assert.ok(text.includes("Form 13615"));
  assert.ok(!/[一-鿿]/.test(text + html));
  assert.ok(!/S\d{8}/.test(text + html));
});

test("expiry in New York time", () => {
  const { text } = build("client");
  assert.ok(text.includes("valid until Wednesday, November 25, 2026 at 3:00 PM (New York time)"));
  assert.ok(text.includes("有效期至纽约时间 2026年11月25日 15:00"));
});

test("expiry across daylight saving", () => {
  const expiresAt = new Date("2026-11-05T19:00:00Z");
  const { text } = invitationEmail({ kind: "volunteer", siteUrl: SITE, expiresAt });
  assert.ok(text.includes("Thursday, November 5, 2026 at 2:00 PM"));
});

test("trailing slash", () => {
  for (const kind of ["client", "volunteer"]) {
    const { text, html } = invitationEmail({ kind, siteUrl: "https://govitally.org/", expiresAt: EXPIRES });
    assert.ok(text.includes("go to https://govitally.org and"));
    assert.ok(!text.includes("govitally.org/"));
    assert.ok(html.includes('href="https://govitally.org"'));
    assert.ok(!html.includes("govitally.org/"));
  }
});

test("no six-digit run and no template placeholders", () => {
  const dates = [
    "2026-03-08T07:00Z", "2026-11-01T05:30Z", "2026-11-01T06:30Z", "2026-11-25T05:05Z",
    "2026-11-25T14:05Z", "2026-12-31T23:59Z", "2027-01-01T00:00Z",
  ];
  for (const kind of ["client", "volunteer"]) {
    for (const date of dates) {
      const { text, html } = invitationEmail({ kind, siteUrl: SITE, expiresAt: new Date(date) });
      assert.ok(!/\d{6}/.test(text + html), `${kind} ${date}`);
      assert.ok(!(text + html).includes("{{"), `${kind} ${date}`);
    }
  }
});

test("a blank or non-string site URL is refused", () => {
  for (const siteUrl of [undefined, "", "   ", 42]) {
    assert.throws(() => invitationEmail({ kind: "client", siteUrl, expiresAt: EXPIRES }), TypeError);
  }
});

test("nothing personal", () => {
  const extra = { name: "Rowan Pike", phone: "555-0100", to: "ada@example.org" };
  for (const kind of ["client", "volunteer"]) {
    const { subject, text, html } = build(kind, extra);
    const all = subject + text + html;
    for (const s of Object.values(extra)) assert.ok(!all.includes(s));
  }
});

test("escaping", () => {
  const { html } = invitationEmail({ kind: "client", siteUrl: 'http://x.test/?a=1&b="2"', expiresAt: EXPIRES });
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;"));
  assert.ok(!html.includes('"2"'));
});

test("unknown kind throws", () => {
  assert.throws(() => build("staff"), TypeError);
  assert.throws(() => build(undefined), TypeError);
});
