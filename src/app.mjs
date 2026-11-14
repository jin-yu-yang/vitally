import { createAuth } from "./auth.mjs";
import { createStore } from "./supabase-store.mjs";
import { createController } from "./controller.mjs";
import { CASE_ACTIONS, ASSISTANCE_ACTIONS, SHADED_EDITOR, SHADED_UPLOAD, isStaffWindow } from "./contracts.mjs";
import { payloadFor } from "./case-actions.mjs";
import { demoToolsFromConfig, demoToolsOn, fillForm } from "./demo-fill.mjs";
import { checkDrafts, forgetDrafts, formValuesWithLists, isCheckable, groupsToOpen, restoreDraft, textDraft } from "./form-values.mjs";
import { sampleAnswersFor, fictionalAnswers } from "./sample-data.mjs";
import { checkValue, findQuestion, findSubstep, isAnswered, spouseShown, visibleAnswers } from "./intake-catalogue.mjs";
import {
  countText,
  drivesVisibility,
  needsRedraw,
  newMemberId,
  noteState,
  readField,
  readForm,
  sendable,
  stepRollup,
  substepStatus,
  visibleSubsteps,
} from "./intake-form.mjs";
import {
  addCaseParts,
  addCaseCountText,
  addCasePartStatus,
  addCaseSendOff,
  closeUnsignedHeading,
  closeUnsignedListKey,
} from "./office-views.mjs";
import { cardsFor } from "./document-cards.mjs";
import { FORM_FILES, draftFields } from "./draft-form.mjs";
import { FORM_14446_FILES, draft14446Fields } from "./draft-virtual-consent.mjs";
import { EXIT_FORM_FILE, buildExitFormPdf, exitFormFontFields, exitFormMarks, exitFormNeedsFont } from "./exit-form.mjs";
import {
  buildDraftPdf,
  buildEditingCopy,
  createDraftOffer,
  draftFontFiles,
  draftFontsFor,
  draftLink,
  fieldsNeedFont,
  readFilledCopy,
} from "./draft-pdf.mjs";
import { readShaded, uploadRefusal } from "./shaded-fields.mjs";
import { OPEN_FAILED, createShadedSave, editorGone, openShadedEditor } from "./shaded-editor.mjs";
import {
  describeFocus,
  focusSelectors,
  dialogFocusTarget,
  fieldId,
  icon,
  nextTabIndex,
  inertWhileDialog,
  trapTarget,
} from "./ui.mjs";
import * as views from "./views.mjs";
import * as client from "./client-views.mjs";
import { POOL_FILTER_KEYS } from "./pool-views.mjs";
import { createSidebarPeek, peekZone, toggleLabel } from "./sidebar-peek.mjs";
import { createRedrawHold } from "./redraw-hold.mjs";
import { STORAGE_KEY, createLanguageRequests, isLang, loadHantWithin, viewLang } from "./language.mjs";
import { createHantLoader, hantReady } from "./hant.mjs";
import { t, SENTENCES } from "./client-text.mjs";
import { createToastTimer } from "./toast.mjs";
import { contactEntryFromForm, contactSummary, contactSummaries } from "./contact-log.mjs";
import { decorateStaffCase, outcomeGroup, staffEligibility } from "./staff-views.mjs";
import { volunteerFromForm, rolesToUntick } from "./volunteer-roster.mjs";

// Bootstrap and DOM wiring, and nothing else. No state lives here (the
// controller owns it), no HTML is written here (the view modules own it), and
// no database call is made here (the store owns it). This file reads the
// configuration, builds the three modules, and turns DOM events into
// controller calls.

const root = document.querySelector("#app");

// The two version-2 forms: the client's own, and the office's Add a case.
// Both are drawn from the controller's draft and share one wiring: the redraw
// hold, the sweep, the quiet edit and the in-place notes (spec §2.4).
const V2_FORMS = "#intake-v2-form, #add-case-v2-form";

// Relative on purpose: the same files are served from a project subfolder on
// GitHub Pages, where an absolute path would leave the site (Ruling R33/R34).
async function readConfig() {
  try {
    const response = await fetch("./public-config.json", { cache: "no-store" });
    if (!response.ok) return null;
    const config = await response.json();
    return config?.configured ? config : null;
  } catch {
    return null;
  }
}

const config = await readConfig();

// The browser's localStorage can throw just by being read (blocked or private
// storage), so it is read here, every time, and null stands in for it.
function readLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The Traditional map (spec 2026-10-05 §4) loads only when 繁體 is chosen,
// or when the 繁體 draft 13614-C is made. A retry after a failure asks for a
// fresh URL (hant.mjs).
const loadHant = createHantLoader((url) => import(url));
// How long a saved 繁體 waits for its map before startup shows 简体; the
// 繁體 draft waits as long before it fails.
const HANT_START_TIMEOUT_MS = 5000;

