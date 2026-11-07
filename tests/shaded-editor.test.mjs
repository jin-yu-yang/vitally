import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICT_SENTENCE,
  DISCARD_QUESTION,
  OPEN_FAILED,
  createEditorSession,
  createShadedSave,
  editorGone,
  rawFromPdfjs,
} from "../src/shaded-editor.mjs";

// The shaded-section editor (change add-preparer-13614c-fields, design D7).
// The repo has no DOM stand-in, so the layer's DOM is covered by the browser
// story; what it decides — the values it reads and when Save, Close and
// Escape may act — is the pure part tested here.

const W2 = "form1[0].page2[0].incomeIncluded[0].formW2s[0]";
const W2_COUNT = "form1[0].page2[0].incomeIncluded[0].formW2sNumber[0]";
const ROW1 = "form1[0].page1[0].namesOf[0].Row1[0].qualifyingChildDependent[0]";
const NOTES = "form1[0].page2[0].IncomeIncludedComment[0].IncomeIncludedComments[0]";

// As pdf.js gives them: a Map keyed by full name, each an array of field
// dicts, with the non-terminal parents (type "") among them.
const fieldObjects = () =>
  new Map([
    ["form1[0]", [{ id: "1R", type: "", kidIds: ["2R"] }]],
    [W2, [{ id: "840R", type: "checkbox", value: "Off", exportValues: "1", name: W2 }]],
    [W2_COUNT, [{ id: "841R", type: "text", value: "", name: W2_COUNT }]],
    [ROW1, [{ id: "1010R", type: "text", value: "Yes", name: ROW1 }]],
    [NOTES, [{ id: "839R", type: "text", value: "", multiline: true, name: NOTES }]],
    ["form1[0].page2[0].incomeIncluded[0].formW2G[0]", [{ id: "850R", type: "checkbox", value: "Yes", exportValues: "Yes" }]],
  ]);

test("rawFromPdfjs reads ticked boxes", () => {
  const raw = rawFromPdfjs(fieldObjects(), new Map());
  assert.equal(raw[W2], false, "Off is not ticked");
  assert.equal(raw["form1[0].page2[0].incomeIncluded[0].formW2G[0]"], true, "an export value is ticked");
  assert.equal(raw[ROW1], "Yes");
  assert.equal(raw[W2_COUNT], "");
  assert.equal(Object.hasOwn(raw, "form1[0]"), false, "a parent is not a field");
  // Edited storage, keyed by annotation id, overrides the stored values.
  const storage = new Map([
    ["840R", { value: true }],
    ["841R", { value: "2" }],
    ["1010R", { value: "" }],
    ["850R", { value: false }],
    ["839R", { value: "收入说明\n第二行" }],
  ]);
  const edited = rawFromPdfjs(fieldObjects(), storage);
  assert.equal(edited[W2], true);
  assert.equal(edited[W2_COUNT], "2");
  assert.equal(edited[ROW1], "");
  assert.equal(edited["form1[0].page2[0].incomeIncluded[0].formW2G[0]"], false);
  assert.equal(edited[NOTES], "收入说明\n第二行");
  // pdf.js's own AnnotationStorage (getRawValue) and a plain object read the same.
  const own = { getRawValue: (id) => storage.get(id) };
  assert.deepEqual(rawFromPdfjs(fieldObjects(), own), edited);
  assert.deepEqual(rawFromPdfjs(Object.fromEntries(fieldObjects()), Object.fromEntries(storage)), edited);
  // A box whose storage holds an export-value string is ticked unless Off.
  assert.equal(rawFromPdfjs(fieldObjects(), new Map([["840R", { value: "Off" }]]))[W2], false);
  assert.equal(rawFromPdfjs(fieldObjects(), new Map([["840R", { value: "1" }]]))[W2], true);
});

