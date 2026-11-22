import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderSeasonSettings,
  changeSidnDialogBody,
  startSeasonDialogBody,
  seasonRefusalLines,
  startSeasonReady,
  seasonLabel,
  LINK_MESSAGE,
} from "../src/season-settings-views.mjs";
import { staffScreen, dialog } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people and links only.
const view = (over = {}) => ({
  season: 2027,
  certificateUploadUrl: "https://example.org/certificates",
  clientDocumentsUrl: null,
  revision: 3,
  siteNumber: { set: true, updatedAt: "2026-11-19T15:00:00Z" },
  canEdit: true,
  siteCoordinators: [
    {
      volunteerId: "p-dana",
      name: "Dana Wu",
      email: "dana@example.org",
      since: "2026-11-02T15:00:00Z",
      onRoster: true,
      accountRevision: 4,
    },
    {
      volunteerId: "p-lee",
      name: "Lee Park",
      email: "lee@example.org",
      since: "2026-10-28T15:00:00Z",
      onRoster: false,
      accountRevision: 2,
    },
  ],
  candidates: [{ volunteerId: "p-ana", name: "Ana Ortiz", accountRevision: 1 }],
  history: [
    { personName: "Lee Park", granted: true, changedByName: "Dana Wu", changedAt: "2026-11-10T15:00:00Z" },
    { personName: "Kim Bell", granted: false, changedByName: "Dana Wu", changedAt: "2026-11-05T15:00:00Z" },
    { personName: "Dana Wu", granted: true, changedByName: null, changedAt: "2026-11-02T15:00:00Z" },
  ],
  ...over,
});

test("the season label is the season for the tax year before it", () => {
  assert.equal(seasonLabel(2027), "2027 for TY 2026");
});

test("the editable page", () => {
  const html = renderSeasonSettings(view(), { canEdit: true, selfId: "p-dana", ui: {} });
  assert.match(html, /2027 for TY 2026/);
  assert.match(html, />Current</);
  assert.match(html, /<label class="field" for="settings-certificate-link"><span>Certificate and photo ID upload link<\/span>/);
  assert.match(html, /<label class="field" for="settings-documents-link"><span>Client documents upload link<\/span>/);
  assert.match(html, /value="https:\/\/example\.org\/certificates"/);
  assert.ok(html.includes("Volunteers open this from &quot;Finish your setup&quot;. Use a folder only site coordinators can see."));
  assert.ok(html.includes("Clients open this to send documents."));
  assert.match(html, /<form id="season-settings-form"[^>]*>/);
  assert.match(html, /<button type="submit" class="btn primary"[^>]*>Save<\/button>/);
  assert.match(html, /Set · updated Nov 19, 2026/);
  assert.match(html, /Volunteers type it at their first sign-in\./);
  assert.match(html, /data-action="open-change-sidn"[^>]*>Change…<\/button>/);
  // Site coordinators.
  assert.match(html, /<h2[^>]*>Site coordinators<\/h2>/);
  assert.match(html, /Kept across seasons · at least one/);
  assert.match(html, /<strong>Dana Wu<\/strong> <span class="badge neutral">You<\/span>/);
  assert.doesNotMatch(html, /<strong>Lee Park<\/strong> <span class="badge neutral">You/);
  assert.match(html, /dana@example\.org · since Nov 2, 2026</);
  assert.match(html, /lee@example\.org · since Oct 28, 2026 · not on this season&#39;s roster/);
  assert.equal((html.match(/not on this season/g) ?? []).length, 1);
  assert.match(html, /data-action="remove-site-coordinator" data-volunteer-id="p-dana"/);
  assert.match(html, /data-action="remove-site-coordinator" data-volunteer-id="p-lee"/);
  // The picker offers only the candidates.
  const picker = html.match(/<select id="sc-pick"[\s\S]*?<\/select>/)[0];
  assert.match(picker, /<option value="">Make someone a site coordinator…<\/option>/);
  assert.match(picker, /<option value="p-ana">Ana Ortiz<\/option>/);
  assert.equal((picker.match(/<option/g) ?? []).length, 2);
  assert.match(html, /data-action="add-site-coordinator"[^>]*>Add<\/button>/);
  // Nothing is picked, so Add is disabled.
  assert.match(html, /data-action="add-site-coordinator"\s+disabled>Add<\/button>/);
  // History, closed, newest first, in its three forms.
  assert.match(html, /<details class="sc-log"><summary>History<\/summary>/);
  assert.doesNotMatch(html, /<details class="sc-log" open/);
  const lines = ["Dana Wu made Lee Park a site coordinator", "Dana Wu removed Kim Bell as site coordinator", "The roster command made Dana Wu a site coordinator"];
  const at = lines.map((line) => html.indexOf(line));
  assert.ok(at.every((index) => index > 0), "every line is there");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "newest first");
  assert.match(html, /Nov 10, 2026<\/span> Dana Wu made Lee Park/);
  assert.doesNotMatch(html, /Only site coordinators can change these settings\./);
});