if (!config) {
  // Nothing to sign in to. Say what to set, and stop before any SDK loads.
  root.innerHTML = views.setupNeeded();
} else {
  // The only place the Supabase SDK is imported, from the committed bundle.
  const { createClient } = await import("./vendor/supabase.mjs");
  const supabase = createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    { auth: { persistSession: true, autoRefreshToken: true } },
  );
  const auth = createAuth(supabase, {
    cooldownSeconds: config.authResendCooldownSeconds,
  });
  const store = createStore(supabase);
  const controller = createController({
    store,
    auth,
    render,
    sessionStorage: window.sessionStorage,
    windowEvents: window,
    cooldownSeconds: config.authResendCooldownSeconds,
    localStorage: readLocalStorage(),
    languages: [...(navigator.languages ?? [navigator.language])],
    demoTools: demoToolsFromConfig(config),
  });
  // The screen language now, for text this file writes itself.
  const screenLang = () => viewLang(controller.getState());

  // A toast that has to wait for the first render: a
  // saved 繁體 whose map could not load at startup.
  let pendingToast = null;
  // The switch, other tabs and startup all ask for a language here; only the
  // newest wish is applied once 繁體's map has loaded.
  const languageRequests = createLanguageRequests({ hantReady, loadHant });
  // Nothing is drawn before controller.start(): a language adopted earlier
  // is drawn by start's own first render.
  let controllerStarted = false;
  let cooldownTimer = null;
  // Where the keyboard was when a dialog opened (a `describeFocus` record), so
  // closing it returns to that very control — the row's own Log contact button,
  // not the first one on the page.
  let focusBeforeDialog = null;
  // The dialog the last render drew. Only a dialog that has just opened takes
  // the keyboard; a re-render of one already open (its own busy state, the
  // re-read after an action, another window's change) leaves the caret where
  // the person is typing.
  let shownDialog = null;
  // The held upload read (state.shadedReview) the last render drew. Only one
  // that has just appeared takes the keyboard, to its heading; a redraw of
  // the same one leaves the keyboard where it is.
  let shownShadedReview = null;
  // A control inside the open dialog that its own action disabled while it was
  // in flight: the keyboard goes back to it once the action lands, rather than
  // being left on the dialog container.
  let heldInDialog = null;
  let quiet = false;
  let sampleSeed = 0;
  // The redraw hold (redraw-hold.mjs). While a pointer is down, or an IME
  // composition is in progress, anywhere on the page, a requested render
  // waits: replacing the page between mousedown and mouseup would swallow the
  // click (#186: a realtime redraw on a staff page did), and replacing it
  // mid-composition would lose the half-typed text (spec §2.4 rules 1 and 4
  // for the version-2 form; every staff page too, for a name typed in Chinese).
  const redrawHold = createRedrawHold({ flush: () => flushHeld() });
  let holdTimer = null;
  // In-place DOM updates waiting for the press to end (afterPress).
  let heldUpdates = [];
  // Where the last render drew: screen, case and sub-step. A version-2 render
  // at the same place keeps focus, caret and scroll; one at a new place (a new
  // sub-step, or entering or leaving the form) starts at the top.
  let lastPlace = null;
  // The connection as the last render drew it: "back online" is said only
  // after a real loss, never on the first connection (design D7).
  let drawnConnection = "unknown";
  // What is half-typed into a staff form, by field id. A re-render can arrive
  // at any moment — a realtime change, a click elsewhere, a connection notice —
  // and rebuilding the page must not empty a box somebody is writing in. What
  // was typed for an action is dropped the moment it is sent. An edit to a
  // saved value is kept as `{ value }` and a tick not yet sent as `{ checked }`
  // (form-values.mjs). Cancel on the best time drops its whole form, and a
  // dialog closing drops its ticks. It all belongs to the one signed in and
  // the case it was typed on: anyone else, or nobody, or
  // another case opened (by any path), starts with none, so nothing can
  // reappear where it does not belong.
  const formDrafts = new Map();
  // The season-end dialog's list as last drawn (closeUnsignedListKey), or null.
  let unsignedListShown = null;
  // Whose unsent entries formDrafts holds, and the case they were typed on
  // (the last case open; null before any), both checked on every render
  // (restoreFormDrafts), like the draft link's maker.
  let draftsOwner = null;
  let draftsCase = null;
  // The link offered when the browser blocks the draft's tab. It lives here,
  // not in the page: every render draws it again (showDraftLink) until it is
  // opened, a new press replaces it, its URL is revoked a minute on, or its
  // maker is no longer the one signed in.
  const draftOffers = createDraftOffer({
    revoke: (url) => URL.revokeObjectURL(url),
    onExpire: () => showDraftLink(),
  });

  function screenFor(state) {
    if (!state.principal) {
      // The sign-in form is only for a visitor who is known to be signed out.
      if (views.showsNoAccess(state)) return views.noAccessScreen(state);
      if (state.session !== "none") return views.unreachableScreen(state);
      return client.accessScreen(state);
    }
    if (isStaffWindow(state.principal)) return views.staffScreen(state);
    return client.clientScreen(state);
  }

  // ---- the staff sidebar's peek (spec 2026-10-04 §8) -----------------------
  // Never saved and never a render: the peek is applied to the page in place,
  // after every render too, so a realtime redraw keeps it.
  const peek = createSidebarPeek({ onChange: () => applyPeek() });
  function applyPeek() {
    const shell = root.querySelector(".app-shell");
    if (!shell) {
      peek.setPinned(true); // no sidebar on this screen: end any peek and its timers
      return;
    }
    const pinned = !shell.classList.contains("sidebar-closed");
    peek.setPinned(pinned);
    peek.hold(Boolean(controller.getState().dialog));
    const peeking = !pinned && peek.isPeeking();
    shell.classList.toggle("sidebar-peek", peeking);
    const toggle = shell.querySelector(".sidebar-toggle");
    if (toggle) {
      const label = toggleLabel({ pinned, peeking });
      toggle.setAttribute("aria-expanded", String(pinned || peeking));
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
    const sidebar = shell.querySelector("#app-sidebar");
    if (!sidebar) return;
    const hide = !pinned && !peeking;
    // A peek never hides the keyboard: closing it with focus inside moves
    // the keyboard to the toggle, which is always visible.
    const hadFocus = hide && !sidebar.hidden && sidebar.contains(document.activeElement);
    sidebar.hidden = hide;
    if (hadFocus) toggle?.focus();
  }

  // The open shaded-section editor (design D7) and the case it was opened on.
  let shadedEditor = null;
  let shadedEditorCase = null;

  function render(focus = false) {
    // Signed out in another tab, or the case left: the editor's session is
    // gone, so it closes without asking, and #app is usable again.
    if (shadedEditor && editorGone(controller.getState(), shadedEditorCase)) shadedEditor.close();
    if (quiet) return;
    // On every page a render waits for the press and the composition to end;
    // `flushHeld` draws it then, unless another render drew first. The
    // press's own click (and a submit button's submit) comes in the same task
    // as pointerup, which ends the hold, so the click's own render is never
    // held.
    if (redrawHold.request(focus)) return;
    redrawHold.drawn(); // a real render: any held request is now satisfied (spec §2.4 rule 1)
    const state = controller.getState();
    // A case's place is its sub-step (resolved as the page resolves it), so
    // scroll and focus restore compare sub-steps. Add a case is one place: an
    // accordion toggle, a realtime redraw and the first save (which adopts a
    // case) keep focus, caret and scroll.
    const place =
      state.screen === "office-add-case"
        ? state.screen
        : `${state.screen}|${state.selectedCaseId}|${controller.currentSubstep()}`;
    const wasV2 = v2OnPage();
    // A full rebuild replaces the fields, so remember where the keyboard was.
    // `describeFocus` decides what can be read; nothing it does may throw here,
    // because this runs before the page is replaced.
    const active = document.activeElement;
    const keyboard = active?.closest?.("#app") ? describeFocus(active) : null;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    root.innerHTML = views.page(state, screenFor(state));
    applyPeek();
    const lang = viewLang(state);
    document.documentElement.lang = lang;
    document.title = t("frame.title", {}, lang);
    // The page behind an open dialog is inert; the dialog and the live
    // regions are not (screen-states). Every render, because a realtime
    // redraw replaces everything it applied to.
    for (const child of root.children) child.inert = Boolean(state.dialog) && inertWhileDialog(child);
    if (pendingToast) {
      notify("warning", t(pendingToast, {}, lang));
      pendingToast = null;
    }
    const v2Place = wasV2 || v2OnPage();
    restoreFormDrafts();
    syncContactForms();
    syncCloseUnsigned();
    syncVolunteerOther();
    showDraftLink();
    markPressed(state);
    tickCooldown(state);
    const opened = Boolean(state.dialog) && state.dialog !== shownDialog;
    shownDialog = state.dialog ?? null;
    const held = heldInDialog;
    heldInDialog = null;
    if (opened)
      requestAnimationFrame(() => {
        const modal = root.querySelector(".modal");
        if (!modal) return;
        // Something inside the dialog always takes the keyboard, even when the
        // body is only prose: the close button, or the container itself.
        dialogFocusTarget(
          [...modal.querySelectorAll("button,input,textarea,select,a[href]")],
          modal,
        )?.focus();
      });
    else if (state.dialog) {
      // Already open: put the keyboard back where it was, looked up inside the
      // dialog only — the drawer's "Open the case" has a twin in the queue
      // behind it. If that control is gone or disabled, the dialog itself
      // keeps the keyboard, so it never falls out behind an aria-modal.
      const modal = root.querySelector(".modal");
      const scope = modal ?? root;
      const wanted = keyboard ?? held;
      if (!(wanted && restoreField(wanted, scope))) {
        modal?.focus();
        if (wanted && findField(wanted, scope)?.disabled) heldInDialog = wanted;
      }
    } else if (v2Place && !focus) {
      // Version 2 only (spec §2.4 rule 4). The place is compared here rather
      // than inferred from the caller: a step change also arrives as
      // `show()` → `render(false)`, the same path as a realtime redraw.
      if (place === lastPlace) {
        if (keyboard) restoreField(keyboard);
        window.scrollTo(scrollX, scrollY);
      } else {
        root.querySelector("#main")?.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
    } else if (focus) {
      root.querySelector("#main")?.focus();
      window.scrollTo(0, 0);
    } else if (keyboard) restoreField(keyboard);
    // A held upload read that has just appeared takes the keyboard, to its
    // heading (Task 3 draws it); a redraw of the same read leaves it be.
    const review = state.shadedReview ?? null;
    if (review && review !== shownShadedReview && !state.dialog)
      root.querySelector("#shaded-review-title")?.focus();
    shownShadedReview = review;
    // A render that removed the focused sidebar control (and whose restore
    // missed) must not leave the peek held.
    peek.focus(peekZone(document.activeElement) === "sidebar" && keyboardFocus(document.activeElement));
    lastPlace = place;
    // The page under the toast may have changed (a staff screen, Add a case's bar).
    placeToast();
    // Back online after a real loss, never on the first connection (design D7).
    if (["offline", "reconnecting"].includes(drawnConnection) && state.connection === "online")
      notify("info", t("toast.back_online", {}, lang));
    drawnConnection = state.connection;
  }

  // ---- the redraw hold: a press (#186) and an IME composition, on every
  // page (spec §2.4 for the version-2 form) ----------------------------------

  function v2OnPage() {
    return Boolean(root.querySelector(V2_FORMS));
  }

  root.addEventListener("pointerdown", () => {
    redrawHold.press();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(release, 2000); // safety: a pointerup that never arrives
  }, true);
  function release() {
    clearTimeout(holdTimer);
    redrawHold.release(); // flushes a task later: after the click
  }
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("contextmenu", release, true); // right-click, Ctrl+click
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", release);
  // A pointerover on root itself is Chrome moving the hover to root when a
  // render removed the node under a resting mouse; the pointer didn't move,
  // so it is not a leave (it would end the no-re-peek after a collapse). The
  // pointerout that follows it names the new node.
  root.addEventListener("pointerover", (event) => {
    if (event.target !== root) peek.pointer(peekZone(event.target), event.pointerType);
  });
  root.addEventListener("pointerout", (event) => peek.pointer(peekZone(event.relatedTarget), event.pointerType));
  // Only keyboard focus in the sidebar holds a peek (a mouse click focuses
  // buttons in Chrome). Within the sidebar the next focusin decides.
  function keyboardFocus(element) {
    try { return element.matches(":focus-visible"); } catch { return true; }
  }
  root.addEventListener("focusin", (event) =>
    peek.focus(peekZone(event.target) === "sidebar" && keyboardFocus(event.target)));
  root.addEventListener("focusout", (event) => {
    if (peekZone(event.relatedTarget) !== "sidebar") peek.focus(false);
    // A composition cannot go on in a field that lost the keyboard; browsers
    // end it with compositionend, and this is the safety if one doesn't, so a
    // staff page never stops redrawing.
    redrawHold.compositionEnd();
  });
  root.addEventListener("compositionstart", () => redrawHold.compositionStart());
  // One flush, a task later: after the composition's last input.
  root.addEventListener("compositionend", () => redrawHold.compositionEnd());
  function flushHeld() {
    // The same test as render's hold: whichever of a press and a composition
    // ends first, the other keeps the held render waiting.
    if (redrawHold.holding()) return;
    const held = redrawHold.pending();
    if (held !== null) render(held); // render() clears it
    for (const fn of heldUpdates.splice(0)) fn(); // each looks its node up by id; a gone node is a no-op
  }
  // A DOM update caused by `change` can move the layout (a note gaining text
  // pushes Continue down), so it waits for any press in progress, like a render.
  function afterPress(fn) {
    if (redrawHold.holding()) heldUpdates.push(fn);
    else setTimeout(fn, 0);
  }

  // What was sent is no longer a draft — and only what was sent. A page holds
  // one form per open request and per open task, so emptying the whole map
  // would throw away a half-typed escalation reason for request A because
  // request B was verified. A control that carries no form (a plain button)
  // carried no typed text either, so there is nothing of its own to clear.
  function clearFormDrafts(form) {
    if (!form) return;
    for (const field of form.querySelectorAll("[id]")) formDrafts.delete(field.id);
  }

  // A dialog's form put away unsent takes its ticks with it: opened again, it
  // shows what is saved. (Its typed text is kept, as it always was.)
  function clearFormTicks(form) {
    if (!form) return;
    for (const field of form.querySelectorAll("input[type=checkbox][id], input[type=radio][id]"))
      formDrafts.delete(field.id);
  }

  // The volunteer drawer is one form for every volunteer, so its typed text
  // goes with its ticks: a name typed for one would otherwise appear in the
  // next one's drawer. Every field's draft, whether the form is drawn or not.
  function forgetVolunteerDrafts() {
    clearFormDrafts(root.querySelector("#volunteer-form"));
    for (const id of [...formDrafts.keys()])
      if (id.startsWith("volunteer-") && id !== "volunteer-search") formDrafts.delete(id);
  }

  // The Other language box shows its field only while Other is ticked: at
  // once on a tick, and after a redraw that put an unsent tick back.
  function syncVolunteerOther() {
    const box = root.querySelector("#volunteer-language-other");
    const field = root.querySelector("#volunteer-other-language");
    if (box && field) field.hidden = !box.checked;
  }

  // Unticking a certificate unticks the roles that lose what they need, in the
  // form (rolesToUntick decides; the save would drop them anyway).
  function syncVolunteerRoles(form, changed) {
    const roles = [...form.querySelectorAll('input[name="role"]:checked')];
    const certificates = [...form.querySelectorAll('input[name="certificate"]:checked')].map((box) => box.value);
    const drop = rolesToUntick(roles.map((box) => box.value), certificates, changed);
    for (const box of roles) {
      if (!drop.includes(box.value)) continue;
      box.checked = false;
      for (const [id, draft] of checkDrafts(box)) keepDraft(id, draft);
    }
  }

  // One input event's draft for a field, or null: the field is back to what
  // it was drawn with, and keeps none.
  function keepDraft(id, draft) {
    if (draft === null) formDrafts.delete(id);
    else formDrafts.set(id, draft);
  }

  // The season-end confirmation covers the list the admin saw. If the list
  // changed under the open dialog (a conflict re-read, a realtime redraw),
  // the box is not carried over: the new list is confirmed afresh.
  function dropStaleCloseConfirmation() {
    const key = root.querySelector("#close-unsigned-form")
      ? closeUnsignedListKey(controller.getState().cases ?? [])
      : null;
    if (key !== null && unsignedListShown !== null && key !== unsignedListShown)
      formDrafts.delete("field-close-unsigned-confirmed");
    unsignedListShown = key;
  }

  // Staff form fields are not rendered from controller state — they are blank
  // boxes for text that only exists until it is sent, and boxes drawn from
  // what is saved — so what was typed is put back by hand after a rebuild:
  // into a blank box only while it is still empty, and an edit to a saved
  // value, or an unsent tick (or untick), as it was. Somebody else signed in,
  // or nobody, gets none of it: a sign-out from another tab or an expired
  // session counts too, as it does for the draft link. Nor does another case,
  // however it was opened: the open case can go (deleted elsewhere) and a
  // board control's claim select the next without passing `open-case`. A page
  // with no case open changes nothing, so the board's own forms keep theirs
  // and a list and back to the same case keeps the case's.
  function restoreFormDrafts() {
    dropStaleCloseConfirmation();
    const userId = signedInUserId();
    if (userId !== draftsOwner) formDrafts.clear();
    draftsOwner = userId;
    const state = controller.getState();
    const caseId = state.savedCase?.id ?? state.selectedCaseId ?? null;
    if (caseId !== null && draftsCase !== null && caseId !== draftsCase) formDrafts.clear();
    if (caseId !== null) draftsCase = caseId;
    for (const [id, value] of formDrafts)
      restoreDraft(root.querySelector(`#${CSS.escape(id)}`), value);
    // A collapsed Exit Form group holding something typed is opened again, so
    // the field a refusal names is in view (design D7).
    const exitGroups = [...root.querySelectorAll("details.q-exit-group:not([open])")];
    const ids = exitGroups.map((group) => [...group.querySelectorAll("[id]")].map((field) => field.id));
    for (const index of groupsToOpen(ids, formDrafts)) exitGroups[index].open = true;
  }

  // Every field the page rebuilds is rendered from state, so the value is back
  // already; this puts the cursor back where it was so typing can continue.
  // The id decides which field that is: a page can hold several fields with the
  // same name — one `reason` box per open document request — and the name alone
  // would put the cursor in the first of them.
  function findField(focus, scope = root) {
    // Most specific first; a button that carries only what it does is found by
    // that, which is what keeps the keyboard on it across a shared update.
    for (const selector of focusSelectors(focus)) {
      const field = scope.querySelector(selector);
      if (field) return field;
    }
    return null;
  }

  // The pressed control (design D5), kept only for the presses that hold the
  // buttons, and found again after every draw while the press runs. A
  // sub-step move is never marked because it is not on the allow-list (its
  // `pressed` stays null); the save chip says Saving.
  const BUSY_ACTIONS = Object.freeze(["save-office-draft", "send-office-draft"]);
  function busyControl(control) {
    if (!control?.dataset) return false;
    if (control.dataset.caseAction || control.dataset.assistanceAction) return true;
    return BUSY_ACTIONS.includes(control.dataset.action);
  }
  let pressed = null;
  function markPressed(state) {
    if (!state.busy && !state.officeSaving) {
      pressed = null;
      return;
    }
    if (!pressed) return;
    const control = findField(pressed);
    if (!control || control.classList.contains("is-busy")) return;
    control.classList.add("is-busy");
    control.setAttribute("aria-busy", "true");
    control.insertAdjacentHTML("afterbegin", icon("spinner", "spin"));
  }

  // Answers whether the keyboard really landed (a disabled button refuses it).
  function restoreField(focus, scope = root) {
    const field = findField(focus, scope);
    if (!field) return false;
    field.focus();
    const landed = document.activeElement === field;
    if (focus.caret === null || !("setSelectionRange" in field)) return landed;
    try {
      // A selection comes back whole, so typing still replaces it (#120).
      field.setSelectionRange(focus.caret, focus.selectionEnd ?? focus.caret, focus.direction ?? "none");
    } catch {
      // Some input types refuse a selection range; the focus is what matters.
    }
    return landed;
  }

  // The countdown is the only thing on the page that changes by itself, so it
  // is the only thing that owns a timer, and it stops the moment it reaches 0.
  // It patches its own two elements rather than re-rendering: a rebuild once a
  // second would replace the code field under a visitor who is still typing
  // into it, and `required` would then stop the form with nothing on screen.
  function tickCooldown(state) {
    const running =
      !state.principal &&
      state.authStep === "code" &&
      controller.cooldownRemaining() > 0;
    if (running && !cooldownTimer)
      cooldownTimer = window.setInterval(() => {
        const left = controller.cooldownRemaining();
        if (left <= 0) {
          window.clearInterval(cooldownTimer);
          cooldownTimer = null;
        }
        paintCountdown(left);
      }, 1000);
    else if (!running && cooldownTimer) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }

  function paintCountdown(secondsLeft) {
    const countdown = root.querySelector('[data-role="resend-countdown"]');
    const resend = root.querySelector('[data-action="resend-code"]');
    if (!countdown || !resend) return;
    if (secondsLeft > 0) {
      countdown.textContent = t("signin.countdown", { n: secondsLeft }, screenLang());
      resend.textContent = t("signin.resend_in", { n: secondsLeft }, screenLang());
      resend.disabled = true;
      return;
    }
    countdown.textContent = "";
    resend.textContent = t("signin.resend", {}, screenLang());
    resend.disabled = false;
  }

  // The user id signed in right now, or null for nobody: the one notion of
  // "who" that unsent entries, the draft link and a press's message share.
  function signedInUserId() {
    return controller.getState().principal?.userId ?? null;
  }

  // The toast (design D4): one host beside #app, made once, never redrawn.
  // The live region is the text span; the Dismiss sits outside it.
  const toastHost = document.createElement("div");
  toastHost.id = "toast";
  toastHost.className = "toast";
  const toastIcon = document.createElement("span");
  toastIcon.className = "toast-icon-slot";
  const toastText = document.createElement("span");
  toastText.className = "toast-text";
  toastText.setAttribute("role", "status");
  toastText.setAttribute("aria-live", "polite");
  const toastDismiss = document.createElement("button");
  toastDismiss.type = "button";
  toastDismiss.className = "toast-dismiss";
  toastDismiss.innerHTML = icon("close");
  toastHost.append(toastIcon, toastText, toastDismiss);
  root.after(toastHost);
  let toastCameFrom = null;
  const toast = createToastTimer({
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
    onHide: () => {
      const hadFocus = toastHost.contains(document.activeElement);
      toastHost.classList.remove("visible");
      // After the 0.2 s fade, so it never shows an empty box; a toast shown
      // again meanwhile keeps its words.
      window.setTimeout(() => {
        if (!toast.shown) toastText.textContent = "";
      }, 200);
      if (hadFocus) {
        const back = toastCameFrom?.isConnected ? toastCameFrom : root.querySelector("#main");
        back?.focus({ preventScroll: true });
      }
      toastCameFrom = null;
    },
  });
  toastHost.addEventListener("mouseenter", () => toast.hover(true));
  toastHost.addEventListener("mouseleave", () => toast.hover(false));
  toastHost.addEventListener("focusin", (event) => {
    if (!toastHost.contains(event.relatedTarget)) toastCameFrom = event.relatedTarget ?? null;
    toast.focus(true);
  });
  toastHost.addEventListener("focusout", (event) => {
    if (!toastHost.contains(event.relatedTarget)) toast.focus(false);
  });
  toastDismiss.addEventListener("click", () => toast.hide());
  toastHost.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      toast.hide();
    }
  });

  // On a staff screen bottom right; above Add a case's bar while it is sticky
  // and on screen. Re-measured on scroll and resize while the toast shows.
  function placeToast() {
    toastHost.classList.toggle("toast-staff", isStaffWindow(controller.getState().principal));
    const bar = root.querySelector(".add-case-bar");
    let lift = 0;
    if (bar && getComputedStyle(bar).position === "sticky") {
      const rect = bar.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) lift = Math.ceil(rect.height);
    }
    toastHost.style.setProperty("--toast-lift", `${lift}px`);
  }
  window.addEventListener("scroll", () => toast.shown && placeToast(), { passive: true });
  window.addEventListener("resize", () => toast.shown && placeToast());

  // `kind` is "success", "info" or "warning" (design D4); errors never toast
  // (design D1). `by` is the user id signed in when a press started (a press
  // takes it before its first await). Its result message is for that person
  // only: if somebody else is signed in by now, or nobody, it is not shown.
  // Messages that are not the result of a press leave `by` out.
  function notify(kind, text, by) {
    if (by !== undefined && by !== signedInUserId()) return;
    const parts = views.toastParts({ kind, text, lang: screenLang() });
    toastIcon.innerHTML = parts.icon;
    toastText.textContent = parts.text;
    toastDismiss.setAttribute("aria-label", parts.dismissLabel);
    toastHost.dataset.kind = kind;
    toastHost.classList.add("visible");
    placeToast();
    toast.show(kind);
    // A toast that replaces another keeps the hold the page still has: no new
    // mouseenter or focusin fires under a pointer or focus that hasn't moved.
    toast.hover(toastHost.matches(":hover"));
    toast.focus(toastHost.contains(document.activeElement));
  }

  // Errors never toast (design D1). The controller records what it refuses
  // and what fails; this only makes sure a press never fails silently. The
  // sign-in form states its own failures.
  function safetyNet(error, by, shown) {
    if (by !== signedInUserId()) return;
    const state = controller.getState();
    if (!state.principal || state.authError) return;
    // `shown` is the count of recorded errors when the press began: the
    // error itself is cloned by getState, so it cannot be compared.
    if (state.errorCount !== shown) return;
    // The payload builders' own VALIDATION sentences (case-actions.mjs,
    // questionnaires.mjs) are fixed, staff-facing text that names what to fix;
    // a refused form must show them rather than "Something went wrong."
    const known =
      typeof error?.message === "string" &&
      (Object.hasOwn(SENTENCES, error.message) || error.code === "VALIDATION");
    controller.noteLocalFailure({ code: error?.code ?? "SERVER_ERROR", message: known ? error.message : "Something went wrong." });
  }

  // A typed character must not rebuild the page under the cursor, so the draft
  // is updated quietly and only the save chip is refreshed in place.
  function refreshSaveChip() {
    const chip = root.querySelector(".application-meta .save-chip");
    if (chip) chip.outerHTML = client.saveStatus(controller.getState());
  }

  // ---- the version-2 forms (spec §2.4, §2.5) ----------------------------
  //
  // Their controls carry `data-control` and `data-q` (the question, "hh" for a
  // household control), and are read with the renderer's own `readField` and
  // `readForm`. `#field-confirmed` has no `data-q`, so it never matches. Each
  // form is spelled out: `${V2_FORMS} [data-control]…` would match the client
  // form element itself through its first part.
  const V2_CONTROLS = "#intake-v2-form [data-control][data-q], #add-case-v2-form [data-control][data-q]";
  // A sub-step or slot id in an element id: "about.you" → "about-you".
  const dashed = (id) => String(id ?? "").replace(/\./g, "-");

  // The renderer's id scope of the form a control sits in: the client's own,
  // or the office's on Add a case.
  const scopeOf = (element) => (element?.closest?.("#add-case-v2-form") ? "office" : "client");

  // What a control answers, as plain values, so an update queued behind a
  // press can find its question again after the page has been replaced.
  function v2Ref(control) {
    const { q, member, sub } = control.dataset;
    const scope = scopeOf(control);
    return member !== undefined && sub !== undefined
      ? { q, member: Number(member), sub, scope }
      : { q, scope };
  }

  // The question a ref points at, its value in `draft`, the id base of its
  // note and count, and its revealed id (`hh[<n>].<sub>` in a household).
  function v2Answer(ref, draft) {
    const top = findQuestion(2, ref.q);
    if (!top) return null;
    const scope = ref.scope ?? "client";
    if (ref.sub === undefined)
      return { question: top, value: draft[ref.q], base: `field-${scope}-${ref.q}`, id: ref.q };
    const question = (top.fields ?? []).find((field) => field.id === ref.sub);
    if (!question) return null;
    const members = Array.isArray(draft[ref.q]) ? draft[ref.q] : [];
    return {
      question,
      value: members[ref.member]?.[ref.sub],
      base: `field-${scope}-${ref.q}-${ref.member}-${ref.sub}`,
      id: `${ref.q}[${ref.member}].${ref.sub}`,
      group: top,
      groupBase: `field-${scope}-${ref.q}`,
    };
  }

  // className and textContent only (spec §2.4 rule 2), and only when they
  // differ, so a live note is not re-announced on every keystroke.
  function paintInPlace(node, baseClass, { text, className }) {
    if (!node) return;
    const wanted = className ? `${baseClass} ${className}` : baseClass;
    if (node.className !== wanted) node.className = wanted;
    if (node.textContent !== text) node.textContent = text;
  }

  // The note of the control's question (and in a household, the group's own
  // note too), from the controller's state now. `showInvalid(note, answer,
  // revealed)` decides whether an invalid value shows its error.
  function paintV2Note(ref, showInvalid) {
    const state = controller.getState();
    const draft = state.draftAnswers ?? {};
    const answer = v2Answer(ref, draft);
    if (!answer) return;
    // Add a case marks what is missing only after a refused Send; the client's
    // form once the sub-step has been left.
    const showMissing =
      ref.scope === "office"
        ? Boolean(state.addCaseShowMissing)
        : (state.visitedSubsteps ?? []).includes(controller.currentSubstep());
    const revealed = new Set(state.revealed ?? []);
    const note = document.getElementById(`${answer.base}-note`);
    if (note)
      paintInPlace(
        note,
        "q-note",
        noteState(answer.question, answer.value, {
          showMissing,
          showInvalid: showInvalid(note, answer, revealed),
          lang: viewLang(state),
        }),
      );
    if (answer.group)
      paintInPlace(
        document.getElementById(`${answer.groupBase}-note`),
        "q-note",
        noteState(answer.group, draft[ref.q], { showMissing, showInvalid: revealed.has(ref.q), lang: viewLang(state) }),
      );
  }

  // The current sub-step's rail mark and its step's, the same functions the
  // render uses. Either span may be absent (the phone bar folds the tree).
  function paintV2Rail() {
    const state = controller.getState();
    const current = controller.currentSubstep();
    const substep = current ? findSubstep(current) : null;
    if (!substep) return;
    const answers = state.draftAnswers ?? {};
    const marks = {
      answers,
      visited: state.visitedSubsteps ?? [],
      revealed: new Set(state.revealed ?? []),
      cards: cardsFor(answers, state.savedCase?.documentCards ?? []),
      lang: viewLang(state),
    };
    const paint = (id, status) =>
      paintInPlace(document.getElementById(id), "rail-status", {
        text: status.text,
        className: `is-${status.key}`,
      });
    paint(`rail-sub-${dashed(current)}-status`, substepStatus(current, marks));
    paint(`rail-step-${substep.step.id}-status`, stepRollup(substep.step.id, marks));
  }

  // Add a case's count of parts, each part's status and Send, from the draft
  // now: className, textContent and Send's disabled only (spec §2.4 rule 2).
  function paintAddCase() {
    if (!root.querySelector("#add-case-v2-form")) return;
    const state = controller.getState();
    const parts = addCaseParts(state.draftAnswers ?? {});
    const count = document.getElementById("add-case-count");
    const text = addCaseCountText(parts);
    if (count && count.textContent !== text) count.textContent = text;
    for (const part of parts) {
      const status = addCasePartStatus(part.needs);
      paintInPlace(document.getElementById(`add-sub-${dashed(part.id)}-status`), "add-sub-status", status);
    }
    const send = document.getElementById("add-case-send");
    if (send)
      send.disabled = addCaseSendOff({
        confirmed: (state.openPanels ?? []).includes("confirmed"),
        busy: state.busy,
        officeSaving: state.officeSaving,
      });
  }

  // A longtext's character count.
  function paintV2Count(ref) {
    const state = controller.getState();
    const answer = v2Answer(ref, state.draftAnswers ?? {});
    if (answer?.question.type !== "longtext") return;
    const lang = viewLang(state);
    const count = document.getElementById(`${answer.base}-count`);
    if (count && count.textContent !== countText(answer.value, lang))
      count.textContent = countText(answer.value, lang);
  }

  // The sub-steps the page lists differ from the ones the draft shows now: a
  // driver can add or remove another sub-step without changing this page's
  // own questions (a death year adds "Your late spouse"). The page is the
  // "before", as in needsRedraw: typing has already put the value in the
  // draft. The client's form lists them in the rail; Add a case lists its
  // question parts, plus its fixed Documents part.
  function listedSubstepsStale(form) {
    const state = controller.getState();
    const answers = state.draftAnswers ?? {};
    const ids = (selector) => [...root.querySelectorAll(selector)].map((element) => element.dataset.substep);
    if (form.id === "add-case-v2-form")
      return (
        ids("#add-case-v2-form .add-sub[data-substep]").filter((id) => id !== "documents").join(" ") !==
        addCaseParts(answers).map((part) => part.id).join(" ")
      );
    const cards = cardsFor(answers, state.savedCase?.documentCards ?? []);
    return ids(".rail-sublink[data-substep]").join(" ") !== visibleSubsteps(answers, cards, state.visitedSubsteps ?? []).join(" ");
  }

  // Every rendered answer into the draft, quietly: the action that follows
  // (a step change, a save, a fill) draws the page. Empty household cards are
  // dropped, as `readForm` drops them.
  function sweepV2Form() {
    const form = root.querySelector(V2_FORMS);
    if (!form) return;
    // A held redraw means the draft has moved on (a realtime change landed
    // during the press) and the boxes still show the old values: sweeping them
    // would write those back over the office's edit. Every keystroke is
    // already in the draft through `input`; the sweep only catches autofill.
    if (redrawHold.pending() !== null) return;
    quiet = true;
    try {
      controller.editAnswers(readForm(form));
    } finally {
      quiet = false;
    }
  }

  // A version-2 control's `change`. For a text field it fires on the
  // mousedown of the next press, so nothing on screen may move now (spec §2.4
  // rule 1): the state is updated at once, the page after the press.
  function changeV2Field(field) {
    const ref = v2Ref(field);
    // `change` fires each time focus moves between a date's three boxes, so a
    // date's error is revealed only when its step is left (spec §2.5).
    const isDate = field.dataset.datePart !== undefined;
    quiet = true;
    try {
      controller.editAnswers(readField(field));
      if (!isDate) {
        const answer = v2Answer(ref, controller.getState().draftAnswers ?? {});
        if (answer && checkValue(answer.question, sendable(answer.question, answer.value)))
          controller.revealInvalid(answer.id);
      }
    } finally {
      quiet = false;
    }
    if (!isDate)
      // Everything read when it runs, not now: a press may have changed the
      // step or replaced the page in between, and then this writes exactly
      // what that render wrote, or finds its node gone.
      afterPress(() => {
        paintV2Note(ref, (_note, answer, revealed) => revealed.has(answer.id));
        // The rail is the client form's only; Add a case has its count instead.
        if (ref.scope === "office") paintAddCase();
        else paintV2Rail();
        refreshSaveChip();
      });
    // A full redraw only when the visible questions change (rule 3): the ids
    // on the page against the ids the draft makes visible. Queued, so a Tab's
    // new target is the focus the render puts back.
    const choice =
      field.type === "radio" || field.type === "checkbox" || field.tagName === "SELECT";
    let redraw = choice;
    if (!redraw && drivesVisibility(ref.q)) {
      const form = field.closest(V2_FORMS);
      const draft = controller.getState().draftAnswers ?? {};
      const idsIn = (scope) =>
        new Set([...scope.querySelectorAll("[data-q]")].map((element) => element.dataset.q));
      if (form.id === "add-case-v2-form")
        // Each open part against what the draft makes visible in it.
        redraw = [...form.querySelectorAll(".add-sub[data-substep]")].some((part) => {
          const id = part.dataset.substep;
          const body = document.getElementById(`add-sub-${dashed(id)}-body`);
          return id !== "documents" && body && !body.hidden && needsRedraw(idsIn(body), id, draft);
        });
      else redraw = needsRedraw(idsIn(form), controller.currentSubstep(), draft);
      if (!redraw) redraw = listedSubstepsStale(form);
    }
    if (redraw) setTimeout(() => render(), 0);
  }

  // A sub-step change: what is in the boxes first (the move saves it), then
  // the move, then the keyboard to the new page.
  async function moveV2(go, focusId = null) {
    sweepV2Form();
    await go();
    focusV2Arrival(focusId);
  }

  // Where the keyboard lands after a sub-step change: the element `focusId`
  // names (an "Upload now" card on the new page), else the alerts heading on
  // arriving at review.check, else `#main` (the render has already scrolled
  // to the top).
  function focusV2Arrival(focusId = null) {
    const card = focusId ? document.getElementById(focusId) : null;
    if (card && root.contains(card)) return card.focus();
    const alerts =
      controller.currentSubstep() === "review.check" ? root.querySelector("#alerts-title") : null;
    if (alerts) return alerts.focus();
    root.querySelector("#main")?.focus({ preventScroll: true });
  }

  // The panels a generic `toggle-panel` control may open: the phone's "All
  // steps", a documents sub-step's Maybe needed group, and a summary section
  // (`summary-shut:<step id>`, collapsed while present). Rail steps have their
  // own action (`setRailExpanded`), and nothing else is a panel here.
  const V2_PANELS = /^(rail-all|maybe:[a-z]+\.[a-z_]+|summary-shut:[a-z]+)$/;

  // `opener` is passed when the control was described before an await (the
  // Log contact button, captured before its case is loaded); otherwise it is
  // whatever holds the keyboard now.
  function openDialog(name, context = null, opener = null) {
    const active = document.activeElement;
    focusBeforeDialog = opener ?? (active?.closest?.("#app") ? describeFocus(active) : null);
    controller.openDialog(name, context);
  }

  // Back to the very control that opened the dialog — matched on its row
  // (`data-case-id`, `data-item-id`) as well as what it does — or, when that
  // row has gone, to the fallback. A drawer's row can go while it is open
  // (another window resolved the task), so a drawer always has one: the queue.
  function closeDialog(fallbackFocusSelector) {
    const dialog = controller.getState().dialog;
    // The volunteer and assign drawers open from the Volunteers page, which
    // has no queue.
    const fallback =
      fallbackFocusSelector ??
      (dialog === "assign" || dialog === "volunteer"
        ? "#main"
        : views.DRAWERS.includes(dialog)
          ? "#office-queue-title"
          : null);
    // The volunteer drawer's typed text goes with it (forgetVolunteerDrafts).
    if (dialog === "volunteer") forgetVolunteerDrafts();
    // A dialog's form closes with it; ticks left unsent go too.
    for (const form of root.querySelectorAll(".modal form")) clearFormTicks(form);
    controller.closeDialog();
    // A render on the version-2 form can be held for a press in progress, so
    // the page is made usable here, before the keyboard goes back to it.
    for (const child of root.children) child.inert = false;
    const opener = findField(focusBeforeDialog);
    if (opener) opener.focus();
    else if (fallback) root.querySelector(fallback)?.focus();
    focusBeforeDialog = null;
  }

  function fictional(replaceEverything) {
    sampleSeed += 1;
    // What is in the boxes first, so a fill sees every answer as typed.
    sweepV2Form();
    const draft = controller.getState().draftAnswers ?? {};
    // A married sample for a spouse on the return; a widowed client stays
    // widowed, and the late spouse gets no phone (sampleAnswersFor).
    const generated = sampleAnswersFor(draft, { seed: sampleSeed });
    // A regenerate is the new example plus a clear of every other answer
    // already in the draft (the wording choice kept); a fill touches blank
    // answers only.
    controller.editAnswers(fictionalAnswers(draft, generated, { replaceEverything }));
    notify("info", t(replaceEverything ? "toast.fictional_replaced" : "toast.fictional_filled", {}, screenLang()));
  }

  // The office's own "fill fictional details", the same generator the client's
  // form uses. It never submits a form, never creates a case and never sends a
  // message to anybody. Add a case is the one form that wears this button: what
  // is in the boxes first, then its blank answers, through the draft like the
  // client's own.
  function fillAssistedIntake() {
    // A demo tool: it does nothing unless the demo-tools switch is on.
    if (!demoToolsOn(controller.getState())) return;
    sampleSeed += 1;
    if (!root.querySelector("#add-case-v2-form")) {
      controller.noteLocalFailure({ code: "VALIDATION", message: "There is no assisted intake form on screen." });
      return;
    }
    sweepV2Form();
    const draft = controller.getState().draftAnswers ?? {};
    // A married sample for a spouse on the return; a widowed client stays
    // widowed, and the late spouse gets no phone (sampleAnswersFor).
    const sample = sampleAnswersFor(draft, { seed: sampleSeed });
    controller.editAnswers(fictionalAnswers(draft, sample));
    notify("info", "Fictional details filled in. Nothing is saved yet.");
  }

  async function reconcile(useMine, by) {
    const state = controller.getState();
    await controller.reconcileAnswers({
      answers: useMine ? state.draftAnswers : (state.savedCase?.answers ?? {}),
      expectedServerRevision: state.savedCase?.revision,
      // Version 2: the office's side also holds the four contact fields,
      // which the server keeps outside `answers`.
      fromServer: !useMine,
    });
    notify("info", t(useMine ? "toast.reconcile_mine" : "toast.reconcile_office", {}, screenLang()), by);
    // On Add a case the choice's panel goes once made, and its button with it:
    // the keyboard goes to Save draft, the next thing to press.
    if (controller.getState().screen === "office-add-case" && !root.contains(document.activeElement))
      root.querySelector('[data-action="save-office-draft"]')?.focus();
  }

  // ---- workflow actions -------------------------------------------------

  // One short sentence per staff action, said after it lands. The screen itself
  // already shows the new state; this is the confirmation that it was this
  // click that changed it.
  const STAFF_NOTICES = Object.freeze({
    VERIFY_INTAKE: "The screening checks are recorded.",
    REMIND: "Reminder recorded. No external message sent.",
    RESOLVE_FOLLOWUP: "The contact task is resolved. Nothing else changed.",
    RECORD_DOCUMENT_RESPONSE:
      "Recorded as staff-recorded, awaiting preparer verification.",
    CLOSE_CASE: "The case is closed.",
    REQUEST_DOCUMENTS_AT_INTAKE: "The documents are requested.",
    PUT_ON_HOLD: "The case is on hold.",
    RESUME_FROM_HOLD: "The case is back in progress.",
    MARK_READY_TO_EFILE: "Marked ready to e-file. The client was told.",
    MARK_EFILED: "Marked e-filed. The client was told.",
    RECORD_FILING_RESULT: "The filing result is recorded.",
    RETURN_TO_SIGNING: "The case is back at signing.",
    CLAIM_PREPARATION: "This case is yours to prepare.",
    CLAIM_REVIEW: "This review is yours.",
    REQUEST_DOCUMENT: "The client was asked for this document.",
    VERIFY_DOCUMENT: "The document is verified.",
    ESCALATE_CONTACT: "The office was asked to contact the client.",
    SUBMIT_REVIEW:
      "Preparation is recorded as complete. The case is waiting for a reviewer.",
    RESUBMIT_REVIEW:
      "The corrections are recorded. The case is waiting for a reviewer.",
    REQUEST_CORRECTIONS: "The preparer was asked for corrections.",
    APPROVE_REVIEW: "The review result is recorded.",
    RECORD_REVIEW_CONTACT: "The conversation is recorded.",
  });
  // The confirmation each office opener shows (the dialog names in views.mjs).
  const CASE_DIALOGS = Object.freeze({
    "open-mark-ready-to-efile": "mark-ready-to-efile",
    "open-mark-efiled": "mark-efiled",
    "open-record-filing-result": "record-filing-result",
    "open-return-to-signing": "return-to-signing",
    "open-close-case": "close-case",
    "open-request-documents": "request-documents",
    "open-put-on-hold": "put-on-hold",
    "open-resume-from-hold": "resume-from-hold",
    "open-withdraw": "withdraw",
  });
  const CLAIMS = Object.freeze(["CLAIM_PREPARATION", "CLAIM_REVIEW"]);
  // Actions whose form holds a checkbox group (contact best time, materials).
  const LIST_FORMS = Object.freeze(["UPDATE_CONTACT", "RECORD_MATERIALS"]);

  async function runCaseAction(target, form = null, by) {
    const type = target.dataset.caseAction;
    // The DOM says a canonical name or it says nothing at all.
    if (!CASE_ACTIONS.includes(type)) return;
    const state = controller.getState();
    if (type === "SAVE_ANSWERS") {
      // The controller owns the draft and the revision the edits started from,
      // so this one is never built from a form's payload.
      // Null: the case it was pressed on is no longer open, so nothing was
      // saved for it. A failure throws, and is shown by the caller.
      if (!(await controller.saveAnswers())) return;
      clearFormDrafts(form);
      notify("success", t("toast.saved", {}, screenLang()), by);
      return;
    }
    if (type === "SUBMIT" && !state.openPanels.includes("confirmed")) {
      notify("warning", t("toast.confirm_first", {}, screenLang()));
      return;
    }
    if (type === "SUBMIT" && state.savedCase) {
      // Anything still in the boxes is saved before the submit, which sends
      // the saved case's revision: otherwise it would be dropped, and the
      // refresh would raise a conflict on a submitted case.
      sweepV2Form();
      // Submit's disabled state is drawn at render, and a press can land on a
      // page drawn before the draft changed, so the controller checks the
      // draft again (guardSubmit). Refused, it has revealed every invalid
      // answer and gone to review.check: the toast says why, and the keyboard
      // goes to the alerts heading.
      if (!(await controller.guardSubmit())) {
        notify("warning", t("toast.needs_change", {}, screenLang()), by);
        focusV2Arrival();
        return;
      }
      if (controller.getState().dirty && !(await controller.saveAnswers())) return;
    }
    if (type === "RESPOND_DOCUMENT" && state.openPanels.includes("upload-failure")) {
      // The simulated failure never reaches the server, so there is nothing to
      // duplicate: the request stays open and the same button retries.
      if (!state.openPanels.includes("upload-failed"))
        controller.togglePanel("upload-failed");
      else render();
      return;
    }
    // A control on the work board names the case it belongs to. Opening it
    // first is what gives the action its case id and its expected revision.
    const boardCaseId = target.dataset.caseId;
    if (boardCaseId && state.savedCase?.id !== boardCaseId)
      await controller.selectCase(boardCaseId, { navigate: false });
    // The payload rules are a pure function of the control and its form.
    // The two forms with checkbox groups read repeated names as lists; every
    // other form keeps its reader.
    const readValues = LIST_FORMS.includes(type)
      ? formValuesWithLists
      : (formElement) => Object.fromEntries(new FormData(formElement));
    const { payload } = payloadFor(type, target.dataset, form ? readValues(form) : {});
    // The receipt is the evidence the action landed. Nothing is announced
    // without it: a refusal throws before this line, and a `null` would mean
    // nothing was sent at all.
    const receipt = await controller.runAction(type, payload);
    // Sent: whatever was typed *for this action* is no longer a draft.
    clearFormDrafts(form);
    // The best-time form puts itself away once the change has landed (the
    // controller's dispatch already re-read the case).
    if (
      type === "UPDATE_CONTACT" &&
      receipt &&
      controller.getState().openPanels.includes("edit-contact")
    ) {
      controller.togglePanel("edit-contact");
    }
    // Closing is confirmed in a dialog, so the dialog closes when it lands.
    if (type === "CLOSE_CASE" && receipt) closeDialog("#case-title, #office-queue-title");
    // From a Follow-ups row the opener has left the queue (the case moved on)
    // and there is no #case-title, so the queue's heading takes the keyboard.
    if (type === "MARK_READY_TO_EFILE" && receipt) closeDialog("#case-title, #office-queue-title");
    if (type === "MARK_EFILED" && receipt) closeDialog("#case-title, #office-queue-title");
    if (type === "RECORD_FILING_RESULT" && receipt) closeDialog("#case-title, #office-queue-title");
    if (type === "RETURN_TO_SIGNING" && receipt) closeDialog("#case-title, #office-queue-title");
    if (["REQUEST_DOCUMENTS_AT_INTAKE", "PUT_ON_HOLD", "RESUME_FROM_HOLD"].includes(type) && receipt)
      closeDialog("#case-title, #office-queue-title");
    if (type === "REQUEST_CORRECTIONS" && receipt) closeDialog("#next-step-title");
    // The client's own withdrawal: the dialog closes, the page now reads Closed.
    if (type === "WITHDRAW") {
      if (receipt) {
        closeDialog("#main");
        notify("success", t("toast.withdrawn", {}, screenLang()), by);
      }
      return;
    }
    // Resolving the task finishes the drawer's work; recording an attempt does
    // not, and the new attempt shows in it because the action re-read the case.
    if (type === "RESOLVE_FOLLOWUP" && receipt && controller.getState().dialog === "log-call")
      closeDialog("#office-queue-title");
    if (type === "SUBMIT") {
      // The office submits an assisted application from the case workspace and
      // stays there; "progress" is a client screen and staff have none.
      if (isStaffWindow(controller.getState().principal)) {
        notify("success", "The application is with the office. Record the intake checks next.", by);
        return;
      }
      controller.navigate("progress");
      notify("success", t("toast.sent", {}, screenLang()), by);
      return;
    }
    if (type === "RESPOND_DOCUMENT") {
      if (controller.getState().openPanels.includes("upload-failed"))
        controller.togglePanel("upload-failed");
      notify("success", t("toast.document_sent", {}, screenLang()), by);
      return;
    }
    // A claim opens the case that was just taken on.
    if (
      CLAIMS.includes(type) &&
      isStaffWindow(controller.getState().principal)
    )
      controller.navigate("staff-case");
    if (receipt && STAFF_NOTICES[type]) notify("success", STAFF_NOTICES[type], by);
  }

  // ---- assistance actions -----------------------------------------------

  // Assistance controls carry their own attribute and are validated against
  // their own shared vocabulary — never translated into a case action.
  const ASSISTANCE_NOTICES = Object.freeze({
    CLAIM: "This request is yours. The client's case is unchanged.",
    RESOLVE: "The request is recorded as resolved. The client's case is unchanged.",
  });

  async function runAssistanceAction(target, form = null, by) {
    const type = target.dataset.assistanceAction;
    if (!ASSISTANCE_ACTIONS.includes(type)) return;
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    // A claim carries no note at all; a resolution says what was done, and the
    // database refuses an empty one.
    const note = type === "RESOLVE" ? String(values.note ?? "").trim() : null;
    if (type === "RESOLVE" && !note) {
      notify("warning", "Say what you helped with before resolving this request.");
      return;
    }
    const sent = await controller.runAssistanceAction(
      type,
      target.dataset.itemId,
      note,
    );
    clearFormDrafts(form);
    if (sent && type === "RESOLVE" && controller.getState().dialog === "resolve-help")
      closeDialog("#office-queue-title");
    if (sent) notify("success", ASSISTANCE_NOTICES[type], by);
  }

  // ---- the contact log (OpenSpec change add-contact-log) -----------------
  //
  // Its own RPCs, not a case action: the form names its case, and its task or
  // its entry, on itself (`staff-views.mjs`, logContactForm).

  // Staff screens stay English; none of these reaches a client.
  const CONTACT_TOASTS = Object.freeze({
    logged: "The contact is logged.",
    updated: "The contact is updated.",
    copied: "Copied.",
    copyFailed: "Copy did not work. Select the line and copy it by hand.",
    otherName: "Type the name of the person you contacted.",
  });
  const copiedMany = (n) => (n === 1 ? CONTACT_TOASTS.copied : `Copied ${n} contacts.`);

  // The one outcome group the method and direction call for is shown and
  // enabled; the other is hidden and disabled, so `reportValidity` skips it
  // and `FormData` leaves it out (Phone → No answer, then Text, cannot send
  // no_answer). The Name box shows only for Other.
  function syncContactForm(form) {
    if (!form) return;
    const picked = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value ?? "";
    const group = outcomeGroup(picked("method"), picked("direction"));
    for (const set of form.querySelectorAll("[data-outcome-group]")) {
      const on = set.dataset.outcomeGroup === group;
      set.hidden = !on;
      set.disabled = !on;
    }
    const name = form.querySelector("[data-other-name]");
    if (name) name.hidden = picked("withWhom") !== "other";
  }
  function syncContactForms() {
    for (const form of root.querySelectorAll("form.contact-form")) syncContactForm(form);
  }

  // The season-end dialog: its heading counts the ticked cases, and its button
  // opens only with a case ticked and the box ticked. Drawn here too, after a
  // re-draw has put the ticks back.
  function syncCloseUnsigned() {
    const form = root.querySelector("#close-unsigned-form");
    if (!form) return;
    const boxes = [...form.querySelectorAll('input[name="caseId"]')];
    const ticked = boxes.filter((box) => box.checked).length;
    const heading = form.parentElement?.querySelector("#close-unsigned-heading");
    if (heading) heading.textContent = closeUnsignedHeading(ticked, boxes.length);
    const sure = form.querySelector("#field-close-unsigned-confirmed")?.checked === true;
    const submit = form.querySelector("#close-unsigned-submit");
    if (submit) submit.disabled = !ticked || !sure || controller.getState().busy === true;
  }

  async function submitCloseUnsigned(form, by) {
    const cases = [...form.querySelectorAll('input[name="caseId"]:checked')].map((box) => ({
      caseId: box.value,
      revision: Number(box.dataset.revision),
    }));
    if (!cases.length) return;
    await controller.closeUnsigned(cases);
    clearFormDrafts(form);
    closeDialog("#office-queue-title");
    notify("success", "The unsigned cases were closed as Dismissed.", by);
  }

  // The volunteer drawer. The controller checks the values and says what is
  // wrong in the drawer (false, nothing sent); a refusal stays in the drawer
  // too, so it closes only on a save that landed.
  async function submitVolunteer(form, by) {
    const saved = await controller.saveVolunteer(volunteerFromForm(new FormData(form)));
    if (saved) closeDialog("#main");
  }

  async function submitContact(form, by) {
    const values = Object.fromEntries(new FormData(form));
    if (values.withWhom === "other" && !String(values.otherName ?? "").trim()) {
      notify("warning", CONTACT_TOASTS.otherName, by);
      form.querySelector('[name="otherName"]')?.focus();
      return;
    }
    // `required` and reportValidity have already refused a blank time.
    const entry = contactEntryFromForm(values);
    const { caseId, followupId, contactId } = form.dataset;
    if (!contactId) {
      await controller.logContact(caseId, entry, followupId || null);
      // The form stays (it is the tab's, or the task's): back to its defaults.
      clearFormDrafts(form);
      render();
      notify("success", CONTACT_TOASTS.logged, by);
      return;
    }
    try {
      await controller.editContact(contactId, entry);
    } catch (error) {
      // The newest version is on screen now; what was typed over the old one
      // is not put back over it.
      if (error?.code === "CONFLICT") {
        clearFormDrafts(form);
        render();
      }
      throw error;
    }
    clearFormDrafts(form);
    const panel = `contact-edit:${contactId}`;
    if (controller.getState().openPanels.includes(panel)) controller.togglePanel(panel);
    document.getElementById(`contact-${contactId}`)?.focus();
    notify("success", CONTACT_TOASTS.updated, by);
  }

  // Copy and Copy all: the same lines the page shows, built from the open
  // case with its names, onto the clipboard.
  async function copyContacts(contactId, by) {
    const state = controller.getState();
    const record = decorateStaffCase(state.savedCase, state.people ?? []);
    const contacts = record?.contacts ?? [];
    const options = { answers: record?.answers ?? {} };
    const one = contactId ? contacts.find((contact) => contact?.id === contactId) : null;
    if (contactId && !one) return;
    if (!contactId && !contacts.length) return;
    try {
      await navigator.clipboard.writeText(one ? contactSummary(one, options) : contactSummaries(contacts, options));
      notify("success", one ? CONTACT_TOASTS.copied : copiedMany(contacts.length), by);
    } catch {
      notify("info", CONTACT_TOASTS.copyFailed, by);
    }
  }

  // ---- navigation actions -----------------------------------------------

  // The draft 13614-C (spec 2026-10-04 §7), built here in the browser: the
  // PDF never leaves it. The tab opens at once, inside the press, because a
  // tab opened after the build no longer counts as part of it and popup
  // blockers stop it; the PDF is loaded into it when ready. pdf-lib and the
  // form load only now, and the Chinese font only when some answer needs it
  // (the same files whatever the text says).
  // `kind` names the tab: the two drafts in the screen language, or the Exit
  // Form, a staff-only tab, in English (staff screens stay English).
  function writeTab(tab, text, kind = "13614c") {
    try {
      const page = tab.document;
      page.title =
        kind === "exit-form"
          ? "Exit Form"
          : t(kind === "14446" ? "draft14446.tab_title" : "draft.tab_title", {}, screenLang());
      page.documentElement?.setAttribute("lang", screenLang());
      if (!page.body) page.documentElement?.append(page.createElement("body"));
      page.body.textContent = text;
    } catch {
      // A tab we can no longer reach is left as it is.
    }
  }

  async function fetchBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function fetchCheckedFont(file) {
    const bytes = await fetchBytes(file.url);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hex !== file.sha256) {
      const error = new Error(t("draft.font_unchecked"));
      error.draftFont = true;
      throw error;
    }
    return bytes;
  }

  // The blocked-tab link, drawn into #draft-ready from draftOffers: after
  // every render (which replaced it; before the render's focus restore, which
  // finds it by its id) and whenever the offer changes. It is drawn only for
  // the user who made it, on the page of the case it was made for; anyone
  // else signed in, or nobody, ends it first, whatever the screen.
  function showDraftLink() {
    const state = controller.getState();
    const userId = signedInUserId();
    draftOffers.follow(userId);
    const ready = root.querySelector("#draft-ready");
    if (!ready) return;
    const offer = draftOffers.current(state.savedCase?.id ?? null, userId);
    if (!offer) {
      ready.replaceChildren();
      return;
    }
    const link = draftLink(document, offer, t("draft.link", {}, screenLang()));
    link.addEventListener("click", () => draftOffers.drop());
    ready.replaceChildren(link);
  }

  const isoToday = () => {
    const now = new Date();
    return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
  };

  // The case's saved shaded section: its one row, or null before the first save.
  const savedShaded = (record) => (record?.preparerShadedFields ?? [])[0] ?? null;

  // ---- the 13614-C shaded section: download / upload (design D8) --------
  //
  // Both stay in this browser: the copy is built here and saved as a file, and
  // the filled copy is read here. Neither is uploaded or kept. Every failure
  // is said beside the upload control (SHADED_UPLOAD), with Dismiss only.
  const shadedFailure = (message, code = "VALIDATION") =>
    controller.noteLocalFailure({ code, message, place: SHADED_UPLOAD });

  // The English editing copy: the client's answers drawn as in the draft, and
  // only the 106 shaded fields left fillable, holding the saved values. Its
  // Keywords carry the case and the section version the upload checks. The
  // download and the editor (design D7) open the same copy.
  async function editingCopy(state) {
    const record = state.savedCase;
    const reference = record.reference ?? "";
    const row = savedShaded(record);
    const version = Number(row?.version ?? 0);
    const fields = draftFields(state.draftAnswers ?? {}, { form: "en", reference, today: isoToday() });
    const PDFLib = await import("./vendor/pdf-lib.mjs");
    const [formBytes, fontFiles] = await Promise.all([
      fetchBytes(FORM_FILES.en),
      fieldsNeedFont(fields) ? draftFontFiles(draftFontsFor("en"), fields, { fetchFont: fetchCheckedFont, fontkit: PDFLib.fontkit }) : [],
    ]);
    const bytes = await buildEditingCopy({
      PDFLib, fontkit: PDFLib.fontkit, formBytes, fontFiles, fields,
      shaded: row?.fields ?? {}, reference, version,
    });
    return { bytes, reference, version };
  }

  // What readShaded needs from the case: its household size (rows past it
  // take no cell) and its season (the year rule), else the workspace's.
  const shadedRules = (record, workspace) => {
    const members = Array.isArray(record?.answers?.hh) ? record.answers.hh.length : 0;
    const season = Number.isInteger(record?.season)
      ? record.season
      : Number.isInteger(workspace?.currentSeason)
        ? workspace.currentSeason
        : undefined;
    return { form: "en", householdSize: Math.min(members, 4), season };
  };

  async function downloadShadedCopy(by) {
    const state = controller.getState();
    if (!isStaffWindow(state.principal) || !state.savedCase) return;
    try {
      const { bytes, reference } = await editingCopy(state);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `13614-C-shaded-${reference || "case"}.pdf`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (by !== signedInUserId()) return;
      shadedFailure(
        error?.draftFont ? "The draft font could not be checked. Try again later." : "The copy could not be made. Press Download to fill elsewhere again.",
        "DRAFT",
      );
    }
  }

  // A filled copy is read, then held for the preparer to check (change
  // guard-shaded-upload-against-preview, design D1): the case's reference,
  // then the shaded fields by name into readShaded (with the case's household
  // size and season), then uploadRefusal (no values). Nothing is sent until
  // Save these values (`confirm-shaded-review`), which sends
  // SAVE_PREPARER_FIELDS on the copy's own version.
  let shadedUploadToken = 0;
  async function uploadShadedCopy(input, by) {
    const file = input.files?.[0] ?? null;
    if (!file) return;
    // Only the latest upload may be reviewed or refused: a slow earlier read must not replace it.
    const token = ++shadedUploadToken;
    const state = controller.getState();
    if (!isStaffWindow(state.principal) || !state.savedCase) return;
    const record = state.savedCase;
    // A new upload replaces any read still held, even one this file's read refuses.
    if (state.shadedReview) controller.cancelShadedReview();
    let read;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const PDFLib = await import("./vendor/pdf-lib.mjs");
      read = await readFilledCopy({ PDFLib, bytes, reference: record.reference ?? "" });
    } catch (error) {
      if (by !== signedInUserId() || token !== shadedUploadToken) return;
      return shadedFailure(
        ["NOT_A_PDF", "OTHER_CASE", "NO_FIELDS"].includes(error?.code)
          ? error.message
          : "This file isn't a PDF the editor can read.",
      );
    } finally {
      // The same file can be chosen again after a fix elsewhere.
      input.value = "";
    }
    if (by !== signedInUserId() || token !== shadedUploadToken) return;
    // Another case was opened while the file was read: this copy was for the old one.
    const now = controller.getState();
    if (now.savedCase?.id !== record.id) return;
    const { values, errors } = readShaded(read.raw, shadedRules(now.savedCase, now.workspace));
    if (errors.length) return shadedFailure(errors.map((entry) => entry.message).join(" "));
    const refusal = uploadRefusal({ values, preview: read.preview });
    if (refusal) return shadedFailure(refusal);
    controller.reviewShadedCopy({ values, version: read.version, preview: read.preview });
  }

  // Save these values: the held read goes through the upload's own save.
  async function confirmShadedReview() {
    const shown = controller.getState().errorCount;
    try {
      await controller.confirmShadedReview();
    } catch (error) {
      // The controller said it beside the control; anything it did not is said there too.
      if (controller.getState().errorCount === shown) shadedFailure("Something went wrong.", error?.code ?? "SERVER_ERROR");
    } finally {
      // Save removed the focused button; the upload control was disabled while busy, so focus it now.
      const active = document.activeElement;
      if (!active || active === document.body || !root.contains(active)) root.querySelector("#shaded-upload")?.focus();
    }
  }

  // ---- the 13614-C shaded section: the editor (design D7) ---------------
  //
  // A full-screen layer beside `#app` (shaded-editor.mjs), which `render()`
  // never touches, so the preparer's edits survive every redraw. `#app` is
  // inert while it is open. pdf.js is loaded only now. (`shadedEditor` and
  // `shadedEditorCase` are declared before render(), which closes the editor
  // when its sign-in or case has gone.)

  async function loadPdfjs() {
    const pdfjs = await import("./vendor/pdfjs.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs-worker.mjs", import.meta.url).href;
    return pdfjs;
  }

  // Why this window may no longer save the open case's shaded section, or
  // null: the same rule that offers the tools (staffEligibility).
  function shadedRefusal(caseId) {
    const state = controller.getState();
    if (state.savedCase?.id !== caseId) return "This case is no longer open here. Close the editor.";
    const people = state.people ?? [];
    const person = people.find((entry) => entry.id === state.principal?.personId) ?? null;
    const decision = staffEligibility(decorateStaffCase(state.savedCase, people), person).shadedSection;
    return decision.allowed ? null : decision.reason;
  }

  function openEditor(by) {
    if (shadedEditor) return;
    const state = controller.getState();
    if (!isStaffWindow(state.principal) || !state.savedCase) return;
    const caseId = state.savedCase.id;
    if (shadedRefusal(caseId)) return;
    // Saves based on the stored version this copy shows, then + 1 per
    // accepted save (createShadedSave).
    const onSave = createShadedSave({
      version: Number(savedShaded(state.savedCase)?.version ?? 0),
      check: (raw) => {
        const now = controller.getState();
        return readShaded(raw, shadedRules(now.savedCase, now.workspace));
      },
      save: (values, basedOnVersion) => controller.saveShadedSection(values, basedOnVersion, { from: "editor" }),
      storedVersion: () => Number(savedShaded(controller.getState().savedCase)?.version ?? 0),
    });
    const bytes = editingCopy(state).then((made) => made.bytes);
    // A copy that couldn't be made fails the opening, through `ready`.
    bytes.catch(() => {});
    root.inert = true;
    const editor = openShadedEditor({
      document,
      window,
      loadPdfjs,
      bytes,
      explainRefusal: () => shadedRefusal(caseId),
      onSave,
      onClose() {
        shadedEditor = null;
        root.inert = false;
        // Back to "Fill the shaded section", or the page when it has gone.
        const opener = root.querySelector('[data-action="open-shaded-editor"]:not([disabled])');
        (opener ?? root.querySelector("#main"))?.focus();
      },
    });
    shadedEditor = editor;
    shadedEditorCase = caseId;
    editor.ready.catch(() => {
      if (by !== signedInUserId()) return;
      controller.noteLocalFailure({ code: "EDITOR", message: OPEN_FAILED, place: SHADED_EDITOR }, () =>
        openEditor(signedInUserId()),
      );
    });
  }

  async function viewDraft(form, by, kind = "13614c") {
    // A client's 13614-C is half finished (hide-draft-13614c-from-clients): only staff make one.
    if (kind !== "14446" && !isStaffWindow(controller.getState().principal)) return;
    const files = kind === "14446" ? FORM_14446_FILES : FORM_FILES;
    if (!Object.hasOwn(files, form)) return;
    const tab = window.open("", "_blank");
    if (tab) writeTab(tab, t("draft.preparing", {}, screenLang()), kind);
    // An earlier press's link goes: this press makes a new draft.
    draftOffers.drop();
    showDraftLink();
    try {
      const state = controller.getState();
      const caseId = state.savedCase?.id ?? null;
      const userId = signedInUserId();
      const reference = state.savedCase?.reference ?? "";
      const now = new Date();
      const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((n) => String(n).padStart(2, "0"))
        .join("-");
      // The 繁體 draft's lines need the map, whatever the screen language;
      // loading it changes nothing on screen. A failure, or a load still
      // hanging after HANT_START_TIMEOUT_MS, is draft.failed.
      // The 14446 has no generated lines of its own, so it never needs the map.
      if (kind !== "14446" && form === "zh-t") await loadHantWithin({ hantReady, loadHant }, HANT_START_TIMEOUT_MS);
      const fields = (kind === "14446" ? draft14446Fields : draftFields)(state.draftAnswers ?? {}, {
        // The 13614-C prints the saved shaded section in every form (design
        // D9); the 14446 has no shaded section and ignores it.
        form, reference, today, shaded: savedShaded(state.savedCase)?.fields ?? null,
      });
      const PDFLib = await import("./vendor/pdf-lib.mjs");
      const [formBytes, fontFiles] = await Promise.all([
        fetchBytes(files[form]),
        fieldsNeedFont(fields) ? draftFontFiles(draftFontsFor(form), fields, { fetchFont: fetchCheckedFont, fontkit: PDFLib.fontkit }) : [],
      ]);
      const bytes = await buildDraftPdf({
        PDFLib, fontkit: PDFLib.fontkit, formBytes, fontFiles, fields,
        stamp: fields.stamp, fileName: fields.fileName,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      // Revoked a minute on; a link offered below goes with it.
      draftOffers.keep(url);
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        // The browser blocked even the early tab: offer a link instead, drawn
        // into the page as it is now and again after every redraw.
        draftOffers.offer({ url, fileName: fields.fileName, caseId, userId });
        showDraftLink();
      }
      // A draft that was built and offered: an earlier draft problem is over.
      controller.clearError("DRAFT");
    } catch (error) {
      if (tab && !tab.closed) writeTab(tab, t("draft.failed", {}, screenLang()), kind);
      if (by !== signedInUserId()) return;
      // A draft that couldn't be built is an error: the banner, with Try again.
      controller.noteLocalFailure(
        {
          code: "DRAFT",
          message: error?.draftFont ? "The draft font could not be checked. Try again later." : "The draft could not be made. Try again.",
        },
        () => viewDraft(form, by, kind),
      );
    }
  }

  // ---- the Exit Form (src/exit-form.mjs) --------------------------------
  //
  // Staff only: built in this browser from the approval's questionnaire and
  // the case, opened in a new tab like the drafts (or offered as a link when
  // the browser blocks the tab). Nothing is uploaded or kept.
  async function viewExitForm(reviewId, by) {
    const state = controller.getState();
    if (!isStaffWindow(state.principal)) return;
    const record = state.savedCase;
    const questionnaire = (record?.reviewerQuestionnaires ?? []).find((q) => q?.reviewId === reviewId);
    if (!record || !questionnaire) return;
    const tab = window.open("", "_blank");
    if (tab) {
      writeTab(tab, "Preparing the Exit Form…", "exit-form");
    }
    draftOffers.drop();
    showDraftLink();
    try {
      const answers = state.draftAnswers ?? record.answers ?? {};
      const visible = visibleAnswers(2, answers);
      const season = Number.isInteger(record.season)
        ? record.season
        : Number.isInteger(state.workspace?.currentSeason)
          ? state.workspace.currentSeason
          : 2025;
      const marks = exitFormMarks(
        questionnaire,
        {
          taxYear: season,
          clientNumber: record.clientNumber ?? "",
          firstName: answers.tp_first_name,
          lastName: answers.tp_last_name,
          // A couple (married, or widowed in the tax year): "Taxpayer & Spouse".
          ...(spouseShown(visible) ? { spouseFirstName: visible.sp_first_name, spouseLastName: visible.sp_last_name } : {}),
        },
        isoToday(),
      );
      const PDFLib = await import("./vendor/pdf-lib.mjs");
      const [formBytes, fontFiles] = await Promise.all([
        fetchBytes(EXIT_FORM_FILE),
        exitFormNeedsFont(marks)
          ? draftFontFiles(draftFontsFor("zh-t"), exitFormFontFields(marks), { fetchFont: fetchCheckedFont, fontkit: PDFLib.fontkit })
          : [],
      ]);
      const bytes = await buildExitFormPdf({ PDFLib, fontkit: PDFLib.fontkit, formBytes, fontFiles, marks });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      draftOffers.keep(url);
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        draftOffers.offer({ url, fileName: marks.fileName, caseId: record.id, userId: signedInUserId() });
        showDraftLink();
      }
      controller.clearError("DRAFT");
    } catch {
      if (tab && !tab.closed) writeTab(tab, "The Exit Form could not be made. Close this tab and try again.", "exit-form");
      if (by !== signedInUserId()) return;
      controller.noteLocalFailure(
        { code: "DRAFT", message: "The Exit Form could not be made. Try again." },
        () => viewExitForm(reviewId, by),
      );
    }
  }

  // ---- leaving Add a case ----------------------------------------------
  //
  // What each exit from Add a case does once it may go. The confirm in the
  // leave dialog runs these directly, past the guard.
  const EXITS = Object.freeze({
    "open-board": () => {
      formDrafts.clear();
      controller.navigate("staff");
    },
    "open-cases": () => {
      formDrafts.clear();
      controller.navigate("office-cases");
    },
    // navigate() reads nothing; the Roster's list is read on arrival.
    "open-volunteers": () => {
      formDrafts.clear();
      controller.navigate("office-volunteers");
      void controller.loadVolunteers();
    },
    // Pressed again while on the page: a fresh draft, which is what it asks for.
    "open-add-case": async () => {
      formDrafts.clear();
      await controller.openAddCase();
    },
  });

  // On Add a case, an exit that would lose typed answers asks first: a new
  // office draft with any answer, or a saved draft with unsaved edits. True
  // when it asked (the exit then waits for the dialog). Sign out leaves
  // without asking.
  function leaveAddCaseFirst(action, target) {
    if (controller.getState().screen !== "office-add-case") return false;
    sweepV2Form();
    const state = controller.getState();
    const loses = state.officeDraft
      ? Object.values(state.draftAnswers ?? {}).some(isAnswered)
      : Boolean(state.savedCase) && Boolean(state.dirty);
    if (!loses) return false;
    openDialog("leave-add-case", { to: action }, describeFocus(target));
    return true;
  }

  async function runNavigation(action, target, by) {
    const state = controller.getState();
    switch (action) {
      case "open-applications":
        controller.navigate("applications");
        break;
      case "open-progress":
        controller.navigate("progress");
        break;
      case "open-case":
        // Another case is another set of forms; nothing half-typed follows it.
        formDrafts.clear();
        // From inside a drawer: the drawer must not stay open over the case.
        if (state.dialog) {
          focusBeforeDialog = null;
          controller.closeDialog();
        }
        await controller.selectCase(target.dataset.caseId);
        break;
      case "open-board":
        if (leaveAddCaseFirst("open-board", target)) break;
        EXITS["open-board"]();
        break;
      case "open-cases":
        if (leaveAddCaseFirst("open-cases", target)) break;
        EXITS["open-cases"]();
        break;
      case "open-volunteers":
        if (leaveAddCaseFirst("open-volunteers", target)) break;
        EXITS["open-volunteers"]();
        break;
      case "open-add-volunteer":
      case "open-edit-volunteer": {
        // A fresh drawer: no earlier refusal, no earlier sentence about a
        // field, and nothing typed for another volunteer.
        const id = target.dataset.volunteerId || null;
        controller.dismissError();
        controller.clearVolunteerFormError();
        forgetVolunteerDrafts();
        openDialog("volunteer", id ? { volunteerId: id } : null, describeFocus(target));
        break;
      }
      case "account-create":
      case "account-resend":
      case "account-reactivate":
        // Said in the drawer (a refusal) or thrown to the safety net.
        await controller[
          { "account-create": "createAccount", "account-resend": "resendAccount", "account-reactivate": "reactivateAccount" }[action]
        ]();
        break;
      case "client-resend":
        // The office screen's Invite a client list: said in the panel, or
        // thrown to the safety net.
        await controller.resendClient(target.dataset.email ?? "");
        break;
      case "account-deactivate":
        // Asks first: nothing is sent until the dialog's confirm.
        openDialog("deactivate-account", { volunteerId: target.dataset.volunteerId }, describeFocus(target));
        break;
      case "confirm-deactivate-account":
        await controller.deactivateAccount();
        break;
      // The Workload (change add-volunteer-workload). The controller decides
      // who may see it and open its drawer; these only pass the press on and
      // keep the keyboard on the control that was pressed.
      case "volunteer-tab":
        await controller.setVolunteerTab(target.dataset.tab);
        root.querySelector(`[data-action="volunteer-tab"][data-tab="${CSS.escape(target.dataset.tab ?? "")}"]`)?.focus();
        break;
      case "sort-workload":
        controller.setWorkloadView({ sortBy: target.dataset.key });
        break;
      case "toggle-workload-row":
        controller.setWorkloadView({ toggleRow: target.dataset.rowId });
        break;
      case "open-assign":
        // Back to this Assign or Reassign when the drawer closes.
        focusBeforeDialog = describeFocus(target);
        controller.openAssign(target.dataset.caseId, target.dataset.slot);
        if (controller.getState().dialog !== "assign") focusBeforeDialog = null;
        break;
      case "assign-case": {
        // A refusal stays in the drawer (the controller records it); the
        // drawer closes only on an assignment that landed.
        const done = await controller.assignCase(target.dataset.personId);
        if (!done) break;
        closeDialog("#main");
        notify("success", done.notice, by);
        break;
      }
      case "demo-fill":
        // Fills the form with fictional answers; nothing is sent until the
        // form's own submit button is pressed (demo-fill.mjs). A demo tool:
        // it does nothing unless the demo-tools switch is on.
        if (!demoToolsOn(controller.getState())) break;
        fillForm(target);
        break;
      case "clear-exit-group": {
        // An Exit Form group is emptied in place: every field unticked or
        // blank, and no draft left to put them back (design D7).
        const group = target.closest("details.q-exit-group");
        if (!group) break;
        const fields = [...group.querySelectorAll("input")];
        for (const field of fields) {
          if (isCheckable(field)) field.checked = false;
          else field.value = "";
        }
        forgetDrafts(
          formDrafts,
          fields.map((field) => field.id).filter(Boolean),
        );
        break;
      }
      case "clear-pool-filters":
        controller.clearBoardFilters(POOL_FILTER_KEYS);
        // "Clear filters" goes once nothing is narrowed; the keyboard goes to
        // the first filter rather than falling out to the page.
        if (!root.querySelector('[data-action="clear-pool-filters"]'))
          root.querySelector("#field-poolStage")?.focus();
        break;
      case "open-add-case":
        if (leaveAddCaseFirst("open-add-case", target)) break;
        await EXITS["open-add-case"]();
        break;
      case "confirm-leave-add-case": {
        const exit = EXITS[state.dialogContext?.to] ?? EXITS["open-board"];
        closeDialog();
        await exit();
        break;
      }
      case "continue-add-case":
        formDrafts.clear();
        await controller.openAddCase({ caseId: target.dataset.caseId });
        break;
      case "toggle-add-substep": {
        const id = target.dataset.substep ?? "";
        sweepV2Form();
        controller.toggleAddSubstep(id);
        document.getElementById(`add-sub-${dashed(id)}-toggle`)?.focus();
        break;
      }
      case "save-office-draft": {
        sweepV2Form();
        const { reason } = await controller.saveOfficeDraft();
        // Said only when the save really landed: no reason, a case, and the
        // draft now matches the server ("saved", or "idle" when there was
        // nothing to send). "busy" and "left" saved nothing by this press,
        // and a failure has already thrown with its error on screen.
        const after = controller.getState();
        const landed =
          !reason && Boolean(after.savedCase) && !after.dirty && ["saved", "idle"].includes(after.saveState);
        if (landed) notify("info", "The draft is saved. Nobody was emailed.", by);
        // The button was off while the save ran, which dropped the keyboard;
        // it goes back to it, unless the office has moved on to a field.
        if (!root.contains(document.activeElement))
          root.querySelector('[data-action="save-office-draft"]')?.focus();
        break;
      }
      case "send-office-draft": {
        sweepV2Form();
        const { sent, reason } = await controller.saveOfficeDraft({ send: true });
        if (sent) notify("success", "The application is with the office.", by);
        else if (reason === "answers") {
          notify("warning", "The draft is saved. Some answers still need attention before it can be sent.", by);
          root.querySelector("#add-case-count")?.focus();
        } else if (reason === "unconfirmed") {
          notify("warning", "Confirm that you have checked these answers with the client first.", by);
          root.querySelector("#field-confirmed")?.focus();
        }
        break;
      }
      case "fill-assisted-intake":
        fillAssistedIntake();
        break;
      case "toggle-intake-check":
        controller.togglePanel(`intake-check-${target.dataset.check}`);
        // The page is rebuilt around the checkbox, so give it back the focus.
        root.querySelector(`#field-intake-${target.dataset.check}`)?.focus();
        break;
      case "open-mark-ready-to-efile":
      case "open-close-case":
      case "open-mark-efiled":
      case "open-record-filing-result":
      case "open-return-to-signing":
      case "open-request-documents":
      case "open-put-on-hold":
      case "open-resume-from-hold":
      case "open-withdraw": {
        // From the case page the button carries no case id and the dialog
        // opens at once. From a Follow-ups row it does: that case is read in
        // place (no navigation, so screening never starts from the queue)
        // and the dialog opens only if it is the one now loaded.
        const opener = describeFocus(target);
        const caseId = target.dataset.caseId;
        const name = CASE_DIALOGS[target.dataset.action];
        if (caseId) {
          controller.dismissError();
          await controller.selectCase(caseId, { navigate: false });
          if (controller.getState().savedCase?.id !== caseId) break;
        }
        openDialog(name, null, opener);
        break;
      }
      case "open-close-unsigned":
        // The list is already loaded (it is the Follow-ups page's own), so
        // the dialog opens at once; a CONFLICT re-reads it in place.
        controller.dismissError();
        openDialog("close-unsigned", null, describeFocus(target));
        break;
      case "open-log-call": {
        // Described before the await: by the time the case has loaded, the
        // page has been rebuilt and the keyboard may be anywhere.
        const opener = describeFocus(target);
        const caseId = target.dataset.caseId;
        controller.dismissError();
        // A queue row carries no follow-up tasks, so the case is read in place.
        await controller.selectCase(caseId, { navigate: false });
        if (controller.getState().savedCase?.id === caseId)
          openDialog("log-call", { caseId }, opener);
        break;
      }
      case "open-resolve-help":
        controller.dismissError();
        openDialog("resolve-help", { itemId: target.dataset.itemId }, describeFocus(target));
        break;
      case "open-request-corrections":
        // Clear any earlier refusal so the dialog only ever shows the error
        // from its own send, not a stale one left over from a previous try.
        controller.dismissError();
        openDialog("request-corrections");
        break;
      case "set-board-filter":
        controller.setBoardFilter(target.dataset.filter, target.dataset.value);
        // "Clear search" is the one filter chip that stands in for a field —
        // give the box the keyboard back, the way a search submit does.
        if (target.dataset.filter === "search")
          root.querySelector("#field-board-search")?.focus();
        // An empty state's "Show every task" or "Show all languages" goes with
        // the empty state. If the keyboard fell out with it, it lands on the
        // chip that now shows that choice ("All", "Any language").
        else if (!root.contains(document.activeElement))
          root
            .querySelector(
              `.filter-group [data-action="set-board-filter"][data-filter="${CSS.escape(
                target.dataset.filter ?? "",
              )}"][data-value="${CSS.escape(target.dataset.value ?? "")}"]`,
            )
            ?.focus();
        break;
      case "clear-board-filters":
        controller.clearBoardFilters();
        break;
      case "toggle-sidebar":
        {
          // Pinning needs no peek call: the render's applyPeek → setPinned(true)
          // ends a peek. Collapsing marks the pointer as not to re-peek.
          const wasOpen = controller.getState().sidebarOpen;
          controller.toggleSidebar();
          if (wasOpen) peek.collapsed();
        }
        break;
      case "toggle-edit-contact":
        // Cancel: the best time opens again as saved, its Note included.
        clearFormDrafts(root.querySelector("#contact-form"));
        controller.togglePanel("edit-contact");
        root
          .querySelector('[data-action="toggle-edit-contact"]')
          ?.focus();
        break;
      case "set-case-tab":
        controller.setCaseTab(target.dataset.value);
        root.querySelector(`#case-tab-${CSS.escape(target.dataset.value ?? "")}`)?.focus();
        break;
      case "start-application": {
        // `createCase` answers null when one is already in flight; nothing was
        // created, so nothing is announced (acceptance 11: no false success).
        // Nor to anyone but the person who pressed (`notify`'s `by`): not on
        // the sign-in screen after a sign-out, not to the next user.
        const started = await controller.createCase();
        if (started) notify("success", t("toast.started", {}, screenLang()), by);
        break;
      }
      case "continue-intake":
        controller.navigate("intake");
        break;
      case "back-step":
        // Back saves, as every sub-step change does.
        await moveV2(() => controller.moveSubstep(-1));
        break;
      // A rail link, an alert, a card's why line, "Upload now" (which names
      // the card to land on in `data-focus`).
      case "go-substep":
        await moveV2(
          () => controller.goToSubstep(target.dataset.substep),
          target.dataset.focus ?? null,
        );
        break;
      // The summary's Change: the sub-step opens with "Back to summary".
      case "change-substep":
        await moveV2(() => controller.openForChange(target.dataset.substep));
        break;
      case "back-to-summary":
        await moveV2(() => controller.backToSummary());
        break;
      case "toggle-rail-step": {
        const stepId = target.dataset.stepId ?? "";
        controller.setRailExpanded(stepId, target.getAttribute("aria-expanded") !== "true");
        // The tree was redrawn: the keyboard stays on this step's toggle.
        root
          .querySelector(`.rail-toggle[data-step-id="${CSS.escape(stepId)}"]`)
          ?.focus();
        break;
      }
      case "toggle-panel": {
        const name = target.dataset.panel ?? "";
        if (!V2_PANELS.test(name)) break;
        controller.togglePanel(name);
        root
          .querySelector(`[data-action="toggle-panel"][data-panel="${CSS.escape(name)}"]`)
          ?.focus();
        break;
      }
      case "summary-expand-all":
      case "summary-collapse-all": {
        // Every section at once (design D7): Collapse all names the sections
        // on the page, Expand all none. The pressed button keeps the keyboard.
        const shut =
          action === "summary-collapse-all"
            ? [...root.querySelectorAll('.summary-toggle[data-panel^="summary-shut:"]')].map((toggle) =>
                toggle.dataset.panel.slice("summary-shut:".length),
              )
            : [];
        controller.setSummaryShut(shut);
        document.getElementById(target.id)?.focus();
        break;
      }
      case "mark-card": {
        const slot = target.dataset.slot ?? "";
        sweepV2Form();
        await controller.setDocumentCard(slot, target.dataset.status);
        // The card's status line, never a button: the upload buttons are
        // disabled and the mark buttons change with the status. On the
        // progress page a card marked "Don't have" leaves the list.
        (
          document.getElementById(`doc-${dashed(slot)}-status`) ??
          document.getElementById(`doc-${dashed(slot)}`) ??
          root.querySelector("#main")
        )?.focus();
        break;
      }
      case "move-card": {
        const slot = target.dataset.slot ?? "";
        await controller.setDocumentGroup(target.dataset.slot, target.dataset.group);
        // The same ids `mark-card` focuses: the status line, then the row.
        (
          document.getElementById(`doc-${dashed(slot)}-status`) ??
          document.getElementById(`doc-${dashed(slot)}`) ??
          root.querySelector("#main")
        )?.focus();
        break;
      }
      case "print-summary":
        // Only `.summary-print` prints while the body carries the class
        // (styles.css, part 4b2); "afterprint" takes it off again.
        document.body.classList.add("print-summary");
        window.print();
        break;
      case "view-exit-form":
        await viewExitForm(target.dataset.review ?? "", by);
        break;
      case "view-draft":
        await viewDraft(target.dataset.form ?? "en", by, target.dataset.draft ?? "13614c");
        break;
      case "download-shaded-copy":
        await downloadShadedCopy(by);
        break;
      case "confirm-shaded-review":
        await confirmShadedReview();
        break;
      case "cancel-shaded-review":
        controller.cancelShadedReview();
        // Back to the upload control, to choose another file.
        root.querySelector("#shaded-upload")?.focus();
        break;
      case "open-shaded-editor":
        // A failure to open said earlier goes with the new try.
        if (controller.getState().error?.place === SHADED_EDITOR) controller.clearError("EDITOR");
        openEditor(by);
        break;
      case "toggle-senior":
        controller.editAnswers({
          form_version: state.draftAnswers?.form_version === "senior" ? "general" : "senior",
        });
        break;
      case "add-member": {
        // A new array, never the draft's own: a card with no answers yet but
        // its own id, which its document cards are keyed by.
        const members = Array.isArray(state.draftAnswers?.hh) ? state.draftAnswers.hh : [];
        if (members.length < 10)
          controller.editAnswers({ hh: [...members, { member_id: newMemberId() }] });
        break;
      }
      case "remove-member":
        // The controller renumbers the revealed ids of the members after it.
        controller.removeMember(Number(target.dataset.member));
        break;
      case "save-exit": {
        sweepV2Form();
        // Not saved: no "Saved", and the page stays.
        if (controller.getState().dirty && !(await controller.saveAnswers())) break;
        controller.navigate("applications");
        notify("success", t("toast.saved", {}, screenLang()), by);
        break;
      }
      case "fill-fictional":
        if (!demoToolsOn(controller.getState())) break;
        fictional(false);
        break;
      case "regenerate-fictional":
        if (!demoToolsOn(controller.getState())) break;
        openDialog("regenerate");
        break;
      case "confirm-regenerate":
        if (demoToolsOn(controller.getState())) fictional(true);
        closeDialog();
        break;
      case "reconcile-mine":
        await reconcile(true, by);
        break;
      case "reconcile-server":
        await reconcile(false, by);
        break;
      case "toggle-upload-failure": {
        controller.togglePanel("upload-failure");
        // The page is rebuilt around the checkbox, so give it back the focus —
        // the box that was clicked, which is the one scoped to its own request.
        const box = fieldId("simulate-upload-failure", target.dataset.requestId ?? "");
        root.querySelector(`#${CSS.escape(box)}`)?.focus();
        break;
      }
      case "toggle-contact-edit": {
        const id = target.dataset.contactId ?? "";
        const panel = `contact-edit:${id}`;
        const formOf = () => root.querySelector(`form.contact-form[data-contact-id="${CSS.escape(id)}"]`);
        const opening = !controller.getState().openPanels.includes(panel);
        // Cancel: nothing typed into it is kept for next time.
        if (!opening) clearFormDrafts(formOf());
        controller.togglePanel(panel);
        if (opening) {
          const form = formOf();
          (form?.querySelector("input:checked") ?? form?.querySelector("input"))?.focus();
        }
        else root.querySelector(`[data-action="toggle-contact-edit"][data-contact-id="${CSS.escape(id)}"]`)?.focus();
        break;
      }
      case "copy-contact":
        await copyContacts(target.dataset.contactId ?? "", by);
        break;
      case "copy-all-contacts":
        await copyContacts(null, by);
        break;
      case "clear-lookup":
        controller.setLookup("");
        render();
        break;
      case "copy-reference":
        try {
          await navigator.clipboard.writeText(state.savedCase?.reference ?? "");
          notify("success", t("toast.id_copied", {}, screenLang()), by);
        } catch {
          openDialog("print");
          notify("info", t("toast.id_select", {}, screenLang()), by);
        }
        break;
      case "print-reference":
        openDialog("print");
        break;
      case "print-now":
        window.print();
        break;
      case "resend-code":
        await controller.sendCode(state.authEmail);
        break;
      case "back-to-email":
        controller.restartSignIn();
        break;
      case "sign-out":
        await controller.signOut();
        break;
      case "retry-action": {
        // Nothing to retry, or an envelope that no longer matches the draft:
        // the controller answers null and says so on screen. "Sent again."
        // would be a claim that something left this window.
        const sent = await controller.retryLast();
        if (sent && !sent.local) notify("success", t("toast.sent_again", {}, screenLang()), by);
        break;
      }
      case "retry-connection":
        await controller.refresh();
        break;
      // Finish your setup's Check again. The window's focus re-checks too,
      // through the controller's own focus listener (refresh).
      case "check-clearance":
        await controller.checkClearance();
        break;
      case "dismiss-error":
        controller.dismissError();
        break;
      case "open-help":
        openDialog("help");
        break;
      case "close-dialog":
        closeDialog();
        break;
      // The language switch (spec 2026-10-05 §2). What is in the boxes first,
      // since the redraw rebuilds them; 繁體's map on first use. The redraw
      // puts the keyboard back on the pressed button (its data-value).
      case "set-language": {
        const lang = target.dataset.value;
        if (!isLang(lang)) break;
        sweepV2Form();
        // A press made while 繁體 is still loading wins over it.
        const outcome = await languageRequests.want(lang, (wanted) => controller.setLanguage(wanted));
        if (outcome === "failed") notify("warning", t("toast.hant_failed", {}, screenLang()), by);
        break;
      }
      default:
        break;
    }
  }

  root.addEventListener("click", async (event) => {
    // Who pressed, before anything is awaited (see `notify`).
    const by = signedInUserId();
    const shown = controller.getState().errorCount;
    const caseTarget = event.target.closest("[data-case-action]");
    const assistTarget = event.target.closest("[data-assistance-action]");
    // A submit button inside a form is handled by the submit event, where the
    // form's own values are; acting on the click too would send it twice.
    if (caseTarget?.type === "submit" || assistTarget?.type === "submit") return;
    const target =
      caseTarget ?? assistTarget ?? event.target.closest("[data-action]");
    if (!target) return;
    pressed = null;
    if (busyControl(target)) pressed = describeFocus(target);
    try {
      if (caseTarget) await runCaseAction(caseTarget, null, by);
      else if (assistTarget) await runAssistanceAction(assistTarget, null, by);
      else await runNavigation(target.dataset.action, target, by);
    } catch (error) {
      // The safety net: never a toast (design D1).
      safetyNet(error, by, shown);
    }
  });

  // A search box that filters as it is typed: `update` redraws, which
  // replaces the box, so the keyboard and the caret go back into the new one.
  function keepTyping(field, selector, update) {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    update();
    const box = root.querySelector(selector);
    if (box && box !== field) {
      box.focus();
      if (typeof start === "number" && typeof end === "number") box.setSelectionRange(start, end);
    }
  }

  root.addEventListener("input", (event) => {
    const field = event.target;
    if (field.matches?.(V2_CONTROLS)) {
      // The version-2 form (spec §2.4 rule 2): the draft, quietly, then the
      // note, the rail mark and a longtext's count in place, never a redraw.
      // The event's own target, so a ticked "No one" clears the others.
      quiet = true;
      try {
        controller.editAnswers(readField(field));
      } finally {
        quiet = false;
      }
      refreshSaveChip();
      const ref = v2Ref(field);
      // Typing never adds an error, but clears one once the value is valid
      // or empty (the controller drops the id at the same moment).
      paintV2Note(ref, (note) => note.classList.contains("is-invalid"));
      if (ref.scope === "office") paintAddCase();
      else paintV2Rail();
      paintV2Count(ref);
    } else if (field.closest(".staff-form") && field.id) {
      // Held in the wiring layer, not in the controller: this text is not part
      // of any record until the action that carries it is sent.
      if (!isCheckable(field)) keepDraft(field.id, textDraft(field));
      // A tick likewise — except a box drawn from state (a toggle with its own
      // action, the "I have checked" box), which a redraw already draws as it
      // is.
      else if (!field.matches("[data-action], #field-confirmed"))
        for (const [id, draft] of checkDrafts(field)) keepDraft(id, draft);
    } else if (field.name === "volunteerSearch") {
      // The Roster filters as it is typed; the redraw replaces the box, so
      // the keyboard and the caret go back into it. Mid-composition the
      // redraw is held and the box is the same one: touching its selection
      // then would end the composition.
      keepTyping(field, "#volunteer-search", () => controller.setVolunteerFilter("search", field.value));
    } else if (field.name === "workloadSearch") {
      // The Workload and its drawer filter the same way.
      keepTyping(field, "#workload-search", () => controller.setWorkloadView({ search: field.value }));
    } else if (field.name === "assignSearch") {
      keepTyping(field, "#assign-search", () => controller.setAssignSearch(field.value));
    } else if (field.name === "lookup") controller.setLookup(field.value);
    else if (field.name === "boardSearch") controller.setBoardSearchDraft(field.value);
    // Kept in state so a re-render re-renders them rather than blanking them.
    // None of these three re-render: the field already shows what was typed.
    else if (field.name === "code") controller.editAuthCode(field.value);
    else if (field.name === "email") controller.editAuthEmail(field.value);
  });

  root.addEventListener("change", (event) => {
    const field = event.target;
    if (field.matches?.('input[type="file"][data-action="upload-shaded-copy"]')) {
      void uploadShadedCopy(field, signedInUserId());
      return;
    }
    if (field.matches?.("select[data-board-filter]")) {
      controller.setBoardFilter(field.dataset.boardFilter, field.value);
      root.querySelector(`#${field.id}`)?.focus();
      return;
    }
    if (field.matches?.("select[data-volunteer-filter]")) {
      controller.setVolunteerFilter(field.dataset.volunteerFilter, field.value);
      root.querySelector(`#${field.id}`)?.focus();
      return;
    }
    if (field.closest?.("#volunteer-form") && field.name === "certificate") {
      syncVolunteerRoles(field.form, field.value);
      return;
    }
    if (field.closest?.("#volunteer-form") && field.name === "language" && field.value === "other") {
      syncVolunteerOther();
      return;
    }
    if (field.id === "field-confirmed") {
      controller.togglePanel("confirmed");
      root.querySelector("#field-confirmed")?.focus();
      return;
    }
    if (field.closest?.("#close-unsigned-form")) {
      syncCloseUnsigned();
      return;
    }
    if (field.closest?.("form.contact-form") && ["direction", "method", "withWhom"].includes(field.name)) {
      syncContactForm(field.form);
      return;
    }
    if (field.matches?.(V2_CONTROLS)) changeV2Field(field);
  });

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    // Who pressed, before anything is awaited (see `notify`).
    const by = signedInUserId();
    const shown = controller.getState().errorCount;
    const form = event.target;
    pressed = null;
    if (event.submitter && busyControl(event.submitter)) pressed = describeFocus(event.submitter);
    // Add a case has no submit: its bar's controls are buttons. Enter in a
    // lone text box would otherwise reach `reportValidity`.
    if (form.id === "add-case-v2-form") return;
    if (form.id === "intake-v2-form") {
      // Continue. Before `reportValidity`, which ignores `novalidate`: the
      // form warns but always moves on, and a half-typed `type="email"` would
      // otherwise block it.
      try {
        // Enter in a lone text box submits even with no Continue on the page;
        // after a Change, that is the way back to the summary.
        if (controller.getState().returnToSummary)
          await moveV2(() => controller.backToSummary());
        else await moveV2(() => controller.moveSubstep(1));
      } catch (error) {
        // The safety net: never a toast (design D1).
        safetyNet(error, by, shown);
      }
      return;
    }
    // The volunteer drawer skips `reportValidity`, which ignores `novalidate`:
    // a half-typed `type="email"` would get the browser's bubble instead of
    // the drawer's own sentence (volunteerProblem).
    if (form.id !== "volunteer-form" && !form.reportValidity()) return;
    const values = new FormData(form);
    try {
      // A staff form carries its action on its own submit button and names its
      // fields after the payload keys; everything else is a known form id. The
      // selector is deliberately narrow: the intake form also holds a workflow
      // button, but that one is `type="button"` and belongs to the click path.
      const caseControl = form.querySelector(
        'button[type="submit"][data-case-action]',
      );
      const assistControl = form.querySelector(
        'button[type="submit"][data-assistance-action]',
      );
      if (form.matches(".contact-form")) {
        await submitContact(form, by);
      } else if (form.id === "volunteer-form") {
        await submitVolunteer(form, by);
      } else if (caseControl) {
        await runCaseAction(caseControl, form, by);
      } else if (assistControl) {
        await runAssistanceAction(assistControl, form, by);
      } else if (form.id === "invite-client-form") {
        await controller.inviteClient(String(values.get("email") ?? ""));
      } else if (form.id === "close-unsigned-form") {
        await submitCloseUnsigned(form, by);
      } else if (form.id === "email-form") {
        await controller.sendCode(String(values.get("email") ?? ""));
      } else if (form.id === "code-form") {
        await controller.verifyCode(String(values.get("code") ?? ""));
      } else if (form.id === "board-search-form") {
        controller.setBoardFilter("search", String(values.get("boardSearch") ?? "").trim());
        root.querySelector("#field-board-search")?.focus();
      } else if (form.id === "lookup-form") {
        controller.setLookup(String(values.get("lookup") ?? ""));
        render();
      }
    } catch (error) {
      // The safety net: never a toast (design D1).
      safetyNet(error, by, shown);
    }
  });

  // The summary's print mode lasts for one print only.
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-summary");
  });

  // The case page's tabs follow the ARIA tab pattern: arrows, Home and End move
  // to a tab and show it, and the keyboard stays on the tab.
  root.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.('[role="tab"][data-action="set-case-tab"]');
    if (!tab) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const next = nextTabIndex(event.key, tabs.indexOf(tab), tabs.length);
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    controller.setCaseTab(target.dataset.value);
    root.querySelector(`#${CSS.escape(target.id)}`)?.focus();
  });

  // Dialogs keep the keyboard inside them, and Escape always closes.
  document.addEventListener("keydown", (event) => {
    // The shaded-section editor keeps its own keyboard (shaded-editor.mjs).
    if (shadedEditor) return;
    if (event.key === "Escape" && !controller.getState().dialog) {
      if (event.isComposing) return; // never block an IME's own cancel
      // applyPeek moves the keyboard to the toggle if it was in the sidebar.
      if (peek.escape()) event.preventDefault();
      return;
    }
    if (!controller.getState().dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...document.querySelectorAll(
        '.modal button:not([disabled]),.modal input:not([type="hidden"]),.modal select,.modal textarea,.modal a[href]',
      ),
    ];
    if (!focusable.length) return;
    const target = trapTarget(focusable, document.activeElement, event.shiftKey);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });

  // Another tab chose a language: this one follows, without writing it back.
  // It is the newest wish, so it also wins over a 繁體 load still in flight.
  window.addEventListener("storage", async (event) => {
    if (event.key !== STORAGE_KEY) return;
    const storage = readLocalStorage();
    if (!storage || event.storageArea !== storage) return;
    const lang = event.newValue;
    if (!isLang(lang)) return;
    sweepV2Form();
    const outcome = await languageRequests.want(lang, (wanted) => {
      if (wanted !== controller.getState().lang)
        controller.adoptLanguage(wanted, { draw: controllerStarted });
    });
    if (outcome === "failed") notify("warning", t("toast.hant_failed", {}, screenLang()));
  });

  // A saved 繁體 needs its map before the first render. If another tab chose
  // meanwhile, its choice stands. If 繁體 is still the language but its map
  // could not load, the page shows 简体 (the saved choice stays) and says so
  // once it is drawn.
  if (controller.getState().lang === "zh-Hant") {
    // A load still hanging after HANT_START_TIMEOUT_MS fails, and its turn is
    // stale: a map that lands later never switches the page to 繁體.
    const outcome = await languageRequests.want("zh-Hant", () => {}, { timeoutMs: HANT_START_TIMEOUT_MS });
    if (controller.getState().lang === "zh-Hant" && (outcome === "failed" || !hantReady())) {
      controller.adoptLanguage("zh-Hans", { draw: false });
      pendingToast = "toast.hant_failed_start";
    }
  }

  controllerStarted = true;
  await controller.start();
}
