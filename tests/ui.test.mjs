import test from "node:test";
import assert from "node:assert/strict";
import {
  describeFocus,
  focusSelectors,
  dialogFocusTarget,
  confirmBody,
  inertWhileDialog,
  trapTarget,
  button,
  icon,
  esc,
  stageBadge,
  relativeDay,
  nextTabIndex,
  OFFICE_CONTACT,
  officeContact,
  formatClientNumber,
  clientNumberLabel,
  clientNumberTag,
  languageCell,
  loadingLine,
  unloadedLine,
  emptyState,
  emptyLine,
  ICON_NAMES,
} from "../src/ui.mjs";

// `describeFocus` is the one piece of the DOM wiring that is worth testing on
// its own, because the thing it has to get right is invisible: reading
// `selectionStart` off a control that has no selection **throws**, and it is
// read before the page is rebuilt, so the throw takes the whole render with it.
// Fake elements stand in for the DOM; only the two properties it reads matter.

const element = ({ tagName = "INPUT", type = "text", name = "field", id = "", caret = 3, throws = false }) => ({
  tagName,
  name,
  id,
  type,
  get selectionStart() {
    if (throws)
      throw new DOMException(
        "Failed to read the 'selectionStart' property from 'HTMLInputElement': The input element's type ('radio') does not support selection.",
        "InvalidStateError",
      );
    return caret;
  },
});

test("a control with no selection is described without reading its caret", () => {
  // Every one of these throws on the getter in Chromium and Firefox, and the
  // accessor exists on the prototype either way — so the type is what decides.
  for (const type of ["radio", "checkbox", "number", "email", "date", "color", "range", "file"]) {
    const found = describeFocus(element({ type, throws: true, name: `f-${type}` }));
    assert.deepEqual(found, { id: null, name: `f-${type}`, action: null, related: [], caret: null }, type);
  }
  // A select has no selection range either, and no `type` worth trusting.
  assert.deepEqual(
    describeFocus({ tagName: "SELECT", name: "residenceState" }),
    { id: null, name: "residenceState", action: null, related: [], caret: null },
  );
});

test("a text-like control keeps its caret", () => {
  for (const type of ["text", "search", "url", "tel", "password"])
    assert.deepEqual(
      describeFocus(element({ type, caret: 5 })),
      { id: null, name: "field", action: null, related: [], caret: 5 },
      type,
    );
  assert.deepEqual(
    describeFocus(element({ tagName: "TEXTAREA", type: undefined, caret: 12 })),
    { id: null, name: "field", action: null, related: [], caret: 12 },
  );
  // An input with no type attribute is a text input.
  assert.deepEqual(describeFocus({ tagName: "INPUT", name: "field", selectionStart: 2 }), {
    id: null,
    name: "field",
    action: null,
    related: [],
    caret: 2,
  });
});

test("a selected range is kept whole, so typing over it still replaces it (#120)", () => {
  // Select all, then a redraw lands before the typing: the range must come
  // back, or the typed text goes in front of the old value.
  const selected = (selectionStart, selectionEnd, selectionDirection) => ({
    tagName: "INPUT",
    type: "text",
    name: "addr_city",
    id: "field-client-addr_city",
    selectionStart,
    selectionEnd,
    selectionDirection,
  });
  assert.deepEqual(describeFocus(selected(0, 12, "forward")), {
    id: "field-client-addr_city",
    name: "addr_city",
    action: null,
    related: [],
    caret: 0,
    selectionEnd: 12,
    direction: "forward",
  });
  assert.equal(describeFocus(selected(2, 9, "backward")).direction, "backward");
  // "none" (no direction) restores as forward, which is what typing over it does.
  assert.equal(describeFocus(selected(2, 9, "none")).direction, "forward");
  // A collapsed caret is described exactly as before: no range keys at all.
  assert.deepEqual(describeFocus(selected(5, 5, "none")), {
    id: "field-client-addr_city",
    name: "addr_city",
    action: null,
    related: [],
    caret: 5,
  });
  // A textarea keeps its range too.
  assert.equal(describeFocus({ tagName: "TEXTAREA", name: "note", selectionStart: 0, selectionEnd: 40 }).selectionEnd, 40);
});

