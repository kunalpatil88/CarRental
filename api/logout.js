const { ok } = require("./_lib");
module.exports = (req, res) => ok(res); // tokens are stateless; the browser just forgets it
