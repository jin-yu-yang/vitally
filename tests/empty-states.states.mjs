// The states the golden empty-state test renders (change unify-empty-states).
// Shared by the one-time capture (plan Task 1) and tests/empty-states.test.mjs,
// so both render exactly the same inputs. Fictional data only.
import { decorateStaffCase } from "../src/staff-views.mjs";

export const NOW = Date.parse("2026-10-01T12:00:00Z");
const ALEX = { id: "alex", name: "Alex", capabilities: ["prepare"] };
const MORGAN = { id: "morgan", name: "Morgan", capabilities: ["review"] };
const SAM = { id: "p-sam", name: "Sam", capabilities: ["admin", "followup", "assist", "receive_documents"] };
const PEOPLE = [ALEX, MORGAN, SAM];

const baseState = (overrides = {}) => ({
  session: "present",
  principal: { userId: "user-1", workspaceId: "w1", access: "applicant" },
  connection: "online",
  error: null,
  retryable: false,
  authStep: "email",
  authEmail: "",
  authCode: "",
  authMessage: "",
  authError: null,
  resendSeconds: 0,
  cases: [],
  people: [],
  savedCase: null,
  draftAnswers: {},
  editBaseRevision: null,
  dirty: false,
  conflict: null,
  saveState: "idle",
  busy: false,
  screen: "applications",
  selectedCaseId: null,
  openPanels: [],
  lookup: "",
  dialog: null,
  ...overrides,
});

// One case with every related list empty, in the stage where the staff and
// admin pages show their sections.
const emptyCase = decorateStaffCase(
  {
    id: "case-empty",
    reference: "VT-EMPT-Y000",
    workspaceId: "w1",
    ownerUserId: "owner-1",
    fixture: false,
    stage: "preparing",
    revision: 3,
    preparationVersion: 0,
    answers: { service: "drop_off", language: "english", tp_first_name: "Robin", tp_last_name: "Lee" },
    intakeVerified: true,
    preparerId: "alex",
    reviewerId: null,
    createdAt: "2026-09-10T15:00:00.000Z",
    updatedAt: "2026-09-12T16:30:00.000Z",
    participants: ["alex"],
    requests: [],
    documents: [],
    followups: [],
    reviews: [],
    history: [],
    internalHistory: [],
  },
  PEOPLE,
);

export const STATES = Object.freeze({
  boardAvailable: ["renderStaffBoard", [[], PEOPLE, { person: ALEX, now: NOW }]],
  boardPreparation: ["renderStaffBoard", [[], PEOPLE, { person: ALEX, filters: { status: "preparation" }, now: NOW }]],
  boardReview: ["renderStaffBoard", [[], PEOPLE, { person: MORGAN, filters: { status: "review" }, now: NOW }]],
  boardMine: ["renderStaffBoard", [[], PEOPLE, { person: MORGAN, filters: { status: "preparation", assignment: "mine" }, now: NOW }]],
  boardFiltered: ["renderStaffBoard", [[], PEOPLE, { person: ALEX, filters: { language: "Polish" }, now: NOW }]],
  boardSearched: ["renderStaffBoard", [[], PEOPLE, { person: ALEX, filters: { search: "ZZZZ" }, now: NOW }]],
  queueEmpty: ["renderFollowups", [[], [], { person: SAM, filters: {}, busy: false, now: NOW }]],
  queueKind: ["renderFollowups", [[], [], { person: SAM, filters: { officeKind: "call" }, busy: false, now: NOW }]],
  queueLanguage: ["renderFollowups", [[], [], { person: SAM, filters: { language: "Polish" }, busy: false, now: NOW }]],
  appsEn: ["applicationsScreen", [baseState({ cases: [] })]],
  appsZh: ["applicationsScreen", [baseState({ cases: [], lang: "zh-Hans" })]],
  progressNoHistory: ["progressScreen", [baseState({ screen: "progress", cases: [emptyCase], selectedCaseId: emptyCase.id, savedCase: emptyCase })]],
  staffCase: ["renderStaffCase", [emptyCase, ALEX, { now: NOW }]],
  adminCase: ["renderAdminCase", [emptyCase, { person: SAM, now: NOW }]],
  taskContactsNone: ["taskContacts", [emptyCase, { id: "task-1" }]],
});

// Every sentence the golden states must contain between them, so a state that
// renders the wrong branch can't pass unnoticed.
export const SENTENCES = Object.freeze([
  "Nothing to claim right now. New work appears here once the office has checked its intake.",
  "Nothing is waiting for preparation.",
  "Nothing is waiting for review.",
  "Nothing of yours is waiting for preparation.",
  "Nothing on this tab matches these filters.",
  "No case matches “ZZZZ”.",
  "Nothing is waiting on the office right now.",
  "Nothing here matches these filters.",
  "No applications yet",
  "还没有申请",
  "Updates from the office appear here.",
  "No documents have been requested on this case.",
  "No review attempt has been opened on this case yet.",
  "No office follow-up has been raised on this case.",
  "Nothing has been recorded on this case yet.",
  "No document request on this case is waiting for a response.",
  "No contact has been logged on this task yet.",
  "No contacts logged yet.",
]);
