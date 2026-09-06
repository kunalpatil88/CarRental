const { ok, fail, auth, configError, readFile, commitFiles, validateContent } = require("./_lib");
module.exports = async (req, res) => {
  const err = configError(); if (err) return fail(res, 500, err);
  try {
    if (req.method === "GET") {
      // Always read the latest committed version so the admin never edits stale content while a deploy is in progress.
      res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(await readFile("data/content.json"));
    }
    if (req.method === "PUT") {
      if (!auth(req)) return fail(res, 401, "Not signed in");
      const content = req.body;
      const v = validateContent(content); if (v) return fail(res, 400, v);
      content.updatedAt = new Date().toISOString();
      const json = JSON.stringify(content, null, 2);
      const sha = await commitFiles([{ path: "data/content.json", content: json + "\n" }, { path: "data/content.js", content: "window.SITE_CONTENT = " + json + ";\n" }], "Publish content from admin panel");
      return ok(res, { updatedAt: content.updatedAt, commit: sha, deploying: true });
    }
    return fail(res, 405, "Method not allowed");
  } catch (e) { return fail(res, 500, e.message); }
};
