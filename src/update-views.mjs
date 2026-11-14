// Posted updates (change add-posted-updates): the Notifications panel every
// staff member reads, and the ceiling admin's Post an update screen with its
// live preview, its table, the who-has-read list and the two confirmations.
// Staff screens stay English. Every value from the database or the form is
// escaped here (Review Focus 5); `button` and `confirmBody` take HTML.
import { esc, icon, button, confirmBody, loadingLine, unloadedLine, emptyLine } from "./ui.mjs";
import { nowInput } from "./contact-log.mjs";
import {
  KINDS,
  KIND_LABELS,
  KIND_TAGS,
  ROLES,
  ROLE_LABELS,
  audienceLabel,
  emptyUpdateForm,
  isPinned,
} from "./posted-updates.mjs";

const when = (condition, html) => (condition ? html : "");

// The toasts after a landed save or action (Global Constraints, Exact copy).
export const UPDATE_TOASTS = Object.freeze({
  posted: "Update posted.",
  draft: "Draft saved.",
  changed: "Changes saved.",
  unpublished: "Update unpublished.",
  deleted: "Draft deleted.",
});

// A save's toast: an edit of a posted update says Changes saved; otherwise
// the receipt's status says what the save became. Null when nothing landed.
export function saveToast(receipt, editing) {
  if (!receipt) return null;
  if (editing?.status === "posted") return UPDATE_TOASTS.changed;
  return receipt.status === "posted" ? UPDATE_TOASTS.posted : UPDATE_TOASTS.draft;
}

// A table action's toast follows the type that was asked for.
const ACTION_TOASTS = Object.freeze({
  POST: UPDATE_TOASTS.posted,
  UNPUBLISH: UPDATE_TOASTS.unpublished,
  DELETE: UPDATE_TOASTS.deleted,
});
export function actionToast(type, receipt) {
  if (!receipt) return null;
  return ACTION_TOASTS[type] ?? null;
}

// "Dec 2": a calendar day in New York, whatever the machine's time zone.
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const shortDay = (value) => {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : DAY.format(at);
};
const today = () => nowInput().slice(0, 10);

// Which ids the item's controls name: database ids are uuids, but anything is
// escaped all the same.
const quoted = (title) => `“${esc(title)}”`;

const FOOTER = "Office admins relay IRS policy updates here. Replies are turned off.";
const footerLine = () => `<p class="feed-footer">${icon("lock")}<span>${esc(FOOTER)}</span></p>`;

// Unread, or asked to confirm and not confirmed: what the badge counts.
const needsAttention = (item) => item.readAt == null || (item.askConfirm === true && !item.confirmedAt);

/**
 * One update as volunteers see it. In the preview nothing is live: the
 * confirm button is a picture of one, and there is no read state. `fresh`:
 * unread when the panel opened (or arrived while it is open), so it stays
 * highlighted until the panel closes, though it was marked read at once.
 */
export function renderFeedItem(item = {}, { preview = false, fresh = false } = {}) {
  const id = String(item.id ?? "");
  const kind = KINDS.includes(item.kind) ? item.kind : "office_notice";
  const highlight = !preview && (fresh || needsAttention(item));
  const posted = preview ? "Just now" : shortDay(item.postedAt);
  const meta = `<div class="feed-meta"><span class="feed-poster">${esc(item.postedByName ?? "")}</span><span class="feed-kind kind-${kind}">${esc(
    KIND_LABELS[kind],
  )}</span>${when(item.pinned, `<span class="feed-flag feed-pinned">${icon("pin")}<span>Pinned</span></span>`)}${when(
    item.edited,
    `<span class="feed-flag feed-edited">Edited</span>`,
  )}<span class="feed-date">${esc(posted)}</span></div>`;
  const title = String(item.title ?? "");
  const message = String(item.message ?? "");
  const heading = preview && !title.trim()
    ? `<h3 class="feed-title muted">The title appears here.</h3>`
    : `<h3 class="feed-title">${esc(title)}</h3>`;
  const body = preview && !message.trim()
    ? `<p class="feed-message muted">The message appears here.</p>`
    : `<p class="feed-message">${esc(message)}</p>`;
  // Only an https link is ever drawn: the database allows nothing else, and
  // the preview draws what is typed before any check.
  const link = /^https:\/\//i.test(String(item.irsLink ?? ""))
    ? `<a class="feed-link" href="${esc(item.irsLink)}" target="_blank" rel="noopener">${icon("arrow")}<span>Read the IRS source</span></a>`
    : "";
  let confirm = "";
  if (item.askConfirm === true) {
    if (preview) confirm = `<span class="btn secondary feed-confirm" aria-hidden="true">${esc("I've read this")}</span>`;
    else if (item.confirmedAt)
      confirm = `<p class="feed-confirmed" id="feed-confirmed-${esc(id)}" tabindex="-1">${icon("check")}<span>Confirmed ${esc(
        shortDay(item.confirmedAt),
      )}</span></p>`;
    else
      confirm = button(
        esc("I've read this"),
        "confirm-update",
        "secondary feed-confirm",
        `data-id="${esc(id)}" aria-label="${esc(`I've read “${title}”`)}"`,
      );
  }
  // The link and the button side by side, wrapping on a narrow screen.
  const actions = link || confirm ? `<div class="feed-actions">${link}${confirm}</div>` : "";
  return `<article class="feed-item${highlight ? " is-unread" : ""}" data-update-id="${esc(id)}">${meta}${heading}${body}${actions}</article>`;
}

