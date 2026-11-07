import test from "node:test";
import assert from "node:assert/strict";
import {
  accessScreen,
  applicationsScreen,
  referenceScreen,
  intakeScreen,
  progressScreen,
  PROGRESS_STEPS,
  conflictForm,
  saveStatus,
} from "../src/client-views.mjs";
import {
  page,
  setupNeeded,
  staffScreen,
  connectionNotice,
  unreachableScreen,
  dialog,
  toastParts,
} from "../src/views.mjs";
import { describeStage } from "../src/domain.mjs";
import { makeSampleAnswers } from "../src/sample-data.mjs";
import { stepsFor, findQuestion, findSubstep, wording } from "../src/intake-catalogue.mjs";
import { formatAnswer, visibleSubsteps, substepStatus, stepRollup } from "../src/intake-form.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { intakeFormV2, docCard, submittedV2 } from "../src/intake-views.mjs";
import { icon } from "../src/ui.mjs";
import { t, sentence } from "../src/client-text.mjs";
import { CONSENT_14446 } from "./support/consent-14446.mjs";

// Views are pure functions of a controller snapshot, so these tests operate on
// the HTML string itself. No DOM library, and nothing here may reach a store.

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

const caseRecord = (overrides = {}) => ({
  id: "case-a",
  reference: "VT-AB2C-DE3F",
  workspaceId: "w1",
  ownerUserId: "user-1",
  stage: "draft",
  revision: 1,
  preparationVersion: 1,
  answers: {},
  intakeVerified: false,
  preparerId: null,
  reviewerId: null,
  requests: [],
  documents: [],
  history: [],
  ...overrides,
});

// A label is really associated with its control, not merely adjacent to it.
function labelledControl(html, text) {
  const label = new RegExp(
    `<label[^>]*\\bfor="([^"]+)"[^>]*>(?:(?!</label>).)*${text}(?:(?!</label>).)*</label>`,
    "s",
  ).exec(html);
  assert.ok(label, `no <label for> carrying ${text}`);
  const id = label[1];
  const control = new RegExp(`<(input|select|textarea)[^>]*\\bid="${id}"`).exec(
    html,
  );
  assert.ok(control, `no control with id="${id}" for ${text}`);
  return html.slice(control.index, html.indexOf(">", control.index) + 1);
}

// An accessible name spelled exactly, on a real button element.
function hasButton(html, name) {
  return new RegExp(
    `<button[^>]*>(?:(?!</button>).)*${name}(?:(?!</button>).)*</button>`,
    "s",
  ).test(html);
}

test("the access screen carries the exact labels and buttons the story automates", () => {
  const emailStep = accessScreen(baseState({ screen: "access", principal: null }));
  const control = labelledControl(emailStep, "Email address");
  assert.match(control, /type="email"/);
  assert.ok(hasButton(emailStep, "Send verification code"));

  const codeStep = accessScreen(
    baseState({
      screen: "access",
      principal: null,
      authStep: "code",
      authEmail: "mei@example.org",
      authMessage: "If this address is eligible, check your inbox for a sign-in code.",
    }),
  );
  labelledControl(codeStep, "Verification code");
  assert.ok(hasButton(codeStep, "Verify and continue"));
  // The neutral message is shown exactly as the auth module returned it.
  assert.ok(
    codeStep.includes(
      "If this address is eligible, check your inbox for a sign-in code.",
    ),
  );
  // The promise is about passwords, not about there being no account.
  assert.ok(emailStep.includes("No password to remember"));
  assert.ok(!/no account/i.test(emailStep));
});

test("no fixed demo code and no phone sign-in appear in the access screens", () => {
  const screens = [
    accessScreen(baseState({ principal: null })),
    accessScreen(baseState({ principal: null, authStep: "code", resendSeconds: 41 })),
    accessScreen(
      baseState({
        principal: null,
        authStep: "code",
        authError: {
          code: "AUTH_INVALID_CODE",
          message: "That code is invalid or has expired. Request a new code.",
        },
      }),
    ),
  ];
  for (const html of screens) {
    assert.ok(!html.includes("246810"), "a fixed demo code is never shown");
    assert.ok(!/demo code/i.test(html));
    assert.ok(!/phone/i.test(html), "there is no phone sign-in option");
    assert.ok(!/type="tel"/.test(html));
    assert.ok(!/one-time code is simulated/i.test(html));
  }
  // The invalid-code failure is its own message, not the neutral send copy.
  assert.ok(/invalid or has expired/i.test(screens[2]));
  // The resend control is disabled while the cooldown runs, and it says so.
  assert.match(screens[1], /<button[^>]*disabled[^>]*data-action="resend-code"|<button[^>]*data-action="resend-code"[^>]*disabled/);
  assert.ok(screens[1].includes("41"));
});

test("an offline visitor reads the last view behind a connection notice", () => {
  const notice = connectionNotice(baseState({ connection: "offline" }));
  assert.ok(notice.length > 0);
  assert.match(notice, /connection/i);
  assert.equal(connectionNotice(baseState({ connection: "online" })), "");
  const offline = accessScreen(
    baseState({
      principal: null,
      authStep: "code",
      authError: { code: "OFFLINE", message: "Network error. Please try again later." },
    }),
  );
  assert.match(offline, /Network error\. Please try again later\./);
});

test("the connection notice: reconnecting spins, offline doesn't", () => {
  const reconnecting = connectionNotice({ ...baseState(), connection: "reconnecting" });
  assert.match(reconnecting, /^<div class="connection-notice reconnecting" role="status"><svg class="icon spin"/);
  const offline = connectionNotice({ ...baseState(), connection: "offline" });
  assert.match(offline, /^<div class="connection-notice offline" role="status">/);
  assert.doesNotMatch(offline, /class="icon spin"/);
  assert.equal(connectionNotice({ ...baseState(), connection: "online" }), "");
});

test("back online, in both languages", () => {
  assert.equal(t("toast.back_online", {}, "en"), "You're back online.");
  assert.equal(t("toast.back_online", {}, "zh-Hans"), "已重新连接。");
});

test("a dialog can always take the keyboard, whatever its body holds", () => {
  // The help dialog's body is prose: its only control is the close button. The
  // container carries tabindex="-1" so there is somewhere to put the keyboard
  // even for a future dialog that has neither.
  const help = dialog(baseState({ dialog: "help" }));
  assert.match(help, /<section class="modal"[^>]*tabindex="-1"/);
  assert.match(help, /role="dialog"/);
  assert.match(help, /aria-modal="true"/);
  assert.match(help, /class="close-btn"/);
  assert.equal(dialog(baseState({ dialog: null })), "");
  // Every dialog this module renders gets the same container.
  for (const name of ["help", "regenerate", "print"]) {
    const html = dialog(baseState({ dialog: name, savedCase: caseRecord() }));
    assert.match(html, /<section class="modal"[^>]*tabindex="-1"/, name);
  }
});

test("an unreachable server gets its own screen, not the sign-in form", () => {
  const html = unreachableScreen(
    baseState({
      session: "unknown",
      principal: null,
      connection: "offline",
      error: {
        code: "OFFLINE",
        message: "Network error. Please try again later.",
      },
    }),
  );
  assert.match(html, /cannot reach the server/i);
  assert.match(html, /data-action="retry-connection"/);
  // It must not read as a sign-out, and it must not ask for the address again.
  assert.ok(!/Sign in with your email/.test(html));
  assert.ok(!/Send verification code/.test(html));
  assert.ok(!/<input[^>]*type="email"/.test(html));
  assert.match(html, /not signed out/i);
  assert.ok(!/data-case-action/.test(html));
});

test("a half-typed code survives a re-render, and the countdown has a stable hook", () => {
  const html = accessScreen(
    baseState({
      principal: null,
      session: "none",
      authStep: "code",
      authEmail: "mei@example.org",
      authCode: "12",
      resendSeconds: 41,
    }),
  );
  // The field renders what is being typed, not a blank: a re-render arriving
  // between a keystroke and pressing Verify must not empty a required field.
  const field = labelledControl(html, "Verification code");
  assert.match(field, /value="12"/);
  // The countdown is patched in place by the tick, so it needs a stable hook.
  assert.match(html, /data-role="resend-countdown"/);
  const countdown = /<span[^>]*data-role="resend-countdown"[^>]*>([^<]*)</.exec(html);
  assert.ok(countdown, "the countdown element is a single stable element");
  assert.match(countdown[1], /41 seconds/);
  // The element is present even at zero, so the tick has something to write to.
  assert.match(
    accessScreen(baseState({ principal: null, session: "none", authStep: "code" })),
    /data-role="resend-countdown"/,
  );
  // And a value from the visitor is escaped like any other.
  assert.match(
    labelledControl(
      accessScreen(
        baseState({ principal: null, session: "none", authStep: "code", authCode: '"><script>' }),
      ),
      "Verification code",
    ),
    /value="&quot;&gt;&lt;script&gt;"/,
  );
});

test("the code step names the address it is bound to", () => {
  const html = accessScreen(
    baseState({
      principal: null,
      session: "none",
      authStep: "code",
      authEmail: "mei@example.org",
    }),
  );
  assert.ok(html.includes("mei@example.org"));
  assert.match(html, /Signing in as/);
  assert.match(html, /data-action="back-to-email"/);
  // An address is the visitor's own input, never a claim about the roster.
  assert.ok(!/registered|on file|approved address/i.test(html));
  // And with nothing bound yet, nothing is claimed.
  assert.ok(
    !/Signing in as/.test(
      accessScreen(baseState({ principal: null, session: "none", authStep: "code" })),
    ),
  );
});

test("applicant text is escaped everywhere it is rendered", () => {
  const nasty = '<script>alert("x")</script>';
  const state = baseState({
    screen: "progress",
    selectedCaseId: "case-a",
    savedCase: caseRecord({
      stage: "received",
      reference: nasty,
      intakeVersion: 2,
      answers: { tp_first_name: nasty, service: "drop_off" },
      history: [
        { id: "e1", action: "SUBMIT", message: nasty, createdAt: "2026-01-02T15:04:05Z" },
      ],
    }),
    draftAnswers: { ...CONSENT_14446, tp_first_name: nasty },
  });
  for (const html of [
    progressScreen(state),
    referenceScreen(state),
    intakeScreen({
      ...state,
      screen: "intake",
      savedCase: { ...state.savedCase, stage: "draft" },
      formSubstep: "about.you",
      revealed: [],
      visitedSubsteps: [],
    }),
    applicationsScreen({ ...state, cases: [state.savedCase], lookup: nasty }),
  ]) {
    assert.ok(!html.includes("<script>"), "raw markup never reaches the page");
    assert.ok(html.includes("&lt;script&gt;"));
  }
});

test("My applications lists owned cases, looks up only those, and starts one explicitly", () => {
  const cases = [
    caseRecord({ id: "case-a", reference: "VT-AB2C-DE3F", stage: "draft" }),
    caseRecord({
      id: "case-b",
      reference: "VT-KK44-MM55",
      stage: "reviewing",
      revision: 9,
    }),
  ];
  const html = applicationsScreen(baseState({ cases }));
  assert.ok(html.includes("VT-AB2C-DE3F"));
  assert.ok(html.includes("VT-KK44-MM55"));
  assert.ok(html.includes(describeStage("draft").clientLabel));
  assert.ok(html.includes(describeStage("reviewing").clientLabel));
  assert.ok(hasButton(html, "Start a new application"));
  assert.match(html, /data-action="start-application"/);
  assert.match(html, /data-action="open-case"[^>]*data-case-id="case-b"|data-case-id="case-b"[^>]*data-action="open-case"/);
  labelledControl(html, "Application ID");

  const found = applicationsScreen(baseState({ cases, lookup: " vt-kk44-mm55 " }));
  assert.ok(found.includes("VT-KK44-MM55"));
  assert.ok(!found.includes("VT-AB2C-DE3F"));
  assert.ok(!/we could not find/i.test(found));

  const missing = applicationsScreen(
    baseState({ cases, lookup: "VT-ZZZZ-ZZZZ" }),
  );
  assert.match(missing, /we could not find/i);
  // A reference that is not this person's reveals nothing at all.
  assert.ok(!missing.includes("VT-AB2C-DE3F"));
  assert.ok(!missing.includes("VT-KK44-MM55"));
  assert.ok(!/registered|email address on file/i.test(missing));
});

test("a 简体 applications list names a screening case in Chinese, never the staff name", () => {
  const html = applicationsScreen(
    baseState({ lang: "zh-Hans", cases: [caseRecord({ id: "case-s", stage: "screening" })] }),
  );
  assert.ok(html.includes("审核中"));
  assert.ok(!html.includes("Screening in progress"));
});

test("the reference card can be copied and printed and starts the form", () => {
  const html = referenceScreen(
    baseState({ screen: "reference", savedCase: caseRecord() }),
  );
  assert.ok(html.includes("VT-AB2C-DE3F"));
  assert.match(html, /data-action="copy-reference"/);
  assert.match(html, /data-action="print-reference"/);
  assert.match(html, /data-action="continue-intake"/);
  assert.ok(!/data-case-action/.test(html));
});

test("sign-in and progress point to the office by phone and email", () => {
  assert.match(accessScreen({ ...baseState(), authStep: "email" }), /class="office-contact"/);
  const progress = progressScreen({ ...baseState(), screen: "progress", savedCase: { id: "c1", reference: "VT-AAAA-AAAA", stage: "received", answers: { firstName: "Mei" }, requests: [], documents: [], history: [] } });
  assert.match(progress, /class="help-card"[\s\S]*class="office-contact"/);
});

test("the save state is named in words and a failed save keeps a retry", () => {
  assert.match(saveStatus(baseState({ saveState: "unsaved", dirty: true })), /unsaved/i);
  assert.match(saveStatus(baseState({ saveState: "saving" })), /saving/i);
  assert.match(saveStatus(baseState({ saveState: "saved" })), /saved/i);
  const failed = saveStatus(
    baseState({
      saveState: "failed",
      dirty: true,
      retryable: true,
      error: { code: "OFFLINE", message: "Network error. Please try again later." },
    }),
  );
  assert.match(failed, /not saved/i);
  assert.match(failed, /data-action="retry-action"/);
});

test("the conflict form offers both choices and neither is automatic", () => {
  const html = conflictForm(
    baseState({
      savedCase: caseRecord({ intakeVersion: 2, revision: 4, answers: { tp_first_name: "Server" } }),
      draftAnswers: { tp_first_name: "Mine" },
      dirty: true,
      editBaseRevision: 2,
      conflict: { code: "REMOTE_CHANGED", baseRevision: 2, serverRevision: 4 },
    }),
  );
  assert.match(html, /data-action="reconcile-mine"/);
  assert.match(html, /data-action="reconcile-server"/);
  assert.ok(html.includes("Mine"));
  assert.ok(html.includes("Server"));
  assert.ok(!/data-case-action/.test(html), "reconciliation never saves by itself");
  assert.equal(conflictForm(baseState()), "");
});