// A session over a fake form: `values` is what the layer holds now.
function session({ onSave, explainRefusal } = {}) {
  const form = { values: { [W2]: false, [W2_COUNT]: "" } };
  const changes = [];
  const closed = [];
  const s = createEditorSession({
    read: () => ({ ...form.values }),
    onSave: onSave ?? (async () => {}),
    explainRefusal,
    onChange: (view) => changes.push(view),
    onClose: () => closed.push(true),
  });
  s.start();
  const edit = (name, value) => {
    form.values[name] = value;
    s.mark();
  };
  return { s, form, edit, changes, closed };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("save is disabled until a change", async () => {
  let saves = 0;
  const { s, edit } = session({ onSave: async () => void (saves += 1) });
  assert.equal(s.view().saveEnabled, false);
  await s.save();
  assert.equal(saves, 0, "Save with nothing changed sends nothing");
  edit(W2, true);
  assert.equal(s.view().saveEnabled, true);
  assert.equal(s.view().dirty, true);
  // Changing it back is no change.
  edit(W2, false);
  assert.equal(s.view().saveEnabled, false);
  edit(W2_COUNT, "2");
  await s.save();
  assert.equal(saves, 1);
  // Saved, the editor stays open, and Save waits for the next change.
  assert.equal(s.view().status, "Saved");
  assert.equal(s.view().saveEnabled, false);
  assert.equal(s.view().closed, false);
  edit(W2_COUNT, "3");
  assert.equal(s.view().saveEnabled, true);
  assert.equal(s.view().status, "", "a new change clears Saved");
});

test("save is single-flight", async () => {
  const pending = deferred();
  let calls = 0;
  const { s, edit } = session({
    onSave: () => {
      calls += 1;
      return pending.promise;
    },
  });
  edit(W2, true);
  const first = s.save();
  const second = s.save();
  assert.equal(calls, 1);
  assert.equal(s.view().saving, true);
  assert.equal(s.view().saveEnabled, false);
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(s.view().status, "Saved");
});

test("a change while a save is out stays a change", async () => {
  const pending = deferred();
  let sent = null;
  const { s, edit } = session({
    onSave: (raw) => {
      sent = raw;
      return pending.promise;
    },
  });
  edit(W2, true);
  const saving = s.save();
  edit(W2_COUNT, "2");
  pending.resolve();
  await saving;
  assert.equal(sent[W2_COUNT], "", "the save carries what was there when Save was pressed");
  assert.equal(s.view().dirty, true);
  assert.equal(s.view().saveEnabled, true);
});

test("close with changes asks first", () => {
  const { s, edit, closed } = session();
  // Nothing changed: Close closes.
  const clean = session();
  clean.s.requestClose();
  assert.equal(clean.s.view().closed, true);
  assert.equal(clean.closed.length, 1);
  edit(W2, true);
  s.requestClose();
  assert.equal(s.view().asking, DISCARD_QUESTION);
  assert.equal(DISCARD_QUESTION, "Discard your changes?");
  assert.equal(s.view().closed, false);
  // Cancelling keeps the editor open, with the change.
  s.keepEditing();
  assert.equal(s.view().asking, null);
  assert.equal(s.view().closed, false);
  assert.equal(s.view().dirty, true);
  assert.equal(closed.length, 0);
  // Confirming closes.
  s.requestClose();
  s.confirmDiscard();
  assert.equal(s.view().closed, true);
  assert.equal(closed.length, 1);
  // Closed once only.
  s.requestClose();
  assert.equal(closed.length, 1);
});

test("escape asks like Close, keeps the question on a second Escape, and never during composition", () => {
  const { s, edit } = session();
  edit(W2, true);
  assert.equal(s.escape({ isComposing: true }), false, "an IME's own cancel");
  assert.equal(s.view().asking, null);
  assert.equal(s.escape({}), true);
  assert.equal(s.view().asking, DISCARD_QUESTION);
  // Escape on the question is "keep editing".
  assert.equal(s.escape({}), true);
  assert.equal(s.view().asking, null);
  assert.equal(s.view().closed, false);
  const clean = session();
  clean.s.escape({});
  assert.equal(clean.s.view().closed, true);
});

test("a stage refusal disables Save and keeps the edits", async () => {
  const refusal = Object.assign(new Error("This case is not being prepared."), { code: "INVALID_TRANSITION" });
  const { s, edit, form } = session({
    onSave: async () => {
      throw refusal;
    },
  });
  edit(W2, true);
  await s.save();
  assert.equal(s.view().status, "This case is not being prepared.");
  assert.equal(s.view().saveEnabled, false);
  assert.equal(s.view().dirty, true, "the edits are kept");
  assert.equal(form.values[W2], true);
  edit(W2_COUNT, "2");
  assert.equal(s.view().saveEnabled, false, "Save stays disabled");
  // The right that is no longer allowed is said without sending anything.
  let sent = 0;
  const gone = session({
    onSave: async () => void (sent += 1),
    explainRefusal: () => "Only the case's preparer does preparation work.",
  });
  gone.edit(W2, true);
  await gone.s.save();
  assert.equal(sent, 0);
  assert.equal(gone.s.view().status, "Only the case's preparer does preparation work.");
  assert.equal(gone.s.view().saveEnabled, false);
});

test("a CONFLICT shows the conflict sentence and keeps the edits", async () => {
  const { s, edit } = session({
    onSave: async () => {
      throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
    },
  });
  edit(W2, true);
  await s.save();
  assert.equal(CONFLICT_SENTENCE, "Saved elsewhere since you opened this. Close and reopen to see the latest.");
  assert.equal(s.view().status, CONFLICT_SENTENCE);
  assert.equal(s.view().dirty, true);
  assert.equal(s.view().saveEnabled, false, "the copy is stale: saving it again would meet the same conflict");
  // Close still asks first: the edits are there to copy.
  s.requestClose();
  assert.equal(s.view().asking, DISCARD_QUESTION);
});

test("a value the rules refuse names the field, and Save stays offered", async () => {
  const { s, edit } = session({
    onSave: async () => {
      throw Object.assign(new Error("W-2s # must be a whole number from 0 to 99."), { code: "VALIDATION" });
    },
  });
  edit(W2_COUNT, "2.0");
  await s.save();
  assert.equal(s.view().status, "W-2s # must be a whole number from 0 to 99.");
  assert.equal(s.view().saveEnabled, true);
  // Any other failure says its sentence, or Something went wrong.
  const other = session({
    onSave: async () => {
      throw {};
    },
  });
  other.edit(W2, true);
  await other.s.save();
  assert.equal(other.s.view().status, "Something went wrong.");
  assert.equal(other.s.view().saveEnabled, true);
});

test("the open failure sentence", () => {
  assert.equal(OPEN_FAILED, "The editor could not be opened. Try again, or use Download to fill elsewhere.");
});

test("every change reaches the layer", () => {
  const { s, edit, changes } = session();
  const before = changes.length;
  edit(W2, true);
  assert.ok(changes.length > before);
  assert.equal(changes.at(-1).dirty, true);
  s.requestClose();
  assert.equal(changes.at(-1).asking, DISCARD_QUESTION);
});

// ---- The save behind the editor's Save (review fix round 1) ----------------

// A stand-in for the server and the controller: the stored row's version, a
// save that accepts only on that version (act_save_preparer_fields), and a
// case revision that another window's unrelated action can move.
function shadedServer({ stored = 1 } = {}) {
  const server = {
    stored,
    revision: 10,
    known: 10, // the revision this window last read
    calls: [],
    // The re-read a CONFLICT triggers (dispatch -> loadSelected).
    reread() {
      server.known = server.revision;
    },
    async save(values, basedOnVersion) {
      server.calls.push({ values, basedOnVersion, revision: server.known });
      if (server.known !== server.revision || basedOnVersion !== server.stored) {
        server.reread();
        throw Object.assign(new Error("CONFLICT"), { code: "CONFLICT" });
      }
      server.stored = basedOnVersion + 1;
      server.revision += 1;
      server.known = server.revision;
      return { revision: server.revision };
    },
  };
  return server;
}

const accept = (raw) => ({ values: { ...raw }, errors: [] });

test("after an accepted save the next is based on version + 1, never on a newer save read back", async () => {
  const server = shadedServer({ stored: 1 });
  const save = createShadedSave({
    version: 1,
    check: accept,
    save: async (values, based) => {
      const receipt = await server.save(values, based);
      // Another window saves the section before this window's re-read lands.
      server.stored += 1;
      server.revision += 1;
      server.known = server.revision;
      return receipt;
    },
    storedVersion: () => server.stored,
  });
  await save({ incomeW2s: true });
  assert.equal(save.version(), 2, "the editor's own save made version 2");
  // The other window's save (version 3) is not this editor's: its next Save conflicts.
  await assert.rejects(save({ incomeW2sCount: 2 }), (error) => error.code === "CONFLICT");
  assert.equal(server.stored, 3, "the other window's save was not overwritten");
});

test("a CONFLICT that is only the case's revision is sent once more and saves", async () => {
  const server = shadedServer({ stored: 1 });
  // The office records materials: the case revision moves, the section does not.
  server.revision += 1;
  const save = createShadedSave({ version: 1, check: accept, save: server.save, storedVersion: () => server.stored });
  await save({ incomeW2s: true });
  assert.equal(server.calls.length, 2);
  assert.equal(server.stored, 2);
  assert.equal(save.version(), 2);
});

test("a CONFLICT on the section itself stays a conflict", async () => {
  const server = shadedServer({ stored: 2 }); // saved elsewhere since the editor opened at 1
  const save = createShadedSave({ version: 1, check: accept, save: server.save, storedVersion: () => server.stored });
  await assert.rejects(save({ incomeW2s: true }), (error) => error.code === "CONFLICT");
  assert.equal(server.calls.length, 1, "nothing is sent again");
  assert.equal(server.stored, 2);
  // Through the session: the conflict sentence, and Save off.
  const { s, edit } = session({ onSave: save });
  edit(W2, true);
  await s.save();
  assert.equal(s.view().status, CONFLICT_SENTENCE);
  assert.equal(s.view().saveEnabled, false);
});

test("a revision CONFLICT twice in a row leaves Save offered, without the conflict sentence", async () => {
  const server = shadedServer({ stored: 1 });
  server.revision += 1;
  const moving = async (values, based) => {
    const result = server.save(values, based);
    server.revision += 1; // the case keeps moving under every send
    return result;
  };
  const save = createShadedSave({ version: 1, check: accept, save: moving, storedVersion: () => server.stored });
  const { s, edit } = session({ onSave: save });
  edit(W2, true);
  await s.save();
  assert.equal(server.calls.length, 2, "one more try only");
  assert.notEqual(s.view().status, CONFLICT_SENTENCE);
  assert.match(s.view().status, /Press Save again/);
  assert.equal(s.view().saveEnabled, true);
  assert.equal(save.version(), 1);
});

test("the editor's save refuses what the rules refuse, and a save nobody sent", async () => {
  let sent = 0;
  const refuse = createShadedSave({
    version: 0,
    check: () => ({ values: {}, errors: [{ message: "W-2s # must be a whole number from 0 to 99." }] }),
    save: async () => void (sent += 1),
    storedVersion: () => 0,
  });
  await assert.rejects(refuse({}), (error) => error.code === "VALIDATION" && /W-2s #/.test(error.message));
  assert.equal(sent, 0);
  const unsent = createShadedSave({ version: 0, check: accept, save: async () => null, storedVersion: () => 0 });
  await assert.rejects(unsent({}), (error) => error.code === "NOT_SENT");
  assert.equal(unsent.version(), 0);
});

test("the editor goes when the sign-in or the open case does", () => {
  const open = { principal: { access: "staff" }, selectedCaseId: "case-a" };
  assert.equal(editorGone(open, "case-a"), false);
  assert.equal(editorGone({ ...open, principal: null }, "case-a"), true, "signed out");
  assert.equal(editorGone({ ...open, principal: { access: "client" } }, "case-a"), true);
  // A presenter is not a staff window (remove-presenter-screens): it has no editor.
  assert.equal(editorGone({ ...open, principal: { access: "presenter" } }, "case-a"), true, "a presenter");
  assert.equal(editorGone({ ...open, principal: { access: "applicant" } }, "case-a"), true);
  assert.equal(editorGone({ ...open, selectedCaseId: null }, "case-a"), true, "the case was left");
  assert.equal(editorGone({ ...open, selectedCaseId: "case-b" }, "case-a"), true);
  // A re-read that drops the record for a moment is not leaving the case.
  assert.equal(editorGone({ ...open, savedCase: null }, "case-a"), false);
});