test("the redraw puts a selection back as a range, not a caret (#120)", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.match(app, /setSelectionRange\(focus\.caret, focus\.selectionEnd \?\? focus\.caret, focus\.direction \?\? "none"\)/);
  assert.doesNotMatch(app, /setSelectionRange\(focus\.caret, focus\.caret\)/);
});

test("nothing focused, or nothing to find again, is nothing to restore", () => {
  assert.equal(describeFocus(null), null);
  assert.equal(describeFocus(undefined), null);
  assert.equal(describeFocus({ tagName: "BUTTON", name: "" }), null);
  assert.equal(describeFocus({ tagName: "BODY" }), null);
  assert.equal(describeFocus({ tagName: "INPUT", name: "", id: "" }), null);
});

test("the field is described by its id, so a namesake cannot take the cursor", () => {
  // The staff workspace renders one escalation form per open document request,
  // each with a `reason` box. They share a name and differ only by id, which is
  // scoped to the request (`fieldId(name, scope)`): restoring by name would put
  // the cursor — and the rest of the sentence — in the first request's box.
  const first = element({
    tagName: "TEXTAREA",
    type: undefined,
    name: "reason",
    id: "field-req-1-reason",
    caret: 7,
  });
  const second = element({
    tagName: "TEXTAREA",
    type: undefined,
    name: "reason",
    id: "field-req-2-reason",
    caret: 4,
  });
  assert.deepEqual(describeFocus(first), {
    id: "field-req-1-reason",
    name: "reason",
    action: null,
    related: [],
    caret: 7,
  });
  assert.deepEqual(describeFocus(second), {
    id: "field-req-2-reason",
    name: "reason",
    action: null,
    related: [],
    caret: 4,
  });
  assert.notEqual(describeFocus(first).id, describeFocus(second).id);

  // What the wiring layer does with that: the id wins, the name is the fallback
  // for a control that has none. (`restoreField` in `src/app.mjs` is this
  // lookup against the rebuilt page.)
  const page = [first, second];
  const resolve = (focus) =>
    (focus.id ? page.find((field) => field.id === focus.id) : null) ??
    (focus.name ? page.find((field) => field.name === focus.name) : null);
  assert.equal(resolve(describeFocus(second)), second, "the second box, not the first");
  assert.equal(resolve(describeFocus(first)), first);
  // A field with no id at all still comes back by name.
  const unnamedId = element({ type: "text", name: "lookup", caret: 2 });
  assert.equal(describeFocus(unnamedId).id, null);
  assert.equal(resolve({ id: null, name: "reason", caret: 0 }), first);
});

test("a caret that cannot be read is never allowed to escape", () => {
  // Belt and braces: even a text input whose getter throws (a detached node, a
  // future engine) must describe the field rather than take the render down.
  assert.deepEqual(describeFocus(element({ type: "text", throws: true })), {
    id: null,
    name: "field",
    action: null,
    related: [],
    caret: null,
  });
  // A non-numeric caret is not a caret.
  assert.deepEqual(describeFocus({ tagName: "INPUT", type: "text", name: "f", selectionStart: null }), {
    id: null,
    name: "f",
    action: null,
    related: [],
    caret: null,
  });
});

// A control the person presses, rather than types into. Every `data-action`
// button in this application has neither an id nor a name.
const pressable = (dataset, className = "btn") => ({
  tagName: "BUTTON",
  className,
  dataset,
});

// What `restoreField` does against the rebuilt page, in one place so the test
// proves the selectors resolve rather than just that they were produced.
const resolveAmong = (page, focus) => {
  for (const selector of focusSelectors(focus)) {
    const found = page.find((element) => matches(element, selector));
    if (found) return found;
  }
  return null;
};
const matches = (element, selector) => {
  const parts = [...selector.matchAll(/\[([a-z-]+)="((?:[^"\\]|\\.)*)"\]/g)];
  if (!parts.length) return false;
  return parts.every(([, attribute, raw]) => {
    const value = raw.replace(/\\(.)/g, "$1");
    if (attribute === "id") return (element.id ?? "") === value;
    if (attribute === "name") return (element.name ?? "") === value;
    const key = attribute
      .replace(/^data-/, "")
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return (element.dataset?.[key] ?? null) === value;
  });
};

