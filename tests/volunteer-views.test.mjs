import test from "node:test";
import assert from "node:assert/strict";
import { renderRoster, volunteerDrawerBody } from "../src/volunteer-views.mjs";
import { staffScreen, dialog } from "../src/views.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people only.
const ADMIN_PERSON = { id: "p-sam", name: "Sam Rivera", capabilities: ["admin", "followup"] };
const PREPARER_PERSON = { id: "p-alex", name: "Alex Chen", capabilities: ["prepare"] };

const volunteer = (overrides = {}) => ({
  id: "v-1",
  name: "Mira Patel",
  email: "mira@example.test",
  phone: "215-555-0101",
  works: "on_site",
  languages: ["english"],
  otherLanguage: null,
  roles: ["preparer"],
  certificates: ["vsc"],
  revision: 3,
  hasSignIn: false,
  isNew: false,
  photoIdChecked: false,
  cleared: true,
  missing: [],
  ...overrides,
});

const baseState = (overrides = {}) => ({
  principal: { userId: "u1", workspaceId: "w1", access: "staff", personId: "p-sam", clearance: cleared({ isAdmin: true }) },
  people: [ADMIN_PERSON, PREPARER_PERSON],
  cases: [],
  assistance: [],
  savedCase: null,
  screen: "office-volunteers",
  boardFilters: {},
  openPanels: [],
  draftAnswers: {},
  busy: false,
  error: null,
  retryable: false,
  lists: { cases: "ready", assistance: "ready", volunteers: "ready" },
  volunteers: [volunteer()],
  volunteerFilters: { search: "", role: "all" },
  volunteerFormError: null,
  dialog: null,
  dialogContext: null,
  ...overrides,
});

const rowsOf = (html) =>
  html.split('<tr class="volunteer-row"').slice(1).map((row) => row.split("</tr>")[0]);

test("an admin's sidebar has the Volunteers link after All cases; a preparer's has none", () => {
  const admin = staffScreen(baseState({ screen: "staff" }));
  assert.match(admin, /data-action="open-volunteers"/);
  assert.ok(
    admin.indexOf('data-action="open-cases"') < admin.indexOf('data-action="open-volunteers"'),
    "Volunteers comes after All cases",
  );
  const preparer = staffScreen(
    baseState({ screen: "staff", principal: { userId: "u2", workspaceId: "w1", access: "staff", personId: "p-alex", clearance: cleared() } }),
  );
  assert.doesNotMatch(preparer, /data-action="open-volunteers"/);
});

test("the Volunteers link is current on the Roster", () => {
  const html = staffScreen(baseState());
  assert.match(html, /data-action="open-volunteers" aria-current="page"/);
});

test("a non-admin left on the Roster gets the work board", () => {
  const html = staffScreen(
    baseState({ principal: { userId: "u2", workspaceId: "w1", access: "staff", personId: "p-alex", clearance: cleared() } }),
  );
  assert.match(html, /Work board<\/h2>/);
  assert.doesNotMatch(html, /OFFICE · VOLUNTEERS|Mira Patel|open-add-volunteer/);
});

test("the Roster page says volunteers work on cases once cleared, and shows no season", () => {
  const html = staffScreen(baseState());
  assert.match(html, />OFFICE · VOLUNTEERS</);
  assert.match(html, /<h1>Volunteers<\/h1>/);
  assert.match(html, /Volunteers work on cases only once they are cleared\./);
  assert.doesNotMatch(html, /recorded here|change what anyone can do/);
  assert.match(html, /class="btn primary" data-action="open-add-volunteer"[^>]*>(?:<svg[\s\S]*?<\/svg>)? Add a volunteer<\/button>/);
  assert.doesNotMatch(html, /season|2025|2026/i);
});

