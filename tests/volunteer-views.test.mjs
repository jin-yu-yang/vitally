import test from "node:test";
import assert from "node:assert/strict";
import {
  renderRoster,
  volunteerDrawerBody,
  deactivateAccountDialogBody,
  cancelInvitationDialogBody,
  removeFromRosterDialogBody,
} from "../src/volunteer-views.mjs";
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
  // The page itself; the sidebar's Season settings link (change
  // add-season-settings) is not the Roster's.
  const main = html.slice(html.indexOf('<main id="main"'));
  assert.ok(main.length < html.length, "the page is drawn");
  assert.doesNotMatch(main, /season|2025|2026/i);
});

test("the table has the spec's columns and a count", () => {
  const html = renderRoster([volunteer(), volunteer({ id: "v-2", name: "Noor Haddad", email: "noor@example.test" })], {
    list: "ready",
    filters: { search: "", role: "all" },
  });
  assert.match(html, /class="board-table people-table"/);
  const headers = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1].replace(/&#39;|&#x27;/g, "'"));
  assert.deepEqual(headers, ["Volunteer", "Roles", "Certificates", "Languages", "Account", "Cleared", "Edit"]);
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

const withStatus = (status, extra = {}) =>
  volunteer({ account: { status, revision: status === "none" ? null : 4 }, ...extra });

test("roster row shows the account column", () => {
  const html = renderRoster(
    ["none", "invited", "active", "deactivated"].map((status, i) => withStatus(status, { id: `v-${i}`, name: `Person ${i}` })),
    { list: "ready", filters: {} },
  );
  const cells = rowsOf(html).map((row) => row.match(new RegExp("</td><td>(Not created|Invited|Active|Deactivated)</td>"))?.[1]);
  assert.deepEqual(cells, ["Not created", "Invited", "Active", "Deactivated"]);
});

test("cleared cell lists No account yet after Form 13615", () => {
  const html = renderRoster(
    [withStatus("none", { roles: [], cleared: false, missing: ["form13615", "noAccount"] })],
    { list: "ready", filters: {} },
  );
  assert.match(html, /Form 13615 missing, No account yet/);
  const other = renderRoster(
    [
      withStatus("invited", { id: "a", cleared: false, missing: ["notSignedIn"] }),
      withStatus("deactivated", { id: "b", cleared: false, missing: ["deactivated"] }),
    ],
    { list: "ready", filters: {} },
  );
  assert.match(other, /Hasn&#39;t signed in yet/);
  assert.match(other, /Account deactivated/);
});

const drawerFor = (status, ui = {}) =>
  volunteerDrawerBody({ volunteer: withStatus(status), isNew: false, ui });
const accountPart = (html) => html.split('class="check-group volunteer-account"')[1] ?? "";

test("drawer account section offers Create account with no account", () => {
  const section = accountPart(drawerFor("none"));
  assert.match(section, /Not created/);
  assert.match(section, /data-action="account-create"/);
  // The page shows the hint (and turns the button off) while the form has
  // unsaved changes; it is drawn hidden.
  assert.match(section, /aria-describedby="volunteer-account-hint"/);
  assert.match(section, /<p class="field-note" id="volunteer-account-hint" hidden>Save your changes first\.<\/p>/);
  assert.doesNotMatch(section, /account-resend|account-deactivate|account-reactivate/);
  assert.ok(drawerFor("none").indexOf("Photo ID checked") < drawerFor("none").indexOf("volunteer-account"), "after the season section");
});

test("drawer account section offers Resend, Cancel invitation and Deactivate when invited", () => {
  const section = accountPart(drawerFor("invited"));
  assert.match(section, /Invited/);
  assert.match(section, /data-action="account-resend"/);
  assert.match(section, /data-action="account-cancel-invitation" data-volunteer-id="v-1">Cancel invitation</);
  assert.ok(section.indexOf("account-resend") < section.indexOf("account-cancel-invitation"), "next to Resend");
  assert.match(section, /data-action="account-deactivate"/);
  assert.doesNotMatch(section, /account-create|account-reactivate/);
});

test("Cancel invitation is offered only for an invitation never used", () => {
  // Invited again after being active (a reactivation): not cancellable.
  const used = volunteerDrawerBody({
    volunteer: volunteer({ account: { status: "invited", revision: 6, activatedAt: "2026-11-02T10:00:00Z" } }),
    isNew: false,
    ui: {},
  });
  assert.doesNotMatch(accountPart(used), /account-cancel-invitation/);
  assert.match(accountPart(used), /account-resend/);
  for (const status of ["none", "active", "deactivated"])
    assert.doesNotMatch(accountPart(drawerFor(status)), /account-cancel-invitation/, status);
});

test("drawer account section offers Deactivate when active", () => {
  const section = accountPart(drawerFor("active"));
  assert.match(section, /Active/);
  assert.match(section, /data-action="account-deactivate"/);
  assert.doesNotMatch(section, /account-create|account-resend|account-reactivate/);
});

// Change add-season-settings, review fix: deactivating a site coordinator's
// account needs a site coordinator.
test("Deactivate on a site coordinator is offered only to site coordinators", () => {
  const coordinator = withStatus("active", { isSiteCoordinator: true });
  const byAdmin = accountPart(volunteerDrawerBody({ volunteer: coordinator, isNew: false, ui: {}, canChangeAdmin: false }));
  assert.doesNotMatch(byAdmin, /account-deactivate/);
  assert.match(
    byAdmin,
    /<p class="field-note" id="volunteer-deactivate-note">Only site coordinators deactivate a site coordinator&#39;s account\.<\/p>/,
  );
  const bySiteCoordinator = accountPart(
    volunteerDrawerBody({ volunteer: coordinator, isNew: false, ui: {}, canChangeAdmin: true }),
  );
  assert.match(bySiteCoordinator, /data-action="account-deactivate"/);
  assert.doesNotMatch(bySiteCoordinator, /volunteer-deactivate-note/);
  // Someone who isn't a site coordinator keeps Deactivate for any admin.
  const plain = accountPart(volunteerDrawerBody({ volunteer: withStatus("active"), isNew: false, ui: {}, canChangeAdmin: false }));
  assert.match(plain, /data-action="account-deactivate"/);
  assert.doesNotMatch(plain, /volunteer-deactivate-note/);
});

test("the cancel-invitation dialog says access ends, not the sign-in code", () => {
  const html = cancelInvitationDialogBody({ volunteer: volunteer(), });
  assert.match(html, /will be cancelled and it will no longer give them access./);
  assert.doesNotMatch(html, /sign-in code/);
});

test("drawer account section offers Reactivate when deactivated", () => {
  const section = accountPart(drawerFor("deactivated"));
  assert.match(section, /data-action="account-reactivate"/);
  assert.doesNotMatch(section, /account-create|account-resend|account-deactivate/);
});

test("drawer account section offers nothing for a new volunteer before saving", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} });
  assert.doesNotMatch(html, /volunteer-account|account-create/);
});

