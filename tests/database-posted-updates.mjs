import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseFixture } from "./support/database-fixture.mjs";

// OpenSpec change add-posted-updates (design D1-D4): admins post updates, and
// every staff member, cleared or not, reads the ones addressed to them. Spec:
// posted-updates. The file shares one fixture, and `add_staff_member` refuses
// changed values for an existing key, so every staff member below has a person
// key of their own. Every assertion is on this file's own workspace: feeds are
// checked by the ids each test posted, or by rules that hold for any item.

const FORBIDDEN = "VT001";
const NOT_FOUND = "VT002";
const CONFLICT = "VT003";
const INVALID_TRANSITION = "VT004";
const VALIDATION = "VT007";
const ANONYMOUS_DENIAL = "42501";
const SAVE = "vitally_save_update";
const ACTION = "vitally_update_action";
const FEED_KEYS = [
  "askConfirm",
  "confirmedAt",
  "edited",
  "id",
  "irsLink",
  "kind",
  "message",
  "pinned",
  "postedAt",
  "postedByName",
  "readAt",
  "source",
  "title",
];

const update = (extra = {}) => ({
  kind: "office_notice",
  title: "Office closes early on Friday",
  message: "The office closes at 3 pm this Friday. Shifts after 3 pm are moved to Saturday.",
  irsLink: null,
  audience: "everyone",
  roles: [],
  keepTopUntil: null,
  askConfirm: false,
  post: false,
  askAgain: false,
  ...extra,
});
const newArgs = (entry = update(), actionId = randomUUID()) => ({
  p_action_id: actionId,
  p_update_id: null,
  p_expected_revision: null,
  p_update: entry,
});
const editArgs = (updateId, revision, entry) => ({
  p_action_id: randomUUID(),
  p_update_id: updateId,
  p_expected_revision: revision,
  p_update: entry,
});
const actionArgs = (updateId, revision, type, actionId = randomUUID()) => ({
  p_action_id: actionId,
  p_update_id: updateId,
  p_expected_revision: revision,
  p_type: type,
});
async function call(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  assert.equal(error, null, `${fn} failed: ${error?.code} ${error?.message} ${error?.details}`);
  return data;
}
// A refused call: the SQLSTATE, the field named in the detail when given, and
// no receipt behind it.
async function refusedWith(f, client, fn, args, code, detail) {
  const { error } = await client.rpc(fn, args);
  assert.equal(error?.code, code, `${fn}: ${error?.code} ${error?.message} ${error?.details}`);
  if (detail !== undefined) assert.equal(error.details, detail, `${fn} detail`);
  if (args?.p_action_id) assert.equal(await f.receiptsFor(args.p_action_id), 0, `${fn} stored a receipt`);
}
const one = async (f, text, values) => (await f.sql(text, values)).rows[0];
const rowOf = (f, id) =>
  one(
    f,
    `select *,posted_at::text as posted,edited_at::text as edited,unpublished_at::text as unpublished
       from public.posted_updates where id=$1`,
    [id],
  );
const readsOf = async (f, id) =>
  (
    await f.sql(
      "select person_id,read_at::text as read_at,confirmed_at::text as confirmed_at from public.update_reads where update_id=$1 order by person_id",
      [id],
    )
  ).rows;
const updateCount = async (f) =>
  Number((await one(f, "select count(*) as n from public.posted_updates where workspace_id=$1", [f.workspaceId])).n);
const feed = (client) => call(client, "vitally_my_updates", {});
const feedIds = async (client) => (await feed(client)).items.map((item) => item.id);
const itemOf = async (client, id) => (await feed(client)).items.find((item) => item.id === id);
const mark = (client, ids, confirm = false) =>
  call(client, "vitally_mark_updates", { p_update_ids: ids, p_confirm: confirm });
const selectedIds = async (client, ids) => {
  const { data, error } = await client.from("posted_updates").select("id").in("id", ids);
  assert.equal(error, null, "posted_updates read");
  return data.map((row) => row.id).sort();
};
const listed = async (client, id) =>
  (await call(client, "vitally_posted_updates", {})).updates.find((entry) => entry.id === id);
// New York's today, and a day relative to it, as YYYY-MM-DD.
const nyDay = async (f, offset = 0) =>
  (await one(f, "select ((now() at time zone 'America/New_York')::date + $1::int)::text as d", [offset])).d;
// A roster entry for the workspace's current season (or one before it), with
// the given roles; no roles needs no certificates. add_staff_member already
// gives every new staff member a current-season entry with no roles, so this
// sets the roles of an existing entry.
const addEntry = (f, personId, { seasonOffset = 0, roles = [] } = {}) =>
  f.sql(
    `insert into public.roster_entries(workspace_id,person_id,season,roles)
      select $1::uuid,$2::uuid,w.current_season+$3::int,$4::text[] from public.workspaces w where w.id=$1::uuid
      on conflict (workspace_id,person_id,season) do update set roles=excluded.roles`,
    [f.workspaceId, personId, seasonOffset, roles],
  );
