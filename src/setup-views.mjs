import { esc, button, icon } from "./ui.mjs";
import { missingLines } from "./clearance.mjs";

export { awaitingClearance } from "./clearance.mjs";

// Finish your setup (change add-volunteer-clearance, design D10): what an
// uncleared staff member sees instead of the work. Staff text, English only.
export function setupScreen(state) {
  const clearance = state?.principal?.clearance ?? null;
  const lines = missingLines(clearance);
  const name = clearance?.siteCoordinatorName ?? null;
  const list = lines.length
    ? `<ul class="setup-missing">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : "";
  const ask = name ? `<p>Ask ${esc(name)}, your site coordinator.</p>` : "";
  return `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><h1>Finish your setup for this season</h1></div><section class="panel setup-screen">${list}${ask}${button("Check again", "check-clearance", "primary")}</section></main>`;
}

// Confirm your site (change add-account-invitations, decision 4): an invited
// volunteer's first sign-in gives their name and this site's number before
// anything else. `state.siteCheck` is the screen's own state: `{name, error,
// cancelled}`, the name kept after a wrong number. An applicant never sees it.
export function siteCheckScreen(state) {
  const view = state?.siteCheck ?? {};
  const open = `<main id="main" class="narrow" tabindex="-1"><div class="page-intro"><h1>Confirm your site</h1></div><section class="panel setup-screen site-check">`;
  if (view.cancelled)
    return `${open}<p role="status">This invitation was cancelled. Ask your site coordinator to invite you again.</p></section></main>`;
  const error = view.error
    ? `<p class="notice error" role="alert" id="site-check-error">${icon("help")}<span>${esc(view.error)}</span></p>`
    : "";
  const busy = state?.busy === true ? " disabled" : "";
  return `${open}<p>Enter your name and this site's SIDN to finish signing in.</p><form id="site-check-form" class="staff-form" novalidate><label class="field" for="site-check-name"><span>Your name</span><input id="site-check-name" name="name" type="text" value="${esc(
    view.name ?? "",
  )}" maxlength="80" autocomplete="name" required></label><label class="field" for="site-check-sidn"><span>Site number (SIDN)</span><input id="site-check-sidn" name="sidn" type="text" value="" autocomplete="off"></label>${error}<button type="submit" class="btn primary"${busy}>Confirm</button></form></section></main>`;
}
