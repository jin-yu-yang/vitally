import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appShell, staffSidebar, staffScreen, presenterScreen, page, clientHeader, languageSwitch, dialog, DRAWERS } from "../src/views.mjs";
import { icon, ICON_NAMES, describeFocus, focusSelectors } from "../src/ui.mjs";
import { TEXT, SENTENCES } from "../src/client-text.mjs";
import { toggleLabel } from "../src/sidebar-peek.mjs";
import { isStaffWindow } from "../src/contracts.mjs";

// Phase 0 of the redesign adds the frame without moving any screen into it,
// so the one thing that must hold today is that a page without a sidebar is
// untouched.
test("without a sidebar the page body comes back unchanged", () => {
  const body = `<main id="main">Work board</main>`;
  assert.equal(appShell({ body }), body);
  assert.equal(appShell({ body, sidebar: "" }), body);
});

test("with a sidebar the toggle names what it does and what it controls", () => {
  const open = appShell({ sidebar: "<nav>Links</nav>", body: "<main></main>" });
  assert.match(open, /class="app-shell"/);
  assert.match(open, /aria-controls="app-sidebar"/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-label="Hide the sidebar"/);
  assert.match(open, /<aside id="app-sidebar" class="app-sidebar" aria-label="Workspace">/);

  const closed = appShell({ sidebar: "<nav>Links</nav>", body: "<main></main>", open: false });
  assert.match(closed, /class="app-shell sidebar-closed"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /aria-label="Show the sidebar"/);
  assert.match(closed, /<aside[^>]* hidden>/);
});

test("every named icon draws its own shape rather than the fallback", () => {
  const fallback = icon("no-such-icon");
  for (const name of ICON_NAMES.filter((n) => n !== "file"))
    assert.notEqual(icon(name), fallback, name);
  for (const name of ["sidebar", "dashboard", "board", "bell", "label", "pin", "eye", "people", "chart"])
    assert.ok(ICON_NAMES.includes(name), name);
});

test("the staff sidebar carries the logo, the one screen that exists, and the account", () => {
  const alex = { id: "alex", name: "Alex", capabilities: ["prepare"] };
  const html = staffSidebar({ screen: "staff" }, alex, false);
  assert.match(html, /<img src="src\/pcdc-logo\.png" alt="PCDC"/);
  assert.match(html, /data-action="open-board"[^>]*aria-current="page"[^>]*>[\s\S]*Work board/);
  assert.match(html, /Alex/);
  assert.match(html, /data-action="open-help"/);
  assert.match(html, /data-action="sign-out"/);
  assert.match(html, /Sign out/);
  // Nothing without a screen behind it.
  assert.doesNotMatch(html, /Dashboard|Schedule|Documents|Messages|Notifications/);

  const office = staffSidebar({ screen: "staff-case" }, { id: "sam", name: "Sam", capabilities: ["admin"] }, true);
  assert.match(office, /Follow-ups/);
  assert.doesNotMatch(office, /aria-current/, "on a case, no nav item is current");
});

test("staff get the sidebar; clients get the client top bar and shell", () => {
  const staffPage = page({ principal: { access: "staff" }, connection: "online" }, "<main></main>");
  assert.doesNotMatch(staffPage, /class="client-bar"/);
  assert.doesNotMatch(staffPage, /class="client-shell"/);
  const client = page({ principal: { access: "applicant" }, connection: "online", screen: "applications" }, "<main></main>");
  assert.match(client, /<header class="client-bar">/);
  assert.match(client, /<div class="client-shell"><main><\/main><\/div>/);
});

// A closed sidebar carries `hidden` (see the `open: false` case above); the
// stylesheet must actually hide it. `.app-sidebar { display: flex }` used to
// win over the UA `[hidden]{display:none}` rule because both are author-level
// specificity 0-1-0 and the flex rule came second, so the fixed overlay could
// not be dismissed on narrow screens (final review, finding 1).
test("the stylesheet hides a closed sidebar rather than leaving it to the UA default", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../src/styles.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /\.app-sidebar\[hidden\]\s*\{[^}]*display:\s*none/);
});

test("the stylesheet draws a closed case's earlier lifecycle steps as neutral", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(css, /\.lifecycle-step\.neutral/);
  assert.match(
    css,
    /\.lifecycle-step\.neutral \+ \.lifecycle-step\.current::before\s*\{[^}]*var\(--vt-line\)/,
  );
});

test("an Exit Form group hides the fields its Result does not use (#108)", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(css, /\.q-exit-when-amount,\s*\.q-exit-when-refund,\s*\.q-exit-when-owe,\s*\.q-exit-when-debit\s*\{\s*display:\s*none;/);
  const shown = (result, part) =>
    new RegExp(`\\.q-exit-group-body:has\\(input\\[name\\$="\\.result"\\]\\[value="${result}"\\]:checked\\)[^,{]*\\.q-exit-when-${part}\\s*[,{]`);
  assert.match(css, shown("refund", "amount"));
  assert.match(css, shown("owe", "amount"));
  assert.match(css, shown("refund", "refund"));
  assert.match(css, shown("owe", "owe"));
  // The debit date needs both Owe and Direct debit, so switching an owed
  // direct debit to Refund hides it again.
  assert.match(
    css,
    /\.q-exit-group-body:has\(input\[name\$="\.result"\]\[value="owe"\]:checked\):has\(input\[name\$="\.oweBy"\]\[value="direct_debit"\]:checked\)\s*\.q-exit-when-debit\s*\{/,
  );
  assert.doesNotMatch(css, shown("none", "amount"));
});

// app.mjs has no DOM harness; the browser story proves what these lines do.
test("app.mjs makes the Exit Form for a staff window only, and records nothing", () => {
  const read = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const app = read("../src/app.mjs");
  assert.match(app, /case "view-exit-form":/);
  const body = app.slice(app.indexOf("async function viewExitForm"), app.indexOf("// ---- leaving Add a case"));
  assert.match(body, /if \(!isStaffWindow\(state\.principal\)\) return;/);
  assert.match(body, /spouseShown\(visible\)/);
  // The date on the form is today's, never the approval's.
  assert.match(body, /isoToday\(\)/);
  assert.match(body, /"The Exit Form could not be made\. Close this tab and try again\."/);
  assert.match(body, /message: "The Exit Form could not be made\. Try again\."/);
  // Only reads and reports: no controller call that saves anything.
  assert.deepEqual(
    [...new Set([...body.matchAll(/controller\.(\w+)/g)].map((match) => match[1]))].sort(),
    ["clearError", "getState", "noteLocalFailure"],
  );
  assert.doesNotMatch(read("../src/client-views.mjs"), /view-exit-form/);
  assert.doesNotMatch(read("../src/intake-views.mjs"), /view-exit-form/);
});

test("an inactive case tab is not displayed", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  // Any author `display` on .case-panel overrides [hidden] unless this exists.
  assert.match(css, /\.case-panel\[hidden\]\s*\{[^}]*display:\s*none/);
});

// The old `.case-tabs button` rule (0-1-1) used to beat the new `.case-tab`
// rule (0-1-0), leaving an inactive tab's label at a legacy green that fails
// contrast (final whole-branch review, finding 1). Nothing should style tabs
// through a bare `button` selector any more.
test("no legacy .case-tabs button selector styles the case tabs", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.doesNotMatch(css, /\.case-tabs\s+button/);
});

test("spinners stand still under reduced motion", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(css, /\.icon\.spin \{ animation: vt-spin [^}]*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.icon\.spin \{ animation: none; \}\s*\}/);
});

test("the client top bar: logo home, language, help, save on intake, sign out", () => {
  const signedIn = { principal: { access: "applicant" }, screen: "applications" };
  const html = clientHeader(signedIn);
  assert.match(html, /<button class="client-brand" data-action="open-applications" aria-label="ViTally home">/);
  assert.match(html, /<img src="src\/pcdc-logo\.png" alt="PCDC"/);
  assert.match(html, /data-action="open-help"/);
  assert.match(html, /data-action="sign-out"[^>]*>[\s\S]*Sign out/);
  assert.doesNotMatch(html, /data-action="save-exit"/, "Save & exit belongs to the intake only");
  const intake = clientHeader({ ...signedIn, screen: "intake", savedCase: { stage: "draft" } });
  assert.match(intake, /data-action="save-exit"[^>]*>Save &amp; exit/);
  const submitted = clientHeader({ ...signedIn, screen: "intake", savedCase: { stage: "received" } });
  assert.doesNotMatch(submitted, /data-action="save-exit"/);
  const signedOut = clientHeader({ principal: null, screen: "access" });
  assert.doesNotMatch(signedOut, /data-action="sign-out"/);
});

// Part 4d: the switch is live. Each button keeps its own lang and name, and
// carries data-value so describeFocus brings the keyboard back to it.
test("the language switch offers three live languages and marks the chosen one", () => {
  assert.match(languageSwitch("en"), /^<div class="language-switch" role="group" aria-label="Language">/);
  const html = languageSwitch("zh-Hant");
  assert.match(html, /^<div class="language-switch" role="group" aria-label="[^"]+">/);
  const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g);
  assert.equal(buttons.length, 3);
  for (const [lang, name] of [["en", "English"], ["zh-Hans", "简体中文"], ["zh-Hant", "繁體中文"]]) {
    const one = buttons.find((b) => b.includes(`lang="${lang}"`));
    assert.ok(one, lang);
    assert.match(one, /type="button"/);
    assert.match(one, /data-action="set-language"/);
    assert.match(one, new RegExp(`data-value="${lang}"`));
    assert.match(one, new RegExp(`>${name}</button>$`));
    assert.match(one, new RegExp(`aria-pressed="${lang === "zh-Hant"}"`));
    assert.doesNotMatch(one, /disabled|data-lang/);
  }
  assert.doesNotMatch(html, /coming soon|lang-note/i, "no coming-soon note");
  // The group's name is in the screen language; the buttons' names never are.
  assert.match(languageSwitch("zh-Hans"), /aria-label="语言"/);
  assert.match(languageSwitch(), /data-value="en"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-value="en"/);
  assert.match(languageSwitch("zh-Hant"), /class="lang current"[^>]*lang="zh-Hant"/);
});

test("the client header's switch shows the view language", () => {
  const header = clientHeader({ principal: { access: "applicant" }, screen: "applications", lang: "zh-Hans" });
  assert.match(header, /lang="zh-Hans"[^>]*aria-pressed="true"/);
  const signedOut = clientHeader({ principal: null, screen: "access", lang: "zh-Hant" });
  assert.match(signedOut, /lang="zh-Hant"[^>]*aria-pressed="true"/);
});

test("describeFocus brings the keyboard back to the pressed language button", () => {
  const pressed = { tagName: "BUTTON", id: "", name: "", dataset: { action: "set-language", value: "zh-Hans" } };
  const focus = describeFocus(pressed);
  assert.deepEqual(focus.related, [{ attribute: "data-value", value: "zh-Hans" }]);
  assert.deepEqual(focusSelectors(focus), ['[data-action="set-language"][data-value="zh-Hans"]']);
});

