import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderFeedItem,
  renderNotificationsPanel,
  renderPostUpdatePage,
  renderUpdatePreview,
  renderUpdatePeople,
  unpublishConfirm,
  deleteDraftConfirm,
  updateFormFromValues,
  UPDATE_TOASTS,
  saveToast,
  actionToast,
} from "../src/update-views.mjs";
import { emptyUpdateForm } from "../src/posted-updates.mjs";
import { staffScreen, dialog, DRAWERS } from "../src/views.mjs";
import { nowInput } from "../src/contact-log.mjs";
import { cleared } from "./support/clearance.mjs";

// Fictional people and updates only.
const NASTY = `Office <closed> & "early"`;
const NASTY_ESCAPED = "Office &lt;closed&gt; &amp; &quot;early&quot;";

const feedItem = (over = {}) => ({
  source: "posted_update",
  id: "u-1",
  kind: "irs_policy",
  title: "Sign this year's Volunteer Standards of Conduct",
  message: "Before your first shift, sign Form 13615.",
  irsLink: null,
  postedAt: "2025-12-02T15:00:00Z",
  postedByName: "Sam Rivera",
  edited: false,
  pinned: false,
  askConfirm: false,
  readAt: "2025-12-02T16:00:00Z",
  confirmedAt: null,
  ...over,
});

const row = (over = {}) => ({
  id: "r-1",
  kind: "irs_policy",
  title: "Sign this year's Volunteer Standards of Conduct",
  message: "Before your first shift, sign Form 13615.",
  irsLink: null,
  audience: "everyone",
  roles: [],
  keepTopUntil: null,
  askConfirm: true,
  status: "posted",
  createdAt: "2025-12-01T15:00:00Z",
  postedAt: "2025-12-02T15:00:00Z",
  postedByName: "Sam Rivera",
  editedAt: null,
  unpublishedAt: null,
  revision: 2,
  audienceSize: 8,
  readCount: 7,
  confirmedCount: 6,
  people: [
    { personId: "p-1", name: "Mira Patel", readAt: "2025-12-02T16:00:00Z", confirmedAt: "2025-12-03T16:00:00Z" },
    { personId: "p-2", name: "Noor Haddad", readAt: null, confirmedAt: null },
  ],
  ...over,
});

const ADMIN = { id: "p-sam", name: "Sam Rivera", capabilities: ["admin", "followup"] };
const PREPARER = { id: "p-alex", name: "Alex Chen", capabilities: ["prepare"] };

const adminState = (over = {}) => ({
  principal: { userId: "u1", workspaceId: "w1", access: "staff", personId: "p-sam", personName: "Sam Rivera", clearance: cleared({ isAdmin: true }) },
  people: [ADMIN, PREPARER],
  cases: [],
  assistance: [],
  savedCase: null,
  screen: "office-updates",
  boardFilters: {},
  openPanels: [],
  draftAnswers: {},
  busy: false,
  error: null,
  retryable: false,
  lists: { cases: "ready", assistance: "ready", volunteers: "ready", updates: "ready", postedUpdates: "ready" },
  volunteers: [],
  volunteerFilters: { search: "", role: "all" },
  updates: [],
  updatesUnread: 0,
  notificationsOpen: false,
  postedUpdates: [row()],
  updateForm: emptyUpdateForm(),
  updateEditing: null,
  updateFormError: null,
  dialog: null,
  dialogContext: null,
  ...over,
});

const panelState = (over = {}) => adminState({ screen: "staff", dialog: "notifications", notificationsOpen: true, ...over });

// ---------------------------------------------------------------------------
// The Notifications panel
// ---------------------------------------------------------------------------

test("the panel is a drawer listed with the others", () => {
  assert.ok(DRAWERS.includes("notifications"));
  const html = dialog(panelState({ updates: [feedItem()] }));
  assert.match(html, /class="modal office-drawer"/);
  assert.match(html, /<h2 id="modal-title">Notifications<\/h2>/);
});

