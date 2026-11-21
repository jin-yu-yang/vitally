import test from "node:test";
import assert from "node:assert/strict";
import { checkDrafts, clearableFields, forgetDrafts, formValuesWithLists, groupsToOpen, restoreDraft, textDraft } from "../src/form-values.mjs";

// A form is only read through `new FormData(form)` and `querySelectorAll`, so
// a tiny stand-in with a real FormData is enough (node has no DOM).
function fakeForm(entries, checkboxNames = []) {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return {
    data,
    form: {
      querySelectorAll: (selector) => {
        assert.equal(selector, "input[type=checkbox][name]");
        return checkboxNames.map((name) => ({ name }));
      },
    },
  };
}

test("two ticked boxes of one name read as an array of two", () => {
  const { form, data } = fakeForm(
    [
      ["received", "photo_id"],
      ["received", "ssn_itin"],
    ],
    ["received", "received", "received"],
  );
  assert.deepEqual(formValuesWithLists(form, data), { received: ["photo_id", "ssn_itin"] });
});

test("a checkbox group with nothing ticked reads as an empty list", () => {
  const { form, data } = fakeForm([], ["received", "received"]);
  assert.deepEqual(formValuesWithLists(form, data), { received: [] });
});

test("one ticked box is still a list", () => {
  const { form, data } = fakeForm([["bestContactTime", "weekend"]], ["bestContactTime", "bestContactTime"]);
  assert.deepEqual(formValuesWithLists(form, data), { bestContactTime: ["weekend"] });
});

test("a single text field reads as a string, beside a checkbox group", () => {
  const { form, data } = fakeForm(
    [
      ["bestContactNote", "After 6 pm"],
      ["bestContactTime", "weekend"],
    ],
    ["bestContactTime"],
  );
  assert.deepEqual(formValuesWithLists(form, data), {
    bestContactNote: "After 6 pm",
    bestContactTime: ["weekend"],
  });
});

test("a repeated name that is not a checkbox still becomes an array", () => {
  const { form, data } = fakeForm([
    ["tag", "a"],
    ["tag", "b"],
  ]);
  assert.deepEqual(formValuesWithLists(form, data), { tag: ["a", "b"] });
});

// ---- What a staff form holds until it is sent (app.mjs's formDrafts) -------
// A redraw rebuilds every staff form from saved state, so what is ticked but
// not yet sent is kept by id and put back. A box's value is its option and is
// never empty, so a tick has to be kept as its own state.

// `defaultChecked` is how the redraw drew the box (its `checked` attribute).
const box = (
  id,
  { checked = false, defaultChecked = false, disabled = false, type = "checkbox", name = "received", form = null } = {},
) => ({
  id,
  type,
  name,
  value: id,
  checked,
  defaultChecked,
  disabled,
  form,
});

test("a ticked box is kept as its tick, by its id", () => {
  assert.deepEqual(checkDrafts(box("field-materials-photo_id", { checked: true })), [
    ["field-materials-photo_id", { checked: true }],
  ]);
  assert.deepEqual(checkDrafts(box("field-materials-w2", { defaultChecked: true })), [
    ["field-materials-w2", { checked: false }],
  ]);
});

test("a box ticked and unticked again keeps no draft: a tick saved later from elsewhere shows", () => {
  assert.deepEqual(checkDrafts(box("field-materials-w2")), [["field-materials-w2", null]]);
  assert.deepEqual(checkDrafts(box("field-materials-photo_id", { checked: true, defaultChecked: true })), [
    ["field-materials-photo_id", null],
  ]);
});

test("a radio keeps its whole group: the one it turned off sent no event", () => {
  const form = { elements: [] };
  const a = box("field-x-a", { type: "radio", name: "x", form, defaultChecked: true });
  const b = box("field-x-b", { type: "radio", name: "x", form, checked: true });
  const other = box("field-y-a", { type: "radio", name: "y", form, checked: true });
  form.elements.push(a, b, other);
  assert.deepEqual(checkDrafts(b), [
    ["field-x-a", { checked: false }],
    ["field-x-b", { checked: true }],
  ]);
  // Back to the one drawn: the whole group is as drawn, so no draft is left.
  a.checked = true;
  b.checked = false;
  assert.deepEqual(checkDrafts(a), [
    ["field-x-a", null],
    ["field-x-b", null],
  ]);
});

