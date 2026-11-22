// The volunteer Schedule (capability `volunteer-schedule`): date helpers,
// labels and the coverage arithmetic. Pure functions; the views render what
// they return. Dates are `YYYY-MM-DD` strings handled through UTC, never
// parsed in the viewer's local time.

export const ROLE_LABELS = Object.freeze({
  greeter: "Greeter",
  intaker: "Intaker",
  preparer: "Preparer",
  reviewer: "Reviewer",
  admin: "Admin",
});

// Why the database refused a shift (VT007 detail), in the words staff see.
export const SHIFT_REFUSALS = Object.freeze({
  OUTSIDE_SITE_HOURS: "The shift must stay inside site hours.",
  SITE_CLOSED: "The site is closed that day.",
  OVERLAP: "That volunteer already has a shift at that time.",
  ROLE_NOT_HELD: "That volunteer doesn't have that role this season.",
  NOT_ON_ROSTER: "That volunteer isn't on this season's roster.",
  DEACTIVATED: "That volunteer's account is deactivated.",
});

// Monday first: ISO weekday d is WEEKDAYS[d - 1].
export const WEEKDAYS = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
// Usual days as main's volunteer profile stores them (change add-my-profile):
// ISO weekday d is WEEKDAY_KEYS[d - 1].
export const WEEKDAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const utc = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

const nyDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// New York's calendar date at `now` (ms), whatever the viewer's time zone.
export const nyToday = (now) => nyDate.format(now);

export const addDays = (date, n) => fromUtc(utc(date) + n * 86400000);

// Monday is 1, Sunday is 7.
export const isoWeekday = (date) => new Date(utc(date)).getUTCDay() || 7;

export function weekBounds(date) {
  const monday = addDays(date, 1 - isoWeekday(date));
  return { monday, sunday: addDays(monday, 6) };
}

export function hourLabel(h) {
  const hour = h % 24;
  const suffix = hour < 12 ? "am" : "pm";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

const monthDay = (date) => {
  const [, m, d] = date.split("-").map(Number);
  return { month: MONTHS[m - 1], day: d };
};

export function dayLabel(date) {
  const { month, day } = monthDay(date);
  return `${WEEKDAYS[isoWeekday(date) - 1]}, ${month} ${day}`;
}

export const weekdayPlural = (weekday) => `${WEEKDAYS[weekday - 1]}s`;

export function shiftLine({ date, startHour, endHour, role }) {
  const { month, day } = monthDay(date);
  const weekday = WEEKDAYS[isoWeekday(date) - 1].slice(0, 3);
  return `${weekday}, ${month.slice(0, 3)} ${day} · ${hourLabel(startHour)} – ${hourLabel(endHour)} · ${ROLE_LABELS[role]}`;
}

const missingText = ({ preparers, reviewers, onSite }) => {
  const parts = [];
  if (preparers) parts.push(`${preparers} more preparer${preparers === 1 ? "" : "s"}`);
  if (reviewers) parts.push(`${reviewers} more reviewer${reviewers === 1 ? "" : "s"}`);
  if (onSite) parts.push(`${onSite} more on site`);
  return parts.join(", ");
};

// One row per open hour. The database decides what each shift counts toward
// (`counts`); a shift with no count (Admin, uncleared, tagged) adds nothing.
export function coverageRows({ hours, targets, shifts }) {
  if (!hours) return [];
  const rows = [];
  for (let hour = hours.open; hour < hours.close; hour += 1) {
    const have = { preparer: 0, reviewer: 0, onSite: 0 };
    for (const s of shifts) {
      if (s.counts && s.startHour <= hour && hour < s.endHour) have[s.counts] += 1;
    }
    const missing = {
      preparers: Math.max(0, targets.preparersNeeded - have.preparer),
      reviewers: Math.max(0, targets.reviewersNeeded - have.reviewer),
      onSite: Math.max(0, targets.onSiteNeeded - have.onSite),
    };
    rows.push({ hour, missing, text: missingText(missing) || "OK" });
  }
  return rows;
}

export function gapHeader(rows) {
  const gaps = rows.filter((r) => r.text !== "OK").length;
  return gaps === 0 ? "No gaps" : `${gaps} of ${rows.length} hours have gaps`;
}

const byName = (a, b) => a.name.localeCompare(b.name);

// Rostered volunteers for Add shift: those whose usual days include the
// weekday (ISO 1 to 7) first, each group by name. Usual days are `mon`..`sun`.
export function orderCandidates(candidates, weekday) {
  const key = WEEKDAY_KEYS[weekday - 1];
  const marked = candidates.map((c) => ({ ...c, usual: key !== undefined && (c.usualDays ?? []).includes(key) }));
  return [...marked.filter((c) => c.usual).sort(byName), ...marked.filter((c) => !c.usual).sort(byName)];
}

// One row per volunteer, by name, each with their shifts in time order.
export function scheduleRows(shifts) {
  const rows = new Map();
  for (const s of shifts) {
    if (!rows.has(s.volunteerId)) rows.set(s.volunteerId, { volunteerId: s.volunteerId, name: s.name, shifts: [] });
    rows.get(s.volunteerId).shifts.push(s);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, shifts: r.shifts.toSorted((a, b) => a.startHour - b.startHour) }))
    .sort(byName);
}

// The role a drag across a row starts with: the volunteer's earliest shift's.
export function dragRole(shifts, volunteerId) {
  const mine = shifts.filter((s) => s.volunteerId === volunteerId);
  if (!mine.length) return null;
  return mine.reduce((a, b) => (b.startHour < a.startHour ? b : a)).role;
}
