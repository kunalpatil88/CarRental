/* Shared helpers for the Vercel serverless API.
   On Vercel the file system is read-only, so "publishing" commits content.json
   (and uploaded photos) to the GitHub repo, and Vercel redeploys automatically. */
"use strict";
const crypto = require("crypto");

const REPO = process.env.GITHUB_REPO || "";            // e.g. kunalpatil88/CarRental
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN || "";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("driveease|" + PASSWORD + "|" + TOKEN).digest("hex");
const SESSION_TTL = 12 * 60 * 60 * 1000;

function json(res, status, body) { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.status(status).send(JSON.stringify(body)); }
const ok = (res, data) => json(res, 200, { ok: true, ...(data || {}) });
const fail = (res, status, error) => json(res, status, { ok: false, error });

function configError() {
  const missing = [];
  if (!PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!TOKEN) missing.push("GITHUB_TOKEN");
  if (!REPO) missing.push("GITHUB_REPO");
  return missing.length ? "Missing environment variables on Vercel: " + missing.join(", ") : null;
}

/* ---------- stateless sessions (HMAC-signed expiry) ---------- */
function sign(exp) { return crypto.createHmac("sha256", SECRET).update(String(exp)).digest("hex"); }
function newToken() { const exp = Date.now() + SESSION_TTL; return exp + "." + sign(exp); }
function auth(req) {
  const h = req.headers.authorization || ""; const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [exp, sig] = t.split("."); if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp); return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function verifyPassword(pw) { if (!PASSWORD || typeof pw !== "string") return false; const a = Buffer.from(pw), b = Buffer.from(PASSWORD); return a.length === b.length && crypto.timingSafeEqual(a, b); }

/* ---------- GitHub API ---------- */
async function gh(method, path, body) {
  const r = await fetch("https://api.github.com" + path, { method, headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json", "User-Agent": "driveease-admin", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${method} ${path} failed (${r.status}): ${data.message || "unknown error"}`);
  return data;
}
async function readFile(path) {
  const d = await gh("GET", `/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  return Buffer.from(d.content, "base64").toString("utf8");
}
/* Commit several files in ONE commit via the Git Data API (so Vercel deploys once). files: [{path, content: Buffer|string}] */
async function commitFiles(files, message) {
  const ref = await gh("GET", `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await gh("GET", `/repos/${REPO}/git/commits/${headSha}`);
  const tree = [];
  for (const f of files) {
    const blob = await gh("POST", `/repos/${REPO}/git/blobs`, { content: Buffer.from(f.content).toString("base64"), encoding: "base64" });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh("POST", `/repos/${REPO}/git/trees`, { base_tree: headCommit.tree.sha, tree });
  const commit = await gh("POST", `/repos/${REPO}/git/commits`, { message, tree: newTree.sha, parents: [headSha] });
  await gh("PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
  return commit.sha;
}
async function listImages() {
  const ref = await gh("GET", `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const t = await gh("GET", `/repos/${REPO}/git/trees/${ref.object.sha}?recursive=1`);
  return (t.tree || []).map((x) => x.path).filter((p) => /^assets\/img\/(promos|cars|uploads)\/.*\.(jpe?g|png|webp|gif)$/i.test(p) && !/-sm\.jpg$/i.test(p));
}
function validateContent(c) {
  if (!c || typeof c !== "object") return "Content must be an object";
  if (!c.site || typeof c.site !== "object") return "Missing site settings";
  if (!Array.isArray(c.fleet)) return "fleet must be an array";
  for (const car of c.fleet) { if (!car.id || !car.name) return "Every car needs an id and a name"; }
  return null;
}

module.exports = { ok, fail, configError, newToken, auth, verifyPassword, readFile, commitFiles, listImages, validateContent, REPO, BRANCH };
