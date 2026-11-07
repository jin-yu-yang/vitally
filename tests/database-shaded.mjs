import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDatabaseFixture, applyArgs, rejected } from "./support/database-fixture.mjs";
import { SHADED_FIELDS } from "../src/shaded-fields.mjs";

const MIGRATION = new URL("../supabase/migrations/039_preparer_shaded_fields.sql", import.meta.url);
const ASTRAL = "\u{1F600}"; // one character, two UTF-16 units

const insertShaded = (f, caseId, fields, overrides = {}) => {
  const row = {
    workspace_id: f.workspaceId,
    case_id: caseId,
    fields: JSON.stringify(fields),
    version: 1,
    updated_by_person_id: f.morgan,
    ...overrides,
  };
  const keys = Object.keys(row);
  return f.sql(
    `insert into public.preparer_shaded_fields(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((key) => row[key]),
  );
};

const checkViolation = (error) => error.code === "23514" || /check/i.test(String(error.message));
// One SQLSTATE and the constraint or column it names (the driver's error is the cause).
const violates = (code, where) => (error) =>
  error.code === code && Object.entries(where).every(([key, value]) => error.cause?.[key] === value);

test("shaded table is staff-only", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.preparedCase();
    await insertShaded(f, caseId, { incomeW2s: true, incomeW2sCount: 2 });
    const applicant = await f.applicantA.from("preparer_shaded_fields").select("*").eq("case_id", caseId);
    assert.equal(applicant.error, null);
    assert.deepEqual(applicant.data, []);
    const staff = await f.presenter.from("preparer_shaded_fields").select("*").eq("case_id", caseId);
    assert.equal(staff.error, null);
    assert.equal(staff.data.length, 1);
    assert.deepEqual(staff.data[0].fields, { incomeW2s: true, incomeW2sCount: 2 });
    // Only the action RPC writes the row: service_role may read and delete it,
    // but not write it directly (its shape check is not executable there).
    const privileges = (
      await f.sql(
        "select has_table_privilege('service_role','public.preparer_shaded_fields',p) as granted, p from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p",
      )
    ).rows;
    assert.deepEqual(Object.fromEntries(privileges.map((row) => [row.p, row.granted])), {
      SELECT: true, INSERT: false, UPDATE: false, DELETE: true,
    });
    for (const client of [f.applicantA, f.presenter]) {
      assert.ok(
        (
          await client
            .from("preparer_shaded_fields")
            .insert({ workspace_id: f.workspaceId, case_id: caseId, fields: {}, version: 1, updated_by_person_id: f.reviewerId })
        ).error,
        "insert refused",
      );
      assert.ok((await client.from("preparer_shaded_fields").update({ version: 2 }).eq("case_id", caseId)).error ||
        (await f.sql("select version from public.preparer_shaded_fields where case_id=$1", [caseId])).rows[0].version === "1",
      "update changes nothing");
      assert.ok((await client.from("preparer_shaded_fields").delete().eq("case_id", caseId)).error ||
        (await f.sql("select 1 from public.preparer_shaded_fields where case_id=$1", [caseId])).rowCount === 1,
      "delete removes nothing");
    }
  } finally {
    await f.close();
  }
});

test("the table refuses a bad shape", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await f.preparedCase();
    const bad = [
      ["a count over 99", { incomeW2sCount: 120 }],
      ["a negative count", { incomeW2sCount: -1 }],
      ["a count that is a string", { incomeW2sCount: "2" }],
      ["a count with a fraction", { incomeW2sCount: 2.5 }],
      ["an unknown key", { nope: true }],
      ["both of a Yes/No pair", { itemizedLastYearYes: true, itemizedLastYearNo: true }],
      ["a bad cell", { household1QualifyingChild: "maybe" }],
      ["a cell that is not a string", { household1QualifyingChild: true }],
      ["a box that is false", { incomeW2s: false }],
      ["a box that is a string", { incomeW2s: "true" }],
      ["an amount with a dollar sign", { incomeRefundAmount: "$12" }],
      ["an amount with three decimals", { incomeRefundAmount: "1.234" }],
      ["an amount with a leading zero", { incomeRefundAmount: "01" }],
      ["an amount that is a number", { incomeRefundAmount: 12 }],
      ["a VIN of 18", { infoVin: "A".repeat(18) }],
      ["a VIN with a dash", { infoVin: "AB-1" }],
      ["a year before 2000", { infoDisallowedYear: "1999" }],
      ["a year of three digits", { infoDisallowedYear: "200" }],
      ["a reason over 120 characters", { infoDisallowedReason: "x".repeat(121) }],
      ["a reason over 120 code points", { infoDisallowedReason: ASTRAL.repeat(121) }],
      ["a blank reason", { infoDisallowedReason: "   " }],
      ["a note over 500 characters", { incomeNotes: "x".repeat(501) }],
      ["a note over 500 code points", { incomeNotes: ASTRAL.repeat(501) }],
      ["a blank note", { incomeNotes: " \t\r\n " }],
      ["an empty note", { incomeNotes: "" }],
      ["a note that is not a string", { incomeNotes: 5 }],
    ];
    for (const [name, fields] of bad)
      await assert.rejects(() => insertShaded(f, caseId, fields), checkViolation, name);
    await assert.rejects(() => insertShaded(f, caseId, [true]), checkViolation, "an array");
    await assert.rejects(() => insertShaded(f, caseId, "x"), checkViolation, "a string");
    // JSON null is a value the shape check refuses; SQL NULL is NOT NULL's.
    await assert.rejects(() => insertShaded(f, caseId, null), checkViolation, "JSON null");
    await assert.rejects(() => insertShaded(f, caseId, {}, { version: 0 }), violates("23514", { constraint: "preparer_shaded_fields_version_check" }), "version at least 1");
    await assert.rejects(() => insertShaded(f, caseId, {}, { fields: null }), violates("23502", { column: "fields" }), "fields not null");
    const none = await f.sql("select 1 from public.preparer_shaded_fields where case_id=$1", [caseId]);
    assert.equal(none.rowCount, 0);
    const good = {
      household1QualifyingChild: "yes",
      household4CostOfHome: "na",
      incomeW2s: true,
      incomeW2sCount: 99,
      incomeRefundAmount: "999999.99",
      infoVin: "1HGCM82633A004352".slice(0, 17),
      infoDisallowedYear: "2000",
      infoDisallowedReason: ASTRAL.repeat(120),
      incomeNotes: `${ASTRAL.repeat(250)}\n${"y".repeat(249)}`,
      itemizedLastYearYes: true,
    };
    await insertShaded(f, caseId, good);
    await assert.rejects(() => insertShaded(f, caseId, {}), violates("23505", { constraint: "preparer_shaded_fields_case_id_key" }), "one row per case");
  } finally {
    await f.close();
  }
});

test("the SQL key lists match the JS table", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const kinds = { cell: "cells", box: "boxes", count: "counts", amount: "amounts", vin: "vins", year: "years", reason: "reasons", note: "notes" };
  let total = 0;
  for (const [kind, variable] of Object.entries(kinds)) {
    const found = new RegExp(`${variable} text\\[\\] := array\\[([^\\]]*)\\]`).exec(sql);
    assert.ok(found, `${variable} is listed in the migration`);
    const listed = [...found[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
    const expected = SHADED_FIELDS.filter((x) => x.kind === kind).map((x) => x.key);
    assert.deepEqual([...listed].sort(), [...expected].sort(), kind);
    total += listed.length;
  }
  assert.equal(total, SHADED_FIELDS.length);
});

// ---------------------------------------------------------------------------
// SAVE_PREPARER_FIELDS (design D2, D4, D5)

const refused = (...codes) => (error) => codes.includes(error.code);

// A case the claimed preparer (the Preparer) is working on: stage `preparing`.
const preparingCase = async (f) => {
  const caseId = await f.readyCase();
  await f.act(f.preparer, caseId, "CLAIM_PREPARATION", {});
  return caseId;
};
const save = (f, caseId, fields, basedOnVersion, client = f.preparer) =>
  f.act(client, caseId, "SAVE_PREPARER_FIELDS", { basedOnVersion, fields });
const stored = async (f, caseId) =>
  (await f.sql("select fields,version,updated_by_person_id from public.preparer_shaded_fields where case_id=$1", [caseId])).rows[0];
const stageOf = async (f, caseId) =>
  (await f.sql("select stage from public.cases where id=$1", [caseId])).rows[0].stage;

test("the case's preparer saves", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    assert.equal(await stageOf(f, caseId), "preparing");
    const receipt = await save(f, caseId, { incomeW2s: true, incomeW2sCount: 2 }, 0);
    assert.ok(receipt.revision);
    const row = await stored(f, caseId);
    assert.deepEqual(row.fields, { incomeW2s: true, incomeW2sCount: 2 });
    assert.equal(Number(row.version), 1);
    assert.equal(row.updated_by_person_id, f.preparerId);
    await save(f, caseId, { incomeW2s: true }, 1);
    assert.equal(Number((await stored(f, caseId)).version), 2);
    assert.deepEqual((await stored(f, caseId)).fields, { incomeW2s: true });
  } finally {
    await f.close();
  }
});

test("only the case's preparer may save", async () => {
  const f = await createDatabaseFixture();
  try {
    const casey = (await f.staff({ key: "casey", name: "Casey", capabilities: ["prepare"] })).client;
    const caseId = await preparingCase(f);
    for (const [name, client] of [
      ["the reviewer", f.reviewer],
      ["an admin who is not the preparer", f.siteCoordinator],
      ["another volunteer", casey],
      ["no staff person", f.presenter],
    ])
      await assert.rejects(() => save(f, caseId, { incomeW2s: true }, 0, client), refused("FORBIDDEN", "INELIGIBLE"), name);
    await assert.rejects(() => save(f, caseId, { incomeW2s: true }, 0, f.applicantA), refused("FORBIDDEN"), "the client");
    assert.equal(await stored(f, caseId), undefined);
  } finally {
    await f.close();
  }
});

test("saving follows the stage", async () => {
  const f = await createDatabaseFixture();
  try {
    const ready = await f.preparedCase();
    assert.equal(await stageOf(f, ready), "review_ready");
    await assert.rejects(() => save(f, ready, { incomeW2s: true }, 0), rejected("INVALID_TRANSITION"));

    const held = await preparingCase(f);
    // No action holds a claimed case, so the stage is set directly.
    await f.sql("update public.cases set stage='on_hold',hold_origin='awaiting_documents',documents_origin='screening' where id=$1", [held]);
    assert.equal(await stageOf(f, held), "on_hold");
    await assert.rejects(() => save(f, held, { incomeW2s: true }, 0), rejected("INVALID_TRANSITION"));

    const approved = await f.approvedCase();
    assert.equal(await stageOf(f, approved), "review_approved");
    await assert.rejects(() => save(f, approved, { incomeW2s: true }, 0), rejected("INVALID_TRANSITION"));

    const corrections = await f.preparedCase();
    await f.act(f.reviewer, corrections, "CLAIM_REVIEW", {});
    await f.act(f.reviewer, corrections, "REQUEST_CORRECTIONS", { findings: "A fictional finding." });
    assert.equal(await stageOf(f, corrections), "corrections_required");
    await save(f, corrections, { incomeW2s: true }, 0);
    assert.equal(Number((await stored(f, corrections)).version), 1);
    for (const id of [ready, held, approved]) assert.equal(await stored(f, id), undefined);
  } finally {
    await f.close();
  }
});

test("a stale version conflicts and other actions do not block a save", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    await save(f, caseId, { incomeW2s: true }, 0);
    await assert.rejects(() => save(f, caseId, { incomeTips: true }, 0), rejected("CONFLICT"));
    await assert.rejects(() => save(f, caseId, { incomeTips: true }, 5), rejected("CONFLICT"));
    const row = await stored(f, caseId);
    assert.deepEqual(row.fields, { incomeW2s: true });
    assert.equal(Number(row.version), 1);
    // The first save of a case with no row must be based on 0.
    const fresh = await preparingCase(f);
    await assert.rejects(() => save(f, fresh, { incomeTips: true }, 1), rejected("CONFLICT"));
    // Another action moves the case revision; the next save is still accepted.
    await f.act(f.siteCoordinator, caseId, "RECORD_MATERIALS", { received: ["w2"] });
    await save(f, caseId, { incomeW2s: true, incomeTips: true }, 1);
    assert.equal(Number((await stored(f, caseId)).version), 2);
  } finally {
    await f.close();
  }
});

test("the season bound and the household rows are the case's", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    // A submitted case keeps the season it was numbered in (010), so the bound
    // is that season, and a different workspace season must not move it.
    const season = Number((await f.sql("select season from public.cases where id=$1", [caseId])).rows[0].season);
    await f.sql("update public.workspaces set current_season=$2 where id=$1", [f.workspaceId, season + 1]);
    await f.sql(
      `update public.cases set answers=jsonb_set(answers,'{hh}','[{"first_name":"Lin"},{"first_name":"Kai"}]'::jsonb) where id=$1`,
      [caseId],
    );
    await assert.rejects(() => save(f, caseId, { infoDisallowedYear: String(season) }, 0), rejected("VALIDATION"));
    await assert.rejects(() => save(f, caseId, { infoDisallowedYear: String(season + 1) }, 0), rejected("VALIDATION"));
    await assert.rejects(() => save(f, caseId, { household3QualifyingChild: "yes" }, 0), rejected("VALIDATION"));
    await assert.rejects(() => save(f, caseId, { household4CostOfHome: "na" }, 0), rejected("VALIDATION"));
    assert.equal(await stored(f, caseId), undefined);
    await save(f, caseId, { infoDisallowedYear: String(season - 1), household2OwnSupport: "no", household1QualifyingChild: "yes" }, 0);
    assert.equal(Number((await stored(f, caseId)).version), 1);
    // No household answer at all: no row has a member.
    await f.sql("update public.cases set answers=answers-'hh' where id=$1", [caseId]);
    await assert.rejects(() => save(f, caseId, { household1QualifyingChild: "yes" }, 1), rejected("VALIDATION"));
    await save(f, caseId, { incomeW2s: true }, 1);
  } finally {
    await f.close();
  }
});

test("the payload has exactly basedOnVersion and fields", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    const bad = [
      ["an extra key", { basedOnVersion: 0, fields: {}, extra: 1 }],
      ["a missing basedOnVersion", { fields: {} }],
      ["a missing fields", { basedOnVersion: 0 }],
      ["fields that are an array", { basedOnVersion: 0, fields: [] }],
      ["fields that are a string", { basedOnVersion: 0, fields: "x" }],
      ["fields that are null", { basedOnVersion: 0, fields: null }],
      ["a negative version", { basedOnVersion: -1, fields: {} }],
      ["a fractional version", { basedOnVersion: 0.5, fields: {} }],
      ["a string version", { basedOnVersion: "0", fields: {} }],
      ["a null version", { basedOnVersion: null, fields: {} }],
      ["an unknown field", { basedOnVersion: 0, fields: { nope: true } }],
      ["a bad value", { basedOnVersion: 0, fields: { incomeW2sCount: 120 } }],
    ];
    for (const [name, payload] of bad)
      await assert.rejects(
        () => f.act(f.preparer, caseId, "SAVE_PREPARER_FIELDS", payload),
        rejected("VALIDATION"),
        name,
      );
    assert.equal(await stored(f, caseId), undefined);
  } finally {
    await f.close();
  }
});

test("history names the changed keys for staff only", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    const events = async () =>
      (await f.sql("select detail from public.case_events where case_id=$1 and action='SAVE_PREPARER_FIELDS' order by created_at, id", [caseId])).rows.map((r) => r.detail);
    const count = async () =>
      (await f.sql("select count(*)::int as n from public.client_events where case_id=$1", [caseId])).rows[0].n;
    const before = await count();
    await save(f, caseId, { incomeW2sCount: 1, incomeW2s: true, incomeNotes: "A" }, 0);
    await save(f, caseId, { incomeW2sCount: 2, incomeW2s: true, incomeNotes: "B" }, 1);
    // A removed key counts as changed too; an unchanged save lists nothing.
    await save(f, caseId, { incomeW2sCount: 2, incomeNotes: "B" }, 2);
    await save(f, caseId, { incomeW2sCount: 2, incomeNotes: "B" }, 3);
    assert.deepEqual((await events()).map((d) => d.changed), [
      ["incomeNotes", "incomeW2s", "incomeW2sCount"],
      ["incomeNotes", "incomeW2sCount"],
      ["incomeW2s"],
      [],
    ]);
    assert.equal(Number((await stored(f, caseId)).version), 4);
    assert.equal(await count(), before);
  } finally {
    await f.close();
  }
});

test("an identical replay returns the receipt and saves once", async () => {
  const f = await createDatabaseFixture();
  try {
    const caseId = await preparingCase(f);
    const revision = Number((await f.sql("select revision from public.cases where id=$1", [caseId])).rows[0].revision);
    const args = applyArgs({ caseId, revision, type: "SAVE_PREPARER_FIELDS", payload: { basedOnVersion: 0, fields: { incomeW2s: true } } });
    const first = await f.preparer.rpc("vitally_apply_action", args);
    const second = await f.preparer.rpc("vitally_apply_action", args);
    assert.equal(first.error, null);
    assert.deepEqual(second.data, first.data);
    assert.equal(Number((await stored(f, caseId)).version), 1);
  } finally {
    await f.close();
  }
});