test("a redraw's unticked box gets its unsaved tick back, and an untick too", () => {
  const rebuilt = box("field-materials-photo_id");
  restoreDraft(rebuilt, { checked: true });
  assert.equal(rebuilt.checked, true);
  const saved = box("field-materials-w2", { checked: true });
  restoreDraft(saved, { checked: false });
  assert.equal(saved.checked, false);
});

test("a tick is not put into a box the redraw disabled: it would not be sent", () => {
  const rebuilt = box("field-materials-photo_id", { disabled: true });
  restoreDraft(rebuilt, { checked: true });
  assert.equal(rebuilt.checked, false);
});

test("typed text still only fills a box the redraw left empty", () => {
  const empty = { id: "field-reason", type: "textarea", value: "" };
  restoreDraft(empty, "Half a reason");
  assert.equal(empty.value, "Half a reason");
  const prefilled = { id: "field-note", type: "textarea", value: "Saved note" };
  restoreDraft(prefilled, "Typed");
  assert.equal(prefilled.value, "Saved note");
  // A field the redraw no longer draws is left alone.
  restoreDraft(null, "Typed");
});

// A box drawn with a saved value (the best time's Note) is refilled with that
// value by every redraw, so an edit to it is kept as `{ value }` and goes back
// whatever the redraw drew. A blank box keeps its text as a plain string.
const note = (value, defaultValue) => ({ id: "field-contact-bestContactNote", type: "textarea", value, defaultValue, disabled: false });

test("typed text in a blank box is kept as its string", () => {
  assert.equal(textDraft(note("Half a reason", "")), "Half a reason");
  assert.equal(textDraft(note("", "")), "");
  // A select has no defaultValue: it is a blank box, as before.
  assert.equal(textDraft({ id: "field-contact-x-outcome", type: "select-one", value: "reached" }), "reached");
});

test("an edit to a box drawn with a saved value is kept as { value }, a cleared box too", () => {
  assert.deepEqual(textDraft(note("Text first", "After 6 pm is best.")), { value: "Text first" });
  assert.deepEqual(textDraft(note("", "After 6 pm is best.")), { value: "" });
});

test("a box edited back to what it was drawn with keeps no draft", () => {
  assert.equal(textDraft(note("After 6 pm is best.", "After 6 pm is best.")), null);
});

test("an edit to a saved value goes back over what the redraw drew, an empty one too", () => {
  const rebuilt = note("After 6 pm is best.", "After 6 pm is best.");
  restoreDraft(rebuilt, { value: "Text first" });
  assert.equal(rebuilt.value, "Text first");
  const cleared = note("After 6 pm is best.", "After 6 pm is best.");
  restoreDraft(cleared, { value: "" });
  assert.equal(cleared.value, "");
  const disabled = { ...note("After 6 pm is best.", "After 6 pm is best."), disabled: true };
  restoreDraft(disabled, { value: "Text first" });
  assert.equal(disabled.value, "After 6 pm is best.", "a disabled box would not be sent");
});

test("a drafted field opens its Exit Form group, and only that group", () => {
  const groups = [["f-method", "f-amount"], ["local.SIT.amount", "local.SIT.method"], ["local.NPT.amount"]];
  assert.deepEqual(groupsToOpen(groups, new Map([["local.SIT.amount", "50.00"]])), [1]);
  assert.deepEqual(groupsToOpen(groups, new Map([["local.NPT.amount", { checked: true }]])), [2]);
  assert.deepEqual(groupsToOpen(groups, new Map()), []);
  assert.deepEqual(groupsToOpen(groups, new Map([["local.SIT.amount", ""], ["f-amount", { value: "" }]])), []);
});

test("forgetDrafts drops only the cleared group's drafts", () => {
  const drafts = new Map([
    ["field-rev-federal.amount", "10.00"],
    ["field-rev-federal.method-efile", { checked: true }],
    ["field-rev-state.amount", "5.00"],
  ]);
  forgetDrafts(drafts, ["field-rev-federal.amount", "field-rev-federal.method-efile", "field-rev-federal.result-refund"]);
  assert.deepEqual([...drafts.keys()], ["field-rev-state.amount"]);
  assert.deepEqual(groupsToOpen([["field-rev-federal.amount"], ["field-rev-state.amount"]], drafts), [1]);
});

test("Clear this section leaves a hidden fixed method alone", () => {
  const fields = [{ type: "text" }, { type: "radio" }, { type: "hidden" }, { type: "date" }];
  assert.deepEqual(clearableFields(fields).map((f) => f.type), ["text", "radio", "date"]);
});

