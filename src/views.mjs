import { esc, icon, button, officeContact, formatClientNumber, loadingLine, confirmBody } from "./ui.mjs";
import { viewLang } from "./language.mjs";
import { isStaffWindow } from "./contracts.mjs";
import { withdrawDialogBody } from "./client-views.mjs";
import { t, sentence } from "./client-text.mjs";
import { TOAST_ICONS } from "./toast.mjs";
import {
  renderStaffBoard,
  renderStaffCase,
  decorateStaffCase,
  correctionsDialogBody,
} from "./staff-views.mjs";
import {
  renderAdminCase,
  closeCaseDialogBody,
  markReadyToEfileDialogBody,
  markEfiledDialogBody,
  recordFilingResultDialogBody,
  returnToSigningDialogBody,
  requestDocumentsDialogBody,
  putOnHoldDialogBody,
  resumeFromHoldDialogBody,
} from "./admin-views.mjs";
import {
  renderAddCaseV2,
  renderFollowups,
  logCallDrawerBody,
  resolveHelpDrawerBody,
  closeUnsignedDialogBody,
} from "./office-views.mjs";
import { renderCasePool } from "./pool-views.mjs";

// The shared shell: the frame every screen sits in, the dialogs, the two
// screens that belong to nobody in particular (setup needed, no access), and
// the staff frame — the persona selector and the `<main>` that the work board
// or one case workspace sits in. The client screens live in
// `client-views.mjs` and the staff screens in `staff-views.mjs`; this file
// renders no intake, no progress and no workflow button of its own.

const when = (condition, html) => (condition ? html : "");

// The language switch (spec 2026-10-05 §2): three live buttons, each in its
// own language and named in it, whatever the screen language is. `data-value`
// is what brings the keyboard back to the pressed one after the redraw.
const SWITCH = Object.freeze([
  ["en", "English"],
  ["zh-Hans", "简体中文"],
  ["zh-Hant", "繁體中文"],
]);

export function languageSwitch(lang = "en") {
  const buttons = SWITCH.map(([code, name]) => {
    const pressed = code === lang;
    return `<button type="button" class="lang${pressed ? " current" : ""}" data-action="set-language" data-value="${code}" lang="${code}" aria-pressed="${pressed}">${name}</button>`;
  }).join("");
  return `<div class="language-switch" role="group" aria-label="${esc(t("frame.language", {}, lang))}">${buttons}</div>`;
}

// The version-2 form's wording switch (spec 2026-09-30 §3.2, §3.4): it edits
// form_version, so the wording changes at once and the answers stay as they are.
function seniorSwitch(pressed, lang = "en") {
  return `<button type="button" class="senior-switch" data-action="toggle-senior" aria-pressed="${pressed ? "true" : "false"}"><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>${esc(t("frame.senior", {}, lang))}</button>`;
}

// The client frame's top bar (spec section 7): the logo takes you home, then
// the language, help, Save & exit while a draft is open, and sign out.
export function clientHeader(state) {
  const lang = viewLang(state);
  const onDraft = state?.screen === "intake" && state?.savedCase?.stage === "draft";
  return `<header class="client-bar"><button class="client-brand" data-action="open-applications" aria-label="${esc(t("frame.home", {}, lang))}"><img src="src/pcdc-logo.png" alt="PCDC" width="32" height="32"><span class="client-wordmark">ViTally<span class="brand-dot">.</span></span></button><div class="client-bar-actions">${languageSwitch(lang)}${when(
    onDraft,
    seniorSwitch(state?.draftAnswers?.form_version === "senior", lang),
  )}${button(
    `${icon("help")} ${esc(t("frame.help", {}, lang))}`,
    "open-help",
    "text",
  )}${when(onDraft, button(esc(t("frame.save_exit", {}, lang)), "save-exit", "secondary"))}${when(
    state?.principal,
    button(`${icon("signout")} ${esc(t("frame.sign_out", {}, lang))}`, "sign-out", "text"),
  )}</div></header>`;
}

