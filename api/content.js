const { ok, fail, auth, configError, readFile, commitFiles, validateContent } = require("./_lib");
module.exports = async (req, res) => {
  const err = configError(); if (err) return fail(res, 500, err);
  // Every call hits the GitHub API, so keep it to signed-in admins (the public site reads data/content.json directly).
  if (!auth(req)) return fail(res, 401, "Not signed in");
  try {
    if (req.method === "GET") {
      // Always read the latest committed version so the admin never edits stale content while a deploy is in progress.
      res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(await readFile("data/content.json"));
    }
    if (req.method === "PUT") {
      const content = req.body;
      const v = validateContent(content); if (v) return fail(res, 400, v);
      // Published from another device since this editor loaded? Refuse unless the admin chose to overwrite.
      const base = req.headers["x-base-updated-at"];
      if (base && req.headers["x-force"] !== "1") {
        let cur = ""; try { cur = JSON.parse(await readFile("data/content.json")).updatedAt || ""; } catch (e) { /* first publish */ }
        if (cur && cur !== base) return res.status(409).json({ ok: false, error: "The site was published from another device since you started editing.", updatedAt: cur });
      }
      content.updatedAt = new Date().toISOString();
      const json = JSON.stringify(content, null, 2);
      const sha = await commitFiles([{ path: "data/content.json", content: json + "\n" }, { path: "data/content.js", content: "window.SITE_CONTENT = " + json + ";\n" }], "Publish content from admin panel");
      return ok(res, { updatedAt: content.updatedAt, commit: sha, deploying: true });
    }
    return fail(res, 405, "Method not allowed");
  } catch (e) { return fail(res, 500, e.message); }
};
