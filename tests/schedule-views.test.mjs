import test from "node:test";
import assert from "node:assert/strict";
import { scheduleScreen, shiftDrawer, removeShiftDialogBody, shiftLabel } from "../src/schedule-views.mjs";
import { staffScreen, dialog } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people only. 2027-02-06 is a Saturday, open 10 am to 4 pm.
const shift = (over = {}) => ({
  shiftId: "s-1",
  revision: 1,
  volunteerId: "p-rowan",
  name: "Rowan Diaz",
  role: "preparer",
  startHour: 10,
  endHour: 13,
  ...over,
});

const adminDay = (over = {}) => ({
  date: "2027-02-06",
  weekday: 6,
  hours: { open: 10, close: 16 },
  anyOpen: true,
  targets: { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 },
  settingsRevision: 2,
  canEdit: true,
  canEditSettings: false,
  shifts: [
    shift({ shiftId: "s-rowan", endHour: 16, flags: [], counts: "preparer" }),
    shift({ shiftId: "s-hana", volunteerId: "p-hana", name: "Hana Lee", endHour: 14, flags: [], counts: "preparer" }),
    shift({ shiftId: "s-ari", volunteerId: "p-ari", name: "Ari Shah", role: "reviewer", endHour: 16, flags: [], counts: "reviewer" }),
    shift({ shiftId: "s-wen", volunteerId: "p-wen", name: "Wen Zhou", role: "greeter", endHour: 16, flags: [], counts: "onSite" }),
    shift({
      shiftId: "s-kai",
      volunteerId: "p-kai",
      name: "Kai Moss",
      role: "intaker",
      startHour: 12,
      endHour: 14,
      flags: ["notCleared", "noSignIn"],
      counts: null,
    }),
    shift({
      shiftId: "s-lia",
      volunteerId: "p-lia",
      name: "Lia Ruiz",
      role: "reviewer",
      startHour: 14,
      endHour: 17,
      flags: ["roleRemoved", "outsideSiteHours"],
      counts: null,
    }),
  ],
  candidates: [
    { volunteerId: "p-ari", name: "Ari Shah", roles: ["reviewer"], usualDays: [2], cleared: true, works: "on_site", signedIn: true },
    { volunteerId: "p-hana", name: "Hana Lee", roles: ["preparer", "reviewer"], usualDays: [6], cleared: true, works: "on_site", signedIn: true },
    { volunteerId: "p-wen", name: "Wen Zhou", roles: ["greeter"], usualDays: [6, 7], cleared: false, works: "on_site", signedIn: false },
  ],
  ...over,
});

const viewerDay = (over = {}) => ({
  ...adminDay(),
  canEdit: false,
  canEditSettings: false,
  shifts: adminDay().shifts.slice(0, 4).map(({ flags, counts, ...rest }) => rest),
  candidates: undefined,
  ...over,
});

const state = (day, over = {}) => ({
  screen: "schedule",
  schedule: { date: day?.date ?? "2027-02-06", day, drawer: null },
  lists: { schedule: "ready" },
  busy: false,
  ...over,
});

