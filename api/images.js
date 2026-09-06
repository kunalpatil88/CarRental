const { ok, fail, auth, configError, listImages } = require("./_lib");
module.exports = async (req, res) => {
  const err = configError(); if (err) return fail(res, 500, err);
  if (!auth(req)) return fail(res, 401, "Not signed in");
  try { return ok(res, { images: await listImages() }); } catch (e) { return fail(res, 500, e.message); }
};