test("the table has the spec's columns and a count", () => {
  const html = renderRoster([volunteer(), volunteer({ id: "v-2", name: "Noor Haddad", email: "noor@example.test" })], {
    list: "ready",
    filters: { search: "", role: "all" },
  });
  assert.match(html, /class="board-table people-table"/);
  const headers = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers, ["Volunteer", "Roles", "Certificates", "Languages", "Cleared", "Edit"]);
  assert.match(html, /2 of 2 volunteers/);
  assert.match(html, /data-action="open-edit-volunteer" data-volunteer-id="v-1"/);
});

test("a row shows the Remote badge, the roles, the certificates and the languages", () => {
  const html = renderRoster(
    [
      volunteer({ id: "a", name: "A One", works: "remote" }),
      volunteer({ id: "b", name: "B Two", works: "on_site_and_remote" }),
      volunteer({ id: "c", name: "C Three", works: "on_site", roles: [], certificates: [], languages: [] }),
      volunteer({
        id: "d",
        name: "D Four",
        roles: ["preparer", "reviewer"],
        certificates: ["vsc", "itqr"],
        languages: ["mandarin", "other"],
        otherLanguage: "Tagalog",
      }),
    ],
    { list: "ready", filters: {} },
  );
  const [a, b, c, d] = rowsOf(html);
  assert.match(a, /Remote/);
  assert.match(b, /Remote/);
  assert.doesNotMatch(c, /Remote/);
  assert.match(c, /No roles recorded/);
  assert.match(c, /None recorded/);
  assert.match(d, /Preparer/);
  assert.match(d, /Reviewer/);
  assert.match(d, /VSC/);
  assert.match(d, /IT&amp;QR/);
  assert.match(d, /Mandarin/);
  assert.match(d, /Tagalog/);
  assert.match(d, /mira@example\.test · 215-555-0101/);
  assert.doesNotMatch(html, /inactive/i);
});

test("a row shows Cleared, or the one thing it waits for", () => {
  const html = renderRoster(
    [
      volunteer({ id: "a", name: "A One" }),
      volunteer({ id: "b", name: "B Two", roles: [], cleared: false, missing: ["form13615"] }),
      volunteer({ id: "c", name: "C Three", isNew: true, cleared: false, missing: ["photoId"] }),
    ],
    { list: "ready", filters: {} },
  );
  const [a, b, c] = rowsOf(html);
  assert.match(a, /Cleared/);
  assert.doesNotMatch(a, /Not cleared|Form 13615|Photo ID/);
  assert.match(b, /Not cleared/);
  assert.match(b, /Form 13615 missing/);
  assert.match(c, /Not cleared/);
  assert.match(c, /Photo ID check missing/);
  assert.doesNotMatch(c, /Form 13615/);
});

test("Add opens with New volunteer ticked and Photo ID checked not", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} });
  assert.match(html, /<input type="checkbox" name="isNew"[^>]* checked[^>]*><span>New volunteer<\/span>/);
  const photo = html.match(/<input type="checkbox" name="photoIdChecked"[^>]*>/)[0];
  assert.doesNotMatch(photo, /checked/);
  assert.match(html, /<span>Photo ID checked<\/span>/);
});

test("Edit shows the volunteer's own New and Photo ID checked values", () => {
  const plain = volunteerDrawerBody({ volunteer: volunteer(), isNew: false, ui: {} });
  assert.doesNotMatch(plain.match(/<input type="checkbox" name="isNew"[^>]*>/)[0], /checked/);
  assert.doesNotMatch(plain.match(/<input type="checkbox" name="photoIdChecked"[^>]*>/)[0], /checked/);
  const both = volunteerDrawerBody({ volunteer: volunteer({ isNew: true, photoIdChecked: true }), isNew: false, ui: {} });
  assert.match(both.match(/<input type="checkbox" name="isNew"[^>]*>/)[0], /checked/);
  assert.match(both.match(/<input type="checkbox" name="photoIdChecked"[^>]*>/)[0], /checked/);
});