test("schedule: an admin day has the gap header, one column per open hour, tags, coverage and Add shift", () => {
  const html = scheduleScreen(state(adminDay()));
  assert.match(html, /<span class="overline">VOLUNTEERS<\/span><h1>Schedule<\/h1>/);
  assert.match(html, /Saturday, February 6/);
  assert.match(html, /2 of 6 hours have gaps/);
  const hours = [...html.matchAll(/class="schedule-hour" data-hour="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(hours, [10, 11, 12, 13, 14, 15]);
  assert.match(html, />10 am</);
  assert.match(html, />3 pm</);
  for (const tag of ["Not cleared", "No sign-in", "Role removed", "Outside site hours"])
    assert.match(html, new RegExp(`class="badge[^"]*">${tag}<`), tag);
  assert.match(html, /class="schedule-row schedule-coverage"/);
  assert.match(html, /1 more preparer/);
  assert.match(html, />OK</);
  assert.match(html, /data-action="open-add-shift"[^>]*>\+ Add shift</);
  // Every shift is a button, by name order, with its spoken label.
  const shifts = [...html.matchAll(/<button type="button" class="schedule-shift[^"]*" data-action="open-shift" data-shift-id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(shifts, ["s-ari", "s-hana", "s-kai", "s-lia", "s-rowan", "s-wen"]);
  assert.match(html, /aria-label="Rowan Diaz, Preparer, 10 am to 4 pm"/);
  assert.match(html, /aria-label="Kai Moss, Intaker, 12 pm to 2 pm, Not cleared, No sign-in"/);
  // Rows carry the volunteer, cells the hour, and a shift spans its hours.
  assert.match(html, /class="schedule-row" data-volunteer-id="p-hana"/);
  assert.match(html, /data-shift-id="s-hana"[^>]*style="grid-column: 2 \/ span 4"/);
  // A shift past the close is drawn up to the close.
  assert.match(html, /data-shift-id="s-lia"[^>]*style="grid-column: 6 \/ span 2"/);
  // Prev, Next and Today.
  assert.match(html, /data-action="schedule-prev"/);
  assert.match(html, /data-action="schedule-next"/);
  assert.match(html, /data-action="schedule-today"/);
  // The grid scrolls in its own box.
  assert.match(html, /class="schedule-scroll"/);
});

test("schedule: no gaps says No gaps", () => {
  const html = scheduleScreen(state(adminDay({ targets: { preparersNeeded: 0, reviewersNeeded: 0, onSiteNeeded: 0 } })));
  assert.match(html, /No gaps/);
});

test("schedule: a non-admin day has no tags, no coverage, no Add shift, and shifts that open nothing", () => {
  const html = scheduleScreen(state(viewerDay()));
  assert.match(html, /<h1>Schedule<\/h1>/);
  assert.match(html, /Rowan Diaz/);
  assert.match(html, /Preparer/);
  assert.doesNotMatch(html, /schedule-coverage/);
  assert.doesNotMatch(html, /hours have gaps|No gaps/);
  assert.doesNotMatch(html, /Add shift/);
  assert.doesNotMatch(html, /open-shift/);
  assert.doesNotMatch(html, /<button[^>]*class="schedule-shift/);
  assert.doesNotMatch(html, /Not cleared|No sign-in|Role removed|Outside site hours/);
  assert.match(html, /<span class="schedule-shift role-preparer" style="grid-column: 2 \/ span 6">/);
});

test("schedule: an admin's shift carries edge handles for drag; a viewer's carries none", () => {
  const html = scheduleScreen(state(adminDay()));
  const button = (id) => html.split("<button").find((part) => part.includes(`data-action="open-shift" data-shift-id="${id}"`)).split("</button>")[0];
  assert.match(button("s-hana"), /data-edge="start"[\s\S]*data-edge="end"/);
  // A shift running past the close has no end handle: its end is not on screen.
  assert.match(button("s-lia"), /data-edge="start"/);
  assert.doesNotMatch(button("s-lia"), /data-edge="end"/);
  assert.match(html, /class="schedule-cell" data-hour="10"/);
  assert.doesNotMatch(scheduleScreen(state(viewerDay())), /data-edge/);
});

test("schedule: a closed day says so with no grid", () => {
  const html = scheduleScreen(state(adminDay({ date: "2027-02-08", weekday: 1, hours: null, shifts: [] })));
  assert.match(html, /The site is closed on Mondays\./);
  assert.doesNotMatch(html, /schedule-grid/);
  assert.doesNotMatch(html, /Add shift/);
});

test("schedule: no site hours asks for them, with a Season settings link only for a site coordinator", () => {
  const none = { hours: null, anyOpen: false, shifts: [] };
  const admin = scheduleScreen(state(adminDay(none)));
  assert.match(admin, /Set site hours in Season settings first\./);
  assert.doesNotMatch(admin, /data-action="open-season-settings"/);
  assert.doesNotMatch(admin, /schedule-grid/);
  const coordinator = scheduleScreen(state(adminDay({ ...none, canEditSettings: true })));
  assert.match(coordinator, /Set site hours in Season settings first\./);
  assert.match(coordinator, /data-action="open-season-settings"[^>]*>Season settings</);
});

test("schedule: loading and a failed first read", () => {
  assert.match(scheduleScreen(state(null, { lists: { schedule: "loading" } })), /Loading the schedule/);
  assert.match(scheduleScreen(state(null, { lists: { schedule: "failed" } })), /The schedule couldn&#39;t load\./);
});

test("shift label: name, role and hours", () => {
  assert.equal(shiftLabel(shift()), "Rowan Diaz, Preparer, 10 am to 1 pm");
});

const drawerState = (drawer, day = adminDay()) => state(day, { dialog: "shift", schedule: { date: day.date, day, drawer } });

test("shift drawer: Add shift lists usual-day volunteers first, with their roles and tags", () => {
  const html = shiftDrawer(drawerState({ mode: "add", volunteerId: null, role: null, startHour: 10, endHour: 13 }));
  const names = [...html.matchAll(/name="volunteerId" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["p-hana", "p-wen", "p-ari"]);
  assert.match(html, /Hana Lee[\s\S]*Usually here Saturdays/);
  assert.match(html, /Preparer, Reviewer/);
  assert.match(html, /Wen Zhou[\s\S]*Not cleared[\s\S]*No sign-in/);
  // No volunteer yet: no role to choose.
  assert.match(html, /<select id="shift-role" name="role"[^>]*disabled/);
});

test("shift drawer: start and end are limited to the open hours, roles to the volunteer's", () => {
  const html = shiftDrawer(drawerState({ mode: "add", volunteerId: "p-hana", role: "preparer", startHour: 10, endHour: 13 }));
  const select = (name) => html.match(new RegExp(`<select id="shift-${name}"[\\s\\S]*?</select>`))[0];
  const values = (name) => [...select(name).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(values("start"), ["10", "11", "12", "13", "14", "15"]);
  assert.deepEqual(values("end"), ["11", "12", "13", "14", "15", "16"]);
  assert.deepEqual(values("role"), ["preparer", "reviewer"]);
  assert.match(select("start"), /<option value="10" selected>10 am</);
  assert.match(select("end"), /<option value="13" selected>1 pm</);
  assert.match(html, /name="volunteerId" value="p-hana" checked/);
  assert.match(html, /data-action="save-shift"/);
  assert.doesNotMatch(html, /Remove shift/);
});

test("shift drawer: editing a shift past the close still shows its saved hours (Review Focus 2)", () => {
  const day = adminDay();
  const lia = day.shifts.find((entry) => entry.shiftId === "s-lia");
  const html = shiftDrawer(
    drawerState(
      { mode: "edit", shiftId: "s-lia", revision: 1, volunteerId: "p-lia", role: "reviewer", startHour: lia.startHour, endHour: lia.endHour },
      day,
    ),
  );
  assert.match(html, /2 pm – 5 pm/);
  assert.match(html, /<select id="shift-start"[\s\S]*?<option value="14" selected>2 pm</);
  assert.match(html, /<select id="shift-end"[\s\S]*?<option value="17" selected>5 pm</);
  // Its role stays offered though the roster no longer holds it.
  assert.match(html, /<select id="shift-role"[\s\S]*?<option value="reviewer" selected>Reviewer</);
  assert.match(html, /Outside site hours/);
  assert.match(html, /data-action="remove-shift"[^>]*>Remove shift</);
  // An edit keeps its volunteer: no picker.
  assert.doesNotMatch(html, /name="volunteerId"/);
});

test("remove shift: the shared confirmation names the volunteer", () => {
  const day = adminDay();
  const html = dialog(
    state(day, {
      dialog: "remove-shift",
      dialogContext: { shiftId: "s-hana" },
      principal: { access: "staff", clearance: cleared({ isAdmin: true }) },
    }),
  );
  assert.match(html, /Remove Hana Lee&#39;s shift\?/);
  assert.match(html, /data-action="confirm-remove-shift"/);
  assert.match(html, /data-action="close-dialog"/);
  assert.match(removeShiftDialogBody(state(day, { dialogContext: { shiftId: "s-hana" } })), /confirm-remove-shift/);
});

test("the shift drawer renders in the shared dialog", () => {
  const html = dialog(
    drawerState({ mode: "add", volunteerId: null, role: null, startHour: 10, endHour: 13 }),
  );
  assert.match(html, /<h2 id="modal-title">Add shift<\/h2>/);
  assert.match(html, /id="shift-form"/);
});

test("staffScreen: a cleared schedule viewer on the schedule sees it; one who is not gets the board", () => {
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
    lists: { cases: "ready", schedule: "ready" },
    boardFilters: {},
  };
  const html = staffScreen({ ...state(viewerDay()), ...base, principal: principal(true) });
  assert.match(html, /<h1>Schedule<\/h1>/);
  assert.match(html, /data-action="open-schedule"[^>]*aria-current="page"/);
  const not = staffScreen({ ...state(viewerDay()), ...base, principal: principal(false) });
  assert.doesNotMatch(not, /<h1>Schedule<\/h1>/);
  assert.doesNotMatch(not, /open-schedule/);
  assert.match(not, /Work board/);
});
