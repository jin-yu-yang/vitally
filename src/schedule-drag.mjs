// Drag on the Schedule (change add-volunteer-schedule, design D7): what a
// pointer gesture on the grid means. Pure; app.mjs does the pointer wiring.
import { dragRole } from "./volunteer-schedule.mjs";

const overlaps = (shifts, volunteerId, start, end) =>
  shifts.some((s) => s.volunteerId === volunteerId && s.startHour < end && s.endHour > start);

/**
 * The shift a gesture asks for, or null (zero-length, no change, a create over
 * an occupied cell, or hours outside the open ones). `fromHour` and `toHour`
 * are the hour cells where it started and where the pointer is now. A create
 * spans the cells crossed (min..max+1) with the role of the volunteer's
 * earliest shift that day; "start" puts the start at the cell, "end" puts the
 * end at the cell's close.
 */
export function dragResult({ kind, volunteerId, shift = null, fromHour, toHour, hours, shifts }) {
  if (!hours || !Number.isInteger(fromHour) || !Number.isInteger(toHour)) return null;
  let start;
  let end;
  let role;
  if (kind === "create") {
    start = Math.min(fromHour, toHour);
    end = Math.max(fromHour, toHour) + 1;
    role = dragRole(shifts, volunteerId);
    if (overlaps(shifts, volunteerId, start, end)) return null;
  } else if (kind === "start" || kind === "end") {
    if (!shift) return null;
    start = kind === "start" ? toHour : shift.startHour;
    end = kind === "end" ? toHour + 1 : shift.endHour;
    if (start === shift.startHour && end === shift.endHour) return null;
    role = shift.role;
  } else return null;
  if (!(end > start) || start < hours.open || end > hours.close || !role) return null;
  return {
    volunteerId,
    shiftId: kind === "create" ? null : shift.shiftId,
    revision: kind === "create" ? null : Number(shift.revision),
    startHour: start,
    endHour: end,
    role,
  };
}

/**
 * Whether a gesture's row is still on the page. A redraw that replaced it
 * mid-drag leaves a detached row whose rects are all zero, so the gesture is
 * cancelled (nothing saved) rather than read at the wrong hour.
 */
export const gestureLive = (row) => row?.isConnected === true;

/**
 * One gesture, made at pointerdown with its own `actionId` and the `date` of
 * the day it was pressed on. `finish` answers once: the draft (carrying the
 * actionId and that date) or null, and null every time after, so a second
 * pointerup for the same gesture sends nothing. A gesture finished on another
 * day (the day changed while the press was down) is cancelled: null, so a
 * shift is never moved to the day now on screen.
 */
export function createGesture({ kind, volunteerId, shift = null, fromHour, actionId, date }) {
  let spent = false;
  return {
    kind,
    volunteerId,
    shift,
    fromHour,
    date,
    finish({ toHour, hours, shifts, date: now }) {
      if (spent) return null;
      spent = true;
      if (now !== date) return null;
      const draft = dragResult({ kind, volunteerId, shift, fromHour, toHour, hours, shifts });
      return draft ? { ...draft, date, actionId } : null;
    },
  };
}

/**
 * Whether a press on this target starts no gesture at all: a check-in bar
 * (change add-volunteer-check-in, design D7) is never dragged; its drawer is
 * its only editor.
 */
export const dragIgnores = (target) => Boolean(target?.closest?.(".check-in-bar"));
