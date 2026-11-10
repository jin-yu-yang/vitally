import test from "node:test";
import assert from "node:assert/strict";

import { createRedrawHold } from "../src/redraw-hold.mjs";

// A hold whose scheduled flushes are collected, not run, so a test runs them
// when it means to (the app schedules each one a task later).
const harness = () => {
  const scheduled = [];
  let flushes = 0;
  const hold = createRedrawHold({
    flush: () => { flushes += 1; },
    schedule: (fn) => scheduled.push(fn),
  });
  const runScheduled = () => { for (const fn of scheduled.splice(0)) fn(); };
  return { hold, scheduled, runScheduled, flushes: () => flushes };
};

test("nothing held: a render goes ahead", () => {
  const { hold } = harness();
  assert.equal(hold.holding(), false);
  assert.equal(hold.request(false), false);
  assert.equal(hold.pending(), null);
});

test("a press holds a render on every page, and its release flushes once, a task later (#186)", () => {
  const { hold, scheduled, runScheduled, flushes } = harness();
  hold.press();
  assert.equal(hold.request(false), true);
  assert.equal(hold.request(false), true);
  assert.equal(hold.pending(), false, "a held request with no focus");
  hold.release();
  assert.equal(hold.holding(), false);
  assert.equal(scheduled.length, 1, "one flush, not run in the release's own task");
  assert.equal(flushes(), 0);
  runScheduled();
  assert.equal(flushes(), 1);
  // A second release with no press in between does nothing.
  hold.release();
  assert.equal(scheduled.length, 0);
});

test("an IME composition holds a render on any page, and compositionend flushes once", () => {
  const { hold, scheduled, runScheduled, flushes } = harness();
  hold.compositionStart();
  assert.equal(hold.holding(), true);
  // A live redraw and the field's own filter redraw, both mid-composition.
  assert.equal(hold.request(false), true);
  assert.equal(hold.request(true), true);
  assert.equal(hold.pending(), true, "a held request for focus is kept");
  hold.compositionEnd();
  assert.equal(hold.holding(), false);
  assert.equal(scheduled.length, 1, "one flush for every render held during the composition");
  runScheduled();
  assert.equal(flushes(), 1);
  // An end with no composition (a focusout after compositionend) adds nothing.
  hold.compositionEnd();
  assert.equal(scheduled.length, 0);
});

test("a held render is cleared by the render that draws", () => {
  const { hold } = harness();
  hold.compositionStart();
  hold.request(true);
  hold.compositionEnd();
  hold.drawn();
  assert.equal(hold.pending(), null);
});

test("a press during a composition keeps holding until both have ended", () => {
  const { hold, runScheduled } = harness();
  hold.compositionStart();
  hold.press();
  hold.request(false);
  hold.compositionEnd();
  assert.equal(hold.holding(), true, "the press still holds");
  assert.equal(hold.request(false), true);
  runScheduled();
  hold.release();
  assert.equal(hold.holding(), false);
  // The other order: the composition outlasts the press.
  hold.press();
  hold.compositionStart();
  hold.release();
  assert.equal(hold.holding(), true, "the composition still holds");
  hold.compositionEnd();
  assert.equal(hold.holding(), false);
});
