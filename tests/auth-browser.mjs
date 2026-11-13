import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createBrowserFixture,
  createSendRoute,
  requestCode,
  loginTestUser,
  submitVerificationCode,
  APP_COOLDOWN_SECONDS,
} from "./support/browser-fixture.mjs";
import { redactAddresses, WORK_BOARD_HEADING } from "./support/story-pages.mjs";
import { NEUTRAL_SEND_MESSAGE } from "../src/auth.mjs";

// Task 5A: the early two-engine Auth compatibility gate.
//
// A confirmed synthetic user signs in through the **real** form with an
// admin-generated one-time code and the **real** verify endpoint, in real
// Chrome and real Firefox, before Task 10A builds the application story on the
// same helper. Only `/auth/v1/otp` is answered by automation, so nothing ever
// asks a mail server for anything; `/auth/v1/verify` is untouched, so a passing
// login is a real login.
//
// Nothing here logs an address, a code or a token. The diagnostics each engine
// prints are Auth *error codes*, counts and versions — the sanitized evidence
// `docs/setup.md` records.

// The message the access screen must show for every syntactically valid
// address, known or not. Written out rather than imported alone, so the copy
// itself is pinned and the module is checked against it.
const NEUTRAL_LITERAL =
  "If this address is eligible, check your inbox for a sign-in code.";

// Task 5's AUTH_INVALID_CODE copy.
const INVALID_CODE_MESSAGE =
  "That code is invalid or has expired. Request a new code.";

// Two wrong codes. `246810` is the prototype's deleted fixed code (R40): it
// must be refused exactly like any other wrong number.
const INVALID_CODES = Object.freeze(["000000", "246810"]);

// The verified server-side minimum interval between emails for one address.
const SEND_INTERVAL_MS = 60_000;
// The bounded wait when a repeat generation is refused: the interval plus a
// margin, and never more than this. Limits are never lowered to pass a test.
const REPEAT_WAIT_MS = 65_000;
const REPEAT_WAIT_CEILING_MS = 75_000;

// The setup screen an uncleared staff member signs in to (change
// add-volunteer-clearance), and the site coordinator it names: the fixture's
// default follow-up person.
const SETUP_HEADING = "Finish your setup for this season";
const SITE_COORDINATOR_NAME = "Avery Lin";

// How long the countdown regression guard waits for two seconds to pass.
const COUNTDOWN_TICK_TIMEOUT_MS = 10_000;

// Enough for a database fixture, two contexts, and the bounded repeat wait.
const ENGINE_TIMEOUT_MS = 300_000;

test("the neutral send message is exactly the copy this gate asserts", () => {
  assert.equal(NEUTRAL_SEND_MESSAGE, NEUTRAL_LITERAL);
});

// ---------------------------------------------------------------------------
// The intercepted send handler, exercised directly
// ---------------------------------------------------------------------------

// A stand-in for Playwright's Route, so the OPTIONS branch and the
// unexpected-method refusal are covered even though neither browser was
// observed to surface a preflight to the handler.
function fakeRoute({ method, origin, body }) {
  const record = { fulfilled: [], aborted: 0 };
  record.request = () => ({
    method: () => method,
    headers: () => (origin === undefined ? {} : { origin }),
    postDataJSON: () => body ?? null,
  });
  record.fulfill = async (options) => {
    record.fulfilled.push(options);
  };
  record.abort = async () => {
    record.aborted += 1;
  };
  return record;
}

const CORS_HEADERS = Object.freeze({
  "access-control-allow-origin": "http://127.0.0.1:4173",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "apikey, authorization, content-type, x-client-info, x-supabase-api-version",
  vary: "Origin",
});

