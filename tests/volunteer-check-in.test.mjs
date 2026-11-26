import test from "node:test";
import assert from "node:assert/strict";
import {
  timeLabel,
  barLabel,
  barPlacement,
  timeOptions,
  hhmm,
  missedNote,
  formatHours,
  checkInTags,
  CHECK_IN_REFUSALS,
} from "../src/volunteer-check-in.mjs";

test("timeLabel is New York time, lowercase, no leading zero", () => {
  assert.equal(timeLabel("2027-02-06T14:52:00Z"), "9:52 am");
  assert.equal(timeLabel("2027-07-10T16:00:00Z"), "12:00 pm");
  assert.equal(timeLabel("2027-07-10T13:52:00Z"), "9:52 am");
  assert.equal(timeLabel("2027-02-06T05:05:00Z"), "12:05 am");
});

test("hhmm is the New York wall time", () => {
  assert.equal(hhmm("2027-02-06T14:52:00Z"), "09:52");
  assert.equal(hhmm("2027-07-10T13:52:00Z"), "09:52");
  assert.equal(hhmm("2027-02-07T05:00:00Z"), "00:00");
});

test("barLabel follows the state", () => {
  const checkedInAt = "2027-02-06T14:52:00Z";
  assert.equal(barLabel({ state: "out", checkedInAt, checkedOutAt: "2027-02-06T18:10:00Z" }), "9:52 am – 1:10 pm");
  assert.equal(barLabel({ state: "open", checkedInAt }), "9:52 am – now");
  assert.equal(barLabel({ state: "missed", checkedInAt }), "9:52 am – no check-out");
});

test("barPlacement is a percentage of the open span, cut to the span", () => {
  const hours = { open: 10, close: 16 };
  const a = barPlacement({ checkedInAt: "2027-02-06T15:30:00Z", endsAt: "2027-02-06T17:00:00Z" }, hours);
  assert.equal(Math.round(a.left * 1000) / 1000, 8.333);
  assert.equal(Math.round(a.width * 1000) / 1000, 25);
  const b = barPlacement({ checkedInAt: "2027-02-06T14:00:00Z", endsAt: "2027-02-06T16:00:00Z" }, hours);
  assert.equal(b.left, 0);
  assert.equal(Math.round(b.width * 1000) / 1000, 16.667);
  assert.equal(barPlacement({ checkedInAt: "2027-02-06T22:00:00Z", endsAt: "2027-02-06T23:00:00Z" }, hours), null);
});

test("barPlacement works from the instants, not the minute of day", () => {
  const hours = { open: 10, close: 16 };
  // Same minute: a sliver, never a bar running to close.
  const sliver = barPlacement({ checkedInAt: "2027-02-06T16:00:10Z", endsAt: "2027-02-06T16:00:40Z" }, hours);
  assert.ok(sliver.width < 0.2);
  // Zero length (same instant): no bar.
  assert.equal(barPlacement({ checkedInAt: "2027-02-06T16:00:10Z", endsAt: "2027-02-06T16:00:10Z" }, hours), null);
  // An end at the next New York midnight reaches 100.
  const late = barPlacement({ checkedInAt: "2027-02-06T22:00:00Z", endsAt: "2027-02-07T05:00:00Z" }, { open: 17, close: 24 });
  assert.equal(late.left, 0);
  assert.equal(late.width, 100);
  // An open bar capped mid-span.
  const open = barPlacement({ checkedInAt: "2027-02-06T15:00:00Z", endsAt: "2027-02-06T17:30:00Z" }, hours);
  assert.equal(Math.round(open.left * 1000) / 1000, 0);
  assert.equal(Math.round(open.width * 1000) / 1000, 41.667);
});

test("timeOptions steps by five minutes and keeps an off-step saved time", () => {
  const o = timeOptions("09:52");
  const i = o.indexOf("09:52");
  assert.deepEqual(o.slice(i - 1, i + 2), ["09:50", "09:52", "09:55"]);
  assert.equal(o.length, 289);
  assert.equal(timeOptions(null).length, 288);
  assert.equal(timeOptions(null)[0], "00:00");
  assert.equal(timeOptions(null).at(-1), "23:55");
  assert.equal(timeOptions(null, { allow24: true }).at(-1), "24:00");
  assert.equal(timeOptions("09:50").length, 288);
});

test("missedNote names the counted end", () => {
  assert.equal(missedNote({ endsAt: "2027-02-06T18:00:00Z" }), "No check-out. Counted to 1 pm.");
  assert.equal(missedNote({ endsAt: "2027-02-06T18:30:00Z" }), "No check-out. Counted to 1:30 pm.");
});

test("formatHours is one decimal, half up, whole numbers bare", () => {
  assert.equal(formatHours(390), "6.5");
  assert.equal(formatHours(420), "7");
  assert.equal(formatHours(0), "0");
  assert.equal(formatHours(393), "6.6");
  assert.equal(formatHours(392), "6.5");
});

test("checkInTags keep a fixed order", () => {
  assert.deepEqual(checkInTags({ corrected: true, noCheckOut: true }), ["No check-out", "Corrected"]);
  assert.deepEqual(
    checkInTags({ noCheckOut: true, notScheduled: true, corrected: true, outsideSiteHours: true }),
    ["No check-out", "Not scheduled", "Corrected", "Outside site hours"],
  );
  assert.deepEqual(checkInTags({}), []);
});

// ALREADY_CHECKED_IN and NOT_CHECKED_IN are not here: the strip re-reads on
// them quietly and never says them (design D6).
test("CHECK_IN_REFUSALS has the reasons the check-in RPCs raise that are said", () => {
  assert.deepEqual(Object.keys(CHECK_IN_REFUSALS).sort(), [
    "DEACTIVATED", "IN_FUTURE", "NOT_ON_ROSTER", "OUT_BEFORE_IN", "OVERLAP",
  ]);
});
