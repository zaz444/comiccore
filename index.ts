// supabase/functions/get-ip/index.ts
//
// Returns the caller's real IP address. Deploy with --no-verify-jwt
// since this gets called from login.html before the user has a session.
//
// IMPORTANT: Supabase's edge network sits behind Cloudflare, and the
// x-forwarded-for header CAN be spoofed by the client — if you set your
// own X-Forwarded-For on the request, Supabase appends the real IP after
// it rather than replacing it (e.g. "spoofed, 68.65.164.215"). Taking the
// FIRST entry would let anyone fake their IP to dodge a ban. We use
// cf-connecting-ip first (set by Cloudflare itself, not spoofable), and
// fall back to the LAST x-forwarded-for entry if that header is missing.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  let ip = req.headers.get("cf-connecting-ip");

  if (!ip) {
    const xff = req.headers.get("x-forwarded-for") || "";
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    ip = parts.length ? parts[parts.length - 1] : null;
  }

  return new Response(JSON.stringify({ ip: ip || "unknown" }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
