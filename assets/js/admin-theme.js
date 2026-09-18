/* Admin colour theme, applied before first paint (kept separate from the visitor's site theme). */
(function () {
  var d = document.documentElement, t, a;
  try { t = localStorage.getItem("dp-admin-theme"); a = localStorage.getItem("dp-accent"); } catch (e) { /* private mode */ }
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  d.setAttribute("data-theme", t);
  if (a && /^#[0-9a-f]{6}$/i.test(a)) d.style.setProperty("--brand", a);
})();
