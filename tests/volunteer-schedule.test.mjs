import test from "node:test";
import assert from "node:assert/strict";
import {
  nyToday,
  addDays,
  isoWeekday,
  weekBounds,
  hourLabel,
  dayLabel,
  weekdayPlural,
  shiftLine,
  coverageRows,
  gapHeader,
  orderCandidates,
  scheduleRows,
  dragRole,
  ROLE_LABELS,
  SHIFT_REFUSALS,
} from "../src/volunteer-schedule.mjs";

test("nyToday gives New York's date, not the viewer's", () => {
  assert.equal(nyToday(Date.parse("2026-11-07T04:30:00Z")), "2026-11-06");
});

test("date arithmetic on plain dates", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(isoWeekday("2027-02-06"), 6);
  assert.equal(isoWeekday("2026-11-01"), 7);
  assert.equal(isoWeekday("2026-10-26"), 1);
});

test("weekBounds runs Monday to Sunday", () => {
  assert.deepEqual(weekBounds("2026-11-01"), { monday: "2026-10-26", sunday: "2026-11-01" });
  assert.deepEqual(weekBounds("2027-03-10"), { monday: "2027-03-08", sunday: "2027-03-14" });
});

test("labels", () => {
  assert.deepEqual([0, 10, 12, 17, 24].map(hourLabel), ["12 am", "10 am", "12 pm", "5 pm", "12 am"]);
  assert.equal(dayLabel("2027-02-06"), "Saturday, February 6");
  assert.equal(weekdayPlural(6), "Saturdays");
  assert.equal(ROLE_LABELS.preparer, "Preparer");
  assert.equal(
    shiftLine({ date: "2027-02-02", startHour: 17, endHour: 20, role: "preparer" }),
    "Tue, Feb 2 · 5 pm – 8 pm · Preparer",
  );
});

const shift = (startHour, endHour, counts) => ({
  shiftId: `s${startHour}${counts}`,
  volunteerId: "v",
  name: "N",
  role: "preparer",
  startHour,
  endHour,
  counts,
});
const targets = { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 1 };

test("coverageRows words what is missing, in order", () => {
  const rows = coverageRows({
    hours: { open: 10, close: 14 },
    targets,
    shifts: [
      shift(11, 12, "preparer"),
      shift(11, 12, "reviewer"),
      shift(11, 12, "onSite"),
      shift(12, 13, "preparer"),
      shift(12, 13, "reviewer"),
      shift(12, 13, "onSite"),
      shift(12, 13, "preparer"),
      shift(13, 14, "preparer"),
      shift(13, 14, "preparer"),
      shift(13, 14, "reviewer"),
      shift(13, 14, null),
    ],
  });
  assert.deepEqual(rows.map((r) => r.hour), [10, 11, 12, 13]);
  assert.equal(rows[0].text, "2 more preparers, 1 more reviewer, 1 more on site");
  assert.equal(rows[1].text, "1 more preparer");
  assert.equal(rows[2].text, "OK");
  assert.equal(rows[3].text, "1 more on site");
  assert.deepEqual(rows[1].missing, { preparers: 1, reviewers: 0, onSite: 0 });
});

test("coverageRows: a target of zero never makes a gap; a closed day has no rows", () => {
  const rows = coverageRows({
    hours: { open: 10, close: 11 },
    targets: { preparersNeeded: 2, reviewersNeeded: 1, onSiteNeeded: 0 },
    shifts: [shift(10, 11, "preparer"), shift(10, 11, "preparer"), shift(10, 11, "reviewer")],
  });
  assert.equal(rows[0].text, "OK");
  assert.deepEqual(coverageRows({ hours: null, targets, shifts: [] }), []);
});

test("gapHeader", () => {
  const rows = (gaps, total) =>
    Array.from({ length: total }, (_, i) => ({ hour: i, text: i < gaps ? "1 more preparer" : "OK" }));
  assert.equal(gapHeader(rows(2, 6)), "2 of 6 hours have gaps");
  assert.equal(gapHeader(rows(0, 6)), "No gaps");
});

test("orderCandidates puts usual-day people first, by name", () => {
  const people = [
    { volunteerId: "a", name: "Ari", usualDays: [1] },
    { volunteerId: "w", name: "Wen", usualDays: [6, 7] },
    { volunteerId: "h", name: "Hana", usualDays: [6] },
  ];
  const ordered = orderCandidates(people, 6);
  assert.deepEqual(ordered.map((c) => c.name), ["Hana", "Wen", "Ari"]);
  assert.deepEqual(ordered.map((c) => c.usual), [true, true, false]);
});

test("dragRole and scheduleRows", () => {
  const shifts = [
    { shiftId: "2", volunteerId: "v1", name: "Ari", role: "reviewer", startHour: 14, endHour: 16 },
    { shiftId: "1", volunteerId: "v1", name: "Ari", role: "preparer", startHour: 10, endHour: 12 },
    { shiftId: "3", volunteerId: "v2", name: "Wen", role: "greeter", startHour: 10, endHour: 12 },
  ];
  assert.equal(dragRole(shifts, "v1"), "preparer");
  assert.equal(dragRole(shifts, "nobody"), null);
  const rows = scheduleRows(shifts);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Ari");
  assert.deepEqual(rows[0].shifts.map((s) => s.shiftId), ["1", "2"]);
});

test("SHIFT_REFUSALS has exactly the six reasons", () => {
  assert.deepEqual(SHIFT_REFUSALS, {
    OUTSIDE_SITE_HOURS: "The shift must stay inside site hours.",
    SITE_CLOSED: "The site is closed that day.",
    OVERLAP: "That volunteer already has a shift at that time.",
    ROLE_NOT_HELD: "That volunteer doesn't have that role this season.",
    NOT_ON_ROSTER: "That volunteer isn't on this season's roster.",
    DEACTIVATED: "That volunteer's account is deactivated.",
  });
});
