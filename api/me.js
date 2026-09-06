const { ok, fail, auth } = require("./_lib");
module.exports = (req, res) => (auth(req) ? ok(res, { defaultPassword: false }) : fail(res, 401, "Not signed in"));
