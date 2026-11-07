import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import {
  createBrowserFixture,
  loginTestUser,
  loginTestUserById,
  requestCode,
  submitVerificationCode,
} from "./support/browser-fixture.mjs";
import { applyArgs } from "./support/database-fixture.mjs";
import { openDatabase } from "../tools/admin/database.mjs";
import { SEED_SCENARIOS, resolveSeedTargets, seedCases } from "../tools/admin/seed-cases.mjs";
import {
  ARRIVAL_MS,
  CLICK_MS,
  DESKTOP,
  MOBILE_WIDTH,
  OFFICE_BOARD_HEADING,
  REFUSAL_LINES,
  REFUSAL_NOTICE,
  RENDER_MS,
  HAS_BADGE,
  HAS_DETAIL,
  HAS_TEXT,
  WORK_BOARD_HEADING,
  alertText,
  assertConsoleQuiet,
  capture,
  caseActionCount,
  chooseAnswer,
  clearToast,
  clickAction,
  clickCaseActionUntil,
  continueToSubmit,
  fieldByLabel,
  findOnBoard,
  guardToast,
  measureOverflow,
  openBoard,
  openCaseByReference,
  openCaseTab,
  pageText,
  pressToastDismiss,
  pressUntil,
  pressUntilEffect,
  railJump,
  railSub,
  readAlerts,
  readBoardTotals,
  readClientPlace,
  readSignedInAs,
  readWindowState,
  rebuiltBy,
  redactAddresses,
  revealCaseControl,
  screenshotDir,
  showBoardTab,
  submitCaseFormUntil,
  tickBox,
  waitFor,
  waitForBadge,
  waitForCaseWorkspace,
  waitForDetail,
  waitForIntakeV2,
  waitForQuiet,
  waitForSubstep,
  waitForText,
  waitForTextGone,
  watchAlerts,
} from "./support/story-pages.mjs";
import { REFERENCE_PATTERN, SQLSTATE_ERROR_CODES } from "../src/contracts.mjs";
import { SAMPLE_DOCUMENT_FILENAME, screeningCheckKeys } from "../src/case-actions.mjs";
import { DRAFT_FONT_FIXTURES } from "../src/draft-pdf.mjs";
import { cardsFor } from "../src/document-cards.mjs";
import { CONTACT_NOT_SHOWN } from "../src/staff-views.mjs";
import { todayIso } from "../src/questionnaires.mjs";
import { findSubstep } from "../src/intake-catalogue.mjs";
import { t as say, sentence } from "../src/client-text.mjs";
import { describeStage } from "../src/domain.mjs";
import HANT from "../src/zh-hant.mjs";

// Task 10A: the demonstration story (spec §9) driven through two real engines,
// twice with the roles swapped, against the isolated local stack — plus the
// regression list, the window-isolation checks and repeatable evidence.
//
// What is real here and what is not:
//
//   * **Real:** every click, every form, every workflow action, the database
//     that answers them, the Realtime notifications that carry them to the
//     other window, and the one-time-code *verification* each sign-in performs.
//   * **Simulated:** the code *send* only (`/auth/v1/otp` is intercepted by the
//     Task 5A fixture so automation never asks a mail server for anything), and
//     the demo's own simulated document upload and time jumps,
//     which the application labels as simulated on screen.
//
// Two denials cannot be expressed by any screen — an applicant sending a staff
// `personId`, and an applicant asking for another applicant's case by id or
// reference. Those are exercised from this process with the applicant's own
// authenticated client and asserted as FORBIDDEN/NOT_FOUND (Ruling R62).
// Everything else runs through the pages.
//
// Nothing here logs an address, a code or a token, and no screenshot is taken
// of a screen that carries one.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = screenshotDir(ROOT);

// Enough for a database fixture, two engines, every window and tab the story
// opens and the whole story with its regressions, on a slower machine too
// (a clean order took about 12–15 minutes in November 2026, with the slower
// one close to the old 15-minute limit; see #126). A run that reaches this
// has stopped, not slowed.
const PERMUTATION_TIMEOUT_MS = 1_200_000;

// The fictional text this story types. Every sentence is invented, names a
// fictional person or a simulated step, and carries no address or contact
// detail of any kind.
const REQUEST_TITLE = "Mileage record";
const REQUEST_MESSAGE = "Please add the fictional sample mileage record.";
const ESCALATION_REASON =
  "The fictional client has not sent the sample yet; the office can ask about it.";
const CONTACT_NOTE = "Simulated call: the fictional client will send the sample.";
// The contact log phase (OpenSpec change add-contact-log). No note is a part
// of another, so a line is found by its note alone.
const HALF_CONTACT_NOTE = "Half a fictional note";
const SAM_CONTACT_NOTE = "Simulated call: the fictional client asked about the sample.";
const ALEX_TEXT_NOTE = "Simulated text: asked for the fictional mileage record.";
const SAM_CORRECTION_NOTE = "Simulated text: asked for the fictional mileage log by Friday.";
const INCOMING_NOTE = "Simulated call: the fictional client phoned to book a time.";
// Every contact line starts with its New York time and an em dash.
const CONTACT_LINE = /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} (AM|PM) — /;
const HELP_NOTE = "Simulated help: walked the fictional client through the intake forms.";
const RESOLUTION_NOTE = "Simulated call ended; the office task is done.";
// Internal staff text. It must never appear in a client window.
const FINDINGS = "Internal only: recheck the simulated mileage total before approval.";
const CORRECTION_NOTE = "Recorded the corrected simulated total in TaxSlayer.";
const EDITED_BEST_TIME_NOTE = "Text first; a fictional call after 6 pm is fine.";
const OFFLINE_CITY = "Riverbend";
const MINE_CITY = "Keepmine City";
const OTHER_CITY = "Otherwindow City";

// Words a client screen must never carry: this demo records a workflow and
// shows no amounts. A version-2 client does choose a refund method (and a
// direct-deposit document card), so the check leaves out the client's own
// `.open-documents` card list, which names the papers to bring; every other
// part of the screen must stay free of them.
const MONEY_WORDS = Object.freeze(["$", "refund", "routing", "deposit", "direct debit"]);

// What counts as the keyboard being somewhere a person can use it.
const CONTROLS = Object.freeze(["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"]);

// The city a draft is saved with before Save & exit, to see it come back.
const RETURN_CITY = "Comebackton";

// The names the database fixture gives its role-named staff accounts (#132),
// as their pages say "Signed in as". Fictional people only.
const ROLE_NAMES = Object.freeze({
  siteCoordinator: "Avery Lin",
  preparer: "Taylor Brooks",
  reviewer: "Jamie Ellis",
});
// How a contact line names the Preparer (staffShortName in src/contact-log.mjs).
const PREPARER_SHORT_NAME = "Taylor B.";

// Notes what a page writes to the clipboard, once the real write resolved:
// Playwright's Firefox has no clipboard permission to grant, so the contact
// log phase reads this back in both engines (and the real clipboard too in
// Chrome). Installed on the Site Coordinator's window before it loads.
const NOTE_COPIES = () => {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return;
  const write = clipboard.writeText.bind(clipboard);
  clipboard.writeText = async (text) => {
    await write(text);
    (window.__copied ??= []).push(String(text));
  };
};

// ---------------------------------------------------------------------------
// Server-side reads — the receipts and rows a screen cannot show
// ---------------------------------------------------------------------------

const one = async (fixture, text, values) =>
  (await fixture.database.sql(text, values)).rows[0] ?? null;

const caseById = (fixture, id) =>
  one(
    fixture,
    "select id,reference,stage,revision,preparer_id,reviewer_id,owner_user_id,answers,intake_verified from public.cases where id=$1",
    [id],
  );

const caseByReference = (fixture, reference) =>
  one(
    fixture,
    "select id,reference,stage,revision,preparer_id,reviewer_id,owner_user_id,answers from public.cases where workspace_id=$1 and reference=$2",
    [fixture.database.workspaceId, reference],
  );

const workspaceCaseCount = async (fixture) =>
  Number(
    (
      await one(
        fixture,
        "select count(*)::int as count from public.cases where workspace_id=$1",
        [fixture.database.workspaceId],
      )
    ).count,
  );

// Receipts are the server's own record that an action landed exactly once.
const receiptCount = async (fixture, caseId, operation) =>
  Number(
    (
      await one(
        fixture,
        "select count(*)::int as count from public.action_receipts where target_id=$1 and operation=$2",
        [caseId, operation],
      )
    ).count,
  );

const eventCount = async (fixture, caseId, action) =>
  Number(
    (
      await one(
        fixture,
        "select count(*)::int as count from public.case_events where case_id=$1 and action=$2",
        [caseId, action],
      )
    ).count,
  );

const participantCount = async (fixture, caseId) =>
  Number(
    (
      await one(
        fixture,
        "select count(*)::int as count from public.preparation_participants where case_id=$1",
        [caseId],
      )
    ).count,
  );

const receiptsForActionId = async (fixture, actionId) =>
  Number(
    (
      await one(
        fixture,
        "select count(*)::int as count from public.action_receipts where action_id=$1",
        [actionId],
      )
    ).count,
  );

/** The domain code one raised SQLSTATE means to the application. */
const domainCode = (error) =>
  SQLSTATE_ERROR_CODES[error?.code] ?? error?.code ?? "none";

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * A page in its own context, with its own console and page-error record. A
 * visible toast never blocks one of its actions (`guardToast`).
 */
async function openWindow(engine, { viewport = DESKTOP, ...options } = {}) {
  const win = await engine.newPage({ viewport, ...options });
  await guardToast(win.page);
  return win;
}

/** A second page inside an existing context: the same storage, another window. */
async function openTab(context, appOrigin) {
  const page = await context.newPage();
  await guardToast(page);
  const errors = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(appOrigin);
  return { page, errors, pageErrors };
}

// What a presenter account gets once it has signed in (#134): one plain
// English screen with Sign out, and nothing of a staff window.
const PRESENTER_HEADING = "This account is no longer used";
const PRESENTER_TEXT = "Presenter mode has been removed. Ask your site coordinator for a staff account.";

/**
 * The presenter signs in through the real form with `loginTestUser`: the same
 * intercepted send, the same real verification, the same 30-second wait and
 * the same proof of the SDK's session. Only the window state differs: the
 * controller loads nothing for a presenter, so the window stores nothing
 * either, and that is asserted.
 */
async function signInPresenter({ page, actor, fixture }) {
  await loginTestUser({ page, actor, fixture, heading: PRESENTER_HEADING, windowState: false });
}

/** The presenter's plain screen is on show, with no board, picker, reset, checkpoint or indicator. */
async function assertPresenterScreen(page) {
  await waitForText(page, PRESENTER_HEADING, RENDER_MS);
  const screen = await page.evaluate(() => ({
    heading: document.querySelector("#main h1")?.textContent.trim() ?? null,
    text: document.querySelector("#main .page-intro p")?.textContent.trim() ?? null,
    actions: [...document.querySelectorAll("#app [data-action]")].map((node) => node.dataset.action),
    board: document.querySelectorAll(".staff-board, .board-row, #office-queue-title, #case-title").length,
    sidebar: document.querySelectorAll(".sidebar-account").length,
    personas: document.querySelectorAll('[data-action="select-person"], #persona-title').length,
    reset: document.querySelectorAll('[data-action="open-reset-fixtures"]').length,
    checkpoint: document.querySelectorAll('[data-action="open-checkpoint"]').length,
    indicator: document.querySelectorAll('[data-role="fixture-indicator"]').length,
  }));
  assert.deepEqual(
    screen,
    {
      heading: PRESENTER_HEADING,
      text: PRESENTER_TEXT,
      actions: ["sign-out"],
      board: 0,
      sidebar: 0,
      personas: 0,
      reset: 0,
      checkpoint: 0,
      indicator: 0,
    },
    "the presenter window shows more than the plain screen",
  );
}

/**
 * Choose one button of a Log contact form's group (direction, method,
 * purpose, outcomeVoice, outcomeWritten, withWhom) by pressing its label, as
 * a person does: the radio itself is drawn as the label's segment.
 */
async function chooseSeg(root, scope, name, key) {
  await root.locator(`label[for="field-${scope}-${name}-${key}"]`).click({ timeout: CLICK_MS });
}

// The questionnaires' inline forms in "Your next step" (design D7). Each field
// is found by the id the page gives it, and every fill is safe to repeat: a
// press that has to be repeated fills the same answers again.
const radioId = (scope, name, value) => `[id="field-${scope}-${name}-${value}"]`;
const fieldIdOf = (scope, name) => `[id="field-${scope}-${name}"]`;

/** Answer the preparer questionnaire. Leave a key out to leave the field as the page shows it. */
async function fillPreparer(page, answers) {
  await waitForQuiet(page);
  const { confirmedBy, confirmedByName, confirmedMethod, shaded, state, readyForReviewOn } = answers;
  if (confirmedBy) await page.locator(radioId("prep", "confirmedBy", confirmedBy)).check({ timeout: CLICK_MS });
  if (confirmedByName !== undefined)
    await page.locator(fieldIdOf("prep", "confirmedByName")).fill(confirmedByName, { timeout: CLICK_MS });
  if (confirmedMethod)
    await page.locator(radioId("prep", "confirmedMethod", confirmedMethod)).check({ timeout: CLICK_MS });
  if (shaded) await page.locator(fieldIdOf("prep", "shadedPartsCompleted")).check({ timeout: CLICK_MS });
  if (state) await page.locator(fieldIdOf("prep", "stateForgivenessSet")).check({ timeout: CLICK_MS });
  if (readyForReviewOn)
    await page.locator(fieldIdOf("prep", "readyForReviewOn")).fill(readyForReviewOn, { timeout: CLICK_MS });
}

/**
 * Answer the reviewer questionnaire. `exit` maps a group ("federal", "state",
 * "local.SIT", ...) to its answers; a group is opened to be typed in, as a
 * person does, and its method/result/refundBy/oweBy are radios.
 */
async function fillReviewer(page, answers) {
  await waitForQuiet(page);
  const { completedOn, paForgiveness, wentOver, wentOverOn, wentOverHow, signMethod, signAppointmentAt, exit, remarks } = answers;
  if (completedOn) await page.locator(fieldIdOf("rev", "completedOn")).fill(completedOn, { timeout: CLICK_MS });
  if (paForgiveness) await page.locator(radioId("rev", "paForgiveness", paForgiveness)).check({ timeout: CLICK_MS });
  if (wentOver) await page.locator(radioId("rev", "wentOver", wentOver)).check({ timeout: CLICK_MS });
  if (wentOverOn) await page.locator(fieldIdOf("rev", "wentOverOn")).fill(wentOverOn, { timeout: CLICK_MS });
  if (wentOverHow) await page.locator(radioId("rev", "wentOverHow", wentOverHow)).check({ timeout: CLICK_MS });
  if (signMethod) await page.locator(radioId("rev", "signMethod", signMethod)).check({ timeout: CLICK_MS });
  if (signAppointmentAt)
    await page.locator(fieldIdOf("rev", "signAppointmentAt")).fill(signAppointmentAt, { timeout: CLICK_MS });
  for (const [prefix, group] of Object.entries(exit ?? {})) {
    const details = page.locator("details.q-exit-group").filter({ has: page.locator(fieldIdOf("rev", `${prefix}.amount`)) });
    if (!(await details.evaluate((element) => element.open)))
      await details.locator("summary").click({ timeout: CLICK_MS });
    for (const [key, value] of Object.entries(group)) {
      if (["amount", "debitOn"].includes(key))
        await page.locator(fieldIdOf("rev", `${prefix}.${key}`)).fill(value, { timeout: CLICK_MS });
      else await page.locator(radioId("rev", `${prefix}.${key}`, value)).check({ timeout: CLICK_MS });
    }
  }
  if (remarks !== undefined) await page.locator(fieldIdOf("rev", "remarks")).fill(remarks, { timeout: CLICK_MS });
}

/** A `datetime-local` value ("YYYY-MM-DDTHH:MM") moved back by whole hours. */
function hoursBefore(value, hours) {
  const moment = new Date(`${value}:00Z`);
  moment.setUTCHours(moment.getUTCHours() - hours);
  return moment.toISOString().slice(0, 16);
}

/** The intake form's own submit: save what is dirty and move a step on. */
async function clickContinue(page) {
  await waitForQuiet(page);
  await page
    .getByRole("button", { name: "Continue", exact: true })
    .first()
    .click({ timeout: CLICK_MS });
}

/** Wait until a client's history shows this exact line. */
const waitForHistoryLine = (page, line) =>
  waitFor(
    page,
    `the history line ${JSON.stringify(line)}`,
    (wanted) =>
      [...document.querySelectorAll(".timeline-item p")].some((entry) => entry.textContent.trim() === wanted),
    line,
    ARRIVAL_MS,
  );

/** Start one fictional application and read back the generated reference. */
async function startApplication(page) {
  await clickAction(page, "start-application");
  const card = page.locator(".reference-card strong");
  await card.waitFor({ state: "visible", timeout: ARRIVAL_MS });
  return (await card.innerText()).trim();
}

/**
 * The office's "Screening checks" panel on an open case: asserts its title, its
 * button and, while a box is unticked, its disabled button and hint; then ticks
 * the checks the case's own service asks for. The service is read from the
 * panel (data-service on the button), so the story never hard-codes it. No
 * story case is an online one, so identity here is covered by the unit and
 * database tests, not the browser story.
 */
async function tickScreeningChecks(page) {
  const button = page.locator('[data-case-action="VERIFY_INTAKE"]');
  await button.waitFor({ state: "visible", timeout: RENDER_MS });
  assert.equal((await page.locator("#checks-title").innerText()).trim(), "Screening checks");
  assert.equal((await button.innerText()).trim(), "Record the screening checks");
  assert.equal(await button.isDisabled(), true, "the screening checks could be recorded before any box was ticked");
  const panel = page.locator("section.panel", { has: page.locator("#checks-title") });
  assert.equal(
    (await panel.locator(".field-note").first().innerText()).trim(),
    "Tick every check before recording them.",
  );
  const service = (await button.getAttribute("data-service")) || undefined;
  for (const check of screeningCheckKeys(service)) await tickBox(page, `field-intake-${check}`);
  assert.equal(await panel.locator(".field-note").count(), 0, "the hint stayed after every check was ticked");
}

/**
 * The Form 14446 consent at 0.4 (openspec change add-form-14446-consent):
 * until it is ticked, every place after "Before you start" is locked. Jump to
 * 0.4, tick the box, and wait until About you is a link on the rail again.
 * Found by ids and data attributes only, so it works in every language.
 */
async function consent14446(page) {
  await railJump(page, "before.virtual");
  await tickBox(page, "field-client-vc_agree-yes");
  await waitFor(
    page,
    "the rail to unlock About you",
    () =>
      Boolean(document.querySelector('.rail-step[data-step-id="about"] .rail-link[data-action="go-substep"]')) &&
      !document.querySelector(".rail-tree .is-locked"),
    undefined,
    RENDER_MS,
  );
}

/**
 * Sign Form 14446 at 1.5: "I consent" to the IRS review, the client's typed
 * name as the signature, then Tab. The date fills itself with today (in the
 * browser's own calendar) on the first keystroke, so once the signature is
 * left its box appears already filled. `name` defaults to the name the page
 * shows it will print. Jumps there by the rail unless the form is already
 * on 1.5. Returns the signature typed.
 */
async function sign14446(page, name) {
  const here = await page.evaluate(() => document.querySelector("#intake-v2-form")?.dataset.substep ?? null);
  if (here !== "about.sign") await railJump(page, "about.sign");
  await chooseAnswer(page, "vc_review", "yes");
  const signature =
    name ?? (await page.evaluate(() => document.querySelector(".sign-details dd")?.textContent.trim() ?? ""));
  assert.ok(signature, "no name to sign Form 14446 with");
  await waitForQuiet(page);
  await page.locator("#field-client-vc_tp_signature").fill(signature);
  await page.keyboard.press("Tab");
  await waitFor(
    page,
    "the Form 14446 date to fill itself with today",
    () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const part = (which) => document.querySelector(`#field-client-vc_tp_date-${which}`)?.value ?? null;
      return (
        part("year") === String(now.getFullYear()) &&
        part("month") === pad(now.getMonth() + 1) &&
        part("day") === pad(now.getDate())
      );
    },
    undefined,
    RENDER_MS,
  );
  return signature;
}

/** A draft PDF's bytes, read in its own tab once it has loaded there. */
async function draftBytes(popup) {
  await popup.waitForURL(/^blob:/, { timeout: ARRIVAL_MS });
  const base64 = await popup.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch(location.href)).arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/**
 * The page count of a flattened draft PDF, and the Latin text one page draws:
 * every `<hex> Tj` string in its content and in the flattened field
 * appearances it holds. A box filled in Helvetica is drawn that way; text in
 * a downloaded font (Chinese) is drawn as glyph ids and is not readable here.
 */
async function draftPageText(bytes, index) {
  const doc = await PDFDocument.load(bytes);
  const seen = new Set();
  const streams = [];
  const walk = (value) => {
    if (value instanceof PDFRef) {
      if (seen.has(value.toString())) return;
      seen.add(value.toString());
      walk(doc.context.lookup(value));
    } else if (value instanceof PDFRawStream) {
      try {
        streams.push(Buffer.from(decodePDFRawStream(value).decode()).toString("latin1"));
      } catch {
        // An image or a font file: no text to read.
      }
      walk(value.dict);
    } else if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) walk(entry);
    } else if (value instanceof PDFArray) {
      for (const entry of value.asArray()) walk(entry);
    }
  };
  const page = doc.getPage(index).node;
  walk(page.get(PDFName.of("Contents")));
  walk(page.get(PDFName.of("Resources")));
  return {
    pages: doc.getPageCount(),
    strings: streams.flatMap((text) =>
      [...text.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")),
    ),
  };
}

/**
 * The version-2 walk the story's own application takes: Fill fictional
 * details, the Form 14446 consent and signature, then the rail. On the way it
 * becomes married (a show-if: the
 * spouse's part joins the rail, and a second Fill answers it) and the wording
 * flips to Senior and back. It reaches review.submit by Continue on 9.1 and
 * 9.2 (the gate), with the box ticked; the Submit is the caller's, and
 * `atCheck` runs on an empty review.check. The fill never consents or signs,
 * so 0.4 and 1.5 are done by hand, right after it.
 */
async function fillIntakeV2ToSubmit(page, { atCheck } = {}) {
  await clickAction(page, "continue-intake");
  await waitForSubstep(page, "before.ready");
  await clickAction(page, "fill-fictional");
  await waitFor(
    page,
    "the fill to be announced",
    () => document.querySelector("#toast")?.textContent.includes("Fictional details filled in"),
    undefined,
    RENDER_MS,
  );
  // The toast's Dismiss: an icon with a name and no words, 44 px square, and
  // a press hides the toast and leaves no focus inside it.
  assert.deepEqual(
    await page.evaluate(() => {
      const dismiss = document.querySelector("#toast.visible .toast-dismiss");
      const box = dismiss?.getBoundingClientRect();
      return dismiss
        ? {
            named: Boolean(dismiss.getAttribute("aria-label")?.trim()),
            words: dismiss.textContent.trim(),
            size: [Math.round(box.width), Math.round(box.height)],
          }
        : null;
    }),
    { named: true, words: "", size: [44, 44] },
    "the toast's Dismiss is not a named 44 px icon button",
  );
  await pressToastDismiss(page);
  await waitFor(page, "Dismiss to hide the toast", () => !document.querySelector("#toast.visible"), undefined, RENDER_MS);
  assert.equal(
    await page.evaluate(() => Boolean(document.querySelector("#toast")?.contains(document.activeElement))),
    false,
    "the focus stayed inside the hidden toast",
  );
  await consent14446(page);
  await sign14446(page);
  await railJump(page, "about.marital");
  assert.equal(
    await page.locator('.rail-sublink[data-substep="about.spouse"]').count(),
    0,
    "a never-married client's rail lists the spouse",
  );
  await chooseAnswer(page, "marital_status", "married");
  await waitFor(
    page,
    "the rail to list Your spouse",
    () =>
      document
        .querySelector('.rail-sublink[data-substep="about.spouse"] .rail-subtitle')
        ?.textContent.trim() === "Your spouse",
    undefined,
    RENDER_MS,
  );
  await clickAction(page, "fill-fictional");
  await waitFor(
    page,
    "the married questions to be filled",
    () => document.querySelector("#field-client-married_last_day-yes")?.checked === true,
    undefined,
    RENDER_MS,
  );
  // A wording change, there and back: the answers stay as they are.
  for (const pressed of ["true", "false"]) {
    await clickAction(page, "toggle-senior");
    await waitFor(
      page,
      `the senior switch to read ${pressed}`,
      (wanted) =>
        document.querySelector('[data-action="toggle-senior"]')?.getAttribute("aria-pressed") ===
        wanted,
      pressed,
      RENDER_MS,
    );
  }
  await railJump(page, "review.check");
  await waitForQuiet(page);
  assert.equal(
    await page.locator(".alerts-block .alert-item").count(),
    0,
    `the filled example still has alerts: ${await page.locator(".alerts-block").innerText().catch(() => "")}`,
  );
  if (atCheck) await atCheck();
  await continueToSubmit(page);
  await tickBox(page, "field-confirmed");
}

// The sample phones (`samplePhone` in src/sample-data.mjs), as a staff page
// prints them. D5 keeps them off every page of a volunteer who has not
// claimed the case.
const SAMPLE_PHONE = /\(215\) 555-01\d\d/;

// ---------------------------------------------------------------------------
// The version-2 form (PR 4b2): the story's workspace is on version 2, so
// every client form here is version 2 except in the one phase that sets the
// workspace back to 1 for its length
// ---------------------------------------------------------------------------

// 4,600 characters of fictional text: 400 short of the long-answer limit, so
// its count is showing.
const LONG_NOTE = "A fictional note for the volunteer. ".repeat(128).slice(0, 4600);

/** One answer as the server holds it, as text. */
const caseAnswer = async (fixture, caseId, key) =>
  (
    await one(fixture, "select answers->>($2::text) as value from public.cases where id=$1", [
      caseId,
      key,
    ])
  )?.value ?? null;

/** One document card's stored row, or null while nobody has marked it. */
const cardRow = (fixture, caseId, slotId) =>
  one(
    fixture,
    "select slot_id, status, group_override from public.case_document_cards where case_id=$1 and slot_id=$2",
    [caseId, slotId],
  );

// Every sub-step the fictional example shows, in order: drop-off, never
// married, one child, wages and a direct deposit, with Form 14446's consent
// (0.4) and signature (1.5). The walk presses Continue once on each up to
// review.check and must arrive at the next (the gate holds the last two until
// the walk's gap is fixed); this is also the rail's list.
const V2_WALK = Object.freeze([
  "before.ready",
  "before.service",
  "before.language",
  "before.virtual",
  "about.you",
  "about.address",
  "about.marital",
  "about.sign",
  "about.situation",
  "about.irs",
  "household.members",
  "income.wages",
  "income.retirement",
  "income.investments",
  "income.rental",
  "income.business",
  "income.other",
  "expenses.deductible",
  "expenses.other",
  "expenses.events",
  "refund.payment",
  "refund.consent",
  "optional.questions",
  "documents.identity",
  "documents.income",
  "documents.events",
  "documents.other",
  "notes.anything",
  "review.check",
  "review.summary",
  "review.submit",
]);

// The Needed cards of the married example that are still open when it is
// submitted, in the order the progress page lists them.
const OPEN_DOCUMENTS = Object.freeze([
  "photo_id.tp",
  "photo_id.sp",
  "ssn.tp",
  "ssn.sp",
  "w2.household",
  "bank.household",
]);

const DRAFT_FAILED = "The draft could not be made. Close this tab and try again.";
const DRAFT_FONT_UNCHECKED = "The draft font could not be checked. Try again later.";
// The problem banner's words for a draft that could not be built.
const DRAFT_NOT_MADE = "The draft could not be made. Try again.";

// ---------------------------------------------------------------------------
// One permutation: client in one engine, staff in the other
// ---------------------------------------------------------------------------

async function runPermutation(t, roles) {
  // The story's workspace is version 2, the column default: its seeded cases,
  // its client forms and Add a case all follow.
  const fixture = await createBrowserFixture();
  const evidence = {
    roles,
    timings: {},
    story: {},
    regressions: {},
    windowIsolation: {},
    retries: [],
    screenshots: [],
    overflow: {},
    consoleErrors: {},
  };
  const timed = async (name, body) => {
    const started = Date.now();
    try {
      return await body();
    } finally {
      evidence.timings[name] = Date.now() - started;
    }
  };
  const phase = async (name, body) => {
    let failure = null;
    await t.test(name, async () => {
      try {
        await timed(name, body);
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    // A linear story must stop where it broke: the steps after a failure would
    // report the wreckage rather than the defect.
    if (failure) throw failure;
  };
  // Hoisted so the evidence can still be gathered from them when a phase throws.
  let client = null;
  let staff = null;
  let roleWins = null;
  let classCase = null;
  // The seed's run directory: both seed runs share it, so the second one
  // replaces exactly the set the first one recorded.
  let seedRunDir = null;
  // What a workflow interaction is waited for, as one of three rendered facts.
  const expectation = (expect) =>
    expect.badge
      ? { ready: HAS_BADGE, arg: expect.badge, what: `a badge reading ${JSON.stringify(expect.badge)}` }
      : expect.detail
        ? {
            ready: HAS_DETAIL,
            arg: expect.detail,
            what: `${expect.detail.label} reading ${JSON.stringify(expect.detail.value)}`,
          }
        : { ready: HAS_TEXT, arg: expect.text, what: `the text ${JSON.stringify(expect.text)}` };

  // The revision of the case an interaction acts on, read before it is sent:
  // if it has not moved, nothing was applied and a repeat cannot duplicate
  // anything. This is the only thing that ever authorises a second press.
  const unmovedSince = async (caseId) => {
    const id = caseId ?? classCase.id;
    const revision = async () => Number((await caseById(fixture, id)).revision);
    const before = await revision();
    return async () => (await revision()) === before;
  };
  // The contact log is not a case action: logging and editing leave the
  // case's revision alone, so whether a press reached the server is read from
  // the log itself — no new entry and no new version means nothing landed.
  const contactLogUnmoved = async (caseId) => {
    const count = async () =>
      (
        await one(
          fixture,
          "select (select count(*) from public.contact_log where case_id=$1)::int as entries, (select count(*) from public.contact_log_versions where case_id=$1)::int as versions",
          [caseId],
        )
      ) ?? null;
    const before = JSON.stringify(await count());
    return async () => JSON.stringify(await count()) === before;
  };
  const record = (type, outcome) => {
    if (outcome.attempts > 1 || outcome.conflicts || outcome.lost)
      evidence.retries.push({ type, ...outcome });
    return outcome;
  };
  const act = async (page, type, expect, { caseId, attributes = "" } = {}) =>
    record(
      type,
      await clickCaseActionUntil(page, type, {
        ...expectation(expect),
        attributes,
        safeToRepeat: await unmovedSince(caseId),
      }),
    );
  const actForm = async (page, type, fields, expect, { caseId, attributes = "" } = {}) =>
    record(
      type,
      await submitCaseFormUntil(page, type, fields, {
        ...expectation(expect),
        attributes,
        safeToRepeat: await unmovedSince(caseId),
      }),
    );

  // A press that first fills an inline questionnaire form (the fill is done
  // again on a repeat) and then presses the form's own submit button.
  const actQuestionnaire = async (page, type, fill, expect, { caseId } = {}) =>
    record(
      type,
      await pressUntilEffect(page, {
        press: async () => {
          await waitForQuiet(page);
          await revealCaseControl(page, `button[type="submit"][data-case-action="${type}"]`);
          await fill();
          await waitForQuiet(page);
          await page.locator(`button[type="submit"][data-case-action="${type}"]`).first().click({ timeout: CLICK_MS });
        },
        ...expectation(expect),
        safeToRepeat: await unmovedSince(caseId),
      }),
    );
  // What the page told the person since `before` notices were recorded.
  const noticeSaid = (page, text, before = 0) =>
    waitFor(
      page,
      `a notice saying ${JSON.stringify(text)}`,
      ([wanted, from]) => (window.__vitallyAlerts ?? []).slice(from).some((line) => line.includes(wanted)),
      [text, before],
      ARRIVAL_MS,
    );

  const tag = `${roles.client}-client-${roles.staff}-staff`;
  const shoot = async (page, name) => {
    const shot = await capture(page, SHOTS, `${tag}--${name}`);
    evidence.screenshots.push(...shot.files);
    evidence.overflow[name] = shot.overflow;
    assert.equal(
      shot.overflow.scrollWidth,
      shot.overflow.clientWidth,
      `${name}: the page scrolls sideways at ${MOBILE_WIDTH}px`,
    );
  };

  // A staff page for the design docs: at the narrow widths the sidebar is an
  // overlay that covers the page, so it is closed by its own toggle for the
  // shot (the page redraws, nothing else moves) and opened again after.
  const shootWithoutSidebar = async (page, name) => {
    const setSidebar = async (open) => {
      await waitForQuiet(page);
      await page.locator('[data-action="toggle-sidebar"]').click({ timeout: CLICK_MS });
      await waitFor(
        page,
        `the sidebar to be ${open ? "open" : "closed"}`,
        (wanted) =>
          document.querySelector('[data-action="toggle-sidebar"]')?.getAttribute("aria-expanded") === wanted,
        String(open),
        RENDER_MS,
      );
    };
    await setSidebar(false);
    await waitForQuiet(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shoot(page, name);
    await setSidebar(true);
  };

  try {
    const clientEngine = await fixture.launch(roles.client);
    const staffEngine = await fixture.launch(roles.staff);
    evidence.engines = {
      client: `${roles.client} ${clientEngine.version}${clientEngine.revision ? ` (playwright build ${clientEngine.revision})` : ""}`,
      staff: `${roles.staff} ${staffEngine.version}${staffEngine.revision ? ` (playwright build ${staffEngine.revision})` : ""}`,
    };
    evidence.simulated =
      "the code send only; every verification and every workflow action is real";

    const applicantA = fixture.actor("applicantA");
    const applicantB = fixture.actor("applicantB");
    const presenter = fixture.actor("presenter");
    // A demonstration persona's person, for the leftover-persona check: a
    // stored persona is ignored by every account (#134).
    const { sam } = fixture.database;
    // The role-named staff accounts the main story signs in as (#132): the
    // Preparer takes Alex's steps, the Reviewer Morgan's, and the Site
    // Coordinator Sam's office work and follow-ups.
    const { siteCoordinatorId, preparerId, reviewerId } = fixture.database;
    const ROLES = Object.freeze(["siteCoordinator", "preparer", "reviewer"]);
    const roleHeading = Object.freeze({
      siteCoordinator: OFFICE_BOARD_HEADING,
      preparer: WORK_BOARD_HEADING,
      reviewer: WORK_BOARD_HEADING,
    });

    const clientWin = await openWindow(clientEngine);
    // The presenter's window: it shows the plain screen, and nothing else (#134).
    const staffWin = await openWindow(staffEngine);
    // One window per role account, each in its own context, signed in once.
    roleWins = {
      siteCoordinator: await openWindow(staffEngine, {
        permissions: roles.staff === "chrome" ? ["clipboard-read", "clipboard-write"] : [],
        initScript: NOTE_COPIES,
      }),
      preparer: await openWindow(staffEngine),
      reviewer: await openWindow(staffEngine),
    };
    client = clientWin.page;
    const presenterPage = staffWin.page;
    staff = roleWins.preparer.page;

    // Which window the story drives now. A window just chosen may be on
    // another screen, so a case is reached the way a person would: back to
    // that window's own board, then the case's link.
    const onCase = async (page, role, reference) => {
      const title = await page.evaluate(() => document.querySelector("#case-title")?.textContent.trim() ?? null);
      if (title === reference) return;
      await openBoard(page, roleHeading[role]);
      await openCaseByReference(page, reference);
    };
    const use = async (role, reference = null) => {
      staff = roleWins[role].page;
      if (reference) await onCase(staff, role, reference);
      return staff;
    };

    // One run of the seed on the story's own workspace and run directory,
    // as the accounts the story's windows are signed in as.
    const runSeed = async () => {
      const db = await openDatabase();
      try {
        const targets = await resolveSeedTargets(db, {
          workspaceId: fixture.database.workspaceId,
          clientAEmail: applicantA.email,
        });
        assert.deepEqual(
          [targets.siteCoordinator.personId, targets.preparer.personId, targets.reviewer.personId, targets.clientA.userId],
          [siteCoordinatorId, preparerId, reviewerId, applicantA.userId],
          "the seed acts as other accounts than the story signs in as",
        );
        return await seedCases(db, targets, { runDir: seedRunDir });
      } finally {
        await db.end();
      }
    };
    // A seed run's cases, by scenario, as { id, reference, stage }: every
    // scenario, all in the story's workspace, and
    // the ones later phases start from at the stage they are named for.
    const seededCases = async (result) => {
      assert.deepEqual(Object.keys(result.caseIdsByScenario).sort(), [...SEED_SCENARIOS].sort());
      const rows = (
        await fixture.database.sql(
          "select id,reference,stage from public.cases where workspace_id=$1 and id = any($2::uuid[])",
          [fixture.database.workspaceId, Object.values(result.caseIdsByScenario)],
        )
      ).rows;
      assert.equal(rows.length, 11, "a seeded case is not in the story's workspace");
      const cases = Object.fromEntries(
        Object.entries(result.caseIdsByScenario).map(([scenario, id]) => {
          const { reference, stage } = rows.find((row) => row.id === id);
          return [scenario, { id, reference, stage }];
        }),
      );
      for (const scenario of ["preparation_ready", "review_ready", "review_approved", "rejected", "on_hold"])
        assert.equal(cases[scenario].stage, scenario, `the seeded ${scenario} case is at ${cases[scenario].stage}`);
      return cases;
    };

    // Named here so later phases can read what the story produced.
    let classReference = null;
    // The seeded case of each scenario, as { id, reference, stage }: the
    // first seed run's, and from the second run on, that run's.
    let seeded = null;
    // The help request the first seed run made, the only one on the queue.
    let seededHelpId = null;
    // How many cases a staff board counts once the seed has run.
    let boardTotal = null;

    await phase("both windows sign in with a generated code and real verification", async () => {
      await loginTestUser({ page: client, actor: applicantA, fixture });
      // The presenter signs in through the same real form and gets the plain
      // screen: no board, no picker, no reset, no checkpoint and no
      // indicator (#134).
      await signInPresenter({ page: presenterPage, actor: presenter, fixture });
      await assertPresenterScreen(presenterPage);
      // Its Sign out works. The account signs in again in a fresh document (the
      // auth module's resend cooldown lives in the one it signed out of), to
      // the same plain screen, which the last staff phase reads once more.
      await clickAction(presenterPage, "sign-out");
      await waitForText(presenterPage, "Sign in with your email", RENDER_MS);
      await presenterPage.goto(fixture.appOrigin);
      await signInPresenter({ page: presenterPage, actor: presenter, fixture });
      await assertPresenterScreen(presenterPage);
      for (const role of ROLES) {
        const page = roleWins[role].page;
        await loginTestUser({ page, actor: fixture.actor(role), fixture, heading: roleHeading[role] });
        assert.equal(await readSignedInAs(page), ROLE_NAMES[role], `the ${role} window is signed in as someone else`);
      }
      // From here on, every notice either window shows is recorded — including
      // the ones the next re-read erases before anybody could read them.
      await watchAlerts(client);
      await watchAlerts(presenterPage);
      for (const role of ROLES) await watchAlerts(roleWins[role].page);
      evidence.story.signIn =
        "applicant A in the client window, the Site Coordinator, Preparer and Reviewer each in a staff window of their own, and the presenter on the plain screen, signed out and in again";
    });

    // The story's workspace starts with no cases: nothing in the app makes
    // sample cases any more (#134, #135).
    await phase("the board starts with no cases", async () => {
      const page = await use("preparer");
      await waitFor(
        page,
        "the Preparer's board to count no cases",
        () => /Showing 0 of 0 cases/.test(document.querySelector(".staff-board .section-head")?.textContent ?? ""),
        undefined,
        ARRIVAL_MS,
      );
      const totals = await readBoardTotals(page);
      assert.deepEqual(totals, { shown: 0, total: 0 }, "the Preparer's board starts with cases on it");
      assert.equal(await page.locator(".board-row").count(), totals.shown);
      assert.equal(
        Number(
          (await one(fixture, "select count(*)::int as count from public.cases where workspace_id=$1", [
            fixture.database.workspaceId,
          ])).count,
        ),
        0,
        "the story's workspace starts with cases in it",
      );
      evidence.story.startingBoard = totals;
    });

    // The main story's cases come from the seed (#132), run on the story's own
    // workspace with a run file of its own: the accounts it acts as are the
    // ones the story's windows are signed in as.
    await phase("the seed builds its eleven cases in the story's workspace", async () => {
      const page = await use("preparer");
      const boardCounts = (total) =>
        waitFor(
          page,
          `the Preparer's board to count ${total} cases`,
          (wanted) =>
            new RegExp(`of ${wanted} cases`).test(document.querySelector(".staff-board .section-head")?.textContent ?? ""),
          total,
          ARRIVAL_MS,
        );
      await boardCounts(0);
      const before = (await readBoardTotals(page)).total;
      assert.equal(before, 0, "the Preparer's board counts cases before the seed");
      seedRunDir = await mkdtemp(path.join(os.tmpdir(), "vitally-story-seed-"));
      const result = await runSeed();
      assert.equal(result.casesCreated, 11);
      assert.equal(result.casesRemoved, 0);
      seeded = await seededCases(result);
      seededHelpId = result.assistanceId;
      // The seeded cases follow the workspace's version (migration 019).
      assert.equal(
        Number(
          (
            await one(fixture, "select intake_version from public.cases where id=$1", [
              seeded.preparation_ready.id,
            ])
          ).intake_version,
        ),
        2,
        "a version-2 workspace's seeded case is not on version 2",
      );
      // The board shows them with no reload: the Preparer's window counts
      // every seeded case and finds one by its Application ID.
      boardTotal = before + result.casesCreated;
      await boardCounts(boardTotal);
      await shoot(page, "staff-board-eight-cases");
      await findOnBoard(page, seeded.preparation_ready.reference);
      evidence.story.seed = {
        casesCreated: result.casesCreated,
        boardTotal,
        stages: Object.fromEntries(Object.entries(seeded).map(([scenario, row]) => [scenario, row.stage])),
      };
    });

    await phase("a new application is submitted and reaches the staff board", async () => {
      // The Preparer's work board is the staff board here.
      await use("preparer");
      classReference = await startApplication(client);
      assert.match(classReference, REFERENCE_PATTERN);
      classCase = await caseByReference(fixture, classReference);
      assert.ok(classCase, "the generated reference names no case");
      assert.equal(classCase.owner_user_id, applicantA.userId);
      // A client's own draft is theirs alone: the staff board cannot see it yet.
      assert.equal((await readBoardTotals(staff)).total, boardTotal);
      assert.equal(
        Number(
          (await one(fixture, "select intake_version from public.cases where id=$1", [classCase.id]))
            .intake_version,
        ),
        2,
      );
      await fillIntakeV2ToSubmit(client, {
        atCheck: () => shoot(client, "intake-v2-review-check"),
      });
      await act(client, "SUBMIT", { badge: "Sent to PCDC" });
      // The same reference, on the other engine, with nothing copied by hand.
      await waitFor(
        staff,
        "the board to count the new application",
        (wanted) =>
          new RegExp(`of ${wanted} cases`).test(document.querySelector(".staff-board .section-head")?.textContent ?? ""),
        boardTotal + 1,
        ARRIVAL_MS,
      );
      await findOnBoard(staff, classReference);
      // Submitting numbered the case: the client sees the number on their
      // progress page, the staff row carries the same one, and the board finds
      // the case by that number typed without its "#".
      await waitFor(
        client,
        "the client number on the progress page",
        () =>
          [...document.querySelectorAll(".id-pill > div")].some(
            (part) =>
              part.querySelector("small")?.textContent.trim() === "CLIENT NUMBER" &&
              part.querySelector("strong")?.textContent.trim(),
          ),
        undefined,
        ARRIVAL_MS,
      );
      const clientNumber = (
        await client
          .locator(".id-pill > div")
          .filter({ has: client.locator("small", { hasText: "CLIENT NUMBER" }) })
          .locator("strong")
          .innerText()
      ).trim();
      assert.match(clientNumber, /^#\d{3,}$/);
      const classRow = staff
        .locator(".board-row")
        .filter({ has: staff.locator("button.board-reference", { hasText: classReference }) });
      assert.equal((await classRow.locator(".client-number").innerText()).trim(), clientNumber);
      // The Fill names English (preferred) and Mandarin (allow-multiple-service-languages):
      // the cell shows letters, with the full names on hover and for screen readers.
      const languages = classRow.locator(".language-letters");
      assert.deepEqual(
        {
          letters: (await languages.locator('[aria-hidden="true"]').innerText()).trim(),
          title: await languages.getAttribute("title"),
          labels: await languages.getAttribute("data-languages"),
        },
        { letters: "E, M", title: "English (preferred), Mandarin", labels: "English|Mandarin" },
      );
      // Clear the reference search first: it already shows exactly this one
      // row, so a number search that did nothing would otherwise pass.
      await clickAction(staff, "set-board-filter", { attributes: '[data-filter="search"]' });
      await waitFor(
        staff,
        "the board to leave its search results",
        () => document.querySelector("h2#board-title")?.textContent.trim() === "Work board",
        undefined,
        ARRIVAL_MS,
      );
      const digits = clientNumber.slice(1);
      await waitForQuiet(staff);
      await staff.locator("#field-board-search").fill(digits, { timeout: CLICK_MS });
      await staff.locator('#board-search-form button[type="submit"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        `only ${classReference} to be found by ${digits}`,
        ([wanted, typed]) => {
          const found = [...document.querySelectorAll("button.board-reference")];
          return (
            document.querySelector("#board-title")?.textContent.trim() === "Search results" &&
            document.querySelector("#field-board-search")?.value === typed &&
            found.length === 1 &&
            found[0].textContent.trim() === wanted
          );
        },
        [classReference, digits],
        ARRIVAL_MS,
      );
      // Back to the Application ID search the rest of the phase expects.
      await findOnBoard(staff, classReference);
      await waitFor(
        staff,
        `the board search to hold ${classReference} again`,
        (wanted) => document.querySelector("#field-board-search")?.value === wanted,
        classReference,
        ARRIVAL_MS,
      );
      evidence.story.clientNumber = clientNumber;
      assert.equal((await readBoardTotals(staff)).total, boardTotal + 1);
      evidence.story.reference = "matched REFERENCE_PATTERN and arrived on the board";
    });

    await phase(
      "a staff reload leaves the client window where it was",
      async () => {
        const before = await readClientPlace(client, applicantA.userId);
        assert.equal(before.stored.screen, "progress");
        assert.equal(before.stored.selectedCaseId, classCase.id);
        // The window remembers the sub-step the Submit was pressed on.
        assert.equal(before.stored.formSubstep, "review.submit");
        assert.ok(
          before.stored.openPanels.includes("confirmed"),
          `the ticked confirmation was not remembered: ${JSON.stringify(before.stored.openPanels)}`,
        );
        evidence.windowIsolation.clientBefore = before.stored;

        // The Preparer's window goes to the new case's History tab and
        // reloads: it comes back to the same case and tab, and the client
        // window does not move.
        await use("preparer", classReference);
        await waitForCaseWorkspace(staff, classReference);
        await openCaseTab(staff, "history");
        await staff.reload();
        await waitForCaseWorkspace(staff, classReference, ARRIVAL_MS);
        await watchAlerts(staff);
        const kept = await staff.evaluate(() => ({
          title: document.querySelector("#case-title")?.textContent.trim() ?? null,
          historyShown: document.getElementById("case-panel-history")?.hidden === false,
        }));
        const keptState = await readWindowState(staff, fixture.actor("preparer").userId);
        assert.deepEqual(
          { ...kept, selectedCaseId: keptState?.selectedCaseId, caseTab: keptState?.caseTab },
          { title: classReference, historyShown: true, selectedCaseId: classCase.id, caseTab: "history" },
          "the staff window did not keep its own case and tab",
        );
        evidence.windowIsolation.staffReload = "the Preparer's window kept its own case and tab";
        // Back to Overview and the board, as the next phases expect it.
        await openCaseTab(staff, "overview");
        await openBoard(staff, WORK_BOARD_HEADING);

        const after = await readClientPlace(client, applicantA.userId);
        assert.deepEqual(after, before, "the staff window moved the client window");

        // …and the client window is not frozen: the next office step arrives.
        // The office opens it from its own queue — an intake row, and a case
        // at `received` is claimable by nobody, so this row's way in is the
        // only control on any office screen that reaches it. Opening its page
        // as an admin is what starts screening: the Site Coordinator's window.
        await use("siteCoordinator");
        await waitForText(staff, OFFICE_BOARD_HEADING, RENDER_MS);
        const arrived = staff
          .locator('tr.queue-row[data-kind="intake"]')
          .filter({ hasText: classReference })
          .first();
        await arrived.waitFor({ state: "visible", timeout: RENDER_MS });
        assert.equal(
          await arrived.locator("[data-case-action]").count(),
          0,
          "the way in to a new application offers a workflow action of its own",
        );
        assert.equal(
          (await arrived.locator(".queue-needed").innerText()).trim(),
          "New application: open it to start screening.",
        );
        // The queue lists it; listing it opens nothing.
        assert.equal(
          (await caseById(fixture, classCase.id)).stage,
          "received",
          "the Follow-ups queue started screening before anyone opened the case",
        );
        await openCaseByReference(staff, classReference);
        // The Site Coordinator's open starts screening, quietly: the badge moves in this window
        // and the client's, and the client's history says what happened.
        await waitForBadge(staff, "Screening in progress");
        await waitForBadge(client, "Being reviewed");
        const screening = await caseById(fixture, classCase.id);
        assert.equal(screening.stage, "screening");
        assert.equal(await eventCount(fixture, classCase.id, "START_SCREENING"), 1);
        await waitForHistoryLine(client, "PCDC started reviewing your application. We may call you.");

        // The same case in a second admin window: it is already at screening,
        // so this open sends nothing, and nothing in it reports a problem.
        const adminContext = await staffEngine.browser.newContext({ viewport: DESKTOP, locale: "en-US" });
        try {
          const second = await openTab(adminContext, fixture.appOrigin);
          await loginTestUser({
            page: second.page,
            actor: fixture.actor("siteCoordinator"),
            fixture,
            heading: OFFICE_BOARD_HEADING,
          });
          await watchAlerts(second.page);
          await waitForText(second.page, OFFICE_BOARD_HEADING, RENDER_MS);
          await openCaseByReference(second.page, classReference);
          await waitForBadge(second.page, "Screening in progress");
          await second.page
            .locator("#field-intake-phone")
            .waitFor({ state: "visible", timeout: RENDER_MS });
          await waitForQuiet(second.page);
          assert.equal(
            await second.page.locator(".problem-banner").count(),
            0,
            "the second admin window shows a problem banner",
          );
          assert.equal(
            await second.page.locator("#dialog-error").count(),
            0,
            "the second admin window shows a dialog error",
          );
          const secondSaid = (await readAlerts(second.page)) ?? [];
          assert.deepEqual(
            secondSaid.filter((line) => REFUSAL_NOTICE.test(line)),
            [],
            `the second admin window was refused: ${JSON.stringify(secondSaid)}`,
          );
          assert.equal(
            await eventCount(fixture, classCase.id, "START_SCREENING"),
            1,
            "the second admin window started screening again",
          );
          assert.equal((await caseById(fixture, classCase.id)).revision, screening.revision);
          assertConsoleQuiet(second, { name: "second admin window" });
          evidence.windowIsolation.secondAdminWindow =
            "opened the case at screening with no banner, no dialog error and no second start";
        } finally {
          await adminContext.close();
        }

        await waitForQuiet(staff);
        await tickScreeningChecks(staff);
        await actForm(staff, "VERIFY_INTAKE", {}, {
          detail: { label: "Intake checks", value: "Recorded" },
        });
        await waitForBadge(client, "Waiting for a volunteer");
        const settled = await readClientPlace(client, applicantA.userId);
        assert.deepEqual(
          settled.stored,
          before.stored,
          "a shared update moved the client window",
        );
        evidence.windowIsolation.sharedUpdate =
          "the intake stage arrived in the client window with its navigation untouched";
      },
    );

    await phase("the Preparer claims preparation and requests the sample mileage record", async () => {
      await use("preparer", classReference);
      await waitForText(staff, "Preparation milestones", RENDER_MS);

      // ---- The version-2 answers, before the claim (D5) ----------------
      // Every tab is in the page and the others are hidden, so the phone
      // check reads the whole of #app, hidden tabs included.
      const appText = () => staff.evaluate(() => document.querySelector("#app")?.textContent ?? "");
      await openCaseTab(staff, "intake");
      const answersRead = await staff.evaluate(() => {
        const panel = document.querySelector("#case-panel-intake .answers-v2");
        return {
          title: panel?.querySelector("#answers-title")?.textContent.trim() ?? null,
          steps: [...(panel?.querySelectorAll(".answers-step > h3") ?? [])].map((h) => h.textContent.trim()),
          parts: [...(panel?.querySelectorAll(".answers-sub > h4") ?? [])].map((h) => h.textContent.trim()),
          wording: panel?.querySelector(".wording-used")?.textContent.trim() ?? null,
          contact: document.querySelector("#case-panel-intake .contact-card")?.textContent ?? "",
        };
      });
      assert.equal(answersRead.title, "What the client told us");
      assert.ok(answersRead.steps.includes("About you"), `no step heading: ${JSON.stringify(answersRead.steps)}`);
      assert.ok(
        answersRead.parts.includes("Mailing address"),
        `no sub-step heading: ${JSON.stringify(answersRead.parts)}`,
      );
      assert.equal(answersRead.wording, "Wording used: Standard");
      assert.ok(answersRead.contact.includes(CONTACT_NOT_SHOWN), "the D5 sentence is missing");
      assert.doesNotMatch(await appText(), SAMPLE_PHONE, "a phone reached a volunteer who has not claimed the case");
      const locked = await staff.evaluate(() =>
        [...document.querySelectorAll("#case-panel-intake .phone-mask")].map((mask) => ({
          locked: mask.classList.contains("is-locked"),
          title: mask.getAttribute("title"),
          focusable: mask.hasAttribute("tabindex"),
          where: mask.closest(".contact-card") ? "card" : mask.closest(".answers-v2") ? "answers" : "other",
        })),
      );
      assert.ok(locked.some((mask) => mask.where === "card"), "no masked phone in the contact card");
      assert.ok(locked.some((mask) => mask.where === "answers"), "no masked phone in the answers");
      for (const mask of locked) {
        assert.ok(mask.locked, "an unlocked mask before the claim");
        assert.equal(mask.title, "Claim this case to see the full number");
        assert.equal(mask.focusable, false);
      }
      const markup = await staff.evaluate(() => document.querySelector("#app")?.innerHTML ?? "");
      assert.doesNotMatch(markup, SAMPLE_PHONE, "a phone reached the markup of a volunteer who has not claimed the case");
      assert.doesNotMatch(markup, /2155550\d\d\d/, "a stored phone reached the markup");
      assert.equal(
        await staff.locator('[data-action="view-draft"]').count(),
        0,
        "the draft 13614-C, which prints the phones, was offered before the claim",
      );
      await shootWithoutSidebar(staff, "staff-contact-hidden");

      await act(staff, "CLAIM_PREPARATION", {
        detail: { label: "Preparer", value: ROLE_NAMES.preparer },
      });
      await waitForBadge(client, "Being prepared");

      // ---- After the claim: the phone, the best time, the draft --------
      await openCaseTab(staff, "intake");
      const contactRow = (label) =>
        staff.evaluate(
          (wanted) =>
            [...document.querySelectorAll("#case-panel-intake .contact-card .detail-row")]
              .find((row) => row.querySelector("span")?.textContent.trim() === wanted)
              ?.querySelector("strong")
              ?.textContent.trim() ?? null,
          label,
        );
      await waitFor(
        staff,
        "the phone in the contact card",
        (pattern) => new RegExp(pattern).test(document.querySelector("#case-panel-intake .contact-card")?.textContent ?? ""),
        SAMPLE_PHONE.source,
        ARRIVAL_MS,
      );
      assert.match(await contactRow("Phone"), SAMPLE_PHONE);
      assert.equal(await contactRow("Best time to reach"), "Weekday evenings");
      // The masked phone (D5, DESIGN.md §8): hidden until hover or focus, kept
      // while focused after a click, hidden again when focus leaves.
      const mask = staff.locator("#contact-phone");
      const fullShown = () =>
        staff.evaluate(() => {
          const full = document.querySelector("#contact-phone .phone-full");
          const dots = document.querySelector("#contact-phone .phone-dots");
          return { full: (full?.getBoundingClientRect().width ?? 0) > 4, dots: (dots?.getBoundingClientRect().width ?? 0) > 4 };
        });
      const pointerAway = () => staff.mouse.move(1, 1);
      await pointerAway();
      assert.deepEqual(await fullShown(), { full: false, dots: true }, "the number shows before anyone asks");
      await mask.hover({ timeout: CLICK_MS });
      assert.deepEqual(await fullShown(), { full: true, dots: false }, "hover did not reveal the number");
      await pointerAway();
      assert.deepEqual(await fullShown(), { full: false, dots: true }, "the number stayed after the pointer left");
      await mask.focus();
      assert.deepEqual(await fullShown(), { full: true, dots: false }, "keyboard focus did not reveal the number");
      await staff.keyboard.press("Tab");
      assert.deepEqual(await fullShown(), { full: false, dots: true }, "the number stayed after focus left");
      await mask.click({ timeout: CLICK_MS });
      await pointerAway();
      assert.deepEqual(await fullShown(), { full: true, dots: false }, "a click did not keep the number shown");
      assert.notEqual(
        await staff.evaluate(() => getComputedStyle(document.querySelector("#contact-phone")).outlineStyle),
        "none",
        "a number held open by a click shows no focus outline",
      );
      await staff.keyboard.press("Tab");
      await pointerAway();
      assert.deepEqual(await fullShown(), { full: false, dots: true }, "the number stayed after the click's focus left");
      assert.deepEqual(
        await staff.evaluate(() =>
          [...document.querySelectorAll('#case-panel-intake [data-action="view-draft"]')].map(
            (button) => `${button.dataset.draft ?? "13614-C"} ${button.dataset.form}`,
          ),
        ),
        // The draft 13614-C in three languages, then the draft Form 14446 in
        // PCDC's two (add-form-14446-consent).
        ["13614-C en", "13614-C zh-s", "13614-C zh-t", "14446 en", "14446 zh-t"],
      );
      // The draft opens as a PDF in its own tab. Chrome only, as in the
      // version-2 phase: Firefox may download a blob PDF instead of opening
      // it, which leaves nothing to read. Here the page is the staff window.
      let staffDraft = `not run: the staff engine is ${roles.staff}, which may download the PDF instead of opening it`;
      if (roles.staff === "chrome") {
        const stray = [];
        await staff.route("https://cdn.jsdelivr.net/**", (route) => {
          stray.push(route.request().url());
          return route.abort();
        });
        await waitForQuiet(staff);
        const opened = staff.waitForEvent("popup", { timeout: CLICK_MS });
        await staff
          .locator('#case-panel-intake [data-action="view-draft"]:not([data-draft])[data-form="en"]')
          .click({ timeout: CLICK_MS });
        const popup = await opened;
        await popup.waitForURL(/^blob:/, { timeout: ARRIVAL_MS });
        staffDraft = await popup.evaluate(async () => {
          const bytes = new Uint8Array(await (await fetch(location.href)).arrayBuffer());
          return { head: String.fromCharCode(...bytes.slice(0, 5)), size: bytes.length };
        });
        await popup.close();
        await staff.unrouteAll({ behavior: "wait" });
        assert.equal(staffDraft.head, "%PDF-");
        assert.ok(staffDraft.size > 100 * 1024, `the staff draft is only ${staffDraft.size} bytes`);
        // The sample's names are in Latin letters: no font is fetched.
        assert.deepEqual(stray, [], "the staff draft fetched a font");
      }
      evidence.story.staffDraft = staffDraft;

      // ---- The 13614-C shaded section: download, fill elsewhere, upload --
      // (change add-preparer-13614c-fields, design D8). The copy is filled
      // here with npm pdf-lib, as another PDF program would, and uploaded
      // from a buffer: nothing reaches the server but the values.
      const shadedTools = staff.locator("#case-panel-intake .shaded-panel");
      await waitForQuiet(staff);
      const downloaded = staff.waitForEvent("download", { timeout: ARRIVAL_MS });
      await shadedTools.locator('[data-action="download-shaded-copy"]').click({ timeout: CLICK_MS });
      const download = await downloaded;
      const copy = await PDFDocument.load(await readFile(await download.path()));
      assert.ok(
        String(copy.getKeywords() ?? "").split(/\s+/).includes(`case:${classCase.reference}`),
        "the editing copy does not carry the case's reference",
      );
      const copyForm = copy.getForm();
      assert.equal(copyForm.getFields().length, 106, "the editing copy does not keep exactly the 106 shaded fields");
      copyForm.getCheckBox("form1[0].page2[0].incomeIncluded[0].formW2s[0]").check();
      copyForm.getTextField("form1[0].page2[0].incomeIncluded[0].formW2sNumber[0]").setText("2");
      const filledCopy = Buffer.from(await copy.save());
      // First, a file that is not a PDF: refused in place, nothing saved.
      await waitForQuiet(staff);
      await shadedTools
        .locator('input[type="file"][data-action="upload-shaded-copy"]')
        .setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
      await waitFor(
        staff,
        "the not-a-PDF refusal beside the upload control",
        () =>
          document.querySelector("#case-panel-intake .shaded-panel #shaded-upload-error")?.textContent.includes(
            "This file isn't a PDF the editor can read.",
          ) ?? false,
        undefined,
        ARRIVAL_MS,
      );
      assert.equal(
        await staff.evaluate(
          () =>
            document.querySelectorAll('[role="alert"]').length === 1 &&
            !document.querySelector(".problem-banner") &&
            !(document.querySelector("#toast")?.textContent ?? "").includes("PDF"),
        ),
        true,
        "the upload refusal was said somewhere else too",
      );
      assert.equal(
        (await fixture.database.sql("select 1 from public.preparer_shaded_fields where case_id=$1", [classCase.id])).rows.length,
        0,
        "a refused upload saved something",
      );
      await shadedTools.locator('[data-action="dismiss-error"]').click({ timeout: CLICK_MS });
      await waitForQuiet(staff);
      await shadedTools
        .locator('input[type="file"][data-action="upload-shaded-copy"]')
        .setInputFiles({ name: "13614-C-filled.pdf", mimeType: "application/pdf", buffer: filledCopy });
      await waitFor(
        staff,
        "the review of what was read from the copy",
        () =>
          document.querySelector("#case-panel-intake .shaded-review h3")?.textContent.trim() ===
          "Check what was read from this copy",
        undefined,
        ARRIVAL_MS,
      );
      const reviewText = await staff.evaluate(() => {
        const box = document.querySelector("#case-panel-intake .shaded-review");
        return {
          count: box?.querySelector("p")?.textContent.trim(),
          rows: [...(box?.querySelectorAll("li") ?? [])].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
        };
      });
      assert.equal(reviewText.count, "2 filled fields:", "the review does not count the two filled fields");
      assert.deepEqual(reviewText.rows, ["W-2s: ticked", "W-2s #: 2"], "the review rows do not match what the copy holds");
      assert.equal(
        (await fixture.database.sql("select 1 from public.preparer_shaded_fields where case_id=$1", [classCase.id])).rows.length,
        0,
        "the upload saved before the preparer confirmed",
      );
      assert.ok(
        ((await shadedTools.locator(".shaded-download-note").textContent()) ?? "").includes("not macOS Preview"),
        "the Preview hint is not beside the Download button",
      );
      await staff.locator('#case-panel-intake [data-action="confirm-shaded-review"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "Saved beside the upload control",
        () => document.querySelector("#case-panel-intake #shaded-status")?.textContent.trim() === "Saved",
        undefined,
        ARRIVAL_MS,
      );
      assert.equal(
        await staff.evaluate(() => document.activeElement?.id),
        "shaded-upload",
        "focus did not return to the upload control after Save these values",
      );
      const shadedRow = (
        await fixture.database.sql("select fields,version from public.preparer_shaded_fields where case_id=$1", [classCase.id])
      ).rows;
      assert.deepEqual(
        shadedRow.map((row) => ({ fields: row.fields, version: Number(row.version) })),
        [{ fields: { incomeW2s: true, incomeW2sCount: 2 }, version: 1 }],
      );
      await openCaseTab(staff, "history");
      await waitFor(
        staff,
        "the shaded save in the internal history",
        (wanted) =>
          document.querySelector('#case-panel-history [data-role="internal-history"]')?.textContent.includes(wanted) ??
          false,
        `${ROLE_NAMES.preparer} saved the shaded section · W-2s, W-2s #.`,
        ARRIVAL_MS,
      );
      assert.doesNotMatch(
        (await staff.locator('#case-panel-history [data-role="client-history"]').textContent()) ?? "",
        /shaded/i,
        "the client's history names the shaded section",
      );
      await openCaseTab(staff, "intake");
      // The English draft prints the saved count on page 2 and the new stamp.
      let shadedDraft = `not run: the staff engine is ${roles.staff}, which may download the PDF instead of opening it`;
      // Page 1's "Yes" strings before the editor's save, to count the new one.
      let shadedYesBefore = null;
      if (roles.staff === "chrome") {
        await waitForQuiet(staff);
        const opened = staff.waitForEvent("popup", { timeout: CLICK_MS });
        await staff
          .locator('#case-panel-intake [data-action="view-draft"]:not([data-draft])[data-form="en"]')
          .click({ timeout: CLICK_MS });
        const popup = await opened;
        const bytes = await draftBytes(popup);
        await popup.close();
        const page2 = await draftPageText(bytes, 1);
        const page1 = await draftPageText(bytes, 0);
        assert.ok(page2.strings.includes("2"), `page 2 of the English draft does not print 2: ${JSON.stringify(page2.strings)}`);
        assert.ok(
          page1.strings.some((text) => text.includes("online answers and preparer entries")),
          `the English draft's stamp does not name the preparer entries: ${JSON.stringify(page1.strings)}`,
        );
        shadedDraft = "page 2 prints 2; the stamp names the preparer entries";
        shadedYesBefore = page1.strings.filter((text) => text === "Yes").length;
      }
      evidence.story.shadedSection = { saved: "Saved", draft: shadedDraft };

      // ---- The 13614-C shaded section: the editor (design D7) ----------
      // The same copy in the pdf.js layer beside #app: only the shaded
      // fields are fields, Save keeps it open, and Escape with an unsaved
      // change asks first. Selectors are the spike's (tasks 1.3).
      const ROW1_CHILD = "form1[0].page1[0].namesOf[0].Row1[0].qualifyingChildDependent[0]";
      const W2S = "form1[0].page2[0].incomeIncluded[0].formW2s[0]";
      const W2S_COUNT = "form1[0].page2[0].incomeIncluded[0].formW2sNumber[0]";
      const INCOME_NOTES = "form1[0].page2[0].IncomeIncludedComment[0].IncomeIncludedComments[0]";
      const EDITOR_NOTE = "Fictional note: the second W-2 is from a summer job.";
      const editorField = (name) => staff.locator(`.shaded-editor [name="${name}"]`);
      const editorButton = (which) => staff.locator(`.shaded-editor [data-editor="${which}"]`);
      await waitForQuiet(staff);
      await shadedTools.locator('[data-action="open-shaded-editor"]').click({ timeout: CLICK_MS });
      // The pages are drawn one after another: wait for all of them.
      await staff.locator('.shaded-editor[data-ready="true"]').waitFor({ timeout: ARRIVAL_MS });
      assert.equal(
        await staff.evaluate(
          () =>
            document.querySelector("#app").inert &&
            document.querySelector('body > .shaded-editor[role="dialog"][aria-modal="true"]') !== null,
        ),
        true,
        "the editor is a modal layer beside an inert #app",
      );
      assert.equal(
        await staff.locator(".shaded-editor .annotationLayer :is(input, textarea, select)").count(),
        106,
        "the editor offers other fields than the 106 shaded ones",
      );
      assert.equal(await editorButton("save").isDisabled(), true, "Save is offered before any change");
      // The saved section is what the editor opens on.
      assert.equal(await editorField(W2S).isChecked(), true);
      assert.equal(await editorField(W2S_COUNT).inputValue(), "2");
      await editorField(ROW1_CHILD).fill("Yes");
      await editorField(W2S).check();
      await editorField(W2S_COUNT).fill("2");
      await editorField(INCOME_NOTES).fill(EDITOR_NOTE);
      await editorField(INCOME_NOTES).press("Escape");
      await waitFor(
        staff,
        "the editor asks before Escape discards a change",
        () => document.querySelector(".shaded-editor-confirm:not([hidden])")?.textContent.includes("Discard your changes?") ?? false,
        undefined,
        ARRIVAL_MS,
      );
      await editorButton("keep").click({ timeout: CLICK_MS });
      assert.equal(await editorField(ROW1_CHILD).inputValue(), "Yes", "keeping the edits lost one");
      await editorButton("save").click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "Saved in the editor",
        () => document.querySelector(".shaded-editor #shaded-editor-status")?.textContent.trim() === "Saved",
        undefined,
        ARRIVAL_MS,
      );
      assert.equal(await staff.locator(".shaded-editor").count(), 1, "the editor closed on Save");
      assert.equal(await editorButton("save").isDisabled(), true, "Save is offered again before a new change");
      assert.deepEqual(
        (
          await fixture.database.sql("select fields,version from public.preparer_shaded_fields where case_id=$1", [classCase.id])
        ).rows.map((row) => ({ fields: row.fields, version: Number(row.version) })),
        [
          {
            fields: { household1QualifyingChild: "yes", incomeW2s: true, incomeW2sCount: 2, incomeNotes: EDITOR_NOTE },
            version: 2,
          },
        ],
      );
      // Nothing unsaved: Close closes, and the keyboard is back on the button.
      await editorButton("close").click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the editor closed, with the keyboard on Fill the shaded section",
        () =>
          !document.querySelector(".shaded-editor") &&
          !document.querySelector("#app").inert &&
          document.activeElement?.dataset?.action === "open-shaded-editor",
        undefined,
        ARRIVAL_MS,
      );
      await openCaseTab(staff, "history");
      await waitFor(
        staff,
        "the editor's save in the internal history",
        (wanted) =>
          document.querySelector('#case-panel-history [data-role="internal-history"]')?.textContent.includes(wanted) ??
          false,
        `${ROLE_NAMES.preparer} saved the shaded section · Row 1: Qualifying child or dependent, Income notes.`,
        ARRIVAL_MS,
      );
      await openCaseTab(staff, "intake");
      // The English draft prints the editor's values and the preparer-entries stamp.
      let editorDraft = `not run: the staff engine is ${roles.staff}, which may download the PDF instead of opening it`;
      if (roles.staff === "chrome") {
        await waitForQuiet(staff);
        const opened = staff.waitForEvent("popup", { timeout: CLICK_MS });
        await staff
          .locator('#case-panel-intake [data-action="view-draft"]:not([data-draft])[data-form="en"]')
          .click({ timeout: CLICK_MS });
        const popup = await opened;
        const bytes = await draftBytes(popup);
        await popup.close();
        const page1 = await draftPageText(bytes, 0);
        const page2 = await draftPageText(bytes, 1);
        assert.equal(
          page1.strings.filter((text) => text === "Yes").length,
          shadedYesBefore + 1,
          `page 1 of the English draft does not print row 1's Yes: ${JSON.stringify(page1.strings)}`,
        );
        assert.ok(page2.strings.includes("2"), `page 2 of the English draft does not print 2: ${JSON.stringify(page2.strings)}`);
        assert.ok(
          page2.strings.some((text) => text.includes("Fictional note:")),
          `page 2 of the English draft does not print the note: ${JSON.stringify(page2.strings)}`,
        );
        assert.ok(
          page1.strings.some((text) => text.includes("online answers and preparer entries")),
          `the English draft's stamp does not name the preparer entries: ${JSON.stringify(page1.strings)}`,
        );
        editorDraft = "page 1 prints Yes; page 2 prints 2 and the note; the stamp names the preparer entries";
      }
      evidence.story.shadedEditor = { saved: "Saved", escape: "Discard your changes?", draft: editorDraft };

      // Materials: two boxes, one save.
      const materials = staff.locator("#case-panel-intake #materials-form");
      await waitForQuiet(staff);
      await materials.getByLabel("Photo ID", { exact: true }).check({ timeout: CLICK_MS });
      await materials.getByLabel("W-2", { exact: true }).check({ timeout: CLICK_MS });
      await waitForQuiet(staff);
      await materials.locator('button[data-case-action="RECORD_MATERIALS"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "both materials recorded by the Preparer",
        (name) =>
          [...document.querySelectorAll("#case-panel-intake #materials-form .material-recorded")].filter((note) =>
            note.textContent.includes(`Recorded by ${name}`),
          ).length === 2,
        ROLE_NAMES.preparer,
        ARRIVAL_MS,
      );
      assert.deepEqual(
        (
          await fixture.database.sql(
            "select item from public.case_materials where case_id=$1 order by item",
            [classCase.id],
          )
        ).rows.map((row) => row.item),
        ["photo_id", "w2"],
      );

      // The best time: Weekends added, saved, and shown.
      await clickAction(staff, "toggle-edit-contact");
      await staff.locator("#contact-form").waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForQuiet(staff);
      await staff.locator("#field-contact-weekend").check({ timeout: CLICK_MS });
      // A tick not yet saved survives a redraw from elsewhere (a no-change
      // update on this case), as typed text does.
      await rebuiltBy(
        staff,
        () => fixture.database.sql("update public.cases set revision=revision where id=$1", [classCase.id]),
        "a no-change update on the class case",
      );
      assert.equal(
        await staff.locator("#field-contact-weekend").isChecked(),
        true,
        "a redraw from elsewhere took the unsaved Weekends tick",
      );
      await staff
        .locator('#contact-form button[data-case-action="UPDATE_CONTACT"]')
        .click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the contact card to show Weekends",
        () =>
          [...document.querySelectorAll("#case-panel-intake .contact-card .detail-row")].some(
            (row) =>
              row.querySelector("span")?.textContent.trim() === "Best time to reach" &&
              /Weekends/.test(row.querySelector("strong")?.textContent ?? ""),
          ),
        undefined,
        ARRIVAL_MS,
      );
      assert.deepEqual(
        (await one(fixture, "select best_contact_time from public.case_contacts where case_id=$1", [classCase.id]))
          .best_contact_time,
        ["weekday_evening", "weekend"],
      );
      await shootWithoutSidebar(staff, "staff-answers-v2");

      // The best time's Note is drawn with what is saved, so an edit to it
      // (not yet saved) is kept over what a redraw from elsewhere draws.
      const savedNote = async () =>
        (await one(fixture, "select best_contact_note from public.case_contacts where case_id=$1", [classCase.id]))
          .best_contact_note;
      const firstNote = await savedNote();
      assert.ok(firstNote, "the class case has no saved Note to edit");
      const noteBox = staff.locator("#field-contact-bestContactNote");
      await clickAction(staff, "toggle-edit-contact");
      await staff.locator("#contact-form").waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(await noteBox.inputValue(), firstNote);
      await noteBox.fill(EDITED_BEST_TIME_NOTE);
      await rebuiltBy(
        staff,
        () => fixture.database.sql("update public.cases set revision=revision where id=$1", [classCase.id]),
        "a no-change update on the class case",
      );
      assert.equal(
        await noteBox.inputValue(),
        EDITED_BEST_TIME_NOTE,
        "a redraw from elsewhere put the saved Note back over the unsaved edit",
      );
      await staff
        .locator('#contact-form button[data-case-action="UPDATE_CONTACT"]')
        .click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the contact card to show the edited Note",
        (wanted) =>
          [...document.querySelectorAll("#case-panel-intake .contact-card .detail-row")].some(
            (row) =>
              row.querySelector("span")?.textContent.trim() === "Note" &&
              row.querySelector("strong")?.textContent.trim() === wanted,
          ),
        EDITED_BEST_TIME_NOTE,
        ARRIVAL_MS,
      );
      assert.equal(await savedNote(), EDITED_BEST_TIME_NOTE);
      // Cancel puts the whole form away, typed text included: opened again,
      // it shows what is saved.
      await clickAction(staff, "toggle-edit-contact");
      await staff.locator("#contact-form").waitFor({ state: "visible", timeout: RENDER_MS });
      await noteBox.fill("A fictional note nobody saves.");
      await waitForQuiet(staff);
      await staff.locator('#contact-form [data-action="toggle-edit-contact"]').click({ timeout: CLICK_MS });
      await staff.locator("#contact-form").waitFor({ state: "detached", timeout: RENDER_MS });
      await clickAction(staff, "toggle-edit-contact");
      await staff.locator("#contact-form").waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(await noteBox.inputValue(), EDITED_BEST_TIME_NOTE, "Cancel kept the unsaved Note");
      await clickAction(staff, "toggle-edit-contact");
      await staff.locator("#contact-form").waitFor({ state: "detached", timeout: RENDER_MS });

      // A realtime update while the number is revealed by focus keeps it
      // revealed: the redraw puts focus back on the mask by its id.
      const REDRAW_NOTE = "Fictional note: written to check a redraw.";
      const setNote = (note) =>
        one(fixture, "update public.case_contacts set best_contact_note=$2 where case_id=$1 returning case_id", [
          classCase.id,
          note,
        ]);
      await pointerAway();
      await staff.locator("#contact-phone").focus();
      await setNote(REDRAW_NOTE);
      await waitForText(staff, REDRAW_NOTE);
      assert.equal(
        await staff.evaluate(() => document.activeElement?.id ?? null),
        "contact-phone",
        "the realtime redraw took focus off the mask",
      );
      assert.deepEqual(await fullShown(), { full: true, dots: false }, "the realtime redraw hid the revealed number");
      await setNote(EDITED_BEST_TIME_NOTE);
      await waitForText(staff, EDITED_BEST_TIME_NOTE);
      await staff.keyboard.press("Tab");

      await actForm(
        staff,
        "REQUEST_DOCUMENT",
        {
          "Short title": REQUEST_TITLE,
          "What the client should send": REQUEST_MESSAGE,
        },
        { badge: "Waiting for the client" },
      );
      await waitForText(client, "ACTION NEEDED");
      await waitForText(client, REQUEST_TITLE, RENDER_MS);
      await shoot(client, "progress-action-needed");
      await shoot(staff, "staff-case-preparing");

      // ---- The office works the client's document checklist ------------
      // The cards come from the answers the client sent, through the same
      // rules the page uses: the example's child is the household's one
      // member, whose SSN card is Maybe needed until somebody moves it.
      const sent = (await caseById(fixture, classCase.id)).answers;
      const childSsn = `ssn.hh.${sent.hh?.[0]?.member_id}`;
      const cards = cardsFor(sent);
      assert.equal(cards.find((card) => card.slotId === childSsn)?.group, "maybe", `${childSsn} is not Maybe needed`);
      assert.ok(cards.some((card) => card.slotId === "photo_id.tp"), "the photo ID card is missing");
      const rowOf = (slot) => `#case-panel-documents #doc-${slot.replace(/\./g, "-")}`;
      const groupOf = (slot) =>
        staff.evaluate((selector) => document.querySelector(`${selector} .doc-group`)?.textContent.trim() ?? null, rowOf(slot));
      await use("siteCoordinator", classReference);
      await waitForCaseWorkspace(staff, classReference);
      await openCaseTab(staff, "documents");
      await staff
        .locator("#case-panel-documents section.doc-checklist")
        .waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(await groupOf(childSsn), "Maybe needed");
      const moveCard = async (slot, group, word) => {
        await waitForQuiet(staff);
        await staff
          .locator(`#case-panel-documents [data-action="move-card"][data-slot="${slot}"][data-group="${group}"]`)
          .click({ timeout: CLICK_MS });
        await waitFor(
          staff,
          `the ${slot} card to read ${word}`,
          ([selector, wanted]) => document.querySelector(`${selector} .doc-group`)?.textContent.trim() === wanted,
          [rowOf(slot), word],
          ARRIVAL_MS,
        );
      };
      await moveCard(childSsn, "needed", "Needed (moved up by the office)");
      assert.equal((await cardRow(fixture, classCase.id, childSsn))?.group_override, "needed");
      await waitForQuiet(staff);
      await staff
        .locator('#case-panel-documents [data-action="mark-card"][data-slot="photo_id.tp"][data-status="none"]')
        .click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the photo ID card to read Don't have",
        (selector) => /Don't have/.test(document.querySelector(`${selector}-status`)?.textContent ?? ""),
        rowOf("photo_id.tp"),
        ARRIVAL_MS,
      );
      assert.equal((await cardRow(fixture, classCase.id, "photo_id.tp"))?.status, "none");
      await shootWithoutSidebar(staff, "staff-doc-checklist");
      // "Move to Maybe needed" undoes the office's move, and nothing else.
      await moveCard(childSsn, "maybe", "Maybe needed");
      assert.equal((await cardRow(fixture, classCase.id, childSsn))?.group_override, null);
      evidence.story.staffChecklist = { moved: childSsn, dontHave: "photo_id.tp" };
      await use("preparer", classReference);
      await waitForCaseWorkspace(staff, classReference);
    });

    await phase("the Preparer asks the office to contact the client", async () => {
      await actForm(
        staff,
        "ESCALATE_CONTACT",
        { "Why the office should call the client": ESCALATION_REASON },
        { text: "The office is already contacting the client about this request." },
      );
      assert.equal(
        await caseActionCount(staff, "ESCALATE_CONTACT"),
        0,
        "a second escalation is offered while one is open",
      );
    });

    await phase("the Site Coordinator logs a contact on the task and resolves it; the Preparer stays the preparer", async () => {
      await use("siteCoordinator");
      // The contact goes through the queue's Log contact drawer; the resolution
      // below goes through the case page's Follow-up tab, so both stay covered.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      const callRow = staff
        .locator('tr.queue-row[data-kind="call"]')
        .filter({ hasText: classReference })
        .first();
      await callRow.waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForQuiet(staff);
      assert.equal(
        (await callRow.locator('[data-action="open-log-call"]').innerText()).trim(),
        "Log contact",
        "the queue row's button is not named Log contact",
      );
      await callRow.locator('[data-action="open-log-call"]').click({ timeout: CLICK_MS });
      const drawer = staff.locator(".modal.office-drawer");
      await drawer.waitFor({ state: "visible", timeout: ARRIVAL_MS });
      // The task's own Log contact form: the one shared form, linked to the task.
      const contactForm = drawer.locator("form.contact-form[data-followup-id]").first();
      await contactForm.waitFor({ state: "visible", timeout: RENDER_MS });
      const taskId = await contactForm.getAttribute("data-followup-id");
      const taskScope = `contact-task-${taskId}`;

      // Half a note, and a change from elsewhere that rebuilds the page but not
      // the drawer: the keyboard, the text and the caret all have to survive.
      await waitForQuiet(staff);
      const noteField = await fieldByLabel(contactForm, "Note", "Log contact");
      await noteField.click({ timeout: CLICK_MS });
      await noteField.pressSequentially("Reached the client", { timeout: CLICK_MS });
      const typed = await noteField.evaluate((field) => {
        field.setSelectionRange(7, 7);
        window.__drawerBeforeChange = document.querySelector(".modal.office-drawer");
        return { id: field.id, value: field.value, caret: field.selectionStart };
      });
      // A no-op update on a seeded case: the staff window re-reads its list and
      // re-renders, exactly as it does for another window's work, and nothing
      // the drawer shows has moved.
      await fixture.database.sql("update public.cases set revision=revision where id=$1", [
        seeded.admin_followup.id,
      ]);
      await waitFor(
        staff,
        "a re-render from the other change to rebuild the drawer",
        () => {
          const now = document.querySelector(".modal.office-drawer");
          return Boolean(now) && now !== window.__drawerBeforeChange;
        },
        undefined,
        ARRIVAL_MS,
      );
      await waitForQuiet(staff);
      const kept = await staff.evaluate(() => {
        const field = document.activeElement;
        return {
          id: field?.id ?? null,
          value: field?.value ?? null,
          caret: field?.selectionStart ?? null,
          inDrawer: Boolean(field?.closest?.(".modal.office-drawer")),
        };
      });
      assert.deepEqual(
        kept,
        { ...typed, inDrawer: true },
        "a re-render took the half-typed note, its caret or the keyboard",
      );
      evidence.regressions.drawerCaret = { typed, kept };

      // Phone (already chosen), No answer, to request documents, with the
      // client, and the note.
      const attempt = record(
        "Log contact (office task)",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            await chooseSeg(contactForm, taskScope, "outcomeVoice", "no_answer");
            await chooseSeg(contactForm, taskScope, "purpose", "request_documents");
            await chooseSeg(contactForm, taskScope, "withWhom", "client");
            await noteField.fill(CONTACT_NOTE, { timeout: CLICK_MS });
            await staff.locator(`[id="field-${taskScope}-submit"]`).click({ timeout: CLICK_MS });
          },
          ready: (note) =>
            [...document.querySelectorAll(".modal.office-drawer .contact-task-list li")].some(
              (entry) => entry.textContent.includes(note),
            ),
          arg: CONTACT_NOTE,
          what: "the logged contact under the drawer's Contacts so far",
          safeToRepeat: await contactLogUnmoved(classCase.id),
        }),
      );
      const taskLine = await staff
        .locator(".modal.office-drawer .contact-task-list li")
        .filter({ hasText: CONTACT_NOTE })
        .first()
        .innerText();
      assert.match(taskLine, CONTACT_LINE, "the task's contact line does not start with its time");
      assert.ok(
        taskLine.includes(", phone — Request documents — No answer. Note: "),
        `the task's contact line reads ${JSON.stringify(taskLine)}`,
      );
      assert.deepEqual(
        await one(
          fixture,
          "select direction,method,purpose,outcome,with_whom,note from public.contact_log where case_id=$1 and followup_id=$2",
          [classCase.id, taskId],
        ),
        {
          direction: "outgoing",
          method: "phone",
          purpose: "request_documents",
          outcome: "no_answer",
          with_whom: "client",
          note: CONTACT_NOTE,
        },
        "the drawer's contact was not stored as logged, linked to its task",
      );
      // Logging a contact keeps the drawer open, and the keyboard goes back to
      // the very button that was pressed — not merely somewhere in the drawer:
      // before the fix each re-render moved it to the first control.
      await waitForQuiet(staff);
      const afterAttempt = await staff.evaluate(() => {
        const active = document.activeElement;
        return {
          id: active?.id ?? null,
          inDrawer: Boolean(active?.closest?.(".modal.office-drawer")),
        };
      });
      assert.deepEqual(
        afterAttempt,
        { id: `field-${taskScope}-submit`, inDrawer: true },
        "the keyboard left the Log contact button when the contact landed",
      );
      // Escape closes the drawer and gives the keyboard back to this row's
      // Log contact button.
      await staff.keyboard.press("Escape");
      await waitFor(
        staff,
        "the Log contact drawer to close",
        () => document.querySelector(".modal") === null,
        undefined,
        RENDER_MS,
      );
      assert.equal(
        await staff.evaluate(
          (id) =>
            document.activeElement?.dataset?.action === "open-log-call" &&
            document.activeElement.dataset.caseId === id,
          classCase.id,
        ),
        true,
        "Escape did not give the keyboard back to the row's Log contact button",
      );
      evidence.regressions.logCallDrawer = { attempt, afterAttempt, escape: "back on the row" };

      // The Resolve a help request drawer: the Site Coordinator takes a help request
      // on the queue, resolves it there, and the row leaves the queue with the
      // keyboard on the queue's title rather than on the page.
      const helpClaim = staff
        .locator('tr.queue-row[data-kind="help"] [data-assistance-action="CLAIM"]')
        .first();
      await helpClaim.waitFor({ state: "visible", timeout: RENDER_MS });
      const helpItemId = await helpClaim.getAttribute("data-item-id");
      // The workspace has no sample help requests: the seed's is the only row.
      assert.equal(
        await staff.locator('tr.queue-row[data-kind="help"]').count(),
        1,
        "the queue lists another help request than the seed's",
      );
      assert.equal(helpItemId, seededHelpId, "the queue's help request is not the seed's");
      const helpRevision = async () =>
        Number(
          (
            await fixture.database.sql(
              "select revision from public.assistance_items where id=$1",
              [helpItemId],
            )
          ).rows[0].revision,
        );
      const helpUnmoved = async () => {
        const before = await helpRevision();
        return async () => (await helpRevision()) === before;
      };
      const helpResolve = `[data-action="open-resolve-help"][data-item-id="${helpItemId}"]`;
      const helpClaimed = record(
        "CLAIM (assistance)",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            await staff
              .locator(`[data-assistance-action="CLAIM"][data-item-id="${helpItemId}"]`)
              .click({ timeout: CLICK_MS });
          },
          ready: (selector) => Boolean(document.querySelector(selector)),
          arg: helpResolve,
          what: "the queue row's Record as resolved button",
          safeToRepeat: await helpUnmoved(),
        }),
      );
      await waitForQuiet(staff);
      await staff.locator(helpResolve).click({ timeout: CLICK_MS });
      const helpDrawer = staff.locator(".modal.office-drawer");
      await helpDrawer.waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForText(staff, "Resolve a help request", RENDER_MS);
      const helpForm = helpDrawer
        .locator('form:has(button[type="submit"][data-assistance-action="RESOLVE"])')
        .first();
      await helpForm.waitFor({ state: "visible", timeout: RENDER_MS });
      await shoot(staff, "office-resolve-help");
      const helpResolved = record(
        "RESOLVE (assistance)",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            const note = await fieldByLabel(helpForm, "What you helped with", "RESOLVE");
            await note.fill(HELP_NOTE, { timeout: CLICK_MS });
            await waitForQuiet(staff);
            await helpForm
              .locator('button[type="submit"][data-assistance-action="RESOLVE"]')
              .click({ timeout: CLICK_MS });
          },
          ready: () => document.querySelector(".modal") === null,
          what: "the Resolve a help request drawer to close",
          safeToRepeat: await helpUnmoved(),
        }),
      );
      await waitFor(
        staff,
        "the resolved help request to leave the queue",
        (id) =>
          !document.querySelector(`tr.queue-row [data-item-id="${id}"]`) &&
          document.activeElement?.id === "office-queue-title",
        helpItemId,
        RENDER_MS,
      );
      const helpRow = await one(
        fixture,
        "select status, resolution_note from public.assistance_items where id=$1",
        [helpItemId],
      );
      assert.equal(helpRow.status, "resolved", "the help request was not resolved");
      evidence.regressions.resolveHelpDrawer = {
        claim: helpClaimed,
        resolve: helpResolved,
        focus: "#office-queue-title",
        rowGone: true,
      };

      // An empty queue's own buttons go with the empty state: "Show all
      // languages" and "Show every task" leave the keyboard on the chip that
      // now shows that choice. A kind with rows, in a language with none of
      // that kind, empties the queue. The cell shows letters, so a row's
      // languages come from its data-languages, and a row counts under every
      // language it lists, as the filter does.
      const emptyPair = await staff.evaluate(() => {
        const rows = [...document.querySelectorAll("tr.queue-row")].map((row) => ({
          kind: row.dataset.kind,
          languages: (row.cells[3]?.querySelector(".language-letters")?.dataset.languages ?? "").split("|").filter(Boolean),
        }));
        const languages = [
          ...document.querySelectorAll('[data-filter="language"]:not([data-value="all"])'),
        ].map((chip) => chip.dataset.value);
        for (const kind of new Set(rows.map((row) => row.kind)))
          for (const language of languages)
            if (!rows.some((row) => row.kind === kind && row.languages.includes(language)))
              return { kind, language };
        return null;
      });
      const chip = (filter, value) =>
        `.filter-group [data-action="set-board-filter"][data-filter="${filter}"][data-value="${value}"]`;
      const emptyButton = (filter) =>
        `.office-queue .empty-state [data-action="set-board-filter"][data-filter="${filter}"][data-value="all"]`;
      if (emptyPair) {
        const narrow = async () => {
          await clickAction(staff, "set-board-filter", {
            attributes: `[data-filter="language"][data-value="${emptyPair.language}"]`,
          });
          await clickAction(staff, "set-board-filter", {
            attributes: `[data-filter="officeKind"][data-value="${emptyPair.kind}"]`,
          });
          await staff
            .locator(emptyButton("language"))
            .waitFor({ state: "visible", timeout: RENDER_MS });
        };
        await narrow();
        await waitForQuiet(staff);
        await staff.locator(emptyButton("language")).click({ timeout: CLICK_MS });
        await waitFor(
          staff,
          'the keyboard on the "Any language" chip after "Show all languages"',
          (wanted) => document.activeElement?.matches?.(wanted) ?? false,
          chip("language", "all"),
          RENDER_MS,
        );
        await narrow();
        await waitForQuiet(staff);
        await staff.locator(emptyButton("officeKind")).click({ timeout: CLICK_MS });
        await waitFor(
          staff,
          'the keyboard on the "All" chip after "Show every task"',
          (wanted) => document.activeElement?.matches?.(wanted) ?? false,
          chip("officeKind", "all"),
          RENDER_MS,
        );
        await clickAction(staff, "set-board-filter", {
          attributes: '[data-filter="language"][data-value="all"]',
        });
        evidence.regressions.queueEmptyStateFocus = { ...emptyPair, focus: "on the chip" };
      } else evidence.regressions.queueEmptyStateFocus = "no kind and language left the queue empty";

      // The resolution is on the office case page's Follow-up tab.
      await openCaseByReference(staff, classReference);
      await openCaseTab(staff, "followup");
      await waitForText(staff, "Follow-up with the client", RENDER_MS);
      // The same contact is under the task's Contacts so far here too, and the
      // open task holds the same Log contact form.
      await waitFor(
        staff,
        "the drawer's contact under the task's Contacts so far on the Follow-up tab",
        (note) =>
          [...document.querySelectorAll("#case-panel-followup .contact-task-list li")].some((entry) =>
            entry.textContent.includes(note),
          ),
        CONTACT_NOTE,
        RENDER_MS,
      );
      assert.equal(
        await staff.locator(`#case-panel-followup form.contact-form[data-followup-id="${taskId}"]`).count(),
        1,
        "the open task on the Follow-up tab has no Log contact form",
      );
      // Logging a contact never resolves the task.
      await waitForBadge(staff, "Open with the office");
      await shoot(staff, "office-case-followup");
      await actForm(
        staff,
        "RESOLVE_FOLLOWUP",
        { "How it ended": "reached", "What the office concluded": RESOLUTION_NOTE },
        { badge: "Resolved" },
      );
      await waitForDetail(staff, "Preparer", ROLE_NAMES.preparer);
      const row = await caseById(fixture, classCase.id);
      assert.equal(row.preparer_id, preparerId, "the office's work moved the preparer");
      assert.equal(row.stage, "preparing");
      // Resolving logs nothing, and a resolved task takes no more contacts.
      assert.equal(
        Number(
          (
            await one(fixture, "select count(*)::int as n from public.contact_log where case_id=$1", [
              classCase.id,
            ])
          ).n,
        ),
        1,
        "resolving the task logged a contact",
      );
      await waitFor(
        staff,
        "the resolved task's Log contact form to go",
        (id) => !document.querySelector(`form.contact-form[data-followup-id="${id}"]`),
        taskId,
        RENDER_MS,
      );
    });

    await phase("the contact log: two windows, a text and its edit, a correction, Copy and Copy all", async () => {
      // Two staff windows, each its own account: the Preparer in the first,
      // the Site Coordinator in the second. Chrome granted the Site
      // Coordinator's context the clipboard and the story reads it back.
      // Playwright's Firefox has no clipboard permission to grant, so in both
      // engines that window's own writeText notes what it wrote (NOTE_COPIES)
      // — only once the real write has resolved.
      const realClipboard = roles.staff === "chrome";
      {
        const alexWin = roleWins.preparer;
        const samWin = roleWins.siteCoordinator;
        const morganWin = roleWins.reviewer;
        // Only what this phase causes is checked against its own windows.
        const marks = new Map([alexWin, samWin, morganWin].map((win) => [win, win.errors.length]));
        const sinceMark = (win) => ({ errors: win.errors.slice(marks.get(win)), pageErrors: win.pageErrors });
        let win1 = alexWin.page;
        const win2 = samWin.page;
        await win2.evaluate(() => {
          window.__copied = [];
        });
        const NEW = "contact-new";
        const lineOf = (page, id) => page.locator(`[id="contact-${id}-line"]`).textContent();
        const entryId = async (note) =>
          (
            await one(fixture, "select id from public.contact_log where case_id=$1 and note=$2", [
              classCase.id,
              note,
            ])
          )?.id ?? null;
        const toastSeen = (page, text) =>
          waitFor(
            page,
            `the toast ${JSON.stringify(text)}`,
            (wanted) => (window.__vitallyAlerts ?? []).some((line) => line.startsWith("toast: ") && line.includes(wanted)),
            text,
            RENDER_MS,
          );
        const outcomeGroups = (page, scope) =>
          page.evaluate(
            (submitId) =>
              Object.fromEntries(
                [...(document.getElementById(submitId)?.form?.querySelectorAll("[data-outcome-group]") ?? [])].map(
                  (set) => [set.dataset.outcomeGroup, { hidden: set.hidden, disabled: set.disabled }],
                ),
              ),
            `field-${scope}-submit`,
          );
        // Log one contact from the Contacts tab's form: its choices, a contact
        // time some hours back (so every entry has its own time), and a note
        // the new line is then found by.
        const logContact = async (page, { choices, hoursAgo, note, what }) => {
          const timeField = page.locator(`[id="field-${NEW}-contactedAt"]`);
          await timeField.waitFor({ state: "visible", timeout: RENDER_MS });
          const contactedAt = hoursBefore(await timeField.inputValue(), hoursAgo);
          return record(
            what,
            await pressUntilEffect(page, {
              press: async () => {
                await waitForQuiet(page);
                for (const [name, key] of choices) await chooseSeg(page, NEW, name, key);
                await timeField.fill(contactedAt, { timeout: CLICK_MS });
                await page.locator(`[id="field-${NEW}-note"]`).fill(note, { timeout: CLICK_MS });
                await page.locator(`[id="field-${NEW}-submit"]`).click({ timeout: CLICK_MS });
              },
              ready: (wanted) =>
                [...document.querySelectorAll("#case-panel-contacts .contact-entry .contact-line")].some((line) =>
                  line.textContent.includes(wanted),
                ),
              arg: note,
              what: `${what} in the Contacts tab`,
              safeToRepeat: await contactLogUnmoved(classCase.id),
            }),
          );
        };
        // Save an open edit form, after `change` has changed it; done when the
        // entry's line has `expected` and its form has closed.
        const saveEdit = async (page, id, change, expected, what) =>
          record(
            what,
            await pressUntilEffect(page, {
              press: async () => {
                await waitForQuiet(page);
                await change();
                await page.locator(`[id="field-contact-edit-${id}-submit"]`).click({ timeout: CLICK_MS });
              },
              ready: ([entry, wanted]) =>
                (document.getElementById(`contact-${entry}-line`)?.textContent ?? "").includes(wanted) &&
                !document.querySelector(`form.contact-form[data-contact-id="${entry}"]`),
              arg: [id, expected],
              what: `${what}: the entry reading ${JSON.stringify(expected)}`,
              safeToRepeat: await contactLogUnmoved(classCase.id),
            }),
          );
        const openEdit = async (page, id) => {
          await clickAction(page, "toggle-contact-edit", { attributes: `[data-contact-id="${id}"]` });
          await page
            .locator(`form.contact-form[data-contact-id="${id}"]`)
            .waitFor({ state: "visible", timeout: RENDER_MS });
        };

        // Both windows on the class case's Contacts tab, each reached from its
        // own board if it is somewhere else.
        await onCase(win1, "preparer", classReference);
        await openCaseTab(win1, "contacts");
        await onCase(win2, "siteCoordinator", classReference);
        await waitForCaseWorkspace(win2, classReference);
        await openCaseTab(win2, "contacts");
        // The office's drawer contact is here too, marked with its task.
        const taskEntry = win1.locator("#case-panel-contacts .contact-entry").filter({ hasText: CONTACT_NOTE });
        await taskEntry.first().waitFor({ state: "visible", timeout: RENDER_MS });
        assert.ok(
          (await taskEntry.first().innerText()).includes("For the follow-up: "),
          "the office task's contact is not marked with its task in the Contacts tab",
        );

        // Alex has half a note typed when Sam logs a contact on the same case
        // in the other window: Alex's window shows it without a reload and
        // keeps the half note.
        await waitForQuiet(win1);
        const alexNote = win1.locator(`[id="field-${NEW}-note"]`);
        await alexNote.click({ timeout: CLICK_MS });
        await alexNote.pressSequentially(HALF_CONTACT_NOTE, { timeout: CLICK_MS });
        await win1.evaluate(() => {
          window.__sameDocument = true;
        });
        const samLogged = await logContact(win2, {
          choices: [
            ["outcomeVoice", "reached"],
            ["purpose", "ask_question"],
            ["withWhom", "client"],
          ],
          hoursAgo: 3,
          note: SAM_CONTACT_NOTE,
          what: "Sam's phone call",
        });
        await waitFor(
          win1,
          "Sam's contact in Alex's Contacts tab",
          (wanted) =>
            [...document.querySelectorAll("#case-panel-contacts .contact-entry .contact-line")].some((line) =>
              line.textContent.includes(wanted),
            ),
          SAM_CONTACT_NOTE,
          ARRIVAL_MS,
        );
        await waitForQuiet(win1);
        const alexKept = await win1.evaluate(
          (id) => ({
            sameDocument: window.__sameDocument === true,
            value: document.getElementById(id)?.value ?? null,
            focused: document.activeElement?.id === id,
          }),
          `field-${NEW}-note`,
        );
        assert.equal(alexKept.sameDocument, true, "Alex's window reloaded to show Sam's contact");
        assert.equal(alexKept.value, HALF_CONTACT_NOTE, "Sam's contact took Alex's half-typed note");
        const samId = await entryId(SAM_CONTACT_NOTE);
        assert.ok(samId, "Sam's contact is not in the log");

        // Alex texts the client. Phone → No answer is chosen first, then Text:
        // the voice outcomes are hidden and disabled, so the entry is Sent.
        await waitForQuiet(win1);
        const revisionBefore = Number((await caseById(fixture, classCase.id)).revision);
        await chooseSeg(win1, NEW, "outcomeVoice", "no_answer");
        await chooseSeg(win1, NEW, "method", "text");
        assert.deepEqual(
          await outcomeGroups(win1, NEW),
          { voice: { hidden: true, disabled: true }, written: { hidden: false, disabled: false } },
          "Text did not swap the voice outcomes for the written ones",
        );
        const alexLogged = await logContact(win1, {
          choices: [
            ["method", "text"],
            ["outcomeWritten", "sent"],
            ["purpose", "request_documents"],
            ["withWhom", "client"],
          ],
          hoursAgo: 2,
          note: ALEX_TEXT_NOTE,
          what: "Alex's text",
        });
        const alexId = await entryId(ALEX_TEXT_NOTE);
        assert.ok(alexId, "Alex's text is not in the log");
        const sentLine = await lineOf(win1, alexId);
        assert.match(sentLine, CONTACT_LINE);
        assert.ok(
          sentLine.includes(`— ${PREPARER_SHORT_NAME} → client`) &&
            sentLine.endsWith(`, text — Request documents — Sent. Note: ${ALEX_TEXT_NOTE}`),
          `Alex's text reads ${JSON.stringify(sentLine)}`,
        );
        assert.deepEqual(
          await one(fixture, "select method,outcome,revision::int from public.contact_log where id=$1", [alexId]),
          { method: "text", outcome: "sent", revision: 1 },
          "the hidden No answer was sent with the text",
        );
        assert.equal(
          Number((await caseById(fixture, classCase.id)).revision),
          revisionBefore,
          "logging a contact moved the case's revision",
        );

        // The client replies: Alex edits his entry to Client replied.
        await openEdit(win1, alexId);
        const replied = await saveEdit(
          win1,
          alexId,
          () => chooseSeg(win1, `contact-edit-${alexId}`, "outcomeWritten", "replied"),
          "— Client replied.",
          "Alex's edit",
        );
        const editedEntry = await win1.locator(`[id="contact-${alexId}"]`).innerText();
        assert.ok(/\bedited \d/.test(editedEntry), `the edited entry does not say edited: ${editedEntry}`);
        assert.equal(
          (await win1.locator(`[id="contact-${alexId}"] .contact-versions summary`).innerText()).trim(),
          "Earlier versions (1)",
        );
        assert.ok(
          (await win1.locator(`[id="contact-${alexId}"] .contact-versions li`).first().textContent()).includes(
            "— Sent.",
          ),
          "the earlier version does not keep Sent",
        );
        // Sam's window shows the edit without a reload.
        await waitFor(
          win2,
          "Alex's edit in Sam's window",
          (id) => (document.getElementById(`contact-${id}-line`)?.textContent ?? "").includes("— Client replied."),
          alexId,
          ARRIVAL_MS,
        );

        // The Preparer opens Edit again and the story moves to the Reviewer's
        // window: the Reviewer neither sees the Preparer's open form nor gets
        // an Edit on the Preparer's entry.
        await openEdit(win1, alexId);
        const preparerPage = win1;
        win1 = morganWin.page;
        await onCase(win1, "reviewer", classReference);
        await waitForCaseWorkspace(win1, classReference);
        await openCaseTab(win1, "contacts");
        await win1.locator(`[id="contact-${alexId}"]`).waitFor({ state: "visible", timeout: RENDER_MS });
        assert.equal(
          await win1.locator(`form.contact-form[data-contact-id="${alexId}"]`).count(),
          0,
          "Morgan sees the edit form Alex left open",
        );
        assert.equal(
          await win1.locator(`[id="contact-${alexId}"] [data-action="toggle-contact-edit"]`).count(),
          0,
          "Morgan is offered Edit on Alex's entry",
        );
        // The same check inside one window, where it can fail: the person
        // changes there. An admin — the only kind of account offered Edit on
        // the Preparer's entry — opens Edit in a window of its own and signs
        // out, and the Reviewer signs in in that window through the real
        // form: the open form went with the sign-out, and the Reviewer gets
        // no Edit (#134). Supabase's sign-out ends every session of the
        // account that signs out, so the admin is one of its own, Quinn Harper,
        // made for this check alone and signed in nowhere else; the Site
        // Coordinator's window keeps its session. The Reviewer signing in
        // ends nothing.
        const switchStarted = Date.now();
        const switchAdminAccount = await fixture.database.staff({
          key: "switch_admin",
          name: "Quinn Harper",
          capabilities: ["admin"],
        });
        const switchAdminActor = { key: "switch_admin", email: switchAdminAccount.email, userId: switchAdminAccount.userId };
        const switchWin = await openWindow(staffEngine);
        try {
          const shared = switchWin.page;
          await loginTestUser({ page: shared, actor: switchAdminActor, fixture, heading: OFFICE_BOARD_HEADING });
          assert.equal(await readSignedInAs(shared), "Quinn Harper", "the switch window is signed in as someone else");
          await watchAlerts(shared);
          // From the office's case pool, which lists every open case.
          await clickAction(shared, "open-cases");
          await waitForText(shared, "Case pool", RENDER_MS);
          await openCaseByReference(shared, classReference);
          await openCaseTab(shared, "contacts");
          await openEdit(shared, alexId);
          await clickAction(shared, "sign-out");
          await waitForText(shared, "Sign in with your email", RENDER_MS);
          assert.equal(
            await shared.locator(`form.contact-form[data-contact-id="${alexId}"]`).count(),
            0,
            "the admin's open edit form outlived the sign-out",
          );
          // A fresh document, as after any sign-out: the auth module's resend
          // cooldown lives in the one it signed out of.
          await shared.goto(fixture.appOrigin);
          await loginTestUser({ page: shared, actor: fixture.actor("reviewer"), fixture, heading: WORK_BOARD_HEADING });
          await watchAlerts(shared);
          assert.equal(await readSignedInAs(shared), ROLE_NAMES.reviewer, "the switched window is signed in as someone else");
          await openCaseByReference(shared, classReference);
          await waitForCaseWorkspace(shared, classReference);
          await openCaseTab(shared, "contacts");
          await shared.locator(`[id="contact-${alexId}"]`).waitFor({ state: "visible", timeout: RENDER_MS });
          assert.equal(
            await shared.locator(`form.contact-form[data-contact-id="${alexId}"]`).count(),
            0,
            "the Reviewer sees the edit form the admin left open in the same window",
          );
          assert.equal(
            await shared.locator(`[id="contact-${alexId}"] [data-action="toggle-contact-edit"]`).count(),
            0,
            "the Reviewer is offered Edit on the Preparer's entry in the same window",
          );
          assertConsoleQuiet(switchWin, { name: "contact log sign-out window" });
        } finally {
          await switchWin.context.close();
        }
        evidence.story.signOutEditSwitchMs = Date.now() - switchStarted;
        // The Preparer puts the open form away again, so its window carries no
        // edit of an entry somebody else is about to correct.
        await clickAction(preparerPage, "toggle-contact-edit", { attributes: `[data-contact-id="${alexId}"]` });
        await preparerPage
          .locator(`form.contact-form[data-contact-id="${alexId}"]`)
          .waitFor({ state: "detached", timeout: RENDER_MS });

        // Sam, an admin, corrects Alex's entry; it still says Alex logged it,
        // and Morgan's window shows the correction.
        await openEdit(win2, alexId);
        const corrected = await saveEdit(
          win2,
          alexId,
          () =>
            win2
              .locator(`[id="field-contact-edit-${alexId}-note"]`)
              .fill(SAM_CORRECTION_NOTE, { timeout: CLICK_MS }),
          SAM_CORRECTION_NOTE,
          "Sam's correction",
        );
        const correctedLine = await lineOf(win2, alexId);
        assert.ok(
          correctedLine.includes(`— ${PREPARER_SHORT_NAME} → client`),
          `the correction changed the logger: ${correctedLine}`,
        );
        assert.equal(
          (await win2.locator(`[id="contact-${alexId}"] .contact-versions summary`).innerText()).trim(),
          "Earlier versions (2)",
        );
        assert.deepEqual(
          await one(
            fixture,
            "select logged_by_person_id::text as logger,revision::int,outcome from public.contact_log where id=$1",
            [alexId],
          ),
          { logger: preparerId, revision: 3, outcome: "replied" },
          "Sam's correction did not keep Alex as the logger",
        );
        await waitFor(
          win1,
          "Sam's correction in Morgan's window",
          ([id, wanted]) => (document.getElementById(`contact-${id}-line`)?.textContent ?? "").includes(wanted),
          [alexId, SAM_CORRECTION_NOTE],
          ARRIVAL_MS,
        );

        // The client phones in: no outcome is offered, and the line starts
        // with its time and then the client.
        await waitForQuiet(win2);
        await chooseSeg(win2, NEW, "direction", "incoming");
        assert.deepEqual(
          await outcomeGroups(win2, NEW),
          { voice: { hidden: true, disabled: true }, written: { hidden: true, disabled: true } },
          "an incoming contact offered an outcome",
        );
        const incoming = await logContact(win2, {
          choices: [
            ["direction", "incoming"],
            ["purpose", "schedule_appointment"],
            ["withWhom", "client"],
          ],
          hoursAgo: 1,
          note: INCOMING_NOTE,
          what: "the client's incoming call",
        });
        const incomingId = await entryId(INCOMING_NOTE);
        const incomingLine = await lineOf(win2, incomingId);
        assert.match(
          incomingLine,
          /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} (AM|PM) — client\b/,
          "the incoming line does not start with its time and then the client",
        );
        assert.ok(
          incomingLine.endsWith(`, phone — Schedule an appointment. Note: ${INCOMING_NOTE}`),
          `the incoming line reads ${JSON.stringify(incomingLine)}`,
        );
        assert.equal(
          (await one(fixture, "select outcome from public.contact_log where id=$1", [incomingId])).outcome,
          "reached",
        );
        await shootWithoutSidebar(win2, "staff-case-contacts");

        // Copy: Sam's own entry's line, as the page shows it.
        await clickAction(win2, "copy-contact", { attributes: `[data-contact-id="${samId}"]` });
        await toastSeen(win2, "Copied.");
        const copied = await win2.evaluate(() => window.__copied ?? []);
        assert.deepEqual(copied, [await lineOf(win2, samId)], "Copy did not put the entry's line on the clipboard");
        if (realClipboard)
          assert.equal(await win2.evaluate(() => navigator.clipboard.readText()), copied[0]);

        // Copy all: every line, oldest contact time first, one per line.
        const ordered = (
          await fixture.database.sql(
            "select id from public.contact_log where case_id=$1 order by contacted_at, logged_at",
            [classCase.id],
          )
        ).rows.map((entry) => entry.id);
        assert.deepEqual(
          ordered.slice(0, 3),
          [samId, alexId, incomingId],
          "the contact times did not land as set",
        );
        await clickAction(win2, "copy-all-contacts");
        await toastSeen(win2, `Copied ${ordered.length} contacts.`);
        const all = (await win2.evaluate(() => window.__copied ?? []))[1] ?? "";
        const lines = all.split("\n");
        const expected = [];
        for (const id of ordered) expected.push(await lineOf(win2, id));
        assert.deepEqual(lines, expected, "Copy all is not every line, oldest first");
        for (const line of lines) assert.match(line, CONTACT_LINE);
        // The system clipboard keeps the platform's line breaks (Windows reads
        // back \r\n for the \n the page wrote), so only those are evened out.
        if (realClipboard)
          assert.equal(
            (await win2.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"),
            all,
          );

        // The client sees none of it: no Contacts tab and none of the text.
        assert.equal(await client.locator("#case-tab-contacts").count(), 0, "the client window has a Contacts tab");
        const seen = await pageText(client);
        for (const secret of [CONTACT_NOTE, SAM_CONTACT_NOTE, ALEX_TEXT_NOTE, SAM_CORRECTION_NOTE, INCOMING_NOTE])
          assert.ok(!seen.includes(secret), `a contact note reached the client window: ${secret.slice(0, 24)}…`);

        assertConsoleQuiet(sinceMark(alexWin), { name: "contact log window 1" });
        assertConsoleQuiet(sinceMark(samWin), { name: "contact log window 2" });
        assertConsoleQuiet(sinceMark(morganWin), { name: "contact log window 1, the Reviewer's" });
        evidence.story.contactLog = {
          entries: ordered.length,
          liveWindow: alexKept,
          presses: { samLogged, alexLogged, replied, corrected, incoming },
          clipboard: realClipboard ? "read back from the real clipboard" : "the page's own writeText, resolved",
          copyAll: lines.length,
        };
      }
    });

    await phase("the client sends the sample document for their own case", async () => {
      // The office has just finished working on this case, so this click can
      // meet a revision that moved a moment ago. The application refuses it and
      // says to try again — which is what this does, and counts.
      const response = await act(client, "RESPOND_DOCUMENT", {
        text: "What you sent",
      });
      evidence.story.documentResponse = response;
      // Ruling R65: a refusal is the person's to act on. Each one recorded here
      // was read back from the screen after the ten-second wait that followed
      // it — several background changes later — and had to still be there.
      for (const refusal of response.refusals) {
        assert.match(refusal.recorded, /Someone else (changed|updated) this/);
        assert.match(
          refusal.onScreen ?? "",
          /Someone else changed this application/,
          `a refusal left the screen before the client acted on it: ${JSON.stringify(refusal)}`,
        );
      }
      await waitForText(client, SAMPLE_DOCUMENT_FILENAME, RENDER_MS);
      await use("preparer", classReference);
      await waitForBadge(staff, "Received, not verified yet");
    });

    await phase("the Preparer verifies the document and records preparation complete", async () => {
      await act(staff, "VERIFY_DOCUMENT", { badge: "Verified" });
      const today = todayIso();
      await actQuestionnaire(
        staff,
        "SUBMIT_REVIEW",
        () =>
          fillPreparer(staff, {
            confirmedBy: "other",
            confirmedByName: "Pat Example",
            confirmedMethod: "phone",
            shaded: true,
            state: true,
            readyForReviewOn: today,
          }),
        { badge: "Pending review" },
      );
      await waitForBadge(client, "Waiting for review");
      const row = await caseById(fixture, classCase.id);
      assert.equal(row.stage, "review_ready");
      const firstQuestionnaire = await one(
        fixture,
        "select confirmed_by, confirmed_by_name, confirmed_method, ready_for_review_on::text as ready_on from public.preparer_questionnaires where case_id=$1 and preparation_version=1",
        [classCase.id],
      );
      assert.deepEqual(firstQuestionnaire, {
        confirmed_by: "other",
        confirmed_by_name: "Pat Example",
        confirmed_method: "phone",
        ready_on: today,
      });
      assert.equal(row.preparer_id, preparerId);
      assert.equal(row.reviewer_id, null);
    });

    await phase("the Reviewer reviews: a finding, the Preparer's resubmission, then approval", async () => {
      await use("reviewer", classReference);
      // The Reviewer's window was last on the Contacts tab; the claim is on Overview.
      await openCaseTab(staff, "overview");
      await act(staff, "CLAIM_REVIEW", { detail: { label: "Reviewer", value: ROLE_NAMES.reviewer } });
      await waitForBadge(staff, "Review in progress");
      // Corrections are asked for in a dialog; its form is the payload.
      await clickAction(staff, "open-request-corrections");
      await actForm(
        staff,
        "REQUEST_CORRECTIONS",
        { "Corrections to send back to the preparer": FINDINGS },
        { badge: "Corrections requested" },
      );
      // The confirmation's toast reaches the live region, outside anything
      // inert, though the dialog closed only a moment ago (screen-states).
      await waitFor(
        staff,
        "the corrections toast, outside anything inert",
        () => {
          const toast = document.querySelector("#toast");
          return (
            (toast?.textContent ?? "").includes("The preparer was asked for corrections.") && !toast.closest("[inert]")
          );
        },
        undefined,
        RENDER_MS,
      );
      evidence.story.correctionsToast = "announced in #toast, outside anything inert";
      await waitForBadge(client, "Being corrected");
      const duringCorrections = await pageText(client);
      assert.ok(
        !duringCorrections.includes(FINDINGS),
        "the reviewer's findings reached the client window",
      );

      await use("preparer", classReference);
      await waitForText(staff, "Corrections the reviewer asked for", RENDER_MS);
      // The resubmit form starts from the earlier answers; only the TaxSlayer
      // date is reset to today.
      await staff.locator(radioId("prep", "confirmedBy", "other")).waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(await staff.locator(radioId("prep", "confirmedBy", "other")).isChecked(), true);
      assert.equal(await staff.locator(fieldIdOf("prep", "confirmedByName")).inputValue(), "Pat Example");
      assert.equal(await staff.locator(radioId("prep", "confirmedMethod", "phone")).isChecked(), true);
      assert.equal(await staff.locator(fieldIdOf("prep", "shadedPartsCompleted")).isChecked(), true);
      assert.equal(await staff.locator(fieldIdOf("prep", "stateForgivenessSet")).isChecked(), true);
      assert.equal(await staff.locator(fieldIdOf("prep", "readyForReviewOn")).inputValue(), todayIso());
      await actQuestionnaire(
        staff,
        "RESUBMIT_REVIEW",
        async () => {
          await staff
            .locator('[id="field-resubmit-resolution"]')
            .fill(CORRECTION_NOTE, { timeout: CLICK_MS });
          await fillPreparer(staff, { confirmedMethod: "email" });
        },
        { badge: "Pending review" },
      );
      assert.equal(
        (
          await one(
            fixture,
            "select confirmed_method from public.preparer_questionnaires where case_id=$1 and preparation_version=2",
            [classCase.id],
          )
        )?.confirmed_method,
        "email",
        "the resubmission did not store its own questionnaire",
      );

      await use("reviewer", classReference);
      await act(staff, "CLAIM_REVIEW", { badge: "Review in progress" });
      // The reviewer form is in "Your next step", above Approve, never in a
      // dialog. Local SIT gets an amount and nothing else: the approval is
      // refused with a sentence naming it, and that group is open again.
      const approveButton = staff.locator('button[type="submit"][data-case-action="APPROVE_REVIEW"]');
      await approveButton.waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForQuiet(staff);
      const placement = await staff.evaluate(() => {
        const button = document.querySelector('button[type="submit"][data-case-action="APPROVE_REVIEW"]');
        const last = document.querySelector('[id="field-rev-remarks"]');
        const first = document.querySelector('[id="field-rev-completedOn"]');
        return {
          sameForm: Boolean(button?.form) && button.form === last?.form && button.form === first?.form,
          above: last.getBoundingClientRect().bottom <= button.getBoundingClientRect().top,
          modals: document.querySelectorAll(".modal").length,
        };
      });
      assert.deepEqual(placement, { sameForm: true, above: true, modals: 0 }, "the reviewer form is not inline above Approve");
      const noticesBefore = ((await readAlerts(staff)) ?? []).length;
      await fillReviewer(staff, {
        paForgiveness: "eligible",
        wentOver: "no",
        signMethod: "portal",
        // The amount is shown only once a Result is chosen (#108), so the
        // half-filled entry has a Result and an amount but no method.
        exit: { "local.SIT": { result: "owe", amount: "45.00" } },
      });
      await waitForQuiet(staff);
      await approveButton.click({ timeout: CLICK_MS });
      await noticeSaid(staff, "choose E-file or Paper", noticesBefore);
      await waitForQuiet(staff);
      assert.equal(
        await staff.locator('details.q-exit-group:has([id="field-rev-local.SIT.amount"])').evaluate((element) => element.open),
        true,
        "the Local SIT group is closed again after the refusal that names it",
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "reviewing");
      assert.equal(await staff.locator(".modal").count(), 0, "a dialog opened for the refused approval");

      // Now the half-filled entry is finished, a Federal one is added, and the
      // reviewer answers No to having gone over the return.
      await actQuestionnaire(
        staff,
        "APPROVE_REVIEW",
        () =>
          fillReviewer(staff, {
            completedOn: todayIso(),
            paForgiveness: "eligible",
            wentOver: "no",
            signMethod: "portal",
            exit: {
              federal: { method: "efile", result: "refund", amount: "120.00", refundBy: "direct_deposit" },
              "local.SIT": { method: "efile", result: "owe", amount: "45.00", oweBy: "mail_check" },
            },
            remarks: "Fictional remarks for the exit form.",
          }),
        { badge: "Ready to exit" },
      );
      assert.equal(await staff.locator(".modal").count(), 0, "a dialog opened for the approval");
      const row = await caseById(fixture, classCase.id);
      assert.equal(row.stage, "review_approved");
      assert.equal(
        (await one(fixture, "select signing_plan from public.cases where id=$1", [classCase.id])).signing_plan,
        "go_over_first",
      );
      assert.equal(row.reviewer_id, reviewerId);
      const answered = await one(
        fixture,
        "select went_over, sign_method, exit_form from public.reviewer_questionnaires where case_id=$1",
        [classCase.id],
      );
      assert.equal(answered.went_over, false);
      assert.equal(answered.sign_method, "portal");
      assert.equal(answered.exit_form.federal.amount, "120.00");
      assert.equal(answered.exit_form.local.find((entry) => entry.type === "SIT")?.result, "owe");
      assert.equal(answered.exit_form.state, null);
      const goOver = await one(
        fixture,
        "select status, reason, assignee_person_id, request_id from public.admin_followups where case_id=$1 and purpose='go_over_return'",
        [classCase.id],
      );
      assert.equal(goOver.status, "open");
      assert.equal(goOver.reason, "Go over the return with the client: the reviewer did not.");
      // The workspace's default follow-up person: the Site Coordinator.
      assert.equal(goOver.assignee_person_id, siteCoordinatorId);
      assert.equal(goOver.request_id, null);
      // The reviewer's next step reads the go-over line and has no call to record.
      await waitForText(staff, "The office will go over the return with the client.", RENDER_MS);
      assert.equal(await caseActionCount(staff, "RECORD_REVIEW_CONTACT"), 0, "an approval left the review-contact step pending");
      assert.equal(row.preparer_id, preparerId);
      evidence.story.reviewVersions = await eventCount(
        fixture,
        classCase.id,
        "APPROVE_REVIEW",
      );
      assert.equal(evidence.story.reviewVersions, 1);
    });

    await phase("the client sees the next step: the office will go over the return first", async () => {
      await waitForBadge(client, "Ready to sign");
      await waitForText(
        client,
        "Your return has been checked. PCDC will contact you to go over your return together. After that, you will sign it. Your return can't be filed until you sign.",
        RENDER_MS,
      );
      const seen = await pageText(client);
      for (const secret of [
        FINDINGS,
        CORRECTION_NOTE,
        CONTACT_NOTE,
        SAM_CONTACT_NOTE,
        SAM_CORRECTION_NOTE,
        INCOMING_NOTE,
      ])
        assert.ok(
          !seen.includes(secret),
          `internal staff text reached the client window: ${secret.slice(0, 24)}…`,
        );
      // A version-2 client's open document cards name papers, not amounts:
      // the bank card asks for "a voided check or a bank letter with routing
      // and account numbers" because the client chose a refund by deposit.
      // Those cards are left out of the money check; everything else is in.
      const claims = await client.evaluate(() => {
        const cards = document.querySelector(".open-documents")?.innerText ?? "";
        return (document.querySelector("#app")?.innerText ?? "").replace(cards, "");
      });
      for (const word of MONEY_WORDS)
        assert.ok(
          !claims.toLowerCase().includes(word),
          `the client window claimed something about money: ${word}`,
        );
      assert.equal(
        await client.locator('[data-role="internal-history"]').count(),
        0,
        "the client window rendered an internal history",
      );
      await shoot(client, "progress-review-complete");
      await shoot(staff, "staff-case-review-approved");
    });

    await phase("a second case takes the short path: claim review, approve", async () => {
      const short = seeded.review_ready;
      await use("reviewer");
      await openBoard(staff, WORK_BOARD_HEADING);
      await showBoardTab(staff, "review");
      // Claimed from the board row itself, which names the case it belongs to.
      record(
        "CLAIM_REVIEW",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            await staff
              .locator(`.board-row:has(button.board-reference:has-text("${short.reference}"))`)
              .first()
              .locator('[data-case-action="CLAIM_REVIEW"]')
              .click({ timeout: CLICK_MS });
          },
          ready: HAS_DETAIL,
          arg: { label: "Reviewer", value: ROLE_NAMES.reviewer },
          what: "the claimed review, in its own case workspace",
          safeToRepeat: await unmovedSince(short.id),
        }),
      );
      await waitForCaseWorkspace(staff, short.reference);
      // This reviewer did go over the return, so the client signs in the portal
      // and the office has nothing to go over: no call is left to record.
      await actQuestionnaire(
        staff,
        "APPROVE_REVIEW",
        () =>
          fillReviewer(staff, {
            completedOn: todayIso(),
            paForgiveness: "not_eligible",
            wentOver: "yes",
            wentOverOn: todayIso(),
            wentOverHow: "phone",
            signMethod: "portal",
          }),
        { badge: "Ready to exit" },
        { caseId: short.id },
      );
      const row = await caseById(fixture, short.id);
      assert.equal(row.stage, "review_approved");
      assert.equal(
        (await one(fixture, "select signing_plan from public.cases where id=$1", [short.id])).signing_plan,
        "portal",
      );
      assert.equal(await eventCount(fixture, short.id, "RECORD_REVIEW_CONTACT"), 0);
      assert.equal(
        Number(
          (
            await one(
              fixture,
              "select count(*)::int as n from public.admin_followups where case_id=$1 and purpose='go_over_return'",
              [short.id],
            )
          ).n,
        ),
        0,
        "a Yes approval raised a go-over task",
      );
      assert.equal(await eventCount(fixture, short.id, "REQUEST_CORRECTIONS"), 0);
      evidence.story.shortPath = "claimed and approved with no correction round";
    });

    await phase("the Exit Form opens from an approved review, and says so when it can't be made", async () => {
      // Chrome only: Firefox may download a blob PDF instead of opening it.
      let exitForm = `not run: the staff engine is ${roles.staff}, which may download the PDF instead of opening it`;
      if (roles.staff === "chrome") {
        // The class case: its review was approved a moment ago with a Federal
        // amount. The seeded review_approved case's Exit Form records none
        // (tools/admin/seed-values.mjs), so it has no amount to print.
        const sample = { id: classCase.id, reference: classReference };
        const before = await caseById(fixture, sample.id);
        const expected = await one(
          fixture,
          "select c.season,c.client_number,c.answers->>'tp_first_name' first_name,c.answers->>'tp_last_name' last_name,c.answers->>'sp_first_name' sp_first_name,c.answers->>'sp_last_name' sp_last_name,q.exit_form from public.cases c join public.reviewer_questionnaires q on q.case_id=c.id where c.id=$1",
          [sample.id],
        );
        const wrongFont = { on: false };
        const fontRoutes = [];
        try {
          // The fonts come from the packages npm installed, never the internet.
          for (const [url, file] of Object.entries(DRAFT_FONT_FIXTURES)) {
            const bytes = await readFile(path.join(ROOT, file.path));
            const handler = (route) =>
              route.fulfill({
                status: 200,
                headers: { "content-type": "font/ttf", "access-control-allow-origin": "*" },
                body: wrongFont.on ? Buffer.from("not the pinned font") : bytes,
              });
            // Both windows this phase presses in: the Reviewer's and the Site Coordinator's.
            for (const page of [roleWins.reviewer.page, roleWins.siteCoordinator.page]) {
              await page.route(url, handler);
              fontRoutes.push([page, url, handler]);
            }
          }
          const press = async () => {
            await revealCaseControl(staff, '[data-action="view-exit-form"]');
            await waitForQuiet(staff);
            const opened = staff.waitForEvent("popup", { timeout: CLICK_MS });
            await staff.locator('[data-action="view-exit-form"]').first().click({ timeout: CLICK_MS });
            return await opened;
          };

          // The reviewer opens it: one page, the case's own header and amount.
          await use("reviewer");
          await openBoard(staff, WORK_BOARD_HEADING);
          await openCaseByReference(staff, sample.reference);
          const popup = await press();
          const bytes = await draftBytes(popup);
          const { pages, strings } = await draftPageText(bytes, 0);
          assert.equal(pages, 1, "the Exit Form is not one page");
          for (const wanted of [
            String(expected.season),
            String(expected.client_number),
            // The class case is a married couple's, so the Exit Form names
            // both, as src/exit-form.mjs joins them.
            expected.sp_first_name
              ? `${expected.first_name} ${expected.last_name} & ${expected.sp_first_name} ${expected.sp_last_name}`
              : `${expected.first_name} ${expected.last_name}`,
            `$${expected.exit_form.federal.amount}`,
          ])
            assert.ok(strings.includes(wanted), `the Exit Form does not print ${JSON.stringify(wanted)}: ${JSON.stringify(strings)}`);
          assert.ok(
            strings.some((text) => /^\d{2}\/\d{2}\/\d{4}$/.test(text)),
            `the Exit Form prints no date: ${JSON.stringify(strings)}`,
          );
          const doc = await PDFDocument.load(bytes, { updateMetadata: false });
          assert.equal(doc.getAuthor() ?? "", "", "the Exit Form names an author");
          assert.equal(doc.getTitle(), "Exit Form");
          await popup.close();

          // The office's form can't be made: the tab and the error notice say so,
          // and Try again makes it once the cause is gone.
          await use("siteCoordinator");
          await openBoard(staff, OFFICE_BOARD_HEADING);
          await openCaseByReference(staff, sample.reference);
          wrongFont.on = true;
          const failed = await press();
          await waitFor(
            failed,
            "the Exit Form tab to say it could not be made",
            (wanted) => document.body?.textContent.trim() === wanted,
            "The Exit Form could not be made. Close this tab and try again.",
            ARRIVAL_MS,
          );
          await waitFor(
            staff,
            "the error notice to say the Exit Form could not be made",
            (wanted) => [...document.querySelectorAll(".notice.error")].some((notice) => notice.textContent.includes(wanted)),
            "The Exit Form could not be made. Try again.",
            ARRIVAL_MS,
          );
          await failed.close();
          wrongFont.on = false;
          const retried = staff.waitForEvent("popup", { timeout: ARRIVAL_MS }).catch(() => null);
          await waitForQuiet(staff);
          await staff
            .locator('.notice.error:has-text("The Exit Form could not be made") [data-action="retry-action"]')
            .click({ timeout: CLICK_MS });
          const again = await retried;
          if (again) {
            assert.equal((await draftBytes(again)).subarray(0, 5).toString("latin1"), "%PDF-", "Try again did not make the Exit Form");
            await again.close();
          } else {
            // Attached, not visible: the link lives in the Intake answers tab (#122).
            await staff.locator("#draft-ready-link").waitFor({ state: "attached", timeout: ARRIVAL_MS });
          }
          await waitFor(
            staff,
            "the Exit Form error notice to clear",
            () => ![...document.querySelectorAll(".notice.error")].some((notice) => notice.textContent.includes("The Exit Form could not be made")),
            undefined,
            ARRIVAL_MS,
          );

          // A blocked tab. Known problem, #122: this records what happens, not
          // what we want. The link is drawn in the Intake answers tab, so the
          // office, pressing the button on Overview, sees nothing and no error.
          await staff.evaluate(() => {
            window.__vitallyOpen = window.open;
            window.open = () => null;
          });
          await openCaseTab(staff, "overview");
          await waitForQuiet(staff);
          await staff.locator('[data-action="view-exit-form"]').first().click({ timeout: CLICK_MS });
          await waitFor(staff, "the Exit Form link", () => Boolean(document.querySelector("#case-panel-intake #draft-ready a")), undefined, ARRIVAL_MS);
          const link = staff.locator("#case-panel-intake #draft-ready a");
          assert.equal(
            await staff.locator('.notice.error:has-text("The Exit Form could not be made")').count(),
            0,
            "a blocked tab showed the Exit Form error",
          );
          assert.equal(await link.isVisible(), false, "the blocked-tab link is visible from Overview");
          await openCaseTab(staff, "intake");
          assert.equal(await link.isVisible(), true, "the blocked-tab link is not on the Intake answers tab");
          const blocked = await link.evaluate((a) => ({ download: a.download, blob: a.href.startsWith("blob:") }));
          await staff.evaluate(() => {
            window.open = window.__vitallyOpen;
          });
          assert.deepEqual(blocked, { download: `exit-form-${expected.client_number}.pdf`, blob: true });

          // Nothing is kept: the case did not move.
          const after = await caseById(fixture, sample.id);
          assert.equal(after.stage, before.stage, "making the Exit Form moved the case");
          assert.equal(after.revision, before.revision, "making the Exit Form changed the case");
          await openBoard(staff, OFFICE_BOARD_HEADING);
          exitForm = {
            opened: "one page with the season, client number, name, amount and a date",
            failure: "tab and error notice said so; Try again " + (again ? "opened a new tab" : "offered the link"),
            blocked: `${blocked.download}, a link only on the Intake answers tab (#122)`,
          };
        } finally {
          await staff.evaluate(() => { if (window.__vitallyOpen) window.open = window.__vitallyOpen; }).catch(() => {});
          for (const [page, url, handler] of fontRoutes) await page.unroute(url, handler).catch(() => {});
        }
      }
      evidence.story.exitForm = exitForm;
    });

    let loopKit = null;
    await phase("the office records signing and e-filing, and the client sees each step", async () => {
      // The class case's approval settled the reviewer's call itself, so the
      // office never records one; its go-over task holds the signature back
      // until it is resolved. The seeded review_approved case is a
      // questionnaire Yes approval, so its row offers the mark.
      const approved = await caseById(fixture, classCase.id);
      assert.equal(approved.stage, "review_approved");
      assert.equal(await eventCount(fixture, classCase.id, "RECORD_REVIEW_CONTACT"), 0);
      const callPending = seeded.review_approved;
      assert.ok(callPending, "the seeded review_approved case is missing");
      // The dialogs name the client as the case page does: first and last name.
      const clientName = [approved.answers?.tp_first_name, approved.answers?.tp_last_name]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");
      assert.ok(clientName, "the class case has no client name for the dialogs to show");
      const queueRow = (kind, reference) =>
        staff
          .locator(`tr.queue-row[data-kind="${kind}"]`)
          .filter({ has: staff.locator("button.board-reference", { hasText: reference }) })
          .first();
      const dialogTitled = (title) =>
        waitFor(
          staff,
          `the dialog ${JSON.stringify(title)}`,
          (wanted) => document.querySelector(".modal #modal-title")?.textContent.trim() === wanted,
          title,
          ARRIVAL_MS,
        );
      const dialogText = async () =>
        (await staff.locator(".modal").innerText()).replace(/\s+/g, " ").trim();
      // Tick the dialog's required box (again, if a rebuild emptied it) and
      // press its confirm, repeating only when nothing moved on the server.
      const confirmMark = async (type, box, ready, arg, what, fill) =>
        record(
          type,
          await pressUntilEffect(staff, {
            press: async () => {
              await waitForQuiet(staff);
              // The dialog's own choices, filled again if a rebuild emptied them.
              if (fill) await fill();
              await waitForQuiet(staff);
              if (!(await staff.locator(`#${box}`).isChecked())) await tickBox(staff, box);
              await waitForQuiet(staff);
              await staff
                .locator(`.modal button[type="submit"][data-case-action="${type}"]`)
                .click({ timeout: CLICK_MS });
            },
            ready,
            arg,
            what,
            safeToRepeat: await unmovedSince(classCase.id),
          }),
        );
      const toastSaid = (text) =>
        waitFor(
          staff,
          `the toast ${JSON.stringify(text)}`,
          (wanted) => (window.__vitallyAlerts ?? []).some((line) => line.startsWith("toast:") && line.includes(wanted)),
          text,
          ARRIVAL_MS,
        );

      await use("siteCoordinator");
      await openBoard(staff, OFFICE_BOARD_HEADING);

      // ---- The seeded review_approved case: its call is settled, nothing to go over
      const pendingRow = queueRow("signing", callPending.reference);
      await pendingRow.waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(
        (await pendingRow.locator(".queue-needed").innerText()).trim(),
        "Waiting for the client to sign.",
      );
      assert.equal(
        await pendingRow.locator('[data-action="open-mark-ready-to-efile"]').count(),
        1,
        "the approved sample does not offer Mark ready to e-file",
      );

      // ---- A Yes approval is not held up: the short case may be marked now --
      const shortCase = seeded.review_ready;
      const shortRow = queueRow("signing", shortCase.reference);
      await shortRow.waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(
        (await shortRow.locator(".queue-needed").innerText()).trim(),
        "Waiting for the client to sign.",
      );
      assert.equal(
        await shortRow.locator('[data-action="open-mark-ready-to-efile"]').count(),
        1,
        "a Yes approval's signing row does not offer Mark ready to e-file",
      );

      // ---- The class case waits for the office to go over the return -------
      const heldRow = queueRow("signing", classReference);
      await heldRow.waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(
        (await heldRow.locator(".queue-needed").innerText()).trim(),
        "Waiting for the office to go over the return with the client.",
      );
      assert.equal(
        await heldRow.locator('[data-action="open-mark-ready-to-efile"]').count(),
        0,
        "Mark ready to e-file was offered before the office went over the return",
      );
      // Its Call the client row opens the go-over task, whose contact form
      // starts with the purpose already chosen.
      const goOverRow = staff
        .locator('tr.queue-row[data-kind="call"]')
        .filter({ hasText: classReference })
        .first();
      await goOverRow.waitFor({ state: "visible", timeout: RENDER_MS });
      assert.match(await goOverRow.locator(".kind-pill").innerText(), /Call the client/);
      await waitForQuiet(staff);
      await goOverRow.locator('[data-action="open-log-call"]').click({ timeout: CLICK_MS });
      const goOverDrawer = staff.locator(".modal.office-drawer");
      await goOverDrawer.waitFor({ state: "visible", timeout: ARRIVAL_MS });
      const goOverForm = goOverDrawer.locator("form.contact-form[data-followup-id]").first();
      await goOverForm.waitFor({ state: "visible", timeout: RENDER_MS });
      assert.ok(
        (await goOverDrawer.innerText()).includes("Go over the return with the client"),
        "the drawer does not show the go-over task",
      );
      const goOverTaskId = await goOverForm.getAttribute("data-followup-id");
      const goOverScope = `contact-task-${goOverTaskId}`;
      assert.equal(
        await staff.locator(`[id="field-${goOverScope}-purpose-go_over_return"]`).isChecked(),
        true,
        "the go-over task's contact does not start with Go over tax return",
      );
      const GO_OVER_NOTE = "Went over the fictional return with the client.";
      record(
        "Log contact (go-over task)",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            await chooseSeg(goOverForm, goOverScope, "outcomeVoice", "reached");
            await chooseSeg(goOverForm, goOverScope, "withWhom", "client");
            await (await fieldByLabel(goOverForm, "Note", "Log contact")).fill(GO_OVER_NOTE, { timeout: CLICK_MS });
            await staff.locator(`[id="field-${goOverScope}-submit"]`).click({ timeout: CLICK_MS });
          },
          ready: (note) =>
            [...document.querySelectorAll(".modal.office-drawer .contact-task-list li")].some((entry) =>
              entry.textContent.includes(note),
            ),
          arg: GO_OVER_NOTE,
          what: "the go-over contact under the drawer's Contacts so far",
          safeToRepeat: await contactLogUnmoved(classCase.id),
        }),
      );
      assert.equal(
        (
          await one(fixture, "select purpose from public.contact_log where case_id=$1 and note=$2", [
            classCase.id,
            GO_OVER_NOTE,
          ])
        )?.purpose,
        "go_over_return",
      );
      // Logging a contact never resolves the task: the signing row still waits.
      assert.equal(
        await one(fixture, "select status from public.admin_followups where id=$1", [goOverTaskId]).then(
          (task) => task.status,
        ),
        "open",
      );
      record(
        "RESOLVE_FOLLOWUP (go-over task)",
        await submitCaseFormUntil(
          staff,
          "RESOLVE_FOLLOWUP",
          { "How it ended": "reached", "What the office concluded": "Went over the fictional return." },
          {
            ready: () => document.querySelector(".modal") === null,
            what: "the go-over drawer to close after the task is resolved",
            safeToRepeat: async () =>
              (await one(fixture, "select status from public.admin_followups where id=$1", [goOverTaskId])).status ===
              "open",
          },
        ),
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "review_approved");
      // Once the office has gone over the return, the client is told how to sign
      // (the reviewer chose the portal), not that the return will be gone over.
      assert.equal(
        (await one(fixture, "select signing_plan from public.cases where id=$1", [classCase.id])).signing_plan,
        "portal",
      );
      await waitForText(
        client,
        "Your return has been checked. Please e-sign Form 8879 in the TaxSlayer Customer Portal. Your return can't be filed until you sign.",
        ARRIVAL_MS,
      );

      // ---- 1–2. Mark ready to e-file, from the class case's signing row ---
      const signingRow = queueRow("signing", classReference);
      await waitFor(
        staff,
        "the class case's signing row to offer Mark ready to e-file",
        (wanted) =>
          [...document.querySelectorAll('tr.queue-row[data-kind="signing"]')].some(
            (row) =>
              row.querySelector("button.board-reference")?.textContent.trim() === wanted &&
              Boolean(row.querySelector('[data-action="open-mark-ready-to-efile"]')),
          ),
        classReference,
        ARRIVAL_MS,
      );
      assert.equal(
        (await signingRow.locator(".queue-needed").innerText()).trim(),
        "Waiting for the client to sign.",
      );
      const markReady = signingRow.locator('[data-action="open-mark-ready-to-efile"]');
      assert.equal((await markReady.innerText()).trim(), "Mark ready to e-file…");
      await waitForQuiet(staff);
      await markReady.click({ timeout: CLICK_MS });
      await dialogTitled("Mark ready to e-file?");
      const readyDialog = await dialogText();
      assert.ok(
        readyDialog.includes(`Mark ${classReference} for ${clientName} as ready to e-file?`),
        `the dialog does not name the client and the reference: ${readyDialog.slice(0, 200)}`,
      );
      // The case was read in place: still on the queue, nothing sent yet.
      assert.equal(await staff.locator("#office-queue-title").count(), 1, "the mark left the queue");
      assert.equal((await caseById(fixture, classCase.id)).stage, "review_approved");
      await confirmMark(
        "MARK_READY_TO_EFILE",
        "field-ready-efile-confirmed",
        (wanted) =>
          !document.querySelector(".modal") &&
          [...document.querySelectorAll('tr.queue-row[data-kind="efiling"]')].some(
            (row) => row.querySelector("button.board-reference")?.textContent.trim() === wanted,
          ),
        classReference,
        "the class case's row to move to E-filing",
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "ready_to_efile");
      assert.equal(await eventCount(fixture, classCase.id, "MARK_READY_TO_EFILE"), 1);
      await toastSaid("Marked ready to e-file. The client was told.");
      await waitFor(
        staff,
        "the keyboard on the queue's title after the confirm",
        () => document.activeElement?.id === "office-queue-title",
        undefined,
        RENDER_MS,
      );
      assert.equal(
        (await queueRow("efiling", classReference).locator(".queue-needed").innerText()).trim(),
        "Ready to e-file.",
      );
      await waitForBadge(client, "Ready");
      await waitForText(client, "Your return is ready. PCDC will take the next step.");
      await waitForHistoryLine(
        client,
        "PCDC recorded that your return is ready. PCDC will take the next step.",
      );

      // ---- 3. Mark e-filed, from the case page ---------------------------
      await openCaseByReference(staff, classReference);
      await waitForBadge(staff, "Ready to e-file");
      await revealCaseControl(staff, '[data-action="open-mark-efiled"]');
      await clickAction(staff, "open-mark-efiled");
      await dialogTitled("Mark e-filed?");
      const efiledDialog = await dialogText();
      assert.ok(
        efiledDialog.includes(`Mark ${classReference} for ${clientName} as e-filed?`),
        `the dialog does not name the client and the reference: ${efiledDialog.slice(0, 200)}`,
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "ready_to_efile");
      // A first filing offers the four combinations; PCDC e-filed both.
      assert.equal(await staff.locator('.modal input[name="filing-combination"]').count(), 4);
      await confirmMark(
        "MARK_EFILED",
        "field-efiled-confirmed",
        (wanted) =>
          !document.querySelector(".modal") &&
          [...document.querySelectorAll(".badge")].some((badge) => badge.textContent.trim() === wanted),
        "Both e-filed",
        "the case page's Both e-filed badge",
        () => staff.locator("#field-efiled-filing-combination-both_efile").check({ timeout: CLICK_MS }),
      );
      const efiled = await caseById(fixture, classCase.id);
      assert.equal(efiled.stage, "efiled");
      assert.equal(efiled.preparer_id, preparerId);
      assert.equal(efiled.reviewer_id, reviewerId);
      assert.equal(await eventCount(fixture, classCase.id, "MARK_EFILED"), 1);
      await toastSaid("Marked e-filed. The client was told.");
      assert.equal(
        await staff.locator('[data-action="open-mark-efiled"], [data-action="open-mark-ready-to-efile"]').count(),
        0,
        "an e-filed case still offers a mark",
      );

      // ---- 4. The client's page: Filing current, E-filed, two lines ------
      const steps = () =>
        client.evaluate(() =>
          [...document.querySelectorAll(".progress-steps > div")].map((step) => ({
            status: step.className,
            label: step.querySelector("small")?.textContent.trim() ?? null,
          })),
        );
      await waitForBadge(client, "E-filed");
      await waitFor(
        client,
        "the e-filed message",
        (wanted) => document.querySelector(".status-explanation")?.textContent.trim() === wanted,
        "Your federal and Pennsylvania returns were e-filed. The IRS and Pennsylvania will each confirm whether they are accepted.",
        ARRIVAL_MS,
      );
      assert.deepEqual(await steps(), [
        { status: "done", label: "Intake" },
        { status: "done", label: "Preparation" },
        { status: "done", label: "Review" },
        { status: "done", label: "Signing" },
        { status: "current", label: "Filing" },
      ]);
      await waitForHistoryLine(
        client,
        "PCDC recorded that your return is ready. PCDC will take the next step.",
      );
      await waitForHistoryLine(client, "PCDC e-filed your return.");
      await shoot(client, "progress-efiled");

      // ---- 5. Once more in 简体, then back to English --------------------
      const clientLang = (wanted) =>
        waitFor(client, `<html lang> to be ${wanted}`, (code) => document.documentElement.lang === code, wanted, ARRIVAL_MS);
      await waitForQuiet(client);
      await client.locator('[data-action="set-language"][data-value="zh-Hans"]').click({ timeout: CLICK_MS });
      await clientLang("zh-Hans");
      await waitForBadge(client, "已电子递交");
      assert.equal(sentence("PCDC e-filed your return.", "zh-Hans"), "PCDC 已电子递交您的报税表。");
      await waitForHistoryLine(client, "PCDC 已电子递交您的报税表。");
      await waitForHistoryLine(client, "PCDC 已记录您的报税表已准备好。PCDC 会进行下一步。");
      assert.equal(
        await client.evaluate(() => document.querySelector(".status-explanation")?.textContent.trim() ?? null),
        "您的联邦和宾州报税表已电子递交。国税局和宾州税务局会分别确认是否接受。",
      );
      assert.equal(
        await client.evaluate(() => document.querySelector(".progress-steps > div.current small")?.textContent.trim() ?? null),
        "递交",
      );
      await waitForQuiet(client);
      await client.locator('[data-action="set-language"][data-value="en"]').click({ timeout: CLICK_MS });
      await clientLang("en");
      await waitForBadge(client, "E-filed");
      evidence.story.signingAndFiling =
        "marked ready to e-file from Follow-ups and e-filed (both returns e-filed) from the case page, each behind its confirmation; the client saw Ready, then E-filed, in English and 简体";
      loopKit = { queueRow, dialogTitled, dialogText, confirmMark, clientLang };
    });

    await phase("a rejection is fixed, signed again and filed again until the case is complete", async () => {
      const { queueRow, dialogTitled, dialogText, confirmMark, clientLang } = loopKit;
      // ---- 6. The rejection loop: result, fix, sign again, file again -----
      // Dates are PCDC's day (US Eastern), which is also the filing day.
      const filingDay = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const REJECT_CODE = "IND-031-04";
      const FIX_NOTE = "Site coordinator to correct the dependent's date of birth in TaxSlayer";
      const badgeIs = (wanted) =>
        !document.querySelector(".modal") &&
        [...document.querySelectorAll(".badge")].some((badge) => badge.textContent.trim() === wanted);
      const poolTabShows = async (tab, reference) => {
        await clickAction(staff, "open-cases");
        await waitForText(staff, "Case pool", RENDER_MS);
        await clickAction(staff, "set-board-filter", {
          attributes: `[data-filter="poolPhase"][data-value="${tab}"]`,
        });
        await waitFor(
          staff,
          `the pool's ${tab} tab to list ${reference}`,
          ([tabName, wanted]) =>
            document.querySelector(`[data-filter="poolPhase"][data-value="${tabName}"]`)?.getAttribute("aria-pressed") ===
              "true" && [...document.querySelectorAll("tr.pool-row")].some((row) => row.textContent.includes(wanted)),
          [tab, reference],
          RENDER_MS,
        );
      };
      const clientSays = (text) =>
        waitFor(
          client,
          `the status panel reading ${JSON.stringify(text)}`,
          (wanted) => document.querySelector(".status-explanation")?.textContent.trim() === wanted,
          text,
          ARRIVAL_MS,
        );

      // Record filing result: federal accepted, state rejected. The staff
      // window is still on the case page.
      await revealCaseControl(staff, '[data-action="open-record-filing-result"]');
      await clickAction(staff, "open-record-filing-result");
      await dialogTitled("Record the filing result?");
      await confirmMark(
        "RECORD_FILING_RESULT",
        "field-filing-result-confirmed",
        badgeIs,
        "Rejected",
        "the case page's Rejected badge",
        async () => {
          await staff.locator("#field-filing-result-federal").selectOption("accepted", { timeout: CLICK_MS });
          await staff.locator("#field-filing-date-federal").fill(filingDay, { timeout: CLICK_MS });
          await staff.locator("#field-filing-result-state").selectOption("rejected", { timeout: CLICK_MS });
          await staff.locator("#field-filing-date-state").fill(filingDay, { timeout: CLICK_MS });
          await staff.locator("#field-filing-code-state").fill(REJECT_CODE, { timeout: CLICK_MS });
          await staff.locator("#field-filing-fix-note").fill(FIX_NOTE, { timeout: CLICK_MS });
        },
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "rejected");
      assert.equal(await eventCount(fixture, classCase.id, "RECORD_FILING_RESULT"), 1);
      // The Filing panel: the code, the note, who wrote it.
      const filingPanelText = async () =>
        (await staff.locator(".filing-panel").innerText()).replace(/\s+/g, " ").trim();
      const panel = await filingPanelText();
      assert.ok(panel.includes(REJECT_CODE), `the Filing panel does not show the code: ${panel}`);
      assert.ok(panel.includes(FIX_NOTE), `the Filing panel does not show the fix note: ${panel}`);

      // The pool's Needs attention tab, and Follow-ups' Rejected row with the note.
      await poolTabShows("attention", classReference);
      await openBoard(staff, OFFICE_BOARD_HEADING);
      const rejectedRow = queueRow("rejected", classReference);
      await rejectedRow.waitFor({ state: "visible", timeout: RENDER_MS });
      const rejectedText = (await rejectedRow.locator(".queue-needed").innerText()).replace(/\s+/g, " ").trim();
      assert.ok(
        rejectedText.includes("Rejected: contact the client to fix and sign again.") && rejectedText.includes(FIX_NOTE),
        `the Rejected row does not read right: ${rejectedText}`,
      );

      // The client, in 简体: the sentence, and no code.
      await waitForQuiet(client);
      await client.locator('[data-action="set-language"][data-value="zh-Hans"]').click({ timeout: CLICK_MS });
      await clientLang("zh-Hans");
      await clientSays(
        "国税局已接受您的联邦报税表。您的宾州报税表需要更正后才能被接受。PCDC 会就更正事宜联系您。",
      );
      assert.ok(
        !(await client.evaluate(() => document.body.innerText)).includes(REJECT_CODE),
        "the client page shows the reject code",
      );
      await waitForQuiet(client);
      await client.locator('[data-action="set-language"][data-value="en"]').click({ timeout: CLICK_MS });
      await clientLang("en");

      // Return to signing.
      await openCaseByReference(staff, classReference);
      await revealCaseControl(staff, '[data-action="open-return-to-signing"]');
      await clickAction(staff, "open-return-to-signing");
      await dialogTitled("Return to signing?");
      assert.ok((await dialogText()).includes("The fix is done."));
      await confirmMark(
        "RETURN_TO_SIGNING",
        "field-return-to-signing-confirmed",
        badgeIs,
        "Ready to exit",
        "the case page's Ready to exit badge",
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "review_approved");
      await poolTabShows("signing", classReference);
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await waitFor(
        staff,
        "the signing row to say the client signs again",
        (wanted) =>
          [...document.querySelectorAll('tr.queue-row[data-kind="signing"]')].some(
            (row) =>
              row.querySelector("button.board-reference")?.textContent.trim() === wanted &&
              row.querySelector(".queue-needed")?.textContent.trim() === "Waiting for the client to sign again.",
          ),
        classReference,
        ARRIVAL_MS,
      );
      await clientSays(
        "PCDC corrected your return. Please sign it again so PCDC can file it. PCDC will contact you to arrange this.",
      );
      await waitForHistoryLine(client, "PCDC corrected your return. You need to sign it again.");

      // Mark ready to e-file: the second signing.
      await waitForQuiet(staff);
      await queueRow("signing", classReference)
        .locator('[data-action="open-mark-ready-to-efile"]')
        .click({ timeout: CLICK_MS });
      await dialogTitled("Mark ready to e-file?");
      assert.ok(
        (await dialogText()).includes("This is the client's second signing"),
        "the dialog does not say this is the second signing",
      );
      await confirmMark(
        "MARK_READY_TO_EFILE",
        "field-ready-efile-confirmed",
        (wanted) =>
          !document.querySelector(".modal") &&
          [...document.querySelectorAll('tr.queue-row[data-kind="efiling"]')].some(
            (row) => row.querySelector("button.board-reference")?.textContent.trim() === wanted,
          ),
        classReference,
        "the class case's row to move to E-filing again",
      );
      assert.equal((await caseById(fixture, classCase.id)).stage, "ready_to_efile");

      // Mark e-filed again: only the PA-40 is offered; file it on paper.
      await openCaseByReference(staff, classReference);
      await revealCaseControl(staff, '[data-action="open-mark-efiled"]');
      await clickAction(staff, "open-mark-efiled");
      await dialogTitled("Mark e-filed?");
      assert.equal(await staff.locator('.modal input[name="filing-combination"]').count(), 0);
      assert.equal(await staff.locator('.modal input[name="method-federal"]').count(), 0);
      assert.equal(await staff.locator('.modal input[name="method-state"]').count(), 2);
      assert.ok(
        (await dialogText()).includes("Federal return: accepted. Nothing to file again."),
        "the dialog does not list the accepted federal return as done",
      );
      await confirmMark(
        "MARK_EFILED",
        "field-efiled-confirmed",
        badgeIs,
        "Accepted, PA on paper",
        "the case page's Accepted, PA on paper badge",
        () => staff.locator("#field-efiled-method-state-paper").check({ timeout: CLICK_MS }),
      );
      // Nothing e-filed waits, so the case goes straight to Accepted: no
      // second Record filing result.
      assert.equal((await caseById(fixture, classCase.id)).stage, "accepted");
      assert.equal(await eventCount(fixture, classCase.id, "RECORD_FILING_RESULT"), 1);
      await poolTabShows("done", classReference);

      // The client: Ready to mail, the PA handover sentence and both refund
      // sites as plain text.
      const PA_HANDOVER =
        "PCDC gave your Pennsylvania return on paper to you or the person you sent. If it isn't signed yet, sign it, then mail it yourself. A reply can take about 3 months after you mail it.";
      await waitForBadge(client, "Ready to mail");
      await waitFor(
        client,
        "the handover sentence and the refund sites in the status panel",
        (handover) => {
          const text = document.querySelector(".status-explanation")?.textContent ?? "";
          return text.includes(handover) && text.includes("irs.gov/refunds") && text.includes("mypath.pa.gov");
        },
        PA_HANDOVER,
        ARRIVAL_MS,
      );
      assert.equal(await client.locator(".status-explanation a").count(), 0, "a refund site is a link");
      await waitForHistoryLine(client, PA_HANDOVER);
      evidence.story.rejectionLoop =
        "both e-filed, federal accepted and state rejected, returned to signing, ready again, the state return given to the client on paper, Accepted, PA on paper; the client read each step";
    });

    // -----------------------------------------------------------------------
    // Regressions
    // -----------------------------------------------------------------------

    const staffB = await openWindow(staffEngine);
    const clientB = await openWindow(clientEngine);
    const draftWin = await openWindow(clientEngine);

    await phase("two simultaneous claims leave exactly one owner", async () => {
      const target = seeded.preparation_ready;
      // A second window of the Preparer's own account.
      await loginTestUser({
        page: staffB.page,
        actor: fixture.actor("preparer"),
        fixture,
        heading: WORK_BOARD_HEADING,
      });
      await watchAlerts(staffB.page);
      await use("preparer");
      await openBoard(staff, WORK_BOARD_HEADING);
      await openCaseByReference(staff, target.reference);
      await openCaseByReference(staffB.page, target.reference);
      const before = await caseById(fixture, target.id);
      assert.equal(before.stage, "preparation_ready");
      assert.equal(before.preparer_id, null);
      const windows = [staff, staffB.page];
      // Read from each window's own recorder rather than from the screen: a
      // refusal is not necessarily still there to be read, because
      // `handleChange` clears the error on its next successful re-read and the
      // winner's change is what arrives next (see the report's findings).
      const mark = await Promise.all(
        windows.map(async (page) => ((await readAlerts(page)) ?? []).length),
      );
      // Both presses are dispatched on the controls themselves, with no
      // actionability wait in between: the winner's own change removes the
      // loser's button within a few tens of milliseconds, and waiting for a
      // control to settle would make this a sequence rather than a race. Each
      // one is a real click event through the real handler, and each reports
      // whether it found a live button to press.
      for (const page of windows) await waitForQuiet(page);
      const fired = await Promise.all(
        windows.map((page) =>
          page.evaluate(() => {
            const button = document.querySelector('[data-case-action="CLAIM_PREPARATION"]');
            if (!button || button.disabled) return false;
            button.click();
            return true;
          }),
        ),
      );
      assert.deepEqual(
        fired,
        [true, true],
        "both windows must press their own claim for this to be a race",
      );
      await waitForDetail(staff, "Preparer", ROLE_NAMES.preparer);
      await waitForDetail(staffB.page, "Preparer", ROLE_NAMES.preparer);
      const said = await Promise.all(
        windows.map(async (page, index) =>
          ((await readAlerts(page)) ?? []).slice(mark[index]),
        ),
      );
      const refused = said.filter((lines) => lines.some((line) => REFUSAL_NOTICE.test(line)));
      const counts = {
        events: await eventCount(fixture, target.id, "CLAIM_PREPARATION"),
        receipts: await receiptCount(fixture, target.id, "CLAIM_PREPARATION"),
        participants: await participantCount(fixture, target.id),
      };
      assert.deepEqual(counts, { events: 1, receipts: 1, participants: 1 });
      assert.equal(
        refused.length,
        1,
        `exactly one window should have been refused; the two were told ${JSON.stringify(said)}`,
      );
      const stillShowing = await Promise.all(windows.map((page) => alertText(page)));
      evidence.regressions.simultaneousClaims = {
        ...counts,
        loserSaw: refused[0].find((line) => REFUSAL_NOTICE.test(line)).slice(0, 140),
        refusalStillOnScreen: stillShowing.filter(Boolean).length === 1,
      };
      assertConsoleQuiet(staffB, {
        name: "second staff window",
        allow: REFUSAL_LINES,
      });
      await staffB.context.close();
    });

    await phase("applicant B sees nothing of applicant A's case", async () => {
      await loginTestUser({ page: clientB.page, actor: applicantB, fixture });
      await waitForText(clientB.page, "No applications yet", RENDER_MS);
      await clientB.page
        .getByLabel("Application ID", { exact: true })
        .fill(classReference);
      await waitForQuiet(clientB.page);
      await clientB.page
        .getByRole("button", { name: "Find", exact: true })
        .click({ timeout: CLICK_MS });
      await waitForText(clientB.page, "We could not find that Application ID");
      assert.equal(
        await clientB.page.locator(".application-row").count(),
        0,
        "a stranger's application was listed",
      );

      // R62: the two denials no screen can express, through applicant B's own
      // authenticated client.
      const byId = await fixture.database.applicantB
        .from("cases")
        .select("id")
        .eq("id", classCase.id);
      const byReference = await fixture.database.applicantB
        .from("cases")
        .select("id")
        .eq("reference", classReference);
      assert.equal(byId.error, null);
      assert.equal(byReference.error, null);
      assert.deepEqual(byId.data, []);
      assert.deepEqual(byReference.data, []);
      const forged = await fixture.database.applicantB.rpc(
        "vitally_apply_action",
        applyArgs({
          caseId: classCase.id,
          revision: 1,
          type: "CLAIM_PREPARATION",
          personId: preparerId,
        }),
      );
      assert.ok(forged.error, "another applicant acted on a case that is not theirs");
      const otherCode = domainCode(forged.error);
      assert.ok(
        ["FORBIDDEN", "NOT_FOUND"].includes(otherCode),
        `unexpected refusal for another applicant's case: ${otherCode}`,
      );
      evidence.regressions.otherIdentity = {
        lookup: "not found, and nothing about the case is revealed",
        byId: "0 rows",
        byReference: "0 rows",
        action: otherCode,
      };
    });

    await phase("an applicant cannot forge a staff action on their own case", async () => {
      const actionId = randomUUID();
      const current = await caseById(fixture, classCase.id);
      const forged = await fixture.database.applicantA.rpc(
        "vitally_apply_action",
        applyArgs({
          actionId,
          caseId: classCase.id,
          revision: Number(current.revision),
          personId: siteCoordinatorId,
          type: "VERIFY_INTAKE",
          payload: {
            // The class case is not an online one, so the three checks.
            checks: { phone: true, documents: true, in_scope: true },
          },
        }),
      );
      assert.ok(forged.error, "an applicant performed a staff action");
      assert.equal(domainCode(forged.error), "FORBIDDEN");
      assert.equal(await receiptsForActionId(fixture, actionId), 0);
      const after = await caseById(fixture, classCase.id);
      assert.equal(after.revision, current.revision);
      evidence.regressions.roleForgery = "FORBIDDEN, with no receipt and no revision moved";
    });

    await phase(
      "an offline action reports no success and its retry is the same action",
      async () => {
        const reference = await startApplication(clientB.page);
        const own = await caseByReference(fixture, reference);
        await clickAction(clientB.page, "continue-intake");
        await waitForSubstep(clientB.page, "before.ready");
        await clickAction(clientB.page, "fill-fictional");
        // The recorded first save, then a visits save, both online. The
        // Form 14446 consent opens the steps after "Before you start".
        await clickContinue(clientB.page);
        await waitForSubstep(clientB.page, "before.service");
        await consent14446(clientB.page);
        await railJump(clientB.page, "about.address");
        await waitForQuiet(clientB.page);
        const savedOnce = await caseById(fixture, own.id);
        const receiptsBefore = await receiptCount(fixture, own.id, "SAVE_ANSWERS");
        const city = clientB.page.locator("#field-client-addr_city");

        // Offline, and refused at the door. `setOffline` alone is enough in
        // Chrome — the request fails at once — but Firefox leaves it pending
        // indefinitely instead, and a save that never answers is a different
        // test from a save that fails. Aborting the API origin makes the
        // disconnect mean the same thing in both engines; `setOffline` still
        // does the rest of the work (`navigator.onLine`, the dropped socket,
        // and the `online` event that drives the recovery below).
        const apiTraffic = `${fixture.authOrigin}/**`;
        const refuse = (route) => route.abort();
        await clientB.context.route(apiTraffic, refuse);
        await clientB.context.setOffline(true);
        await city.fill(OFFLINE_CITY);
        await clickContinue(clientB.page);
        await waitForText(clientB.page, "No connection to the server.");
        await waitForText(clientB.page, "Not saved.");
        const offlineRow = await caseById(fixture, own.id);
        assert.equal(
          Number(offlineRow.revision),
          Number(savedOnce.revision),
          "an offline action reached the server",
        );
        assert.notEqual(offlineRow.answers.addr_city, OFFLINE_CITY);
        assert.equal(
          await receiptCount(fixture, own.id, "SAVE_ANSWERS"),
          receiptsBefore,
        );

        await clientB.context.unroute(apiTraffic, refuse);
        await clientB.context.setOffline(false);
        await clickAction(clientB.page, "retry-action");
        await waitForText(clientB.page, "Saved");
        await waitForTextGone(clientB.page, "No connection to the server.");
        const retried = await caseById(fixture, own.id);
        assert.equal(retried.answers.addr_city, OFFLINE_CITY);
        assert.equal(
          Number(retried.revision),
          Number(savedOnce.revision) + 1,
          "the retry was a second action, not the same one",
        );
        assert.equal(
          await receiptCount(fixture, own.id, "SAVE_ANSWERS"),
          receiptsBefore + 1,
        );
        evidence.regressions.offlineRetry = {
          offline: "the connection notice appeared and nothing was saved",
          retry: "one further receipt and one further revision",
        };
      },
    );

    await phase("a draft edited in two windows offers a choice, and keeps it", async () => {
      await clickAction(client, "open-applications");
      const reference = await startApplication(client);
      const draftCase = await caseByReference(fixture, reference);
      await clickAction(client, "continue-intake");
      await waitForSubstep(client, "before.ready");
      await clickAction(client, "fill-fictional");
      await clickContinue(client);
      await waitForSubstep(client, "before.service");
      await consent14446(client);
      await railJump(client, "about.address");
      await waitForQuiet(client);
      await client.locator("#field-client-addr_city").fill(MINE_CITY);

      // Another window of the same account — the one thing that can change a
      // client's own draft, because the office is refused it by design.
      await loginTestUser({ page: draftWin.page, actor: applicantA, fixture });
      await waitForQuiet(draftWin.page);
      await draftWin.page
        .locator(`.application-row:has-text("${reference}")`)
        .first()
        .click({ timeout: CLICK_MS });
      await waitForIntakeV2(draftWin.page);
      await railJump(draftWin.page, "about.address");
      await waitForQuiet(draftWin.page);
      await draftWin.page.locator("#field-client-addr_city").fill(OTHER_CITY);
      await draftWin.page.locator('#intake-v2-form button[type="submit"]').click({ timeout: CLICK_MS });
      await waitForSubstep(draftWin.page, "about.marital");

      await waitForText(client, "Someone else changed this application");
      // The conflict lists the city by its own wording, with both values.
      const rows = await client.evaluate(() =>
        [...document.querySelectorAll(".conflict-panel tbody tr")].map((row) => [
          row.querySelector("th")?.textContent.trim() ?? null,
          ...[...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()),
        ]),
      );
      assert.deepEqual(
        rows.find((row) => row[0] === "City"),
        ["City", MINE_CITY, OTHER_CITY],
        `the conflict did not offer both cities: ${JSON.stringify(rows)}`,
      );
      await clickAction(client, "reconcile-mine");
      await waitForTextGone(client, "Someone else changed this application");
      assert.equal(await client.locator("#field-client-addr_city").inputValue(), MINE_CITY);
      await clickContinue(client);
      await waitForSubstep(client, "about.marital");
      const saved = await caseById(fixture, draftCase.id);
      assert.equal(saved.answers.addr_city, MINE_CITY);
      evidence.regressions.conflict = "REMOTE_CHANGED offered both answers; the chosen one saved";
      assertConsoleQuiet(draftWin, {
        name: "second applicant-A window",
        allow: REFUSAL_LINES,
      });
      await draftWin.context.close();
    });

    await phase("a draft saved with Save & exit comes back after signing in again", async () => {
      await clickAction(client, "open-applications");
      const reference = await startApplication(client);
      const own = await caseByReference(fixture, reference);
      await clickAction(client, "continue-intake");
      await waitForSubstep(client, "before.ready");
      await clickAction(client, "fill-fictional");
      await clickContinue(client);
      await waitForSubstep(client, "before.service");
      await consent14446(client);
      await railJump(client, "about.address");

      // Save and exit, sign out, come back as the same applicant, and open
      // the same application again from the list.
      await waitForQuiet(client);
      await client.locator("#field-client-addr_city").fill(RETURN_CITY);
      await clickAction(client, "save-exit");
      await waitForText(client, "My applications", RENDER_MS);
      assert.equal(
        (await caseById(fixture, own.id)).answers.addr_city,
        RETURN_CITY,
        "save and exit saved nothing",
      );
      await clickAction(client, "sign-out");
      await waitForText(client, "Sign in with your email", RENDER_MS);
      // A fresh document, because the auth module's resend cooldown lives in
      // the one it signed out of (Task 5A, note 3).
      await client.goto(fixture.appOrigin);
      await loginTestUser({ page: client, actor: applicantA, fixture });
      await watchAlerts(client);
      await waitForQuiet(client);
      await client
        .locator(`.application-row:has-text("${reference}")`)
        .first()
        .click({ timeout: CLICK_MS });
      await waitForIntakeV2(client);
      await railJump(client, "about.address");
      assert.equal(
        await client.locator("#field-client-addr_city").inputValue(),
        RETURN_CITY,
        "the answers saved before signing out did not come back",
      );
      evidence.regressions.saveAndReturn =
        "saved, signed out, signed back in, reopened from the list with the same answers";
      // Left on the sub-step the second seed run's phase reads a field from.
    });

    await phase("a dialog takes the keyboard and gives it back", async () => {
      // Run while the client window is quiet: a dialog is about the keyboard,
      // and a page that is rebuilding itself is a different question (see the
      // second seed run's phase below, which measures exactly that).
      const where = () =>
        client.evaluate(() => ({
          inModal: Boolean(document.activeElement?.closest(".modal")),
          element: document.activeElement?.tagName ?? null,
          action: document.activeElement?.dataset?.action ?? null,
        }));
      const openWithKeyboard = async (action) => {
        const control = client.locator(`[data-action="${action}"]`).first();
        // Wait for stillness first: a rebuild replaces the control, and the
        // keyboard does not follow it (see the finding on `describeFocus`).
        await waitForQuiet(client);
        await control.focus();
        await waitFor(
          client,
          `the ${action} control to hold the keyboard`,
          (wanted) => document.activeElement?.dataset?.action === wanted,
          action,
          RENDER_MS,
        );
        const presses = await pressUntil(
          client,
          control,
          "Enter",
          () => Boolean(document.querySelector(".modal")),
          `the ${action} dialog`,
        );
        // The dialog moves the keyboard on the next animation frame, so this
        // waits for it rather than sampling — and reports rather than throws,
        // because whether it ever arrives is the measurement.
        const landed = await client
          .waitForFunction(
            () => Boolean(document.activeElement?.closest(".modal")),
            undefined,
            { timeout: 2_000, polling: 100 },
          )
          .then(() => true)
          .catch(() => false);
        return { presses, landed, focus: await where() };
      };
      const closeWithEscape = async (action) => {
        // Quiet again before the key: the focus this hands back is dropped by
        // any rebuild that arrives with it, which is the same finding as above
        // and not what this check is about.
        await waitForQuiet(client);
        await client.keyboard.press("Escape");
        await waitFor(
          client,
          `the ${action} dialog to close`,
          () => document.querySelector(".modal") === null,
          undefined,
          RENDER_MS,
        );
        await waitFor(
          client,
          `the ${action} dialog to give the keyboard back`,
          (wanted) => document.activeElement?.dataset?.action === wanted,
          action,
          RENDER_MS,
        );
      };

      // A dialog whose body carries controls: it takes the keyboard, keeps it
      // while Tab moves around inside, and hands it back on Escape.
      const regenerate = await openWithKeyboard("regenerate-fictional");
      assert.equal(
        regenerate.landed,
        true,
        `the dialog opened without taking the keyboard: ${JSON.stringify(regenerate.focus)}`,
      );
      // The page behind is inert; the dialog and the live regions are not, and
      // the toast (outside #app) never is (screen-states).
      const inertWhileOpen = await client.evaluate(() => ({
        stray: [...document.querySelector("#app").children]
          .filter(
            (child) =>
              !child.inert &&
              !["modal-backdrop", "connection-notice", "problem-banner"].some((name) =>
                child.classList.contains(name),
              ),
          )
          .map((child) => child.className || child.tagName),
        modalInert: Boolean(document.querySelector(".modal")?.closest("[inert]")),
        toastInert: Boolean(document.querySelector("#toast")?.closest("[inert]")),
      }));
      assert.deepEqual(inertWhileOpen.stray, [], "something behind the dialog can still be reached");
      assert.equal(inertWhileOpen.modalInert, false, "the dialog itself is inert");
      assert.equal(inertWhileOpen.toastInert, false, "the toast is inside something inert");
      // From the dialog itself (a click on its text), Shift+Tab stays inside.
      await client.evaluate(() => document.querySelector(".modal").focus());
      await client.keyboard.press("Shift+Tab");
      const fromContainer = await where();
      assert.equal(fromContainer.inModal, true, "Shift+Tab from the dialog itself left the dialog");
      await client.keyboard.press("Tab");
      const firstTab = await where();
      await client.keyboard.press("Tab");
      const secondTab = await where();
      assert.equal(firstTab.inModal, true, "Tab left the dialog");
      assert.equal(secondTab.inModal, true, "Tab left the dialog on the way round");
      await closeWithEscape("regenerate-fictional");
      const inertAfterClose = await client.evaluate(
        () => [...document.querySelector("#app").children].filter((child) => child.inert).length,
      );
      assert.equal(inertAfterClose, 0, "something stayed inert after the dialog closed");

      // A dialog whose body is only prose — the help dialog's one focusable
      // control is its own close button. It still has to take the keyboard
      // (Ruling R65), and Tab still has to stay inside it.
      const helpDialog = await openWithKeyboard("open-help");
      assert.equal(
        helpDialog.landed,
        true,
        `the help dialog opened without taking the keyboard: ${JSON.stringify(helpDialog.focus)}`,
      );
      assert.ok(
        CONTROLS.includes(helpDialog.focus.element),
        `the help dialog put the keyboard on ${helpDialog.focus.element} rather than on a control`,
      );
      await client.keyboard.press("Tab");
      const helpAfterTab = await where();
      assert.equal(helpAfterTab.inModal, true, "Tab left the help dialog");
      await closeWithEscape("open-help");

      evidence.regressions.dialogFocus = {
        result: "Escape closed both dialogs and the focus returned to the control that opened each",
        regenerate: {
          ...regenerate.focus,
          landed: regenerate.landed,
          presses: regenerate.presses,
        },
        afterTabInside: [firstTab.inModal, secondTab.inModal],
        inert: { whileOpen: inertWhileOpen, afterClose: inertAfterClose, shiftTabFromContainer: fromContainer },
        help: { ...helpDialog.focus, landed: helpDialog.landed, presses: helpDialog.presses },
        helpAfterTab,
      };
    });

    await phase("the sidebar peeks under a resting mouse and pins on a click", async () => {
      // The staff window, while it is quiet (spec 2026-10-04 §8). Above 800px
      // a pinned sidebar pushes the page, which step 6 measures; a screenshot
      // phase leaves the window at DESKTOP, but say so rather than assume it.
      const size = staff.viewportSize();
      if (size?.width !== DESKTOP.width || size?.height !== DESKTOP.height)
        await staff.setViewportSize(DESKTOP);
      const toggle = staff.locator(".sidebar-toggle");
      const sidebar = staff.locator("#app-sidebar");
      const sidebarState = (page) =>
        page.evaluate(() => {
          const shell = document.querySelector(".app-shell");
          const button = document.querySelector(".sidebar-toggle");
          return {
            peek: shell?.classList.contains("sidebar-peek") ?? null,
            hidden: document.querySelector("#app-sidebar")?.hidden ?? null,
            expanded: button?.getAttribute("aria-expanded") ?? null,
            label: button?.getAttribute("aria-label") ?? null,
            mainLeft: document.querySelector(".app-main")?.getBoundingClientRect().left ?? null,
          };
        });
      // In the page: does the sidebar read as `wanted` (any of its keys)?
      const SIDEBAR_IS = (wanted) => {
        const shell = document.querySelector(".app-shell");
        const button = document.querySelector(".sidebar-toggle");
        const now = {
          peek: shell?.classList.contains("sidebar-peek") ?? null,
          hidden: document.querySelector("#app-sidebar")?.hidden ?? null,
          expanded: button?.getAttribute("aria-expanded") ?? null,
          label: button?.getAttribute("aria-label") ?? null,
          onToggle: Boolean(document.activeElement?.matches(".sidebar-toggle")),
        };
        return Object.entries(wanted).every(([key, value]) => now[key] === value);
      };
      const waitSidebar = async (page, what, predicate, arg) => {
        try {
          await waitFor(page, what, predicate, arg, RENDER_MS);
        } catch (error) {
          error.message += ` The sidebar read: ${JSON.stringify(await sidebarState(page))}`;
          throw error;
        }
      };
      const PINNED = { peek: false, hidden: false, expanded: "true", label: "Hide the sidebar" };
      const COLLAPSED = { peek: false, hidden: true, expanded: "false", label: "Show the sidebar" };
      const PEEKING = { peek: true, hidden: false, expanded: "true", label: "Pin the sidebar open" };
      const centreOf = async (locator, what) => {
        const box = await locator.boundingBox();
        assert.ok(box, `${what} has no box to point at`);
        return [box.x + box.width / 2, box.y + box.height / 2];
      };
      const mouseOnToggle = async () => staff.mouse.move(...(await centreOf(toggle, "the toggle")));
      const mouseToPageCentre = async () => {
        const { width, height } = staff.viewportSize();
        await staff.mouse.move(width / 2, height / 2);
      };
      const peekWithMouse = async (when) => {
        await mouseOnToggle();
        await waitSidebar(staff, `the sidebar to peek ${when}`, SIDEBAR_IS, PEEKING);
      };
      const keyboardOnToggle = (what) =>
        waitSidebar(staff, what, SIDEBAR_IS, { onToggle: true });

      await waitForQuiet(staff);
      await mouseToPageCentre();
      const found = await sidebarState(staff);
      assert.equal(
        await staff.evaluate(SIDEBAR_IS, PINNED),
        true,
        `the phase expects the sidebar pinned open, as the story leaves it: ${JSON.stringify(found)}`,
      );
      const pinnedLeft = found.mainLeft;

      // 1. Collapse with no re-peek: the mouse is still on the toggle.
      await toggle.click({ timeout: CLICK_MS });
      await waitSidebar(staff, "the click to collapse the sidebar", SIDEBAR_IS, COLLAPSED);
      const collapsedLeft = (await sidebarState(staff)).mainLeft;
      // Testing that nothing happens: two close delays with the mouse resting.
      await staff.waitForTimeout(600);
      const afterCollapse = await sidebarState(staff);
      assert.equal(afterCollapse.peek, false, "the sidebar peeked again under the click that collapsed it");
      assert.equal(afterCollapse.hidden, true, "the collapsed sidebar is showing");

      // 2. Peek: off the toggle and back on, over the page without pushing it.
      await mouseToPageCentre();
      await peekWithMouse("under the resting mouse");
      const peeking = await sidebarState(staff);
      assert.equal(peeking.mainLeft, collapsedLeft, "the peek pushed the page");

      // 3. Stay: the mouse in the sidebar keeps it open.
      await staff.mouse.move(...(await centreOf(sidebar, "the peeked sidebar")));
      // Testing that nothing happens: two close delays with the mouse in the sidebar.
      await staff.waitForTimeout(600);
      assert.equal((await sidebarState(staff)).peek, true, "the peek closed with the mouse in the sidebar");

      // 4. The peek survives a realtime redraw. A no-change bump on the case
      // this window has open (also on its board), from outside the window.
      // Delegated listeners on root never see events from the removed nodes,
      // so the peek's pointer zone stays "sidebar".
      const bumped = seeded.preparation_ready;
      assert.ok(bumped, "the seeded preparation_ready case is missing");
      await waitForQuiet(staff);
      await staff.evaluate(() => document.querySelector("#main")?.setAttribute("data-peek-marker", "1"));
      await fixture.database.sql("update public.cases set revision = revision + 1 where id=$1", [bumped.id]);
      await waitFor(
        staff,
        "the realtime change to rebuild the page",
        () => Boolean(document.querySelector("#main")) && !document.querySelector("#main[data-peek-marker]"),
      );
      // Testing that nothing happens: two close delays after the redraw, so a
      // peek that the redraw broke has had its chance to close.
      await staff.waitForTimeout(600);
      const redrawn = await sidebarState(staff);
      assert.equal(redrawn.peek, true, "the realtime redraw closed the peek");
      assert.equal(redrawn.hidden, false, "the realtime redraw hid the peeked sidebar");

      // 5. Close after leaving: 300 ms after the mouse leaves both.
      await mouseToPageCentre();
      await waitSidebar(staff, "the peek to close after the mouse left", SIDEBAR_IS, COLLAPSED);

      // 6. Pin: a click during a peek pins it, and the page is pushed.
      await peekWithMouse("again");
      await toggle.click({ timeout: CLICK_MS });
      await waitSidebar(staff, "the click during the peek to pin the sidebar", SIDEBAR_IS, PINNED);
      const pinned = await sidebarState(staff);
      assert.ok(
        pinned.mainLeft > collapsedLeft,
        `the pinned sidebar did not push the page (${pinned.mainLeft} against ${collapsedLeft})`,
      );

      // 7. Keyboard: focus doesn't peek, Enter pins, Tab keeps, Escape closes.
      await toggle.click({ timeout: CLICK_MS });
      await waitSidebar(staff, "the click to collapse the sidebar again", SIDEBAR_IS, COLLAPSED);
      await mouseToPageCentre();
      await toggle.focus();
      await keyboardOnToggle("the toggle to hold the keyboard");
      // Testing that nothing happens: two close delays with the keyboard on the toggle.
      await staff.waitForTimeout(600);
      assert.equal((await sidebarState(staff)).peek, false, "focusing the toggle opened a peek");
      await staff.keyboard.press("Enter");
      await waitSidebar(staff, "Enter on the toggle to pin the sidebar", SIDEBAR_IS, PINNED);
      await keyboardOnToggle("the keyboard to stay on the toggle after Enter");
      await staff.keyboard.press("Enter");
      await waitSidebar(staff, "Enter on the toggle to collapse the sidebar", SIDEBAR_IS, COLLAPSED);
      await keyboardOnToggle("the keyboard to stay on the toggle after the second Enter");
      await peekWithMouse("with the keyboard on the toggle");
      const inSidebar = () =>
        staff.evaluate(() => Boolean(document.activeElement?.closest("#app-sidebar")));
      let tabs = 0;
      while (tabs < 3 && !(await inSidebar())) {
        await staff.keyboard.press("Tab");
        tabs += 1;
      }
      assert.equal(await inSidebar(), true, `${tabs} presses of Tab did not reach the peeked sidebar`);
      await mouseToPageCentre();
      // Testing that nothing happens: two close delays with the keyboard in the sidebar.
      await staff.waitForTimeout(600);
      assert.equal((await sidebarState(staff)).peek, true, "the peek closed with the keyboard in the sidebar");
      await staff.keyboard.press("Escape");
      await waitSidebar(staff, "Escape to close the peek", SIDEBAR_IS, { ...COLLAPSED, onToggle: true });

      // 7a. A dialog opened from a peek holds it, and the keyboard never ends
      // on a hidden control.
      await peekWithMouse("before Need help?");
      await staff.locator('#app-sidebar [data-action="open-help"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the help dialog to open from the peek",
        () => Boolean(document.querySelector(".modal")),
        undefined,
        RENDER_MS,
      );
      await mouseToPageCentre();
      // Testing that nothing happens: two close delays with the dialog open.
      await staff.waitForTimeout(600);
      assert.equal((await sidebarState(staff)).peek, true, "the peek closed behind the dialog");
      await staff.keyboard.press("Escape");
      await waitFor(
        staff,
        "the dialog to close and give the keyboard back to Need help? in the visible sidebar",
        () =>
          document.querySelector(".modal") === null &&
          document.activeElement?.dataset?.action === "open-help" &&
          document.querySelector("#app-sidebar")?.hidden === false,
        undefined,
        RENDER_MS,
      );
      // The focus handed back after a key press may count as keyboard focus
      // and hold the peek, which this Escape then closes; if it doesn't, the
      // peek is already closing on its own. Either way it ends on the toggle.
      const beforeSecondEscape = await sidebarState(staff);
      await staff.keyboard.press("Escape");
      await waitSidebar(
        staff,
        "the peek to close after the dialog, with the keyboard on the toggle",
        SIDEBAR_IS,
        { ...COLLAPSED, onToggle: true },
      );

      // 8. Touch: no peek; a click after a touch hover pins.
      await toggle.dispatchEvent("pointerover", { pointerType: "touch", bubbles: true });
      // Testing that nothing happens: two close delays after a touch hover.
      await staff.waitForTimeout(600);
      assert.equal((await sidebarState(staff)).peek, false, "a touch hover opened a peek");
      await toggle.click({ timeout: CLICK_MS });
      await waitSidebar(staff, "the click after a touch hover to pin the sidebar", SIDEBAR_IS, PINNED);
      // Left pinned open, as the phase found it.
      await mouseToPageCentre();

      evidence.regressions.sidebarPeek = {
        result:
          "collapse with no re-peek, peek without pushing, stay, a realtime redraw kept it, close after leaving, pin, keyboard, a dialog held it, touch",
        mainLeft: { pinnedBefore: pinnedLeft, collapsed: collapsedLeft, peeking: peeking.mainLeft, pinned: pinned.mainLeft },
        tabsIntoSidebar: tabs,
        peekHeldByReturnedFocus: beforeSecondEscape.peek,
      };
    });

    await phase("the office takes in a walk-in client's application and its document", async () => {
      await use("siteCoordinator");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await clickAction(staff, "open-add-case");
      await staff.locator("#add-case-v2-form").waitFor({ state: "visible", timeout: RENDER_MS });
      const meta = () =>
        staff.evaluate(() => document.querySelector(".add-case-v2 .application-meta span")?.textContent.trim() ?? null);
      const box = (id) => staff.locator(`#field-office-${id}`);
      const text = (selector) =>
        staff.evaluate((wanted) => document.querySelector(wanted)?.textContent.trim() ?? null, selector);
      const toggle = (id) => staff.locator(`#add-sub-${id.replace(/\./g, "-")}-toggle`);
      const openPart = async (id) => {
        if ((await toggle(id).getAttribute("aria-expanded")) === "true") return;
        await waitForQuiet(staff);
        await toggle(id).click({ timeout: CLICK_MS });
        await waitFor(
          staff,
          `the ${id} part to open`,
          (selector) => document.querySelector(selector)?.getAttribute("aria-expanded") === "true",
          `#add-sub-${id.replace(/\./g, "-")}-toggle`,
          RENDER_MS,
        );
      };
      assert.equal(await meta(), "Application ID: assigned when you save");

      // Nothing to record or mark on before there is a case.
      assert.equal(await text(".add-case-side .materials-card .staff-reason"), "Save the draft first to record materials.");
      assert.equal(
        await staff.evaluate(() =>
          [...document.querySelectorAll('.add-case-side .materials-card input[type="checkbox"]')].every((input) => input.disabled),
        ),
        true,
        "a materials box was enabled before the first save",
      );
      await openPart("documents");
      const marksBefore = await staff.evaluate(() => ({
        note: document.querySelector("#add-sub-documents-body > .field-note")?.textContent.trim() ?? null,
        marks: [...document.querySelectorAll('#add-sub-documents-body [data-action="mark-card"]')].map((mark) => mark.disabled),
      }));
      assert.equal(marksBefore.note, "Save the draft first to mark documents.");
      assert.ok(marksBefore.marks.length > 0, "the Documents part shows no marks to hold");
      assert.ok(marksBefore.marks.every(Boolean), "a document mark was enabled before the first save");
      await waitForQuiet(staff);
      await toggle("documents").click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the Documents part to close",
        () => document.querySelector("#add-sub-documents-toggle")?.getAttribute("aria-expanded") === "false",
        undefined,
        RENDER_MS,
      );

      await clickAction(staff, "fill-assisted-intake");
      // The fill never consents or signs Form 14446 (add-form-14446-consent):
      // 0.4 and 1.5 are the two parts it leaves, and Add a case is never
      // locked. The office ticks and signs them with the client.
      await waitFor(
        staff,
        "the fill to leave only the Form 14446 parts",
        () =>
          document.querySelector("#add-case-count")?.textContent.trim() === "2 parts still need answers" &&
          document.querySelector("#add-sub-before-virtual-status")?.textContent.trim() === "Needs answers" &&
          document.querySelector("#add-sub-about-sign-status")?.textContent.trim() === "Needs answers",
        undefined,
        RENDER_MS,
      );
      assert.equal(await staff.locator("#add-case-v2-form .is-locked").count(), 0, "Add a case shows a locked part");
      await openPart("about.you");
      const firstName = await box("tp_first_name").inputValue();
      assert.ok(firstName, "Fill fictional details left the first name blank");
      const officeSignature = `${firstName} ${await box("tp_last_name").inputValue()}`;
      await openPart("before.virtual");
      await tickBox(staff, "field-office-vc_agree-yes");
      await openPart("about.sign");
      await chooseAnswer(staff, "vc_review", "yes", "office");
      await waitForQuiet(staff);
      await box("vc_tp_signature").fill(officeSignature);
      await staff.keyboard.press("Tab");
      await waitFor(
        staff,
        "every part to be answered",
        () => document.querySelector("#add-case-count")?.textContent.trim() === "Every part is answered",
        undefined,
        RENDER_MS,
      );
      await waitForQuiet(staff);
      await shootWithoutSidebar(staff, "add-case-v2");

      // The leave check: every way off the page asks first, and Keep
      // editing keeps every answer. No case exists yet.
      const casesBefore = await workspaceCaseCount(fixture);
      const leaveThenKeep = async (selector, what) => {
        await waitForQuiet(staff);
        await staff.locator(selector).click({ timeout: CLICK_MS });
        await waitFor(
          staff,
          `the leave check after ${what}`,
          () => (document.querySelector(".modal")?.textContent ?? "").includes("Leave without saving?"),
          undefined,
          RENDER_MS,
        );
        await waitForQuiet(staff);
        await staff.locator(".modal").getByRole("button", { name: "Keep editing", exact: true }).click({ timeout: CLICK_MS });
        await waitFor(staff, "the leave check to close", () => document.querySelector(".modal") === null, undefined, RENDER_MS);
        assert.equal(await staff.locator("#add-case-v2-form").count(), 1, `${what} left Add a case`);
        assert.equal(await box("tp_first_name").inputValue(), firstName, `Keep editing after ${what} lost an answer`);
      };
      await leaveThenKeep("#add-case-cancel", "Cancel");
      await leaveThenKeep('#app-sidebar [data-action="open-cases"]', "All cases");
      assert.equal(await workspaceCaseCount(fixture), casesBefore, "the leave check created a case");

      // Save draft: the first save creates the case. A repeat is safe as
      // long as at most one case appeared, because the draft adopts it.
      record(
        "SAVE_OFFICE_DRAFT",
        await pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            await staff.locator('[data-action="save-office-draft"]').click({ timeout: CLICK_MS });
          },
          ready: () => {
            const said = document.querySelector(".add-case-v2 .application-meta span")?.textContent.trim() ?? "";
            return said.startsWith("Application ID: ") && !said.endsWith("assigned when you save");
          },
          what: "the saved draft's Application ID",
          safeToRepeat: async () => (await workspaceCaseCount(fixture)) <= casesBefore + 1,
        }),
      );
      const assistedReference = (await meta()).replace("Application ID: ", "");
      assert.match(assistedReference, REFERENCE_PATTERN);
      assert.equal(await workspaceCaseCount(fixture), casesBefore + 1, "Save draft made more than one case");
      // The landed save's toast sits above Add a case's bar while that bar is
      // sticky and on screen, never over it. The toast is raised only when the
      // save lands and lasts 5 s, and nothing here presses anything between
      // the save and this wait (the guard runs only before an action), so it
      // is still showing. A toast that never shows fails the wait (it throws).
      const savedToast = await waitFor(
        staff,
        "the saved draft's toast",
        () => document.querySelector("#toast.visible")?.textContent.trim() === "The draft is saved. Nobody was emailed.",
        undefined,
        RENDER_MS,
      ).then(() => true);
      assert.equal(await staff.locator(".add-case-bar").count(), 1, "Add a case has no bar to keep clear");
      assert.ok(
        await staff.evaluate(() => {
          const r = document.querySelector(".add-case-bar").getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        }),
        "Add a case's sticky bar is off screen when the toast shows",
      );
      const clear = await staff.evaluate(() => {
        const toast = document.querySelector("#toast.visible").getBoundingClientRect();
        const bar = document.querySelector(".add-case-bar").getBoundingClientRect();
        // Above the bar, or (a bar not stuck to the bottom) nowhere over it.
        return (
          toast.bottom <= bar.top + 1 ||
          toast.top >= bar.bottom - 1 ||
          toast.right <= bar.left + 1 ||
          toast.left >= bar.right - 1
        );
      });
      assert.ok(clear, "the toast covers Add a case's bar");
      evidence.story.addCaseToast = savedToast ? "shown above the bar" : "not seen after the save";
      const assisted = await one(
        fixture,
        "select id,owner_user_id,intake_version,stage,answers,intake_visited from public.cases where workspace_id=$1 and reference=$2",
        [fixture.database.workspaceId, assistedReference],
      );
      assert.ok(assisted, "the saved draft's reference names no case");
      assert.equal(assisted.owner_user_id, null, "an assisted case has a client account");
      assert.equal(Number(assisted.intake_version), 2);
      assert.equal(assisted.stage, "draft");
      assert.equal(assisted.answers.tp_first_name, firstName, "the draft's answers were not saved");
      assert.deepEqual(
        [assisted.answers.vc_agree, assisted.answers.vc_review, assisted.answers.vc_tp_signature],
        [["yes"], "yes", officeSignature],
        "the office's Form 14446 consent and signature were not saved",
      );
      assert.deepEqual(assisted.intake_visited, [], "the office sent visits");
      const onAssisted = { caseId: assisted.id };

      // With a case, the materials card and the marks work.
      await waitFor(
        staff,
        "the materials card to be enabled",
        () =>
          Boolean(document.querySelector('.add-case-side button[data-case-action="RECORD_MATERIALS"]')) &&
          document.querySelector("#field-materials-photo_id")?.disabled === false,
        undefined,
        RENDER_MS,
      );
      await waitForQuiet(staff);
      await staff.locator(".add-case-side #materials-form").getByLabel("Photo ID", { exact: true }).check({ timeout: CLICK_MS });
      // The tick survives a redraw from elsewhere before Save (a no-change
      // update on the new case): a redraw used to untick it, and Save then
      // recorded nothing.
      await rebuiltBy(
        staff,
        () => fixture.database.sql("update public.cases set revision=revision where id=$1", [assisted.id]),
        "a no-change update on the walk-in case",
      );
      assert.equal(
        await staff.locator("#field-materials-photo_id").isChecked(),
        true,
        "a redraw from elsewhere took the unsaved Photo ID tick",
      );
      await staff.locator('.add-case-side button[data-case-action="RECORD_MATERIALS"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the photo ID recorded by the Site Coordinator",
        (name) => (document.querySelector('label[for="field-materials-photo_id"]')?.textContent ?? "").includes(`Recorded by ${name}`),
        ROLE_NAMES.siteCoordinator,
        ARRIVAL_MS,
      );
      assert.deepEqual(
        (await fixture.database.sql("select item from public.case_materials where case_id=$1", [assisted.id])).rows.map(
          (row) => row.item,
        ),
        ["photo_id"],
      );
      await openPart("documents");
      await waitForQuiet(staff);
      await staff
        .locator('#add-sub-documents-body [data-action="mark-card"][data-slot="photo_id.tp"][data-status="later"]')
        .click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the photo ID card to read Later",
        () => /Later/.test(document.querySelector("#doc-photo_id-tp-status")?.textContent ?? ""),
        undefined,
        ARRIVAL_MS,
      );
      assert.equal((await cardRow(fixture, assisted.id, "photo_id.tp"))?.status, "later");
      await shootWithoutSidebar(staff, "add-case-v2-saved");

      // Send waits only for the box.
      const send = staff.locator("#add-case-send");
      assert.equal(await send.isDisabled(), true, "Send was on before the box was ticked");
      await tickBox(staff, "field-confirmed");
      assert.equal(await send.isDisabled(), false, "Send stayed off with the box ticked");

      // A bad email and a cleared last name: Send stays on, and its press is
      // refused with the reasons shown and the keyboard on the count.
      await openPart("about.you");
      await waitForQuiet(staff);
      await box("email").fill("not-an-email");
      await box("tp_last_name").fill("");
      assert.equal(await send.isDisabled(), false, "Send went off with answers missing");
      assert.equal(await text("#field-office-tp_last_name-note"), "", "the last name's note spoke before Send");
      await send.click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the keyboard on the count after a refused Send",
        () => document.activeElement?.id === "add-case-count",
        undefined,
        ARRIVAL_MS,
      );
      await waitForQuiet(staff);
      const refusedRow = await caseById(fixture, assisted.id);
      assert.equal(refusedRow.stage, "draft", "a draft with missing answers was sent");
      assert.equal(refusedRow.answers.tp_last_name ?? null, null, "the cleared last name was not saved");
      assert.notEqual(refusedRow.answers.email, "not-an-email", "an invalid email reached the server");
      assert.match(await text("#add-case-count"), /\bpart\b/);
      assert.equal(await text("#add-sub-about-you-status"), "Needs answers");
      assert.equal(await text("#field-office-tp_last_name-note"), "Needs an answer");
      assert.equal(await text("#field-office-email-note"), "Enter a valid email address.");

      // Both fixed: one press sends it, and the page is the case.
      await waitForQuiet(staff);
      await box("email").fill("walkin@example.com");
      await box("tp_last_name").fill("Rivera");
      await send.click({ timeout: CLICK_MS });
      await waitForCaseWorkspace(staff, assistedReference);
      // An office case is sent straight into screening.
      assert.equal((await caseById(fixture, assisted.id)).stage, "screening");

      // The case pool, while the new case is still in intake with nobody
      // preparing it: its phase tab, a narrowing filter, and clearing it.
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await clickAction(staff, "set-board-filter", {
        attributes: '[data-filter="poolPhase"][data-value="intake"]',
      });
      await waitFor(
        staff,
        "the pool's Intake tab to show the assisted case",
        (wanted) =>
          document
            .querySelector('[data-filter="poolPhase"][data-value="intake"]')
            ?.getAttribute("aria-pressed") === "true" &&
          [...document.querySelectorAll("tr.pool-row")].some((row) =>
            row.textContent.includes(wanted),
          ),
        assistedReference,
        RENDER_MS,
      );
      await waitForQuiet(staff);
      await staff
        .locator('select[data-board-filter="poolPreparer"]')
        .selectOption("unassigned", { timeout: CLICK_MS });
      await waitFor(
        staff,
        "the Unassigned filter to still show the assisted case",
        (wanted) =>
          document.querySelector('select[data-board-filter="poolPreparer"]')?.value ===
            "unassigned" &&
          /Showing [1-9]\d* of \d+ cases/.test(
            document.querySelector('.case-pool [role="status"]')?.textContent ?? "",
          ) &&
          [...document.querySelectorAll("tr.pool-row")].some((row) =>
            row.textContent.includes(wanted),
          ),
        assistedReference,
        RENDER_MS,
      );
      await clickAction(staff, "clear-pool-filters");
      await waitFor(
        staff,
        "the pool's filters to be cleared",
        () =>
          document.querySelector('select[data-board-filter="poolPreparer"]')?.value === "all" &&
          document.querySelector('[data-action="clear-pool-filters"]') === null,
        undefined,
        RENDER_MS,
      );
      // "Clear filters" went with the filters; the keyboard went to the first
      // filter, not out to the page.
      await waitFor(
        staff,
        "the keyboard on the Stage filter after Clear filters",
        () => document.activeElement?.id === "field-poolStage",
        undefined,
        RENDER_MS,
      );
      await shoot(staff, "office-case-pool");
      // Back to the case from the pool's own row.
      await openCaseByReference(staff, assistedReference);

      await tickScreeningChecks(staff);
      await actForm(
        staff,
        "VERIFY_INTAKE",
        {},
        { detail: { label: "Intake checks", value: "Recorded" } },
        onAssisted,
      );

      await use("preparer", assistedReference);
      await act(
        staff,
        "CLAIM_PREPARATION",
        { detail: { label: "Preparer", value: ROLE_NAMES.preparer } },
        onAssisted,
      );
      await actForm(
        staff,
        "REQUEST_DOCUMENT",
        {
          "Short title": REQUEST_TITLE,
          "What the client should send": REQUEST_MESSAGE,
        },
        { badge: "Waiting for the client" },
        onAssisted,
      );

      await use("siteCoordinator", assistedReference);
      await waitForText(staff, "Documents the office took in", RENDER_MS);
      await act(
        staff,
        "RECORD_DOCUMENT_RESPONSE",
        { badge: "Received, not verified yet" },
        onAssisted,
      );
      const recorded = await one(
        fixture,
        "select source,filename from public.documents where case_id=$1",
        [assisted.id],
      );
      assert.deepEqual(recorded, {
        source: "staff_recorded",
        filename: SAMPLE_DOCUMENT_FILENAME,
      });

      await use("preparer", assistedReference);
      await act(staff, "VERIFY_DOCUMENT", { badge: "Verified" }, onAssisted);
      await shoot(staff, "office-board-assisted");
      evidence.regressions.assistedReceipt =
        "created, submitted, verified intake, claimed, requested, staff-recorded, verified";
    });

    await phase("two windows of one staff account in one browser keep their own place", async () => {
      // English, as every context but the Chinese phase's (spec 2026-10-05 §6).
      const context = await staffEngine.browser.newContext({ viewport: DESKTOP, locale: "en-US" });
      try {
        const preparerActor = fixture.actor("preparer");
        const tabOne = await openTab(context, fixture.appOrigin);
        await loginTestUser({
          page: tabOne.page,
          actor: preparerActor,
          fixture,
          heading: WORK_BOARD_HEADING,
        });
        // The same account, the same origin, the same storage: a second window.
        const tabTwo = await openTab(context, fixture.appOrigin);
        await waitForText(tabTwo.page, WORK_BOARD_HEADING, ARRIVAL_MS);
        // Each window on a case of its own: the class case on Overview in the
        // first, the seeded review_ready case on History in the second.
        const other = seeded.review_ready.reference;
        await openCaseByReference(tabOne.page, classReference);
        await openCaseByReference(tabTwo.page, other);
        await openCaseTab(tabTwo.page, "history");
        await tabOne.page.reload();
        await tabTwo.page.reload();
        await waitForCaseWorkspace(tabOne.page, classReference, ARRIVAL_MS);
        await waitForCaseWorkspace(tabTwo.page, other, ARRIVAL_MS);
        const place = async (page) => {
          const shown = await page.evaluate(() => ({
            title: document.querySelector("#case-title")?.textContent.trim() ?? null,
            tab: document.querySelector('.case-tab[aria-selected="true"]')?.dataset.value ?? null,
          }));
          const stored = await readWindowState(page, preparerActor.userId);
          return { ...shown, selectedCaseId: stored?.selectedCaseId ?? null, caseTab: stored?.caseTab ?? null };
        };
        assert.deepEqual(
          await place(tabOne.page),
          { title: classReference, tab: "overview", selectedCaseId: classCase.id, caseTab: "overview" },
          "the first window followed the second one into its case",
        );
        assert.deepEqual(
          await place(tabTwo.page),
          { title: other, tab: "history", selectedCaseId: seeded.review_ready.id, caseTab: "history" },
          "the second window followed the first one into its case",
        );
        assertConsoleQuiet(tabOne, { name: "Preparer tab 1" });
        assertConsoleQuiet(tabTwo, { name: "Preparer tab 2" });
        evidence.windowIsolation.staffTabs =
          "one BrowserContext, one staff account, two cases and two tabs, each surviving its own reload";
      } finally {
        await context.close();
      }
    });

    await phase("a fixed code is refused and an unknown address says nothing", async () => {
      const codeWin = await openWindow(clientEngine);
      try {
        const { release } = await requestCode({
          page: codeWin.page,
          fixture,
          address: applicantB.email,
        });
        let pending = null;
        try {
          // The deleted prototype's fixed code is just a wrong number now.
          await submitVerificationCode({ page: codeWin.page, code: "246810" });
          await waitForText(
            codeWin.page,
            "That code is invalid or has expired. Request a new code.",
          );
          await codeWin.page.getByLabel("Verification code", { exact: true }).waitFor();
        } catch (error) {
          pending = error;
          throw error;
        } finally {
          await release({ pending });
        }
        evidence.regressions.fixedCode = "refused, and the form stays on the code step";
        assertConsoleQuiet(codeWin, {
          name: "wrong-code window",
          allow: REFUSAL_LINES,
        });
      } finally {
        await codeWin.context.close();
      }

      const unknownWin = await openWindow(clientEngine);
      try {
        const { release } = await requestCode({
          page: unknownWin.page,
          fixture,
          // Syntactically valid, and nobody's.
          address: `unknown-${randomUUID()}@vitally.invalid`,
        });
        let pending = null;
        try {
          await waitForText(unknownWin.page, fixture.neutralSendMessage, RENDER_MS);
          const resend = unknownWin.page.locator("[data-action='resend-code']");
          assert.match((await resend.innerText()).trim(), /^Resend code in \d+s$/);
          assert.equal(await resend.isDisabled(), true);
        } catch (error) {
          pending = error;
          throw error;
        } finally {
          await release({ pending });
        }
        evidence.regressions.unknownAddress =
          "the same neutral message and the same disabled countdown";
        assertConsoleQuiet(unknownWin, {
          name: "unknown-address window",
          allow: REFUSAL_LINES,
        });
      } finally {
        await unknownWin.context.close();
      }
    });

    await phase("a second seed run replaces its set and leaves the class's own work alone", async () => {
      // Everything in the workspace no seed run made: the class's own cases
      // and help requests, which the second run must leave as they are.
      const firstRun = Object.values(seeded).map((row) => row.id);
      const notSeeded = async (caseIds, helpIds) => ({
        cases: (
          await fixture.database.sql(
            "select id,reference,stage,owner_user_id from public.cases where workspace_id=$1 and not (id = any($2::uuid[])) order by id",
            [fixture.database.workspaceId, caseIds],
          )
        ).rows,
        help: (
          await fixture.database.sql(
            "select id,status from public.assistance_items where workspace_id=$1 and not (id = any($2::uuid[])) order by id",
            [fixture.database.workspaceId, helpIds],
          )
        ).rows,
      });
      const othersBefore = await notSeeded(firstRun, [seededHelpId]);
      // Two things this phase asserts about the client window while somebody
      // else replaces the seeded cases underneath it. Both were defects this
      // story found; both are fixed, and this is what pins them (Ruling R65).
      //
      // (1) A refusal the person has not dismissed. The save below is refused
      //     because the API is unreachable, and the notice names why.
      const apiTraffic = `${fixture.authOrigin}/**`;
      const refuse = (route) => route.abort();
      await clientWin.context.route(apiTraffic, refuse);
      await client.getByLabel("ZIP code", { exact: true }).fill("19104");
      await clickContinue(client);
      await waitForText(client, "Not saved.");
      const refusalBefore = await alertText(client);
      assert.ok(refusalBefore, "the refused save said nothing at all");
      await clientWin.context.unroute(apiTraffic, refuse);
      // (2) Where the keyboard is when the replacement arrives.
      await client.locator('[data-action="open-help"]').first().focus();
      // The seed again, on the same workspace and run directory as the first
      // run: it removes exactly the eleven cases that run recorded and builds
      // a fresh set.
      const result = await runSeed();
      assert.equal(result.casesRemoved, 11, "the second seed run removed another set than the first run's");
      assert.equal(result.casesCreated, 11);
      const fresh = await seededCases(result);
      assert.equal(
        Object.values(fresh).filter((row) => firstRun.includes(row.id)).length,
        0,
        "the second seed run kept a case id of the first",
      );
      assert.equal(
        Number(
          (
            await one(fixture, "select count(*)::int as count from public.cases where id = any($1::uuid[])", [firstRun])
          ).count,
        ),
        0,
        "a case of the first seed run is still there",
      );
      assert.deepEqual(
        await notSeeded(Object.values(fresh).map((row) => row.id), [result.assistanceId]),
        othersBefore,
        "the second seed run changed something its run file does not list",
      );
      // From here on the story works with the second run's cases.
      seeded = fresh;
      seededHelpId = result.assistanceId;
      const kept = await caseById(fixture, classCase.id);
      assert.equal(kept.reference, classReference);
      assert.equal(kept.owner_user_id, applicantA.userId);
      // Taken through filing by the office earlier in the story; a seed run leaves it there.
      assert.equal(kept.stage, "accepted");
      // Both measurements are about what the *client* window does when the
      // change reaches it, so they wait for the sign that it has: the refused
      // save left the connection notice on screen, and the re-read that
      // handles the replacement is what takes it away again.
      const reconnected = await client
        .waitForFunction(
          () =>
            !(document.querySelector("#app")?.innerText ?? "").includes(
              "No connection to the server.",
            ),
          undefined,
          { timeout: ARRIVAL_MS, polling: 150 },
        )
        .then(() => true)
        .catch(() => false);
      const rerun = {
        casesRemoved: result.casesRemoved,
        casesCreated: result.casesCreated,
        keptClassCase: "same reference, same owner, same stage",
        keptOthers: `${othersBefore.cases.length} cases and ${othersBefore.help.length} help requests not in the run file, unchanged`,
        clientRecovered: reconnected,
        keyboardBeforeSharedUpdate: "open-help",
        keyboardAfterSharedUpdate: await client.evaluate(
          () =>
            document.activeElement?.dataset?.action ??
            document.activeElement?.tagName ??
            null,
        ),
        refusalBefore,
        refusalAfter: await alertText(client),
      };
      rerun.refusalKept = rerun.refusalAfter === refusalBefore;
      evidence.regressions.secondSeed = rerun;
      // Both checks below are about what the seed run did to the client
      // window, so they mean nothing until it has reached it. This is the sign
      // that it did: the connection notice the refused save left behind is
      // gone, which only the re-read that handles the change can do.
      assert.equal(
        rerun.clientRecovered,
        true,
        "the client window never re-read after the second seed run, so the checks below prove nothing",
      );
      assert.equal(
        rerun.keyboardAfterSharedUpdate,
        rerun.keyboardBeforeSharedUpdate,
        "a shared update took the keyboard away from the control it was on",
      );
      assert.equal(
        rerun.refusalKept,
        true,
        `a refusal nobody had dismissed was changed by a background update: ${JSON.stringify(rerun.refusalAfter)}`,
      );
      // The client's own window still lists their own application, unchanged.
      await clickAction(client, "open-applications");
      await waitForText(client, classReference, ARRIVAL_MS);
    });

    // D5 on the board: a claim unlocks the row's phone where the claimer is
    // looking, with no reload. A board claim moves the claiming window to the
    // case, so a second window of the same account watches the row; it finds
    // the case by search, which spans every stage, so the row stays listed
    // when the claim moves it off the Available tab.
    await phase("a claim unlocks the phone on the board in another window", async () => {
      // The first run's preparation_ready case was claimed in the race above,
      // so the unclaimed one is the second seed run's.
      const target = seeded.preparation_ready;
      assert.ok(target, "the second seed run's preparation_ready case is missing");
      assert.equal((await caseById(fixture, target.id)).stage, "preparation_ready");
      const maskId = `board-phone-${target.id}`;
      const watcher = await openWindow(staffEngine);
      await loginTestUser({ page: watcher.page, actor: fixture.actor("preparer"), fixture, heading: WORK_BOARD_HEADING });
      await watchAlerts(watcher.page);
      await openBoard(watcher.page);
      await findOnBoard(watcher.page, target.reference);
      const rowMask = (page) =>
        page.evaluate((wanted) => {
          const row = [...document.querySelectorAll("tr.board-row")].find((tr) =>
            tr.querySelector("button.board-reference")?.textContent.includes(wanted),
          );
          const mask = row?.querySelector(".phone-mask");
          return row
            ? {
                locked: mask?.classList.contains("is-locked") ?? null,
                id: mask?.id || null,
                focusable: mask?.hasAttribute("tabindex") ?? null,
                html: row.outerHTML,
              }
            : null;
        }, target.reference);

      // 1. Before the claim: locked, no id, no tab stop, no number.
      const before = await rowMask(watcher.page);
      assert.ok(before, "the case is not on the watching window's board");
      assert.deepEqual(
        { locked: before.locked, id: before.id, focusable: before.focusable },
        { locked: true, id: null, focusable: false },
      );
      assert.doesNotMatch(before.html, SAMPLE_PHONE, "a locked row carries the number");
      assert.doesNotMatch(before.html, /2155550\d\d\d/, "a locked row carries the stored number");

      // 2. The Preparer claims from the board in their other window.
      await use("preparer");
      await openBoard(staff);
      await findOnBoard(staff, target.reference);
      await waitForQuiet(staff);
      await staff
        .locator(`[data-case-action="CLAIM_PREPARATION"][data-case-id="${target.id}"]`)
        .click({ timeout: CLICK_MS });
      await waitForCaseWorkspace(staff, target.reference);

      // 3. The watching window: the same row unlocks in place.
      await waitFor(
        watcher.page,
        "the row's phone to unlock without a reload",
        (id) => {
          const mask = document.getElementById(id);
          return Boolean(mask) && mask.getAttribute("tabindex") === "0" && Boolean(mask.querySelector(".phone-full"));
        },
        maskId,
        ARRIVAL_MS,
      );
      assert.equal(
        await watcher.page.locator("#field-board-search").inputValue(),
        target.reference,
        "the watching window's search did not survive the redraw",
      );

      // 4. The claiming window, back on the board: revealable there too.
      await openBoard(staff);
      await findOnBoard(staff, target.reference);
      await waitFor(
        staff,
        "the claiming window's row to show the revealable phone",
        (id) => {
          const mask = document.getElementById(id);
          return Boolean(mask) && mask.getAttribute("tabindex") === "0";
        },
        maskId,
        ARRIVAL_MS,
      );
      const after = await rowMask(staff);
      assert.deepEqual(
        { locked: after?.locked, id: after?.id, focusable: after?.focusable },
        { locked: false, id: maskId, focusable: true },
      );

      // 5. Tab from the case link lands on the phone and reveals it.
      await waitForQuiet(watcher.page);
      await watcher.page.mouse.move(1, 1);
      await watcher.page.evaluate(
        (wanted) =>
          [...document.querySelectorAll("button.board-reference")]
            .find((button) => button.textContent.includes(wanted))
            ?.focus(),
        target.reference,
      );
      await watcher.page.keyboard.press("Tab");
      const landed = await watcher.page.evaluate(() => ({
        id: document.activeElement?.id ?? null,
        full: (document.activeElement?.querySelector(".phone-full")?.getBoundingClientRect().width ?? 0) > 4,
      }));
      assert.deepEqual(landed, { id: maskId, full: true }, "Tab from the case link did not reveal the phone");

      // 6. A realtime redraw keeps the revealed number revealed (spec:
      // "A realtime update keeps a revealed listed number revealed"). A
      // no-change bump on the case, from outside the window, rebuilds the
      // board; the per-row id puts focus back on the mask.
      await watcher.page.evaluate(() => document.querySelector("#main")?.setAttribute("data-phone-marker", "1"));
      await fixture.database.sql("update public.cases set revision = revision + 1 where id=$1", [target.id]);
      await waitFor(
        watcher.page,
        "the realtime change to rebuild the board",
        () => Boolean(document.querySelector("#main")) && !document.querySelector("#main[data-phone-marker]"),
        undefined,
        ARRIVAL_MS,
      );
      const kept = await watcher.page.evaluate(() => ({
        id: document.activeElement?.id ?? null,
        full: (document.activeElement?.querySelector(".phone-full")?.getBoundingClientRect().width ?? 0) > 4,
      }));
      assert.deepEqual(kept, { id: maskId, full: true }, "a realtime redraw lost the revealed phone");

      assertConsoleQuiet(watcher, { name: "board phone window" });
      await watcher.context.close();
    });

    // After the second seed run, which compares case sets. The case it makes is never
    // opened on a staff screen.
    //
    // Typing rule: text goes in with `fill`, or `focus` then the keyboard.
    // Nothing clicks into a field, because that click is itself a press, and it
    // fires the `change` of the field left behind: the only press after typing
    // is the one a check is about, and it is sent once, with no retry helper.
    //
    // Moving: Continue walks every visible sub-step exactly once, from
    // before.ready to review.check (the gate holds 9.2 and 9.3 until the city
    // is fixed). Everywhere else the phase moves the way a person jumps
    // around: a rail link (`go-substep`), an alert, a Change.
    await phase("a client walks the version-2 intake, sub-step by sub-step", async () => {
      let v2Win = null;
      let againWin = null;
      // The console lines this phase causes on purpose, by their place in the
      // window's record: each is caught as it happens, beside the check that
      // causes it, so nothing else can pass under its pattern.
      const excused = new Set();
      try {
        v2Win = await openWindow(clientEngine);
        const page = v2Win.page;
        const box = (id) => page.locator(`#field-client-${id}`);
        const continueButton = page.locator('#intake-v2-form button[type="submit"]');
        const submitButton = page.locator('#intake-v2-form [data-case-action="SUBMIT"]');
        const confirmBox = page.locator("#field-confirmed");
        const railLink = (id) => page.locator(`.rail-sublink[data-substep="${id}"]`);
        const railToggle = (stepId) => page.locator(`.rail-toggle[data-step-id="${stepId}"]`);
        const stepOf = (id) => id.split(".")[0];
        const here = () =>
          page.evaluate(() => document.querySelector("#intake-v2-form")?.dataset.substep ?? null);
        const rail = (id) => railSub(page, id);
        // A move no check is about: wait for stillness, press, arrive.
        const goTo = async (control, id) => {
          await waitForQuiet(page);
          await control.click({ timeout: CLICK_MS });
          await waitForSubstep(page, id);
        };
        const railOpen = (stepId) =>
          page.evaluate((wanted) => {
            const toggle = document.querySelector(`.rail-toggle[data-step-id="${wanted}"]`);
            return {
              expanded: toggle?.getAttribute("aria-expanded") ?? null,
              hidden: document.getElementById(`rail-subs-${wanted}`)?.hidden ?? null,
            };
          }, stepId);
        // A rail step's toggle, and the keyboard staying on it (spec §3.2).
        const toggleRailStep = async (stepId, expanded) => {
          await waitForQuiet(page);
          await railToggle(stepId).click({ timeout: CLICK_MS });
          await waitFor(
            page,
            `the rail step ${stepId} to be ${expanded ? "expanded" : "collapsed"}`,
            ([wanted, open]) =>
              document
                .querySelector(`.rail-toggle[data-step-id="${wanted}"]`)
                ?.getAttribute("aria-expanded") === String(open) &&
              document.getElementById(`rail-subs-${wanted}`)?.hidden === !open,
            [stepId, expanded],
            RENDER_MS,
          );
          assert.equal(
            await page.evaluate(
              (wanted) =>
                document.activeElement?.matches(`.rail-toggle[data-step-id="${wanted}"]`) ?? false,
              stepId,
            ),
            true,
            `the ${stepId} toggle lost the keyboard`,
          );
        };
        // A rail jump. A collapsed step's links are hidden, so its toggle
        // opens it first; it then stays open (`rail-open:<step>`).
        const jump = async (id) => {
          await waitForQuiet(page);
          if ((await railOpen(stepOf(id))).expanded !== "true") await toggleRailStep(stepOf(id), true);
          await goTo(railLink(id), id);
        };
        // A radio redraws the page around itself, so it is read back, not
        // `check()`ed: the element Playwright pressed is gone by then.
        const choose = async (id, value) => {
          await waitForQuiet(page);
          await page.locator(`label[for="field-client-${id}-${value}"]`).click({ timeout: CLICK_MS });
          await waitFor(
            page,
            `${id} to come back as ${value}`,
            (selector) => document.querySelector(selector)?.checked === true,
            `#field-client-${id}-${value}`,
            RENDER_MS,
          );
        };
        const confirmTicked = (wanted) =>
          waitFor(
            page,
            `the confirmation to come back ${wanted ? "ticked" : "unticked"}`,
            (ticked) => document.querySelector("#field-confirmed")?.checked === ticked,
            wanted,
            RENDER_MS,
          );
        const keyboardNow = () =>
          page.evaluate(() => ({
            id: document.activeElement?.id ?? null,
            value: document.activeElement?.value ?? null,
            caret: document.activeElement?.selectionStart ?? null,
            scrollY: window.scrollY,
          }));
        const focused = () => page.evaluate(() => document.activeElement?.id ?? null);
        const readNode = (id) =>
          page.evaluate((wanted) => {
            const node = document.getElementById(wanted);
            return { className: node?.className ?? null, text: node?.textContent.trim() ?? null };
          }, id);
        const note = (id) => readNode(`field-client-${id}-note`);
        const railStep = (stepId) => readNode(`rail-step-${stepId}-status`);
        const chip = async () =>
          (await page.locator(".application-meta .save-chip").innerText()).trim();
        const header = () =>
          page.evaluate(() => {
            const intro = document.querySelector(".form-workspace .page-intro");
            return {
              overline: intro?.querySelector(".overline")?.textContent.trim() ?? null,
              title: intro?.querySelector("h1")?.textContent.trim() ?? null,
              count: intro?.querySelector(".substep-count")?.textContent.trim() ?? null,
            };
          });
        // Where the rail says the form is, read off the tree itself.
        const railHere = () =>
          page.evaluate(() => {
            const link = document.querySelector('.rail-sublink[aria-current="step"]');
            const step = document.querySelector(".rail-step.is-current");
            return {
              substep: document.querySelector("#intake-v2-form")?.dataset.substep ?? null,
              current: link?.dataset.substep ?? null,
              here: link?.querySelector(".rail-here")?.textContent.trim() ?? null,
              step: step?.dataset.stepId ?? null,
              expanded: step?.querySelector(".rail-toggle")?.getAttribute("aria-expanded") ?? null,
              shown: step ? step.querySelector(".rail-subs")?.hidden === false : null,
            };
          });
        // The review step's rail entries, in order: the gate decides 9.2 and 9.3.
        const reviewRail = () =>
          page.evaluate(() => [...document.querySelectorAll("#rail-subs-review .rail-sublink")].map((link) => link.dataset.substep));
        // Every mark on the rail, collapsed steps included.
        const railMarks = () =>
          page.evaluate(() =>
            Object.fromEntries(
              [...document.querySelectorAll('.rail-tree [id^="rail-"][id$="-status"]')].map(
                (span) => [span.id, `${span.className} | ${span.textContent.trim()}`],
              ),
            ),
          );
        // A marker is a property on a node: it survives an in-place update and
        // dies with a redraw. Set only once the page is still, because a late
        // realtime refresh from an earlier save is a legitimate redraw.
        const mark = (selector, name) =>
          page.evaluate(([wanted, key]) => {
            document.querySelector(wanted)[key] = true;
          }, [selector, name]);
        const marked = (selector, name) =>
          page.evaluate(
            ([wanted, key]) => document.querySelector(wanted)?.[key] === true,
            [selector, name],
          );
        // review.check's two blocks, as a person reads them.
        const alertsList = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".alerts-block .alerts-step")].map((group) => ({
              step: group.querySelector("h4")?.textContent.trim() ?? null,
              items: [...group.querySelectorAll(".alert-item")].map((item) => ({
                question: item.querySelector(".alert-q")?.textContent.trim() ?? null,
                flag: item.querySelector(".alert-flag")?.textContent.trim() ?? null,
                substep: item.dataset.substep ?? null,
                kind: item.className,
              })),
            })),
          );
        const warningsList = () =>
          page.evaluate(() => ({
            heading: document.querySelector(".warnings-block h3")?.textContent.trim() ?? null,
            items: [...document.querySelectorAll(".warnings-block .warning-item")].map((item) => ({
              label: item.querySelector("strong")?.textContent.trim() ?? null,
              detail: item.querySelector("small")?.textContent.trim() ?? null,
              focus: item.querySelector("button")?.dataset.focus ?? null,
            })),
          }));
        const cardStatus = (slot) => readNode(`doc-${slot.replace(/\./g, "-")}-status`);
        const markCard = async (slot, status, word) => {
          await waitForQuiet(page);
          await page
            .locator(`[data-action="mark-card"][data-slot="${slot}"][data-status="${status}"]`)
            .click({ timeout: CLICK_MS });
          await waitFor(
            page,
            `the ${slot} card to read ${word}`,
            ([id, wanted]) =>
              document.getElementById(id)?.textContent.trim() === `Status: ${wanted}`,
            [`doc-${slot.replace(/\./g, "-")}-status`, word],
            ARRIVAL_MS,
          );
        };
        // The mark the rail shows for a sub-step once the server has answered.
        const railReads = (id, text) =>
          waitFor(
            page,
            `the rail to mark ${id} ${JSON.stringify(text)}`,
            ([span, wanted]) => document.getElementById(span)?.textContent.trim() === wanted,
            [`rail-sub-${id.replace(/\./g, "-")}-status`, text],
            ARRIVAL_MS,
          );

        // Applicant B already has a case from an earlier phase (the offline
        // draft), so this is a new one, and every query below uses its id.
        await loginTestUser({ page, actor: applicantB, fixture });
        const reference = await startApplication(page);
        const own = await caseByReference(fixture, reference);
        assert.ok(own, "the generated reference names no case");
        const answer = (key) => caseAnswer(fixture, own.id, key);
        const redrawFromElsewhere = async () => {
          await mark("#intake-v2-form", "__beforeRedraw");
          await fixture.database.sql("update public.cases set revision=revision where id=$1", [
            own.id,
          ]);
          await waitFor(
            page,
            "a realtime change to rebuild the form",
            () => {
              const form = document.querySelector("#intake-v2-form");
              return Boolean(form) && form.__beforeRedraw !== true;
            },
            undefined,
            ARRIVAL_MS,
          );
          await waitForQuiet(page);
        };
        assert.equal(
          Number(
            (await one(fixture, "select intake_version from public.cases where id=$1", [own.id]))
              .intake_version,
          ),
          2,
        );
        await clickAction(page, "continue-intake");
        await waitForSubstep(page, "before.ready");

        // ---- The walk: Continue on every visible sub-step, once ----------
        // The gate: 9.2 and 9.3 need every alert fixed, and the walk keeps a gap
        // (the city) for review.check, so Continue walks up to 9.1.
        const WALKED = V2_WALK.slice(0, V2_WALK.indexOf("review.check") + 1);
        // The Form 14446 signature typed at 1.5, for the checks after it.
        let walkSignature = null;
        for (let at = 0; at < WALKED.length; at += 1) {
          const id = WALKED[at];
          const next = WALKED[at + 1] ?? null;
          if (at > 0) await waitForSubstep(page, id);
          // The rail marks where the form is, and the current step is open.
          assert.deepEqual(
            await railHere(),
            {
              substep: id,
              current: id,
              here: "You are here",
              step: stepOf(id),
              expanded: "true",
              shown: true,
            },
            `the rail on arriving at ${id}`,
          );
          let pressed = false;

          if (id === "before.ready") {
            assert.deepEqual(await header(), {
              overline: "BEFORE YOU START",
              title: "Before you start",
              count: "1 of 4",
            });
            assert.deepEqual(await railOpen("about"), { expanded: "false", hidden: true });
            // Another step's toggle opens it where it is: no move, no save.
            await toggleRailStep("about", true);
            assert.equal(await here(), "before.ready", "a rail toggle moved the form");
            assert.deepEqual(await railOpen("household"), { expanded: "false", hidden: true });
            // Every blank filled once, here, so the walk has its answers.
            await clickAction(page, "fill-fictional");
            await waitFor(
              page,
              "the fill to be announced",
              () => document.querySelector("#toast")?.textContent.includes("Fictional details filled in"),
              undefined,
              RENDER_MS,
            );
          }

          if (id === "before.service") {
            assert.deepEqual(await rail("before.ready"), {
              className: "rail-status is-done",
              text: "Done",
            });
            assert.equal(await box("service-drop_off").isChecked(), true);
            // The fill is saved: the rail now lists exactly the walk (the
            // locked sub-steps too), less 9.2 and 9.3: the fill never
            // consents to or signs Form 14446, so the review gate is shut.
            assert.deepEqual(
              await page.evaluate(() =>
                [...document.querySelectorAll(".rail-sublink")].map((link) => link.dataset.substep),
              ),
              V2_WALK.filter((id) => id !== "review.summary" && id !== "review.submit"),
              "the rail does not list the sub-steps this example shows",
            );
          }

          if (id === "before.virtual") {
            // The Form 14446 gate (add-form-14446-consent): until 0.4 is
            // ticked, every step after "Before you start" is locked on the
            // rail (no link), and Continue waits, with a line saying why.
            const shut = await page.evaluate(() => ({
              aboutHead: document.querySelectorAll('.rail-step[data-step-id="about"] .rail-link.is-locked').length,
              aboutLinks: document.querySelectorAll('.rail-step[data-step-id="about"] [data-action="go-substep"]').length,
              lockedSteps: [...document.querySelectorAll(".rail-step")]
                .filter((step) => step.querySelector(".rail-link.is-locked"))
                .map((step) => step.dataset.stepId),
              links: [...document.querySelectorAll('.rail-tree [data-action="go-substep"]')].map(
                (link) => link.dataset.substep,
              ),
            }));
            assert.equal(shut.aboutHead, 1, "About you is not locked before the consent");
            assert.equal(shut.aboutLinks, 0, "About you has a link before the consent");
            assert.deepEqual(
              shut.lockedSteps,
              [...new Set(V2_WALK.map(stepOf))].filter((stepId) => stepId !== "before"),
              "the steps after Before you start are not all locked",
            );
            assert.ok(
              shut.links.every((substep) => stepOf(substep) === "before"),
              `a link past Before you start before the consent: ${JSON.stringify(shut.links)}`,
            );
            assert.equal(await continueButton.isDisabled(), true, "Continue was on before the consent");
            assert.equal(await continueButton.getAttribute("aria-describedby"), "consent-blocked");
            assert.equal(
              await page.locator("#consent-blocked").innerText(),
              "We need this consent to prepare your return. If you'd rather not give it, please call PCDC at 215-922-6156.",
            );
            assert.equal(await box("vc_agree-yes").isChecked(), false, "Fill fictional details gave the consent");
            await tickBox(page, "field-client-vc_agree-yes");
            await waitFor(
              page,
              "the rail to unlock after the consent",
              () =>
                !document.querySelector(".rail-tree .is-locked") &&
                Boolean(document.querySelector('.rail-step[data-step-id="about"] .rail-link[data-action="go-substep"]')),
              undefined,
              RENDER_MS,
            );
            assert.equal(await continueButton.isDisabled(), false, "Continue stayed off after the consent");
            assert.equal(await page.locator("#consent-blocked").count(), 0, "the consent line outlived the consent");
          }

          if (id === "about.you") {
            // A realtime redraw keeps the keyboard, the caret and the scroll.
            await waitForQuiet(page);
            await page.evaluate(() => window.scrollBy(0, 160));
            await box("tp_middle_name").focus();
            await page.keyboard.type("Xia");
            await waitForQuiet(page);
            const typed = await page.evaluate(() => {
              document.activeElement.setSelectionRange(2, 2);
              return {
                id: document.activeElement.id,
                value: document.activeElement.value,
                caret: document.activeElement.selectionStart,
                scrollY: window.scrollY,
              };
            });
            assert.equal(typed.id, "field-client-tp_middle_name");
            assert.ok(typed.scrollY > 0, "the page never scrolled, so keeping the scroll proves nothing");
            await redrawFromElsewhere();
            assert.deepEqual(
              await keyboardNow(),
              typed,
              "a realtime redraw moved the keyboard, the caret or the scroll",
            );

            // Leaving a text field doesn't redraw.
            await waitForQuiet(page);
            await mark("#intake-v2-form", "__beforeTab");
            await page.keyboard.press("Tab");
            await waitForQuiet(page);
            assert.equal(
              await marked("#intake-v2-form", "__beforeTab"),
              true,
              "leaving a text field redrew the page",
            );
            assert.equal(await focused(), "field-client-tp_last_name");

            // Continue after typing, with a real mouse and one press: the
            // `change` of the field left behind fires on that press and must
            // not swallow it.
            await waitForQuiet(page);
            await box("email").fill("mei.lin@example.com");
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await continueButton.click({ timeout: CLICK_MS });
            pressed = true;
          }

          if (id === "about.address") {
            assert.equal(await answer("email"), "mei.lin@example.com");
            assert.equal(await answer("tp_middle_name"), "Xia");
            await waitForQuiet(page);
            const opened = await keyboardNow();
            assert.equal(opened.scrollY, 0, "the new sub-step did not open at the top");
            assert.equal(opened.id, "main", "the new sub-step did not put the keyboard on main");
            // A never-married client: the spouse's sub-step is hidden, so this
            // is the second of five.
            assert.deepEqual(await header(), {
              overline: "STEP 1 OF 9 · ABOUT YOU",
              title: "Mailing address",
              count: "2 of 6",
            });
            assert.equal(await rail("about.spouse"), null, "a never-married client's rail lists the spouse");
            // A gap left on purpose: review.check lists it later.
            await box("addr_city").fill("");
          }

          if (id === "about.marital") {
            assert.deepEqual(await rail("about.address"), {
              className: "rail-status is-needs",
              text: "Needs answers",
            });
            assert.deepEqual(await railStep("about"), {
              className: "rail-status is-needs",
              text: "Needs answers",
            });
            assert.deepEqual(await rail("about.you"), { className: "rail-status is-done", text: "Done" });
            assert.equal(await answer("addr_city"), null, "the cleared city is still on the server");
            // The phone's "All steps" opens the tree at narrow widths, and the
            // keyboard stays on it; the screenshot shows the open tree.
            await page.setViewportSize({ width: MOBILE_WIDTH, height: 900 });
            const allSteps = page.locator('[data-action="toggle-panel"][data-panel="rail-all"]');
            await waitForQuiet(page);
            await allSteps.click({ timeout: CLICK_MS });
            await waitFor(
              page,
              "the phone's step list to open",
              () =>
                document.querySelector("#rail-tree")?.classList.contains("is-open") &&
                document
                  .querySelector('[data-action="toggle-panel"][data-panel="rail-all"]')
                  ?.getAttribute("aria-expanded") === "true",
              undefined,
              RENDER_MS,
            );
            assert.equal(
              await page.evaluate(
                () => document.activeElement?.dataset.panel ?? null,
              ),
              "rail-all",
              "All steps lost the keyboard",
            );
            await shoot(page, "intake-v2-rail-tree");
            await page.setViewportSize({ width: MOBILE_WIDTH, height: 900 });
            await waitForQuiet(page);
            await allSteps.click({ timeout: CLICK_MS });
            await waitFor(
              page,
              "the phone's step list to close",
              () => !document.querySelector("#rail-tree")?.classList.contains("is-open"),
              undefined,
              RENDER_MS,
            );
            await page.setViewportSize(DESKTOP);
          }

          if (id === "about.sign") {
            // Form 14446's signatures (add-form-14446-consent): the details it
            // will print come first, read-only, and the date is asked only
            // once there is a signature, which fills it with today.
            assert.equal(await page.locator("#intake-v2-form .sign-details").count(), 1, "1.5 shows no details");
            assert.equal(await box("vc_tp_date-year").count(), 0, "1.5 asked the date before the signature");
            walkSignature = await sign14446(page);
          }

          if (id === "income.wages") {
            // A sub-step with a lead line shows it, and no section intro.
            assert.deepEqual(
              await page.evaluate(() => ({
                lead: document.querySelector("#intake-v2-form .q-lead")?.textContent.trim() ?? null,
                intros: document.querySelectorAll("#intake-v2-form .q-intro").length,
              })),
              { lead: "Did you receive any of these in 2025?", intros: 0 },
            );
            // The label can carry a range note after the wording, so compare its start.
            assert.ok(
              (await page.evaluate(() => document.querySelector('[data-q="inc_wages_job_count"] .q-label')?.textContent.trim() ?? "")).startsWith(
                "How many jobs did you have in 2025?",
              ),
              "Q9.1a reads the not-married wording",
            );
            assert.deepEqual(await header(), {
              overline: "STEP 3 OF 9 · INCOME",
              title: "Wages and tips",
              count: "1 of 6",
            });
          }

          if (id === "about.situation") {
            // Never married: Q5.3 asks the client directly, with Yes/No radio buttons.
            const citizen = await page.evaluate(() => ({
              legend: document.querySelector('[data-q="us_citizen"] .q-label')?.textContent.trim() ?? "",
              radios: document.querySelectorAll('[data-q="us_citizen"] input[type="radio"]').length,
              boxes: document.querySelectorAll('[data-q="us_citizen"] input[type="checkbox"]').length,
            }));
            assert.ok(citizen.legend.startsWith("Are you a U.S. citizen?"), citizen.legend);
            assert.deepEqual([citizen.radios, citizen.boxes], [2, 0]);
          }

          if (id === "review.check") {
            // Arriving by Continue puts the keyboard on the alerts heading.
            await waitForQuiet(page);
            assert.equal(await focused(), "alerts-title");
            // The gate: the city is missing, so Continue waits, a line says
            // why, and the review step lists 9.1 alone.
            assert.equal(await continueButton.isDisabled(), true, "Continue was on with an alert");
            assert.equal(await continueButton.getAttribute("aria-describedby"), "continue-blocked");
            assert.equal(await page.locator("#continue-blocked").innerText(), "Fix the items above to continue.");
            assert.deepEqual(await reviewRail(), ["review.check"]);
            assert.equal(
              await page.locator(".rail-progress p").innerText(),
              `Part ${WALKED.length} of ${WALKED.length}`,
            );
            // The alert is the way on: it opens its sub-step, and leaving
            // review.check saves its visit.
            await goTo(page.locator('.alert-item[data-substep="about.address"]'), "about.address");
            pressed = true;
          }

          if (next && !pressed) {
            await waitForQuiet(page);
            await continueButton.click({ timeout: CLICK_MS });
          }
        }
        assert.deepEqual(
          (
            await one(fixture, "select intake_visited from public.cases where id=$1", [own.id])
          ).intake_visited,
          // review.check too: its alert left it.
          [...WALKED].sort(),
          "the server's visits are not the walk",
        );

        // ---- 4b's checks, moving by rail ---------------------------------

        // A trailing space survives a redraw that rebuilds the draft (spec
        // 2026-09-30 §2.5). The draft must not be dirty: a dirty draft is
        // never rebuilt when the revision is unchanged, and would pass
        // without the rule.
        await jump("about.you");
        assert.equal(await answer("tp_middle_name"), "Xia");
        await waitForQuiet(page);
        await box("tp_middle_name").focus();
        // The caret to the end by hand: macOS's End key doesn't move it in a
        // text box, in either engine.
        await page.evaluate(() => {
          const field = document.activeElement;
          field.setSelectionRange(field.value.length, field.value.length);
        });
        await page.keyboard.type(" ");
        assert.doesNotMatch(await chip(), /Unsaved changes/, "a trailing space made the draft dirty");
        await redrawFromElsewhere();
        const spaced = await keyboardNow();
        assert.deepEqual(
          { id: spaced.id, value: spaced.value, caret: spaced.caret },
          { id: "field-client-tp_middle_name", value: "Xia ", caret: 4 },
          "a redraw that rebuilt the draft lost the trailing space or the caret",
        );
        await page.keyboard.type("o");
        assert.equal(await box("tp_middle_name").inputValue(), "Xia o");

        // A rail link after typing: one press, and what was typed is saved.
        await waitForQuiet(page);
        await box("tp_job_title").fill("Teacher");
        await railLink("about.address").click({ timeout: CLICK_MS });
        await waitForSubstep(page, "about.address");
        assert.equal(await answer("tp_job_title"), "Teacher");
        assert.equal(await answer("tp_middle_name"), "Xia o");

        // An office change that lands during a press on a rail link. The
        // redraw waits for the press, so the boxes still say "Teacher" while
        // the draft already says "Librarian": the move must not sweep the
        // stale boxes back over the office's edit.
        await jump("about.you");
        await waitForQuiet(page);
        // Warm the realtime path first: a no-change bump from the office whose
        // re-read is waited for, so the change under the press is not the
        // first one this window has seen in a while (the hold lasts 2 seconds,
        // and a cold delivery in Firefox could outlast it).
        const warmed = page.waitForResponse(
          (response) => response.url().includes("/rest/v1/case_document_cards"),
          { timeout: ARRIVAL_MS },
        );
        await fixture.database.sql("update public.cases set revision = revision + 1 where id=$1", [own.id]);
        await warmed;
        await waitForQuiet(page);
        assert.doesNotMatch(await chip(), /Unsaved changes/, "the draft must be clean for this check");
        await mark("#intake-v2-form", "__beforeOffice");
        const heldLink = railLink("about.address");
        await heldLink.scrollIntoViewIfNeeded();
        const pressAt = await heldLink.boundingBox();
        await page.mouse.move(pressAt.x + pressAt.width / 2, pressAt.y + pressAt.height / 2);
        await page.mouse.down();
        // The re-read a realtime change causes ends with the document cards.
        // The wait is the suite's usual arrival time, not a tight window: a
        // slow realtime delivery is not a failure here. What the check below
        // pins is that the page has not redrawn by the time the re-read is in,
        // which fails by itself if the hold's 2-second safety timer ran out.
        const reread = page.waitForResponse(
          (response) => response.url().includes("/rest/v1/case_document_cards"),
          { timeout: ARRIVAL_MS },
        );
        const pressedAt = Date.now();
        await fixture.database.sql(
          `update public.cases set answers = answers || '{"tp_job_title":"Librarian"}'::jsonb,
             revision = revision + 1 where id=$1`,
          [own.id],
        );
        await reread;
        const rereadMs = Date.now() - pressedAt;
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
        assert.equal(
          await marked("#intake-v2-form", "__beforeOffice"),
          true,
          `the page redrew during the press, so the stale-box case was not reached (the re-read came ${rereadMs} ms into the press; the hold lasts 2000 ms)`,
        );
        assert.equal(await box("tp_job_title").inputValue(), "Teacher");
        await page.mouse.up();
        await waitForSubstep(page, "about.address");
        await waitForQuiet(page);
        assert.equal(
          await answer("tp_job_title"),
          "Librarian",
          "the move wrote the stale box back over the office's edit",
        );
        await jump("about.you");
        assert.equal(await box("tp_job_title").inputValue(), "Librarian");

        // In place on about.you: its note and its rail mark follow the
        // typing, and the note is the same node throughout.
        assert.deepEqual(await rail("about.you"), { className: "rail-status is-done", text: "Done" });
        await waitForQuiet(page);
        await box("tp_first_name").fill("");
        assert.equal((await note("tp_first_name")).text, "Needs an answer");
        assert.match((await rail("about.you")).className, /\bis-needs\b/);
        await waitForQuiet(page);
        await mark("#field-client-tp_first_name-note", "__kept");
        await page.keyboard.type("Mei");
        assert.equal(await box("tp_first_name").inputValue(), "Mei");
        assert.deepEqual(await note("tp_first_name"), { className: "q-note", text: "" });
        assert.deepEqual(await rail("about.you"), { className: "rail-status is-done", text: "Done" });
        assert.equal(
          await marked("#field-client-tp_first_name-note", "__kept"),
          true,
          "typing replaced the note instead of updating it",
        );

        // A long answer's count, with no redraw.
        await jump("notes.anything");
        await waitForQuiet(page);
        await mark("#intake-v2-form", "__beforeLong");
        const notes = box("additional_notes");
        await notes.fill(LONG_NOTE);
        await notes.press("s");
        assert.equal(
          (await page.locator("#field-client-additional_notes-count").textContent()).trim(),
          "4,601 of 5,000 characters",
        );
        assert.equal(await marked("#intake-v2-form", "__beforeLong"), true, "a long answer redrew the page");
        await notes.fill("");

        // Invalid values (spec 2026-09-30 §2.5): leaving with a bad email
        // keeps it out of the save, reveals it and marks the rail.
        await jump("about.you");
        await waitForQuiet(page);
        await box("tp_job_title").fill("Baker");
        await box("email").fill("not-an-email");
        await railLink("about.address").click({ timeout: CLICK_MS });
        await waitForSubstep(page, "about.address");
        await waitForQuiet(page);
        assert.deepEqual(await rail("about.you"), {
          className: "rail-status is-needs",
          text: "Needs answers",
        });
        assert.equal(await chip(), "1 answer needs checking");
        assert.equal(await answer("tp_job_title"), "Baker", "the rest of about.you was not saved");
        assert.equal(await answer("email"), "mei.lin@example.com", "an invalid email reached the server");

        // The gate (design D1, D4): with an invalid email and no city, neither
        // the summary nor Submit is on the rail, and 9.1's Continue waits.
        // (9.3 can't be drawn with an alert. The SUBMIT guard's redirect, for
        // a press on a page drawn before an alert came back, is the
        // controller's guardSubmit and is unit-tested there; its unticked-box
        // refusal is checked at Submit below.)
        await jump("review.check");
        assert.deepEqual(await reviewRail(), ["review.check"]);
        assert.equal(await continueButton.isDisabled(), true, "Continue was on with two alerts");
        assert.equal(await chip(), "1 answer needs checking");

        // review.check lists both, in sub-step order, under the step.
        await jump("review.check");
        await waitForQuiet(page);
        assert.equal(await focused(), "alerts-title", "a rail jump to review.check left the heading");
        assert.deepEqual(await alertsList(), [
          {
            step: "Step 1: About you",
            items: [
              {
                question: "Email (optional)",
                flag: "Needs a change",
                substep: "about.you",
                kind: "alert-item is-invalid",
              },
              {
                question: "City",
                flag: "Needs an answer",
                substep: "about.address",
                kind: "alert-item is-missing",
              },
            ],
          },
        ]);

        // An alert goes to its sub-step, where the note says what to fix.
        await goTo(page.locator('.alert-item.is-invalid[data-substep="about.you"]'), "about.you");
        assert.deepEqual(await note("email"), {
          className: "q-note is-invalid",
          text: "Enter a valid email address.",
        });
        assert.equal(await box("email").inputValue(), "not-an-email");
        const emailNoteHeight = await page
          .locator("#field-client-email-note")
          .evaluate((node) => node.offsetHeight);
        await waitForQuiet(page);
        await mark("#field-client-email-note", "__kept");
        await mark("#intake-v2-form", "__beforeFix");
        await box("email").fill("mei.lin@example.org");
        assert.deepEqual(await note("email"), { className: "q-note", text: "" });
        assert.equal(await marked("#field-client-email-note", "__kept"), true, "fixing the email replaced its note");
        assert.equal(await marked("#intake-v2-form", "__beforeFix"), true, "fixing the email redrew the page");
        assert.match((await rail("about.you")).className, /\bis-done\b/);
        await railLink("about.address").click({ timeout: CLICK_MS });
        await waitForSubstep(page, "about.address");
        assert.equal(await answer("email"), "mei.lin@example.org");
        await waitForQuiet(page);
        assert.doesNotMatch(await chip(), /checking/);

        // ---- Documents (spec 2026-10-04 §6) ------------------------------
        await jump("documents.identity");
        const photo = page.locator("#doc-photo_id-tp");
        assert.deepEqual(
          await photo.evaluate((card) =>
            [...card.querySelectorAll(".doc-upload button")].map((button) => ({
              text: button.textContent.trim(),
              disabled: button.disabled,
              note: document.getElementById(button.getAttribute("aria-describedby"))?.textContent.trim() ?? null,
            })),
          ),
          ["Take a photo", "Choose a file"].map((text) => ({
            text,
            disabled: true,
            note: "Uploading arrives soon. For now, bring it or mark it below.",
          })),
        );
        assert.deepEqual(await cardStatus("photo_id.tp"), {
          className: "doc-status is-not_done",
          text: "Status: Not done",
        });
        assert.deepEqual(await rail("documents.identity"), {
          className: "rail-status is-docs",
          text: "Needs documents",
        });
        assert.equal(await cardRow(fixture, own.id, "photo_id.tp"), null);
        // "Later" for one Needed card: the other still owes, so the mark stays.
        await markCard("photo_id.tp", "later", "Later");
        await waitForQuiet(page);
        assert.equal(await focused(), "doc-photo_id-tp-status", "a mark left the keyboard off its status");
        assert.deepEqual(await cardRow(fixture, own.id, "photo_id.tp"), {
          slot_id: "photo_id.tp",
          status: "later",
          group_override: null,
        });
        assert.deepEqual(await rail("documents.identity"), {
          className: "rail-status is-docs",
          text: "Needs documents",
        });
        // Every Needed card marked: Done.
        await markCard("ssn.tp", "none", "Don't have");
        await railReads("documents.identity", "Done");
        assert.deepEqual(await rail("documents.identity"), { className: "rail-status is-done", text: "Done" });
        // "Mark as not done" puts it back: the row stays, with no status.
        await markCard("ssn.tp", "not_done", "Not done");
        await railReads("documents.identity", "Needs documents");
        assert.deepEqual(await cardRow(fixture, own.id, "ssn.tp"), {
          slot_id: "ssn.tp",
          status: null,
          group_override: null,
        });
        // The Maybe needed group opens in place, and keeps the keyboard.
        const maybeToggle = page.locator('[data-action="toggle-panel"][data-panel="maybe:documents.identity"]');
        assert.equal(await maybeToggle.getAttribute("aria-expanded"), "false");
        await waitForQuiet(page);
        await maybeToggle.click({ timeout: CLICK_MS });
        await waitFor(
          page,
          "the Maybe needed cards",
          () =>
            document
              .querySelector('[data-panel="maybe:documents.identity"]')
              ?.getAttribute("aria-expanded") === "true" &&
            Boolean(document.querySelector('.doc-maybe .doc-card[data-slot^="ssn.hh."]')),
          undefined,
          RENDER_MS,
        );
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset.panel ?? null),
          "maybe:documents.identity",
        );
        await shoot(page, "intake-v2-documents");

        // ---- Review & submit (spec 2026-10-04 §5) ------------------------
        await jump("review.check");
        assert.deepEqual(await alertsList(), [
          {
            step: "Step 1: About you",
            items: [
              {
                question: "City",
                flag: "Needs an answer",
                substep: "about.address",
                kind: "alert-item is-missing",
              },
            ],
          },
        ]);
        const warnings = await warningsList();
        assert.equal(warnings.heading, "You can still submit");
        assert.deepEqual(
          warnings.items.find((item) => item.focus === "doc-photo_id-tp"),
          {
            label: "Photo ID (driver's license, state ID, passport)",
            detail: `${await answer("tp_first_name")} ${await answer("tp_last_name")} · Later`,
            focus: "doc-photo_id-tp",
          },
          "the Later card is not under You can still submit",
        );
        await shoot(page, "intake-v2-review-check");
        // "Upload now" lands on the card itself.
        await goTo(
          page.locator('.warning-item [data-focus="doc-photo_id-tp"]'),
          "documents.identity",
        );
        await waitForQuiet(page);
        assert.equal(await focused(), "doc-photo_id-tp", "Upload now did not land on its card");
        await jump("review.check");
        await goTo(page.locator('.alert-item[data-substep="about.address"]'), "about.address");
        assert.deepEqual(await note("addr_city"), {
          className: "q-note is-missing",
          text: "Needs an answer",
        });
        await waitForQuiet(page);
        await box("addr_city").fill("Philadelphia");
        assert.deepEqual(await rail("about.address"), { className: "rail-status is-done", text: "Done" });
        await jump("review.check");
        assert.deepEqual(await alertsList(), [], "an alert outlived its fix");

        // With nothing wrong, Continue on 9.1 opens the summary, and the rail
        // lists it; Continue on 9.2 earns 9.3.
        assert.deepEqual(await reviewRail(), ["review.check", "review.summary"]);
        await goTo(continueButton, "review.summary");
        assert.deepEqual(await reviewRail(), ["review.check", "review.summary"], "9.3 before Continue on 9.2");
        await goTo(continueButton, "review.submit");
        assert.deepEqual(await reviewRail(), ["review.check", "review.summary", "review.submit"]);
        assert.ok(
          (await one(fixture, "select intake_visited from public.cases where id=$1", [own.id])).intake_visited.includes("review.submit"),
          "the earned 9.3 was not saved",
        );

        // Submit: on only with the box ticked. Its guard re-checks the draft
        // itself: an unticked box is refused even when Submit is turned on by
        // hand, the one way to reach that state on purpose.
        const forceSubmit = async () => {
          await waitForQuiet(page);
          await submitButton.evaluate((button) => {
            button.disabled = false;
          });
          await submitButton.click({ timeout: CLICK_MS });
        };
        assert.equal(await confirmBox.isChecked(), false);
        assert.equal(await submitButton.isDisabled(), true, "Submit was on before the box was ticked");
        await forceSubmit();
        await waitFor(
          page,
          "the unconfirmed Submit to be refused",
          () =>
            document.querySelector("#toast")?.textContent.trim() ===
            "Confirm that you have checked your answers first.",
          undefined,
          RENDER_MS,
        );
        assert.equal(
          await page.evaluate(() => document.querySelector("#toast")?.dataset.kind),
          "warning",
          "the unconfirmed Submit's toast is not a warning",
        );
        assert.equal(await here(), "review.submit", "an unconfirmed Submit moved the form");
        assert.equal((await caseById(fixture, own.id)).stage, "draft", "an unconfirmed Submit was sent");
        await tickBox(page, "field-confirmed");
        assert.equal(await submitButton.isDisabled(), false, "Submit stayed off with nothing wrong");
        await waitForQuiet(page);
        await confirmBox.click({ timeout: CLICK_MS });
        await confirmTicked(false);
        assert.equal(await submitButton.isDisabled(), true, "Submit was on with the box unticked");
        await tickBox(page, "field-confirmed");
        assert.equal(await submitButton.isDisabled(), false);

        // ---- The summary page (design D6-D8) ------------------------------
        await jump("review.summary");
        const order = await page.evaluate(() =>
          [...document.querySelectorAll("#intake-v2-form > div, #intake-v2-form > p")].map((node) => node.className || node.id),
        );
        assert.deepEqual(
          order.filter((name) => ["summary-intro", "summary-tools", "summary-fold", "summary-print"].includes(name)),
          ["summary-intro", "summary-tools", "summary-fold", "summary-print"],
          "the summary page's order",
        );
        assert.equal(
          await page.locator(".summary-intro p").first().innerText(),
          "Here is a summary of everything you told us in your application.",
        );
        // One section folds from its heading, and the keyboard stays on it.
        const aboutToggle = page.locator('.summary-toggle[data-panel="summary-shut:about"]');
        await waitForQuiet(page);
        await aboutToggle.click({ timeout: CLICK_MS });
        await waitFor(
          page,
          "About you to collapse",
          () => document.getElementById("summary-body-about")?.hidden === true,
          undefined,
          RENDER_MS,
        );
        assert.equal(await aboutToggle.getAttribute("aria-expanded"), "false");
        assert.equal(
          await page.evaluate(() => document.activeElement?.dataset.panel ?? null),
          "summary-shut:about",
        );
        // The Print button's printout shows it anyway. The press sets
        // body.print-summary and opens the print dialog, which a story can't
        // close, so the class is set by hand under print media instead.
        await page.evaluate(() => document.body.classList.add("print-summary"));
        await page.emulateMedia({ media: "print" });
        assert.deepEqual(
          await page.evaluate(() => {
            const body = document.getElementById("summary-body-about");
            return { display: getComputedStyle(body).display, shown: body.offsetHeight > 0 };
          }),
          { display: "block", shown: true },
          "a collapsed section does not print",
        );
        await page.emulateMedia({ media: "screen" });
        await page.evaluate(() => document.body.classList.remove("print-summary"));
        // Collapse all and Expand all, each keeping the keyboard.
        for (const [button, hidden] of [["summary-collapse-all", true], ["summary-expand-all", false]]) {
          await waitForQuiet(page);
          await page.locator(`#${button}`).click({ timeout: CLICK_MS });
          await waitFor(
            page,
            `every section to be ${hidden ? "collapsed" : "expanded"}`,
            (wanted) => [...document.querySelectorAll(".summary-body")].every((body) => body.hidden === wanted),
            hidden,
            RENDER_MS,
          );
          assert.equal(await focused(), button, `${button} lost the keyboard`);
        }
        // The fold is kept while moving: collapse About you, Change, come back.
        await waitForQuiet(page);
        await aboutToggle.click({ timeout: CLICK_MS });
        await waitFor(page, "About you to collapse again", () => document.getElementById("summary-body-about")?.hidden === true, undefined, RENDER_MS);
        await goTo(page.locator('.summary-print [data-action="change-substep"][data-substep="income.wages"]'), "income.wages");
        await goTo(page.locator('[data-action="back-to-summary"]'), "review.summary");
        assert.equal(await page.evaluate(() => document.getElementById("summary-body-about")?.hidden), true, "the fold was lost");
        await waitForQuiet(page);
        await aboutToggle.click({ timeout: CLICK_MS });
        await waitFor(page, "About you to expand", () => document.getElementById("summary-body-about")?.hidden === false, undefined, RENDER_MS);

        // An alert brought back from a Change: "Back to summary" lands on 9.1,
        // and 9.2 and 9.3 hide until it is fixed (brainstorm Q2-A).
        await goTo(page.locator('.summary-print [data-action="change-substep"][data-substep="about.address"]'), "about.address");
        await waitForQuiet(page);
        await box("addr_city").fill("");
        await goTo(page.locator('[data-action="back-to-summary"]'), "review.check");
        assert.deepEqual(await reviewRail(), ["review.check"]);
        await goTo(page.locator('.alert-item[data-substep="about.address"]'), "about.address");
        await waitForQuiet(page);
        await box("addr_city").fill("Philadelphia");
        await jump("review.check");
        assert.deepEqual(await reviewRail(), ["review.check", "review.summary", "review.submit"], "the fix did not bring 9.2 and 9.3 back");
        await jump("review.summary");
        await goTo(
          page.locator('.summary-print [data-action="change-substep"][data-substep="about.address"]'),
          "about.address",
        );
        assert.equal(await continueButton.count(), 0, "Continue is still offered during a Change");
        await goTo(page.locator('[data-action="back-to-summary"]'), "review.summary");
        // Enter in the one text box of a sub-step submits the form: during a
        // Change it goes back to the summary too, not on to the next part.
        await goTo(
          page.locator('.summary-print [data-action="change-substep"][data-substep="income.wages"]'),
          "income.wages",
        );
        await waitForQuiet(page);
        await box("inc_wages_job_count").focus();
        await page.keyboard.press("Enter");
        await waitForSubstep(page, "review.summary");
        await shoot(page, "intake-v2-summary");

        // ---- Show-if, a fill that follows the draft, and the senior switch
        await jump("about.marital");
        // A recently widowed client (add-widowed-spouse-rules): a 2025 death
        // brings "Your late spouse" with the job title and no phone; 2015 takes
        // the sub-step away again. The year redraws on change, as a signature does.
        await choose("marital_status", "widowed");
        await waitFor(page, "the death year", () => Boolean(document.querySelector("#field-client-spouse_death_year")), undefined, RENDER_MS);
        await box("spouse_death_year").fill("2025");
        await page.keyboard.press("Tab");
        await waitFor(
          page,
          "the rail to list Your late spouse",
          () => document.querySelector('.rail-sublink[data-substep="about.spouse"] .rail-subtitle')?.textContent.trim() === "Your late spouse",
          undefined,
          RENDER_MS,
        );
        await jump("about.spouse");
        await waitForQuiet(page);
        assert.equal(
          await page.evaluate(() => document.querySelector(".page-intro h1")?.textContent.trim()),
          "Your late spouse",
        );
        assert.equal(await box("sp_job_title").count(), 1, "a 2025 death asks the job title");
        assert.equal(await box("sp_phone").count(), 0, "a late spouse has no phone");
        await jump("about.marital");
        await waitForQuiet(page);
        await box("spouse_death_year").fill("2015");
        await page.keyboard.press("Tab");
        await waitFor(page, "the late spouse to leave the rail", () => !document.querySelector('.rail-sublink[data-substep="about.spouse"]'), undefined, RENDER_MS);
        await choose("marital_status", "married");
        await waitFor(
          page,
          "the married questions",
          () => Boolean(document.querySelector("#field-client-married_last_day-yes")),
          undefined,
          RENDER_MS,
        );
        await clickAction(page, "fill-fictional");
        await waitFor(
          page,
          "the married questions to be filled",
          () => document.querySelector("#field-client-married_last_day-yes")?.checked === true,
          undefined,
          RENDER_MS,
        );
        assert.notEqual(await rail("about.spouse"), null, "a married client's rail has no spouse");

        // Married now: the wages lead and Q9.1a name the spouse again.
        await jump("income.wages");
        // The move saved the second Fill: it kept the client's own Form
        // 14446 consent and signature.
        assert.deepEqual(
          [JSON.parse((await answer("vc_agree")) ?? "null"), await answer("vc_review"), await answer("vc_tp_signature")],
          [["yes"], "yes", walkSignature],
          "Fill fictional details changed the client's Form 14446 answers",
        );
        await waitFor(
          page,
          "the married wages lead",
          () => document.querySelector("#intake-v2-form .q-lead")?.textContent.trim() === "Did you or your spouse receive any of these in 2025?",
          undefined,
          RENDER_MS,
        );
        assert.ok(
          (await page.evaluate(() => document.querySelector('[data-q="inc_wages_job_count"] .q-label')?.textContent.trim() ?? "")).startsWith(
            "How many jobs did you and your spouse have in 2025?",
          ),
          "a married client's Q9.1a names the spouse",
        );

        // Married: Q5.3 is the "who" question again, with three check boxes.
        await jump("about.situation");
        await waitFor(
          page,
          "the married Q5.3 check boxes",
          () => document.querySelectorAll('[data-q="us_citizen"] input[type="checkbox"]').length === 3,
          undefined,
          RENDER_MS,
        );
        assert.ok(
          (await page.evaluate(() => document.querySelector('[data-q="us_citizen"] .q-label')?.textContent.trim() ?? "")).startsWith(
            "Who is a U.S. citizen?",
          ),
        );

        // A household member's middle name sits between first and last name
        // (change require-15080-signatures-and-household-middle-name).
        await jump("household.members");
        await waitFor(
          page,
          "the first member's middle-name box",
          () => Boolean(document.querySelector('[data-q="hh"][data-member="0"][data-sub="middle_name"]')),
          undefined,
          RENDER_MS,
        );
        assert.deepEqual(
          await page.evaluate(() =>
            [...document.querySelectorAll('[data-q="hh"][data-member="0"][data-sub]')]
              .map((el) => el.dataset.sub)
              .filter((sub) => sub !== "member_id")
              .slice(0, 3),
          ),
          ["first_name", "middle_name", "last_name"],
        );
        await page.locator('[data-q="hh"][data-member="0"][data-sub="middle_name"]').fill("Q");
        await page.keyboard.press("Tab");
        // A version-2 draft is saved by the move to another sub-step, not by
        // leaving a box, so the server is read after the move.
        await jump("notes.anything");
        assert.equal(JSON.parse(await answer("hh"))[0].middle_name, "Q");

        await jump("refund.consent");
        const consentWording = (wanted) =>
          waitFor(
            page,
            `the consent question to read ${JSON.stringify(wanted)}`,
            (text) =>
              document.querySelector('[data-q="gcf_consent"] legend')?.textContent.trim() === text,
            wanted,
            RENDER_MS,
          );
        const senior = page.locator('[data-action="toggle-senior"]');
        await consentWording("Do you consent to this disclosure?");
        await clickAction(page, "toggle-senior");
        await consentWording("Do you agree to let your tax information be shared this way?");
        assert.equal(await senior.getAttribute("aria-pressed"), "true");
        await shoot(page, "intake-v2-senior");
        await clickAction(page, "toggle-senior");
        await consentWording("Do you consent to this disclosure?");
        assert.equal(await senior.getAttribute("aria-pressed"), "false");

        // The spouse's signature is the one text answer that shows another
        // question: leaving it is the change that redraws.
        await choose("gcf_consent", "yes");
        await waitFor(
          page,
          "both signature boxes",
          () =>
            Boolean(document.querySelector("#field-client-gcf_tp_signature")) &&
            Boolean(document.querySelector("#field-client-gcf_sp_signature")),
          undefined,
          RENDER_MS,
        );
        await waitForQuiet(page);
        // Consenting with only the primary signature leaves the sub-step
        // Needs answers: a married client's spouse signs too.
        await box("gcf_tp_signature").fill("Mei Lin");
        await page.keyboard.press("Tab");
        await jump("notes.anything");
        assert.deepEqual(await rail("refund.consent"), { className: "rail-status is-needs", text: "Needs answers" });
        await jump("refund.consent");
        await box("gcf_sp_signature").fill("Wei Lin");
        assert.equal(
          await page.locator('[data-q="gcf_sp_date"]').count(),
          0,
          "the spouse's date was on the page before any redraw",
        );
        await page.keyboard.press("Tab");
        await waitFor(
          page,
          "the spouse's date",
          () => Boolean(document.querySelector('[data-q="gcf_sp_date"]')),
          undefined,
          RENDER_MS,
        );
        await jump("notes.anything");
        assert.equal(await answer("gcf_consent"), "yes");
        assert.equal(await answer("gcf_sp_signature"), "Wei Lin");
        assert.deepEqual(await rail("refund.consent"), { className: "rail-status is-done", text: "Done" });

        // ---- Visits follow the client (spec 2026-10-04 §3.7) -------------
        // A fresh sign-in in its own context has no window record: the rail
        // comes from the server's visits, and the case opens at the first
        // sub-step that isn't Done: the spouse's new document cards, because
        // the widowed walk above already opened the spouse part.
        await waitForQuiet(page);
        assert.doesNotMatch(await chip(), /Unsaved|checking/, "the draft must be saved for this check");
        const marksHere = await railMarks();
        againWin = await openWindow(clientEngine);
        await loginTestUser({ page: againWin.page, actor: applicantB, fixture });
        await waitForQuiet(againWin.page);
        await againWin.page
          .locator(`.application-row:has-text("${reference}")`)
          .first()
          .click({ timeout: CLICK_MS });
        await waitForSubstep(againWin.page, "documents.identity");
        await waitForQuiet(againWin.page);
        assert.deepEqual(
          await againWin.page.evaluate(() =>
            Object.fromEntries(
              [...document.querySelectorAll('.rail-tree [id^="rail-"][id$="-status"]')].map(
                (span) => [span.id, `${span.className} | ${span.textContent.trim()}`],
              ),
            ),
          ),
          marksHere,
          "a fresh window's rail is not the one this window shows",
        );
        const againConsole = assertConsoleQuiet(againWin, {
          name: "second version-2 window",
          allow: [],
        });
        await againWin.context.close();
        againWin = null;

        // ---- The client's drafts: the Form 14446 only (hide-draft-13614c-from-clients)
        // Chrome only: Firefox may download a blob PDF instead of opening it
        // in the tab, which leaves nothing for a check to read.
        let draft = "not run: the client engine is Firefox, which may download the PDF instead of opening it";
        if (roles.client === "chrome") {
          draft = {};
          // The fonts come from the packages npm installed, never the internet.
          const fontHits = Object.fromEntries(Object.keys(DRAFT_FONT_FIXTURES).map((url) => [url, 0]));
          const fontBytes = {};
          const wrongFont = {};
          const strayRequests = [];
          await page.route("https://cdn.jsdelivr.net/**", (route) => {
            strayRequests.push(route.request().url());
            return route.abort();
          });
          for (const [url, file] of Object.entries(DRAFT_FONT_FIXTURES)) {
            fontBytes[url] = await readFile(path.join(ROOT, file.path));
            await page.route(url, (route) => {
              fontHits[url] += 1;
              return route.fulfill({
                status: 200,
                headers: { "content-type": "font/ttf", "access-control-allow-origin": "*" },
                body: wrongFont[url] ?? fontBytes[url],
              });
            });
          }
          const hitsSince = (before) =>
            Object.fromEntries(
              Object.entries(fontHits).map(([url, n]) => [url.split("/").at(-1), n - before[url]]),
            );
          // Presses a Form 14446 button and returns its tab, still open, for
          // the check to read.
          const press14446 = async (form) => {
            await waitForQuiet(page);
            const opened = page.waitForEvent("popup", { timeout: CLICK_MS });
            await page
              .locator(`[data-action="view-draft"][data-draft="14446"][data-form="${form}"]`)
              .click({ timeout: CLICK_MS });
            return await opened;
          };
          const readDraft = async (popup) => {
            await popup.waitForURL(/^blob:/, { timeout: ARRIVAL_MS });
            return await popup.evaluate(async () => {
              const bytes = new Uint8Array(await (await fetch(location.href)).arrayBuffer());
              return { head: String.fromCharCode(...bytes.slice(0, 5)), size: bytes.length };
            });
          };
          const tabSays = (popup, text) =>
            waitFor(
              popup,
              `the draft tab to say ${JSON.stringify(text)}`,
              (wanted) => document.body?.textContent.trim() === wanted,
              text,
              ARRIVAL_MS,
            );
          // A draft that couldn't be built is an error: the problem banner
          // says so, never the toast.
          const bannerSays = (text) =>
            waitFor(
              page,
              `the problem banner to say ${JSON.stringify(text)}`,
              (wanted) => document.querySelector(".problem-banner")?.textContent.includes(wanted),
              text,
              ARRIVAL_MS,
            );
          const toastShows = (text) =>
            page.evaluate((wanted) => document.querySelector("#toast")?.textContent.includes(wanted) ?? false, text);
          const pressBanner = async (action) => {
            await waitForQuiet(page);
            await page.locator(`.problem-banner [data-action="${action}"]`).click({ timeout: CLICK_MS });
          };

          await jump("review.summary");
          // A client is offered no draft 13614-C: every draft button on 9.2
          // is the Form 14446's, and a 13614-C button forged into the page
          // opens no tab, offers no link and raises no banner.
          await waitForQuiet(page);
          assert.equal(await page.locator('[data-action="view-draft"]:not([data-draft="14446"])').count(), 0, "9.2 offers a draft 13614-C");
          await page.evaluate(() => {
            const forged = document.createElement("button");
            forged.type = "button"; forged.id = "forged-13614c";
            forged.dataset.action = "view-draft"; forged.dataset.form = "en";
            document.querySelector(".summary-tools").append(forged);
          });
          const forgedPopup = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null);
          await page.locator("#forged-13614c").click({ timeout: CLICK_MS });
          assert.equal(await forgedPopup, null, "a forged 13614-C button opened a tab on a client page");
          assert.equal(await page.locator("#draft-ready a, .problem-banner").count(), 0);
          draft.forged = "a forged 13614-C button opened nothing";

          let before;
          let popup;

          // The draft Form 14446 (add-form-14446-consent): PCDC's three-page
          // form, its page 3 filled from the answers. The flattened page is
          // read back here: in Latin letters, the printed name and the typed
          // signature are drawn in Helvetica, so their text can be found.
          const signedName = await answer("vc_tp_signature");
          assert.equal(signedName, walkSignature);
          const printedName = (
            await Promise.all(["tp_first_name", "tp_middle_name", "tp_last_name"].map((key) => answer(key)))
          )
            .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" ");
          const open14446 = async (form) => {
            await waitForQuiet(page);
            const opened = page.waitForEvent("popup", { timeout: CLICK_MS });
            await page
              .locator(`[data-action="view-draft"][data-draft="14446"][data-form="${form}"]`)
              .click({ timeout: CLICK_MS });
            const tab = await opened;
            const bytes = await draftBytes(tab);
            await tab.close();
            return { head: bytes.subarray(0, 5).toString("latin1"), size: bytes.length, ...(await draftPageText(bytes, 2)) };
          };
          before = { ...fontHits };
          const en14446 = await open14446("en");
          assert.equal(en14446.head, "%PDF-");
          assert.equal(en14446.pages, 3, "the English draft 14446 is not PCDC's three pages");
          assert.ok(en14446.strings.includes(printedName), `page 3 of the English 14446 does not print ${JSON.stringify(printedName)}: ${JSON.stringify(en14446.strings)}`);
          assert.ok(en14446.strings.includes(signedName), `page 3 of the English 14446 does not print the signature: ${JSON.stringify(en14446.strings)}`);
          assert.deepEqual(Object.values(hitsSince(before)), [0, 0, 0], "an English draft 14446 fetched a font");
          draft.form14446 = { en: { size: en14446.size, pages: en14446.pages, page3: "printed name and signature found" } };

          // A Chinese first name (fictional), so the Chinese font path runs.
          await jump("about.you");
          await waitForQuiet(page);
          await box("tp_first_name").fill("美");
          await jump("review.summary");
          assert.equal(await answer("tp_first_name"), "美");

          // The 繁體 draft 14446 with the Chinese first name: the name is
          // drawn in the downloaded 繁體 font (so that font is fetched, which
          // only a name needing it does), and the Latin signature is still
          // readable on page 3.
          before = { ...fontHits };
          const zh14446 = await open14446("zh-t");
          assert.equal(zh14446.head, "%PDF-");
          assert.equal(zh14446.pages, 3, "the 繁體 draft 14446 is not PCDC's three pages");
          assert.ok(zh14446.strings.includes(signedName), `page 3 of the 繁體 14446 does not print the signature: ${JSON.stringify(zh14446.strings)}`);
          assert.deepEqual(
            hitsSince(before),
            { "NotoSansSC_400Regular.ttf": 0, "NotoSansTC_400Regular.ttf": 1, "NotoSans_400Regular.ttf": 1 },
            "the 繁體 draft 14446 fetched the wrong fonts",
          );
          draft.form14446["zh-t"] = { size: zh14446.size, pages: zh14446.pages, page3: "signature found; the Chinese name drawn in the 繁體 font" };

          // A simplified first name the 繁體 font lacks (陈, fictional; issue
          // #81): the 繁體 14446 still builds, printed as typed, and only now
          // is the Simplified font fetched, after TC and Latin. Then back to 美.
          await jump("about.you");
          await waitForQuiet(page);
          await box("tp_first_name").fill("陈");
          await jump("review.summary");
          assert.equal(await answer("tp_first_name"), "陈");
          before = { ...fontHits };
          const simplified14446 = await open14446("zh-t");
          assert.equal(simplified14446.head, "%PDF-");
          assert.equal(simplified14446.pages, 3, "the 繁體 draft 14446 with 陈 is not PCDC's three pages");
          assert.ok(simplified14446.strings.includes(signedName), `page 3 of the 繁體 14446 with 陈 does not print the signature: ${JSON.stringify(simplified14446.strings)}`);
          assert.deepEqual(
            hitsSince(before),
            { "NotoSansSC_400Regular.ttf": 1, "NotoSansTC_400Regular.ttf": 1, "NotoSans_400Regular.ttf": 1 },
            "the 繁體 draft 14446 with 陈 fetched the wrong fonts",
          );
          draft.form14446["zh-t simplified"] = { size: simplified14446.size, pages: simplified14446.pages, fonts: "TC, SC and Latin, each once" };
          await jump("about.you");
          await waitForQuiet(page);
          await box("tp_first_name").fill("美");
          await jump("review.summary");
          assert.equal(await answer("tp_first_name"), "美");

          // A font whose bytes are not the pinned ones is refused: the 繁體
          // 14446, built with the Chinese name, fetches the Latin font too.
          const latin = Object.keys(DRAFT_FONT_FIXTURES).find((url) => url.endsWith("/NotoSans_400Regular.ttf"));
          wrongFont[latin] = Buffer.from("not the pinned font");
          popup = await press14446("zh-t");
          await tabSays(popup, DRAFT_FAILED);
          await bannerSays(DRAFT_FONT_UNCHECKED);
          assert.equal(await toastShows(DRAFT_FONT_UNCHECKED), false, "the font failure was toasted");
          await popup.close();
          await pressBanner("dismiss-error");
          await waitFor(page, "Dismiss to clear the font failure", () => !document.querySelector(".problem-banner"), undefined, RENDER_MS);
          delete wrongFont[latin];
          draft.fontMismatch = DRAFT_FONT_UNCHECKED;

          // The 14446's form itself refused: the tab and the problem banner
          // say so, and the banner's Try again builds the same 14446 again.
          // The English 14446 fetches no font (asserted above), so only the
          // form can fail it. Chrome logs the refused request as one console
          // error; that one line is caught here and excused by its place, and
          // nothing else this check logs is (the retry logs nothing).
          const formUrl = `${fixture.appOrigin}/src/forms/f14446-pcdc-en.pdf`;
          const refusedForm = /^Failed to load resource: the server responded with a status of 500\b/;
          await page.route(formUrl, (route) => route.fulfill({ status: 500, body: "refused" }));
          const from = v2Win.errors.length;
          const logged = page.waitForEvent("console", {
            predicate: (message) => message.type() === "error" && refusedForm.test(message.text()),
            timeout: ARRIVAL_MS,
          });
          popup = await press14446("en");
          await tabSays(popup, DRAFT_FAILED);
          // Read on the failed tab, not while it is prepared (that would race
          // the build).
          assert.equal(await popup.title(), "Draft Form 14446");
          await bannerSays(DRAFT_NOT_MADE);
          assert.equal(await toastShows(DRAFT_NOT_MADE), false, "the draft failure was toasted");
          await logged;
          await popup.close();
          await page.unroute(formUrl);
          // Try again rebuilds it inside the press: a new tab, or (blocked)
          // the link; either way the banner goes.
          const retried = page.waitForEvent("popup", { timeout: ARRIVAL_MS }).catch(() => null);
          await pressBanner("retry-action");
          const again = await retried;
          if (again) {
            assert.equal((await readDraft(again)).head, "%PDF-", "Try again did not rebuild the 14446");
            await again.close();
          } else {
            await page.locator("#draft-ready-link").waitFor({ state: "visible", timeout: ARRIVAL_MS });
          }
          await waitFor(page, "the draft error to clear", () => !document.querySelector(".problem-banner"), undefined, ARRIVAL_MS);
          draft.retried = again ? "Try again opened the rebuilt draft in a new tab" : "Try again offered the rebuilt draft as a link";
          const caused = v2Win.errors.slice(from);
          assert.equal(caused.length, 1, `the refused form logged ${caused.length} console errors`);
          assert.match(caused[0], refusedForm);
          excused.add(from);
          draft.failure = DRAFT_FAILED;

          // A blocked tab: the page offers the finished 14446 as a link.
          await page.evaluate(() => {
            window.__vitallyOpen = window.open;
            window.open = () => null;
          });
          await waitForQuiet(page);
          await page.locator('[data-action="view-draft"][data-draft="14446"][data-form="zh-t"]').click({ timeout: CLICK_MS });
          await waitFor(
            page,
            "the draft link",
            () => Boolean(document.querySelector("#draft-ready a")),
            undefined,
            ARRIVAL_MS,
          );
          draft.blocked = await page.evaluate(() => {
            const link = document.querySelector("#draft-ready a");
            return { text: link.textContent.trim(), download: link.download, blob: link.href.startsWith("blob:") };
          });
          await page.evaluate(() => {
            window.open = window.__vitallyOpen;
          });
          assert.deepEqual(draft.blocked, {
            text: "Your draft is ready: open it",
            download: `14446-draft-${reference}-zh-t.pdf`,
            blob: true,
          });
          // The link outlives a redraw from elsewhere, and so does the
          // keyboard on it: it is drawn again after every render, with the
          // id the render's focus restore looks for. Nothing opens the PDF.
          await waitForQuiet(page);
          await page.locator("#draft-ready-link").focus({ timeout: CLICK_MS });
          assert.equal(
            await page.evaluate(() => document.activeElement?.id ?? null),
            "draft-ready-link",
            "the draft link did not take the keyboard",
          );
          await redrawFromElsewhere();
          draft.blockedAfterRedraw = await page.evaluate(() => ({
            link: document.querySelector("#draft-ready #draft-ready-link")?.textContent.trim() ?? null,
            focused: document.activeElement?.id ?? null,
          }));
          assert.deepEqual(
            draft.blockedAfterRedraw,
            { link: "Your draft is ready: open it", focused: "draft-ready-link" },
            "a redraw from elsewhere took the draft link or the keyboard on it",
          );
          assert.deepEqual(strayRequests, [], "the draft reached for a CDN file it was not given");
          await page.unrouteAll({ behavior: "wait" });
        }

        // ---- Same-day (spec 2026-10-04 §6.7) -----------------------------
        await jump("before.service");
        await choose("service", "same_day");
        // The radio is ticked before the redraw it asks for: wait for the rail.
        await waitFor(
          page,
          "the rail to list the same-day documents step",
          () => Boolean(document.querySelector('#rail-subs-documents [data-substep="documents.bring"]')),
          undefined,
          RENDER_MS,
        );
        await waitForQuiet(page);
        assert.deepEqual(
          await page.evaluate(() =>
            [...document.querySelectorAll("#rail-subs-documents .rail-sublink")].map((link) => ({
              substep: link.dataset.substep,
              title: link.querySelector(".rail-subtitle")?.textContent.trim() ?? null,
            })),
          ),
          [{ substep: "documents.bring", title: "Bring these to your visit" }],
          "a same-day client's step 7 is not the one list",
        );
        await jump("documents.bring");
        assert.deepEqual(
          await page.evaluate(() => ({
            items: document.querySelectorAll("#intake-v2-form .bring-list li").length,
            buttons: document.querySelectorAll("#intake-v2-form .bring-list button").length,
            marks: document.querySelectorAll('[data-action="mark-card"]').length,
            statuses: document.querySelectorAll(".doc-status").length,
          })),
          { items: 7, buttons: 0, marks: 0, statuses: 0 },
        );
        await jump("review.check");
        assert.equal(
          await page.locator(".warnings-block").count(),
          0,
          "a same-day client is warned about documents",
        );
        await jump("before.service");
        await choose("service", "drop_off");

        // ---- Submit, and the open documents on the progress page ---------
        await jump("review.submit");
        if (!(await confirmBox.isChecked())) await tickBox(page, "field-confirmed");
        assert.equal(await submitButton.isDisabled(), false, "Submit stayed off with nothing wrong");
        await waitForQuiet(page);
        await submitButton.click({ timeout: CLICK_MS });
        await waitFor(
          page,
          "the client number on the progress page",
          () =>
            [...document.querySelectorAll(".id-pill > div")].some(
              (part) =>
                part.querySelector("small")?.textContent.trim() === "CLIENT NUMBER" &&
                part.querySelector("strong")?.textContent.trim(),
            ),
          undefined,
          ARRIVAL_MS,
        );
        const submitted = await caseById(fixture, own.id);
        assert.equal(submitted.stage, "received");
        assert.equal(submitted.answers.gcf_consent, "yes");
        assert.equal(submitted.answers.gcf_tp_signature, "Mei Lin");
        assert.equal(submitted.answers.gcf_sp_signature, "Wei Lin");
        assert.deepEqual(submitted.answers.vc_agree, ["yes"]);
        assert.equal(submitted.answers.vc_review, "yes");
        assert.equal(submitted.answers.vc_tp_signature, walkSignature);
        assert.match(submitted.answers.vc_tp_date ?? "", /^\d{4}-\d{2}-\d{2}$/, "the Form 14446 date was not saved");
        const clientNumber = (
          await page
            .locator(".id-pill > div")
            .filter({ has: page.locator("small", { hasText: "CLIENT NUMBER" }) })
            .locator("strong")
            .innerText()
        ).trim();
        assert.match(clientNumber, /^#\d{3,}$/);
        const openSlots = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".open-documents .doc-card")].map((card) => card.dataset.slot),
          );
        assert.deepEqual(await openSlots(), [...OPEN_DOCUMENTS]);
        // Marked here too: "Later" stays listed and keeps the keyboard on
        // its status; "Don't have" leaves the list, and the keyboard goes to main.
        await markCard("w2.household", "later", "Later");
        await waitForQuiet(page);
        assert.equal(await focused(), "doc-w2-household-status");
        await waitForQuiet(page);
        await page
          .locator('[data-action="mark-card"][data-slot="bank.household"][data-status="none"]')
          .click({ timeout: CLICK_MS });
        await waitFor(
          page,
          "the bank card to leave the open documents",
          () => !document.querySelector('.open-documents [data-slot="bank.household"]'),
          undefined,
          ARRIVAL_MS,
        );
        await waitForQuiet(page);
        assert.equal(await focused(), "main");
        assert.deepEqual(await cardRow(fixture, own.id, "bank.household"), {
          slot_id: "bank.household",
          status: "none",
          group_override: null,
        });
        await shoot(page, "intake-v2-progress");
        evidence.story.versionTwo = {
          intakeVersion: 2,
          walked: V2_WALK.length,
          emailNoteHeight,
          clientNumber,
          submitted: "consent and both signatures saved before the submit, with the Form 14446 consent and signature",
          openDocuments: await openSlots(),
          draft,
          secondWindowConsoleLines: againConsole,
          // Every console error but the excused one, with no pattern allowed.
          consoleLines: assertConsoleQuiet(
            { ...v2Win, errors: v2Win.errors.filter((_, at) => !excused.has(at)) },
            { name: "version-2 client window", allow: [] },
          ),
          excusedConsoleLines: excused.size,
          // The draft tabs are pages of their own: their console and page
          // errors are not collected by the fixture, so none is checked.
          popups: "the draft tabs' own console and page errors are not collected",
        };
        assert.equal(
          excused.size,
          roles.client === "chrome" ? 1 : 0,
          "the console lines this phase excuses are not the one refused form request",
        );
      } finally {
        await againWin?.context.close();
        await v2Win?.context.close();
      }
    });

    // Part 4d (spec 2026-10-05 §6): one client works in Chinese from the
    // browser's own language, and the Traditional map is fetched only when
    // 繁體 is chosen. It runs after the 4b2 phase, which also signs applicant B
    // in and reads their applications list. Controls are found by id and
    // data-action only; Chinese text is read only where the wording is the
    // check, and it comes from the app's own tables so a wording review that
    // changes a line does not break the story.
    await phase("a client works in Chinese, and 繁體 loads only when chosen", async () => {
      let zhWin = null;
      try {
        zhWin = await clientEngine.newPage({ locale: "zh-CN" });
        const page = zhWin.page;
        await guardToast(page);
        const hantRequests = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.endsWith("/src/zh-hant.mjs")) hantRequests.push(request.url());
        });
        const lang = () => page.evaluate(() => document.documentElement.lang);
        const langIs = (wanted) =>
          waitFor(page, `<html lang> to be ${wanted}`, (code) => document.documentElement.lang === code, wanted, ARRIVAL_MS);
        const textOf = (selector) =>
          page.evaluate((wanted) => document.querySelector(wanted)?.textContent.trim() ?? null, selector);
        // A toast would cover part of a screenshot: dismiss it (it holds
        // itself while the pointer is over it), and wait for it to go.
        const shootQuiet = async (name) => {
          if (await page.locator("#toast.visible").count()) await clearToast(page);
          await waitFor(page, "the toast to close", () => !document.querySelector("#toast.visible"), undefined, ARRIVAL_MS);
          await waitForQuiet(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await shoot(page, name);
        };

        // ---- Before sign-in: 简体 from navigator.languages ----------------
        await langIs("zh-Hans");
        assert.equal(
          await page.evaluate(() => document.querySelector('label[for="field-email"] > span')?.textContent.trim() ?? null),
          say("signin.email", {}, "zh-Hans"),
        );
        assert.equal(say("signin.email", {}, "zh-Hans"), "电子邮箱");
        await loginTestUserById({ page, actor: applicantB, fixture });
        assert.equal(await lang(), "zh-Hans", "signing in changed the language");

        // ---- A new application, filled, then the rail ----------------------
        await clickAction(page, "start-application");
        await page.locator(".reference-card strong").waitFor({ state: "visible", timeout: ARRIVAL_MS });
        const reference = (await page.locator(".reference-card strong").innerText()).trim();
        const own = await caseByReference(fixture, reference);
        assert.ok(own, "the generated reference names no case");
        await clickAction(page, "continue-intake");
        await waitForSubstep(page, "before.ready");
        await clickAction(page, "fill-fictional");
        await waitFor(
          page,
          "the fill to be announced in Chinese",
          (wanted) => document.querySelector("#toast")?.textContent.includes(wanted),
          say("toast.fictional_filled", {}, "zh-Hans"),
          RENDER_MS,
        );
        // The fill never consents or signs Form 14446: 0.4 and 1.5 by hand.
        await consent14446(page);
        await sign14446(page);

        await railJump(page, "about.you");
        assert.equal(await textOf(".form-workspace .page-intro h1"), findSubstep("about.you").title.general.zh);
        // 年 / 月 / 日, in that order in the page; the ids are unchanged.
        assert.deepEqual(
          await page.evaluate(() =>
            [...document.querySelectorAll('input[id^="field-client-tp_dob-"]')].map((input) => [
              input.id,
              input.closest("label")?.querySelector("span")?.textContent.trim() ?? null,
            ]),
          ),
          [
            ["field-client-tp_dob-year", "年"],
            ["field-client-tp_dob-month", "月"],
            ["field-client-tp_dob-day", "日"],
          ],
        );
        await waitForQuiet(page);
        await page.locator("#field-client-tp_dob-year").fill("1961");
        await page.locator("#field-client-tp_dob-month").fill("04");
        await page.locator("#field-client-tp_dob-day").fill("12");
        await shootQuiet("zh-intake");

        // The move saves the date the boxes hold.
        await railJump(page, "review.check");
        assert.equal(await caseAnswer(fixture, own.id, "tp_dob"), "1961-04-12");
        assert.equal(await textOf("#alerts-title"), say("review.alerts_title", {}, "zh-Hans"));
        await shootQuiet("zh-review");

        // The summary holds the Change links and the draft buttons, which are
        // the Form 14446's only: the screen's Chinese form (繁體; there is no
        // 简体 14446) comes first.
        await railJump(page, "review.summary");
        assert.equal(
          await textOf('#intake-v2-form [data-action="change-substep"]'),
          say("summary.change", {}, "zh-Hans"),
        );
        const firstDraft = page.locator('[data-action="view-draft"]').first();
        assert.deepEqual(
          { draft: await firstDraft.getAttribute("data-draft"), form: await firstDraft.getAttribute("data-form") },
          { draft: "14446", form: "zh-t" },
          "the 简体 summary's first draft button is not the 繁體 Form 14446",
        );
        assert.equal(
          await page.locator('[data-action="view-draft"]:not([data-draft="14446"])').count(),
          0,
          "the 简体 summary offers a draft 13614-C",
        );
        // Building the 繁體 14446 never loads the 繁體 map: only a 13614-C
        // in 繁體 would. Chrome only, as every draft build in the story is;
        // the fonts come from the packages npm installed, never the internet.
        let hantRequestsAfter14446 = "not run: the client engine is Firefox, which may download the PDF instead of opening it";
        if (roles.client === "chrome") {
          const strayRequests = [];
          await page.route("https://cdn.jsdelivr.net/**", (route) => {
            strayRequests.push(route.request().url());
            return route.abort();
          });
          for (const [url, file] of Object.entries(DRAFT_FONT_FIXTURES)) {
            const body = await readFile(path.join(ROOT, file.path));
            await page.route(url, (route) =>
              route.fulfill({
                status: 200,
                headers: { "content-type": "font/ttf", "access-control-allow-origin": "*" },
                body,
              }),
            );
          }
          await waitForQuiet(page);
          const opened = page.waitForEvent("popup", { timeout: CLICK_MS });
          await firstDraft.click({ timeout: CLICK_MS });
          const tab = await opened;
          await tab.waitForURL(/^blob:/, { timeout: ARRIVAL_MS });
          const head = await tab.evaluate(async () => {
            const bytes = new Uint8Array(await (await fetch(location.href)).arrayBuffer());
            return String.fromCharCode(...bytes.slice(0, 5));
          });
          await tab.close();
          assert.equal(head, "%PDF-", "the 繁體 Form 14446 from the 简体 summary is not a PDF");
          assert.deepEqual(hantRequests, [], "building the 繁體 Form 14446 fetched the Traditional map");
          assert.deepEqual(strayRequests, [], "the 繁體 Form 14446 reached for a CDN file it was not given");
          await page.unroute("https://cdn.jsdelivr.net/**");
          for (const url of Object.keys(DRAFT_FONT_FIXTURES)) await page.unroute(url);
          hantRequestsAfter14446 = hantRequests.length;
        }

        await continueToSubmit(page);
        await tickBox(page, "field-confirmed");
        await waitForQuiet(page);
        await page.locator('#intake-v2-form [data-case-action="SUBMIT"]').click({ timeout: CLICK_MS });

        // ---- The progress page, in 简体 ------------------------------------
        const statusHans = describeStage("received", "zh-Hans").clientMessage;
        await waitFor(
          page,
          "the status in Chinese",
          (wanted) => document.querySelector(".status-explanation")?.textContent.trim() === wanted,
          statusHans,
          ARRIVAL_MS,
        );
        assert.equal((await caseById(fixture, own.id)).stage, "received");
        // The submit's history sentence, translated (spec §3.3).
        const received = sentence(
          "Application received. A volunteer will check your information and documents.",
          "zh-Hans",
        );
        assert.match(received, /^已收到申请/);
        await waitFor(
          page,
          "the translated history line",
          (wanted) => [...document.querySelectorAll(".timeline-item p")].some((line) => line.textContent.trim() === wanted),
          received,
          ARRIVAL_MS,
        );
        await shootQuiet("zh-progress");

        // ---- 繁體, with one click: the map is fetched now and only now ----
        assert.deepEqual(hantRequests, [], "the Traditional map was fetched before 繁體 was chosen");
        const hantButton = '[data-action="set-language"][data-value="zh-Hant"]';
        await waitForQuiet(page);
        await page.locator(hantButton).click({ timeout: CLICK_MS });
        await langIs("zh-Hant");
        assert.equal(
          await page.evaluate((selector) => document.activeElement?.matches(selector) ?? false, hantButton),
          true,
          "the keyboard left the 繁體 button",
        );
        assert.notEqual(HANT[statusHans], undefined, "the map has no Traditional for the status");
        assert.equal(await textOf(".status-explanation"), HANT[statusHans]);
        assert.equal(hantRequests.length, 1, "the Traditional map was not fetched exactly once");

        // ---- A reload keeps 繁體 ------------------------------------------
        await page.reload();
        await langIs("zh-Hant");
        await waitFor(
          page,
          "the status in Traditional after the reload",
          (wanted) => document.querySelector(".status-explanation")?.textContent.trim() === wanted,
          HANT[statusHans],
          ARRIVAL_MS,
        );

        // ---- Back to English, and the window is left that way -------------
        await waitForQuiet(page);
        await page.locator('[data-action="set-language"][data-value="en"]').click({ timeout: CLICK_MS });
        await langIs("en");
        await waitFor(
          page,
          "the status in English",
          (wanted) => document.querySelector(".status-explanation")?.textContent.trim() === wanted,
          describeStage("received").clientMessage,
          ARRIVAL_MS,
        );
        evidence.story.chinese = {
          reference,
          hantRequestsAfter14446,
          hantRequestsAtSwitch: 1,
          hantRequestsAfterReload: hantRequests.length,
          consoleLines: assertConsoleQuiet(zhWin, { name: "Chinese client window", allow: [] }),
        };
      } finally {
        await zhWin?.context.close();
      }
    });

    // ---- Hold and closing (change add-hold-and-closing) ---------------------
    // The Chinese phase's applicant keeps going: the office asks for a
    // document, puts the case on hold and takes it off again, the client sends
    // the document, and the case is claimed and then withdrawn by the client,
    // all in 简体. The sample Hold and Withdrawn cases cover the rest.
    let holdCase = null;
    let hansWin = null;
    const HOLD_NOTE = "Simulated: two fictional calls went unanswered.";
    const CLOSE_NOTE = "Simulated: the fictional client never replied.";
    const ASK_TITLE = "Photo ID";
    const ASK_MESSAGE = "Please send a fictional photo ID.";
    const hansLang = "zh-Hans";
    const hansStatus = (page, wanted, what) =>
      waitFor(
        page,
        what,
        (text) => document.querySelector(".status-explanation")?.textContent.trim() === text,
        wanted,
        ARRIVAL_MS,
      );
    const officeRow = (kind, reference) =>
      staff
        .locator(`tr.queue-row[data-kind="${kind}"]`)
        .filter({ has: staff.locator("button.board-reference", { hasText: reference }) })
        .first();
    // Press a row's opener until its dialog is on screen. Opening one reads the
    // case and changes nothing, so pressing again is always safe.
    const openFromRow = async (kind, reference, action, ready) => {
      for (let attempt = 1; ; attempt += 1) {
        await officeRow(kind, reference).waitFor({ state: "visible", timeout: RENDER_MS });
        await waitForQuiet(staff);
        await officeRow(kind, reference).locator(`[data-action="${action}"]`).click({ timeout: CLICK_MS });
        try {
          await staff.locator(`.modal ${ready}`).waitFor({ state: "visible", timeout: 5_000 });
          return;
        } catch (error) {
          if (attempt >= 3) throw error;
        }
      }
    };
    const chooseRadio = async (page, id) => {
      await waitForQuiet(page);
      if (await page.locator(`#${id}`).isChecked()) return;
      await page.locator(`label[for="${id}"]`).click({ timeout: CLICK_MS });
      await waitFor(
        page,
        `#${id} to come back chosen`,
        (selector) => document.querySelector(selector)?.checked === true,
        `#${id}`,
        RENDER_MS,
      );
    };
    // The office dialog's confirm: fill its fields (again, if a rebuild emptied
    // them), tick its box, press the submit, and repeat only when nothing moved.
    const confirmDialog = (type, caseId, { fill, box, ready, arg, what }) =>
      unmovedSince(caseId).then((safeToRepeat) =>
        pressUntilEffect(staff, {
          press: async () => {
            await waitForQuiet(staff);
            if (fill) await fill();
            if (box) {
              await waitForQuiet(staff);
              if (!(await staff.locator(`#${box}`).isChecked())) await tickBox(staff, box);
            }
            await waitForQuiet(staff);
            await staff.locator(`.modal button[type="submit"][data-case-action="${type}"]`).click({ timeout: CLICK_MS });
          },
          ready,
          arg,
          what,
          safeToRepeat,
        }).then((outcome) => record(type, outcome)),
      );
    const modalGone = () => document.querySelector(".modal") === null;
    const showPoolTab = async (value) => {
      await clickAction(staff, "set-board-filter", { attributes: `[data-filter="poolPhase"][data-value="${value}"]` });
      await waitFor(
        staff,
        `the pool's ${value} tab to be shown`,
        (wanted) =>
          document.querySelector(`[data-filter="poolPhase"][data-value="${wanted}"]`)?.getAttribute("aria-pressed") === "true",
        value,
        RENDER_MS,
      );
    };
    const poolShows = (reference, shown, what) =>
      waitFor(
        staff,
        what,
        ([wanted, expected]) =>
          [...document.querySelectorAll("tr.pool-row")].some((row) => row.textContent.includes(wanted)) === expected,
        [reference, shown],
        RENDER_MS,
      );
    const stageOf = async (id) => (await caseById(fixture, id)).stage;

    await phase("the office asks for documents at Screening, and the client reads the request in 简体", async () => {
      const reference = evidence.story.chinese.reference;
      holdCase = await caseByReference(fixture, reference);
      assert.equal(holdCase.stage, "received");
      await use("siteCoordinator");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await openCaseByReference(staff, reference);
      await waitForBadge(staff, "Screening in progress");
      assert.equal(await stageOf(holdCase.id), "screening");

      // The screening checks panel offers it while the documents box is unticked.
      const opener = 'section.panel:has(#checks-title) [data-action="open-request-documents"]';
      await revealCaseControl(staff, opener);
      await waitForQuiet(staff);
      await staff.locator(opener).click({ timeout: CLICK_MS });
      await staff.locator("#field-ask-request-title-1").waitFor({ state: "visible", timeout: RENDER_MS });
      const asked = await staff.locator(".modal").innerText();
      assert.ok(asked.replace(/\s+/g, " ").includes("The case waits at Waiting for documents until you verify every one."));
      await confirmDialog("REQUEST_DOCUMENTS_AT_INTAKE", holdCase.id, {
        fill: async () => {
          await staff.locator("#field-ask-request-title-1").fill(ASK_TITLE, { timeout: CLICK_MS });
          await staff.locator("#field-ask-request-message-1").fill(ASK_MESSAGE, { timeout: CLICK_MS });
        },
        ready: modalGone,
        what: "the Ask for documents dialog to close",
      });
      await waitForBadge(staff, "Waiting for documents");
      assert.equal(await stageOf(holdCase.id), "awaiting_documents");

      // The pool: Waiting on client, and the Follow-ups row.
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await showPoolTab("signing");
      await poolShows(reference, true, "the pool's Waiting on client tab to list the case");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await officeRow("documents", reference).waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(
        (await officeRow("documents", reference).locator(".queue-needed").innerText()).trim(),
        "Waiting for the client's documents.",
      );

      // The client, in 简体.
      hansWin = await clientEngine.newPage({ locale: "zh-CN" });
      const page = hansWin.page;
      await guardToast(page);
      await loginTestUserById({ page, actor: applicantB, fixture });
      await watchAlerts(page);
      const applicationRow = page.locator(`.application-row:has-text("${reference}")`).first();
      await applicationRow.waitFor({ state: "visible", timeout: ARRIVAL_MS });
      await waitForQuiet(page);
      await applicationRow.click({ timeout: CLICK_MS });
      await hansStatus(
        page,
        describeStage("awaiting_documents", hansLang).clientMessage,
        "the status to ask for documents in 简体",
      );
      assert.equal(
        describeStage("awaiting_documents", hansLang).clientMessage,
        say("stage.awaiting_documents.client", {}, hansLang),
      );
      assert.equal(await page.locator(".action-card h2").first().innerText(), ASK_TITLE);
      assert.ok((await page.locator(".action-card p").first().innerText()).includes(ASK_MESSAGE));
      evidence.story.documentsRequest = "asked at Screening, listed under Waiting on client, read in 简体";
    });

    await phase("a hold and a call back, from the Follow-ups rows", async () => {
      const reference = evidence.story.chinese.reference;
      const page = hansWin.page;
      await openBoard(staff, OFFICE_BOARD_HEADING);

      // Put on hold… from the Waiting for documents row.
      await openFromRow("documents", reference, "open-put-on-hold", "#field-hold-hold-note");
      await confirmDialog("PUT_ON_HOLD", holdCase.id, {
        fill: () => staff.locator("#field-hold-hold-note").fill(HOLD_NOTE, { timeout: CLICK_MS }),
        box: "field-hold-confirmed",
        ready: modalGone,
        what: "the Put on hold dialog to close",
      });
      assert.equal(await stageOf(holdCase.id), "on_hold");
      await officeRow("hold", reference).waitFor({ state: "visible", timeout: RENDER_MS });
      assert.equal(
        (await officeRow("hold", reference).locator(".queue-needed").innerText()).trim(),
        "Can't reach the client about documents.",
      );
      // A Hold needs attention.
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await showPoolTab("attention");
      await poolShows(reference, true, "the pool's Needs attention tab to list the Hold");
      // The client is told, and never sees the note.
      const holdMessage = describeStage("on_hold", hansLang, { stage: "on_hold", holdOrigin: "awaiting_documents" }).clientMessage;
      await hansStatus(page, holdMessage, "the status to tell the client about the Hold in 简体");
      assert.ok(!(await pageText(page)).includes("unanswered"), "the hold note reached the client");

      // Got in touch… from the Hold row.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await openFromRow("hold", reference, "open-resume-from-hold", "#field-resume-confirmed");
      await confirmDialog("RESUME_FROM_HOLD", holdCase.id, {
        box: "field-resume-confirmed",
        ready: modalGone,
        what: "the Got in touch dialog to close",
      });
      assert.equal(await stageOf(holdCase.id), "awaiting_documents");
      await officeRow("documents", reference).waitFor({ state: "visible", timeout: RENDER_MS });
      await hansStatus(
        page,
        describeStage("awaiting_documents", hansLang).clientMessage,
        "the status to ask for documents again in 简体",
      );
    });

    await phase("the client sends the document, the admin verifies it, and Screening goes on", async () => {
      const reference = evidence.story.chinese.reference;
      const page = hansWin.page;
      await act(page, "RESPOND_DOCUMENT", { text: say("progress.sent", {}, hansLang) }, { caseId: holdCase.id });
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await openCaseByReference(staff, reference);
      await waitForBadge(staff, "Received, not verified yet");
      await act(staff, "VERIFY_DOCUMENT", { badge: "Verified" }, { caseId: holdCase.id });
      // The last request is verified: the case is back where the request came from.
      await waitForBadge(staff, "Screening in progress");
      assert.equal(await stageOf(holdCase.id), "screening");
      await hansStatus(page, describeStage("screening", hansLang).clientMessage, "the status to read Screening in 简体");
      // The Verify left the window on the Documents tab; the checks are elsewhere.
      await revealCaseControl(staff, '[data-case-action="VERIFY_INTAKE"]');
      await tickScreeningChecks(staff);
      await actForm(
        staff,
        "VERIFY_INTAKE",
        {},
        { detail: { label: "Intake checks", value: "Recorded" } },
        { caseId: holdCase.id },
      );
      assert.equal(await stageOf(holdCase.id), "preparation_ready");
      evidence.story.documentsFlow = "asked, held, called back, sent, verified, back at Screening, checks recorded";
    });

    await phase("the office closes a Hold from a Follow-ups row and filters the Closed tab by reason", async () => {
      const onHold = seeded.on_hold;
      const withdrawnSample = seeded.withdrawn;
      assert.ok(onHold && withdrawnSample, "the seeded on_hold or withdrawn case is missing");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await openFromRow("hold", onHold.reference, "open-close-case", "#field-close-close-note");
      // Other needs a note: the dialog refuses without one.
      await chooseRadio(staff, "field-close-close-reason-other");
      await tickBox(staff, "field-close-confirmed");
      await waitForQuiet(staff);
      await staff.locator('.modal button[type="submit"][data-case-action="CLOSE_CASE"]').click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the refusal for Other with no note",
        () => /Add a note for Other/.test(document.querySelector(".modal")?.textContent ?? "") || /Add a note for Other/.test(document.querySelector("#toast")?.textContent ?? "") || (window.__vitallyAlerts ?? []).some((line) => line.includes("Add a note for Other")),
        undefined,
        RENDER_MS,
      );
      assert.equal(await stageOf(onHold.id), "on_hold", "Other with no note closed the case");
      await confirmDialog("CLOSE_CASE", onHold.id, {
        fill: async () => {
          await chooseRadio(staff, "field-close-close-reason-other");
          await staff.locator("#field-close-close-note").fill(CLOSE_NOTE, { timeout: CLICK_MS });
        },
        box: "field-close-confirmed",
        ready: modalGone,
        what: "the Close dialog to close",
      });
      assert.equal(await stageOf(onHold.id), "closed");
      assert.equal((await one(fixture, "select closing_reason from public.cases where id=$1", [onHold.id])).closing_reason, "other");
      await waitFor(
        staff,
        "the Hold row to leave the queue",
        (wanted) => ![...document.querySelectorAll('tr.queue-row[data-kind="hold"]')].some((row) => row.textContent.includes(wanted)),
        onHold.reference,
        RENDER_MS,
      );

      // The pool's Closed tab and its reason filter.
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await showPoolTab("closed");
      await staff.locator('select[data-board-filter="poolReason"]').waitFor({ state: "visible", timeout: RENDER_MS });
      const chooseReason = async (reason) => {
        await waitForQuiet(staff);
        await staff.locator('select[data-board-filter="poolReason"]').selectOption(reason, { timeout: CLICK_MS });
        await waitFor(
          staff,
          `the Closed reason filter to read ${reason}`,
          (wanted) => document.querySelector('select[data-board-filter="poolReason"]')?.value === wanted,
          reason,
          RENDER_MS,
        );
      };
      await chooseReason("other");
      await poolShows(onHold.reference, true, "the Other filter to list the closed Hold");
      await poolShows(withdrawnSample.reference, false, "the Other filter to leave out the withdrawn sample");
      await chooseReason("withdrawn");
      await poolShows(withdrawnSample.reference, true, "the Withdrawn filter to list the withdrawn sample");
      await poolShows(onHold.reference, false, "the Withdrawn filter to leave out the closed Hold");
      await chooseReason("all");
      await poolShows(onHold.reference, true, "Any reason to list the closed Hold");
      evidence.story.closeFromRow = "Other with a note, closed from a Hold row; the Closed tab filtered by reason";
    });

    await phase("a claimed case is withdrawn by the client, and the office is told", async () => {
      const reference = evidence.story.chinese.reference;
      const page = hansWin.page;
      await use("preparer");
      await openBoard(staff, WORK_BOARD_HEADING);
      await openCaseByReference(staff, reference);
      await act(
        staff,
        "CLAIM_PREPARATION",
        { detail: { label: "Preparer", value: ROLE_NAMES.preparer } },
        { caseId: holdCase.id },
      );
      assert.equal(await stageOf(holdCase.id), "preparing");
      await hansStatus(page, describeStage("preparing", hansLang).clientMessage, "the status to read Preparing in 简体");

      // The button and the dialog, in 简体.
      const button = page.locator('[data-action="open-withdraw"]');
      await button.waitFor({ state: "visible", timeout: ARRIVAL_MS });
      assert.equal((await button.innerText()).trim(), say("withdraw.button", {}, hansLang));
      await clickAction(page, "open-withdraw");
      await page.locator("#field-withdraw-withdraw-confirmed").waitFor({ state: "visible", timeout: RENDER_MS });
      assert.ok((await page.locator(".modal").innerText()).includes(say("withdraw.box", {}, hansLang)));
      const closedMessage = describeStage("closed", hansLang, { stage: "closed", closingReason: "withdrawn" }).clientMessage;
      assert.equal(closedMessage, say("stage.closed.client.withdrawn", {}, hansLang));
      record(
        "WITHDRAW",
        await pressUntilEffect(page, {
          press: async () => {
            await waitForQuiet(page);
            if (!(await page.locator("#field-withdraw-withdraw-confirmed").isChecked())) await tickBox(page, "field-withdraw-withdraw-confirmed");
            await waitForQuiet(page);
            await page.locator('.modal button[type="submit"][data-case-action="WITHDRAW"]').click({ timeout: CLICK_MS });
          },
          ready: (wanted) =>
            document.querySelector(".modal") === null &&
            document.querySelector(".status-explanation")?.textContent.trim() === wanted,
          arg: closedMessage,
          what: "the page to read the withdrawn message in 简体",
          safeToRepeat: await unmovedSince(holdCase.id),
        }),
      );
      const closed = await one(fixture, "select stage,closing_reason from public.cases where id=$1", [holdCase.id]);
      assert.deepEqual(closed, { stage: "closed", closing_reason: "withdrawn" });
      assert.equal(await page.locator('[data-action="open-withdraw"]').count(), 0, "a closed case still offers Withdraw");
      assert.equal(
        Number(
          (
            await one(
              fixture,
              "select count(*)::int as count from public.admin_followups where case_id=$1 and purpose='withdrawal_notice' and status='open'",
              [holdCase.id],
            )
          ).count,
        ),
        1,
      );

      // The office: Closed · Withdrawn in the pool, and the notice in Follow-ups.
      await use("siteCoordinator");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      const notice = officeRow("withdrawn", reference);
      await notice.waitFor({ state: "visible", timeout: RENDER_MS });
      const told = (await notice.locator(".queue-needed").innerText()).trim();
      assert.equal(told, `The client withdrew; tell ${ROLE_NAMES.preparer} to stop work.`);
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await showPoolTab("closed");
      await staff.locator('select[data-board-filter="poolReason"]').selectOption("withdrawn", { timeout: CLICK_MS });
      await poolShows(reference, true, "the Withdrawn filter to list the withdrawn case");
      assert.ok(
        await staff.evaluate(
          (wanted) =>
            [...document.querySelectorAll("tr.pool-row")]
              .find((row) => row.textContent.includes(wanted))
              ?.textContent.includes("Closed · Withdrawn") ?? false,
          reference,
        ),
        "the pool row does not read Closed · Withdrawn",
      );

      // Resolve it, from the row.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await officeRow("withdrawn", reference).waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForQuiet(staff);
      await officeRow("withdrawn", reference).locator('[data-action="open-log-call"]').click({ timeout: CLICK_MS });
      await staff.locator(".modal.office-drawer").waitFor({ state: "visible", timeout: ARRIVAL_MS });
      const noticeId = (
        await one(
          fixture,
          "select id from public.admin_followups where case_id=$1 and purpose='withdrawal_notice' and status='open'",
          [holdCase.id],
        )
      ).id;
      record(
        "RESOLVE_FOLLOWUP (withdrawal notice)",
        await submitCaseFormUntil(
          staff,
          "RESOLVE_FOLLOWUP",
          { "How it ended": "reached", "What the office concluded": "Told the fictional volunteer to stop work." },
          {
            ready: modalGone,
            what: "the drawer to close after the withdrawal notice is resolved",
            safeToRepeat: async () =>
              (await one(fixture, "select status from public.admin_followups where id=$1", [noticeId])).status === "open",
          },
        ),
      );
      assert.notEqual(
        (await one(fixture, "select status from public.admin_followups where id=$1", [noticeId])).status,
        "open",
      );
      await waitFor(
        staff,
        "the Withdrawn row to leave the queue",
        (wanted) => ![...document.querySelectorAll('tr.queue-row[data-kind="withdrawn"]')].some((row) => row.textContent.includes(wanted)),
        reference,
        RENDER_MS,
      );
      // The client's page, in 简体, still reads the withdrawn message.
      await hansStatus(page, closedMessage, "the client's page to keep the withdrawn message in 简体");
      assert.ok(!(await pageText(page)).includes("unanswered"), "a hold note reached the client");
      evidence.story.withdrawal = {
        consoleLines: assertConsoleQuiet(hansWin, { name: "简体 client window", allow: REFUSAL_LINES }),
      };
      await hansWin.context.close();
      hansWin = null;
    });

    await phase("season-end close: the unsigned cases are closed as Dismissed, and the rest are left alone", async () => {
      await use("siteCoordinator");
      await openBoard(staff, OFFICE_BOARD_HEADING);
      // The seeded review_approved and rejected cases, as they are now: no
      // earlier phase moved either.
      const held = await caseById(fixture, seeded.review_approved.id);
      const returned = await caseById(fixture, seeded.rejected.id);
      assert.ok(held && returned, "the seeded review_approved or rejected case is missing");
      assert.equal(held.stage, "review_approved");
      assert.equal(returned.stage, "rejected");

      // The review_approved sample goes on a signing Hold, from its case page.
      await openCaseByReference(staff, held.reference);
      await revealCaseControl(staff, '[data-action="open-put-on-hold"]');
      await clickAction(staff, "open-put-on-hold");
      await staff.locator("#field-hold-hold-note").waitFor({ state: "visible", timeout: RENDER_MS });
      await confirmDialog("PUT_ON_HOLD", held.id, {
        fill: () => staff.locator("#field-hold-hold-note").fill(HOLD_NOTE, { timeout: CLICK_MS }),
        box: "field-hold-confirmed",
        ready: modalGone,
        what: "the Put on hold dialog to close",
      });
      assert.equal(await stageOf(held.id), "on_hold");

      // The rejected sample is returned to signing from its Follow-ups row.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await openFromRow("rejected", returned.reference, "open-return-to-signing", "#field-return-to-signing-confirmed");
      assert.ok((await staff.locator(".modal").innerText()).includes("The fix is done."));
      await confirmDialog("RETURN_TO_SIGNING", returned.id, {
        box: "field-return-to-signing-confirmed",
        ready: modalGone,
        what: "the Return to signing dialog to close",
      });
      assert.equal(await stageOf(returned.id), "review_approved");

      // Close unsigned cases…: both samples are listed, ticked, with their stage and days.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      await clickAction(staff, "open-close-unsigned");
      await staff.locator("#close-unsigned-form").waitFor({ state: "visible", timeout: RENDER_MS });
      const dialogRow = (id) => staff.locator(`#close-unsigned-form tr:has(#close-unsigned-${id})`);
      const heading = async () => (await staff.locator("#close-unsigned-heading").innerText()).trim();
      const total = await staff.locator('#close-unsigned-form input[name="caseId"]').count();
      assert.ok(total >= 2, `the dialog lists ${total} cases, fewer than the two samples`);
      for (const [row, stage] of [
        [held, "Hold"],
        [returned, "Ready to exit"],
      ]) {
        const text = (await dialogRow(row.id).innerText()).replace(/\s+/g, " ");
        assert.ok(text.includes(row.reference), `the row for ${row.reference} is missing its reference: ${text}`);
        assert.ok(text.includes(stage), `the row for ${row.reference} does not say ${stage}: ${text}`);
        assert.ok(text.includes("0 days"), `the row for ${row.reference} does not say 0 days: ${text}`);
        assert.equal(await staff.locator(`#close-unsigned-${row.id}`).isChecked(), true, "a listed case starts ticked");
      }
      const headingFor = (ticked) =>
        `Close ${ticked === total ? total : `${ticked} of ${total}`} cases that are waiting for a signature, as Dismissed?`;
      assert.equal(await heading(), headingFor(total));

      // Leave out every case but the held sample: the heading follows the ticks.
      const untick = async (id) => {
        await waitForQuiet(staff);
        if (await staff.locator(`#close-unsigned-${id}`).isChecked()) {
          await staff.locator(`#close-unsigned-${id}`).click({ timeout: CLICK_MS });
        }
        await waitFor(
          staff,
          `#close-unsigned-${id} to come back unticked`,
          (selector) => document.querySelector(selector)?.checked === false,
          `#close-unsigned-${id}`,
          RENDER_MS,
        );
      };
      const otherIds = (
        await staff
          .locator('#close-unsigned-form input[name="caseId"]')
          .evaluateAll((boxes) => boxes.map((box) => box.value))
      ).filter((id) => id !== held.id);
      await untick(returned.id);
      assert.equal(await heading(), headingFor(total - 1));
      for (const id of otherIds.filter((id) => id !== returned.id)) await untick(id);
      assert.equal(await heading(), headingFor(1));
      assert.equal(await staff.locator(`#close-unsigned-${held.id}`).isChecked(), true);
      await tickBox(staff, "field-close-unsigned-confirmed");
      await waitFor(
        staff,
        "the confirm button to open",
        () => document.querySelector("#close-unsigned-submit")?.disabled === false,
        undefined,
        RENDER_MS,
      );
      await waitForQuiet(staff);
      await staff.locator("#close-unsigned-submit").click({ timeout: CLICK_MS });
      await waitFor(
        staff,
        "the season-end toast",
        () =>
          (window.__vitallyAlerts ?? []).some(
            (line) => line.startsWith("toast:") && line.includes("The unsigned cases were closed as Dismissed."),
          ),
        undefined,
        ARRIVAL_MS,
      );
      await waitFor(staff, "the dialog to close", modalGone, undefined, RENDER_MS);

      // The held sample is Closed · Dismissed; the other is untouched.
      const closed = await one(fixture, "select stage,closing_reason from public.cases where id=$1", [held.id]);
      assert.deepEqual(closed, { stage: "closed", closing_reason: "dismissed" });
      assert.equal(await stageOf(returned.id), "review_approved", "the case that was left out moved");
      assert.equal(
        (
          await one(
            fixture,
            "select message from public.client_events where case_id=$1 order by created_at desc, id desc limit 1",
            [held.id],
          )
        ).message,
        "PCDC could not reach you, so this application was closed. Your return was not filed.",
      );
      await clickAction(staff, "open-cases");
      await waitForText(staff, "Case pool", RENDER_MS);
      await showPoolTab("closed");
      await staff.locator('select[data-board-filter="poolReason"]').waitFor({ state: "visible", timeout: RENDER_MS });
      await waitForQuiet(staff);
      await staff.locator('select[data-board-filter="poolReason"]').selectOption("dismissed", { timeout: CLICK_MS });
      await poolShows(held.reference, true, "the Dismissed filter to list the closed sample");
      assert.ok(
        await staff.evaluate(
          (wanted) =>
            [...document.querySelectorAll("tr.pool-row")]
              .find((row) => row.textContent.includes(wanted))
              ?.textContent.includes("Closed · Dismissed") ?? false,
          held.reference,
        ),
        "the pool row does not read Closed · Dismissed",
      );

      // No TaxSlayer notice for the season-end close.
      await openBoard(staff, OFFICE_BOARD_HEADING);
      assert.equal(
        await staff
          .locator("tr.queue-row", {
            hasText: "The case was closed before filing; make sure the return is not transmitted in TaxSlayer.",
          })
          .count(),
        0,
        "Follow-ups shows a TaxSlayer notice for the season-end close",
      );
      assert.equal(
        Number(
          (
            await one(
              fixture,
              "select count(*)::int as count from public.admin_followups where case_id=$1 and purpose='withdrawal_notice'",
              [held.id],
            )
          ).count,
        ),
        0,
      );
      evidence.story.seasonEndClose =
        "a held signer closed as Dismissed from Close unsigned cases…; the case left out stayed at Ready to exit; the client was told; no TaxSlayer notice";
    });

    // OpenSpec change add-staff-identity: two real staff accounts, each its own
    // person, work one case in two engines. Neither chooses a persona; the
    // server names whoever is signed in, and the independence rule holds
    // between the accounts. Last before the console check, so the two new
    // people in the roster reach no earlier phase (the contact log's own
    // admin, Quinn Harper, is the only other person added to it).
    await phase("two staff accounts work one case, each signed in as themselves", async () => {
      // A call made from this test process (not a page wait, which has its
      // own timeout) has no timeout of its own; a stuck one fails here by
      // name rather than running the permutation out of time.
      const within = async (what, promise, ms = ARRIVAL_MS * 3) => {
        let timer = null;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      // Riley prepares and could review; Jordan reviews. Fictional people,
      // fresh accounts of this run, removed with the rest by fixture.close().
      const rileyAccount = await within(
        "adding Riley Park",
        fixture.database.staff({ key: "riley", name: "Riley Park", capabilities: ["prepare", "review"] }),
      );
      const jordanAccount = await within(
        "adding Jordan Lee",
        fixture.database.staff({ key: "jordan", name: "Jordan Lee", capabilities: ["review"] }),
      );
      const rileyActor = { key: "riley", email: rileyAccount.email, userId: rileyAccount.userId };
      const jordanActor = { key: "jordan", email: jordanAccount.email, userId: jordanAccount.userId };
      // A case waiting for a preparer, built through the public actions.
      const caseId = await within("building a case ready for preparation", fixture.database.readyCase());
      const { reference } = await caseById(fixture, caseId);

      // The presenter's window still shows the plain screen (a presenter
      // gets the plain message), and reads as no staff account.
      await assertPresenterScreen(presenterPage);
      assert.equal(await readSignedInAs(presenterPage), null, "the presenter window reads as a staff account");

      const rileyWin = await openWindow(staffEngine);
      const jordanWin = await openWindow(clientEngine);
      const riley = rileyWin.page;
      const jordan = jordanWin.page;
      try {
        // A leftover persona: this window's storage says Sam before Riley
        // signs in, as a presenter window acting as Sam used to leave it.
        await riley.evaluate(
          ([key, personId]) => sessionStorage.setItem(key, JSON.stringify({ selectedPersonId: personId })),
          [fixture.sessionStateKey(rileyAccount.userId), sam],
        );
        // Really there before the sign-in, so what follows proves it ignored.
        assert.equal((await readWindowState(riley, rileyAccount.userId))?.selectedPersonId, sam);
        await loginTestUser({ page: riley, actor: rileyActor, fixture, heading: WORK_BOARD_HEADING });
        await loginTestUser({ page: jordan, actor: jordanActor, fixture, heading: WORK_BOARD_HEADING });
        await watchAlerts(riley);
        await watchAlerts(jordan);

        // A staff member signs in: "Signed in as", no persona buttons, no
        // reset and no checkpoint.
        for (const [page, name] of [
          [riley, "Riley Park"],
          [jordan, "Jordan Lee"],
        ]) {
          assert.equal(await readSignedInAs(page), name);
          const controls = await page.evaluate(() => ({
            personas: document.querySelectorAll('[data-action="select-person"]').length,
            actingAs: document.querySelectorAll("#persona-title").length,
            reset: document.querySelectorAll('[data-action="open-reset-fixtures"]').length,
            checkpoint: document.querySelectorAll('[data-action="open-checkpoint"]').length,
          }));
          assert.deepEqual(
            controls,
            { personas: 0, actingAs: 0, reset: 0, checkpoint: 0 },
            `${name}'s window shows a presenter control`,
          );
        }
        // No persona button is pressed in Riley's window.
        assert.equal(
          await riley.locator('[data-action="select-person"][aria-pressed="true"]').count(),
          0,
          "Riley's window acts as a persona",
        );
        // The stored persona was never restored, and is not written back.
        assert.equal(
          (await readWindowState(riley, rileyAccount.userId))?.selectedPersonId,
          undefined,
          "Riley's window kept the leftover persona",
        );
        // How the staff row reads beside the board, for the design check.
        const sidebarShot = path.join(SHOTS, `${tag}--staff-signed-in-as.png`);
        await riley.screenshot({ path: sidebarShot });
        evidence.screenshots.push(path.relative(ROOT, sidebarShot));

        // Jordan watches the case from the board; nothing here reloads it.
        await findOnBoard(jordan, reference);
        await jordan.evaluate(() => {
          window.__staffPhaseNoReload = true;
        });
        const jordanRow = (wanted) =>
          waitFor(
            jordan,
            `Jordan's board row for ${reference} to show ${wanted}`,
            ([ref, what]) => {
              const row = [...document.querySelectorAll("tr.board-row")].find((tr) =>
                tr.querySelector("button.board-reference")?.textContent.includes(ref),
              );
              if (!row) return false;
              return what === "claim-review"
                ? Boolean(row.querySelector('[data-case-action="CLAIM_REVIEW"]'))
                : row.textContent.includes(what);
            },
            [reference, wanted],
            ARRIVAL_MS,
          );

        // Riley claims and hands the case to review, as Riley — never as Sam.
        await openCaseByReference(riley, reference);
        // The case header says who is signed in, where a presenter's says
        // who it acts as.
        assert.equal(
          (await riley.locator(".staff-header .field-note").innerText()).trim(),
          "Signed in as Riley Park.",
        );
        await act(riley, "CLAIM_PREPARATION", { detail: { label: "Preparer", value: "Riley Park" } }, { caseId });
        assert.equal((await caseById(fixture, caseId)).preparer_id, rileyAccount.personId);
        // Live updates: the claim reaches Jordan's board without a reload.
        await jordanRow("Riley Park");

        // The shaded section, as a staff account (#103): its tools once did
        // nothing for one while every presenter run passed. A field is as tall
        // as its cell: the page's field rule once made one 44px, and the text
        // typed in it landed on the row below.
        const rowOneChild = riley.locator(
          '.shaded-editor [name="form1[0].page1[0].namesOf[0].Row1[0].qualifyingChildDependent[0]"]',
        );
        const rileyEditorButton = (which) => riley.locator(`.shaded-editor [data-editor="${which}"]`);
        await openCaseTab(riley, "intake");
        await waitForQuiet(riley);
        await riley.locator('#case-panel-intake [data-action="open-shaded-editor"]').click({ timeout: CLICK_MS });
        await riley.locator('.shaded-editor[data-ready="true"]').waitFor({ timeout: ARRIVAL_MS });
        await rowOneChild.fill("Yes");
        const rowOneHeights = await rowOneChild.evaluate((input) => ({
          input: input.getBoundingClientRect().height,
          cell: input.closest("section").getBoundingClientRect().height,
        }));
        assert.ok(
          Math.abs(rowOneHeights.input - rowOneHeights.cell) <= 1,
          `a shaded field is not as tall as its cell: ${JSON.stringify(rowOneHeights)}`,
        );
        await rileyEditorButton("save").click({ timeout: CLICK_MS });
        await waitFor(
          riley,
          "Saved in Riley's editor",
          () => document.querySelector(".shaded-editor #shaded-editor-status")?.textContent.trim() === "Saved",
          undefined,
          ARRIVAL_MS,
        );
        assert.deepEqual(
          (
            await fixture.database.sql("select fields,version from public.preparer_shaded_fields where case_id=$1", [caseId])
          ).rows.map((row) => ({ fields: row.fields, version: Number(row.version) })),
          [{ fields: { household1QualifyingChild: "yes" }, version: 1 }],
        );
        await rileyEditorButton("close").click({ timeout: CLICK_MS });
        await waitFor(
          riley,
          "Riley's editor to close",
          () => !document.querySelector(".shaded-editor") && !document.querySelector("#app").inert,
          undefined,
          ARRIVAL_MS,
        );

        await actQuestionnaire(
          riley,
          "SUBMIT_REVIEW",
          () =>
            fillPreparer(riley, {
              confirmedBy: "other",
              confirmedByName: "Pat Example",
              confirmedMethod: "phone",
              shaded: true,
              state: true,
              readyForReviewOn: todayIso(),
            }),
          { badge: "Pending review" },
          { caseId },
        );
        await jordanRow("claim-review");
        assert.equal(
          await jordan.evaluate(() => window.__staffPhaseNoReload === true),
          true,
          "Jordan's window reloaded to see the case",
        );

        // A preparer who can also review: the page offers Riley no claim and
        // says why, and the server refuses the claim sent anyway.
        await waitForText(riley, "You prepared this case, so you cannot review it.", RENDER_MS);
        assert.equal(await caseActionCount(riley, "CLAIM_REVIEW"), 0, "Riley is offered a review of their own case");
        const before = await caseById(fixture, caseId);
        const selfReviewId = randomUUID();
        const selfReview = await within(
          "Riley's own claim of the review",
          rileyAccount.client.rpc(
            "vitally_apply_action",
            applyArgs({
              actionId: selfReviewId,
              caseId,
              revision: Number(before.revision),
              type: "CLAIM_REVIEW",
            }),
          ),
        );
        assert.ok(selfReview.error, "Riley claimed the review of a case Riley prepared");
        assert.equal(domainCode(selfReview.error), "SELF_REVIEW");
        assert.equal(await receiptsForActionId(fixture, selfReviewId), 0);
        const after = await caseById(fixture, caseId);
        assert.deepEqual(
          { stage: after.stage, revision: after.revision, reviewer: after.reviewer_id },
          { stage: "review_ready", revision: before.revision, reviewer: null },
        );

        // Another reviewer can claim it: Jordan, from the board row.
        record(
          "CLAIM_REVIEW",
          await pressUntilEffect(jordan, {
            press: async () => {
              await waitForQuiet(jordan);
              await jordan
                .locator(`.board-row:has(button.board-reference:has-text("${reference}"))`)
                .first()
                .locator('[data-case-action="CLAIM_REVIEW"]')
                .click({ timeout: CLICK_MS });
            },
            ready: HAS_DETAIL,
            arg: { label: "Reviewer", value: "Jordan Lee" },
            what: "Jordan's claimed review, in its own case workspace",
            safeToRepeat: await unmovedSince(caseId),
          }),
        );
        await waitForCaseWorkspace(jordan, reference);
        await actQuestionnaire(
          jordan,
          "APPROVE_REVIEW",
          () =>
            fillReviewer(jordan, {
              completedOn: todayIso(),
              paForgiveness: "not_eligible",
              wentOver: "yes",
              wentOverOn: todayIso(),
              wentOverHow: "phone",
              signMethod: "portal",
            }),
          { badge: "Ready to exit" },
          { caseId },
        );
        // Both staff windows are on this case's page now: each header names
        // its own account, and neither page says "Acting as" anywhere,
        // hidden tabs included.
        for (const [page, name] of [
          [riley, "Riley Park"],
          [jordan, "Jordan Lee"],
        ]) {
          assert.equal(
            (await page.locator(".staff-header .field-note").innerText()).trim(),
            `Signed in as ${name}.`,
          );
          assert.equal(
            await page.evaluate(() => /acting as/i.test(document.querySelector("#app")?.textContent ?? "")),
            false,
            `${name}'s page says "acting as"`,
          );
        }
        const approved = await caseById(fixture, caseId);
        assert.equal(approved.stage, "review_approved");
        assert.equal(approved.preparer_id, rileyAccount.personId);
        assert.equal(approved.reviewer_id, jordanAccount.personId);

        // Two staff members share a case: the History tab names each for
        // their own steps, and each step's receipt and event name the same
        // person and account.
        const steps = {
          CLAIM_PREPARATION: ["Riley Park claimed preparation.", rileyAccount],
          SUBMIT_REVIEW: ["Riley Park recorded that preparation is complete.", rileyAccount],
          CLAIM_REVIEW: ["Jordan Lee claimed the review.", jordanAccount],
          APPROVE_REVIEW: ["Jordan Lee approved the review.", jordanAccount],
        };
        await openCaseTab(jordan, "history");
        await waitFor(
          jordan,
          "the internal history to name Riley Park and Jordan Lee for their steps",
          (wanted) => {
            const seen = [...document.querySelectorAll('[data-role="internal-history"] .timeline-item p')].map(
              (entry) => entry.textContent.trim(),
            );
            return wanted.every((line) => seen.includes(line));
          },
          Object.values(steps).map(([line]) => line),
          ARRIVAL_MS,
        );
        for (const [operation, [, account]] of Object.entries(steps)) {
          const expected = [{ actor_user_id: account.userId, actor_person_id: account.personId }];
          const receipts = (
            await fixture.database.sql(
              "select actor_user_id, actor_person_id from public.action_receipts where target_id=$1 and operation=$2",
              [caseId, operation],
            )
          ).rows;
          assert.deepEqual(receipts, expected, `the ${operation} receipt names someone else`);
          const events = (
            await fixture.database.sql(
              "select actor_user_id, actor_person_id from public.case_events where case_id=$1 and action=$2",
              [caseId, operation],
            )
          ).rows;
          assert.deepEqual(events, expected, `the ${operation} event names someone else`);
        }
        assert.equal(
          (await readWindowState(riley, rileyAccount.userId))?.selectedPersonId,
          undefined,
          "Riley's window saved a persona while working",
        );
        assertConsoleQuiet(rileyWin, { name: "Riley's staff window", allow: REFUSAL_LINES });
        assertConsoleQuiet(jordanWin, { name: "Jordan's staff window", allow: REFUSAL_LINES });
        evidence.story.staffAccounts =
          "Riley Park (prepare, review) and Jordan Lee (review) signed in through the real form in two engines; Signed in as, no presenter controls; a leftover Sam persona ignored; the presenter window on the plain screen before and after a reload; Riley prepared and filled the shaded section in the editor, a field as tall as its cell; Jordan's board followed live, Riley's own review refused (SELF_REVIEW), Jordan claimed and approved; history, receipts and events name each";
      } finally {
        await rileyWin.context.close();
        await jordanWin.context.close();
      }
      // Read again on a reload, the presenter's window is still the plain
      // screen: nothing there offers the two accounts' people, or anyone.
      await presenterPage.reload();
      await assertPresenterScreen(presenterPage);
      await watchAlerts(presenterPage);
      for (const name of ["Riley Park", "Jordan Lee"])
        assert.ok(
          !(await presenterPage.locator("#app").innerText()).includes(name),
          `the presenter window names ${name}`,
        );
    });

    await phase("nothing threw, and every console line was one we asked for", async () => {
      evidence.consoleErrors = {
        // The client window's own refusals are the stale-revision conflicts
        // counted above; Chrome logs one resource line per refused request and
        // Firefox logs none. Nothing else may appear on any of these pages.
        client: assertConsoleQuiet(clientWin, {
          name: "client window",
          allow: REFUSAL_LINES,
        }),
        staff: assertConsoleQuiet(staffWin, {
          name: "staff window",
          allow: REFUSAL_LINES,
        }),
        ...Object.fromEntries(
          ROLES.map((role) => [
            role,
            assertConsoleQuiet(roleWins[role], { name: `${role} staff window`, allow: REFUSAL_LINES }),
          ]),
        ),
        clientB: assertConsoleQuiet(clientB, {
          name: "second applicant window",
          allow: REFUSAL_LINES,
        }),
      };
      // A press that reached nothing at all is an application defect, not a
      // retry case: the page rebuilt itself under the pointer (Ruling R65).
      assert.deepEqual(
        evidence.retries.filter((entry) => entry.lost > 0),
        [],
        "a press reached nothing at all and had to be sent again",
      );
      // Recorded, not asserted: the measurement that matters is the one each
      // screenshot took at 390px, and every one of those is asserted there.
      evidence.overflow.desktop = {
        client: await measureOverflow(client),
        staff: await measureOverflow(staff),
      };
    });
  } finally {
    // Gathered even when a phase throws: every notice the two windows showed
    // (including the ones already erased) and the class case as the server
    // holds it are what say how far the story got and what stopped it.
    try {
      evidence.alerts = {
        client: client ? await readAlerts(client) : null,
        staff: staff ? await readAlerts(staff) : null,
        ...(roleWins
          ? Object.fromEntries(
              await Promise.all(
                Object.entries(roleWins).map(async ([role, win]) => [role, await readAlerts(win.page).catch(() => null)]),
              ),
            )
          : {}),
      };
      if (classCase) evidence.classCase = await caseById(fixture, classCase.id);
    } catch (error) {
      evidence.evidenceGathering = String(error?.message ?? error);
    }
    // The one place the whole record is printed, and so the one place worth
    // masking as a whole: anything read off a page reaches this line.
    t.diagnostic(redactAddresses(`evidence ${JSON.stringify(evidence)}`));
    if (seedRunDir) await rm(seedRunDir, { recursive: true, force: true }).catch(() => {});
    await fixture.close();
  }
}

// The guard for this file's own invariant, and the only test here that needs
// no browser: a test account's address is the one secret a screen can echo
// back ("Signing in as …" on the code step), and everything this file reads off
// a page ends up in a failure message or in the evidence diagnostic.
test("no address survives the redaction every message goes through", () => {
  const address = "applicant-7f3a2e1c@vitally.invalid";
  // The sentence the code step renders. The trailing full stop goes with the
  // address, which is the safe direction to err in.
  assert.equal(
    redactAddresses(`Signing in as ${address}. This confirms you can read that inbox.`),
    "Signing in as <address> This confirms you can read that inbox.",
  );
  // Whatever quoting a screen read, a JSON dump or an alert puts around one.
  assert.equal(
    redactAddresses(JSON.stringify({ tail: `to "${address}" and <${address}>` })),
    '{"tail":"to \\"<address>\\" and <<address>>"}',
  );
  assert.equal(
    redactAddresses(`unknown-1@vitally.invalid and unknown-2@vitally.invalid`),
    "<address> and <address>",
  );
  // And nothing else is touched: the reference, the stages and the copy this
  // file asserts on have to survive a message unchanged.
  const ordinary =
    "VT-4UPB-2AKH Pending intake / filing · Someone else changed this case.";
  assert.equal(redactAddresses(ordinary), ordinary);
  assert.equal(redactAddresses(null), null);
  assert.equal(redactAddresses(undefined), undefined);
});

test(
  "Chrome client and Firefox staff run the whole demonstration story",
  { timeout: PERMUTATION_TIMEOUT_MS },
  (t) => runPermutation(t, { client: "chrome", staff: "firefox" }),
);

test(
  "Firefox client and Chrome staff run the whole demonstration story",
  { timeout: PERMUTATION_TIMEOUT_MS },
  (t) => runPermutation(t, { client: "firefox", staff: "chrome" }),
);
