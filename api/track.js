// Vercel's file system is read-only, so visits can't be counted here. Run the Node server for Admin → Analytics.
module.exports = (req, res) => { res.status(204).end(); };
