// The admin Workload (capability `volunteer-workload`): who holds which
// cases, what has stalled, the Unassigned list, and the Assign/Reassign
// drawer's candidates. Pure functions over the volunteers, the people and the
// staff case list; the view renders what these return.
import { waitingDays } from "./office-views.mjs";
import { clientLanguages } from "./intake-catalogue.mjs";

// The role capabilities, as the database grants them (volunteer-clearance).
export const ROLE_CAPABILITIES = Object.freeze({
  greeter: Object.freeze([]),
  intaker: Object.freeze(["receive_documents", "assist"]),
  preparer: Object.freeze(["prepare"]),
  reviewer: Object.freeze(["prepare", "review"]),
  admin: Object.freeze(["admin", "followup", "assist", "receive_documents"]),
});

// The union of the volunteer's roles' capabilities, within the person's
// roster ceiling (`people.capabilities`), as the database computes it.
export function effectiveCapabilities(volunteer, person) {
  const ceiling = new Set(person?.capabilities ?? []);
  const granted = new Set();
  for (const role of volunteer?.roles ?? []) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      if (ceiling.has(capability)) granted.add(capability);
    }
  }
  return [...granted];
}

export const STALLED_DAYS = 5;

const PREPARING_STAGES = Object.freeze(["preparing", "corrections_required"]);
const REVIEW_STAGES = Object.freeze(["reviewing"]);

const timeOf = (value) => {
  const at = Date.parse(value ?? "");
  return Number.isNaN(at) ? null : at;
};

// The later of the last accepted case action and the newest logged contact.
// `lastContactAt` is the logged time, so editing a contact is not activity.
export function lastActivity(record) {
  const updated = timeOf(record?.updatedAt);
  const contact = timeOf(record?.lastContactAt);
  if (updated === null && contact === null) return null;
  if (contact === null) return record.updatedAt;
  if (updated === null) return record.lastContactAt;
  return contact > updated ? record.lastContactAt : record.updatedAt;
}

export function isStalled(record, now = Date.now()) {
  const days = waitingDays(lastActivity(record), now);
  return days !== null && days >= STALLED_DAYS;
}

export function taxpayerName(answers) {
  const name = [answers?.tp_first_name, answers?.tp_last_name]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || "—";
}

const holdsWork = (capabilities) => capabilities.includes("prepare") || capabilities.includes("review");

const SLOT_NEEDS = Object.freeze({ preparer: "prepare", reviewer: "review" });

// One row per volunteer whose effective capabilities include prepare or review,
// and one for anyone else who still holds an open case: a volunteer whose role
// was removed (a certificate unticked, say), or a person no longer on this
// season's roster. Such a row has `roleRemoved`: it holds at least one case in
// a slot whose capability its person no longer has, so an admin can reassign it.
export function workloadRows({ volunteers = [], people = [], cases = [], now = Date.now() } = {}) {
  const personById = new Map(people.map((p) => [p.id, p]));
  const listed = new Set(volunteers.map((volunteer) => volunteer.id));
  // Holders of an open case who are not on the roster, as the people list names them.
  const unlisted = [];
  for (const record of cases) {
    for (const [id, stages] of [
      [record.preparerId, PREPARING_STAGES],
      [record.reviewerId, REVIEW_STAGES],
    ]) {
      if (!id || listed.has(id) || !stages.includes(record.stage)) continue;
      listed.add(id);
      unlisted.push({ id, name: personById.get(id)?.name ?? "Unknown person", roles: [], cleared: false });
    }
  }
  const rows = [];
  for (const volunteer of [...volunteers, ...unlisted]) {
    const capabilities = effectiveCapabilities(volunteer, personById.get(volunteer.id));
    const row = {
      id: volunteer.id,
      name: volunteer.name,
      cleared: volunteer.cleared === true,
      roleRemoved: false,
      preparing: 0,
      review: 0,
      open: 0,
      waiting: 0,
      stalled: 0,
      cases: [],
    };
    for (const record of cases) {
      let slot = null;
      if (record.preparerId === volunteer.id && PREPARING_STAGES.includes(record.stage)) slot = "preparer";
      else if (record.reviewerId === volunteer.id && REVIEW_STAGES.includes(record.stage)) slot = "reviewer";
      if (!slot) continue;
      const stalled = isStalled(record, now);
      const roleRemoved = !capabilities.includes(SLOT_NEEDS[slot]);
      if (slot === "preparer") {
        row.preparing += 1;
        if ((record.openRequests ?? 0) > 0) row.waiting += 1;
      } else {
        row.review += 1;
      }
      if (stalled) row.stalled += 1;
      if (roleRemoved) row.roleRemoved = true;
      row.cases.push({ record, slot, stalled, roleRemoved });
    }
    row.open = row.preparing + row.review;
    if (!holdsWork(capabilities) && row.open === 0) continue;
    rows.push(row);
  }
  return rows;
}