// A lost connection is stated plainly, and what is on screen stays readable.
// It never claims an action succeeded.
export function connectionNotice(state) {
  if (state.connection === "online" || state.connection === "unknown") return "";
  const reconnecting = state.connection === "reconnecting";
  return `<div class="connection-notice ${reconnecting ? "reconnecting" : "offline"}" role="status">${
    reconnecting ? icon("spinner", "spin") : icon("clock")
  }<span>${esc(t(reconnecting ? "frame.reconnecting" : "frame.offline", {}, viewLang(state)))}</span></div>`;
}

// The office's two drawers: the modal frame placed at the right edge.
export const DRAWERS = Object.freeze(["log-call", "resolve-help"]);

function problemBanner(state) {
  if (!state.error || state.saveState === "failed") return "";
  // The staff workspace states a failure in place, beside the action that
  // failed, with the same Try again and Dismiss controls. One announcement is
  // enough, and that one is the more useful of the two — but only when that
  // screen is really the one being rendered (see `staffScreen`).
  if (state.screen === "staff-case" && state.savedCase) return "";
  // While any dialog is open it says the failure itself (the drawers and the
  // corrections dialog in their own bodies, the others through `dialogError`);
  // a second alert behind an aria-modal dialog would be announced twice and
  // could not be reached.
  if (state.dialog) return "";
  const lang = viewLang(state);
  return `<div class="problem-banner" role="alert">${icon("help")}<span>${esc(sentence(state.error.message, lang))}</span>${when(state.retryable, button(esc(t("frame.try_again", {}, lang)), "retry-action", "inline"))}${button(esc(t("frame.dismiss", {}, lang)), "dismiss-error", "inline")}</div>`;
}

export function footer(lang = "en") {
  return `<footer class="site-footer"><span>${esc(t("footer.org", {}, lang))}</span><span>${esc(t("footer.note", {}, lang))}</span></footer>`;
}

// The redesigned staff frame: a collapsible sidebar beside the page body, with
// the toggle pinned to the top-left corner so it is always reachable. Nothing
// passes a sidebar yet (Phase 0), and without one the body comes back exactly
// as it went in, so no screen changes until it opts in.
export function appShell({ sidebar = "", body = "", open = true } = {}) {
  if (!sidebar) return body;
  const label = open ? "Hide the sidebar" : "Show the sidebar";
  return `<div class="app-shell${open ? "" : " sidebar-closed"}"><button type="button" class="sidebar-toggle" data-action="toggle-sidebar" aria-controls="app-sidebar" aria-expanded="${open}" aria-label="${label}" title="${label}">${icon("sidebar")}</button><aside id="app-sidebar" class="app-sidebar" aria-label="Workspace"${open ? "" : " hidden"}>${sidebar}</aside><div class="app-main">${body}</div></div>`;
}

export function page(state, body) {
  // A presenter's one plain screen stands alone: no header, footer, banners or
  // dialogs around it.
  if (state?.principal?.access === "presenter") return body;
  // Staff accounts work in the staff frame, whose sidebar carries the brand,
  // help and sign-out. Everyone else gets the client frame.
  const staff = isStaffWindow(state?.principal);
  const top = staff ? "" : clientHeader(state);
  const main = staff ? body : `<div class="client-shell">${body}</div>`;
  return `<a class="skip" href="#main">${t("frame.skip", {}, viewLang(state))}</a>${top}${connectionNotice(state)}${problemBanner(state)}${main}${footer(viewLang(state))}${dialog(state)}`;
}

// The toast's parts (design D4). Its host lives outside the page, in app.mjs.
export function toastParts({ kind, text, lang = "en" }) {
  if (!Object.hasOwn(TOAST_ICONS, kind)) throw new Error(`unknown toast kind: ${kind}`);
  return {
    icon: icon(TOAST_ICONS[kind], "toast-icon"),
    text: String(text ?? ""),
    dismissLabel: t("frame.dismiss", {}, lang),
  };
}