test("progress names the stage, shows client history and answers a document request", () => {
  const state = baseState({
    screen: "progress",
    savedCase: caseRecord({
      stage: "preparing",
      revision: 6,
      intakeVerified: true,
      answers: { tp_first_name: "Mei", service: "drop_off", language: "english" },
      requests: [
        {
          id: "req-1",
          caseId: "case-a",
          title: "2025 mileage record",
          message: "Please provide your 2025 mileage record.",
          status: "open",
        },
      ],
      history: [
        { id: "e1", action: "SUBMIT", message: "Application received.", createdAt: "2026-01-02T15:04:05Z" },
      ],
    }),
  });
  const html = progressScreen(state);
  assert.ok(html.includes(describeStage("preparing").clientLabel));
  assert.ok(html.includes(describeStage("preparing").clientMessage));
  assert.ok(html.includes("Application received."));
  assert.ok(html.includes("2025 mileage record"));
  const button = /<button[^>]*data-case-action="RESPOND_DOCUMENT"[^>]*>/.exec(html);
  assert.ok(button, "the sample response uses the canonical action name");
  assert.match(button[0], /data-request-id="req-1"/);
  // A settled request offers no second response.
  const settled = progressScreen({
    ...state,
    savedCase: {
      ...state.savedCase,
      requests: [{ ...state.savedCase.requests[0], status: "awaiting_verification" }],
      documents: [
        { id: "d1", requestId: "req-1", filename: "demo-mileage-record-2025.pdf", source: "client" },
      ],
    },
  });
  assert.ok(!/data-case-action="RESPOND_DOCUMENT"/.test(settled));
  assert.ok(settled.includes("demo-mileage-record-2025.pdf"));
});

test("two open requests render two distinct simulate-failure boxes", () => {
  // A shared id would make both labels address the first box, so clicking the
  // second request's label would tick the first request's checkbox.
  const requests = ["req-1", "req-2"].map((id) => ({
    id,
    caseId: "case-a",
    title: `Document ${id}`,
    message: "Please add the fictional sample.",
    status: "open",
  }));
  const html = progressScreen(
    baseState({
      screen: "progress",
      savedCase: caseRecord({
        stage: "preparing",
        revision: 6,
        intakeVerified: true,
        requests,
      }),
    }),
  );
  const boxes = [
    ...html.matchAll(/<input[^>]*data-action="toggle-upload-failure"[^>]*>/g),
  ].map(([tag]) => tag);
  assert.equal(boxes.length, 2);
  const ids = boxes.map((tag) => /id="([^"]+)"/.exec(tag)[1]);
  assert.equal(new Set(ids).size, 2, "the two boxes carry the same id");
  for (const [index, id] of ids.entries()) {
    assert.ok(id.includes(requests[index].id), "the id names its request");
    assert.match(boxes[index], /data-request-id="req-[12]"/);
    assert.ok(
      html.includes(`<label class="checkbox-row small" for="${id}">`),
      "each label addresses its own box",
    );
  }
});

test("review progress is plain and never carries findings", () => {
  for (const stage of [
    "review_ready",
    "reviewing",
    "corrections_required",
    "review_approved",
  ]) {
    const html = progressScreen(
      baseState({
        screen: "progress",
        savedCase: caseRecord({ stage, revision: 8, intakeVerified: true }),
      }),
    );
    assert.ok(html.includes(describeStage(stage).clientLabel), stage);
    assert.ok(html.includes(escHtml(describeStage(stage).clientMessage)), stage);
    for (const word of ["findings", "refund", "routing", "deposit", "$"])
      assert.ok(!html.toLowerCase().includes(word), `${stage} must not say ${word}`);
  }
});

test("the setup-needed screen explains the configuration and holds no secrets", () => {
  const html = setupNeeded();
  assert.match(html, /\.env\.local/);
  assert.match(html, /SUPABASE_URL/);
  assert.match(html, /SUPABASE_PUBLISHABLE_KEY/);
  assert.ok(!/eyJ|secret|service_role/i.test(html));
  assert.ok(!/data-case-action/.test(html));
});

test("a staff account gets the board and one case workspace, with no persona selector", () => {
  const cases = [
    caseRecord({ id: "case-a", reference: "VT-AB2C-DE3F", stage: "preparing", preparerId: "person-1" }),
  ];
  const staffState = (overrides = {}) =>
    baseState({
      principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "person-1" },
      screen: "staff",
      cases,
      people: [
        { id: "person-1", name: "Alex", capabilities: ["prepare"] },
        { id: "person-2", name: "Morgan", capabilities: ["review"] },
      ],
      boardFilters: { status: "preparation" },
      ...overrides,
    });
  const board = staffScreen(staffState());
  assert.ok(board.includes("VT-AB2C-DE3F"));
  assert.ok(board.includes(describeStage("preparing").label));
  assert.ok(board.includes("Alex"), "the preparer is named, not an id");
  assert.ok(!board.includes("person-1</"), "no person id is shown as a name");
  assert.doesNotMatch(board, /data-action="select-person"/);
  assert.match(board, /data-action="open-case" data-case-id="case-a"/);

  // Opening a case is the same screen function, with the workspace inside it.
  const workspace = staffScreen(
    staffState({
      screen: "staff-case",
      savedCase: {
        ...cases[0],
        participants: ["person-1"],
        requests: [],
        documents: [],
        followups: [],
        reviews: [],
        internalHistory: [],
      },
    }),
  );
  assert.match(workspace, /Preparation milestones/);
  assert.match(workspace, /data-case-action="SUBMIT_REVIEW"/);
  assert.match(workspace, /data-action="open-board"/);
  assert.doesNotMatch(workspace, /data-action="select-person"/);

  // The applicant never sees a staff screen.
  const clientPage = page(baseState(), applicationsScreen(baseState()));
  assert.ok(!/data-action="select-person"/.test(clientPage));
  assert.ok(!clientPage.includes("Morgan"));
  assert.ok(!/data-case-action="CLAIM_/.test(clientPage));
});

test("the staff workspace announces a failure once, beside the work", () => {
  const state = baseState({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "person-1" },
    screen: "staff-case",
    error: {
      code: "CONFLICT",
      message: "Someone else changed this case. The newest version is shown — check it and try again.",
    },
    people: [{ id: "person-1", name: "Alex", capabilities: ["prepare"] }],
    savedCase: {
      ...caseRecord({ id: "case-a", stage: "preparing", preparerId: "person-1" }),
      participants: ["person-1"],
      requests: [],
      documents: [],
      followups: [],
      reviews: [],
      internalHistory: [],
    },
  });
  const html = page(state, staffScreen(state));
  assert.equal(
    html.match(/Someone else changed this case/g).length,
    1,
    "the page-wide banner steps aside for the in-place notice",
  );
  assert.match(html, /data-action="dismiss-error"/);
  // The board keeps the page-wide banner, which is the only notice there.
  const onBoard = { ...state, screen: "staff" };
  assert.match(page(onBoard, staffScreen(onBoard)), /problem-banner/);
});

test("an error shows inside the open dialog, and the banner steps aside", () => {
  const error = { code: "VALIDATION", message: "This checkpoint is not available." };
  for (const name of ["help", "regenerate", "leave-add-case", "close-case", "print"]) {
    const state = {
      ...baseState({ savedCase: caseRecord() }),
      principal: baseState().principal,
      dialog: name,
      error,
      retryable: false,
    };
    const html = dialog(state);
    assert.match(html, /<div class="notice error" role="alert" id="dialog-error">[\s\S]*This checkpoint is not available\./, name);
    assert.match(html, /data-action="dismiss-error"/, name);
    assert.doesNotMatch(page(state, "<main></main>"), /class="problem-banner"/, `${name}: no banner behind the dialog`);
  }
  // Without an error, nothing is added.
  assert.doesNotMatch(dialog(baseState({ dialog: "help" })), /dialog-error/);
});

test("a dialog on the case page holds the only copy of the error", () => {
  const state = baseState({
    principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: "person-1" },
    screen: "staff-case",
    dialog: "close-case",
    error: { code: "SERVER_ERROR", message: "x" },
    retryable: false,
    people: [{ id: "person-1", name: "Alex", capabilities: ["prepare"] }],
    savedCase: {
      ...caseRecord({ id: "case-a", stage: "preparing", preparerId: "person-1" }),
      participants: ["person-1"],
      requests: [],
      documents: [],
      followups: [],
      reviews: [],
      internalHistory: [],
    },
  });
  assert.doesNotMatch(staffScreen(state), /That step did not go through/, "no in-place copy behind the modal");
  assert.match(staffScreen({ ...state, dialog: null }), /That step did not go through/, "with no dialog the case page says it");
  assert.match(dialog(state), /id="dialog-error"/);
});

test("a toast's parts: an icon, the text, and a Dismiss label in the screen's language", () => {
  const parts = toastParts({ kind: "success", text: "Your answers are saved.", lang: "en" });
  assert.match(parts.icon, /<svg class="icon toast-icon[^"]*"[^>]*aria-hidden="true"/);
  assert.equal(parts.text, "Your answers are saved.");
  assert.equal(parts.dismissLabel, "Dismiss");
  assert.equal(toastParts({ kind: "info", text: "x", lang: "zh-Hans" }).dismissLabel, "关闭");
  assert.throws(() => toastParts({ kind: "error", text: "x", lang: "en" }), /kind/);
});

test("the page no longer draws the toast: its host lives beside #app (design D4)", () => {
  const html = page(baseState(), applicationsScreen(baseState()));
  assert.doesNotMatch(html, /id="toast"/);
  assert.doesNotMatch(html, /class="toast"/);
});

test("the brand is ViTally, attributed to PCDC, for tax year 2025", () => {
  const html = page(baseState(), applicationsScreen(baseState()));
  assert.ok(html.includes("ViTally"));
  assert.ok(html.includes("PCDC"));
  assert.ok(html.includes("2025"));
  assert.match(html, /data-action="sign-out"/);
});

test("the progress page shows the client number after the Application ID", () => {
  const record = { id: "c1", reference: "VT-AAAA-AAAA", stage: "received", answers: { firstName: "Mei" }, requests: [], documents: [], history: [] };
  const numbered = progressScreen({ ...baseState(), screen: "progress", savedCase: { ...record, clientNumber: 93 } });
  const pill = numbered.match(/<div class="id-pill">[\s\S]*?<\/div><\/div>(?=<\/div>)/)[0];
  assert.ok(pill.includes("<small>CLIENT NUMBER</small><strong>#093</strong>"));
  assert.ok(pill.indexOf("VT-AAAA-AAAA") < pill.indexOf("#093"));
  const plain = progressScreen({ ...baseState(), screen: "progress", savedCase: { ...record, clientNumber: null } });
  assert.ok(!plain.includes("CLIENT NUMBER"));
});

