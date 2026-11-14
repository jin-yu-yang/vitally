// Edge Function entry for add-account-invitations (design D4). The logic is in
// handler.mjs; this file only builds the Supabase clients and serves.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handleAccountRequest } from "./handler.mjs";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const auth = { persistSession: false };

const deps = {
  userClient: (jwt: string) =>
    createClient(url, anonKey, { auth, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
  adminClient: createClient(url, serviceKey, { auth }),
  anonClient: createClient(url, anonKey, { auth }),
};

Deno.serve((request: Request) => handleAccountRequest(request, deps));