test("a button with no id and no name is described by what it does", () => {
  const help = pressable({ action: "open-help" });
  assert.deepEqual(describeFocus(help), {
    id: null,
    name: null,
    action: { attribute: "data-action", value: "open-help" },
    related: [],
    caret: null,
  });
  // It resolves back to itself on the rebuilt page — this is the whole point:
  // a shared update used to send the keyboard to the top of the document.
  const page = [pressable({ action: "sign-out" }), help, pressable({ action: "open-applications" })];
  assert.equal(resolveAmong(page, describeFocus(help)), help);

  // The workflow and assistance vocabularies are described the same way.
  assert.deepEqual(describeFocus(pressable({ caseAction: "CLAIM_REVIEW" })).action, {
    attribute: "data-case-action",
    value: "CLAIM_REVIEW",
  });
  assert.deepEqual(describeFocus(pressable({ assistanceAction: "CLAIM" })).action, {
    attribute: "data-assistance-action",
    value: "CLAIM",
  });
});

test("a related id tells one namesake button from another", () => {
  // Every open request renders the same button; only the request id differs.
  const first = pressable({ caseAction: "RESPOND_DOCUMENT", requestId: "req-1" });
  const second = pressable({ caseAction: "RESPOND_DOCUMENT", requestId: "req-2" });
  const page = [first, second];
  assert.equal(resolveAmong(page, describeFocus(second)), second, "the second request");
  assert.equal(resolveAmong(page, describeFocus(first)), first);
  assert.deepEqual(describeFocus(second).related, [
    { attribute: "data-request-id", value: "req-2" },
  ]);
  // Ambiguity resolves to the first match only when nothing disambiguates:
  // a control that belongs to no row is looked up by what it does.
  const plain = pressable({ caseAction: "RESPOND_DOCUMENT" });
  assert.deepEqual(describeFocus(plain).related, []);
  assert.equal(resolveAmong(page, describeFocus(plain)), first);

  // A row that is gone after the rebuild is not found — it never steals the
  // keyboard for a different request. This is the whole point of naming the
  // row: the other button is live, and a keypress on it would send a real
  // workflow action against the wrong request.
  assert.equal(resolveAmong([second], describeFocus(first)), null);
  assert.equal(resolveAmong([], describeFocus(first)), null);
  // The one that is still there is still found, on the same page.
  assert.equal(resolveAmong([second], describeFocus(second)), second);
});

test("a field whose row is gone does not put the cursor in a namesake", () => {
  // The staff workspace renders one escalation form per open document request:
  // same `reason` name, ids scoped to the request. If the focused request is
  // resolved in a background rebuild while another stays open, the rest of the
  // sentence must not be typed into — and sent for — the other request.
  const box = (requestId, caret) => ({
    tagName: "TEXTAREA",
    id: `field-${requestId}-reason`,
    name: "reason",
    caret,
    get selectionStart() {
      return caret;
    },
  });
  const one = box("req-1", 9);
  const two = box("req-2", 0);
  assert.equal(resolveAmong([one, two], describeFocus(one)), one);
  assert.equal(resolveAmong([one, two], describeFocus(two)), two);
  assert.equal(resolveAmong([two], describeFocus(one)), null, "not the other box");
  // A control with no id of its own still comes back by name.
  const lookup = { tagName: "INPUT", type: "text", name: "lookup", selectionStart: 2 };
  assert.deepEqual(focusSelectors(describeFocus(lookup)), ['[name="lookup"]']);
  assert.equal(resolveAmong([lookup], describeFocus(lookup)), lookup);
});

