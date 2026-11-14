import { describeStage } from "./domain.mjs";
import { localeOf } from "./language.mjs";
import { t } from "./client-text.mjs";

export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  arrow: "m9 5 7 7-7 7M4 12h12",
  back: "m14 5-7 7 7 7M7 12h13",
  check: "m5 12 4 4L19 6",
  file: "M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8M8 17h5",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  phone: "M7 3H4c-1 8 9 18 17 17v-4l-5-2-2 2-6-6 2-2-3-5Z",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  copy: "M8 8h12v13H8ZM4 16H2V2h13v3",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  user: "M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0M3 22v-3c0-7 18-7 18 0v3",
  home: "m2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8",
  mail: "M2 4h20v16H2ZM2 5l10 8L22 5",
  close: "m5 5 14 14M5 19 19 5",
  refresh: "M3 10a9 9 0 1 1 1 8M3 3v7h7",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  lock: "M5 10h14v12H5ZM8 10V6a4 4 0 0 1 8 0v4M12 15v3",
  play: "m7 3 14 9-14 9V3Z",
  chevron: "m9 5 7 7-7 7",
  folder: "M2 6h8l2 3h10v12H2V6Zm0 0V3h8l2 3h8v3",
  print: "M6 8V2h12v6M6 17H2V8h20v9h-4M6 13h12v9H6Z",
  search: "M20 20l-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  signout: "M10 21H4V3h6M16 8l4 4-4 4M20 12H9",
  // Redesign shell and boards (docs/design/redesign-review.md, Phase 0)
  sidebar: "M3 4h18v16H3ZM9 4v16M5 8h2M5 11h2",
  dashboard: "M3 3h8v8H3ZM13 3h8v5h-8ZM13 10h8v11h-8ZM3 13h8v8H3Z",
  board: "M3 4h18v16H3ZM3 9h18M3 14h18M9 9v11",
  calendar: "M3 5h18v16H3ZM3 10h18M8 3v4M16 3v4",
  message: "M4 4h16v12H9l-5 4V4Z",
  bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2ZM10 21h4",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  label: "M3 12V3h9l9 9-9 9-9-9ZM7.5 7.5h.01",
  pin: "M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6ZM12 14v7",
  plus: "M12 5v14M5 12h14",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  filter: "M4 6h16M7 12h10M10 18h4",
  expand: "m6 9 6 6 6-6",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  people:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2c0-3 3-5 7-5s7 2 7 5v2M16 3a4 4 0 0 1 0 8M22 21v-2c0-2-1-4-4-5",
  megaphone: "M3 10v4h4l8 5V5L7 10H3ZM18 9a4 4 0 0 1 0 6",
  chart: "M3 3v18h18M7 15l4-4 3 3 6-7",
  // The intake redesign's document cards (spec 2026-10-04 §6.4)
  camera: "M3 8h4l2-3h6l2 3h4v12H3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  // The toast's kinds (design D4): success is `check`.
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  warning: "M12 3 2 21h20L12 3ZM12 10v5M12 18h.01",
  // The one loading pattern (design D6).
  spinner: "M21 12a9 9 0 1 1-9-9",
};

// Every name the icon table knows. A name that is not here falls back to the
// file icon, which is right for data but wrong for a control.
export const ICON_NAMES = Object.freeze(Object.keys(paths));
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
// One loading pattern (design D6): a spinner and a sentence, as a status.
export const loadingLine = (text) =>
  `<p class="loading-line" role="status">${icon("spinner", "spin")}<span>${esc(text)}</span></p>`;
// A list that never loaded: said plainly, under the banner's Try again.
export const unloadedLine = (text) =>
  `<p class="unloaded-line">${icon("help")}<span>${esc(text)}</span></p>`;