test("the drawer says the last account result, and the confirmation asks before deactivating", () => {
  const ok = accountPart(drawerFor("invited", { accountNotice: { kind: "ok", text: "Account created and invitation sent" } }));
  assert.match(ok, /role="status"[^>]*>.*Account created and invitation sent/);
  const bad = accountPart(drawerFor("none", { accountNotice: { kind: "error", text: "Add an email first" } }));
  assert.match(bad, /role="alert"[^>]*>.*Add an email first/);
  const confirm = deactivateAccountDialogBody({ volunteer: volunteer() });
  assert.match(confirm, /Mira Patel/);
  assert.match(confirm, /data-action="confirm-deactivate-account"/);
  assert.match(confirm, /data-action="close-dialog"/);
  const html = dialog(baseState({ dialog: "deactivate-account", dialogContext: { volunteerId: "v-1" } }));
  assert.match(html, /Deactivate this account?/);
});

test("Signed in as shows in the row's Account cell and in the drawer, escaped", () => {
  const signed = withStatus("active", { signedInName: "Mira <b>P</b>" });
  const [row] = rowsOf(renderRoster([signed], { list: "ready", filters: {} }));
  assert.match(row, /<td>Active<span class="volunteer-signed-in">Signed in as Mira &lt;b&gt;P&lt;\/b&gt;<\/span><\/td>/);
  const section = accountPart(volunteerDrawerBody({ volunteer: signed, isNew: false, ui: {} }));
  assert.match(section, /<p class="volunteer-signed-in">Signed in as Mira &lt;b&gt;P&lt;\/b&gt;<\/p>/);
  assert.doesNotMatch(section, /<b>P/);
  // No name given yet: no line.
  const [plain] = rowsOf(renderRoster([withStatus("invited")], { list: "ready", filters: {} }));
  assert.doesNotMatch(plain, /Signed in as/);
  assert.doesNotMatch(accountPart(drawerFor("invited")), /Signed in as/);
});

test("the cancel question names the volunteer and the email, and changes nothing until confirmed", () => {
  const body = cancelInvitationDialogBody({ volunteer: volunteer({ account: { status: "invited", revision: 4 } }) });
  assert.match(body, /Mira Patel \(mira@example\.test\)/);
  assert.match(body, /The email can be edited again, and you can invite them again later\./);
  assert.match(body, /data-action="confirm-cancel-invitation"[^>]*>Cancel invitation</);
  assert.match(body, /data-action="close-dialog"/);
  const html = dialog(baseState({ dialog: "cancel-invitation", dialogContext: { volunteerId: "v-1" } }));
  assert.match(html, /<h2 id="modal-title">Cancel this invitation\?<\/h2>/);
  assert.match(html, /Mira Patel \(mira@example\.test\)/);
  // From the office list: the email only.
  const office = dialog(baseState({ dialog: "cancel-invitation", dialogContext: { email: "ana@example.org", revision: 1 } }));
  assert.match(office, /Cancel this invitation\?/);
  assert.match(office, /The invitation for ana@example\.org will be cancelled/);
  assert.match(office, /data-action="confirm-cancel-invitation"/);
});

