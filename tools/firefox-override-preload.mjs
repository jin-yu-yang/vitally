// A preload for the browser suites, for runs started from the Claude desktop
// app (its agent shell or its Terminal panel). There, macOS refuses the app's
// processes `~/Library/Application Support/Firefox`, and Playwright's Firefox
// quits at launch with "Could not find profile folder." This wraps
// Playwright's `firefox.launch` to add `--override <file>`, a file that gives
// Firefox's application data a folder of its own ("Playwright Firefox"). The
// suites still run on Playwright's own temporary profile; nothing else changes.
//
//   NODE_OPTIONS="--import=./tools/firefox-override-preload.mjs" npm run test:browser
//
// Nothing imports it otherwise. See docs/setup.md, "Firefox inside the Claude
// desktop app".
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/** The override file: Firefox's `[App]` section, with its own data folder name. */
export const OVERRIDE_INI = "[App]\nProfile=Playwright Firefox\n";

/** `launch`, with `--override <iniPath>` after the caller's own arguments. */
export const withOverride = (launch, iniPath) => (options = {}) =>
  launch({ ...options, args: [...(options.args ?? []), "--override", iniPath] });

let firefox = null;
try {
  ({ firefox } = createRequire(import.meta.url)("playwright"));
} catch {
  // Playwright is not installed here: nothing to wrap.
}
if (firefox) {
  const iniPath = path.join(os.tmpdir(), "vitally-firefox-override.ini");
  const launch = firefox.launch.bind(firefox);
  firefox.launch = (options) => {
    writeFileSync(iniPath, OVERRIDE_INI);
    return withOverride(launch, iniPath)(options);
  };
}
