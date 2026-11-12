import test from "node:test";
import assert from "node:assert/strict";
import { setupScreen, awaitingClearance } from "../src/setup-views.mjs";
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

test("an uncleared ceiling admin gets only the Volunteers link, and the Roster opens", () => {
  const setup = staffScreen(staffState({ isAdmin: true }));
  assert.match(setup, /Finish your setup for this season/);
  assert.match(setup, /data-action="open-volunteers"/);
  assert.doesNotMatch(setup, /data-action="open-board"/);
  assert.doesNotMatch(setup, /data-action="open-cases"/);
  const roster = staffScreen(staffState({ isAdmin: true }, { screen: "office-volunteers" }));
  assert.doesNotMatch(roster, /Finish your setup for this season/);
  assert.match(roster, /<h1>Volunteers<\/h1>/);
  assert.match(roster, /data-action="open-add-volunteer"/);
  assert.match(roster, /data-action="open-volunteers"[^>]*aria-current="page"/);
});

test("a cleared staff member gets the normal staff screens", () => {
  const html = staffScreen(staffState({ cleared: true, missing: [], capabilities: ["prepare"] }, {
    people: [{ id: "p-kim", name: "Kim Novak", capabilities: ["prepare"] }],
  }));
  assert.doesNotMatch(html, /Finish your setup/);
  assert.match(html, /Work board/);
});