test("a name or phone with markup is shown as text in the table and in the drawer", () => {
  const odd = volunteer({ name: "<b>O'Hara & Co</b>", phone: '"555" <i>' });
  const table = renderRoster([odd], { list: "ready", filters: {} });
  assert.match(table, /&lt;b&gt;O&#39;Hara &amp; Co&lt;\/b&gt;/);
  assert.match(table, /&quot;555&quot; &lt;i&gt;/);
  assert.doesNotMatch(table, /<b>O'Hara|<i>/);
  const drawer = volunteerDrawerBody({ volunteer: odd, isNew: false, ui: {} });
  assert.match(drawer, /value="&lt;b&gt;O&#39;Hara &amp; Co&lt;\/b&gt;"/);
  assert.match(drawer, /value="&quot;555&quot; &lt;i&gt;"/);
  assert.doesNotMatch(drawer, /<b>O'Hara/);
  const title = dialog(baseState({ volunteers: [odd], dialog: "volunteer", dialogContext: { volunteerId: "v-1" } }));
  assert.match(title, /<h2 id="modal-title">&lt;b&gt;O&#39;Hara &amp; Co&lt;\/b&gt;<\/h2>/);
});

test("a list loading, a list that failed, and a filter with no matches each say so", () => {
  const failed = renderRoster([], { list: "failed", filters: {} });
  assert.match(failed, /class="unloaded-line"/);
  assert.match(failed, /The volunteers couldn&#39;t load\./);
  assert.doesNotMatch(failed, /Nobody matches|No volunteers yet|of 0 volunteers/);
  const loading = renderRoster([], { list: "loading", filters: {} });
  assert.match(loading, /class="loading-line"/);
  assert.doesNotMatch(loading, /Nobody matches|unloaded-line/);
  const none = renderRoster([volunteer()], { list: "ready", filters: { search: "zzz", role: "all" } });
  assert.match(none, /Nobody matches\./);
  assert.match(none, /0 of 1 volunteers/);
  const byRole = renderRoster([volunteer()], { list: "ready", filters: { search: "", role: "reviewer" } });
  assert.match(byRole, /Nobody matches\./);
});

test("the toolbar has the role filter and the search box", () => {
  const html = renderRoster([volunteer()], { list: "ready", filters: { search: "mi", role: "preparer" } });
  assert.match(html, /<select[^>]*data-volunteer-filter="role"/);
  for (const label of ["All roles", "Greeter", "Intaker", "Preparer", "Reviewer", "Admin"])
    assert.match(html, new RegExp(`<option value="[a-z]+"[^>]*>${label}</option>`));
  assert.match(html, /<option value="preparer" selected>Preparer<\/option>/);
  assert.match(html, /<input[^>]*id="volunteer-search"/);
  const search = html.match(/<input[^>]*id="volunteer-search"[^>]*>/)[0];
  assert.match(search, /name="volunteerSearch"/);
  assert.match(search, /type="search"/);
  assert.match(search, /aria-label="Search volunteers"/);
  assert.match(search, /value="mi"/);
});

test("the Add drawer: every field by its name, works On site, email enabled", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} });
  assert.match(html, /<form id="volunteer-form" class="staff-form"/);
  assert.match(html, /id="volunteer-name"[^>]*name="name"|name="name"[^>]*id="volunteer-name"/);
  const email = html.match(/<input[^>]*id="volunteer-email"[^>]*>/)[0];
  assert.match(email, /name="email"/);
  assert.doesNotMatch(email, /readonly|disabled/);
  assert.match(html, /id="volunteer-phone"/);
  assert.match(html, /type="radio" name="works" value="on_site" checked/);
  for (const name of ["language", "role", "certificate"]) assert.match(html, new RegExp(`type="checkbox" name="${name}"`));
  assert.match(html, /name="otherLanguage"/);
  assert.match(html, /<[^>]*id="volunteer-other-language"[^>]*hidden/);
  assert.match(html, /Volunteer Standards of Conduct/);
  assert.match(html, /Intake\/Interview &amp; Quality Review/);
  assert.match(html, /<button type="submit"[^>]*>Add a volunteer<\/button>/);
  assert.match(html, /data-action="close-dialog"[^>]*>Cancel/);
  assert.doesNotMatch(html, /This is their sign-in email/);
  // The order the brief fixes.
  const order = ["volunteer-name", "volunteer-email", "volunteer-phone", 'name="works"', 'name="language"', 'name="otherLanguage"', 'name="role"', 'name="certificate"', 'type="submit"'];
  const at = order.map((needle) => html.indexOf(needle));
  assert.deepEqual([...at].sort((x, y) => x - y), at, "fields in order");
});

test("the Edit drawer is filled in, and a sign-in email is read-only", () => {
  const v = volunteer({
    hasSignIn: true,
    works: "remote",
    languages: ["english", "other"],
    otherLanguage: "Tagalog",
    roles: ["reviewer"],
    certificates: ["basic"],
  });
  const html = volunteerDrawerBody({ volunteer: v, isNew: false, ui: {} });
  const email = html.match(/<input[^>]*id="volunteer-email"[^>]*>/)[0];
  assert.match(email, /readonly/);
  assert.match(email, /value="mira@example\.test"/);
  assert.match(html, /This is their sign-in email\./);
  assert.match(html, /name="works" value="remote" checked/);
  assert.doesNotMatch(html, /name="works" value="on_site" checked/);
  assert.match(html, /name="language" value="other" checked/);
  assert.match(html, /name="role" value="reviewer" checked/);
  assert.doesNotMatch(html, /name="role" value="preparer" checked/);
  assert.match(html, /name="certificate" value="basic" checked/);
  assert.doesNotMatch(html.match(/<[^>]*id="volunteer-other-language"[^>]*>/)[0], /hidden/);
  assert.match(html, /value="Tagalog"/);
  assert.match(html, /<button type="submit"[^>]*>Save<\/button>/);
});

test("the drawer's form error and its busy state", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: { formError: "Preparer needs IT&QR and Basic or Advanced.", busy: true } });
  assert.match(html, /role="alert" id="volunteer-form-error"[^>]*>[\s\S]*Preparer needs IT&amp;QR and Basic or Advanced./);
  assert.match(html, /<button type="submit"[^>]*disabled/);
});