// Shown when `/public-config.json` cannot be read or reports `configured:false`.
// It explains what to set and nothing about what the values are.
export function setupNeeded() {
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon">${icon("shield")}</div><div class="page-intro centered"><span class="overline">SETUP NEEDED</span><h1>ViTally is not configured yet</h1><p>This browser could not read a usable <code>/public-config.json</code>, so there is no project to sign in to.</p></div><section class="panel setup-panel"><h2>Add a local environment file</h2><p>Copy <code>.env.example</code> to <code>.env.local</code> in the project root and fill in the two published values of your own Supabase project:</p><pre><code>SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key</code></pre><p>Then restart the server with <code>npm start</code> and reload this page. Both values are the ones a browser is meant to hold; nothing private belongs in this file, and it is never committed.</p><p class="field-note">See <code>docs/setup.md</code> for the database migrations and workspace setup that come before this step.</p></section></main>`;
}

// The server could not be reached while establishing who this visitor is.
// Showing the sign-in form here would be a guess — and a misleading one for
// someone who is already signed in — so this says what is actually known and
// offers another attempt. Focus and `online` events retry on their own too.
export function unreachableScreen(state) {
  const lang = viewLang(state);
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon">${icon("clock")}</div><div class="page-intro centered"><span class="overline">${esc(t("unreachable.overline", {}, lang))}</span><h1>${esc(t("unreachable.title", {}, lang))}</h1><p>${esc(sentence(state.error?.message ?? "Network error. Please try again later.", lang))}</p></div><div class="panel"><p>${esc(t("unreachable.body", {}, lang))}</p>${button(`${icon("refresh")} ${esc(t("frame.try_again", {}, lang))}`, "retry-connection", "primary full")}<p class="field-note">${esc(t("unreachable.note", {}, lang))}</p></div></main>`;
}

// Signed in, but this account has no active membership in a workspace.
export function noAccessScreen(state) {
  const lang = viewLang(state);
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon">${icon("lock")}</div><div class="page-intro centered"><span class="overline">${esc(t("no_access.overline", {}, lang))}</span><h1>${esc(t("no_access.title", {}, lang))}</h1><p>${esc(sentence(state.error?.message ?? "You do not have access to this step.", lang))}</p></div><div class="panel"><p>${esc(t("no_access.body", {}, lang))}</p>${button(esc(t("frame.sign_out", {}, lang)), "sign-out", "primary full")}</div></main>`;
}

// A presenter account is no longer used: the one plain screen it gets. English
// only, like every staff-side screen.
export function presenterScreen() {
  return `<main id="main" class="narrow" tabindex="-1"><div class="center-icon">${icon("lock")}</div><div class="page-intro centered"><h1>This account is no longer used</h1><p>Presenter mode has been removed. Ask your site coordinator for a staff account.</p></div><div class="panel">${button("Sign out", "sign-out", "text")}</div></main>`;
}

// ---------------------------------------------------------------------------
// The staff frame
// ---------------------------------------------------------------------------

// Which screens a staff account gets is decided by its own capabilities: an
// office administrator works in the follow-up and assistance workspace,
// everybody else in the preparation/review one (Ruling R55). This is a view
// choice — the database re-checks every capability on every action, so nothing
// here grants anything.
const isAdmin = (person) =>
  Array.isArray(person?.capabilities) && person.capabilities.includes("admin");

// What the staff sidebar holds: the brand, the screens this account can go to,
// and who is signed in. Screens that do not exist yet (Dashboard, Schedule,
// Documents, Messages) are not shown.
export function staffSidebar(state, person, office) {
  // A staff account is its own person: "Signed in as".
  const accountRow = `<small>Signed in as</small> <strong>${esc(person?.name ?? state.principal?.personName ?? "")}</strong>`;
  const onBoard = state?.screen === "staff";
  const onPool = state?.screen === "office-cases";
  const label = office ? "Follow-ups" : "Work board";
  const pool = office
    ? button(
        `${icon("folder")} All cases`,
        "open-cases",
        `nav-link${onPool ? " current" : ""}`,
        onPool ? 'aria-current="page"' : "",
      )
    : "";
  return `<div class="sidebar-brand"><img src="src/pcdc-logo.png" alt="PCDC" width="36" height="36"><span class="sidebar-wordmark">ViTally<span class="brand-dot">.</span></span></div><nav class="sidebar-nav" aria-label="Main navigation">${button(
    `${icon(office ? "people" : "board")} ${label}`,
    "open-board",
    `nav-link${onBoard ? " current" : ""}`,
    onBoard ? 'aria-current="page"' : "",
  )}${pool}</nav><div class="sidebar-account"><div class="account-row">${icon("user")}<span>${accountRow}</span></div>${button(
    `${icon("help")} Need help?`,
    "open-help",
    "text",
  )}${button(`${icon("signout")} Sign out`, "sign-out", "text")}</div>`;
}

