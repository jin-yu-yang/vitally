import test from "node:test";
import assert from "node:assert/strict";
import { dragResult, createGesture, gestureLive, dragIgnores } from "../src/schedule-drag.mjs";

const hours = { open: 9, close: 17 };
const rowan = (extra = {}) => ({ shiftId: "s1", revision: 3, volunteerId: "v1", role: "preparer", startHour: 10, endHour: 13, ...extra });
const shifts = [
  rowan(),
  { shiftId: "s2", revision: 1, volunteerId: "v1", role: "reviewer", startHour: 16, endHour: 17 },
  { shiftId: "s3", revision: 1, volunteerId: "v2", role: "greeter", startHour: 14, endHour: 15 },
];

test("a create across 14 and 15 takes the role of the earliest shift that day", () => {
  assert.deepEqual(dragResult({ kind: "create", volunteerId: "v1", fromHour: 14, toHour: 15, hours, shifts }), {
    volunteerId: "v1",
    shiftId: null,
    revision: null,
    startHour: 14,
    endHour: 16,
    role: "preparer",
  });
});

test("a create dragged backwards spans the same cells", () => {
  const draft = dragResult({ kind: "create", volunteerId: "v1", fromHour: 15, toHour: 14, hours, shifts });
  assert.equal(draft.startHour, 14);
  assert.equal(draft.endHour, 16);
});

test("a single-cell create is one hour", () => {
  const draft = dragResult({ kind: "create", volunteerId: "v1", fromHour: 14, toHour: 14, hours, shifts });
  assert.deepEqual([draft.startHour, draft.endHour], [14, 15]);
});

test("a create over an occupied cell, or outside the hours, gives null", () => {
  assert.equal(dragResult({ kind: "create", volunteerId: "v1", fromHour: 12, toHour: 14, hours, shifts }), null);
  assert.equal(dragResult({ kind: "create", volunteerId: "v1", fromHour: 16, toHour: 16, hours, shifts }), null);
  assert.equal(dragResult({ kind: "create", volunteerId: "v1", fromHour: 8, toHour: 9, hours, shifts }), null);
  assert.equal(dragResult({ kind: "create", volunteerId: "v1", fromHour: 15, toHour: 16, hours, shifts: [] }), null);
});

test("an end-drag of 10-13 to the 14 cell gives 10-15, at the saved revision", () => {
  assert.deepEqual(dragResult({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, toHour: 14, hours, shifts }), {
    volunteerId: "v1",
    shiftId: "s1",
    revision: 3,
    startHour: 10,
    endHour: 15,
    role: "preparer",
  });
});

test("an end-drag back to the 11 cell shortens to 12", () => {
  const draft = dragResult({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, toHour: 11, hours, shifts });
  assert.deepEqual([draft.startHour, draft.endHour], [10, 12]);
});

test("a start-drag moves the start to the cell; past the end gives null", () => {
  const draft = dragResult({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, toHour: 11, hours, shifts });
  assert.deepEqual([draft.startHour, draft.endHour], [11, 13]);
  assert.equal(dragResult({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, toHour: 14, hours, shifts }), null);
  assert.equal(dragResult({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, toHour: 13, hours, shifts }), null);
});

test("an end-drag to or before the start gives null", () => {
  assert.equal(dragResult({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, toHour: 9, hours, shifts }), null);
});

test("a no-op gesture gives null", () => {
  assert.equal(dragResult({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, toHour: 12, hours, shifts }), null);
  assert.equal(dragResult({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, toHour: 10, hours, shifts }), null);
});

test("a resize stays inside the open hours", () => {
  assert.equal(dragResult({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, toHour: 8, hours, shifts }), null);
  assert.equal(dragResult({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, toHour: 17, hours, shifts }), null);
});

test("one actionId per gesture, and a second pointerup sends nothing (Review Focus 3)", () => {
  const gesture = createGesture({ kind: "create", volunteerId: "v1", fromHour: 14, actionId: "act-1" });
  const first = gesture.finish({ toHour: 15, hours, shifts });
  assert.equal(first.actionId, "act-1");
  assert.equal(first.startHour, 14);
  assert.equal(gesture.finish({ toHour: 15, hours, shifts }), null);
});

test("a gesture that ends in a no-op is spent too", () => {
  const gesture = createGesture({ kind: "start", volunteerId: "v1", shift: rowan(), fromHour: 10, actionId: "act-2" });
  assert.equal(gesture.finish({ toHour: 10, hours, shifts }), null);
  assert.equal(gesture.finish({ toHour: 11, hours, shifts }), null);
});

test("two gestures carry their own actionIds", () => {
  const a = createGesture({ kind: "create", volunteerId: "v1", fromHour: 14, actionId: "a" }).finish({ toHour: 14, hours, shifts });
  const b = createGesture({ kind: "create", volunteerId: "v1", fromHour: 14, actionId: "b" }).finish({ toHour: 14, hours, shifts });
  assert.notEqual(a.actionId, b.actionId);
});

test("a gesture carries its day, and finishing it on another day cancels it", () => {
  const resize = createGesture({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, actionId: "act-3", date: "2027-02-06" });
  assert.equal(resize.finish({ toHour: 13, hours, shifts, date: "2027-02-13" }), null);
  assert.equal(resize.finish({ toHour: 13, hours, shifts, date: "2027-02-06" }), null, "a cancelled gesture is spent");
  const same = createGesture({ kind: "end", volunteerId: "v1", shift: rowan(), fromHour: 12, actionId: "act-4", date: "2027-02-06" });
  const draft = same.finish({ toHour: 13, hours, shifts, date: "2027-02-06" });
  assert.equal(draft.date, "2027-02-06");
  assert.equal(draft.endHour, 14);
});

test("a gesture is live only while its row is still on the page", () => {
  assert.equal(gestureLive({ isConnected: true }), true);
  assert.equal(gestureLive({ isConnected: false }), false);
  assert.equal(gestureLive(null), false);
});

test("a press on a check-in bar never starts a drag", () => {
  const target = (classes) => ({ closest: (selector) => (selector === ".check-in-bar" && classes.includes("check-in-bar") ? {} : null) });
  assert.equal(dragIgnores(target(["check-in-bar"])), true);
  assert.equal(dragIgnores(target(["schedule-cell"])), false);
  assert.equal(dragIgnores(null), false);
});
