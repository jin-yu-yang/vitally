// The Schedule (change add-volunteer-schedule, design D7): one day at a time,
// a row per volunteer with a shift that day, a column per open hour. A
// workspace admin (the read's own `canEdit`) gets the flag tags, the coverage
// row, "+ Add shift" and a button on every shift; anyone else reads names,
// roles and hours. Staff text, English only. Pure: `state.schedule.day` is the
// `vitally_schedule_day` answer.
import { esc, button, confirmBody, loadingLine, unloadedLine } from "./ui.mjs";
import {
  ROLE_LABELS,
  hourLabel,
  dayLabel,
  weekdayPlural,
  coverageRows,
  gapHeader,
  orderCandidates,
  scheduleRows,
} from "./volunteer-schedule.mjs";

// Why a shift doesn't count, in the order the database gives them.
export const FLAG_TAGS = Object.freeze({
  notCleared: "Not cleared",
  noSignIn: "No sign-in",
  roleRemoved: "Role removed",
  outsideSiteHours: "Outside site hours",
});

const roleLabel = (role) => ROLE_LABELS[role] ?? String(role ?? "");
const hoursText = (start, end) => `${hourLabel(start)} – ${hourLabel(end)}`;
const disabled = (busy) => (busy ? " disabled" : "");

const flagTags = (shift) => Object.keys(FLAG_TAGS).filter((flag) => (shift?.flags ?? []).includes(flag)).map((flag) => FLAG_TAGS[flag]);
const tagList = (tags) =>
  tags.length ? `<span class="schedule-tags">${tags.map((tag) => `<span class="badge amber">${esc(tag)}</span>`).join("")}</span>` : "";

/** What a shift button says to a screen reader: "Rowan Diaz, Preparer, 10 am to 1 pm" (then its tags). */
export const shiftLabel = (shift, tags = []) =>
  [shift.name, roleLabel(shift.role), `${hourLabel(shift.startHour)} to ${hourLabel(shift.endHour)}`, ...tags].join(", ");

// The grid's column for an hour: the names take the first.
const column = (hour, hours) => hour - hours.open + 2;

// One shift: a button for an admin, text for anyone else. It spans the part
// of its hours the day is open; `style` is left out for one drawn beside the
// name (none of its hours is open).
function shiftElement(shift, hours, admin, { placed = true } = {}) {
  const tags = admin ? flagTags(shift) : [];
  const from = Math.max(shift.startHour, hours.open);
  const to = Math.min(shift.endHour, hours.close);
  const style = placed ? ` style="grid-column: ${column(from, hours)} / span ${to - from}"` : "";
  const cls = `schedule-shift role-${esc(shift.role)}${tags.length ? " flagged" : ""}${placed ? "" : " off-hours"}`;
  const inner = `<span class="schedule-role">${esc(roleLabel(shift.role))}</span><span class="schedule-time">${esc(
    hoursText(shift.startHour, shift.endHour),
  )}</span>${tagList(tags)}`;
  // The edge zones a pointer drags to change the hours (design D7); keyboard
  // users change them in the drawer. Only on a shift drawn on the grid, and
  // an edge only where the shift's own end is on screen.
  const edges = placed
    ? `${shift.startHour >= hours.open ? `<span class="schedule-edge start" data-edge="start" aria-hidden="true"></span>` : ""}${
        shift.endHour <= hours.close ? `<span class="schedule-edge end" data-edge="end" aria-hidden="true"></span>` : ""
      }`
    : "";
  return admin
    ? `<button type="button" class="${cls}" data-action="open-shift" data-shift-id="${esc(shift.shiftId)}"${style} aria-label="${esc(
        shiftLabel(shift, tags),
      )}">${inner}${edges}</button>`
    : `<span class="${cls}"${style}>${inner}</span>`;
}

const fits = (shift, hours) => Math.min(shift.endHour, hours.close) > Math.max(shift.startHour, hours.open);

function volunteerRow(row, hours, admin) {
  const open = row.shifts.filter((shift) => fits(shift, hours));
  // A shift with no open hour left (the hours moved) stays reachable by the name.
  const off = row.shifts.filter((shift) => !fits(shift, hours));
  const cells = [];
  for (let hour = hours.open; hour < hours.close; hour += 1)
    cells.push(`<span class="schedule-cell" data-hour="${hour}" style="grid-column: ${column(hour, hours)}"></span>`);
  const name = `<span class="schedule-name">${esc(row.name)}${
    off.length ? `<span class="schedule-off">${off.map((shift) => shiftElement(shift, hours, admin, { placed: false })).join("")}</span>` : ""
  }</span>`;
  return `<div class="schedule-row" data-volunteer-id="${esc(row.volunteerId)}">${name}${cells.join("")}${open
    .map((shift) => shiftElement(shift, hours, admin))
    .join("")}</div>`;
}