test("the send question is exactly the email it goes to", () => {
  const drawer = dialog(
    baseState({
      volunteers: [volunteer({ email: "ada@example.org", account: { status: "none", revision: null } })],
      dialog: "send-invitation",
      dialogContext: { volunteerId: "v-1" },
    }),
  );
  assert.match(drawer, /<h2 id="modal-title">Send a sign-in invitation to ada@example\.org\?<\/h2>/);
  assert.match(drawer, /data-action="confirm-send-invitation"[^>]*>Send</);
  assert.match(drawer, /data-action="close-dialog"[^>]*>Cancel</);
  const office = dialog(baseState({ dialog: "send-invitation", dialogContext: { email: "ada@example.org" } }));
  assert.match(office, /Send a sign-in invitation to ada@example\.org\?/);
  const hostile = dialog(baseState({ dialog: "send-invitation", dialogContext: { email: "<i>x</i>@example.org" } }));
  assert.match(hostile, /Send a sign-in invitation to &lt;i&gt;x&lt;\/i&gt;@example\.org\?/);
});

// ---- The Workload tab (change add-volunteer-workload) ----------------------

const WORKER = volunteer({ id: "p-alex", name: "Alex Chen", roles: ["preparer"] });
const workloadState = (overrides = {}) =>
  baseState({
    volunteers: [WORKER],
    cases: [
      {
        id: "c-1",
        reference: "VT-ABCD-EFGH",
        stage: "preparing",
        preparerId: "p-alex",
        reviewerId: null,
        participants: ["p-alex"],
        openRequests: 0,
        updatedAt: new Date().toISOString(),
        lastContactAt: null,
        answers: { tp_first_name: "Lena", tp_last_name: "Ortiz" },
      },
    ],
    ...overrides,
  });

test("a cleared admin has a Roster tab and a Workload tab; the Roster is the default", () => {
  const html = staffScreen(workloadState());
  assert.match(html, /data-action="volunteer-tab" data-tab="roster"[^>]*aria-current="page"/);
  assert.match(html, /data-action="volunteer-tab" data-tab="workload"/);
  assert.match(html, /id="roster-title"/);
  assert.doesNotMatch(html, /workload-table/);
});

test("on the Workload tab the table replaces the Roster, with names and no Add button", () => {
  const html = staffScreen(workloadState({ volunteerTab: "workload", workload: { sort: { key: "open", dir: "desc" }, search: "", expanded: ["p-alex"] } }));
  assert.match(html, /data-tab="workload"[^>]*aria-current="page"/);
  assert.match(html, /workload-table/);
  assert.doesNotMatch(html, /id="roster-title"/);
  assert.match(html, /data-row-id="p-alex"/);
  assert.match(html, /Lena Ortiz/);
  assert.doesNotMatch(html, /data-action="open-add-volunteer"/);
  // Without workload state yet, the defaults hold.
  const bare = staffScreen(workloadState({ volunteerTab: "workload" }));
  assert.match(bare, /aria-sort="descending"><button type="button"[^>]*data-key="open"/);
});

test("an uncleared ceiling admin keeps the Roster alone, even if the tab says Workload", () => {
  const uncleared = { ...cleared({ isAdmin: true }), cleared: false, missing: [{ kind: "photoId" }] };
  const html = staffScreen(
    workloadState({
      volunteerTab: "workload",
      principal: { userId: "u1", workspaceId: "w1", access: "staff", personId: "p-sam", clearance: uncleared },
    }),
  );
  assert.match(html, /id="roster-title"/);
  assert.doesNotMatch(html, /data-tab="workload"|workload-table|Lena Ortiz/);
});

test("a cleared ceiling admin without effective admin gets no Workload", () => {
  const html = staffScreen(
    workloadState({
      volunteerTab: "workload",
      people: [{ ...ADMIN_PERSON, capabilities: ["followup"] }, PREPARER_PERSON],
    }),
  );
  assert.doesNotMatch(html, /data-tab="workload"|workload-table|Lena Ortiz/);
});

