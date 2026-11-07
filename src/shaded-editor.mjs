// The 13614-C shaded-section editor (change add-preparer-13614c-fields,
// design D7): the English editing copy in a full-screen layer beside `#app`,
// drawn by pdf.js with its forms on, so only the 106 shaded fields the copy
// keeps can be typed in. `render()` in app.mjs never touches it, so the
// preparer's edits survive every redraw, realtime included.
//
// Two parts. `createEditorSession` decides — what changed, when Save may be
// pressed, what a refusal says, when Close and Escape ask first — and touches
// no DOM. `openShadedEditor` draws the layer and wires it to a session. pdf.js
// is passed in (`loadPdfjs`), so it is loaded only when the editor opens.

import { isStaffWindow } from "./contracts.mjs";

export const DISCARD_QUESTION = "Discard your changes?";
export const CONFLICT_SENTENCE = "Saved elsewhere since you opened this. Close and reopen to see the latest.";
export const OPEN_FAILED = "The editor could not be opened. Try again, or use Download to fill elsewhere.";
const SAVED = "Saved";
const SAVING = "Saving…";
const LOADING = "Opening the form…";
const UNKNOWN = "Something went wrong.";
// A refusal because of who or where the case is: saving again cannot help.
const STAGE_REFUSALS = Object.freeze(["INVALID_TRANSITION", "FORBIDDEN", "INELIGIBLE"]);
// Any checkbox value but these is ticked (spec shaded-section).
const UNTICKED = new Set(["off", "false", ""]);

const ticked = (value) => {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value !== 0;
  return !UNTICKED.has(String(value).trim().toLowerCase());
};

const entriesOf = (source) =>
  source instanceof Map ? [...source.entries()] : Object.entries(source ?? {});

const storedOf = (storage, id) => {
  if (!storage || id == null) return undefined;
  if (typeof storage.getRawValue === "function") return storage.getRawValue(id);
  if (storage instanceof Map) return storage.get(id);
  return Object.hasOwn(storage, id) ? storage[id] : undefined;
};

/**
 * What the layer holds, by full PDF field name, for `readShaded`: a text
 * field's string, a checkbox's tick as a boolean. `fieldObjects` is pdf.js's
 * `getFieldObjects()` (a Map, or an object, of name -> [field dict]); the
 * preparer's edits are in `storageValues` (pdf.js's `annotationStorage`, a
 * Map or an object), keyed by annotation id, and override the stored values.
 * The form's non-terminal parents (no type) are not fields.
 */
export function rawFromPdfjs(fieldObjects, storageValues) {
  const raw = {};
  for (const [name, list] of entriesOf(fieldObjects)) {
    const field = (Array.isArray(list) ? list : [list]).find(
      (entry) => entry && (entry.type === "text" || entry.type === "checkbox"),
    );
    if (!field) continue;
    const edited = storedOf(storageValues, field.id);
    const value = edited && Object.hasOwn(edited, "value") ? edited.value : field.value;
    raw[name] = field.type === "checkbox" ? ticked(value) : value == null ? "" : String(value);
  }
  return raw;
}

const sameKey = (raw) =>
  JSON.stringify(
    Object.keys(raw ?? {})
      .sort()
      .map((key) => [key, raw[key]]),
  );

/**
 * The editor's decisions, without a page. `read()` gives the layer's values
 * now; `onSave(raw)` saves them (and throws `{code, message}` on a refusal);
 * `explainRefusal()` says why saving is no longer allowed, or null;
 * `onChange(view)` redraws the toolbar; `onClose()` takes the layer down.
 * `start()` once the form is drawn: what it holds then is "no change".
 */
