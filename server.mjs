import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isLoopbackUrl } from "./src/loopback.mjs";

// The local demo server. It serves the browser files and one public
// configuration document, and nothing else: the repository also holds
// migrations, privileged tooling, test fixtures and ignored private
// environment files, none of which is reachable over this port.
//
// The allowlist is matched against the **raw** request path, before any dot
// segment or percent escape is resolved. Normalising first and then checking
// would let `/src/vendor/../app.mjs` slip through as a tidy path; refusing
// anything that is not literally one of these shapes cannot.
const PAGE = "/index.html";
const ASSET = /^\/src\/[a-z-]+\.(?:mjs|css|svg|png)$/;
const VENDOR = /^\/src\/vendor\/[a-z-]+\.mjs$/;
// The forms the drafts are built on, by their exact names: the IRS 13614-C in
// three languages (English, Simplified and Traditional Chinese) and PCDC's own
// Form 14446 in English and Traditional Chinese, and PCDC's blank Exit Form.
// The module rule above admits no digits, and nothing else under
// `src/forms/` is served.
const FORMS =
  /^\/src\/forms\/(?:f13614c[nt]?-2025|f14446-pcdc-(?:en|zh-t)|exit-form-pcdc)\.pdf$/;
const CONFIG = "/public-config.json";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
};
const JSON_TYPE = "application/json; charset=utf-8";
const DEFAULT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COOLDOWN_SECONDS = 65;

const value = (env, name) => String(env[name] ?? "").trim();

// The published resend cooldown is the server's own minimum interval plus five
// seconds. It is not a secret, but it must be a sane number: anything that is
// not a positive whole number of seconds falls back to the documented default
// rather than disabling the cooldown.
function cooldownSeconds(raw) {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return DEFAULT_COOLDOWN_SECONDS;
  const seconds = Number(text);
  return Number.isSafeInteger(seconds) && seconds > 0
    ? seconds
    : DEFAULT_COOLDOWN_SECONDS;
}

// Four keys, plus `demoTools: true` only when VITALLY_DEMO_TOOLS=1 and the
// Supabase URL is on this machine, and never any other environment value. Everything else in
// the process environment — administrative keys, database URLs, SMTP
// credentials — stays on the server side of this function.
export function publicConfig(env) {
  const supabaseUrl = value(env, "SUPABASE_URL");
  const supabasePublishableKey = value(env, "SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabasePublishableKey) return { configured: false };
  return {
    configured: true,
    supabaseUrl,
    supabasePublishableKey,
    authResendCooldownSeconds: cooldownSeconds(
      value(env, "AUTH_RESEND_COOLDOWN_SECONDS"),
    ),
    ...(value(env, "VITALLY_DEMO_TOOLS") === "1" && isLoopbackUrl(supabaseUrl)
      ? { demoTools: true }
      : {}),
  };
}

// The switch is on, the project is configured, but its URL is not local, so
// the switch has no effect. Used to warn once at start-up.
export function demoToolsIgnored(env) {
  return (
    value(env, "VITALLY_DEMO_TOOLS") === "1" &&
    publicConfig(env).configured &&
    !isLoopbackUrl(value(env, "SUPABASE_URL"))
  );
}

const served = (requested) =>
  requested === PAGE ||
  requested === CONFIG ||
  ASSET.test(requested) ||
  VENDOR.test(requested) ||
  FORMS.test(requested);

export function createAppServer({ env = process.env, root = DEFAULT_ROOT } = {}) {
  return http.createServer(async (req, res) => {
    const requested = req.url.split("?", 1)[0];
    const file = requested === "/" ? PAGE : requested;
    const head = req.method === "HEAD";
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      });
      res.end(head || body === undefined ? undefined : body);
    };
    const notFound = () => send(404, "text/plain; charset=utf-8", "Not found");
    if (!served(file)) return notFound();
    // A refused method on a served path says so; on any other path it still
    // says only that there is nothing there.
    if (!(req.method === "GET" || head))
      return send(405, "text/plain; charset=utf-8", "Method not allowed", {
        Allow: "GET, HEAD",
      });
    if (file === CONFIG)
      return send(200, JSON_TYPE, JSON.stringify(publicConfig(env)));
    try {
      const body = await readFile(path.join(root, file));
      send(200, TYPES[path.extname(file)], body);
    } catch {
      notFound();
    }
  });
}

if (import.meta.filename === process.argv[1]) {
  const port = Number(process.env.PORT || 4173);
  if (demoToolsIgnored(process.env))
    console.warn(
      "VITALLY_DEMO_TOOLS is ignored: the Supabase URL is not on this machine.",
    );
  createAppServer().listen(port, "127.0.0.1", () =>
    console.log(`ViTally demo ready: http://127.0.0.1:${port}`),
  );
}
