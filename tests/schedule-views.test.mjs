import test from "node:test";
import assert from "node:assert/strict";
import { scheduleScreen, shiftDrawer, removeShiftDialogBody, shiftLabel, checkInDrawer, removeCheckInDialogBody } from "../src/schedule-views.mjs";
import { nyToday, addDays } from "../src/volunteer-schedule.mjs";
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
    { volunteerId: "p-ari", name: "Ari Shah", roles: ["reviewer"], usualDays: ["tue"], cleared: true, works: "on_site", signedIn: true },
    { volunteerId: "p-hana", name: "Hana Lee", roles: ["preparer", "reviewer"], usualDays: ["sat"], cleared: true, works: "on_site", signedIn: true },
    { volunteerId: "p-wen", name: "Wen Zhou", roles: ["greeter"], usualDays: ["sat", "sun"], cleared: false, works: "on_site", signedIn: false },
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
  // The full label is also the title, so a tag clipped in a narrow shift still shows on hover.
  assert.match(html, /aria-label="Kai Moss, Intaker, 12 pm to 2 pm, Not cleared, No sign-in" title="Kai Moss, Intaker, 12 pm to 2 pm, Not cleared, No sign-in"/);
  // Rows carry the volunteer, cells the hour, and a shift spans its hours.
  assert.match(html, /class="schedule-row" data-volunteer-id="p-hana"/);
  assert.match(html, /data-shift-id="s-hana"[^>]*style="grid-column: 2 \/ span 4"/);
  // A shift past the close is drawn up to the close.
  assert.match(html, /data-shift-id="s-lia"[^>]*style="grid-column: 6 \/ span 2"/);
  // Prev, Next and Today.
  assert.match(html, /data-action="schedule-prev"/);
  assert.match(html, /data-action="schedule-next"/);
  assert.match(html, /data-action="schedule-today"/);
  // The grid scrolls in its own box, a region named apart from the section.
  assert.match(html, /class="schedule-scroll" role="region" aria-label="Shifts"/);
  assert.match(html, /<section class="panel schedule-panel" aria-labelledby="schedule-day">/);
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
  assert.match(html, /class="schedule-grid can-drag"/);
  assert.doesNotMatch(scheduleScreen(state(viewerDay())), /can-drag/);
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

// ---- Check-ins on the admin Schedule (change add-volunteer-check-in, Task 6) ----