test("the assign dialog is a drawer naming the case, the client and the slot", () => {
  const html = dialog(
    workloadState({
      volunteers: [WORKER, volunteer({ id: "p-noor", name: "Noor Haddad", roles: ["preparer"] })],
      people: [ADMIN_PERSON, PREPARER_PERSON, { id: "p-noor", name: "Noor Haddad", capabilities: ["prepare"] }],
      dialog: "assign",
      dialogContext: { caseId: "c-1", slot: "preparer", search: "" },
    }),
  );
  assert.match(html, /class="modal office-drawer"/);
  assert.match(html, /<span class="overline">OFFICE · WORKLOAD<\/span>/);
  assert.match(html, /<h2 id="modal-title">VT-ABCD-EFGH · Lena Ortiz<\/h2>/);
  assert.match(html, /Reassign the preparer/);
  assert.match(html, /data-action="assign-case" data-person-id="p-noor"/);
  assert.doesNotMatch(html, /data-person-id="p-alex"/);
  const failed = dialog(
    workloadState({ dialog: "assign", dialogContext: { caseId: "c-1", slot: "preparer" }, error: { code: "SERVER_ERROR", message: "Boom." } }),
  );
  assert.equal(failed.match(/role="alert"/g).length, 1);
  const gone = dialog(workloadState({ dialog: "assign", dialogContext: { caseId: "gone", slot: "preparer" } }));
  assert.match(gone, /This case could not be opened/);
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

test("the drawer has an empty polite status line for unticked roles (#192)", () => {
  for (const html of [
    volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} }),
    volunteerDrawerBody({ volunteer: volunteer(), isNew: false, ui: {} }),
  ]) {
    assert.match(
      html,
      /<p class="sr-only" role="status" aria-live="polite" id="volunteer-role-notice"><\/p>/
    );
    assert.equal(html.match(/id="volunteer-role-notice"/g).length, 1);
  }
});

test("a site coordinator's row without SC says SC certificate missing", () => {
  const [row] = rowsOf(
    renderRoster([volunteer({ roles: ["admin"], cleared: false, missing: ["scCertificate"] })], { list: "ready", filters: {} }),
  );
  assert.match(row, /Not cleared/);
  assert.match(row, /SC certificate missing/);
});

const adminTick = (html) => html.match(/<input type="checkbox" name="role" value="admin"[^>]*>/)[0];

test("for someone who is not a site coordinator the Admin tick is disabled, keeps its state and says why", () => {
  const held = volunteerDrawerBody({ volunteer: volunteer({ roles: ["admin"] }), isNew: false, ui: {}, canChangeAdmin: false });
  assert.match(adminTick(held), / disabled/);
  assert.match(adminTick(held), / checked/);
  assert.match(adminTick(held), /aria-describedby="volunteer-admin-note"/);
  assert.match(held, /<p class="field-note" id="volunteer-admin-note">Only site coordinators change the Admin role\.<\/p>/);
  // A disabled box is not sent, so the saved Admin role goes with the form as it was.
  assert.match(held, /<input type="hidden" name="role" value="admin">/);
  const without = volunteerDrawerBody({ volunteer: volunteer({ roles: ["preparer"] }), isNew: false, ui: {}, canChangeAdmin: false });
  assert.match(adminTick(without), / disabled/);
  assert.doesNotMatch(adminTick(without), / checked/);
  assert.doesNotMatch(without, /type="hidden" name="role"/);
  // The other roles stay free.
  assert.doesNotMatch(without.match(/<input type="checkbox" name="role" value="preparer"[^>]*>/)[0], /disabled/);
});

test("for a site coordinator the Admin tick is a normal tick", () => {
  const html = volunteerDrawerBody({ volunteer: volunteer({ roles: ["admin"] }), isNew: false, ui: {}, canChangeAdmin: true });
  assert.doesNotMatch(adminTick(html), /disabled/);
  assert.doesNotMatch(html, /Only site coordinators change the Admin role|type="hidden" name="role"/);
});

test("the drawer's Admin tick follows whether the signed-in person is a site coordinator", () => {
  const open = (isSiteCoordinator) =>
    dialog(
      baseState({
        principal: { userId: "u1", workspaceId: "w1", access: "staff", personId: "p-sam", clearance: cleared({ isAdmin: true, isSiteCoordinator }) },
        volunteers: [volunteer({ roles: ["admin"] })],
        dialog: "volunteer",
        dialogContext: { volunteerId: "v-1" },
      }),
    );
  assert.match(adminTick(open(false)), / disabled/);
  assert.match(open(false), /Only site coordinators change the Admin role\./);
  assert.doesNotMatch(adminTick(open(true)), /disabled/);
});

// ---- uploads to review (change add-clearance-uploads) ----

test("the toolbar has a Show select", () => {
  const html = renderRoster([volunteer()], { list: "ready", filters: { show: "uploads" } });
  assert.match(html, /<select id="volunteer-show-filter" data-volunteer-filter="show">/);
  const options = [...html.match(/id="volunteer-show-filter"[^]*?<\/select>/)[0].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)</g)];
  assert.deepEqual(options.map((m) => [m[1], Boolean(m[2]), m[3]]), [
    ["all", false, "Everyone"],
    ["uploads", true, "Uploads to review"],
  ]);
  const plain = renderRoster([volunteer()], { list: "ready", filters: {} });
  assert.match(plain, /<option value="all" selected>Everyone/);
});

