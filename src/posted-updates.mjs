// Pure rules for posted updates: kinds, audiences, validation, request shaping, badge and pinning.
export const KINDS = ["irs_policy", "office_notice"];
export const KIND_LABELS = { irs_policy: "IRS policy update", office_notice: "Office notice" };
export const KIND_TAGS = { irs_policy: "IRS policy", office_notice: "Office" };
export const ROLES = ["greeter", "intaker", "preparer", "reviewer", "admin"];
export const ROLE_LABELS = { greeter: "Greeter", intaker: "Intaker", preparer: "Preparer", reviewer: "Reviewer", admin: "Admin" };
export const ROLE_PLURALS = { greeter: "Greeters", intaker: "Intakers", preparer: "Preparers", reviewer: "Reviewers", admin: "Admins" };

const TITLE_MAX = 120;
const MESSAGE_MAX = 2000;
const LINK_MAX = 500;

function orderedRoles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  return ROLES.filter((role) => list.includes(role));
}

export function audienceLabel({ audience, roles } = {}) {
  if (audience !== "roles") return "All volunteers";
  const names = orderedRoles(roles).map((role) => ROLE_PLURALS[role]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function emptyUpdateForm() {
  return {
    kind: "irs_policy",
    title: "",
    message: "",
    irsLink: "",
    audience: "everyone",
    roles: [],
    keepTopUntil: "",
    askConfirm: false
  };
}

// The database regex, applied to the raw text: https, irs.gov or a subdomain, at most 500 characters.
const IRS_LINK = /^https:\/\/([a-z0-9-]+\.)*irs\.gov(\/\S*)?$/i;
function isIrsLink(text) {
  return text.length <= LINK_MAX && IRS_LINK.test(text);
}

export function validateUpdate(form = {}) {
  const errors = {};
  const title = String(form.title ?? "").trim();
  const message = String(form.message ?? "").trim();
  const link = String(form.irsLink ?? "").trim();
  if (!KINDS.includes(form.kind)) errors.kind = "Choose a type.";
  if (title.length < 1 || title.length > TITLE_MAX) errors.title = "Enter a title of up to 120 characters.";
  if (message.length < 1 || message.length > MESSAGE_MAX) errors.message = "Enter a message of up to 2000 characters.";
  if (link) {
    if (form.kind === "office_notice") errors.irsLink = "Only IRS policy updates link to the IRS.";
    else if (!isIrsLink(link)) errors.irsLink = "Use an https link on irs.gov.";
  }
  if (form.audience === "roles" && orderedRoles(form.roles).length === 0) errors.roles = "Choose at least one role.";
  const keep = String(form.keepTopUntil ?? "").trim();
  if (keep && !/^\d{4}-\d{2}-\d{2}$/.test(keep)) errors.keepTopUntil = "Enter a valid date.";
  return Object.keys(errors).length ? errors : null;
}

// Always the ten keys vitally_save_update requires, no more and no fewer.
export function toUpdateRequest(form = {}, { post = false, askAgain = false } = {}) {
  const everyone = form.audience !== "roles";
  const link = String(form.irsLink ?? "").trim();
  const keep = String(form.keepTopUntil ?? "").trim();
  return {
    kind: form.kind,
    title: String(form.title ?? "").trim(),
    message: String(form.message ?? "").trim(),
    irsLink: form.kind === "office_notice" || !link ? null : link,
    audience: everyone ? "everyone" : "roles",
    roles: everyone ? [] : orderedRoles(form.roles),
    keepTopUntil: keep || null,
    askConfirm: Boolean(form.askConfirm),
    post: Boolean(post),
    askAgain: Boolean(askAgain)
  };
}

export function badgeCount(items) {
  return (items ?? []).filter((item) => !item.readAt || (item.askConfirm && !item.confirmedAt)).length;
}

export function isPinned(keepTopUntil, today) {
  return Boolean(keepTopUntil) && String(keepTopUntil) >= String(today);
}