test("every selector names the row as precisely as the element did", () => {
  // The id is the whole answer when there is one, and the row-specific action
  // is the only action selector for a control that named its row. Nothing in
  // this list can match a different row's control.
  assert.deepEqual(
    focusSelectors({
      id: "field-req-1-reason",
      name: "reason",
      action: { attribute: "data-action", value: "escalate" },
      related: [{ attribute: "data-request-id", value: "req-1" }],
      caret: null,
    }),
    [
      '[id="field-req-1-reason"]',
      '[data-action="escalate"][data-request-id="req-1"]',
    ],
  );
  // No id: the name is the fallback for a control that has none.
  assert.deepEqual(
    focusSelectors({ id: null, name: "lookup", action: null, related: [], caret: 0 }),
    ['[name="lookup"]'],
  );
  // No row: what it does is all there is, and all that is needed.
  assert.deepEqual(
    focusSelectors({
      id: null,
      name: null,
      action: { attribute: "data-action", value: "open-help" },
      related: [],
      caret: null,
    }),
    ['[data-action="open-help"]'],
  );
  // A row named once is never widened back to the bare action.
  const rowScoped = focusSelectors({
    id: null,
    name: null,
    action: { attribute: "data-case-action", value: "RESPOND_DOCUMENT" },
    related: [{ attribute: "data-request-id", value: "req-1" }],
    caret: null,
  });
  assert.deepEqual(rowScoped, [
    '[data-case-action="RESPOND_DOCUMENT"][data-request-id="req-1"]',
  ]);
  assert.ok(!rowScoped.includes('[data-case-action="RESPOND_DOCUMENT"]'));
  assert.deepEqual(focusSelectors(null), []);
  assert.deepEqual(focusSelectors({ id: null, name: null, action: null, related: [] }), []);
  // A value carrying a quote or a backslash cannot break out of the selector.
  assert.deepEqual(
    focusSelectors({ id: null, name: 'we"ird\\', action: null, related: [] }),
    ['[name="we\\"ird\\\\"]'],
  );
});

test("a dialog always has somewhere to put the keyboard", () => {
  const close = { tagName: "BUTTON", className: "close-btn" };
  const container = { tagName: "SECTION", className: "modal" };
  const control = { tagName: "BUTTON", className: "btn primary" };
  const disabled = { tagName: "BUTTON", className: "btn primary", disabled: true };
  // The first real control wins.
  assert.equal(dialogFocusTarget([close, control], container), control);
  assert.equal(dialogFocusTarget([control, close], container), control);
  // A dialog whose body is only prose still takes the keyboard, on its close
  // button — this is the "Need help?" dialog, which used to land on BODY.
  assert.equal(dialogFocusTarget([close], container), close);
  // Nothing focusable at all falls back to the container, which is why the
  // modal carries tabindex="-1".
  assert.equal(dialogFocusTarget([], container), container);
  assert.equal(dialogFocusTarget([disabled], container), container);
  assert.equal(dialogFocusTarget([], null), null);
  assert.equal(dialogFocusTarget(), null);
});

test("a confirmation has one shape: lead, note, form or confirm, keep", () => {
  const confirm = button("Do it", "confirm-thing", "primary full");
  const keep = button("Keep it", "close-dialog", "text");
  // The simplest: a sentence, the confirm control, the keep button.
  assert.equal(confirmBody({ lead: "It happens.", confirm, keep: "Keep it" }), `<p>It happens.</p>${confirm}${keep}`);
  // A note sits between the lead and the confirm.
  assert.equal(
    confirmBody({ lead: "It happens.", note: { icon: "shield", html: "Nothing else." }, confirm, keep: "Keep it" }),
    `<p>It happens.</p><div class="info-note">${icon("shield")}<p>Nothing else.</p></div>${confirm}${keep}`,
  );
  // A form wraps its fields and the confirm, and the keep button stays outside it.
  assert.equal(
    confirmBody({ lead: "L", form: { fields: "<i>f</i>" }, confirm, keep: "Keep it" }),
    `<p>L</p><form class="staff-form"><i>f</i>${confirm}</form>${keep}`,
  );
  // Something said before everything else (the corrections dialog's refusal).
  assert.equal(
    confirmBody({ before: "<div>refused</div>", lead: "L", confirm, keep: "Keep it" }),
    `<div>refused</div><p>L</p>${confirm}${keep}`,
  );
  // No sentence, no empty paragraph: a missing or empty lead adds nothing.
  assert.equal(confirmBody({ confirm, keep: "Keep it" }), `${confirm}${keep}`);
  assert.equal(confirmBody({ lead: "", confirm, keep: "Keep it" }), `${confirm}${keep}`);
  assert.doesNotMatch(confirmBody({ confirm, keep: "Keep it" }), /undefined/);
});