test("the Show filter narrows the rows", () => {
  const html = renderRoster(
    [volunteer({ id: "a", name: "A One", form13615SentAt: "2026-11-20T15:00:00Z" }), volunteer({ id: "b", name: "B Two" })],
    { list: "ready", filters: { show: "uploads" } },
  );
  assert.match(html, /A One/);
  assert.doesNotMatch(html, /B Two/);
  assert.match(html, /1 of 2 volunteers/);
});

test("a row says Form 13615 to review and Photo ID to review", () => {
  const sentAt = "2026-11-20T15:00:00Z";
  const rows = (v) => renderRoster([v], { list: "ready", filters: {} });
  const uncleared = rows(volunteer({ cleared: false, missing: ["form13615"], form13615SentAt: sentAt }));
  assert.match(uncleared, /Not cleared<\/span> <span class="muted">Form 13615 missing<\/span> <span class="volunteer-to-review">Form 13615 to review<\/span>/);
  const clearedRow = rows(volunteer({ cleared: true, photoIdSentAt: sentAt }));
  assert.match(clearedRow, /Cleared<\/span> <span class="volunteer-to-review">Photo ID to review<\/span>/);
  assert.match(rows(volunteer({ form13615SentAt: sentAt, photoIdSentAt: sentAt })), /Form 13615 to review, Photo ID to review/);
  assert.doesNotMatch(rows(volunteer()), /volunteer-to-review/);
});

test("the drawer shows Form 13615 sent Nov 20 with Mark reviewed", () => {
  const html = volunteerDrawerBody({
    volunteer: volunteer({ form13615SentAt: "2026-11-20T15:00:00Z", photoIdSentAt: "2026-11-19T15:00:00Z" }),
    isNew: false,
    ui: {},
  });
  assert.match(html, /Form 13615 sent Nov 20/);
  assert.match(html, /Photo ID sent Nov 19/);
  assert.match(html, /<button type="button" class="btn secondary" data-action="mark-upload-reviewed" data-document="form13615">Mark reviewed<\/button>/);
  assert.match(html, /data-action="mark-upload-reviewed" data-document="photoId"/);
  assert.ok(html.indexOf("Form 13615 sent") < html.indexOf("<legend>Certificates</legend>"));
  assert.ok(html.indexOf("Photo ID sent") > html.indexOf('id="volunteer-photoIdChecked"'));
});

test("drawer date is the New York day", () => {
  // 02:30 UTC on Nov 21 is 9:30 pm on Nov 20 in New York.
  const html = volunteerDrawerBody({ volunteer: volunteer({ form13615SentAt: "2026-11-21T02:30:00Z" }), isNew: false, ui: {} });
  assert.match(html, /Form 13615 sent Nov 20/);
});

test("no sent line when nothing is waiting", () => {
  const html = volunteerDrawerBody({ volunteer: volunteer(), isNew: false, ui: {} });
  assert.doesNotMatch(html, /sent|mark-upload-reviewed/);
});

test("no sent line in Add a volunteer", () => {
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} });
  assert.doesNotMatch(html, /mark-upload-reviewed/);
  const withData = volunteerDrawerBody({ volunteer: volunteer({ form13615SentAt: "2026-11-20T15:00:00Z" }), isNew: true, ui: {} });
  assert.doesNotMatch(withData, /mark-upload-reviewed/);
});