test("the read-only page", () => {
  const html = renderSeasonSettings(view({ canEdit: false }), { canEdit: false, selfId: "p-ana", ui: {} });
  assert.doesNotMatch(html, /<input|<select|<form|<button/);
  assert.match(html, /Only site coordinators can change these settings\./);
  assert.match(html, /https:\/\/example\.org\/certificates/);
  assert.match(html, /Client documents upload link[\s\S]*Not set/);
  assert.match(html, /Set · updated Nov 19, 2026/);
  assert.match(html, /Dana Wu/);
  assert.match(html, /<details class="sc-log">/);
});

test("Not set when the workspace has no SIDN", () => {
  const html = renderSeasonSettings(view({ siteNumber: { set: false, updatedAt: null } }), { canEdit: true, ui: {} });
  assert.match(html, /id="sidn-status">Not set</);
  assert.doesNotMatch(html, /Set · updated/);
});

test("field errors render beside their field", () => {
  const html = renderSeasonSettings(view(), {
    canEdit: true,
    ui: { fieldErrors: { clientDocumentsUrl: LINK_MESSAGE } },
  });
  assert.equal(LINK_MESSAGE, "Enter a link that starts with https://.");
  assert.match(
    html,
    /id="settings-documents-link"[^>]*aria-invalid="true"[^>]*aria-describedby="settings-documents-link-note settings-documents-link-error"/,
  );
  assert.match(html, /<p class="field-error" id="settings-documents-link-error">Enter a link that starts with https:\/\/\.<\/p>/);
  assert.doesNotMatch(html, /id="settings-certificate-link"[^>]*aria-invalid/);
});

test("a notice is said in its own card", () => {
  const links = renderSeasonSettings(view(), {
    canEdit: true,
    ui: { notice: { place: "links", text: "Someone else changed these settings. Check them and save again." } },
  });
  assert.match(links, /role="alert"[^>]*>[\s\S]*Someone else changed these settings/);
  assert.ok(links.indexOf("Someone else changed") < links.indexOf("Site coordinators"));
  const coordinators = renderSeasonSettings(view(), {
    canEdit: true,
    ui: { notice: { place: "coordinators", text: "At least one site coordinator must remain. Make someone else a site coordinator first." } },
  });
  assert.ok(coordinators.indexOf("At least one site coordinator") > coordinators.indexOf("Kept across seasons"));
});

test("busy disables the page's buttons", () => {
  const html = renderSeasonSettings(view(), { canEdit: true, ui: { busy: true } });
  // Save, Change…, Start next season…, Add, and Remove on each of the two
  // rows; idle, only Add (nothing picked).
  assert.equal((html.match(/<button[^>]* disabled/g) ?? []).length, 6);
  assert.equal((renderSeasonSettings(view(), { canEdit: true, ui: {} }).match(/<button[^>]* disabled/g) ?? []).length, 1);
});

test("escaping: names, emails and links render as text", () => {
  const nasty = `Riley <b>"R"</b>`;
  const html = renderSeasonSettings(
    view({
      certificateUploadUrl: `https://example.org/"><script>`,
      siteCoordinators: [{ volunteerId: `p"x`, name: nasty, email: "<e>@example.org", since: null, onRoster: true, accountRevision: 1 }],
      candidates: [{ volunteerId: "p-ana", name: nasty, accountRevision: 1 }],
      history: [{ personName: nasty, granted: true, changedByName: nasty, changedAt: "2026-11-10T15:00:00Z" }],
    }),
    { canEdit: true, ui: {} },
  );
  assert.doesNotMatch(html, /<b>|<script>|<e>/);
  assert.ok(html.includes("Riley &lt;b&gt;&quot;R&quot;&lt;/b&gt;"));
  assert.ok(html.includes('data-volunteer-id="p&quot;x"'));
});

