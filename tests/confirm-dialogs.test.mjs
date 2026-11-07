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