const removeEntry = (f, personId) =>
  f.sql(
    `delete from public.roster_entries r using public.workspaces w
      where w.id=r.workspace_id and r.season=w.current_season and r.workspace_id=$1 and r.person_id=$2`,
    [f.workspaceId, personId],
  );
const isMember = async (f, personId, audience = "everyone", roles = []) =>
  (
    await one(f, "select vitally_private.audience_member($1,$2,$3,$4::text[]) as answer", [
      f.workspaceId,
      personId,
      audience,
      roles,
    ])
  ).answer;

test("posted updates against real Supabase", async (t) => {
  const f = await createDatabaseFixture();
  try {
    const admin = f.siteCoordinator;
    // A posted update to the given audience, as the Site Coordinator.
    const post = (extra = {}) => call(admin, SAVE, newArgs(update({ post: true, ...extra })));
    const draft = (extra = {}) => call(admin, SAVE, newArgs(update(extra)));

    await t.test("audience: an uncleared staff member with a current-season entry and no roles is in All volunteers", async () => {
      const greeter = await f.staff({ key: "gale_no_roles", name: "Gale Moreno", capabilities: [], cleared: false });
      await addEntry(f, greeter.personId);
      const cleared = await one(f, "select vitally_private.cleared($1,$2) as cleared", [f.workspaceId, greeter.personId]);
      assert.equal(cleared.cleared, false, "not cleared");
      const posted = await post({ title: "Standards of Conduct reminder" });
      assert.ok((await feedIds(greeter.client)).includes(posted.updateId), "in the feed");
      assert.deepEqual(await selectedIds(greeter.client, [posted.updateId]), [posted.updateId], "readable row");
      assert.equal(await isMember(f, greeter.personId), true);
    });

    await t.test("audience: added to the roster after posting sees the update", async () => {
      const late = await f.staff({ key: "lee_late_entry", name: "Lee Okafor", capabilities: [], cleared: false });
      await removeEntry(f, late.personId);
      const posted = await post({ title: "New shift sign-up sheet" });
      assert.equal((await feedIds(late.client)).includes(posted.updateId), false, "no entry yet");
      await addEntry(f, late.personId);
      assert.ok((await feedIds(late.client)).includes(posted.updateId), "after the entry");
    });

    await t.test("audience: an earlier-season entry only gives no items", async () => {
      const last = await f.staff({ key: "lou_last_season", name: "Lou Barros", capabilities: [], cleared: false });
      await removeEntry(f, last.personId);
      await addEntry(f, last.personId, { seasonOffset: -1 });
      const posted = await post({ title: "Parking lot closed Monday" });
      assert.deepEqual(await feed(last.client), { items: [], unread: 0 });
      assert.deepEqual(await selectedIds(last.client, [posted.updateId]), []);
      assert.equal(await isMember(f, last.personId), false);
    });

    await t.test("audience: an inactive staff membership gives no items and no rows", async () => {
      const gone = await f.staff({ key: "ines_inactive", name: "Ines Varga", capabilities: [], cleared: false });
      await addEntry(f, gone.personId);
      const posted = await post({ title: "Printer moved to room 2" });
      // The positive control: while active, the update reaches them.
      assert.ok((await feedIds(gone.client)).includes(posted.updateId), "active");
      await f.sql("update public.memberships set active=false where workspace_id=$1 and user_id=$2", [
        f.workspaceId,
        gone.userId,
      ]);
      await refusedWith(f, gone.client, "vitally_my_updates", {}, FORBIDDEN);
      assert.deepEqual(await selectedIds(gone.client, [posted.updateId]), []);
      assert.equal(await isMember(f, gone.personId), false);
    });

    await t.test("audience: a Reviewer update reaches the reviewer and not the preparer", async () => {
      const posted = await post({ title: "Reviewer checklist changed", audience: "roles", roles: ["reviewer"] });
      assert.ok((await feedIds(f.reviewer)).includes(posted.updateId), "reviewer");
      assert.equal((await feedIds(f.preparer)).includes(posted.updateId), false, "preparer");
      assert.equal(await isMember(f, f.reviewerId, "roles", ["reviewer"]), true);
      assert.equal(await isMember(f, f.preparerId, "roles", ["reviewer"]), false);
    });

    await t.test("write: a preparer, a client and an anonymous caller get FORBIDDEN from both write RPCs", async () => {
      const target = await draft({ title: "Draft for the refusals" });
      const before = await updateCount(f);
      const row = await rowOf(f, target.updateId);
      for (const [label, client] of [
        ["preparer", f.preparer],
        ["client", f.applicantA],
      ]) {
        await refusedWith(f, client, SAVE, newArgs(update({ post: true })), FORBIDDEN);
        await refusedWith(f, client, SAVE, editArgs(target.updateId, 1, update({ title: "Changed" })), FORBIDDEN);
        await refusedWith(f, client, ACTION, actionArgs(target.updateId, 1, "POST"), FORBIDDEN);
        await refusedWith(f, client, ACTION, actionArgs(target.updateId, 1, "DELETE"), FORBIDDEN);
        // A malformed call is refused as FORBIDDEN too, before validation.
        await refusedWith(f, client, SAVE, { ...newArgs(), p_action_id: null }, FORBIDDEN, undefined);
        assert.equal(await updateCount(f), before, label);
      }
      // The anonymous client has no execute grant at all.
      await refusedWith(f, f.anonymous, SAVE, newArgs(update({ post: true })), ANONYMOUS_DENIAL);
      await refusedWith(f, f.anonymous, ACTION, actionArgs(target.updateId, 1, "POST"), ANONYMOUS_DENIAL);
      assert.equal(await updateCount(f), before, "anonymous");
      assert.deepEqual(await rowOf(f, target.updateId), row, "the draft is unchanged");
      // The reads: a client is refused, an admin-only read refuses a preparer.
      await refusedWith(f, f.applicantA, "vitally_my_updates", {}, FORBIDDEN);
      await refusedWith(f, f.applicantA, "vitally_mark_updates", { p_update_ids: [], p_confirm: false }, FORBIDDEN);
      await refusedWith(f, f.applicantA, "vitally_posted_updates", {}, FORBIDDEN);
      await refusedWith(f, f.anonymous, "vitally_my_updates", {}, ANONYMOUS_DENIAL);
    });

    await t.test("write: an admin with no roles can post", async () => {
      const lead = await f.staff({
        key: "quinn_uncleared_admin",
        name: "Quinn Adair",
        capabilities: ["admin", "followup"],
        cleared: false,
      });
      const posted = await call(lead.client, SAVE, newArgs(update({ title: "Welcome back, volunteers", post: true })));
      assert.equal(posted.status, "posted");
      const row = await rowOf(f, posted.updateId);
      assert.equal(row.status, "posted");
      assert.equal(row.posted_by_person_id, lead.personId);
      assert.equal(row.created_by_person_id, lead.personId);
      assert.equal(await f.receiptsFor(posted.actionId), 1);
    });

    await t.test("write: no direct insert into posted_updates or update_reads", async () => {
      const posted = await post({ title: "Direct write target" });
      const before = await updateCount(f);
      const inserted = await admin.from("posted_updates").insert({
        workspace_id: f.workspaceId,
        kind: "office_notice",
        title: "Inserted directly",
        message: "Should not exist.",
        audience: "everyone",
        status: "posted",
        created_by_person_id: f.siteCoordinatorId,
        posted_by_person_id: f.siteCoordinatorId,
        posted_at: new Date().toISOString(),
      });
      assert.ok(inserted.error, "posted_updates insert");
      const updated = await admin.from("posted_updates").update({ title: "Changed directly" }).eq("id", posted.updateId);
      assert.ok(updated.error, "posted_updates update");
      const deleted = await admin.from("posted_updates").delete().eq("id", posted.updateId);
      assert.ok(deleted.error, "posted_updates delete");
      const read = await admin.from("update_reads").insert({
        workspace_id: f.workspaceId,
        update_id: posted.updateId,
        person_id: f.siteCoordinatorId,
      });
      assert.ok(read.error, "update_reads insert");
      assert.equal(await updateCount(f), before);
      assert.equal((await rowOf(f, posted.updateId)).title, "Direct write target");
      assert.deepEqual(await readsOf(f, posted.updateId), []);
    });

    await t.test("validation: each field is refused with VALIDATION naming it, and nothing is stored", async () => {
      const cases = [
        ["title", update({ title: "    " })],
        ["title", update({ title: "x".repeat(121) })],
        ["message", update({ message: "x".repeat(2001) })],
        ["irsLink", update({ kind: "irs_policy", irsLink: "https://example.org/irs" })],
        ["irsLink", update({ kind: "irs_policy", irsLink: "http://www.irs.gov/x" })],
        ["irsLink", update({ kind: "irs_policy", irsLink: "https://evilirs.gov/x" })],
        ["irsLink", update({ kind: "irs_policy", irsLink: `https://www.irs.gov/${"a".repeat(500)}` })],
        ["irsLink", update({ kind: "office_notice", irsLink: "https://www.irs.gov/newsroom" })],
        ["roles", update({ audience: "roles", roles: [] })],
        ["roles", update({ audience: "roles", roles: ["janitor"] })],
        ["audience", update({ audience: "staff" })],
        ["kind", update({ kind: "newsletter" })],
        ["keepTopUntil", update({ keepTopUntil: "2026-02-30" })],
        ["askConfirm", update({ askConfirm: "yes" })],
      ];
      const before = await updateCount(f);
      for (const [field, entry] of cases)
        await refusedWith(f, admin, SAVE, newArgs({ ...entry, post: true }), VALIDATION, field);
      // A missing or extra key is refused as a whole.
      const { askAgain: _drop, ...missing } = update();
      await refusedWith(f, admin, SAVE, newArgs(missing), VALIDATION, "update");
      await refusedWith(f, admin, SAVE, newArgs({ ...update(), extra: 1 }), VALIDATION, "update");
      assert.equal(await updateCount(f), before);
      // The positive controls: a valid link on irs.gov and on a subdomain.
      for (const irsLink of ["https://www.irs.gov/newsroom/tax-tips", "HTTPS://IRS.GOV", "https://apps.irs.gov/app/x"]) {
        const saved = await draft({ kind: "irs_policy", irsLink });
        assert.equal((await rowOf(f, saved.updateId)).irs_link, irsLink);
      }
      // Trimmed before it is stored.
      const trimmed = await draft({ title: "  Padded title  ", message: "  Padded message  " });
      const row = await rowOf(f, trimmed.updateId);
      assert.equal(row.title, "Padded title");
      assert.equal(row.message, "Padded message");
    });

    await t.test("lifecycle: save draft, POST, UNPUBLISH", async () => {
      const saved = await draft({ title: "Draft then posted" });
      assert.deepEqual(saved, { actionId: saved.actionId, updateId: saved.updateId, revision: 1, status: "draft" });
      let row = await rowOf(f, saved.updateId);
      assert.equal(row.status, "draft");
      assert.equal(row.posted_at, null);
      assert.equal(row.posted_by_person_id, null);
      assert.equal(row.created_by_person_id, f.siteCoordinatorId);
      assert.equal((await feedIds(f.preparer)).includes(saved.updateId), false, "draft not in the feed");
      assert.deepEqual(await selectedIds(f.preparer, [saved.updateId]), [], "draft not readable");
      assert.deepEqual(await selectedIds(admin, [saved.updateId]), [saved.updateId], "admin reads the draft");

      const posted = await call(admin, ACTION, actionArgs(saved.updateId, 1, "POST"));
      assert.deepEqual(posted, { actionId: posted.actionId, updateId: saved.updateId, revision: 2, status: "posted" });
      row = await rowOf(f, saved.updateId);
      assert.equal(row.status, "posted");
      assert.ok(row.posted_at, "posted_at");
      assert.equal(row.posted_by_person_id, f.siteCoordinatorId);
      const item = await itemOf(f.preparer, saved.updateId);
      assert.ok(item, "in the feed");
      assert.equal(item.postedByName, "Avery Lin");

      const unpublished = await call(admin, ACTION, actionArgs(saved.updateId, 2, "UNPUBLISH"));
      assert.deepEqual(unpublished, {
        actionId: unpublished.actionId,
        updateId: saved.updateId,
        revision: 3,
        status: "unpublished",
      });
      row = await rowOf(f, saved.updateId);
      assert.equal(row.status, "unpublished");
      assert.ok(row.unpublished_at, "unpublished_at");
      assert.ok(row.posted_at, "posted_at kept");
      assert.equal((await feedIds(f.preparer)).includes(saved.updateId), false, "left the feed");
      assert.ok(await listed(admin, saved.updateId), "still in the admin list");
    });

    await t.test("lifecycle: DELETE removes a draft; refused transitions give INVALID_TRANSITION", async () => {
      const removed = await draft({ title: "Draft to delete" });
      const deleted = await call(admin, ACTION, actionArgs(removed.updateId, 1, "DELETE"));
      assert.equal(deleted.status, "deleted");
      assert.equal(deleted.updateId, removed.updateId);
      assert.equal(await rowOf(f, removed.updateId), undefined, "gone");

      const posted = await post({ title: "Posted, never deleted" });
      const postedRow = await rowOf(f, posted.updateId);
      await refusedWith(f, admin, ACTION, actionArgs(posted.updateId, 1, "DELETE"), INVALID_TRANSITION);
      await refusedWith(f, admin, ACTION, actionArgs(posted.updateId, 1, "POST"), INVALID_TRANSITION);
      assert.deepEqual(await rowOf(f, posted.updateId), postedRow, "posted unchanged");

      const gone = await post({ title: "Unpublished, frozen" });
      await call(admin, ACTION, actionArgs(gone.updateId, 1, "UNPUBLISH"));
      const goneRow = await rowOf(f, gone.updateId);
      await refusedWith(f, admin, ACTION, actionArgs(gone.updateId, 2, "DELETE"), INVALID_TRANSITION);
      await refusedWith(f, admin, ACTION, actionArgs(gone.updateId, 2, "POST"), INVALID_TRANSITION);
      await refusedWith(f, admin, ACTION, actionArgs(gone.updateId, 2, "UNPUBLISH"), INVALID_TRANSITION);
      await refusedWith(f, admin, SAVE, editArgs(gone.updateId, 2, update({ title: "Edited" })), INVALID_TRANSITION);
      await refusedWith(f, admin, SAVE, editArgs(gone.updateId, 2, update({ post: true })), INVALID_TRANSITION);
      assert.deepEqual(await rowOf(f, gone.updateId), goneRow, "unpublished unchanged");

      const kept = await draft({ title: "Draft, not unpublished" });
      await refusedWith(f, admin, ACTION, actionArgs(kept.updateId, 1, "UNPUBLISH"), INVALID_TRANSITION);
      await refusedWith(f, admin, ACTION, actionArgs(kept.updateId, 1, "ARCHIVE"), VALIDATION, "type");
      assert.equal((await rowOf(f, kept.updateId)).status, "draft");
    });

    await t.test("lifecycle: a stale revision gives CONFLICT; an unknown id gives NOT_FOUND", async () => {
      const saved = await draft({ title: "Two admins edit this" });
      await call(admin, SAVE, editArgs(saved.updateId, 1, update({ title: "First edit wins" })));
      await refusedWith(f, admin, SAVE, editArgs(saved.updateId, 1, update({ title: "Second edit" })), CONFLICT);
      await refusedWith(f, admin, ACTION, actionArgs(saved.updateId, 1, "POST"), CONFLICT);
      assert.equal((await rowOf(f, saved.updateId)).title, "First edit wins");
      const unknown = randomUUID();
      await refusedWith(f, admin, SAVE, editArgs(unknown, 1, update()), NOT_FOUND);
      await refusedWith(f, admin, ACTION, actionArgs(unknown, 1, "POST"), NOT_FOUND);
      // Another workspace's update is unknown here.
      const foreign = await call(f.foreignStaff, SAVE, newArgs(update({ title: "Other site's notice" })));
      await refusedWith(f, admin, SAVE, editArgs(foreign.updateId, 1, update()), NOT_FOUND);
      await refusedWith(f, admin, ACTION, actionArgs(foreign.updateId, 1, "DELETE"), NOT_FOUND);
      assert.equal((await rowOf(f, foreign.updateId)).title, "Other site's notice");
    });

    await t.test("receipts: replaying save, POST and DELETE returns the stored result", async () => {
      const title = `Replayed ${randomUUID()}`;
      const args = newArgs(update({ title }));
      const first = await call(admin, SAVE, args);
      const again = await call(admin, SAVE, args);
      assert.deepEqual(again, first);
      const count = await one(f, "select count(*) as n from public.posted_updates where workspace_id=$1 and title=$2", [
        f.workspaceId,
        title,
      ]);
      assert.equal(Number(count.n), 1, "one update");

      const postArgs = actionArgs(first.updateId, 1, "POST");
      const posted = await call(admin, ACTION, postArgs);
      assert.deepEqual(await call(admin, ACTION, postArgs), posted);
      assert.equal(Number((await rowOf(f, first.updateId)).revision), 2, "posted once");

      const doomed = await draft({ title: "Delete replayed" });
      const deleteArgs = actionArgs(doomed.updateId, 1, "DELETE");
      const deleted = await call(admin, ACTION, deleteArgs);
      const replayed = await call(admin, ACTION, deleteArgs);
      assert.deepEqual(replayed, deleted);
      assert.equal(replayed.status, "deleted");
      // The same action id with a different request is refused.
      const changed = await admin.rpc(SAVE, { ...args, p_update: update({ title: "Different" }) });
      assert.equal(changed.error?.code, VALIDATION);
      assert.equal(await f.receiptsFor(args.p_action_id), 1, "still the one receipt");
    });

    await t.test("edit: askAgain false keeps reads and sets edited_at; askAgain true removes them", async () => {
      const posted = await post({ title: "Mileage rate for 2026", askConfirm: true });
      await mark(f.preparer, [posted.updateId], true);
      const [read] = await readsOf(f, posted.updateId);
      assert.ok(read.read_at && read.confirmed_at, "read and confirmed");
      const edited = await call(
        admin,
        SAVE,
        editArgs(posted.updateId, 1, update({ title: "Mileage rate for 2026 (fixed typo)", askConfirm: true })),
      );
      assert.deepEqual(edited, { actionId: edited.actionId, updateId: posted.updateId, revision: 2, status: "posted" });
      assert.deepEqual(await readsOf(f, posted.updateId), [read], "reads kept");
      let row = await rowOf(f, posted.updateId);
      assert.ok(row.edited, "edited_at");
      assert.equal(row.status, "posted");
      const item = await itemOf(f.preparer, posted.updateId);
      assert.equal(item.edited, true);
      assert.equal(item.title, "Mileage rate for 2026 (fixed typo)");
      assert.equal(item.readAt === null, false);

      await call(admin, SAVE, editArgs(posted.updateId, 2, update({ title: "Mileage rate changed", askConfirm: true, askAgain: true })));
      assert.deepEqual(await readsOf(f, posted.updateId), [], "reads removed");
      row = await rowOf(f, posted.updateId);
      assert.equal(row.status, "posted");
      const fresh = await itemOf(f.preparer, posted.updateId);
      assert.equal(fresh.readAt, null);
      assert.equal(fresh.confirmedAt, null);

      // A draft edit with askAgain touches no read and records no edit.
      const other = await post({ title: "Another update, read" });
      await mark(f.preparer, [other.updateId]);
      const otherReads = await readsOf(f, other.updateId);
      const saved = await draft({ title: "Draft edited with askAgain" });
      await call(admin, SAVE, editArgs(saved.updateId, 1, update({ title: "Draft edited", askAgain: true })));
      assert.equal((await rowOf(f, saved.updateId)).edited, null);
      assert.deepEqual(await readsOf(f, other.updateId), otherReads);
    });

    await t.test("feed: pinned items first, newest first within each group; yesterday's pin is not pinned", async () => {
      const pinned = await post({ title: "Pinned, older", keepTopUntil: await nyDay(f, 3) });
      const plain = await post({ title: "Not pinned" });
      const yesterday = await post({ title: "Pin ended yesterday", keepTopUntil: await nyDay(f, -1) });
      const today = await post({ title: "Pinned until today", keepTopUntil: await nyDay(f, 0) });
      const { items } = await feed(f.preparer);
      const order = items.map((item) => item.id);
      const at = (id) => order.indexOf(id);
      assert.ok(at(today.updateId) < at(pinned.updateId), "pinned, newest first");
      assert.ok(at(pinned.updateId) < at(yesterday.updateId), "pinned before the rest");
      assert.ok(at(yesterday.updateId) < at(plain.updateId), "the rest, newest first");
      const flags = Object.fromEntries(items.map((item) => [item.id, item.pinned]));
      assert.equal(flags[pinned.updateId], true);
      assert.equal(flags[today.updateId], true);
      assert.equal(flags[yesterday.updateId], false);
      assert.equal(flags[plain.updateId], false);
      // The whole feed follows the rule.
      for (let i = 1; i < items.length; i += 1) {
        const [a, b] = [items[i - 1], items[i]];
        if (a.pinned === b.pinned)
          assert.ok(Date.parse(a.postedAt) >= Date.parse(b.postedAt), `${a.title} before ${b.title}`);
        else assert.equal(a.pinned, true, `${a.title} pinned before ${b.title}`);
      }
    });

    await t.test("feed: drafts and unpublished updates are absent; item keys are exactly the contract", async () => {
      const hidden = await draft({ title: "Draft, hidden" });
      const shown = await post({
        title: "IRS: new standard mileage rate",
        kind: "irs_policy",
        irsLink: "https://www.irs.gov/newsroom",
      });
      const gone = await post({ title: "Posted then unpublished" });
      await call(admin, ACTION, actionArgs(gone.updateId, 1, "UNPUBLISH"));
      const { items } = await feed(f.preparer);
      const ids = items.map((item) => item.id);
      assert.ok(ids.includes(shown.updateId));
      assert.equal(ids.includes(hidden.updateId), false, "draft");
      assert.equal(ids.includes(gone.updateId), false, "unpublished");
      for (const item of items) assert.deepEqual(Object.keys(item).sort(), FEED_KEYS, item.title);
      const item = items.find((entry) => entry.id === shown.updateId);
      assert.equal(item.source, "posted_update");
      assert.equal(item.kind, "irs_policy");
      assert.equal(item.irsLink, "https://www.irs.gov/newsroom");
      assert.equal(item.edited, false);
      assert.equal(item.askConfirm, false);
      assert.equal(item.readAt, null);
      assert.equal(item.confirmedAt, null);
    });

    await t.test("feed: unread counts unread items plus askConfirm items without confirmedAt", async () => {
      const reader = await f.staff({ key: "uma_unread", name: "Uma Castillo", capabilities: [], cleared: false });
      await addEntry(f, reader.personId);
      await post({ title: "Please confirm the new hours", askConfirm: true });
      const expected = (items) =>
        items.filter((item) => item.readAt === null || (item.askConfirm && item.confirmedAt === null)).length;
      let current = await feed(reader.client);
      assert.ok(current.items.length > 0);
      assert.equal(current.unread, current.items.length, "nothing read yet");
      const ids = current.items.map((item) => item.id);
      await mark(reader.client, ids);
      current = await feed(reader.client);
      const asking = current.items.filter((item) => item.askConfirm).length;
      assert.ok(asking > 0);
      assert.equal(current.unread, asking, "read, but not confirmed");
      assert.equal(current.unread, expected(current.items));
      await mark(reader.client, ids, true);
      current = await feed(reader.client);
      assert.equal(current.unread, 0, "all read and confirmed");
      assert.equal(expected(current.items), 0);
    });

    await t.test("mark: keeps the first read_at; confirms only where asked; another role's id gives 0; 201 ids are refused", async () => {
      const plain = await post({ title: "Supplies restocked" });
      const asking = await post({ title: "Sign the volunteer agreement", askConfirm: true });
      const reviewersOnly = await post({ title: "Reviewers only", audience: "roles", roles: ["reviewer"] });
      const hidden = await draft({ title: "Not posted" });
      assert.deepEqual(await mark(f.preparer, [plain.updateId, asking.updateId, plain.updateId]), { marked: 2 });
      const [first] = await readsOf(f, plain.updateId);
      const [askingFirst] = await readsOf(f, asking.updateId);
      assert.equal(first.person_id, f.preparerId);
      assert.equal(first.confirmed_at, null);
      assert.equal(askingFirst.confirmed_at, null, "confirm not asked for in this call");
      assert.deepEqual(await mark(f.preparer, [plain.updateId, asking.updateId], true), { marked: 2 });
      const [second] = await readsOf(f, plain.updateId);
      const [confirmed] = await readsOf(f, asking.updateId);
      assert.equal(second.read_at, first.read_at, "first read time kept");
      assert.equal(second.confirmed_at, null, "no confirmation where not asked");
      assert.equal(confirmed.read_at, askingFirst.read_at);
      assert.ok(confirmed.confirmed_at, "confirmed");
      await mark(f.preparer, [asking.updateId], true);
      assert.deepEqual(await readsOf(f, asking.updateId), [confirmed], "first confirmation kept");
      assert.deepEqual(await mark(f.preparer, [reviewersOnly.updateId, hidden.updateId, randomUUID()]), { marked: 0 });
      assert.deepEqual(await readsOf(f, reviewersOnly.updateId), []);
      assert.deepEqual(await readsOf(f, hidden.updateId), []);
      const tooMany = Array.from({ length: 201 }, () => randomUUID());
      await refusedWith(f, f.preparer, "vitally_mark_updates", { p_update_ids: tooMany, p_confirm: false }, VALIDATION);
      assert.deepEqual(await mark(f.preparer, tooMany.slice(0, 200)), { marked: 0 });
    });

    await t.test("posted list: counts only the current audience; people list names and times; a preparer is refused", async () => {
      const posted = await post({ title: "Counts follow the roster", askConfirm: true });
      // The audience, counted independently: an active staff membership and a
      // current-season entry in this workspace.
      const audience = async () =>
        Number(
          (
            await one(
              f,
              `select count(*) as n from public.people p
                join public.memberships m on m.workspace_id=p.workspace_id and m.user_id=p.user_id and m.active and m.access='staff'
                join public.workspaces w on w.id=p.workspace_id
                join public.roster_entries r on r.workspace_id=p.workspace_id and r.person_id=p.id and r.season=w.current_season
               where p.workspace_id=$1`,
              [f.workspaceId],
            )
          ).n,
        );
      let entry = await listed(admin, posted.updateId);
      const size = await audience();
      assert.equal(entry.audienceSize, size);
      assert.equal(entry.people.length, size);
      assert.equal(entry.readCount, 0);
      assert.equal(entry.confirmedCount, 0);
      assert.equal(entry.status, "posted");
      assert.equal(entry.postedByName, "Avery Lin");
      assert.deepEqual(entry.roles, []);

      await mark(f.preparer, [posted.updateId], true);
      const newcomer = await f.staff({ key: "nia_newcomer", name: "Nia Patel", capabilities: [], cleared: false });
      await addEntry(f, newcomer.personId);
      await mark(newcomer.client, [posted.updateId]);
      entry = await listed(admin, posted.updateId);
      assert.equal(entry.audienceSize, size + 1, "the new roster entry counts");
      assert.equal(entry.readCount, 2);
      assert.equal(entry.confirmedCount, 1);
      const prep = entry.people.find((person) => person.personId === f.preparerId);
      assert.equal(prep.name, "Taylor Brooks");
      assert.ok(prep.readAt && prep.confirmedAt);
      const nia = entry.people.find((person) => person.personId === newcomer.personId);
      assert.equal(nia.name, "Nia Patel");
      assert.ok(nia.readAt);
      assert.equal(nia.confirmedAt, null);
      for (const person of entry.people)
        assert.deepEqual(Object.keys(person).sort(), ["confirmedAt", "name", "personId", "readAt"]);

      // Leaving the roster leaves the audience, and their read stops counting.
      await removeEntry(f, newcomer.personId);
      entry = await listed(admin, posted.updateId);
      assert.equal(entry.audienceSize, size);
      assert.equal(entry.readCount, 1);
      assert.equal(entry.people.some((person) => person.personId === newcomer.personId), false);

      // A role audience counts only its roles.
      const reviewers = await post({ title: "Reviewers: new checklist", audience: "roles", roles: ["reviewer"] });
      const reviewerEntry = await listed(admin, reviewers.updateId);
      assert.deepEqual(reviewerEntry.roles, ["reviewer"]);
      assert.ok(reviewerEntry.people.some((person) => person.personId === f.reviewerId));
      assert.equal(reviewerEntry.people.some((person) => person.personId === f.preparerId), false);

      // Every update of the workspace, newest first, with the contract's keys.
      const { updates } = await call(admin, "vitally_posted_updates", {});
      assert.equal(updates.length, await updateCount(f));
      for (let i = 1; i < updates.length; i += 1) {
        const time = (u) => Date.parse(u.postedAt ?? u.createdAt);
        assert.ok(time(updates[i - 1]) >= time(updates[i]), "newest first");
      }
      assert.deepEqual(Object.keys(updates[0]).sort(), [
        "askConfirm",
        "audience",
        "audienceSize",
        "confirmedCount",
        "createdAt",
        "editedAt",
        "id",
        "irsLink",
        "keepTopUntil",
        "kind",
        "message",
        "people",
        "postedAt",
        "postedByName",
        "readCount",
        "revision",
        "roles",
        "status",
        "title",
        "unpublishedAt",
      ]);
      await refusedWith(f, f.preparer, "vitally_posted_updates", {}, FORBIDDEN);
    });

    await t.test("rls: a preparer reads no draft and no other role's row; a client reads none; an unpublished row stays readable", async () => {
      const hidden = await draft({ title: "RLS draft" });
      const reviewers = await post({ title: "RLS reviewers only", audience: "roles", roles: ["reviewer"] });
      const shown = await post({ title: "RLS everyone" });
      const gone = await post({ title: "RLS unpublished" });
      await call(admin, ACTION, actionArgs(gone.updateId, 1, "UNPUBLISH"));
      const ids = [hidden.updateId, reviewers.updateId, shown.updateId, gone.updateId];
      assert.deepEqual(await selectedIds(f.preparer, ids), [shown.updateId, gone.updateId].sort());
      assert.deepEqual(await selectedIds(f.reviewer, ids), [reviewers.updateId, shown.updateId, gone.updateId].sort());
      assert.deepEqual(await selectedIds(admin, ids), [...ids].sort());
      assert.deepEqual(await selectedIds(f.applicantA, ids), []);
      // Another workspace's admin reads none of these.
      assert.deepEqual(await selectedIds(f.foreignStaff, ids), []);
    });

    await t.test("rls: select on update_reads is refused for an admin", async () => {
      const posted = await post({ title: "Reads stay private" });
      await mark(admin, [posted.updateId]);
      const { error } = await admin.from("update_reads").select("*");
      assert.ok(error, "update_reads read refused");
      assert.equal((await readsOf(f, posted.updateId)).length, 1, "the read exists");
    });

    await t.test("the policy helper answers only for the caller", async () => {
      // Run as the authenticated role with a real session's claims, rolled back.
      const answer = async (userId, audience, roles) => {
        await f.sql("begin");
        try {
          await f.sql("select set_config('request.jwt.claims',$1,true)", [
            JSON.stringify({ sub: userId, role: "authenticated" }),
          ]);
          await f.sql("set local role authenticated");
          return (
            await one(f, "select vitally_policy.in_update_audience($1,$2,$3::text[]) as answer", [
              f.workspaceId,
              audience,
              roles,
            ])
          ).answer;
        } finally {
          await f.sql("rollback");
        }
      };
      assert.equal(await answer(f.preparerUserId, "everyone", []), true);
      assert.equal(await answer(f.preparerUserId, "roles", ["reviewer"]), false);
      assert.equal(await answer(f.reviewerUserId, "roles", ["reviewer", "greeter"]), true);
      assert.equal(await answer(f.applicantAUserId, "everyone", []), false);
    });
  } finally {
    await f.close();
  }
});
