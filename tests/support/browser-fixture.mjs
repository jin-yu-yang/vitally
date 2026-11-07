import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createAppServer } from "../../server.mjs";
import { NEUTRAL_SEND_MESSAGE } from "../../src/auth.mjs";
import { isLoopbackUrl } from "../../src/loopback.mjs";
import { assertTestTarget } from "../../tools/admin/test-target.mjs";
import { createDatabaseFixture } from "./database-fixture.mjs";

// The shared browser harness: one guarded test target, one in-process
// application server, one database fixture of confirmed synthetic users, and
// the two real engines. Task 5A proves it; Task 10A imports it unchanged.
//
// Three rules this file exists to keep:
//
//   * **Nothing secret leaves the page.** The generated one-time code stays in
//     this process, the access token stays in the browser, and the assertions
//     that need them run where they already are. No value here is ever printed.
//   * **Only the send is simulated.** The exact guarded `/auth/v1/otp` URL is
//     intercepted so automation never asks a mail server for anything; the real
//     `/auth/v1/verify` is always untouched, so a passing login is a real one.
//   * **Users come from the database fixture.** It owns provisioning and
//     run-scoped cleanup; this file never creates an Auth user of its own.

// The published resend cooldown the app is served with. The server's own
// minimum email interval (60s on the verified stack) plus five seconds.
export const APP_COOLDOWN_SECONDS = 65;

// The one URL automation is allowed to answer for the application.
export const SEND_PATH = "/auth/v1/otp";

// The app's own window-state key, keyed by the authenticated user (Task 6).
export const sessionStateKey = (userId) => `vitally:client:v1:${userId}`;