test("the page frame speaks the view language: a client's, never a staff account's", () => {
  const client = page({ principal: { access: "applicant" }, connection: "online", screen: "applications", lang: "zh-Hans" }, "<main></main>");
  assert.match(client, /^<a class="skip" href="#main">跳到主要内容<\/a>/);
  const signedOut = page({ principal: null, connection: "online", screen: "access", lang: "zh-Hans" }, "<main></main>");
  assert.match(signedOut, /^<a class="skip" href="#main">跳到主要内容<\/a>/);
  const staffPage = page({ principal: { access: "staff" }, connection: "online", screen: "staff", lang: "zh-Hans" }, "<main></main>");
  assert.match(staffPage, /^<a class="skip" href="#main">Skip to content<\/a>/);
  assert.match(page({ principal: null, connection: "online", screen: "access" }, "<main></main>"), /Skip to content/);
});

// Part 4d Task 6: the client frame in the client's language; staff stays English.
test("the client top bar, footer and dialogs speak the client's language", async () => {
  const { setHantMap } = await import("../src/hant.mjs");
  const { default: MAP } = await import("../src/zh-hant.mjs");
  const draft = {
    principal: { access: "applicant" },
    screen: "intake",
    savedCase: { stage: "draft", intakeVersion: 2 },
    draftAnswers: {},
    lang: "zh-Hans",
  };
  const header = clientHeader(draft);
  assert.match(header, /aria-label="ViTally 首页"/);
  assert.match(header, /data-action="toggle-senior"[\s\S]*长者版<\/button>/);
  assert.match(header, /data-action="open-help"[^>]*>[\s\S]*需要帮助？/);
  assert.match(header, /data-action="save-exit"[^>]*>保存并退出/);
  assert.match(header, /data-action="sign-out"[^>]*>[\s\S]*退出登录/);
  const frame = page({ ...draft, connection: "online", dialog: "help" }, "<main></main>");
  assert.match(frame, /<footer class="site-footer"><span>ViTally · 费城华埠发展会（PCDC）<\/span>/);
  assert.match(frame, /aria-label="关闭对话框"/);
  assert.match(frame, /<span class="overline">ViTally · 随时为您提供帮助<\/span>/);
  setHantMap(MAP);
  try {
    assert.match(page({ ...draft, lang: "zh-Hant", connection: "online" }, ""), /費城華埠發展會/);
  } finally {
    setHantMap(null);
  }
  // A staff account's help dialog and every staff dialog stay English.
  const staffPage = page({ principal: { access: "staff" }, connection: "online", screen: "staff", dialog: "help", lang: "zh-Hans" }, "");
  assert.match(staffPage, /A real person can help\./);
  assert.match(staffPage, /aria-label="Close dialog"/);
});

test("the help dialog gives the office phone and email", () => {
  const html = page({ principal: { access: "applicant" }, connection: "online", screen: "applications", dialog: "help" }, "<main></main>");
  assert.match(html, /href="tel:\+12159226156"/);
  assert.match(html, /href="mailto:vita@chinatown-pcdc\.org"/);
});