/**
 * The Notifications panel's body: the feed as held, newest pinned first (the
 * order the database gives), and the footer. A failed refresh keeps the items.
 */
export function renderNotificationsPanel(state = {}) {
  const items = Array.isArray(state.updates) ? state.updates : [];
  const list = state.lists?.updates ?? "ready";
  const failed = list === "failed"
    ? `<p class="feed-stale">${icon("help")}<span>${esc("Couldn't refresh notifications.")}</span></p>`
    : "";
  let body;
  const fresh = new Set(Array.isArray(state.notificationsFresh) ? state.notificationsFresh : []);
  if (items.length)
    body = `<div class="feed-list">${items.map((item) => renderFeedItem(item, { fresh: fresh.has(item.id) })).join("")}</div>`;
  else if (list === "loading") body = loadingLine("Loading notifications…");
  else if (list === "failed") body = "";
  else body = `<p class="feed-empty">No updates yet.</p>`;
  return `${failed}${body}${footerLine()}`;
}

// ---------------------------------------------------------------------------
// Post an update: the form
// ---------------------------------------------------------------------------

/**
 * The form's values as the controller holds them (`emptyUpdateForm()`'s
 * shape, plus `askAgain` while editing). `values` is a FormData or anything
 * with `get` and `getAll`. The link of an office notice is hidden, not sent.
 */
export function updateFormFromValues(values, { editing = false } = {}) {
  const text = (key) => String(values.get(key) ?? "");
  const kind = text("kind");
  const form = {
    kind,
    title: text("title"),
    message: text("message"),
    irsLink: kind === "irs_policy" ? text("irsLink") : "",
    audience: text("audience") === "roles" ? "roles" : "everyone",
    roles: values.getAll("roles").map(String),
    keepTopUntil: text("keepTopUntil"),
    askConfirm: values.get("askConfirm") != null,
  };
  if (editing) form.askAgain = values.get("askAgain") != null;
  return form;
}

const fieldError = (errors, field) =>
  errors?.[field] ? `<p class="field-error" id="update-${field}-error">${esc(errors[field])}</p>` : "";
const invalid = (errors, field, describedBy = "") => {
  const ids = [describedBy, errors?.[field] ? `update-${field}-error` : ""].filter(Boolean).join(" ");
  return `${errors?.[field] ? ' aria-invalid="true"' : ""}${ids ? ` aria-describedby="${ids}"` : ""}`;
};

const KIND_HINTS = Object.freeze({
  irs_policy: "Rules and guidance from the IRS, summarized by the office",
  office_notice: "Hours, closures, supplies, shift changes",
});

function kindChoices(form, errors) {
  const choices = KINDS.map((kind) => {
    const id = `update-kind-${kind}`;
    return `<label class="update-choice" for="${id}"><input type="radio" id="${id}" name="kind" value="${kind}"${
      form.kind === kind ? " checked" : ""
    }><span><strong>${esc(KIND_LABELS[kind])}</strong><small>${esc(KIND_HINTS[kind])}</small></span></label>`;
  }).join("");
  const described = errors?.kind ? ' aria-describedby="update-kind-error"' : "";
  return `<fieldset class="update-kinds"${described}><legend>Type</legend><div class="update-choices">${choices}</div>${fieldError(
    errors,
    "kind",
  )}</fieldset>`;
}