test("a preflight is answered without consuming the send", async () => {
  const frontendOrigin = "http://127.0.0.1:4173";
  const route = createSendRoute({ frontendOrigin });

  const preflight = fakeRoute({ method: "OPTIONS", origin: frontendOrigin });
  await route.handler(preflight);
  assert.deepEqual(route.failures, []);
  assert.equal(route.preflights, 1);
  // The whole reason there is no `times:1`: a preflight is not a send.
  assert.equal(route.posts, 0);
  assert.equal(preflight.aborted, 0);
  assert.deepEqual(preflight.fulfilled, [
    { status: 204, headers: CORS_HEADERS },
  ]);

  const send = fakeRoute({
    method: "POST",
    origin: frontendOrigin,
    body: { email: "someone@vitally.invalid", create_user: false },
  });
  await route.handler(send);
  assert.deepEqual(route.failures, []);
  assert.equal(route.posts, 1);
  assert.equal(send.fulfilled.length, 1);
  assert.equal(send.fulfilled[0].status, 200);
  assert.equal(send.fulfilled[0].body, "{}");
  assert.deepEqual(send.fulfilled[0].headers, CORS_HEADERS);
});

test("an unexpected method, a second send and a foreign origin are refused", async () => {
  const frontendOrigin = "http://127.0.0.1:4173";
  const route = createSendRoute({ frontendOrigin });

  const other = fakeRoute({ method: "PUT", origin: frontendOrigin });
  await route.handler(other);
  assert.equal(route.failures.length, 1);
  assert.match(route.failures[0].message, /unexpected method/);
  // Refused, never forwarded to the real Auth server, and never counted.
  assert.equal(other.aborted, 1);
  assert.deepEqual(other.fulfilled, []);
  assert.equal(route.posts, 0);

  const first = fakeRoute({
    method: "POST",
    origin: frontendOrigin,
    body: { create_user: false },
  });
  await route.handler(first);
  assert.equal(route.posts, 1);
  const second = fakeRoute({
    method: "POST",
    origin: frontendOrigin,
    body: { create_user: false },
  });
  await route.handler(second);
  assert.equal(route.failures.length, 2);
  assert.match(route.failures[1].message, /more than one code request/);
  assert.equal(second.aborted, 1);

  const strangers = createSendRoute({ frontendOrigin });
  const stranger = fakeRoute({
    method: "POST",
    origin: "http://example.invalid",
    body: { create_user: false },
  });
  await strangers.handler(stranger);
  assert.equal(strangers.failures.length, 1);
  assert.match(strangers.failures[0].message, /unexpected origin/);
  assert.equal(stranger.aborted, 1);

  // A send that forgot `shouldCreateUser:false` is refused too.
  const creating = createSendRoute({ frontendOrigin });
  const creates = fakeRoute({
    method: "POST",
    origin: frontendOrigin,
    body: { email: "someone@vitally.invalid" },
  });
  await creating.handler(creates);
  assert.equal(creating.failures.length, 1);
  assert.match(creating.failures[0].message, /create_user:false/);
  assert.equal(creates.aborted, 1);
});

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

// Scenario 3: wrong codes through the real form, with no fixed-code bypass.
async function refuseInvalidCodes({ page, actor, fixture, restart }) {
  const { release } = await requestCode({
    page,
    fixture,
    address: actor.email,
  });
  let pending = null;
  try {
    for (const [index, code] of INVALID_CODES.entries()) {
      // Every attempt after the first starts from a freshly rendered code step
      // (restored from the window's access record), so the refusal asserted
      // below can only be this attempt's and never the previous one's.
      if (index > 0) await restart();
      await page.getByLabel("Verification code", { exact: true }).waitFor();
      await submitVerificationCode({ page, code });
      const failure = page.locator("#code-form p.error[role='alert']");
      await failure.waitFor();
      assert.equal((await failure.innerText()).trim(), INVALID_CODE_MESSAGE);
      // Still on the code step, and nothing was signed in.
      await page.getByLabel("Verification code", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "My applications", exact: true })
          .count(),
        0,
      );
    }
    const survivedSeconds = await assertCodeSurvivesCountdown(page);
    // The same refusal, read at the source, so the sanitized code is observed
    // rather than inferred from the copy.
    const direct = await fixture
      .anonClient()
      .auth.verifyOtp({
        email: actor.email,
        token: INVALID_CODES[0],
        type: "email",
      });
    assert.ok(direct.error, "an invalid code authenticated");
    assert.equal(direct.data?.session ?? null, null);
    return {
      code: direct.error.code ?? `status ${direct.error.status}`,
      survivedSeconds,
    };
  } catch (error) {
    pending = error;
    throw error;
  } finally {
    await release({ pending });
  }
}

