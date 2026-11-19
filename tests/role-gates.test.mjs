import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ROLES_CHANGED_TEXT,
  rolesChangedLine,
  DIALOG_CAPABILITY,
  CEILING_DIALOGS,
  NO_CAPABILITY_DIALOGS,
  ownCapabilities,
  dialogLocked,
  addCaseLocked,
} from "../src/role-gates.mjs";

// Fictional people only.
const stateWith = (capabilities, extra = {}) => ({
  principal: { access: "staff", personId: "p-riley" },
  people: [{ id: "p-riley", name: "Riley", capabilities }, { id: "p-sam", name: "Sam", capabilities: ["admin"] }],
  ...extra,
});

test("the line carries the exact copy, escaped", () => {
  assert.equal(ROLES_CHANGED_TEXT, "Your roles changed, so you can't send this any more.");
  const html = rolesChangedLine();
  assert.match(html, /^<p class="field-note roles-changed" role="note">/);
  assert.ok(html.includes("you can&#39;t send this any more."));
});

test("ownCapabilities reads the signed-in person's own entry", () => {
  assert.deepEqual(ownCapabilities(stateWith(["prepare"])), ["prepare"]);
  assert.deepEqual(ownCapabilities({ principal: null, people: [] }), []);
});

test("dialogLocked follows the dialog's capability", () => {
  assert.equal(dialogLocked(stateWith(["prepare"], { dialog: "log-call" })), true);
  assert.equal(dialogLocked(stateWith(["followup"], { dialog: "log-call" })), false);
  assert.equal(dialogLocked(stateWith([], { dialog: "volunteer" })), false);
  assert.equal(dialogLocked(stateWith([], { dialog: "withdraw" })), false);
  assert.equal(dialogLocked({ principal: { access: "applicant" }, people: [], dialog: "withdraw" }), false);
  assert.equal(dialogLocked(stateWith([], {})), false);
});

test("addCaseLocked follows admin for a staff person only", () => {
  assert.equal(addCaseLocked(stateWith(["prepare"])), true);
  assert.equal(addCaseLocked(stateWith(["admin"])), false);
  assert.equal(addCaseLocked({ principal: { access: "applicant" }, people: [] }), false);
});

test("every staff dialog is classified", () => {
  const source = fs.readFileSync(new URL("../src/views.mjs", import.meta.url), "utf8");
  const keys = new Set([...source.matchAll(/state\.dialog === "([a-z-]+)"/g)].map((m) => m[1]));
  const drawers = source.match(/export const DRAWERS = Object\.freeze\(\[([^\]]*)\]\)/)[1];
  for (const m of drawers.matchAll(/"([a-z-]+)"/g)) keys.add(m[1]);
  // The resolve-help drawer is the DRAWERS fall-through branch.
  assert.ok(keys.size > 20);
  const capability = Object.keys(DIALOG_CAPABILITY);
  for (const key of keys) {
    const hits = [capability.includes(key), CEILING_DIALOGS.includes(key), NO_CAPABILITY_DIALOGS.includes(key)].filter(Boolean);
    assert.equal(hits.length, 1, `${key} is in ${hits.length} categories`);
  }
  const all = [...capability, ...CEILING_DIALOGS, ...NO_CAPABILITY_DIALOGS];
  assert.equal(new Set(all).size, all.length, "the categories overlap");
});