function grid(day, admin, rows) {
  const { hours } = day;
  const count = hours.close - hours.open;
  const head = [];
  for (let hour = hours.open; hour < hours.close; hour += 1)
    head.push(`<span class="schedule-hour" data-hour="${hour}" style="grid-column: ${column(hour, hours)}">${esc(hourLabel(hour))}</span>`);
  const people = scheduleRows(day.shifts ?? []);
  const coverage = admin
    ? `<div class="schedule-row schedule-coverage"><span class="schedule-name">Coverage</span>${rows
        .map(
          (row) =>
            `<span class="coverage-cell ${row.text === "OK" ? "ok" : "gap"}" data-hour="${row.hour}" style="grid-column: ${column(
              row.hour,
              hours,
            )}">${esc(row.text)}</span>`,
        )
        .join("")}</div>`
    : "";
  const empty = people.length ? "" : `<p class="muted schedule-empty">No shifts on this day.</p>`;
  return `<div class="schedule-scroll" role="region" aria-labelledby="schedule-day" tabindex="0"><div class="schedule-grid" style="--schedule-hours: ${count}"><div class="schedule-row schedule-head"><span class="schedule-name"></span>${head.join(
    "",
  )}</div>${people.map((row) => volunteerRow(row, hours, admin)).join("")}${coverage}</div></div>${empty}`;
}

function dayBody(day, admin) {
  if (!day.hours) {
    if (admin && day.anyOpen === false) {
      const link = day.canEditSettings === true ? ` ${button("Season settings", "open-season-settings", "text")}` : "";
      return `<p class="notice schedule-notice" role="note">Set site hours in Season settings first.${link}</p>`;
    }
    return `<p class="schedule-closed">${esc(`The site is closed on ${weekdayPlural(day.weekday)}.`)}</p>`;
  }
  const rows = admin ? coverageRows({ hours: day.hours, targets: day.targets, shifts: day.shifts ?? [] }) : [];
  const header = admin ? `<p class="schedule-gaps">${esc(gapHeader(rows))}</p>` : "";
  return `${header}${grid(day, admin, rows)}`;
}

/**
 * The Schedule page: its intro, the day picker and the day. Whether it edits
 * is the read's own `canEdit`, never the sidebar's view of the person.
 */
export function scheduleScreen(state) {
  const view = state?.schedule ?? {};
  const day = view.day ?? null;
  const date = view.date ?? day?.date ?? null;
  const admin = day?.canEdit === true;
  const list = state?.lists?.schedule ?? "loading";
  const add = admin && day?.hours ? `<div class="page-actions">${button("+ Add shift", "open-add-shift", "primary", disabled(state?.busy))}</div>` : "";
  const picker = `<div class="schedule-daybar">${button("‹ Prev", "schedule-prev", "secondary", 'aria-label="Previous day"')}<h2 id="schedule-day">${esc(
    date ? dayLabel(date) : "",
  )}</h2>${button("Next ›", "schedule-next", "secondary", 'aria-label="Next day"')}${button("Today", "schedule-today", "text")}</div>`;
  const body = day
    ? dayBody(day, admin)
    : list === "failed"
      ? unloadedLine("The schedule couldn't load.")
      : loadingLine("Loading the schedule…");
  return `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">VOLUNTEERS</span><h1>Schedule</h1>${add}</div><section class="panel schedule-panel" aria-labelledby="schedule-day">${picker}${body}</section></main>`;
}

// ---- the shift drawer ----------------------------------------------------

const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

// The hours a select offers: the open ones, and the value it holds (a shift
// saved before the hours moved still shows its own).
function hourOptions(hours, value, { end = false } = {}) {
  const offered = hours ? range(end ? hours.open + 1 : hours.open, end ? hours.close + 1 : hours.close) : [];
  const all = [...new Set([...offered, ...(Number.isInteger(value) ? [value] : [])])].sort((a, b) => a - b);
  return all.map((hour) => `<option value="${hour}"${hour === value ? " selected" : ""}>${esc(hourLabel(hour))}</option>`).join("");
}

function candidateItem(candidate, weekday, chosen, busy) {
  const tags = [
    candidate.usual ? `Usually here ${weekdayPlural(weekday)}` : null,
    candidate.cleared === false ? FLAG_TAGS.notCleared : null,
    candidate.signedIn === false ? FLAG_TAGS.noSignIn : null,
  ].filter(Boolean);
  const roles = (candidate.roles ?? []).map(roleLabel).join(", ");
  return `<li><label class="shift-candidate"><input type="radio" id="shift-volunteer-${esc(candidate.volunteerId)}" name="volunteerId" value="${esc(candidate.volunteerId)}"${
    candidate.volunteerId === chosen ? " checked" : ""
  }${disabled(busy)}><span class="shift-candidate-name">${esc(candidate.name)}</span><span class="shift-candidate-roles muted">${esc(roles)}</span>${tagList(
    tags,
  )}</label></li>`;
}

