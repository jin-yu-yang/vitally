import {
  CASE_ACTIONS,
  ASSISTANCE_ACTIONS,
  SHADED_EDITOR,
  SHADED_UPLOAD,
} from "./contracts.mjs";
import {
  CONTACT_FIELDS,
  checkValue,
  findQuestion,
  findSubstep,
  isAnswered,
  isMemberId,
  missingToSubmit,
  stepsFor,
  substepOfQuestion,
  spouseShown,
  substepsFor,
} from "./intake-catalogue.mjs";
import {
  adjacentSubstep,
  firstUnfinishedSubstep,
  invalidAnswers,
  keepLocalOnly,
  mergeIntoDraft,
  newMemberId,
  resolveSubstep,
  reviewAlerts,
  sendable,
  sendableDiffers,
  withholdInvalid,
} from "./intake-form.mjs";
import { cardsFor } from "./document-cards.mjs";
import { createShadedSave } from "./shaded-editor.mjs";
import { createWindowState } from "./window-state.mjs";
import { isLang, readLanguage, writeLanguage } from "./language.mjs";

// The one place browser state lives. It owns what is loaded, what is being
// edited, and which action envelope is in flight; it renders nothing and knows
// no HTML. Everything it reads or writes goes through the injected store and
// auth modules, so the same controller runs in the browser and against doubles.
//
// Three rules this file exists to keep:
//
//   * **savedCase and draftAnswers are different things.** A remote change
//     replaces what the server says; it never rewrites what the person typed.
//     When the two diverge the controller says so (`conflict`) and refuses to
//     save until a human chooses. Pending edits are never silently rebased.
//   * **An unknown outcome keeps its envelope.** A timed-out action is retried
//     as the identical object — same action id, payload and expected
//     revision — so the server replays its receipt instead of acting twice.
//   * **Window state is per window and per user.** Selection, screen, sub-step,
//     open panels and the board's filters live in session storage
//     under the authenticated user's id, so two windows disagree freely and two
//     accounts never share a view. That storage is a collaborator of its own
//     (`window-state.mjs`, Ruling R44); this file decides what the values mean.

// Screens each principal can be on, first entry first. A restored value outside
// the caller's own list is ignored rather than trusted — which is also what
// stops a client screen from being restored for staff, and the reverse.
const CLIENT_SCREENS = Object.freeze([
  "applications",
  "reference",
  "intake",
  "progress",
]);
const STAFF_SCREENS = Object.freeze(["staff", "staff-case", "office-cases", "office-add-case"]);

// An action whose answer never arrived may or may not have been applied. Those
// are the only failures worth retrying with the same envelope; a refusal is
// final and its expected revision is already stale.
const UNKNOWN_OUTCOME = Object.freeze(["OFFLINE", "SERVER_ERROR"]);

// Assistance is its own workflow: its own RPC, its own revision and its own
// list, beside the tax case rather than inside it (Ruling R22). Its two actions
// therefore have their own vocabulary (`ASSISTANCE_ACTIONS` in contracts.mjs),
// checked here exactly as `CASE_ACTIONS` is checked for a case action.

const CONFLICT_MESSAGE =
  "Someone else changed this application. The newest version is shown — check it and try again.";
// The same event, in the words of the screen it lands on: staff read "case",
// clients read "application", and neither ever sees a revision number.
const STAFF_CONFLICT_MESSAGE =
  "Someone else changed this case. The newest version is shown — check it and try again.";
// The shaded section's upload (change add-preparer-13614c-fields, design D8):
// its errors are said beside the upload control, and a stale copy is named as
// one, since nothing was "opened" there.
const STAFF_UPLOAD_CONFLICT_MESSAGE =
  "The shaded section was saved since this copy was downloaded. Download a fresh copy and fill that one.";
// The case moved again while an upload was being sent once more: the copy is
// still good, so the same file is uploaded again.
const STAFF_UPLOAD_CASE_MOVED_MESSAGE =
  "The case changed while this copy was being saved. Upload the same file again.";
const ASSISTANCE_CONFLICT_MESSAGE =
  "Someone else changed this item. The newest version is shown — check it and try again.";
const STAFF_CONTACT_GONE_MESSAGE = "This contact is no longer on screen.";
const STAFF_CONTACT_CONFLICT_MESSAGE =
  "Someone else changed this contact. The newest version is shown — check it and try again.";
const EDIT_CONFLICT_MESSAGE =
  "Someone else changed this application while you were editing. Choose which answers to keep.";

function controllerError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

// The intake whitelist is the only thing that reaches `answers`. Anything else
// — an owner id, a stage, a forged reference — is dropped here, once. It keeps
// the catalogue's top-level field ids with their structured values, null
// included (a null is "clear this field on the next save", spec 2026-09-30
// §3.3).
function pickAnswers(source) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const [key, value] of Object.entries(source))
    if (value !== undefined && findQuestion(2, key)) result[key] = value;
  return result;
}

// ---- intake helpers (spec 2026-09-30 §2.5, §3.3–§3.4; 2026-10-04 §3) ----

const V2_QUESTIONS = Object.freeze(
  stepsFor(2).flatMap((step) => step.sections.flatMap((section) => section.questions)),
);
const WHO_IDS = Object.freeze(
  V2_QUESTIONS.filter((question) => question.type === "who").map((question) => question.id),
);
// The groups whose members carry a hidden `member_id` (today only `hh`).
const MEMBER_GROUPS = Object.freeze(
  V2_QUESTIONS.filter(
    (question) =>
      question.type === "group" &&
      (question.fields ?? []).some((field) => field.id === "member_id"),
  ).map((question) => question.id),
);
// Every sub-step id, in catalogue order: the order visits are kept and sent in.
const SUBSTEP_IDS = Object.freeze(substepsFor(2).map((substep) => substep.id));
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The server's side of a version-2 draft: its answers plus the contact record's
// four fields. A null contact (no contact saved yet), or a null inside it,
// counts as empty.
function serverAnswersOf(record) {
  const result = pickAnswers(record?.answers);
  for (const [id, key] of Object.entries(CONTACT_FIELDS)) {
    const value = record?.contact?.[key];
    if (value !== undefined && value !== null) result[id] = value;
  }
  return result;
}

// No joint return any more: no who answer may still name the spouse. A list
// left empty reads as null, as an unticked group does.
function clearSpouse(draft) {
  const next = { ...draft };
  for (const id of WHO_IDS) {
    const value = next[id];
    if (!Array.isArray(value) || !value.includes("spouse")) continue;
    const kept = value.filter((entry) => entry !== "spouse");
    next[id] = kept.length ? kept : null;
  }
  return next;
}

// Every household member has an id (spec 2026-10-04 §6.2). Without one,
// `checkGroup` calls the household invalid and `withholdInvalid` drops it from
// every save without a word, so each path that puts members into a version-2
// draft goes through here. A member without a valid id, or sharing the id of
// a member before it, gets one: the id the previous draft's member at the same
// position had, when that is free (so a refresh doesn't deal new ids each
// time), otherwise a new one. Returns the same object when nothing changed.
function withMemberIds(draft, previous = {}) {
  let result = draft;
  for (const group of MEMBER_GROUPS) {
    const members = draft?.[group];
    if (!Array.isArray(members)) continue;
    const firstAt = new Map();
    members.forEach((member, index) => {
      if (isPlainObject(member) && isMemberId(member.member_id) && !firstAt.has(member.member_id))
        firstAt.set(member.member_id, index);
    });
    const taken = new Set(firstAt.keys());
    const before = Array.isArray(previous?.[group]) ? previous[group] : [];
    let changed = false;
    const fixed = members.map((member, index) => {
      if (!isPlainObject(member) || firstAt.get(member.member_id) === index) return member;
      const earlier = before[index]?.member_id;
      let id = isMemberId(earlier) && !taken.has(earlier) ? earlier : newMemberId();
      while (taken.has(id)) id = newMemberId();
      taken.add(id);
      changed = true;
      return { ...member, member_id: id };
    });
    if (changed) result = { ...result, [group]: fixed };
  }
  return result;
}

// Visits in catalogue order, any id the catalogue doesn't know after them.
function orderVisited(ids) {
  const seen = new Set(ids);
  return [
    ...SUBSTEP_IDS.filter((id) => seen.has(id)),
    ...[...seen].filter((id) => !SUBSTEP_IDS.includes(id)),
  ];
}

// The two snapshots hold the same answers and contact fields, field by field
// by their sendable values (spec 2026-10-04 §3.8).
const sameServerAnswers = (a, b) => {
  const left = serverAnswersOf(a);
  const right = serverAnswersOf(b);
  return !sendableDiffers(left, right, 2) && !sendableDiffers(right, left, 2);
};

// "hh[1].dob" -> { group: "hh", index: 1, sub: "dob" }.
const MEMBER_ID = /^([a-z0-9_]+)\[(\d+)\]\.([a-z0-9_]+)$/;
const parseMemberId = (id) => {
  const match = MEMBER_ID.exec(id);
  return match ? { group: match[1], index: Number(match[2]), sub: match[3] } : null;
};

// Whether an id (top-level, or a member's sub-field) holds an invalid value in
// this draft, visible or not. Valid, empty and gone are all "no".
function holdsInvalid(id, draft) {
  const member = parseMemberId(id);
  if (member) {
    const question = findQuestion(2, member.group);
    const field = question?.fields?.find((entry) => entry.id === member.sub);
    const person = Array.isArray(draft?.[member.group]) ? draft[member.group][member.index] : undefined;
    if (!field || !isPlainObject(person)) return false;
    return checkValue(field, sendable(field, person[member.sub])) !== null;
  }
  const question = findQuestion(2, id);
  if (!question || question.type === "group") return false;
  return checkValue(question, sendable(question, draft?.[id])) !== null;
}

