const { ok, configError } = require("./_lib");
module.exports = (req, res) => ok(res, { mode: "vercel", version: 2, configError: configError(), time: new Date().toISOString() });
