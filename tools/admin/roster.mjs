// Admits an exact list of approved email addresses to one workspace.
//
//   node --env-file=.env.test  tools/admin/roster.mjs --target test      --roster .vitally-roster.json
//   node --env-file=.env.admin tools/admin/roster.mjs --target classroom --roster .vitally-roster.json
//
// Every address becomes a confirmed Auth account with no password (the app
// signs in with one-time codes only), then the shared initializer grants each
// account staff or applicant access. The target is approved by the same
// fail-closed guards as every other privileged tool before anything is read.
// Re-running with a longer roster adds the new people; nobody is removed.
// Addresses are never printed: errors name a roster position instead.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { EMAIL_PATTERN } from "../../src/auth.mjs";
import { assertTarget } from "./database.mjs";
import { initializeWorkspace } from "./workspace-setup.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIST_PAGE_SIZE = 1000;

const failure = (code, message) =>
  Object.assign(new Error(message), { code });
const invalid = (message) => failure("ROSTER_INVALID", message);

function addresses(raw, field, { required = false } = {}) {
  if (raw === undefined && !required) return [];
  if (!Array.isArray(raw)) throw invalid(`${field} must be a list of email addresses.`);
  return raw.map((value, index) => {
    const address = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (address.length > 254 || !EMAIL_PATTERN.test(address))
      throw invalid(`${field}[${index}] is not an email address.`);
    return address;
  });
}

// Mirrors vitally_private.add_staff_member (latest in migration 042) so the operator gets
// a clear message before any account is created; the database refuses them again.
export const STAFF_CAPABILITIES = Object.freeze([
  "prepare",
  "review",
  "admin",
  "followup",
  "receive_documents",
  "assist",
]);
const PERSON_KEY = /^[a-z][a-z0-9_]{0,39}$/;

