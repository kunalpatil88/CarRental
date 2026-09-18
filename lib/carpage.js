/* Per-car share page: /car/<id>
   WhatsApp (and other apps) read the Open Graph tags here to show the car's photo as a
   thumbnail above the booking message. People who tap the link are sent on to the car on the site. */
"use strict";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

const findCar = (content, id) => ((content && content.fleet) || []).find((c) => c && c.id === id) || null;
/* The car's cover photo, plus its "-sm.jpg" copy. WhatsApp drops og:images over ~300 KB,
   and the full-size covers often are, so callers use the small copy whenever it exists. */
function shareImages(car) {
  const full = String((car && (car.cover || (car.images || [])[0])) || "").trim().replace(/^\/+/, "");
  const small = /\/\d{2}\.jpg$/i.test(full) ? full.replace(/(\/\d{2})\.jpg$/i, "$1-sm.jpg") : "";
  return { full, small };
}

/* origin: e.g. "https://example.com". img: the photo path to use (see shareImages).
   Returns the page HTML, or null when the car doesn't exist. */
function renderCarPage(content, id, origin, img) {
  const car = findCar(content, id);
  if (!car) return null;
  const site = (content.site && content.site.name) || "";
  if (img === undefined) img = shareImages(car).full;
  const imgUrl = img ? (/^https:\/\//i.test(img) ? img : new URL(img, origin + "/").href) : "";
  const imgType = /\.png$/i.test(img) ? "image/png" : /\.webp$/i.test(img) ? "image/webp" : "image/jpeg";
  const target = origin + "/#car-" + encodeURIComponent(car.id);
  const title = `${car.name}${site ? " | " + site : ""}`;
  const desc = [[car.category, car.transmission, car.fuel].filter(Boolean).join(" · "), car.pricePerDay ? inr(car.pricePerDay) + "/day" : ""].filter(Boolean).join(" · ");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(site)}" />
<meta property="og:title" content="${esc(car.name)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(origin + "/car/" + encodeURIComponent(car.id))}" />
${imgUrl ? `<meta property="og:image" content="${esc(imgUrl)}" />
${/^https:/.test(imgUrl) ? `<meta property="og:image:secure_url" content="${esc(imgUrl)}" />\n` : ""}<meta property="og:image:type" content="${imgType}" />
<meta property="og:image:alt" content="${esc(car.name)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(imgUrl)}" />` : ""}
<link rel="canonical" href="${esc(target)}" />
<meta http-equiv="refresh" content="0; url=${esc(target)}" />
</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:40px 16px">
<p><a href="${esc(target)}">View ${esc(car.name)}</a></p>
</body></html>`;
}

module.exports = { renderCarPage, findCar, shareImages };