test("the panel lists the items in the order given", () => {
  const html = renderNotificationsPanel(
    panelState({ updates: [feedItem({ id: "b", title: "Second posted, pinned" }), feedItem({ id: "a", title: "First" })] }),
  );
  assert.ok(html.indexOf("Second posted, pinned") < html.indexOf("First"));
  assert.equal((html.match(/<article class="feed-item/g) ?? []).length, 2);
});

test("an unread item, or one waiting for confirmation, is highlighted", () => {
  assert.match(renderFeedItem(feedItem({ readAt: null })), /<article class="feed-item is-unread"/);
  assert.match(renderFeedItem(feedItem({ askConfirm: true, confirmedAt: null })), /<article class="feed-item is-unread"/);
  assert.match(renderFeedItem(feedItem()), /<article class="feed-item"/);
});

test("an item unread when the panel opened stays highlighted after it is marked read", () => {
  assert.match(renderFeedItem(feedItem(), { fresh: true }), /<article class="feed-item is-unread"/);
  const html = renderNotificationsPanel(
    panelState({ updates: [feedItem({ id: "a" }), feedItem({ id: "b" })], notificationsFresh: ["a"] }),
  );
  assert.match(html, /<article class="feed-item is-unread" data-update-id="a"/);
  assert.match(html, /<article class="feed-item" data-update-id="b"/);
});

test("the IRS link and I've read this sit in one row", () => {
  const html = renderFeedItem(feedItem({ irsLink: "https://www.irs.gov/x", askConfirm: true }));
  assert.match(html, /<div class="feed-actions"><a class="feed-link"[^]*data-action="confirm-update"[^]*<\/div><\/article>$/);
  assert.doesNotMatch(renderFeedItem(feedItem()), /feed-actions/);
});

test("I've read this shows only for an item that asks and is not confirmed; a confirmed one shows the date", () => {
  const asks = renderFeedItem(feedItem({ askConfirm: true }));
  assert.match(asks, /<button type="button" class="btn secondary feed-confirm" data-action="confirm-update" data-id="u-1"[^>]*>I&#39;ve read this<\/button>/);
  assert.doesNotMatch(renderFeedItem(feedItem({ askConfirm: false })), /I&#39;ve read this/);
  const done = renderFeedItem(feedItem({ askConfirm: true, confirmedAt: "2025-12-02T18:00:00Z" }));
  assert.doesNotMatch(done, /I&#39;ve read this/);
  assert.match(done, /Confirmed Dec 2/);
  assert.match(done, /id="feed-confirmed-u-1"/);
});

test("dates are New York calendar days", () => {
  // 03:00 UTC on Dec 3 is still Dec 2 in New York.
  const html = renderFeedItem(feedItem({ postedAt: "2025-12-03T03:00:00Z" }));
  assert.match(html, /Dec 2/);
});

test("an item shows its poster, type, title, message, date, Edited and Pinned", () => {
  const html = renderFeedItem(feedItem({ edited: true, pinned: true }));
  assert.match(html, /Sam Rivera/);
  assert.match(html, /IRS policy update/);
  assert.match(html, /Sign this year&#39;s Volunteer Standards of Conduct/);
  assert.match(html, /Before your first shift, sign Form 13615\./);
  assert.match(html, /Dec 2/);
  assert.match(html, />Edited</);
  assert.match(html, />Pinned</);
  const plain = renderFeedItem(feedItem());
  assert.doesNotMatch(plain, />Edited<|>Pinned</);
  assert.match(renderFeedItem(feedItem({ kind: "office_notice" })), /Office notice/);
});

test("the IRS link opens in a new tab without an opener", () => {
  const html = renderFeedItem(feedItem({ irsLink: "https://www.irs.gov/individuals/a?b=1&c=2" }));
  assert.match(html, /<a class="feed-link" href="https:\/\/www\.irs\.gov\/individuals\/a\?b=1&amp;c=2" target="_blank" rel="noopener">/);
  assert.doesNotMatch(renderFeedItem(feedItem()), /<a /);
  // The preview draws what is typed: anything but https is never a link.
  assert.doesNotMatch(renderUpdatePreview({ ...emptyUpdateForm(), irsLink: "javascript:alert(1)" }, {}), /<a |javascript/);
});

test("the panel ends with the footer and has no reply control", () => {
  const html = renderNotificationsPanel(panelState({ updates: [feedItem({ askConfirm: true })] }));
  assert.match(html, /Office admins relay IRS policy updates here\. Replies are turned off\./);
  assert.doesNotMatch(html, /<textarea|<input|<form|Reply/i);
});

test("an empty feed says No updates yet.", () => {
  const html = renderNotificationsPanel(panelState({ updates: [] }));
  assert.match(html, /No updates yet\./);
  assert.match(html, /Office admins relay IRS policy updates here/);
});

test("a failed refresh keeps the held items", () => {
  const html = renderNotificationsPanel(
    panelState({ updates: [feedItem()], lists: { updates: "failed" } }),
  );
  assert.match(html, /Sign this year&#39;s/);
  assert.match(html, /Couldn&#39;t refresh notifications\./);
});

test("a failed confirm is said inside the panel with Try again", () => {
  const html = dialog(
    panelState({ updates: [feedItem()], error: { code: "OFFLINE", message: "Network error." }, retryable: true }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /data-action="retry-action"/);
});

// ---------------------------------------------------------------------------
// The Post an update page: the form
// ---------------------------------------------------------------------------

test("the page has its overline, title and intro, and the Post an update link is current", () => {
  const html = staffScreen(adminState());
  assert.match(html, />OFFICE · ADMIN</);
  assert.match(html, /<h1>Post an update<\/h1>/);
  assert.match(html, /Post IRS policy updates and office notices to volunteers\. Replies are turned off\./);
  assert.match(html, /data-action="open-post-update" aria-current="page"/);
});

test("the new form has every field and the two buttons", () => {
  const html = renderPostUpdatePage(adminState());
  assert.match(html, /<h2 id="update-form-title">New update<\/h2>/);
  assert.match(html, /<form id="update-form"/);
  for (const text of [
    "Type",
    "IRS policy update",
    "Rules and guidance from the IRS, summarized by the office",
    "Office notice",
    "Hours, closures, supplies, shift changes",
    "Title",
    "Message",
    "Plain language works best. Volunteers read this in the Notifications panel and cannot reply.",
    "Link to the IRS source (optional)",
    "Who sees it",
    "All volunteers",
    "Chosen roles",
    "Keep at the top until",
    "Ask volunteers to confirm they have read it",
    "Adds an &quot;I&#39;ve read this&quot; button, and you can see who has confirmed.",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /<button type="submit" class="btn text" name="intent" value="draft"[^>]*>Save draft<\/button>/);
  assert.match(html, /<button type="submit" class="btn primary" name="intent" value="post"[^>]*>(?:<svg[\s\S]*?<\/svg>)? ?Post update<\/button>/);
  assert.doesNotMatch(html, /Save changes|Ask everyone to read it again|cancel-update-edit/);
});

test("the link field shows only for an IRS policy update", () => {
  const irs = renderPostUpdatePage(adminState());
  assert.match(irs, /<div class="update-link-field" id="update-link-field">/);
  const office = renderPostUpdatePage(adminState({ updateForm: { ...emptyUpdateForm(), kind: "office_notice" } }));
  assert.match(office, /<div class="update-link-field" id="update-link-field" hidden>/);
});

test("the role checkboxes show only for Chosen roles", () => {
  const everyone = renderPostUpdatePage(adminState());
  assert.match(everyone, /<div class="update-roles" id="update-roles" hidden>/);
  const chosen = renderPostUpdatePage(
    adminState({ updateForm: { ...emptyUpdateForm(), audience: "roles", roles: ["reviewer"] } }),
  );
  assert.match(chosen, /<div class="update-roles" id="update-roles">/);
  for (const role of ["Greeter", "Intaker", "Preparer", "Reviewer", "Admin"]) assert.ok(chosen.includes(`<span>${role}</span>`), role);
  assert.match(chosen, /id="update-role-reviewer" name="roles" value="reviewer" checked/);
  assert.doesNotMatch(chosen, /id="update-role-preparer" name="roles" value="preparer" checked/);
});

test("editing a posted update offers Ask everyone to read it again, Save changes and Cancel", () => {
  const html = renderPostUpdatePage(
    adminState({ updateForm: { ...emptyUpdateForm(), title: "x", askAgain: false }, updateEditing: { id: "r-1", revision: 2, status: "posted" } }),
  );
  assert.match(html, /<h2 id="update-form-title">Edit update<\/h2>/);
  assert.match(html, /Ask everyone to read it again/);
  assert.match(html, /Clears every read and confirmation, so everyone sees it as new\./);
  assert.match(html, /<button type="submit" class="btn primary" name="intent" value="post"[^>]*>Save changes<\/button>/);
  assert.doesNotMatch(html, />Save draft<|Post update<\/button>/);
  assert.match(html, /data-action="cancel-update-edit"[^>]*>Cancel<\/button>/);
});

test("editing a draft keeps Save draft and Post update, with Cancel, and no ask-again box", () => {
  const html = renderPostUpdatePage(adminState({ updateEditing: { id: "r-1", revision: 1, status: "draft" } }));
  assert.match(html, /Edit update/);
  assert.match(html, />Save draft</);
  assert.match(html, /Post update<\/button>/);
  assert.match(html, /cancel-update-edit/);
  assert.doesNotMatch(html, /Ask everyone to read it again|Save changes/);
});

test("field errors show next to their fields", () => {
  const html = renderPostUpdatePage(
    adminState({
      updateFormError: {
        title: "Enter a title of up to 120 characters.",
        message: "Enter a message of up to 2000 characters.",
        irsLink: "Use an https link on irs.gov.",
        roles: "Choose at least one role.",
        kind: "Choose a type.",
        form: "Please check the update and try again.",
      },
      updateForm: { ...emptyUpdateForm(), audience: "roles" },
    }),
  );
  assert.match(html, /id="update-title"[^>]*aria-invalid="true"[^>]*aria-describedby="update-title-error"/);
  assert.match(html, /<p class="field-error" id="update-title-error">Enter a title of up to 120 characters\.<\/p>/);
  assert.match(html, /<p class="field-error" id="update-message-error">Enter a message of up to 2000 characters\.<\/p>/);
  assert.match(html, /<p class="field-error" id="update-irsLink-error">Use an https link on irs\.gov\.<\/p>/);
  assert.match(html, /<p class="field-error" id="update-roles-error">Choose at least one role\.<\/p>/);
  assert.match(html, /<p class="field-error" id="update-kind-error">Choose a type\.<\/p>/);
  assert.match(html, /Please check the update and try again\./);
  // Each error comes right after its field.
  assert.ok(html.indexOf('id="update-title"') < html.indexOf('id="update-title-error"'));
  assert.ok(html.indexOf('id="update-title-error"') < html.indexOf('id="update-message"'));
  assert.ok(html.indexOf('id="update-irs-link"') < html.indexOf('id="update-irsLink-error"'));
  assert.ok(html.indexOf('id="update-irsLink-error"') < html.indexOf('id="update-keep"'));
});

test("the date input cannot go before today in New York", () => {
  const today = nowInput().slice(0, 10);
  const html = renderPostUpdatePage(adminState());
  assert.match(html, new RegExp(`<input type="date" id="update-keep" name="keepTopUntil" value="" min="${today}"`));
  // An edited update kept since a past day can still be saved as it is.
  const past = renderPostUpdatePage(adminState({ updateForm: { ...emptyUpdateForm(), keepTopUntil: "2020-01-02" } }));
  assert.match(past, /value="2020-01-02" min="2020-01-02"/);
});

test("the form holds what was typed", () => {
  const html = renderPostUpdatePage(
    adminState({ updateForm: { ...emptyUpdateForm(), kind: "office_notice", title: "Closed Friday", message: "Line one\nLine two", askConfirm: true } }),
  );
  assert.match(html, /id="update-kind-office_notice" name="kind" value="office_notice" checked/);
  assert.match(html, /id="update-title" name="title"[^>]*value="Closed Friday"/);
  assert.match(html, /<textarea id="update-message"[^>]*>Line one\nLine two<\/textarea>/);
  assert.match(html, /id="update-ask-confirm" name="askConfirm" checked/);
});

test("the form's values read back into the form shape", () => {
  const values = (entries) => ({
    get: (key) => entries.find(([k]) => k === key)?.[1] ?? null,
    getAll: (key) => entries.filter(([k]) => k === key).map(([, v]) => v),
  });
  assert.deepEqual(
    updateFormFromValues(values([["kind", "irs_policy"], ["title", " T "], ["message", "M"], ["irsLink", "https://irs.gov"], ["audience", "roles"], ["roles", "reviewer"], ["roles", "greeter"], ["keepTopUntil", "2030-01-01"], ["askConfirm", "on"]])),
    { kind: "irs_policy", title: " T ", message: "M", irsLink: "https://irs.gov", audience: "roles", roles: ["reviewer", "greeter"], keepTopUntil: "2030-01-01", askConfirm: true },
  );
  // A hidden link is not sent with an office notice; the box keeps it.
  const office = updateFormFromValues(values([["kind", "office_notice"], ["irsLink", "https://irs.gov"]]), { editing: true });
  assert.equal(office.irsLink, "");
  assert.equal(office.askConfirm, false);
  assert.equal(office.askAgain, false);
  assert.equal(office.audience, "everyone");
  assert.equal(updateFormFromValues(values([["askAgain", "on"]]), { editing: true }).askAgain, true);
  assert.equal("askAgain" in updateFormFromValues(values([["askAgain", "on"]])), false);
});

// ---------------------------------------------------------------------------
// The preview and the table
// ---------------------------------------------------------------------------

test("the preview shows the form's title and the Shown to line", () => {
  const html = renderPostUpdatePage(
    adminState({ updateForm: { ...emptyUpdateForm(), title: "Bring your badge", message: "See you Saturday." } }),
  );
  assert.match(html, /<h2 id="update-preview-title">Preview <small>as volunteers see it<\/small><\/h2>/);
  assert.match(html, /<div class="update-preview" id="update-preview"[^>]*>[\s\S]*Bring your badge[\s\S]*See you Saturday\./);
  assert.match(html, /Shown to: All volunteers</);
  const asks = renderUpdatePreview({ ...emptyUpdateForm(), audience: "roles", roles: ["admin", "greeter", "reviewer"], askConfirm: true }, { posterName: "Sam" });
  assert.match(asks, /Shown to: Greeters, Reviewers and Admins · asks them to confirm</);
  assert.match(asks, /I&#39;ve read this/);
  assert.doesNotMatch(asks, /data-action="confirm-update"/, "the preview's button does nothing");
  assert.match(asks, /Sam/);
});

test("the preview hides the link of an office notice", () => {
  const html = renderUpdatePreview({ ...emptyUpdateForm(), kind: "office_notice", irsLink: "https://www.irs.gov/x" }, {});
  assert.doesNotMatch(html, /feed-link/);
  assert.match(renderUpdatePreview({ ...emptyUpdateForm(), irsLink: "https://www.irs.gov/x" }, {}), /feed-link/);
});

const rowsOf = (html) => html.split('<tr class="update-row"').slice(1).map((part) => part.split("</tr>")[0]);

test("the table has its columns, counts with bars, and the footnote", () => {
  const html = renderPostUpdatePage(adminState());
  assert.match(html, /<h2 id="posted-updates-title" tabindex="-1">Posted updates<\/h2>/);
  const headers = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers, ["Update", "Type", "Posted", "Audience", "Read", "Confirmed", "Actions"]);
  const [one] = rowsOf(html);
  assert.match(one, /IRS policy/);
  assert.match(one, /Dec 2/);
  assert.match(one, /All volunteers/);
  assert.match(one, /data-action="open-update-people" data-id="r-1" aria-label="7 of 8 read"[^>]*>7\/8 <meter min="0" max="8" value="7"/);
  assert.match(one, /aria-label="6 of 8 confirmed"[^>]*>6\/8 <meter/);
  assert.match(html, /Read and confirmed counts show who has not seen an update yet, so you can remind them at the next shift\./);
});

test("Not asked when the update does not ask for confirmation", () => {
  const [one] = rowsOf(renderPostUpdatePage(adminState({ postedUpdates: [row({ askConfirm: false, kind: "office_notice", audience: "roles", roles: ["preparer", "reviewer"] })] })));
  assert.match(one, /Not asked/);
  assert.match(one, /Office/);
  assert.match(one, /Preparers and Reviewers/);
  assert.doesNotMatch(one, /confirmed"/);
});

test("each status has its own actions", () => {
  const html = renderPostUpdatePage(
    adminState({
      postedUpdates: [
        row({ id: "posted" }),
        row({ id: "draft", status: "draft", postedAt: null, postedByName: null, readCount: 0, confirmedCount: 0 }),
        row({ id: "gone", status: "unpublished", unpublishedAt: "2025-12-04T15:00:00Z" }),
      ],
    }),
  );
  const [posted, draft, gone] = rowsOf(html);
  const actions = (part) => [...part.matchAll(/data-action="((?:edit|post|open)-[a-z-]+)" data-id="[^"]+"/g)].map((m) => m[1]).filter((a) => a !== "open-update-people");
  assert.deepEqual(actions(posted), ["edit-update", "open-unpublish-update"]);
  assert.deepEqual(actions(draft), ["edit-update", "post-draft", "open-delete-update"]);
  assert.deepEqual(actions(gone), []);
  assert.match(posted, />Edit<\/button>/);
  assert.match(posted, />Unpublish<\/button>/);
  assert.match(draft, />Post<\/button>/);
  assert.match(draft, />Delete<\/button>/);
  assert.match(draft, /<span class="update-status draft">Draft<\/span>/);
  assert.match(gone, /<span class="update-status unpublished">Unpublished<\/span>/);
});

test("the table's empty, loading and failed states", () => {
  assert.match(renderPostUpdatePage(adminState({ postedUpdates: [] })), /No updates yet\. Posted updates and drafts appear here\./);
  assert.match(renderPostUpdatePage(adminState({ postedUpdates: [], lists: { postedUpdates: "loading" } })), /role="status"/);
  assert.match(renderPostUpdatePage(adminState({ postedUpdates: [], lists: { postedUpdates: "failed" } })), /couldn&#39;t load/);
});

test("the who dialog lists every audience member with dates or Not yet", () => {
  const html = dialog(adminState({ dialog: "update-people", dialogContext: { updateId: "r-1" } }));
  assert.match(html, /<h2 id="modal-title">Who has read “Sign this year&#39;s Volunteer Standards of Conduct”<\/h2>/);
  const body = renderUpdatePeople(row());
  const headers = [...body.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headers, ["Name", "Read", "Confirmed"]);
  assert.match(body, /Mira Patel<\/th><td>Dec 2<\/td><td>Dec 3<\/td>/);
  assert.match(body, /Noor Haddad<\/th><td>Not yet<\/td><td>Not yet<\/td>/);
  assert.match(renderUpdatePeople(row({ askConfirm: false })), /Noor Haddad<\/th><td>Not yet<\/td><td>Not asked<\/td>/);
});

test("the confirms name the update and send nothing until confirmed", () => {
  const unpublish = unpublishConfirm(row());
  assert.match(unpublish, /<p>Unpublish “Sign this year&#39;s Volunteer Standards of Conduct”\?<\/p>/);
  assert.match(unpublish, /Volunteers will no longer see it\. It stays in your table with its counts\./);
  assert.match(unpublish, /data-action="confirm-unpublish-update" data-id="r-1"[^>]*>Unpublish<\/button>/);
  assert.match(unpublish, /data-action="close-dialog"[^>]*>Keep it<\/button>/);
  const del = deleteDraftConfirm(row({ status: "draft" }));
  assert.match(del, /<p>Delete the draft “Sign this year&#39;s Volunteer Standards of Conduct”\?<\/p>/);
  assert.match(del, /Nobody has seen it\. This can&#39;t be undone\./);
  assert.match(del, /data-action="confirm-delete-update" data-id="r-1"[^>]*>Delete draft<\/button>/);
  assert.match(del, />Keep it<\/button>/);
  // Busy: the confirm waits.
  assert.match(unpublishConfirm(row(), { busy: true }), /data-action="confirm-unpublish-update" data-id="r-1" disabled/);
});

test("a confirm or who dialog for an update no longer in the table says so", () => {
  for (const name of ["unpublish-update", "delete-update", "update-people"]) {
    const html = dialog(adminState({ dialog: name, dialogContext: { updateId: "missing" }, postedUpdates: [] }));
    assert.match(html, /This update is no longer in the table\./, name);
    assert.doesNotMatch(html, /confirm-(unpublish|delete)-update/, name);
  }
});

// ---------------------------------------------------------------------------
// Review Focus 5: HTML and quotes in a title show as text everywhere
// ---------------------------------------------------------------------------

test("a title with HTML and quotes is escaped in the panel, preview, table, who dialog and both confirms", () => {
  const raw = /Office <closed>|"early"/;
  const panel = dialog(panelState({ updates: [feedItem({ title: NASTY, message: NASTY, postedByName: NASTY, irsLink: `https://www.irs.gov/"x"` })] }));
  const preview = renderUpdatePreview({ ...emptyUpdateForm(), title: NASTY, message: NASTY }, { posterName: NASTY });
  const page = staffScreen(adminState({ postedUpdates: [row({ title: NASTY })], updateForm: { ...emptyUpdateForm(), title: NASTY } }));
  const who = dialog(adminState({ dialog: "update-people", dialogContext: { updateId: "r-1" }, postedUpdates: [row({ title: NASTY, people: [{ personId: "p", name: NASTY, readAt: null, confirmedAt: null }] })] }));
  const unpublish = dialog(adminState({ dialog: "unpublish-update", dialogContext: { updateId: "r-1" }, postedUpdates: [row({ title: NASTY })] }));
  const del = dialog(adminState({ dialog: "delete-update", dialogContext: { updateId: "r-1" }, postedUpdates: [row({ title: NASTY, status: "draft" })] }));
  for (const [name, html] of Object.entries({ panel, preview, page, who, unpublish, del })) {
    assert.doesNotMatch(html, raw, name);
    assert.ok(html.includes(NASTY_ESCAPED), name);
  }
  assert.ok(page.includes(`value="${NASTY_ESCAPED}"`), "the title box");
  assert.ok(page.includes(`aria-label="Edit “${NASTY_ESCAPED}”"`), "a row action's name");
});

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

test("the toasts follow what was saved or done", () => {
  assert.deepEqual(UPDATE_TOASTS, {
    posted: "Update posted.",
    draft: "Draft saved.",
    changed: "Changes saved.",
    unpublished: "Update unpublished.",
    deleted: "Draft deleted.",
  });
  assert.equal(saveToast({ status: "posted" }, { id: "x", status: "posted" }), "Changes saved.");
  assert.equal(saveToast({ status: "posted" }, null), "Update posted.");
  assert.equal(saveToast({ status: "posted" }, { id: "x", status: "draft" }), "Update posted.");
  assert.equal(saveToast({ status: "draft" }, null), "Draft saved.");
  assert.equal(saveToast(null, null), null);
  assert.equal(actionToast("POST", { status: "posted" }), "Update posted.");
  assert.equal(actionToast("UNPUBLISH", { status: "whatever" }), "Update unpublished.");
  assert.equal(actionToast("DELETE", { status: "deleted" }), "Draft deleted.");
  assert.equal(actionToast("DELETE", null), null);
});

// ---------------------------------------------------------------------------
// app.mjs wiring, pinned at the source (it has no DOM harness)
// ---------------------------------------------------------------------------

test("app.mjs handles every posted-update action", () => {
  const app = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
  for (const action of [
    "open-notifications",
    "open-post-update",
    "confirm-update",
    "edit-update",
    "post-draft",
    "open-unpublish-update",
    "open-delete-update",
    "confirm-unpublish-update",
    "confirm-delete-update",
    "open-update-people",
    "cancel-update-edit",
  ])
    assert.match(app, new RegExp(`case "${action}"`), action);
  assert.match(app, /"open-post-update": \(\) => \{[\s\S]{0,120}controller\.navigate\("office-updates"\);[\s\S]{0,60}controller\.loadPostedUpdates\(\)/);
  assert.match(app, /form\.id === "update-form"/);
  assert.match(app, /controller\.openNotifications\(\)/);
  assert.match(app, /controller\.closeNotifications\(\)/);
  assert.match(app, /controller\.setUpdateForm\(/);
  assert.match(app, /#update-preview/);
});
