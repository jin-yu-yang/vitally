// The Schedule (change add-volunteer-schedule, design D7): one day at a time,
// a row per volunteer with a shift that day, a column per open hour. A
// workspace admin (the read's own `canEdit`) gets the flag tags, the coverage
// row, "+ Add shift" and a button on every shift, and (change
// add-volunteer-check-in, design D7) the day's check-ins as bars, "+ Add
// check-in" and their drawer; anyone else reads names, roles and hours.
// Staff text, English only. Pure: `state.schedule.day` is the
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
  nyToday,
} from "./volunteer-schedule.mjs";
import { barLabel, barPlacement, checkInTags, timeOptions, missedNote } from "./volunteer-check-in.mjs";

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
// name (none of its hours is open) or in a closed day's list (`hours` null),
// which also shows the name (`withName`).
function shiftElement(shift, hours, admin, { placed = true, withName = false } = {}) {
  const tags = admin ? flagTags(shift) : [];
  let style = "";
  if (placed) {
    const from = Math.max(shift.startHour, hours.open);
    const to = Math.min(shift.endHour, hours.close);
    style = ` style="grid-column: ${column(from, hours)} / span ${to - from}"`;
  }
  const cls = `schedule-shift role-${esc(shift.role)}${tags.length ? " flagged" : ""}${placed ? "" : " off-hours"}`;
  const name = withName ? `<span class="schedule-shift-name">${esc(shift.name)}</span>` : "";
  const inner = `${name}<span class="schedule-role">${esc(roleLabel(shift.role))}</span><span class="schedule-time">${esc(
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
      )}" title="${esc(shiftLabel(shift, tags))}">${inner}${edges}</button>`
    : `<span class="${cls}"${style}>${inner}</span>`;
}

// ---- check-ins (change add-volunteer-check-in, design D7) ----------------

/** What a check-in button says to a screen reader: "Ari Moss, checked in 9:52 am – 1:10 pm" (then its tags). */
export const checkInLabel = (checkIn, tags = checkInTags(checkIn?.flags ?? {})) =>
  [checkIn.name, `checked in ${barLabel(checkIn)}`, ...tags].join(", ");

const percent = (n) => Number(n.toFixed(2));

// One check-in: a button, an admin's only. Placed (left and width as
// percentages of the open hours) in its row's track, or with no style beside
// the name or in the closed day's list.
function checkInBar(checkIn, placement = null, { withName = false } = {}) {
  const tags = checkInTags(checkIn.flags ?? {});
  const style = placement ? ` style="left: ${percent(placement.left)}%; width: ${percent(placement.width)}%"` : "";
  const name = withName ? `<span class="check-in-name">${esc(checkIn.name)}</span>` : "";
  return `<button type="button" class="check-in-bar${tags.length ? " flagged" : ""}" data-action="open-check-in" data-check-in-id="${esc(
    checkIn.checkInId,
  )}"${style} aria-label="${esc(checkInLabel(checkIn, tags))}">${name}<span class="check-in-time">${esc(barLabel(checkIn))}</span>${tagList(tags)}</button>`;
}

// A closed day, or no open weekday: the admin's check-ins as a list, by name.
function checkInList(day) {
  const checkIns = scheduleRows([], day.checkIns ?? []).flatMap((row) => row.checkIns);
  return checkIns.length
    ? `<ul class="check-in-list">${checkIns.map((checkIn) => `<li>${checkInBar(checkIn, null, { withName: true })}</li>`).join("")}</ul>`
    : "";
}

// A closed day, or no open weekday: the shifts saved on it before it closed
// (#275), by name then start, so they stay reachable. An admin's are buttons
// with their tags that open the shift drawer; anyone else reads them.
function closedShiftList(day, admin) {
  const shifts = scheduleRows(day.shifts ?? []).flatMap((row) => row.shifts);
  return shifts.length
    ? `<ul class="schedule-closed-shifts" aria-label="Shifts">${shifts
        .map((shift) => `<li>${shiftElement(shift, null, admin, { placed: false, withName: true })}</li>`)
        .join("")}</ul>`
    : "";
}

const fits = (shift, hours) => Math.min(shift.endHour, hours.close) > Math.max(shift.startHour, hours.open);

