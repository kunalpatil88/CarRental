const { ok, configError, REPO, BRANCH } = require("./_lib");
module.exports = (req, res) => ok(res, { mode: "vercel", version: 1, repo: REPO, branch: BRANCH, configError: configError(), time: new Date().toISOString() });
