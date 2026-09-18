/* ============================================================
   Cloudflare Worker (see wrangler.jsonc)
   The site itself is static files served by Cloudflare. This script only handles:
   - /car/<id>   share page with the car's photo, so WhatsApp shows a thumbnail on booking messages
   - /api/*      enquiry and track are accepted but not stored (no writable disk here, same as Vercel);
                 everything else returns 404, so the admin panel opens in static (export) mode
   ============================================================ */
import { renderCarPage, findCar, shareImages } from "../lib/carpage.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function carPage(env, url) {
  try {
    const id = decodeURIComponent(url.pathname.slice("/car/".length)).replace(/[^\w-]/g, "");
    const r = await env.ASSETS.fetch(new URL("/data/content.json", url.origin));
    if (r.ok) {
      const content = await r.json();
      let { full, small } = shareImages(findCar(content, id));
      // WhatsApp drops large og:images, so prefer the "-sm.jpg" copy when it exists
      if (small && !(await env.ASSETS.fetch(new URL("/" + small, url.origin), { method: "HEAD" })).ok) small = "";
      const html = renderCarPage(content, id, url.origin, small || full);
      if (html) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300" } });
    }
  } catch (e) { /* fall through to the home page */ }
  return new Response(null, { status: 302, headers: { Location: "/", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/car/")) return carPage(env, url);
    if (url.pathname === "/api/enquiry" && request.method === "POST") return json({ ok: true, stored: false });
    if (url.pathname === "/api/track" && request.method === "POST") return new Response(null, { status: 204 });
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Not available on this host" }, 404);
    return env.ASSETS.fetch(request);
  },
};