function volunteerRow(row, hours, admin) {
  const open = row.shifts.filter((shift) => fits(shift, hours));
  // A shift with no open hour left (the hours moved) stays reachable by the name.
  const off = row.shifts.filter((shift) => !fits(shift, hours));
  // An admin's check-ins: a bar each in a track under the shifts, or by the
  // name when none of it is inside the open hours.
  const checkIns = admin ? (row.checkIns ?? []).map((checkIn) => ({ checkIn, placement: barPlacement(checkIn, hours) })) : [];
  const placed = checkIns.filter((entry) => entry.placement);
  const offBars = checkIns.filter((entry) => !entry.placement).map((entry) => checkInBar(entry.checkIn));
  const cells = [];
  for (let hour = hours.open; hour < hours.close; hour += 1)
    cells.push(`<span class="schedule-cell" data-hour="${hour}" style="grid-column: ${column(hour, hours)}"></span>`);
  const name = `<span class="schedule-name">${esc(row.name)}${
    off.length || offBars.length
      ? `<span class="schedule-off">${off.map((shift) => shiftElement(shift, hours, admin, { placed: false })).join("")}${offBars.join("")}</span>`
      : ""
  }</span>`;
  // Its own grid line under the cells, so it takes no part in a drag.
  const track = placed.length
    ? `<div class="check-in-track" style="grid-column: 2 / span ${hours.close - hours.open}">${placed
        .map((entry) => checkInBar(entry.checkIn, entry.placement))
        .join("")}</div>`
    : "";
  return `<div class="schedule-row${track ? " has-check-ins" : ""}" data-volunteer-id="${esc(row.volunteerId)}">${name}${cells.join("")}${open
    .map((shift) => shiftElement(shift, hours, admin))
    .join("")}${track}</div>`;
}

function grid(day, admin, rows) {
  const { hours } = day;
  const count = hours.close - hours.open;
  const head = [];
  for (let hour = hours.open; hour < hours.close; hour += 1)
    head.push(`<span class="schedule-hour" data-hour="${hour}" style="grid-column: ${column(hour, hours)}">${esc(hourLabel(hour))}</span>`);
  // An admin also gets a row for a volunteer who checked in with no shift.
  const people = admin ? scheduleRows(day.shifts ?? [], day.checkIns ?? []) : scheduleRows(day.shifts ?? []);
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
  const empty = (day.shifts ?? []).length ? "" : `<p class="muted schedule-empty">No shifts on this day.</p>`;
  return `<div class="schedule-scroll" role="region" aria-label="Shifts" tabindex="0"><div class="schedule-grid${admin ? " can-drag" : ""}" style="--schedule-hours: ${count}"><div class="schedule-row schedule-head"><span class="schedule-name"></span>${head.join(
    "",
  )}</div>${people.map((row) => volunteerRow(row, hours, admin)).join("")}${coverage}</div></div>${empty}`;
}