function audienceChoices(form, errors) {
  const radios = [
    ["everyone", "All volunteers"],
    ["roles", "Chosen roles"],
  ]
    .map(([value, text]) => {
      const id = `update-audience-${value}`;
      return `<label class="checkbox-row small" for="${id}"><input type="radio" id="${id}" name="audience" value="${value}"${
        form.audience === value ? " checked" : ""
      }><span>${esc(text)}</span></label>`;
    })
    .join("");
  const chosen = Array.isArray(form.roles) ? form.roles : [];
  const roles = ROLES.map((role) => {
    const id = `update-role-${role}`;
    return `<label class="checkbox-row small" for="${id}"><input type="checkbox" id="${id}" name="roles" value="${role}"${
      chosen.includes(role) ? " checked" : ""
    }><span>${esc(ROLE_LABELS[role])}</span></label>`;
  }).join("");
  return `<fieldset class="update-audience"><legend>Who sees it</legend><div class="update-audience-choices">${radios}</div><div class="update-roles" id="update-roles"${
    form.audience === "roles" ? "" : " hidden"
  }>${roles}</div>${fieldError(errors, "roles")}</fieldset>`;
}

const checkRow = (id, name, on, title, hint) =>
  `<label class="update-check" for="${id}"><input type="checkbox" id="${id}" name="${name}"${on ? " checked" : ""}><span><strong>${esc(
    title,
  )}</strong><small>${esc(hint)}</small></span></label>`;

function updateForm(state) {
  const form = { ...emptyUpdateForm(), ...(state.updateForm ?? {}) };
  const errors = state.updateFormError ?? null;
  const editing = state.updateEditing ?? null;
  const editingPosted = editing?.status === "posted";
  const busy = state.busy ? " disabled" : "";
  const keep = String(form.keepTopUntil ?? "");
  // Never before today, but an update kept since an earlier day still saves.
  const min = keep && keep < today() ? keep : today();
  const formError = errors?.form
    ? `<p class="notice error" role="alert" id="update-form-error">${icon("help")}<span>${esc(errors.form)}</span></p>`
    : "";
  const fields = `${kindChoices(form, errors)}<label class="field" for="update-title"><span>Title</span><input type="text" id="update-title" name="title" maxlength="120" autocomplete="off" value="${esc(
    form.title,
  )}"${invalid(errors, "title")}></label>${fieldError(errors, "title")}<label class="field" for="update-message"><span>Message</span><textarea id="update-message" name="message" rows="5" maxlength="2000"${invalid(
    errors,
    "message",
    "update-message-note",
  )}>${esc(form.message)}</textarea></label><p class="field-note" id="update-message-note">Plain language works best. Volunteers read this in the Notifications panel and cannot reply.</p>${fieldError(
    errors,
    "message",
  )}<div class="update-link-field" id="update-link-field"${form.kind === "irs_policy" ? "" : " hidden"}><label class="field" for="update-irs-link"><span>Link to the IRS source (optional)</span><input type="url" id="update-irs-link" name="irsLink" maxlength="500" autocomplete="off" placeholder="https://www.irs.gov/…" value="${esc(
    form.irsLink,
  )}"${invalid(errors, "irsLink")}></label>${fieldError(errors, "irsLink")}</div><div class="update-row-fields">${audienceChoices(
    form,
    errors,
  )}<div><label class="field" for="update-keep"><span>Keep at the top until</span><input type="date" id="update-keep" name="keepTopUntil" value="${esc(
    keep,
  )}" min="${esc(min)}"${invalid(errors, "keepTopUntil")}></label>${fieldError(errors, "keepTopUntil")}</div></div>${checkRow(
    "update-ask-confirm",
    "askConfirm",
    form.askConfirm === true,
    "Ask volunteers to confirm they have read it",
    `Adds an "I've read this" button, and you can see who has confirmed.`,
  )}${when(
    editingPosted,
    checkRow(
      "update-ask-again",
      "askAgain",
      form.askAgain === true,
      "Ask everyone to read it again",
      "Clears every read and confirmation, so everyone sees it as new.",
    ),
  )}`;
  const submits = editingPosted
    ? `<button type="submit" class="btn primary" name="intent" value="post"${busy}>Save changes</button>`
    : `<button type="submit" class="btn text" name="intent" value="draft"${busy}>Save draft</button><button type="submit" class="btn primary" name="intent" value="post"${busy}>${icon(
        "megaphone",
      )} Post update</button>`;
  const actions = `<div class="update-actions">${when(editing, button("Cancel", "cancel-update-edit", "text"))}${submits}</div>`;
  return `<section class="panel update-form-panel" aria-labelledby="update-form-title"><h2 id="update-form-title">${
    editing ? "Edit update" : "New update"
  }</h2><form id="update-form" class="update-form" novalidate>${formError}${fields}${actions}</form></section>`;
}

