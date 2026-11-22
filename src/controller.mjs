import { awaitingClearance, ceilingAdmin, scheduleViewer, withOwnCapabilities } from "./clearance.mjs";
import { nyToday, addDays, weekBounds, SHIFT_REFUSALS, WEEKDAYS } from "./volunteer-schedule.mjs";
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
import { LABEL_COLORS, labelNameTaken } from "./case-labels.mjs";
import { createShadedSave } from "./shaded-editor.mjs";
import { createWindowState } from "./window-state.mjs";
import { isLang, readLanguage, writeLanguage } from "./language.mjs";
import { volunteerProblem, profileProblem, withoutLostRoles, roleNeedsMessage, openWorkMessage, accountMessage } from "./volunteer-roster.mjs";
import { emptyUpdateForm, toUpdateRequest, validateUpdate } from "./posted-updates.mjs";
import { nowInput } from "./contact-log.mjs";
import { seasonRefusalLines } from "./season-settings-views.mjs";

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
const STAFF_SCREENS = Object.freeze([
  "staff",
  "staff-case",
  "office-cases",
  "office-add-case",
  "office-volunteers",
  // Post an update (change add-posted-updates) and Season settings (change
  // add-season-settings): a workspace admin's only, cleared or not
  // (`screenAllowed`).
  "office-updates",
  "office-settings",
  // The Schedule (change add-volunteer-schedule): a schedule viewer's only,
  // cleared or not (`screenAllowed`).
  "schedule",
  // My profile (change add-my-profile, design D9): a cleared window's only
  // (`screenAllowed`).
  "my-profile",
]);
// The screens only a schedule viewer may be on (design D11).
// My profile is main's (change add-my-profile), a cleared window's, not a
// schedule viewer's. TODO(Task 15): My profile's shifts section and realtime.
const SCHEDULE_SCREENS = Object.freeze(["schedule"]);
// The admin screens an uncleared workspace admin keeps (design D10 of
// add-volunteer-clearance, add-posted-updates and add-season-settings).
const ADMIN_SETUP_SCREENS = Object.freeze(["office-volunteers", "office-updates", "office-settings"]);
// The screens only a workspace admin may be on.
const CEILING_ONLY_SCREENS = Object.freeze(["office-updates", "office-settings"]);
// The screens only a cleared window may be on.
const CLEARED_ONLY_SCREENS = Object.freeze(["my-profile"]);

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
// The Roster's drawer (change add-volunteer-roster-records): its list is read
// again, but the drawer keeps what was typed, so the admin reopens it to see
// the newer values. Staff-only, so named STAFF_ like the other staff
// sentences (no client ever reads them, and they have no 简体).
const STAFF_VOLUNTEER_CONFLICT_MESSAGE =
  "Someone else changed this volunteer. Close this and open it again to see their changes.";
export const VOLUNTEER_CONFLICT_MESSAGE = STAFF_VOLUNTEER_CONFLICT_MESSAGE;
// Site coordinators (change add-season-settings): a save that changes the
// Admin role by someone who is not one, deactivating a site coordinator by
// someone who is not one, and deactivating the last one.
const STAFF_ADMIN_ROLE_MESSAGE = "Only site coordinators change the Admin role.";
const STAFF_DEACTIVATE_SITE_COORDINATOR_MESSAGE = "Only site coordinators deactivate a site coordinator's account.";
const STAFF_LAST_SITE_COORDINATOR_MESSAGE =
  "At least one site coordinator must remain. Make someone else a site coordinator first.";
// Season settings (change add-season-settings): what its writes say.
const STAFF_SETTINGS_SAVED = "Season settings saved";
const STAFF_SETTINGS_LINK_MESSAGE = "Enter a link that starts with https://.";
const STAFF_SETTINGS_CONFLICT_MESSAGE = "Someone else changed these settings. Check them and save again.";
const STAFF_SIDN_FORMAT_MESSAGE = "Enter the site's SIDN: S followed by eight digits.";
const STAFF_SIDN_UPDATED = "SIDN updated";
const SETTINGS_LINK_FIELDS = Object.freeze(["certificateUploadUrl", "clientDocumentsUrl"]);
// Start next season (change add-start-next-season, design D8).
const STAFF_SEASON_MOVED_MESSAGE = "The season has already moved.";
const freshSettingsUi = () => ({ notice: null, fieldErrors: null, sidnError: null, startRefusal: null });
// The Schedule (change add-volunteer-schedule, design D7 and D10). Staff-only.
const STAFF_SHIFT_CONFLICT_MESSAGE = "Someone changed this shift. The schedule has been refreshed.";
const STAFF_SHIFT_ORDER_MESSAGE = "The shift must end after it starts.";
const STAFF_SHIFT_VOLUNTEER_MESSAGE = "Choose a volunteer.";
// The day on screen (null: today in New York, set when it opens), the
// `vitally_schedule_day` answer as last read, and the open shift drawer's
// draft. None persisted but the screen itself.
const freshSchedule = () => ({ date: null, day: null, drawer: null });
// The site hours card on Season settings: what its save says, and the
// sentence for each field the database can name (VT007 detail).
const STAFF_SITE_HOURS_SAVED = "Site hours saved";
const STAFF_TARGET_MESSAGE = "Enter a whole number from 0 to 9.";
const SITE_TARGET_FIELDS = Object.freeze(["preparersNeeded", "reviewersNeeded", "onSiteNeeded"]);
const siteHoursMessage = (day) => `${WEEKDAYS[day - 1]} must close after it opens.`;
// My profile (change add-my-profile, design D9). Staff-only text.
export const STAFF_MY_PROFILE_CONFLICT_MESSAGE = "Someone else changed these details. Here they are now.";
const STAFF_MY_PROFILE_SAVED = "Profile saved";
// Post an update (change add-posted-updates): the table is read again and
// the form keeps what was typed. Staff-only, so named STAFF_.
const STAFF_UPDATE_CONFLICT_MESSAGE = "Someone changed this update. Check the table and try again.";
const STAFF_UPDATE_TRANSITION_MESSAGE = "This update can no longer be changed.";
const EDITABLE_UPDATE_STATUSES = Object.freeze(["draft", "posted", "unpublished"]);
const STAFF_UPDATE_GONE_MESSAGE = "This update is no longer in the table.";
const STAFF_UPDATE_FORM_MESSAGE = "Please check the update and try again.";
const UPDATE_ACTIONS = Object.freeze(["POST", "UNPUBLISH", "DELETE"]);
const STAFF_VOLUNTEER_GONE_MESSAGE = "This volunteer could not be opened. Close this and try again.";
const EDIT_CONFLICT_MESSAGE =
  "Someone else changed this application while you were editing. Choose which answers to keep.";