test("my applications shows the client number on submitted rows only", () => {
  const html = applicationsScreen(baseState({
    cases: [
      caseRecord({ id: "case-a", reference: "VT-AB2C-DE3F", stage: "received", clientNumber: 93 }),
      caseRecord({ id: "case-b", reference: "VT-KK44-MM55", stage: "draft", clientNumber: null }),
    ],
  }));
  const rows = html.split('<button class="application-row"').slice(1);
  assert.match(rows[0], /<span class="application-id"><span class="application-reference">VT-AB2C-DE3F<\/span><span class="application-number">#093<\/span><\/span>/);
  assert.ok(!rows[1].includes("application-number"));
});

test("a version-2 chip counts the revealed invalid answers of visible questions", () => {
  const v2 = (overrides = {}) =>
    baseState({ savedCase: { id: "c2", intakeVersion: 2, answers: {} }, revealed: [], ...overrides });
  const text = (html) => html.replace(/<[^>]+>/g, "").trim();
  const one = saveStatus(v2({ saveState: "saved", draftAnswers: { email: "a@" }, revealed: ["email"] }));
  assert.equal(text(one), "1 answer needs checking");
  assert.match(one, /class="save-chip checking" role="status"/);
  const two = saveStatus(
    v2({ saveState: "idle", draftAnswers: { email: "a@", addr_zip: "191" }, revealed: ["email", "addr_zip"] }),
  );
  assert.equal(text(two), "2 answers need checking");
  // Typed but not revealed, and revealed but hidden, are never counted.
  assert.equal(text(saveStatus(v2({ saveState: "saved", draftAnswers: { email: "a@" } }))), "Saved");
  assert.equal(
    text(saveStatus(v2({ saveState: "saved", draftAnswers: { marital_status: "single", sp_dob: "1990-02-30" }, revealed: ["sp_dob"] }))),
    "Saved",
  );
  // A revealed id whose value is valid again counts for nothing.
  assert.equal(text(saveStatus(v2({ saveState: "idle", draftAnswers: { email: "a@b" }, revealed: ["email"] }))), "Up to date");
  // Saving, Failed and Unsaved come first.
  const shown = { draftAnswers: { email: "a@" }, revealed: ["email"] };
  assert.match(text(saveStatus(v2({ ...shown, saveState: "saving" }))), /Saving/);
  assert.match(text(saveStatus(v2({ ...shown, saveState: "failed", dirty: true }))), /Not saved/);
  assert.equal(text(saveStatus(v2({ ...shown, saveState: "unsaved", dirty: true }))), "Unsaved changes");
});

const progressAt = (stage, lang = "en", overrides = {}) =>
  progressScreen(
    baseState({
      screen: "progress",
      lang,
      savedCase: caseRecord({ stage, revision: 8, intakeVerified: true, ...overrides }),
    }),
  );

// What the five steps of the track read, in order, as "name: status".
const trackOf = (html) =>
  [...html.matchAll(/<div class="(done|current|)"><span>[\s\S]*?<small>([^<]*)<\/small><em class="sr-only">([^<]*)<\/em><\/div>/g)].map(
    ([, , name, status]) => `${name}: ${status}`,
  );

test("the client's progress has five steps", () => {
  assert.deepEqual(
    PROGRESS_STEPS.map(([key, stages]) => [key, stages]),
    [
      ["progress.step.intake", ["draft", "received", "screening"]],
      ["progress.step.preparation", ["preparation_ready", "preparing", "corrections_required"]],
      ["progress.step.review", ["review_ready", "reviewing"]],
      ["progress.step.signing", ["review_approved"]],
      ["progress.step.filing", ["ready_to_efile", "efiled", "rejected"]],
    ],
  );
  assert.equal(t("progress.step.signing", {}, "zh-Hans"), "签名");
  assert.equal(t("progress.step.filing", {}, "zh-Hans"), "递交");
  assert.equal(trackOf(progressAt("preparing")).length, 5);
});

test("at Ready to exit, intake to review are done and signing is current", () => {
  assert.deepEqual(trackOf(progressAt("review_approved")), [
    "Intake: complete",
    "Preparation: complete",
    "Review: complete",
    "Signing: in progress",
    "Filing: not started",
  ]);
  assert.deepEqual(trackOf(progressAt("screening")), [
    "Intake: in progress",
    "Preparation: not started",
    "Review: not started",
    "Signing: not started",
    "Filing: not started",
  ]);
  assert.deepEqual(trackOf(progressAt("efiled")).slice(3), ["Signing: complete", "Filing: in progress"]);
});

test("the client sees their own label, never the staff name", () => {
  const signing = progressAt("review_approved");
  assert.ok(signing.includes("Ready to sign"));
  assert.ok(signing.includes(escHtml(describeStage("review_approved").clientMessage)));
  assert.ok(!signing.includes("Ready to exit"));
  const screening = progressAt("screening", "zh-Hans");
  assert.ok(screening.includes("审核中"));
  assert.ok(!screening.includes("Screening in progress"));
  const filed = progressAt("efiled");
  assert.ok(filed.includes("E-filed"));
  assert.match(
    filed,
    /<p class="status-explanation">Your return was e-filed\. The IRS will confirm whether it is accepted\.<\/p>/,
  );
  const signed = progressAt("ready_to_efile", "zh-Hans");
  assert.ok(signed.includes("已准备好"));
  assert.ok(!signed.includes("Ready to e-file"));
});

test("a closed case shows its closed notice, not a step", () => {
  for (const [lang, badge] of [["en", "Closed"], ["zh-Hans", "已关闭"]]) {
    const html = progressAt("closed", lang);
    assert.ok(!html.includes("progress-steps"), lang);
    assert.ok(!html.includes('class="current"'), lang);
    assert.ok(html.includes(`<i></i>${badge}</span>`), lang);
    assert.match(
      html,
      new RegExp(`<p class="status-explanation">${reEsc(describeStage("closed", lang).clientMessage)}</p>`),
      lang,
    );
  }
});

test("the stepper: Filing is current at Rejected, and Accepted completes all five", () => {
  assert.deepEqual(trackOf(progressAt("rejected")).slice(3), ["Signing: complete", "Filing: in progress"]);
  const accepted = trackOf(progressAt("accepted"));
  assert.equal(accepted.length, 5);
  for (const step of accepted) assert.match(step, /: complete$/, step);
  assert.ok(!progressAt("accepted").includes('class="current"'));
});

const statusOf = (html) => /<p class="status-explanation">([^<]*)<\/p>/.exec(html)?.[1];
const BOTH_EFILE = { federalMethod: "efile", stateMethod: "efile", federalResult: null, stateResult: null };
const REFUNDS_EN =
  'If you are due a refund, you can check on it with &quot;Where&#39;s My Refund?&quot; at irs.gov/refunds for your federal return, and with myPATH at mypath.pa.gov for your Pennsylvania return.';

test("the client's filing messages, per return", () => {
  assert.equal(
    statusOf(progressAt("efiled", "en", BOTH_EFILE)),
    "Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted.",
  );
  assert.equal(
    statusOf(progressAt("efiled", "en", { ...BOTH_EFILE, federalResult: "accepted" })),
    "The IRS accepted your federal return. Your Pennsylvania return was e-filed. Pennsylvania will confirm whether it is accepted.",
  );
  assert.equal(
    statusOf(progressAt("rejected", "zh-Hans", { ...BOTH_EFILE, federalResult: "accepted", stateResult: "rejected" })),
    "国税局已接受您的联邦报税表。您的宾州报税表需要更正后才能被接受。PCDC 会就更正事宜联系您。",
  );
  assert.equal(
    statusOf(progressAt("rejected", "en", { ...BOTH_EFILE, federalResult: "rejected", stateResult: "rejected" })),
    "Your federal and Pennsylvania returns need a correction before they can be accepted. PCDC will contact you about the correction.",
  );
  assert.equal(
    statusOf(progressAt("efiled", "en", { federalMethod: "paper", stateMethod: "paper" })),
    "PCDC gave your federal and Pennsylvania returns on paper to you or the person you sent. If they aren&#39;t signed yet, sign them, then mail them yourself. A reply can take about 3 months after you mail them.",
  );
  assert.equal(
    statusOf(progressAt("efiled", "zh-Hans", { federalMethod: "efile", stateMethod: "paper" })),
    "您的联邦报税表已电子递交。国税局会确认是否接受。PCDC 已将您的宾州报税表纸本交给您或您委托的人。如果还没有签名，请先签名，然后自行邮寄。邮寄后可能需要约 3 个月才会有回复。",
  );
});

test("Complete: the refund sites are plain text, not links", () => {
  const html = progressAt("accepted", "en", { ...BOTH_EFILE, federalResult: "accepted", stateResult: "accepted" });
  assert.equal(statusOf(html), `The IRS and Pennsylvania accepted your returns. ${REFUNDS_EN}`);
  const zh = progressAt("accepted", "zh-Hans", { ...BOTH_EFILE, federalResult: "accepted", stateResult: "accepted" });
  assert.equal(
    statusOf(zh),
    '国税局和宾州税务局都已接受您的报税表。如果您有退税，可以在 irs.gov/refunds 使用 "Where&#39;s My Refund?" 查询联邦退税，在 mypath.pa.gov 使用 myPATH 查询宾州退税。（网站为英文页面，可用浏览器翻译）'.replace(
      '"Where&#39;s My Refund?"',
      "&quot;Where&#39;s My Refund?&quot;",
    ),
  );
  for (const page of [html, zh]) assert.ok(!/<a[ >]/.test(statusOf(page) ?? "") && !/<a [^>]*irs\.gov/.test(page));
});

test("clients see the filing method's label on the list and the progress page", () => {
  const cases = [
    [{ federalMethod: "efile", stateMethod: "paper" }, "Filed", "已递交"],
    [{ federalMethod: "paper", stateMethod: "paper" }, "Filed", "已递交"],
    [{ federalMethod: "paper", stateMethod: "efile" }, "Filed", "已递交"],
    [{ federalMethod: "efile", stateMethod: "efile" }, "E-filed", "已电子递交"],
    [{ federalMethod: null, stateMethod: null }, "E-filed", "已电子递交"],
  ];
  for (const [methods, en, zh] of cases)
    for (const [lang, label] of [["en", en], ["zh-Hans", zh]]) {
      const record = caseRecord({ stage: "efiled", revision: 8, ...methods });
      const list = applicationsScreen(baseState({ lang, cases: [record] }));
      assert.ok(list.includes(`<i></i>${label}</span>`), `list ${lang} ${label}`);
      const page = progressAt("efiled", lang, methods);
      assert.equal(page.split(`<i></i>${label}</span>`).length - 1, 2, `progress ${lang} ${label}`);
    }
});

test("a case e-filed before filing methods keeps its message", () => {
  for (const [lang, text] of [
    ["en", "Your return was e-filed. The IRS will confirm whether it is accepted."],
    ["zh-Hans", "您的报税表已电子递交。国税局会确认是否接受。"],
  ])
    assert.equal(statusOf(progressAt("efiled", lang, { federalMethod: null, stateMethod: null })), text);
});

test("Sign again: the re-sign message replaces the approval's variant", () => {
  const record = { signingPlan: "portal", ...BOTH_EFILE, federalResult: "rejected", stateResult: null };
  assert.equal(
    statusOf(progressAt("review_approved", "en", record)),
    "PCDC corrected your return. Please sign it again so PCDC can file it. PCDC will contact you to arrange this.",
  );
  assert.equal(
    statusOf(progressAt("review_approved", "zh-Hans", record)),
    "PCDC 已更正您的报税表。请再次签名，以便 PCDC 递交。PCDC 会联系您安排签名。",
  );
});

test("no client page shows a reject code or a fix note", () => {
  const filingAttempts = [
    { attempt: 1, notes: [{ note: "Fix the zebra SSN", recordedAt: "2026-01-02T00:00:00Z" }], codes: ["IND-031-04"] },
  ];
  for (const stage of ["efiled", "rejected", "review_approved", "accepted"])
    for (const lang of ["en", "zh-Hans"]) {
      const html = progressAt(stage, lang, { ...BOTH_EFILE, federalResult: "rejected", filingAttempts, rejectCode: "IND-031-04" });
      assert.ok(!html.includes("IND-031-04") && !html.includes("Fix the zebra SSN"), `${stage} ${lang}`);
    }
});

test("the history shows the new lines in 简体", () => {
  const history = [
    { id: "h1", action: "SUBMIT", message: "Application received. A volunteer will check your information and documents.", createdAt: "2026-01-02T15:04:05Z" },
    { id: "h2", action: "START_SCREENING", message: "PCDC started reviewing your application. We may call you.", createdAt: "2026-01-03T15:04:05Z" },
    { id: "h3", action: "MARK_READY_TO_EFILE", message: "PCDC recorded that you signed Form 8879. Your return is ready to e-file.", createdAt: "2026-01-04T15:04:05Z" },
    { id: "h4", action: "MARK_EFILED", message: "PCDC e-filed your return.", createdAt: "2026-01-05T15:04:05Z" },
    { id: "h5", action: "MARK_READY_TO_EFILE", message: "PCDC recorded that your return is ready. PCDC will take the next step.", createdAt: "2026-01-06T15:04:05Z" },
    { id: "h6", action: "MARK_EFILED", message: "PCDC mailed your returns.", createdAt: "2026-01-07T15:04:05Z" },
  ];
  const html = progressAt("efiled", "zh-Hans", { history });
  for (const line of [
    "PCDC 已开始审核您的申请。我们可能会致电您。",
    "PCDC 已记录您签署了 8879 表。您的报税表可以电子递交了。",
    "PCDC 已电子递交您的报税表。",
    "已收到申请。志愿者会核对您的信息和文件。",
    "PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。",
    "PCDC 已邮寄您的报税表。",
  ])
    assert.ok(html.includes(line), line);
  assert.ok(!html.includes("PCDC e-filed your return."));
  assert.ok(!html.includes("Application received."));
});

// ---------------------------------------------------------------------------
// Hold and closing (change add-hold-and-closing)
// ---------------------------------------------------------------------------

const WAITING = { holdOrigin: "awaiting_documents" };
const SIGNING_HOLD = { holdOrigin: "review_approved" };
const escHtml = (text) => text.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");

test("the stepper: Intake is current while waiting for documents, Signing at a signing hold", () => {
  const intake = [
    "Intake: in progress",
    "Preparation: not started",
    "Review: not started",
    "Signing: not started",
    "Filing: not started",
  ];
  assert.deepEqual(trackOf(progressAt("awaiting_documents")), intake);
  assert.deepEqual(trackOf(progressAt("on_hold", "en", WAITING)), intake);
  assert.deepEqual(trackOf(progressAt("on_hold", "en", SIGNING_HOLD)), [
    "Intake: complete",
    "Preparation: complete",
    "Review: complete",
    "Signing: in progress",
    "Filing: not started",
  ]);
  assert.equal(trackOf(progressAt("on_hold", "en", {})).length, 0);
});

test("the status panels: Waiting for documents and each Hold", () => {
  const waiting = progressAt("awaiting_documents", "zh-Hans");
  assert.ok(waiting.includes("需要文件"));
  assert.equal(statusOf(waiting), t("stage.awaiting_documents.client", {}, "zh-Hans"));
  for (const lang of ["en", "zh-Hans"]) {
    assert.equal(
      statusOf(progressAt("on_hold", lang, WAITING)),
      escHtml(t("stage.on_hold.client", {}, lang)),
      lang,
    );
    assert.equal(
      statusOf(progressAt("on_hold", lang, SIGNING_HOLD)),
      escHtml(t("stage.on_hold.client.signing", {}, lang)),
      lang,
    );
  }
  assert.ok(progressAt("on_hold", "zh-Hans", WAITING).includes("等待您的回复"));
});

test("each closed message, and the generic one for older closed cases", () => {
  for (const lang of ["en", "zh-Hans"]) {
    for (const reason of ["out_of_scope", "no_need_to_file", "duplicate", "dismissed", "withdrawn"])
      assert.equal(
        statusOf(progressAt("closed", lang, { closingReason: reason })),
        escHtml(t(`stage.closed.client.${reason}`, {}, lang)),
        `${lang} ${reason}`,
      );
    for (const overrides of [{}, { closingReason: "other" }, { closingReason: null }])
      assert.equal(
        statusOf(progressAt("closed", lang, overrides)),
        escHtml(t("stage.closed.client", {}, lang)),
        `${lang} ${JSON.stringify(overrides)}`,
      );
  }
  const duplicate = statusOf(progressAt("closed", "en", { closingReason: "duplicate", reference: "VT-AB2C-DE3F" }));
  assert.ok(!/VT-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(duplicate), duplicate);
});

test("the Withdraw button shows at exactly the stages the client may withdraw from", () => {
  const withdrawable = [
    ["received", {}],
    ["screening", {}],
    ["awaiting_documents", {}],
    ["preparation_ready", {}],
    ["preparing", {}],
    ["corrections_required", {}],
    ["review_ready", {}],
    ["reviewing", {}],
    ["on_hold", WAITING],
  ];
  const notWithdrawable = [
    ["draft", {}],
    ["review_approved", {}],
    ["ready_to_efile", {}],
    ["efiled", {}],
    ["rejected", {}],
    ["accepted", {}],
    ["closed", {}],
    ["on_hold", SIGNING_HOLD],
    ["on_hold", {}],
  ];
  const OPENER = 'data-action="open-withdraw"';
  for (const [stage, overrides] of withdrawable)
    for (const [lang, name] of [["en", "Withdraw this application"], ["zh-Hans", "撤回此申请"]]) {
      const html = progressAt(stage, lang, overrides);
      assert.ok(html.includes(OPENER), `${stage} ${lang}`);
      assert.ok(hasButton(html, name), `${stage} ${lang}`);
      assert.ok(!html.includes("To withdraw now, contact PCDC.") && !html.includes("如需撤回，请联系 PCDC。"), stage);
    }
  for (const [stage, overrides] of notWithdrawable) {
    assert.ok(!progressAt(stage, "en", overrides).includes(OPENER), `${stage} ${JSON.stringify(overrides)}`);
  }
});

test("from Ready to exit on, and at a signing hold, the client is told to contact PCDC", () => {
  for (const [stage, overrides] of [
    ["review_approved", {}],
    ["ready_to_efile", {}],
    ["rejected", {}],
    ["on_hold", SIGNING_HOLD],
  ]) {
    assert.ok(progressAt(stage, "en", overrides).includes("To withdraw now, contact PCDC."), stage);
    assert.ok(progressAt(stage, "zh-Hans", overrides).includes("如需撤回，请联系 PCDC。"), stage);
  }
  // Once the return is filed or accepted there is nothing to withdraw: no line.
  for (const [stage, overrides] of [
    ["efiled", {}],
    ["accepted", {}],
    ["draft", {}],
    ["preparing", {}],
    ["closed", {}],
    ["on_hold", WAITING],
    ["on_hold", {}],
  ])
    assert.ok(!progressAt(stage, "en", overrides).includes("To withdraw now, contact PCDC."), stage);
});

test("the withdraw dialog: the box, the confirm control and the way out, in both languages", () => {
  for (const [lang, box, confirm, title] of [
    ["en", "I want to withdraw this application. My return will not be filed.", "Withdraw this application", "Withdraw this application?"],
    ["zh-Hans", "我要撤回此申请。我的报税表将不会被递交。", "撤回此申请", "撤回此申请？"],
  ]) {
    const html = dialog(baseState({ dialog: "withdraw", lang, savedCase: caseRecord({ stage: "preparing" }) }));
    assert.ok(html.includes(title), lang);
    const control = labelledControl(html, reEsc(box));
    assert.match(control, /name="withdraw-confirmed"/);
    assert.match(control, /type="checkbox"/);
    assert.match(html, new RegExp(`<button type="submit"[^>]*data-case-action="WITHDRAW"[^>]*>[^<]*${confirm}`));
    assert.match(html, /data-action="close-dialog"/);
    assert.ok(!/\d{3}\D{0,2}\d{3}\D{0,2}\d{4}/.test(html));
  }
});

test("no client page shows a hold note or a close note", () => {
  const NOTE = "<b>Left two voicemails</b> zebra-note";
  const history = [
    { id: "h1", action: "PUT_ON_HOLD", message: "PCDC is trying to reach you.", createdAt: "2026-01-02T15:04:05Z" },
  ];
  for (const [stage, overrides] of [
    ["on_hold", WAITING],
    ["on_hold", SIGNING_HOLD],
    ["closed", { closingReason: "other" }],
    ["closed", { closingReason: "dismissed" }],
    ["preparing", {}],
  ])
    for (const lang of ["en", "zh-Hans"]) {
      const record = { holdNote: NOTE, closeNote: NOTE, closingNote: NOTE, note: NOTE, history, ...overrides };
      const html = progressAt(stage, lang, record);
      assert.ok(!html.includes("zebra-note") && !html.includes("Left two voicemails"), `${stage} ${lang}`);
      const list = applicationsScreen(baseState({ lang, cases: [caseRecord({ stage, ...record })] }));
      assert.ok(!list.includes("zebra-note"), `list ${stage} ${lang}`);
    }
});

test("the document requests show at Waiting for documents and at a documents Hold", () => {
  const requests = [{ id: "req-9", caseId: "case-a", title: "W-2 from Acme", message: "Please send it", status: "open" }];
  for (const [stage, overrides] of [
    ["awaiting_documents", {}],
    ["on_hold", WAITING],
  ]) {
    const html = progressAt(stage, "en", { ...overrides, requests });
    assert.ok(html.includes("W-2 from Acme"), stage);
    assert.match(html, /data-case-action="RESPOND_DOCUMENT"/, stage);
  }
});

// ---------------------------------------------------------------------------
// Version 2: sub-steps, the rail tree, Documents, Review & submit
// (spec 2026-10-04 §2–§6)
// ---------------------------------------------------------------------------

const v2Case = (overrides = {}) =>
  caseRecord({ id: "case-v2", reference: "VT-GJPY-JAY9", intakeVersion: 2, answers: {}, contact: null, documentCards: [], ...overrides });
const v2State = (overrides = {}) =>
  baseState({
    screen: "intake",
    selectedCaseId: "case-v2",
    savedCase: v2Case(),
    draftAnswers: makeSampleAnswers(),
    formSubstep: "before.ready",
    visitedSubsteps: [],
    revealed: [],
    returnToSummary: false,
    ...overrides,
  });
const without = (answers, ...ids) =>
  Object.fromEntries(Object.entries(answers).filter(([id]) => !ids.includes(id)));
const plain = (html) => html.replace(/<[^>]+>/g, "").trim();
const escText = (text) => text.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
const reEsc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sample = () => makeSampleAnswers();
const TODAY = new Date(2026, 9, 4, 12);
const chrome = { saveStatus, conflictForm, fictionalTools: "", today: TODAY };
const form = (overrides) => intakeFormV2(v2State(overrides), chrome);

test("the v2 intake says an error once: the banner, or the chip for a failed save", () => {
  const alerts = (html) => (html.match(/role="alert"/g) ?? []).length;
  const drafted = v2State({ error: { code: "DRAFT", message: "The draft could not be made. Try again." }, retryable: true });
  const withBanner = page(drafted, intakeScreen(drafted));
  assert.match(withBanner, /class="problem-banner" role="alert"/);
  assert.equal(alerts(withBanner), 1, "only the banner");
  assert.doesNotMatch(intakeScreen(drafted), /<p class="error"/, "no copy inside the form");
  const failed = v2State({ saveState: "failed", dirty: true, error: { code: "OFFLINE", message: "Network error. Please try again later." }, retryable: true });
  const withChip = page(failed, intakeScreen(failed));
  assert.match(withChip, /class="save-chip failed" role="alert"/);
  assert.equal(alerts(withChip), 1, "only the chip");
});

// One step's <li>, up to the next step (its sub-steps included).
const railStepOf = (html, id) => {
  const start = html.search(new RegExp(`<li class="rail-step[^"]*" data-step-id="${id}">`));
  assert.ok(start >= 0, `rail step ${id} is rendered`);
  const next = html.indexOf(`<li class="rail-step`, start + 1);
  return html.slice(start, next < 0 ? html.indexOf("</nav>", start) : next);
};
const markOf = (html, spanId) => {
  const found = new RegExp(`<span id="${reEsc(spanId)}" class="rail-status is-(\\w+)">([^<]*)</span>`).exec(html);
  assert.ok(found, `${spanId} is rendered`);
  return { key: found[1], text: found[2] };
};
const subLinkOf = (html, id) => {
  const found = new RegExp(`<button type="button" class="rail-sublink" data-action="go-substep" data-substep="${reEsc(id)}"[^>]*>[\\s\\S]*?</button>`).exec(html);
  assert.ok(found, `the rail links to ${id}`);
  return found[0];
};
const slug = (slot) => slot.replace(/\./g, "-");
const cardOf = (html, slot) =>
  new RegExp(`<article class="doc-card" id="doc-${reEsc(slug(slot))}" data-slot="${reEsc(slot)}" tabindex="-1">[\\s\\S]*?</article>`).exec(html)?.[0];
const submitOf = (html) => {
  const found = /<button[^>]*data-case-action="SUBMIT"[^>]*>/.exec(html);
  assert.ok(found, "review.submit has Submit");
  return found[0];
};
const MEMBER = "000000000000000000000000000003e9"; // the sample's first household member

test("the fiction toolbar shows only with the switch", () => {
  const off = intakeScreen(v2State({ formSubstep: "about.address", demoTools: false }));
  assert.doesNotMatch(off, /fill-fictional|regenerate-fictional|demo-fiction/);
  assert.doesNotMatch(intakeScreen(v2State({ formSubstep: "about.address" })), /fill-fictional/, "absent means off");
  const on = intakeScreen(v2State({ formSubstep: "about.address", demoTools: true }));
  assert.match(on, /Fill fictional details/);
  assert.match(on, /data-action="fill-fictional"/);
  assert.match(on, /data-action="regenerate-fictional"/);
  assert.match(on, /demo-fiction/);
  assert.match(intakeScreen(v2State({ formSubstep: "about.address", demoTools: true, lang: "zh-Hans" })), /填入虚构资料/);
});

test("a version-2 draft gets the sub-step page: form, overline, title and count", () => {
  const html = intakeScreen(v2State({ formSubstep: "about.address" }));
  assert.match(html, /<form id="intake-v2-form" novalidate data-substep="about\.address">/);
  assert.match(html, /<span class="overline">STEP 1 OF 9 · ABOUT YOU<\/span><h1>Mailing address<\/h1><p class="substep-count">2 of 6<\/p>/);
  // The office card stays under the rail, and the chrome comes from client-views.
  assert.match(html, /class="sidebar-help"[\s\S]*class="office-contact"[\s\S]*tel:\+12159226156/);
  assert.match(html, /<span class="save-chip/);
  // Save & exit lives in the top bar; the form keeps Back and Continue.
  assert.doesNotMatch(html, /data-action="save-exit"/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  // Before you start has no number; an ampersand in a title is escaped.
  assert.match(intakeScreen(v2State()), /<span class="overline">BEFORE YOU START<\/span><h1>Before you start<\/h1><p class="substep-count">1 of 4<\/p>/);
  assert.match(
    intakeScreen(v2State({ formSubstep: "expenses.other" })),
    /<span class="overline">STEP 4 OF 9 · EXPENSES &amp; LIFE EVENTS<\/span><h1>Other expenses<\/h1><p class="substep-count">2 of 3<\/p>/,
  );
  // A hidden sub-step resolves to the next visible one; an unknown id to the first.
  assert.match(intakeScreen(v2State({ formSubstep: "about.spouse" })), /<form id="intake-v2-form" novalidate data-substep="about\.sign">/);
  assert.match(intakeScreen(v2State({ formSubstep: "nowhere.at_all" })), /<form id="intake-v2-form" novalidate data-substep="before\.ready">/);
  // The senior titles are used when chosen.
  const senior = intakeScreen(v2State({ formSubstep: "about.address", draftAnswers: { ...sample(), form_version: "senior" } }));
  assert.ok(senior.includes(`<h1>${escText(findSubstep("about.address").title.senior.en)}</h1>`));
});

test("the rail tree: the current step expanded, the others collapsed, each with its toggle, link and marks", () => {
  const draftAnswers = sample();
  const visitedSubsteps = ["before.ready", "before.service", "before.language", "before.virtual", "about.you"];
  const html = intakeScreen(v2State({ formSubstep: "about.address", visitedSubsteps }));
  assert.match(html, /<nav class="rail-nav" aria-label="Form steps"><ol id="rail-tree" class="rail-tree">/);
  const steps = stepsFor(2);
  assert.equal((html.match(/<li class="rail-step/g) ?? []).length, steps.length);
  for (const step of steps) {
    const item = railStepOf(html, step.id);
    const expanded = step.id === "about";
    assert.match(
      item,
      new RegExp(`<button type="button" class="rail-toggle" data-action="toggle-rail-step" data-step-id="${step.id}" aria-expanded="${expanded}" aria-controls="rail-subs-${step.id}">`),
    );
    assert.ok(item.includes(`<span class="sr-only">Show or hide the parts of ${escText(step.title.en)}</span>`));
    assert.match(item, new RegExp(`<ol id="rail-subs-${step.id}" class="rail-subs"${expanded ? "" : " hidden"}>`));
    // The step's mark is its roll-up.
    const rollup = stepRollup(step.id, { answers: draftAnswers, visited: visitedSubsteps, revealed: new Set(), cards: cardsFor(draftAnswers, []) });
    assert.deepEqual(markOf(item, `rail-step-${step.id}-status`), { key: rollup.key, text: rollup.text });
  }
  // Numbers 1–9; Before you start has none.
  assert.doesNotMatch(railStepOf(html, "before"), /rail-step-num/);
  assert.match(railStepOf(html, "about"), /<span class="rail-step-num" aria-hidden="true">1<\/span>/);
  assert.match(railStepOf(html, "review"), /<span class="rail-step-num" aria-hidden="true">9<\/span>/);
  // A step's name links to its first sub-step that isn't Done, or its first when all are.
  assert.match(railStepOf(html, "about"), /<button type="button" class="rail-link" data-action="go-substep" data-substep="about\.address">/);
  assert.match(railStepOf(html, "before"), /<button type="button" class="rail-link" data-action="go-substep" data-substep="before\.ready">/);
  // The current sub-step: aria-current and "You are here"; only it.
  const here = subLinkOf(html, "about.address");
  assert.match(here, /aria-current="step"/);
  assert.match(here, /<small class="rail-here">You are here<\/small>/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.equal((html.match(/You are here/g) ?? []).length, 1);
  assert.doesNotMatch(subLinkOf(html, "about.you"), /aria-current/);
  // Sub-step marks: fixed ids with "." as "-".
  assert.deepEqual(markOf(html, "rail-sub-about-you-status"), { key: "done", text: "Done" });
  assert.deepEqual(markOf(html, "rail-sub-about-address-status"), { key: "none", text: "" });
  assert.deepEqual(markOf(html, "rail-step-before-status"), { key: "done", text: "Done" });
  // A hidden sub-step is not listed (the spouse, for an unmarried client).
  assert.doesNotMatch(html, /data-substep="about\.spouse"/);
  assert.doesNotMatch(html, /rail-sub-about-spouse-status/);
  // Collapsed steps still render their sub-steps' spans, hidden.
  assert.match(railStepOf(html, "income"), /rail-sub-income-wages-status/);
});

test("the rail's open and shut entries win over the current step, and the phone bar opens the tree", () => {
  const html = intakeScreen(v2State({ formSubstep: "about.address", openPanels: ["rail-open:income", "rail-shut:about"] }));
  assert.match(railStepOf(html, "about"), /aria-expanded="false" aria-controls="rail-subs-about"/);
  assert.match(railStepOf(html, "about"), /<ol id="rail-subs-about" class="rail-subs" hidden>/);
  assert.match(railStepOf(html, "income"), /aria-expanded="true" aria-controls="rail-subs-income"/);
  assert.match(railStepOf(html, "income"), /<ol id="rail-subs-income" class="rail-subs">/);
  // The phone bar, and the tree closed until "All steps" opens it.
  assert.match(
    html,
    /<div class="rail-phone"><span>About you · 2 of 6<\/span><button type="button" class="btn secondary" data-action="toggle-panel" data-panel="rail-all" aria-expanded="false" aria-controls="rail-tree">All steps<\/button><\/div>/,
  );
  const open = intakeScreen(v2State({ formSubstep: "about.address", openPanels: ["rail-all"] }));
  assert.match(open, /<ol id="rail-tree" class="rail-tree is-open">/);
  assert.match(open, /data-panel="rail-all" aria-expanded="true" aria-controls="rail-tree"/);
});

test("the progress bar counts visible sub-steps", () => {
  const draftAnswers = sample();
  const count = visibleSubsteps(draftAnswers, cardsFor(draftAnswers, [])).length;
  const html = intakeScreen(v2State({ formSubstep: "about.address" }));
  assert.match(html, new RegExp(`<progress class="rail-bar" max="${count}" value="6"[^>]*></progress><p>Part 6 of ${count}</p>`));
  // A married client has one more part.
  const married = makeSampleAnswers({ married: true });
  const more = visibleSubsteps(married, cardsFor(married, [])).length;
  assert.equal(more, count + 1);
  assert.match(intakeScreen(v2State({ formSubstep: "about.address", draftAnswers: married })), new RegExp(`max="${more}" value="6"`));
});

test("the rail counts a revealed invalid answer on its sub-step and its step", () => {
  const draftAnswers = { ...sample(), email: "a@" };
  const html = intakeScreen(v2State({ formSubstep: "income.wages", draftAnswers, visitedSubsteps: ["about.you"], revealed: ["email"] }));
  assert.deepEqual(markOf(html, "rail-sub-about-you-status"), { key: "needs", text: "Needs answers" });
  assert.deepEqual(markOf(html, "rail-step-about-status"), { key: "needs", text: "Needs answers" });
  const ctx = { answers: draftAnswers, visited: ["about.you"], revealed: new Set(["email"]), cards: cardsFor(draftAnswers, []) };
  assert.equal(substepStatus("about.you", ctx).key, "needs");
});

test("a Documents sub-step with a Needed card still Not done reads Needs documents", () => {
  const html = intakeScreen(v2State({ formSubstep: "notes.anything", visitedSubsteps: ["documents.identity"] }));
  assert.deepEqual(markOf(html, "rail-sub-documents-identity-status"), { key: "docs", text: "Needs documents" });
  assert.deepEqual(markOf(html, "rail-step-documents-status"), { key: "docs", text: "Needs documents" });
  // Later or Don't have clears it.
  const marked = intakeScreen(
    v2State({
      formSubstep: "notes.anything",
      visitedSubsteps: ["documents.identity"],
      savedCase: v2Case({ documentCards: [{ slotId: "photo_id.tp", status: "later" }, { slotId: "ssn.tp", status: "none" }] }),
    }),
  );
  assert.deepEqual(markOf(marked, "rail-sub-documents-identity-status"), { key: "done", text: "Done" });
});

test("Needs an answer shows on the current sub-step only once it was visited", () => {
  const fresh = intakeScreen(v2State({ formSubstep: "about.you", draftAnswers: { ...CONSENT_14446 } }));
  assert.doesNotMatch(fresh, /Needs an answer/);
  assert.doesNotMatch(fresh, /is-missing/);
  const again = intakeScreen(v2State({ formSubstep: "about.you", draftAnswers: { ...CONSENT_14446 }, visitedSubsteps: ["about.you"] }));
  assert.match(again, /<p id="field-client-tp_first_name-note" class="q-note is-missing" aria-live="polite">Needs an answer<\/p>/);
  // Every rendered question is a data-q wrapper (the page's renderedIds), and only this sub-step's.
  for (const id of ["tp_first_name", "tp_dob", "tp_phone", "email"]) assert.match(again, new RegExp(`data-q="${id}"`));
  assert.doesNotMatch(again, /data-q="addr_zip"/);
});

test("a revealed error shows on an unvisited sub-step, in the note and the rail", () => {
  const draftAnswers = { ...sample(), email: "a@" };
  const html = intakeScreen(v2State({ formSubstep: "about.you", draftAnswers, revealed: ["email"] }));
  assert.match(html, /<p id="field-client-email-note" class="q-note is-invalid" aria-live="polite">Enter a valid email address\.<\/p>/);
  assert.deepEqual(markOf(html, "rail-sub-about-you-status"), { key: "needs", text: "Needs answers" });
  const quiet = intakeScreen(v2State({ formSubstep: "about.you", draftAnswers }));
  assert.doesNotMatch(quiet, /is-invalid/);
  assert.deepEqual(markOf(quiet, "rail-sub-about-you-status"), { key: "none", text: "" });
});

test("with the senior wording chosen, questions use it", () => {
  const html = intakeScreen(v2State({ formSubstep: "about.you", draftAnswers: { ...sample(), form_version: "senior" } }));
  assert.ok(html.includes(escText(findQuestion(2, "tp_first_name").wording.senior.en)));
  assert.ok(!html.includes(`>${findQuestion(2, "tp_first_name").wording.general.en}<`));
  const general = intakeScreen(v2State({ formSubstep: "about.you" }));
  assert.ok(general.includes(`>${findQuestion(2, "tp_first_name").wording.general.en}<`));
});

test("show-if: the spouse questions render only for a married client", () => {
  const married = intakeScreen(v2State({ formSubstep: "about.spouse", draftAnswers: makeSampleAnswers({ married: true }) }));
  assert.match(married, /<form id="intake-v2-form" novalidate data-substep="about\.spouse">/);
  assert.match(married, /data-q="sp_first_name"/);
  const single = intakeScreen(v2State({ formSubstep: "about.spouse" }));
  assert.doesNotMatch(single, /data-q="sp_first_name"/);
  assert.match(single, /<form id="intake-v2-form" novalidate data-substep="about\.sign">/);
});

test("a widowed client's spouse sub-step reads Your late spouse, and follows the year (add-widowed-spouse-rules)", () => {
  const widowed = (year) => ({ ...makeSampleAnswers(), marital_status: "widowed", spouse_death_year: year, sp_first_name: "Wei", sp_last_name: "Lin", sp_dob: "1960-02-03" });
  const died2025 = intakeScreen(v2State({ formSubstep: "about.spouse", draftAnswers: widowed("2025") }));
  assert.match(died2025, /<h1>Your late spouse<\/h1>/);
  assert.match(died2025, /<span class="rail-subtitle">Your late spouse<\/span>/);
  assert.doesNotMatch(died2025, />Your spouse</);
  assert.match(died2025, /data-q="sp_job_title"/);
  assert.doesNotMatch(died2025, /data-q="sp_phone"/);
  const died2024 = intakeScreen(v2State({ formSubstep: "about.spouse", draftAnswers: widowed("2024") }));
  assert.match(died2024, /data-q="sp_first_name"/);
  assert.doesNotMatch(died2024, /data-q="sp_job_title"/);
  const died2015 = intakeScreen(v2State({ formSubstep: "about.spouse", draftAnswers: widowed("2015") }));
  assert.doesNotMatch(died2015, /data-q="sp_first_name"/);
  assert.match(died2015, /<form id="intake-v2-form" novalidate data-substep="about\.sign">/);
});

test("a lead line replaces the section intro; a section's intro shows on its first sub-step only", () => {
  const wages = intakeScreen(v2State({ formSubstep: "income.wages" }));
  assert.match(wages, /<p class="q-lead">Did you receive any of these in 2025\?<\/p>/);
  assert.match(intakeScreen(v2State({ formSubstep: "expenses.events" })), /<p class="q-lead">Did any of these happen to you in 2025\?<\/p>/);
  // No Section 9 intro anywhere, and no intro beside a lead.
  for (const id of ["income.wages", "income.retirement", "income.investments", "income.rental", "income.business", "income.other"])
    assert.doesNotMatch(intakeScreen(v2State({ formSubstep: id })), /class="q-intro"/, id);
  // Section 6's intro on the household page; nothing on About you's later pages.
  assert.match(intakeScreen(v2State({ formSubstep: "household.members" })), /class="q-intro"/);
  assert.doesNotMatch(intakeScreen(v2State({ formSubstep: "about.address" })), /class="q-intro"/);
  // Section 0's intro on before.ready only, not on the later Before you start pages.
  assert.match(intakeScreen(v2State()), /<div class="q-intro"><p>Please have these ready:/);
  assert.doesNotMatch(intakeScreen(v2State({ formSubstep: "before.service" })), /class="q-intro"/);
});

test("before.ready adds a line after the S0 text: the Documents step, or a list for same-day", () => {
  const html = intakeScreen(v2State());
  assert.match(html, /ts\.voltax@irs\.gov[\s\S]*<p class="q-intro-extra">You will upload them in the Documents step\.<\/p>/);
  assert.doesNotMatch(html, /You will get a list of what to bring/);
  const sameDay = intakeScreen(v2State({ draftAnswers: { ...sample(), service: "same_day" } }));
  assert.match(sameDay, /<p class="q-intro-extra">You will get a list of what to bring\.<\/p>/);
  assert.doesNotMatch(sameDay, /Documents step/);
  assert.doesNotMatch(intakeScreen(v2State({ formSubstep: "before.service" })), /q-intro-extra/);
});

test("Back, Continue and Back to summary", () => {
  const first = intakeScreen(v2State());
  assert.doesNotMatch(first, /data-action="back-step"/);
  assert.match(first, /<button type="submit" class="btn primary"[^>]*>Continue/);
  const middle = intakeScreen(v2State({ formSubstep: "about.you" }));
  assert.match(middle, /data-action="back-step"/);
  assert.match(middle, /<button type="submit" class="btn primary"[^>]*>Continue/);
  const submit = intakeScreen(v2State({ formSubstep: "review.submit", visitedSubsteps: ["review.submit"] }));
  assert.match(submit, /data-action="back-step"/);
  assert.doesNotMatch(submit, /type="submit"/);
  // A Change link's return: the primary button goes back to the summary instead.
  const change = intakeScreen(v2State({ formSubstep: "about.address", returnToSummary: true }));
  assert.match(change, /<button type="button" class="btn primary" data-action="back-to-summary"[^>]*>Back to summary<\/button>/);
  assert.doesNotMatch(change, /type="submit"/);
  // A conflict or a save in flight disables the primary button.
  assert.match(intakeScreen(v2State({ formSubstep: "about.you", busy: true })), /<button type="submit" class="btn primary" disabled>/);
});

test("a Documents sub-step: Needed cards, then the Maybe needed group, each card with its marks", () => {
  const html = intakeScreen(v2State({ formSubstep: "documents.identity" }));
  assert.match(html, /<span class="overline">STEP 7 OF 9 · DOCUMENTS<\/span><h1>Identity<\/h1>/);
  const photo = cardOf(html, "photo_id.tp");
  assert.ok(photo, "the photo ID card is rendered");
  assert.match(photo, /<h3>Photo ID \(driver&#39;s license, state ID, passport\)<\/h3>/);
  assert.match(photo, /<p class="doc-owner">Mei Chen<\/p>/);
  // Upload buttons, disabled, described by the note.
  for (const name of ["Take a photo", "Choose a file"])
    assert.match(photo, new RegExp(`<button type="button" class="btn secondary" disabled aria-describedby="doc-photo_id-tp-note">[\\s\\S]*?${name}</button>`));
  assert.match(photo, /<p class="doc-note" id="doc-photo_id-tp-note">Uploading arrives soon\. For now, bring it or mark it below\.<\/p>/);
  assert.match(photo, /<button type="button" class="btn secondary" data-action="mark-card" data-slot="photo_id\.tp" data-status="later">I will send it later<\/button>/);
  assert.match(photo, /<button type="button" class="btn secondary" data-action="mark-card" data-slot="photo_id\.tp" data-status="none">I don&#39;t have this<\/button>/);
  assert.doesNotMatch(photo, /data-status="not_done"/);
  assert.match(photo, /<p class="doc-status is-not_done" id="doc-photo_id-tp-status" tabindex="-1">[\s\S]*Not done<\/p>/);
  assert.match(photo, /<svg/, "the status has an icon");
  // No why line on photo ID, so no link.
  assert.doesNotMatch(photo, /data-action="go-substep"/);
  // Maybe needed: a closed toggle after the Needed cards, its cards not shown.
  const toggle = /<button type="button" class="doc-maybe-toggle" data-action="toggle-panel" data-panel="maybe:documents\.identity" aria-expanded="false"[^>]*>Maybe needed \(1\)<\/button>/.exec(html);
  assert.ok(toggle, "the Maybe needed toggle is rendered");
  assert.ok(html.indexOf(cardOf(html, "ssn.tp")) < toggle.index);
  assert.equal(cardOf(html, `ssn.hh.${MEMBER}`), undefined);
  // Open, the Maybe needed card shows, with its why line linking back.
  const open = intakeScreen(v2State({ formSubstep: "documents.identity", openPanels: ["maybe:documents.identity"] }));
  assert.match(open, /data-panel="maybe:documents\.identity" aria-expanded="true"/);
  const member = cardOf(open, `ssn.hh.${MEMBER}`);
  assert.ok(member, "the household member's card shows");
  assert.match(member, /<p class="doc-owner">Lin Chen<\/p>/);
  assert.match(member, /<button type="button" class="inline" data-action="go-substep" data-substep="household\.members">You listed this person in your household<\/button>/);
  assert.ok(open.indexOf(member) > open.indexOf("doc-maybe-toggle"));
});

test("a card's status reads Later or Don't have, and then offers Mark as not done", () => {
  const state = (status) =>
    v2State({ formSubstep: "documents.income", savedCase: v2Case({ documentCards: [{ slotId: "w2.household", status }] }) });
  const later = cardOf(intakeScreen(state("later")), "w2.household");
  assert.match(later, /<p class="doc-status is-later" id="doc-w2-household-status" tabindex="-1">[\s\S]*Later<\/p>/);
  assert.match(later, /<button type="button" class="btn secondary" data-action="mark-card" data-slot="w2\.household" data-status="not_done">Mark as not done<\/button>/);
  const none = cardOf(intakeScreen(state("none")), "w2.household");
  assert.match(none, /<p class="doc-status is-none" id="doc-w2-household-status" tabindex="-1">[\s\S]*Don&#39;t have<\/p>/);
  assert.match(none, /data-status="not_done">Mark as not done/);
  // The why line links to the question that asked.
  assert.match(later, /<button type="button" class="inline" data-action="go-substep" data-substep="income\.wages">You said you had wages from a job<\/button>/);
  assert.match(later, /<p class="doc-owner">For you<\/p>/);
  assert.match(later, /You said 1 job\. Upload 1 W-2\./);
});

test("while an action is in flight, the form's navigation and the card marks are disabled", () => {
  // The controller ignores a sub-step change or a mark while one is in flight
  // (a second write would meet a false conflict); disabled, the page never
  // offers one, so nothing is dropped silently.
  const GUARDED = /<button[^>]*data-action="(?:go-substep|change-substep|back-step|back-to-summary|mark-card)"[^>]*>/g;
  const tagsOf = (html) => html.match(GUARDED) ?? [];
  const draftAnswers = { ...without(sample(), "tp_first_name"), email: "a@" };
  const later = v2Case({ documentCards: [{ slotId: "w2.household", status: "later" }] });
  const pages = [
    { formSubstep: "about.you" },
    { formSubstep: "about.address", returnToSummary: true },
    { formSubstep: "documents.income", savedCase: later },
    { formSubstep: "documents.identity", openPanels: ["maybe:documents.identity"] },
    { formSubstep: "review.check", draftAnswers },
    { formSubstep: "review.summary", savedCase: later },
    { formSubstep: "review.submit", visitedSubsteps: ["review.submit"] },
  ];
  const seen = new Set();
  for (const page of pages) {
    const idle = tagsOf(intakeScreen(v2State(page)));
    const busy = tagsOf(intakeScreen(v2State({ ...page, busy: true })));
    assert.ok(busy.length > 0 && busy.length === idle.length, page.formSubstep);
    for (const tag of idle) assert.doesNotMatch(tag, /\sdisabled/, `${page.formSubstep}: ${tag}`);
    for (const tag of busy) {
      assert.match(tag, /\sdisabled[\s>]/, `${page.formSubstep}: ${tag}`);
      seen.add(/data-action="([^"]+)"/.exec(tag)[1]);
    }
    // Opening and closing parts of the page sends nothing, so it stays live.
    const busyHtml = intakeScreen(v2State({ ...page, busy: true }));
    for (const toggle of busyHtml.match(/<button[^>]*data-action="(?:toggle-rail-step|toggle-panel)"[^>]*>/g) ?? [])
      assert.doesNotMatch(toggle, /\sdisabled/, toggle);
  }
  assert.deepEqual([...seen].sort(), ["back-step", "back-to-summary", "change-substep", "go-substep", "mark-card"]);
  // The progress page's marks too.
  const progress = (busy) =>
    progressScreen(baseState({ screen: "progress", busy, savedCase: v2Case({ stage: "received", answers: sample() }) }));
  const idleMarks = tagsOf(progress(false));
  const busyMarks = tagsOf(progress(true));
  assert.ok(busyMarks.length > 0 && busyMarks.length === idleMarks.length);
  for (const tag of idleMarks) assert.doesNotMatch(tag, /\sdisabled/, tag);
  for (const tag of busyMarks) assert.match(tag, /\sdisabled[\s>]/, tag);
});

test("the optional Other documents card has the upload buttons but no marks and no status", () => {
  const html = intakeScreen(v2State({ formSubstep: "documents.other" }));
  const other = cardOf(html, "other.household");
  assert.ok(other, "the Other documents card shows");
  assert.match(other, /<h3>Other documents<\/h3>/);
  assert.match(other, /<p class="doc-owner">For your household<\/p>/);
  assert.match(other, /For example, a city tax notice, or a blank local tax form you received\./);
  assert.match(other, /disabled aria-describedby="doc-other-household-note"/);
  assert.match(other, /class="doc-note"/);
  assert.doesNotMatch(other, /mark-card/);
  assert.doesNotMatch(other, /doc-status/);
  assert.doesNotMatch(html, /doc-maybe-toggle/);
});

test("same-day: Bring these to your visit, a list with no buttons and no statuses", () => {
  const draftAnswers = { ...sample(), service: "same_day" };
  const html = intakeScreen(v2State({ formSubstep: "documents.bring", draftAnswers }));
  assert.match(html, /<h1>Bring these to your visit<\/h1>/);
  const list = /<ul class="bring-list">[\s\S]*?<\/ul>/.exec(html)?.[0];
  assert.ok(list, "the bring list is rendered");
  for (const card of cardsFor(draftAnswers, []).filter((c) => c.group !== "optional"))
    assert.ok(list.includes(escText(card.label.en)), card.slotId);
  // Needed first, then Maybe needed.
  assert.ok(list.indexOf("A voided check") < list.indexOf("Maybe needed"));
  assert.doesNotMatch(list, /Other documents/);
  assert.doesNotMatch(html, /data-action="mark-card"/);
  assert.doesNotMatch(html, /doc-status/);
  assert.doesNotMatch(html, /Take a photo/);
  assert.doesNotMatch(html, /<article class="doc-card"/);
});

test("review.check: the two texts, alerts grouped by step and the document warnings", () => {
  const draftAnswers = { ...without(sample(), "tp_first_name", "refund_method"), email: "a@" };
  const html = intakeScreen(v2State({ formSubstep: "review.check", draftAnswers }));
  assert.match(html, /<p>Please review your application and check it for accuracy and completeness before you submit it\.<\/p>/);
  assert.match(html, /<p>The IRS Volunteer Income Tax Assistance \(VITA\) program is completely free if you qualify\. We will never ask you to pay\.<\/p>/);
  assert.match(html, /<section class="alerts-panel" aria-labelledby="alerts-title"><h2 id="alerts-title" tabindex="-1">Alerts and warnings<\/h2>/);
  const alerts = /<div class="alerts-block">[\s\S]*?<\/div><div class="warnings-block">/.exec(html)?.[0];
  assert.ok(alerts, "alerts come before warnings");
  assert.match(alerts, /Fix before you submit/);
  const item = (kind, id, wordingOf, flag) =>
    new RegExp(`<button type="button" class="alert-item is-${kind}" data-action="go-substep" data-substep="${reEsc(id)}">[\\s\\S]*?${reEsc(escText(wordingOf))}[\\s\\S]*?${flag}[\\s\\S]*?</button>`);
  assert.match(alerts, item("missing", "about.you", findQuestion(2, "tp_first_name").wording.general.en, "Needs an answer"));
  assert.match(alerts, item("invalid", "about.you", findQuestion(2, "email").wording.general.en, "Needs a change"));
  assert.match(alerts, item("missing", "refund.payment", findQuestion(2, "refund_method").wording.general.en, "Needs an answer"));
  // Grouped by step, in step order.
  assert.ok(alerts.indexOf("Step 1: About you") < alerts.indexOf("Step 5: Refund &amp; permission"));
  assert.ok(alerts.indexOf("Step 1: About you") < alerts.indexOf(escText(findQuestion(2, "tp_first_name").wording.general.en)));
  // Warnings: every Needed card Not done or Later, each with Upload now.
  const warnings = /<div class="warnings-block">[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(warnings, /You can still submit/);
  for (const [slot, substep] of [["photo_id.tp", "identity"], ["ssn.tp", "identity"], ["w2.household", "income"]])
    assert.match(warnings, new RegExp(`data-action="go-substep" data-substep="documents\\.${substep}" data-focus="doc-${reEsc(slug(slot))}">Upload now</button>`));
  // The Maybe needed cards as one line (the member's SSN and the bank letter).
  assert.match(warnings, /<button type="button" class="inline" data-action="go-substep" data-substep="documents\.identity">2 more documents may be needed<\/button>/);
  assert.doesNotMatch(html, /alerts-empty/);
});

test("review.check: Later still warns, Don't have does not, and nothing at all reads the empty sentence", () => {
  const cards = (statuses) => v2Case({ documentCards: Object.entries(statuses).map(([slotId, status]) => ({ slotId, status })) });
  const later = intakeScreen(v2State({ formSubstep: "review.check", savedCase: cards({ "photo_id.tp": "later", "ssn.tp": "none" }) }));
  assert.match(later, /data-focus="doc-photo_id-tp">Upload now/);
  assert.doesNotMatch(later, /data-focus="doc-ssn-tp"/);
  assert.doesNotMatch(later, /alerts-block/);
  const settled = cards({
    "photo_id.tp": "none",
    "ssn.tp": "none",
    "w2.household": "none",
    "bank.household": "none",
    [`ssn.hh.${MEMBER}`]: "none",
  });
  const empty = intakeScreen(v2State({ formSubstep: "review.check", savedCase: settled }));
  assert.match(empty, /<p class="alerts-empty">We found no alerts or warnings in your application\.<\/p>/);
  assert.doesNotMatch(empty, /alerts-block|warnings-block/);
  // One Maybe needed card reads in the singular.
  const one = intakeScreen(v2State({ formSubstep: "review.check", savedCase: cards({ "photo_id.tp": "none", "ssn.tp": "none", "w2.household": "none", "bank.household": "none" }) }));
  assert.match(one, />1 more document may be needed</);
});

test("review.check: same-day gets no document warnings, and alerts come from the draft alone", () => {
  const sameDay = intakeScreen(v2State({ formSubstep: "review.check", draftAnswers: { ...sample(), service: "same_day" } }));
  assert.match(sameDay, /alerts-empty/);
  assert.doesNotMatch(sameDay, /Upload now|may be needed/);
  // The phone is on the server's contact record but not in the draft: still an alert.
  const html = intakeScreen(
    v2State({
      formSubstep: "review.check",
      draftAnswers: without(sample(), "tp_phone"),
      savedCase: v2Case({ contact: { phone: "2155550100", spousePhone: null, bestContactTime: null, bestContactNote: null } }),
    }),
  );
  assert.match(html, /class="alert-item is-missing" data-action="go-substep" data-substep="about\.you"/);
});

test("review.check: Continue waits for the alerts, and a line next to it says why", () => {
  const blocked = form({ formSubstep: "review.check", draftAnswers: without(sample(), "addr_city") });
  assert.match(
    blocked,
    /<p id="continue-blocked" class="form-blocked">Fix the items above to continue\.<\/p><button type="submit" class="btn primary" aria-describedby="continue-blocked" disabled>Continue/,
  );
  const invalid = form({ formSubstep: "review.check", draftAnswers: { ...sample(), email: "a@" } });
  assert.match(invalid, /aria-describedby="continue-blocked" disabled>/);
  // Open documents never block: the sample's Needed cards are Not done.
  assert.ok(cardsFor(sample(), []).some((card) => card.group === "needed" && card.status === "not_done"));
  const open = form({ formSubstep: "review.check" });
  assert.match(open, /<button type="submit" class="btn primary">Continue/);
  assert.doesNotMatch(open, /continue-blocked/);
  // Other parts never draw the line, even with an alert.
  assert.doesNotMatch(form({ formSubstep: "about.you", draftAnswers: without(sample(), "addr_city") }), /continue-blocked/);
  // In Chinese.
  assert.match(
    form({ formSubstep: "review.check", draftAnswers: without(sample(), "addr_city"), lang: "zh-Hans" }),
    /<p id="continue-blocked" class="form-blocked">请先修正上面的问题，然后继续。<\/p>/,
  );
});

test("the rail and the count follow the review gate", () => {
  const reviewRail = (html) =>
    [...html.matchAll(/class="rail-sublink" data-action="go-substep" data-substep="(review\.[a-z]+)"/g)].map((match) => match[1]);
  const count = (html) => Number(/<p>Part \d+ of (\d+)<\/p>/.exec(html)[1]);
  const clean = intakeScreen(v2State({ formSubstep: "review.check" }));
  assert.deepEqual(reviewRail(clean), ["review.check", "review.summary"]);
  const earned = intakeScreen(v2State({ formSubstep: "review.check", visitedSubsteps: ["review.submit"] }));
  assert.deepEqual(reviewRail(earned), ["review.check", "review.summary", "review.submit"]);
  assert.equal(count(earned), count(clean) + 1);
  // An alert after 9.3 was earned: both hide, and the page is 9.1.
  const alert = intakeScreen(
    v2State({ formSubstep: "review.submit", visitedSubsteps: ["review.submit"], draftAnswers: without(sample(), "addr_city") }),
  );
  assert.deepEqual(reviewRail(alert), ["review.check"]);
  assert.match(alert, /id="intake-v2-form"[^>]*data-substep="review\.check"/);
  assert.equal(count(alert), count(clean) - 1);
  // The review step's mark stays blank until submission, even with 9.1 and 9.2 Done.
  const visitedBoth = intakeScreen(v2State({ formSubstep: "review.summary", visitedSubsteps: ["review.check", "review.summary"] }));
  assert.match(visitedBoth, /<span id="rail-step-review-status" class="rail-status is-none">/);
});

const summaryPage = (overrides = {}) =>
  form({ formSubstep: "review.summary", savedCase: v2Case({ documentCards: [{ slotId: "w2.household", status: "later" }] }), ...overrides });

test("review.summary: the intro, then the tools, then Expand and Collapse all, then the printed block", () => {
  const html = summaryPage();
  const [intro, tools, fold, start, end] = [
    '<div class="summary-intro">', '<div class="summary-tools">', '<div class="summary-fold">', '<div class="summary-print">', '<div class="form-actions">',
  ].map((needle) => html.indexOf(needle));
  assert.ok(intro >= 0 && intro < tools && tools < fold && fold < start && start < end, "the order");
  assert.equal(
    html.slice(intro, tools),
    '<div class="summary-intro"><p>Here is a summary of everything you told us in your application.</p><p>Before you submit, make sure you have answered everything that applies to you. To change an answer, choose <strong>Change</strong> next to that part, or choose that part in the list of steps.</p><p>With the buttons below, you can print this summary, or view and download a draft Form 14446 made from your answers.</p></div>',
  );
  assert.equal(
    html.slice(fold, start),
    '<div class="summary-fold"><button type="button" id="summary-expand-all" class="btn text" data-action="summary-expand-all">Expand all</button><button type="button" id="summary-collapse-all" class="btn text" data-action="summary-collapse-all">Collapse all</button></div>',
  );
  // The tools, before the printed block.
  const toolbox = html.slice(tools, fold);
  assert.match(toolbox, /data-action="print-summary"[^>]*>[\s\S]*?Print<\/button>/);
  assert.match(toolbox, /data-action="view-draft" data-draft="14446" data-form="en"[^>]*>[\s\S]*?View Draft Form 14446<\/button>/);
  assert.doesNotMatch(toolbox, /data-action="view-draft"(?![^>]*data-draft="14446")/);
  assert.doesNotMatch(toolbox, /13614-C/);
  assert.match(toolbox, /<p id="draft-ready" class="draft-ready" aria-live="polite"><\/p>/);
  const printed = html.slice(start, end);
  assert.match(printed, /VT-GJPY-JAY9/);
  assert.match(printed, /October 4, 2026/);
  // Each step's heading is its toggle; every section starts expanded.
  assert.ok(
    printed.includes(
      `<section class="summary-step"><h2 class="summary-step-head"><button type="button" id="summary-toggle-about" class="summary-toggle" data-action="toggle-panel" data-panel="summary-shut:about" aria-expanded="true" aria-controls="summary-body-about" aria-label="Show or hide About you">${icon("expand")}<span>About you</span></button></h2><div id="summary-body-about" class="summary-body">`,
    ),
  );
  assert.doesNotMatch(printed, /aria-expanded="false"|class="summary-body" hidden/);
  // Sub-steps, each with its Change link.
  assert.match(printed, /<div class="summary-sub"><div class="summary-sub-head"><h3>Mailing address<\/h3><button type="button" class="inline" data-action="change-substep" data-substep="about\.address">Change<\/button><\/div>/);
  assert.match(printed, /<section class="summary-step summary-documents"><h2 class="summary-step-head"><button[^>]*data-panel="summary-shut:documents"/);
  assert.match(printed, /<span>[^<]*<\/span><strong>Philadelphia<\/strong>/);
  assert.ok(printed.includes(`<strong>${escText(formatAnswer(findQuestion(2, "marital_status"), "never_married"))}</strong>`));
  assert.doesNotMatch(printed, /data-substep="about\.spouse"/);
  assert.doesNotMatch(printed, /data-substep="review\./);
  // The cards and their status.
  assert.match(printed, /W-2 from each job[\s\S]*?<strong>Later<\/strong>/);
  assert.match(printed, /Photo ID[\s\S]*?<strong>Not done<\/strong>/);
  assert.doesNotMatch(printed, /Other documents/);
  // Same-day: the bring list instead of the cards.
  const sameDay = form({ formSubstep: "review.summary", draftAnswers: { ...sample(), service: "same_day" } });
  assert.match(sameDay.slice(sameDay.indexOf("summary-print"), sameDay.indexOf("form-actions")), /<ul class="bring-list">/);
});

test("the summary offers the draft Form 14446 in English and 繁體, never 简体 (add-form-14446-consent)", () => {
  const summary = (lang) => intakeScreen(v2State({ formSubstep: "review.summary", visitedSubsteps: ["review.check"], lang }));
  const en = summary("en");
  assert.match(en, /data-action="view-draft" data-draft="14446" data-form="en"/);
  assert.match(en, /data-draft="14446" data-form="zh-t"/);
  assert.doesNotMatch(en, /data-draft="14446" data-form="zh-s"/);
  assert.match(en, /view and download a draft Form 14446 made from your answers/);
  assert.doesNotMatch(en, /13614-C/);
  // The spec's order: Print, then View Draft Form 14446.
  const at = (pattern) => en.search(pattern);
  assert.ok(at(/data-action="print-summary"/) < at(/data-draft="14446"/), "Print before the 14446");
  const hans = summary("zh-Hans");
  assert.match(hans, /data-draft="14446" data-form="zh-t"/);
  assert.doesNotMatch(hans, /data-draft="14446" data-form="zh-s"/);
  // The primary button names the form it opens, 繁體, in the screen's own script.
  const primary = (html, form) => new RegExp(`<button[^>]*class="btn secondary"[^>]*data-draft="14446" data-form="${form}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? "";
  assert.ok(primary(hans, "zh-t").includes(t("draft.form_zh_t", {}, "zh-Hans")), "简体 screen: 繁体中文版");
  const hant = summary("zh-Hant");
  assert.ok(primary(hant, "zh-t").includes(t("draft.form_zh_t", {}, "zh-Hant")), "繁體 screen: 繁體中文版");
  assert.doesNotMatch(primary(en, "en"), /繁/);
});

test("review.summary: a section folds from its heading, and Expand or Collapse all sets them all", () => {
  const shut = summaryPage({ openPanels: ["summary-shut:about", "summary-shut:documents"] });
  assert.match(shut, /data-panel="summary-shut:about" aria-expanded="false" aria-controls="summary-body-about"/);
  assert.match(shut, /<div id="summary-body-about" class="summary-body" hidden>/);
  assert.match(shut, /<div id="summary-body-household" class="summary-body">/);
  assert.match(shut, /data-panel="summary-shut:documents" aria-expanded="false"/);
  // Same-day: the bring list is the documents section.
  const sameDay = form({
    formSubstep: "review.summary",
    draftAnswers: { ...sample(), service: "same_day" },
    openPanels: ["summary-shut:documents"],
  });
  assert.match(sameDay, /<div id="summary-body-documents" class="summary-body" hidden><ul class="bring-list">/);
  // Busy: folding sends nothing, so it stays live.
  for (const tag of summaryPage({ busy: true }).match(/<button[^>]*(?:summary-toggle|summary-expand-all|summary-collapse-all)[^>]*>/g))
    assert.doesNotMatch(tag, /\sdisabled/, tag);
  // The submitted page's answers don't fold.
  assert.doesNotMatch(
    submittedV2(v2State({ savedCase: v2Case({ stage: "received", answers: sample() }) })),
    /summary-toggle|summary-fold/,
  );
});

test("review.summary in Chinese: the intro names its controls, and the buttons read 全部展开 and 全部收起", () => {
  const html = summaryPage({ lang: "zh-Hans" });
  assert.ok(html.includes("<p>提交之前，请确认所有适用于您的问题都已回答。如需修改，请点击相应部分旁边的“修改”，或在步骤列表中选择该部分。</p>"));
  assert.match(html, /data-action="summary-expand-all">全部展开<\/button>/);
  assert.match(html, /data-action="summary-collapse-all">全部收起<\/button>/);
  assert.match(html, /data-panel="summary-shut:about" aria-expanded="true" aria-controls="summary-body-about" aria-label="显示或隐藏[^"]+"/);
});

test("review.submit: Submit waits for no alerts and the confirmation", () => {
  const clean = { formSubstep: "review.submit", visitedSubsteps: ["review.submit"] };
  const html = intakeScreen(v2State(clean));
  // 9.3 is never drawn with an alert, so it has no alert notice.
  assert.doesNotMatch(html, /See the alerts/);
  assert.match(html, /<input type="checkbox" id="field-confirmed" name="confirmed"\s*>/);
  assert.match(html, /I have checked my answers/);
  assert.match(submitOf(html), /disabled/);
  assert.doesNotMatch(submitOf(intakeScreen(v2State({ ...clean, openPanels: ["confirmed"] }))), /disabled/);
  // With an alert there is no Submit page: 9.3 resolves to 9.1, whose
  // Continue waits (the gate). Submit's own rule stays for a stale page.
  for (const draftAnswers of [without(sample(), "tp_first_name"), { ...sample(), email: "a@" }]) {
    const html = intakeScreen(v2State({ ...clean, openPanels: ["confirmed"], draftAnswers }));
    assert.match(html, /id="intake-v2-form"[^>]*data-substep="review\.check"/);
    assert.doesNotMatch(html, /data-case-action="SUBMIT"/);
  }
  // Document warnings never block.
  assert.ok(cardsFor(sample(), []).some((card) => card.group === "needed" && card.status === "not_done"));
  // A conflict or a save in flight does.
  assert.match(submitOf(intakeScreen(v2State({ ...clean, openPanels: ["confirmed"], busy: true }))), /disabled/);
});

test("a submitted version-2 case shows its answers read-only, grouped by step and sub-step", () => {
  const answers = without(sample(), "tp_phone", "best_contact_time", "best_contact_note");
  const html = intakeScreen(
    v2State({
      savedCase: v2Case({
        stage: "received",
        answers,
        contact: { phone: "2155550123", spousePhone: null, bestContactTime: ["weekday_morning"], bestContactNote: null },
      }),
      draftAnswers: {},
    }),
  );
  assert.match(html, /Your answers are with the office/);
  assert.doesNotMatch(html, /<form|<input|data-action="change-substep"/);
  assert.match(html, /<section class="answer-step"><h2>About you<\/h2>/);
  assert.match(html, /<div class="answer-sub"><h3>About you<\/h3>/);
  assert.match(html, /<div class="answer-sub"><h3>Mailing address<\/h3>/);
  // Contact fields come from the contact record.
  assert.match(html, /<strong>\(215\) 555-0123<\/strong>/);
  assert.match(html, /<strong>Weekday mornings<\/strong>/);
  // Unanswered and hidden questions are left out; so is a sub-step with nothing answered.
  assert.doesNotMatch(html, /data-q=/);
  assert.doesNotMatch(html, /<h3>Your spouse<\/h3>/);
  assert.match(html, /data-action="open-progress"/);
});

test("the progress page lists open documents for version 2, with their marks", () => {
  const progress = (overrides) =>
    progressScreen(baseState({ screen: "progress", savedCase: v2Case({ stage: "received", answers: sample(), ...overrides }) }));
  const html = progress({ documentCards: [{ slotId: "ssn.tp", status: "none" }, { slotId: "w2.household", status: "later" }] });
  const panel = /<section class="panel open-documents"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(panel, "the open documents panel is rendered");
  assert.match(panel, /<h2 id="open-documents-title">Open documents<\/h2>/);
  assert.ok(cardOf(panel, "photo_id.tp"));
  assert.match(cardOf(panel, "w2.household"), /Later/);
  assert.match(cardOf(panel, "w2.household"), /data-status="not_done">Mark as not done/);
  assert.match(cardOf(panel, "photo_id.tp"), /data-action="mark-card" data-slot="photo_id\.tp" data-status="later"/);
  // Don't have, Maybe needed and the optional card are not open documents.
  assert.equal(cardOf(panel, "ssn.tp"), undefined);
  assert.equal(cardOf(panel, `ssn.hh.${MEMBER}`), undefined);
  assert.equal(cardOf(panel, "other.household"), undefined);
  // Answers are locked: no link back into the form.
  assert.doesNotMatch(panel, /data-action="go-substep"/);
  // After the status panel.
  assert.ok(html.indexOf("status-panel") < html.indexOf("open-documents"));
  // Same-day: the bring list.
  const sameDay = progressScreen(baseState({ screen: "progress", savedCase: v2Case({ stage: "received", answers: { ...sample(), service: "same_day" } }) }));
  assert.match(sameDay, /<h2 id="open-documents-title">Bring these to your visit<\/h2>/);
  assert.match(sameDay, /<ul class="bring-list">/);
  assert.doesNotMatch(sameDay, /mark-card/);
});

test("the version-2 chip: revealed invalid answers need checking, in every quiet save state", () => {
  const chip = (overrides) => plain(saveStatus(v2State(overrides)));
  const sample = makeSampleAnswers();
  const one = { draftAnswers: { ...sample, email: "a@" }, revealed: ["email"] };
  assert.equal(chip({ ...one, saveState: "saved" }), "1 answer needs checking");
  assert.equal(chip({ ...one, saveState: "idle" }), "1 answer needs checking");
  assert.equal(
    chip({ saveState: "saved", draftAnswers: { ...sample, email: "a@", tp_dob: "1984-02-30" }, revealed: ["email", "tp_dob"] }),
    "2 answers need checking",
  );
  assert.equal(chip({ saveState: "saved", draftAnswers: { ...sample, email: "a@" }, revealed: [] }), "Saved");
  assert.equal(chip({ ...one, saveState: "unsaved", dirty: true }), "Unsaved changes");
});

test("the client's form uses the not-married wording for an unmarried client", () => {
  const single = { ...makeSampleAnswers(), inc_wages: "yes" };
  const married = { ...makeSampleAnswers({ married: true }), inc_wages: "yes" };
  const wages = (answers) => form({ formSubstep: "income.wages", draftAnswers: answers });
  assert.match(wages(single), /<p class="q-lead">Did you receive any of these in 2025\?<\/p>/);
  assert.match(wages(single), /How many jobs did you have in 2025\?/);
  assert.doesNotMatch(wages(single), /your spouse/);
  assert.match(wages(married), /<p class="q-lead">Did you or your spouse receive any of these in 2025\?<\/p>/);
  assert.match(wages(married), /How many jobs did you and your spouse have in 2025\?/);

  const household = (answers) => form({ formSubstep: "household.members", draftAnswers: answers });
  assert.match(household(married), /\(except your spouse\)/);
  assert.doesNotMatch(household(single), /except your spouse/);

  // Alerts and the summary.
  const alerts = form({ formSubstep: "review.check", draftAnswers: without(makeSampleAnswers(), "claimed_by_other") });
  assert.match(alerts, /claim you as a dependent on their tax return\?/);
  assert.doesNotMatch(alerts, /claim you or your spouse/);
  const summary = form({ formSubstep: "review.summary", draftAnswers: makeSampleAnswers() });
  assert.match(summary, /claim you as a dependent on their tax return\?/);
});

test("a 2025 death keeps the married wording and the who questions; 2023 reads as unmarried (add-widowed-spouse-rules)", () => {
  const widowed = (year) => ({ ...makeSampleAnswers(), marital_status: "widowed", spouse_death_year: year, inc_wages: "yes" });
  const wages = (answers) => form({ formSubstep: "income.wages", draftAnswers: answers });
  assert.match(wages(widowed("2025")), /<p class="q-lead">Did you or your spouse receive any of these in 2025\?<\/p>/);
  assert.match(wages(widowed("2023")), /<p class="q-lead">Did you receive any of these in 2025\?<\/p>/);
  const situation = (answers) => form({ formSubstep: "about.situation", draftAnswers: answers });
  assert.match(situation(widowed("2025")), /Who is a U\.S\. citizen\?/);
  assert.match(situation(widowed("2023")), /Are you a U\.S\. citizen\?/);
});

test("the conflict table labels a row with the wording the client saw", () => {
  const sample = makeSampleAnswers(); // never married
  const html = conflictForm(
    v2State({
      savedCase: v2Case({ revision: 4, answers: { ...sample, opt_veteran: "no" } }),
      draftAnswers: { ...sample, opt_veteran: "yes" },
      dirty: true,
      editBaseRevision: 2,
      conflict: { code: "REMOTE_CHANGED", baseRevision: 2, serverRevision: 4 },
    }),
  );
  assert.match(html, /<th scope="row">Are you a veteran of the U\.S\. Armed Forces\?<\/th>/);
  assert.doesNotMatch(html, /Are you or your spouse a veteran/);
});

test("the version-2 conflict screen compares sendable values and labels rows by wording", () => {
  const sample = makeSampleAnswers();
  const member = sample.hh[0];
  const html = conflictForm(
    v2State({
      savedCase: v2Case({
        revision: 4,
        answers: { ...without(sample, "best_contact_time", "email"), tp_first_name: "Mei", hh: [member] },
        contact: { phone: sample.tp_phone, spousePhone: null, bestContactTime: ["weekday_morning"], bestContactNote: sample.best_contact_note },
      }),
      draftAnswers: {
        ...sample,
        tp_first_name: "Mei ",
        email: null,
        best_contact_time: ["weekday_evening", "weekend"],
        hh: [member, { member_id: "fedcba9876543210fedcba9876543210", first_name: "An", last_name: "Chen" }],
      },
      dirty: true,
      editBaseRevision: 2,
      conflict: { code: "REMOTE_CHANGED", baseRevision: 2, serverRevision: 4 },
    }),
  );
  const rows = [...html.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => m.slice(1));
  assert.deepEqual(
    rows.map(([label]) => label),
    [findQuestion(2, "best_contact_time").wording.general.en, findQuestion(2, "hh").wording.general.en],
  );
  assert.match(rows[0][1], /Weekday evenings, Weekends/);
  assert.match(rows[0][2], /Weekday mornings/);
  assert.match(rows[1][1], /Lin Chen · Son \/ Daughter · born Mar 14, 2015 · lived with you 12 months[\s\S]*An Chen/);
  assert.doesNotMatch(rows[1][2], /An Chen/);
  assert.match(html, /data-action="reconcile-mine"/);
  assert.match(html, /data-action="reconcile-server"/);
});

test("the progress page labels service and language codes", () => {
  const progress = (savedCase) => progressScreen(baseState({ screen: "progress", savedCase }));
  const v2 = progress(v2Case({ stage: "received", answers: { service: "drop_off", language: "english", tp_first_name: "Mei" } }));
  assert.match(v2, /<span>Service<\/span><strong>Drop-off<\/strong>/);
  assert.match(v2, /<span>Language<\/span><strong>English<\/strong>/);
  assert.match(v2, /Hello, Mei\./);
  // Every language the client named, by full name, preferred first (allow-multiple-service-languages, design D7).
  const both = progress(v2Case({ stage: "received", answers: { service: "drop_off", language: "cantonese", language_also: ["mandarin"], tp_first_name: "Mei" } }));
  assert.match(both, /<span>Language<\/span><strong>Cantonese, Mandarin<\/strong>/);
  const zh = progressScreen(
    baseState({
      screen: "progress",
      lang: "zh-Hans",
      savedCase: v2Case({ stage: "received", answers: { language: "mandarin", language_also: ["other"], language_also_other: "Vietnamese", tp_first_name: "Mei" } }),
    }),
  );
  assert.match(zh, /<strong>普通话、Vietnamese<\/strong>/);
});

// Part 4c (Task 4): the card is exported for Add a case. Without `office` it is
// 4b2's markup byte for byte; with it, the marks and notes speak to the office.
test("docCard without office is unchanged; with office it speaks to the office", () => {
  const cards = cardsFor(makeSampleAnswers(), []);
  const w2 = cards.find((card) => card.slotId === "w2.household");
  assert.equal(
    docCard(w2, { links: false }),
    `<article class="doc-card" id="doc-w2-household" data-slot="w2.household" tabindex="-1"><h3>W-2 from each job</h3><p class="doc-owner">For you</p><p class="doc-why">You said you had wages from a job</p><p class="doc-hint">You said 1 job. Upload 1 W-2.</p><div class="doc-upload"><button type="button" class="btn secondary" disabled aria-describedby="doc-w2-household-note">${icon("camera")} Take a photo</button><button type="button" class="btn secondary" disabled aria-describedby="doc-w2-household-note">${icon("upload")} Choose a file</button></div><p class="doc-note" id="doc-w2-household-note">Uploading arrives soon. For now, bring it or mark it below.</p><div class="doc-marks"><button type="button" class="btn secondary" data-action="mark-card" data-slot="w2.household" data-status="later">I will send it later</button><button type="button" class="btn secondary" data-action="mark-card" data-slot="w2.household" data-status="none">I don&#39;t have this</button></div><p class="doc-status is-not_done" id="doc-w2-household-status" tabindex="-1">${icon("upload")}<span class="sr-only">Status: </span>Not done</p></article>`,
  );
  assert.match(docCard(w2), /<p class="doc-why"><button type="button" class="inline" data-action="go-substep" data-substep="income\.wages">You said you had wages from a job<\/button><\/p>/);

  const office = docCard({ ...w2, status: "later" }, { links: false, off: " disabled", office: true });
  assert.match(office, /data-status="later" disabled>Later<\/button>/);
  assert.match(office, /data-status="none" disabled>Don&#39;t have<\/button>/);
  assert.match(office, /data-status="not_done" disabled>Mark as not done<\/button>/);
  assert.match(office, new RegExp(`<p class="doc-why">Asked by: ${escText(wording(findQuestion(2, "inc_wages"), { variant: "general", lang: "en" }))}</p>`));
  // The reason line never quotes the client ("You said…", "You wrote…").
  assert.doesNotMatch(office, /<p class="doc-why">[^<]*You (said|wrote)/);
  assert.doesNotMatch(office, /I will send|I don&#39;t have/);
  assert.match(office, /<p class="doc-note" id="doc-w2-household-note">Uploads come later\. Mark what the client will send later or doesn&#39;t have\.<\/p>/);
  // A card with no asking question has no reason line on the office's side.
  const photo = cards.find((card) => card.slotId === "photo_id.tp");
  assert.equal(photo.ask ?? null, null);
  assert.doesNotMatch(docCard(photo, { links: false, office: true }), /doc-why/);
});

// Section 1, decision 3 of the wording review (#48): on Add a case, a hint or
// owner line with an office version shows that one; the client's card keeps
// its own words.
test("on Add a case, hints and owner lines speak to the office", () => {
  const cards = cardsFor(
    { marital_status: "married", inc_wages: "yes", inc_wages_job_count: "2", refund_method: "direct_deposit" },
    [],
  );
  const card = (slot) => cards.find((c) => c.slotId === slot);
  const office = (slot) => docCard(card(slot), { links: false, office: true });
  const client = (slot) => docCard(card(slot), { links: false });
  assert.match(office("w2.household"), /<p class="doc-owner">Client and spouse<\/p>/);
  assert.match(office("w2.household"), /<p class="doc-hint">Client said 2 jobs\. Expect 2 W-2s\.<\/p>/);
  assert.match(office("photo_id.sp"), /<p class="doc-owner">Spouse<\/p>/);
  assert.match(office("photo_id.sp"), /<p class="doc-hint">Needed if filing jointly<\/p>/);
  assert.match(office("bank.household"), /<p class="doc-owner">Household<\/p>/);
  assert.match(office("bank.household"), /<p class="doc-hint">The account must be in the client&#39;s or spouse&#39;s name\.<\/p>/);
  assert.match(client("w2.household"), /<p class="doc-owner">For you and your spouse<\/p>/);
  assert.match(client("w2.household"), /<p class="doc-hint">You said 2 jobs\. Upload 2 W-2s\.<\/p>/);
  assert.match(client("bank.household"), /<p class="doc-hint">The account must be in your name \(or your spouse&#39;s\)\.<\/p>/);
  // A person card's hint has its office version too.
  const visa = cardsFor({ on_visa: ["me"] }, []).find((c) => c.slotId === "visa.tp");
  assert.match(docCard(visa, { links: false, office: true }), /<p class="doc-hint">Helps check residency status\.<\/p>/);
});

// Part 4d Task 6: the progress page's cards and request in the client's language.
test("docCard speaks the client's language; the office's card stays English whatever lang says", () => {
  const cards = cardsFor(makeSampleAnswers(), []);
  const w2 = cards.find((card) => card.slotId === "w2.household");
  const zh = docCard({ ...w2, status: "later" }, { links: false, lang: "zh-Hans" });
  assert.match(zh, /<h3>每份工作的 W-2<\/h3>/);
  assert.match(zh, /<p class="doc-owner">本人<\/p>/);
  assert.match(zh, /<p class="doc-hint">您说有 1 份工作，请上传 1 张 W-2。<\/p>/);
  assert.match(zh, /data-status="later">我稍后再提供<\/button>/);
  assert.match(zh, /data-status="not_done">标记为未完成<\/button>/);
  assert.match(zh, /<span class="sr-only">状态：<\/span>稍后提供<\/p>/);
  assert.equal(docCard(w2, { links: false, lang: "en" }), docCard(w2, { links: false }));
  assert.equal(docCard(w2, { links: false, office: true, lang: "zh-Hans" }), docCard(w2, { links: false, office: true }));
});

test("a document request labels the office's words in Chinese and shows them as typed", () => {
  const state = (lang) =>
    baseState({
      screen: "progress",
      lang,
      savedCase: caseRecord({
        stage: "preparing",
        requests: [{ id: "req-1", title: "Mileage record", message: "Please send it.", status: "open" }],
        history: [{ id: "e1", message: "A volunteer requested a document: Mileage record", createdAt: "2026-01-02T15:04:05Z" }],
      }),
    });
  const zh = progressScreen(state("zh-Hans"));
  assert.match(zh, /<span class="request-label">需要的文件<\/span><h2>Mileage record<\/h2><span class="request-label">办公室留言<\/span><p>Please send it\.<\/p>/);
  assert.match(zh, /<p>志愿者请求了一份文件：Mileage record<\/p>/);
  const en = progressScreen(state("en"));
  assert.doesNotMatch(en, /request-label/);
  assert.match(en, /<h2>Mileage record<\/h2><p>Please send it\.<\/p>/);
  assert.match(en, /<p>A volunteer requested a document: Mileage record<\/p>/);
});

test("the office's document card asks the question the client saw", () => {
  const answers = { ...makeSampleAnswers(), on_visa: ["me"] };
  const visa = cardsFor(answers, []).find((card) => card.slotId === "visa.tp");
  assert.match(docCard(visa, { links: false, office: true, answers }), /Asked by: Were you in the U\.S\. on a visa in 2025\?/);
  const married = { ...makeSampleAnswers({ married: true }), on_visa: ["me"] };
  const theirs = cardsFor(married, []).find((card) => card.slotId === "visa.tp");
  assert.match(docCard(theirs, { links: false, office: true, answers: married }), /Asked by: Who was in the U\.S\. on a visa in 2025\?/);
});

test("the 14446 gate locks the rail and Continue until the client consents (add-form-14446-consent)", () => {
  const { vc_agree: _a, ...unticked } = makeSampleAnswers();
  const locked = intakeScreen(v2State({ formSubstep: "before.virtual", draftAnswers: unticked }));
  assert.match(locked, /<h1>Virtual VITA consent \(Form 14446\)<\/h1>/);
  assert.match(locked, /We need this consent to prepare your return\. If you&#39;d rather not give it, please call PCDC at 215-922-6156\./);
  assert.match(locked, /<button type="submit" class="btn primary" aria-describedby="consent-blocked" disabled>/);
  assert.doesNotMatch(locked, /data-action="go-substep" data-substep="about\./);
  assert.match(locked, /data-step-id="about"[^>]*>[\s\S]*?aria-disabled="true"/);
  // Locked spans keep data-substep: the app compares them with the visible sub-steps.
  assert.match(locked, /<span class="rail-sublink is-locked" data-substep="about\.you" aria-disabled="true">/);
  const atAddress = intakeScreen(v2State({ formSubstep: "about.address", draftAnswers: unticked }));
  assert.match(atAddress, /<h1>Virtual VITA consent \(Form 14446\)<\/h1>/);
  const fromSummary = intakeScreen(v2State({ formSubstep: "before.virtual", returnToSummary: true, draftAnswers: unticked }));
  assert.match(fromSummary, /id="consent-blocked"/);
  assert.match(fromSummary, /<button type="submit" class="btn primary" aria-describedby="consent-blocked" disabled>/);
  assert.doesNotMatch(fromSummary, /data-action="back-to-summary"/);
  const open = intakeScreen(v2State({ formSubstep: "before.virtual" }));
  assert.doesNotMatch(open, /consent-blocked/);
  assert.match(open, /data-action="go-substep" data-substep="about\.you"/);
});

test("1.5 shows the details Form 14446 will print, the spouse's under J (add-form-14446-consent)", () => {
  const single = intakeScreen(v2State({ formSubstep: "about.sign" }));
  assert.match(single, /<h1>Sign Form 14446<\/h1>/);
  assert.match(single, /class="sign-details"/);
  const sample = makeSampleAnswers();
  assert.match(single, new RegExp(`${sample.tp_first_name} ${sample.tp_last_name}`));
  assert.doesNotMatch(single, /data-q="vc_sp_signature"/);
  assert.doesNotMatch(single, /your spouse signs too/);
  const married = intakeScreen(v2State({ formSubstep: "about.sign", draftAnswers: makeSampleAnswers({ married: true }) }));
  assert.match(married, /If you file a joint return, your spouse signs too\./);
  assert.match(married, /data-q="vc_sp_signature"/);
  assert.match(married, /data-q="vc_sp_email"/);
});

test("1.5's details name a late spouse, and print the dates and phones as the summary does (add-form-14446-consent)", () => {
  const answers = { ...makeSampleAnswers({ married: true }), marital_status: "widowed", spouse_death_year: "2025", tp_phone: "2155550101" };
  const html = intakeScreen(v2State({ formSubstep: "about.sign", draftAnswers: answers }));
  assert.match(html, /<h2 class="q-heading">Your late spouse<\/h2>/);
  assert.doesNotMatch(html, /<h2 class="q-heading">Your spouse<\/h2>/);
  const phone = formatAnswer(findQuestion(2, "tp_phone"), "2155550101", { lang: "en" });
  assert.match(html, new RegExp(`<dt>Telephone number</dt><dd>${reEsc(phone)}</dd>`));
  const dob = formatAnswer(findQuestion(2, "tp_dob"), answers.tp_dob, { lang: "en" });
  assert.match(html, new RegExp(`<dt>Date of birth</dt><dd>${reEsc(dob)}</dd>`));
});

test("1.5 shows only the details the draft prints: a late spouse has no phone or email (add-form-14446-consent)", () => {
  const spouseBlock = (html) => /<h2 class="q-heading">Your (?:late )?spouse<\/h2>[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "";
  const stale = { sp_phone: "2155550150", vc_sp_email: "wei@example.com" };
  const widowed = { ...makeSampleAnswers({ married: true }), marital_status: "widowed", spouse_death_year: "2025", ...stale };
  const late = spouseBlock(intakeScreen(v2State({ formSubstep: "about.sign", draftAnswers: widowed })));
  assert.match(late, /Your late spouse/);
  assert.match(late, new RegExp(`${reEsc(widowed.sp_first_name)} ${reEsc(widowed.sp_last_name)}`));
  const dob = formatAnswer(findQuestion(2, "sp_dob"), widowed.sp_dob, { lang: "en" });
  assert.match(late, new RegExp(`<dt>Date of birth</dt><dd>${reEsc(dob)}</dd>`));
  assert.doesNotMatch(late, /Telephone number/);
  assert.doesNotMatch(late, /Email address/);
  assert.doesNotMatch(late, /2155550150|\(215\) 555-0150|wei@example\.com/);
  const marriedAnswers = { ...makeSampleAnswers({ married: true }), ...stale };
  const married = spouseBlock(intakeScreen(v2State({ formSubstep: "about.sign", draftAnswers: marriedAnswers })));
  assert.match(married, /<dt>Telephone number<\/dt><dd>[^<]*555[^<]*<\/dd>/);
  assert.match(married, /<dt>Email address<\/dt><dd>wei@example\.com<\/dd>/);
});

test("1.5's spouse-signature tip follows the marital status (add-form-14446-consent)", () => {
  const sign = (answers) => intakeScreen(v2State({ formSubstep: "about.sign", draftAnswers: answers }));
  const marriedTip = escText("Leave this empty if you won't file a joint return.");
  const lateTip = escText("Type your late spouse's full name. You sign for them because a joint return is possible for 2025.");
  const married = sign(makeSampleAnswers({ married: true }));
  assert.ok(married.includes(marriedTip), "married: the leave-empty tip");
  assert.ok(!married.includes(lateTip));
  const widowed = sign({ ...makeSampleAnswers({ married: true }), marital_status: "widowed", spouse_death_year: "2025" });
  assert.ok(widowed.includes(lateTip), "widowed 2025: the late-spouse tip");
  assert.ok(!widowed.includes(marriedTip));
  const single = sign(makeSampleAnswers());
  assert.ok(!single.includes(marriedTip) && !single.includes(lateTip), "never married: neither tip");
});

test("the draft banner's sentences speak the screen's language", () => {
  assert.equal(sentence("The draft could not be made. Try again.", "zh-Hans"), "无法生成草稿。请再试一次。");
  assert.equal(sentence("The draft font could not be checked. Try again later.", "zh-Hans"), "无法核对草稿所用的字体。请稍后再试。");
});

test("the client's applications while they load, and when they couldn't", () => {
  const loading = applicationsScreen(baseState({ cases: [], lists: { cases: "loading", assistance: "ready" } }));
  assert.match(loading, /Loading your applications…/);
  assert.doesNotMatch(loading, /No applications yet/);
  const failed = applicationsScreen(baseState({ cases: [], lists: { cases: "failed", assistance: "ready" }, lang: "zh-Hans" }));
  assert.match(failed, /无法载入您的申请。/);
  assert.match(applicationsScreen(baseState({ cases: [] })), /No applications yet/, "no lists means loaded");
});

test("the status panel shows the variant", () => {
  const record = caseRecord({ stage: "review_approved", revision: 8, intakeVerified: true, signingPlan: "portal", signingAppointmentAt: null });
  const html = progressScreen(baseState({ screen: "progress", savedCase: record }));
  const message = describeStage("review_approved", "en", record).clientMessage;
  assert.ok(message.includes("TaxSlayer Customer Portal"));
  // shown in the status panel and in the review panel
  assert.equal(html.split(escHtml(message)).length - 1, 2);
  const legacy = progressScreen(baseState({ screen: "progress", savedCase: { ...record, signingPlan: null } }));
  assert.ok(!legacy.includes("Customer Portal"));
});
