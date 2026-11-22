import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/056_onedrive_client_documents.sql", import.meta.url), "utf8");
test("OneDrive link is applicant scoped and does not return the certificate link", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.vitally_client_documents_link()"),sql.indexOf("revoke all on function public.vitally_client_documents_link()"));
  assert.match(fn, /require_membership\(\)/);
  assert.match(fn, /v_member.workspace_id/);
  assert.match(fn, /client_documents_url/);
  assert.doesNotMatch(fn, /certificate_upload_url/);
});
test("Only staff can confirm receipt, and clients cannot erase confirmed statuses", () => {
  assert.match(sql, /p_payload->>'status' in \('received','verified'\) and p_member.access<>'staff'/);
  assert.match(sql, /p_member.access='applicant' and exists/);
  assert.match(sql, /d.status in \('received','verified'\)/);
});
test("Document response payload accepts only requestId, no client-supplied filename", () => {
  assert.match(sql, /payload_keys\(p_payload\)<>array\['requestId'\]/);
  assert.match(sql, /OneDrive upload reported/);
  assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function vitally_private.receive_document")), /p_payload->>'filename'/);
});

test("An upload claim requires the workspace's client link", () => {
  assert.match(sql, /p_payload->>'status'='sent' and p_member.access<>'staff' and not exists/);
  assert.match(sql, /s.workspace_id=p_case.workspace_id/);
  assert.match(sql, /s.client_documents_url is not null/);
});