// The Workload's sortable columns (workload-views.mjs) and its starting view.
const WORKLOAD_SORT_KEYS = Object.freeze(["name", "open", "preparing", "review", "waiting", "stalled", "hours"]);
const freshWorkloadView = () => ({ sort: { key: "open", dir: "desc" }, search: "", expanded: [] });

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
  // The document, for visibilitychange (a tab that becomes visible is a wake).
  documentEvents = globalThis.document,
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
    // The office's case labels, and the open label menu (change
    // add-case-labels): window-local, never persisted.
    // labelMenu = {caseId, search,
    //   editing: null | {labelId, revision, name, color, error}}.
    labels: [],
    labelMenu: null,
    // Whether each list has been read (design D6): a first load that failed
    // must never look like an empty list.
    lists: {
      cases: "loading",
      assistance: "loading",
      volunteers: "loading",
      updates: "loading",
      postedUpdates: "loading",
      seasonSettings: "loading",
      schedule: "loading",
      myProfile: "loading",
    },
    people: [],
    // The Roster (admin only): read when its screen opens and after each
    // save, never live. Its filters and the drawer's own sentence are
    // window-local and never persisted.
    volunteers: [],
    volunteerFilters: { search: "", role: "all" },
    volunteerFormError: null,
    // The document whose Mark reviewed reason row is open in the drawer; window-local.
    reviewReasonFor: null,
    // The last account action's result in the drawer: {kind: "ok" | "error", text}.
    volunteerAccountNotice: null,
    // The office screen's Invite a client panel (admin only): the client
    // accounts (null until read), the email as typed, and the last result.
    invitations: null,
    invitationsFailed: false,
    inviteEmail: "",
    inviteNotice: null,
    // The site check's own state (change add-account-invitations): null, or
    // `{name, error, cancelled}` once Confirm was pressed. Window-local.
    siteCheck: null,
    // The Volunteers page's tab, and the Workload's own view (change
    // add-volunteer-workload): window-local and never persisted. The Workload
    // tab is only ever set for a cleared, effective admin (`canSeeWorkload`).
    volunteerTab: "roster",
    workload: freshWorkloadView(),
    // The live shifts of the week holding today, for the Workload's Hours
    // this week (design D9); read only while the Workload is open.
    weekShifts: [],
    // Posted updates (change add-posted-updates). The feed is every staff
    // window's, cleared or not: `updates` is the RPC's items as read,
    // `updatesUnread` its own badge count (never recounted here), and
    // `notificationsOpen` whether the panel shows. A failed read keeps the
    // items and marks `lists.updates` failed; it blocks nothing else.
    // `notificationsFresh` holds the ids that were unread while the panel
    // showed (those it opened with, and any marked while open): the panel
    // highlights them until it closes, though they are marked read at once.
    updates: [],
    updatesUnread: 0,
    // Volunteers with an upload to review (a workspace admin's sidebar; D8).
    uploadsToReview: 0,
    notificationsOpen: false,
    notificationsFresh: [],
    // The Post an update screen (a workspace admin's): the table, the form as
    // typed, the update being edited (`{id, revision, status}` or null) and
    // the form's own errors (`{field: message}` or null). None persisted.
    postedUpdates: [],
    updateForm: emptyUpdateForm(),
    updateEditing: null,
    updateFormError: null,
    // Season settings (a workspace admin's): the `vitally_season_settings`
    // answer as last read (null until then), and the page's own sentences:
    // `notice` ({place: "links" | "coordinators", text}), `fieldErrors`
    // ({field: message}) and the SIDN dialog's `sidnError`. None persisted.
    seasonSettings: null,
    clientDocumentsUrl: null,
    seasonSettingsUi: freshSettingsUi(),
    // The Schedule (a schedule viewer's): `{date, day, drawer}`, where the
    // drawer is `{mode: "add" | "edit", shiftId, revision, volunteerId, name,
    // role, startHour, endHour, actionId}` or null.
    schedule: freshSchedule(),
    // My profile (a cleared staff window's): the `vitally_my_profile` answer
    // as last read, or null until then. Not persisted.
    myProfile: null,
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
  // The Roster save whose outcome is unknown, likewise the very request sent
  // (`saveVolunteer`). Window memory only: a reload starts without it.
  let pendingVolunteerSave = null;
  // An upload send whose answer never came (change add-clearance-uploads).
  let pendingUploadSend = null;
  // An account action whose answer never came, kept with the revision it was
  // sent at, so pressing the same button again sends the same action id.
  let pendingAccountAction = null;
  let pendingInviteAction = null;
  // Post an update's save and table action whose outcome is unknown, kept
  // the same way: `{ key, request }`, where the key says what was pressed.
  let pendingUpdateSave = null;
  // A Season settings write whose answer never came: the same press sends
  // that very request again, so the database replays its receipt.
  let pendingSettingsWrite = null;
  // A shift save or removal whose answer never came: `{key, request}`, sent
  // again unchanged when the same values are pressed again.
  let pendingShiftWrite = null;
  // The revision a draft of the site hours card started from (ruling R13):
  // set at the person's first change since the last save, CONFLICT re-read
  // or page open, and sent by Save, so a live or focus re-read that moves the
  // page never lets an unsent draft overwrite a change it never saw. null
  // while there is no draft.
  let siteHoursBaseRevision = null;
  // A My profile save whose answer never came: `{ key, request }`, the key
  // being the values as typed.
  let pendingProfileSave = null;
  // The revision My profile's form was drawn from: set by the first read
  // after the screen opens, by a landed save's answer and by a CONFLICT's
  // re-read. A focus refresh or the re-read after "I've uploaded it" never
  // moves it, so an edit made elsewhere in between is a CONFLICT, never
  // overwritten (PR #262 review). null until a read sets it.
  let profileFormRevision = null;
  let pendingUpdateAction = null;
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

  // Whether this principal may be on a screen: in its list, Post an update
  // and Season settings only for a workspace admin, and My profile only
  // while cleared.
  const screenAllowed = (screen) =>
    screens().includes(screen) &&
    (!CEILING_ONLY_SCREENS.includes(screen) || ceilingAdmin(state.principal)) &&
    (!SCHEDULE_SCREENS.includes(screen) || scheduleViewer(state.principal)) &&
    (!CLEARED_ONLY_SCREENS.includes(screen) || !awaitingClearance(state));

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
    if (!state.principal) return;
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
    if (screenAllowed(saved.screen)) state.screen = saved.screen;
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

  // `clearanceRead`: the failure is the clearance read's own, which never
  // starts a re-check (no loop).
  function noteFailure(error, { message, clearanceRead = false } = {}) {
    dropLocalRetry();
    state.errorCount += 1;
    // Not cleared (any action, change add-volunteer-clearance): the setup
    // screen says it, so there is no inline error.
    if (error?.code === "NOT_CLEARED" && staffWindow()) {
      loseClearance();
      return;
    }
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
    // A refusal for a role or clearance reason may mean the roster changed
    // under this cleared window (#190): re-read it. A refusal of the read
    // itself starts none.
    if (
      !clearanceRead &&
      staffWindow() &&
      !awaitingClearance(state) &&
      (error?.code === "FORBIDDEN" || error?.code === "INELIGIBLE")
    )
      void recheckAfterRefusal();
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

  function noteLocalFailure(error, retry = null, { clearanceRead = false } = {}) {
    replaceFailedSave();
    noteFailure(error ?? {}, { message: error?.message ?? "Something went wrong.", clearanceRead });
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
    state.cases = await store.listCases();
    // The office's labels ride with the case list, so a live refresh brings
    // both. Only a staff window reads them. The open menu is left alone.
    if (staffWindow()) state.labels = await store.listLabels();
    state.lists.cases = "ready";
    noteConnected();
  }

  // Everything a staff screen does: its reads, its rules and its actions.
  const staffWindow = () => state.principal?.access === "staff";

  // Only a staff window may read the assistance table at all, so only a staff
  // window ever asks: the adapter would refuse an applicant, and asking is
  // already a mistake (`supabase-store.mjs`, "an applicant read never names a
  // staff table").
  async function loadAssistance() {
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
    if (!staffWindow() || !store.getWorkspace) return;
    state.workspace = await store.getWorkspace();
    noteConnected();
    enterOfficeDraftIfNeeded();
    await seasonMovedUnderDialog(state.workspace?.currentSeason);
  }

  async function loadSelected() {
    if (!state.selectedCaseId) return;
    const next = await store.getCase(state.selectedCaseId);
    applyCase(next);
    noteConnected();
  }

  // The public re-fetch: the list plus whatever case is open. Used by the
  // reconnect, the window focus and the online event alike, because a
  // subscription is never the only way back.
  // A wake refresh that starts while another is in flight joins it: focus and
  // visibilitychange come together when a tab returns. The refresh after an
  // action neither joins nor is joined. Signing out forgets it (forgetUser).
  let wakeRefresh = null;
  function refresh({ wake = false } = {}) {
    if (!wake) return runRefresh({ wake });
    if (!wakeRefresh) {
      const run = runRefresh({ wake }).finally(() => {
        if (wakeRefresh === run) wakeRefresh = null;
      });
      wakeRefresh = run;
    }
    return wakeRefresh;
  }

  async function runRefresh({ wake = false } = {}) {
    // Without a principal there is nothing to re-read, but there may still be
    // an identity to establish: a visitor whose session could not be read, or
    // who is signed in and could not be identified, gets another attempt here.
    // That is what makes focus, `online` and the retry button work when the
    // subscription never opened at all.
    if (!state.principal) {
      if (state.session !== "none") await load();
      return;
    }
    // Not cleared: the focus, `online` and retry re-read the clearance only.
    if (awaitingClearance(state)) {
      await checkClearance();
      // Post an update's table re-reads on focus too (an uncleared admin's
      // window has no realtime channel).
      if (awaitingClearance(state) && state.screen === "office-updates") await loadPostedUpdates();
      if (awaitingClearance(state) && state.screen === "office-settings") await loadSeasonSettings();
      if (awaitingClearance(state) && state.screen === "schedule") await loadScheduleDay();
      if (awaitingClearance(state) && state.screen === "my-profile") await loadMyProfile();
      return;
    }
    // A wake event re-reads the clearance first: role changes never come
    // through realtime. A failed check leaves the window cleared, so the
    // refresh goes on; a check that finds no clearance has already dropped the
    // work and redrawn the setup screen.
    if (wake) {
      const asked = state.principal.userId;
      const wasStaff = staffWindow();
      await checkClearance();
      // Signed out, or another user signed in, while the check was out.
      if (!state.principal || state.principal.userId !== asked) return;
      if (staffWindow() !== wasStaff) return;
      if (awaitingClearance(state)) return;
    }
    // The client documents link is read once in loadData; a wake re-reads it,
    // since Season settings may change in another window.
    if (wake) await readClientDocumentsUrl();
    // The feed never blocks the rest, and never fails the refresh.
    await readFeed();
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
      // A client who signed in since shows as Active (never throws).
      await readInvitations();
      // The sidebar's uploads count (never throws).
      await readUploadsCount();
      if (state.screen === "office-updates")
        try {
          await readPostedUpdates();
        } catch (error) {
          failure = failure ?? error;
        }
      if (state.screen === "office-settings")
        try {
          await readSeasonSettings();
        } catch (error) {
          failure = failure ?? error;
        }
      if (state.screen === "schedule")
        try {
          await readScheduleDay();
        } catch (error) {
          failure = failure ?? error;
        }
      if (state.screen === "my-profile")
        try {
          await readMyProfile();
        } catch (error) {
          failure = failure ?? error;
        }
      // A wake, focus or reconnect re-reads the week too (it may have turned).
      try {
        await readWorkloadHours();
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
    state.labelMenu = null;
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
    // client document states on another, means nothing on this application.
    state.openPanels = [];
    pendingAction = null;
    screeningStart = null;
    state.retryable = false;
    // A held upload read is the old case's: never saved to another.
    state.shadedReview = null;
  }

  // ---- start / stop ------------------------------------------------------

  const onWake = () => refresh({ wake: true });
  const onVisible = () =>
    documentEvents?.visibilityState === "visible" ? refresh({ wake: true }) : undefined;

  function listen() {
    if (listening) return;
    listening = true;
    windowEvents?.addEventListener?.("focus", onWake);
    windowEvents?.addEventListener?.("online", onWake);
    documentEvents?.addEventListener?.("visibilitychange", onVisible);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    windowEvents?.removeEventListener?.("focus", onWake);
    windowEvents?.removeEventListener?.("online", onWake);
    documentEvents?.removeEventListener?.("visibilitychange", onVisible);
  }

  function subscribe() {
    if (releaseStore) return;
    // A released channel still reports itself closed (removeChannel): that
    // is not this window's connection, so it is not heard.
    let live = true;
    const release = store.subscribe({
      onChange: (change) => handleChange(change),
      onConnection: (status) => {
        if (!live) return;
        const previous = state.connection;
        state.connection = status;
        show();
        // Reconnecting means the browser may have missed changes entirely.
        if (status === "online" && previous !== "online" && previous !== "unknown")
          refresh({ wake: true });
      },
    });
    releaseStore = () => {
      live = false;
      release?.();
    };
  }

  // TODO(Task 15): main's My profile is a cleared window's only, so the
  // uncleared "my-profile" reads here, in handleChange, refresh and
  // holdForClearance are dead; the channel is held only on the Schedule.
  // An uncleared schedule viewer's window follows the Schedule and My
  // profile live (design D10): it holds the channel while it is on either,
  // and only then. A cleared window's channel is loadWork's and is left alone.
  function syncScheduleChannel() {
    if (!staffWindow() || !awaitingClearance(state)) return;
    if (SCHEDULE_SCREENS.includes(state.screen) && scheduleViewer(state.principal)) subscribe();
    else unsubscribe();
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
    // An uncleared window holds a channel only while it is on the Schedule
    // or My profile (syncScheduleChannel), and hears nothing but their own
    // tables: it never reads a case, a list or the workspace.
    if (staffWindow() && awaitingClearance(state)) {
      if (!SCHEDULE_SCREENS.includes(state.screen) || (change.table !== "shifts" && change.table !== "schedule_settings")) return;
      try {
        if (state.screen === "schedule") await readScheduleDay();
        else await readMyProfile();
      } catch (error) {
        noteFailure(error);
      }
      show();
      return;
    }
    // A workspace change names no case and carries nothing private, so
    // everything this window holds may have changed: all of it is re-read
    // through the same access-scoped paths.
    const touchesWorkspace = change.table === "workspaces";
    // A logged contact never touches the cases row, but it moves the case's
    // lastContactAt, which the Workload's Stalled count reads from the list.
    // A label change moves the chips on every board row and the label options,
    // so it re-reads the list (which brings the labels with it) too.
    const touchesLabels =
      change.table === "case_labels" || change.table === "case_label_links";
    const touchesList =
      touchesWorkspace ||
      touchesLabels ||
      change.table === "cases" ||
      change.table === "contact_log";
    // A label rename names no case, so it reaches the open case's header too.
    const touchesOpen =
      Boolean(state.selectedCaseId) &&
      (touchesWorkspace ||
        change.table === "case_labels" ||
        change.caseId === state.selectedCaseId);
    // An assistance item belongs to no case, so it is named by its own table
    // rather than by a case id: a claim in another window has to reach this one.
    const touchesAssistance =
      touchesWorkspace || change.table === "assistance_items";
    // A posted update reaches the feed, and the admin's table when it shows
    // (a workspace change may move the season, and so every audience).
    const touchesUpdates = touchesWorkspace || change.table === "posted_updates";
    // A shift or the site hours move the day on the Schedule (design D10).
    const touchesSchedule =
      state.screen === "schedule" &&
      (touchesWorkspace || change.table === "shifts" || change.table === "schedule_settings");
    // ... and My profile's week, which a new season changes too.
    // TODO(Task 15): re-read myShifts (vitally_my_shifts) here, not main's profile.
    const touchesProfile =
      state.screen === "my-profile" &&
      (touchesWorkspace || change.table === "shifts" || change.table === "schedule_settings");
    // The site hours card on Season settings.
    const touchesSettings = state.screen === "office-settings" && change.table === "schedule_settings";
    // A shift moves the Workload's Hours this week (a new season too).
    const touchesHours =
      state.screen === "office-volunteers" &&
      state.volunteerTab === "workload" &&
      (touchesWorkspace || change.table === "shifts");
    if (
      !touchesList &&
      !touchesOpen &&
      !touchesAssistance &&
      !touchesUpdates &&
      !touchesSchedule &&
      !touchesProfile &&
      !touchesSettings &&
      !touchesHours
    )
      return;
    try {
      if (touchesUpdates) await readFeed();
      if (touchesList) await loadList();
      if (touchesWorkspace) await loadWorkspace();
      // A start that landed (seasonMovedUnderDialog) may have left this
      // window uncleared: nothing more of the work is read.
      if (!state.principal || (staffWindow() && awaitingClearance(state))) {
        show();
        return;
      }
      if (touchesAssistance) await loadAssistance();
      if (touchesUpdates && state.screen === "office-updates") await readPostedUpdates();
      if (touchesSchedule && state.screen === "schedule") await readScheduleDay();
      if (touchesProfile && state.screen === "my-profile") await readMyProfile();
      if (touchesSettings && state.screen === "office-settings") await readSeasonSettings();
      if (touchesHours)
        try {
          await readWorkloadHours();
        } catch (error) {
          noteFailure(error);
        }
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
  // Client windows only: staff screens no longer link to it (#245 review).
  async function readClientDocumentsUrl() {
    if (staffWindow()) {
      state.clientDocumentsUrl = null;
      return;
    }
    try {
      state.clientDocumentsUrl = (await store.getClientDocumentsUrl?.()) ?? null;
    } catch {
      // Never display a stale or staff-only URL if this optional read fails.
      state.clientDocumentsUrl = null;
    }
  }

  async function loadData() {
    await readClientDocumentsUrl();
    await loadList();
    if (staffWindow()) {
      state.people = withOwnCapabilities(await store.listPeople(), state.principal);
      await loadAssistance();
      await loadWorkspace();
      // The Roster is read only where it is shown (a restored window on it).
      if (state.screen === "office-volunteers") await readVolunteers();
      else await readUploadsCount();
      await readInvitations();
      if (state.screen === "office-updates") await readPostedUpdates();
      if (state.screen === "office-settings") await readSeasonSettings();
      if (state.screen === "schedule") await readScheduleDay();
      if (state.screen === "my-profile") await readMyProfile();
    } else {
      state.lists.assistance = "ready";
    }
    dataLoaded = true;
  }

  // The Roster's list (design D9). Only an admin's window asks: the policies
  // would answer anyone else with no rows, and asking is already a mistake.
  // It is the workspace admin's (design D10), cleared or not. A
  // first read that fails marks the list failed, so it never looks empty; one
  // that loaded once keeps what it shows. It throws, for loadData.
  async function readVolunteers() {
    if (!staffWindow() || !ceilingAdmin(state.principal)) return;
    try {
      state.volunteers = await store.listVolunteers();
      state.lists.volunteers = "ready";
      noteConnected();
    } catch (error) {
      if (state.lists.volunteers !== "ready") state.lists.volunteers = "failed";
      throw error;
    } finally {
      // After the list, and whatever the list did: the count is its own read,
      // started here and not waited for, so the list's callers never wait on it.
      if (staffWindow() && ceilingAdmin(state.principal)) {
        const asked = state.principal.userId;
        void redrawIfUploadsChanged(() => staffWindow() && state.principal?.userId === asked);
      }
    }
  }

  // The sidebar's uploads-to-review count (design D8): only a workspace
  // admin's staff window asks, cleared or not. Returns whether the number
  // changed. A failed read keeps the last count; it never throws and never
  // changes what its caller does.
  async function readUploadsCount() {
    try {
      if (!staffWindow() || !ceilingAdmin(state.principal)) return false;
      const asked = state.principal.userId;
      const count = Number(await store.countUploadsToReview());
      if (!Number.isFinite(count) || count < 0) return false;
      if (!staffWindow() || state.principal.userId !== asked) return false;
      if (state.uploadsToReview === count) return false;
      state.uploadsToReview = count;
      return true;
    } catch {
      return false;
    }
  }

  // The office screen's client list. Only an admin's window asks. A failed
  // read never fails the load around it: the panel says so and keeps what it
  // had. It never throws.
  async function readInvitations() {
    if (!staffWindow() || !ceilingAdmin(state.principal)) return;
    try {
      state.invitations = await store.listClientInvitations();
    } catch {
      state.invitationsFailed = true;
      return;
    }
    state.invitationsFailed = false;
  }

  // Opening the Roster: read its list, and say a failure with its own Try
  // again. Never rejects, so the screen's navigation can fire and forget it.
  async function loadVolunteers() {
    try {
      await readVolunteers();
      // The Workload's Hours this week come with its rows, on every arrival.
      await readWorkloadHours();
    } catch (error) {
      noteLocalFailure(error, loadVolunteers);
      return;
    }
    show();
  }

  function setVolunteerFilter(key, value) {
    if (key !== "search" && key !== "role" && key !== "show") return;
    state.volunteerFilters = { ...state.volunteerFilters, [key]: String(value ?? "") };
    show();
  }

  // ---- the Workload (change add-volunteer-workload) ------------------------

  // Who may see the Workload and open its drawer: a cleared staff member with
  // effective admin (design D1). The views hide the tab for anyone else; this
  // is the second gate, so nothing here opens it for them either.
  const canSeeWorkload = () => staffWindow() && !awaitingClearance(state) && actingAdmin();

  // The Volunteers page's tab. Either tab reads the volunteers, as opening the
  // Roster does: the Workload's rows and its drawer are built from them, and
  // its cases are the list this window already keeps live.
  async function setVolunteerTab(tab) {
    if (tab !== "roster" && tab !== "workload") return;
    if (tab === "workload" && !canSeeWorkload()) return;
    state.volunteerTab = tab;
    show();
    await loadVolunteers();
  }

  // The Workload's Hours this week: the live shifts dated Monday to Sunday of
  // the week holding today in New York. A failed read keeps the last hours.
  async function readWorkloadHours() {
    if (!canSeeWorkload() || state.screen !== "office-volunteers" || state.volunteerTab !== "workload") return;
    state.weekShifts = (await store.weekShifts(weekBounds(nyToday(clock())))) ?? [];
  }


  // The Workload's search, sort and open rows, one change at a time:
  // `search` (text), `sortBy` (a header pressed: the same key again reverses
  // it; a new key starts with its natural order, A to Z for the name and
  // highest first for a count) and `toggleRow` (a row id, or "unassigned").
  function setWorkloadView(patch = {}) {
    const view = state.workload;
    let next = view;
    if (typeof patch.search === "string") next = { ...next, search: patch.search };
    if (WORKLOAD_SORT_KEYS.includes(patch.sortBy)) {
      const dir =
        next.sort.key === patch.sortBy
          ? next.sort.dir === "asc"
            ? "desc"
            : "asc"
          : patch.sortBy === "name"
            ? "asc"
            : "desc";
      next = { ...next, sort: { key: patch.sortBy, dir } };
    }
    if (typeof patch.toggleRow === "string" && patch.toggleRow) {
      const id = patch.toggleRow;
      next = {
        ...next,
        expanded: next.expanded.includes(id)
          ? next.expanded.filter((entry) => entry !== id)
          : [...next.expanded, id],
      };
    }
    if (next === view) return;
    state.workload = next;
    show();
  }

  // What the drawer was opened on: the case's revision and the slot's holder
  // (null for an empty slot) as the case list shows them now. Choose sends
  // these, not the live list's, so a case that changes while the drawer is
  // open (a volunteer claims it, someone else reassigns it) is refused with
  // CONFLICT instead of turning an Assign into a Reassign.
  function assignBasis(caseId, slot) {
    const record = state.cases.find((entry) => entry?.id === caseId);
    if (!record) return null;
    const holder = slot === "reviewer" ? record.reviewerId : record.preparerId;
    return { revision: Number(record.revision), holderId: holder || null };
  }

  // Assign or Reassign: the drawer for one case's slot, fresh (no earlier
  // refusal). Only for a cleared, effective admin.
  function openAssign(caseId, slot) {
    if (!canSeeWorkload()) return;
    if (typeof caseId !== "string" || !caseId) return;
    if (slot !== "preparer" && slot !== "reviewer") return;
    const basis = assignBasis(caseId, slot);
    if (!basis) return;
    dropLocalRetry();
    state.error = null;
    openDialog("assign", { caseId, slot, search: "", ...basis });
  }

  function setAssignSearch(text) {
    if (state.dialog !== "assign" || !state.dialogContext) return;
    state.dialogContext = { ...state.dialogContext, search: String(text ?? "") };
    show();
  }

  // The drawer's Choose (spec "An admin assigns or reassigns…"). It needs no
  // open case: the action names the case, the revision captured when the
  // drawer opened and the holder it showed then (`expectedHolderId`), so a
  // case that moved meanwhile is a CONFLICT. It goes through
  // `dispatch`, as every case action does (its receipt, its retry of an
  // unknown outcome, its conflict message). On success the drawer closes and
  // the cases (dispatch's refresh) and the volunteers are read again; the
  // result carries the sentence the page says. A refusal stays in the drawer,
  // over the list as it is now. Returns null when nothing was sent.
  async function assignCase(personId) {
    if (!canSeeWorkload() || state.dialog !== "assign" || state.busy) return null;
    const { caseId, slot, revision, holderId } = state.dialogContext ?? {};
    if (slot !== "preparer" && slot !== "reviewer") return null;
    if (typeof personId !== "string" || !personId) return null;
    if (!Number.isFinite(revision)) return null;
    const name =
      state.volunteers.find((entry) => entry?.id === personId)?.name ??
      state.people.find((entry) => entry?.id === personId)?.name ??
      "the volunteer";
    const action = {
      actionId: newActionId(),
      caseId,
      expectedRevision: revision,
      type: "ASSIGN_CASE",
      payload: { slot, personId, expectedHolderId: holderId ?? null },
    };
    let receipt;
    try {
      receipt = await dispatch(action);
    } catch (error) {
      // Not after NOT_CLEARED, which has dropped the work: no case is read.
      if (canSeeWorkload()) {
        await loadList().catch(() => {});
        await readVolunteers().catch(() => {});
        // The refusal is on screen over the case as it is now, so a second
        // Choose is made knowingly: it is based on what the drawer now shows.
        const basis = assignBasis(caseId, slot);
        if (basis && state.dialog === "assign" && state.dialogContext?.caseId === caseId) {
          state.dialogContext = { ...state.dialogContext, ...basis };
        }
        show();
      }
      throw error;
    }
    if (state.dialog === "assign" && state.dialogContext?.caseId === caseId) {
      state.dialog = null;
      state.dialogContext = null;
    }
    // A failed re-read keeps the list it shows: the assignment landed.
    await readVolunteers().catch(() => {});
    show();
    return { receipt, notice: `Assigned ${name} as ${slot}.` };
  }

  function setReviewReasonFor(document) {
    state.reviewReasonFor = document ?? null;
    show();
  }

  function clearVolunteerFormError() {
    state.reviewReasonFor = null;
    state.volunteerFormError = null;
    state.volunteerAccountNotice = null;
  }

  // ---- posted updates (change add-posted-updates) --------------------------
  //
  // The feed: every staff window's, cleared or not. A read that fails marks
  // the feed failed and keeps what it showed; it never reaches the page-wide
  // error, so the board and the setup screen carry on. While the panel is
  // open, each read marks the unread items it shows (`markShown`), once:
  // the re-read after marking marks nothing, so an item the database did not
  // mark is never sent round again by that read.
  async function readFeed({ mark = true } = {}) {
    if (!staffWindow() || typeof store.getUpdates !== "function") return;
    const asked = state.principal.userId;
    const same = () => staffWindow() && state.principal.userId === asked;
    let answer;
    try {
      answer = await store.getUpdates();
    } catch (error) {
      if (!same()) return;
      state.lists = { ...state.lists, updates: "failed" };
      if (error?.code === "OFFLINE") state.connection = "offline";
      return;
    }
    if (!same()) return;
    state.updates = Array.isArray(answer?.items) ? answer.items.map((item) => ({ ...item })) : [];
    state.updatesUnread = Math.max(0, Number(answer?.unread) || 0);
    state.lists = { ...state.lists, updates: "ready" };
    noteConnected();
    if (mark && panelShowing()) await markShown();
  }

  // The panel shows only while its dialog does: a path that drops the dialog
  // (navigation, lost clearance) leaves nothing to mark.
  function panelShowing() {
    return state.notificationsOpen && state.dialog === "notifications";
  }

  // The panel is closed, by whatever path: nothing more is marked, and the
  // highlight of what was fresh goes with it.
  function endNotifications() {
    state.notificationsOpen = false;
    state.notificationsFresh = [];
  }

  // The unread items the panel shows, marked read in one call (at most the
  // 200 the RPC takes), then the feed again for the badge. Items already
  // read are never sent. A failed mark leaves them unread, for the next one.
  async function markShown() {
    const unread = state.updates.filter((item) => item && item.id && item.readAt == null).map((item) => item.id);
    // Still highlighted after the re-read, until the panel closes.
    state.notificationsFresh = [...new Set([...state.notificationsFresh, ...unread])];
    const ids = unread.slice(0, 200);
    if (!ids.length) return;
    try {
      await store.markUpdates({ ids, confirm: false });
    } catch (error) {
      if (error?.code === "OFFLINE") state.connection = "offline";
      return;
    }
    await readFeed({ mark: false });
  }

  // The public feed read: never rejects.
  async function loadFeed() {
    await readFeed();
    show();
  }

  async function openNotifications() {
    if (!staffWindow() || state.dialog !== "notifications") return;
    state.notificationsOpen = true;
    state.notificationsFresh = [];
    show();
    await markShown();
    show();
  }

  function closeNotifications() {
    endNotifications();
    show();
  }

  // "I've read this": the one item, confirmed, then the feed again. A
  // failure is said with its own Try again. Resolves true when it landed.
  async function confirmUpdate(id) {
    if (!staffWindow() || !id) return false;
    try {
      await store.markUpdates({ ids: [id], confirm: true });
    } catch (error) {
      noteLocalFailure(error, () => confirmUpdate(id));
      return false;
    }
    noteConnected();
    await readFeed();
    show();
    return true;
  }

  // Post an update's table: a workspace admin's, cleared or not. Like the
  // Roster's list, a first read that fails marks it failed, and one that
  // loaded once keeps what it shows. It throws, for loadData and refresh.
  async function readPostedUpdates() {
    if (!staffWindow() || !ceilingAdmin(state.principal)) return;
    try {
      const rows = await store.listPostedUpdates();
      state.postedUpdates = Array.isArray(rows) ? rows : [];
      state.lists = { ...state.lists, postedUpdates: "ready" };
      noteConnected();
    } catch (error) {
      if (state.lists.postedUpdates !== "ready") state.lists = { ...state.lists, postedUpdates: "failed" };
      throw error;
    }
  }

  // Opening the screen: read the table, and say a failure with its own Try
  // again. Never rejects.
  async function loadPostedUpdates() {
    try {
      await readPostedUpdates();
    } catch (error) {
      noteLocalFailure(error, loadPostedUpdates);
      return;
    }
    show();
  }

  // ---- The Schedule (change add-volunteer-schedule, design D7 and D10) ------
  //
  // A schedule viewer's page, cleared or not: one day, read on open, on each
  // day move, on focus, on a shifts or schedule_settings change (a cleared
  // window's channel), and after each write. Like Season settings, a first
  // read that fails marks it failed, and one that loaded once keeps what it
  // shows. It throws, for loadData and refresh.
  async function readScheduleDay() {
    if (!staffWindow() || !scheduleViewer(state.principal)) return;
    const date = state.schedule.date ?? nyToday(clock());
    if (!state.schedule.date) state.schedule = { ...state.schedule, date };
    try {
      const day = await store.scheduleDay(date);
      // A newer move asked for another day: this answer is not it.
      if (state.schedule.date !== date) return;
      state.schedule = { ...state.schedule, day };
      state.lists = { ...state.lists, schedule: "ready" };
      noteConnected();
    } catch (error) {
      if (state.schedule.date === date && state.lists.schedule !== "ready")
        state.lists = { ...state.lists, schedule: "failed" };
      throw error;
    }
  }

  // Reads the day and says a failure with its own Try again. Never rejects.
  async function loadScheduleDay() {
    try {
      await readScheduleDay();
    } catch (error) {
      noteLocalFailure(error, loadScheduleDay);
      return;
    }
    show();
  }

  // The sidebar link: the Schedule on today's New York date.
  async function openSchedule() {
    navigate("schedule");
    if (state.screen !== "schedule") return;
    state.schedule = { ...freshSchedule(), date: nyToday(clock()) };
    state.lists = { ...state.lists, schedule: "loading" };
    show();
    await loadScheduleDay();
  }

  // ‹ Prev, Next › and Today. Past days stay readable, and editable for admins.
  async function scheduleGo(direction) {
    if (state.screen !== "schedule" || !scheduleViewer(state.principal)) return;
    const from = state.schedule.date ?? nyToday(clock());
    const date =
      direction === "prev" ? addDays(from, -1) : direction === "next" ? addDays(from, 1) : nyToday(clock());
    state.schedule = { date, day: null, drawer: null };
    state.lists = { ...state.lists, schedule: "loading" };
    state.error = null;
    dropLocalRetry();
    show();
    await loadScheduleDay();
  }

  const scheduleShift = (shiftId) =>
    (state.schedule.day?.shifts ?? []).find((entry) => entry?.shiftId === shiftId) ?? null;
  const shiftCandidate = (volunteerId) =>
    (state.schedule.day?.candidates ?? []).find((entry) => entry?.volunteerId === volunteerId) ?? null;

  // "+ Add shift" (null) or a shift pressed: the drawer, for an admin only
  // (the read's own `canEdit`). A new shift starts at the opening hour.
  function openShiftDrawer(shiftId = null) {
    const day = state.schedule.day;
    if (state.screen !== "schedule" || day?.canEdit !== true) return;
    let drawer;
    if (shiftId) {
      const shift = scheduleShift(shiftId);
      if (!shift) return;
      drawer = {
        mode: "edit",
        shiftId: shift.shiftId,
        revision: Number(shift.revision),
        volunteerId: shift.volunteerId,
        name: shift.name,
        role: shift.role,
        startHour: shift.startHour,
        endHour: shift.endHour,
        actionId: null,
      };
    } else {
      if (!day.hours) return;
      drawer = {
        mode: "add",
        shiftId: null,
        revision: null,
        volunteerId: null,
        name: null,
        role: null,
        startHour: day.hours.open,
        endHour: Math.min(day.hours.open + 3, day.hours.close),
        actionId: null,
      };
    }
    endNotifications();
    state.schedule = { ...state.schedule, drawer };
    state.dialog = "shift";
    state.dialogContext = { shiftId: drawer.shiftId };
    state.error = null;
    dropLocalRetry();
    show();
  }

  // What the drawer holds as chosen: hours as numbers, and for a new shift a
  // role the chosen volunteer holds (their first when the one held does not
  // fit). An edit keeps its volunteer.
  const draftValues = (drawer, values = {}) => {
    const hour = (value, fallback) => {
      const n = Number.parseInt(value, 10);
      return Number.isInteger(n) ? n : fallback;
    };
    const edit = drawer.mode === "edit";
    const volunteerId = edit ? drawer.volunteerId : (values.volunteerId ?? drawer.volunteerId);
    let role = values.role || drawer.role;
    const roles = shiftCandidate(volunteerId)?.roles ?? [];
    if (!edit && roles.length && !roles.includes(role)) role = roles[0];
    return {
      ...drawer,
      volunteerId: volunteerId || null,
      name: edit ? drawer.name : (shiftCandidate(volunteerId)?.name ?? null),
      role: role || null,
      startHour: hour(values.startHour, drawer.startHour),
      endHour: hour(values.endHour, drawer.endHour),
    };
  };

  // A change in the drawer (a volunteer picked): redrawn, so the roles follow.
  function editShiftDraft(values = {}) {
    const drawer = state.schedule.drawer;
    if (!drawer) return;
    state.schedule = { ...state.schedule, drawer: draftValues(drawer, values) };
    show();
  }

  // One shift write: busy while it is out, the request kept for a lost answer
  // (matched on `key`). After any answer the day is read again. CONFLICT
  // closes the dialog and says the schedule was refreshed; another refusal is
  // said in the dialog, which stays. Resolves to `{done, toast}` when the
  // dialog is done with (`toast` the warning to show, or null), or null.
  async function shiftWrite(key, makeRequest, send) {
    let request = pendingShiftWrite?.key === key ? pendingShiftWrite.request : null;
    pendingShiftWrite = null;
    if (!request) request = makeRequest();
    if (state.schedule.drawer)
      state.schedule = { ...state.schedule, drawer: { ...state.schedule.drawer, actionId: request.actionId } };
    state.busy = true;
    state.error = null;
    dropLocalRetry();
    show();
    const done = (toast) => {
      state.dialog = null;
      state.dialogContext = null;
      state.schedule = { ...state.schedule, drawer: null };
      return { done: true, toast };
    };
    try {
      await send(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingShiftWrite = { key, request };
      let result = null;
      if (error?.code === "CONFLICT") result = done(STAFF_SHIFT_CONFLICT_MESSAGE);
      else {
        const reason = error?.code === "VALIDATION" ? SHIFT_REFUSALS[String(error?.cause?.details ?? "")] : null;
        noteFailure(error, reason ? { message: reason } : {});
      }
      // What the write did, or what changed under it: the day as it is now.
      await readScheduleDay().catch(() => {});
      show();
      return result;
    }
    state.busy = false;
    noteConnected();
    const result = done(null);
    try {
      await readScheduleDay();
    } catch (error) {
      noteFailure(error);
    }
    show();
    return result;
  }

  // Save in the drawer: the values as chosen, for the day on screen, at the
  // revision the drawer opened with.
  async function saveShift(values = {}) {
    const open = state.schedule.drawer;
    if (state.busy || !staffWindow() || !open || state.schedule.day?.canEdit !== true) return null;
    const drawer = draftValues(open, values);
    state.schedule = { ...state.schedule, drawer };
    if (!drawer.volunteerId) {
      noteFailure({ code: "VALIDATION" }, { message: STAFF_SHIFT_VOLUNTEER_MESSAGE });
      show();
      return null;
    }
    if (!(drawer.endHour > drawer.startHour)) {
      noteFailure({ code: "VALIDATION" }, { message: STAFF_SHIFT_ORDER_MESSAGE });
      show();
      return null;
    }
    const shift = {
      volunteerId: drawer.volunteerId,
      date: state.schedule.date,
      startHour: drawer.startHour,
      endHour: drawer.endHour,
      role: drawer.role,
    };
    const edit = drawer.mode === "edit";
    const key = JSON.stringify({ save: drawer.shiftId, revision: drawer.revision, shift });
    return await shiftWrite(
      key,
      () => ({
        actionId: newActionId(),
        shiftId: edit ? drawer.shiftId : null,
        revision: edit ? drawer.revision : null,
        shift,
      }),
      (request) => store.saveShift(request),
    );
  }

  // A drag on the grid (design D7): a draft from `schedule-drag.mjs`, saved
  // through the same write as the drawer's Save, so a CONFLICT, a refusal and
  // a lost answer are handled identically. There is no drawer: a refusal is
  // the page's banner, and the day is read again either way. The draft's
  // `actionId` is the gesture's, and so is its `date`: a draft from another
  // day than the one on screen (the day changed mid-drag) sends nothing, so a
  // resize never moves a shift to another date.
  async function saveShiftDrag(draft) {
    if (state.busy || state.dialog || !staffWindow() || state.screen !== "schedule" || state.schedule.day?.canEdit !== true) return null;
    if (!draft?.volunteerId || !(draft.endHour > draft.startHour)) return null;
    if (!draft.date || draft.date !== state.schedule.date) return null;
    const shift = {
      volunteerId: draft.volunteerId,
      date: draft.date,
      startHour: draft.startHour,
      endHour: draft.endHour,
      role: draft.role,
    };
    const edit = Boolean(draft.shiftId);
    const key = JSON.stringify({ save: draft.shiftId ?? null, revision: draft.revision ?? null, shift });
    return await shiftWrite(
      key,
      () => ({
        actionId: draft.actionId ?? newActionId(),
        shiftId: edit ? draft.shiftId : null,
        revision: edit ? draft.revision : null,
        shift,
      }),
      (request) => store.saveShift(request),
    );
  }

  // Remove shift, once its confirmation is pressed, at the revision read.
  // The re-read revision on purpose: the confirmation shows the re-read hours.
  async function removeShift(shiftId) {
    if (state.busy || !staffWindow() || !shiftId || state.schedule.day?.canEdit !== true) return null;
    const shift = scheduleShift(shiftId);
    const revision = Number(shift?.revision ?? state.schedule.drawer?.revision);
    if (!Number.isFinite(revision)) return null;
    const key = JSON.stringify({ remove: shiftId, revision });
    return await shiftWrite(
      key,
      () => ({ actionId: newActionId(), shiftId, revision }),
      (request) => store.removeShift(request),
    );
  }

  // Leaving the Schedule because this person may no longer be on it: its data
  // goes with it. (My profile is main's, change add-my-profile.)
  function leaveSchedule() {
    if (state.dialog === "shift" || state.dialog === "remove-shift") {
      state.dialog = null;
      state.dialogContext = null;
    }
    state.schedule = freshSchedule();
    state.screen = homeScreen();
  }

  // ---- My profile (change add-my-profile, design D9) ---------------------
  //
  // A cleared staff window's own details. It is read when the screen opens,
  // on focus, after a save and after a send; there is no realtime for it.
  // Like Season settings, a first read that fails marks it failed, and one
  // that loaded once keeps what it shows. It throws, for loadData and refresh.
  async function readMyProfile() {
    if (!staffWindow() || awaitingClearance(state)) return;
    try {
      state.myProfile = await store.getMyProfile();
      if (profileFormRevision === null) profileFormRevision = Number(state.myProfile?.revision ?? 0);
      state.lists = { ...state.lists, myProfile: "ready" };
      noteConnected();
    } catch (error) {
      if (state.lists.myProfile !== "ready") state.lists = { ...state.lists, myProfile: "failed" };
      throw error;
    }
  }

  // Opening the screen: read it, and say a failure with its own Try again.
  // Never rejects.
  async function loadMyProfile() {
    // The form is drawn afresh: it starts from what this read finds.
    profileFormRevision = null;
    try {
      await readMyProfile();
    } catch (error) {
      noteLocalFailure(error, loadMyProfile);
      return;
    }
    show();
  }

  // The six fields the save sends, and nothing else: strings trimmed, an
  // empty phone or other language as null, the lists as lists.
  const profileFields = (values) => {
    const text = (value) => String(value ?? "").trim();
    const list = (value) => (Array.isArray(value) ? value.map(String) : []);
    const languages = list(values?.languages);
    return {
      name: text(values?.name),
      phone: text(values?.phone) || null,
      works: text(values?.works),
      languages,
      // A hidden box still holds its stored name: only Other names a language.
      otherLanguage: languages.includes("other") ? text(values?.otherLanguage) || null : null,
      usualDays: list(values?.usualDays),
    };
  };

  // Save: the typed details at the revision the form was drawn from
  // (profileFormRevision), not the latest refresh. A save whose
  // answer never came is kept, and Save pressed again with the same values
  // sends that very request, so the stored receipt answers; changed values
  // are a new save. A CONFLICT re-reads and says someone else changed them
  // (the page then shows what is stored now). Any other refusal is said and
  // leaves the read alone, so the form keeps what was typed. After a landed
  // save the profile, the people (the name the window shows for the
  // signed-in person) and the clearance are read again. Resolves to the
  // toast's text, or null.
  async function saveMyProfile(values) {
    if (state.busy || !staffWindow() || awaitingClearance(state) || !state.myProfile) return null;
    const profile = profileFields(values);
    const key = JSON.stringify(profile);
    let request = pendingProfileSave?.key === key ? pendingProfileSave.request : null;
    pendingProfileSave = null;
    if (!request) {
      // The drawer's own check and sentences: nothing is sent, and the form
      // keeps what was typed.
      const problem = profileProblem(profile);
      if (problem) {
        state.error = { code: "VALIDATION", message: problem };
        state.retryable = false;
        show();
        return null;
      }
    }
    if (!request)
      request = {
        actionId: newActionId(),
        expectedRevision: profileFormRevision ?? Number(state.myProfile.revision ?? 0),
        profile,
      };
    state.busy = true;
    state.error = null;
    show();
    let answer;
    try {
      answer = await store.saveMyProfile(request);
    } catch (error) {
      state.busy = false;
      // An earlier action's Try again does not belong beside this refusal.
      state.retryable = false;
      const lost = UNKNOWN_OUTCOME.includes(error?.code);
      if (lost) pendingProfileSave = { key, request };
      noteFailure(error, error?.code === "CONFLICT" ? { message: STAFF_MY_PROFILE_CONFLICT_MESSAGE } : undefined);
      // What changed under it, or what a lost save did: the details as they
      // are now.
      // A CONFLICT draws the stored details, so the form starts again from
      // them; a lost save keeps its revision for the retry.
      if (error?.code === "CONFLICT") profileFormRevision = null;
      if (lost || error?.code === "CONFLICT") await readMyProfile().catch(() => {});
      show();
      return null;
    }
    state.busy = false;
    noteConnected();
    // The form now holds what was saved, at the revision the save made.
    profileFormRevision = Number.isFinite(Number(answer?.revision))
      ? Number(answer.revision)
      : request.expectedRevision + 1;
    // A landed save whose re-read fails is a stale page, never a failed save.
    await readMyProfile().catch((error) => noteFailure(error));
    try {
      state.people = withOwnCapabilities(await store.listPeople(), state.principal);
    } catch (error) {
      noteFailure(error);
    }
    show();
    await recheckAfterOwnSave();
    show();
    return STAFF_MY_PROFILE_SAVED;
  }

  // ---- Season settings (change add-season-settings, design D10) ----------
  //
  // A workspace admin's page, cleared or not. It is read on open, on focus and
  // after each of its writes, and a cleared window reads it again on a
  // schedule_settings change (the site hours card). Like the Roster's
  // list, a first read that fails marks it failed, and one that loaded once
  // keeps what it shows. It throws, for loadData and refresh.
  async function readSeasonSettings() {
    if (!staffWindow() || !ceilingAdmin(state.principal)) return;
    try {
      state.seasonSettings = await store.getSeasonSettings();
      state.lists = { ...state.lists, seasonSettings: "ready" };
      noteConnected();
      await seasonMovedUnderDialog(state.seasonSettings?.season);
    } catch (error) {
      if (state.lists.seasonSettings !== "ready") state.lists = { ...state.lists, seasonSettings: "failed" };
      throw error;
    }
  }

  // Opening the page: read it, and say a failure with its own Try again.
  // Never rejects.
  async function loadSeasonSettings() {
    try {
      await readSeasonSettings();
    } catch (error) {
      noteLocalFailure(error, loadSeasonSettings);
      return;
    }
    show();
  }

  // One write: the request kept for a lost answer (matched on `key`), busy
  // while it is out, and `refused(error)` saying a refusal on the page (true
  // when it did; anything else is the window's own error). The page is read
  // again after any answer. Resolves to the store's answer, or null.
  async function settingsWrite(key, makeRequest, send, refused) {
    if (state.busy || !staffWindow() || !state.seasonSettings) return null;
    let request = pendingSettingsWrite?.key === key ? pendingSettingsWrite.request : null;
    pendingSettingsWrite = null;
    if (!request) request = makeRequest();
    state.seasonSettingsUi = freshSettingsUi();
    state.busy = true;
    state.error = null;
    show();
    let answer;
    try {
      answer = await send(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingSettingsWrite = { key, request };
      if (!refused(error)) noteFailure(error);
      // What the write did, or what changed under it: the page as it is now.
      await readSeasonSettings().catch(() => {});
      show();
      return null;
    }
    state.busy = false;
    noteConnected();
    try {
      await readSeasonSettings();
    } catch (error) {
      noteFailure(error);
    }
    show();
    return answer ?? {};
  }

  // Save: both links, trimmed, at the revision the page read. Resolves to
  // the toast's text, or null (the page says why).
  async function saveSeasonSettings(values) {
    const settings = Object.fromEntries(
      SETTINGS_LINK_FIELDS.map((field) => [field, String(values?.[field] ?? "").trim()]),
    );
    const expectedRevision = Number(state.seasonSettings?.revision ?? 0);
    const answer = await settingsWrite(
      JSON.stringify({ type: "links", settings, expectedRevision }),
      () => ({ actionId: newActionId(), expectedRevision, settings }),
      (request) => store.saveSeasonSettings(request),
      (error) => {
        const field = error?.cause?.details;
        if (error?.code === "VALIDATION" && SETTINGS_LINK_FIELDS.includes(field)) {
          state.seasonSettingsUi = { ...state.seasonSettingsUi, fieldErrors: { [field]: STAFF_SETTINGS_LINK_MESSAGE } };
          return true;
        }
        if (error?.code === "CONFLICT") {
          state.seasonSettingsUi = {
            ...state.seasonSettingsUi,
            notice: { place: "links", text: STAFF_SETTINGS_CONFLICT_MESSAGE },
          };
          return true;
        }
        return false;
      },
    );
    return answer ? STAFF_SETTINGS_SAVED : null;
  }

  // The site hours card's Save (change add-volunteer-schedule): the whole
  // settings as the form holds them, every open day's hours and all three
  // targets, at the revision the page read. A refused day or target is named
  // beside it; a CONFLICT is said in the card, which the re-read redraws.
  // Resolves to the toast's text, or null.
  async function saveScheduleSettings(settings) {
    const revision = siteHoursBaseRevision ?? Number(state.seasonSettings?.schedule?.revision ?? 0);
    const answer = await settingsWrite(
      JSON.stringify({ type: "site-hours", settings, revision }),
      () => ({ actionId: newActionId(), revision, settings }),
      (request) => store.saveScheduleSettings(request),
      (error) => {
        const field = String(error?.cause?.details ?? "");
        const day = /^siteHours\.([1-7])$/.exec(field);
        if (error?.code === "VALIDATION" && (day || SITE_TARGET_FIELDS.includes(field))) {
          state.seasonSettingsUi = {
            ...state.seasonSettingsUi,
            fieldErrors: { [field]: day ? siteHoursMessage(Number(day[1])) : STAFF_TARGET_MESSAGE },
          };
          return true;
        }
        if (error?.code === "CONFLICT") {
          state.seasonSettingsUi = {
            ...state.seasonSettingsUi,
            notice: { place: "site-hours", text: STAFF_SETTINGS_CONFLICT_MESSAGE },
          };
          // The re-read is what the next draft starts from.
          siteHoursBaseRevision = null;
          return true;
        }
        return false;
      },
    );
    if (answer) siteHoursBaseRevision = null;
    return answer ? STAFF_SITE_HOURS_SAVED : null;
  }

  // The person's first change to the site hours card since the last save,
  // CONFLICT re-read or page open: the draft starts from the revision on
  // screen (ruling R13).
  function beginSiteHoursEdit() {
    if (siteHoursBaseRevision !== null || state.screen !== "office-settings" || !state.seasonSettings) return;
    siteHoursBaseRevision = Number(state.seasonSettings.schedule?.revision ?? 0);
  }

  // Change the SIDN. Spaces, hyphens and case are ignored here as they are
  // by the database, so a malformed number is said without sending it; the
  // number goes as typed and is never kept in state.
  async function saveSidn(sidn) {
    if (state.busy || !staffWindow() || !state.seasonSettings) return null;
    const typed = String(sidn ?? "");
    if (!/^S[0-9]{8}$/.test(typed.replace(/[\s-]/g, "").toUpperCase())) {
      state.seasonSettingsUi = { ...state.seasonSettingsUi, sidnError: STAFF_SIDN_FORMAT_MESSAGE };
      show();
      return null;
    }
    const answer = await settingsWrite(
      // A lost answer is sent again only for the same number typed again.
      JSON.stringify({ type: "sidn", typed }),
      () => ({ actionId: newActionId(), sidn: typed }),
      (request) => store.setSiteNumber(request),
      (error) => {
        if (error?.code !== "VALIDATION") return false;
        state.seasonSettingsUi = { ...state.seasonSettingsUi, sidnError: STAFF_SIDN_FORMAT_MESSAGE };
        return true;
      },
    );
    return answer ? STAFF_SIDN_UPDATED : null;
  }

  // Start next season (change add-start-next-season, design D8): the year
  // typed must be the next one (the dialog's confirm waits for it too), sent
  // with the season the page read. SEASON_NOT_FINISHED keeps the dialog open
  // with its counts; CONFLICT closes it and says so in the card. On success
  // the workspace and the clearance are read again: the starter has no roles
  // in the new season, so the clearance routing gives them the setup screen;
  // a starter still cleared reads the lists again. Other windows learn
  // through the realtime `workspaces` change and their own account checks.
  // Resolves to the toast's text, or null.
  async function startNextSeason(typedYear) {
    const season = Number(state.seasonSettings?.season);
    const typed = String(typedYear ?? "").trim();
    if (!Number.isInteger(season) || typed !== String(season + 1)) return null;
    if (state.busy || startingSeason) return null;
    // The season this dialog is about, for a re-read that shows it moved.
    if (state.dialog === "start-season" && state.dialogContext?.expectedSeason == null)
      state.dialogContext = { ...state.dialogContext, expectedSeason: season };
    startingSeason = true;
    let answer;
    try {
      answer = await settingsWrite(
        JSON.stringify({ type: "start-season", expectedSeason: season, typed }),
        () => ({ actionId: newActionId(), expectedSeason: season, typedYear: season + 1 }),
        (request) => store.startNextSeason(request),
        (error) => {
          if (error?.code === "INVALID_TRANSITION" && error?.cause?.message === "SEASON_NOT_FINISHED") {
            let counts = null;
            try {
              counts = JSON.parse(String(error.cause.details ?? ""));
            } catch {
              counts = null;
            }
            if (!counts || typeof counts !== "object" || Array.isArray(counts)) return false;
            // Nothing to list: the window's own error, never an empty refusal.
            if (!seasonRefusalLines(counts).length) return false;
            state.seasonSettingsUi = { ...state.seasonSettingsUi, startRefusal: counts };
            return true;
          }
          if (error?.code === "CONFLICT") {
            state.dialog = null;
            state.dialogContext = null;
            state.seasonSettingsUi = {
              ...state.seasonSettingsUi,
              notice: { place: "next-season", text: STAFF_SEASON_MOVED_MESSAGE },
            };
            return true;
          }
          return false;
        },
      );
    } finally {
      startingSeason = false;
    }
    if (answer) return await seasonStartLanded(Number(answer.season ?? season + 1));
    // An answer that never came, for a start that did land: the re-read
    // already shows the next season (I1).
    return await seasonMovedUnderDialog(state.seasonSettings?.season);
  }

  // The start is out: its own answer decides, not a re-read in the middle.
  let startingSeason = false;

  // The Start next season dialog is open for the season it was opened at,
  // and a re-read (Season settings, the workspace) shows another. One more
  // is that start having landed, here or in another window: the success
  // tail runs, and pressing again can never start the season after. Any
  // other season just closes the dialog. Resolves to the toast's text when
  // it landed, else null.
  async function seasonMovedUnderDialog(current) {
    if (startingSeason || state.dialog !== "start-season") return null;
    const expected = Number(state.dialogContext?.expectedSeason);
    if (current == null || !Number.isInteger(expected) || Number(current) === expected) return null;
    if (Number(current) === expected + 1) return await seasonStartLanded(expected + 1);
    state.dialog = null;
    state.dialogContext = null;
    show();
    return null;
  }

  // A start landed: close the dialog, forget a lost answer kept for it, and
  // read the workspace and the clearance again. The starter has no roles in
  // the new season, so the clearance routing gives them the setup screen; a
  // window still cleared reads the lists again.
  async function seasonStartLanded(season) {
    state.dialog = null;
    state.dialogContext = null;
    if (pendingSettingsWrite && JSON.parse(pendingSettingsWrite.key)?.type === "start-season") pendingSettingsWrite = null;
    // A lost answer's notice is answered: the start went through.
    if (UNKNOWN_OUTCOME.includes(state.error?.code)) state.error = null;
    try {
      await loadWorkspace();
    } catch (error) {
      noteFailure(error);
    }
    await recheckAfterOwnSave();
    if (!staffWindow()) return null;
    if (awaitingClearance(state)) {
      // Finish your setup: the new season's roster has no roles for them yet.
      state.screen = homeScreen();
      persistSession();
      show(true);
    } else {
      await refresh();
      show();
    }
    return `The ${season} season has started`;
  }

  // Add (the picker's volunteer) or Remove (a row's), at the account
  // revision the page read. Resolves to the toast's text, or null.
  async function changeSiteCoordinator(volunteerId, granted) {
    const view = state.seasonSettings;
    if (!volunteerId || !view) return null;
    const list = granted ? view.candidates : view.siteCoordinators;
    const person = (Array.isArray(list) ? list : []).find((entry) => entry?.volunteerId === volunteerId);
    if (!person) return null;
    const name = person.name ?? "";
    const expectedRevision = Number(person.accountRevision);
    const answer = await settingsWrite(
      JSON.stringify({ type: "coordinator", volunteerId, granted, expectedRevision }),
      () => ({ actionId: newActionId(), volunteerId, expectedRevision, granted }),
      (request) => store.setSiteCoordinator(request),
      (error) => {
        const reason = error?.cause?.message;
        const text =
          error?.code === "INVALID_TRANSITION" && reason === "LAST_SITE_COORDINATOR"
            ? STAFF_LAST_SITE_COORDINATOR_MESSAGE
            : error?.code === "INVALID_TRANSITION" && reason === "DEFAULT_FOLLOWUP"
              ? `${name} is the default follow-up person, so they stay a site coordinator.`
              : // Somebody else changed them first: the page read again shows how.
                error?.code === "CONFLICT" || error?.code === "INVALID_TRANSITION"
                ? STAFF_SETTINGS_CONFLICT_MESSAGE
                : null;
        if (!text) return false;
        state.seasonSettingsUi = { ...state.seasonSettingsUi, notice: { place: "coordinators", text } };
        return true;
      },
    );
    if (!answer) return null;
    // Their own mark changed what they may do here and on the Roster: ask
    // again, as a save of their own Roster row does. Not awaited.
    if (volunteerId === state.principal?.personId) void recheckAfterOwnSave();
    return granted ? `${name} is now a site coordinator` : `${name} is no longer a site coordinator`;
  }

  const addSiteCoordinator = (volunteerId) => changeSiteCoordinator(volunteerId, true);
  const removeSiteCoordinator = (volunteerId) => changeSiteCoordinator(volunteerId, false);

  function copyUpdateForm(form) {
    const source = form && typeof form === "object" ? form : {};
    return { ...source, roles: Array.isArray(source.roles) ? [...source.roles] : [] };
  }

  // The form as typed: kept, never drawn (the page draws its own preview),
  // so a re-render cannot empty a field somebody is using.
  function setUpdateForm(form) {
    state.updateForm = copyUpdateForm(form);
  }

  // Edit from the table: the form holds the row, and the save carries its
  // revision. A draft, a posted update or an unpublished one is edited (an
  // unpublished one stays unpublished).
  function editUpdate(id) {
    const row = state.postedUpdates.find((entry) => entry?.id === id);
    if (!row || !EDITABLE_UPDATE_STATUSES.includes(row.status)) return false;
    state.updateForm = {
      kind: row.kind,
      title: String(row.title ?? ""),
      message: String(row.message ?? ""),
      irsLink: row.irsLink ?? "",
      audience: row.audience === "roles" ? "roles" : "everyone",
      roles: Array.isArray(row.roles) ? [...row.roles] : [],
      keepTopUntil: row.keepTopUntil ?? "",
      askConfirm: Boolean(row.askConfirm),
      askAgain: false,
    };
    state.updateEditing = { id: row.id, revision: Number(row.revision), status: row.status };
    state.updateFormError = null;
    pendingUpdateSave = null;
    show();
    return true;
  }

  function resetUpdateForm() {
    state.updateForm = emptyUpdateForm();
    state.updateEditing = null;
    state.updateFormError = null;
    pendingUpdateSave = null;
  }

  function cancelUpdateEdit() {
    resetUpdateForm();
    show();
  }

  // What a VALIDATION refusal's field says, in the form's own words.
  function updateFieldError(field, form) {
    const messages = {
      kind: "Choose a type.",
      title: "Enter a title of up to 120 characters.",
      message: "Enter a message of up to 2000 characters.",
      irsLink:
        form?.kind === "office_notice" ? "Only IRS policy updates link to the IRS." : "Use an https link on irs.gov.",
      roles: "Choose at least one role.",
    };
    return Object.hasOwn(messages, field) ? { [field]: messages[field] } : { form: STAFF_UPDATE_FORM_MESSAGE };
  }

  // A refused or lost update write: CONFLICT, INVALID_TRANSITION and
  // NOT_FOUND (another admin deleted it) are said in their own words,
  // anything else as it came. The table is read again either way: what the
  // write did, or what changed under it.
  async function noteUpdateFailure(error) {
    const message =
      error?.code === "CONFLICT"
        ? STAFF_UPDATE_CONFLICT_MESSAGE
        : error?.code === "INVALID_TRANSITION"
          ? STAFF_UPDATE_TRANSITION_MESSAGE
          : error?.code === "NOT_FOUND"
            ? STAFF_UPDATE_GONE_MESSAGE
            : undefined;
    noteFailure(error, message ? { message } : undefined);
    await readPostedUpdates().catch(() => {});
    show();
  }

  // An edit refused because another admin changed the update first. The form
  // keeps what this admin typed and now carries the update's current revision
  // and status, with their title and message beside it (`conflict`): saving
  // again replaces their version, Cancel leaves it. Without this every retry
  // sent the stale revision and met the same CONFLICT. False when the table
  // can't be read again, the update is gone or can no longer be edited, or
  // the form has moved on to something else meanwhile.
  async function takeUpdateConflict(id) {
    try {
      await readPostedUpdates();
    } catch {
      return false;
    }
    const row = state.postedUpdates.find((entry) => entry?.id === id);
    if (!row || !EDITABLE_UPDATE_STATUSES.includes(row.status) || state.updateEditing?.id !== id) return false;
    state.updateEditing = {
      id,
      revision: Number(row.revision),
      status: row.status,
      conflict: { title: String(row.title ?? ""), message: String(row.message ?? "") },
    };
    state.updateFormError = null;
    state.error = null;
    show();
    return true;
  }

  // After a write landed: the table and the feed (the admin may be in the
  // audience) as they are now.
  async function afterUpdateWrite() {
    try {
      await readPostedUpdates();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    await readFeed();
    show();
  }

  // Save draft, Post update and Save changes. Resolves to the store's
  // receipt (`{actionId, updateId, revision, status}`) when it landed, and
  // null when it did not; the form keeps what was typed until it lands.
  // A save whose answer never came is kept, as the Roster's is: the same
  // press with the same form sends that very request, so its action id is
  // the same and the database replays its receipt (Review Focus 4).
  async function saveUpdate(form, { post = false } = {}) {
    if (state.busy || !staffWindow()) return null;
    const typed = copyUpdateForm(form);
    state.updateForm = typed;
    const editing = state.updateEditing ? { ...state.updateEditing } : null;
    const key = JSON.stringify({ typed, post: Boolean(post), editing });
    let request = pendingUpdateSave?.key === key ? pendingUpdateSave.request : null;
    pendingUpdateSave = null;
    if (!request) {
      // A date before today (New York) is refused, except the saved date of
      // the update being edited.
      const saved = editing ? state.postedUpdates.find((entry) => entry?.id === editing.id) : null;
      const problem = validateUpdate(typed, {
        today: nowInput(clock()).slice(0, 10),
        savedKeepTopUntil: saved?.keepTopUntil ?? null,
      });
      if (problem) {
        state.updateFormError = problem;
        show();
        return null;
      }
      // "Ask everyone to read it again" goes only with a posted update, and
      // an unpublished update's save never asks to post it.
      const askAgain = editing?.status === "posted" && typed.askAgain === true;
      const posting = Boolean(post) && editing?.status !== "unpublished";
      request = {
        actionId: newActionId(),
        updateId: editing?.id ?? null,
        expectedRevision: editing ? editing.revision : null,
        update: toUpdateRequest(typed, { post: posting, askAgain }),
      };
    }
    state.updateFormError = null;
    state.busy = true;
    state.error = null;
    show();
    let result;
    try {
      result = await store.saveUpdate(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingUpdateSave = { key, request };
      if (error?.code === "VALIDATION") {
        state.updateFormError = updateFieldError(error?.cause?.details, typed);
        show();
        return null;
      }
      if (error?.code === "CONFLICT" && editing && (await takeUpdateConflict(editing.id))) return null;
      await noteUpdateFailure(error);
      return null;
    }
    state.busy = false;
    noteConnected();
    resetUpdateForm();
    await afterUpdateWrite();
    return result ?? { status: request.update.post ? "posted" : "draft" };
  }

  // A table action: POST (a draft), UNPUBLISH (a posted update) or DELETE
  // (a draft), with the revision the table shows. Resolves to the receipt,
  // or null. A lost answer is kept and resent unchanged, as a save is.
  async function updateAction(id, type) {
    if (state.busy || !staffWindow() || !UPDATE_ACTIONS.includes(type)) return null;
    const row = state.postedUpdates.find((entry) => entry?.id === id);
    if (!row) {
      noteFailure({ code: "NOT_FOUND" }, { message: STAFF_UPDATE_GONE_MESSAGE });
      show();
      return null;
    }
    const key = JSON.stringify({ id, type, revision: Number(row.revision) });
    let request = pendingUpdateAction?.key === key ? pendingUpdateAction.request : null;
    pendingUpdateAction = null;
    if (!request)
      request = { actionId: newActionId(), updateId: id, expectedRevision: Number(row.revision), type };
    state.busy = true;
    state.error = null;
    show();
    let result;
    try {
      result = await store.updateAction(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingUpdateAction = { key, request };
      await noteUpdateFailure(error);
      return null;
    }
    state.busy = false;
    noteConnected();
    // The form held that update at its old revision: it is done with.
    if (state.updateEditing?.id === id) resetUpdateForm();
    await afterUpdateWrite();
    return result ?? { status: type };
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

  // The window of an account with no membership (or an access this app no
  // longer has). `getPrincipal` is the only store call it makes; focus,
  // online and Try again ask it again, so a granted membership is noticed.
  function showNoAccess(error) {
    state.principal = null;
    noteFailure(error, { message: "You do not have access to this step." });
    state.screen = "no-access";
    show();
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
      if (error?.code === "FORBIDDEN") state.screen = "no-access";
      show();
      return;
    }
    // Only staff and applicant accounts get a window. Any other access has
    // the same answer as no membership: the no-access screen, nothing read,
    // no channel opened and no place saved for this window.
    if (principal?.access !== "staff" && principal?.access !== "applicant") {
      showNoAccess({ code: "FORBIDDEN" });
      return;
    }
    state.principal = principal;
    state.authError = null;
    windowState.clearAccess();
    restoreSession();
    // A staff window lands on the work board and a client on their applications,
    // unless this window was already somewhere this principal may be.
    if (!screenAllowed(state.screen)) state.screen = homeScreen();
    state.error = null;
    if (awaitingClearance(state)) {
      await holdForClearance();
      return;
    }
    await loadWork();
  }

  // The work a cleared staff window (or any client window) reads: its lists,
  // the realtime channel and the open case. `focus` moves the keyboard to the
  // rebuilt page, as navigation does (the window just became cleared).
  async function loadWork({ focus = false } = {}) {
    // The feed first: it never fails the load, and the load never stops it.
    await readFeed();
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
    show(focus);
    // A reload on a case page: the people are in.
    void startScreeningIfDue();
  }

  // ---- clearance (change add-volunteer-clearance, design D10) -------------
  //
  // An uncleared staff window shows the setup screen and holds no work: no
  // case, no help request, no workspace row and no realtime channel. A
  // workspace admin's window keeps the Roster, which needs none of them.
  // A schedule viewer keeps the Schedule and My profile, cleared or not
  // (design D11).
  const keepsSchedule = () => SCHEDULE_SCREENS.includes(state.screen) && scheduleViewer(state.principal);
  function dropWork() {
    unsubscribe();
    clearSelection();
    dataLoaded = false;
    state.cases = [];
    state.assistance = [];
    state.lists = { ...state.lists, cases: "loading", assistance: "loading" };
    state.dialog = null;
    state.dialogContext = null;
    // The Workload is case data: back to the Roster.
    state.volunteerTab = "roster";
    endNotifications();
    if (!(ceilingAdmin(state.principal) && ADMIN_SETUP_SCREENS.includes(state.screen)) && !keepsSchedule())
      state.screen = "staff";
    // A viewer kept on the Schedule keeps a channel for it alone.
    syncScheduleChannel();
  }

  async function holdForClearance() {
    dropWork();
    persistSession();
    show();
    // The feed is the setup screen's too.
    await readFeed();
    show();
    if (state.screen === "office-volunteers") await loadVolunteers();
    if (state.screen === "office-updates") await loadPostedUpdates();
    if (state.screen === "office-settings") await loadSeasonSettings();
    if (state.screen === "schedule") await loadScheduleDay();
    if (state.screen === "my-profile") await loadMyProfile();
  }

  // An action refused NOT_CLEARED: the window is not cleared any more. It
  // drops the work, shows the setup screen and asks again.
  function loseClearance() {
    state.principal = {
      ...state.principal,
      clearance: { ...(state.principal.clearance ?? {}), cleared: false },
    };
    dropWork();
    state.error = null;
    state.retryable = false;
    persistSession();
    void checkClearance();
  }

  // Re-reads `vitally_my_clearance` (Check again, focus). One request at a
  // time: a call while one is out gets the same promise. Only `cleared` says
  // cleared; an answer that is no clearance at all is a failure, with Try
  // again. Never rejects.
  // Signing out forgets the pending check (forgetUser), so a check that
  // settles after that clears only itself.
  let clearanceCheck = null;
  function checkClearance() {
    if (!clearanceCheck) {
      const check = recheckClearance().finally(() => {
        if (clearanceCheck === check) clearanceCheck = null;
      });
      clearanceCheck = check;
    }
    return clearanceCheck;
  }

  // The same effective capabilities (as a set) and the same ceiling flag.
  const sameStanding = (before, after) => {
    const had = new Set(before?.capabilities ?? []);
    const has = new Set(after?.capabilities ?? []);
    return (
      had.size === has.size &&
      [...has].every((capability) => had.has(capability)) &&
      (before?.isAdmin === true) === (after?.isAdmin === true)
    );
  };

  // A clearance read refused FORBIDDEN may mean the account lost its
  // membership (Deactivate, or Start next season): a deactivated member gets
  // no realtime, so a wake is how its window learns. The principal is read
  // once more. Refused, or no longer staff, the window becomes the first
  // load's no-access window, holding nothing of the work and no channel.
  // A member still active keeps the refusal as it was. Resolves true when
  // the window went to no-access.
  async function lostMembership(asked) {
    let gone;
    try {
      // An applicant answer counts as gone too: a deactivated staff membership
      // never reads as applicant, and the next wake's load() corrects it.
      gone = (await store.getPrincipal())?.access !== "staff";
    } catch (error) {
      gone = error?.code === "FORBIDDEN";
    }
    if (!gone || !staffWindow() || state.principal.userId !== asked) return false;
    forgetUser();
    // Still signed in: focus, online and Try again ask for the principal
    // again, as on a first load with no membership.
    state.session = "present";
    showNoAccess({ code: "FORBIDDEN" });
    return true;
  }

  async function recheckClearance() {
    if (!staffWindow()) return;
    // A cancelled site check has no membership left to ask about: the screen
    // says so and offers only Sign out.
    if (state.siteCheck?.cancelled) return;
    const asked = state.principal.userId;
    const same = () => staffWindow() && state.principal.userId === asked;
    let answer;
    try {
      answer = await store.getClearance();
      if (!answer || typeof answer !== "object" || Array.isArray(answer) || !Array.isArray(answer.capabilities))
        throw controllerError("SERVER_ERROR", "Something went wrong.");
    } catch (error) {
      if (same() && error?.code === "FORBIDDEN" && (await lostMembership(asked))) return;
      if (same()) noteLocalFailure(error, checkClearance, { clearanceRead: true });
      // The feed re-reads with every check, answered or not.
      await readFeed();
      if (same()) show();
      return;
    }
    if (!same()) return;
    noteConnected();
    const was = !awaitingClearance(state);
    const oldClearance = state.principal.clearance;
    state.principal = { ...state.principal, clearance: answer };
    // No longer a workspace admin: a later regain must not flash an old number.
    if (!ceilingAdmin(state.principal)) state.uploadsToReview = 0;
    // No longer a schedule viewer: the Schedule, My profile and their data go.
    const leftSchedule = SCHEDULE_SCREENS.includes(state.screen) && !scheduleViewer(state.principal);
    if (leftSchedule) leaveSchedule();
    // The person's own entry follows what they may do now.
    state.people = withOwnCapabilities(state.people, state.principal);
    // An earlier failed check's notice is answered.
    if (localRetry === checkClearance) {
      dropLocalRetry();
      state.error = null;
    }
    const now = !awaitingClearance(state);
    if (now && !was) {
      if (!ADMIN_SETUP_SCREENS.includes(state.screen) && !keepsSchedule()) state.screen = homeScreen();
      // The setup screen is replaced by the work: the keyboard goes to it.
      await loadWork({ focus: true });
      return;
    }
    if (now && was) {
      // Cleared before and after: nothing to reload, and nothing to draw unless
      // what the person may do changed. Their entry is already narrowed above.
      // The uploads count is the one thing that can still have moved.
      if (sameStanding(oldClearance, answer) && !leftSchedule) return redrawIfUploadsChanged(same);
      // All cases is Admin's; the other screens stay, and Admin coming back
      // moves nobody.
      let focus = leftSchedule;
      if (!answer.capabilities?.includes("admin") && state.screen === "office-cases") {
        state.screen = homeScreen();
        focus = true;
      }
      persistSession();
      show(focus);
      return redrawIfUploadsChanged(same);
    }
    if (!now && was) dropWork();
    // Still not cleared: the Schedule's channel follows the screen (it may
    // have been left above), and the feed re-reads with the check.
    syncScheduleChannel();
    await readFeed();
    persistSession();
    show();
    await redrawIfUploadsChanged(same);
  }

  // The uploads count, read after the clearance's own outcome is drawn, so a
  // slow or failed count never delays or changes it. Redraws only when the
  // number moved and the window is still the one that asked.
  async function redrawIfUploadsChanged(same) {
    if ((await readUploadsCount()) && same()) show();
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
    // The next user's first Check again asks afresh.
    clearanceCheck = null;
    wakeRefresh = null;
    afterRefusal = null;
    if (state.principal) windowState.clear(state.principal.userId);
    unsubscribe();
    clearSelection();
    state.session = "none";
    state.principal = null;
    state.cases = [];
    state.labels = [];
    state.labelMenu = null;
    pendingLabelWrites.clear();
    state.lists = {
      cases: "loading",
      assistance: "loading",
      volunteers: "loading",
      updates: "loading",
      postedUpdates: "loading",
      seasonSettings: "loading",
      schedule: "loading",
      myProfile: "loading",
    };
    dataLoaded = false;
    state.people = [];
    state.volunteers = [];
    state.volunteerFilters = { search: "", role: "all" };
    state.volunteerFormError = null;
    state.reviewReasonFor = null;
    state.volunteerAccountNotice = null;
    state.invitations = null;
    state.invitationsFailed = false;
    state.inviteEmail = "";
    state.inviteNotice = null;
    state.siteCheck = null;
    state.volunteerTab = "roster";
    state.workload = freshWorkloadView();
    pendingVolunteerSave = null;
    pendingUploadSend = null;
    pendingAccountAction = null;
    pendingInviteAction = null;
    state.updates = [];
    state.updatesUnread = 0;
    state.uploadsToReview = 0;
    endNotifications();
    state.postedUpdates = [];
    state.updateForm = emptyUpdateForm();
    state.updateEditing = null;
    state.updateFormError = null;
    pendingUpdateSave = null;
    pendingUpdateAction = null;
    state.seasonSettings = null;
    state.clientDocumentsUrl = null;
    state.seasonSettingsUi = freshSettingsUi();
    pendingSettingsWrite = null;
    siteHoursBaseRevision = null;
    state.schedule = freshSchedule();
    pendingShiftWrite = null;
    state.myProfile = null;
    pendingProfileSave = null;
    profileFormRevision = null;
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
    // The no-access window has nowhere to go: the logo and every other
    // navigation do nothing, so the screen and its Sign out stay.
    if (state.screen === "no-access" && !state.principal) return;
    // Post an update and Season settings are a workspace admin's: anyone else
    // lands on their home.
    if (CEILING_ONLY_SCREENS.includes(screen) && !screenAllowed(screen)) screen = homeScreen();
    // The Schedule is a schedule viewer's (design D11).
    if (SCHEDULE_SCREENS.includes(screen) && !screenAllowed(screen)) screen = homeScreen();
    // Leaving the Schedule leaves its drawer.
    if (screen !== "schedule") state.schedule = { ...state.schedule, drawer: null };
    // My profile is a cleared window's: an uncleared one stays on its home.
    if (CLEARED_ONLY_SCREENS.includes(screen) && !screenAllowed(screen)) screen = homeScreen();
    // Season settings starts without an earlier visit's sentences.
    if (screen === "office-settings") state.seasonSettingsUi = freshSettingsUi();
    // Leaving or opening a page ends its draft, and the revision it began at.
    siteHoursBaseRevision = null;
    // A new office draft belongs to the Add a case page: leaving drops it.
    if (screen !== "office-add-case") {
      state.officeDraft = false;
      state.officeDraftCaseId = null;
      state.addCaseShowMissing = false;
    }
    state.screen = screen;
    state.labelMenu = null;
    state.error = null;
    state.dialog = null;
    state.dialogContext = null;
    endNotifications();
    // An uncleared window opens or releases the Schedule's channel.
    syncScheduleChannel();
    persistSession();
    show(true);
    // My profile is read each time it opens. The promise is returned for
    // callers that wait on the read; it never rejects.
    if (screen === "my-profile") return loadMyProfile();
    return undefined;
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

  // The questions the drawer's Account section asks; the office panel asks
  // the same two with an email and no volunteer.
  const DRAWER_QUESTIONS = Object.freeze(["send-invitation", "cancel-invitation"]);

  function openDialog(name, context = null) {
    // The shift drawer opens only on the Schedule, for an admin (openShiftDrawer).
    if (name === "shift") return openShiftDrawer(context?.shiftId ?? null);
    if (name !== "notifications") endNotifications();
    // Change the SIDN and Start next season open without an earlier refusal.
    if (name === "change-sidn") state.seasonSettingsUi = { ...state.seasonSettingsUi, sidnError: null };
    if (name === "start-season") state.seasonSettingsUi = { ...state.seasonSettingsUi, startRefusal: null };
    state.dialog = name;
    state.dialogContext = context ? { ...context } : null;
    // Start next season is about the season the page read when it opened.
    if (name === "start-season" && state.seasonSettings?.season != null)
      state.dialogContext = { ...state.dialogContext, expectedSeason: Number(state.seasonSettings.season) };
    show();
  }

  function closeDialog() {
    // Keeping the shift goes back to its drawer; closing the drawer drops its draft.
    if (state.dialog === "remove-shift" && state.schedule.drawer) {
      state.dialog = "shift";
      state.dialogContext = { shiftId: state.schedule.drawer.shiftId };
      show();
      return;
    }
    if (state.dialog === "shift" || state.dialog === "remove-shift")
      state.schedule = { ...state.schedule, drawer: null };
    // Keeping the account (or not sending, or keeping the invitation) goes
    // back to the drawer it was asked from.
    if (
      state.dialog === "deactivate-account" ||
      (DRAWER_QUESTIONS.includes(state.dialog) && state.dialogContext?.volunteerId)
    ) {
      state.dialog = "volunteer";
      show();
      return;
    }
    state.dialog = null;
    state.dialogContext = null;
    endNotifications();
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
      // Not cleared: the setup screen says it, like any other action (#193).
      if (error?.code === "NOT_CLEARED") {
        held.gaveUp = true;
        noteFailure(error);
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
  // `mode` is what distinguishes a client's own application from
  // one the office typed in for a walk-in; the idempotency, the receipt and the
  // "what happens next" hook are the same for both, so they are written once.
  // `select: false` (the office's new draft) only creates: the caller reads
  // and adopts the case itself.
  async function startCase({ mode, answers }, afterReceipt, { select = true } = {}) {
    if (creating) return null;
    creating = true;
    if (!state.pendingCreateActionId) {
      state.pendingCreateActionId = newActionId();
      persistSession();
    }
    const request = {
      actionId: state.pendingCreateActionId,
      mode,
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
    return await startCase({ mode: "client", answers: {} }, () => {
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
        { mode: "assisted", answers: {} },
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
  async function runContactWrite(request, write, { rereadList = false } = {}) {
    state.busy = true;
    state.error = null;
    show();
    try {
      await write(request);
      state.busy = false;
      noteConnected();
      try {
        // A new entry moves the case's lastContactAt in the list (Workload's
        // Stalled count); an edit keeps the logged time, so it does not.
        if (rereadList) await loadList();
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

  // The case label menu (change add-case-labels). Its state is window-local.
  // A write whose answer never came (UNKNOWN_OUTCOME) may have landed, so the
  // same write pressed again sends that very request with its action id; the
  // stored receipt answers instead of a second write. Any other outcome
  // forgets it.
  const pendingLabelWrites = new Map();

  const labelRequest = (key, make) => pendingLabelWrites.get(key) ?? make();

  // One label write, shaped like `runContactWrite`: a refusal is shown and
  // thrown, and a CONFLICT re-reads the labels first.
  async function runLabelWrite(key, request, write) {
    state.busy = true;
    state.error = null;
    show();
    let result;
    try {
      result = await write(request);
      pendingLabelWrites.delete(key);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingLabelWrites.set(key, request);
      else pendingLabelWrites.delete(key);
      noteFailure(error);
      if (error?.code === "CONFLICT") await loadList().catch(() => {});
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    return result;
  }

  // A landed write whose re-read fails is a stale view, never a failed write.
  async function rereadAfterLabelWrite(caseId) {
    try {
      await loadList();
      if (caseId && caseId === state.selectedCaseId) await loadSelected();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
  }

  function openLabelMenu(caseId) {
    state.labelMenu = { caseId, search: "", editing: null };
    show();
  }

  function closeLabelMenu() {
    if (!state.labelMenu) return;
    state.labelMenu = null;
    show();
  }

  function setLabelSearch(text) {
    if (!state.labelMenu) return;
    state.labelMenu = { ...state.labelMenu, search: String(text ?? "") };
    show();
  }

  // An edit keeps the revision the form opened on (like the assign drawer's
  // basis): Save sends it, not the live list's, so a rename or recolor made
  // elsewhere while the form is open is refused with CONFLICT.
  function startLabelEdit(labelId = null, name = "") {
    if (!state.labelMenu) return;
    const current = labelId ? state.labels.find((label) => label.id === labelId) : null;
    state.labelMenu = {
      ...state.labelMenu,
      editing: {
        labelId: current ? labelId : null,
        revision: current ? Number(current.revision) : null,
        name: name || current?.name || "",
        color: current?.color ?? LABEL_COLORS[0],
        error: null,
      },
    };
    show();
  }

  // What the form holds as it is typed or picked, kept so a redraw (a live
  // refresh) draws it again. Quiet: the field already shows it, so no redraw.
  function setLabelDraft({ name, color } = {}) {
    const editing = state.labelMenu?.editing;
    if (!editing) return;
    state.labelMenu = {
      ...state.labelMenu,
      editing: {
        ...editing,
        ...(name !== undefined ? { name: String(name) } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    };
  }

  function cancelLabelEdit() {
    if (!state.labelMenu?.editing) return;
    state.labelMenu = { ...state.labelMenu, editing: null };
    show();
  }

  async function toggleCaseLabel(caseId, labelId, on) {
    const key = `toggle:${caseId}:${labelId}:${Boolean(on)}`;
    const request = labelRequest(key, () => ({
      actionId: newActionId(),
      caseId,
      labelId,
      on: Boolean(on),
    }));
    await runLabelWrite(key, request, (sent) => store.setCaseLabel(sent));
    await rereadAfterLabelWrite(caseId);
    show();
    return request;
  }

  function setLabelFormError(message) {
    state.labelMenu = {
      ...state.labelMenu,
      editing: { ...state.labelMenu.editing, error: message },
    };
  }

  // Save from the form. A create (labelId null) also puts the new label on the
  // case the menu is open for. A bad name or color, or a name the window can
  // see is taken, is said in the form and nothing is sent. A save whose answer
  // never came is sent again first: the re-read list may already hold the
  // label it created, which is no reason to refuse it.
  async function saveLabelEdit({ name, color }) {
    const editing = state.labelMenu?.editing;
    if (!editing || state.busy) return false;
    const trimmed = String(name ?? "").trim();
    const caseId = state.labelMenu.caseId;
    const { labelId } = editing;
    state.labelMenu = { ...state.labelMenu, editing: { ...editing, name: trimmed, color } };
    const key = `save:${labelId ?? "new"}:${trimmed}:${color}`;
    if (!pendingLabelWrites.has(key)) {
      let problem = null;
      if (trimmed.length < 1 || trimmed.length > 24) problem = "A label name is 1 to 24 characters";
      else if (!LABEL_COLORS.includes(color)) problem = "Pick one of the colors";
      else if (labelNameTaken(state.labels, trimmed, labelId))
        problem = "A label with this name already exists";
      if (problem) {
        setLabelFormError(problem);
        show();
        return false;
      }
    }
    setLabelFormError(null);
    const request = labelRequest(key, () => ({
      actionId: newActionId(),
      labelId,
      expectedRevision: labelId ? editing.revision : null,
      label: { name: trimmed, color },
    }));
    let saved;
    try {
      saved = await runLabelWrite(key, request, (sent) => store.saveLabel(sent));
    } catch (error) {
      // The labels were re-read on a CONFLICT; the form stays open and takes
      // the fresh revision, so the next save is judged against what is there now.
      if (error?.code === "CONFLICT" && state.labelMenu?.editing) {
        const fresh = state.labels.find((label) => label.id === labelId);
        state.labelMenu = {
          ...state.labelMenu,
          editing: {
            ...state.labelMenu.editing,
            ...(fresh ? { revision: Number(fresh.revision) } : {}),
          },
        };
        setLabelFormError("This label was changed elsewhere. Check it and save again");
        show();
      }
      throw error;
    }
    const savedId = saved?.labelId ?? labelId;
    if (!labelId && caseId && savedId) {
      try {
        await toggleCaseLabel(caseId, savedId, true);
      } catch (error) {
        // The label exists; the form closes and the error shows.
        if (state.labelMenu) state.labelMenu = { ...state.labelMenu, editing: null };
        await rereadAfterLabelWrite(caseId);
        show();
        throw error;
      }
    } else {
      await rereadAfterLabelWrite(caseId);
    }
    if (state.labelMenu) state.labelMenu = { ...state.labelMenu, editing: null };
    show();
    return true;
  }

  async function logContact(caseId, entry, followupId = null) {
    return await runContactWrite(
      {
        actionId: newActionId(),
        caseId,
        followupId,
        entry,
      },
      (request) => store.logContact(request),
      { rereadList: true },
    );
  }

  // The Roster drawer's save: Add when the drawer was opened for nobody, Edit
  // for the volunteer it names, at the revision this window read. A problem the
  // window can see (a missing role, a listed email) is said beside the form and
  // nothing is sent. A refusal is shown in the drawer and thrown, shaped like
  // `runContactWrite`, and any failure re-reads the list. A landed save whose
  // re-read fails is a stale list, never a failed save.
  //
  // A save whose answer never came (UNKNOWN_OUTCOME) may have landed, so, as
  // `dispatch` does, it is kept: Save pressed again for the same volunteer with
  // the same values sends that very request, and its stored receipt answers
  // instead of a second save (which an Add's own email would refuse). It skips
  // the window's checks, which the re-read list may now fail on the save's own
  // result. Changed values are a new save, with a new action id.
  // "I've uploaded it" on the setup screen (change add-clearance-uploads,
  // design D6). A send whose answer never came may have landed, so, as
  // saveVolunteer does, pressing it again for the same document sends the same
  // action id and the stored receipt answers. Refusals are said on the screen.
  // A refusal's reason is the database's detail (`cause.details`; its message
  // is VALIDATION), and it means the screen is stale (a photo ID no longer
  // needed, an entry removed): the clearance is asked again. After a send, a
  // check already out (a focus fired by the same click, say) was asked before
  // the send landed, so, as saveVolunteer does, it is followed by one more.
  const UPLOAD_REFUSALS = Object.freeze({
    PHOTO_ID_NOT_NEEDED: "Your photo ID doesn't need sending any more.",
    NO_ROSTER_ENTRY: "You're not on this season's roster yet. Ask your site coordinator.",
  });
  async function markUploadSent(document) {
    if (state.busy || !staffWindow()) return false;
    const request =
      pendingUploadSend?.request.document === document
        ? pendingUploadSend.request
        : { actionId: newActionId(), document };
    pendingUploadSend = null;
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.markUploadSent(request);
    } catch (error) {
      state.busy = false;
      // An earlier action's Try again does not belong beside this refusal.
      state.retryable = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingUploadSend = { request };
      const known = error?.code === "VALIDATION" ? UPLOAD_REFUSALS[String(error?.cause?.details ?? "")] : null;
      noteFailure(error, { message: known ?? (error?.code === "OFFLINE" ? undefined : "Something went wrong.") });
      show();
      if (error?.code === "VALIDATION") void recheckAfterOwnSave();
      // A stale My profile section: what it is now.
      if (error?.code === "VALIDATION" && state.screen === "my-profile") {
        await readMyProfile().catch(() => {});
        show();
      }
      return false;
    }
    state.busy = false;
    await recheckAfterOwnSave();
    // My profile shows the send: read it again (change add-my-profile, D9).
    if (state.screen === "my-profile") await readMyProfile().catch((error) => noteFailure(error));
    show();
    return true;
  }

  // The drawer's Mark reviewed (change add-clearance-uploads, design D7): the
  // admin has looked at a document the volunteer said they sent. It sends the
  // drawer volunteer's revision, as Save does, and then re-reads the Roster so
  // the next Save sends the new one. The drawer stays open and its typed
  // values are untouched. Returns the toast's text, or null when it did not
  // land (the banner says why). Since change add-my-profile (design D6) it
  // carries the reason the admin picked or typed, trimmed; the database
  // refuses an empty one or one over 120 characters.
  async function markUploadReviewed(document, reason) {
    if (state.busy || state.dialog !== "volunteer") return null;
    const volunteerId = state.dialogContext?.volunteerId ?? null;
    const current = volunteerId ? (state.volunteers.find((entry) => entry?.id === volunteerId) ?? null) : null;
    if (!current) throw refuse("NOT_FOUND", STAFF_VOLUNTEER_GONE_MESSAGE);
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.markUploadReviewed({
        actionId: newActionId(),
        volunteerId,
        expectedRevision: Number(current.revision),
        document,
        reason: String(reason ?? "").trim(),
      });
    } catch (error) {
      state.busy = false;
      // An earlier action's Try again does not belong beside this refusal.
      state.retryable = false;
      noteFailure(error, error?.code === "CONFLICT" ? { message: VOLUNTEER_CONFLICT_MESSAGE } : undefined);
      // What changed under it: the list as it is now.
      await readVolunteers().catch(() => {});
      show();
      return null;
    }
    state.busy = false;
    state.reviewReasonFor = null;
    noteConnected();
    try {
      await readVolunteers();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    show();
    return "Marked reviewed";
  }

  async function saveVolunteer(values) {
    if (state.busy) return false;
    const volunteerId = state.dialogContext?.volunteerId ?? null;
    // `values` is what the form held; the request may send fewer roles, so the
    // kept save is matched on the form's values.
    let request =
      pendingVolunteerSave &&
      pendingVolunteerSave.request.volunteerId === volunteerId &&
      JSON.stringify(pendingVolunteerSave.values) === JSON.stringify(values)
        ? pendingVolunteerSave.request
        : null;
    pendingVolunteerSave = null;
    if (!request) {
      const current = volunteerId
        ? (state.volunteers.find((entry) => entry?.id === volunteerId) ?? null)
        : null;
      if (volunteerId && !current)
        throw refuse("NOT_FOUND", STAFF_VOLUNTEER_GONE_MESSAGE);
      const problem = volunteerProblem(values, state.volunteers, volunteerId);
      if (problem) {
        state.volunteerFormError = problem;
        show();
        return false;
      }
      request = {
        actionId: newActionId(),
        volunteerId,
        expectedRevision: current ? Number(current.revision) : null,
        // The roles held before that lost a certificate are left out, as the
        // server drops them.
        volunteer: withoutLostRoles(values, state.volunteers, volunteerId),
      };
    }
    state.volunteerFormError = null;
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.saveVolunteer(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingVolunteerSave = { request, values };
      // The two refusals the form can say itself (the window's own checks can
      // disagree with the server's, for example on a stale form): in the form,
      // not as a banner. Anything unreadable stays the safe generic message.
      const cause = error?.cause;
      const sentence =
        error?.code === "VALIDATION" && cause?.message === "ROLE_NEEDS"
          ? roleNeedsMessage(cause.details)
          : error?.code === "INVALID_TRANSITION" && cause?.message === "OPEN_WORK"
            ? openWorkMessage(request.volunteer.name || "This volunteer", cause.details)
            : error?.code === "FORBIDDEN" && cause?.message === "ADMIN_ROLE"
              ? STAFF_ADMIN_ROLE_MESSAGE
              : null;
      if (sentence) {
        state.volunteerFormError = sentence;
        await readVolunteers().catch(() => {});
        show();
        return false;
      }
      noteFailure(
        error,
        error?.code === "CONFLICT" ? { message: VOLUNTEER_CONFLICT_MESSAGE } : undefined,
      );
      // What the save did, or what changed under it: the list as it is now.
      await readVolunteers().catch(() => {});
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    try {
      await readVolunteers();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    show();
    // Someone who just saved their own row may have changed their own roles
    // (#190, #191): ask again, so the setup screen gives way (or comes) and
    // the buttons follow, without Check again. Not awaited, so the drawer
    // closes on the save alone.
    if (volunteerId && volunteerId === state.principal?.personId) void recheckAfterOwnSave();
    return true;
  }

  // A check already out (a focus, say) was asked before the save landed, so
  // its answer may be the old one: wait for it, then ask once more.
  // checkClearance never rejects.
  async function recheckAfterOwnSave() {
    if (clearanceCheck) await clearanceCheck;
    await checkClearance();
  }

  // A refused action in a cleared window: a check already out was asked
  // before the refusal, so its answer may be the old one. Wait for it, then
  // ask once more, still only for a cleared window of the same user. Refusals
  // while one is waiting share it. Never rejects; never awaited.
  let afterRefusal = null;
  function recheckAfterRefusal() {
    if (!clearanceCheck) return checkClearance();
    if (afterRefusal) return afterRefusal;
    const asked = state.principal.userId;
    const pending = (async () => {
      await clearanceCheck;
      if (afterRefusal === pending) afterRefusal = null;
      if (staffWindow() && !awaitingClearance(state) && state.principal.userId === asked) await checkClearance();
    })();
    afterRefusal = pending;
    return pending;
  }

  // The drawer's Account section (change add-account-invitations): Create
  // account, Resend, Deactivate and Reactivate for the volunteer the drawer
  // names. A refusal with a sentence of its own (a missing email, open work, a
  // used email) is said in the drawer and returns false; a stale revision
  // (CONFLICT) or anything unreadable is the banner's message, thrown. An
  // answer that never came is kept: the same press again sends the same
  // action id. Create account, Cancel invitation and Deactivate are sent only
  // from their question (`asked`), which returns to the drawer whatever the
  // outcome.
  const ACCOUNT_ACTIONS = Object.freeze({
    create: { send: (request) => store.createAccount(request), asked: "send-invitation" },
    resend: { send: (request) => store.resendAccount(request) },
    deactivate: { send: (request) => store.deactivateAccount(request), asked: "deactivate-account" },
    reactivate: { send: (request) => store.reactivateAccount(request) },
    cancel: { send: (request) => store.cancelInvitation(request), asked: "cancel-invitation" },
  });
  const EMAIL_NOT_SENT = "The invitation email wasn't sent. Use Resend later.";
  const CREATED_NOT_SENT = "Account created; the invitation email wasn't sent. Use Resend later.";
  // A replayed answer (the same action id again) sent nothing this time, but
  // the first attempt did (decision 6).
  const ALREADY_SENT = "This invitation was already sent. If it didn't arrive, use Resend.";
  const INVITATION_CANCELLED = "Invitation cancelled.";
  const NOT_CANCELLABLE = "This invitation can no longer be cancelled.";
  // IN_USE (design D15): the account was already used, so it is not cancelled.
  const IN_USE_NOT_CANCELLABLE = "This account is already in use, so the invitation can't be cancelled.";
  const cancelRefusal = (error) =>
    error?.cause?.details === "IN_USE" ? IN_USE_NOT_CANCELLABLE : NOT_CANCELLABLE;

  async function runAccountAction(kind) {
    const action = ACCOUNT_ACTIONS[kind];
    if (state.busy || !action) return false;
    if (state.dialog !== (action.asked ?? "volunteer")) return false;
    const volunteerId = state.dialogContext?.volunteerId ?? null;
    const current = volunteerId
      ? (state.volunteers.find((entry) => entry?.id === volunteerId) ?? null)
      : null;
    if (!current) throw refuse("NOT_FOUND", STAFF_VOLUNTEER_GONE_MESSAGE);
    const revision = current.account?.revision ?? null;
    const key = `${kind}:${volunteerId}:${revision}`;
    const id = pendingAccountAction?.key === key ? pendingAccountAction.actionId : newActionId();
    const request =
      kind === "cancel"
        ? { actionId: id, target: { volunteerId }, expectedRevision: revision }
        : {
            actionId: id,
            volunteerId,
            ...(kind === "deactivate" || kind === "reactivate" ? { expectedRevision: revision } : {}),
          };
    pendingAccountAction = null;
    state.volunteerAccountNotice = null;
    state.busy = true;
    state.error = null;
    show();
    // The question closes into the drawer, so its notice and errors show there.
    const backToDrawer = () => {
      if (action.asked && state.dialog === action.asked) state.dialog = "volunteer";
    };
    let result;
    try {
      result = await action.send(request);
    } catch (error) {
      state.busy = false;
      backToDrawer();
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingAccountAction = { key, actionId: request.actionId };
      const cause = error?.cause;
      const sentence =
        cause?.message === "OPEN_WORK"
          ? openWorkMessage(current.name || "This volunteer", cause.details)
          : error?.code === "INVALID_TRANSITION" && cause?.message === "LAST_SITE_COORDINATOR"
            ? STAFF_LAST_SITE_COORDINATOR_MESSAGE
            : kind === "deactivate" && error?.code === "FORBIDDEN" && current.isSiteCoordinator === true
              ? STAFF_DEACTIVATE_SITE_COORDINATOR_MESSAGE
              : error?.code === "CONFLICT"
                ? null
                : kind === "cancel" && error?.code === "INVALID_TRANSITION"
                  ? cancelRefusal(error)
                  : accountMessage(cause?.details);
      if (sentence) {
        state.volunteerAccountNotice = { kind: "error", text: sentence };
        await readVolunteers().catch(() => {});
        show();
        return false;
      }
      noteFailure(
        error,
        error?.code === "CONFLICT" ? { message: VOLUNTEER_CONFLICT_MESSAGE } : undefined,
      );
      await readVolunteers().catch(() => {});
      show();
      throw error;
    }
    state.busy = false;
    backToDrawer();
    noteConnected();
    const sent = result?.emailSent === true && result?.replay !== true;
    state.volunteerAccountNotice = {
      kind: "ok",
      text:
        kind === "create"
          ? result?.replay === true
            ? ALREADY_SENT
            : sent
              ? "Account created and invitation sent"
              : CREATED_NOT_SENT
          : kind === "cancel"
            ? INVITATION_CANCELLED
            : kind === "resend"
              ? sent
                ? "Invitation sent"
                : EMAIL_NOT_SENT
              : kind === "deactivate"
                ? "Account deactivated"
                : result?.status === "invited"
                  ? "Account reactivated. Use Resend to send the invitation."
                  : "Account reactivated",
    };
    try {
      await readVolunteers();
      state.error = null;
    } catch (error) {
      noteFailure(error);
    }
    show();
    return true;
  }

  // Invite a client asks first (decision 5): the typed email is kept and the
  // question names it, trimmed. An empty email is refused here, with no
  // question. Nothing is sent until `inviteClient` is called from the question.
  function askInviteClient(rawEmail) {
    if (state.busy) return false;
    const email = String(rawEmail ?? "");
    state.inviteEmail = email;
    if (!email.trim()) {
      state.inviteNotice = { kind: "error", text: accountMessage("NO_EMAIL") };
      show();
      return false;
    }
    state.inviteNotice = null;
    openDialog("send-invitation", { email: email.trim() });
    return true;
  }

  // The question's Send (no volunteer): the panel's invite, closing the
  // question first so the panel says the result.
  async function inviteClient() {
    if (state.dialog !== "send-invitation" || state.dialogContext?.volunteerId) return false;
    const email = state.dialogContext?.email ?? "";
    state.dialog = null;
    state.dialogContext = null;
    return await runClientInvite("invite", email);
  }

  // Invite a client / Resend (the office screen's panel). The action id is
  // kept across an OFFLINE or SERVER_ERROR retry of the same email, like the
  // drawer's. A refusal is said in the panel, and what was typed stays.
  async function runClientInvite(kind, rawEmail) {
    if (state.busy) return false;
    const email = String(rawEmail ?? "");
    if (!email.trim()) {
      state.inviteNotice = { kind: "error", text: accountMessage("NO_EMAIL") };
      show();
      return false;
    }
    const key = `${kind}:${email.trim().toLowerCase()}`;
    const request = {
      actionId: pendingInviteAction?.key === key ? pendingInviteAction.actionId : newActionId(),
      email,
    };
    pendingInviteAction = null;
    state.inviteNotice = null;
    state.busy = true;
    state.error = null;
    show();
    let result;
    try {
      result = await (kind === "invite" ? store.inviteClient(request) : store.resendClient(request));
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingInviteAction = { key, actionId: request.actionId };
      const sentence = error?.code === "CONFLICT" ? null : accountMessage(error?.cause?.details);
      if (sentence) {
        state.inviteNotice = { kind: "error", text: sentence };
        await readInvitations();
        show();
        return false;
      }
      noteFailure(error);
      await readInvitations();
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    const sent = result?.emailSent === true && result?.replay !== true;
    state.inviteNotice = {
      kind: "ok",
      text:
        kind === "invite"
          ? result?.replay === true
            ? ALREADY_SENT
            : sent
              ? "Account created and invitation sent"
              : CREATED_NOT_SENT
          : sent
            ? "Invitation sent"
            : EMAIL_NOT_SENT,
    };
    if (kind === "invite") state.inviteEmail = "";
    await readInvitations();
    show();
    return true;
  }

  const resendClient = (email) => runClientInvite("resend", email);

  // The office list's Cancel, from its question: the email and the account
  // revision the row showed. INVALID_TRANSITION is said in the panel; a stale
  // row or anything unreadable goes to the safety net. The list is re-read
  // whatever the outcome.
  async function cancelClientInvitation() {
    if (state.busy || state.dialog !== "cancel-invitation" || state.dialogContext?.volunteerId) return false;
    const email = String(state.dialogContext?.email ?? "");
    const revision = Number(state.dialogContext?.revision);
    state.dialog = null;
    state.dialogContext = null;
    const key = `cancel:${email.toLowerCase()}:${revision}`;
    const request = {
      actionId: pendingInviteAction?.key === key ? pendingInviteAction.actionId : newActionId(),
      target: { email },
      expectedRevision: revision,
    };
    pendingInviteAction = null;
    state.inviteNotice = null;
    state.busy = true;
    state.error = null;
    show();
    try {
      await store.cancelInvitation(request);
    } catch (error) {
      state.busy = false;
      if (UNKNOWN_OUTCOME.includes(error?.code)) pendingInviteAction = { key, actionId: request.actionId };
      if (error?.code === "INVALID_TRANSITION") {
        state.inviteNotice = { kind: "error", text: cancelRefusal(error) };
        await readInvitations();
        show();
        return false;
      }
      noteFailure(error);
      await readInvitations();
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    state.inviteNotice = { kind: "ok", text: INVITATION_CANCELLED };
    await readInvitations();
    show();
    return true;
  }

  // The cancel question's confirm: the drawer's (a volunteer) or the office
  // list's (an email).
  const cancelInvitation = () =>
    state.dialogContext?.volunteerId ? runAccountAction("cancel") : cancelClientInvitation();

  // ---- the site check (change add-account-invitations, decision 4) --------
  //
  // An invited volunteer's first sign-in: their name and this site's SIDN.
  // The right number makes the account active and the clearance is read
  // again, so the window moves on to the setup screen or the work. A wrong
  // number keeps the name and says so; a cancelled invitation replaces the
  // form. A refusal the screen can say is said there; anything else goes to
  // the safety net. Answers "active", "wrong-site", "cancelled", "invalid",
  // or null when this window has no site check.
  const SITE_CHECK_TEXT = Object.freeze({
    NO_NAME: "Enter your name.",
    NO_SIDN: "Enter this site's SIDN.",
    SITE_NOT_SET: "This site isn't set up for sign-in yet. Ask your site coordinator.",
  });
  const WRONG_SITE_TEXT = "That isn't this site's number.";

  async function completeSiteCheck(rawName, rawSidn) {
    if (state.busy || !staffWindow() || state.principal.clearance?.siteCheck !== true) return null;
    if (state.siteCheck?.cancelled) return null;
    const name = String(rawName ?? "").trim();
    if (!name) {
      state.siteCheck = { name: "", error: SITE_CHECK_TEXT.NO_NAME, cancelled: false };
      show();
      return "invalid";
    }
    state.siteCheck = { name, error: null, cancelled: false };
    state.busy = true;
    state.error = null;
    show();
    let answer;
    try {
      answer = await store.completeSiteCheck(name, String(rawSidn ?? ""));
    } catch (error) {
      state.busy = false;
      const said =
        error?.code === "VALIDATION" ? (SITE_CHECK_TEXT[String(error?.cause?.details ?? "")] ?? null) : null;
      if (said) {
        state.siteCheck = { name, error: said, cancelled: false };
        show();
        return "invalid";
      }
      // No invited account of their own any more: an admin cancelled it, or
      // it expired, before this press.
      if (error?.code === "FORBIDDEN") {
        state.siteCheck = { name, error: null, cancelled: true };
        show();
        return "cancelled";
      }
      // Not invited any more: an earlier press landed and its answer was
      // lost. The clearance says where the window goes next.
      if (error?.code === "INVALID_TRANSITION") {
        state.siteCheck = null;
        await checkClearance();
        return "active";
      }
      noteFailure(error);
      show();
      throw error;
    }
    state.busy = false;
    noteConnected();
    if (answer?.status === "active") {
      state.siteCheck = null;
      await checkClearance();
      return "active";
    }
    if (answer?.status === "cancelled") {
      state.siteCheck = { name, error: null, cancelled: true };
      show();
      return "cancelled";
    }
    if (answer?.status === "invited" && answer?.reason === "WRONG_SITE") {
      state.siteCheck = { name, error: WRONG_SITE_TEXT, cancelled: false };
      show();
      return "wrong-site";
    }
    const unread = controllerError("SERVER_ERROR", "Something went wrong.");
    noteFailure(unread);
    show();
    throw unread;
  }

  const createAccount = () => runAccountAction("create");
  const resendAccount = () => runAccountAction("resend");
  const deactivateAccount = () => runAccountAction("deactivate");
  const reactivateAccount = () => runAccountAction("reactivate");

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
      labels: state.labels.map((label) => ({ ...label })),
      labelMenu: state.labelMenu
        ? {
            ...state.labelMenu,
            editing: state.labelMenu.editing ? { ...state.labelMenu.editing } : null,
          }
        : null,
      lists: { ...state.lists },
      people: [...state.people],
      assistance: [...state.assistance],
      volunteers: state.volunteers.map((entry) => ({ ...entry })),
      volunteerFilters: { ...state.volunteerFilters },
      weekShifts: state.weekShifts.map((entry) => ({ ...entry })),
      workload: {
        ...state.workload,
        sort: { ...state.workload.sort },
        expanded: [...state.workload.expanded],
      },
      dialogContext: state.dialogContext ? { ...state.dialogContext } : null,
      updates: state.updates.map((item) => ({ ...item })),
      notificationsFresh: [...state.notificationsFresh],
      postedUpdates: state.postedUpdates.map((entry) => ({ ...entry })),
      updateForm: copyUpdateForm(state.updateForm),
      updateEditing: state.updateEditing
        ? {
            ...state.updateEditing,
            ...(state.updateEditing.conflict ? { conflict: { ...state.updateEditing.conflict } } : {}),
          }
        : null,
      updateFormError: state.updateFormError ? { ...state.updateFormError } : null,
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
    openLabelMenu,
    closeLabelMenu,
    setLabelSearch,
    toggleCaseLabel,
    startLabelEdit,
    setLabelDraft,
    cancelLabelEdit,
    saveLabelEdit,
    loadVolunteers,
    askInviteClient,
    inviteClient,
    resendClient,
    cancelInvitation,
    completeSiteCheck,
    setVolunteerFilter,
    saveVolunteer,
    markUploadReviewed,
    setReviewReasonFor,
    createAccount,
    resendAccount,
    deactivateAccount,
    reactivateAccount,
    clearVolunteerFormError,
    setVolunteerTab,
    setWorkloadView,
    openAssign,
    setAssignSearch,
    assignCase,
    loadFeed,
    openNotifications,
    closeNotifications,
    confirmUpdate,
    loadPostedUpdates,
    loadSeasonSettings,
    saveSeasonSettings,
    openSchedule,
    scheduleGo,
    readScheduleDay,
    loadScheduleDay,
    saveScheduleSettings,
    beginSiteHoursEdit,
    openShiftDrawer,
    editShiftDraft,
    saveShift,
    saveShiftDrag,
    removeShift,
    loadMyProfile,
    saveMyProfile,
    saveSidn,
    startNextSeason,
    addSiteCoordinator,
    removeSiteCoordinator,
    saveUpdate,
    updateAction,
    editUpdate,
    cancelUpdateEdit,
    setUpdateForm,
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
    checkClearance,
    markUploadSent,
    navigate,
    togglePanel,
    setLookup,
    openDialog,
    closeDialog,
    dismissError,
    clearError,
    noteLocalFailure,
  };
}
