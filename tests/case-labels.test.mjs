import test from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_COLORS,
  canLabelCase,
  canManageLabels,
  sortLabels,
  labelNameTaken,
} from "../src/case-labels.mjs";

const record = { stage: "preparation", preparerId: "p1", reviewerId: "r1" };

test("label colors are the six, in order", () => {
  assert.deepEqual(LABEL_COLORS, ["sky", "amber", "pink", "green", "violet", "slate"]);
});

test("canLabelCase: admin, follow-up, preparer and reviewer; not others; never closed", () => {
  assert.equal(canLabelCase(record, { id: "a", capabilities: ["admin"] }), true);
  assert.equal(canLabelCase(record, { id: "f", capabilities: ["followup"] }), true);
  assert.equal(canLabelCase(record, { id: "p1", capabilities: ["prepare"] }), true);
  assert.equal(canLabelCase(record, { id: "r1", capabilities: ["review"] }), true);
  assert.equal(canLabelCase(record, { id: "x", capabilities: ["prepare", "review"] }), false);
  assert.equal(canLabelCase(record, null), false);
  const closed = { ...record, stage: "closed" };
  assert.equal(canLabelCase(closed, { id: "a", capabilities: ["admin"] }), false);
  assert.equal(canLabelCase(closed, { id: "p1", capabilities: [] }), false);
});

test("canManageLabels is admin only", () => {
  assert.equal(canManageLabels({ capabilities: ["admin"] }), true);
  assert.equal(canManageLabels({ capabilities: ["followup"] }), false);
  assert.equal(canManageLabels(null), false);
});

test("sortLabels sorts by name ignoring case, without mutating", () => {
  const input = [{ name: "b" }, { name: "A" }, { name: "c" }];
  assert.deepEqual(sortLabels(input).map((l) => l.name), ["A", "b", "c"]);
  assert.deepEqual(input.map((l) => l.name), ["b", "A", "c"]);
});

test("labelNameTaken compares trimmed names ignoring case", () => {
  const labels = [{ id: "1", name: "City Tax" }];
  assert.equal(labelNameTaken(labels, " city tax "), true);
  assert.equal(labelNameTaken(labels, " city tax ", "1"), false);
  assert.equal(labelNameTaken(labels, "Other"), false);
});