// A list that loaded and has nothing to show (screen-states). A panel list
// gets an icon, an optional heading, its sentence and the actions that undo a
// filter; a section inside a case gets one muted line. Each list keeps its own
// words and passes its own ready-made buttons, so their data-* stay with it.
// `title`, `text` and the actions are HTML the caller has already escaped.
export const emptyState = ({ icon: name, title, text, actions = [], className } = {}) =>
  `<div class="${className ? `${className} ` : ""}empty-state">${name ? icon(name) : ""}${
    title ? `<h2>${title}</h2>` : ""
  }<p>${text}</p>${actions.join("")}</div>`;
// One muted line for a section inside a case. `attrs` is for a caller that needs an
// extra attribute, e.g. a data-role the story reads.
export const emptyLine = (text, attrs = "") => `<p class="muted"${attrs ? ` ${attrs}` : ""}>${text}</p>`;
export const button = (text, action, kind = "primary", extra = "") =>
  `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${text}</button>`;

// Workflow buttons name the canonical action directly, so the DOM and the
// database speak the same vocabulary (contracts.mjs, DOM action convention).
export const caseButton = (text, action, kind = "primary", extra = "") =>
  `<button type="button" class="btn ${kind}" data-case-action="${action}" ${extra}>${text}</button>`;

// The same, as a form's submit control: the named fields around it are what the
// payload is built from, so the button has to submit the form rather than fire
// on click (the click handler skips submit buttons for exactly that reason).
export const caseSubmit = (text, action, kind = "primary", extra = "") =>
  `<button type="submit" class="btn ${kind}" data-case-action="${action}" ${extra}>${text}</button>`;

// One id per field name, so every control has a real `for` association rather
// than only a wrapping element. A `scope` keeps ids unique when the same field
// name appears in more than one form on a page (one escalation form per open
// document request, for instance).
export const fieldId = (name, scope = "") =>
  `field-${scope ? `${esc(scope)}-` : ""}${name}`;