test("a confirmation note always comes before the form", () => {
  const html = confirmBody({
    lead: "L",
    note: { icon: "info", html: "n" },
    form: { fields: "<input>" },
    confirm: "<button>",
    keep: "Keep",
  });
  assert.ok(html.indexOf('class="info-note"') >= 0);
  assert.ok(html.indexOf('class="info-note"') < html.indexOf("<form"));
});

test("only the dialog and the live regions stay out of inert", () => {
  const el = (...names) => ({ classList: { contains: (name) => names.includes(name) } });
  for (const name of ["modal-backdrop", "connection-notice", "problem-banner"])
    assert.equal(inertWhileDialog(el(name)), false, name);
  for (const name of ["skip", "client-header", "client-shell", "app-shell", "site-footer"])
    assert.equal(inertWhileDialog(el(name)), true, name);
  assert.equal(inertWhileDialog(el("connection-notice", "reconnecting")), false);
});

test("Tab stays inside a dialog, from its ends and from the dialog itself", () => {
  const first = { name: "first" };
  const middle = { name: "middle" };
  const last = { name: "last" };
  const container = { name: "modal" };
  const controls = [first, middle, last];
  assert.equal(trapTarget(controls, last, false), first);
  assert.equal(trapTarget(controls, first, true), last);
  assert.equal(trapTarget(controls, middle, false), null);
  assert.equal(trapTarget(controls, middle, true), null);
  assert.equal(trapTarget(controls, first, false), null);
  assert.equal(trapTarget(controls, last, true), null);
  // The dialog itself, or its text, holds the keyboard: Tab goes in at the start,
  // Shift+Tab at the end, and never out behind the dialog.
  assert.equal(trapTarget(controls, container, false), first);
  assert.equal(trapTarget(controls, container, true), last);
  assert.equal(trapTarget(controls, null, true), last);
  // One control: it keeps the keyboard either way.
  assert.equal(trapTarget([first], first, false), first);
  assert.equal(trapTarget([first], first, true), first);
  // No controls: the browser decides.
  assert.equal(trapTarget([], container, false), null);
  assert.equal(trapTarget(), null);
});

test("the shared helpers still escape and name stages", () => {
  assert.equal(esc('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
  assert.match(stageBadge("corrections_required"), /Corrections in progress/);
  assert.match(stageBadge("nonsense"), /Application/);
});

test("dates on the board read as days, not timestamps", () => {
  const now = new Date(2026, 8, 14, 12, 0).getTime();
  const at = (day, hour = 9) => new Date(2026, 8, day, hour, 0).toISOString();
  assert.equal(relativeDay(at(14), now), "Today");
  assert.equal(relativeDay(at(13, 23), now), "Yesterday");
  assert.equal(relativeDay(at(12), now), "2 days ago");
  assert.equal(relativeDay(at(8), now), "6 days ago");
  assert.equal(relativeDay(at(3), now), "Sep 3");
  assert.equal(relativeDay("not a date", now), "");
  assert.equal(relativeDay(null, now), "");
});

test("stage badges carry the design's family and keep their words", () => {
  const family = (stage) => /class="badge ([a-z]+)"/.exec(stageBadge(stage))?.[1];
  assert.equal(family("draft"), "intake");
  assert.equal(family("received"), "intake");
  for (const stage of ["preparation_ready", "preparing", "review_ready", "reviewing"])
    assert.equal(family(stage), "prep", stage);
  assert.equal(family("corrections_required"), "amend");
  assert.equal(family("review_approved"), "filing");
  assert.equal(family("closed"), "neutral");
  assert.equal(family("nonsense"), "neutral");
  assert.match(stageBadge("review_approved"), /Ready to exit/);
  assert.equal(family("screening"), "intake");
  assert.equal(family("ready_to_efile"), "filing");
  assert.equal(family("efiled"), "filing");
});

test("a stage badge shows the staff name, or the client's label for a client", () => {
  assert.match(stageBadge("screening"), /Screening in progress/);
  assert.match(stageBadge("screening", "zh-Hans", { audience: "client" }), /审核中/);
  assert.doesNotMatch(stageBadge("screening", "zh-Hans", { audience: "client" }), /Screening in progress/);
  assert.match(stageBadge("review_approved", "en", { audience: "client" }), /Ready to sign/);
  for (const stage of ["screening", "ready_to_efile", "efiled"]) assert.doesNotMatch(stageBadge(stage), /class="badge neutral"/, stage);
});

test("arrow keys, Home and End move between tabs and wrap around", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 5), 1);
  assert.equal(nextTabIndex("ArrowRight", 4, 5), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 5), 4);
  assert.equal(nextTabIndex("ArrowLeft", 3, 5), 2);
  assert.equal(nextTabIndex("Home", 3, 5), 0);
  assert.equal(nextTabIndex("End", 1, 5), 4);
  assert.equal(nextTabIndex("Enter", 1, 5), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});

