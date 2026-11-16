import test from "node:test";
import assert from "node:assert/strict";
import { setupScreen, siteCheckScreen, awaitingClearance } from "../src/setup-views.mjs";
import { staffScreen } from "../src/views.mjs";

// Fictional people only.
const clearance = (extra = {}) => ({
  cleared: false,
  missing: [{ kind: "form13615" }],
  capabilities: [],
  isAdmin: false,
  siteCoordinatorName: "Jordan Avery",
  ...extra,
});

const staffState = (extra = {}, overrides = {}) => ({
  principal: {
    userId: "u1",
    workspaceId: "w1",
    access: "staff",
    personId: "p-kim",
    personName: "Kim Novak",
    clearance: clearance(extra),
  },
  people: [],
  cases: [],
  assistance: [],
  savedCase: null,
  screen: "staff",
  boardFilters: {},
  openPanels: [],
  draftAnswers: {},
  busy: false,
  error: null,
  retryable: false,
  lists: { cases: "ready", assistance: "ready", volunteers: "ready" },
  volunteers: [],
  volunteerFilters: { search: "", role: "all" },
  dialog: null,
  dialogContext: null,
  ...overrides,
});

test("the setup screen for a missing Form 13615 names it and the site coordinator", () => {
  const html = setupScreen(staffState());
  assert.match(html, /<h1>Finish your setup for this season<\/h1>/);
  assert.match(html, /<li>Upload your signed Form 13615\.<\/li>/);
  assert.match(html, /Ask Jordan Avery, your site coordinator\./);
  assert.match(html, /<button type="button" class="btn primary" data-action="check-clearance" >Check again<\/button>/);
});

test("the setup screen for an unchecked photo ID says so", () => {
  const html = setupScreen(staffState({ missing: [{ kind: "photoId" }] }));
  assert.match(html, /<li>Have your photo ID checked\.<\/li>/);
  assert.doesNotMatch(html, /Form 13615/);
});

test("with no site coordinator name the setup screen leaves the Ask line out", () => {
  const html = setupScreen(staffState({ siteCoordinatorName: null }));
  assert.doesNotMatch(html, /Ask /);
  assert.doesNotMatch(html, /site coordinator/);
  assert.match(html, /data-action="check-clearance"/);
});

test("the site coordinator's name is escaped", () => {
  const html = setupScreen(staffState({ siteCoordinatorName: "<b>Jo</b>" }));
  assert.match(html, /Ask &lt;b&gt;Jo&lt;\/b&gt;, your site coordinator\./);
});

test("awaitingClearance is true for an uncleared or unchecked staff window only", () => {
  assert.equal(awaitingClearance(staffState()), true);
  assert.equal(awaitingClearance(staffState({ cleared: true })), false);
  // A staff principal with no clearance has not been shown to be cleared.
  assert.equal(awaitingClearance({ principal: { access: "staff" } }), true);
  assert.equal(awaitingClearance({ principal: { access: "applicant" } }), false);
  assert.equal(awaitingClearance({ principal: null }), false);
});

test("an uncleared staff member's window shows only the setup screen: no work board, no links", () => {
  const html = staffScreen(staffState());
  assert.match(html, /Finish your setup for this season/);
  assert.doesNotMatch(html, /Work board/);
  assert.doesNotMatch(html, /data-action="open-board"/);
  assert.doesNotMatch(html, /data-action="open-cases"/);
  assert.doesNotMatch(html, /data-action="open-volunteers"/);
  // Help and Sign out stay.
  assert.match(html, /data-action="sign-out"/);
});

test("an uncleared staff member left on a case or an office screen still sees the setup screen", () => {
  for (const screen of ["staff-case", "office-cases", "office-add-case", "office-volunteers"]) {
    const html = staffScreen(staffState({}, { screen, savedCase: { id: "c1", stage: "draft", answers: {}, revision: 1 } }));
    assert.match(html, /Finish your setup for this season/, screen);
  }
});