function dayBody(day, admin) {
  if (!day.hours) {
    if (admin && day.anyOpen === false) {
      const link = day.canEditSettings === true ? ` ${button("Season settings", "open-season-settings", "text")}` : "";
      return `<p class="notice schedule-notice" role="note">Set site hours in Season settings first.${link}</p>${closedShiftList(day, admin)}${checkInList(day)}`;
    }
    return `<p class="schedule-closed">${esc(`The site is closed on ${weekdayPlural(day.weekday)}.`)}</p>${closedShiftList(day, admin)}${
      admin ? checkInList(day) : ""
    }`;
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
  // "+ Add check-in" on today and past days only (New York's today).
  const addShift = admin && day?.hours ? button("+ Add shift", "open-add-shift", "primary", disabled(state?.busy)) : "";
  const addCheckIn =
    admin && date && date <= nyToday(Date.now()) ? button("+ Add check-in", "add-check-in", "secondary", disabled(state?.busy)) : "";
  const add = addShift || addCheckIn ? `<div class="page-actions">${addShift}${addCheckIn}</div>` : "";
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

function candidateItem(candidate, weekday, chosen, busy, prefix = "shift-volunteer") {
  const tags = [
    candidate.usual ? `Usually here ${weekdayPlural(weekday)}` : null,
    candidate.cleared === false ? FLAG_TAGS.notCleared : null,
    candidate.signedIn === false ? FLAG_TAGS.noSignIn : null,
  ].filter(Boolean);
  const roles = (candidate.roles ?? []).map(roleLabel).join(", ");
  return `<li><label class="shift-candidate"><input type="radio" id="${prefix}-${esc(candidate.volunteerId)}" name="volunteerId" value="${esc(candidate.volunteerId)}"${
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

// ---- the check-in drawer (change add-volunteer-check-in, design D7) -------

// "09:52" as "9:52 am"; "24:00" (the midnight that ends the day) as
// "12:00 am (midnight)".
const clockLabel = (value) => {
  if (value === "24:00") return "12:00 am (midnight)";
  const [hour, minute] = String(value).split(":").map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
};

// A select's options in 5-minute steps, with the saved value kept though it is
// off the step (Review Focus 4): it is sent as read unless it is changed.
const timeSelect = (values, chosen) =>
  values.map((value) => `<option value="${esc(value)}"${value === chosen ? " selected" : ""}>${esc(clockLabel(value))}</option>`).join("");

const checkInOnScreen = (state, id) => (state?.schedule?.day?.checkIns ?? []).find((entry) => entry.checkInId === id) ?? null;

/** The drawer's title: Add check-in, or the volunteer's name. */
export const checkInDrawerTitle = (state) => {
  const drawer = state?.schedule?.checkInDrawer ?? null;
  return drawer?.mode === "edit" ? (drawer.name ?? "Edit check-in") : "Add check-in";
};

/**
 * The check-in drawer's body (`state.schedule.checkInDrawer` is the draft): a
 * volunteer picker for a new one (Add shift's, usual days first), then
 * Checked in and Checked out (which may be empty), Save, and for a saved one
 * its notes and Remove check-in.
 */
export function checkInDrawer(state) {
  const day = state?.schedule?.day ?? null;
  const drawer = state?.schedule?.checkInDrawer ?? null;
  if (!day || !drawer) return `<p>This check-in is no longer on screen.</p>`;
  const busy = state?.busy === true;
  const edit = drawer.mode === "edit";
  const candidates = Array.isArray(day.candidates) ? day.candidates : [];
  const saved = edit ? checkInOnScreen(state, drawer.checkInId) : null;
  const notes = saved
    ? [
        saved.flags?.corrected && saved.correctedByName ? `Corrected by ${saved.correctedByName}` : null,
        saved.state === "missed" ? missedNote(saved) : null,
      ]
        .filter(Boolean)
        .map((note) => `<p class="check-in-note muted">${esc(note)}</p>`)
        .join("")
    : "";
  const intro = edit
    ? `<p class="shift-saved"><strong>${esc(drawer.name ?? saved?.name ?? "")}</strong>${
        saved ? ` · ${esc(barLabel(saved))}${tagList(checkInTags(saved.flags ?? {}))}` : ""
      }</p>${notes}`
    : `<fieldset class="shift-pick"><legend>Volunteer</legend>${
        candidates.length
          ? `<ul class="shift-candidates">${orderCandidates(candidates, day.weekday)
              .map((candidate) => candidateItem(candidate, day.weekday, drawer.volunteerId, busy, "check-in-volunteer"))
              .join("")}</ul>`
          : `<p class="muted">No one on this season's roster has a role yet.</p>`
      }</fieldset>`;
  const checkedOut = drawer.checkedOut ?? "";
  const remove = edit
    ? button("Remove check-in", "remove-check-in", "text danger-text", `data-check-in-id="${esc(drawer.checkInId)}"${disabled(busy)}`)
    : "";
  return `<form id="check-in-form" class="staff-form shift-form check-in-form" novalidate>${intro}<div class="shift-hours"><label class="field" for="check-in-in"><span>Checked in</span><select id="check-in-in" name="checkedIn"${disabled(
    busy,
  )}>${timeSelect(timeOptions(drawer.checkedIn), drawer.checkedIn)}</select></label><label class="field" for="check-in-out"><span>Checked out</span><select id="check-in-out" name="checkedOut"${disabled(
    busy,
  )}><option value=""${checkedOut === "" ? " selected" : ""}>Not checked out</option>${timeSelect(
    // No 00:00: a check-out at the day's start is never after the check-in.
    // Midnight is offered once, as 24:00, the end of the day.
    timeOptions(drawer.checkedOut, { allow24: true }).filter((value) => value !== "00:00" || value === checkedOut),
    checkedOut,
  )}</select></label></div><div class="drawer-actions">${button("Save", "save-check-in", "primary", disabled(busy))}${remove}${button(
    "Cancel",
    "close-dialog",
    "text",
  )}</div></form>`;
}

// ---- Remove check-in -------------------------------------------------------

const checkInToRemove = (state) =>
  checkInOnScreen(state, state?.dialogContext?.checkInId ?? state?.schedule?.checkInDrawer?.checkInId ?? null);

/** "Remove Ari Moss's check-in?" */
export const removeCheckInTitle = (state) => {
  const name = checkInToRemove(state)?.name ?? state?.schedule?.checkInDrawer?.name ?? "this volunteer";
  return `Remove ${name}'s check-in?`;
};

/** The shared confirmation: the check-in, Remove check-in, and Keep check-in. */
export function removeCheckInDialogBody(state) {
  const checkIn = checkInToRemove(state);
  const id = checkIn?.checkInId ?? state?.dialogContext?.checkInId ?? "";
  return confirmBody({
    lead: checkIn ? esc(barLabel(checkIn)) : "",
    confirm: button("Remove check-in", "confirm-remove-check-in", "primary full", `data-check-in-id="${esc(id)}"${disabled(state?.busy === true)}`),
    keep: "Keep check-in",
  });
}
