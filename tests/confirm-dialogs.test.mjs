import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  closeCaseDialogBody,
  markReadyToEfileDialogBody,
  markEfiledDialogBody,
  recordFilingResultDialogBody,
  returnToSigningDialogBody,
  requestDocumentsDialogBody,
  putOnHoldDialogBody,
  resumeFromHoldDialogBody,
} from "../src/admin-views.mjs";
import { correctionsDialogBody } from "../src/staff-views.mjs";
import { dialog } from "../src/views.mjs";
import { STATES } from "./confirm-dialogs.states.mjs";

// Moving the confirmations onto confirmBody must not change a single
// character (change unify-confirmation-dialogs, design D1): the strings were
// captured from the code before the move.
const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/confirm-dialogs.json", import.meta.url), "utf8"),
);
const render = {
  closeCaseDialogBody,
  markReadyToEfileDialogBody,
  markEfiledDialogBody,
  recordFilingResultDialogBody,
  returnToSigningDialogBody,
  requestDocumentsDialogBody,
  putOnHoldDialogBody,
  resumeFromHoldDialogBody,
  correctionsDialogBody,
  dialog,
};

test("every confirmation renders exactly as it did before confirmBody", () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(STATES).sort());
  // The date inputs' `max` is today in New York; the golden holds a placeholder.
  const undated = (html) => html.replace(/max="\d{4}-\d{2}-\d{2}"/g, 'max="TODAY"');
  for (const [name, [fn, state]] of Object.entries(STATES))
    assert.equal(undated(render[fn](state)), GOLDEN[name], name);
});

test("a refused Return to signing keeps a typed group open", async () => {
  const { groupsToOpen } = await import("../src/form-values.mjs");
  const html = returnToSigningDialogBody({
    savedCase: { federalMethod: "efile", federalResult: "rejected", stateMethod: "efile", stateResult: "accepted" },
  });
  const groups = [...html.matchAll(/<details class="q-exit-group" data-exit-group="([^"]+)">([^]*?)<\/details>/g)].map((m) => ({
    name: m[1],
    ids: [...m[2].matchAll(/ id="([^"]+)"/g)].map((id) => id[1]),
  }));
  const federal = groups.findIndex((g) => g.name === "federal");
  assert.ok(federal >= 0);
  assert.ok(groups[federal].ids.includes("field-return-to-signing-federal.amount"));
  const drafts = new Map([["field-return-to-signing-federal.amount", "12.345"]]);
  assert.deepEqual(groupsToOpen(groups.map((g) => g.ids), drafts), [federal]);
});

