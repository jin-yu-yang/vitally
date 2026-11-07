import test from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseFixture,
  rejected,
  PREPARER,
} from "./support/database-fixture.mjs";
import CATALOGUE from "../src/intake-catalogue-data.mjs";
import { missingToSubmit, isVisible } from "../src/intake-catalogue.mjs";
import { RULE_TYPES } from "../src/document-cards.mjs";

// Part 4b2, Task 4 (docs/superpowers/specs/2026-10-04-intake-redesign-design.md
// §3.7 and §6.3): server-side visits, case_document_cards and the two card
// actions of migration 017.

const TOP = CATALOGUE.steps.flatMap((step) =>
  step.sections.flatMap((section) => section.questions),
);
const HH = TOP.find((question) => question.id === "hh");
function sampleValue(question) {
  switch (question.type) {
    case "text":
    case "signature":
    case "longtext":
      return "Sample";
    case "email":
      return "sample@example.test";
    case "phone":
      return "2155550100";
    case "zip":
      return "19107";
    case "date":
      return "1980-01-02";
    case "year":
      return "2025";
    case "number":
      return String(question.min ?? 1);
    case "yesno":
      return "no";
    case "id":
      return crypto.randomUUID().replaceAll("-", "");
    case "who":
      return ["none"];
    case "multi":
      return [question.options[0].value];
    case "choice":
      return question.options[0].value;
    default:
      throw new Error(`no sample for ${question.type}`);
  }
}
// Every required, visible question answered: never married, no household.
function completeAnswers() {
  const answers = {
    marital_status: "never_married",
    has_household_members: "no",
    inc_self_employed: "yes",
  };
  for (let pass = 0; pass < 10; pass++) {
    let added = false;
    for (const question of TOP) {
      if (question.id in answers || !question.required) continue;
      if (!isVisible(question, answers)) continue;
      answers[question.id] =
        question.type === "group"
          ? [Object.fromEntries(HH.fields.map((field) => [field.id, sampleValue(field)]))]
          : sampleValue(question);
      added = true;
    }
    if (!added) break;
  }
  assert.deepEqual(missingToSubmit(2, answers, {}), []);
  return answers;
}

const HH_A = "a".repeat(32);
const caseRow = async (f, caseId) =>
  (await f.sql("select * from public.cases where id=$1", [caseId])).rows[0];
const cardRows = async (f, caseId) =>
  (
    await f.sql(
      "select slot_id, status, group_override from public.case_document_cards where case_id=$1 order by slot_id",
      [caseId],
    )
  ).rows;
// A case created empty, as every version-2 case is; the fixture's workspaces
// keep the column default, 2.
const v2Case = (f, actor = f.applicantA, options = {}) =>
  f.createCase(actor, crypto.randomUUID(), { answers: {}, ...options });
const visit = (f, caseId, visited, actor = f.applicantA) =>
  f.act(actor, caseId, "SAVE_ANSWERS", { answers: {}, visited });
const card = (f, actor, caseId, slotId, status) =>
  f.act(actor, caseId, "SET_DOCUMENT_CARD", { slotId, status });
const group = (f, actor, caseId, slotId, grp) =>
  f.act(actor, caseId, "SET_DOCUMENT_GROUP", { slotId, group: grp });
const readCards = async (client, caseId) => {
  const { data, error } = await client
    .from("case_document_cards")
    .select("slot_id")
    .eq("case_id", caseId);
  assert.equal(error, null);
  return data.map((row) => row.slot_id).sort();
};
// A case the client has submitted, so staff can see it.
async function submittedCase(f) {
  const { caseId } = await v2Case(f);
  await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: completeAnswers() });
  await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
  return caseId;
}