test("the page is loading, then failed, before a read lands", () => {
  assert.match(renderSeasonSettings(null, { list: "loading" }), /role="status"/);
  assert.match(renderSeasonSettings(null, { list: "failed" }), /couldn&#39;t load/);
});

test("the Change the SIDN dialog: one field, Save and Cancel, and its error", () => {
  const html = changeSidnDialogBody({});
  assert.match(html, /<form id="sidn-form"/);
  assert.match(html, /<label class="field" for="sidn-input"><span>SIDN<\/span><input[^>]*name="sidn"/);
  assert.match(html, /<button type="submit" class="btn primary"[^>]*>Save<\/button>/);
  assert.match(html, /data-action="close-dialog"[^>]*>Cancel</);
  const refused = changeSidnDialogBody({ error: "Enter the site's SIDN: S followed by eight digits.", busy: true });
  assert.match(refused, /id="sidn-input"[^>]*aria-invalid="true"[^>]*aria-describedby="sidn-error"/);
  assert.match(refused, /id="sidn-error"[^>]*>Enter the site&#39;s SIDN: S followed by eight digits\.</);
  assert.match(refused, /type="submit"[^>]*disabled/);
});

// ---------------------------------------------------------------------------
// Start next season (change add-start-next-season, design D8)
// ---------------------------------------------------------------------------

test("a site coordinator sees Start next season…", () => {
  const html = renderSeasonSettings(view({ season: 2026 }), { canEdit: true, selfId: "p-dana", ui: {} });
  assert.match(html, /<h2 id="next-season-title">Next season<\/h2>/);
  assert.match(html, /data-action="open-start-season"[^>]*>Start next season…</);
  // After the season card and before the Site coordinators card.
  assert.ok(html.indexOf("season-card-title") < html.indexOf("next-season-title"));
  assert.ok(html.indexOf("next-season-title") < html.indexOf('id="sc-title"'));
});

test("another admin sees the card without the button", () => {
  const html = renderSeasonSettings(view({ season: 2026, canEdit: false }), { canEdit: false, selfId: "p-ana", ui: {} });
  assert.match(html, /<h2 id="next-season-title">Next season<\/h2>/);
  assert.doesNotMatch(html, /open-start-season/);
  assert.doesNotMatch(html, /<button/);
});

test("a notice for the next season is said in its card", () => {
  const html = renderSeasonSettings(view(), {
    canEdit: true,
    ui: { notice: { place: "next-season", text: "The season has already moved." } },
  });
  assert.match(html, /aria-labelledby="next-season-title">[\s\S]*role="alert">The season has already moved\.</);
});

test("the dialog for season 2026", () => {
  const html = startSeasonDialogBody({ season: 2026 });
  assert.match(html, /<form id="start-season-form" class="staff-form"/);
  // The three things that happen (spec: season-rollover, requirement 1).
  assert.match(html, /Site coordinators keep their sign-in\./);
  assert.match(html, /Every other staff account loses its sign-in\./);
  assert.match(html, /The 2027 roster starts with only you\./);
  assert.ok(html.includes("Export this season&#39;s roster and cases first if you need them."));
  assert.match(html, /<label class="field" for="start-season-year"><span>Type 2027 to confirm<\/span><input[^>]*id="start-season-year"/);
  assert.match(html, /data-action="close-dialog"[^>]*>Cancel</);
  const confirm = (typed) => startSeasonDialogBody({ season: 2026, typed }).match(/<button type="submit"[^>]*>/)[0];
  assert.match(confirm(""), /disabled/);
  assert.match(confirm("2026"), /disabled/);
  assert.doesNotMatch(confirm("2027"), /disabled/);
  assert.doesNotMatch(confirm(" 2027 "), /disabled/);
  // Busy holds it even with the year typed.
  assert.match(startSeasonDialogBody({ season: 2026, typed: "2027", busy: true }).match(/<button type="submit"[^>]*>/)[0], /disabled/);
  assert.match(html, /id="start-season-submit"[^>]*>Start the 2027 season</);
  assert.doesNotMatch(html, /Finish these first/);
});

test("the typed-year gate", () => {
  assert.equal(startSeasonReady(2026, "2027"), true);
  assert.equal(startSeasonReady(2026, " 2027"), true);
  assert.equal(startSeasonReady(2026, "2026"), false);
  assert.equal(startSeasonReady(2026, "02027"), false);
  assert.equal(startSeasonReady(2026, ""), false);
  assert.equal(startSeasonReady(null, ""), false);
});

test("seasonRefusalLines: one line per count above zero, singular for one", () => {
  assert.deepEqual(seasonRefusalLines({ openCases: 2, openFollowups: 1, claimedHelp: 0, unclaimedHelpOnCases: 1 }), [
    "2 open cases",
    "1 open follow-up",
    "1 unclaimed help request on cases",
  ]);
  assert.ok(seasonRefusalLines({ openCases: 0, openFollowups: 0, claimedHelp: 3, unclaimedHelpOnCases: 0 }).includes("3 claimed help requests"));
  assert.deepEqual(seasonRefusalLines({ openCases: 1, openFollowups: 2, claimedHelp: 1, unclaimedHelpOnCases: 2 }), [
    "1 open case",
    "2 open follow-ups",
    "1 claimed help request",
    "2 unclaimed help requests on cases",
  ]);
  assert.deepEqual(seasonRefusalLines(null), []);
});

test("a refusal lists what to finish first, in the dialog", () => {
  const html = startSeasonDialogBody({
    season: 2026,
    typed: "2027",
    refusal: { openCases: 2, openFollowups: 1, claimedHelp: 0, unclaimedHelpOnCases: 0 },
  });
  assert.match(html, /role="alert"[^>]*>[\s\S]*Finish these first:[\s\S]*<li>2 open cases<\/li><li>1 open follow-up<\/li><\/ul>/);
});

// ---------------------------------------------------------------------------
// The frame: the screen, the sidebar link and the dialog
// ---------------------------------------------------------------------------

const staffState = (clearance, over = {}) => ({
  screen: "office-settings",
  principal: { access: "staff", personId: "p-dana", userId: "u-1", clearance },
  people: [{ id: "p-dana", name: "Dana Wu", capabilities: clearance.capabilities }],
  lists: { cases: "ready", assistance: "ready", seasonSettings: "ready" },
  seasonSettings: view(),
  seasonSettingsUi: {},
  ...over,
});

test("the page has its overline and title, and its sidebar link is current", () => {
  const html = staffScreen(staffState(cleared({ isAdmin: true, isSiteCoordinator: true, capabilities: ["admin"] })));
  assert.match(html, />OFFICE · ADMIN</);
  assert.match(html, /<h1>Season settings<\/h1>/);
  assert.match(html, /data-action="open-season-settings" aria-current="page"/);
  assert.match(html, /2027 for TY 2026/);
  // After Post an update.
  assert.ok(html.indexOf('data-action="open-post-update"') < html.indexOf('data-action="open-season-settings"'));
});

test("an uncleared workspace admin has the link and the page", () => {
  const uncleared = { cleared: false, missing: [{ kind: "form13615" }], capabilities: [], isAdmin: true, isSiteCoordinator: true, siteCoordinatorName: "Dana Wu" };
  const html = staffScreen(staffState(uncleared));
  assert.match(html, /data-action="open-season-settings" aria-current="page"/);
  assert.match(html, /<h1>Season settings<\/h1>/);
  const setup = staffScreen(staffState(uncleared, { screen: "staff" }));
  assert.match(setup, /data-action="open-season-settings"/);
});

test("a preparer has no link, and a window left on the page shows their home", () => {
  const preparer = cleared({ capabilities: ["prepare"] });
  const html = staffScreen(staffState(preparer));
  assert.doesNotMatch(html, /open-season-settings|Season settings|2027 for TY 2026/);
});

test("the Change the SIDN dialog is framed with its title and overline", () => {
  const html = dialog(staffState(cleared({ isAdmin: true, isSiteCoordinator: true }), { dialog: "change-sidn" }));
  assert.match(html, /<h2 id="modal-title">Change the SIDN<\/h2>/);
  assert.match(html, />OFFICE · ADMIN</);
  assert.match(html, /<form id="sidn-form"/);
});

test("the Start next season dialog is framed with its title and overline", () => {
  const html = dialog(
    staffState(cleared({ isAdmin: true, isSiteCoordinator: true }), {
      dialog: "start-season",
      seasonSettings: view({ season: 2026 }),
      seasonSettingsUi: { startRefusal: { openCases: 1, openFollowups: 0, claimedHelp: 0, unclaimedHelpOnCases: 0 } },
    }),
  );
  assert.match(html, /<h2 id="modal-title">Start the 2027 season<\/h2>/);
  assert.match(html, />OFFICE · ADMIN</);
  assert.match(html, /<form id="start-season-form"/);
  assert.match(html, /<li>1 open case<\/li>/);
});

test("app.mjs handles every Season settings action", () => {
  const app = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
  for (const action of ["open-season-settings", "open-change-sidn", "open-start-season", "add-site-coordinator", "remove-site-coordinator"])
    assert.match(app, new RegExp(`case "${action}"`), action);
  assert.match(app, /"open-season-settings": \(\) => \{[\s\S]{0,120}controller\.navigate\("office-settings"\);[\s\S]{0,60}controller\.loadSeasonSettings\(\)/);
  assert.match(app, /form\.id === "season-settings-form"/);
  assert.match(app, /form\.id === "sidn-form"/);
  assert.match(app, /form\.id === "start-season-form"/);
});

test("the stylesheet lays the cards out at phone width", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [".settings-card", ".sc-list", ".sc-add"]) assert.ok(css.includes(selector), selector);
});
