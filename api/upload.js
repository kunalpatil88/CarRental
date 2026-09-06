const { ok, fail, auth, configError, commitFiles } = require("./_lib");
module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  const err = configError(); if (err) return fail(res, 500, err);
  if (!auth(req)) return fail(res, 401, "Not signed in");
  try {
    const { name, data, folder } = req.body || {};
    const m = typeof data === "string" && data.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    if (!m) return fail(res, 400, "Expected a JPG, PNG or WebP image");
    const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 4 * 1024 * 1024) return fail(res, 400, "Image larger than 4 MB");
    const safeFolder = String(folder || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const base = String(name || "image").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    const rel = "assets/img/uploads/" + (safeFolder ? safeFolder + "/" : "") + `${Date.now().toString(36)}-${base}.${ext}`;
    await commitFiles([{ path: rel, content: buf }], "Upload photo from admin panel: " + rel);
    return ok(res, { path: rel, size: buf.length, deploying: true });
  } catch (e) { return fail(res, 500, e.message); }
};
