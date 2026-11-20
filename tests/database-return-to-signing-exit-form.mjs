import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseFixture, rejected } from "./support/database-fixture.mjs";

// The corrected values a staff member enters at Return to signing (054) are
// staff work: only a cleared staff member reads them, and no client writes them.
const EMPTY_FORM = { federal: null, state: null, local: [] };

const insertRow = (f, caseId, overrides = {}) => {
  const row = {
    workspace_id: f.workspaceId,
    case_id: caseId,
    entered_by_person_id: f.reviewerId,
    exit_form: JSON.stringify(EMPTY_FORM),
    remarks: null,
    ...overrides,
  };
  const keys = Object.keys(row);
  return f.sql(
    `insert into public.return_to_signing_exit_forms(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((key) => row[key]),
  );
};
const read = (client, caseId) =>
  client.from("return_to_signing_exit_forms").select("*").eq("case_id", caseId);

test("return_to_signing_exit_forms access and checks", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.preparedCase();
    await insertRow(f, caseId);

    await t.test("an applicant reads no corrected values", async () => {
      const { data, error } = await read(f.applicantA, caseId);
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });

    await t.test("a cleared staff member reads them", async () => {
      const { data, error } = await read(f.siteCoordinator, caseId);
      assert.equal(error, null);
      assert.equal(data.length, 1);
    });

    await t.test("an uncleared staff member reads none", async () => {
      const member = await f.staff({
        key: "ulla_uncleared_exit",
        name: "Ulla Brenner",
        capabilities: ["prepare"],
        cleared: false,
      });
      const { data, error } = await read(member.client, caseId);
      assert.equal(error, null);
      assert.deepEqual(data, []);
    });

    await t.test("staff can't insert directly", async () => {
      const { error } = await f.siteCoordinator.from("return_to_signing_exit_forms").insert({
        workspace_id: f.workspaceId,
        case_id: caseId,
        entered_by_person_id: f.reviewerId,
        exit_form: EMPTY_FORM,
      });
      assert.ok(error);
    });

    await t.test("exit_form must pass check_exit_form", async () => {
      await assert.rejects(
        insertRow(f, caseId, {
          exit_form: JSON.stringify({
            federal: {
              method: "efile",
              result: "refund",
              amount: "1.00",
              refundBy: "direct_deposit",
              accountNumber: "1",
            },
            state: null,
            local: [],
          }),
        }),
        rejected("23514"),
      );
    });

    await t.test("remarks over 2000 characters are refused", async () => {
      await assert.rejects(insertRow(f, caseId, { remarks: "x".repeat(2001) }), rejected("23514"));
      await assert.rejects(insertRow(f, caseId, { remarks: "" }), rejected("23514"));
    });
  } finally {
    await f.close();
  }
});