test("the old site header's styles are gone and the client shell sets its ink", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.doesNotMatch(css, /\.site-header\b/);
  assert.doesNotMatch(css, /\.header-divider\b/);
  assert.match(css, /\.client-shell\s*\{[^}]*color:\s*var\(--vt-intake-ink\)/);
  assert.match(css, /\.client-bar\s*\{/);
  assert.match(css, /\.office-contact\s*\{/);
});

test("staff case history keeps its own unscoped timeline text size, separate from the client override", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(
    css,
    /(?<![.\w-])\.timeline-item p\s*\{\s*font-size:\s*12px;\s*color:\s*#75876c;\s*\}/,
    "an unscoped .timeline-item p rule at 12px must still exist for staff screens",
  );
});

test("the body behind the restyled frames uses the lavender background, not the old canvas", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(
    css,
    /body:has\(\.client-shell\),\s*body:has\(\.app-shell\)\s*\{\s*background:\s*var\(--vt-background\);/,
  );
});

// ---------------------------------------------------------------------------
// The office drawers
// ---------------------------------------------------------------------------

const drawerSam = { id: "p-sam", name: "Sam", capabilities: ["admin", "followup", "assist"] };
const drawerCase = {
  id: "c1",
  reference: "VT-CALL",
  stage: "preparing",
  revision: 3,
  answers: {},
  followups: [{ id: "f1", status: "open", reason: "Ask for the W-2", assigneeId: "p-sam" }],
};
const drawerState = (over = {}) => ({
  principal: { access: "staff", personId: drawerSam.id },
  connection: "online",
  screen: "staff",
  people: [drawerSam],
  cases: [],
  assistance: [],
  ...over,
});

test("while a drawer is open, a refusal is announced once, by the drawer", () => {
  const error = { code: "VALIDATION", message: "Refused." };
  const open = page(
    drawerState({ error, dialog: "log-call", dialogContext: { caseId: "c1" }, savedCase: drawerCase }),
    "<main></main>",
  );
  assert.equal((open.match(/role="alert"/g) ?? []).length, 1);
  assert.match(open, /role="alert" id="drawer-error"/);
  assert.doesNotMatch(open, /problem-banner/);

  const closed = page(drawerState({ error, dialog: null }), "<main></main>");
  assert.equal((closed.match(/role="alert"/g) ?? []).length, 1);
  assert.match(closed, /class="problem-banner" role="alert"/);
});

test("the drawer is the modal frame at the edge, and each dialog names its place", () => {
  const drawer = dialog(
    drawerState({ dialog: "log-call", dialogContext: { caseId: "c1" }, savedCase: drawerCase }),
  );
  assert.match(drawer, /class="modal office-drawer"/);
  assert.match(drawer, /OFFICE FOLLOW-UP/);
  assert.match(drawer, /<h2[^>]*>Log contact<\/h2>/);
  assert.doesNotMatch(drawer, /Log a call|RECORD_CONTACT/);
  assert.match(drawer, /<form class="staff-form contact-form" data-case-id="c1" data-followup-id="f1">/);

  const help = dialog(
    drawerState({
      dialog: "resolve-help",
      dialogContext: { itemId: "h1" },
      assistance: [{ id: "h1", status: "assigned", assigneeId: "p-sam", title: "Letter", revision: 1 }],
    }),
  );
  assert.match(help, /class="modal office-drawer"/);
  assert.match(help, /Resolve a help request/);
  assert.match(help, /data-assistance-action="RESOLVE" data-item-id="h1"/);

  assert.match(dialog({ dialog: "help" }), /ViTally · HERE TO HELP/);
  assert.doesNotMatch(dialog({ dialog: "help" }), /office-drawer/);
});

test("the drawer list is exported once, for the renderer and app.mjs's focus fallback alike", () => {
  assert.deepEqual([...DRAWERS], ["log-call", "resolve-help"]);
  assert.ok(Object.isFrozen(DRAWERS));
  const app = readFileSync(fileURLToPath(new URL("../src/app.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(app, /\["log-call",\s*"resolve-help"\]/);
  assert.match(app, /views\.DRAWERS\.includes\(/);
});

// Part 4b2 (Task 8): app.mjs has no DOM harness, so the wiring is pinned at
// the source: every control the version-2 screens emit has its handler, and
// the step-index wiring it replaced is gone.
test("app.mjs handles every version-2 action and no longer moves the form by step index", () => {
  const read = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const app = read("../src/app.mjs");
  const screens = read("../src/intake-views.mjs");
  const emitted = new Set([
    ...[...screens.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]),
    ...[...screens.matchAll(/button\([^;]*?,\s*"([a-z-]+)",\s*"(?:primary|secondary|text|inline)/g)].map((match) => match[1]),
    ...(screens.includes('"mark-card"') ? ["mark-card"] : []),
  ]);
  for (const action of [
    "go-substep", "toggle-rail-step", "toggle-panel", "back-step", "change-substep",
    "back-to-summary", "mark-card", "print-summary", "view-draft",
    "summary-expand-all", "summary-collapse-all",
  ]) {
    assert.ok(emitted.has(action), `the screens emit ${action}`);
    assert.match(app, new RegExp(`case "${action}":`), `app.mjs handles ${action}`);
  }
  for (const action of emitted)
    assert.match(app, new RegExp(`case "${action}":`), `app.mjs handles ${action}`);
  assert.match(app, /controller\.moveSubstep\(1\)/, "Continue moves one sub-step");
  assert.match(app, /controller\.moveSubstep\(-1\)/, "Back moves one sub-step");
  assert.match(app, /member_id: newMemberId\(\)/, "a new person gets a member id");
  // Part 4b2 (Task 9): the draft 13614-C replaced the placeholder. The tab is
  // opened inside the press, before anything is awaited; the bundle loads on
  // demand; fonts are checked by sha256; a failure never leaves the tab on
  // "Preparing your draft…". Task 10's browser story presses the buttons.
  assert.doesNotMatch(app, /The draft is not available yet/);
  const draft = app.slice(app.indexOf("async function viewDraft("), app.indexOf("async function runNavigation("));
  assert.ok(draft.indexOf('window.open("", "_blank")') > 0, "the tab opens in the press");
  assert.ok(draft.indexOf('window.open("", "_blank")') < draft.indexOf("await "), "before anything is awaited");
  assert.match(draft, /await import\("\.\/vendor\/pdf-lib\.mjs"\)/);
  // Part 4d: its text is a key now (draft.preparing is "Preparing your draft…").
  assert.match(draft, /writeTab\(tab, t\("draft\.preparing", \{\}, screenLang\(\)\), kind\)/);
  assert.match(draft, /writeTab\(tab, t\("draft\.failed", \{\}, screenLang\(\)\), kind\)/);
  // Only staff make a 13614-C (hide-draft-13614c-from-clients): refused before any tab opens.
  const staffGuard = draft.search(/kind !== "14446" && [^\n]*!isStaffWindow\(controller\.getState\(\)\.principal\)[^\n]*\)\s*return/);
  assert.ok(staffGuard > 0, "viewDraft refuses a 13614-C for anyone but staff");
  assert.ok(staffGuard < draft.indexOf('window.open("", "_blank")'), "before any tab opens");
  assert.match(app, /kind === "14446" \? "draft14446\.tab_title" : "draft\.tab_title"/);
  assert.equal(TEXT["draft14446.tab_title"].en, "Draft Form 14446");
  assert.equal(TEXT["draft14446.tab_title"].zh, "14446 表草稿");
  // The Exit Form's tabs, preparing and failed, are titled for it, never as
  // the 13614-C draft (#122).
  assert.match(app, /kind === "exit-form"\s*\? "Exit Form"/);
  const exitTabs = app.match(/writeTab\(tab, "(?:Preparing the Exit Form|The Exit Form could not be made)[^"]*"[^)]*\)/g) ?? [];
  assert.equal(exitTabs.length, 2, "both Exit Form tab texts");
  for (const call of exitTabs) assert.match(call, /, "exit-form"\)$/, call);
  // The blocked-tab link goes with its URL (draft-pdf.mjs createDraftOffer),
  // and is offered after the build. It is kept outside the page and drawn
  // into #draft-ready after every render, so a redraw within its minute never
  // drops it; opening it, or a new press, ends the offer.
  assert.match(app, /const draftOffers = createDraftOffer\(\{\s*revoke: \(url\) => URL\.revokeObjectURL\(url\),\s*onExpire: \(\) => showDraftLink\(\),\s*\}\);/);
  assert.match(draft, /draftOffers\.drop\(\);\s*showDraftLink\(\);/, "an earlier press's link goes");
  assert.match(draft, /draftOffers\.keep\(url\);/);
  const built = draft.indexOf("await buildDraftPdf(");
  assert.ok(built > 0);
  assert.ok(draft.indexOf("draftOffers.offer(") > built, "the link is offered after the build");
  const show = app.slice(app.indexOf("function showDraftLink("), app.indexOf("async function viewDraft("));
  assert.match(show, /draftLink\(document, offer, t\("draft\.link", \{\}, screenLang\(\)\)\)/);
  // The offer is its maker's: any other principal (or none) ends it before
  // anything is drawn, and only that user's offer is ever drawn.
  assert.match(show, /const userId = signedInUserId\(\);\s*draftOffers\.follow\(userId\);\s*const ready = root\.querySelector\("#draft-ready"\);/);
  assert.match(show, /draftOffers\.current\(state\.savedCase\?\.id \?\? null, userId\)/);
  assert.match(draft, /draftOffers\.offer\(\{ url, fileName: fields\.fileName, caseId, userId \}\)/);
  assert.match(show, /addEventListener\("click", \(\) => draftOffers\.drop\(\)\)/, "an opened link is not drawn again");
  // Showing the link comes before the render's focus restore, so a keyboard
  // user on it stays on it (it has an id: draft-pdf.mjs draftLink).
  const renderBody = app.slice(app.indexOf("function render(focus = false) {"), app.indexOf("function v2OnPage("));
  assert.ok(renderBody.indexOf("showDraftLink();") > renderBody.indexOf("root.innerHTML = views.page("), "every render draws the link again");
  assert.ok(renderBody.indexOf("showDraftLink();") < renderBody.indexOf("restoreField("), "before the focus restore");
  // A create that lands after sign-out, or after somebody else signed in,
  // announces nothing (the rule is pinned with the other press messages).
  assert.match(app, /const started = await controller\.createCase\(\);\s*if \(started\) notify\("success", t\("toast\.started", \{\}, screenLang\(\)\), by\);/);
  assert.doesNotMatch(app, /if \(started && controller\.getState\(\)\.principal\)/);
  assert.match(app, /crypto\.subtle\.digest\("SHA-256"/);
  // Part 4d: the two failures are keys; their English is unchanged.
  assert.match(app, /writeTab\(tab, t\("draft\.failed", \{\}, screenLang\(\)\), kind\)/);
  assert.equal(TEXT["draft.failed"].en, "The draft could not be made. Close this tab and try again.");
  assert.equal(TEXT["draft.font_unchecked"].en, "The draft font could not be checked. Try again later.");
  assert.match(app, /case "view-draft":\s+await viewDraft\(/);
  // A draft that couldn't be built is an error (design D1).
  const viewDraftFn = app.slice(app.indexOf("async function viewDraft("), app.indexOf("// ---- leaving Add a case"));
  const draftCatch = viewDraftFn.slice(viewDraftFn.indexOf("} catch (error) {"), viewDraftFn.indexOf("// ---- leaving Add a case"));
  assert.match(viewDraftFn, /writeTab\(tab, t\("draft\.failed", \{\}, screenLang\(\)\), kind\)/);
  assert.match(viewDraftFn, /controller\.noteLocalFailure\(\s*\{\s*code: "DRAFT",\s*message: error\?\.draftFont \? "The draft font could not be checked\. Try again later\." : "The draft could not be made\. Try again\.",?\s*\},\s*\(\) => viewDraft\(form, by, kind\),?\s*\)/);
  // A built draft clears only the draft's own error, never the notice.
  assert.match(viewDraftFn, /\/\/ A draft that was built and offered[^\n]*\n\s*controller\.clearError\("DRAFT"\);/);
  assert.doesNotMatch(viewDraftFn, /dismissError/);
  assert.ok(draftCatch.startsWith("} catch (error) {"), "the catch block was found");
  assert.doesNotMatch(draftCatch, /notify\(/, "a draft failure never toasts");
  assert.doesNotMatch(viewDraftFn, /const failure/);
  assert.match(app, /const sent = await controller\.retryLast\(\);\s*if \(sent && !sent\.local\) notify\("success", t\("toast\.sent_again"/);
  assert.match(app, /addEventListener\("afterprint"/);
  for (const gone of [/goToStep\(/, /goToV2Step/, /"go-step"/, /still-title/, /\bstepStatus\(/, /rail-step-\$\{step\}-status/, /formStep/, /setFormStep/, /"edit-"/])
    assert.doesNotMatch(app, gone);
  // The Submit guard's decision is the controller's (guardSubmit, design D5):
  // app.mjs shows the toast and moves the keyboard, and checks nothing itself.
  const guard = app.slice(app.indexOf('if (type === "SUBMIT" && state.savedCase)'), app.indexOf('if (type === "RESPOND_DOCUMENT"'));
  assert.ok(guard.length > 0, "the SUBMIT block");
  assert.match(guard, /sweepV2Form\(\);[\s\S]*if \(!\(await controller\.guardSubmit\(\)\)\) \{[\s\S]*toast\.needs_change[\s\S]*focusV2Arrival\(\);[\s\S]*return;/);
  assert.doesNotMatch(guard, /invalidAnswers|missingToSubmit/);
  // A summary section is a panel; nothing else new is (design D7).
  const V2_PANELS = Function(`return ${/const V2_PANELS = (\/[^\n]+\/);/.exec(app)[1]}`)();
  for (const name of ["rail-all", "maybe:documents.identity", "summary-shut:about", "summary-shut:documents"])
    assert.ok(V2_PANELS.test(name), name);
  for (const name of ["summary-shut:", "summary-shut:about.you", "confirmed", "rail-open:about"])
    assert.equal(V2_PANELS.test(name), false, name);
});

// Part 4c (Task 2): the staff checklist emits mark-card, move-card and
// view-draft; app.mjs handles each, and move-card puts the group through the
// controller and returns the keyboard to the card.
test("app.mjs handles the staff checklist's actions", () => {
  const read = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const app = read("../src/app.mjs");
  const staff = read("../src/staff-views.mjs");
  for (const action of ["mark-card", "move-card", "view-draft"]) {
    assert.match(staff, new RegExp(`"${action}"`), `staff-views emits ${action}`);
    assert.match(app, new RegExp(`case "${action}":`), `app.mjs handles ${action}`);
  }
  const move = app.slice(app.indexOf('case "move-card":'), app.indexOf('case "print-summary":'));
  assert.match(move, /controller\.setDocumentGroup\(target\.dataset\.slot, target\.dataset\.group\)/);
  assert.match(move, /doc-\$\{dashed\(slot\)\}-status/);
});

// PR 4 (the office screens) styles its new containers in one marked block of
// the stylesheet, on the design tokens only.
const stylesheet = () =>
  readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");

test("the office drawer is the modal frame placed at the right edge", () => {
  const css = stylesheet();
  assert.match(css, /\.modal\.office-drawer\s*\{/);
  assert.match(css, /\.modal-backdrop:has\(\.office-drawer\)\s*\{[^}]*justify-content:\s*flex-end/);
});

test("the shared dialog notes read the tokens, so the help dialog's note is legible", () => {
  const css = stylesheet();
  assert.match(css, /\.modal \.info-note p\s*\{[^}]*color:\s*var\(--vt-/);
});

test("the office block of the stylesheet uses tokens, not hex colors", () => {
  const css = stylesheet();
  const start = css.indexOf("/* PR 4: office screens */");
  const end = css.indexOf("/* end PR 4 */");
  assert.ok(start >= 0 && end > start, "the PR 4 block is marked");
  const block = css.slice(start, end);
  const hexes = (block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => hex.toLowerCase() !== "#fff");
  assert.deepEqual(hexes, []);
});

test("the queue's row actions keep the 44px staff control minimum", () => {
  assert.match(stylesheet(), /\.office-queue \.queue-action \.btn\s*\{[^}]*min-height:\s*var\(--vt-tap\)/);
});

test("every filter chip, on every staff screen, keeps the 44px staff minimum", () => {
  // One base rule for the volunteer board, the office queue and the pool.
  assert.match(stylesheet(), /\n\.btn\.chip\s*\{[^}]*min-height:\s*var\(--vt-tap\)/);
});

test("the old palette is gone: every color and font reads a --vt-* token", () => {
  const css = stylesheet();
  for (const name of ["ink", "muted", "blue", "teal", "line", "canvas", "serif", "sans"]) {
    assert.doesNotMatch(css, new RegExp(`var\\(--${name}\\)`), `var(--${name}) is still read`);
    assert.doesNotMatch(css, new RegExp(`\\n\\s*--${name}:`), `--${name} is still defined`);
  }
});

test("the office drawer fills the dynamic viewport, with 100vh as the fallback", () => {
  const rule = stylesheet().match(/\.modal\.office-drawer\s*\{([^}]*)\}/)[1];
  assert.match(rule, /height:\s*100vh;\s*height:\s*100dvh;/);
  assert.match(rule, /max-height:\s*100vh;\s*max-height:\s*100dvh;/);
});

test("the client-number block of the stylesheet uses tokens, not hex colors", () => {
  const css = stylesheet();
  const start = css.indexOf("/* Part 2: client numbers */");
  const end = css.indexOf("/* end part 2 */");
  assert.ok(start >= 0 && end > start, "the part 2 block is marked");
  const block = css.slice(start, end);
  assert.match(block, /\.client-number\s*\{/);
  const hexes = (block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => hex.toLowerCase() !== "#fff");
  assert.deepEqual(hexes, []);
});

test("the print card shows the client number only when there is one", () => {
  const withNumber = dialog({ dialog: "print", savedCase: { reference: "VT-AB2C-DE3F", clientNumber: 93 } });
  assert.ok(withNumber.includes("CLIENT NUMBER") && withNumber.includes("#093"));
  const without = dialog({ dialog: "print", savedCase: { reference: "VT-AB2C-DE3F" } });
  assert.ok(!without.includes("CLIENT NUMBER") && !without.includes("#0"));
});

test("the senior switch shows on a version-2 intake draft only, pressed for the senior wording", () => {
  const v2 = (draftAnswers, overrides = {}) => ({
    principal: { access: "applicant" },
    screen: "intake",
    savedCase: { stage: "draft", intakeVersion: 2 },
    draftAnswers,
    ...overrides,
  });
  const toggle = (html) => /<button[^>]*data-action="toggle-senior"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0];
  const senior = toggle(clientHeader(v2({ form_version: "senior" })));
  assert.ok(senior, "the switch is on the version-2 form");
  assert.match(senior, /type="button"/);
  assert.match(senior, /aria-pressed="true"/);
  assert.match(senior, /Senior version/);
  assert.match(toggle(clientHeader(v2({ form_version: "general" }))), /aria-pressed="false"/);
  assert.match(toggle(clientHeader(v2({}))), /aria-pressed="false"/);
  // The top bar's order: language, the switch, Need help?, Save & exit.
  const bar = clientHeader(v2({}));
  const at = (text) => bar.indexOf(text);
  assert.ok(at('class="language-switch"') < at('data-action="toggle-senior"'));
  assert.ok(at('data-action="toggle-senior"') < at('data-action="open-help"'));
  assert.ok(at('data-action="open-help"') < at('data-action="save-exit"'));
  // Not after submission, not on other screens.
  assert.equal(toggle(clientHeader(v2({}, { savedCase: { stage: "received", intakeVersion: 2 } }))), undefined);
  assert.equal(toggle(clientHeader(v2({}, { screen: "progress" }))), undefined);
  assert.equal(toggle(clientHeader(v2({}, { screen: "applications" }))), undefined);
});

test("the part 4b block styles the version-2 form with tokens only", () => {
  const css = stylesheet();
  const start = css.indexOf("/* Part 4b: intake v2 */");
  const end = css.indexOf("/* end part 4b */");
  assert.ok(start >= 0 && end > start, "the part 4b block is marked");
  const block = css.slice(start, end);
  const hexes = (block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => hex.toLowerCase() !== "#fff");
  assert.deepEqual(hexes, []);
  // No new tokens.
  assert.doesNotMatch(block, /--vt-[\w-]+\s*:/);
  for (const selector of [
    ".rail-status.is-done",
    ".rail-status.is-needs",
    ".q-card",
    ".q-segmented",
    ".q-chip",
    ".hh-card",
    ".q-date",
    ".q-note.is-missing",
    ".q-note.is-invalid",
    ".q-count",
    ".save-chip.checking",
  ])
    assert.ok(block.includes(selector), `${selector} is styled`);
  // Part 4b2 replaced 4b's numbered rail and its "Still to answer" list; no
  // markup uses these any more, so their rules went with them.
  for (const gone of [/\.rail[\s,{]/, /\.rail-num\b/, /\.rail-digit\b/, /\.rail-body\b/, /\.rail-title\b/, /\.q-section-head\b/, /\.still-/])
    assert.doesNotMatch(css, gone);
  assert.match(block, /\.q-note\.is-invalid\s*\{[^}]*color:\s*var\(--vt-age-late-ink\)[^}]*\}/);
  assert.match(block, /\.q-note\.is-invalid\s*\{[^}]*border-left:[^;}]*var\(--vt-phase-attention\)/);
  assert.match(block, /\.q-note\.is-missing\s*\{[^}]*color:\s*var\(--vt-age-soon-ink\)/);
  assert.match(block, /\.save-chip\.checking\s*\{[^}]*color:\s*var\(--vt-age-late-ink\)/);
  // The live note and the count take no room when empty, and are never display:none.
  const empty = /\.q-note:empty,\s*\.q-count:empty\s*\{([^}]*)\}/.exec(block);
  assert.ok(empty, "an :empty rule covers both containers");
  assert.match(empty[1], /margin:\s*0/);
  assert.match(empty[1], /padding:\s*0/);
  assert.doesNotMatch(block, /\.q-(note|count)[^{]*\{[^}]*display:\s*none/);
  // The segmented radios are hidden visually, not from the keyboard, and the label shows focus.
  assert.doesNotMatch(block, /\.q-segmented input[^{]*\{[^}]*display:\s*none/);
  assert.match(block, /\.q-segmented input:focus-visible \+ span\s*\{[^}]*outline:/);
});

test("the part 4b2 block follows 4b's: icon-and-word marks, the phone bar and the summary print", () => {
  const css = stylesheet();
  const start = css.indexOf("/* Part 4b2: intake redesign */");
  const end = css.indexOf("/* end part 4b2 */");
  assert.ok(start >= 0 && end > start, "the part 4b2 block is marked");
  assert.ok(start > css.indexOf("/* end part 4b */"), "it comes after 4b's block");
  const block = css.slice(start, end);
  const hexes = (block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => hex.toLowerCase() !== "#fff");
  assert.deepEqual(hexes, []);
  assert.doesNotMatch(block, /--vt-[\w-]+\s*:/, "no new tokens");
  // Each mark draws its own glyph before the word, so the marks differ by shape, not colour alone.
  const glyphs = ["needs", "docs", "done"].map((key) => {
    const rule = new RegExp(`\\.rail-status\\.is-${key}::before\\s*\\{([^}]*)\\}`).exec(block);
    assert.ok(rule, `.rail-status.is-${key}::before is styled`);
    const content = /content:\s*("[^"]*"|'[^']*')/.exec(rule[1]);
    assert.ok(content && content[1].length > 2, `.rail-status.is-${key}::before sets a glyph`);
    return content[1];
  });
  assert.equal(new Set(glyphs).size, 3, "three different glyphs");
  // The document statuses, too.
  for (const key of ["not_done", "later", "none"]) assert.ok(block.includes(`.doc-status.is-${key}`), `.doc-status.is-${key} is styled`);
  // Phone width: the tree folds behind "All steps".
  const phone = /@media \(max-width: 800px\)\s*\{([\s\S]*?)\n\}/.exec(block);
  assert.ok(phone, "a phone-width rule set");
  assert.match(phone[1], /\.rail-phone\s*\{[^}]*display:\s*flex/);
  assert.match(phone[1], /\.rail-tree:not\(\.is-open\)\s*\{[^}]*display:\s*none/);
  assert.match(block, /\n\.rail-phone\s*\{[^}]*display:\s*none/);
  // Print: only the summary, while the body carries print-summary.
  const print = /@media print\s*\{([\s\S]*?)\n\}/.exec(block);
  assert.ok(print, "a print rule set");
  assert.match(print[1], /body\.print-summary #app > \*\s*\{\s*display:\s*block;\s*\}/);
  assert.match(print[1], /body\.print-summary \*\s*\{\s*visibility:\s*hidden;\s*\}/);
  assert.match(print[1], /body\.print-summary \.summary-print,\s*body\.print-summary \.summary-print \*\s*\{\s*visibility:\s*visible;\s*\}/);
  assert.match(print[1], /body\.print-summary \.summary-tools\s*\{\s*display:\s*none;\s*\}/);
  // Every section prints, collapsed or not; the toggles print as headings.
  assert.match(print[1], /\.summary-print \.summary-body\[hidden\]\s*\{\s*display:\s*block;\s*\}/);
  assert.match(print[1], /\.summary-toggle \.icon\s*\{\s*display:\s*none;\s*\}/);
});

// ---------------------------------------------------------------------------
// Part 4c, Task 4: Add a case by version, the leave dialog and the wiring.
// ---------------------------------------------------------------------------

const ADD_SAM = { id: "p-sam", name: "Sam", capabilities: ["admin", "followup", "assist", "receive_documents"] };
const addState = (over = {}) => ({
  principal: { userId: "p1", workspaceId: "w1", access: "staff", personId: ADD_SAM.id },
  people: [ADD_SAM],
  screen: "office-add-case",
  cases: [],
  assistance: [],
  savedCase: null,
  officeDraft: false,
  officeSaving: false,
  openAddSubsteps: ["before.ready"],
  addCaseShowMissing: false,
  draftAnswers: {},
  openPanels: [],
  revealed: [],
  boardFilters: {},
  busy: false,
  dirty: false,
  saveState: "idle",
  error: null,
  retryable: false,
  ...over,
});

test("Add a case is the office draft's page, a new draft or a saved one, once the workspace has loaded", () => {
  const fresh = staffScreen(addState({ workspace: { defaultIntakeVersion: 2 }, officeDraft: true }));
  assert.match(fresh, /<form id="add-case-v2-form"/);
  assert.doesNotMatch(fresh, /assisted-intake-form/);
  assert.match(fresh, /<h1>Add a case<\/h1>/);
  assert.match(staffScreen(addState({ workspace: { defaultIntakeVersion: 2 } })), /id="add-case-v2-form"/);
  const loading = staffScreen(addState({ workspace: null }));
  assert.match(loading, /<p class="loading-line" role="status">[\s\S]*<span>Loading…<\/span><\/p>/);
  assert.doesNotMatch(loading, /<form id="(assisted-intake-form|add-case-v2-form)"/);
  // A saved office draft opens on the page.
  const draftV2 = { id: "c2", reference: "VT-TWO2-0002", stage: "draft", ownerUserId: null, intakeVersion: 2, revision: 1, answers: {}, documentCards: [], materials: [], internalHistory: [] };
  assert.match(staffScreen(addState({ workspace: { defaultIntakeVersion: 2 }, savedCase: draftV2, selectedCaseId: "c2" })), /Application ID: VT-TWO2-0002[\s\S]*id="add-case-v2-form"/);
});

test("Add a case passes a conflict to its page, which offers the choice", () => {
  const draftV2 = { id: "c2", reference: "VT-TWO2-0002", stage: "draft", ownerUserId: null, intakeVersion: 2, revision: 5, answers: { tp_first_name: "Lan" }, documentCards: [], materials: [], internalHistory: [] };
  const html = staffScreen(
    addState({
      workspace: { defaultIntakeVersion: 2 },
      savedCase: draftV2,
      selectedCaseId: "c2",
      draftAnswers: { tp_first_name: "Mei" },
      dirty: true,
      conflict: { code: "REMOTE_CHANGED", baseRevision: 4, serverRevision: 5 },
    }),
  );
  assert.match(html, /<div class="application-meta">[\s\S]*?<section class="panel conflict-panel"[\s\S]*?<form id="add-case-v2-form"/);
});

test("the leave dialog asks before discarding the answers on Add a case", () => {
  const html = dialog({ dialog: "leave-add-case", dialogContext: { to: "open-board" } });
  assert.match(html, /<h2 id="modal-title">Leave without saving\?<\/h2>/);
  assert.match(html, /The answers on this page are not saved yet\. If you leave now, they are lost\. Nothing has been sent to the office\./);
  assert.match(html, /<button type="button" class="btn primary full" data-action="confirm-leave-add-case"[^>]*>Leave and discard<\/button>/);
  assert.match(html, /<button type="button" class="btn text" data-action="close-dialog"[^>]*>Keep editing<\/button>/);
});

test("app.mjs wires the version-2 Add a case", () => {
  const read = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const app = read("../src/app.mjs");
  const office = read("../src/office-views.mjs");
  const admin = read("../src/admin-views.mjs");
  for (const action of ["toggle-add-substep", "save-office-draft", "send-office-draft", "fill-assisted-intake", "open-board"])
    assert.match(office, new RegExp(`"${action}"`), `office-views emits ${action}`);
  assert.match(admin, /"continue-add-case"/);
  for (const action of [
    "toggle-add-substep", "save-office-draft", "send-office-draft", "continue-add-case",
    "confirm-leave-add-case", "open-add-case", "open-board", "open-cases", "fill-assisted-intake", "mark-card",
  ])
    assert.match(app, new RegExp(`case "${action}":`), `app.mjs handles ${action}`);
  // The leave guard sits at the top of each exit's handler.
  const handler = (action) => {
    const start = app.indexOf(`case "${action}":`);
    assert.ok(start >= 0, action);
    return app.slice(start, app.indexOf("\n      case ", start + 1));
  };
  for (const action of ["open-board", "open-cases", "open-add-case"]) {
    assert.match(handler(action), new RegExp(`if \\(leaveAddCaseFirst\\("${action}", target\\)\\) break;`), action);
    assert.match(handler(action), new RegExp(`EXITS\\["${action}"\\]\\(\\)`), action);
  }
  // Each exit's body, which the confirm runs past the guard.
  assert.match(app, /"open-board": \(\) => \{\s+formDrafts\.clear\(\);\s+controller\.navigate\("staff"\);/);
  assert.match(app, /"open-cases": \(\) => \{\s+formDrafts\.clear\(\);\s+controller\.navigate\("office-cases"\);/);
  assert.match(app, /"open-add-case": async \(\) => \{\s+formDrafts\.clear\(\);\s+await controller\.openAddCase\(\);/);
  assert.match(handler("continue-add-case"), /controller\.openAddCase\(\{ caseId: target\.dataset\.caseId \}\)/);
  const confirm = handler("confirm-leave-add-case");
  assert.match(confirm, /EXITS\[state\.dialogContext\?\.to\]/);
  assert.match(app, /openDialog\("leave-add-case", \{ to: action \}, describeFocus\(target\)\)/);
  // Both version-2 forms share the wiring; each control selector names its form.
  assert.match(app, /const V2_FORMS = "#intake-v2-form, #add-case-v2-form";/);
  assert.match(app, /const V2_CONTROLS = "#intake-v2-form \[data-control\]\[data-q\], #add-case-v2-form \[data-control\]\[data-q\]";/);
  assert.match(app, /form\.id === "add-case-v2-form"\) return;/, "an implicit submit never reaches reportValidity");
  assert.match(app, /controller\.saveOfficeDraft\(\{ send: true \}\)/);
  assert.match(app, /"The draft is saved\. Nobody was emailed\."/);
  // Fix round 1 (I2): the notice only when the save really landed.
  const save = handler("save-office-draft");
  assert.match(save, /const \{ reason \} = await controller\.saveOfficeDraft\(\);/);
  assert.match(save, /const landed =\s+!reason && Boolean\(after\.savedCase\) && !after\.dirty && \["saved", "idle"\]\.includes\(after\.saveState\);/);
  assert.match(save, /if \(landed\) notify\("info", "The draft is saved\. Nobody was emailed\.", by\);/);
  // Fix round 1 (I1): a reconcile on Add a case keeps the keyboard on the page.
  assert.match(app, /async function reconcile\(useMine, by\)[\s\S]*?if \(controller\.getState\(\)\.screen === "office-add-case" && !root\.contains\(document\.activeElement\)\)/);
  assert.match(app, /"The application is with the office\."/);
  assert.match(app, /"The draft is saved\. Some answers still need attention before it can be sent\."/);
  assert.match(app, /"Confirm that you have checked these answers with the client first\."/);
});

test("the part 4c block styles the version-2 Add a case with tokens only", () => {
  const css = stylesheet();
  const start = css.indexOf("/* Part 4c: staff views */");
  const end = css.indexOf("/* end part 4c */");
  const block = css.slice(start, end);
  for (const selector of [".add-step", ".add-sub-toggle", ".add-sub-summary", ".add-sub-status.is-needs", ".add-case-v2 .add-case-bar"])
    assert.ok(block.includes(selector), `${selector} is styled`);
  const hexes = (block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => hex.toLowerCase() !== "#fff");
  assert.deepEqual(hexes, []);
  assert.match(block, /\.add-sub-status\.is-needs::before\s*\{[^}]*content:/, "an icon as well as the words");
});

test("the shell's server-side toggle label matches the peek's label for pinned and collapsed", () => {
  const open = appShell({ sidebar: "<nav></nav>", body: "<main></main>" });
  assert.ok(open.includes(`aria-label="${toggleLabel({ pinned: true, peeking: false })}"`));
  const closed = appShell({ sidebar: "<nav></nav>", body: "<main></main>", open: false });
  assert.ok(closed.includes(`aria-label="${toggleLabel({ pinned: false, peeking: false })}"`));
});

test("app.mjs applies the sidebar peek in place after every render and feeds it events", () => {
  const app = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
  assert.match(app, /import \{[^}]*createSidebarPeek[^}]*\} from "\.\/sidebar-peek\.mjs"/);
  // Applied straight after the page is replaced, before focus is restored,
  // so a redraw keeps the peek and the keyboard can go back into the sidebar.
  assert.match(app, /root\.innerHTML = views\.page\(state, screenFor\(state\)\);\s*applyPeek\(\);/);
  for (const event of ["pointerover", "pointerout", "focusin", "focusout"])
    assert.match(app, new RegExp(`root\\.addEventListener\\("${event}"`), event);
  // Chrome's hover moving to root after a render removed the hovered node is not a leave.
  assert.match(app, /"pointerover", \(event\) => \{\s*if \(event\.target !== root\) peek\.pointer/);
  // Only keyboard focus holds a peek.
  assert.match(app, /:focus-visible/);
  // The toggle tells the peek whether the click pinned or collapsed.
  assert.match(app, /case "toggle-sidebar":[\s\S]{0,300}controller\.toggleSidebar\(\);[\s\S]{0,100}peek\.collapsed\(\)/);
  // A render re-syncs the peek's keyboard focus with where focus really is.
  assert.match(app, /peek\.focus\(peekZone\(document\.activeElement\) === "sidebar" && keyboardFocus\(document\.activeElement\)\);\s*lastPlace = place;/);
  // No shell on the screen ends any peek; Escape spares an IME composition.
  assert.match(app, /if \(!shell\) \{[\s\S]{0,120}peek\.setPinned\(true\)/);
  assert.match(app, /if \(event\.isComposing\) return;[\s\S]{0,200}peek\.escape\(\)/);
  assert.match(app, /peek\.escape\(\)/);
  // An open dialog holds the peek, and hiding the sidebar never strands the keyboard.
  assert.match(app, /peek\.hold\(Boolean\(controller\.getState\(\)\.dialog\)\)/);
  assert.match(app, /if \(hadFocus\) toggle\?\.focus\(\)/);
});

// ---------------------------------------------------------------------------
// Part 4d (Task 5): app.mjs's own text. It has no DOM harness, so the wiring
// is pinned at the source.
// ---------------------------------------------------------------------------

// Toasts on staff-only paths stay English (spec 2026-10-05 §2: staff screens
// are always English). Each is listed with the path that raises it.
const STAFF_ONLY_TOASTS = Object.freeze([
  // submitCloseUnsigned: the season-end close
  "The unsigned cases were closed as Dismissed.",
  // fillAssistedIntake: the office's fill on Add a case
  "Fictional details filled in. Nothing is saved yet.",
  // runCaseAction SUBMIT, staff branch only
  "The application is with the office. Record the intake checks next.",
  // runAssistanceAction RESOLVE: the office's help-request drawer
  "Say what you helped with before resolving this request.",
  // save-office-draft / send-office-draft: Add a case
  "The draft is saved. Nobody was emailed.",
  "The application is with the office.",
  "The draft is saved. Some answers still need attention before it can be sent.",
  "Confirm that you have checked these answers with the client first.",
]);

const appSource = () => readFileSync(fileURLToPath(new URL("../src/app.mjs", import.meta.url)), "utf8");

// Each notify(…) call's argument, up to its matching parenthesis.
function notifyArguments(source) {
  const found = [];
  for (const match of source.matchAll(/\bnotify\(/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    let quote = null;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    }
    found.push(source.slice(start, i - 1));
  }
  return found;
}

test("app.mjs writes no client text of its own: toasts and patched text go through t() or sentence()", () => {
  const app = appSource();
  // The direct forms first: a literal straight into notify or textContent.
  for (const match of app.matchAll(/notify\(\s*"(?:success|info|warning)",\s*(["'`])((?:(?!\1).)*)\1/g))
    assert.ok(STAFF_ONLY_TOASTS.includes(match[2]), `literal toast outside the staff allow-list: ${match[2]}`);
  for (const match of app.matchAll(/\.textContent = (["'`])((?:(?!\1).)+)\1/g))
    assert.fail(`literal textContent: ${match[2]}`);
  // Then every literal inside any notify(…), ternaries included. A text key
  // ("toast.saved") is not text, and a sentence(…) may name a known sentence.
  const calls = notifyArguments(app);
  assert.ok(calls.length > 20, "found the notify calls");
  // Every call names its kind first (design D4). The definition's own
  // parameter list is not a call.
  for (const call of calls)
    if (call !== "kind, text, by")
      assert.match(call, /^\s*"(success|info|warning)",/, `a toast without a kind: notify(${call.slice(0, 60)}…)`);
  for (const call of calls) {
    const said = call.replace(/^\s*"(success|info|warning)",\s*/, "");
    for (const literal of said.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
      const text = literal[2];
      if (/^[a-z_]+(\.[a-z_]+)+$/.test(text)) {
        assert.ok(Object.hasOwn(TEXT, text), `unknown text key ${text}`);
        continue;
      }
      if (said.startsWith("sentence(") && Object.hasOwn(SENTENCES, text)) continue;
      assert.ok(STAFF_ONLY_TOASTS.includes(text), `toast outside the staff allow-list: ${text}`);
    }
  }
  // Every allow-listed toast is really there (the list does not go stale).
  for (const text of STAFF_ONLY_TOASTS) assert.ok(app.includes(`"${text}"`), `still raised: ${text}`);
  // Errors never toast (design D1).
  assert.doesNotMatch(app, /notify\([^)]*error/);
  assert.match(app, /notify\("success", t\("toast\.saved"/);
  assert.match(app, /notify\("warning", t\("toast\.confirm_first"/);
  assert.match(app, /notify\("warning", t\("toast\.needs_change"/);
  assert.match(app, /import \{ TOAST_MS[^}]*\} from "\.\/toast\.mjs"|createToastTimer/);
  // The draft's own messages are keys now.
  assert.doesNotMatch(app, /DRAFT_FAILED|DRAFT_FONT_UNCHECKED/);
  assert.match(app, /"draft\.failed"/);
  assert.match(app, /"draft\.font_unchecked"/);
  // The resend countdown and button, and the in-place form text, take the view language.
  for (const key of ["signin.countdown", "signin.resend_in", "signin.resend", "draft.link", "draft.preparing", "draft.tab_title", "draft14446.tab_title"])
    assert.match(app, new RegExp(`"${key.replace(".", "\\.")}"`), key);
  assert.match(app, /noteState\(answer\.question, answer\.value, \{[\s\S]{0,160}lang/);
  assert.match(app, /noteState\(answer\.group, draft\[ref\.q\], \{[^}]*lang/);
  assert.match(app, /countText\(answer\.value, lang\)/);
  assert.match(app, /const marks = \{[\s\S]{0,300}lang/);
});

test("app.mjs: the switch, the saved language, other tabs, and the document's lang and title", () => {
  const app = appSource();
  // localStorage can throw just by being read.
  assert.doesNotMatch(app, /localStorage: window\.localStorage/);
  assert.match(app, /try \{\s*return window\.localStorage;\s*\} catch/);
  assert.match(app, /localStorage: readLocalStorage\(\)/);
  assert.match(app, /languages: /);
  // The map is loaded on demand and registered.
  assert.match(app, /const loadHant = createHantLoader\(\(url\) => import\(url\)\);/);
  assert.match(readFileSync(new URL("../src/hant.mjs", import.meta.url), "utf8"), /failures === 0 \? "\.\/zh-hant\.mjs" : `\.\/zh-hant\.mjs\?r=\$\{failures\}`/);
  // One request helper for the switch, other tabs and startup: only the newest wish applies.
  assert.match(app, /const languageRequests = createLanguageRequests\(\{ hantReady, loadHant \}\);/);
  // Outside the request helper, only the 繁體 draft waits for the map, and it
  // changes no language: the draft's lines need it whatever the screen shows.
  // It waits no longer than startup does (language.mjs loadHantWithin): a
  // hung load fails the draft (draft.failed) rather than leaving the tab on
  // "Preparing your draft…".
  assert.doesNotMatch(app, /await loadHant\(\)/, "nothing awaits the map without a timeout");
  assert.match(
    app,
    /async function viewDraft\(form, by, kind = "13614c"\) \{[\s\S]{0,1400}if \(kind !== "14446" && form === "zh-t"\) await loadHantWithin\(\{ hantReady, loadHant \}, HANT_START_TIMEOUT_MS\);\s*const fields = \(kind === "14446" \? draft14446Fields : draftFields\)\(/,
  );
  // Startup waits five seconds at most for a saved 繁體's map, and the draft as long.
  assert.match(app, /const HANT_START_TIMEOUT_MS = 5000;/);
  // Startup in 繁體: loaded before start through a request; 繁體 still wanted
  // without its map means 简体, undrawn, and the toast after the first render.
  assert.match(
    app,
    /if \(controller\.getState\(\)\.lang === "zh-Hant"\) \{[^]*?const outcome = await languageRequests\.want\("zh-Hant", \(\) => \{\}, \{ timeoutMs: HANT_START_TIMEOUT_MS \}\);\s*if \(controller\.getState\(\)\.lang === "zh-Hant" && \(outcome === "failed" \|\| !hantReady\(\)\)\) \{\s*controller\.adoptLanguage\("zh-Hans", \{ draw: false \}\);\s*pendingToast = "toast\.hant_failed_start";\s*\}\s*\}\s*controllerStarted = true;\s*await controller\.start\(\);\s*\}\s*$/,
  );
  assert.match(app, /if \(pendingToast\) \{\s*notify\("warning", t\(pendingToast, \{\}, lang\)\);\s*pendingToast = null;/);
  // The switch: sweep, then a request (a failure keeps the language).
  assert.match(
    app,
    /case "set-language": \{[\s\S]{0,200}sweepV2Form\(\);[\s\S]{0,200}const outcome = await languageRequests\.want\(lang, \(wanted\) => controller\.setLanguage\(wanted\)\);\s*if \(outcome === "failed"\) notify\("warning", t\("toast\.hant_failed", \{\}, screenLang\(\)\), by\);\s*break;/,
  );
  // Other tabs follow through a request, without writing it back, and draw nothing before start.
  assert.match(
    app,
    /window\.addEventListener\("storage", async \(event\) => \{[\s\S]{0,200}event\.key !== STORAGE_KEY[\s\S]{0,300}isLang\(lang\)[\s\S]{0,100}sweepV2Form\(\);\s*const outcome = await languageRequests\.want\(lang, \(wanted\) => \{[\s\S]{0,120}controller\.adoptLanguage\(wanted, \{ draw: controllerStarted \}\);/,
  );
  assert.ok(app.indexOf('window.addEventListener("storage"') < app.indexOf("controllerStarted = true;"));
  // After every render: <html lang> and the title in the view language.
  assert.match(
    app,
    /root\.innerHTML = views\.page\(state, screenFor\(state\)\);\s*applyPeek\(\);\s*const lang = viewLang\(state\);\s*document\.documentElement\.lang = lang;\s*document\.title = t\("frame\.title", \{\}, lang\);/,
  );
});

test("index.html keeps lang=\"en\" and today's title, which frame.title repeats", () => {
  const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  assert.match(html, /<html lang="en">/);
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  assert.equal(TEXT["frame.title"].en, title);
});

// Cleanup (version-2 save path): a Save that saved nothing for the open case
// resolves to null. Save, Save & exit and Submit's save first then neither
// say "Saved", nor leave, nor submit.
test("app.mjs treats a Save that saved nothing as not saved", () => {
  const app = readFileSync(fileURLToPath(new URL("../src/app.mjs", import.meta.url)), "utf8");
  const save = app.slice(app.indexOf('if (type === "SAVE_ANSWERS") {'), app.indexOf('if (type === "SUBMIT" && !state.openPanels'));
  assert.match(save, /if \(!\(await controller\.saveAnswers\(\)\)\) return;\s+clearFormDrafts\(form\);\s+notify\("success", t\("toast\.saved"/);
  const submit = app.slice(app.indexOf('if (type === "SUBMIT" && state.savedCase) {'), app.indexOf('if (type === "RESPOND_DOCUMENT"'));
  assert.match(submit, /if \(controller\.getState\(\)\.dirty && !\(await controller\.saveAnswers\(\)\)\) return;/);
  const exit = app.slice(app.indexOf('case "save-exit": {'), app.indexOf('case "fill-fictional":'));
  assert.match(exit, /if \(controller\.getState\(\)\.dirty && !\(await controller\.saveAnswers\(\)\)\) break;\s+controller\.navigate\("applications"\);/);
});

test("an unsent tick in a staff form is kept across a redraw, and goes when its form is put away", () => {
  const app = appSource();
  // Recorded on input (form-values.mjs: typed text, `{ value }` over a saved
  // value, `{ checked }`), except a box drawn from state; a field back to what
  // it was drawn with drops its draft. Put back by restoreDraft after every
  // render.
  assert.match(app, /if \(!isCheckable\(field\)\) keepDraft\(field\.id, textDraft\(field\)\);/);
  assert.match(
    app,
    /else if \(!field\.matches\("\[data-action\], #field-confirmed"\)\)\s+for \(const \[id, draft\] of checkDrafts\(field\)\) keepDraft\(id, draft\);/,
  );
  assert.match(app, /function keepDraft\(id, draft\) \{\s+if \(draft === null\) formDrafts\.delete\(id\);\s+else formDrafts\.set\(id, draft\);\s+\}/);
  assert.match(app, /for \(const \[id, value\] of formDrafts\)\s+restoreDraft\(root\.querySelector\(`#\$\{CSS\.escape\(id\)\}`\), value\);/);
  // Cancel on the best time drops the whole form's drafts, typed Note
  // included; any dialog closing drops its ticks.
  assert.match(app, /case "toggle-edit-contact":\s+\/\/[^\n]*\n\s+clearFormDrafts\(root\.querySelector\("#contact-form"\)\);/);
  assert.match(app, /for \(const form of root\.querySelectorAll\("\.modal form"\)\) clearFormTicks\(form\);\s+controller\.closeDialog\(\);/);
});

test("unsent staff-form entries belong to the one signed in", () => {
  const app = appSource();
  // Like the draft link (showDraftLink → draftOffers.follow), checked on every
  // render: a sign-out from another tab or an expired session counts too.
  const restore = app.slice(app.indexOf("function restoreFormDrafts() {"), app.indexOf("function findField("));
  assert.match(
    restore,
    /const userId = signedInUserId\(\);\s+if \(userId !== draftsOwner\) formDrafts\.clear\(\);\s+draftsOwner = userId;/,
  );
  assert.match(app, /let draftsOwner = null;/);
  const renderBody = app.slice(app.indexOf("function render(focus = false) {"), app.indexOf("function v2OnPage("));
  assert.ok(renderBody.indexOf("restoreFormDrafts();") > renderBody.indexOf("root.innerHTML = views.page("), "every render checks");
});

// A case can be left by paths that never pass `open-case` (the open case
// deleted elsewhere, then a board control's claim selects another), so the
// render checks which case the drafts belong to, beside whose they are. No
// case open keeps them: the board's own forms, and a list and back.
test("unsent staff-form entries belong to the case they were typed on", () => {
  const app = appSource();
  const restore = app.slice(app.indexOf("function restoreFormDrafts() {"), app.indexOf("function findField("));
  assert.match(
    restore,
    /draftsOwner = userId;\s+const state = controller\.getState\(\);\s+const caseId = state\.savedCase\?\.id \?\? state\.selectedCaseId \?\? null;\s+if \(caseId !== null && draftsCase !== null && caseId !== draftsCase\) formDrafts\.clear\(\);\s+if \(caseId !== null\) draftsCase = caseId;\s+for \(const \[id, value\] of formDrafts\)/,
  );
  assert.match(app, /let draftsCase = null;/);
});

// Cleanup (messages): a press awaits the controller and then says how it went.
// The person who pressed is the only one it is for: if another user is signed
// in by then, or nobody, it is not shown. Every press (click and submit) takes
// the signed-in user id first; each message after an await names it.
test("a press's result message is shown only while the person who pressed is signed in", () => {
  const app = appSource();
  assert.match(app, /function signedInUserId\(\) \{\s+return controller\.getState\(\)\.principal\?\.userId \?\? null;\s+\}/);
  assert.equal([...app.matchAll(/principal\?\.userId/g)].length, 1, "one notion of the signed-in user");
  // The one place the rule lives: notify, given who the press was made by.
  const notifyFn = app.slice(app.indexOf("function notify("), app.indexOf("function notify(") + 500);
  assert.match(notifyFn, /function notify\(kind, text, by\) \{\s+if \(by !== undefined && by !== signedInUserId\(\)\) return;/);
  // Taken at the start of the click and submit handlers (the change handler
  // awaits nothing and says nothing).
  const click = app.slice(app.indexOf('root.addEventListener("click"'), app.indexOf('root.addEventListener("input"'));
  const submit = app.slice(app.indexOf('root.addEventListener("submit"'), app.indexOf('window.addEventListener("afterprint"'));
  const change = app.slice(app.indexOf('root.addEventListener("change"'), app.indexOf('root.addEventListener("submit"'));
  assert.match(click, /root\.addEventListener\("click", async \(event\) => \{\s+\/\/[^\n]*\n\s+const by = signedInUserId\(\);/);
  assert.match(submit, /root\.addEventListener\("submit", async \(event\) => \{\s+event\.preventDefault\(\);\s+\/\/[^\n]*\n\s+const by = signedInUserId\(\);/);
  assert.doesNotMatch(change, /notify\(|await /);
  // Both handlers also take the error on screen at the press, for the safety net.
  assert.match(click, /const by = signedInUserId\(\);\s+const shown = controller\.getState\(\)\.errorCount;/);
  assert.match(submit, /const by = signedInUserId\(\);\s+const shown = controller\.getState\(\)\.errorCount;/);
  // The three catches: the safety net, never a toast (design D1).
  const net = /\} catch \(error\) \{\s+\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*safetyNet\(error, by, shown\);/g;
  assert.equal([...click.matchAll(net)].length, 1, "the click handler's catch is the safety net");
  assert.equal([...submit.matchAll(net)].length, 2, "both submit catches are the safety net");
  // The press functions take it from the handler that called them.
  assert.match(click, /await runCaseAction\(caseTarget, null, by\)/);
  assert.match(click, /await runAssistanceAction\(assistTarget, null, by\)/);
  assert.match(click, /await runNavigation\(target\.dataset\.action, target, by\)/);
  assert.match(submit, /await runCaseAction\(caseControl, form, by\)/);
  assert.match(submit, /await runAssistanceAction\(assistControl, form, by\)/);
  assert.match(app, /async function runCaseAction\(target, form = null, by\)/);
  assert.match(app, /async function runAssistanceAction\(target, form = null, by\)/);
  assert.match(app, /async function runNavigation\(action, target, by\)/);
  assert.match(app, /async function reconcile\(useMine, by\)/);
  assert.match(app, /async function viewDraft\(form, by, kind = "13614c"\)/);
  assert.match(app, /await reconcile\(true, by\)/);
  assert.match(app, /await reconcile\(false, by\)/);
  assert.match(app, /await viewDraft\(target\.dataset\.form \?\? "en", by, target\.dataset\.draft \?\? "13614c"\)/);
  // Every message in them names the presser, but two that come before any
  // await (nobody can have changed): Submit's "confirm first" and Resolve's
  // "say what you helped with".
  const press = [
    app.slice(app.indexOf("async function reconcile("), app.indexOf("// ---- workflow actions")),
    app.slice(app.indexOf("async function runCaseAction("), app.indexOf("// ---- navigation actions")),
    app.slice(app.indexOf("async function viewDraft("), app.indexOf("// ---- leaving Add a case")),
    app.slice(app.indexOf("async function runNavigation("), app.indexOf('root.addEventListener("input"')),
    submit,
  ];
  const BEFORE_ANY_AWAIT = [
    '"warning", t("toast.confirm_first", {}, screenLang())',
    '"warning", "Say what you helped with before resolving this request."',
  ];
  // "Before any await" is checked, not assumed: a later await put ahead of
  // either message on its way would let another user sign in first. The one
  // await ahead of Submit's message in runCaseAction is Save's branch, which
  // returns before the Submit check is reached.
  const awaitsBefore = (name, message) => {
    const fn = app.slice(app.indexOf(`async function ${name}(`));
    const at = fn.indexOf(`notify(${message})`);
    assert.ok(at >= 0, `${name} says ${message}`);
    let before = fn.slice(0, at);
    const save = before.indexOf('if (type === "SAVE_ANSWERS") {');
    if (save >= 0) {
      let depth = 0;
      let end = before.indexOf("{", save);
      for (; end < before.length; end += 1) {
        if (before[end] === "{") depth += 1;
        else if (before[end] === "}" && --depth === 0) break;
      }
      assert.match(before.slice(save, end), /return;\s*$/, "Save's branch returns");
      before = before.slice(0, save) + before.slice(end + 1);
    }
    return before.match(/\bawait\b/g)?.length ?? 0;
  };
  assert.equal(awaitsBefore("runCaseAction", BEFORE_ANY_AWAIT[0]), 0, "Submit's confirm-first is shown before any await");
  assert.equal(awaitsBefore("runAssistanceAction", BEFORE_ANY_AWAIT[1]), 0, "Resolve's say-what-you-did is shown before any await");
  let said = 0;
  for (const call of press.flatMap(notifyArguments)) {
    if (BEFORE_ANY_AWAIT.includes(call)) continue;
    said += 1;
    assert.match(call, /,\s*by$/, `a message after an await names who pressed: ${call}`);
  }
  // 21 since the three catches became the safety net (design D1); 20 since a
  // draft that couldn't be built went to the banner instead of a toast.
  assert.ok(said >= 20, `found the press messages (${said})`);
  // The one that was reported and is still here: the client's "started"
  // (which used to ask only that somebody was signed in).
  assert.match(app, /if \(started\) notify\("success", t\("toast\.started", \{\}, screenLang\(\)\), by\);/);
});

test("the safety net and the toast host (design D1, D4)", () => {
  const app = appSource();
  const net = app.slice(app.indexOf("function safetyNet("), app.indexOf("function safetyNet(") + 900);
  assert.match(net, /if \(by !== signedInUserId\(\)\) return;/);
  assert.match(net, /const state = controller\.getState\(\);\s*if \(!state\.principal \|\| state\.authError\) return;/);
  // getState() clones the error, so only the count says nothing new was recorded.
  assert.match(net, /if \(state\.errorCount !== shown\) return;/);
  assert.doesNotMatch(net, /state\.error !== shown/);
  assert.match(net, /controller\.noteLocalFailure\(/);
  assert.match(app, /root\.after\(toastHost\)/);
  assert.match(app, /setAttribute\("role", "status"\)/);
  assert.doesNotMatch(app, /toastHost\.setAttribute\("role"/, "the live region is the text span, not the host");
  // The live region stays in the accessibility tree while the host is hidden
  // (it is empty then), so a toast's words are announced.
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  assert.match(css, /\.toast \.toast-text \{[^}]*visibility: visible;/);
  assert.match(css, /\.toast:not\(\.visible\) \.toast-text \{ pointer-events: none; \}/, "a hidden toast never takes a click");
  // The text goes after the 0.2 s fade, and only if no toast came meanwhile.
  const onHide = app.slice(app.indexOf("onHide: () => {"), app.indexOf("toastHost.addEventListener(\"mouseenter\""));
  assert.match(onHide, /window\.setTimeout\(\(\) => \{\s*if \(!toast\.shown\) toastText\.textContent = "";\s*\}, 200\);/);
  assert.doesNotMatch(onHide, /^\s*toastText\.textContent = "";$/m, "never cleared at once");
  // A replacing toast keeps the hold the page still has (no new mouseenter or
  // focusin fires under a pointer or focus that hasn't moved).
  const notifyFn = app.slice(app.indexOf("function notify("), app.indexOf("function safetyNet("));
  assert.match(
    notifyFn,
    /toast\.show\(kind\);\s*(?:\/\/[^\n]*\n\s*)*toast\.hover\(toastHost\.matches\(":hover"\)\);\s*toast\.focus\(toastHost\.contains\(document\.activeElement\)\);\s*\}/,
  );
});

test("a pressed control is found again after a redraw (design D5)", () => {
  const claim = { id: "", name: "", dataset: { caseAction: "CLAIM_PREPARATION", caseId: "case-7" }, tagName: "BUTTON" };
  const help = { id: "", name: "", dataset: { assistanceAction: "CLAIM", itemId: "help-3" }, tagName: "BUTTON" };
  assert.ok(focusSelectors(describeFocus(claim)).some((s) => s.includes('data-case-action="CLAIM_PREPARATION"') && s.includes('data-case-id="case-7"')));
  assert.ok(focusSelectors(describeFocus(help)).some((s) => s.includes('data-assistance-action="CLAIM"') && s.includes('data-item-id="help-3"')));
  // A pressed control that is known by its id is found again by that id.
  const byId = { id: "save-draft-submit", name: "", dataset: {}, tagName: "BUTTON" };
  assert.deepEqual(focusSelectors(describeFocus(byId)), ['[id="save-draft-submit"]']);
});

test("app.mjs marks only the allow-listed press while it runs (design D5)", () => {
  const app = appSource();
  assert.match(app, /const BUSY_ACTIONS = Object\.freeze\(\["save-office-draft", "send-office-draft"\]\);/);
  const allow = app.slice(app.indexOf("function busyControl("), app.indexOf("function busyControl(") + 600);
  assert.match(allow, /dataset\.caseAction \|\| control\.dataset\.assistanceAction/);
  assert.match(allow, /BUSY_ACTIONS\.includes\(control\.dataset\.action\)/);
  assert.match(app, /pressed = null;\s*if \(busyControl\(target\)\) pressed = describeFocus\(target\);/);
  assert.match(app, /pressed = null;\s*if \(event\.submitter && busyControl\(event\.submitter\)\) pressed = describeFocus\(event\.submitter\);/);
  const mark = app.slice(app.indexOf("function markPressed("), app.indexOf("function markPressed(") + 900);
  assert.match(mark, /if \(!state\.busy && !state\.officeSaving\) \{\s*pressed = null;\s*return;\s*\}/);
  assert.match(mark, /if \(!pressed\) return;/);
  assert.doesNotMatch(mark, /saveState/);
  assert.match(mark, /control\.classList\.contains\("is-busy"\)/);
  assert.match(mark, /setAttribute\("aria-busy", "true"\)/);
  assert.match(mark, /icon\("spinner", "spin"\)/);
  const renderBody = app.slice(app.indexOf("function render(focus = false) {"), app.indexOf("function v2OnPage("));
  assert.match(renderBody, /markPressed\(state\);/);
});

test("errors share one look (design D7)", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  for (const token of ["--vt-error-bg: #fbeceb", "--vt-error: #8a3b34", "--vt-attention-bg: #faf0dd"])
    assert.ok(css.includes(token), token);
  assert.match(css, /\.notice\.error p \{[^}]*color: var\(--vt-error\)/);
  assert.match(css, /\.office-drawer \.notice\.error/);
  assert.match(css, /\.unloaded-line \{ color: var\(--vt-error\); \}/);
  assert.doesNotMatch(css, /\.unloaded-line \{[^}]*#8a3b34/);
  assert.doesNotMatch(css, /\.office-drawer \.notice\.amber/);
});

test("app.mjs says back online only after a real loss (design D7)", () => {
  const app = appSource();
  const renderBody = app.slice(app.indexOf("function render(focus = false) {"), app.indexOf("function v2OnPage("));
  assert.match(renderBody, /if \(\["offline", "reconnecting"\]\.includes\(drawnConnection\) && state\.connection === "online"\)\s*notify\("info", t\("toast\.back_online", \{\}, lang\)\);\s*drawnConnection = state\.connection;/);
  assert.match(app, /let drawnConnection = "unknown";/);
});

test("the page behind an open dialog is inert, on every render, and never when it closes", () => {
  const app = appSource();
  const renderBody = app.slice(app.indexOf("function render(focus = false)"), app.indexOf("function render(focus = false)") + 6000);
  const inertLoop = "for (const child of root.children) child.inert = Boolean(state.dialog) && inertWhileDialog(child);";
  assert.ok(renderBody.includes(inertLoop), "every render recomputes inert");
  assert.ok(renderBody.indexOf(inertLoop) > renderBody.indexOf("root.innerHTML = views.page("), "after the page is drawn");
  const closeBody = app.slice(app.indexOf("function closeDialog("), app.indexOf("function fictional("));
  const clear = "for (const child of root.children) child.inert = false;";
  assert.ok(closeBody.includes(clear), "closing clears inert itself (a held render may not)");
  assert.ok(closeBody.indexOf(clear) > closeBody.indexOf("controller.closeDialog();"));
  assert.ok(closeBody.indexOf(clear) < closeBody.indexOf("findField(focusBeforeDialog)"), "before focus goes back");
});

test("the Tab trap asks trapTarget, so the dialog itself cannot be tabbed out of", () => {
  const app = appSource();
  assert.match(app, /const target = trapTarget\(focusable, document\.activeElement, event\.shiftKey\);/);
  assert.doesNotMatch(app, /document\.activeElement === first\)/);
});

// The contact log (change add-contact-log, Task 4): app.mjs has no DOM
// harness, so its wiring is pinned at the source, like the version-2 actions.
test("app.mjs wires the Log contact form, Copy, Copy all and Edit", () => {
  const read = (file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const app = read("../src/app.mjs");
  const views = read("../src/staff-views.mjs");
  for (const action of ["toggle-contact-edit", "copy-contact", "copy-all-contacts"]) {
    assert.match(views, new RegExp(`"${action}"`), `the Contacts tab emits ${action}`);
    assert.match(app, new RegExp(`case "${action}":`), `app.mjs handles ${action}`);
  }
  // The submit goes through the form builder, to the controller's own calls,
  // never through a case action.
  assert.match(app, /form\.matches\("\.contact-form"\)[^]*?submitContact\(form, by\)/);
  assert.match(app, /contactEntryFromForm\(values\)/);
  assert.match(app, /controller\.logContact\(caseId, entry, followupId \|\| null\)/);
  assert.match(app, /controller\.editContact\(contactId, entry\)/);
  // The outcome groups follow the radios after every restore and every change.
  assert.match(app, /restoreFormDrafts\(\);\n\s*syncContactForms\(\);/);
  assert.match(app, /set\.hidden = !on;\n\s*set\.disabled = !on;/);
  // Copy writes the same lines the page shows.
  assert.match(app, /navigator\.clipboard\.writeText\(one \? contactSummary\(one, options\) : contactSummaries\(contacts, options\)\)/);
  for (const toast of [
    "The contact is logged.", "The contact is updated.", "Copied.",
    "Copy did not work. Select the line and copy it by hand.", "Type the name of the person you contacted.",
  ])
    assert.ok(app.includes(`"${toast}"`), toast);
  assert.match(app, /`Copied \$\{n\} contacts\.`/);
  // The old attempt is gone from the browser, notice and all.
  assert.doesNotMatch(app, /RECORD_CONTACT/);
});

test("app.mjs opens, closes and announces the two e-file confirmations", () => {
  const app = appSource();
  // Both open from the case page or from a Follow-ups row. A row selects its
  // case in place (no navigation, so screening never starts from the queue),
  // and the dialog opens only once that case is the one loaded.
  const opener = app.slice(app.indexOf('case "open-mark-ready-to-efile":'), app.indexOf('case "open-log-call":'));
  assert.match(
    opener,
    /case "open-mark-ready-to-efile":\s+case "open-close-case":\s+case "open-mark-efiled":\s+case "open-record-filing-result":\s+case "open-return-to-signing":\s+case "open-request-documents":\s+case "open-put-on-hold":\s+case "open-resume-from-hold":\s+case "open-withdraw": \{/,
  );
  assert.match(app, /"open-close-case": "close-case"/);
  assert.match(app, /"open-request-documents": "request-documents"/);
  assert.match(app, /"open-put-on-hold": "put-on-hold"/);
  assert.match(app, /"open-resume-from-hold": "resume-from-hold"/);
  // The toasts of the intake-and-closing moves.
  assert.match(app, /REQUEST_DOCUMENTS_AT_INTAKE: "The documents are requested\."/);
  assert.match(app, /PUT_ON_HOLD: "The case is on hold\."/);
  assert.match(app, /RESUME_FROM_HOLD: "The case is back in progress\."/);
  assert.match(app, /CLOSE_CASE: "The case is closed\."/);
  assert.match(dialog({ dialog: "request-documents", savedCase: { reference: "VT-X" } }), /Ask for documents\?/);
  assert.match(dialog({ dialog: "put-on-hold", savedCase: { reference: "VT-X" } }), /Put this case on hold\?/);
  assert.match(dialog({ dialog: "resume-from-hold", savedCase: { reference: "VT-X" } }), /Got in touch\?/);
  assert.match(opener, /const opener = describeFocus\(target\);/);
  assert.match(opener, /const caseId = target\.dataset\.caseId;/);
  assert.match(opener, /const name = CASE_DIALOGS\[target\.dataset\.action\];/);
  assert.match(app, /"open-mark-efiled": "mark-efiled"/);
  assert.match(app, /"open-record-filing-result": "record-filing-result"/);
  assert.match(app, /"open-return-to-signing": "return-to-signing"/);
  assert.match(opener, /if \(caseId\) \{\s+controller\.dismissError\(\);\s+await controller\.selectCase\(caseId, \{ navigate: false \}\);\s+if \(controller\.getState\(\)\.savedCase\?\.id !== caseId\) break;\s+\}\s+openDialog\(name, null, opener\);/);
  // After a confirm the keyboard goes back to the opener, or, when its row has
  // left the queue, to the case title or the queue heading, whichever screen it is.
  assert.match(app, /if \(type === "MARK_READY_TO_EFILE" && receipt\) closeDialog\("#case-title, #office-queue-title"\);/);
  assert.match(app, /if \(type === "MARK_EFILED" && receipt\) closeDialog\("#case-title, #office-queue-title"\);/);
  assert.match(app, /MARK_READY_TO_EFILE: "Marked ready to e-file\. The client was told\."/);
  assert.match(app, /MARK_EFILED: "Marked e-filed\. The client was told\."/);
  // The two moves after E-filed open from the same places and announce themselves.
  assert.match(app, /if \(type === "RECORD_FILING_RESULT" && receipt\) closeDialog\("#case-title, #office-queue-title"\);/);
  assert.match(app, /if \(type === "RETURN_TO_SIGNING" && receipt\) closeDialog\("#case-title, #office-queue-title"\);/);
  assert.match(app, /RECORD_FILING_RESULT: "The filing result is recorded\."/);
  assert.match(app, /RETURN_TO_SIGNING: "The case is back at signing\."/);
  // The shared modal frame places both.
  assert.match(dialog({ dialog: "mark-ready-to-efile", savedCase: { reference: "VT-X" } }), /Mark ready to e-file\?/);
  assert.match(dialog({ dialog: "mark-efiled", savedCase: { reference: "VT-X" } }), /Mark e-filed\?/);
});

test("a presenter is not a staff window", () => {
  assert.equal(isStaffWindow({ access: "presenter" }), false);
  assert.equal(isStaffWindow({ access: "staff" }), true);
  assert.equal(isStaffWindow({ access: "applicant" }), false);
});

test("the presenter screen says the account is no longer used", () => {
  const html = presenterScreen({ principal: { access: "presenter" } });
  assert.ok(html.includes("This account is no longer used"));
  assert.ok(html.includes("Presenter mode has been removed. Ask your site coordinator for a staff account."));
  assert.deepEqual([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]), ["sign-out"]);
  for (const gone of ["select-person", "open-reset-fixtures", "open-checkpoint", "Class workspace", "board-row"])
    assert.ok(!html.includes(gone), gone);
});

test("a presenter gets the plain screen in a bare English frame", () => {
  const state = { principal: { access: "presenter" }, connection: "online", screen: "presenter", lang: "zh-Hans" };
  const html = page(state, presenterScreen(state));
  assert.equal([...html.matchAll(/data-action="sign-out"/g)].length, 1);
  for (const gone of ["set-language", "open-help", "open-applications", "client-bar", "client-shell", "site-footer", 'class="skip"'])
    assert.ok(!html.includes(gone), gone);
  assert.ok(!/[一-鿿]/.test(html), "no Chinese characters");
  assert.ok(html.includes("This account is no longer used"));
});

test("a refusal shows in the error banner and the staff window stays usable", () => {
  const state = {
    principal: { access: "staff", personName: "Sam" },
    connection: "online",
    screen: "staff",
    people: [],
    cases: [],
    assistance: [],
    error: { code: "FORBIDDEN", message: "You do not have access to that." },
  };
  const html = page(state, staffScreen(state));
  assert.match(html, /class="problem-banner"[\s\S]*You do not have access to that\./);
  assert.match(html, /data-action="dismiss-error"/);
  assert.match(html, /data-action="open-board"/, "the sidebar is still there");
});

test("no staff screen offers a persona, a reset or a checkpoint", () => {
  const people = [{ id: "p-sam", name: "Sam", capabilities: ["prepare"] }];
  const base = { principal: { access: "staff", personId: "p-sam", personName: "Sam" }, connection: "online", people, cases: [], assistance: [], demoTools: true };
  const board = staffScreen({ ...base, screen: "staff" });
  const casePage = staffScreen({
    ...base,
    screen: "staff-case",
    savedCase: { id: "c1", reference: "VT-TEST-0001", stage: "preparing", revision: 1, answers: {} },
  });
  for (const html of [board, casePage])
    for (const gone of ["select-person", "open-reset-fixtures", "open-checkpoint", "presenter-panel", "Class workspace"])
      assert.ok(!html.includes(gone), gone);
});

test("a staff account's screens name it and act as no one", () => {
  const sam = { id: "p-sam", name: "Sam", capabilities: ["admin"] };
  const base = { principal: { access: "staff", personId: "p-sam", personName: "Sam" }, connection: "online", people: [sam], cases: [], assistance: [] };
  const board = staffScreen({ ...base, screen: "staff" });
  assert.match(board.match(/<div class="account-row">[\s\S]*?<\/span><\/div>/)[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /Signed in as Sam/);
  assert.doesNotMatch(board, /Presenter controls|No persona chosen|Acting as/);
  const onCase = staffScreen({
    ...base,
    people: [{ id: "p-sam", name: "Sam", capabilities: ["prepare"] }],
    screen: "staff-case",
    savedCase: { id: "case-1", reference: "VT-AB2C-DE3F", stage: "preparation_ready", answers: {} },
  });
  assert.match(onCase, /Everything this case holds, and the work you may do on it\.</);
  assert.doesNotMatch(onCase, /acting as/i);
  // The Add a case fill pill follows the switch alone.
  const add = { ...base, screen: "office-add-case", workspace: { defaultIntakeVersion: 2 }, officeDraft: true, draftAnswers: {} };
  assert.match(staffScreen({ ...add, demoTools: true }), /data-action="fill-assisted-intake"/);
  assert.doesNotMatch(staffScreen({ ...add, demoTools: false }), /fill-assisted-intake/);
});