// The records are decorated here — once, with the roster this screen already
// holds — so the renderers never see a bare id.
const OFFICE_SCREENS = ["office-cases", "office-add-case"];

// The Follow-ups queue reads the cases and the help requests; it is ready only
// when both are (a list that was never given counts as loaded).
const combineLists = (...states) => {
  const all = states.map((s) => s ?? "ready");
  return all.includes("failed") ? "failed" : all.includes("loading") ? "loading" : "ready";
};

export function staffScreen(state) {
  const people = state.people ?? [];
  const person =
    people.find((entry) => entry.id === state.principal?.personId) ?? null;
  const office = isAdmin(person);
  // A volunteer whose window was left on an office screen gets the work board.
  const screen =
    !office && OFFICE_SCREENS.includes(state.screen) ? "staff" : state.screen;
  const main = (() => {
    const addCaseAction = button(`${icon("plus")} Add a case`, "open-add-case", "primary");
    const frame = (overline, title, intro, backLabel, body, actions = "") =>
      `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">${esc(overline)}</span><h1>${esc(title)}</h1><p>${esc(intro)}</p>${when(
        backLabel,
        button(`${icon("back")} ${backLabel}`, "open-board", "text"),
      )}${when(actions, `<div class="page-actions">${actions}</div>`)}</div>${body}</main>`;
    if (screen === "staff-case" && state.savedCase) {
      const record = decorateStaffCase(state.savedCase, people);
      const ui = {
        person,
        // The case header says "Signed in as" for a staff account.
        principal: state.principal,
        // The demo-tools switch: it shows the Auto-fill button on the forms.
        demoTools: state.demoTools === true,
        busy: state.busy,
        // A dialog opened from the case page holds the only copy of the error.
        error: state.dialog ? null : state.error,
        retryable: state.retryable,
        // The shaded section's "Saved", beside its upload control.
        shadedStatus: state.shadedStatus,
        // What was read from an uploaded copy, held until Save these values.
        shadedReview: state.shadedReview,
        draftAnswers: state.draftAnswers,
        dirty: state.dirty,
        openPanels: state.openPanels,
        caseTab: state.caseTab,
        // The Log contact form's time field starts at now (New York).
        now: Date.now(),
      };
      return office
        ? frame(
            "OFFICE WORKSPACE",
            "One case",
            "What the office knows about this case, and the office work you may do on it.",
            "Back to Follow-ups",
            renderAdminCase(record, ui),
          )
        : frame(
            "VOLUNTEER WORKSPACE",
            "One case",
            // A staff account acts as no one but itself.
            state.principal?.access === "staff"
              ? "Everything this case holds, and the work you may do on it."
              : "Everything this case holds, and the work you may do on it as the volunteer you are acting as.",
            "Back to the work board",
            renderStaffCase(record, person, ui),
          );
    }
    if (screen === "office-add-case")
      return frame(
        "OFFICE · ADD A CASE",
        "Add a case",
        "Enter a walk-in client's answers yourself. The case has no client account: the office owns it.",
        "Back to Follow-ups",
        addCasePage(state, person, people),
      );
    const cases = (state.cases ?? []).map((record) =>
      decorateStaffCase(record, people),
    );
    if (screen === "office-cases")
      return frame(
        "OFFICE · ALL CASES",
        "Case pool",
        "Every case in this workspace, in every stage.",
        "",
        renderCasePool(cases, people, {
          list: state.lists?.cases ?? "ready",
          person,
          filters: state.boardFilters,
          now: Date.now(),
        }),
        addCaseAction,
      );
    return office
      ? frame(
          "OFFICE",
          "Follow-ups",
          "Everything waiting on the office, most urgent first.",
          "",
          renderFollowups(
            cases,
            (state.assistance ?? []).map((item) => decorateAssistance(item, people)),
            {
              person,
              list: combineLists(state.lists?.cases, state.lists?.assistance),
              filters: state.boardFilters,
              busy: state.busy,
              now: Date.now(),
            },
          ),
          addCaseAction,
        )
      : frame(
          "VOLUNTEER WORKSPACE",
          "Work board",
          "Every case in this workspace, what it is waiting for, and the work you can take on.",
          "",
          renderStaffBoard(cases, people, {
            person,
            list: state.lists?.cases ?? "ready",
            filters: state.boardFilters,
            busy: state.busy,
            searchDraft: state.boardSearchDraft,
            currentSeason: state.workspace?.currentSeason ?? null,
          }),
        );
  })();
  return appShell({
    sidebar: staffSidebar({ ...state, screen }, person, office),
    body: main,
    open: state.sidebarOpen !== false,
  });
}