export function createEditorSession({ read, onSave, explainRefusal, onChange, onClose }) {
  let baseline = null;
  const state = {
    ready: false,
    dirty: false,
    saving: false,
    blocked: null,
    status: "",
    asking: null,
    closed: false,
  };
  const view = () => ({
    ...state,
    saveEnabled: state.ready && state.dirty && !state.saving && !state.blocked && !state.closed,
  });
  const emit = () => onChange?.(view());
  const changed = () => state.ready && sameKey(read()) !== baseline;

  function start() {
    if (state.closed) return;
    baseline = sameKey(read());
    state.ready = true;
    state.status = "";
    emit();
  }

  function mark() {
    if (!state.ready || state.closed) return;
    state.dirty = changed();
    // "Saved" was about what was there then.
    if (state.dirty && state.status === SAVED) state.status = "";
    emit();
  }

  function close() {
    if (state.closed) return;
    state.closed = true;
    state.asking = null;
    emit();
    onClose?.();
  }

  function refuse(sentence) {
    state.blocked = sentence;
    state.status = sentence;
  }

  async function save() {
    if (!view().saveEnabled || state.asking) return;
    const reason = explainRefusal?.() ?? null;
    if (reason) {
      refuse(reason);
      emit();
      return;
    }
    state.saving = true;
    state.status = SAVING;
    emit();
    // What is there when Save is pressed is what is saved; a change typed
    // while the save is out stays a change.
    const raw = read();
    try {
      await onSave(raw);
      baseline = sameKey(raw);
      state.status = SAVED;
    } catch (error) {
      const code = error?.code;
      if (code === "CONFLICT") refuse(CONFLICT_SENTENCE);
      else if (STAGE_REFUSALS.includes(code))
        refuse(explainRefusal?.() || (typeof error?.message === "string" && error.message) || UNKNOWN);
      else state.status = (typeof error?.message === "string" && error.message) || UNKNOWN;
    } finally {
      state.saving = false;
      if (!state.closed) {
        state.dirty = changed();
        emit();
      }
    }
  }

  // Close, or Escape: straight away when nothing is unsaved, else ask.
  function requestClose() {
    if (state.closed) return;
    if (state.dirty) {
      state.asking = DISCARD_QUESTION;
      emit();
      return;
    }
    close();
  }

  function keepEditing() {
    if (!state.asking) return;
    state.asking = null;
    emit();
  }

  function confirmDiscard() {
    if (state.asking) close();
  }

  // Escape (screen-states): never during an IME composition; on the question
  // it keeps editing. Returns whether the key was used.
  function escape(event = {}) {
    if (event.isComposing || event.keyCode === 229 || state.closed) return false;
    if (state.asking) keepEditing();
    else requestClose();
    return true;
  }

  return { start, mark, save, requestClose, keepEditing, confirmDiscard, escape, close, view };
}

const CASE_MOVED = "The case changed while you were saving. Press Save again.";

/**
 * The save behind the editor's Save. `check(raw)` is readShaded with the
 * case's rules; `save(values, basedOnVersion)` sends SAVE_PREPARER_FIELDS
 * (null when nothing was sent); `storedVersion()` is the section version the
 * window now holds. `version` is the stored version the editor opened on.
 *
 * - An accepted save made exactly version + 1 (the server accepts only on the
 *   stored version and writes based + 1), so that is the next base. It is
 *   never read back from the case: a newer save by another window, landing
 *   first, would be adopted and then silently overwritten.
 * - The server says CONFLICT for a stale case revision as well as a stale
 *   section. After one, the window has re-read the case: when the section is
 *   still at this editor's version, only the case moved (the office recorded
 *   materials, say), and the same values are sent once more on the fresh
 *   revision. When it moved again meanwhile, Save stays offered without the
 *   conflict sentence. When the section itself moved, it is a conflict.
 */
export function createShadedSave({ version: opened, check, save, storedVersion }) {
  let version = Number(opened) || 0;
  async function send(values) {
    const receipt = await save(values, version);
    if (!receipt) throw { code: "NOT_SENT", message: "Nothing was saved. Press Save again." };
    version += 1;
  }
  async function onSave(raw) {
    const { values, errors } = check(raw);
    if (errors.length) throw { code: "VALIDATION", message: errors.map((entry) => entry.message).join(" ") };
    try {
      await send(values);
    } catch (error) {
      if (error?.code !== "CONFLICT" || Number(storedVersion()) !== version) throw error;
      try {
        await send(values);
      } catch (again) {
        if (again?.code === "CONFLICT" && Number(storedVersion()) === version)
          throw { code: "CASE_MOVED", message: CASE_MOVED };
        throw again;
      }
    }
  }
  onSave.version = () => version;
  return onSave;
}

/**
 * Whether the open editor has lost its place: no staff account is signed in
 * any more (a sign-out in another tab, as isStaffWindow says), or the case it
 * was opened on is no longer the selected one. A re-read that drops the
 * record for a moment keeps the selection, so it is not leaving.
 */
export function editorGone(state, caseId) {
  return !isStaffWindow(state?.principal) || state?.selectedCaseId !== caseId;
}