const CLIENT_OPTIONS = Object.freeze({
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const LAUNCHERS = Object.freeze({
  // The installed Google Chrome, not a bundled Chromium: the engine a visitor
  // actually has.
  chrome: () => chromium.launch({ channel: "chrome", headless: true }),
  firefox: () => firefox.launch({ headless: true }),
});

// The Playwright build that supplies each engine, for the evidence record.
const REVISIONS = Object.freeze({
  chrome: () => null,
  firefox: () => /firefox-(\d+)/.exec(firefox.executablePath())?.[1] ?? null,
});

/**
 * The OPTIONS-safe handler for the intercepted send.
 *
 * It answers a preflight without consuming the send, counts POSTs on its own,
 * and refuses anything else — which is why it carries no `times:1`: a browser
 * that does send a preflight would otherwise spend the handler on it and let
 * the real request through to Auth.
 *
 * Assertion failures are collected rather than thrown, because a throw inside a
 * Playwright route handler leaves the request hanging and prints an unhandled
 * error instead of failing the test. The refused request is aborted, so it can
 * never reach the real server, and the caller asserts `failures` is empty.
 */
export function createSendRoute({ frontendOrigin }) {
  let posts = 0;
  let preflights = 0;
  const failures = [];
  const corsHeaders = () => ({
    "access-control-allow-origin": frontendOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "apikey, authorization, content-type, x-client-info, x-supabase-api-version",
    vary: "Origin",
  });
  const handler = async (route) => {
    const request = route.request();
    try {
      // Only the application's own page may be answered here. Anything else is
      // a different page talking to the test target, which is never expected.
      assert.equal(
        request.headers().origin,
        frontendOrigin,
        "the intercepted send came from an unexpected origin",
      );
      if (request.method() === "OPTIONS") {
        preflights += 1;
        return await route.fulfill({ status: 204, headers: corsHeaders() });
      }
      assert.equal(
        request.method(),
        "POST",
        "the intercepted send used an unexpected method",
      );
      posts += 1;
      assert.equal(posts, 1, "the application sent more than one code request");
      // `shouldCreateUser:false` is `create_user:false` on the wire: the demo
      // never creates an account from a sign-in attempt.
      assert.equal(
        request.postDataJSON()?.create_user,
        false,
        "the code request did not carry create_user:false",
      );
      return await route.fulfill({
        status: 200,
        headers: corsHeaders(),
        contentType: "application/json",
        body: "{}",
      });
    } catch (error) {
      failures.push(error);
      await route.abort().catch(() => {});
      return undefined;
    }
  };
  return {
    handler,
    get posts() {
      return posts;
    },
    get preflights() {
      return preflights;
    },
    get failures() {
      return failures;
    },
  };
}

// The heading an applicant lands on. A presenter lands somewhere else — the
// work board, or the office board — so the screen a caller waits for is an
// argument with this as its default. Nothing else about the assertion changes.
export const SIGNED_IN_HEADING = "My applications";

/**
 * Prove the session, not the screen (Ruling R46). The signed-in screen is the
 * first condition, but a screen change alone says nothing about who is signed
 * in: the SDK's stored session is read in the page, and only the user id and
 * two booleans come back — the access token never leaves the browser.
 *
 * `heading` is the signed-in screen's own heading; it defaults to the
 * applicant's, and a staff caller passes the one their principal lands on.
 * `.first()` because a staff screen names itself twice — once in the frame and
 * once in the panel — and a single match is unaffected by it. `windowState`
 * is passed on to `assertStoredSession`.
 */
export async function assertAuthenticatedUser(
  page,
  userId,
  { timeout, heading = SIGNED_IN_HEADING, windowState = true } = {},
) {
  await page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .waitFor(timeout === undefined ? undefined : { timeout });
  await assertStoredSession(page, userId, { windowState });
}

/**
 * The session half of `assertAuthenticatedUser`, with no screen in it: the
 * SDK's stored session belongs to this user and carries an access token, and
 * the app wrote its window state. Only ids and booleans leave the page.
 * `windowState: false` expects the opposite of the last: a presenter's window
 * loads nothing, so it stores no window state either.
 */
export async function assertStoredSession(page, userId, { windowState = true } = {}) {
  const stored = await page.evaluate(
    ({ stateKey }) => {
      const key = Object.keys(localStorage).find((name) =>
        /^sb-.*-auth-token$/.test(name),
      );
      if (!key) return { key: null, parsed: false };
      let session = null;
      try {
        session = JSON.parse(localStorage.getItem(key));
      } catch {
        return { key, parsed: false };
      }
      return {
        key,
        parsed: true,
        userId: session?.user?.id ?? null,
        hasAccessToken:
          typeof session?.access_token === "string" &&
          session.access_token.length > 0,
        windowState: sessionStorage.getItem(stateKey) !== null,
      };
    },
    { stateKey: sessionStateKey(userId) },
  );
  assert.ok(stored.key, "the SDK stored no session under sb-<ref>-auth-token");
  assert.match(stored.key, /^sb-.*-auth-token$/);
  assert.equal(stored.parsed, true, "the stored session was not readable JSON");
  assert.equal(stored.userId, userId, "the session belongs to another user");
  assert.equal(
    stored.hasAccessToken,
    true,
    "the stored session carries no access token",
  );
  assert.equal(
    stored.windowState,
    windowState,
    windowState
      ? "the app stored no window state for the signed-in user"
      : "the app stored a window state it should not have",
  );
}

// The one bounded wait for a verification to be answered, whichever way.
const SIGNED_IN_TIMEOUT_MS = 30_000;

/**
 * Ask for a code through the real form, with only the send intercepted.
 *
 * Installs the route, fills the address, clicks Send, and waits for the neutral
 * message and the code field — which render only once the send resolved, so the
 * route is necessarily still installed when its one POST completes.
 *
 * Returns the live route and a `release()`. Because the handler *collects*
 * assertion failures rather than throwing them (a throw inside a Playwright
 * route handler leaves the request hanging), a caller's check is the only thing
 * that surfaces a refused request — so `release()` must be called in a
 * `finally`, however long the route stays installed afterwards. It unroutes,
 * re-raises anything the handler collected, and asserts the POST count.
 */
export async function requestCode({ page, fixture, address }) {
  const route = createSendRoute({ frontendOrigin: fixture.appOrigin });
  await page.route(fixture.sendPattern, route.handler);
  const unroute = () =>
    page.unroute(fixture.sendPattern, route.handler).catch(() => {});
  const release = async ({ posts = 1, pending = null } = {}) => {
    await unroute();
    // A failure the handler collected is the precise cause and outranks any
    // symptom the caller saw, so it is raised even over a pending error.
    if (route.failures.length) throw route.failures[0];
    // A counter mismatch must not replace a real failure the caller is already
    // throwing; it would hide the message that explains it.
    if (!pending) assert.equal(route.posts, posts);
  };
  try {
    await page.getByLabel("Email address", { exact: true }).fill(address);
    await page
      .getByRole("button", { name: "Send verification code", exact: true })
      .click();
    await page.getByText(fixture.neutralSendMessage, { exact: true }).waitFor();
    await page.getByLabel("Verification code", { exact: true }).waitFor();
  } catch (error) {
    await unroute();
    if (route.failures.length) throw route.failures[0];
    throw error;
  }
  return { route, release };
}

/**
 * Enter the code and submit the real form: one fill, one click.
 *
 * The typed code lives in the controller's `state.authCode` and the field is
 * rendered from it, so a re-render — the countdown, a connection notice, a
 * realtime change — can no longer empty the field between typing and clicking.
 * What is submitted is what was typed, so there is nothing here to retry and no
 * actionability check to skip.
 */
export async function submitVerificationCode({ page, code }) {
  await page.getByLabel("Verification code", { exact: true }).fill(String(code));
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
}

/**
 * Sign one provisioned actor in through the real form.
 *
 * `otp` is optional: pass one that was generated earlier (a return visit, or a
 * repeat-generation measurement), otherwise one is generated here. The returned
 * code is for a caller that needs to prove it cannot be reused — it must never
 * be logged. `heading` is the signed-in screen this actor lands on; a presenter
 * passes their own, and an applicant needs nothing. `windowState` is
 * `assertStoredSession`'s: a presenter passes false.
 */
export async function loginTestUser({ page, actor, fixture, otp, heading, windowState }) {
  const code = otp ?? (await fixture.generateOtp(actor.email));
  assert.match(String(code), /^[0-9]+$/);
  const { route, release } = await requestCode({
    page,
    fixture,
    address: actor.email,
  });
  let pending = null;
  try {
    await submitVerificationCode({ page, code });
    // Real verification: /auth/v1/verify is never intercepted. One bounded wait
    // covers the whole round trip — the verify, the identity read and the first
    // case list all happen before the signed-in screen renders.
    await assertAuthenticatedUser(page, actor.userId, {
      timeout: SIGNED_IN_TIMEOUT_MS,
      ...(heading === undefined ? {} : { heading }),
      ...(windowState === undefined ? {} : { windowState }),
    });
    return { posts: route.posts, preflights: route.preflights, otp: code };
  } catch (error) {
    pending = error;
    throw error;
  } finally {
    await release({ pending });
  }
}

/**
 * `loginTestUser` with no text in its locators, for a page that is not in
 * English (spec 2026-10-05 §6). The same route, the same one POST, the same
 * release in a `finally`, and the same proof of the session; only the way
 * the controls are found differs:
 *
 *   * the address goes into `#field-email` and `#email-form`'s submit sends it;
 *   * the code field `#field-code` appearing is the sign that the send was
 *     answered (the code step renders only then), in place of the English
 *     neutral message;
 *   * `#code-form`'s submit verifies;
 *   * the applications screen is recognised by its own form and its Start
 *     button, `#lookup-form` and `[data-action="start-application"]` in `#main`.
 */
export async function loginTestUserById({ page, actor, fixture, otp }) {
  const code = otp ?? (await fixture.generateOtp(actor.email));
  assert.match(String(code), /^[0-9]+$/);
  const route = createSendRoute({ frontendOrigin: fixture.appOrigin });
  await page.route(fixture.sendPattern, route.handler);
  let pending = null;
  try {
    await page.locator("#field-email").fill(actor.email);
    await page.locator('#email-form button[type="submit"]').click();
    await page.locator("#field-code").waitFor();
    await page.locator("#field-code").fill(String(code));
    await page.locator('#code-form button[type="submit"]').click();
    await page
      .locator('#main #lookup-form ~ .start-row [data-action="start-application"]')
      .waitFor({ timeout: SIGNED_IN_TIMEOUT_MS });
    await assertStoredSession(page, actor.userId);
    return { posts: route.posts, preflights: route.preflights, otp: code };
  } catch (error) {
    pending = error;
    throw error;
  } finally {
    await page.unroute(fixture.sendPattern, route.handler).catch(() => {});
    // As in requestCode's release: a failure the handler collected is the
    // precise cause; the count is checked only when nothing else failed.
    if (route.failures.length) throw route.failures[0];
    if (!pending) assert.equal(route.posts, 1);
  }
}

export async function createBrowserFixture() {
  const target = await assertTestTarget();
  // The database fixture's default: the Site Coordinator is the default
  // follow-up person, as the seed (tools/admin/seed-cases.mjs) requires.
  const database = await createDatabaseFixture();
  const browsers = [];
  let server = null;
  try {
    // Ruling R45: the app is served in-process from the repository, configured
    // only with the guarded test target. No `.env.local` is ever written, and
    // port 0 keeps parallel runs and other sessions' servers out of the way.
    if (!isLoopbackUrl(target.apiUrl)) {
      throw new Error("The browser story needs a local (loopback) Supabase test target for the demo tools.");
    }
    server = createAppServer({
      env: {
        VITALLY_DEMO_TOOLS: "1",
        SUPABASE_URL: target.apiUrl,
        SUPABASE_PUBLISHABLE_KEY: target.publishableKey,
        AUTH_RESEND_COOLDOWN_SECONDS: String(APP_COOLDOWN_SECONDS),
      },
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    server?.close?.();
    await database.close();
    throw error;
  }

  const appOrigin = `http://127.0.0.1:${server.address().port}`;

  const fixture = {
    // The guarded target's keys are deliberately not exposed: `anonClient` and
    // `generateLink` are the only ways in, and neither hands a caller a value
    // it could print.
    targetMode: target.mode,
    database,
    appOrigin,
    authOrigin: target.apiUrl,
    sendPattern: `${target.apiUrl}${SEND_PATH}`,
    cooldownSeconds: APP_COOLDOWN_SECONDS,
    neutralSendMessage: NEUTRAL_SEND_MESSAGE,
    sessionStateKey,
  };

  // One provisioned actor, by the name the database fixture uses: one of its
  // own actors (applicantA, presenter, …) or one of its role-named staff
  // accounts (siteCoordinator, preparer, reviewer, intaker), whose address the
  // fixture keeps under `roleAccounts`. Never logged.
  fixture.actor = (key) => {
    const email = database[`${key}Email`] ?? database.roleAccounts?.[key]?.email;
    const userId = database[`${key}UserId`];
    assert.ok(
      email && userId,
      `The database fixture exposes no ${key} actor (R46).`,
    );
    return { key, email, userId };
  };

  // A fresh unauthenticated client, for the checks that must not borrow a
  // session the fixture already holds.
  fixture.anonClient = () =>
    createClient(target.apiUrl, target.publishableKey, CLIENT_OPTIONS);

  // The privileged generation, re-guarded on every call by `database.service`.
  // The raw result is returned so a caller can record a refusal instead of
  // throwing on it.
  fixture.generateLink = (email) =>
    database.service((admin) =>
      admin.auth.admin.generateLink({ type: "magiclink", email }),
    );

  fixture.generateOtp = async (email) => {
    const { data, error } = await fixture.generateLink(email);
    if (error) throw error;
    const otp = data?.properties?.email_otp;
    assert.match(
      String(otp),
      /^[0-9]+$/,
      "the admin API returned no numeric one-time code",
    );
    return otp;
  };

  fixture.launch = async (engine) => {
    const launcher = LAUNCHERS[engine];
    assert.ok(launcher, `Unknown engine ${engine}.`);
    const browser = await launcher();
    browsers.push(browser);
    return {
      engine,
      browser,
      version: browser.version(),
      revision: REVISIONS[engine](),
      // Each page gets its own context, so two windows never share storage.
      // `pageErrors` are the application's own uncaught exceptions and must
      // always be empty. `errors` are console error lines, which include the
      // engine's own notice for a request the server refused — a deliberately
      // wrong code produces one — so a caller that expects a refusal checks
      // what they say rather than only that there are none.
      //
      // `locale` is pinned (spec 2026-10-05 §6): a first visit takes its
      // language from `navigator.languages`, so a machine whose browser runs
      // in Chinese would otherwise start an English story in Chinese. The one
      // phase that works in Chinese asks for its own.
      //
      // `permissions` are granted for the app's origin and `initScript` runs
      // in every document, both before the first one loads (the story's
      // clipboard check needs both on a window it signs in once).
      async newPage({
        viewport = { width: 1280, height: 900 },
        locale = "en-US",
        permissions = [],
        initScript = null,
      } = {}) {
        const context = await browser.newContext({ viewport, locale });
        if (permissions.length) await context.grantPermissions(permissions, { origin: appOrigin });
        if (initScript) await context.addInitScript(initScript);
        const page = await context.newPage();
        const errors = [];
        const pageErrors = [];
        page.on("pageerror", (error) =>
          pageErrors.push(String(error?.message ?? error)),
        );
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(appOrigin);
        return { context, page, errors, pageErrors };
      },
      close: () => browser.close(),
    };
  };

  fixture.close = async () => {
    const problems = [];
    for (const browser of browsers.splice(0))
      await browser.close().catch((error) => problems.push(error));
    try {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    } catch (error) {
      problems.push(error);
    }
    // The database fixture owns every Auth user and workspace this run made.
    await database.close();
    if (problems.length) throw problems[0];
  };

  return fixture;
}