// New York is UTC-5 on 2027-02-06. Fictional people only.
const ny = (hm, date = "2027-02-06") => new Date(`${date}T${hm}:00-05:00`).toISOString();
const checkIn = (over = {}) => ({
  checkInId: "ci-rowan",
  revision: 1,
  volunteerId: "p-rowan",
  name: "Rowan Diaz",
  checkedInAt: ny("09:52"),
  checkedOutAt: ny("13:10"),
  endsAt: ny("13:10"),
  state: "out",
  minutes: 198,
  flags: { noCheckOut: false, notScheduled: false, corrected: false, outsideSiteHours: false },
  correctedByName: null,
  ...over,
});
const barsIn = (html) => [...html.matchAll(/<button[^>]*class="check-in-bar[^"]*"[\s\S]*?<\/button>/g)].map((m) => m[0]);
// One volunteer's row of the grid, up to the next row.
const rowOf = (html, volunteerId) => {
  const at = html.indexOf(`data-volunteer-id="${volunteerId}"`);
  const from = html.lastIndexOf('<div class="schedule-row', at);
  const next = html.indexOf('<div class="schedule-row', at);
  return html.slice(from, next === -1 ? undefined : next);
};
const checkInDay = (checkIns, over = {}) =>
  adminDay({ shifts: [shift({ shiftId: "s-rowan", flags: [], counts: "preparer" })], checkIns, ...over });

test("schedule: admin bar under its shift", () => {
  const html = scheduleScreen(state(checkInDay([checkIn()])));
  const row = rowOf(html, "p-rowan");
  const bars = barsIn(row);
  assert.equal(bars.length, 1);
  assert.match(bars[0], />9:52 am – 1:10 pm</);
  assert.doesNotMatch(bars[0], /class="badge/);
  // Cut off at the 10 am opening.
  assert.match(bars[0], /style="left: 0%; width: [\d.]+%"/);
  // Under the shift, in the same row.
  assert.ok(row.indexOf("schedule-shift") < row.indexOf("check-in-bar"));
});

test("schedule: unscheduled row", () => {
  const html = scheduleScreen(
    state(
      checkInDay([
        checkIn({
          checkInId: "ci-ari",
          volunteerId: "p-ari",
          name: "Ari Moss",
          checkedInAt: ny("11:00"),
          checkedOutAt: null,
          endsAt: ny("12:30"),
          state: "open",
          flags: { noCheckOut: false, notScheduled: true, corrected: false, outsideSiteHours: false },
        }),
      ]),
    ),
  );
  const row = rowOf(html, "p-ari");
  assert.match(row, /Ari Moss/);
  const [bar] = barsIn(row);
  assert.match(bar, />11:00 am – now</);
  assert.match(bar, /class="badge[^"]*">Not scheduled</);
  // Rows stay ordered by name: Ari Moss before Rowan Diaz.
  assert.ok(html.indexOf('data-volunteer-id="p-ari"') < html.indexOf('data-volunteer-id="p-rowan"'));
});

test("schedule: missed", () => {
  const html = scheduleScreen(
    state(
      checkInDay([
        checkIn({
          checkedInAt: ny("10:05"),
          checkedOutAt: null,
          endsAt: ny("13:00"),
          state: "missed",
          flags: { noCheckOut: true, notScheduled: false, corrected: false, outsideSiteHours: false },
        }),
      ]),
    ),
  );
  const [bar] = barsIn(html);
  assert.match(bar, />10:05 am – no check-out</);
  assert.match(bar, /class="badge[^"]*">No check-out</);
});

test("schedule: closed day lists check-ins for admins", () => {
  const monday = checkIn({
    checkInId: "ci-ari",
    volunteerId: "p-ari",
    name: "Ari Moss",
    checkedInAt: ny("11:00", "2027-02-08"),
    checkedOutAt: ny("12:00", "2027-02-08"),
    endsAt: ny("12:00", "2027-02-08"),
    flags: { noCheckOut: false, notScheduled: true, corrected: false, outsideSiteHours: true },
  });
  const html = scheduleScreen(state(adminDay({ date: "2027-02-08", weekday: 1, hours: null, shifts: [], checkIns: [monday] })));
  assert.match(html, /The site is closed on Mondays\./);
  assert.doesNotMatch(html, /schedule-grid/);
  const list = html.match(/<ul class="check-in-list">[\s\S]*?<\/ul>/)?.[0] ?? "";
  assert.match(list, /<li>/);
  assert.match(list, /Ari Moss/);
  assert.match(list, /11:00 am – 12:00 pm/);
  assert.match(list, /class="badge[^"]*">Not scheduled</);
  assert.match(list, /class="badge[^"]*">Outside site hours</);
  assert.match(list, /data-action="open-check-in"/);
  // No site hours at all: the list stays below that message too.
  const none = scheduleScreen(state(adminDay({ hours: null, anyOpen: false, shifts: [], checkIns: [monday] })));
  assert.match(none, /Set site hours in Season settings first\.[\s\S]*class="check-in-list"/);
});

test('schedule: each bar is a button with data-action="open-check-in"', () => {
  const html = scheduleScreen(state(checkInDay([checkIn()])));
  const [bar] = barsIn(html);
  assert.match(bar, /^<button type="button" class="check-in-bar"/);
  assert.match(bar, /data-action="open-check-in"/);
  assert.match(bar, /data-check-in-id="ci-rowan"/);
  assert.match(bar, /aria-label="Rowan Diaz, checked in 9:52 am – 1:10 pm"/);
});

test("schedule: a check-in wholly outside the open hours stays reachable by the name", () => {
  const early = checkIn({ checkedInAt: ny("08:00"), checkedOutAt: ny("09:30"), endsAt: ny("09:30") });
  const row = rowOf(scheduleScreen(state(checkInDay([early]))), "p-rowan");
  const [bar] = barsIn(row);
  assert.match(bar, />8:00 am – 9:30 am</);
  assert.doesNotMatch(bar, /style=/);
});

test("schedule: Add check-in on today and past, not future", () => {
  const today = nyToday(Date.now());
  const on = (date, over = {}) => scheduleScreen(state(checkInDay([], { date, ...over })));
  assert.match(on(today), /data-action="add-check-in"[^>]*>\+ Add check-in</);
  assert.match(on(addDays(today, -1)), /\+ Add check-in/);
  assert.doesNotMatch(on(addDays(today, 1)), /Add check-in/);
  assert.match(on(addDays(today, 1)), /\+ Add shift/);
  // Beside Add shift.
  assert.match(on(today), /\+ Add shift[\s\S]*\+ Add check-in/);
  // A closed day still takes a check-in.
  assert.match(on(today, { hours: null }), /\+ Add check-in/);
});

test("schedule: read-only has no check-ins", () => {
  const today = nyToday(Date.now());
  const stray = checkIn({
    checkInId: "ci-ari",
    volunteerId: "p-ari",
    name: "Ari Moss",
    flags: { noCheckOut: false, notScheduled: true, corrected: false, outsideSiteHours: false },
  });
  const html = scheduleScreen(state(viewerDay({ date: today, checkIns: [checkIn(), stray] })));
  assert.equal(html, scheduleScreen(state(viewerDay({ date: today }))));
  assert.doesNotMatch(html, /check-in-bar/);
  assert.doesNotMatch(html, /Add check-in/);
  assert.doesNotMatch(html, /Ari Moss/);
  const closed = scheduleScreen(state(viewerDay({ date: today, hours: null, checkIns: [stray] })));
  assert.doesNotMatch(closed, /check-in-list|Ari Moss|Add check-in/);
});

const checkInDrawerState = (drawer, day = checkInDay([checkIn()])) =>
  state(day, {
    dialog: "check-in",
    dialogContext: { checkInId: drawer.checkInId },
    schedule: { date: day.date, day, drawer: null, checkInDrawer: drawer },
  });

test("drawer: corrected and missed notes", () => {
  const missed = checkIn({
    checkedInAt: ny("10:05"),
    checkedOutAt: null,
    endsAt: ny("13:00"),
    state: "missed",
    flags: { noCheckOut: true, notScheduled: false, corrected: true, outsideSiteHours: false },
    correctedByName: "Sam Lee",
  });
  const html = checkInDrawer(
    checkInDrawerState(
      { mode: "edit", checkInId: "ci-rowan", revision: 1, volunteerId: "p-rowan", name: "Rowan Diaz", checkedIn: "10:05", checkedOut: null },
      checkInDay([missed]),
    ),
  );
  assert.match(html, /Corrected by Sam Lee/);
  assert.match(html, /No check-out\. Counted to 1 pm\./);
  assert.match(html, /data-action="remove-check-in"[^>]*>Remove check-in</);
  assert.match(html, /data-action="save-check-in"/);
  // Checked out is empty.
  assert.match(html, /<select id="check-in-out"[\s\S]*?<option value="" selected>/);
  // Neither note on a plain one.
  const plain = checkInDrawer(
    checkInDrawerState({ mode: "edit", checkInId: "ci-rowan", revision: 1, volunteerId: "p-rowan", name: "Rowan Diaz", checkedIn: "09:52", checkedOut: "13:10" }),
  );
  assert.doesNotMatch(plain, /Corrected by|No check-out\./);
});

test("drawer: an off-step saved time stays selected, in 5-minute steps", () => {
  const html = checkInDrawer(
    checkInDrawerState({ mode: "edit", checkInId: "ci-rowan", revision: 1, volunteerId: "p-rowan", name: "Rowan Diaz", checkedIn: "09:52", checkedOut: "13:10" }),
  );
  const select = (id) => html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
  assert.match(select("check-in-in"), /<option value="09:52" selected>9:52 am</);
  assert.match(select("check-in-in"), /<option value="09:50">9:50 am</);
  assert.match(select("check-in-in"), /<option value="09:55">9:55 am</);
  assert.match(select("check-in-out"), /<option value="13:10" selected>1:10 pm</);
  assert.match(select("check-in-out"), /<option value="24:00">12:00 am</);
  // An edit keeps its volunteer.
  assert.doesNotMatch(html, /name="volunteerId"/);
});

test("drawer: Add check-in picks a volunteer, usual days first", () => {
  const html = checkInDrawer(
    checkInDrawerState({ mode: "add", checkInId: null, revision: null, volunteerId: null, name: null, checkedIn: "10:00", checkedOut: null }, adminDay()),
  );
  const names = [...html.matchAll(/name="volunteerId" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["p-hana", "p-wen", "p-ari"]);
  assert.doesNotMatch(html, /Remove check-in/);
  assert.match(html, /<span>Checked in<\/span>/);
  assert.match(html, /<span>Checked out<\/span>/);
});

test("the check-in drawer and its Remove confirmation render in the shared dialog", () => {
  const drawer = { mode: "add", checkInId: null, revision: null, volunteerId: null, name: null, checkedIn: "10:00", checkedOut: null };
  const html = dialog(checkInDrawerState(drawer, adminDay()));
  assert.match(html, /<h2 id="modal-title">Add check-in<\/h2>/);
  assert.match(html, /id="check-in-form"/);
  assert.match(html, /VOLUNTEERS · SCHEDULE/);
  const ari = checkIn({ checkInId: "ci-ari", volunteerId: "p-ari", name: "Ari Moss" });
  const remove = dialog(
    state(checkInDay([ari]), {
      dialog: "remove-check-in",
      dialogContext: { checkInId: "ci-ari" },
      principal: { access: "staff", clearance: cleared({ isAdmin: true }) },
    }),
  );
  assert.match(remove, /Remove Ari Moss&#39;s check-in\?/);
  assert.match(remove, /data-action="confirm-remove-check-in" data-check-in-id="ci-ari"/);
  assert.match(removeCheckInDialogBody(state(checkInDay([ari]), { dialogContext: { checkInId: "ci-ari" } })), /confirm-remove-check-in/);
});
