import { esc, button } from "./ui.mjs";
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