// A submitted version-2 case the Preparer prepares and the Reviewer reviews.
async function claimedCase(f) {
  const caseId = await submittedCase(f);
  await f.act(f.siteCoordinator, caseId, "START_SCREENING", {});
  await f.act(f.siteCoordinator, caseId, "VERIFY_INTAKE", { checks: f.intakeChecks });
  await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
  await f.act(f.preparer, caseId, "SUBMIT_REVIEW", { questionnaire: PREPARER });
  await f.act(f.reviewer, caseId, "CLAIM_REVIEW", {});
  return caseId;
}

test("visits and document cards on the server", async (t) => {
  const f = await createDatabaseFixture();
  try {
    await t.test("SAVE_ANSWERS stores visited sub-steps as a union", async () => {
      const { caseId } = await v2Case(f);
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, []);
      await visit(f, caseId, ["before.ready", "about.you"]);
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, ["about.you", "before.ready"]);
      await visit(f, caseId, ["about.address"]);
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, [
        "about.address",
        "about.you",
        "before.ready",
      ]);
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: {} });
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, [
        "about.address",
        "about.you",
        "before.ready",
      ]);
    });

    await t.test("a bad visited list is refused", async () => {
      const { caseId } = await v2Case(f);
      const sixtyFive = Array.from({ length: 65 }, () => "about.you");
      for (const visited of [["about.nowhere"], "about.you", [7], sixtyFive, [{}], ["About.you"]])
        await assert.rejects(visit(f, caseId, visited), rejected("VALIDATION"));
      await assert.rejects(
        f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: {}, visited: [], extra: 1 }),
        rejected("VALIDATION"),
      );
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, []);
      // Exactly 64 is accepted.
      await visit(f, caseId, Array.from({ length: 64 }, () => "about.you"));
    });

    await t.test("a stored id the catalogue no longer has is dropped on the next visit save", async () => {
      const { caseId } = await v2Case(f);
      await visit(f, caseId, ["about.you"]);
      await f.sql(
        "update public.cases set intake_visited = intake_visited || '{gone.step}' where id=$1",
        [caseId],
      );
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, ["about.you", "gone.step"]);
      // A save without `visited` leaves the list as it is.
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: {} });
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, ["about.you", "gone.step"]);
      await visit(f, caseId, ["before.ready"]);
      assert.deepEqual((await caseRow(f, caseId)).intake_visited, ["about.you", "before.ready"]);
    });

    await t.test("the client marks a card; the table names no person", async () => {
      const { caseId } = await v2Case(f);
      const before = await caseRow(f, caseId);
      await card(f, f.applicantA, caseId, "w2.household", "later");
      assert.deepEqual(await cardRows(f, caseId), [
        { slot_id: "w2.household", status: "later", group_override: null },
      ]);
      assert.equal(Number((await caseRow(f, caseId)).revision), Number(before.revision) + 1);
      const events = (
        await f.sql(
          "select detail from public.case_events where case_id=$1 and action='SET_DOCUMENT_CARD'",
          [caseId],
        )
      ).rows;
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].detail, { slotId: "w2.household", status: "later" });
      assert.equal(
        (
          await f.sql(
            "select count(*)::int as n from public.client_events where case_id=$1 and action='SET_DOCUMENT_CARD'",
            [caseId],
          )
        ).rows[0].n,
        0,
      );
      const columns = (
        await f.sql(
          "select column_name from information_schema.columns where table_schema='public' and table_name='case_document_cards' order by column_name",
        )
      ).rows.map((row) => row.column_name);
      assert.deepEqual(
        columns,
        ["workspace_id", "case_id", "slot_id", "status", "group_override", "changed_at"].sort(),
      );
    });

    await t.test("Not done sets the status to null and keeps the row", async () => {
      const { caseId } = await v2Case(f);
      await card(f, f.applicantA, caseId, "w2.household", "none");
      await card(f, f.applicantA, caseId, "w2.household", "not_done");
      const rows = await cardRows(f, caseId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, null);
      await card(f, f.applicantA, caseId, `ssn.hh.${HH_A}`, "later");
      await card(f, f.applicantA, caseId, "ssn.tp", "none");
      await card(f, f.applicantA, caseId, "ssn.sp", "none");
      assert.equal((await cardRows(f, caseId)).length, 4);
    });

    await t.test("a card action must name a known slot, owner and status", async () => {
      const { caseId } = await v2Case(f);
      const revision = (await caseRow(f, caseId)).revision;
      const bad = [
        { slotId: "nope.household", status: "later" },
        { slotId: "w2.tp", status: "later" },
        { slotId: "photo_id.household", status: "later" },
        { slotId: "w2.hh.abc", status: "later" },
        { slotId: "w2", status: "later" },
        { slotId: "W2.household", status: "later" },
        { slotId: "w2.household", status: "maybe" },
        { slotId: "w2.household", status: null },
        { slotId: 7, status: "later" },
        { slotId: "w2.household", status: "later", extra: 1 },
        { slotId: "w2.household" },
      ];
      for (const payload of bad)
        await assert.rejects(
          f.act(f.applicantA, caseId, "SET_DOCUMENT_CARD", payload),
          rejected("VALIDATION"),
          JSON.stringify(payload),
        );
      await assert.rejects(
        f.act(f.applicantA, caseId, "SET_DOCUMENT_CARD", { slotId: "ssn.household", status: "later" }),
        rejected("VALIDATION"),
      );
      await card(f, f.applicantA, caseId, "photo_id.tp", "later");
      assert.deepEqual(await cardRows(f, caseId).then((rows) => rows.length), 1);
      assert.equal(Number((await caseRow(f, caseId)).revision), Number(revision) + 1);
    });

    await t.test("staff may mark a card on an office draft and on a submitted case", async () => {
      const office = await v2Case(f, f.siteCoordinator, { mode: "assisted" });
      await card(f, f.siteCoordinator, office.caseId, "w2.household", "later");
      assert.deepEqual(await cardRows(f, office.caseId), [
        { slot_id: "w2.household", status: "later", group_override: null },
      ]);
      // The Preparer neither is nor will be this case's preparer here: refused for not
      // working on the case (018), not for lacking a capability.
      await assert.rejects(
        card(f, f.preparer, office.caseId, "w2.household", "none"),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        group(f, f.preparer, office.caseId, "w2.household", "needed"),
        rejected("FORBIDDEN"),
      );
      assert.equal((await cardRows(f, office.caseId)).length, 1);
      // Office staff may move a card on an office draft too.
      await group(f, f.siteCoordinator, office.caseId, "w2.household", "needed");
      assert.deepEqual(await cardRows(f, office.caseId), [
        { slot_id: "w2.household", status: "later", group_override: "needed" },
      ]);
      // The client cannot mark a card on a case that is not theirs.
      await assert.rejects(
        card(f, f.applicantA, office.caseId, "w2.household", "none"),
        (error) => ["FORBIDDEN", "NOT_FOUND"].includes(error.code),
      );

      const caseId = await submittedCase(f);
      await card(f, f.siteCoordinator, caseId, "ssn.tp", "none");
      assert.deepEqual(await cardRows(f, caseId), [
        { slot_id: "ssn.tp", status: "none", group_override: null },
      ]);
      // The client can still mark one after submitting.
      await card(f, f.applicantA, caseId, "ssn.sp", "later");
      assert.equal((await cardRows(f, caseId)).length, 2);
    });

    await t.test("staff are refused on the client's unsent draft", async () => {
      const { caseId } = await v2Case(f);
      for (const [client, type, payload] of [
        [f.siteCoordinator, "SET_DOCUMENT_CARD", { slotId: "w2.household", status: "later" }],
        [f.siteCoordinator, "SET_DOCUMENT_GROUP", { slotId: "w2.household", group: "needed" }],
      ])
        await assert.rejects(
          f.act(client, caseId, type, payload),
          (error) => ["FORBIDDEN", "NOT_FOUND"].includes(error.code),
        );
      assert.deepEqual(await cardRows(f, caseId), []);
    });

    await t.test("a volunteer who does not work on the case may not mark a card", async () => {
      // Alex has the prepare capability but no claim on this case. Until 018 he
      // was refused for lacking admin; now it is works_on_case that refuses him.
      const caseId = await submittedCase(f);
      await assert.rejects(
        card(f, f.preparer, caseId, "w2.household", "later"),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        card(f, f.reviewer, caseId, "w2.household", "later"),
        rejected("FORBIDDEN"),
      );
      assert.deepEqual(await cardRows(f, caseId), []);
    });

    await t.test("the preparer and the reviewer may mark and move; others on that case may not", async () => {
      const caseId = await claimedCase(f);
      const slot = `ssn.hh.${HH_A}`;
      // Alex as its preparer.
      await card(f, f.preparer, caseId, "w2.household", "later");
      await group(f, f.preparer, caseId, slot, "needed");
      // Morgan as its reviewer.
      await card(f, f.reviewer, caseId, "ssn.tp", "none");
      await group(f, f.reviewer, caseId, slot, "maybe");
      assert.deepEqual(await cardRows(f, caseId), [
        { slot_id: slot, status: null, group_override: null },
        { slot_id: "ssn.tp", status: "none", group_override: null },
        { slot_id: "w2.household", status: "later", group_override: null },
      ]);
      // Alex on a case he does not prepare is still refused, and nothing is written.
      const other = await submittedCase(f);
      await assert.rejects(
        card(f, f.preparer, other, "w2.household", "later"),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        group(f, f.preparer, other, "w2.household", "needed"),
        rejected("FORBIDDEN"),
      );
      assert.deepEqual(await cardRows(f, other), []);
      // Sam (office) may on any submitted case.
      await card(f, f.siteCoordinator, other, "w2.household", "later");
      await group(f, f.siteCoordinator, other, "w2.household", "needed");
      assert.equal((await cardRows(f, other)).length, 1);
      // The client's own mark is unchanged.
      await card(f, f.applicantA, other, "ssn.tp", "later");
      assert.equal((await cardRows(f, other)).length, 2);
    });

    await t.test("the preparer is refused once the case is closed", async () => {
      const caseId = await claimedCase(f);
      await f.act(f.siteCoordinator, caseId, "CLOSE_CASE", { confirmed: true, reason: "other", note: "Test close." });
      await assert.rejects(
        card(f, f.preparer, caseId, "w2.household", "later"),
        rejected("INVALID_TRANSITION"),
      );
      await assert.rejects(
        group(f, f.reviewer, caseId, "w2.household", "needed"),
        rejected("INVALID_TRANSITION"),
      );
      assert.deepEqual(await cardRows(f, caseId), []);
    });

    await t.test("SET_DOCUMENT_GROUP moves a card up and, only then, back down", async () => {
      const caseId = await submittedCase(f);
      const slot = `ssn.hh.${HH_A}`;
      const before = Number((await caseRow(f, caseId)).revision);
      await group(f, f.siteCoordinator, caseId, slot, "needed");
      assert.deepEqual(await cardRows(f, caseId), [
        { slot_id: slot, status: null, group_override: "needed" },
      ]);
      assert.equal(Number((await caseRow(f, caseId)).revision), before + 1);
      await group(f, f.siteCoordinator, caseId, slot, "maybe");
      assert.deepEqual(await cardRows(f, caseId), [
        { slot_id: slot, status: null, group_override: null },
      ]);
      // Nothing left to move back down.
      await assert.rejects(group(f, f.siteCoordinator, caseId, slot, "maybe"), rejected("VALIDATION"));
      await assert.rejects(
        group(f, f.siteCoordinator, caseId, "w2.household", "maybe"),
        rejected("VALIDATION"),
      );
      // A status mark keeps the override it sits beside.
      await group(f, f.siteCoordinator, caseId, "w2.household", "needed");
      await card(f, f.siteCoordinator, caseId, "w2.household", "later");
      assert.deepEqual(
        (await cardRows(f, caseId)).find((row) => row.slot_id === "w2.household"),
        { slot_id: "w2.household", status: "later", group_override: "needed" },
      );
      for (const payload of [
        { slotId: slot, group: "optional" },
        { slotId: slot },
        { slotId: slot, group: "needed", extra: 1 },
        { slotId: "w2.tp", group: "needed" },
      ])
        await assert.rejects(
          f.act(f.siteCoordinator, caseId, "SET_DOCUMENT_GROUP", payload),
          rejected("VALIDATION"),
        );
    });

    await t.test("SET_DOCUMENT_GROUP is for staff who work on the case only", async () => {
      const caseId = await submittedCase(f);
      await assert.rejects(
        group(f, f.applicantA, caseId, "w2.household", "needed"),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        group(f, f.preparer, caseId, "w2.household", "needed"),
        rejected("FORBIDDEN"),
      );
      await assert.rejects(
        group(f, f.reviewer, caseId, "w2.household", "needed"),
        rejected("FORBIDDEN"),
      );
      assert.deepEqual(await cardRows(f, caseId), []);
    });

    await t.test("both actions are refused on a closed case", async () => {
      const caseId = await submittedCase(f);
      await group(f, f.siteCoordinator, caseId, "w2.household", "needed");
      await f.act(f.siteCoordinator, caseId, "CLOSE_CASE", { confirmed: true, reason: "other", note: "Test close." });
      assert.equal((await caseRow(f, caseId)).stage, "closed");
      await assert.rejects(
        card(f, f.siteCoordinator, caseId, "ssn.tp", "none"),
        rejected("INVALID_TRANSITION"),
      );
      await assert.rejects(
        group(f, f.siteCoordinator, caseId, "w2.household", "maybe"),
        rejected("INVALID_TRANSITION"),
      );
      await assert.rejects(
        card(f, f.applicantA, caseId, "ssn.tp", "none"),
        rejected("INVALID_TRANSITION"),
      );
      assert.equal((await cardRows(f, caseId)).length, 1);
    });

    await t.test("who may read card rows", async () => {
      const { caseId } = await v2Case(f);
      await card(f, f.applicantA, caseId, "w2.household", "later");
      await card(f, f.applicantA, caseId, "ssn.tp", "none");
      assert.deepEqual(await readCards(f.applicantA, caseId), ["ssn.tp", "w2.household"]);
      assert.deepEqual(await readCards(f.applicantB, caseId), []);
      assert.deepEqual(await readCards(f.presenter, caseId), []);
      await f.act(f.applicantA, caseId, "SAVE_ANSWERS", { answers: completeAnswers() });
      await f.act(f.applicantA, caseId, "SUBMIT", { confirmed: true });
      assert.deepEqual(await readCards(f.presenter, caseId), ["ssn.tp", "w2.household"]);
      assert.deepEqual(await readCards(f.applicantB, caseId), []);
    });

    await t.test("the table is in the realtime publication", async () => {
      const rows = (
        await f.sql(
          "select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='case_document_cards'",
        )
      ).rows;
      assert.equal(rows.length, 1);
    });

    await t.test("the SQL rule list equals RULE_TYPES", async () => {
      const rows = (
        await f.sql("select rule_id, card_type from vitally_private.document_card_rules() order by rule_id")
      ).rows.map((row) => [row.rule_id, row.card_type]);
      const expected = [...RULE_TYPES].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      // The database sorts by collation; compare as sets of pairs, sorted the same way.
      const sortPairs = (pairs) => pairs.map((pair) => pair.join("|")).sort();
      assert.equal(rows.length, 46);
      assert.deepEqual(sortPairs(rows), sortPairs(expected));
    });
  } finally {
    await f.close();
  }
});
