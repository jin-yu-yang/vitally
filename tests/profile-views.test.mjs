import test from "node:test";
import assert from "node:assert/strict";
import { myProfileScreen, usualDayToggles, PROFILE_PRIVACY_NOTE } from "../src/profile-views.mjs";
import { staffScreen } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people only. The week of Monday, February 1, 2027.
const profile = (over = {}) => ({
  name: "Rowan Diaz",
  roles: ["preparer"],
  usualDays: [2, 6],
  profileRevision: 4,
  weekStart: "2027-02-01",
  weekEnd: "2027-02-07",
  shiftsThisWeek: [
    { shiftId: "s-1", date: "2027-02-02", startHour: 17, endHour: 20, role: "preparer" },
    { shiftId: "s-2", date: "2027-02-06", startHour: 10, endHour: 14, role: "preparer" },
  ],
  ...over,
});
const state = (myProfile, over = {}) => ({
  screen: "my-profile",
  myProfile,
  myProfileUi: { notice: null },
  lists: { myProfile: myProfile ? "ready" : "loading" },
  busy: false,
  ...over,
});
const pressed = (html) => [...html.matchAll(/data-day="(\d)" aria-pressed="(true|false)"/g)].map((m) => [Number(m[1]), m[2] === "true"]);

test("my profile: the title, the overline, the name and the roles", () => {
  const html = myProfileScreen(state(profile({ roles: ["preparer", "reviewer"] })));
  assert.match(html, /<span class="overline">VOLUNTEER<\/span><h1>My profile<\/h1>/);
  assert.match(html, /Rowan Diaz/);
  assert.match(html, /Roles this season[\s\S]*Preparer[\s\S]*Reviewer/);
  assert.doesNotMatch(html, /No roles recorded/);
  assert.match(myProfileScreen(state(profile({ roles: [] }))), /Roles this season[\s\S]*No roles recorded/);
});

test("my profile: seven usual-day toggles, Mon to Sun, the saved ones pressed, with Save and the privacy note", () => {
  const html = myProfileScreen(state(profile()));
  assert.deepEqual(pressed(html), [
    [1, false],
    [2, true],
    [3, false],
    [4, false],
    [5, false],
    [6, true],
    [7, false],
  ]);
  assert.match(html, />Mon<\/button>[\s\S]*>Sun<\/button>/);
  assert.match(html, /<h2[^>]*>Usual days<\/h2>/);
  assert.match(html, /id="my-profile-form"/);
  assert.match(html, /<input type="hidden" id="my-usual-days" name="usualDays" value="2,6">/);
  assert.match(html, /<button type="submit" class="btn primary">Save<\/button>/);
  assert.equal(PROFILE_PRIVACY_NOTE, "Only you and the office admins see your usual days.");
  assert.match(html, /Only you and the office admins see your usual days\./);
});

test("my profile: the shifts this week, in order, or none", () => {
  const html = myProfileScreen(state(profile()));
  assert.match(html, /Your shifts this week[\s\S]*Tue, Feb 2 · 5 pm – 8 pm · Preparer[\s\S]*Sat, Feb 6 · 10 am – 2 pm · Preparer/);
  assert.doesNotMatch(html, /No shifts this week/);
  assert.match(myProfileScreen(state(profile({ shiftsThisWeek: [] }))), /Your shifts this week[\s\S]*No shifts this week\./);
});

test("my profile: busy, or with no profile row to save to, the toggles and Save are off", () => {
  const busy = myProfileScreen(state(profile(), { busy: true }));
  assert.match(busy, /<button type="submit" class="btn primary" disabled>Save<\/button>/);
  assert.equal([...busy.matchAll(/data-action="toggle-usual-day"[^>]* disabled/g)].length, 7);
  const none = myProfileScreen(state(profile({ profileRevision: null, usualDays: [] })));
  assert.match(none, /<button type="submit" class="btn primary" disabled>Save<\/button>/);
});

test("my profile: loading, a failed first read, and the conflict notice", () => {
  assert.match(myProfileScreen(state(null)), /Loading your profile/);
  assert.match(myProfileScreen(state(null, { lists: { myProfile: "failed" } })), /Your profile couldn&#39;t load\./);
  const conflict = myProfileScreen(state(profile(), { myProfileUi: { notice: "Changed elsewhere." } }));
  assert.match(conflict, /role="alert"[^>]*>Changed elsewhere\./);
});

test("usual-day toggles: their own hidden field, ids from it, and no day outside 1 to 7", () => {
  const html = usualDayToggles({ id: "volunteer-usual-days", days: [7, 1, 9] });
  assert.match(html, /data-for="volunteer-usual-days"/);
  assert.match(html, /<input type="hidden" id="volunteer-usual-days" name="usualDays" value="1,7">/);
  assert.equal(pressed(html).filter(([, on]) => on).length, 2);
  assert.match(html, /aria-label="Monday"/);
});

test("staffScreen: a schedule viewer on My profile sees it, and the link is current; anyone else gets home", () => {
  const principal = (scheduleViewer) => ({
    userId: "u1",
    access: "staff",
    personId: "p-rowan",
    personName: "Rowan Diaz",
    clearance: { ...cleared({ capabilities: ["prepare"] }), scheduleViewer },
  });
  const base = {
    people: [{ id: "p-rowan", name: "Rowan Diaz", capabilities: ["prepare"] }],
    cases: [],
    boardFilters: {},
  };
  const html = staffScreen({ ...state(profile()), ...base, lists: { cases: "ready", myProfile: "ready" }, principal: principal(true) });
  assert.match(html, /<h1>My profile<\/h1>/);
  assert.match(html, /data-action="open-my-profile"[^>]*aria-current="page"/);
  const not = staffScreen({ ...state(profile()), ...base, lists: { cases: "ready", myProfile: "ready" }, principal: principal(false) });
  assert.doesNotMatch(not, /<h1>My profile<\/h1>/);
  assert.doesNotMatch(not, /open-my-profile/);
});