// Add a case: the open office draft, or a new one. Before the workspace row
// has loaded the new draft has not started yet, so nothing is offered yet.
function addCasePage(state, person, people) {
  const saved = state.savedCase ?? null;
  if (!saved && !state.officeDraft && !state.workspace)
    return loadingLine("Loading…");
  return renderAddCaseV2({
    person,
    busy: state.busy,
    officeSaving: state.officeSaving,
    draftAnswers: state.draftAnswers,
    savedCase: decorateStaffCase(saved, people),
    openAddSubsteps: state.openAddSubsteps,
    openPanels: state.openPanels,
    addCaseShowMissing: state.addCaseShowMissing,
    revealed: state.revealed,
    dirty: state.dirty,
    saveState: state.saveState,
    conflict: state.conflict,
    error: state.error,
    retryable: state.retryable,
    people,
    demoTools: state.demoTools === true,
  });
}

// The same id-to-name step `decorateStaffCase` performs, for the one field an
// assistance item holds: the helper who took it. The store returns ids; no
// renderer ever sees one.
function decorateAssistance(item, people = []) {
  if (!item) return item;
  return {
    ...item,
    assigneeName: item.assigneeId
      ? (people.find((person) => person?.id === item.assigneeId)?.name ??
        "Unknown person")
      : null,
  };
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

// An error while a dialog is open is said inside it (design D2): the page's
// banner is behind an aria-modal and could not be reached or read. The drawers
// and the corrections dialog state their own failure in their bodies.
const OWN_ERROR_DIALOGS = Object.freeze([...DRAWERS, "request-corrections"]);
export function dialogError(state, lang) {
  if (!state.error || !state.dialog || OWN_ERROR_DIALOGS.includes(state.dialog)) return "";
  const say = (key) => esc(t(key, {}, lang));
  return `<div class="notice error" role="alert" id="dialog-error">${icon("help")}<div><p>${esc(sentence(state.error.message, lang))}</p><div class="conflict-choices">${when(
    state.retryable,
    button(say("frame.try_again"), "retry-action", "secondary"),
  )}${button(say("frame.dismiss"), "dismiss-error", "text")}</div></div></div>`;
}

export function dialog(state) {
  if (!state.dialog) return "";
  // The client's dialogs speak the view language; on staff screens it is English.
  const lang = viewLang(state);
  const say = (key) => esc(t(key, {}, lang));
  let title = "";
  let body = "";
  if (state.dialog === "help") {
    title = t("help.title", {}, lang);
    body = `<p>${say("help.body")}</p><div class="contact-option">${icon("home")}<div><strong>${say("help.contact")}</strong>${officeContact()}</div></div><div class="info-note">${icon("shield")}<p>${say("help.identity")}</p></div>`;
  }
  if (state.dialog === "regenerate") {
    title = t("regenerate.title", {}, lang);
    body = confirmBody({
      lead: say("regenerate.body"),
      note: { icon: "help", html: say("regenerate.note") },
      confirm: button(say("regenerate.confirm"), "confirm-regenerate", "primary full"),
      keep: say("regenerate.keep"),
    });
  }
  if (state.dialog === "leave-add-case") {
    title = "Leave without saving?";
    body = confirmBody({
      lead: "The answers on this page are not saved yet. If you leave now, they are lost. Nothing has been sent to the office.",
      confirm: button("Leave and discard", "confirm-leave-add-case", "primary full"),
      keep: "Keep editing",
    });
  }
  if (state.dialog === "withdraw") {
    title = t("withdraw.title", {}, lang);
    body = withdrawDialogBody(state);
  }
  if (state.dialog === "close-case") {
    title = "Close this case?";
    // The office screens own their own copy; this frame only places it.
    body = closeCaseDialogBody(state);
  }
  if (state.dialog === "mark-ready-to-efile") {
    title = "Mark ready to e-file?";
    body = markReadyToEfileDialogBody(state);
  }
  if (state.dialog === "mark-efiled") {
    title = "Mark e-filed?";
    body = markEfiledDialogBody(state);
  }
  if (state.dialog === "record-filing-result") {
    title = "Record the filing result?";
    body = recordFilingResultDialogBody(state);
  }
  if (state.dialog === "return-to-signing") {
    title = "Return to signing?";
    body = returnToSigningDialogBody(state);
  }
  if (state.dialog === "request-documents") {
    title = "Ask for documents?";
    body = requestDocumentsDialogBody(state);
  }
  if (state.dialog === "put-on-hold") {
    title = "Put this case on hold?";
    body = putOnHoldDialogBody(state);
  }
  if (state.dialog === "resume-from-hold") {
    title = "Got in touch?";
    body = resumeFromHoldDialogBody(state);
  }
  if (state.dialog === "close-unsigned") {
    title = "Close unsigned cases?";
    body = closeUnsignedDialogBody({ cases: state.cases ?? [], now: Date.now() });
  }
  if (state.dialog === "request-corrections") {
    title = "Ask the preparer for corrections";
    body = correctionsDialogBody(state);
  }
  if (DRAWERS.includes(state.dialog)) {
    const people = state.people ?? [];
    const person = people.find((entry) => entry.id === state.principal?.personId) ?? null;
    const ui = { busy: state.busy, error: state.error, retryable: state.retryable, now: Date.now() };
    if (state.dialog === "log-call") {
      title = "Log contact";
      body = logCallDrawerBody({
        record: decorateStaffCase(state.savedCase, people),
        person,
        ui,
        caseId: state.dialogContext?.caseId,
      });
    } else {
      title = "Resolve a help request";
      const item = (state.assistance ?? []).find(
        (entry) => entry?.id === state.dialogContext?.itemId,
      );
      body = resolveHelpDrawerBody({ item: decorateAssistance(item, people), person, ui });
    }
  }
  if (state.dialog === "print") {
    title = t("print.title", {}, lang);
    body = `<div class="print-card"><strong>${say("print.org")}</strong><span>${say("id.application_caps")}</span><b>${esc(state.savedCase?.reference)}</b>${state.savedCase?.clientNumber != null ? `<span>${say("id.client_number_caps")}</span><b>${esc(formatClientNumber(state.savedCase.clientNumber))}</b>` : ""}<p>${say("print.return")}</p></div><p class="field-note">${say("print.note")}</p>${button(`${icon("print")} ${say("print.button")}`, "print-now", "primary full")}`;
  }
  const drawer = DRAWERS.includes(state.dialog);
  const overline = drawer ? "OFFICE FOLLOW-UP" : t("dialog.overline", {}, lang);
  return `<div class="modal-backdrop"><section class="modal${drawer ? " office-drawer" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><button class="close-btn" data-action="close-dialog" aria-label="${say("dialog.close")}">${icon("close")}</button><span class="overline">${esc(overline)}</span><h2 id="modal-title">${esc(title)}</h2>${dialogError(state, lang)}${body}</section></div>`;
}