test("an Edit drawer whose volunteer is gone says so and offers Close", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: false, ui: {} });
  assert.match(html, /This volunteer could not be opened\. Close this and try again\./);
  assert.match(html, /data-action="close-dialog"/);
  assert.doesNotMatch(html, /<form/);
  const viaDialog = dialog(baseState({ dialog: "volunteer", dialogContext: { volunteerId: "gone" } }));
  assert.match(viaDialog, /This volunteer could not be opened/);
});

test("a conflict in the drawer names the volunteer, not a case", () => {
  const error = { code: "CONFLICT", message: "Someone else changed this volunteer. Close this and open it again to see their changes." };
  const html = volunteerDrawerBody({ volunteer: volunteer(), isNew: false, ui: { error } });
  assert.match(html, /<h3>This volunteer changed while you were working<\/h3>/);
  assert.doesNotMatch(html, /This case changed/);
});

test("the volunteer dialog is a drawer with its own overline and title", () => {
  const add = dialog(baseState({ dialog: "volunteer", dialogContext: null }));
  assert.match(add, /class="modal office-drawer"/);
  assert.match(add, /<span class="overline">OFFICE · VOLUNTEERS<\/span>/);
  assert.match(add, /<h2 id="modal-title">Add a volunteer<\/h2>/);
  assert.match(add, /id="volunteer-form"/);
  const edit = dialog(baseState({ dialog: "volunteer", dialogContext: { volunteerId: "v-1" } }));
  assert.match(edit, /<h2 id="modal-title">Mira Patel<\/h2>/);
  // The page banner steps aside; the drawer says the error itself, once.
  const failed = dialog(
    baseState({ dialog: "volunteer", dialogContext: { volunteerId: "v-1" }, error: { code: "SERVER_ERROR", message: "Boom." } }),
  );
  assert.equal(failed.match(/role="alert"/g).length, 1);
  assert.match(failed, /id="drawer-error"/);
});

