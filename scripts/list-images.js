/* Build step for the Cloudflare Worker (run by wrangler, see wrangler.jsonc):
   writes worker/static-images.json, every photo file in the repo (thumbnails included), which the
   Worker copies into R2. A Worker can't list its own static files, so the list is made here. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
function list(rel) {
  const dir = path.join(ROOT, rel), out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = rel + "/" + ent.name;
    if (ent.isDirectory()) out.push(...list(p));
    else if (/\.(jpe?g|png|webp|gif)$/i.test(ent.name)) out.push(p);
  }
  return out;
}
const images = ["assets/img/promos", "assets/img/cars", "assets/img/uploads"].flatMap(list);
fs.writeFileSync(path.join(ROOT, "worker", "static-images.json"), JSON.stringify(images) + "\n");
console.log(`Listed ${images.length} photo files to copy into R2`);