/**
 * The preview's contents, drawn from the form as typed. app.mjs redraws only
 * this container while somebody types (`#update-preview`).
 */
export function renderUpdatePreview(form = {}, { posterName = "" } = {}) {
  const f = { ...emptyUpdateForm(), ...form };
  const item = {
    id: "preview",
    kind: f.kind,
    title: f.title,
    message: f.message,
    irsLink: f.kind === "irs_policy" && String(f.irsLink ?? "").trim() ? String(f.irsLink).trim() : null,
    postedByName: posterName,
    edited: false,
    pinned: isPinned(f.keepTopUntil, today()),
    askConfirm: f.askConfirm === true,
    readAt: null,
    confirmedAt: null,
  };
  const shownTo = `Shown to: ${audienceLabel(f)}${f.askConfirm === true ? " · asks them to confirm" : ""}`;
  return `<div class="feed-sample"><p class="feed-sample-head">Notifications</p>${renderFeedItem(item, { preview: true })}${footerLine()}</div><p class="update-shown-to">${esc(
    shownTo,
  )}</p>`;
}

const posterOf = (state) => {
  const own = (state.people ?? []).find((person) => person?.id === state.principal?.personId);
  return own?.name ?? state.principal?.personName ?? "";
};

function previewPanel(state) {
  return `<section class="panel update-preview-panel" aria-labelledby="update-preview-title"><h2 id="update-preview-title">Preview <small>as volunteers see it</small></h2><div class="update-preview" id="update-preview" aria-live="off">${renderUpdatePreview(
    state.updateForm ?? emptyUpdateForm(),
    { posterName: posterOf(state) },
  )}</div></section>`;
}

// ---------------------------------------------------------------------------
// Post an update: the table
// ---------------------------------------------------------------------------

function countCell(update, count, word) {
  const size = Math.max(0, Number(update.audienceSize) || 0);
  const value = Math.min(Math.max(0, Number(count) || 0), size);
  return button(
    `${value}/${size} <meter min="0" max="${size}" value="${value}"></meter>`,
    "open-update-people",
    "update-count",
    `data-id="${esc(update.id)}" aria-label="${value} of ${size} ${word}"`,
  );
}

function postedCell(update) {
  if (update.status === "draft") return `<span class="update-status draft">Draft</span>`;
  const day = esc(shortDay(update.postedAt));
  if (update.status === "unpublished") return `${day} <span class="update-status unpublished">Unpublished</span>`;
  return day;
}

function rowActions(update) {
  const named = (verb) => `data-id="${esc(update.id)}" aria-label="${esc(verb)} “${esc(update.title)}”"`;
  if (update.status === "posted")
    return `${button("Edit", "edit-update", "text", named("Edit"))}${button("Unpublish", "open-unpublish-update", "text", named("Unpublish"))}`;
  if (update.status === "draft")
    return `${button("Edit", "edit-update", "text", named("Edit"))}${button("Post", "post-draft", "text", named("Post"))}${button(
      "Delete",
      "open-delete-update",
      "text",
      named("Delete"),
    )}`;
  return "";
}

