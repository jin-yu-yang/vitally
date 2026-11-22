import test from "node:test";
import assert from "node:assert/strict";
import { myProfilePage } from "../src/profile-views.mjs";
import { staffScreen } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people and links only.
const profile = (over = {}) => ({
  personId: "p-mira",
  name: "Mira Patel",
  email: "mira@example.org",
  phone: "555-0100",
  works: "on_site",
  languages: ["english", "other"],
  otherLanguage: "Tagalog",
  usualDays: ["tue", "thu"],
  revision: 4,
  accountStatus: "active",
  roles: ["preparer"],
  certificates: ["vsc", "basic"],
  form13615: null,
  uploadUrl: "https://example.org/upload",
  siteCoordinatorName: "Dana Wu",
  ...over,
});
const stateOf = (over = {}, list = "ready") => ({
  principal: { access: "staff", personId: "p-mira", personName: "Mira Patel", clearance: cleared() },
  myProfile: profile(over),
  lists: { myProfile: list },
  busy: false,
});
// esc turns an apostrophe into &#39;; read it back for the sentence checks.
const says = (html, sentence) => html.replace(/&#39;/g, "'").includes(sentence);
const page = (over, list) => myProfilePage(stateOf(over, list));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("shows the three sections", () => {
  const html = page();
  for (const heading of ["Your details", "This season", "Passed a higher certification? Send your new Form 13615"])
    assert.ok(html.includes(heading), heading);
  assert.match(html, /<h1>My profile<\/h1>/);
  assert.match(html, /<form id="my-profile-form"/);
  for (const name of ["name", "phone", "works", "languages", "otherLanguage", "usualDays"])
    assert.match(html, new RegExp(`name="${name}"`), name);
  assert.match(html, /value="Mira Patel"/);
  assert.match(html, /value="Tagalog"/);
  assert.match(html, /name="usualDays" value="tue" checked/);
  assert.doesNotMatch(html, /name="usualDays" value="mon" checked/);
  assert.match(html, /name="works" value="on_site" checked/);
  assert.match(html, /name="languages" value="other" checked/);
  assert.match(text(html), /Active/);
});

test("email is read-only with its hint", () => {
  const html = page();
  assert.match(html, /<input[^>]*name="email"[^>]*readonly/);
  assert.match(html, /value="mira@example.org"/);
  assert.ok(html.includes("Your email is how you sign in. Only a site coordinator can change it."));
});

test("roles and certificates have no control", () => {
  const html = page();
  const section = html.match(/<section[^>]*id="my-profile-season"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(section, /<input|<select|<textarea|<button/);
  const plain = text(section);
  assert.match(plain, /Managed by the office/);
  assert.match(plain, /Preparer/);
  assert.match(plain, /VSC/);
  assert.match(plain, /Basic/);
  assert.match(text(page({ roles: [], certificates: [] })), /No roles this season/);
});

test("does not name the site coordinator (Hailey, Nov 22: the line isn't needed)", () => {
  assert.ok(!page().includes("Dana Wu"));
  assert.ok(!page().includes(", your site coordinator."));
});

test("Upload opens the link in a new tab, or the ask text with no link", () => {
  const html = page();
  assert.match(html, /<a class="btn secondary" href="https:\/\/example\.org\/upload" target="_blank" rel="noopener">Upload<\/a>/);
  assert.match(html, /data-action="mark-upload-sent"[^>]*data-document="form13615"/);
  assert.ok(says(html, "I've uploaded it"));
  const none = page({ uploadUrl: null });
  assert.ok(none.includes("Ask your site coordinator how to send it."));
  assert.doesNotMatch(none, /<a [^>]*>Upload/);
  const hostile = page({ uploadUrl: 'https://example.org/"><script>' });
  assert.doesNotMatch(hostile, /<script>/);
});

test("a sent 13615 shows Waiting for review · sent <date>", () => {
  const sent = { sentAt: "2026-11-20T15:00:00Z", reviewedAt: null, reviewReason: null };
  const html = page({ form13615: sent });
  assert.ok(html.includes("Waiting for review · sent Nov 20"));
  assert.ok(!says(html, "I've uploaded it"));
  assert.match(html, /Upload<\/a>/);
  assert.ok(page({ uploadUrl: null, form13615: sent }).includes("Ask your site coordinator how to send it."));
});

test("a returned 13615 shows the reason with I've uploaded it", () => {
  const returned = (reviewReason) => ({ sentAt: null, reviewedAt: "2026-11-20T16:00:00Z", reviewReason });
  const wrong = page({ form13615: returned("Wrong form") });
  assert.ok(wrong.includes("Your site coordinator looked at this: Wrong form. Please send it again or ask them."));
  assert.ok(says(wrong, "I've uploaded it"));
  assert.match(wrong, /Upload<\/a>/);
  const onFile = page({ form13615: returned("Already on file") });
  assert.ok(says(onFile, "Your site coordinator says this is already on file. You don't need to send it again."));
  assert.ok(says(onFile, "I've uploaded it"));
});

test("escapes the reason", () => {
  const html = page({ form13615: { sentAt: null, reviewedAt: "2026-11-20T16:00:00Z", reviewReason: "<img src=x onerror=1>" } });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=1&gt;"));
  assert.ok(!page({ name: '"><script>x</script>' }).includes("<script>"));
});

test("loading and failed states", () => {
  const loading = myProfilePage({ ...stateOf(), myProfile: null, lists: { myProfile: "loading" } });
  assert.match(loading, /Loading/);
  assert.doesNotMatch(loading, /<form|<input/);
  const failed = myProfilePage({ ...stateOf(), myProfile: null, lists: { myProfile: "failed" } });
  assert.ok(says(failed, "My profile couldn't load."));
  assert.doesNotMatch(failed, /<form|<input/);
  // A failed read never draws a Save that would do nothing.
  const stale = myProfilePage({ ...stateOf(), lists: { myProfile: "failed" } });
  assert.doesNotMatch(stale, /<form|<input/);
  // Busy disables Save.
  const busy = myProfilePage({ ...stateOf(), busy: true });
  assert.match(busy, /<button type="submit" class="btn primary" disabled>Save<\/button>/);
});

test("the staff screen routes my-profile for a cleared window and marks the sidebar link current", () => {
  const html = staffScreen({ ...stateOf(), screen: "my-profile", connection: "online", people: [], cases: [], assistance: [] });
  assert.match(html, /<form id="my-profile-form"/);
  assert.match(html, /data-action="open-my-profile"[^>]*aria-current="page"/);
});

test("a cleared window's account row is the My profile link; an uncleared one's is plain text", () => {
  const sam = { id: "p-sam", name: "Sam <b>", capabilities: ["admin"] };
  const base = { connection: "online", people: [sam], cases: [], assistance: [], screen: "staff" };
  const principal = (clearance) => ({ access: "staff", personId: "p-sam", personName: "Sam <b>", clearance });
  const row = (html) => html.match(/<div class="account-row">[\s\S]*?<\/div>\s*(?=<button)/)[0];
  const open = row(staffScreen({ ...base, principal: principal(cleared({ isAdmin: true })) }));
  assert.match(open, /data-action="open-my-profile"/);
  assert.match(open, /<span>My profile<\/span><small class="account-name">Sam &lt;b&gt;<\/small>/);
  assert.doesNotMatch(open, /Signed in as|aria-current/);
  const current = row(staffScreen({ ...base, screen: "my-profile", principal: principal(cleared({ isAdmin: true })) }));
  assert.match(current, /aria-current="page"/);
  const plain = row(staffScreen({ ...base, principal: principal({ ...cleared({ isAdmin: true }), cleared: false, missing: [] }) }));
  assert.doesNotMatch(plain, /<button|open-my-profile/);
  assert.match(text(plain), /Signed in as Sam &lt;b&gt;/);
});
