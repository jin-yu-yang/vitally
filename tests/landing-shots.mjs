// One-off: screenshots for the govitally.org landing page (#218).
// Runs only on the `landing-screenshots` branch (.github/workflows/landing-shots.yml).
// Local test stack + seed:local data only (fictional). The demo tools' buttons
// are hidden in the shots, because govitally.org never shows them.
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserFixture, loginTestUser } from "./support/browser-fixture.mjs";
import {
  WORK_BOARD_HEADING,
  OFFICE_BOARD_HEADING,
  clickAction,
  waitForText,
  waitForQuiet,
  clearToast,
} from "./support/story-pages.mjs";
import { seedWorkspace } from "../tools/admin/seed-cases.mjs";

const OUT = "artifacts/landing";
const HIDE_DEMO =
  ".fiction-tools,.demo-fill,.fiction-pill,.demo-fiction,.toast,[role=status].toast{display:none!important}";
const WIDE = { width: 1280, height: 900 };
// Follow-ups and the reviewer's board overflow at 1280 (their last column is
// cut off; #147), so they are also taken at 1440 for #261.
const WIDER = { width: 1440, height: 900 };

await mkdir(OUT, { recursive: true });
const done = [];
const failed = [];

const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    failed.push(name);
    console.log(`SKIPPED ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
};

const shot = async (page, name, { full = false } = {}) => {
  await page.addStyleTag({ content: HIDE_DEMO });
  await waitForQuiet(page).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  done.push(name);
};

// Every chip of one filter group, one shot each.
const shootChips = async (page, filter, prefix) => {
  const chips = page.locator(`[data-action="set-board-filter"][data-filter="${filter}"]`);
  const count = await chips.count();
  for (let i = 0; i < count; i += 1) {
    const chip = chips.nth(i);
    const value = (await chip.getAttribute("data-value")) ?? String(i);
    await chip.click();
    await waitForQuiet(page).catch(() => {});
    await shot(page, `${prefix}-${filter}-${value}`, { full: true });
  }
};

const fixture = await createBrowserFixture();
try {
  const db = fixture.database;
  const runDir = await mkdtemp(join(tmpdir(), "landing-seed-"));
  const seeded = await seedWorkspace({
    workspaceId: db.workspaceId,
    clientAEmail: db.applicantAEmail,
    runDir,
  });
  console.log("Seeded:", JSON.stringify(seeded));

  const chrome = await fixture.launch("chrome");

  await step("preparer work board", async () => {
    const { page } = await chrome.newPage({ viewport: WIDE });
    await loginTestUser({ page, actor: fixture.actor("preparer"), fixture, heading: WORK_BOARD_HEADING });
    await shot(page, "preparer-work-board");
    await shot(page, "preparer-work-board-full", { full: true });
    await step("preparer board chips", () => shootChips(page, "status", "preparer-work-board"));
  });

  await step("reviewer work board", async () => {
    const { page } = await chrome.newPage({ viewport: WIDE });
    await loginTestUser({ page, actor: fixture.actor("reviewer"), fixture, heading: WORK_BOARD_HEADING });
    await shot(page, "reviewer-work-board-full", { full: true });
    await page.setViewportSize(WIDER);
    await shot(page, "reviewer-work-board-1440-full", { full: true });
    await page.setViewportSize(WIDE);
    await step("reviewer board chips", () => shootChips(page, "status", "reviewer-work-board"));
  });

  await step("site coordinator", async () => {
    const { page } = await chrome.newPage({ viewport: WIDE });
    await loginTestUser({ page, actor: fixture.actor("siteCoordinator"), fixture, heading: OFFICE_BOARD_HEADING });
    await shot(page, "office-followups-full", { full: true });
    await page.setViewportSize(WIDER);
    await shot(page, "office-followups-1440-full", { full: true });
    await page.setViewportSize(WIDE);
    await clickAction(page, "open-cases");
    await waitForText(page, "Case pool");
    await shot(page, "office-case-pool");
    await shot(page, "office-case-pool-full", { full: true });
    await step("office case page", async () => {
      await page.locator('tr.pool-row [data-action="open-case"]').first().click();
      await waitForQuiet(page).catch(() => {});
      await shot(page, "office-case-page-full", { full: true });
    });
  });

  await step("client", async () => {
    const { page } = await chrome.newPage({ viewport: WIDE });
    await loginTestUser({ page, actor: fixture.actor("applicantA"), fixture });
    await shot(page, "client-applications-full", { full: true });
    await step("client progress", async () => {
      await page.locator('.application-row[data-action="open-case"]').first().click();
      await waitForQuiet(page).catch(() => {});
      await shot(page, "client-progress-full", { full: true });
      for (const width of [720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await shot(page, `client-progress-${width}-full`, { full: true });
      }
      await page.setViewportSize(WIDE);
    });
    await step("client intake", async () => {
      await clickAction(page, "open-applications");
      await waitForQuiet(page).catch(() => {});
      await clickAction(page, "start-application");
      await waitForQuiet(page).catch(() => {});
      await clearToast(page).catch(() => {});
      await shot(page, "client-reference-card");
      await clickAction(page, "continue-intake");
      await waitForQuiet(page).catch(() => {});
      await clearToast(page).catch(() => {});
      await shot(page, "client-intake");
      await shot(page, "client-intake-full", { full: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, "client-intake-390");
    });
  });
} finally {
  console.log(`Shots: ${done.length} (${done.join(", ")})`);
  if (failed.length) console.log(`Skipped: ${failed.join(", ")}`);
  await fixture.close().catch(() => {});
}
