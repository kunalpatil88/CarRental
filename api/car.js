/* /car/<id> on Vercel (rewritten here by vercel.json). Serves the share page with the car's
   photo as the Open Graph image, so WhatsApp shows it as a thumbnail on booking messages. */
const { renderCarPage, findCar, shareImages } = require("../lib/carpage");
module.exports = async (req, res) => {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().replace(/[^\w.:-]/g, "");
  const origin = "https://" + host;
  const id = String((req.query && req.query.id) || "").replace(/[^\w-]/g, "");
  let html = null;
  try {
    const r = await fetch(origin + "/data/content.json", { cache: "no-store" });
    if (r.ok) {
      const content = await r.json();
      let { full, small } = shareImages(findCar(content, id));
      if (small) { try { const h = await fetch(origin + "/" + small, { method: "HEAD" }); if (!h.ok) small = ""; } catch (e) { small = ""; } }
      html = renderCarPage(content, id, origin, small || full);
    }
  } catch (e) { /* fall through to the home page */ }
  if (!html) { res.setHeader("Cache-Control", "no-store"); return res.redirect(302, "/"); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  return res.status(200).send(html);
};