// Cases waiting for a preparer (Pending intake / filing) or a reviewer (Pending review).
export function unassignedCases(cases = []) {
  return {
    preparer: cases.filter((record) => record.stage === "preparation_ready" && !record.preparerId),
    reviewer: cases.filter((record) => record.stage === "review_ready" && !record.reviewerId),
  };
}

const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "en", { sensitivity: "base" });

// Highest Open first by default; ties by name. A copy: the input is untouched.
export function sortRows(rows, { key = "open", dir = "desc" } = {}) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    const diff = (a[key] ?? 0) - (b[key] ?? 0);
    return diff !== 0 ? sign * diff : byName(a, b);
  });
}

export function searchRows(rows, text) {
  const needle = String(text ?? "").trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => String(row.name ?? "").toLowerCase().includes(needle));
}

const normalised = (text) => (typeof text === "string" ? text.trim().toLowerCase() : "");

function speaks(volunteer, entry) {
  if (entry.code === "other") {
    const theirs = normalised(volunteer.otherLanguage);
    return theirs !== "" && theirs === normalised(entry.text);
  }
  return (volunteer.languages ?? []).includes(entry.code);
}

// 0: speaks the client's preferred language; 1: another the client speaks; 2: neither.
export function languageGroup(volunteer, clientEntries = []) {
  const [preferred, ...others] = clientEntries ?? [];
  if (!preferred) return 2;
  if (speaks(volunteer, preferred)) return 0;
  return others.some((entry) => speaks(volunteer, entry)) ? 1 : 2;
}

const SLOT_CAPABILITY = Object.freeze({ preparer: "prepare", reviewer: "review" });

// The drawer's list for one slot of one case. The current holder is listed
// (marked current); people left out only for independence are counted.
export function candidates({ record, slot, volunteers = [], people = [], rows = [] } = {}) {
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const openById = new Map((rows ?? []).map((row) => [row.id, row.open ?? 0]));
  const participants = record?.participants ?? [];
  const currentId = slot === "reviewer" ? record?.reviewerId : record?.preparerId;
  const capability = SLOT_CAPABILITY[slot];
  const entries = clientLanguages(record?.answers ?? {});
  const kept = [];
  let hiddenForIndependence = 0;
  for (const volunteer of volunteers ?? []) {
    const current = currentId != null && volunteer.id === currentId;
    if (!current) {
      if (volunteer.cleared !== true) continue;
      if (!effectiveCapabilities(volunteer, personById.get(volunteer.id)).includes(capability)) continue;
      const notIndependent =
        slot === "reviewer" ? participants.includes(volunteer.id) : volunteer.id === record?.reviewerId;
      if (notIndependent) {
        hiddenForIndependence += 1;
        continue;
      }
    }
    kept.push({
      group: languageGroup(volunteer, entries),
      entry: {
        id: volunteer.id,
        name: volunteer.name,
        languages: [...(volunteer.languages ?? [])],
        otherLanguage: volunteer.otherLanguage ?? null,
        roles: [...(volunteer.roles ?? [])],
        open: openById.get(volunteer.id) ?? 0,
        current,
      },
    });
  }
  kept.sort((a, b) => a.group - b.group || a.entry.open - b.entry.open || byName(a.entry, b.entry));
  return { list: kept.map((item) => item.entry), hiddenForIndependence };
}
