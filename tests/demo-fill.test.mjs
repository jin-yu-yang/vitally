import test from "node:test";
import assert from "node:assert/strict";
import { demoValues, demoFillButton, demoToolsFromConfig, demoToolsOn } from "../src/demo-fill.mjs";
import {
  markEfiledDialogBody,
  markReadyToEfileDialogBody,
  recordFilingResultDialogBody,
  returnToSigningDialogBody,
} from "../src/admin-views.mjs";
import { preparerQuestionnaire, reviewerQuestionnaire } from "../src/questionnaires.mjs";
import { payloadFor } from "../src/case-actions.mjs";

// The form values a browser would read once the button has filled the form:
// a ticked checkbox sends its value ("yes" / "true"), everything else its text.
const asForm = (values, ticked = "yes") =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === true ? ticked : value]));

const NOW = Date.parse("2026-02-10T15:00:00Z");

const STAFF = { access: "staff" };

test("the auto-fill button names its action", () => {
  assert.match(demoFillButton(true), /data-action="demo-fill"/);
  assert.match(demoFillButton(true), /type="button"/); // never submits the form
});

test("the auto-fill button follows the switch, not the account", () => {
  assert.match(demoFillButton(true), /data-action="demo-fill"/);
  assert.equal(demoFillButton(false), "", "switch off");
  assert.equal(demoFillButton(undefined), "", "no switch given");
  assert.equal(demoFillButton(STAFF), "", "a principal is not the switch");
});

test("the fictional data passes the preparer questionnaire", () => {
  const payload = preparerQuestionnaire(asForm(demoValues(NOW)));
  assert.equal(payload.confirmedBy, "client");
  assert.equal(payload.readyForReviewOn, "2026-02-10");
});

test("the fictional data passes the reviewer questionnaire for every service", () => {
  for (const service of ["same_day", "drop_off", "online", undefined]) {
    for (const signMethod of ["portal", "in_person"]) {
      const values = { ...asForm(demoValues(NOW)), signMethod };
      const payload = reviewerQuestionnaire(values, service);
      assert.equal(payload.exitForm.federal.result, "refund");
      assert.equal(payload.exitForm.state.oweBy, "direct_debit");
      assert.deepEqual(payload.exitForm.local, []);
    }
  }
});

test("the fictional data passes the review-contact form and a corrections resubmit", () => {
  const values = asForm(demoValues(NOW));
  assert.equal(payloadFor("RECORD_REVIEW_CONTACT", {}, values).payload.outcome, "reached");
  assert.doesNotThrow(() => payloadFor("RESUBMIT_REVIEW", {}, values));
});

test("the fictional data passes the filing dialogs", () => {
  const values = asForm(demoValues(NOW), "true");
  assert.doesNotThrow(() => payloadFor("MARK_READY_TO_EFILE", {}, values));
  assert.doesNotThrow(() => payloadFor("MARK_EFILED", {}, values));
  assert.doesNotThrow(() => payloadFor("RETURN_TO_SIGNING", {}, values));
  const { payload: result } = payloadFor("RECORD_FILING_RESULT", { stage: "efiled" }, values);
  assert.equal(result.results.federal.result, "accepted");
  assert.equal(result.fixNote, undefined);
});

test("a filing dialog shows the auto-fill button with the switch on and never with it off", () => {
  const savedCase = { reference: "VT-TEST-0002", answers: { tp_first_name: "Mei", tp_last_name: "Chen" } };
  for (const body of [markReadyToEfileDialogBody, markEfiledDialogBody, recordFilingResultDialogBody, returnToSigningDialogBody]) {
    assert.match(body({ savedCase, principal: { access: "staff" }, demoTools: true }), /data-action="demo-fill"/, `${body.name}, switch on`);
    assert.doesNotMatch(body({ savedCase, principal: STAFF, demoTools: false }), /demo-fill/, `${body.name}, switch off`);
  }
});

test("the switch needs demoTools true and a loopback Supabase URL", () => {
  const local = "http://localhost:54321";
  assert.equal(demoToolsFromConfig({ demoTools: true, supabaseUrl: local }), true);
  assert.equal(demoToolsFromConfig({ demoTools: true, supabaseUrl: "https://abcd.supabase.co" }), false);
  assert.equal(demoToolsFromConfig({ demoTools: "true", supabaseUrl: local }), false);
  assert.equal(demoToolsFromConfig({ demoTools: 1, supabaseUrl: local }), false);
  assert.equal(demoToolsFromConfig({ supabaseUrl: local }), false);
  assert.equal(demoToolsFromConfig(null), false);
});

test("demoToolsOn reads the controller's switch", () => {
  assert.equal(demoToolsOn({ demoTools: true }), true);
  assert.equal(demoToolsOn({}), false);
  assert.equal(demoToolsOn(null), false);
});

test("every fill handler checks the switch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  for (const name of ["demo-fill", "fill-fictional", "regenerate-fictional", "confirm-regenerate"]) {
    const start = source.indexOf(`case "${name}":`);
    assert.ok(start >= 0, `case ${name} exists`);
    const rest = source.slice(start + 1);
    const next = rest.search(/case "|default:/);
    const slice = source.slice(start, start + 1 + (next < 0 ? rest.length : next));
    assert.ok(slice.includes("demoToolsOn("), `${name} checks demoToolsOn`);
    assert.ok(!slice.includes('access !== "presenter"'), `${name} no longer checks presenter`);
  }
  const fnStart = source.indexOf("function fillAssistedIntake");
  assert.ok(fnStart >= 0);
  const body = source.slice(fnStart, fnStart + 400);
  assert.ok(body.includes("demoToolsOn("), "fillAssistedIntake checks demoToolsOn");
  assert.ok(!body.includes('access !== "presenter"'));
});