// The regression guard for the defect this gate originally found: the resend
// countdown used to rebuild the whole access screen once a second, and the
// rebuilt code field was rendered blank, so a code typed in one tick was gone
// in the next and the form then silently submitted nothing.
//
// Run on a page sitting on the code step: type a value, wait — by condition,
// not by clock — for the countdown to advance at least two seconds, and assert
// the value is still there. Both halves matter: a countdown that stopped
// ticking would make the survival prove nothing. Returns the seconds observed.
async function assertCodeSurvivesCountdown(page) {
  const probe = "135790";
  const field = page.getByLabel("Verification code", { exact: true });
  const resend = page.locator("[data-action='resend-code']");
  const secondsLeft = async () =>
    Number(/\d+/.exec((await resend.innerText()).trim())?.[0] ?? NaN);
  await field.fill(probe);
  const before = await secondsLeft();
  assert.ok(
    Number.isFinite(before) && before > 2,
    `the resend countdown is not running (${before}), so this proves nothing`,
  );
  await page.waitForFunction(
    (limit) => {
      const button = document.querySelector("[data-action='resend-code']");
      const left = Number(/\d+/.exec(button?.textContent ?? "")?.[0] ?? NaN);
      return Number.isFinite(left) && left <= limit;
    },
    before - 2,
    { timeout: COUNTDOWN_TICK_TIMEOUT_MS },
  );
  assert.equal(
    await field.inputValue(),
    probe,
    "the resend countdown cleared the code the visitor typed",
  );
  await field.fill("");
  return before - (await secondsLeft());
}

// Every row an unknown request could conceivably add, counted over the two
// workspaces this run owns. Scoped rather than global so a parallel run on the
// same stack cannot move the numbers.
async function runOwnedRowCounts(fixture) {
  const { database } = fixture;
  const scope = [database.workspaceId, database.foreignWorkspaceId];
  const { rows } = await database.sql(
    `select
       (select count(*) from public.workspaces where id = any($1))::int as workspaces,
       (select count(*) from public.cases where workspace_id = any($1))::int as cases,
       (select count(*) from public.people where workspace_id = any($1))::int as people,
       (select count(*) from public.memberships where workspace_id = any($1))::int as memberships`,
    [scope],
  );
  return rows[0];
}

// Scenario 6: an address with no account. Nothing may be created by asking —
// no user, no session, and no case, person, membership or workspace either.
async function refuseUnknownAddress(fixture) {
  const email = `unknown-${randomUUID()}@vitally.invalid`;
  const before = await runOwnedRowCounts(fixture);
  const send = await fixture.anonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  const signup = await fixture.anonClient().auth.signUp({
    email,
    password: randomBytes(32).toString("base64url"),
  });
  // Precise, and it enumerates nothing: one count for one address through the
  // privileged connection, never a listUsers sweep.
  const users = await fixture.database.sql(
    "select count(*)::int as count from auth.users where email=$1",
    [email],
  );
  const after = await runOwnedRowCounts(fixture);
  assert.ok(send.error, "an unknown address was accepted for a code");
  assert.equal(send.data?.session ?? null, null);
  assert.equal(send.data?.user ?? null, null);
  assert.ok(signup.error, "public signup is open");
  assert.equal(signup.data?.session ?? null, null);
  assert.equal(signup.data?.user ?? null, null);
  assert.equal(users.rows[0].count, 0, "an unknown request created a user");
  assert.deepEqual(after, before, "an unknown request created application rows");
  return {
    send: send.error.code ?? `status ${send.error.status}`,
    signup: signup.error.code ?? `status ${signup.error.status}`,
    rowsUnchanged: before,
  };
}