// pdf.js's annotation layer wants a link service; the editing copy has no
// links worth following, so every one goes nowhere.
const NO_LINKS = Object.freeze({
  externalLinkEnabled: false,
  getDestinationHash: () => "#",
  getAnchorUrl: () => "#",
  addLinkAttributes() {},
  goToDestination() {},
  executeNamedAction() {},
  executeSetOCGState() {},
  eventBus: { dispatch() {} },
});

const FOCUSABLE =
  'button:not([disabled]),input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]';

const LAYER = `<div class="shaded-editor-bar"><div class="shaded-editor-heading"><h2 id="shaded-editor-title">Shaded section of the 13614-C</h2><p class="shaded-editor-hint">Only the shaded fields can be changed. Save keeps the editor open.</p></div><p id="shaded-editor-status" class="shaded-editor-status" role="status" aria-live="polite"></p><div class="shaded-editor-actions"><button type="button" class="btn primary" data-editor="save" disabled>Save</button><button type="button" class="btn secondary" data-editor="close">Close</button></div></div><div class="shaded-editor-pages" aria-label="The editing copy of the 13614-C"></div><div class="shaded-editor-confirm" role="alertdialog" aria-modal="true" aria-labelledby="shaded-editor-confirm-text" hidden><div class="shaded-editor-confirm-box"><p id="shaded-editor-confirm-text">${DISCARD_QUESTION}</p><div class="shaded-editor-actions"><button type="button" class="btn secondary" data-editor="keep">Keep editing</button><button type="button" class="btn primary" data-editor="discard">Discard</button></div></div></div>`;

/**
 * Open the editor over the page. `bytes` is the editing copy (or a promise of
 * it); `onSave(raw)` saves the layer's values; `onClose()` runs once when the
 * layer has gone, whichever way. Returns `{close, session, ready}`: `ready`
 * settles once the form is drawn, and rejects — after the layer has gone and
 * `onClose` has run — when it could not be opened.
 */