test("an uncleared ceiling admin gets the Volunteers link and the way back to setup, and the Roster opens", () => {
  const setup = staffScreen(staffState({ isAdmin: true }));
  assert.match(setup, /Finish your setup for this season/);
  assert.match(setup, /data-action="open-volunteers"/);
  // The setup screen is the home link: no work board, no Follow-ups.
  assert.match(setup, /data-action="open-board"[^>]*aria-current="page"><svg[^]*?<\/svg> Finish your setup<\/button>/);
  assert.doesNotMatch(setup, /Work board|Follow-ups/);
  assert.doesNotMatch(setup, /data-action="open-cases"/);
  const roster = staffScreen(staffState({ isAdmin: true }, { screen: "office-volunteers" }));
  assert.doesNotMatch(roster, /Finish your setup for this season/);
  assert.match(roster, /<h1>Volunteers<\/h1>/);
  assert.match(roster, /data-action="open-add-volunteer"/);
  assert.match(roster, /data-action="open-volunteers"[^>]*aria-current="page"/);
  assert.match(roster, /data-action="open-board" ><svg[^]*?<\/svg> Finish your setup<\/button>/);
});

test("a cleared staff member gets the normal staff screens", () => {
  const html = staffScreen(staffState({ cleared: true, missing: [], capabilities: ["prepare"] }, {
    people: [{ id: "p-kim", name: "Kim Novak", capabilities: ["prepare"] }],
  }));
  assert.doesNotMatch(html, /Finish your setup/);
  assert.match(html, /Work board/);
});

// ---- the site check (change add-account-invitations, decision 4) ----------

test("the site check asks for a name and the site's SIDN", () => {
  const html = siteCheckScreen(staffState({ siteCheck: true }));
  assert.match(html, /<h1>Confirm your site<\/h1>/);
  assert.match(html, /<p>Enter your name and this site&#39;s SIDN to finish signing in\.<\/p>|<p>Enter your name and this site's SIDN to finish signing in\.<\/p>/);
  assert.match(html, /<form id="site-check-form"/);
  assert.match(html, /<span>Your name<\/span><input id="site-check-name" name="name" type="text" value="" maxlength="80"[^>]* required>/);
  assert.match(html, /<span>Site number \(SIDN\)<\/span><input id="site-check-sidn" name="sidn"/);
  assert.match(html, /<button type="submit" class="btn primary">Confirm<\/button>/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("the site check keeps the name, says its error, both escaped, and never keeps the SIDN", () => {
  const html = siteCheckScreen(
    staffState({ siteCheck: true }, { siteCheck: { name: "Kim <b>N</b>", error: "That isn't this site's number.", cancelled: false } }),
  );
  assert.match(html, /id="site-check-name" name="name" type="text" value="Kim &lt;b&gt;N&lt;\/b&gt;"/);
  assert.match(html, /role="alert" id="site-check-error">[^]*That isn&#39;t this site&#39;s number\./);
  assert.match(html, /id="site-check-sidn" name="sidn" type="text" value=""/);
});

test("a cancelled site check says so and offers no form", () => {
  const html = siteCheckScreen(staffState({ siteCheck: true }, { siteCheck: { name: "Kim", error: null, cancelled: true } }));
  assert.match(html, /This invitation was cancelled\. Ask your site coordinator to invite you again\./);
  assert.doesNotMatch(html, /site-check-form|Confirm<\/button>/);
});

test("a staff window with siteCheck shows the site check instead of the setup screen, with Sign out", () => {
  const html = staffScreen(staffState({ siteCheck: true, missing: [{ kind: "form13615" }] }));
  assert.match(html, /<h1>Confirm your site<\/h1>/);
  assert.doesNotMatch(html, /Finish your setup for this season/);
  assert.match(html, /data-action="sign-out"/);
  // A ceiling admin left on the Roster sees the site check too.
  const admin = staffScreen(staffState({ siteCheck: true, isAdmin: true }, { screen: "office-volunteers" }));
  assert.match(admin, /Confirm your site/);
  assert.doesNotMatch(admin, /<h1>Volunteers<\/h1>/);
  // The cancelled message keeps Sign out.
  const cancelled = staffScreen(staffState({ siteCheck: true }, { siteCheck: { cancelled: true } }));
  assert.match(cancelled, /This invitation was cancelled/);
  assert.match(cancelled, /data-action="sign-out"/);
  // Without siteCheck: the setup screen as before.
  assert.match(staffScreen(staffState({ siteCheck: false })), /Finish your setup for this season/);
});
