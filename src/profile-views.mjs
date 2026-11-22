// My profile (change add-volunteer-schedule, design D8): the volunteer's
// name and roles this season, their usual days with Save, and their shifts
// this week. Every schedule viewer's, cleared or not. Staff text, English
// only. Pure: `state.myProfile` is the `vitally_my_profile` answer.
//
// The usual-day toggles are shared with the Roster's drawer: seven
// `aria-pressed` buttons and one hidden field that holds the pressed days
// ("2,6"), which is what a form sends; `data-saved` keeps the days as drawn.
// The app flips a button and rewrites the field (`toggle-usual-day`); the
// field's draft survives a redraw.
import { esc, button, loadingLine, unloadedLine } from "./ui.mjs";
import { ROLE_LABELS, WEEKDAYS, shiftLine } from "./volunteer-schedule.mjs";
import { readUsualDays } from "./volunteer-roster.mjs";

export const PROFILE_PRIVACY_NOTE = "Only you and the office admins see your usual days.";

const disabled = (off) => (off ? " disabled" : "");

/**
 * The seven toggles, Mon to Sun, and their hidden field `id` (name
 * `usualDays`). `days` are the pressed weekdays (1 Monday … 7 Sunday).
 */
export function usualDayToggles({ id, days = [], busy = false, describedBy = "" } = {}) {
  const on = readUsualDays((days ?? []).join(","));
  const buttons = WEEKDAYS.map((weekday, index) => {
    const day = index + 1;
    return button(
      esc(weekday.slice(0, 3)),
      "toggle-usual-day",
      "usual-day",
      `data-day="${day}" aria-pressed="${on.includes(day)}" aria-label="${esc(weekday)}"${disabled(busy)}`,
    );
  }).join("");
  return `<div class="usual-days" data-for="${esc(id)}" data-saved="${on.join(",")}"${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ""}>${buttons}</div><input type="hidden" id="${esc(
    id,
  )}" name="usualDays" value="${on.join(",")}">`;
}

const roleChips = (roles) =>
  roles.length
    ? `<span class="volunteer-chips">${roles
        .map((role) => `<span class="volunteer-chip">${esc(ROLE_LABELS[role] ?? role)}</span>`)
        .join("")}</span>`
    : `<p class="muted">No roles recorded</p>`;

function profileBody(profile, { busy, notice }) {
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const shifts = Array.isArray(profile.shiftsThisWeek) ? profile.shiftsThisWeek : [];
  // With no volunteer profile row there is nothing to save to (ruling R3).
  const off = busy || profile.profileRevision == null;
  const alert = notice ? `<p class="notice error settings-notice" role="alert">${esc(notice)}</p>` : "";
  const who = `<section class="panel profile-card" aria-labelledby="profile-name"><h2 id="profile-name">${esc(
    profile.name ?? "",
  )}</h2><h3 class="profile-subhead">Roles this season</h3>${roleChips(roles)}</section>`;
  const days = `<section class="panel profile-card" aria-labelledby="profile-days-title"><h2 id="profile-days-title">Usual days</h2>${alert}<form id="my-profile-form" class="staff-form profile-days-form" novalidate>${usualDayToggles(
    { id: "my-usual-days", days: profile.usualDays ?? [], busy: off, describedBy: "profile-days-note" },
  )}<p class="field-note" id="profile-days-note">${esc(PROFILE_PRIVACY_NOTE)}</p><div class="settings-actions"><button type="submit" class="btn primary"${disabled(
    off,
  )}>Save</button></div></form></section>`;
  const list = shifts.length
    ? `<ul class="profile-shifts">${shifts.map((shift) => `<li>${esc(shiftLine(shift))}</li>`).join("")}</ul>`
    : `<p class="muted">No shifts this week.</p>`;
  const week = `<section class="panel profile-card" aria-labelledby="profile-shifts-title"><h2 id="profile-shifts-title">Your shifts this week</h2>${list}</section>`;
  return `${who}${days}${week}`;
}

/** The My profile page. */
export function myProfileScreen(state) {
  const profile = state?.myProfile ?? null;
  const list = state?.lists?.myProfile ?? "loading";
  const body = profile
    ? profileBody(profile, { busy: state?.busy === true, notice: state?.myProfileUi?.notice ?? null })
    : list === "failed"
      ? unloadedLine("Your profile couldn't load.")
      : loadingLine("Loading your profile…");
  return `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><span class="overline">VOLUNTEER</span><h1>My profile</h1></div><div class="my-profile">${body}</div></main>`;
}