test("Mark reviewed is off while the drawer is busy", () => {
  const v = volunteer({ form13615SentAt: "2026-11-20T15:00:00Z", photoIdSentAt: "2026-11-20T15:00:00Z" });
  const busy = volunteerDrawerBody({ volunteer: v, isNew: false, ui: { busy: true } });
  assert.equal([...busy.matchAll(/data-action="mark-upload-reviewed" data-document="[A-Za-z0-9]+" disabled/g)].length, 2);
  const idle = volunteerDrawerBody({ volunteer: v, isNew: false, ui: {} });
  assert.doesNotMatch(idle, /mark-upload-reviewed"[^>]*disabled/);
});

// The reason row, Last returned and Usual days (change add-my-profile, D7, D8).
const drawer = (overrides = {}, ui = {}) =>
  volunteerDrawerBody({ volunteer: volunteer(overrides), isNew: false, ui });
const picks = (html) =>
  [...html.matchAll(/<input[^>]*name="review-reason"[^>]*value="([^"]*)"/g)].map((m) => m[1].replace(/&#39;/g, "'"));

test("Mark reviewed opens the reason row", () => {
  const closed = drawer({ form13615SentAt: "2026-11-20T15:00:00Z" });
  assert.doesNotMatch(closed, /review-reason/);
  const open = drawer({ form13615SentAt: "2026-11-20T15:00:00Z" }, { reviewReasonFor: "form13615" });
  assert.match(open, /name="review-reason"/);
  assert.match(open, /<input[^>]*name="review-note"[^>]*maxlength="120"/);
  assert.match(open, /data-action="send-back"/);
  assert.match(open, /data-action="cancel-review"/);
  assert.match(open, />Send back</);
  assert.match(open, />Cancel</);
});

test("photo ID picks are Can't read it, Expired and Not a photo ID", () => {
  const html = drawer({ photoIdSentAt: "2026-11-20T15:00:00Z" }, { reviewReasonFor: "photoId" });
  assert.deepEqual(picks(html), ["Can't read it", "Expired", "Not a photo ID"]);
  assert.doesNotMatch(html, /Not signed|Wrong form|Missing a certification|Already on file/);
});

test("13615 picks are the four, plus Already on file with a role", () => {
  const html = drawer({ form13615SentAt: "2026-11-20T15:00:00Z", roles: ["preparer"] }, { reviewReasonFor: "form13615" });
  assert.deepEqual(picks(html), ["Not signed", "Can't read it", "Wrong form", "Missing a certification", "Already on file"]);
});

test("Already on file only with a role this season", () => {
  const html = drawer({ form13615SentAt: "2026-11-20T15:00:00Z", roles: [] }, { reviewReasonFor: "form13615" });
  assert.deepEqual(picks(html), ["Not signed", "Can't read it", "Wrong form", "Missing a certification"]);
});

test("Send back is disabled until a pick or a note", () => {
  const html = drawer({ form13615SentAt: "2026-11-20T15:00:00Z" }, { reviewReasonFor: "form13615" });
  assert.match(html, /data-action="send-back"[^>]* disabled/);
});

test("a stored reason shows Last returned in the document's place", () => {
  const stored = drawer({
    form13615ReviewedAt: "2026-11-21T03:30:00Z",
    form13615ReviewReason: "Not signed",
    photoIdReviewedAt: "2026-11-21T03:30:00Z",
    photoIdReviewReason: "Expired",
  });
  assert.match(stored, /Last returned: Not signed · Nov 20/);
  assert.match(stored, /Last returned: Expired · Nov 20/);
  assert.ok(stored.indexOf("Last returned: Not signed") > stored.indexOf("<legend>Roles</legend>"));
  assert.ok(stored.indexOf("Last returned: Not signed") < stored.indexOf("<legend>Certificates</legend>"));
  assert.ok(stored.indexOf("Last returned: Expired") > stored.indexOf('id="volunteer-photoIdChecked"'));
  const sent = drawer({
    form13615SentAt: "2026-11-20T15:00:00Z",
    form13615ReviewedAt: "2026-11-21T03:30:00Z",
    form13615ReviewReason: "Not signed",
  });
  assert.match(sent, /Form 13615 sent Nov 20/);
  assert.doesNotMatch(sent, /Last returned/);
});

test("escapes the last reason in the drawer", () => {
  const html = drawer({ photoIdReviewedAt: "2026-11-21T03:30:00Z", photoIdReviewReason: '<b>&"' });
  assert.match(html, /Last returned: &lt;b&gt;&amp;&quot; · Nov 20/);
  assert.doesNotMatch(html, /<b>/);
});

test("usual days are ticked from the record", () => {
  const html = drawer({ usualDays: ["mon", "wed"] });
  assert.match(html, /<legend>Usual days<\/legend>/);
  for (const [value, label] of [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]]) {
    assert.match(html, new RegExp(`<input type="checkbox" name="usualDays" value="${value}"[^>]*>`));
    assert.match(html, new RegExp(`<span>${label}</span>`));
  }
  assert.equal([...html.matchAll(/name="usualDays" value="\w+" checked/g)].length, 2);
  assert.match(html, /name="usualDays" value="mon" checked/);
});

// Returning volunteers (change add-returning-volunteers-and-roster-csv).
const earlierPerson = (overrides = {}) => ({
  id: "v-old",
  name: "Dana Okafor",
  email: "dana@example.test",
  phone: "215-555-0199",
  works: "on_site",
  languages: ["english"],
  otherLanguage: null,
  usualDays: ["tue", "thu"],
  hasSignIn: false,
  lastSeason: true,
  revision: 2,
  ...overrides,
});