function updateRow(update) {
  const draft = update.status === "draft";
  const kind = KINDS.includes(update.kind) ? update.kind : "office_notice";
  const read = draft ? `<span class="muted">—</span>` : countCell(update, update.readCount, "read");
  const confirmed = update.askConfirm !== true
    ? `<span class="muted">Not asked</span>`
    : draft
      ? `<span class="muted">—</span>`
      : countCell(update, update.confirmedCount, "confirmed");
  return `<tr class="update-row" data-update-id="${esc(update.id)}"><th scope="row"><span class="update-row-title">${esc(
    update.title,
  )}</span></th><td><span class="update-tag kind-${kind}">${esc(KIND_TAGS[kind])}</span></td><td>${postedCell(update)}</td><td class="update-audience-cell">${esc(
    audienceLabel(update),
  )}</td><td>${read}</td><td>${confirmed}</td><td><div class="update-row-actions">${rowActions(update)}</div></td></tr>`;
}

function postedTable(state) {
  const list = state.lists?.postedUpdates ?? "ready";
  const rows = Array.isArray(state.postedUpdates) ? state.postedUpdates : [];
  const open = `<section class="panel posted-updates" aria-labelledby="posted-updates-title"><h2 id="posted-updates-title" tabindex="-1">Posted updates</h2>`;
  let body;
  if (!rows.length && list === "loading") body = loadingLine("Loading updates…");
  else if (!rows.length && list === "failed") body = unloadedLine("The updates couldn't load.");
  else if (!rows.length) body = emptyLine(esc("No updates yet. Posted updates and drafts appear here."));
  else
    body = `<div class="board-table-wrap"><table class="board-table updates-table"><thead><tr><th scope="col">Update</th><th scope="col">Type</th><th scope="col">Posted</th><th scope="col">Audience</th><th scope="col">Read</th><th scope="col">Confirmed</th><th scope="col">Actions</th></tr></thead><tbody>${rows
      .map(updateRow)
      .join("")}</tbody></table></div>`;
  return `${open}${body}<p class="board-foot">Read and confirmed counts show who has not seen an update yet, so you can remind them at the next shift.</p></section>`;
}

/** The Post an update screen's body: the form beside its preview, then the table. */
export function renderPostUpdatePage(state = {}) {
  return `<div class="update-layout">${updateForm(state)}${previewPanel(state)}</div>${postedTable(state)}`;
}

// ---------------------------------------------------------------------------
// The who-has-read list and the two confirmations
// ---------------------------------------------------------------------------

export const UPDATE_GONE = "This update is no longer in the table.";
export const updateGoneBody = () => `<p>${esc(UPDATE_GONE)}</p>${button("Close", "close-dialog", "secondary")}`;

/** Every audience member with their read and confirmed dates, or Not yet. */
export function renderUpdatePeople(update = {}) {
  const people = Array.isArray(update.people) ? update.people : [];
  const asked = update.askConfirm === true;
  if (!people.length) return `<p class="muted">Nobody is in this update's audience yet.</p>`;
  const rows = people
    .map(
      (person) =>
        `<tr><th scope="row">${esc(person.name)}</th><td>${esc(person.readAt ? shortDay(person.readAt) : "Not yet")}</td><td>${esc(
          !asked ? "Not asked" : person.confirmedAt ? shortDay(person.confirmedAt) : "Not yet",
        )}</td></tr>`,
    )
    .join("");
  return `<div class="board-table-wrap"><table class="board-table update-people"><thead><tr><th scope="col">Name</th><th scope="col">Read</th><th scope="col">Confirmed</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function unpublishConfirm(update = {}, { busy = false } = {}) {
  return confirmBody({
    lead: `Unpublish ${quoted(update.title)}?`,
    note: { icon: "help", html: esc("Volunteers will no longer see it. It stays in your table with its counts.") },
    confirm: button("Unpublish", "confirm-unpublish-update", "primary full", `data-id="${esc(update.id)}"${busy ? " disabled" : ""}`),
    keep: "Keep it",
  });
}

export function deleteDraftConfirm(update = {}, { busy = false } = {}) {
  return confirmBody({
    lead: `Delete the draft ${quoted(update.title)}?`,
    note: { icon: "help", html: esc("Nobody has seen it. This can't be undone.") },
    confirm: button("Delete draft", "confirm-delete-update", "primary full", `data-id="${esc(update.id)}"${busy ? " disabled" : ""}`),
    keep: "Keep it",
  });
}
