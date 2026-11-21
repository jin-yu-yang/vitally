// Reads a form into a plain object where a name that appears more than once
// is a list. `Object.fromEntries(new FormData(form))` keeps only the last
// value of a repeated name, so a group of checkboxes needs this instead.
//
// A checkbox group is always a list — one ticked box is a list of one, and
// nothing ticked is `[]` — because an unticked box sends nothing at all and
// "nothing" has to be told apart from "the field is not on this form".
// Every other name is a string, or a list when it repeats.

/**
 * @param {HTMLFormElement} form
 * @param {FormData} [data] the form's entries; read from `form` when omitted
 *   (a test passes its own, since node has no DOM)
 */
export function formValuesWithLists(form, data = new FormData(form)) {
  const checkboxes = new Set(
    [...form.querySelectorAll("input[type=checkbox][name]")].map((box) => box.name),
  );
  const values = {};
  for (const name of checkboxes) values[name] = [];
  for (const [name, value] of data.entries()) {
    if (checkboxes.has(name)) values[name].push(value);
    else if (!Object.hasOwn(values, name)) values[name] = value;
    else values[name] = [].concat(values[name], value);
  }
  return values;
}

// ---- What a staff form holds until it is sent ----------------------------
//
// app.mjs keeps it by field id (formDrafts) and puts it back after every
// redraw, because a redraw rebuilds each staff form from what is saved. Typed
// text in a blank box is kept as its string. A box drawn with a saved value
// (the best time's Note) is drawn with it again by every redraw, so an edit to
// it is kept as `{ value }`. A checkbox's or radio's value is its option and
// is never empty, so a tick is kept as its own state: `{ checked }`. A field
// back to what it was drawn with keeps no draft (null): one left behind would
// hide a change saved later from elsewhere.

export const isCheckable = (field) => field?.type === "checkbox" || field?.type === "radio";

// The fields "Clear this section" empties: a hidden input (a settled return's
// fixed method) is not something the volunteer typed, so it stays.
export const clearableFields = (fields) => [...fields].filter((field) => field?.type !== "hidden");

/**
 * The draft one input event on a text box (or select) records, or null for
 * none. A select has no defaultValue, and on this path (staff forms' unsent
 * entries) none is drawn with a saved value, so it is a blank box. An answer
 * form's selects are drawn with saved answers, but they go through
 * ANSWER_FORMS and never reach here.
 */
export function textDraft(field) {
  const drawn = field.defaultValue ?? "";
  if (!drawn) return field.value;
  return field.value === drawn ? null : { value: field.value };
}

/**
 * The [id, draft] pairs one input event on a checkbox or radio records, a
 * null draft for a box back to how it was drawn. A radio records its whole
 * group: the one it turned off sent no event.
 */
export function checkDrafts(field) {
  const group =
    field.type === "radio" && field.name && field.form
      ? [...field.form.elements].filter((other) => other.type === "radio" && other.name === field.name)
      : [field];
  return group
    .filter((one) => one.id)
    .map((one) => [
      one.id,
      Boolean(one.checked) === Boolean(one.defaultChecked) ? null : { checked: Boolean(one.checked) },
    ]);
}

/**
 * Put one draft back into the field a redraw built. Typed text in a blank box
 * only fills a box the redraw left empty. An edit to a saved value goes back
 * as it was, an empty one too, and so does a tick (or an untick), unless the
 * box is now disabled, when it would not be sent.
 */
export function restoreDraft(field, draft) {
  if (!field) return;
  if (draft !== null && typeof draft === "object") {
    if (field.disabled) return;
    if (Object.hasOwn(draft, "value")) {
      if (!isCheckable(field)) field.value = draft.value;
    } else if (isCheckable(field)) field.checked = draft.checked;
    return;
  }
  if (!field.value) field.value = draft;
}

/**
 * Forget the drafts of the given field ids (a cleared Exit Form group), so a
 * redraw does not put them back and the group reads as empty.
 */
export function forgetDrafts(drafts, ids) {
  for (const id of ids) drafts.delete(id);
}

/**
 * Which collapsible groups a redraw must open again: those with a field that
 * holds a draft. `groups` is one list of field ids per group, in order;
 * `drafts` is app.mjs's draft map. An empty string, null or an edit back to
 * empty is no draft. Returns the indexes of the groups to open.
 */
export function groupsToOpen(groups, drafts) {
  const held = (draft) =>
    draft !== null && draft !== undefined && draft !== "" && !(typeof draft === "object" && draft.value === "");
  return groups.flatMap((ids, index) => (ids.some((id) => held(drafts.get(id))) ? [index] : []));
}