test("the Add drawer offers last season's roster to search, with an Earlier volunteer tag", () => {
  const candidates = [
    earlierPerson(),
    earlierPerson({ id: "v-older", name: "Lee Wong", email: "lee@example.test", lastSeason: false, earlier: true }),
  ];
  const html = volunteerDrawerBody({
    volunteer: null,
    isNew: true,
    ui: {},
    returning: { query: "e", candidates, picked: null },
  });
  assert.match(html, /<label[^>]*for="returning-search"[^>]*>[\s\S]*Returning volunteer\? Search last season&#39;s roster|Returning volunteer\? Search last season's roster/);
  assert.match(html, /<input[^>]*id="returning-search"[^>]*>/);
  assert.match(html.match(/<input[^>]*id="returning-search"[^>]*>/)[0], /value="e"/);
  const picks = html.match(/<button[^>]*data-action="pick-returning-volunteer"[\s\S]*?<\/button>/g);
  assert.equal(picks.length, 2);
  assert.match(picks[0], /data-id="v-old"/);
  assert.match(picks[0], /Dana Okafor/);
  assert.match(picks[0], /dana@example\.test/);
  assert.doesNotMatch(picks[0], /Earlier volunteer/);
  assert.match(picks[1], /data-id="v-older"/);
  assert.match(picks[1], /Earlier volunteer/);
  assert.doesNotMatch(html, /Not this person/);
  // The search sits before the form, so the form's own fields still come first in it.
  assert.ok(html.indexOf('id="returning-search"') < html.indexOf('id="volunteer-form"'));
});

test("a picked earlier volunteer fills Add, email read-only, nothing for this season ticked", () => {
  const picked = earlierPerson();
  const html = volunteerDrawerBody({
    volunteer: null,
    isNew: true,
    ui: {},
    returning: { query: "dana", candidates: [picked], picked },
  });
  const email = html.match(/<input[^>]*id="volunteer-email"[^>]*>/)[0];
  assert.match(email, /readonly/);
  assert.match(email, /value="dana@example\.test"/);
  assert.match(html.match(/<input[^>]*id="volunteer-name"[^>]*>/)[0], /value="Dana Okafor"/);
  assert.doesNotMatch(html.match(/<input type="checkbox" name="isNew"[^>]*>/)[0], /checked/);
  assert.doesNotMatch(html.match(/<input type="checkbox" name="photoIdChecked"[^>]*>/)[0], /checked/);
  for (const box of html.match(/<input type="checkbox" name="(role|certificate)"[^>]*>/g)) assert.doesNotMatch(box, /checked/);
  assert.match(html.match(/<input[^>]*id="volunteer-usualDays-tue"[^>]*>/)[0], /checked/);
  assert.match(html.match(/<input[^>]*id="volunteer-usualDays-thu"[^>]*>/)[0], /checked/);
  assert.doesNotMatch(html.match(/<input[^>]*id="volunteer-usualDays-mon"[^>]*>/)[0], /checked/);
  assert.match(html, /<button[^>]*data-action="unpick-returning-volunteer"[^>]*>Not this person<\/button>/);
  assert.doesNotMatch(html, /id="returning-search"/);
  assert.doesNotMatch(html, /data-action="pick-returning-volunteer"/);
  // Still an add: no account section, no document lines.
  assert.doesNotMatch(html, /Mark reviewed|volunteer-account/);
  assert.match(html, /<button type="submit"[^>]*>Add a volunteer<\/button>/);
});

test("a picked earlier volunteer with a sign-in keeps the email read-only", () => {
  const picked = earlierPerson({ hasSignIn: true });
  const html = volunteerDrawerBody({ volunteer: null, isNew: true, ui: {}, returning: { query: "", candidates: [], picked } });
  assert.match(html.match(/<input[^>]*id="volunteer-email"[^>]*>/)[0], /readonly/);
  assert.match(html, /This is their sign-in email\./);
});

test("the volunteer dialog for a pick is the Add drawer filled from the earlier person", () => {
  const html = dialog(
    baseState({
      dialog: "volunteer",
      dialogContext: { volunteerId: "v-old", returning: true },
      earlierVolunteers: [earlierPerson()],
      returningSearch: "dana",
    }),
  );
  assert.match(html, /<h2 id="modal-title">Add a volunteer<\/h2>/);
  assert.doesNotMatch(html, /could not be opened/);
  assert.match(html.match(/<input[^>]*id="volunteer-email"[^>]*>/)[0], /readonly/);
  assert.match(html, /Not this person/);
  const plain = dialog(
    baseState({ dialog: "volunteer", dialogContext: null, earlierVolunteers: [earlierPerson()], returningSearch: "" }),
  );
  assert.match(plain, /id="returning-search"/);
  assert.match(plain, /data-action="pick-returning-volunteer" data-id="v-old"/);
});

test("the Roster's Export CSV is on with rows and off when nothing passes the filters", () => {
  const on = renderRoster([volunteer()], { list: "ready", filters: {}, exportable: true });
  const onButton = on.match(/<button[^>]*data-action="export-roster-csv"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(onButton, /Export CSV/);
  assert.doesNotMatch(onButton, /disabled/);
  const off = renderRoster([volunteer()], { list: "ready", filters: { search: "zzz" }, exportable: true });
  assert.match(off.match(/<button[^>]*data-action="export-roster-csv"[^>]*>/)[0], /disabled/);
  const page = staffScreen(baseState());
  assert.match(page, /data-action="export-roster-csv"/);
});

test("a pick whose earlier person is gone says it could not be opened, with no search box", () => {
  const html = dialog(
    baseState({
      dialog: "volunteer",
      dialogContext: { volunteerId: "gone", returning: true },
      earlierVolunteers: [earlierPerson()],
      returningSearch: "",
    }),
  );
  assert.match(html, /This volunteer could not be opened\. Close this and try again\./);
  assert.doesNotMatch(html, /id="returning-search"/);
  assert.doesNotMatch(html, /id="volunteer-form"/);
});

// Change add-remove-from-roster: the drawer's Remove button, its confirmation
// and the Reactivate note (#269).
const REMOVE_BUTTON = /data-action="volunteer-remove" data-volunteer-id="v-1"/;
test("the Edit drawer offers Remove from this season's roster…", () => {
  const html = drawerFor("active");
  assert.match(html, REMOVE_BUTTON);
  assert.ok(html.includes("Remove from this season&#39;s roster…") || html.includes("Remove from this season's roster…"));
  assert.doesNotMatch(volunteerDrawerBody({ volunteer: null, isNew: true, ui: {} }), /data-action="volunteer-remove"/);
});

test("a non-site-coordinator sees the site coordinator sentence instead of Remove", () => {
  const html = volunteerDrawerBody({ volunteer: withStatus("active", { isSiteCoordinator: true }), isNew: false, ui: {}, canChangeAdmin: false });
  assert.doesNotMatch(html, /data-action="volunteer-remove"/);
  assert.match(html, /Only site coordinators remove a site coordinator from the roster\./);
  const sc = volunteerDrawerBody({ volunteer: withStatus("active", { isSiteCoordinator: true }), isNew: false, ui: {}, canChangeAdmin: true });
  assert.match(sc, REMOVE_BUTTON);
});

test("a non-site-coordinator sees the Admin role sentence instead of Remove", () => {
  const html = volunteerDrawerBody({ volunteer: withStatus("active", { roles: ["admin"] }), isNew: false, ui: {}, canChangeAdmin: false });
  assert.doesNotMatch(html, /data-action="volunteer-remove"/);
  assert.match(html, /<p class="field-note" id="volunteer-remove-note">Only site coordinators change the Admin role\.<\/p>/);
  const plain = volunteerDrawerBody({ volunteer: withStatus("active"), isNew: false, ui: {}, canChangeAdmin: false });
  assert.match(plain, REMOVE_BUTTON);
});

test("the confirmation for an active account", () => {
  const html = removeFromRosterDialogBody({ volunteer: withStatus("active") });
  assert.match(html, /Mira Patel \(mira@example\.test\) comes off this season&#39;s roster, with their roles, certificates and the record of what they sent this season\./);
  assert.match(html, /Their account is deactivated, so they can no longer sign in\./);
  assert.match(html, /Their cases and contact details are kept\. To add them back, search for mira@example\.test in Add a volunteer\./);
  assert.match(html, /data-action="confirm-remove-from-roster"[^>]*>[^<]*Remove from roster/);
  assert.match(html, /data-action="close-dialog"[^>]*>[^<]*Cancel/);
  assert.doesNotMatch(html, /remove-from-roster-error/);
});

test("the confirmation's account line follows the account", () => {
  const line = (v) => removeFromRosterDialogBody({ volunteer: v });
  for (const status of ["invited", "active"])
    assert.match(line(withStatus(status)), /Their account is deactivated, so they can no longer sign in\./, status);
  const sc = line(withStatus("active", { isSiteCoordinator: true }));
  assert.match(sc, /Their account stays active because they are a site coordinator, but they will have no roles this season\./);
  assert.doesNotMatch(sc, /so they can no longer sign in/);
  assert.match(line(withStatus("deactivated")), /Their account is already deactivated\./);
  const none = line(withStatus("none"));
  assert.doesNotMatch(none, /Their account/);
});

test("the confirmation escapes the name and email, and shows a refusal", () => {
  const html = removeFromRosterDialogBody({ volunteer: withStatus("active", { name: "<b>X</b>", email: "a<i>@e.test" }), error: "Try again <u>" });
  assert.doesNotMatch(html, /<b>X|<i>|<u>/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.match(html, /role="alert" id="remove-from-roster-error"|id="remove-from-roster-error"[^>]*role="alert"/);
  const view = dialog(baseState({ dialog: "remove-from-roster", dialogContext: { volunteerId: "v-1" }, volunteers: [volunteer()], removeFromRosterError: "Nope." }));
  assert.match(view, /Remove Mira Patel from this season&#39;s roster\?/);
  assert.match(view, /remove-from-roster-error/);
});

test("a deactivated volunteer's drawer shows the Reactivate note", () => {
  const html = drawerFor("deactivated");
  assert.match(html, /<p class="field-note" id="volunteer-reactivate-note">Reactivate so they can sign in\.<\/p>/);
  for (const status of ["none", "invited", "active"])
    assert.doesNotMatch(drawerFor(status), /volunteer-reactivate-note/, status);
});

test("the notice and the note never show together", () => {
  const html = drawerFor("deactivated", { accountNotice: { kind: "ok", text: "Mira is back on this season's roster." } });
  assert.match(html, /volunteer-account-notice/);
  assert.doesNotMatch(html, /volunteer-reactivate-note/);
});
