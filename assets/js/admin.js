/* ============================================================
   DP Self Drive — Admin
   Edits data/content.json. Three modes:
     server  → node server.js: publish, uploads, backups, password
     vercel  → publishes by committing to GitHub (Vercel redeploys)
     static  → no server: edit in the browser, export content.json
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "car";
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
  const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
  const small = (src) => String(src || "").replace(/(\/\d{2})\.jpg$/i, "$1-sm.jpg");
  const safeImg = (u) => { const s = String(u || "").trim(); return /^(assets\/|\/|https:\/\/|blob:)/i.test(s) && !/["'()\\]/.test(s) ? s : ""; };
  const store = { get(k, ls) { try { return (ls === false ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } }, set(k, v, ls) { try { const s = ls === false ? sessionStorage : localStorage; v == null ? s.removeItem(k) : s.setItem(k, v); } catch (e) { /* private mode */ } } };
  const DRAFT_KEY = "dp_admin_draft";
  const TOKEN_KEY = "dp_admin_token";

  const state = { an: { days: 7, data: null, supported: false }, enq: { list: [], counts: {}, supported: false, filter: { q: "", status: "", from: "", to: "" } }, mode: "static", configError: "", token: store.get(TOKEN_KEY) || store.get(TOKEN_KEY, false) || "", content: null, saved: null, section: "dashboard", dirty: false, changed: [], defaultPassword: false, publishing: false };
  const online = () => state.mode === "server" || state.mode === "vercel";

  /* ---------- path helpers ---------- */
  const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, val) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }

  /* ---------- toast (with optional action, e.g. Undo) ---------- */
  function toast(msg, kind, opts) {
    const t = $("#toast"); opts = opts || {};
    t.className = "toast is-visible" + (kind ? " is-" + kind : "");
    t.innerHTML = (kind === "error" ? icon("alert-triangle") : kind === "success" ? icon("check-circle") : "") + `<span>${esc(msg)}</span>` + (opts.action ? `<button type="button" class="toast__action">${esc(opts.action)}</button>` : "");
    if (opts.action) $(".toast__action", t).onclick = () => { t.classList.remove("is-visible"); opts.onAction(); };
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("is-visible"), opts.action ? 6000 : kind === "error" ? 5000 : 3000);
  }

  /* ---------- confirm dialog → resolves to the chosen button value ---------- */
  function ask({ title, text, buttons }) {
    const d = $("#confirmDlg");
    $("#confirmTitle").textContent = title; $("#confirmText").textContent = text || ""; $("#confirmText").hidden = !text;
    $("#confirmActions").innerHTML = (buttons || [{ label: "Cancel", value: "" }, { label: "OK", value: "ok", kind: "primary" }]).map((b) => `<button class="btn btn--${b.kind || "soft"}" value="${esc(b.value)}" type="submit">${esc(b.label)}</button>`).join("");
    d.returnValue = ""; d.showModal();
    const def = $(`#confirmActions .btn--primary, #confirmActions .btn--danger`); if (def) def.focus();
    return new Promise((res) => d.addEventListener("close", () => res(d.returnValue), { once: true }));
  }

  /* ---------- API ---------- */
  async function api(method, path, body, headers) {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: "Bearer " + state.token } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401 && path !== "/api/login") { const e = new Error("Your session expired. Please sign in again."); e.status = 401; await reauth(); throw e; }
    if (!r.ok || data.ok === false) { const e = new Error(data.error || `Request failed (${r.status})`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  async function detectMode() {
    try { const r = await fetch("/api/health", { cache: "no-store" }); const d = await r.json(); if (d.ok) { state.mode = d.mode === "vercel" ? "vercel" : "server"; state.configError = d.configError || ""; state.enq.supported = !!d.enquiries; state.an.supported = !!d.analytics; state.photoStore = !!d.photos; return; } } catch (e) { /* static */ }
    state.mode = "static";
  }
  async function loadContent() {
    if (online() && state.token) return api("GET", "/api/content");
    try { const r = await fetch("data/content.json", { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) { /* file:// */ }
    if (!window.SITE_CONTENT) await new Promise((res) => { const s = document.createElement("script"); s.src = "data/content.js"; s.onload = s.onerror = res; document.head.appendChild(s); });
    if (window.SITE_CONTENT) return clone(window.SITE_CONTENT);
    throw new Error("Could not load content.json");
  }

  /* ---------- admin theme ---------- */
  function setAdminTheme(t) {
    document.documentElement.setAttribute("data-theme", t); store.set("dp-admin-theme", t);
    $$("[data-admin-theme]").forEach((b) => { b.querySelector("svg") && (b.querySelector("svg").outerHTML = icon(t === "dark" ? "sun" : "moon")); const l = $(".theme-label", b); if (l) l.textContent = t === "dark" ? "Light mode" : "Dark mode"; });
    $('meta[name="theme-color"]').content = t === "dark" ? "#0b0c0f" : "#f5f5f7";
  }

  /* ---------- branding (name, logo, accent) ---------- */
  function applyBranding(c) {
    const site = (c && c.site) || {}; const name = site.name || "Admin";
    $$("[data-brand-mark]").forEach((m) => (m.innerHTML = safeImg(site.logo) ? `<img src="${esc(site.logo)}" alt="" />` : brandMark(38)));
    $$(".brand-name").forEach((n) => (n.textContent = name));
    document.title = "Admin · " + name;
    const accent = c && c.theme && /^#[0-9a-f]{6}$/i.test(c.theme.accent || "") ? c.theme.accent : "";
    if (accent) document.documentElement.style.setProperty("--brand", accent); else document.documentElement.style.removeProperty("--brand");
  }

  /* ============================================================
     Dirty tracking, status, drafts
     ============================================================ */
  const SECTION_LABELS = { site: "Business", seo: "SEO", hero: "Hero", stats: "Stats", features: "Why us", howItWorks: "How it works", testimonials: "Reviews", faq: "FAQ", contact: "Contact", footer: "Footer", fleet: "Fleet", social: "Social", promos: "Offers", theme: "Theme" };
  function computeDirty() {
    const a = state.content, b = state.saved || {};
    state.changed = Object.keys({ ...a, ...b }).filter((k) => k !== "updatedAt" && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    state.dirty = state.changed.length > 0;
  }
  function markDirty(immediate) {
    clearTimeout(markDirty._t);
    const run = () => {
      computeDirty(); renderStatus(); refreshNavCounts(); applyBranding(state.content);
      if (state.dirty) store.set(DRAFT_KEY, JSON.stringify({ at: Date.now(), base: (state.saved || {}).updatedAt || "", content: state.content })); else store.set(DRAFT_KEY, null);
      pushPreview();
    };
    if (immediate) run(); else markDirty._t = setTimeout(run, 180);
  }
  function renderStatus() {
    const st = $("#status"), save = $("#saveBtn");
    if (state.publishing) { st.className = "status is-busy"; st.textContent = "Publishing…"; }
    else if (state.dirty) { st.className = "status is-dirty"; const names = state.changed.map((k) => SECTION_LABELS[k] || k); st.textContent = "Unsaved · " + names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : ""); st.title = "Unsaved changes in: " + names.join(", "); }
    else { st.className = "status"; const at = (state.saved || {}).updatedAt; st.textContent = at ? "Published " + new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "All changes saved"; st.title = ""; }
    save.disabled = state.publishing || (!state.dirty && online());
    $("#saveLabel").textContent = online() ? (state.publishing ? "Publishing…" : "Publish") : "Export";
    $("#discardBtn").disabled = !state.dirty;
  }
  window.addEventListener("beforeunload", (e) => { if (state.dirty && online()) { e.preventDefault(); e.returnValue = ""; } });

  /* ============================================================
     Auth
     ============================================================ */
  async function signIn(pw, remember) {
    if (online()) {
      const d = await api("POST", "/api/login", { password: pw });
      state.token = d.token; state.defaultPassword = !!d.defaultPassword;
      store.set(TOKEN_KEY, remember ? d.token : null); store.set(TOKEN_KEY, remember ? null : d.token, false);
    }
    await boot();
  }
  function forgetToken() { state.token = ""; store.set(TOKEN_KEY, null); store.set(TOKEN_KEY, null, false); }
  function signOut() {
    if (online() && state.token) api("POST", "/api/logout").catch(() => {});
    forgetToken(); $("#app").hidden = true; $("#login").hidden = false; $("#loginPw").value = ""; $("#loginPw").focus();
  }
  /* Session expired mid-edit: keep the editor and its unsaved work, just ask for the password again. */
  let reauthing = null;
  function reauth() {
    if (reauthing) return reauthing;
    forgetToken();
    if ($("#app").hidden) return Promise.resolve();
    reauthing = (async () => {
      const d = $("#confirmDlg");
      $("#confirmTitle").textContent = "Please sign in again";
      $("#confirmText").hidden = false; $("#confirmText").textContent = "Your session expired. Your unsaved changes are safe.";
      $("#confirmActions").innerHTML = `<div class="field" style="width:100%"><input type="password" id="reauthPw" placeholder="Password" autocomplete="current-password" /></div><button class="btn btn--soft" type="button" id="reauthLater">Later</button><button class="btn btn--primary" value="ok" type="submit">Sign in</button>`;
      d.returnValue = ""; d.showModal(); $("#reauthPw").focus(); $("#reauthLater").onclick = () => d.close("");
      const v = await new Promise((res) => d.addEventListener("close", () => res(d.returnValue), { once: true }));
      if (v === "ok") {
        try { const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#reauthPw").value }) }); const j = await r.json(); if (!j.ok) throw new Error(j.error); state.token = j.token; store.set(TOKEN_KEY, j.token, false); toast("Signed in. Try that again.", "success"); }
        catch (e) { toast(e.message || "Sign-in failed", "error"); }
      }
      reauthing = null;
    })();
    return reauthing;
  }

  /* ============================================================
     Sections
     ============================================================ */
  const SECTIONS = [
    { id: "dashboard", group: "Overview", label: "Dashboard", icon: "home", sub: "Today at a glance" },
    { id: "enquiries", group: "Overview", label: "Enquiries", icon: "inbox", sub: "Booking requests from the website", count: () => state.enq.counts.new || "", keys: "enquiry leads bookings requests customers excel download export" },
    { id: "analytics", group: "Overview", label: "Analytics", icon: "bar-chart", sub: "Visitors, devices and where they come from", keys: "traffic visitors views stats mobile desktop device phone model brand country city location source google instagram whatsapp clicks" },
    { id: "fleet", group: "Fleet", label: "Cars & availability", icon: "car", sub: "Add cars, set prices, mark booked", count: () => (state.content.fleet || []).length, keys: "car fleet photos price booked available" },
    { id: "promos", group: "Marketing", label: "Offers & posters", icon: "tag", sub: "Rotating posters under the hero", count: () => livePromos().length, keys: "poster banner discount festival" },
    { id: "announcement", group: "Marketing", label: "Announcement bar", icon: "megaphone", sub: "Slim notice at the very top of the site", keys: "notice offer banner top" },
    { id: "testimonials", group: "Marketing", label: "Reviews", icon: "message-circle", sub: "Customer testimonials", count: () => (state.content.testimonials.items || []).length, keys: "testimonial rating stars" },
    { id: "social", group: "Marketing", label: "Social media", icon: "share", sub: "Profile links, follow section, share buttons", keys: "instagram facebook youtube google" },
    { id: "seo", group: "Marketing", label: "SEO & sharing", icon: "globe", sub: "How you look on Google and WhatsApp", keys: "google title description meta keywords og image" },
    { id: "hero", group: "Home page", label: "Hero banner", icon: "layout", sub: "Headline, buttons and background photo", keys: "headline title photo background" },
    { id: "stats", group: "Home page", label: "Stats strip", icon: "bar-chart", sub: "The numbers under the hero", keys: "numbers rating customers" },
    { id: "features", group: "Home page", label: "Why choose us", icon: "sparkles", sub: "Feature cards with icons", keys: "benefits features" },
    { id: "how", group: "Home page", label: "How it works", icon: "list", sub: "Booking steps", keys: "steps process" },
    { id: "faq", group: "Home page", label: "FAQ", icon: "help-circle", sub: "Frequently asked questions", count: () => (state.content.faq.items || []).length, keys: "questions answers" },
    { id: "contact", group: "Home page", label: "Contact & footer", icon: "mail", sub: "Contact section and footer text", keys: "footer copyright about" },
    { id: "site", group: "Settings", label: "Business & contact", icon: "phone", sub: "Name, phone, WhatsApp, address, map", keys: "phone whatsapp email address map hours name" },
    { id: "branding", group: "Settings", label: "Logo & theme", icon: "palette", sub: "Logo, colours, dark mode", keys: "logo favicon colour color accent dark light theme brand" },
    { id: "backups", group: "Settings", label: "History", icon: "refresh", sub: "Restore a previous version", keys: "backup restore undo version" },
    { id: "security", group: "Settings", label: "Security", icon: "lock", sub: "Admin password", keys: "password" },
  ];
  function renderNav() {
    const q = ($("#navSearch").value || "").trim().toLowerCase();
    const list = SECTIONS.filter((s) => !q || (s.label + " " + s.sub + " " + (s.keys || "")).toLowerCase().includes(q));
    let html = "", group = "";
    list.forEach((s) => {
      if (s.group !== group && !q) { group = s.group; html += `<div class="nav-group">${esc(group)}</div>`; }
      html += `<button type="button" data-section="${s.id}" class="${s.id === state.section ? "is-active" : ""}" ${s.id === state.section ? 'aria-current="page"' : ""}>${icon(s.icon)}<span>${esc(s.label)}</span>${s.count ? `<span class="pill" data-count="${s.id}"></span>` : ""}</button>`;
    });
    $("#nav").innerHTML = html || `<div class="is-empty">Nothing matches “${esc(q)}”</div>`;
    $$("#nav [data-section]").forEach((b) => (b.onclick = () => { go(b.dataset.section); closeSidebar(); }));
    refreshNavCounts();
  }
  function refreshNavCounts() { SECTIONS.forEach((s) => { if (s.count) { const el = $(`[data-count="${s.id}"]`); if (el) el.textContent = s.count(); } }); }
  function go(id, opts) {
    opts = opts || {};
    const s = SECTIONS.find((x) => x.id === id) || SECTIONS[0]; id = s.id;
    const sameSection = state.section === id, y = scrollY;
    state.section = id;
    $$("#nav [data-section]").forEach((b) => { const on = b.dataset.section === id; b.classList.toggle("is-active", on); on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
    $$("[data-tab-go]").forEach((b) => b.classList.toggle("is-active", b.dataset.tabGo === id));
    $("#pageTitle").textContent = s.label; $("#pageSub").textContent = s.sub;
    const root = $("#content"); root.innerHTML = "";
    RENDER[id](root); hydrateIcons(root); bindFields(root); fixThumbs(root);
    if (opts.keepScroll && sameSection) scrollTo(0, y);
    else { scrollTo(0, 0); root.classList.remove("is-entering"); void root.offsetWidth; root.classList.add("is-entering"); }
    if (location.hash.slice(1) !== id) history.pushState(null, "", "#" + id);
  }
  const rerender = () => go(state.section, { keepScroll: true });
  window.addEventListener("popstate", () => { const id = location.hash.slice(1); if ($("#drawer").hidden && SECTIONS.some((s) => s.id === id) && id !== state.section) go(id); });

  /* ============================================================
     Form builders
     ============================================================ */
  const help = (o) => (o.help ? ` <small>${esc(o.help)}</small>` : "");
  const F = {
    text: (path, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""}" data-field="${esc(path)}"><label>${esc(label)}${help(o)}</label>${o.prefix ? `<div class="prefix"><span>${esc(o.prefix)}</span>` : ""}<input type="${o.type || "text"}" data-path="${esc(path)}" ${o.type === "number" ? `data-type="number" inputmode="numeric" min="${o.min ?? 0}" step="${o.step || 1}" ${o.def != null ? `data-default="${o.def}"` : ""}` : ""} value="${esc(getPath(state.content, path))}" placeholder="${esc(o.placeholder || "")}" ${o.max ? `data-max="${o.max}"` : ""} ${o.inputmode ? `inputmode="${o.inputmode}"` : ""} />${o.prefix ? "</div>" : ""}${o.max ? `<div class="field__meta"><span></span><span data-counter></span></div>` : ""}<div class="hint" data-hint hidden></div></div>`,
    area: (path, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""}" data-field="${esc(path)}"><label>${esc(label)}${help(o)}</label><textarea data-path="${esc(path)}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || "")}" ${o.max ? `data-max="${o.max}"` : ""}>${esc(getPath(state.content, path))}</textarea>${o.max ? `<div class="field__meta"><span></span><span data-counter></span></div>` : ""}<div class="hint" data-hint hidden></div></div>`,
    select: (path, label, options, o = {}) => `<div class="field ${o.full ? "field--full" : ""}"><label>${esc(label)}${help(o)}</label><select data-path="${esc(path)}" ${o.number ? 'data-type="number"' : ""}>${options.map((v) => `<option value="${esc(v.value ?? v)}" ${String(getPath(state.content, path)) === String(v.value ?? v) ? "selected" : ""}>${esc(v.label ?? v)}</option>`).join("")}</select></div>`,
    toggle: (path, label, o = {}) => `<label class="switch ${o.full ? "field--full" : ""}"><input type="checkbox" data-path="${esc(path)}" data-type="bool" ${getPath(state.content, path) ? "checked" : ""} /><span class="track"></span><span>${esc(label)}</span></label>`,
    image: (path, label, o = {}) => { const v = getPath(state.content, path); return `<div class="field field--full"><label>${esc(label)}${help(o)}</label>
      <div class="imgfield"><div class="imgfield__preview ${o.contain ? "imgfield__preview--contain" : ""}">${safeImg(v) ? `<img src="${esc(v)}" alt="" />` : o.placeholderHtml || icon("image")}</div>
      <div style="display:grid;gap:10px;min-width:0"><input data-path="${esc(path)}" value="${esc(v)}" placeholder="${esc(o.placeholder || "assets/img/…")}" />
      <div class="imgfield__actions"><button type="button" class="btn btn--soft btn--sm" data-lib-for="${esc(path)}">${icon("image")} Library</button><button type="button" class="btn btn--soft btn--sm" data-upload-for="${esc(path)}" ${!online() ? "disabled title='Uploads need the server (npm start)'" : ""}>${icon("upload")} Upload</button>${v ? `<button type="button" class="btn btn--ghost btn--sm" data-clear="${esc(path)}">${icon("x")} Remove</button>` : ""}</div></div></div></div>`; },
    tags: (path, label, o = {}) => `<div class="field field--full"><label>${esc(label)} <small>one per line</small></label><textarea data-path="${esc(path)}" data-type="lines" rows="${o.rows || 4}">${esc((getPath(state.content, path) || []).join("\n"))}</textarea></div>`,
  };
  function repeat(path, opts) {
    const items = getPath(state.content, path) || [];
    return `<div class="rep" data-rep="${esc(path)}">${items.map((it, i) => `<div class="rep__item" data-i="${i}">
      <div class="rep__handle"><button type="button" data-move="${path}|${i}|-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">${icon("arrow-up")}</button><button type="button" data-move="${path}|${i}|1" ${i === items.length - 1 ? "disabled" : ""} aria-label="Move down">${icon("arrow-down")}</button></div>
      <div class="rep__body">${opts.item(`${path}.${i}`, it, i)}</div>
      <button type="button" class="rep__remove" data-remove="${path}|${i}" aria-label="Remove">${icon("trash")}</button></div>`).join("")}
      <button type="button" class="rep__add" data-add="${esc(path)}">${icon("plus")} ${esc(opts.addLabel || "Add item")}</button></div>`;
  }
  const REPEAT_DEFAULTS = {
    stats: () => ({ value: "10+", label: "New stat" }),
    "features.items": () => ({ icon: "check-circle", title: "New feature", text: "Describe the benefit in one or two sentences." }),
    "howItWorks.steps": () => ({ title: "New step", text: "What the customer does at this step." }),
    "testimonials.items": () => ({ name: "Customer name", role: "Trip or occasion", rating: 5, text: "What they said about the experience." }),
    "faq.items": () => ({ q: "New question?", a: "The answer." }),
    "social.links": () => ({ platform: "instagram", label: "Instagram", url: "", enabled: true }),
    "promos.items": () => ({ image: "", title: "", caption: "", text: "", ctaText: "", link: "#fleet", enabled: true, startDate: "", endDate: "", fit: "auto" }),
  };
  function readInput(el) {
    const type = el.dataset.type || el.type; let v = el.value;
    if (type === "bool" || type === "checkbox") return el.checked;
    if (type === "number") { if (v === "") return el.dataset.default != null ? Number(el.dataset.default) : null; const n = Number(v); return Number.isFinite(n) ? n : null; }
    if (type === "lines") return v.split("\n").map((s) => s.trim()).filter(Boolean);
    return v;
  }
  function bindFields(root) {
    $$("[data-path]", root).forEach((el) => {
      const path = el.dataset.path;
      const handler = (e) => {
        setPath(state.content, path, readInput(el)); markDirty();
        const f = el.closest(".imgfield"); if (f) { const pv = $(".imgfield__preview", f); pv.innerHTML = safeImg(el.value) ? `<img src="${esc(el.value)}" alt="" />` : icon("image"); }
        updateCounter(el); validateField(el);
        if (e.type === "change" && el.dataset.rerender) rerender();
      };
      el.addEventListener("input", handler); el.addEventListener("change", handler);
      updateCounter(el); validateField(el);
    });
    $$("[data-move]", root).forEach((b) => (b.onclick = () => { const [p, i, d] = b.dataset.move.split("|"); const arr = getPath(state.content, p); const a = +i, z = a + +d; [arr[a], arr[z]] = [arr[z], arr[a]]; markDirty(); rerender(); flash(p, z); }));
    $$("[data-remove]", root).forEach((b) => (b.onclick = () => {
      const [p, i] = b.dataset.remove.split("|"); const arr = getPath(state.content, p); const removed = arr.splice(+i, 1)[0];
      markDirty(); rerender(); toast("Item removed", "", { action: "Undo", onAction: () => { arr.splice(+i, 0, removed); markDirty(); rerender(); flash(p, +i); } });
    }));
    $$("[data-add]", root).forEach((b) => (b.onclick = () => { const p = b.dataset.add; const arr = getPath(state.content, p) || []; arr.push((REPEAT_DEFAULTS[p] || (() => ({})))()); setPath(state.content, p, arr); markDirty(); rerender(); const last = flash(p, arr.length - 1); if (last) { last.scrollIntoView({ behavior: "smooth", block: "center" }); const inp = $("input:not([type=checkbox]),textarea", last); if (inp) inp.focus({ preventScroll: true }); } }));
    $$("[data-lib-for]", root).forEach((b) => (b.onclick = () => openLibrary({ single: true }, (paths) => { if (!paths[0]) return; setPath(state.content, b.dataset.libFor, paths[0]); markDirty(); rerender(); })));
    $$("[data-upload-for]", root).forEach((b) => (b.onclick = () => pickFiles(false, async (files) => { const p = await uploadFiles(files, "site"); if (p[0]) { setPath(state.content, b.dataset.uploadFor, p[0]); markDirty(); rerender(); } })));
    $$("[data-clear]", root).forEach((b) => (b.onclick = () => { setPath(state.content, b.dataset.clear, ""); markDirty(); rerender(); }));
    $$("[data-go]", root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); if (b.dataset.focus) { const el = $(`[data-path="${b.dataset.focus}"]`); if (el) { el.focus(); el.scrollIntoView({ block: "center" }); } } }));
  }
  function flash(path, i) { const el = $(`[data-rep="${path}"] > .rep__item[data-i="${i}"]`); if (el) { el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash"); } return el; }
  function updateCounter(el) {
    const max = +el.dataset.max; if (!max) return; const c = $("[data-counter]", el.closest(".field")); if (!c) return;
    const n = el.value.length; c.textContent = `${n} / ${max}`; c.classList.toggle("is-over", n > max);
  }

  /* ---------- validation (inline hints; warnings never block publishing) ---------- */
  const VALIDATORS = {
    "site.phone": (v) => (digits(v).length < 10 ? ["err", "Enter a full phone number, e.g. +91 98765 43210"] : null),
    "site.whatsapp": (v) => {
      const d = digits(v);
      if (d.length < 10) return ["err", "Enter the WhatsApp number with country code, e.g. 919876543210"];
      if (d.length === 10) return ["warn", "No country code. The site will add 91 automatically."];
      const p = digits(state.content.site.phone).slice(-10); if (p && d.slice(-10) !== p) return ["warn", "This is different from the phone number above. Is that intended?"];
      return null;
    },
    "site.email": (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? ["err", "That doesn't look like an email address"] : null),
    "site.mapEmbed": (v) => {
      if (!v) return ["warn", "Empty: the map will be found from your address."];
      if (/google\.[a-z.]+\/maps\/embed\?|<iframe/i.test(v)) return ["ok", "Embedded map link. Looks good."];
      return ["warn", "Share links can't be shown inside a page. Visitors get a map found from your address, and this link is used for the Directions button. For an exact pin: Google Maps → Share → Embed a map → copy the link."];
    },
    "seo.title": (v) => { const n = (state.content.site.name || "").toLowerCase().split(/\s+/)[0]; if (n && !String(v).toLowerCase().includes(n)) return ["warn", "Tip: include your business name so people recognise you in Google."]; return null; },
  };
  function validateField(el) {
    const fn = VALIDATORS[el.dataset.path]; if (!fn) return; const f = el.closest(".field"), h = $("[data-hint]", f); if (!h) return;
    const r = fn(el.value);
    f.classList.toggle("is-invalid", !!r && r[0] === "err"); f.classList.toggle("is-warn", !!r && r[0] === "warn");
    h.hidden = !r; if (r) { h.className = "hint " + (r[0] === "err" ? "hint--err" : r[0] === "warn" ? "hint--warn" : ""); h.textContent = r[1]; }
  }
  const safeLink = (u) => /^(#|\/|https?:\/\/|tel:|mailto:|assets\/)/i.test(String(u || "").trim()) || !u;

  /* ============================================================
     Renderers
     ============================================================ */
  const card = (title, sub, body, extra) => `<section class="card"><div class="card__head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${extra || ""}</div>${body}</section>`;
  const isBooked = (c) => c.available === false && (!c.bookedUntil || c.bookedUntil >= today());
  const livePromos = () => { const p = state.content.promos || {}; if (!p.enabled) return []; const t = today(); return (p.items || []).filter((x) => x.enabled !== false && x.image && (!x.startDate || x.startDate <= t) && (!x.endDate || x.endDate >= t)); };
  const thumb = (src) => (safeImg(src) ? `<img src="${esc(small(src))}" data-full="${esc(src)}" alt="" loading="lazy" />` : `<span class="ph"></span>`);

  function healthChecks() {
    const c = state.content, s = c.site, out = [];
    const add = (text, go, focus) => out.push({ text, go, focus });
    if (state.defaultPassword) add("Change the default admin password", "security");
    if (digits(s.phone).length < 10) add("Add your phone number", "site", "site.phone");
    if (digits(s.whatsapp).length < 10) add("Add your WhatsApp number", "site", "site.whatsapp");
    else if (digits(s.phone).slice(-10) !== digits(s.whatsapp).slice(-10)) add("Phone and WhatsApp numbers differ. Check which is right", "site", "site.whatsapp");
    const fleet = c.fleet || [];
    const noPhoto = fleet.filter((x) => !x.hidden && !(x.images || []).length); if (noPhoto.length) add(`${noPhoto.length} car${noPhoto.length > 1 ? "s have" : " has"} no photos`, "fleet");
    const noPrice = fleet.filter((x) => !x.hidden && !(+x.pricePerDay > 0)); if (noPrice.length) add(`${noPrice.length} car${noPrice.length > 1 ? "s have" : " has"} no price`, "fleet");
    const expired = ((c.promos || {}).items || []).filter((x) => x.enabled !== false && x.endDate && x.endDate < today()); if (expired.length) add(`${expired.length} offer poster${expired.length > 1 ? "s have" : " has"} expired`, "promos");
    if (!(c.social.links || []).some((l) => l.enabled !== false && l.url && !/^https?:\/\/(www\.)?\w+\.com\/?$/.test(l.url))) add("Add your Instagram or Google Reviews link", "social");
    const n = (s.name || "").toLowerCase().split(/\s+/)[0]; if (n && !(c.seo.title || "").toLowerCase().includes(n)) add("Put your business name in the Google title", "seo", "seo.title");
    return out;
  }

  const RENDER = {
    dashboard(root) {
      const c = state.content, fleet = c.fleet || [];
      const booked = fleet.filter((x) => !x.hidden && isBooked(x)).sort((a, b) => (a.bookedUntil || "9") > (b.bookedUntil || "9") ? 1 : -1);
      const avail = fleet.filter((x) => !x.hidden && !isBooked(x));
      const h = new Date().getHours(), hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      const kpi = (ic, cls, v, l, goTo) => `<button type="button" class="kpi" data-go="${goTo}"><span class="kpi__icon ${cls}">${icon(ic)}</span><span><span class="kpi__value">${v}</span><span class="kpi__label" style="display:block">${esc(l)}</span></span></button>`;
      const checks = healthChecks();
      const soon = booked.filter((x) => x.bookedUntil && x.bookedUntil <= addDays(today(), 1));
      root.innerHTML = `
        <div class="hello"><h2>${hello}.</h2><p>${avail.length} of ${fleet.filter((x) => !x.hidden).length} cars are available${soon.length ? `, ${soon.length} coming back by tomorrow` : ""}.</p></div>
        ${state.mode === "static" ? `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>Static mode: changes are not saved to a server.</b> Edit freely, then press <b>Export</b> and replace the files in the <code>data</code> folder. Run <code>npm start</code> (or double-click start.bat) for one-click publishing and photo uploads.</div></div>` : ""}
        ${state.mode === "vercel" ? `<div class="notice notice--info">${icon("info")}<div><b>Hosted on Vercel.</b> Publishing commits to GitHub and the live site updates about a minute later.</div></div>` : ""}
        ${state.defaultPassword ? `<div class="notice notice--danger">${icon("lock")}<div><b>You're using the default password (admin123).</b> <a href="#security" data-go="security">Change it now</a> so nobody else can edit your site.</div></div>` : ""}
        <div class="kpis">${state.enq.supported ? kpi("inbox", "", state.enq.counts.new || 0, "New enquiries", "enquiries") : kpi("car", "", fleet.filter((x) => !x.hidden).length, "Cars on the site", "fleet")}${kpi("check-circle", "green", avail.length, "Available now", "fleet")}${kpi("calendar", "red", booked.length, "Booked", "fleet")}${kpi("tag", "amber", livePromos().length, "Live offers", "promos")}</div>
        ${state.enq.supported ? card("Latest enquiries", "", state.enq.list.length ? `<div class="mini-list">${state.enq.list.slice(0, 5).map((e) => `<div class="mini-row"><span class="kpi__icon ${e.status === "new" ? "" : "green"}">${icon(e.status === "new" ? "inbox" : "check")}</span><div><b>${esc(e.name)} · ${esc(e.carName || "Car not chosen")}</b><small>${esc(timeAgo(e.createdAt))}${e.pickup ? " · " + esc(fmtDate(e.pickup)) + (e.return ? "–" + esc(fmtDate(e.return)) : "") : ""}${e.estimate ? " · " + inr(e.estimate) : ""}</small></div><span class="st st--${e.status}">${esc(STATUS[e.status] || e.status)}</span></div>`).join("")}</div><div style="margin-top:12px"><button type="button" class="btn btn--soft" data-go="enquiries">See all enquiries</button></div>` : `<p class="empty">No enquiries yet. They appear here when a customer taps Book on WhatsApp.</p>`) : ""}
        <div class="dash-cols">
          ${card("Booked cars", booked.length ? "Tap to change a return date or mark a car available again." : "", booked.length ? `<div class="mini-list">${booked.map((x) => { const i = fleet.indexOf(x); return `<div class="mini-row">${thumb(x.cover)}<div><b>${esc(x.name)}</b><small>${x.bookedUntil ? (x.bookedUntil === today() ? "Back today" : "Back after " + esc(fmtDate(x.bookedUntil))) : "No return date set"}</small></div><button type="button" class="btn btn--soft btn--sm" data-avail="${i}">Edit</button><button type="button" class="btn btn--primary btn--sm" data-free="${i}">Available</button></div>`; }).join("")}</div>` : `<p class="empty">Every car is available. Mark one as booked from Cars & availability.</p>`)}
          ${card("Site health", checks.length ? `${checks.length} thing${checks.length > 1 ? "s" : ""} to look at` : "", `<ul class="checklist">${checks.length ? checks.map((t) => `<li class="todo">${icon("alert-triangle")}<span>${esc(t.text)}</span><button type="button" data-go="${t.go}" ${t.focus ? `data-focus="${t.focus}"` : ""}>Fix</button></li>`).join("") : `<li>${icon("check-circle")}Everything looks good.</li>`}</ul>`)}
        </div>
        ${card("Quick actions", "", `<div class="quick">
          <button type="button" data-quick="car">${icon("plus")}<span><b>Add a car</b><span>Photos, price and specs</span></span></button>
          <button type="button" data-go="announcement" data-focus="site.announcement">${icon("megaphone")}<span><b>Post an announcement</b><span>Top-of-site notice</span></span></button>
          <button type="button" data-quick="offer">${icon("tag")}<span><b>Add an offer poster</b><span>Festival or discount banner</span></span></button>
          <button type="button" data-quick="preview">${icon("eye")}<span><b>Preview the site</b><span>See unsaved changes</span></span></button></div>`)}`;
      $$("[data-quick]", root).forEach((b) => (b.onclick = () => { const q = b.dataset.quick; if (q === "car") { go("fleet"); openCarEditor(null); } if (q === "offer") { go("promos"); const a = $('[data-add="promos.items"]'); if (a) a.click(); } if (q === "preview") openPreview(); }));
      bindAvailButtons(root);
      $$("[data-free]", root).forEach((b) => (b.onclick = () => { const x = fleet[+b.dataset.free]; x.available = true; x.bookedUntil = ""; markDirty(); rerender(); toast(`${x.name} is available. Publish to update the site.`, "success"); }));
    },

    fleet(root) {
      const fleet = state.content.fleet || [];
      const f = RENDER.fleet.filter || (RENDER.fleet.filter = { q: "", status: "" });
      const counts = { all: fleet.length, available: fleet.filter((x) => !isBooked(x) && !x.hidden).length, booked: fleet.filter((x) => isBooked(x) && !x.hidden).length, hidden: fleet.filter((x) => x.hidden).length };
      const chip = (v, l, n) => `<button type="button" class="chip ${f.status === v ? "is-active" : ""}" data-status="${v}">${l}<span class="n">${n}</span></button>`;
      root.innerHTML = `<div class="toolbar"><div class="search-box"><span data-icon="search"></span><input type="search" id="fleetSearch" placeholder="Search cars" value="${esc(f.q)}" /></div><button class="btn btn--primary" id="addCarBtn">${icon("plus")} Add car</button></div>
        <div class="chipset">${chip("", "All", counts.all)}${chip("available", "Available", counts.available)}${chip("booked", "Booked", counts.booked)}${chip("hidden", "Hidden", counts.hidden)}</div>
        <div class="fleet-list" id="fleetList">${fleet.map((x, i) => fleetRow(x, i)).join("")}</div>
        <p class="hint">Cars show on the site in this order, with Popular cars first and booked cars last. Tap the status to mark a car booked until a date.</p>`;
      $("#addCarBtn").onclick = () => openCarEditor(null);
      const apply = () => { $$("#fleetList .fleet-row").forEach((r) => { const x = fleet[+r.dataset.i]; const st = x.hidden ? "hidden" : isBooked(x) ? "booked" : "available"; r.hidden = !(r.dataset.search.includes(f.q) && (!f.status || f.status === st)); }); $$("#fleetList [data-car-move]").forEach((b) => (b.disabled = b.disabled || !!(f.q || f.status))); };
      $("#fleetSearch").oninput = (e) => { f.q = e.target.value.trim().toLowerCase(); apply(); };
      $$("[data-status]", root).forEach((b) => (b.onclick = () => { f.status = b.dataset.status; rerender(); }));
      apply(); bindFleetRows(root);
    },

    enquiries(root) {
      if (!state.enq.supported) {
        root.innerHTML = `<div class="notice notice--${state.mode === "vercel" ? "info" : "warn"}">${icon("info")}<div><b>${state.mode === "vercel" ? "Enquiries can't be saved on Vercel" : "Enquiries need the server"}</b>${state.mode === "vercel" ? "Vercel can't save files, so enquiries still reach you on WhatsApp but aren't logged here. To keep an enquiry log and download it as Excel, host the site with the Node server (npm start, a VPS, or the included Docker setup)." : "Run <code>npm start</code> (or double-click start.bat). Every booking request from the website is then saved here and can be downloaded as Excel."}</div></div>`;
        return;
      }
      const f = state.enq.filter, c = state.enq.counts;
      const chip = (v, l) => `<button type="button" class="chip ${f.status === v ? "is-active" : ""}" data-enq-status="${v}">${l}<span class="n">${v ? c[v] || 0 : c.all || 0}</span></button>`;
      root.innerHTML = `
        <div class="toolbar"><div class="search-box"><span data-icon="search"></span><input type="search" id="enqSearch" placeholder="Search name, mobile, car or ref" value="${esc(f.q)}" /></div>
          <button class="btn btn--primary" id="enqExport">${icon("download")} Download Excel</button></div>
        <div class="enq-filters"><div class="chipset">${chip("", "All")}${chip("new", "New")}${chip("contacted", "Contacted")}${chip("booked", "Booked")}${chip("closed", "Closed")}</div>
          <div class="enq-range"><label>From <input type="date" id="enqFrom" value="${esc(f.from)}" /></label><label>To <input type="date" id="enqTo" value="${esc(f.to)}" /></label>${f.from || f.to ? `<button type="button" class="btn btn--ghost btn--sm" id="enqClearDates">Clear</button>` : ""}</div></div>
        <p class="hint" id="enqCount"></p>
        <div class="enq-list" id="enqList"><p class="empty">Loading…</p></div>`;
      const load = async () => { await loadEnquiries(); renderEnqList(); };
      let t; $("#enqSearch").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 250); };
      $$("[data-enq-status]", root).forEach((b) => (b.onclick = () => { f.status = b.dataset.enqStatus; rerender(); }));
      $("#enqFrom").onchange = (e) => { f.from = e.target.value; rerender(); };
      $("#enqTo").onchange = (e) => { f.to = e.target.value; rerender(); };
      const cd = $("#enqClearDates"); if (cd) cd.onclick = () => { f.from = f.to = ""; rerender(); };
      $("#enqExport").onclick = exportEnquiries;
      load();
    },

    analytics(root) {
      if (!state.an.supported) {
        root.innerHTML = `<div class="notice notice--${state.mode === "vercel" ? "info" : "warn"}">${icon("info")}<div><b>${state.mode === "vercel" ? "Analytics can't be saved on Vercel" : "Analytics need the server"}</b>${state.mode === "vercel" ? "Vercel can't save files, so visits aren't counted. Host the site with the Node server (npm start, a VPS, or the included Docker setup) to see daily traffic here." : "Run <code>npm start</code> (or double-click start.bat). Every visit to the website is then counted here."}</div></div>`;
        return;
      }
      const RANGES = [[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]];
      root.innerHTML = `<div class="toolbar an-toolbar"><div class="seg-toggle" role="radiogroup" aria-label="Date range">${RANGES.map(([v, l]) => `<label><input type="radio" name="anDays" value="${v}" ${state.an.days === v ? "checked" : ""} /><span>${l}</span></label>`).join("")}</div>
        <button type="button" class="btn btn--soft" id="anRefresh">${icon("refresh")} Refresh</button></div>
        <div id="anBody" class="an-body"><p class="empty">Loading…</p></div>`;
      $$('[name="anDays"]', root).forEach((r) => (r.onchange = () => { state.an.days = +r.value; loadAnalytics(); }));
      $("#anRefresh").onclick = () => loadAnalytics();
      if (state.an.data && state.an.data.days === state.an.days) renderAnalytics();
      loadAnalytics(true);
    },

    announcement(root) {
      root.innerHTML = card("Announcement bar", "A slim bar above the header for offers or notices. Visitors can dismiss it.", `<div class="grid">${F.toggle("site.announcementEnabled", "Show the announcement bar")}${F.text("site.announcement", "Announcement text", { full: true, max: 90, placeholder: "Weekend special: 10% off on 3+ day bookings" })}</div>`);
    },

    site(root) {
      root.innerHTML =
        card("Business details", "Shown in the header, footer, contact section and on Google.", `<div class="grid grid--2">${F.text("site.name", "Business name")}${F.text("site.tagline", "Tagline", { help: "under the logo" })}${F.text("site.phone", "Phone number", { help: "as displayed", type: "tel", inputmode: "tel" })}${F.text("site.whatsapp", "WhatsApp number", { help: "with country code", inputmode: "numeric", placeholder: "919876543210" })}${F.text("site.email", "Email", { type: "email" })}${F.text("site.city", "City")}${F.area("site.address", "Address", { full: true, rows: 2 })}${F.text("site.hours", "Opening hours / note", { full: true })}</div>`) +
        card("Map & directions", "", `<div class="grid">${F.text("site.mapEmbed", "Google Maps link", { full: true, placeholder: "https://www.google.com/maps/embed?pb=…" })}</div>`);
    },

    branding(root) {
      const t = state.content.theme;
      const SW = [["#0071e3", "Blue"], ["#5e5ce6", "Indigo"], ["#0a8a9e", "Teal"], ["#248a3d", "Green"], ["#f56300", "Orange"], ["#d70015", "Red"], ["#c01f7a", "Pink"], ["#3a3a3c", "Graphite"]];
      root.innerHTML =
        card("Colour theme", "The accent colour is used for buttons, links and the logo. Visitors can switch between light and dark.", `<div class="grid">
          <div class="field"><label>Accent colour</label><div class="swatches">${SW.map(([c, n]) => `<button type="button" class="swatch ${t.accent.toLowerCase() === c ? "is-active" : ""}" style="--c:${c}" data-swatch="${c}" aria-label="${n}" title="${n}"></button>`).join("")}<label class="swatch-custom"><input type="color" id="accentCustom" value="${esc(t.accent)}" aria-label="Custom colour" />Custom</label></div></div>
          <div class="field"><label>Default look for new visitors</label><div class="seg-toggle" role="radiogroup">${[["auto", "Match their phone"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<label><input type="radio" name="themeMode" value="${v}" ${t.mode === v ? "checked" : ""} /><span>${l}</span></label>`).join("")}</div></div>
          ${F.toggle("theme.allowToggle", "Let visitors switch between light and dark")}</div>`) +
        card("Logo", "Leave empty to use the built-in DP monogram, which adapts to your accent colour and dark mode. If you upload your own, use a PNG or SVG with a transparent background.", `<div class="grid grid--2">${F.image("site.logo", "Logo image", { contain: true, placeholderHtml: brandMark(64), placeholder: "Empty = built-in logo" })}${F.text("site.logoHeight", "Logo height (px)", { type: "number", def: 38, help: "32 to 48 works well" })}<div style="align-self:end;padding-bottom:8px">${F.toggle("site.logoShowText", "Show business name next to the logo")}</div>${F.image("site.favicon", "Browser tab icon", { contain: true, help: "optional, square", placeholderHtml: brandMark(40) })}</div>`);
      $$("[data-swatch]", root).forEach((b) => (b.onclick = () => { t.accent = b.dataset.swatch; markDirty(true); rerender(); }));
      $("#accentCustom").oninput = (e) => { t.accent = e.target.value; markDirty(); $$("[data-swatch]", root).forEach((s) => s.classList.toggle("is-active", s.dataset.swatch === t.accent)); };
      $$('[name="themeMode"]', root).forEach((r) => (r.onchange = () => { t.mode = r.value; markDirty(); }));
    },

    hero(root) {
      root.innerHTML =
        card("Headline", "Keep it short. The second line is highlighted.", `<div class="grid grid--2">${F.text("hero.eyebrow", "Small label above the title")}<div></div>${F.text("hero.title", "Title, first line")}${F.text("hero.titleHighlight", "Title, highlighted line")}${F.area("hero.subtitle", "Subtitle", { full: true, max: 220 })}</div>`) +
        card("Buttons & badges", "", `<div class="grid grid--2">${F.text("hero.primaryCta", "Main button text")}${F.select("hero.primaryLink", "Main button goes to", [{ value: "#fleet", label: "Fleet" }, { value: "#contact", label: "Contact" }, { value: "#how", label: "How it works" }, { value: "#why", label: "Why choose us" }])}${F.text("hero.secondaryCta", "WhatsApp button text")}<div></div>${F.tags("hero.badges", "Trust badges")}</div>`) +
        card("Background photo", "A wide landscape photo works best. It's darkened automatically so the text stays readable.", F.image("hero.image", "Hero image"));
    },
    stats(root) {
      root.innerHTML = card("Stats strip", "Four short numbers work best. A stat whose label mentions “rating” also shows next to your reviews.", repeat("stats", { addLabel: "Add stat", item: (p) => `<div class="grid grid--2">${F.text(p + ".value", "Value", { placeholder: "22+" })}${F.text(p + ".label", "Label", { placeholder: "Cars in fleet" })}</div>` }));
    },
    promos(root) {
      const t = today();
      const status = (it) => !it.image ? ["gray", "No image"] : it.enabled === false ? ["gray", "Off"] : it.endDate && it.endDate < t ? ["gray", "Expired"] : it.startDate && it.startDate > t ? ["accent", "Starts " + fmtDate(it.startDate)] : ["green", "Live"];
      root.innerHTML =
        card("Carousel", "Posters rotate automatically and can be swiped on phones.", `<div class="grid grid--2"><div class="field--full">${F.toggle("promos.enabled", "Show the offers carousel")}</div>${F.text("promos.interval", "Seconds per slide", { type: "number", def: 5, min: 2 })}<div class="switches" style="align-self:end;padding-bottom:6px">${F.toggle("promos.showArrows", "Arrows")}${F.toggle("promos.showDots", "Dots")}${F.toggle("promos.pauseOnHover", "Pause on hover")}</div></div>`) +
        card("Posters", "1600×640 looks best. Schedule with dates and expired posters disappear by themselves.", repeat("promos.items", { addLabel: "Add poster", item: (p, it) => { const [k, l] = status(it); return `<div class="badges" style="margin:0"><span class="badge badge--${k === "green" ? "accent" : "gray"}" style="${k === "green" ? "background:var(--green-soft);color:var(--green)" : ""}">${esc(l)}</span></div><div class="grid grid--2">${F.image(p + ".image", "Poster image")}${F.text(p + ".title", "Poster name", { help: "for screen readers" })}${F.text(p + ".link", "Link", { help: "#fleet, #contact, #car-thar or https://…" })}${F.text(p + ".caption", "Caption headline", { help: "optional, leave empty if the poster has text" })}${F.text(p + ".text", "Caption text", { help: "optional" })}${F.text(p + ".ctaText", "Button text", { help: "optional" })}${F.select(p + ".fit", "Image fit", [{ value: "auto", label: "Automatic" }, { value: "contain", label: "Show whole poster" }, { value: "cover", label: "Fill and crop" }])}${F.text(p + ".startDate", "Show from", { type: "date" })}${F.text(p + ".endDate", "Show until", { type: "date" })}<div class="field--full">${F.toggle(p + ".enabled", "Show this poster")}</div></div>`; } }));
    },
    features(root) {
      const ICON_OPTS = ["shield", "tag", "truck", "clock", "sparkles", "headset", "heart", "check-circle", "star", "map", "key", "calendar", "phone", "users", "fuel", "gear", "road", "bolt", "globe", "lock", "car", "navigation"];
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("features.eyebrow", "Small label")}${F.text("features.title", "Title")}</div>`) +
        card("Feature cards", "Six cards fill the grid perfectly.", repeat("features.items", { addLabel: "Add feature", item: (p, it) => `<div class="grid grid--2"><div class="field"><label>Icon</label><div style="display:flex;gap:10px;align-items:center"><span class="kpi__icon">${icon(it.icon) || icon("check-circle")}</span><select data-path="${p}.icon" data-rerender="1" style="flex:1">${ICON_OPTS.map((o) => `<option ${o === it.icon ? "selected" : ""}>${o}</option>`).join("")}</select></div></div>${F.text(p + ".title", "Title")}${F.area(p + ".text", "Text", { full: true, rows: 2 })}</div>` }));
    },
    how(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("howItWorks.eyebrow", "Small label")}${F.text("howItWorks.title", "Title")}</div>`) +
        card("Steps", "Numbered automatically in this order.", repeat("howItWorks.steps", { addLabel: "Add step", item: (p) => `<div class="grid">${F.text(p + ".title", "Step title")}${F.area(p + ".text", "Description", { rows: 2 })}</div>` }));
    },
    testimonials(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("testimonials.eyebrow", "Small label")}${F.text("testimonials.title", "Title")}</div>`) +
        card("Reviews", "Real reviews from Google work best. Copy them word for word.", repeat("testimonials.items", { addLabel: "Add review", item: (p) => `<div class="grid grid--3">${F.text(p + ".name", "Customer name")}${F.text(p + ".role", "Trip / occasion")}${F.select(p + ".rating", "Rating", [5, 4, 3, 2, 1].map((n) => ({ value: n, label: "★".repeat(n) })), { number: true })}${F.area(p + ".text", "Review", { full: true, rows: 2 })}</div>` }));
    },
    faq(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("faq.eyebrow", "Small label")}${F.text("faq.title", "Title")}</div>`) +
        card("Questions", "The first question starts open. Questions also appear in Google results.", repeat("faq.items", { addLabel: "Add question", item: (p) => `<div class="grid">${F.text(p + ".q", "Question")}${F.area(p + ".a", "Answer", { rows: 2 })}</div>` }));
    },
    social(root) {
      const PLATFORMS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["google", "Google Business / Reviews"], ["x", "X (Twitter)"], ["linkedin", "LinkedIn"], ["threads", "Threads"], ["telegram", "Telegram"], ["whatsapp", "WhatsApp channel"], ["custom", "Other"]];
      root.innerHTML =
        card("Your profiles", "Links that are off, empty, or just a bare instagram.com address are hidden on the site.", repeat("social.links", { addLabel: "Add platform", item: (p) => `<div class="grid grid--3">${F.select(p + ".platform", "Platform", PLATFORMS.map(([v, l]) => ({ value: v, label: l })))}${F.text(p + ".label", "Label")}${F.text(p + ".url", "Profile link", { placeholder: "https://instagram.com/yourpage" })}<div class="field--full">${F.toggle(p + ".enabled", "Show this link")}</div></div>` })) +
        card("Where they appear", "", `<div class="switches">${F.toggle("social.showInFooter", "Footer and menu")}${F.toggle("social.shareButtons", "Share buttons on every car")}</div>`) +
        card("Follow us section", "A section with your profiles and embedded posts. It only shows when you have links or posts.", `<div class="grid grid--2"><div class="field--full">${F.toggle("social.section.enabled", "Show the Follow us section")}</div>${F.text("social.section.eyebrow", "Small label")}${F.text("social.section.title", "Title")}${F.area("social.section.text", "Text", { full: true, rows: 2 })}${F.text("social.section.ctaText", "Button text")}${F.text("social.section.ctaLink", "Button link", { placeholder: "https://instagram.com/yourpage" })}${F.tags("social.section.posts", "Post links (Instagram, YouTube, Facebook)", { rows: 4 })}</div>`);
    },
    contact(root) {
      root.innerHTML = card("Contact section", "", `<div class="grid grid--2">${F.text("contact.eyebrow", "Small label")}${F.text("contact.title", "Title")}${F.area("contact.text", "Text", { full: true, rows: 2 })}</div>`) +
        card("Footer", "", `<div class="grid">${F.area("footer.about", "About text", { rows: 3 })}${F.text("footer.copyright", "Copyright line", { help: "{year} becomes the current year" })}</div>`);
    },
    seo(root) {
      const renderPreviews = () => {
        const c = state.content, img = safeImg(c.seo.image) || safeImg(c.hero.image);
        const host = location.host || "yourwebsite.com";
        $("#seoPreviews").innerHTML = `<div><h4>Google</h4><div class="serp"><div class="serp__site">${brandMark(26)}<div><div>${esc(c.site.name)}</div><div class="serp__url">https://${esc(host)}</div></div></div><div class="serp__title">${esc((c.seo.title || c.site.name).slice(0, 65))}${(c.seo.title || "").length > 65 ? "…" : ""}</div><div class="serp__desc">${esc((c.seo.description || "").slice(0, 160))}${(c.seo.description || "").length > 160 ? "…" : ""}</div></div></div>
          <div><h4>WhatsApp link preview</h4><div class="wa-card"><div class="wa-card__inner">${img ? `<img src="${esc(img)}" alt="" />` : ""}<div class="wa-card__text"><b>${esc(c.seo.title || c.site.name)}</b><span>${esc(c.seo.description)}</span><span class="wa-card__url">${esc(host)}</span></div></div></div></div>`;
      };
      root.innerHTML = card("Search & sharing", "What Google shows, and what appears when someone shares your link on WhatsApp.", `<div class="grid">${F.text("seo.title", "Title", { max: 60 })}${F.area("seo.description", "Description", { rows: 3, max: 160 })}${F.text("seo.keywords", "Keywords", { help: "comma separated" })}${F.image("seo.image", "Share image", { help: "1200×630. Empty uses the hero photo." })}</div>`) +
        card("Preview", "", `<div class="previews" id="seoPreviews"></div>`);
      renderPreviews(); $$("[data-path^='seo.']", root).forEach((el) => el.addEventListener("input", renderPreviews));
    },
    backups(root) {
      if (state.mode === "vercel") { root.innerHTML = `<div class="notice notice--info">${icon("info")}<div><b>On Vercel, every publish is a Git commit.</b> Your full history is in the GitHub repository. To roll back, revert the commit on GitHub and Vercel redeploys it.</div></div>`; return; }
      if (state.mode !== "server") { root.innerHTML = `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>History needs the server.</b> Run <code>npm start</code> to keep the last 30 published versions automatically.</div></div>`; return; }
      root.innerHTML = card("Published versions", "A copy is kept every time you publish (last 30). Restoring replaces the live site immediately, and the current version is kept too.", `<div id="backupList"><p class="empty">Loading…</p></div>`);
      api("GET", "/api/backups").then((d) => {
        $("#backupList").innerHTML = d.backups.length ? `<div class="mini-list">${d.backups.map((b) => { const m = b.name.match(/content-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/); const when = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null; return `<div class="mini-row"><span class="kpi__icon">${icon("refresh")}</span><div><b>${when ? esc(when.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })) : esc(b.name)}</b><small>${(b.size / 1024).toFixed(1)} KB</small></div><button class="btn btn--soft btn--sm" data-restore="${esc(b.name)}">Restore</button></div>`; }).join("")}</div>` : `<p class="empty">No history yet. A copy is saved each time you publish.</p>`;
        $$("[data-restore]").forEach((b) => (b.onclick = async () => {
          if (await ask({ title: "Restore this version?", text: "The live site will be replaced with this version straight away. The current version is kept in history.", buttons: [{ label: "Cancel", value: "" }, { label: "Restore", value: "ok", kind: "primary" }] }) !== "ok") return;
          try { const d = await api("POST", "/api/restore", { name: b.dataset.restore }); migrate(d.content); state.content = d.content; state.saved = clone(d.content); markDirty(true); toast("Version restored and published", "success"); go("backups"); } catch (e) { toast(e.message, "error"); }
        }));
      }).catch((e) => ($("#backupList").innerHTML = `<p class="empty">${esc(e.message)}</p>`));
    },
    security(root) {
      if (state.mode === "vercel") { root.innerHTML = `<div class="notice notice--info">${icon("lock")}<div><b>On Vercel the password is the ADMIN_PASSWORD environment variable.</b> Change it in Vercel → Project → Settings → Environment Variables, then redeploy.</div></div>`; return; }
      if (state.mode !== "server") { root.innerHTML = `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>Password protection needs the server.</b> Run <code>npm start</code> to enable sign-in.</div></div>`; return; }
      root.innerHTML = card("Change password", "Use at least 8 characters. A short sentence is easy to remember and hard to guess.", `<form id="pwForm" class="grid grid--3"><div class="field"><label for="pwCur">Current password</label><input type="password" id="pwCur" autocomplete="current-password" required /></div><div class="field"><label for="pwNew">New password</label><input type="password" id="pwNew" autocomplete="new-password" required minlength="8" /></div><div class="field"><label for="pwNew2">Confirm new password</label><input type="password" id="pwNew2" autocomplete="new-password" required /></div><div class="field--full"><button class="btn btn--primary" type="submit">${icon("key")} Update password</button></div></form>`);
      $("#pwForm").onsubmit = async (e) => { e.preventDefault(); if ($("#pwNew").value.length < 8) return toast("Use at least 8 characters", "error"); if ($("#pwNew").value !== $("#pwNew2").value) return toast("The new passwords don't match", "error"); try { await api("POST", "/api/password", { current: $("#pwCur").value, next: $("#pwNew").value }); state.defaultPassword = false; toast("Password updated", "success"); $("#pwForm").reset(); } catch (err) { toast(err.message, "error"); } };
    },
  };

  /* ============================================================
     Fleet rows + availability
     ============================================================ */
  function availChip(x, i) {
    if (!isBooked(x)) return `<button type="button" class="avail avail--on" data-avail="${i}" aria-label="${esc(x.name)}: available. Change">Available</button>`;
    const soon = x.bookedUntil && x.bookedUntil <= addDays(today(), 1);
    return `<button type="button" class="avail ${soon ? "avail--soon" : "avail--off"}" data-avail="${i}" aria-label="${esc(x.name)}: booked. Change">${x.bookedUntil ? "Booked · " + esc(fmtDate(x.bookedUntil)) : "Booked"}</button>`;
  }
  function fleetRow(x, i) {
    const fleet = state.content.fleet;
    return `<div class="fleet-row ${x.hidden ? "is-hidden" : ""}" data-i="${i}" data-search="${esc([x.name, x.brand, x.category, x.fuel].join(" ").toLowerCase())}">
      <div class="rep__handle"><button type="button" data-car-move="${i}|-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">${icon("arrow-up")}</button><button type="button" data-car-move="${i}|1" ${i === fleet.length - 1 ? "disabled" : ""} aria-label="Move down">${icon("arrow-down")}</button></div>
      <button type="button" class="fleet-row__thumb" data-edit-car="${i}" aria-label="Edit ${esc(x.name)}">${thumb(x.cover || (x.images || [])[0])}</button>
      <div class="fleet-row__info" style="min-width:0"><div class="fleet-row__name">${esc(x.name)}</div><div class="fleet-row__meta">${esc(x.category)} · ${esc(x.transmission)} · ${esc(x.fuel)} · ${(x.images || []).length} photos</div>${x.featured || x.hidden ? `<div class="badges">${x.featured ? `<span class="badge badge--accent">Popular</span>` : ""}${x.hidden ? `<span class="badge badge--gray">Hidden</span>` : ""}</div>` : ""}</div>
      <div class="fleet-row__price">${inr(x.pricePerDay)}<small> /day</small></div>
      <div class="fleet-row__avail">${availChip(x, i)}</div>
      <div class="fleet-row__actions"><button type="button" class="icon-btn icon-btn--sm" data-car-hide="${i}" aria-label="${x.hidden ? "Show on site" : "Hide from site"}" title="${x.hidden ? "Show on site" : "Hide from site"}">${icon(x.hidden ? "eye-off" : "eye")}</button><button type="button" class="icon-btn icon-btn--sm" data-car-dup="${i}" aria-label="Duplicate" title="Duplicate">${icon("copy")}</button><button type="button" class="btn btn--soft btn--sm" data-edit-car="${i}">${icon("edit")} Edit</button></div></div>`;
  }
  function bindFleetRows(root) {
    const fleet = state.content.fleet;
    $$("[data-edit-car]", root).forEach((b) => (b.onclick = () => openCarEditor(+b.dataset.editCar)));
    $$("[data-car-move]", root).forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.carMove.split("|").map(Number); [fleet[i], fleet[i + d]] = [fleet[i + d], fleet[i]]; markDirty(); rerender(); }));
    $$("[data-car-hide]", root).forEach((b) => (b.onclick = () => { const c = fleet[+b.dataset.carHide]; c.hidden = !c.hidden; markDirty(); rerender(); toast(c.hidden ? `${c.name} hidden from the site` : `${c.name} is visible again`); }));
    $$("[data-car-dup]", root).forEach((b) => (b.onclick = () => { const i = +b.dataset.carDup; const c = clone(fleet[i]); c.name += " (copy)"; c.id = uniqueId(slugify(c.name)); fleet.splice(i + 1, 0, c); markDirty(); rerender(); toast("Car duplicated"); }));
    bindAvailButtons(root);
  }
  function bindAvailButtons(root) { $$("[data-avail]", root).forEach((b) => (b.onclick = () => openAvailability(+b.dataset.avail))); }
  function uniqueId(base) { const ids = new Set(state.content.fleet.map((x) => x.id)); let id = base, n = 2; while (ids.has(id)) id = `${base}-${n++}`; return id; }

  function openAvailability(i) {
    const car = state.content.fleet[i], d = $("#availDlg");
    $("#availSub").textContent = car.name;
    const booked = isBooked(car);
    $$('[name="avail"]', d).forEach((r) => (r.checked = r.value === (booked ? "0" : "1")));
    $("#availUntil").value = booked ? car.bookedUntil || "" : ""; $("#availUntil").min = today();
    const sync = () => { const off = $('[name="avail"]:checked', d).value === "0"; $("#availUntilWrap").hidden = !off; $("#availQuick").hidden = !off; };
    $$('[name="avail"]', d).forEach((r) => (r.onchange = sync)); sync();
    $("#availQuick").innerHTML = [["Today", 0], ["Tomorrow", 1], ["+2 days", 2], ["+3 days", 3], ["+1 week", 7]].map(([l, n]) => `<button type="button" data-days="${n}">${l}</button>`).join("");
    $$("[data-days]", d).forEach((b) => (b.onclick = () => ($("#availUntil").value = addDays(today(), +b.dataset.days))));
    d.returnValue = ""; d.showModal();
    d.addEventListener("close", () => {
      if (d.returnValue !== "ok") return;
      const off = $('[name="avail"]:checked', d).value === "0";
      car.available = !off; car.bookedUntil = off ? $("#availUntil").value : "";
      markDirty(); rerender();
      toast(off ? `${car.name} marked booked${car.bookedUntil ? " until " + fmtDate(car.bookedUntil) : ""}. Publish to update the site.` : `${car.name} is available. Publish to update the site.`, "success");
    }, { once: true });
  }

  /* ============================================================
     Analytics
     ============================================================ */
  const num = (n) => Number(n || 0).toLocaleString("en-IN");
  const hourLabel = (h) => (h % 12 || 12) + (h < 12 ? "am" : "pm");
  const hourTip = (v, h) => `<b>${hourLabel(h)}–${hourLabel((h + 1) % 24)}</b>${num(v)} page view${v === 1 ? "" : "s"}`;
  async function loadAnalytics(quiet) {
    if (!state.an.supported || !state.token) return;
    const days = state.an.days;
    try { const d = await api("GET", "/api/analytics?days=" + days); if (days !== state.an.days) return; state.an.data = d; if (state.section === "analytics") renderAnalytics(); }
    catch (e) { if (!quiet && e.status !== 401) toast(e.message, "error"); }
  }
  function renderAnalytics() {
    const box = $("#anBody"), d = state.an.data; if (!box || !d) return;
    const t = d.totals, p = d.prev, L = d.lists, span = d.days === 1 ? "yesterday" : `previous ${d.days} days`;
    const delta = (a, b) => { if (!b) return a ? `<span class="kpi__delta">none in the ${span}</span>` : ""; const c = Math.round(((a - b) / b) * 100); return `<span class="kpi__delta ${c > 0 ? "is-up" : c < 0 ? "is-down" : ""}">${c > 0 ? "▲ " : c < 0 ? "▼ " : ""}${Math.abs(c)}% vs ${span}</span>`; };
    const kpi = (ic, cls, v, label, sub) => `<div class="kpi"><span class="kpi__icon ${cls}">${icon(ic)}</span><span><span class="kpi__value">${num(v)}</span><span class="kpi__label" style="display:block">${esc(label)}</span>${sub || ""}</span></div>`;
    const act = Object.fromEntries(L.act), dev = Object.fromEntries(L.dev);
    const wa = act["WhatsApp clicks"] || 0, calls = act["Call clicks"] || 0, enq = act["Booking enquiries sent"] || 0, mobile = (dev.Mobile || 0) + (dev.Tablet || 0);
    // "Today" shows hours; longer ranges show one bar per day
    const hourly = d.days === 1;
    const bars = hourly ? d.hours.map((v, h) => ({ v, label: hourLabel(h), tip: hourTip(v, h) }))
      : d.series.map((x) => ({ v: x.u, label: fmtDate(x.d), today: x.d === today(), tip: `<b>${new Date(x.d + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</b>${num(x.u)} visitor${x.u === 1 ? "" : "s"} · ${num(x.v)} views · ${num(x.s)} visits` }));
    const conv = t.u ? Math.round((enq / t.u) * 1000) / 10 : 0;
    const cityHelp = d.location.city ? "" : `<p class="hint">To see cities: Cloudflare dashboard → your domain → Rules → Transform Rules → Managed Transforms → turn on <b>Add visitor location headers</b>.</p>`;
    box.innerHTML = `
      <div class="kpis">${kpi("users", "", t.u, "Visitors", delta(t.u, p.u))}${kpi("eye", "green", t.v, "Page views", delta(t.v, p.v))}${kpi("phone", "amber", wa + calls, "WhatsApp & call taps", `<span class="kpi__delta">${num(wa)} WhatsApp · ${num(calls)} calls</span>`)}${kpi("bolt", "red", d.online, "Online now", `<span class="kpi__delta">active in the last 5 min</span>`)}</div>
      ${card(hourly ? "Today by hour" : "Daily visitors", hourly ? "Page views in each hour (India time). Hover or tap a bar." : "Unique visitors per day. Hover or tap a bar for views and visits.", barChart(bars, hourly ? 3 : Math.max(1, Math.ceil(bars.length / 7))))}
      <div class="an-grid">
        ${card("Mobile or desktop", t.u ? `${Math.round((mobile / t.u) * 100)}% of visitors are on a phone or tablet` : "", anList(L.dev, t.u, { icons: { Mobile: "phone", Tablet: "phone", Desktop: "layout" } }))}
        ${card("Where visitors come from", "Counted once per visit", anList(L.src, t.s))}
        ${card("Phone brands", "Visitors on phones and tablets", anList(L.brand, mobile))}
        ${card("Phone models", "Android phones share the model; iPhones only say “iPhone”.", anList(L.model, mobile))}
        ${card("Countries", "", anList(L.country, t.u) + (d.location.country ? "" : `<p class="hint">Countries appear when the site runs behind Cloudflare, as the Docker setup does.</p>`))}
        ${card("Cities", "", anList(L.city, t.u) + cityHelp)}
        ${card("Cars people looked at", "Times each car's details were opened", anList(L.car, L.car.reduce((a, x) => a + x[1], 0), { max: 10 }))}
        ${card("What visitors did", t.u ? `${conv}% of visitors sent a booking enquiry` : "", anList(L.act, 0))}
        ${card("Browsers", "", anList(L.br, t.u))}
        ${card("Operating systems", "", anList(L.os, t.u))}
      </div>
      ${hourly ? "" : card("Busiest hours", "Page views by hour of day in this period (India time). The times to reply fastest on WhatsApp.", barChart(d.hours.map((v, h) => ({ v, label: hourLabel(h), tip: hourTip(v, h) })), 3))}
      <div class="an-foot"><p class="hint">${t.n ? `${num(t.n)} of ${num(t.u)} visitors came for the first time. ` : ""}Counting since ${d.since ? new Date(d.since + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "today"}. No cookies or IP addresses are stored, and admin and preview visits aren't counted.</p>
        <button type="button" class="btn btn--ghost btn--sm" id="anReset">${icon("trash")} Clear analytics</button></div>`;
    bindCharts(box);
    $("#anReset").onclick = async () => {
      if (await ask({ title: "Clear all analytics?", text: "Every visitor count, device and source is deleted and counting starts again from now. This can't be undone.", buttons: [{ label: "Cancel", value: "" }, { label: "Clear", value: "ok", kind: "danger" }] }) !== "ok") return;
      try { await api("DELETE", "/api/analytics"); toast("Analytics cleared", "success"); loadAnalytics(); } catch (e) { toast(e.message, "error"); }
    };
  }
  function niceStep(max) { const raw = max / 2, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p); }
  function barChart(bars, every) {
    const max = Math.max(1, ...bars.map((b) => b.v)), top = Math.ceil(max / niceStep(max)) * niceStep(max);
    const grid = [top, top / 2, 0].map((g) => `<div class="an-chart__grid" style="bottom:${(g / top) * 100}%"><span>${num(g)}</span></div>`).join("");
    return `<div class="an-chart" style="--n:${bars.length}"><div class="an-chart__plot">${grid}<div class="an-chart__bars">${bars.map((b) => `<div class="an-bar ${b.today ? "is-today" : ""}" tabindex="0" data-tip="${esc(b.tip)}" aria-label="${esc(b.tip.replace(/<[^>]+>/g, " "))}"><i style="height:${b.v ? Math.max(1.5, (b.v / top) * 100) : 0}%"></i></div>`).join("")}</div><div class="an-tip" role="status" hidden></div></div>
      <div class="an-chart__x">${bars.map((b, i) => `<span>${i % every === 0 ? esc(b.label) : ""}</span>`).join("")}</div></div>`;
  }
  function bindCharts(root) {
    $$(".an-chart__plot", root).forEach((plot) => {
      const tip = $(".an-tip", plot);
      const clear = () => $$(".an-bar.is-hover", plot).forEach((x) => x.classList.remove("is-hover"));
      const show = (bar) => {
        tip.innerHTML = bar.dataset.tip; tip.hidden = false; clear(); bar.classList.add("is-hover");
        const r = plot.getBoundingClientRect(), b = bar.getBoundingClientRect(), w = tip.offsetWidth;
        tip.style.left = Math.min(Math.max(b.left + b.width / 2 - r.left, w / 2), r.width - w / 2) + "px";
      };
      const hide = () => { tip.hidden = true; clear(); };
      $$(".an-bar", plot).forEach((bar) => { bar.onpointerenter = () => show(bar); bar.onfocus = () => show(bar); bar.onclick = () => show(bar); bar.onblur = hide; });
      plot.onpointerleave = (e) => { if (e.pointerType === "mouse") hide(); };
    });
  }
  /* Ranked list with a share bar. total = what the percentages are of (0 = counts only). */
  function anList(rows, total, o) {
    o = o || {}; if (!rows.length) return `<p class="empty">Nothing yet for this period.</p>`;
    const max = rows[0][1] || 1, limit = o.max || 8;
    const row = ([k, n]) => `<li class="an-row"><span class="an-row__label" title="${esc(k)}">${o.icons && o.icons[k] ? icon(o.icons[k]) : ""}<span>${esc(k)}</span></span><span class="an-row__n">${num(n)}${total ? `<small>${Math.round((n / total) * 100)}%</small>` : ""}</span><span class="an-row__bar"><i style="width:${(n / max) * 100}%"></i></span></li>`;
    return `<ul class="an-list">${rows.slice(0, limit).map(row).join("")}</ul>${rows.length > limit ? `<details class="an-more"><summary>Show all ${rows.length}</summary><ul class="an-list">${rows.slice(limit).map(row).join("")}</ul></details>` : ""}`;
  }

  /* ============================================================
     Enquiries
     ============================================================ */
  const STATUS = { new: "New", contacted: "Contacted", booked: "Booked", closed: "Closed" };
  function timeAgo(iso) {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
  const enqQuery = () => { const f = state.enq.filter; return new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); };
  async function loadEnquiries(silent) {
    if (!state.enq.supported || !state.token) return;
    try { const d = await api("GET", "/api/enquiries?" + enqQuery()); state.enq.list = d.enquiries; state.enq.counts = d.counts; refreshNavCounts(); renderEnqBadge(); }
    catch (e) { if (!silent && e.status !== 401) toast(e.message, "error"); }
  }
  function renderEnqBadge() { const b = $("#tabEnqBadge"); if (b) { const n = state.enq.counts.new || 0; b.hidden = !n; b.textContent = n > 99 ? "99+" : n; } }
  function replyText(e) {
    const site = state.content.site;
    const trip = e.carName ? ` for the *${e.carName}*${e.pickup ? ` from ${fmtDate(e.pickup)}${e.return ? " to " + fmtDate(e.return) : ""}` : ""}` : "";
    return `Hello ${e.name},

Thank you for your enquiry${trip} (Ref: ${e.id}).

` + (e.estimate ? `The estimated rent is ${inr(e.estimate)}. ` : "") + `We will confirm availability shortly.

Regards,
${site.name}`;
  }
  function renderEnqList() {
    const list = state.enq.list, box = $("#enqList"); if (!box) return;
    const c = $("#enqCount"); if (c) c.textContent = list.length ? `${list.length} enquir${list.length === 1 ? "y" : "ies"}${state.enq.filter.status || state.enq.filter.q || state.enq.filter.from || state.enq.filter.to ? " match your filters" : ""}. Download Excel exports exactly this list.` : "";
    box.innerHTML = list.length ? list.map((e, i) => {
      const wa = digits(e.phone).length === 10 ? "91" + digits(e.phone) : digits(e.phone);
      return `<article class="enq ${e.status === "new" ? "is-new" : ""}" data-enq="${esc(e.id)}">
        <div class="enq__head">
          <div class="enq__who"><b>${esc(e.name)}</b><a href="tel:${esc(digits(e.phone))}">${esc(e.phone)}</a></div>
          <select class="st-select st--${e.status}" data-enq-set="${esc(e.id)}" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${l}</option>`).join("")}</select>
        </div>
        <div class="enq__trip">
          <span>${icon("car")}<b>${esc(e.carName || "Car not chosen")}</b></span>
          ${e.pickup ? `<span>${icon("calendar")}${esc(fmtDate(e.pickup))}${e.return ? " → " + esc(fmtDate(e.return)) : ""}${e.days ? ` · ${e.days} day${e.days > 1 ? "s" : ""}` : ""}</span>` : ""}
          ${e.estimate ? `<span>${icon("tag")}<b>${inr(e.estimate)}</b></span>` : ""}
        </div>
        ${e.message ? `<p class="enq__msg">“${esc(e.message)}”</p>` : ""}
        <div class="enq__meta">${esc(e.id)} · ${esc(timeAgo(e.createdAt))} · ${esc(e.source)}</div>
        <textarea class="enq__notes" data-enq-notes="${esc(e.id)}" rows="1" placeholder="Add a note (only you can see this)">${esc(e.notes || "")}</textarea>
        <div class="enq__actions">
          <a class="btn btn--soft btn--sm" href="tel:${esc(digits(e.phone))}">${icon("phone")} Call</a>
          <a class="btn btn--wa btn--sm" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(replyText(e))}" target="_blank" rel="noopener">${icon("whatsapp")} Reply</a>
          <button type="button" class="icon-btn icon-btn--sm" data-enq-del="${esc(e.id)}" aria-label="Delete enquiry" title="Delete">${icon("trash")}</button>
        </div>
      </article>`;
    }).join("") : `<div class="card empty-state">${icon("inbox")}<b>No enquiries${state.enq.filter.status || state.enq.filter.q || state.enq.filter.from || state.enq.filter.to ? " match these filters" : " yet"}</b><span>When a customer taps Book on WhatsApp or sends the contact form, their request is saved here.</span></div>`;
    hydrateIcons(box);
    $$("[data-enq-set]", box).forEach((sel) => (sel.onchange = async () => {
      const id = sel.dataset.enqSet, status = sel.value;
      sel.className = "st-select st--" + status; sel.closest(".enq").classList.toggle("is-new", status === "new");
      try { await api("PATCH", "/api/enquiries", { id, status }); const e = state.enq.list.find((x) => x.id === id); const was = e.status; e.status = status; state.enq.counts[was]--; state.enq.counts[status] = (state.enq.counts[status] || 0) + 1; refreshNavCounts(); renderEnqBadge(); $$("[data-enq-status] .n").forEach((n) => { const k = n.parentElement.dataset.enqStatus; n.textContent = k ? state.enq.counts[k] || 0 : state.enq.counts.all; }); toast(`Marked ${STATUS[status].toLowerCase()}`, "success"); }
      catch (err) { toast(err.message, "error"); }
    }));
    $$("[data-enq-notes]", box).forEach((ta) => {
      const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }; fit(); ta.oninput = fit;
      ta.onchange = async () => { try { await api("PATCH", "/api/enquiries", { id: ta.dataset.enqNotes, notes: ta.value }); const e = state.enq.list.find((x) => x.id === ta.dataset.enqNotes); if (e) e.notes = ta.value; toast("Note saved", "success"); } catch (err) { toast(err.message, "error"); } };
    });
    $$("[data-enq-del]", box).forEach((b) => (b.onclick = async () => {
      const e = state.enq.list.find((x) => x.id === b.dataset.enqDel);
      if (await ask({ title: `Delete enquiry from ${e.name}?`, text: "It will be removed from the list and from future Excel downloads. This can't be undone.", buttons: [{ label: "Cancel", value: "" }, { label: "Delete", value: "ok", kind: "danger" }] }) !== "ok") return;
      try { await api("DELETE", "/api/enquiries", { id: e.id }); await loadEnquiries(); renderEnqList(); toast("Enquiry deleted"); } catch (err) { toast(err.message, "error"); }
    }));
  }
  async function exportEnquiries() {
    const btn = $("#enqExport"); if (btn) btn.disabled = true;
    try {
      const r = await fetch("/api/enquiries/export?" + enqQuery(), { headers: { Authorization: "Bearer " + state.token } });
      if (r.status === 401) { await reauth(); return; }
      if (!r.ok) throw new Error("Download failed (" + r.status + ")");
      const blob = await r.blob(), name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "enquiries.xlsx";
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast(`Downloaded ${name}`, "success");
    } catch (e) { toast(e.message, "error"); }
    if (btn) btn.disabled = false;
  }

  /* ============================================================
     Car editor
     ============================================================ */
  const drawer = { index: null, car: null, original: "", tab: "details" };
  const CAR_DEFAULT = () => ({ id: "", name: "", brand: "", category: "Hatchback", seats: 5, fuel: "Petrol", transmission: "Manual", pricePerDay: 1999, priceWeekly: null, priceMonthly: null, kmPerDay: 300, extraKmCharge: 8, deposit: 3000, featured: false, available: true, bookedUntil: "", hidden: false, description: "", features: ["Air Conditioning", "Music System", "Power Steering", "Airbags"], cover: "", images: [] });
  function openCarEditor(index) {
    drawer.index = index; drawer.tab = "details";
    drawer.car = index == null ? CAR_DEFAULT() : Object.assign(CAR_DEFAULT(), clone(state.content.fleet[index]));
    drawer.original = JSON.stringify(drawer.car);
    $("#drawerTitle").textContent = index == null ? "New car" : drawer.car.name;
    $("#drawerSub").textContent = index == null ? "Add details, prices and photos" : "Changes go live when you publish";
    $("#drawerDelete").hidden = index == null;
    renderDrawer(); $("#drawer").hidden = false; $("#drawer").classList.remove("is-closing");
    document.documentElement.classList.add("is-locked");
    history.pushState({ drawer: true }, "", location.hash);
    setTimeout(() => { const f = $("#drawerBody input"); if (f && index == null) f.focus(); }, 100);
  }
  async function closeDrawer(force, fromHistory) {
    if ($("#drawer").hidden || drawer.closing) return;
    if (!force && JSON.stringify(drawer.car) !== drawer.original) {
      const v = await ask({ title: "Discard changes to this car?", text: "Your edits to this car haven't been applied yet.", buttons: [{ label: "Keep editing", value: "" }, { label: "Discard", value: "ok", kind: "danger" }] });
      if (v !== "ok") { if (fromHistory) history.pushState({ drawer: true }, "", location.hash); return; }
    }
    drawer.closing = true;
    const el = $("#drawer"); el.classList.add("is-closing");
    setTimeout(() => { el.hidden = true; el.classList.remove("is-closing"); drawer.closing = false; if (!$("#sidebar").classList.contains("is-open")) document.documentElement.classList.remove("is-locked"); }, 200);
    // Drop the history entry the editor added, and wait for it so later navigation isn't undone by it
    if (!fromHistory && history.state && history.state.drawer) await new Promise((res) => { addEventListener("popstate", () => res(), { once: true }); history.back(); setTimeout(res, 400); });
  }
  window.addEventListener("popstate", () => { if (!$("#drawer").hidden && !drawer.closing && !(history.state && history.state.drawer)) closeDrawer(false, true); });

  function carErrors(c) {
    const e = {};
    if (!String(c.name || "").trim()) e.name = "Give the car a name";
    if (!(+c.pricePerDay > 0)) e.pricePerDay = "Set a daily price";
    if (!(+c.seats > 0)) e.seats = "Seats must be at least 1";
    return e;
  }
  function renderDrawer() {
    const c = drawer.car, body = $("#drawerBody"), errs = carErrors(c);
    const cats = Array.from(new Set(["Hatchback", "Sedan", "SUV", "MUV", "Luxury", ...state.content.fleet.map((x) => x.category)].filter(Boolean)));
    const f = (key, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""} ${drawer.touched && errs[key] ? "is-invalid" : ""}"><label>${esc(label)}${help(o)}</label>${o.area ? `<textarea data-car="${key}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || "")}">${esc(c[key])}</textarea>` : `${o.prefix ? `<div class="prefix"><span>${o.prefix}</span>` : ""}<input type="${o.type || "text"}" data-car="${key}" ${o.type === "number" ? `data-type="number" inputmode="numeric" min="0"` : ""} value="${esc(c[key] ?? "")}" placeholder="${esc(o.placeholder || "")}" ${o.list ? `list="${o.list}"` : ""} />${o.prefix ? "</div>" : ""}`}${drawer.touched && errs[key] ? `<div class="hint hint--err">${esc(errs[key])}</div>` : ""}</div>`;
    const sel = (key, label, opts) => `<div class="field"><label>${esc(label)}</label><select data-car="${key}">${opts.map((v) => `<option ${String(c[key]) === String(v) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>`;
    const tog = (key, label) => `<label class="switch"><input type="checkbox" data-car="${key}" data-type="bool" ${c[key] ? "checked" : ""} /><span class="track"></span><span>${esc(label)}</span></label>`;
    const tabErr = { details: errs.name || errs.seats, pricing: errs.pricePerDay };
    $("#drawerTabs").innerHTML = [["details", "Details"], ["pricing", "Pricing"], ["photos", `Photos · ${(c.images || []).length}`]].map(([k, l]) => `<button type="button" class="${drawer.tab === k ? "is-active" : ""}" data-tab="${k}">${esc(l)}${drawer.touched && tabErr[k] ? '<span class="err"></span>' : ""}</button>`).join("");
    let pane = "";
    if (drawer.tab === "details") pane = `<section class="card"><div class="grid grid--2">${f("name", "Car name", { placeholder: "Maruti Suzuki Swift", full: true })}${f("brand", "Brand", { placeholder: "Maruti Suzuki" })}${f("category", "Category", { list: "catList" })}<datalist id="catList">${cats.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>${f("seats", "Seats", { type: "number" })}${sel("fuel", "Fuel", ["Petrol", "Diesel", "CNG", "Electric", "Hybrid"])}${sel("transmission", "Gearbox", ["Manual", "Automatic"])}${f("description", "Description", { area: true, full: true, rows: 3, help: "shown on the car's page" })}<div class="field field--full"><label>Features <small>one per line, shown as pills</small></label><textarea data-car="features" data-type="lines" rows="4">${esc((c.features || []).join("\n"))}</textarea></div></div></section>
      <section class="card"><div class="switches">${tog("featured", "Popular (shown first)")}${tog("hidden", "Hide from website")}</div><div class="hint" style="margin-top:12px">Availability: ${isBooked(c) ? `booked${c.bookedUntil ? " until " + esc(fmtDate(c.bookedUntil)) : ""}` : "available"}. <button type="button" class="btn btn--ghost btn--sm" id="drawerAvail" style="padding:0 6px;min-height:0;color:var(--accent-text)">Change</button></div></section>`;
    if (drawer.tab === "pricing") pane = `<section class="card"><div class="grid grid--2">${f("pricePerDay", "Price per day", { type: "number", prefix: "₹" })}${f("deposit", "Refundable deposit", { type: "number", prefix: "₹" })}${f("kmPerDay", "Km included per day", { type: "number" })}${f("extraKmCharge", "Extra km charge (per km)", { type: "number", prefix: "₹" })}</div></section>
      <section class="card"><div class="card__head"><div><h2>Long-rental prices</h2><p>Optional. The site shows the cheapest total for the visitor's dates.</p></div></div><div class="grid grid--2">${f("priceWeekly", "Price for 7 days", { type: "number", prefix: "₹", placeholder: c.pricePerDay ? String(Math.round(c.pricePerDay * 6)) : "" })}${f("priceMonthly", "Price for 30 days", { type: "number", prefix: "₹", placeholder: c.pricePerDay ? String(Math.round(c.pricePerDay * 22)) : "" })}</div><p class="hint" id="weeklyHint" style="margin-top:10px" hidden></p></section>`;
    if (drawer.tab === "photos") pane = `<section class="card">
      <button type="button" class="dropzone" id="dropzone" ${online() ? "" : "disabled"}>${icon("upload")}<b>${online() ? "Drop photos here or tap to upload" : "Uploads need the server (npm start)"}</b><span>JPG, PNG or WebP · full quality (only photos over 2560 px are scaled down)</span></button>
      <div class="progress" id="uploadProgress" style="margin-top:10px" hidden><div></div></div>
      <div style="display:flex;gap:8px;margin:14px 0;flex-wrap:wrap;align-items:center"><button type="button" class="btn btn--soft btn--sm" id="libBtn">${icon("image")} Add from library</button><span class="hint">The photo marked Cover is shown on the car's card.</span></div>
      <div class="imggrid" id="imgGrid">${(c.images || []).map((src, i) => `<div class="imgtile ${src === c.cover ? "is-cover" : ""}">${src === c.cover ? `<span class="imgtile__cover">Cover</span>` : ""}${thumb(src)}<div class="imgtile__bar"><button type="button" data-img-cover="${i}" aria-label="Set as cover" title="Set as cover">${icon("star")}</button><button type="button" data-img-move="${i}|-1" aria-label="Move left" ${i === 0 ? "disabled" : ""}>${icon("chevron-left")}</button><button type="button" data-img-move="${i}|1" aria-label="Move right" ${i === c.images.length - 1 ? "disabled" : ""}>${icon("chevron-right")}</button><button type="button" class="danger" data-img-remove="${i}" aria-label="Remove photo">${icon("trash")}</button></div></div>`).join("") || `<p class="empty" style="grid-column:1/-1">No photos yet.</p>`}</div></section>`;
    body.innerHTML = pane; hydrateIcons(body); fixThumbs(body);
    $$("[data-tab]").forEach((b) => (b.onclick = () => { drawer.tab = b.dataset.tab; renderDrawer(); body.scrollTop = 0; }));
    $$("[data-car]", body).forEach((el) => { const h = () => { c[el.dataset.car] = readInput(el); if (el.dataset.car === "name") $("#drawerTitle").textContent = c.name || "New car"; weeklyHint(); }; el.addEventListener("input", h); el.addEventListener("change", h); });
    function weeklyHint() { const w = $("#weeklyHint"); if (!w) return; const ok = +c.priceWeekly > 0 && +c.pricePerDay > 0; w.hidden = !ok; if (ok) w.textContent = `Weekly works out to ${inr(Math.round(c.priceWeekly / 7))}/day, ${Math.max(0, Math.round((1 - c.priceWeekly / (c.pricePerDay * 7)) * 100))}% off the daily price.`; }
    weeklyHint();
    const da = $("#drawerAvail"); if (da) da.onclick = () => { if (drawer.index == null) { toast("Save the car first, then set availability from the list."); return; } const tmp = state.content.fleet[drawer.index]; Object.assign(tmp, { available: c.available, bookedUntil: c.bookedUntil }); openAvailability(drawer.index); $("#availDlg").addEventListener("close", () => { c.available = tmp.available; c.bookedUntil = tmp.bookedUntil; renderDrawer(); }, { once: true }); };
    $$("[data-img-cover]", body).forEach((b) => (b.onclick = () => { c.cover = c.images[+b.dataset.imgCover]; renderDrawer(); }));
    $$("[data-img-move]", body).forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.imgMove.split("|").map(Number); [c.images[i], c.images[i + d]] = [c.images[i + d], c.images[i]]; renderDrawer(); }));
    $$("[data-img-remove]", body).forEach((b) => (b.onclick = () => { const i = +b.dataset.imgRemove, removed = c.images.splice(i, 1)[0]; const wasCover = c.cover === removed; if (wasCover) c.cover = c.images[0] || ""; renderDrawer(); toast("Photo removed", "", { action: "Undo", onAction: () => { c.images.splice(i, 0, removed); if (wasCover) c.cover = removed; renderDrawer(); } }); }));
    const dz = $("#dropzone");
    if (dz && online()) {
      dz.onclick = () => pickFiles(true, addUploads);
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("is-over"); }; dz.ondragleave = () => dz.classList.remove("is-over");
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("is-over"); addUploads(Array.from(e.dataTransfer.files)); };
    }
    const libBtn = $("#libBtn"); if (libBtn) libBtn.onclick = () => openLibrary({ single: false, exclude: c.images }, (paths) => { paths.forEach((p) => { if (!c.images.includes(p)) c.images.push(p); }); if (!c.cover && c.images[0]) c.cover = c.images[0]; renderDrawer(); });
    async function addUploads(files) {
      if (!files.length) return;
      const folder = slugify(c.id || c.name || "car");
      const paths = await uploadFiles(files, folder, (pct) => { const p = $("#uploadProgress"); if (p) { p.hidden = false; p.firstElementChild.style.width = pct + "%"; } });
      paths.forEach((p) => c.images.push(p)); if (!c.cover && c.images[0]) c.cover = c.images[0];
      renderDrawer();
    }
  }
  async function commitDrawer() {
    const c = drawer.car; drawer.touched = true;
    const errs = carErrors(c);
    if (Object.keys(errs).length) { drawer.tab = errs.name || errs.seats ? "details" : "pricing"; renderDrawer(); toast(Object.values(errs)[0], "error"); return; }
    c.name = c.name.trim();
    if (!c.id) c.id = uniqueId(slugify(c.name));
    if (!c.cover && c.images.length) c.cover = c.images[0];
    ["priceWeekly", "priceMonthly"].forEach((k) => { if (!(+c[k] > 0)) c[k] = null; });
    if (c.available !== false) c.bookedUntil = "";
    const isNew = drawer.index == null;
    if (isNew) state.content.fleet.push(c); else state.content.fleet[drawer.index] = c;
    drawer.touched = false; drawer.original = JSON.stringify(c);
    markDirty(); await closeDrawer(true);
    if (state.section === "fleet" || state.section === "dashboard") rerender(); else go("fleet");
    toast(isNew ? `${c.name} added. Publish to make it live.` : `${c.name} updated. Publish to make it live.`, "success");
  }
  function bindDrawer() {
    $$("[data-drawer-close]").forEach((el) => (el.onclick = () => closeDrawer()));
    $("#drawerDone").onclick = $("#drawerDone2").onclick = commitDrawer;
    $("#drawerDelete").onclick = async () => {
      const i = drawer.index, car = state.content.fleet[i];
      if (await ask({ title: `Delete ${car.name}?`, text: "It will be removed from the site when you publish. Photos stay in the library.", buttons: [{ label: "Cancel", value: "" }, { label: "Delete", value: "ok", kind: "danger" }] }) !== "ok") return;
      state.content.fleet.splice(i, 1); markDirty(); await closeDrawer(true); go("fleet");
      toast(`${car.name} deleted`, "", { action: "Undo", onAction: () => { state.content.fleet.splice(i, 0, car); markDirty(); rerender(); } });
    };
    $("#drawer").addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("dialog[open]")) closeDrawer(); if ((e.ctrlKey || e.metaKey) && e.key === "Enter") commitDrawer(); });
  }

  /* ============================================================
     Uploads
     ============================================================ */
  function pickFiles(multiple, cb) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp"; inp.multiple = multiple; inp.onchange = () => cb(Array.from(inp.files)); inp.click(); }
  /* Photos are uploaded as they are when they are already a sensible size, so nothing is lost.
     Only very large ones (straight from a camera) are scaled down, to 2560 px at high quality:
     still sharp on a full-width hero on a large or high-density screen. */
  const KEEP_BYTES = 4 * 1024 * 1024;
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("Could not read " + file.name)); r.readAsDataURL(file); });
  }
  function resizeImage(file, max = 2560, quality = 0.92) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url); let { width: w, height: h } = img;
        if (Math.max(w, h) <= max && file.size <= KEEP_BYTES) return resolve(readAsDataUrl(file));
        const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        const png = file.type === "image/png"; // keep transparency for logos
        ctx.drawImage(img, 0, 0, w, h); resolve(cv.toDataURL(png ? "image/png" : "image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read " + file.name)); };
      img.src = url;
    });
  }
  async function uploadFiles(files, folder, onProgress) {
    if (!online()) { toast("Uploads need the server. Run npm start.", "error"); return []; }
    const out = []; let n = 0; const imgs = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (imgs.length < files.length) toast("Some files were skipped. Use JPG, PNG or WebP.", "error");
    for (const f of imgs) {
      try { const data = await resizeImage(f); const d = await api("POST", "/api/upload", { name: f.name, data, folder }); out.push(d.path); } catch (e) { toast(e.message, "error"); }
      n++; if (onProgress) onProgress(Math.round((n / imgs.length) * 100));
    }
    if (out.length) toast(state.mode === "vercel" ? `${out.length} photo${out.length > 1 ? "s" : ""} uploaded. They appear on the site after the next deploy.` : `${out.length} photo${out.length > 1 ? "s" : ""} uploaded`, "success");
    return out;
  }
  /* Thumbnails: try the 720px "-sm" copy first, fall back to the original (no inline handlers). */
  function fixThumbs(root) { $$("img[data-full]", root).forEach((im) => im.addEventListener("error", () => { const full = im.dataset.full; if (full && !im.src.endsWith(full)) im.src = full; }, { once: true })); }

  /* ============================================================
     Photo library
     ============================================================ */
  const lib = { all: [], selected: new Set(), single: false, cb: null, exclude: new Set() };
  async function openLibrary(opts, cb) {
    lib.single = !!opts.single; lib.cb = cb; lib.selected = new Set(); lib.exclude = new Set(opts.exclude || []);
    $("#libGrid").innerHTML = `<p class="empty">Loading photos…</p>`; $("#libSearch").value = ""; $("#libDelete").hidden = !state.photoStore; $("#libDlg").showModal();
    if (online()) { try { lib.all = (await api("GET", "/api/images")).images; } catch (e) { lib.all = []; toast(e.message, "error"); } }
    else lib.all = Array.from(new Set(state.content.fleet.flatMap((x) => x.images || []).concat(state.content.hero.image ? [state.content.hero.image] : [])));
    renderLib();
  }
  function renderLib() {
    const q = $("#libSearch").value.toLowerCase(); const groups = {};
    lib.all.filter((p) => !lib.exclude.has(p) && p.toLowerCase().includes(q)).forEach((p) => { const folder = p.split("/").slice(2, -1).join(" / ").replace(/-/g, " ") || "other"; (groups[folder] = groups[folder] || []).push(p); });
    $("#libGrid").innerHTML = Object.keys(groups).sort().map((g) => `<div class="lib__folder">${esc(g)} · ${groups[g].length}</div>` + groups[g].map((p) => `<button type="button" data-pick="${esc(p)}" class="${lib.selected.has(p) ? "is-selected" : ""}" aria-pressed="${lib.selected.has(p)}" aria-label="${esc(p.split("/").pop())}">${thumb(p)}</button>`).join("")).join("") || `<p class="empty">No photos found.</p>`;
    fixThumbs($("#libGrid"));
    $("#libCount").textContent = lib.selected.size ? `${lib.selected.size} selected` : lib.single ? "Pick one photo" : "Pick one or more";
    $("#libUse").disabled = $("#libDelete").disabled = !lib.selected.size;
    $$("[data-pick]", $("#libGrid")).forEach((b) => (b.onclick = () => { const p = b.dataset.pick; if (lib.single) { lib.selected = new Set([p]); } else if (lib.selected.has(p)) lib.selected.delete(p); else lib.selected.add(p); const top = $("#libGrid").scrollTop; renderLib(); $("#libGrid").scrollTop = top; }));
  }
  function bindLibrary() {
    $$("[data-lib-close]").forEach((el) => (el.onclick = () => $("#libDlg").close()));
    $("#libSearch").oninput = renderLib;
    $("#libUse").onclick = () => { const picked = Array.from(lib.selected); $("#libDlg").close(); if (lib.cb) lib.cb(picked); };
    // Photos kept in Cloudflare R2 can be deleted for good (the thumbnail goes with it)
    $("#libDelete").onclick = async () => {
      const picked = Array.from(lib.selected), used = JSON.stringify([state.content, state.saved]);
      const inUse = picked.filter((p) => used.includes(JSON.stringify(p)));
      const n = picked.length, what = n === 1 ? "this photo" : `these ${n} photos`;
      if (await ask({ title: `Delete ${what}?`, text: (inUse.length ? `${inUse.length === n ? (n === 1 ? "It is" : "They are") : inUse.length + " of them are"} still used on the site and will show as missing until you pick another photo. ` : "") + "This can't be undone.", buttons: [{ label: "Cancel", value: "" }, { label: "Delete", value: "ok", kind: "danger" }] }) !== "ok") return;
      let done = 0;
      for (const p of picked) { try { await api("DELETE", "/api/upload", { path: p }); lib.all = lib.all.filter((x) => x !== p); lib.selected.delete(p); done++; } catch (e) { toast(e.message, "error"); break; } }
      if (done) toast(`${done} photo${done > 1 ? "s" : ""} deleted`, "success");
      renderLib();
    };
  }

  /* ============================================================
     Live preview
     ============================================================ */
  function openPreview() {
    const fr = $("#previewFrame"), th = document.documentElement.getAttribute("data-theme");
    $$('[name="pvTheme"]').forEach((r) => (r.checked = r.value === th));
    if (!fr.getAttribute("src")) fr.src = "index.html?preview=1&theme=" + th; else { pushPreview(); fr.contentWindow.postMessage({ type: "dp:theme", theme: th }, location.origin); }
    $("#previewDlg").showModal();
  }
  function pushPreview() { const fr = $("#previewFrame"); if (fr && fr.contentWindow && $("#previewDlg").open) fr.contentWindow.postMessage({ type: "dp:preview", content: state.content }, location.origin); }
  function bindPreview() {
    $("#previewBtn").onclick = openPreview; $("#tabPreview").onclick = openPreview;
    $$("[data-preview-close]").forEach((el) => (el.onclick = () => $("#previewDlg").close()));
    window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.type === "dp:ready") pushPreview(); });
    $$('[name="pvDevice"]').forEach((r) => (r.onchange = () => $(".preview__stage").classList.toggle("is-mobile", r.value === "mobile" && r.checked)));
    $$('[name="pvTheme"]').forEach((r) => (r.onchange = () => { if (r.checked) $("#previewFrame").contentWindow.postMessage({ type: "dp:theme", theme: r.value }, location.origin); }));
  }

  /* ============================================================
     Publish / export / import
     ============================================================ */
  async function save(force) {
    if (state.publishing) return;
    if (!$("#drawer").hidden) { toast("Press Done to apply the car's changes first."); return; }
    if (!online()) { exportJson(); toast("Downloaded content.json and content.js. Put them in the data folder to publish."); return; }
    if (!state.dirty && !force) { toast("Nothing new to publish."); return; }
    state.publishing = true; renderStatus();
    try {
      const d = await api("PUT", "/api/content", state.content, { "X-Base-Updated-At": (state.saved || {}).updatedAt || "", ...(force ? { "X-Force": "1" } : {}) });
      state.content.updatedAt = d.updatedAt; state.saved = clone(state.content);
      state.publishing = false; markDirty(true);
      toast(state.mode === "vercel" ? "Published. The live site updates in about a minute." : "Published to the live site", "success");
    } catch (e) {
      state.publishing = false; renderStatus();
      if (e.status === 409) {
        const v = await ask({ title: "Published from another device", text: "Someone published changes after you opened the editor. Load their version (your unsaved edits are dropped), or replace it with yours.", buttons: [{ label: "Cancel", value: "" }, { label: "Load latest", value: "reload" }, { label: "Publish mine", value: "force", kind: "danger" }] });
        if (v === "force") return save(true);
        if (v === "reload") { state.content = await loadContent(); migrate(state.content); state.saved = clone(state.content); markDirty(true); rerender(); toast("Loaded the latest version"); }
        return;
      }
      if (e.status !== 401) toast(e.message, "error");
    }
  }
  function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function exportJson() { const json = JSON.stringify(state.content, null, 2); download("content.json", json + "\n", "application/json"); setTimeout(() => download("content.js", "window.SITE_CONTENT = " + json + ";\n", "application/javascript"), 300); }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => { try { const c = JSON.parse(String(r.result).replace(/^\s*window\.SITE_CONTENT\s*=\s*/, "").replace(/;\s*$/, "")); if (!c.site || !Array.isArray(c.fleet)) throw new Error("This doesn't look like a content file"); migrate(c); state.content = c; markDirty(true); rerender(); toast("Imported. Review it, then publish.", "success"); } catch (e) { toast(e.message, "error"); } };
    r.readAsText(file);
  }

  /* ============================================================
     Schema migration: fills in anything older content files lack
     ============================================================ */
  function migrate(c) {
    const numOr = (v, d) => (v === "" || v == null || !Number.isFinite(+v) ? d : +v);
    c.site = c.site || {};
    if (!c.social) {
      const old = c.site.social || {};
      c.social = { showInHeader: true, showInFooter: true, showInContact: true, shareButtons: true, links: ["instagram", "facebook", "youtube"].map((k) => ({ platform: k, label: k[0].toUpperCase() + k.slice(1), url: old[k] || "", enabled: !!old[k] })), section: { enabled: false, eyebrow: "Follow us", title: "See the fleet in action", text: "", handle: "", ctaText: "Follow us", ctaLink: "", posts: [] } };
    }
    delete c.site.social;
    c.site.logo = c.site.logo || ""; c.site.logoHeight = numOr(c.site.logoHeight, 38); if (c.site.logoShowText == null) c.site.logoShowText = true; c.site.favicon = c.site.favicon || "";
    c.seo = Object.assign({ title: "", description: "", keywords: "", image: "" }, c.seo);
    c.theme = Object.assign({ mode: "auto", accent: "#0071e3", allowToggle: true }, c.theme);
    if (!/^#[0-9a-f]{6}$/i.test(c.theme.accent)) c.theme.accent = "#0071e3";
    c.hero = c.hero || {}; c.hero.badges = c.hero.badges || [];
    c.stats = c.stats || [];
    ["features", "testimonials", "faq"].forEach((k) => { c[k] = c[k] || {}; c[k].items = c[k].items || []; });
    c.howItWorks = c.howItWorks || {}; c.howItWorks.steps = c.howItWorks.steps || [];
    c.contact = c.contact || {}; c.footer = c.footer || {};
    c.promos = Object.assign({ enabled: true, interval: 5, showArrows: true, showDots: true, pauseOnHover: true, items: [] }, c.promos);
    c.promos.interval = numOr(c.promos.interval, 5); c.promos.items = c.promos.items || [];
    c.social.links = c.social.links || []; c.social.section = c.social.section || {}; c.social.section.posts = c.social.section.posts || [];
    c.testimonials.items.forEach((t) => (t.rating = Math.min(5, Math.max(1, numOr(t.rating, 5)))));
    c.fleet = (c.fleet || []).filter(Boolean);
    c.fleet.forEach((f) => {
      f.seats = numOr(f.seats, 5); f.pricePerDay = numOr(f.pricePerDay, 0); f.kmPerDay = numOr(f.kmPerDay, 300); f.extraKmCharge = numOr(f.extraKmCharge, 0); f.deposit = numOr(f.deposit, 0);
      f.priceWeekly = +f.priceWeekly > 0 ? +f.priceWeekly : null; f.priceMonthly = +f.priceMonthly > 0 ? +f.priceMonthly : null;
      f.bookedUntil = f.bookedUntil || ""; f.images = f.images || []; f.features = f.features || [];
    });
    c.schemaVersion = 2;
    return c;
  }

  /* ============================================================
     Shell: sidebar, tab bar, shortcuts
     ============================================================ */
  function openSidebar() { $("#sidebar").classList.add("is-open"); document.documentElement.classList.add("is-locked"); }
  function closeSidebar() { $("#sidebar").classList.remove("is-open"); if ($("#drawer").hidden) document.documentElement.classList.remove("is-locked"); }
  function bindShell() {
    $("#menuBtn").onclick = openSidebar; $("#tabMore").onclick = openSidebar;
    $("#sidebarClose").onclick = closeSidebar; $("#sidebarScrim").onclick = closeSidebar;
    $$("[data-tab-go]").forEach((b) => (b.onclick = () => go(b.dataset.tabGo)));
    $("#navSearch").oninput = renderNav;
    $("#navSearch").onkeydown = (e) => { if (e.key === "Enter") { const b = $("#nav [data-section]"); if (b) { b.click(); e.target.value = ""; renderNav(); } } };
    const more = $("#moreMenu"), mb = $("#moreBtn");
    mb.onclick = (e) => { e.stopPropagation(); more.hidden = !more.hidden; mb.setAttribute("aria-expanded", !more.hidden); };
    document.addEventListener("click", (e) => { if (!more.hidden && !e.target.closest(".menu-wrap")) { more.hidden = true; mb.setAttribute("aria-expanded", "false"); } });
    $("#exportBtn").onclick = () => { more.hidden = true; exportJson(); };
    $("#importBtn").onclick = () => { more.hidden = true; $("#importFile").click(); };
    $("#importFile").onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; };
    $("#discardBtn").onclick = async () => { more.hidden = true; if (await ask({ title: "Discard unsaved changes?", text: "Everything since your last publish will be undone.", buttons: [{ label: "Cancel", value: "" }, { label: "Discard", value: "ok", kind: "danger" }] }) !== "ok") return; state.content = clone(state.saved); markDirty(true); rerender(); toast("Changes discarded"); };
    $("#saveBtn").onclick = () => save();
    $("#logoutBtn").onclick = async () => { if (state.dirty && online() && await ask({ title: "Sign out with unsaved changes?", text: "They're kept as a draft on this device.", buttons: [{ label: "Cancel", value: "" }, { label: "Sign out", value: "ok", kind: "primary" }] }) !== "ok") return; signOut(); };
    document.addEventListener("keydown", (e) => {
      if ($("#app").hidden) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); if (innerWidth <= 900) openSidebar(); $("#navSearch").focus(); $("#navSearch").select(); }
      if (e.key === "Escape" && $("#sidebar").classList.contains("is-open")) closeSidebar();
    });
  }

  /* ============================================================
     Boot
     ============================================================ */
  async function boot() {
    let content;
    try { content = await loadContent(); } catch (e) { if (e.status !== 401) toast(e.message, "error"); return; }
    state.content = migrate(content); state.saved = clone(state.content);
    if (online() && state.token && state.mode === "server") { try { const me = await api("GET", "/api/me"); state.defaultPassword = !!me.defaultPassword; } catch (e) { /* handled by api() */ } }
    $("#login").hidden = true; $("#app").hidden = false;
    // Restore an unsaved draft from this device?
    try {
      const raw = store.get(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw); migrate(d.content);
        if (JSON.stringify(d.content) !== JSON.stringify(state.saved)) {
          const stale = d.base && d.base !== (state.saved.updatedAt || "");
          const v = await ask({ title: "Restore unsaved changes?", text: `You have edits from ${new Date(d.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} that weren't published.${stale ? " The site has been published since then, so restoring will replace those newer changes." : ""}`, buttons: [{ label: "Discard", value: "discard" }, { label: "Restore", value: "ok", kind: "primary" }] });
          if (v === "ok") state.content = d.content; else if (v === "discard") store.set(DRAFT_KEY, null);
        } else store.set(DRAFT_KEY, null);
      }
    } catch (e) { store.set(DRAFT_KEY, null); }
    applyBranding(state.content);
    $("#sbMode").innerHTML = state.mode === "server" ? `<span class="dot"></span><span>Connected · one-click publish</span>` : state.mode === "vercel" ? `<span class="dot"></span><span>Vercel · publishes via GitHub</span>` : `<span class="dot off"></span><span>Static mode · export to publish</span>`;
    await loadEnquiries(true);
    clearInterval(boot._poll);
    boot._poll = setInterval(async () => {
      if (document.hidden || $("#app").hidden) return;
      if (state.section === "analytics") loadAnalytics(true);
      const before = state.enq.counts.all || 0; await loadEnquiries(true);
      if ((state.enq.counts.all || 0) > before) {
        toast("New enquiry received", "success");
        const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
        if ((state.section === "enquiries" || state.section === "dashboard") && !typing) rerender();
      }
    }, 60000);
    renderNav(); hydrateIcons(document);
    const hash = location.hash.slice(1);
    history.replaceState(null, "", "#" + (SECTIONS.some((s) => s.id === hash) ? hash : "dashboard"));
    go(SECTIONS.some((s) => s.id === hash) ? hash : "dashboard"); markDirty(true);
  }
  async function init() {
    hydrateIcons(document);
    setAdminTheme(document.documentElement.getAttribute("data-theme") || "light");
    $$("[data-admin-theme]").forEach((b) => (b.onclick = () => setAdminTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark")));
    $("#pwEye").onclick = () => { const i = $("#loginPw"), show = i.type === "password"; i.type = show ? "text" : "password"; $("#pwEye").innerHTML = icon(show ? "eye-off" : "eye"); $("#pwEye").setAttribute("aria-label", show ? "Hide password" : "Show password"); };
    await detectMode();
    fetch("data/content.json", { cache: "no-store" }).then((r) => r.json()).then(applyBranding).catch(() => applyBranding(null));
    const lm = $("#loginMode");
    if (state.mode === "server") lm.innerHTML = `<span class="dot"></span><span>Connected to your server.</span>`;
    else if (state.mode === "vercel") lm.innerHTML = state.configError ? `<span class="dot off"></span><span><b>Vercel setup incomplete.</b> ${esc(state.configError)}. Add them in Vercel → Project → Settings → Environment Variables, then redeploy.</span>` : `<span class="dot"></span><span>Hosted on Vercel. Changes go live about a minute after you publish.</span>`;
    else { lm.innerHTML = `<span class="dot off"></span><span>Static mode (no server). You can edit and export, but nothing is password-protected.</span>`; $("#loginPw").closest(".field").hidden = true; $(".check").hidden = true; $("#loginBtn").innerHTML = icon("edit") + " Open editor"; }
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault(); $("#loginErr").hidden = true; const btn = $("#loginBtn"); btn.disabled = true;
      try { await signIn($("#loginPw").value, $("#loginRemember").checked); } catch (err) { $("#loginErr").textContent = err.message; $("#loginErr").hidden = false; $("#loginPw").select(); }
      btn.disabled = false;
    };
    bindShell(); bindDrawer(); bindLibrary(); bindPreview();
    if (online() && state.token) { try { await boot(); } catch (e) { forgetToken(); } }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
