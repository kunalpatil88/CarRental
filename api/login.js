const { ok, fail, configError, newToken, verifyPassword } = require("./_lib");
// Best-effort throttle. Serverless instances are short-lived, so this slows guessing rather than stopping it;
// use a long ADMIN_PASSWORD (and Vercel Firewall rate limiting) for real protection.
const attempts = new Map();
module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  const err = configError(); if (err) return fail(res, 500, err);
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const a = attempts.get(ip) || { n: 0, t: 0 };
  if (a.n >= 8 && Date.now() - a.t < 10 * 60 * 1000) return fail(res, 429, "Too many attempts. Try again in 10 minutes.");
  const { password } = req.body || {};
  if (!verifyPassword(password)) {
    attempts.set(ip, { n: a.n + 1, t: Date.now() });
    await new Promise((r) => setTimeout(r, 400));
    return fail(res, 401, "Incorrect password");
  }
  attempts.delete(ip);
  return ok(res, { token: newToken(), defaultPassword: false });
};