/** The drawer's title: Add shift, or the volunteer's name. */
export const shiftDrawerTitle = (state) => {
  const drawer = state?.schedule?.drawer ?? null;
  return drawer?.mode === "edit" ? (drawer.name ?? "Edit shift") : "Add shift";
};

/**
 * The shift drawer's body (`state.schedule.drawer` is the draft): a volunteer
 * picker for a new shift, then the role (the volunteer's current roles), the
 * start and the end (the day's open hours), Save, and for a saved shift
 * Remove shift.
 */
export function shiftDrawer(state) {
  const day = state?.schedule?.day ?? null;
  const drawer = state?.schedule?.drawer ?? null;
  if (!day || !drawer) return `<p>This shift is no longer on screen.</p>`;
  const busy = state?.busy === true;
  const edit = drawer.mode === "edit";
  const candidates = Array.isArray(day.candidates) ? day.candidates : [];
  const chosen = candidates.find((entry) => entry.volunteerId === drawer.volunteerId) ?? null;
  const saved = edit ? ((day.shifts ?? []).find((entry) => entry.shiftId === drawer.shiftId) ?? null) : null;
  const intro = edit
    ? `<p class="shift-saved"><strong>${esc(drawer.name ?? saved?.name ?? "")}</strong> · ${esc(roleLabel(saved?.role ?? drawer.role))} · ${esc(
        hoursText(saved?.startHour ?? drawer.startHour, saved?.endHour ?? drawer.endHour),
      )}${tagList(flagTags(saved))}</p>`
    : `<fieldset class="shift-pick"><legend>Volunteer</legend>${
        candidates.length
          ? `<ul class="shift-candidates">${orderCandidates(candidates, day.weekday)
              .map((candidate) => candidateItem(candidate, day.weekday, drawer.volunteerId, busy))
              .join("")}</ul>`
          : `<p class="muted">No one on this season's roster has a role yet.</p>`
      }</fieldset>`;
  // The volunteer's current roles, and in an edit the shift's own.
  const roles = [...new Set([...(chosen?.roles ?? []), ...(edit && drawer.role ? [drawer.role] : [])])];
  const roleSelect = roles.length
    ? `<select id="shift-role" name="role"${disabled(busy)}>${roles
        .map((role) => `<option value="${esc(role)}"${role === drawer.role ? " selected" : ""}>${esc(roleLabel(role))}</option>`)
        .join("")}</select>`
    : `<select id="shift-role" name="role" disabled><option value="">Choose a volunteer first</option></select>`;
  const remove = edit
    ? button("Remove shift", "remove-shift", "text danger-text", `data-shift-id="${esc(drawer.shiftId)}"${disabled(busy)}`)
    : "";
  return `<form id="shift-form" class="staff-form shift-form" novalidate>${intro}<label class="field" for="shift-role"><span>Role</span>${roleSelect}</label><div class="shift-hours"><label class="field" for="shift-start"><span>Start</span><select id="shift-start" name="startHour"${disabled(
    busy,
  )}>${hourOptions(day.hours, drawer.startHour)}</select></label><label class="field" for="shift-end"><span>End</span><select id="shift-end" name="endHour"${disabled(
    busy,
  )}>${hourOptions(day.hours, drawer.endHour, { end: true })}</select></label></div><div class="drawer-actions">${button(
    "Save",
    "save-shift",
    "primary",
    disabled(busy),
  )}${remove}${button("Cancel", "close-dialog", "text")}</div></form>`;
}

// ---- Remove shift ----------------------------------------------------------

const shiftToRemove = (state) => {
  const id = state?.dialogContext?.shiftId ?? state?.schedule?.drawer?.shiftId ?? null;
  return (state?.schedule?.day?.shifts ?? []).find((entry) => entry.shiftId === id) ?? null;
};

/** "Remove Rowan Diaz's shift?" */
export const removeShiftTitle = (state) => {
  const name = shiftToRemove(state)?.name ?? state?.schedule?.drawer?.name ?? "this volunteer";
  return `Remove ${name}'s shift?`;
};

/** The shared confirmation: the shift, Remove shift, and Keep shift. */
export function removeShiftDialogBody(state) {
  const shift = shiftToRemove(state);
  const id = shift?.shiftId ?? state?.dialogContext?.shiftId ?? "";
  return confirmBody({
    lead: shift ? esc(`${roleLabel(shift.role)} · ${hoursText(shift.startHour, shift.endHour)}`) : "",
    confirm: button("Remove shift", "confirm-remove-shift", "primary full", `data-shift-id="${esc(id)}"${disabled(state?.busy === true)}`),
    keep: "Keep shift",
  });
}