export function createController({
  store,
  auth,
  render,
  sessionStorage,
  windowEvents = globalThis,
  clock = () => Date.now(),
  newActionId = () => crypto.randomUUID(),
  cooldownSeconds = 65,
  // The browser's own storage for the language (spec 2026-10-05 §2): kept
  // per browser, never in the window state. null when it is blocked.
  localStorage = null,
  languages = [],
  // The demo-tools switch (demoToolsFromConfig); fixed for the session.
  demoTools = false,
}) {
  const state = {
    demoTools: demoTools === true,
    // The client's language: "en", "zh-Hans" or "zh-Hant". Staff screens
    // ignore it (viewLang). Saved per browser, never in sessionStorage.
    lang: readLanguage({ storage: localStorage, languages }),
    // Identity and transport. `session` is what the last identity attempt
    // learned, and it is deliberately three-valued: a visitor who is signed out
    // and a server that cannot be reached must never be shown the same screen,
    // which is exactly why `auth.getSession()` throws OFFLINE rather than
    // answering null.
    session: "unknown", // 'unknown' | 'none' | 'present'
    principal: null,
    connection: "unknown",
    error: null,
    // How many errors have been recorded: app.mjs's safety net compares it
    // to tell a press that recorded its own failure from one that did not
    // (`error` is cloned by getState, so it cannot be compared).
    errorCount: 0,
    retryable: false,
    // Sign-in. The half-typed code lives here for the same reason answers do:
    // a re-render must never be able to empty a field somebody is using.
    authStep: "email",
    authEmail: "",
    authCode: "",
    authMessage: "",
    authError: null,
    // Records
    cases: [],
    // Whether each list has been read (design D6): a first load that failed
    // must never look like an empty list.
    lists: { cases: "loading", assistance: "loading" },
    people: [],
    // The caller's own workspace row, read only for a staff window: the
    // office's defaults.
    workspace: null,
    // The office's assistance requests. Staff-only: an applicant never
    // reads this table, so the list stays empty for them and is never fetched.
    assistance: [],
    savedCase: null,
    draftAnswers: {},
    editBaseRevision: null,
    dirty: false,
    conflict: null,
    saveState: "idle",
    // The ids whose error this window has shown (spec §2.5):
    // an id enters on `change` or when its step is left, and leaves once its
    // value is valid or empty. Stored as a list, because it is window state.
    revealed: [],
    // Where the form is: a sub-step id, or null until a case
    // is open (then the first unfinished sub-step, spec 2026-10-04 §3.1). The
    // page shows `currentSubstep()`, which resolves a hidden or unknown one.
    formSubstep: null,
    // The sub-steps left on the selected case: the server's
    // `intakeVisited`, merged on every refresh, plus this window's visits not
    // yet saved (§3.7). Only ids the catalogue knows are ever sent.
    visitedSubsteps: [],
    // A sub-step opened from the summary's Change link: its
    // primary button returns to the summary (§5.2).
    returnToSummary: false,
    // Add a case (spec 2026-10-04 §10). `officeDraft`: a new office draft
    // with no case yet; its first save creates the case.
    // `officeDraftCaseId`: that create's case, held only while the case is
    // still to be read and adopted. `officeSaving`: a Save draft or Send is
    // in flight. `openAddSubsteps`: the page's open parts (sub-step ids, or
    // "documents"). `addCaseShowMissing`: a refused Send marks what is
    // missing. None of them is persisted, and none outlives the page.
    officeDraft: false,
    officeDraftCaseId: null,
    officeSaving: false,
    openAddSubsteps: ["before.ready"],
    addCaseShowMissing: false,
    busy: false,
    // Window-local navigation
    screen: "access",
    selectedCaseId: null,
    openPanels: [],
    lookup: "",
    dialog: null,
    // What the open dialog is about — the case a Log contact drawer was opened
    // from, the help request being resolved. Window-local and never persisted:
    // a reload closes every dialog.
    dialogContext: null,
    pendingCreateActionId: null,
    // The staff board's filters, as chosen in this window. Only the choices a
    // person made are held; the board fills in its own defaults for the rest.
    boardFilters: {},
    // The board search box's half-typed text, kept the same way `lookup` is:
    // a re-render (a realtime change, a notice) must not wipe
    // out what somebody is in the middle of typing. `undefined` means nothing
    // is being typed, so the box shows the saved search instead. Window-local
    // only — never written to `windowState`.
    boardSearchDraft: undefined,
    // Whether this window shows the staff sidebar. Open unless the person
    // closed it.
    sidebarOpen: true,
    // Which tab of the case page this window shows. Overview unless chosen.
    caseTab: "overview",
    // `{caseId, text: "Saved"}` once an uploaded shaded section was saved,
    // said beside the upload control on that case's page until the next
    // upload or error.
    shadedStatus: null,
    // `{caseId, values, version, preview}` while what was read from an
    // uploaded copy waits for the preparer to confirm it (change
    // guard-shaded-upload-against-preview, design D1). Kept across redraws;
    // dropped on a case switch, sign-out, Cancel, Save and the next upload.
    // Window-local only, never persisted.
    shadedReview: null,
  };

  // Everything this window remembers by itself, under one key per user.
  const windowState = createWindowState({ sessionStorage, clock });

  // The envelope of the last action whose outcome is unknown. Kept as the very
  // object that was sent, because retrying a copy would be a second action.
  let pendingAction = null;
  // The screening start for the open case, if one is due or held:
  // `{ action, inFlight, gaveUp }` (`startScreeningIfDue`).
  let screeningStart = null;
  // The start being sent now, `{ caseId, promise }`, so a case action can wait
  // for it (`runAction`).
  let screeningInFlight = null;
  // A case action is waiting for that start; a second press does nothing.
  let pressWaitingOnStart = false;
  // What the save state was before an edit made a version-2 draft dirty
  // ("idle" or "saved"), so an undo can put it back.
  let stateBeforeEdit = "idle";
  // A version-2 sub-step change is waiting for its save (`goToSubstep`), or a
  // card mark is waiting for its pre-save or its own action (`cardAction`).
  let substepSaveInFlight = false;
  // While the flag is held: a promise that settles when it is dropped, so a
  // Save pressed meanwhile can wait its turn (`takeFlag`, `dropFlag`).
  let flagFree = null;
  // The version-2 save out now (`{ opening, promise, shown }`), so a Save
  // pressed meanwhile can learn how it ended. `shown`: its failure is already
  // on its way to the person, through the press that sent it or through a
  // Save that waited for it, so it is said once.
  let saveOut = null;
  // Which new office draft is open: moves each time one starts. A Save draft
  // started for one draft adopts nothing once that draft is gone.
  let officeDraftToken = 0;
  // A version-2 save's envelope -> the draft it was built from, so what was
  // typed while it was out survives the re-read once it lands.
  const sentDrafts = new WeakMap();
  // Which opening of a case this window is on: moves each time the open case
  // changes (one opened, left, or another opened; `clearSelection`), never
  // when the same opening reads its case again (a refresh, `loadSelected`, a
  // realtime catch-up, a board control's `selectCase` of the open case). A
  // case opened again after another case (or none) was opened is a new
  // opening, whose draft is built from the server as it was then; going to a
  // list and back keeps the same opening, since its draft was not rebuilt.
  let opening = 0;
  // A case action's envelope -> the opening it was sent from. Every "is this
  // still the draft the save was for?" compares openings, never case ids;
  // the opening stays out here because the envelope is the RPC's contract
  // and carries nothing more.
  const sentFrom = new WeakMap();
  const sameOpening = (action) => sentFrom.get(action) === opening;
  // A save carrying answer changes failed with an unknown outcome, so the
  // server may hold answers the draft doesn't (an undo after it, say). Until a
  // save succeeds, the draft is then never "dirty only because of visits"
  // (spec 2026-10-04 §3.8), so a newer revision is not taken without a choice.
  let answersInDoubt = false;
  // The revision the open version-2 case's last save made, from its receipt
  // (`{ opening, revision }`). A re-read that fails after the save leaves
  // savedCase older, and the next pin must not be a revision the save moved
  // past, or the next save meets a conflict with this person's own save. It
  // belongs to the opening the save was sent from, whose draft holds what was
  // sent: a later opening's draft was built from its own read, and pinning
  // that to the save's revision would let its next save put older answers
  // back over the saved ones without a conflict. What keeps it from a later
  // opening is that it is only set when the save landed on the same opening
  // and is cleared where the opening moves (`clearSelection`); the opening
  // kept with it is a second check, not the first.
  let landedRevision = null;
  let creating = false;
  let releaseStore = null;
  let releaseAuth = null;
  let listening = false;
  let started = false;

  // `focus` says this render changed the screen, so the page it drew is a new
  // one and the keyboard belongs at the top of it. Everything else — a data
  // refresh, somebody else's Realtime change, a refusal, a dialog — leaves the
  // keyboard exactly where the person put it.
  const show = (focus = false) => render?.(focus);

  // ---- window-local state ------------------------------------------------
  //
  // What is stored, and how, belongs to the collaborator; what the values mean
  // — which screens exist, which of them this principal may be on — belongs
  // here.

  // Screens the current principal may be on, first entry first.
  const screens = () => (staffWindow() ? STAFF_SCREENS : CLIENT_SCREENS);

  // Where "back to the list" goes for whoever is signed in.
  const homeScreen = () => screens()[0];

  // Screens that are about the selected case. Anywhere else, a case that has
  // gone only clears the selection: the person is somewhere else on purpose.
  const CASE_SCREENS = Object.freeze(["staff-case", "intake", "progress", "reference"]);
  function forgetGoneCase() {
    clearSelection();
    if (CASE_SCREENS.includes(state.screen)) state.screen = homeScreen();
  }

  function persistSession() {
    if (!state.principal || inert()) return;
    const { userId } = state.principal;
    windowState.write(userId, {
      screen: state.screen,
      selectedCaseId: state.selectedCaseId,
      openPanels: state.openPanels,
      pendingCreateActionId: state.pendingCreateActionId,
      boardFilters: state.boardFilters,
      sidebarOpen: state.sidebarOpen,
      caseTab: state.caseTab,
      formSubstep: state.formSubstep,
      revealedAnswers: state.selectedCaseId
        ? { caseId: state.selectedCaseId, ids: state.revealed }
        : undefined,
    });
  }

  function restoreSession() {
    const saved = state.principal
      ? windowState.read(state.principal.userId)
      : null;
    if (!saved) return;
    // Every field has already been checked for its shape; the screen is checked
    // here, against the list this principal is allowed.
    if (screens().includes(saved.screen)) state.screen = saved.screen;
    if (saved.selectedCaseId) state.selectedCaseId = saved.selectedCaseId;
    if (saved.openPanels) state.openPanels = saved.openPanels;
    if (saved.pendingCreateActionId)
      state.pendingCreateActionId = saved.pendingCreateActionId;
    if (saved.boardFilters) state.boardFilters = saved.boardFilters;
    if (typeof saved.sidebarOpen === "boolean") state.sidebarOpen = saved.sidebarOpen;
    if (typeof saved.caseTab === "string") state.caseTab = saved.caseTab;
    if (saved.formSubstep) state.formSubstep = saved.formSubstep;
    // Revealed ids belong to one case: another case's record means nothing.
    if (saved.revealedAnswers && saved.revealedAnswers.caseId === state.selectedCaseId)
      state.revealed = [...saved.revealedAnswers.ids];
  }

  // ---- the resend cooldown (Ruling R38) ----------------------------------
  //
  // The auth module's cooldown lives in memory, so a reload would start a fresh
  // one. The moment the last request left is written to session storage
  // instead, and the remaining time is derived from it, so reloading the window
  // cannot buy another send. It is per window, exactly like the rest of this
  // state, and holds no code or token.

  const accessRecord = () => windowState.readAccess();

  const cooldownRemaining = () =>
    Math.max(
      windowState.cooldownRemaining(cooldownSeconds),
      auth?.cooldownRemaining?.() ?? 0,
    );

  // ---- reading -----------------------------------------------------------

  function noteConnected() {
    if (state.connection !== "online") state.connection = "online";
  }

  // One local retry (design D3): what Try again runs for a failure outside the
  // store's actions. Any newer error drops it; only noteLocalFailure and
  // noteUnloaded set it, after recording.
  let localRetry = null;
  function setLocalRetry(fn) {
    localRetry = typeof fn === "function" ? fn : null;
    state.retryable = Boolean(localRetry);
  }
  // A dropped local retry takes its Try again with it. Only when one was
  // pending: a store action's retry (`pendingAction`) keeps its own flag.
  function dropLocalRetry() {
    if (localRetry) state.retryable = false;
    localRetry = null;
  }

  function noteFailure(error, { message } = {}) {
    dropLocalRetry();
    state.errorCount += 1;
    state.error = {
      code: error?.code ?? "SERVER_ERROR",
      message: message ?? error?.message ?? "Something went wrong.",
      // Where the page says it, when that is not the usual place: the
      // shaded section's upload control (SHADED_UPLOAD), or its panel when
      // the editor couldn't be opened (SHADED_EDITOR).
      ...(error?.place === SHADED_UPLOAD || error?.place === SHADED_EDITOR ? { place: error.place } : {}),
    };
    // A newer error replaces a shaded save's "Saved".
    state.shadedStatus = null;
    if (error?.code === "OFFLINE") state.connection = "offline";
  }

  // One error at a time (design D2): a newer error replaces a failed save's.
  // The draft stays and goes with the next move or save.
  function replaceFailedSave() {
    if (state.saveState !== "failed") return;
    forgetPendingSave();
    state.saveState = "unsaved";
  }

  // A refusal the window makes itself: recorded, drawn, then thrown.
  function refuse(code, message) {
    replaceFailedSave();
    noteFailure({ code }, { message });
    state.retryable = false;
    show();
    return controllerError(code, message);
  }

  function noteLocalFailure(error, retry = null) {
    replaceFailedSave();
    noteFailure(error ?? {}, { message: error?.message ?? "Something went wrong." });
    setLocalRetry(retry);
    show();
  }

  // A snapshot from the server replaces what we knew only when it is newer, so
  // a slow earlier response cannot undo a later one. A newer revision arriving
  // mid-edit updates savedCase and raises the conflict; it never rebases the
  // draft. It first settles the revisions that leave nothing to choose
  // between (spec 2026-10-04 §3.8), and merges the server's visits (§3.7).
  function applyCase(next) {
    if (!next) return;
    const current = state.savedCase;
    if (
      current &&
      current.id === next.id &&
      Number(next.revision) < Number(current.revision)
    )
      return;
    // The draft being replaced, when it is this case's: its local-only
    // differences (an invalid value, or spaces only) survive the rebuild.
    const previousDraft = current?.id === next.id ? state.draftAnswers : {};
    if (current?.id === next.id && settleNewerRevision(current, next, previousDraft)) {
      openAtFirstUnfinished();
      return;
    }
    mergeVisits(current?.id === next.id ? state.visitedSubsteps : [], next);
    state.savedCase = next;
    if (state.dirty && state.editBaseRevision !== null) {
      state.conflict =
        Number(next.revision) > Number(state.editBaseRevision)
          ? {
              code: "REMOTE_CHANGED",
              baseRevision: Number(state.editBaseRevision),
              serverRevision: Number(next.revision),
            }
          : null;
      openAtFirstUnfinished();
      return;
    }
    state.draftAnswers = rebuildDraft(previousDraft, next);
    pruneRevealed();
    state.conflict = null;
    openAtFirstUnfinished();
  }

  // The server's answers, with this draft's local-only differences kept and
  // every household member given an id.
  const rebuildDraft = (previousDraft, record) =>
    withMemberIds(keepLocalOnly(previousDraft, serverAnswersOf(record), 2), previousDraft);

  // The server's visited set merged into `base` (union).
  function mergeVisits(base, record) {
    state.visitedSubsteps = orderVisited([...base, ...(record?.intakeVisited ?? [])]);
  }

  // Spec 2026-10-04 §3.8: a newer revision of the open version-2 case while
  // the draft is dirty and pinned. Returns true when it was taken without a
  // conflict; false leaves it to today's conflict path. "Only visits unsaved"
  // means no answer or contact change pending against the snapshot being
  // replaced, and no failed save that may have stored answers the draft lacks.
  function settleNewerRevision(current, next, previousDraft) {
    if (!state.dirty || state.editBaseRevision === null || state.conflict) return false;
    if (Number(next.revision) <= Number(state.editBaseRevision)) return false;
    const onlyVisits =
      !answersInDoubt && !sendableDiffers(previousDraft, serverAnswersOf(current), 2);
    if (next.stage !== current.stage) {
      // Another window submitted. With answers unsaved, as today.
      if (!onlyVisits) return false;
      // The unsaved visits can't be saved any more: the server's set stands.
      state.savedCase = next;
      state.visitedSubsteps = orderVisited(next.intakeVisited ?? []);
      state.draftAnswers = rebuildDraft(previousDraft, next);
      pruneRevealed();
      state.dirty = false;
      state.editBaseRevision = null;
      state.conflict = null;
      if (state.saveState === "unsaved" || state.saveState === "failed")
        state.saveState = settledState();
      forgetPendingSave();
      return true;
    }
    if (sameServerAnswers(current, next)) {
      // A card mark, a visit, a stage-free action: only the base moves.
      mergeVisits(state.visitedSubsteps, next);
      state.savedCase = next;
      movePin(next);
      return true;
    }
    if (!onlyVisits) return false;
    // Nothing to choose between: take the newer answers, keep the visits.
    mergeVisits(state.visitedSubsteps, next);
    state.savedCase = next;
    state.draftAnswers = rebuildDraft(previousDraft, next);
    pruneRevealed();
    movePin(next);
    return true;
  }

  // The base revision moves forward to `record`. A retained save envelope
  // still expects the old revision, so it could only be refused now. What is
  // left to save is measured again against the newer snapshot, as in
  // `commitDraft`: nothing left (the visits, say, are already there) clears
  // the pin and settles the chip. A save refused as a conflict is answered by
  // the move, so its failure and its banner go too.
  function movePin(record) {
    state.editBaseRevision = Number(record.revision);
    state.conflict = null;
    forgetPendingSave();
    const refused = state.saveState === "failed" && state.error?.code === "CONFLICT";
    if (refused) state.error = null;
    if (!sendableDiffers(state.draftAnswers, serverAnswersOf(record), 2) && !visitsPending()) {
      state.dirty = false;
      state.editBaseRevision = null;
      if (state.saveState === "unsaved" || state.saveState === "failed")
        state.saveState = settledState();
    } else if (refused) {
      state.saveState = "unsaved";
    }
  }

  // A case opened with no saved place opens at its first unfinished sub-step
  // (spec 2026-10-04 §3.1); a new case therefore opens at before.ready.
  function openAtFirstUnfinished() {
    if (state.formSubstep !== null || !state.savedCase) return;
    state.formSubstep = firstUnfinishedSubstep(
      state.draftAnswers,
      cardsNow(),
      state.visitedSubsteps,
      state.revealed,
    );
  }

  // The document cards the draft makes, with the case's stored card state.
  const cardsNow = () => cardsFor(state.draftAnswers, state.savedCase?.documentCards ?? []);

  // Every change to a version-2 draft drops the revealed ids whose value is now
  // valid or empty, or whose household member is gone (spec §2.5).
  function pruneRevealed() {
    if (!state.revealed.length) return false;
    const kept = state.revealed.filter((id) => holdsInvalid(id, state.draftAnswers));
    if (kept.length === state.revealed.length) return false;
    state.revealed = kept;
    return true;
  }

  async function loadList() {
    if (inert()) return;
    state.cases = await store.listCases();
    state.lists.cases = "ready";
    noteConnected();
  }

  // The one presenter check (remove-presenter-screens): a presenter's plain
  // screen reads nothing, saves no place and opens no channel. Every read
  // (`loadData`, `loadList`, `loadWorkspace`, `loadAssistance`, `loadSelected`),
  // the save of the window's place (`persistSession`) and the channel
  // (`subscribe`) return at once, so no caller (focus, online, Try again,
  // refresh, a late change) can wake it.
  const inert = () => state.principal?.access === "presenter";
  // Everything a staff screen does: its reads, its rules and its actions.
  const staffWindow = () => state.principal?.access === "staff";

  // Only a staff window may read the assistance table at all, so only a staff
  // window ever asks: the adapter would refuse an applicant, and asking is
  // already a mistake (`supabase-store.mjs`, "an applicant read never names a
  // staff table").
  async function loadAssistance() {
    if (inert()) return;
    if (!staffWindow()) {
      state.lists.assistance = "ready";
      return;
    }
    state.assistance = await store.listAssistance();
    state.lists.assistance = "ready";
    noteConnected();
  }

  // The workspace row carries what the staff screens need of the office: the
  // default follow-up person, the season and the intake version a new case
  // starts at.
  // Only a staff window reads it.
  async function loadWorkspace() {
    if (inert()) return;
    if (!staffWindow() || !store.getWorkspace) return;
    state.workspace = await store.getWorkspace();
    noteConnected();
    enterOfficeDraftIfNeeded();
  }

  async function loadSelected() {
    if (inert()) return;
    if (!state.selectedCaseId) return;
    const next = await store.getCase(state.selectedCaseId);
    applyCase(next);
    noteConnected();
  }

  // The public re-fetch: the list plus whatever case is open. Used by the
  // reconnect, the window focus and the online event alike, because a
  // subscription is never the only way back.
  async function refresh() {
    // Without a principal there is nothing to re-read, but there may still be
    // an identity to establish: a visitor whose session could not be read, or
    // who is signed in and could not be identified, gets another attempt here.
    // That is what makes focus, `online` and the retry button work when the
    // subscription never opened at all.
    if (!state.principal) {
      if (state.session !== "none") await load();
      return;
    }
    let failure = null;
    if (!dataLoaded) {
      // The first load never finished: read everything it reads.
      try {
        await loadData();
      } catch (error) {
        failure = error;
      }
    } else {
      try {
        await loadList();
      } catch (error) {
        failure = error;
      }
      try {
        // The office board shows these beside the cases, and a reconnect is the
        // one path a missed subscription change comes back through.
        await loadAssistance();
      } catch (error) {
        failure = failure ?? error;
      }
    }
    try {
      await loadSelected();
    } catch (error) {
      // A case that is gone is not a failure to report: it was closed
      // and removed. Fall back to the list.
      if (error?.code === "NOT_FOUND") forgetGoneCase();
      else failure = failure ?? error;
    }
    // A refusal the person has been shown is theirs to dismiss or to act on.
    // Re-reading is not an answer to it: an unrelated change landing in
    // this window must not quietly replace "the demo cannot reach the server"
    // with nothing, leaving a click that did nothing and no explanation. The
    // next deliberate action clears it (every dispatch, save, navigation and
    // the dismiss control do), and so does a successful identity load.
    if (failure) {
      noteFailure(failure);
      noteUnloaded();
    }
    persistSession();
    show();
    // Also what the reconnect, the focus and the online event come through: a
    // held offline start is sent again here, unchanged.
    void startScreeningIfDue();
  }

  function clearSelection() {
    opening += 1;
    state.selectedCaseId = null;
    state.savedCase = null;
    state.draftAnswers = {};
    state.editBaseRevision = null;
    state.dirty = false;
    state.conflict = null;
    state.saveState = "idle";
    stateBeforeEdit = "idle";
    answersInDoubt = false;
    landedRevision = null;
    state.formSubstep = null;
    state.visitedSubsteps = [];
    state.returnToSummary = false;
    state.revealed = [];
    state.officeDraft = false;
    // Open panels are per case: a confirmation ticked on one application, or a
    // simulated upload failure on one request, means nothing on another.
    state.openPanels = [];
    pendingAction = null;
    screeningStart = null;
    state.retryable = false;
    // A held upload read is the old case's: never saved to another.
    state.shadedReview = null;
  }

  // ---- start / stop ------------------------------------------------------

  const onWake = () => refresh();

  function listen() {
    if (listening) return;
    listening = true;
    windowEvents?.addEventListener?.("focus", onWake);
    windowEvents?.addEventListener?.("online", onWake);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    windowEvents?.removeEventListener?.("focus", onWake);
    windowEvents?.removeEventListener?.("online", onWake);
  }

  function subscribe() {
    if (releaseStore || inert()) return;
    releaseStore = store.subscribe({
      onChange: (change) => handleChange(change),
      onConnection: (status) => {
        const previous = state.connection;
        state.connection = status;
        show();
        // Reconnecting means the browser may have missed changes entirely.
        if (status === "online" && previous !== "online" && previous !== "unknown")
          refresh();
      },
    });
  }

  function unsubscribe() {
    const release = releaseStore;
    releaseStore = null;
    release?.();
  }

  // A change carries identifiers only, so the reaction is a targeted re-read
  // through the same access-scoped path — never the payload itself.
  async function handleChange(change) {
    if (!state.principal || !change) return;
    // A workspace change names no case and carries nothing private, so
    // everything this window holds may have changed: all of it is re-read
    // through the same access-scoped paths.
    const touchesWorkspace = change.table === "workspaces";
    const touchesList = touchesWorkspace || change.table === "cases";
    const touchesOpen =
      Boolean(state.selectedCaseId) &&
      (touchesWorkspace || change.caseId === state.selectedCaseId);
    // An assistance item belongs to no case, so it is named by its own table
    // rather than by a case id: a claim in another window has to reach this one.
    const touchesAssistance =
      touchesWorkspace || change.table === "assistance_items";
    if (!touchesList && !touchesOpen && !touchesAssistance) return;
    try {
      if (touchesList) await loadList();
      if (touchesWorkspace) await loadWorkspace();
      if (touchesAssistance) await loadAssistance();
      // The open case comes last, because it is the one read that may
      // legitimately find nothing: a case that is gone must not stop the
      // lists around it from being refreshed.
      if (touchesOpen) await loadSelected();
      // Deliberately not `state.error = null`: this ran because somebody
      // else's window did something, and a notice nobody in *this* window has
      // read is not theirs to erase. See the note in `refresh`.
    } catch (error) {
      if (error?.code !== "NOT_FOUND") noteFailure(error);
      else forgetGoneCase();
    }
    show();
  }

  // Everything the first load reads (design D6): the cases, and for a staff
  // window the people, the help requests and the workspace.
  // `dataLoaded` is true once one whole pass has succeeded; until then a
  // refresh reads everything, not only the lists.
  let dataLoaded = false;
  async function loadData() {
    if (inert()) return;
    await loadList();
    if (staffWindow()) {
      state.people = await store.listPeople();
      await loadAssistance();
      await loadWorkspace();
    } else {
      state.lists.assistance = "ready";
    }
    dataLoaded = true;
  }

  // A list that never loaded and whose read failed says so; one that loaded
  // once keeps what it shows. Try again reads everything again.
  function noteUnloaded() {
    let failed = false;
    for (const key of ["cases", "assistance"])
      if (state.lists[key] !== "ready") {
        state.lists[key] = "failed";
        failed = true;
      }
    // A first load can fail after both lists are read (the workspace, say):
    // Try again still reads the rest.
    if (failed || !dataLoaded)
      setLocalRetry(async () => {
        try {
          await loadData();
        } catch (error) {
          noteFailure(error);
          noteUnloaded();
        }
        show();
      });
  }

  // Identity first, and only then the subscription: a refused or unreachable
  // principal must never open a channel, and staff reads happen only when the
  // principal says staff.
  async function load() {
    let session;
    try {
      session = await auth.getSession();
    } catch (error) {
      // Whether this visitor is signed in is simply not known, so the sign-in
      // form would be a guess. The screen says so and offers another attempt,
      // and focus/online events keep trying on their own.
      state.session = "unknown";
      state.principal = null;
      noteFailure(error);
      show();
      return;
    }
    if (!session) {
      state.session = "none";
      state.principal = null;
      state.screen = "access";
      const record = accessRecord();
      if (record.email) {
        state.authStep = "code";
        state.authEmail = record.email;
        state.authMessage = record.message ?? "";
      }
      show();
      return;
    }
    state.session = "present";
    let principal;
    try {
      principal = await store.getPrincipal();
    } catch (error) {
      // There is a session, so this is never the sign-in form: either this
      // account is not on the roster (FORBIDDEN) or the server is unreachable.
      state.principal = null;
      noteFailure(error);
      show();
      return;
    }
    state.principal = principal;
    state.authError = null;
    windowState.clearAccess();
    // A presenter account is no longer used: one plain screen, nothing read,
    // no channel opened and no place saved for this window.
    if (inert()) {
      state.screen = "presenter";
      state.error = null;
      show();
      return;
    }
    restoreSession();
    // A staff window lands on the work board and a client on their applications,
    // unless this window was already somewhere this principal may be.
    if (!screens().includes(state.screen)) state.screen = homeScreen();
    try {
      await loadData();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    subscribe();
    if (state.selectedCaseId) {
      try {
        await loadSelected();
      } catch (error) {
        if (error?.code === "NOT_FOUND") forgetGoneCase();
        else noteFailure(error);
      }
    }
    // After the open case: its own failure drops the local retry, so the
    // lists' Try again is set last.
    noteUnloaded();
    persistSession();
    show();
    // A reload on a case page: the people are in.
    void startScreeningIfDue();
  }

  async function start() {
    if (started) return;
    started = true;
    listen();
    releaseAuth = auth.subscribe?.(({ event }) => {
      // Another window signing out must not leave this one holding records.
      if (event === "SIGNED_OUT" && state.principal) forgetUser();
    });
    await load();
  }

  function stop() {
    started = false;
    unsubscribe();
    const releaseAuthListener = releaseAuth;
    releaseAuth = null;
    releaseAuthListener?.();
    unlisten();
  }

  // ---- sign-in -----------------------------------------------------------

  async function sendCode(email) {
    const address = String(email ?? "").trim();
    state.authError = null;
    const remaining = cooldownRemaining();
    if (remaining > 0) {
      // Inside the window nothing leaves at all, and the answer is the same
      // sentence as a real send: a cooldown must not become a second channel
      // for telling two addresses apart. The cooldown runs against the window,
      // not against an address, so the address entered now is the one bound and
      // shown — a corrected typo must never stay tied to the typo.
      const record = accessRecord();
      state.authStep = "code";
      state.authEmail = address;
      const answer = {
        state: "code_entry",
        message: record.message ?? state.authMessage,
        retryAfterSeconds: remaining,
      };
      state.authMessage = answer.message;
      windowState.writeAccess({
        startedAt: record.startedAt,
        email: address,
        message: answer.message,
      });
      show();
      return answer;
    }
    try {
      const answer = await auth.sendCode(address);
      state.authStep = "code";
      state.authEmail = address;
      state.authMessage = answer.message;
      windowState.writeAccess({
        startedAt: clock(),
        email: address,
        message: answer.message,
      });
      show();
      return answer;
    } catch (error) {
      state.authError = {
        code: error?.code ?? "AUTH_ERROR",
        message: error?.message ?? "Sign-in could not be completed.",
      };
      if (error?.code === "OFFLINE") state.connection = "offline";
      show();
      throw error;
    }
  }

  // What the visitor is typing, kept without a re-render: the field already
  // shows it, and rebuilding the page under the cursor is the defect this
  // exists to prevent. The address gets the same treatment — a connection
  // notice arriving mid-typing would otherwise empty that field too.
  function editAuthCode(value) {
    state.authCode = String(value ?? "");
  }

  function editAuthEmail(value) {
    state.authEmail = String(value ?? "");
  }

  // The argument wins when given — it is what the field actually showed at
  // submit time — and is stored, so the state and what was sent always agree.
  // Called with nothing, the stored value is used.
  async function verifyCode(code) {
    if (code !== undefined && code !== null) editAuthCode(code);
    state.authError = null;
    show();
    try {
      await auth.verifyCode(state.authEmail, state.authCode);
    } catch (error) {
      state.authError = {
        code: error?.code ?? "AUTH_ERROR",
        message: error?.message ?? "Sign-in could not be completed.",
      };
      if (error?.code === "OFFLINE") state.connection = "offline";
      show();
      throw error;
    }
    windowState.clearAccess();
    state.authStep = "email";
    state.authCode = "";
    // Which screen this visitor lands on is `load()`'s to decide: it knows the
    // principal, and this window may already have been somewhere.
    await load();
  }

  // "Use a different email address". The cooldown is the window's and survives
  // (R38 — a reload or a restart cannot buy another send), but the address it
  // was bound to does not: the next send binds whatever is typed then.
  function restartSignIn() {
    const record = accessRecord();
    state.authStep = "email";
    state.authEmail = "";
    state.authCode = "";
    state.authError = null;
    state.authMessage = "";
    if (record.startedAt === undefined) windowState.clearAccess();
    else
      windowState.writeAccess({
        startedAt: record.startedAt,
        message: record.message,
      });
    show();
  }

  // Signing out drops every record this window holds, not just the session.
  function forgetUser() {
    dropLocalRetry();
    if (state.principal) windowState.clear(state.principal.userId);
    unsubscribe();
    clearSelection();
    state.session = "none";
    state.principal = null;
    state.cases = [];
    state.lists = { cases: "loading", assistance: "loading" };
    dataLoaded = false;
    state.people = [];
    state.assistance = [];
    state.workspace = null;
    state.openPanels = [];
    state.lookup = "";
    state.dialog = null;
    state.dialogContext = null;
    state.pendingCreateActionId = null;
    state.officeDraftCaseId = null;
    state.openAddSubsteps = ["before.ready"];
    state.addCaseShowMissing = false;
    state.boardFilters = {};
    state.caseTab = "overview";
    state.boardSearchDraft = undefined;
    state.sidebarOpen = true;
    state.shadedStatus = null;
    state.shadedReview = null;
    state.error = null;
    state.authStep = "email";
    state.authEmail = "";
    state.authCode = "";
    state.authMessage = "";
    state.authError = null;
    state.screen = "access";
    // Signing out replaces the whole page with the sign-in screen.
    show(true);
  }

  async function signOut() {
    try {
      await auth.signOut?.();
    } finally {
      forgetUser();
    }
  }

  // ---- navigation (window-local) -----------------------------------------

  function navigate(screen) {
    // A new office draft belongs to the Add a case page: leaving drops it.
    if (screen !== "office-add-case") {
      state.officeDraft = false;
      state.officeDraftCaseId = null;
      state.addCaseShowMissing = false;
    }
    state.screen = screen;
    state.error = null;
    state.dialog = null;
    state.dialogContext = null;
    persistSession();
    show(true);
  }

  function togglePanel(name) {
    state.openPanels = state.openPanels.includes(name)
      ? state.openPanels.filter((entry) => entry !== name)
      : [...state.openPanels, name];
    persistSession();
    show();
  }

  function setLookup(value) {
    state.lookup = String(value ?? "");
  }

  function openDialog(name, context = null) {
    state.dialog = name;
    state.dialogContext = context ? { ...context } : null;
    show();
  }

  function closeDialog() {
    state.dialog = null;
    state.dialogContext = null;
    show();
  }

  function dismissError() {
    dropLocalRetry();
    state.error = null;
    show();
  }

  // Clears the error only when it is this code's: a draft that was built
  // ends the draft's own problem, never another error.
  function clearError(code) {
    if (state.error?.code !== code) return;
    dropLocalRetry();
    state.error = null;
    show();
  }

  // The work board's filters, one choice at a time. They are this window's
  // view of the same list everybody else sees, so they are stored beside the
  // selection rather than sent anywhere.
  function setBoardFilter(name, value) {
    if (!name) return;
    const next = { ...state.boardFilters, [name]: String(value ?? "") };
    // A tab is what the person asked to see, so choosing one ends a search.
    if (name === "status") delete next.search;
    state.boardFilters = next;
    // Whatever was half-typed is now either sent (a search submit) or
    // superseded (any other filter, including "Clear search"), so the box
    // goes back to showing the saved search.
    state.boardSearchDraft = undefined;
    persistSession();
    show();
  }

  // With a list of names, only those filters go (the office pool clears its
  // own without touching the volunteer board's); with none, every filter does.
  function clearBoardFilters(keys) {
    if (Array.isArray(keys)) {
      const next = { ...state.boardFilters };
      for (const key of keys) delete next[key];
      state.boardFilters = next;
    } else {
      state.boardFilters = {};
      state.boardSearchDraft = undefined;
    }
    persistSession();
    show();
  }

  // The board search box's in-progress text, updated on every keystroke. Like
  // `setLookup`, this does not re-render by itself — the box already shows
  // what was typed — it only makes sure a render triggered by something else
  // does not blank it.
  function setBoardSearchDraft(value) {
    state.boardSearchDraft = String(value ?? "");
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    persistSession();
    show();
  }

  // ---- the language (spec 2026-10-05 §2) -------------------------------

  // The client's own choice: saved for this browser, then drawn. An unknown
  // language throws and changes nothing.
  function setLanguage(lang) {
    writeLanguage(lang, { storage: localStorage });
    state.lang = lang;
    show();
  }

  // A language chosen elsewhere (another tab), or startup's fallback when the
  // Traditional map can't load: set, never written, so the saved choice stays.
  function adoptLanguage(lang, { draw = true } = {}) {
    if (!isLang(lang)) throw new Error(`Unknown language: ${lang}`);
    state.lang = lang;
    if (draw) show();
  }

  function setCaseTab(value) {
    state.caseTab = String(value || "overview");
    persistSession();
    show();
  }

  // ---- cases -------------------------------------------------------------

  async function selectCase(id, { navigate: move = true } = {}) {
    // Another case opens on its Overview; the same case keeps its tab, which is
    // what a reload restores.
    if (state.selectedCaseId !== id) state.caseTab = "overview";
    if (state.savedCase?.id !== id) clearSelection();
    state.selectedCaseId = id;
    persistSession();
    try {
      const next = await store.getCase(id);
      applyCase(next);
      noteConnected();
      state.error = null;
      if (move)
        state.screen =
          staffWindow()
            ? "staff-case"
            : next.stage === "draft"
              ? "intake"
              : "progress";
    } catch (error) {
      if (error?.code === "NOT_FOUND") forgetGoneCase();
      noteFailure(error);
      persistSession();
      show();
      throw error;
    }
    persistSession();
    // Opening a case is a screen change; reading the same case again in place
    // (`navigate: false`, which is how a board control gets its case) is not.
    show(move);
    void startScreeningIfDue();
  }

  // Screening starts when an admin first opens a Request sent case's page
  // (design D4). An open is not a press: nothing is disabled, and no refusal is
  // shown. A race ("another admin got there first", a stale revision) is
  // answered by re-reading the case. Any other refusal gives up on this case in
  // this window. An offline start is held whole and resent unchanged, as
  // dispatch's pendingAction is, so its receipt answers the replay. The store
  // turns VT003 into CONFLICT and VT004 into INVALID_TRANSITION (contracts.mjs).
  const SCREENING_RACES = Object.freeze(["INVALID_TRANSITION", "CONFLICT"]);

  function actingAdmin() {
    if (!staffWindow()) return false;
    const own = state.principal.personId ?? null;
    const person = (state.people ?? []).find((entry) => entry?.id === own);
    return Array.isArray(person?.capabilities) && person.capabilities.includes("admin");
  }

  async function startScreeningIfDue({ afterRace = false } = {}) {
    const record = state.savedCase;
    if (!record || record.stage !== "received" || state.screen !== "staff-case" || !actingAdmin()) return;
    if (state.busy || pendingAction) return;
    if (screeningStart?.action.caseId !== record.id)
      screeningStart = {
        action: {
          actionId: newActionId(),
          caseId: record.id,
          expectedRevision: Number(record.revision),
          personId: null,
          type: "START_SCREENING",
          payload: {},
        },
        inFlight: false,
        gaveUp: false,
      };
    if (screeningStart.inFlight || screeningStart.gaveUp) return;
    const held = screeningStart;
    held.inFlight = true;
    const run = sendScreeningStart(held, afterRace);
    // A case action pressed meanwhile waits for this (`runAction`), so it pins
    // the revision the start leaves behind.
    const flight = { caseId: held.action.caseId, promise: run };
    screeningInFlight = flight;
    try {
      await run;
    } finally {
      if (screeningInFlight === flight) screeningInFlight = null;
    }
  }

  async function sendScreeningStart(held, afterRace) {
    let raced = false;
    try {
      await store.act(held.action);
      noteConnected();
      if (screeningStart === held) screeningStart = null;
    } catch (error) {
      held.inFlight = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) {
        // Held whole for the next refresh; nothing is shown for it.
        if (error?.code === "OFFLINE") state.connection = "offline";
        show();
        return;
      }
      if (SCREENING_RACES.includes(error?.code)) {
        raced = true;
        if (screeningStart === held) screeningStart = null;
      } else held.gaveUp = true;
    }
    try {
      await loadSelected();
    } catch {
      /* the next refresh reads it */
    }
    show();
    // The case changed but is still at Request sent: try once more at the new
    // revision. A second race in a row waits for the next open or refresh.
    if (raced && !afterRace && state.savedCase?.stage === "received")
      await startScreeningIfDue({ afterRace: true });
  }

  // Explicit and idempotent: the pending action id lives in window state until
  // its receipt arrives, so an offline retry reuses it and a second click while
  // one is in flight does nothing at all. Reopening, refreshing or filling a
  // form never reaches this function.
  //
  // `mode` and `personId` are what distinguish a client's own application from
  // one the office typed in for a walk-in; the idempotency, the receipt and the
  // "what happens next" hook are the same for both, so they are written once.
  // `select: false` (the office's new draft) only creates: the caller reads
  // and adopts the case itself.
  async function startCase({ mode, personId, answers }, afterReceipt, { select = true } = {}) {
    if (creating) return null;
    creating = true;
    if (!state.pendingCreateActionId) {
      state.pendingCreateActionId = newActionId();
      persistSession();
    }
    const request = {
      actionId: state.pendingCreateActionId,
      mode,
      personId: personId ?? null,
      answers,
    };
    // Who asked: a sign-out (or another sign-in) while the create is out
    // replaces both, and that window must not read or select anything for it.
    const { session, principal } = state;
    try {
      const receipt = await store.createCase(request);
      // The case exists, but this window has signed out since: nothing more.
      if (state.session !== session || state.principal !== principal) return receipt;
      // The receipt is the point of no return: the case exists, so the pending
      // id is spent and a later read failure cannot make it look unstarted.
      state.pendingCreateActionId = null;
      state.error = null;
      noteConnected();
      persistSession();
      try {
        await loadList();
        if (select) {
          await selectCase(receipt.caseId);
          afterReceipt?.();
        }
      } catch (error) {
        noteFailure(error);
      }
      persistSession();
      show();
      return receipt;
    } catch (error) {
      noteFailure(error);
      // The id stays in window state: the retry has to be the same request.
      persistSession();
      show();
      throw error;
    } finally {
      creating = false;
    }
  }

  async function createCase() {
    return await startCase({ mode: "client", personId: null, answers: {} }, () => {
      state.screen = "reference";
    });
  }

  // ---- Add a case (spec 2026-10-04 §10) ------------------------------------
  //
  // The office takes in a walk-in client on a draft that has no case
  // yet (`officeDraft`). Its first Save draft or Send creates an empty case,
  // adopts it in place (the page and what was typed stay), then saves; Send
  // then submits. A failure after the create keeps the case selected, so the
  // next press saves to it: one draft never makes a second case.

  // Add a case. With `caseId`, an office draft already saved opens on the
  // page. Without, a new office draft starts. Before the workspace row has
  // loaded, the draft starts when it arrives (`enterOfficeDraftIfNeeded`).
  async function openAddCase({ caseId = null } = {}) {
    requireStaffWindow("Only a volunteer can start an assisted application.");
    if (caseId) {
      await selectCase(caseId, { navigate: false });
      state.officeDraft = false;
      state.openAddSubsteps = ["before.ready"];
    } else if (state.workspace) {
      startOfficeDraft();
    } else {
      // No workspace yet (the draft starts when it arrives): a kept selection
      // would be shown as a new walk-in's.
      clearSelection();
      state.officeDraftCaseId = null;
    }
    navigate("office-add-case");
  }

  function startOfficeDraft() {
    clearSelection();
    officeDraftToken += 1;
    state.officeDraft = true;
    state.officeDraftCaseId = null;
    state.openAddSubsteps = ["before.ready"];
    state.addCaseShowMissing = false;
  }

  // On every workspace read: Add a case with no case and no draft starts its
  // draft (a reload, or a press before the row arrived). Never while a draft
  // is open: a workspace change must not wipe what the office is typing.
  function enterOfficeDraftIfNeeded() {
    if (state.screen !== "office-add-case" || state.selectedCaseId || state.officeDraft) return;
    if (!state.workspace) return;
    startOfficeDraft();
    persistSession();
  }

  // An Add a case part opens or closes; opening one closes none.
  function toggleAddSubstep(id) {
    if (typeof id !== "string" || !id) return;
    state.openAddSubsteps = state.openAddSubsteps.includes(id)
      ? state.openAddSubsteps.filter((entry) => entry !== id)
      : [...state.openAddSubsteps, id];
    show();
  }

  // Save draft (`send: false`) and Send to the office (`send: true`).
  // Returns, or throws:
  //   * `{ sent: true }`: Send only. Saved and submitted; the office is on the
  //     case page.
  //   * `{ sent: false }` (no reason): Save draft only. The press ran to the
  //     end: the case exists and any unsaved edit was saved. Typing that
  //     landed during the save stays dirty for the next press, so a caller
  //     that says "saved" also checks `dirty` and `saveState`.
  //   * `{ sent: false, reason: "busy" }`: another save or create is in
  //     flight. Nothing was done by this press.
  //   * `{ sent: false, reason: "unconfirmed" }`: Send only. The box isn't
  //     ticked; nothing at all was done.
  //   * `{ sent: false, reason: "answers" }`: Send only. Saved, but something
  //     is missing or invalid: nothing was submitted and the page marks it.
  //   * `{ sent: false, reason: "left" }`: the office left the draft, or
  //     opened another case (or this one again), while it was out. Nothing
  //     more was done.
  //   * thrown: a failure (offline, refused, a conflict), with its error
  //     already on screen. Nothing more was done.
  async function saveOfficeDraft({ send = false } = {}) {
    if (state.officeSaving || substepSaveInFlight) return { sent: false, reason: "busy" };
    if (send && !state.openPanels.includes("confirmed")) return { sent: false, reason: "unconfirmed" };
    if (!state.savedCase && !state.officeDraft)
      throw refuse("NOT_FOUND", "Open an application first.");
    // The flag is the one sub-step changes and card marks hold, so a mark
    // can't race the save.
    state.officeSaving = true;
    takeFlag();
    show();
    try {
      if (!state.savedCase) {
        const adopted = await adoptOfficeCase();
        if (adopted !== true) return { sent: false, reason: adopted };
      }
      const from = opening;
      if (state.dirty) await saveNow();
      if (!send) return { sent: false };
      if (opening !== from || state.screen !== "office-add-case")
        return { sent: false, reason: "left" };
      return await sendOfficeDraft();
    } finally {
      state.officeSaving = false;
      dropFlag();
      show();
    }
  }

  // The new draft's case: created once (an earlier create that landed is used
  // again), read, and adopted in one step. True once adopted; "busy" while
  // another create is in flight; "left" when the draft it was started for is
  // gone after an await (left, another case opened, signed out, or a fresh
  // draft started): the created case then stays, unselected.
  async function adoptOfficeCase() {
    const token = officeDraftToken;
    const stillHere = () =>
      state.officeDraft &&
      officeDraftToken === token &&
      state.screen === "office-add-case" &&
      !state.selectedCaseId;
    if (!state.officeDraftCaseId) {
      const receipt = await startCase(
        { mode: "assisted", personId: null, answers: {} },
        null,
        { select: false },
      );
      if (!receipt) return "busy";
      if (!stillHere()) return "left";
      state.officeDraftCaseId = receipt.caseId;
    }
    let record;
    try {
      record = await store.getCase(state.officeDraftCaseId);
      noteConnected();
    } catch (error) {
      if (!stillHere()) return "left";
      noteFailure(error);
      show();
      throw error;
    }
    if (!stillHere()) return "left";
    // No await from here: nothing can land between the selection and the
    // draft, and nothing on the page resets.
    state.selectedCaseId = record.id;
    state.savedCase = record;
    state.caseTab = "overview";
    state.officeDraft = false;
    state.officeDraftCaseId = null;
    commitDraft(mergeIntoDraft(serverAnswersOf(record), state.draftAnswers));
    // Typed before the case existed, the draft was never pinned: pin it now,
    // so a refresh before the save raises a choice instead of rebuilding it.
    if (state.dirty && state.editBaseRevision === null)
      state.editBaseRevision = Number(record.revision);
    persistSession();
    return true;
  }

  // Send, checked again from the draft (nothing missing or invalid is ever
  // sent). Refused: every invalid answer is revealed, missing ones are marked,
  // and every part holding one opens. Sent: the office lands on the case page.
  async function sendOfficeDraft() {
    const draft = state.draftAnswers;
    const missing = missingToSubmit(2, draft);
    const invalid = invalidAnswers(null, draft);
    if (missing.length || invalid.length) {
      for (const id of invalid) revealInvalid(id);
      state.addCaseShowMissing = true;
      const parts = new Set(state.openAddSubsteps);
      for (const id of [...missing, ...invalid]) {
        const part = substepOfQuestion(id.replace(/\[.*$/, ""));
        if (part) parts.add(part);
      }
      state.openAddSubsteps = [...parts];
      show();
      return { sent: false, reason: "answers" };
    }
    await runAction("SUBMIT", { confirmed: true });
    state.addCaseShowMissing = false;
    try {
      await selectCase(state.selectedCaseId);
    } catch {
      // The send landed; the failed read is on screen.
    }
    return { sent: true };
  }

  // ---- editing and saving -------------------------------------------------

  // A retained save envelope carries the answers it was built from. It is only
  // meaningful while those answers are still the draft: re-sending it after a
  // further edit would commit the older text at its older expected revision
  // and then be refreshed over, losing the newer typing without any error.
  //
  // It is compared with what the draft would send now: `withholdInvalid(draft)`,
  // so a withheld field or a change of spaces only leaves it current, and the
  // visited set it would carry. A retry that left a refused field out (`omit`)
  // is compared without that field.
  const staleSave = () => {
    if (!pendingAction?.save) return false;
    const sending = savePayload();
    if (pendingAction.omit) delete sending.answers[pendingAction.omit];
    const sent = pendingAction.action.payload ?? {};
    return (
      JSON.stringify(sent.answers ?? {}) !== JSON.stringify(sending.answers) ||
      JSON.stringify(sent.visited ?? null) !== JSON.stringify(sending.visited ?? null)
    );
  };

  // A form is open: a case, or a new office draft before it has one.
  const formOpen = () => state.officeDraft || Boolean(state.savedCase);

  // A client answers for themselves.
  const actingAsClient = () => state.principal?.access === "applicant";

  // The visited sub-steps a save sends: only ids the catalogue knows, so a
  // stale stored id can never block every save (spec 2026-10-04 §3.7).
  const knownVisited = () => {
    const seen = new Set(state.visitedSubsteps);
    return SUBSTEP_IDS.filter((id) => seen.has(id));
  };

  // Visits count only on the client's own draft: staff never send
  // them, and the server refuses SAVE_ANSWERS on any other stage, so a
  // submitted case is never dirty because of a visit.
  function visitsPending() {
    const record = state.savedCase;
    if (!record || record.stage !== "draft" || !actingAsClient()) return false;
    const stored = new Set(record.intakeVisited ?? []);
    return knownVisited().some((id) => !stored.has(id));
  }

  // What a save would send now: `{ answers }`, and for the client's own
  // draft the visited set when there is one.
  function savePayload() {
    const payload = { answers: { ...withholdInvalid(state.draftAnswers, 2) } };
    if (actingAsClient()) {
      const visited = knownVisited();
      if (visited.length) payload.visited = visited;
    }
    return payload;
  }

  // The save state once nothing is left to save: the settled state an edit
  // replaced. "failed" is not settled, and nothing is in doubt any more.
  const settledState = () => (stateBeforeEdit === "failed" ? "idle" : stateBeforeEdit);

  function forgetPendingSave() {
    if (!pendingAction?.save) return;
    pendingAction = null;
    state.retryable = false;
  }

  function editAnswers(patch) {
    if (!formOpen()) return;
    const clean = pickAnswers(patch);
    // Keys, not values: a patch of nulls is a real edit (it clears).
    if (!Object.keys(clean).length) return;
    let draft = mergeIntoDraft(state.draftAnswers, clean);
    // The spouse leaves the who answers once a joint return stops being
    // possible (change add-widowed-spouse-rules, brainstorm I10): when the
    // marital status changes, or on a whole, valid death year. A move re-sends
    // the page's answers, an unchanged marital status included, so only a
    // changed one counts; a year half typed or cleared keeps them, so retyping
    // 2025 never loses "My spouse".
    const statusChanged =
      Object.hasOwn(clean, "marital_status") && clean.marital_status !== (state.draftAnswers ?? {}).marital_status;
    // The year as the save sends it (trimmed), so "2020 " counts like "2020".
    const yearQuestion = findQuestion(2, "spouse_death_year");
    const yearSent = Object.hasOwn(clean, "spouse_death_year") ? sendable(yearQuestion, clean.spouse_death_year) : null;
    const yearDone = isAnswered(yearSent) && checkValue(yearQuestion, yearSent) === null;
    if ((statusChanged || yearDone) && !spouseShown(draft)) draft = clearSpouse(draft);
    // Form 14446's dates fill themselves (openspec change add-form-14446-consent,
    // design D4): a signature typed into an empty box sets its empty date to
    // today, in the browser's own calendar. The date stays editable; 15080's
    // dates are not filled.
    const before = state.draftAnswers ?? {};
    for (const [signature, date] of [["vc_tp_signature", "vc_tp_date"], ["vc_sp_signature", "vc_sp_date"]]) {
      if (!Object.hasOwn(clean, signature) || isAnswered(before[signature])) continue;
      if (!isAnswered(sendable(findQuestion(2, signature), clean[signature])) || isAnswered(draft[date])) continue;
      const day = new Date(clock());
      const pad = (n) => String(n).padStart(2, "0");
      draft = { ...draft, [date]: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}` };
    }
    commitDraft(draft);
  }

  // A version-2 draft change (spec §2.5). `dirty` means a save would change
  // the server, recomputed over the whole draft: an answer that differs, or a
  // visit the server lacks (spec 2026-10-04 §3.7):
  //   * it turns true: the revision is pinned and the chip goes Unsaved,
  //     remembering the state it replaced;
  //   * it turns false only from Unsaved (an undo): the pin is cleared and the
  //     chip goes back. After a failed save it stays true until a save
  //     succeeds, because that save may have landed. So does an undo of an
  //     edit made after a failed save: the server may hold what was undone, so
  //     the chip goes back to Not saved and the next save sends the undone
  //     values (spec 2026-10-04 §9.3).
  // The retained envelope is dropped only when what would be sent changed.
  // Every household member gets an id here (`withMemberIds`).
  function commitDraft(draft) {
    state.draftAnswers = withMemberIds(draft, state.draftAnswers);
    const revealedChanged = pruneRevealed();
    const differs =
      sendableDiffers(state.draftAnswers, serverAnswersOf(state.savedCase), 2) || visitsPending();
    if (differs && !state.dirty) {
      markDirty();
    } else if (!differs && state.dirty && state.saveState === "unsaved") {
      if (stateBeforeEdit === "failed") {
        // Dirty and pinned still; the envelope holds the undone edit.
        state.saveState = "failed";
        forgetPendingSave();
      } else {
        state.dirty = false;
        state.editBaseRevision = null;
        state.saveState = stateBeforeEdit;
        // Nothing left to choose between: the draft sends what the server has.
        state.conflict = null;
      }
    }
    state.error = null;
    if (staleSave()) forgetPendingSave();
    if (revealedChanged) persistSession();
    show();
  }

  // A version-2 draft turns dirty: the base revision is pinned and the chip
  // goes Unsaved.
  function markDirty() {
    if (state.editBaseRevision === null && state.savedCase)
      state.editBaseRevision = pinRevision();
    markUnsaved();
    state.dirty = true;
  }

  // The open version-2 case's revision as this window last knew it: the
  // snapshot's, or the one its last save's receipt named when the re-read
  // after that save failed.
  function pinRevision() {
    const revision = Number(state.savedCase.revision);
    return landedRevision?.opening === opening
      ? Math.max(revision, landedRevision.revision)
      : revision;
  }

  // Unsaved, remembering what it replaced when that was a settled state, or a
  // failed save (whose outcome is unknown, so an undo goes back to it).
  function markUnsaved() {
    if (state.saveState === "idle" || state.saveState === "saved" || state.saveState === "failed")
      stateBeforeEdit = state.saveState;
    state.saveState = "unsaved";
  }

  // An id whose error has been shown (on `change`). Only an invalid value is
  // added; the page updates the note itself, so nothing is redrawn here.
  function revealInvalid(id) {
    if (!formOpen() || typeof id !== "string") return;
    if (state.revealed.includes(id) || !holdsInvalid(id, state.draftAnswers)) return;
    state.revealed = [...state.revealed, id];
    persistSession();
  }

  // The Submit guard (spec 2026-09-30 §2.5: nothing missing or invalid is
  // ever submitted). Submit's disabled state is drawn at render, and a press
  // can land on a page drawn before the draft changed (a refresh held back
  // while the pointer was down), so the press checks the draft again, with
  // the review gate's own list (reviewAlerts). With an alert it reveals every
  // invalid answer and goes to review.check, whose list says what to fix, and
  // returns false: don't submit.
  async function guardSubmit() {
    const draft = state.draftAnswers ?? {};
    if (reviewAlerts(draft).length === 0) return true;
    for (const id of invalidAnswers(null, draft)) revealInvalid(id);
    await goToSubstep("review.check");
    return false;
  }

  // Where the version-2 form is now: the saved place resolved against the
  // draft (a hidden sub-step goes to the next visible one, an unknown id to
  // the first, spec 2026-10-04 §3.1). Null with no case.
  function currentSubstep() {
    if (!state.savedCase) return null;
    return resolveSubstep(state.formSubstep, state.draftAnswers, cardsNow(), state.visitedSubsteps);
  }

  // The form's sub-step change (Continue, Back, a rail jump, a link). The
  // sub-step being left reveals its invalid answers and becomes visited, a
  // dirty draft is saved (a new visit alone makes it dirty, so the visit is
  // sent), and the form moves on even when that save fails: the chip and the
  // banner say so, and the draft is still here. Any move clears the return to
  // the summary unless `keepReturn`.
  async function goToSubstep(id, { keepReturn = false } = {}) {
    if (!formOpen()) return;
    // One change at a time: a second press during the first one's save would
    // send the same expected revision and meet a false conflict.
    if (substepSaveInFlight) return;
    const leaving = currentSubstep();
    if (leaving) {
      const fresh = invalidAnswers(leaving, state.draftAnswers).filter(
        (answer) => !state.revealed.includes(answer),
      );
      if (fresh.length) state.revealed = [...state.revealed, ...fresh];
      if (findSubstep(leaving) && !state.visitedSubsteps.includes(leaving)) {
        state.visitedSubsteps = orderVisited([...state.visitedSubsteps, leaving]);
        if (!state.dirty && visitsPending()) markDirty();
      }
    }
    persistSession();
    if (state.dirty) {
      const from = opening;
      takeFlag();
      try {
        await saveNow({ quiet: true });
      } catch {
        // Already on screen: the save state is "failed" and the error is set.
      } finally {
        dropFlag();
      }
      // Another case was opened during the save, or this one left and opened
      // again: this move belongs to the old opening.
      if (opening !== from) return;
    }
    state.formSubstep = resolveSubstep(id, state.draftAnswers, cardsNow(), state.visitedSubsteps);
    if (!keepReturn) state.returnToSummary = false;
    persistSession();
    show();
  }

  // Continue (+1) and Back (-1): the adjacent visible sub-step. Nothing at
  // either end, not even a visit. Continue on the summary is what earns the
  // Submit page (openspec change gate-review-and-redesign-summary, design D3):
  // its visit is added first, so the move finds 9.3 and the save sends it. The
  // move starts from where the form is shown (the resolved place), which is not
  // always the stored one: a stored review.submit without its visit shows 9.2.
  async function moveSubstep(delta) {
    if (!formOpen() || substepSaveInFlight) return;
    const from = currentSubstep();
    if (delta > 0 && from === "review.summary" && !state.visitedSubsteps.includes("review.submit")) {
      state.visitedSubsteps = orderVisited([...state.visitedSubsteps, "review.submit"]);
      if (!state.dirty && visitsPending()) markDirty();
    }
    const target = adjacentSubstep(from, state.draftAnswers, cardsNow(), delta, state.visitedSubsteps);
    if (!target) return;
    await goToSubstep(target);
  }

  // The summary's Change link: the sub-step opens with a return set, so its
  // primary button reads "Back to summary" (spec 2026-10-04 §5.2).
  async function openForChange(id) {
    if (!formOpen() || substepSaveInFlight) return;
    state.returnToSummary = true;
    await goToSubstep(id, { keepReturn: true });
  }

  // "Back to summary": saves and returns, which clears the return.
  async function backToSummary() {
    await goToSubstep("review.summary");
  }

  // A rail step's toggle, in one change to `openPanels`: a step is expanded
  // when `rail-shut:<id>` is absent and `rail-open:<id>` is present or it is
  // the current step, so expanding adds `rail-open:` and collapsing adds
  // `rail-shut:`, each replacing the other.
  function setRailExpanded(stepId, expanded) {
    const open = `rail-open:${stepId}`;
    const shut = `rail-shut:${stepId}`;
    state.openPanels = [
      ...state.openPanels.filter((name) => name !== open && name !== shut),
      expanded ? open : shut,
    ];
    persistSession();
    show();
  }

  // The summary's Expand all and Collapse all, in one change to `openPanels`:
  // a section is collapsed while `summary-shut:<step id>` is there, so this
  // replaces every such name with one per id in `stepIds` (none expands all).
  function setSummaryShut(stepIds) {
    state.openPanels = [
      ...state.openPanels.filter((name) => !name.startsWith("summary-shut:")),
      ...stepIds.map((id) => `summary-shut:${id}`),
    ];
    persistSession();
    show();
  }

  // The household card's Remove: the member leaves the draft, its revealed ids
  // go, and the ids of the members after it move down by one.
  function removeMember(index, group = "hh") {
    if (!formOpen()) return;
    const members = state.draftAnswers[group];
    const at = Number(index);
    if (!Array.isArray(members) || !Number.isInteger(at) || at < 0 || at >= members.length) return;
    state.revealed = state.revealed.flatMap((id) => {
      const member = parseMemberId(id);
      if (!member || member.group !== group || member.index < at) return [id];
      if (member.index === at) return [];
      return [`${group}[${member.index - 1}].${member.sub}`];
    });
    const kept = members.filter((_, position) => position !== at);
    persistSession();
    commitDraft(mergeIntoDraft(state.draftAnswers, { [group]: kept.length ? kept : null }));
  }

  async function dispatch(action, { save = false, omit = null } = {}) {
    sentFrom.set(action, opening);
    state.busy = true;
    state.error = null;
    if (save) state.saveState = "saving";
    show();
    try {
      const receipt = await store.act(action);
      pendingAction = null;
      state.retryable = false;
      noteConnected();
      // The draft as it is now, for a version-2 save: what was typed while the
      // save was out is not in what was sent.
      const typed = sentDrafts.has(action) ? state.draftAnswers : null;
      // A save that lands after another case was opened, or after its case
      // was left and opened again, says nothing about the open draft: its
      // edits, pin and chip are its own, and its re-read below is a newer
      // revision like anybody else's.
      if (save && sameOpening(action)) {
        state.dirty = false;
        state.editBaseRevision = null;
        state.conflict = null;
        state.saveState = "saved";
        answersInDoubt = false;
        if (typed && Number.isFinite(Number(receipt?.revision)))
          landedRevision = { opening, revision: Number(receipt.revision) };
      }
      // The action is done. A re-read that fails afterwards is a stale view,
      // never a failed action, and must not put the envelope back in hand.
      await refresh();
      if (typed) keepLaterEdits(action, typed);
      state.busy = false;
      show();
      // A start held while this action was out (the gate in
      // `startScreeningIfDue` skips it while busy) is sent now.
      void startScreeningIfDue();
      return receipt;
    } catch (error) {
      state.busy = false;
      // A save that fails after another case was opened (or its case opened
      // again) is not the open draft's failure: its chip, its banner and its
      // retry stay as they are.
      if (save && !sameOpening(action)) {
        if (error?.code === "OFFLINE") state.connection = "offline";
        show();
        throw error;
      }
      if (save) state.saveState = "failed";
      if (UNKNOWN_OUTCOME.includes(error?.code)) {
        // The server may already have applied it. The retry must be the same
        // envelope so the stored receipt answers instead of a second action.
        pendingAction = { action, save, omit };
        noteFailure(error);
        // After noteFailure, which drops any older local retry and its flag.
        state.retryable = true;
      } else {
        pendingAction = null;
        state.retryable = false;
        noteFailure(
          error,
          error?.code === "CONFLICT"
            ? {
                message:
                  staffWindow()
                    ? STAFF_CONFLICT_MESSAGE
                    : CONFLICT_MESSAGE,
              }
            : undefined,
        );
        if (error?.code === "CONFLICT")
          await loadSelected().catch(() => {});
      }
      show();
      if (!pendingAction) void startScreeningIfDue();
      throw error;
    }
  }

  // A version-2 save landed and the re-read rebuilt the draft from the
  // server. Every answer the draft changed after the save's snapshot goes
  // back on top, and the draft is dirty again when they differ from the
  // server; anything else keeps the rebuild (`keepLocalOnly`).
  function keepLaterEdits(action, typed) {
    const sent = sentDrafts.get(action);
    if (!sameOpening(action)) return;
    const later = {};
    for (const [id, value] of Object.entries(typed))
      if (JSON.stringify(value) !== JSON.stringify(sent[id])) later[id] = value;
    if (!Object.keys(later).length) return;
    state.draftAnswers = withMemberIds(mergeIntoDraft(state.draftAnswers, later), state.draftAnswers);
    pruneRevealed();
    if (!state.dirty && sendableDiffers(state.draftAnswers, serverAnswersOf(state.savedCase), 2))
      markDirty();
  }

  // The one-save-at-a-time flag, which sub-step changes, card marks, the
  // office's Save draft, a version-2 Retry and a Save all hold.
  function takeFlag() {
    substepSaveInFlight = true;
    let free;
    flagFree = { promise: new Promise((resolve) => (free = resolve)), free };
  }

  function dropFlag() {
    substepSaveInFlight = false;
    flagFree?.free();
    flagFree = null;
  }

  // A version-2 save, known as the one out until it settles. `shown`: the
  // press that sent it shows its failure itself.
  async function trackSave(promise, shown) {
    // The opening read here is the one the save was sent from: the caller
    // built `promise` first, and that call reaches `dispatch`'s
    // `sentFrom.set` synchronously, before this body runs.
    const out = { opening, promise, shown };
    saveOut = out;
    try {
      return await promise;
    } finally {
      if (saveOut === out) saveOut = null;
    }
  }

  // A save asked for on its own (Save, Save & exit, Submit's save first). It
  // saves or fails visibly. It holds the one-save-at-a-time flag, so
  // no second save goes out at the same expected revision. Pressed while
  // another save is out, it waits for that save: when that was this
  // opening's save and it failed, so does this, unless that failure has been
  // shown already (by the press that sent it, or an earlier Save waiting
  // for it), which resolves to null instead; otherwise what is still unsaved
  // is saved after it. Resolves to the receipt, or null when nothing was
  // saved for this press: the opening it was pressed on is gone, or the
  // failure it waited for is already on screen. With no form open it fails
  // as saveNow does.
  async function saveAnswers() {
    if (!formOpen()) return await saveNow();
    const from = opening;
    let waited = null;
    let receipt = null;
    while (substepSaveInFlight) {
      const out = saveOut;
      if (out && out !== waited) {
        waited = out;
        try {
          const done = await out.promise;
          if (out.opening === from) receipt = done;
        } catch (error) {
          if (out.opening === from && opening === from) {
            if (out.shown) return null;
            out.shown = true;
            throw error;
          }
        }
      } else await flagFree.promise;
    }
    if (opening !== from) return null;
    // The save it waited for took everything: nothing is left to send.
    if (receipt && !state.dirty) return receipt;
    takeFlag();
    try {
      return await saveNow();
    } finally {
      dropFlag();
    }
  }

  // `quiet`: the press that asked shows no failure of its own (a sub-step
  // change, a card mark's pre-save); the banner says it, and so does the
  // first Save that waited for it.
  async function saveNow({ quiet = false } = {}) {
    if (!state.savedCase)
      throw refuse("NOT_FOUND", "Open an application first.");
    if (state.conflict) {
      // Refusing here is the point: the pending edits are not rebased onto the
      // newer revision behind the person's back.
      state.saveState = "failed";
      noteFailure({ code: "CONFLICT" }, { message: EDIT_CONFLICT_MESSAGE });
      show();
      throw controllerError("CONFLICT", EDIT_CONFLICT_MESSAGE);
    }
    const action = {
      actionId: newActionId(),
      caseId: state.savedCase.id,
      expectedRevision: state.editBaseRevision ?? pinRevision(),
      // No one sends a person: a client answers for themselves, and the
      // database derives a staff account's person from the account.
      personId: null,
      type: "SAVE_ANSWERS",
      // A save never sends an invalid value (spec §2.5): every field's
      // trimmed value, null clears included, minus the ones that fail their
      // check. The draft itself keeps exactly what was typed. The client's
      // own draft also sends its visited sub-steps (spec 2026-10-04 §3.7).
      payload: savePayload(),
    };
    sentDrafts.set(action, state.draftAnswers);
    return await trackSave(sendVersionTwo(action), !quiet);
  }

  // A version-2 save's envelope sent, with its one retry without a field.
  async function sendVersionTwo(action) {
    try {
      return await dispatchSave(action);
    } catch (error) {
      // A refusal that names one field is retried once, without that field
      // too. This retry is dispatched directly, never back through here, so a
      // second refusal takes the usual failure path. Today's server names no
      // field, so this waits for a server that does.
      const field = refusedField(error, action);
      // Another case was opened meanwhile (or this one opened again): the old
      // opening's save is not retried.
      if (!field || !sameOpening(action)) throw error;
      const { [field]: _left, ...rest } = action.payload.answers;
      const retry = {
        ...action,
        actionId: newActionId(),
        payload: { ...action.payload, answers: rest },
      };
      sentDrafts.set(retry, sentDrafts.get(action));
      return await dispatchSave(retry, field);
    }
  }

  // A version-2 save. When its outcome is unknown and it carried answers the
  // server didn't have, the server may now hold them (`answersInDoubt`).
  async function dispatchSave(action, omit = null) {
    try {
      return await dispatch(action, { save: true, omit });
    } catch (error) {
      if (
        UNKNOWN_OUTCOME.includes(error?.code) &&
        sameOpening(action) &&
        sendableDiffers(action.payload.answers, serverAnswersOf(state.savedCase), 2)
      )
        answersInDoubt = true;
      throw error;
    }
  }

  // The top-level field a refusal names, when it was in the request.
  function refusedField(error, action) {
    if (typeof error?.field !== "string") return null;
    if (UNKNOWN_OUTCOME.includes(error.code) || error.code === "CONFLICT") return null;
    const field = error.field.replace(/\[.*$/, "");
    return Object.hasOwn(action.payload.answers, field) ? field : null;
  }

  // A deliberate choice between two sets of answers, and nothing more: it takes
  // a fresh look at the server, refuses if the case moved again, and leaves the
  // result unsaved so the save still goes through the database revision check.
  // `fromServer`: take the office's side from the fresh record,
  // its answers plus the contact record's four fields, not from `answers`.
  async function reconcileAnswers({ answers, expectedServerRevision, fromServer = false }) {
    if (!state.selectedCaseId)
      throw refuse("NOT_FOUND", "Open an application first.");
    const latest = await store.getCase(state.selectedCaseId);
    applyCase(latest);
    noteConnected();
    if (Number(latest.revision) !== Number(expectedServerRevision)) {
      show();
      throw refuse(
        "CONFLICT",
        "This application changed again. Check the newest values and choose once more.",
      );
    }
    reconcileVersionTwo(fromServer ? serverAnswersOf(latest) : pickAnswers(answers), latest);
  }

  // The chosen answers are dirty only when a save would change the
  // server (spec 2026-10-04 §9.3). Choosing what the server already has
  // leaves nothing to save: no pin, and the chip goes back to its settled
  // state. The fresh read settles any save in doubt either way.
  function reconcileVersionTwo(chosen, latest) {
    state.draftAnswers = withMemberIds(chosen, state.draftAnswers);
    pruneRevealed();
    state.conflict = null;
    state.error = null;
    answersInDoubt = false;
    forgetPendingSave();
    if (sendableDiffers(state.draftAnswers, serverAnswersOf(latest), 2) || visitsPending()) {
      state.editBaseRevision = Number(latest.revision);
      state.dirty = true;
      markUnsaved();
    } else {
      state.editBaseRevision = null;
      state.dirty = false;
      if (state.saveState === "unsaved" || state.saveState === "failed")
        state.saveState = settledState();
    }
    show();
  }

  // `caseId`, when given, is the case the action is for: nothing is sent once
  // another case is open (the envelope is never built for a different case).
  async function runAction(type, payload, { caseId: forCase = null } = {}) {
    if (!CASE_ACTIONS.includes(type))
      throw refuse("VALIDATION", "This step is not available.");
    if (!state.savedCase)
      throw refuse("NOT_FOUND", "Open an application first.");
    if (forCase !== null && state.savedCase.id !== forCase) return null;
    // A start sent by this window's open is still out: the press waits for it
    // (it re-reads the case), so it pins the new revision and meets no conflict.
    // A second press meanwhile does nothing, as a second click while a
    // dispatch is in flight does nothing; and if the case is left meanwhile,
    // the press was for the old opening and nothing is sent (as `cardAction`
    // treats a press whose opening has changed).
    if (screeningInFlight?.caseId === state.savedCase.id) {
      if (pressWaitingOnStart) return null;
      const caseId = state.savedCase.id;
      pressWaitingOnStart = true;
      try {
        await screeningInFlight.promise.catch(() => {});
      } finally {
        pressWaitingOnStart = false;
      }
      if (state.savedCase?.id !== caseId) return null;
    }
    const action = {
      actionId: newActionId(),
      // The open case, which is `forCase` when one was named (checked above).
      caseId: forCase ?? state.savedCase.id,
      // As a save's pin: the revision this window last knew, the receipt's
      // when the re-read after a save failed.
      expectedRevision: pinRevision(),
      personId: null,
      type,
      payload: payload ?? {},
    };
    return await dispatch(action);
  }

  // A document card's mark or group (spec 2026-10-04 §6.3). On a draft, a
  // dirty draft is saved first, the same as a rail jump; a failed save stops
  // here, with its error on screen. On any other stage nothing is saved first
  // (the server refuses SAVE_ANSWERS there). Then the action goes through the
  // same path as any other. It shares the sub-step change's one-at-a-time
  // guard, held from the pre-save until the mark itself has been answered: a
  // mark during a sub-step change's save is ignored (it would send a second
  // write with the same expected revision and meet a false conflict), and a
  // second mark or a sub-step change while this one is in flight is ignored
  // the same way. The page disables the marks and the form's navigation while
  // `busy`, so these early returns are a safety net, not a silent drop.
  async function cardAction(type, payload) {
    // First, so a mark during a new office draft's first save (no case yet)
    // is ignored like any other.
    if (substepSaveInFlight) return null;
    if (!state.savedCase)
      throw refuse("NOT_FOUND", "Open an application first.");
    takeFlag();
    try {
      if (state.savedCase.stage === "draft" && state.dirty) {
        const from = opening;
        try {
          await saveNow({ quiet: true });
        } catch {
          return null;
        }
        // Another case was opened during the save, or this one left and
        // opened again: this mark was for the old opening.
        if (opening !== from) return null;
      }
      return await runAction(type, payload);
    } finally {
      dropFlag();
    }
  }

  const setDocumentCard = (slotId, status) =>
    cardAction("SET_DOCUMENT_CARD", { slotId, status });
  const setDocumentGroup = (slotId, group) =>
    cardAction("SET_DOCUMENT_GROUP", { slotId, group });

  // The shaded section, read from an uploaded copy (design D5, D8). The case
  // revision is the latest this window knows (`runAction`, kept current by
  // realtime), so unrelated work on the case never blocks it; the copy's own
  // section version is what catches a stale copy (`basedOnVersion`). One at a
  // time: a second press while one is out does nothing. A refusal is said
  // beside the upload control with Dismiss only: the way to try again is to
  // upload again.
  // From the editor (`from: "editor"`, design D7) a refusal is the editor's
  // to say, in its own status with the edits kept: nothing is recorded on the
  // page behind it, and nothing is kept to send again.
  // The server says CONFLICT for a stale case revision as well as a stale
  // section. An upload treats them as the editor does (createShadedSave): when
  // the re-read case still holds the copy's section version, only the case
  // moved and the same values go once more on the fresh revision; only a
  // section that moved is a stale copy. The editor makes that call itself,
  // around each of its own sends.
  let shadedSaveInFlight = false;
  async function saveShadedSection(fields, basedOnVersion, { from = "upload" } = {}) {
    if (shadedSaveInFlight) return null;
    shadedSaveInFlight = true;
    const caseId = state.savedCase?.id ?? null;
    state.shadedStatus = null;
    // Every send is for the case open when this save began (`caseId`), never
    // whatever is open by the time it goes: runAction sends nothing once that
    // case is no longer open, and the section version is read from it only
    // while it is.
    const stillOpen = () => caseId !== null && state.savedCase?.id === caseId;
    try {
      let receipt = null;
      const send = async (values, based) =>
        (receipt = await runAction("SAVE_PREPARER_FIELDS", { fields: values, basedOnVersion: based }, { caseId }));
      if (from === "editor") await send(fields, basedOnVersion);
      else {
        const upload = createShadedSave({
          version: basedOnVersion,
          check: () => ({ values: fields, errors: [] }),
          save: send,
          storedVersion: () => (stillOpen() ? Number((state.savedCase.preparerShadedFields ?? [])[0]?.version ?? 0) : NaN),
        });
        try {
          await upload(fields);
        } catch (error) {
          // Nothing was sent (the case was left meanwhile): nothing to say.
          if (error?.code === "NOT_SENT") return null;
          // Another case was opened while it was out: what this upload met is
          // the old case's, and nothing of it is said on the new one.
          if (!stillOpen()) {
            state.error = null;
            state.retryable = false;
            pendingAction = null;
            show();
            return null;
          }
          throw error;
        }
      }
      if (receipt && state.savedCase?.id === caseId) {
        state.shadedStatus = { caseId, text: "Saved" };
        show();
      }
      return receipt;
    } catch (error) {
      if (from === "editor") {
        state.error = null;
        state.retryable = false;
        state.shadedStatus = null;
        pendingAction = null;
        show();
      } else if (state.error) {
        state.error = {
          ...state.error,
          place: SHADED_UPLOAD,
          ...(error?.code === "CONFLICT" ? { message: STAFF_UPLOAD_CONFLICT_MESSAGE } : {}),
          ...(error?.code === "CASE_MOVED" ? { message: STAFF_UPLOAD_CASE_MOVED_MESSAGE } : {}),
        };
        // Dismiss only (screen-states): no envelope is kept to send again.
        state.retryable = false;
        pendingAction = null;
        show();
      }
      throw error;
    } finally {
      shadedSaveInFlight = false;
    }
  }

  // What was read from an uploaded copy is held for the open case until the
  // preparer confirms it (design D1): nothing is sent yet. A new upload
  // replaces the one held, and starts this case's upload control afresh: its
  // earlier error and "Saved" go.
  function reviewShadedCopy({ values, version, preview }) {
    const caseId = state.savedCase?.id ?? null;
    if (caseId === null) return;
    state.shadedReview = { caseId, values, version, preview: Boolean(preview) };
    if (state.error?.place === SHADED_UPLOAD) {
      state.error = null;
      state.retryable = false;
    }
    state.shadedStatus = null;
    show();
  }

  // Save these values: the held read goes through the upload's own save, with
  // its single flight, stale-copy sentence and case-moved resend. A read held
  // for a case no longer open is dropped unsent.
  async function confirmShadedReview() {
    const review = state.shadedReview;
    if (!review) return null;
    if (review.caseId !== state.savedCase?.id) {
      state.shadedReview = null;
      show();
      return null;
    }
    if (shadedSaveInFlight) return null;
    state.shadedReview = null;
    return saveShadedSection(review.values, review.version);
  }

  // Cancel: the held read is dropped and nothing is sent.
  function cancelShadedReview() {
    state.shadedReview = null;
    show();
  }

  // Assistance items are not cases: they have their own RPC, their own revision
  // and their own list, so they get their own dispatch rather than a branch
  // inside `runAction`. The shape is deliberately the same — an unknown type is
  // refused here without a call, the expected revision comes from the item this
  // window is looking at, and a CONFLICT re-reads the list before it is shown —
  // because the two failures are the same failure to the person reading them.
  //
  // It is not retryable: `actAssistance` returns no receipt to the browser, so
  // a timed-out claim is re-read rather than re-sent.
  async function runAssistanceAction(type, itemId, note = null) {
    if (!ASSISTANCE_ACTIONS.includes(type))
      throw refuse("VALIDATION", "This step is not available.");
    const item = state.assistance.find((entry) => entry?.id === itemId);
    if (!item)
      throw refuse("NOT_FOUND", "This request is no longer on screen.");
    const request = {
      actionId: newActionId(),
      itemId: item.id,
      expectedRevision: Number(item.revision),
      personId: null,
      type,
      // A claim carries no note at all; a resolution says what was done.
      note: type === "RESOLVE" ? note : null,
    };
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.actAssistance(request);
      state.busy = false;
      noteConnected();
      try {
        await loadAssistance();
        state.error = null;
      } catch (error) {
        // The action landed. A re-read that fails afterwards is a stale list,
        // never a failed claim.
        noteFailure(error);
      }
      show();
      // A start skipped while this was out (busy) is sent now.
      void startScreeningIfDue();
      return request;
    } catch (error) {
      state.busy = false;
      noteFailure(
        error,
        error?.code === "CONFLICT"
          ? { message: ASSISTANCE_CONFLICT_MESSAGE }
          : undefined,
      );
      if (error?.code === "CONFLICT") await loadAssistance().catch(() => {});
      show();
      void startScreeningIfDue();
      throw error;
    }
  }

  // The contact log: its own RPCs and its own revision per entry, beside the
  // case actions (they touch neither the case row nor its revision). Both are
  // shaped like `runAssistanceAction`: a refusal is shown and thrown, a
  // CONFLICT re-reads the case before it is shown, and a landed write whose
  // re-read fails is a stale view, never a failed write. Not retryable: the
  // form keeps what was typed and the person presses the button again.
  async function runContactWrite(request, write) {
    state.busy = true;
    state.error = null;
    show();
    try {
      await write(request);
      state.busy = false;
      noteConnected();
      try {
        await loadSelected();
        state.error = null;
      } catch (error) {
        noteFailure(error);
      }
      show();
      // A start skipped while this was out (busy) is sent now.
      void startScreeningIfDue();
      return request;
    } catch (error) {
      state.busy = false;
      noteFailure(
        error,
        error?.code === "CONFLICT" ? { message: STAFF_CONTACT_CONFLICT_MESSAGE } : undefined,
      );
      if (error?.code === "CONFLICT") await loadSelected().catch(() => {});
      show();
      void startScreeningIfDue();
      throw error;
    }
  }

  async function logContact(caseId, entry, followupId = null) {
    return await runContactWrite(
      {
        actionId: newActionId(),
        caseId,
        personId: null,
        followupId,
        entry,
      },
      (request) => store.logContact(request),
    );
  }

  // Season end: the ticked cases and the revisions the dialog showed. The
  // database moves all of them or none. A refusal is shown inside the dialog,
  // which stays open; a CONFLICT also re-reads the list, so the dialog reopens
  // with the cases as they are now (without the one that moved).
  async function closeUnsigned(cases) {
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.closeUnsigned({
        actionId: newActionId(),
        personId: null,
        cases: cases.map(({ caseId, revision }) => ({ caseId, revision })),
        confirmed: true,
      });
    } catch (error) {
      state.busy = false;
      noteFailure(
        error,
        error?.code === "CONFLICT"
          ? { message: "A case changed while you were deciding. The list is up to date: check it and try again." }
          : undefined,
      );
      state.retryable = false;
      if (error?.code === "CONFLICT") await loadList().catch(() => {});
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    try {
      await loadList();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    show();
  }

  async function editContact(contactId, entry) {
    const contact = (state.savedCase?.contacts ?? []).find(
      (item) => item?.id === contactId,
    );
    if (!contact)
      throw refuse("NOT_FOUND", STAFF_CONTACT_GONE_MESSAGE);
    return await runContactWrite(
      {
        actionId: newActionId(),
        contactId: contact.id,
        expectedRevision: Number(contact.revision),
        personId: null,
        entry,
      },
      (request) => store.editContact(request),
    );
  }

  // Staff work (Add a case).
  function requireStaffWindow(message) {
    if (!staffWindow()) throw refuse("FORBIDDEN", message);
  }

  async function retryLast() {
    if (localRetry && state.error) {
      const run = localRetry;
      localRetry = null;
      state.error = null;
      state.retryable = false;
      show();
      // Called before anything is awaited: a draft rebuilt here opens its tab
      // inside the press, as viewDraft does.
      await run();
      return { local: true };
    }
    dropLocalRetry();
    if (!pendingAction) return null;
    // Second guard, for any path that changes the draft without going through
    // editAnswers: an envelope that no longer matches the draft is dropped, not
    // sent. Nothing is lost — the draft is still here and still saveable.
    if (staleSave()) {
      forgetPendingSave();
      show();
      return null;
    }
    const { action, save, omit } = pendingAction;
    if (!save || !formOpen()) return await dispatch(action, { save, omit });
    // A save: one at a time, like any other.
    if (substepSaveInFlight) return null;
    takeFlag();
    try {
      return await trackSave(dispatch(action, { save, omit }), true);
    } finally {
      dropFlag();
    }
  }

  function getState() {
    return {
      ...state,
      cases: [...state.cases],
      lists: { ...state.lists },
      people: [...state.people],
      assistance: [...state.assistance],
      draftAnswers: { ...state.draftAnswers },
      revealed: [...state.revealed],
      openAddSubsteps: [...state.openAddSubsteps],
      visitedSubsteps: [...state.visitedSubsteps],
      openPanels: [...state.openPanels],
      boardFilters: { ...state.boardFilters },
      conflict: state.conflict ? { ...state.conflict } : null,
      error: state.error ? { ...state.error } : null,
      authError: state.authError ? { ...state.authError } : null,
      resendSeconds: cooldownRemaining(),
    };
  }

  return {
    start,
    stop,
    getState,
    refresh,
    sendCode,
    verifyCode,
    editAuthCode,
    editAuthEmail,
    restartSignIn,
    signOut,
    cooldownRemaining,
    selectCase,
    createCase,
    openAddCase,
    toggleAddSubstep,
    saveOfficeDraft,
    runAssistanceAction,
    logContact,
    closeUnsigned,
    editContact,
    setBoardFilter,
    clearBoardFilters,
    setBoardSearchDraft,
    toggleSidebar,
    setLanguage,
    adoptLanguage,
    setCaseTab,
    editAnswers,
    revealInvalid,
    guardSubmit,
    currentSubstep,
    goToSubstep,
    moveSubstep,
    openForChange,
    backToSummary,
    setRailExpanded,
    setSummaryShut,
    removeMember,
    saveAnswers,
    reconcileAnswers,
    runAction,
    setDocumentCard,
    setDocumentGroup,
    saveShadedSection,
    reviewShadedCopy,
    confirmShadedReview,
    cancelShadedReview,
    retryLast,
    navigate,
    togglePanel,
    setLookup,
    openDialog,
    closeDialog,
    dismissError,
    clearError,
    noteLocalFailure,
    // For the unit tests only: the loads a late change reaches, called
    // directly to prove each is inert for a presenter on its own.
    testing: { loadList, loadWorkspace, loadAssistance },
  };
}