export function openShadedEditor({ document, window = document.defaultView, loadPdfjs, bytes, onSave, onClose, explainRefusal }) {
  const layer = document.createElement("div");
  layer.className = "shaded-editor";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "shaded-editor-title");
  layer.tabIndex = -1;
  layer.innerHTML = LAYER;
  const bar = layer.querySelector(".shaded-editor-bar");
  const status = layer.querySelector("#shaded-editor-status");
  const saveButton = layer.querySelector('[data-editor="save"]');
  const closeButton = layer.querySelector('[data-editor="close"]');
  const pages = layer.querySelector(".shaded-editor-pages");
  const confirm = layer.querySelector(".shaded-editor-confirm");
  const keepButton = layer.querySelector('[data-editor="keep"]');
  let pdf = null;
  let task = null;
  let fieldObjects = new Map();
  let wasAsking = false;
  let focusBeforeAsking = null;
  let unloadGuard = false;
  let gone = false;

  const beforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = "";
  };
  const guardUnload = (on) => {
    if (on === unloadGuard || !window) return;
    unloadGuard = on;
    if (on) window.addEventListener("beforeunload", beforeUnload);
    else window.removeEventListener("beforeunload", beforeUnload);
  };

  function teardown() {
    if (gone) return;
    gone = true;
    guardUnload(false);
    layer.remove();
    try {
      task?.destroy?.();
      pdf?.destroy?.();
    } catch {
      // Nothing to keep: the layer has gone.
    }
    onClose?.();
  }

  const session = createEditorSession({
    read: () => rawFromPdfjs(fieldObjects, pdf?.annotationStorage),
    onSave,
    explainRefusal,
    onClose: teardown,
    onChange(view) {
      if (gone) return;
      saveButton.disabled = !view.saveEnabled;
      status.textContent = view.ready || view.status ? view.status : LOADING;
      status.classList.toggle("error", Boolean(view.blocked) || (Boolean(view.status) && ![SAVED, SAVING].includes(view.status)));
      guardUnload(view.dirty && !view.closed);
      const asking = Boolean(view.asking);
      if (asking !== wasAsking) {
        wasAsking = asking;
        confirm.hidden = !asking;
        bar.inert = asking;
        pages.inert = asking;
        if (asking) {
          focusBeforeAsking = document.activeElement;
          keepButton.focus();
        } else if (focusBeforeAsking?.isConnected) focusBeforeAsking.focus();
        else closeButton.focus();
      }
    },
  });

  layer.addEventListener("click", (event) => {
    const control = event.target.closest?.("[data-editor]");
    if (!control) return;
    const what = control.dataset.editor;
    if (what === "save") void session.save();
    else if (what === "close") session.requestClose();
    else if (what === "keep") session.keepEditing();
    else if (what === "discard") session.confirmDiscard();
  });
  // pdf.js writes an edit to its storage from the field's own listener; the
  // layer hears it afterwards, once it has bubbled up.
  const heard = () => setTimeout(() => session.mark(), 0);
  pages.addEventListener("input", heard);
  pages.addEventListener("change", heard);
  layer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      // The page's own Escape (a dialog's, the sidebar's) is not for this layer.
      event.stopPropagation();
      if (session.escape(event)) event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const scope = session.view().asking ? confirm : layer;
    const focusable = [...scope.querySelectorAll(FOCUSABLE)].filter(
      (element) => !element.closest("[hidden]") && !element.closest("[inert]"),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !scope.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !scope.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });

  document.body.append(layer);
  status.textContent = LOADING;
  // The keyboard moves in: to the only control there is while it loads.
  closeButton.focus();

  const ready = (async () => {
    try {
      const pdfjs = await loadPdfjs();
      const data = await bytes;
      if (gone) return;
      // pdf.js hands its data to the worker; it gets its own copy.
      task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, enableXfa: false });
      pdf = await task.promise;
      if (gone) return;
      fieldObjects = (await pdf.getFieldObjects()) ?? new Map();
      const room = Math.max(320, (pages.clientWidth || window?.innerWidth || 960) - 32);
      const ratio = window?.devicePixelRatio || 1;
      for (let number = 1; number <= pdf.numPages; number += 1) {
        if (gone) return;
        const page = await pdf.getPage(number);
        const scale = Math.min(1.5, Math.max(0.75, room / page.getViewport({ scale: 1 }).width));
        const viewport = page.getViewport({ scale });
        const sheet = document.createElement("div");
        sheet.className = "shaded-editor-page";
        sheet.setAttribute("role", "group");
        sheet.setAttribute("aria-label", `Page ${number}`);
        sheet.style.width = `${viewport.width}px`;
        sheet.style.height = `${viewport.height}px`;
        sheet.style.setProperty("--scale-factor", String(scale));
        sheet.style.setProperty("--total-scale-factor", String(scale));
        sheet.style.setProperty("--user-unit", "1");
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-hidden", "true");
        const forms = document.createElement("div");
        forms.className = "annotationLayer";
        sheet.append(canvas, forms);
        pages.append(sheet);
        // One map for the page and its layer, or every box draws ticked.
        const annotationCanvasMap = new Map();
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
          annotationCanvasMap,
        }).promise;
        const annotations = await page.getAnnotations({ intent: "display" });
        const size = () => {
          forms.style.width = `${viewport.width}px`;
          forms.style.height = `${viewport.height}px`;
        };
        size();
        // The storage goes to the constructor: given only to render, edits
        // would land in a throwaway one.
        const annotationLayer = new pdfjs.AnnotationLayer({
          div: forms,
          annotationStorage: pdf.annotationStorage,
          accessibilityManager: null,
          annotationCanvasMap,
          annotationEditorUIManager: null,
          page,
          viewport: viewport.clone({ dontFlip: true }),
          structTreeLayer: null,
          commentManager: null,
          linkService: NO_LINKS,
        });
        await annotationLayer.render({
          annotations,
          imageResourcesPath: "",
          renderForms: true,
          linkService: NO_LINKS,
          downloadManager: null,
          annotationStorage: pdf.annotationStorage,
          enableScripting: false,
          hasJSActions: false,
          fieldObjects,
        });
        size();
      }
      if (gone) return;
      session.start();
      // Every page is drawn: the form can be read and saved.
      layer.dataset.ready = "true";
      // First control that isn't the close button (screen-states): Save is
      // off until something changes, so the first shaded field.
      const first = pages.querySelector('input:not([type="hidden"]):not([disabled]),textarea:not([disabled])');
      (first ?? closeButton).focus({ preventScroll: true });
    } catch (error) {
      if (gone) return;
      teardown();
      throw error;
    }
  })();

  return {
    session,
    ready,
    close: () => session.close(),
    get open() {
      return !gone;
    },
  };
}
