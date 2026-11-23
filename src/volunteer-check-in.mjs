// Volunteer check-in (capability `volunteer-check-in`): labels, bar placement
// and hours arithmetic. Pure functions; the views render what they return.
// Times are New York wall times, whatever the viewer's time zone.

export const CHECK_IN_REFUSALS = Object.freeze({
  ALREADY_CHECKED_IN: "You are already checked in.",
  NOT_CHECKED_IN: "You are not checked in.",
  OUT_BEFORE_IN: "The check-out must be after the check-in.",
  IN_FUTURE: "A check-in can't be in the future.",
  OVERLAP: "That volunteer already has a check-in at that time.",
  NOT_ON_ROSTER: "That volunteer isn't on this season's roster.",
  DEACTIVATED: "That volunteer's account is deactivated.",
});

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// The New York hour (0-23) and minute of an ISO instant.
function parts(iso) {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

const pad = (n) => String(n).padStart(2, "0");

export function hhmm(iso) {
  const { hour, minute } = parts(iso);
  return `${pad(hour)}:${pad(minute)}`;
}

export function timeLabel(iso) {
  const { hour, minute } = parts(iso);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour < 12 ? "am" : "pm"}`;
}

export function barLabel(checkIn) {
  const start = timeLabel(checkIn.checkedInAt);
  if (checkIn.state === "open") return `${start} – now`;
  if (checkIn.state === "missed") return `${start} – no check-out`;
  return `${start} – ${timeLabel(checkIn.checkedOutAt)}`;
}

const minutesOfDay = (iso) => {
  const { hour, minute } = parts(iso);
  return hour * 60 + minute;
};

// Percentages of the open span. An end at midnight reads as 24:00.
export function barPlacement(checkIn, hours) {
  const span = (hours.close - hours.open) * 60;
  const start = minutesOfDay(checkIn.checkedInAt);
  let end = minutesOfDay(checkIn.endsAt);
  if (end <= start) end += 24 * 60;
  const from = Math.max(start, hours.open * 60);
  const to = Math.min(end, hours.close * 60);
  if (span <= 0 || to <= from) return null;
  return { left: ((from - hours.open * 60) / span) * 100, width: ((to - from) / span) * 100 };
}

export function timeOptions(saved, { allow24 = false } = {}) {
  const options = [];
  for (let m = 0; m < 24 * 60; m += 5) options.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  if (allow24) options.push("24:00");
  if (saved && !options.includes(saved)) {
    options.push(saved);
    options.sort();
  }
  return options;
}

// "No check-out. Counted to 1 pm." (":00" dropped from the end).
export function missedNote(checkIn) {
  return `No check-out. Counted to ${timeLabel(checkIn.endsAt).replace(":00", "")}.`;
}

// Minutes as hours to one decimal, half up, with whole numbers bare.
export function formatHours(minutes) {
  const tenths = Math.round((minutes * 10) / 60);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function checkInTags(flags) {
  const tags = [];
  if (flags.noCheckOut) tags.push("No check-out");
  if (flags.notScheduled) tags.push("Not scheduled");
  if (flags.corrected) tags.push("Corrected");
  if (flags.outsideSiteHours) tags.push("Outside site hours");
  return tags;
}
