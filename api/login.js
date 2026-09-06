const { ok, fail, configError, newToken, verifyPassword } = require("./_lib");
module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  const err = configError(); if (err) return fail(res, 500, err);
  const { password } = req.body || {};
  if (!verifyPassword(password)) return fail(res, 401, "Incorrect password");
  return ok(res, { token: newToken(), defaultPassword: false });
};