test("the office contact is the one real phone number and address, as links", () => {
  assert.deepEqual({ ...OFFICE_CONTACT }, {
    phone: "(215) 922-6156",
    tel: "+12159226156",
    email: "vita@chinatown-pcdc.org",
  });
  const html = officeContact();
  assert.match(html, /<div class="office-contact">/);
  assert.match(html, /<a href="tel:\+12159226156"[^>]*>[\s\S]*\(215\) 922-6156<\/a>/);
  assert.match(html, /<a href="mailto:vita@chinatown-pcdc\.org"[^>]*>[\s\S]*vita@(?:<wbr>)?chinatown-pcdc\.org<\/a>/);
});

test("client numbers read as #, padded to three digits", () => {
  assert.equal(formatClientNumber(93), "#093");
  assert.equal(formatClientNumber(1), "#001");
  assert.equal(formatClientNumber(101), "#101");
  assert.equal(formatClientNumber(1000), "#1000");
  assert.equal(formatClientNumber(null), null);
  assert.equal(formatClientNumber(undefined), null);
});

test("a case without a number says why", () => {
  assert.equal(clientNumberLabel({ clientNumber: 93, stage: "received" }), "#093");
  assert.equal(clientNumberLabel({ clientNumber: null, stage: "draft" }), "No number yet");
  assert.equal(clientNumberLabel({ clientNumber: null, stage: "closed" }), "Never sent");
  assert.equal(
    clientNumberTag({ clientNumber: 93, stage: "received" }),
    '<span class="client-number">#093</span>',
  );
  assert.equal(
    clientNumberTag({ clientNumber: null, stage: "closed" }),
    '<span class="client-number none">Never sent</span>',
  );
});

// Part 4d: times, days, badges and client numbers in the client's language.
test("times and days follow the language; English is the default", async () => {
  const { formatTime } = await import("../src/ui.mjs");
  const value = new Date(2026, 9, 5, 15, 4).toISOString();
  assert.equal(formatTime(value, "en"), formatTime(value));
  assert.match(formatTime(value), /^Oct 5/);
  assert.match(formatTime(value, "zh-Hans"), /10月5日/);
  assert.match(formatTime(value, "zh-Hant"), /月/);
  assert.equal(formatTime("not a date", "zh-Hans"), "");
  const now = new Date(2026, 8, 14, 12, 0).getTime();
  const at = (day, hour = 9) => new Date(2026, 8, day, hour, 0).toISOString();
  assert.equal(relativeDay(at(14), now, "zh-Hans"), "今天");
  assert.equal(relativeDay(at(13, 23), now, "zh-Hans"), "昨天");
  assert.equal(relativeDay(at(12), now, "zh-Hans"), "2 天前");
  assert.match(relativeDay(at(3), now, "zh-Hans"), /9月3日/);
  assert.equal(relativeDay(at(12), now, "en"), "2 days ago");
});