// Scenario 8: the access screen must read the same for a known and an unknown
// address. The address the visitor typed is echoed back to them by design, and
// the countdown ticks, so both are normalized before the two screens are
// compared; everything else must be identical.
function normalizeAccessScreen(text, address) {
  return text
    .split(address)
    .join("<address>")
    .replace(/Resend code in \d+s/g, "Resend code in Ns")
    .replace(/another code in \d+ seconds/g, "another code in N seconds");
}

async function readNeutralAccessScreen({ engine, fixture, address }) {
  const { context, page, errors, pageErrors } = await engine.newPage();
  const { release } = await requestCode({ page, fixture, address });
  let pending = null;
  try {
    const message = page.getByText(NEUTRAL_LITERAL, { exact: true });
    assert.equal((await message.innerText()).trim(), NEUTRAL_LITERAL);
    // The resend control is disabled and counting down immediately.
    const resend = page.locator("[data-action='resend-code']");
    await resend.waitFor();
    const label = (await resend.innerText()).trim();
    assert.match(label, /^Resend code in \d+s$/);
    assert.equal(await resend.isDisabled(), true);
    const seconds = Number(/\d+/.exec(label)[0]);
    assert.ok(
      seconds > 0 && seconds <= APP_COOLDOWN_SECONDS,
      `countdown out of range: ${seconds}`,
    );
    // Masked before the text enters this process: the two screens are compared
    // by equality, so a difference prints both, and the address the page echoes
    // back is the one thing on them that must never reach a test report.
    const screen = normalizeAccessScreen(
      redactAddresses(await page.locator("#main").innerText()),
      address,
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(errors, []);
    return { screen, seconds };
  } catch (error) {
    pending = error;
    throw error;
  } finally {
    // Release before the context goes, so the route's own counters are still
    // readable and an unroute is still possible.
    await release({ pending });
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// The gate, once per engine
// ---------------------------------------------------------------------------

async function runEngineGate(t, engineName) {
  const fixture = await createBrowserFixture();
  const observed = { engine: engineName };
  try {
    const engine = await fixture.launch(engineName);
    observed.version = engine.version;
    observed.playwrightBuild = engine.revision;
    try {
      const applicantA = fixture.actor("applicantA");
      const applicantB = fixture.actor("applicantB");
      const main = await engine.newPage();
      let firstOtp = null;
      let returnOtp = null;
      let generatedAt = 0;

      await t.test(
        "a confirmed applicant signs in through the real form with a generated code",
        async () => {
          generatedAt = Date.now();
          const login = await loginTestUser({
            page: main.page,
            actor: applicantA,
            fixture,
          });
          assert.equal(login.posts, 1);
          firstOtp = login.otp;
          observed.firstLogin = {
            posts: login.posts,
            preflights: login.preflights,
          };
        },
      );

      await t.test("the used one-time code cannot authenticate again", async () => {
        const reuse = await fixture.anonClient().auth.verifyOtp({
          email: applicantA.email,
          token: firstOtp,
          type: "email",
        });
        assert.ok(reuse.error, "a spent one-time code authenticated again");
        assert.equal(reuse.data?.session ?? null, null);
        observed.reusedCode = reuse.error.code ?? `status ${reuse.error.status}`;
      });

      // The fact the earlier probe did not establish. Either outcome is
      // recorded rather than asserted; the return visit below handles both.
      await t.test(
        "repeat generation for the same user inside the send interval is measured",
        async () => {
          const elapsed = Date.now() - generatedAt;
          assert.ok(
            elapsed < SEND_INTERVAL_MS,
            `the repeat generation was ${elapsed}ms after the first, outside the ${SEND_INTERVAL_MS}ms interval this measures`,
          );
          const repeat = await fixture.generateLink(applicantA.email);
          observed.repeatGeneration = {
            afterMs: elapsed,
            outcome: repeat.error
              ? (repeat.error.code ?? `status ${repeat.error.status}`)
              : "accepted",
          };
          if (!repeat.error) {
            const otp = repeat.data?.properties?.email_otp;
            assert.match(String(otp), /^[0-9]+$/);
            observed.returnOtpSource = "repeat generation inside the interval";
            t.diagnostic(
              `${engineName}: repeat generateLink inside the interval was accepted`,
            );
            returnOtp = otp;
          } else {
            observed.returnOtpSource = "generation after the bounded wait";
            t.diagnostic(
              `${engineName}: repeat generateLink inside the interval was refused (${observed.repeatGeneration.outcome})`,
            );
          }
        },
      );

      await t.test(
        "the same user signs out and returns through the real form",
        async () => {
          await main.page
            .getByRole("button", { name: "Sign out", exact: true })
            .click();
          await main.page.getByLabel("Email address", { exact: true }).waitFor();
          // A reload, not a new identity: the window's access record is already
          // gone (a completed sign-in drops it), and a fresh page gives the auth
          // module a fresh in-memory resend cooldown, so the return visit really
          // does send a request.
          await main.page.goto(fixture.appOrigin);
          let otp = returnOtp;
          if (!otp) {
            // The configured interval plus a margin, and never more than the
            // ceiling. A limit is waited out, never lowered.
            const waitMs = REPEAT_WAIT_MS;
            assert.ok(
              waitMs <= REPEAT_WAIT_CEILING_MS,
              "the bounded wait exceeds its ceiling",
            );
            t.diagnostic(
              `${engineName}: waiting ${waitMs}ms for the configured send interval before the return code`,
            );
            await delay(waitMs);
            otp = await fixture.generateOtp(applicantA.email);
            observed.repeatGeneration = {
              ...(observed.repeatGeneration ?? {}),
              waitedMs: waitMs,
            };
          }
          const started = Date.now();
          const login = await loginTestUser({
            page: main.page,
            actor: applicantA,
            fixture,
            otp,
          });
          assert.equal(login.posts, 1);
          observed.returnLogin = {
            posts: login.posts,
            verifiedMs: Date.now() - started,
          };
        },
      );

      await t.test(
        "an invalid code leaves the form on the code step",
        async () => {
          const invalid = await engine.newPage();
          try {
            const refusal = await refuseInvalidCodes({
              page: invalid.page,
              actor: applicantB,
              fixture,
              restart: () => invalid.page.goto(fixture.appOrigin),
            });
            observed.invalidCode = refusal.code;
            observed.codeSurvivedCountdownSeconds = refusal.survivedSeconds;
            // The application itself never throws. The only console lines this
            // page may produce are the engine's own notices for the refused
            // verifications, which are the point of the test.
            assert.deepEqual(invalid.pageErrors, []);
            assert.ok(
              invalid.errors.length <= INVALID_CODES.length,
              `unexpected console errors: ${invalid.errors.length}`,
            );
            for (const line of invalid.errors)
              assert.match(line, /\b403\b/, "an unexplained console error");
            observed.refusedVerifyConsoleLines = invalid.errors.length;
          } finally {
            await invalid.context.close();
          }
        },
      );

      await t.test(
        "a known address asked again inside the send interval is refused",
        async () => {
          await fixture.generateOtp(applicantB.email);
          const send = await fixture.anonClient().auth.signInWithOtp({
            email: applicantB.email,
            options: { shouldCreateUser: false },
          });
          observed.knownSendInsideInterval = send.error
            ? (send.error.code ?? `status ${send.error.status}`)
            : "accepted";
          assert.equal(send.data?.session ?? null, null);
          assert.equal(
            observed.knownSendInsideInterval,
            "over_email_send_rate_limit",
          );
        },
      );

      await t.test(
        "an unknown address creates nothing and public signup stays closed",
        async () => {
          observed.unknownAddress = await refuseUnknownAddress(fixture);
          assert.equal(observed.unknownAddress.send, "otp_disabled");
        },
      );

      // Clearance (change add-volunteer-clearance): a staff member with no
      // roles signs in to the setup screen and no work board; a cleared one
      // signs in to the work board. Each in a window of its own.
      await t.test(
        "an uncleared staff member signs in to the setup screen, with no work board",
        async () => {
          const uncleared = await fixture.database.staff({
            key: "uncleared_preparer",
            name: "Dana Whitfield",
            capabilities: ["prepare"],
            cleared: false,
          });
          const win = await engine.newPage();
          try {
            await loginTestUser({
              page: win.page,
              actor: { key: "uncleared_preparer", email: uncleared.email, userId: uncleared.userId },
              fixture,
              heading: SETUP_HEADING,
            });
            const main = win.page.locator("#main");
            await main.getByText("Upload your signed Form 13615.", { exact: true }).waitFor();
            await main
              .getByText(`Ask ${SITE_COORDINATOR_NAME}, your site coordinator.`, { exact: true })
              .waitFor();
            assert.equal(
              await win.page.getByRole("button", { name: "Check again", exact: true }).count(),
              1,
              "the setup screen has no Check again",
            );
            assert.equal(
              await win.page.getByRole("heading", { name: WORK_BOARD_HEADING, exact: true }).count(),
              0,
              "an uncleared staff member sees the work board",
            );
            assert.equal(
              await win.page.locator('[data-action="open-volunteers"]').count(),
              0,
              "a staff member without admin is offered the Roster",
            );
            assert.deepEqual(win.pageErrors, []);
            assert.deepEqual(win.errors.map(redactAddresses), []);
          } finally {
            await win.context.close();
          }
        },
      );

      await t.test("a cleared staff member signs in to the work board", async () => {
        const win = await engine.newPage();
        try {
          await loginTestUser({
            page: win.page,
            actor: fixture.actor("preparer"),
            fixture,
            heading: WORK_BOARD_HEADING,
          });
          assert.equal(
            await win.page.getByRole("heading", { name: SETUP_HEADING, exact: true }).count(),
            0,
            "a cleared staff member sees the setup screen",
          );
          assert.deepEqual(win.pageErrors, []);
          assert.deepEqual(win.errors.map(redactAddresses), []);
        } finally {
          await win.context.close();
        }
      });

      if (engineName === "chrome")
        await t.test(
          "a known and an unknown address get the same access screen",
          async () => {
            const known = await readNeutralAccessScreen({
              engine,
              fixture,
              address: applicantA.email,
            });
            const unknown = await readNeutralAccessScreen({
              engine,
              fixture,
              address: `unknown-${randomUUID()}@vitally.invalid`,
            });
            assert.equal(known.screen, unknown.screen);
            assert.ok(known.screen.includes(NEUTRAL_LITERAL));
            observed.neutralScreensIdentical = true;
          },
        );

      assert.deepEqual(main.pageErrors, []);
      assert.deepEqual(main.errors, []);
    } finally {
      await engine.close();
    }
  } finally {
    // Recorded even when the gate fails: a partial observation is what says
    // how far it got.
    t.diagnostic(`evidence ${JSON.stringify(observed)}`);
    await fixture.close();
  }
}

test(
  "Chrome: the real form signs a confirmed user in with a generated code",
  { timeout: ENGINE_TIMEOUT_MS },
  (t) => runEngineGate(t, "chrome"),
);

test(
  "Firefox: the real form signs a confirmed user in with a generated code",
  { timeout: ENGINE_TIMEOUT_MS },
  (t) => runEngineGate(t, "firefox"),
);