// ---------------------------------------------------------------------------
// Posted updates (change add-posted-updates): Notifications and Post an update
// ---------------------------------------------------------------------------

const preparerState = (overrides = {}) =>
  baseState({
    screen: "staff",
    principal: { userId: "u2", workspaceId: "w1", access: "staff", personId: "p-alex", clearance: cleared() },
    ...overrides,
  });
const notificationsButton = (html) => html.match(/<button[^>]*data-action="open-notifications"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

test("a cleared preparer's sidebar has Notifications with a bell, and no badge at 0", () => {
  const html = staffScreen(preparerState({ updatesUnread: 0 }));
  const entry = notificationsButton(html);
  assert.match(entry, /Notifications/);
  assert.match(entry, /<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2ZM10 21h4"\/>/, "the bell");
  assert.doesNotMatch(entry, /nav-badge|unread/);
  assert.doesNotMatch(html, /data-action="open-post-update"/);
});

test("the badge shows the unread count and names it", () => {
  const entry = notificationsButton(staffScreen(preparerState({ updatesUnread: 3 })));
  assert.match(entry, /aria-label="Notifications, 3 unread"/);
  assert.match(entry, /<span class="nav-badge" aria-hidden="true">3<\/span>/);
});

test("a ceiling admin gets Post an update after Volunteers, and Notifications", () => {
  const html = staffScreen(baseState({ screen: "staff" }));
  assert.match(html, /data-action="open-post-update"[^>]*>(?:<svg[\s\S]*?<\/svg>)? Post an update<\/button>/);
  assert.ok(
    html.indexOf('data-action="open-volunteers"') < html.indexOf('data-action="open-post-update"'),
    "Post an update comes after Volunteers",
  );
  assert.match(html, /data-action="open-notifications"/);
});

test("a non-admin left on Post an update gets the work board", () => {
  const html = staffScreen(preparerState({ screen: "office-updates" }));
  assert.match(html, /Work board<\/h2>/);
  assert.doesNotMatch(html, /OFFICE · ADMIN|update-form/);
});

test("the setup screen still has Notifications; an uncleared ceiling admin also gets Post an update", () => {
  const uncleared = { cleared: false, missing: [{ kind: "form13615" }], capabilities: [], isAdmin: false, siteCoordinatorName: null };
  const volunteerHtml = staffScreen(
    preparerState({ principal: { userId: "u2", workspaceId: "w1", access: "staff", personId: "p-alex", clearance: uncleared }, updatesUnread: 1 }),
  );
  assert.match(volunteerHtml, /Finish your setup for this season/);
  assert.match(notificationsButton(volunteerHtml), /aria-label="Notifications, 1 unread"/);
  assert.doesNotMatch(volunteerHtml, /open-post-update/);

  const adminPrincipal = { userId: "u1", workspaceId: "w1", access: "staff", personId: "p-sam", clearance: { ...uncleared, isAdmin: true } };
  const setup = staffScreen(baseState({ screen: "staff", principal: adminPrincipal }));
  assert.match(setup, /data-action="open-post-update"/);
  assert.match(setup, /data-action="open-notifications"/);
  // The uncleared admin's Post an update screen.
  const updates = staffScreen(baseState({ screen: "office-updates", principal: adminPrincipal, postedUpdates: [], updateForm: null }));
  assert.match(updates, /<h1>Post an update<\/h1>/);
  assert.match(updates, /data-action="open-post-update" aria-current="page"/);
  assert.doesNotMatch(updates, /Finish your setup for this season<\/h1>/);
});

test("a client has no Notifications", async () => {
  const { page, clientHeader } = await import("../src/views.mjs");
  const state = { principal: { access: "applicant" }, connection: "online", screen: "applications" };
  assert.doesNotMatch(page(state, "<main></main>") + clientHeader(state), /open-notifications|Notifications/);
});
