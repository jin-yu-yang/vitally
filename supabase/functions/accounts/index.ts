// Edge Function entry for add-account-invitations (design D4). The logic is in
// handler.mjs; this file only builds the Supabase clients and serves.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handleAccountRequest } from "./handler.mjs";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const auth = { persistSession: false };

const missing = [
  ["SUPABASE_URL", url],
  ["SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY", anonKey],
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length) {
  // Name the variables, never their values.
  console.error(`accounts function: missing environment variable ${missing.join(", ")}`);
  Deno.serve(() =>
    new Response(JSON.stringify({ code: "SERVER_ERROR" }), {
      status: 500,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    }));
} else {
  const deps = {
    userClient: (jwt: string) =>
      createClient(url!, anonKey!, { auth, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    adminClient: createClient(url!, serviceKey!, { auth }),
    anonClient: createClient(url!, anonKey!, { auth }),
  };
  Deno.serve((request: Request) => handleAccountRequest(request, deps));
}