test("badges and client-number labels follow the language", () => {
  assert.match(stageBadge("reviewing", "zh-Hans", { audience: "client" }), /<i><\/i>\p{Script=Han}/u);
  assert.match(stageBadge("reviewing", "zh-Hans"), /<i><\/i>Review in progress/, "staff names stay English");
  assert.equal(stageBadge("reviewing", "en"), stageBadge("reviewing"));
  assert.equal(clientNumberLabel({ clientNumber: null, stage: "draft" }, "zh-Hans"), "尚无客户编号");
  assert.equal(clientNumberLabel({ clientNumber: null, stage: "closed" }, "zh-Hans"), "从未发送");
  assert.equal(clientNumberLabel({ clientNumber: 93, stage: "received" }, "zh-Hans"), "#093");
  assert.equal(clientNumberTag({ clientNumber: null, stage: "draft" }, "zh-Hans"), '<span class="client-number none">尚无客户编号</span>');
});

test("languageCell: the letters for sighted staff, the names on hover and for screen readers, the labels for tests", () => {
  assert.equal(
    languageCell({ letters: "C, M", names: "Cantonese (preferred), Mandarin", labels: ["Cantonese", "Mandarin"] }),
    '<span class="language-letters" title="Cantonese (preferred), Mandarin" data-languages="Cantonese|Mandarin"><span aria-hidden="true">C, M</span><span class="sr-only">Cantonese (preferred), Mandarin</span></span>',
  );
  assert.equal(languageCell({ letters: "", names: "", labels: [] }), "—");
  assert.equal(languageCell(), "—");
  const odd = languageCell({ letters: "O", names: 'Other: <b>"x"</b>', labels: ["Other"] });
  assert.doesNotMatch(odd, /<b>/);
  assert.match(odd, /title="Other: &lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
});

test("the loading and couldn't-load lines", () => {
  assert.match(loadingLine("Loading cases…"), /^<p class="loading-line" role="status"><svg class="icon spin"[^>]*aria-hidden="true"[\s\S]*<span>Loading cases…<\/span><\/p>$/);
  assert.match(unloadedLine("The cases couldn't load."), /^<p class="unloaded-line"><svg[\s\S]*<span>The cases couldn&#39;t load\.<\/span><\/p>$/);
  assert.ok(ICON_NAMES.includes("spinner"));
});

test("an empty panel: icon, heading, sentence and actions, each optional but the sentence", () => {
  const clear = button("Clear filters", "clear-board-filters", "secondary");
  assert.equal(emptyState({ text: "Nothing here." }), `<div class="empty-state"><p>Nothing here.</p></div>`);
  assert.equal(
    emptyState({ icon: "folder", text: "Nothing here.", actions: [clear] }),
    `<div class="empty-state">${icon("folder")}<p>Nothing here.</p>${clear}</div>`,
  );
  // A conditional action that is off renders nothing, as `when` returns "".
  assert.equal(
    emptyState({ icon: "check", text: "T", actions: ["", clear] }),
    `<div class="empty-state">${icon("check")}<p>T</p>${clear}</div>`,
  );
  // The client's list: a heading, and its own class first.
  assert.equal(
    emptyState({ icon: "folder", title: "No applications yet", text: "Start one.", className: "panel" }),
    `<div class="panel empty-state">${icon("folder")}<h2>No applications yet</h2><p>Start one.</p></div>`,
  );
});

test("an empty section is one muted line", () => {
  assert.equal(emptyLine("No call has been recorded on this task yet."), '<p class="muted">No call has been recorded on this task yet.</p>');
  assert.equal(emptyLine("T", 'data-role="x"'), '<p class="muted" data-role="x">T</p>');
});

test("the Workload's tab, sort header and row toggle each come back as the same control", () => {
  const control = (dataset) => ({ tagName: "BUTTON", dataset });
  assert.deepEqual(focusSelectors(describeFocus(control({ action: "volunteer-tab", tab: "workload" }))), [
    '[data-action="volunteer-tab"][data-tab="workload"]',
  ]);
  assert.deepEqual(focusSelectors(describeFocus(control({ action: "sort-workload", key: "stalled" }))), [
    '[data-action="sort-workload"][data-key="stalled"]',
  ]);
  assert.deepEqual(focusSelectors(describeFocus(control({ action: "toggle-workload-row", rowId: "unassigned" }))), [
    '[data-action="toggle-workload-row"][data-row-id="unassigned"]',
  ]);
});