function parseStaff(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw invalid("staff must be a list of staff entries.");
  const keys = new Set();
  return raw.map((entry, index) => {
    const where = `staff[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw invalid(`${where} must be an object with email, name, personKey and capabilities.`);
    const [email] = addresses([entry.email], where);
    const { personKey, name, capabilities } = entry;
    if (
      typeof personKey !== "string" ||
      !PERSON_KEY.test(personKey)
    )
      throw invalid(
        `${where}.personKey must be lower-case letters, digits and underscores, start with a letter ` +
          `and be at most 40 characters.`,
      );
    if (typeof name !== "string" || name.length < 1 || name.length > 80)
      throw invalid(`${where}.name must be 1 to 80 characters.`);
    if (
      !Array.isArray(capabilities) ||
      capabilities.length === 0 ||
      capabilities.some((capability) => !STAFF_CAPABILITIES.includes(capability))
    )
      throw invalid(
        `${where}.capabilities must be a non-empty list of: ${STAFF_CAPABILITIES.join(", ")}.`,
      );
    if (capabilities.includes("followup") && !capabilities.includes("admin"))
      throw invalid(`${where}.capabilities must include admin when they include followup.`);
    if (keys.has(personKey)) throw invalid(`${where}.personKey is already on the roster.`);
    keys.add(personKey);
    return { email, name, personKey, capabilities: [...new Set(capabilities)] };
  });
}

function parseDefaultFollowup(raw, staff) {
  const member = typeof raw === "string" ? staff.find((entry) => entry.personKey === raw) : undefined;
  if (!member)
    throw invalid("defaultFollowup must name the personKey of a staff entry on this roster.");
  if (!member.capabilities.includes("followup"))
    throw invalid("defaultFollowup must name a staff entry that has the followup capability.");
  return raw;
}

export function parseRoster(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw invalid("The roster must be a JSON object.");
  if (typeof raw.workspaceId !== "string" || !UUID.test(raw.workspaceId))
    throw invalid(
      "workspaceId must be a lower-case UUID. Generate one once and keep it: node -e \"console.log(crypto.randomUUID())\"",
    );
  const applicants = addresses(raw.applicants, "applicants");
  const staff = parseStaff(raw.staff);
  if (staff.length === 0) throw invalid("The roster needs at least one staff member.");
  const defaultFollowup = parseDefaultFollowup(raw.defaultFollowup, staff);
  const seen = new Set();
  for (const [field, list] of [
    ["staff", staff.map((member) => member.email)],
    ["applicants", applicants],
  ])
    list.forEach((address, index) => {
      if (seen.has(address))
        throw invalid(`${field}[${index}] is already on the roster.`);
      seen.add(address);
    });
  return {
    workspaceId: raw.workspaceId,
    applicants,
    staff,
    defaultFollowup,
  };
}

export function rosterNotes(raw) {
  const notes = [];
  if (raw && typeof raw === "object") {
    if ("sampleCaseOwners" in raw)
      notes.push("sampleCaseOwners is no longer used and was ignored.");
    if ("presenters" in raw)
      notes.push("presenters is no longer used and was ignored; those addresses get no access.");
  }
  return notes;
}

export function parseRosterArgs(argv) {
  const usage = () =>
    failure(
      "ROSTER_USAGE",
      "Usage: roster.mjs --target test|classroom --roster <file.json>",
    );
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!["--target", "--roster"].includes(flag) || value === undefined || flag in options)
      throw usage();
    options[flag] = value;
  }
  if (!["test", "classroom"].includes(options["--target"]) || !options["--roster"])
    throw usage();
  return { target: { kind: options["--target"] }, rosterPath: options["--roster"] };
}

async function existingAccounts(admin, perPage) {
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw failure("ROSTER_ACCOUNT_FAILED", "Existing accounts could not be listed.");
    const users = data?.users ?? [];
    for (const user of users)
      if (user.email) byEmail.set(user.email.toLowerCase(), user);
    if (users.length < perPage) return byEmail;
  }
}

export async function applyRoster(
  roster,
  { admin, initialize, perPage = LIST_PAGE_SIZE },
) {
  const accounts = await existingAccounts(admin, perPage);
  const ids = new Map();
  let created = 0,
    confirmed = 0;
  for (const [field, list] of [
    ["staff", roster.staff.map((member) => member.email)],
    ["applicants", roster.applicants],
  ])
    for (const [index, address] of list.entries()) {
      const where = `${field}[${index}]`;
      const account = accounts.get(address);
      if (!account) {
        const { data, error } = await admin.auth.admin.createUser({
          email: address,
          email_confirm: true,
        });
        if (error || !data?.user?.id)
          throw failure("ROSTER_ACCOUNT_FAILED", `The account for ${where} could not be created.`);
        ids.set(address, data.user.id);
        created += 1;
        continue;
      }
      if (!account.email_confirmed_at) {
        const { error } = await admin.auth.admin.updateUserById(account.id, {
          email_confirm: true,
        });
        if (error)
          throw failure("ROSTER_ACCOUNT_FAILED", `The account for ${where} could not be confirmed.`);
        confirmed += 1;
      }
      ids.set(address, account.id);
    }
  await initialize({
    workspaceId: roster.workspaceId,
    applicantUserIds: roster.applicants.map((address) => ids.get(address)),
    staff: roster.staff.map(({ email, personKey, name, capabilities }) => ({
      userId: ids.get(email),
      personKey,
      name,
      capabilities,
    })),
    defaultFollowup: roster.defaultFollowup,
  });
  return {
    workspaceId: roster.workspaceId,
    applicants: roster.applicants.length,
    staff: roster.staff.length,
    created,
    confirmed,
  };
}

const HINTS = {
  ROSTER_USAGE: "",
  ROSTER_INVALID: "",
  ROSTER_UNREADABLE: "",
  TARGET_REJECTED: " Check the target's env file and .vitally-targets.json (docs/setup.md).",
  VALIDATION:
    " The workspace refused the roster: someone may already belong to another workspace, or appear here with the other role, or a staff key may already belong to a kept persona.",
};

async function main() {
  const { target, rosterPath } = parseRosterArgs(process.argv.slice(2));
  let raw;
  try {
    raw = JSON.parse(await readFile(rosterPath, "utf8"));
  } catch {
    throw failure("ROSTER_UNREADABLE", "The roster file could not be read as JSON.");
  }
  const roster = parseRoster(raw);
  for (const note of rosterNotes(raw)) console.log(note);
  const approved = await assertTarget(target);
  const admin = createClient(approved.apiUrl, approved.adminKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await applyRoster(roster, {
    admin,
    initialize: (setup) => initializeWorkspace({ ...setup, target }),
  });
  console.log(
    `Roster applied to workspace ${result.workspaceId} on the ${target.kind} target: ` +
      `${result.staff} staff, ${result.applicants} applicant(s); ` +
      `${result.created} account(s) created, ${result.confirmed} confirmed.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    const code = error.code || "SERVER_ERROR";
    const detail = code.startsWith("ROSTER_") ? ` ${error.message}` : "";
    console.error(`Roster failed (${code}).${detail}${HINTS[code] ?? ""}`);
    process.exitCode = 1;
  });
