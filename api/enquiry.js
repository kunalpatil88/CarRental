const { ok } = require("./_lib");
// Vercel's file system is read-only, so enquiries can't be stored here. The WhatsApp message
// still reaches the owner; run the Node server (npm start or Docker) to keep an enquiry log.
module.exports = (req, res) => ok(res, { stored: false });