export const input = (
  label,
  name,
  value = "",
  type = "text",
  extra = "",
  scope = "",
) =>
  `<label class="field" for="${fieldId(name, scope)}"><span>${esc(label)}</span><input id="${fieldId(name, scope)}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const textarea = (label, name, value = "", extra = "", scope = "") =>
  `<label class="field" for="${fieldId(name, scope)}"><span>${esc(label)}</span><textarea id="${fieldId(name, scope)}" name="${name}" ${extra}>${esc(value)}</textarea></label>`;
// Stays English: only staff screens use it. The client form's select is
// intake-form.mjs's, through t("form.select_option").
export const select = (label, name, value, options, extra = "", scope = "") =>
  `<label class="field" for="${fieldId(name, scope)}"><span>${esc(label)}</span><select id="${fieldId(name, scope)}" name="${name}" ${extra}><option value="">Select an option</option>${options
    .map((o) => {
      const [val, txt] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${value === val ? "selected" : ""}>${esc(txt)}</option>`;
    })
    .join("")}</select></label>`;

// One time format for every screen, in the language's locale (English by
// default). An unusable value renders as nothing at all rather than "Invalid Date".
export function formatTime(value, lang = "en") {
  const at = new Date(value ?? "");
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(localeOf(lang), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Client numbers (part 2): "#" and at least three digits. A case without one
// is a draft ("No number yet") or an assisted draft the office closed before
// sending it ("Never sent") — a closed case with no number was never submitted.
export const formatClientNumber = (n) =>
  n === null || n === undefined ? null : `#${String(n).padStart(3, "0")}`;
export const clientNumberLabel = (record, lang = "en") =>
  formatClientNumber(record?.clientNumber) ??
  t(record?.stage === "closed" ? "client_number.never" : "client_number.none", {}, lang);
export const clientNumberTag = (record, lang = "en") =>
  `<span class="client-number${record?.clientNumber == null ? " none" : ""}">${esc(clientNumberLabel(record, lang))}</span>`;

// A staff table's Language cell (allow-multiple-service-languages, design D4):
// the letters for sighted staff, the full names on hover and for screen
// readers, and the labels (data-languages) for tests and the story.
export const languageCell = ({ letters = "", names = "", labels = [] } = {}) =>
  letters
    ? `<span class="language-letters" title="${esc(names)}" data-languages="${esc(labels.join("|"))}"><span aria-hidden="true">${esc(letters)}</span><span class="sr-only">${esc(names)}</span></span>`
    : "—";

// How long ago, in days, for lists where the minute does not matter. Dates are
// compared as calendar days in the viewer's time zone, so a case updated late
// last night reads "Yesterday", not "Today".
export function relativeDay(value, now = Date.now(), lang = "en") {
  const at = new Date(value ?? "");
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date(now);
  const calendarDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((calendarDay(today) - calendarDay(at)) / 86_400_000);
  if (days <= 0) return t("day.today", {}, lang);
  if (days === 1) return t("day.yesterday", {}, lang);
  if (days < 7) return t("day.ago", { n: days }, lang);
  return at.toLocaleDateString(localeOf(lang), { month: "short", day: "numeric" });
}

// The ARIA tab pattern's keys: the arrows move one tab and wrap around, Home
// and End jump to the ends. Anything else is not a tab key (null).
export function nextTabIndex(key, at, count) {
  if (!count) return null;
  if (key === "ArrowRight") return (at + 1) % count;
  if (key === "ArrowLeft") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// The PCDC office's own contact details, given everywhere a client is told to
// reach the office. Links, so a phone can call and a laptop can write.
export const OFFICE_CONTACT = Object.freeze({
  phone: "(215) 922-6156",
  tel: "+12159226156",
  email: "vita@chinatown-pcdc.org",
});

export const officeContact = () =>
  `<div class="office-contact"><a href="tel:${OFFICE_CONTACT.tel}">${icon("phone")} ${OFFICE_CONTACT.phone}</a><a href="mailto:${OFFICE_CONTACT.email}">${icon("mail")} ${OFFICE_CONTACT.email.replace("@", "@<wbr>")}</a></div>`;

// Colour is never the only signal: every badge carries its own words, and the
// words come from the one stage table in domain.mjs. The colour is the stage's
// family in the redesign (docs/design/DESIGN.md): intake, preparation and
// review, amendment, filing, or neutral.
const STAGE_TONES = Object.freeze({
  draft: "intake",
  received: "intake",
  screening: "intake",
  preparation_ready: "prep",
  preparing: "prep",
  review_ready: "prep",
  reviewing: "prep",
  corrections_required: "amend",
  review_approved: "filing",
  ready_to_efile: "filing",
  efiled: "filing",
  rejected: "amend",
  accepted: "filing",
  closed: "neutral",
});
// Staff see the staff name (English); a client sees the label in their language.
// A `record` lets E-filed and Accepted carry the case's filing method.
export const stageBadge = (stage, lang = "en", { audience = "staff", record = null } = {}) => {
  const described = describeStage(stage, lang, record);
  const text = audience === "client" ? described.clientLabel : described.label;
  return `<span class="badge ${STAGE_TONES[stage] ?? "neutral"}"><i></i>${esc(text)}</span>`;
};

// Rebuilding the page loses the keyboard, so the wiring layer records where it
// was first — by **id** before name, because a name is not unique on a page any
// more: a case with two open document requests renders one escalation form per
// request, each with a `reason` field. Restoring by name alone would move the
// cursor to the first of them, and the rest of the sentence would be typed
// into, and sent for, the wrong request. Ids already carry the request they
// belong to (`fieldId(name, scope)`); the name stays as the fallback for a
// control that has none.
//
// Only these controls have a text selection at all: `selectionStart`
// is defined on `HTMLInputElement.prototype` for *every* input, so testing
// `"selectionStart" in element` proves nothing about whether it can be read.
// The measured behaviour for the rest (radio, checkbox, number, email, date,
// colour, range, file) is `null` in Chromium 153 and Firefox 155 — but the
// specification allows an `InvalidStateError` instead, engines have differed
// historically, and this runs *before* the page is replaced, so a throw here
// would take the whole render with it. Hence the allowlist and the try/catch:
// a field with no caret still gets its focus back, just without one.
const SELECTABLE_INPUT_TYPES = Object.freeze([
  "text",
  "search",
  "url",
  "tel",
  "password",
]);

// A button carries neither an id nor a name — every `data-action` control in
// this application is in that class — so what it *does* is its stable hook, in
// the same vocabulary the click handler reads. Without this a keyboard user is
// sent back to the top of the document by any background update, and there are
// two of those for every accepted action.
const ACTION_KEYS = Object.freeze([
  ["action", "data-action"],
  ["caseAction", "data-case-action"],
  ["assistanceAction", "data-assistance-action"],
]);

// What tells one namesake from another: every "Send sample document" button
// says RESPOND_DOCUMENT, and only the request id says which request. A filter
// or a check is the same idea for the staff board.
const RELATED_KEYS = Object.freeze([
  ["caseId", "data-case-id"],
  ["requestId", "data-request-id"],
  ["itemId", "data-item-id"],
  ["followupId", "data-followup-id"],
  ["personId", "data-person-id"],
  ["volunteerId", "data-volunteer-id"],
  ["check", "data-check"],
  ["filter", "data-filter"],
  ["value", "data-value"],
  // The Workload (change add-volunteer-workload): its tabs, its sort headers
  // and its row toggles share one action each.
  ["tab", "data-tab"],
  ["key", "data-key"],
  ["rowId", "data-row-id"],
]);

const attributeValue = (value) =>
  `"${String(value).replace(/[\\"]/g, (character) => `\\${character}`)}"`;

export function describeFocus(active) {
  if (!active) return null;
  const id = active.id || null;
  const name = active.name || null;
  const data = active.dataset ?? {};
  let action = null;
  for (const [key, attribute] of ACTION_KEYS)
    if (data[key]) {
      action = { attribute, value: data[key] };
      break;
    }
  const related = action
    ? RELATED_KEYS.filter(([key]) => data[key] != null && data[key] !== "").map(
        ([key, attribute]) => ({ attribute, value: data[key] }),
      )
    : [];
  // With none of the three there is nothing to find again after the rebuild.
  if (!id && !name && !action) return null;
  const description = { id, name, action, related, caret: null };
  const selectable =
    active.tagName === "TEXTAREA" ||
    (active.tagName === "INPUT" &&
      SELECTABLE_INPUT_TYPES.includes(
        String(active.type ?? "text").toLowerCase(),
      ));
  if (!selectable) return description;
  try {
    const caret = active.selectionStart;
    if (typeof caret !== "number") return description;
    // A selected range is kept as a range (#120). With only its start, a
    // redraw between selecting a field's text and typing over it collapsed
    // the selection to that start, so the new text went in front of the old
    // instead of replacing it ("Otherwindow CityPhiladelphia"). Only a real
    // range is recorded: a plain caret is described exactly as before.
    const end = active.selectionEnd;
    if (typeof end !== "number" || end <= caret) return { ...description, caret };
    return {
      ...description,
      caret,
      selectionEnd: end,
      direction: active.selectionDirection === "backward" ? "backward" : "forward",
    };
  } catch {
    return description;
  }
}

// How to find that element again, most specific first: its own id, then its
// name, then what it does together with the row it belongs to — **or**, for a
// control that belongs to no row, what it does.
//
// A button that named a row is never looked up by what it does alone. The two
// are alternatives, not a fallback chain: a case can have several open document
// requests at once, each rendering its own RESPOND_DOCUMENT button that differs
// only by `data-request-id`. If the focused request is resolved in a background
// rebuild while another stays open, falling back to the bare action would put
// the keyboard on a *different* request's live button — and a keyboard user
// mid-keypress would then send a real workflow action against the wrong
// request. A row that is gone restores nothing, which is the safe answer.
export function focusSelectors(focus) {
  if (!focus) return [];
  const selectors = [];
  // Attribute form throughout, so no value needs CSS.escape — which does not
  // exist outside a browser, and this has to be testable without one.
  // An id is unique and row-scoped (`fieldId(name, scope)`), so it is the whole
  // answer when there is one. The name is the fallback for a control that has
  // no id — never a fallback *from* an id, for the same reason the bare action
  // is not one: a case with two open document requests renders two `reason`
  // boxes, and landing in the surviving one would put the rest of a sentence
  // into, and send it for, the wrong request.
  if (focus.id) selectors.push(`[id=${attributeValue(focus.id)}]`);
  else if (focus.name) selectors.push(`[name=${attributeValue(focus.name)}]`);
  if (focus.action) {
    const base = `[${focus.action.attribute}=${attributeValue(focus.action.value)}]`;
    const related = (focus.related ?? [])
      .map(({ attribute, value }) => `[${attribute}=${attributeValue(value)}]`)
      .join("");
    selectors.push(related ? `${base}${related}` : base);
  }
  return selectors;
}

// Opening a dialog has to move the keyboard into it: it is `aria-modal`, and
// the Tab trap only stops focus leaving from the first or last control, so it
// can never recover focus that never arrived. A dialog whose body is three
// paragraphs has only its close button, and a dialog with nothing at all still
// has the container, which carries `tabindex="-1"` for exactly this.
const isCloseButton = (element) =>
  String(element?.className ?? "")
    .split(/\s+/)
    .includes("close-btn");
// The demo's "Auto-fill fictional data" button (demo-fill.mjs) is a helper, not
// the dialog's work: the keyboard still lands on the first real control.
const isDemoFill = (element) =>
  String(element?.className ?? "")
    .split(/\s+/)
    .includes("demo-fill");

export function dialogFocusTarget(controls = [], container = null) {
  const usable = controls.filter((control) => control && !control.disabled);
  return (
    usable.find((control) => !isCloseButton(control) && !isDemoFill(control)) ??
    usable.find((control) => !isCloseButton(control)) ??
    usable.find(isCloseButton) ??
    container ??
    null
  );
}

// Every confirmation has one shape (screen-states, "Every confirmation has the
// same shape"): a sentence, an optional note, an optional form, the confirm
// control, and a text button that closes without sending anything. The
// confirm control comes ready-made from the caller, so its action, its kind,
// its `disabled` and the payload's fields stay with the dialog that owns them.
// `lead` and `note.html` are HTML the caller has already escaped.
export function confirmBody({ before = "", lead, note = null, form = null, confirm, keep }) {
  const said = note ? `<div class="info-note">${icon(note.icon)}<p>${note.html}</p></div>` : "";
  const action = form
    ? `<form ${form.attrs ?? 'class="staff-form"'}>${form.fields}${confirm}</form>`
    : confirm;
  return `${before}${lead ? `<p>${lead}</p>` : ""}${note ? said : ""}${action}${button(keep, "close-dialog", "text")}`;
}

// While a dialog is open everything behind it is inert, except the dialog and
// the live regions placed directly in #app: a toast or a banner announced while
// it is open, or just after it closes, still has to reach a screen reader. The
// toast lives outside #app, so it is never a candidate. A live region nested in
// the page body (the intake's q-note, #draft-ready) is inert with the rest of
// the page; a dialog says its own messages. A new live region placed directly
// in #app joins this list.
const STAYS_REACHABLE = Object.freeze([
  "modal-backdrop",
  "connection-notice",
  "problem-banner",
]);
export const inertWhileDialog = (element) =>
  !STAYS_REACHABLE.some((name) => element?.classList?.contains(name));

// Where Tab goes inside an open dialog: round from the last control to the
// first and back, and in at the right end when the keyboard is on the dialog
// itself or on its text (a click there focuses the container, which carries
// tabindex="-1"). Null leaves the move to the browser.
export function trapTarget(controls = [], active = null, shift = false) {
  if (!controls.length) return null;
  const first = controls[0];
  const last = controls.at(-1);
  if (!controls.includes(active)) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}
