/* ============================================================
   DriveEase Admin — edits every section of the home page
   Works in two modes:
     server  → saves via /api (node server.js)
     static  → edits in browser, export content.json manually
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "car";
  const DRAFT_KEY = "driveease_admin_draft";

  const online = () => state.mode === "server" || state.mode === "vercel";
  const state = { mode: "static", configError: "", token: sessionStorage.getItem("de_token") || "", content: null, saved: null, section: "dashboard", dirty: false, savedAt: null, defaultPassword: false };

  /* ---------- path helpers ---------- */
  const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, val) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }

  /* ---------- toast ---------- */
  function toast(msg, kind) { const t = $("#toast"); t.className = "toast is-visible" + (kind ? " is-" + kind : ""); t.innerHTML = (kind === "error" ? icon("alert-triangle") : kind === "success" ? icon("check-circle") : icon("info")) + esc(msg); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("is-visible"), 3200); }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: "Bearer " + state.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 401 && path !== "/api/login") { signOut(true); throw new Error("Session expired. Please sign in again."); }
    if (!r.ok || data.ok === false) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  async function detectMode() {
    try { const r = await fetch("/api/health", { cache: "no-store" }); const d = await r.json(); if (d.ok) { state.mode = d.mode === "vercel" ? "vercel" : "server"; state.configError = d.configError || ""; return; } } catch (e) { /* static */ }
    state.mode = "static";
  }
  async function loadContent() {
    if (online()) return api("GET", "/api/content");
    try { const r = await fetch("data/content.json?v=" + Date.now(), { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) { /* file:// */ }
    if (window.SITE_CONTENT) return clone(window.SITE_CONTENT);
    throw new Error("Could not load content.json");
  }

  /* ---------- dirty / draft ---------- */
  function markDirty() {
    state.dirty = JSON.stringify(state.content) !== JSON.stringify(state.saved);
    $("#dirtyBadge").hidden = !state.dirty;
    try { if (state.dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), content: state.content })); else localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    clearTimeout(markDirty._p); markDirty._p = setTimeout(pushPreview, 250);
    refreshNavCounts();
  }
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- auth ---------- */
  async function signIn(pw) {
    if (online()) { const d = await api("POST", "/api/login", { password: pw }); state.token = d.token; state.defaultPassword = !!d.defaultPassword; sessionStorage.setItem("de_token", d.token); }
    await boot();
  }
  function signOut(silent) {
    if (online() && state.token && !silent) api("POST", "/api/logout").catch(() => {});
    state.token = ""; sessionStorage.removeItem("de_token");
    $("#app").hidden = true; $("#login").hidden = false; $("#loginPw").value = "";
    if (silent) { $("#loginErr").textContent = "Your session expired. Please sign in again."; $("#loginErr").hidden = false; }
  }

  /* ---------- sections registry ---------- */
  const SECTIONS = [
    { id: "dashboard", group: "main", label: "Dashboard", icon: "home", sub: "Overview and quick actions" },
    { id: "site", group: "content", label: "Business & contact", icon: "settings", sub: "Name, phone, WhatsApp, address, social links" },
    { id: "hero", group: "content", label: "Hero banner", icon: "layout", sub: "Headline, subtitle, buttons and background photo" },
    { id: "stats", group: "content", label: "Stats strip", icon: "bar-chart", sub: "The numbers shown under the hero" },
    { id: "promos", group: "content", label: "Offers & posters", icon: "tag", sub: "Rotating posters below the stats strip", count: () => (state.content.promos.items || []).filter((x) => x.enabled !== false && x.image).length },
    { id: "fleet", group: "content", label: "Fleet / cars", icon: "car", sub: "Add, edit, reorder and hide cars", count: () => (state.content.fleet || []).length },
    { id: "features", group: "content", label: "Why choose us", icon: "sparkles", sub: "Feature cards with icons" },
    { id: "how", group: "content", label: "How it works", icon: "list", sub: "The three booking steps" },
    { id: "testimonials", group: "content", label: "Reviews", icon: "message-circle", sub: "Customer testimonials", count: () => (state.content.testimonials.items || []).length },
    { id: "social", group: "content", label: "Social media", icon: "share", sub: "Profile links, follow section, embedded posts, share buttons", count: () => (state.content.social.links || []).filter((l) => l.enabled !== false && l.url).length },
    { id: "faq", group: "content", label: "FAQ", icon: "help-circle", sub: "Frequently asked questions", count: () => (state.content.faq.items || []).length },
    { id: "contact", group: "content", label: "Contact & footer", icon: "mail", sub: "Contact section text and footer" },
    { id: "seo", group: "content", label: "SEO", icon: "globe", sub: "Browser title, meta description and keywords" },
    { id: "backups", group: "system", label: "Backups", icon: "refresh", sub: "Restore a previous version" },
    { id: "security", group: "system", label: "Security", icon: "lock", sub: "Change the admin password" },
  ];
  function renderNav() {
    const groups = { main: $("#navMain"), content: $("#navContent"), system: $("#navSystem") };
    Object.values(groups).forEach((g) => (g.innerHTML = ""));
    SECTIONS.forEach((s) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.section = s.id;
      b.innerHTML = `${icon(s.icon)}<span>${esc(s.label)}</span>${s.count ? `<span class="pill" data-count="${s.id}"></span>` : ""}`;
      b.onclick = () => { go(s.id); $("#sidebar").classList.remove("is-open"); };
      groups[s.group].appendChild(b);
    });
    refreshNavCounts();
  }
  function refreshNavCounts() { SECTIONS.forEach((s) => { if (s.count) { const el = $(`[data-count="${s.id}"]`); if (el) el.textContent = s.count(); } }); }
  function go(id) {
    state.section = id; const s = SECTIONS.find((x) => x.id === id);
    $$("#sidebar nav button").forEach((b) => b.classList.toggle("is-active", b.dataset.section === id));
    $("#pageTitle").textContent = s.label; $("#pageSub").textContent = s.sub;
    const root = $("#content"); root.innerHTML = "";
    RENDER[id](root); hydrateIcons(root); bindFields(root); window.scrollTo({ top: 0 });
    location.hash = id;
  }

  /* ---------- form builders ---------- */
  const F = {
    text: (path, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""}"><label>${esc(label)}${o.help ? ` <small>${esc(o.help)}</small>` : ""}</label><input type="${o.type || "text"}" data-path="${esc(path)}" value="${esc(getPath(state.content, path))}" placeholder="${esc(o.placeholder || "")}" ${o.type === "number" ? `min="0" step="${o.step || 1}"` : ""} /></div>`,
    area: (path, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""}"><label>${esc(label)}${o.help ? ` <small>${esc(o.help)}</small>` : ""}</label><textarea data-path="${esc(path)}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || "")}">${esc(getPath(state.content, path))}</textarea></div>`,
    select: (path, label, options, o = {}) => `<div class="field ${o.full ? "field--full" : ""}"><label>${esc(label)}</label><select data-path="${esc(path)}">${options.map((v) => `<option value="${esc(v.value ?? v)}" ${String(getPath(state.content, path)) === String(v.value ?? v) ? "selected" : ""}>${esc(v.label ?? v)}</option>`).join("")}</select></div>`,
    toggle: (path, label, o = {}) => `<label class="switch ${o.full ? "field--full" : ""}"><input type="checkbox" data-path="${esc(path)}" data-type="bool" ${getPath(state.content, path) ? "checked" : ""} /><span class="track"></span><span>${esc(label)}</span></label>`,
    image: (path, label, o = {}) => { const v = getPath(state.content, path); return `<div class="field field--full"><label>${esc(label)}${o.help ? ` <small>${esc(o.help)}</small>` : ""}</label>
      <div class="imgfield"><div class="imgfield__preview">${v ? `<img src="${esc(v)}" alt="" />` : icon("image")}</div>
      <div style="display:grid;gap:10px"><input data-path="${esc(path)}" value="${esc(v)}" placeholder="assets/img/…" />
      <div class="imgfield__actions"><button type="button" class="btn btn--light btn--sm" data-lib-for="${esc(path)}">${icon("image")} Choose from library</button><button type="button" class="btn btn--light btn--sm" data-upload-for="${esc(path)}" ${!online() ? "disabled title='Uploads need the server (npm start)'" : ""}>${icon("upload")} Upload new</button></div></div></div></div>`; },
    tags: (path, label, o = {}) => `<div class="field field--full"><label>${esc(label)} <small>one per line</small></label><textarea data-path="${esc(path)}" data-type="lines" rows="${o.rows || 4}">${esc((getPath(state.content, path) || []).join("\n"))}</textarea></div>`,
  };
  function repeat(path, opts) {
    const items = getPath(state.content, path) || [];
    return `<div class="rep" data-rep="${esc(path)}">${items.map((it, i) => `<div class="rep__item">
      <div class="rep__handle"><button type="button" data-move="${path}|${i}|-1" ${i === 0 ? "disabled" : ""} title="Move up">${icon("arrow-up")}</button><button type="button" data-move="${path}|${i}|1" ${i === items.length - 1 ? "disabled" : ""} title="Move down">${icon("arrow-down")}</button></div>
      <div class="rep__body">${opts.item(`${path}.${i}`, it, i)}</div>
      <button type="button" class="rep__remove" data-remove="${path}|${i}" title="Remove">${icon("trash")}</button></div>`).join("")}
      <button type="button" class="rep__add" data-add="${esc(path)}">${icon("plus")} ${esc(opts.addLabel || "Add item")}</button></div>`;
  }
  const REPEAT_DEFAULTS = {
    "stats": () => ({ value: "10+", label: "New stat" }),
    "hero.badges": () => "New badge",
    "features.items": () => ({ icon: "check-circle", title: "New feature", text: "Describe the benefit in one or two sentences." }),
    "howItWorks.steps": () => ({ title: "New step", text: "What the customer does at this step." }),
    "testimonials.items": () => ({ name: "Customer name", role: "Trip or occasion", rating: 5, text: "What they said about the experience." }),
    "faq.items": () => ({ q: "New question?", a: "The answer." }),
    "social.links": () => ({ platform: "instagram", label: "Instagram", url: "", enabled: true }),
    "promos.items": () => ({ image: "", title: "", caption: "", text: "", ctaText: "", link: "#fleet", enabled: true, startDate: "", endDate: "", fit: "auto" }),
  };
  function bindFields(root) {
    $$("[data-path]", root).forEach((el) => {
      const path = el.dataset.path; const type = el.dataset.type || el.type;
      const handler = () => {
        let v = el.value;
        if (type === "bool") v = el.checked; else if (type === "number") v = el.value === "" ? "" : Number(el.value); else if (type === "lines") v = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
        setPath(state.content, path, v); markDirty();
        if (el.closest(".imgfield")) { const pv = $(".imgfield__preview", el.closest(".imgfield")); pv.innerHTML = v ? `<img src="${esc(v)}" alt="" />` : icon("image"); }
      };
      el.addEventListener("input", handler); el.addEventListener("change", handler);
    });
    $$("[data-move]", root).forEach((b) => (b.onclick = () => { const [p, i, d] = b.dataset.move.split("|"); const arr = getPath(state.content, p); const a = +i, z = a + +d; [arr[a], arr[z]] = [arr[z], arr[a]]; markDirty(); go(state.section); }));
    $$("[data-remove]", root).forEach((b) => (b.onclick = () => { const [p, i] = b.dataset.remove.split("|"); getPath(state.content, p).splice(+i, 1); markDirty(); go(state.section); }));
    $$("[data-add]", root).forEach((b) => (b.onclick = () => { const p = b.dataset.add; const arr = getPath(state.content, p) || []; arr.push((REPEAT_DEFAULTS[p] || (() => ({})))()); setPath(state.content, p, arr); markDirty(); go(state.section); setTimeout(() => { const last = $$(".rep__item", $(`[data-rep="${p}"]`)).pop(); if (last) { last.scrollIntoView({ behavior: "smooth", block: "center" }); const inp = $("input,textarea", last); if (inp) inp.focus(); } }, 50); }));
    $$("[data-lib-for]", root).forEach((b) => (b.onclick = () => openLibrary({ single: true }, (paths) => { if (!paths[0]) return; setPath(state.content, b.dataset.libFor, paths[0]); markDirty(); go(state.section); })));
    $$("[data-upload-for]", root).forEach((b) => (b.onclick = () => pickFiles(false, async (files) => { const p = await uploadFiles(files, "site"); if (p[0]) { setPath(state.content, b.dataset.uploadFor, p[0]); markDirty(); go(state.section); } })));
  }

  /* ---------- renderers ---------- */
  const card = (title, sub, body, extra) => `<section class="card"><div class="card__head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${extra || ""}</div>${body}</section>`;
  const RENDER = {
    dashboard(root) {
      const c = state.content; const fleet = c.fleet || [];
      const todo = [];
      if (/98765 43210|9876543210/.test(c.site.phone + c.site.whatsapp)) todo.push("Replace the placeholder phone and WhatsApp number in Business & contact");
      if (/driveease\.in/.test(c.site.email)) todo.push("Set your real email address");
      if (state.defaultPassword) todo.push("Change the default admin password in Security");
      const live = (c.social.links || []).filter((l) => l.enabled !== false && l.url);
      if (!live.length) todo.push("Add at least one social media profile in Social media");
      if (live.some((l) => /driveease/.test(l.url))) todo.push("Replace the placeholder social media URLs in Social media");
      const kpi = (ic, cls, v, l) => `<div class="kpi"><div class="kpi__icon ${cls}">${icon(ic)}</div><div><div class="kpi__value">${v}</div><div class="kpi__label">${esc(l)}</div></div></div>`;
      root.innerHTML = `
        ${state.mode === "static" ? `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>Static mode: changes are not saved to the server.</b> Edit freely, then use <b>Export</b> to download content.json and replace the file in the <code>data</code> folder. Run <code>npm start</code> (or double-click start.bat) to enable one-click publishing and photo uploads.</div></div>` : ""}
        ${state.mode === "vercel" ? `<div class="notice notice--info">${icon("info")}<div><b>Hosted on Vercel.</b> Publishing commits to GitHub and Vercel redeploys automatically. Changes and new photos appear on the live site about a minute after you publish.</div></div>` : ""}
        ${state.defaultPassword ? `<div class="notice notice--danger">${icon("lock")}<div><b>You are using the default password (admin123).</b> <a href="#security" data-go="security">Change it now</a> so nobody else can edit your site.</div></div>` : ""}
        <div class="kpis">${kpi("car", "", fleet.length, "Cars in fleet")}${kpi("check-circle", "green", fleet.filter((x) => x.available !== false && !x.hidden).length, "Available now")}${kpi("star", "amber", fleet.filter((x) => x.featured).length, "Marked popular")}${kpi("image", "blue", fleet.reduce((n, x) => n + (x.images || []).length, 0), "Photos online")}</div>
        ${card("Quick actions", "Jump straight to the things you edit most.", `<div class="quick">
          <button type="button" data-go="fleet" data-add-car="1">${icon("plus")}<div><b>Add a new car</b><span>Photos, price and specs</span></div></button>
          <button type="button" data-go="site">${icon("phone")}<div><b>Update phone / WhatsApp</b><span>Used by every button on the site</span></div></button>
          <button type="button" data-go="hero">${icon("layout")}<div><b>Change hero headline</b><span>The first thing visitors read</span></div></button>
          <button type="button" data-go="site" data-focus="site.announcement">${icon("bolt")}<div><b>Post an announcement</b><span>Top bar offer or notice</span></div></button>
          <button type="button" data-go="promos">${icon("tag")}<div><b>Add an offer poster</b><span>Festival and discount banners</span></div></button>
          <button type="button" data-go="testimonials">${icon("message-circle")}<div><b>Add a review</b><span>Social proof sells cars</span></div></button>
          <button type="button" data-go="faq">${icon("help-circle")}<div><b>Edit FAQ</b><span>Cut down on repeat questions</span></div></button></div>`)}
        ${card("Setup checklist", "", `<ul class="checklist">${todo.length ? todo.map((t) => `<li class="todo">${icon("check-circle")}${esc(t)}</li>`).join("") : `<li>${icon("check-circle")}Everything looks configured. Nice work!</li>`}</ul>`)}
        ${card("Fleet at a glance", "", `<div class="fleet-list">${fleet.slice(0, 6).map((x) => fleetRow(x, fleet.indexOf(x), true)).join("")}</div><div style="margin-top:14px"><button type="button" class="btn btn--light" data-go="fleet">Manage all ${fleet.length} cars</button></div>`)}`;
      $$("[data-go]", root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); if (b.dataset.addCar) openCarEditor(null); if (b.dataset.focus) { const el = $(`[data-path="${b.dataset.focus}"]`); if (el) { el.focus(); el.scrollIntoView({ block: "center" }); } } }));
      $$("[data-edit-car]", root).forEach((b) => (b.onclick = () => openCarEditor(+b.dataset.editCar)));
    },
    site(root) {
      root.innerHTML =
        card("Business details", "Shown in the header, footer and contact section.", `<div class="grid grid--2">${F.text("site.name", "Business name")}${F.text("site.tagline", "Tagline", { help: "under the logo" })}${F.text("site.phone", "Phone number", { help: "as displayed, e.g. +91 98765 43210" })}${F.text("site.whatsapp", "WhatsApp number", { help: "digits only with country code, e.g. 919876543210" })}${F.text("site.email", "Email", { type: "email" })}${F.text("site.city", "City")}${F.area("site.address", "Address", { full: true, rows: 2 })}${F.text("site.hours", "Opening hours / note", { full: true })}${F.text("site.mapEmbed", "Google Maps embed URL", { full: true, help: "Google Maps → Share → Embed a map → copy the src URL. Leave empty to hide the map." })}</div>`) +
        card("Announcement bar", "A slim bar above the header for offers or notices.", `<div class="grid">${F.toggle("site.announcementEnabled", "Show announcement bar")}${F.text("site.announcement", "Announcement text", { full: true })}</div>`) +
        `<div class="notice notice--info">${icon("share")}<div>Social media profiles, the Follow section and share buttons are managed under <a href="#social" data-go="social">Social media</a>.</div></div>`;
      $$("[data-go]", root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); }));
    },
    hero(root) {
      const ICON_OPTS = Object.keys(window.ICONS);
      root.innerHTML =
        card("Headline", "Keep it short. The highlighted part shows in orange on its own line.", `<div class="grid grid--2">${F.text("hero.eyebrow", "Small label above the title")}<div></div>${F.text("hero.title", "Title, first line")}${F.text("hero.titleHighlight", "Title, highlighted line")}${F.area("hero.subtitle", "Subtitle", { full: true })}</div>`) +
        card("Buttons & badges", "", `<div class="grid grid--2">${F.text("hero.primaryCta", "Primary button text")}${F.select("hero.primaryLink", "Primary button goes to", [{ value: "#fleet", label: "Fleet section" }, { value: "#contact", label: "Contact section" }, { value: "#how", label: "How it works" }, { value: "#why", label: "Why choose us" }])}${F.text("hero.secondaryCta", "WhatsApp button text")}<div></div>${F.tags("hero.badges", "Trust badges")}</div>`) +
        card("Background photo", "A wide landscape photo works best. It is darkened automatically so the text stays readable.", F.image("hero.image", "Hero image"));
      void ICON_OPTS;
    },
    stats(root) {
      root.innerHTML = card("Stats strip", "Four short numbers work best. Keep values to 6 characters or fewer.", repeat("stats", { addLabel: "Add stat", item: (p) => `<div class="grid grid--2">${F.text(p + ".value", "Value", { placeholder: "22+" })}${F.text(p + ".label", "Label", { placeholder: "Cars in fleet" })}</div>` }));
    },
    promos(root) {
      root.innerHTML =
        card("Carousel settings", "Posters rotate automatically and can be swiped on phones. Any image shape works: portrait posters get a blurred backdrop.", `<div class="grid grid--3"><div class="field--full">${F.toggle("promos.enabled", "Show the offers carousel")}</div>${F.text("promos.interval", "Seconds per slide", { type: "number" })}${F.toggle("promos.showArrows", "Show arrows")}${F.toggle("promos.showDots", "Show dots")}<div class="field--full">${F.toggle("promos.pauseOnHover", "Pause while the mouse is over it")}</div></div>`) +
        card("Posters", "Upload a festival or discount poster (1600×640 looks best), add an optional caption and link, and schedule it with dates. Expired posters disappear on their own.", repeat("promos.items", { addLabel: "Add poster", item: (p) => `<div class="grid grid--2">${F.image(p + ".image", "Poster image")}${F.text(p + ".title", "Poster name", { help: "for screen readers and image alt text" })}<div></div>${F.text(p + ".caption", "Caption headline", { help: "optional, overlaid on the poster. Leave empty if the poster already has text" })}${F.text(p + ".text", "Caption text", { help: "optional" })}${F.text(p + ".ctaText", "Button text", { help: "optional, e.g. Book now" })}${F.text(p + ".link", "Link", { help: "#fleet, #contact, #car-thar or a full URL" })}${F.text(p + ".startDate", "Show from", { type: "date" })}${F.text(p + ".endDate", "Show until", { type: "date" })}${F.select(p + ".fit", "Image fit", [{ value: "auto", label: "Automatic (recommended)" }, { value: "contain", label: "Fit whole poster (blurred edges)" }, { value: "cover", label: "Fill and crop" }])}<div>${F.toggle(p + ".enabled", "Show this poster")}</div></div>` }));
    },
    features(root) {
      const ICON_OPTS = ["shield", "tag", "truck", "clock", "sparkles", "headset", "heart", "check-circle", "star", "map", "key", "calendar", "phone", "users", "fuel", "gear", "road", "bolt", "globe", "lock"];
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("features.eyebrow", "Small label")}${F.text("features.title", "Title")}</div>`) +
        card("Feature cards", "Six cards fill the grid perfectly.", repeat("features.items", { addLabel: "Add feature", item: (p) => `<div class="grid grid--3">${F.select(p + ".icon", "Icon", ICON_OPTS)}${F.text(p + ".title", "Title")}<div></div>${F.area(p + ".text", "Text", { full: true, rows: 2 })}</div>` }));
    },
    how(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("howItWorks.eyebrow", "Small label")}${F.text("howItWorks.title", "Title")}</div>`) +
        card("Steps", "Numbered automatically in the order shown here.", repeat("howItWorks.steps", { addLabel: "Add step", item: (p) => `<div class="grid">${F.text(p + ".title", "Step title")}${F.area(p + ".text", "Description", { rows: 2 })}</div>` }));
    },
    testimonials(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("testimonials.eyebrow", "Small label")}${F.text("testimonials.title", "Title")}</div>`) +
        card("Reviews", "", repeat("testimonials.items", { addLabel: "Add review", item: (p) => `<div class="grid grid--3">${F.text(p + ".name", "Customer name")}${F.text(p + ".role", "Trip / occasion")}${F.select(p + ".rating", "Rating", [5, 4, 3, 2, 1].map((n) => ({ value: n, label: "★".repeat(n) })))}${F.area(p + ".text", "Review text", { full: true, rows: 2 })}</div>` }));
    },
    faq(root) {
      root.innerHTML = card("Section heading", "", `<div class="grid grid--2">${F.text("faq.eyebrow", "Small label")}${F.text("faq.title", "Title")}</div>`) +
        card("Questions", "The first question is expanded by default.", repeat("faq.items", { addLabel: "Add question", item: (p) => `<div class="grid">${F.text(p + ".q", "Question")}${F.area(p + ".a", "Answer", { rows: 2 })}</div>` }));
    },
    social(root) {
      const PLATFORMS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["google", "Google Business / Reviews"], ["x", "X (Twitter)"], ["linkedin", "LinkedIn"], ["threads", "Threads"], ["telegram", "Telegram"], ["whatsapp", "WhatsApp channel"], ["custom", "Other / custom"]];
      root.innerHTML =
        card("Your profiles", "Add every platform you are on. Disabled or empty links are hidden everywhere.", repeat("social.links", { addLabel: "Add platform", item: (p, it) => `<div class="grid grid--3">${F.select(p + ".platform", "Platform", PLATFORMS.map(([v, l]) => ({ value: v, label: l })))}${F.text(p + ".label", "Label", { placeholder: "Instagram" })}${F.text(p + ".url", "Profile URL", { placeholder: "https://instagram.com/yourpage" })}<div class="field--full">${F.toggle(p + ".enabled", "Show this link")}</div></div>` })) +
        card("Where the icons appear", "", `<div class="grid grid--3">${F.toggle("social.showInHeader", "Header (desktop, max 4)")}${F.toggle("social.showInFooter", "Footer")}${F.toggle("social.showInContact", "Contact section")}<div class="field--full">${F.toggle("social.shareButtons", "Share buttons on every car (WhatsApp, Facebook, X, copy link)")}</div></div>`) +
        card("Follow us section", "A dark band on the home page with your handle, platform buttons and embedded posts.", `<div class="grid grid--2"><div class="field--full">${F.toggle("social.section.enabled", "Show the Follow us section")}</div>${F.text("social.section.eyebrow", "Small label")}${F.text("social.section.title", "Title")}${F.area("social.section.text", "Text", { full: true, rows: 2 })}${F.text("social.section.handle", "Handle", { placeholder: "@yourbrand" })}<div></div>${F.text("social.section.ctaText", "Button text")}${F.text("social.section.ctaLink", "Button link", { placeholder: "https://instagram.com/yourpage" })}</div>`) +
        card("Embedded posts", "Paste post links: Instagram posts or reels, YouTube videos or shorts, Facebook posts or videos. Other links show as a card. Three or six look best.", F.tags("social.section.posts", "Post URLs", { rows: 6 }));
    },
    contact(root) {
      root.innerHTML = card("Contact section", "Also used for the dark call-to-action band.", `<div class="grid grid--2">${F.text("contact.eyebrow", "Small label")}${F.text("contact.title", "Title")}${F.area("contact.text", "Text", { full: true, rows: 2 })}</div>`) +
        card("Footer", "", `<div class="grid">${F.area("footer.about", "About text", { rows: 3 })}${F.text("footer.copyright", "Copyright line", { help: "{year} is replaced with the current year" })}</div>`);
    },
    seo(root) {
      root.innerHTML = card("Search engine settings", "What Google and WhatsApp link previews show.", `<div class="grid">${F.text("seo.title", "Browser / Google title", { help: "under 60 characters is ideal" })}${F.area("seo.description", "Meta description", { rows: 2, help: "under 160 characters" })}${F.text("seo.keywords", "Keywords", { help: "comma separated" })}</div>`);
    },
    fleet(root) {
      const fleet = state.content.fleet || [];
      root.innerHTML = `<div class="fleet-tools"><input type="search" id="fleetSearch" placeholder="Search cars…" /><div style="display:flex;gap:8px"><button class="btn btn--primary" id="addCarBtn">${icon("plus")} Add car</button></div></div>
        <div class="notice notice--info">${icon("info")}<div>Cars appear on the site in this order (popular cars are pulled to the top). Use the arrows to reorder, the eye to hide a car without deleting it, and the switch inside the editor to mark it booked.</div></div>
        <div class="fleet-list" id="fleetList">${fleet.map((x, i) => fleetRow(x, i)).join("")}</div>`;
      $("#addCarBtn").onclick = () => openCarEditor(null);
      $("#fleetSearch").oninput = (e) => { const q = e.target.value.toLowerCase(); $$("#fleetList .fleet-row").forEach((r) => (r.hidden = !r.dataset.search.includes(q))); };
      bindFleetRows(root);
    },
    backups(root) {
      if (state.mode === "vercel") { root.innerHTML = `<div class="notice notice--info">${icon("info")}<div><b>On Vercel every publish is a Git commit.</b> Your full history is in the GitHub repository. To roll back, revert the commit on GitHub (or restore an older <code>data/content.json</code>) and Vercel redeploys it.</div></div>`; return; }
      if (state.mode !== "server") { root.innerHTML = `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>Backups need the server.</b> Run <code>npm start</code> to keep the last 30 published versions automatically.</div></div>`; return; }
      root.innerHTML = card("Published versions", "A copy is kept every time you publish. Restoring replaces the live content immediately.", `<div id="backupList">Loading…</div>`);
      api("GET", "/api/backups").then((d) => {
        $("#backupList").innerHTML = d.backups.length ? `<div class="fleet-list">${d.backups.map((b) => { const m = b.name.match(/content-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/); const when = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`).toLocaleString("en-IN") : b.name; return `<div class="fleet-row" style="grid-template-columns:1fr auto auto"><div><div class="fleet-row__name">${esc(when)}</div><div class="fleet-row__meta">${esc(b.name)} · ${(b.size / 1024).toFixed(1)} KB</div></div><span></span><button class="btn btn--light btn--sm" data-restore="${esc(b.name)}">${icon("refresh")} Restore</button></div>`; }).join("")}</div>` : `<p style="color:var(--muted)">No backups yet. One is created each time you publish.</p>`;
        hydrateIcons($("#backupList"));
        $$("[data-restore]").forEach((b) => (b.onclick = async () => { if (!confirm("Restore this version? The current live content will be replaced (a backup of it is kept).")) return; try { const d = await api("POST", "/api/restore", { name: b.dataset.restore }); state.content = d.content; state.saved = clone(d.content); markDirty(); toast("Version restored and published", "success"); go("backups"); } catch (e) { toast(e.message, "error"); } }));
      }).catch((e) => ($("#backupList").textContent = e.message));
    },
    security(root) {
      if (state.mode === "vercel") { root.innerHTML = `<div class="notice notice--info">${icon("lock")}<div><b>On Vercel the password is the ADMIN_PASSWORD environment variable.</b> Change it in Vercel → Project → Settings → Environment Variables, then redeploy. Existing sessions are signed out automatically.</div></div>`; return; }
      if (state.mode !== "server") { root.innerHTML = `<div class="notice notice--warn">${icon("alert-triangle")}<div><b>Password protection needs the server.</b> Run <code>npm start</code> to enable sign-in and password changes.</div></div>`; return; }
      root.innerHTML = card("Change admin password", "Use at least 6 characters. You can also set the ADMIN_PASSWORD environment variable on the server.", `<form id="pwForm" class="grid grid--3"><div class="field"><label>Current password</label><input type="password" id="pwCur" autocomplete="current-password" required /></div><div class="field"><label>New password</label><input type="password" id="pwNew" autocomplete="new-password" required minlength="6" /></div><div class="field"><label>Confirm new password</label><input type="password" id="pwNew2" autocomplete="new-password" required /></div><div class="field--full"><button class="btn btn--dark" type="submit">${icon("key")} Update password</button></div></form>`);
      $("#pwForm").onsubmit = async (e) => { e.preventDefault(); if ($("#pwNew").value !== $("#pwNew2").value) return toast("New passwords do not match", "error"); try { await api("POST", "/api/password", { current: $("#pwCur").value, next: $("#pwNew").value }); state.defaultPassword = false; toast("Password updated", "success"); $("#pwForm").reset(); } catch (err) { toast(err.message, "error"); } };
    },
  };

  /* ---------- fleet rows ---------- */
  function fleetRow(x, i, compact) {
    const fleet = state.content.fleet;
    return `<div class="fleet-row" data-search="${esc((x.name + " " + x.brand + " " + x.category).toLowerCase())}">
      ${compact ? "<span></span>" : `<div class="rep__handle"><button type="button" data-car-move="${i}|-1" ${i === 0 ? "disabled" : ""}>${icon("arrow-up")}</button><button type="button" data-car-move="${i}|1" ${i === fleet.length - 1 ? "disabled" : ""}>${icon("arrow-down")}</button></div>`}
      <div class="fleet-row__thumb">${x.cover ? `<img src="${esc(x.cover.replace(/(\d{2})\.jpg$/, "$1-sm.jpg"))}" onerror="this.onerror=null;this.src='${esc(x.cover)}'" alt="" />` : ""}</div>
      <div style="min-width:0"><div class="fleet-row__name">${esc(x.name)}</div><div class="fleet-row__meta">${esc(x.category)} · ${esc(x.seats)} seats · ${esc(x.fuel)} · ${esc(x.transmission)} · ${(x.images || []).length} photos</div></div>
      <div class="fleet-row__price">${inr(x.pricePerDay)}<small> / day</small></div>
      <div class="badges">${x.featured ? `<span class="badge badge--accent">Popular</span>` : ""}${x.available === false ? `<span class="badge badge--red">Booked</span>` : `<span class="badge badge--green">Available</span>`}${x.hidden ? `<span class="badge badge--gray">Hidden</span>` : ""}</div>
      <div class="fleet-row__actions">${compact ? "" : `<button type="button" class="btn btn--light btn--icon" data-car-hide="${i}" title="${x.hidden ? "Show on site" : "Hide from site"}">${icon(x.hidden ? "eye-off" : "eye")}</button><button type="button" class="btn btn--light btn--icon" data-car-dup="${i}" title="Duplicate">${icon("plus")}</button>`}<button type="button" class="btn btn--dark btn--sm" data-edit-car="${i}">${icon("edit")} Edit</button></div></div>`;
  }
  function bindFleetRows(root) {
    $$("[data-edit-car]", root).forEach((b) => (b.onclick = () => openCarEditor(+b.dataset.editCar)));
    $$("[data-car-move]", root).forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.carMove.split("|").map(Number); const a = state.content.fleet; [a[i], a[i + d]] = [a[i + d], a[i]]; markDirty(); go("fleet"); }));
    $$("[data-car-hide]", root).forEach((b) => (b.onclick = () => { const c = state.content.fleet[+b.dataset.carHide]; c.hidden = !c.hidden; markDirty(); go("fleet"); }));
    $$("[data-car-dup]", root).forEach((b) => (b.onclick = () => { const i = +b.dataset.carDup; const c = clone(state.content.fleet[i]); c.name += " (copy)"; c.id = uniqueId(slugify(c.name)); state.content.fleet.splice(i + 1, 0, c); markDirty(); go("fleet"); }));
  }
  function uniqueId(base) { const ids = new Set(state.content.fleet.map((x) => x.id)); let id = base, n = 2; while (ids.has(id)) id = `${base}-${n++}`; return id; }

  /* ---------- car editor drawer ---------- */
  const drawer = { index: null, car: null, tab: "details" };
  function openCarEditor(index) {
    drawer.index = index; drawer.tab = "details";
    drawer.car = index == null ? { id: "", name: "", brand: "", category: "Hatchback", seats: 5, fuel: "Petrol", transmission: "Manual", pricePerDay: 1999, kmPerDay: 300, extraKmCharge: 8, deposit: 3000, featured: false, available: true, hidden: false, description: "", features: ["Air Conditioning", "Music System", "Power Steering", "Airbags"], cover: "", images: [] } : clone(state.content.fleet[index]);
    $("#drawerTitle").textContent = index == null ? "Add a new car" : "Edit " + drawer.car.name;
    $("#drawerSub").textContent = index == null ? "Fill in the details, then add photos." : "Changes apply when you press Done, and go live when you publish.";
    $("#drawerDelete").hidden = index == null;
    renderDrawer(); $("#drawer").classList.add("is-open"); document.body.style.overflow = "hidden";
  }
  function closeDrawer() { $("#drawer").classList.remove("is-open"); document.body.style.overflow = ""; }
  function renderDrawer() {
    const c = drawer.car; const body = $("#drawerBody");
    const cats = Array.from(new Set(["Hatchback", "Sedan", "SUV", "MUV", "Luxury", ...state.content.fleet.map((x) => x.category)].filter(Boolean)));
    const f = (key, label, o = {}) => `<div class="field ${o.full ? "field--full" : ""}"><label>${esc(label)}${o.help ? ` <small>${esc(o.help)}</small>` : ""}</label>${o.area ? `<textarea data-car="${key}" rows="${o.rows || 3}">${esc(c[key])}</textarea>` : `<input type="${o.type || "text"}" data-car="${key}" value="${esc(c[key])}" ${o.type === "number" ? 'min="0"' : ""} placeholder="${esc(o.placeholder || "")}" />`}</div>`;
    const sel = (key, label, opts) => `<div class="field"><label>${esc(label)}</label><select data-car="${key}">${opts.map((v) => `<option ${String(c[key]) === String(v) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>`;
    const tog = (key, label) => `<label class="switch"><input type="checkbox" data-car="${key}" data-type="bool" ${c[key] ? "checked" : ""} /><span class="track"></span><span>${esc(label)}</span></label>`;
    const tabs = `<div class="tabs">${[["details", "Details"], ["pricing", "Pricing & features"], ["photos", `Photos (${(c.images || []).length})`]].map(([k, l]) => `<button type="button" class="${drawer.tab === k ? "is-active" : ""}" data-tab="${k}">${esc(l)}</button>`).join("")}</div>`;
    let pane = "";
    if (drawer.tab === "details") pane = `<section class="card"><div class="grid grid--2">${f("name", "Car name", { placeholder: "Maruti Suzuki Swift", full: true })}${f("brand", "Brand", { placeholder: "Maruti Suzuki" })}<div class="field"><label>Category</label><input list="catList" data-car="category" value="${esc(c.category)}" /><datalist id="catList">${cats.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>${f("seats", "Seats", { type: "number" })}${sel("fuel", "Fuel", ["Petrol", "Diesel", "CNG", "Electric", "Hybrid"])}${sel("transmission", "Transmission", ["Manual", "Automatic"])}<div></div>${f("description", "Description", { area: true, full: true, rows: 3, help: "shown in the details popup" })}<div class="field--full" style="display:flex;gap:24px;flex-wrap:wrap">${tog("featured", "Mark as Popular (shown first)")}${tog("available", "Available for booking")}${tog("hidden", "Hide from website")}</div></div></section>`;
    if (drawer.tab === "pricing") pane = `<section class="card"><div class="grid grid--2">${f("pricePerDay", "Price per day (₹)", { type: "number" })}${f("kmPerDay", "Kilometres included per day", { type: "number" })}${f("extraKmCharge", "Extra km charge (₹ per km)", { type: "number" })}${f("deposit", "Refundable deposit (₹)", { type: "number" })}<div class="field field--full"><label>Features <small>one per line, shown as pills</small></label><textarea data-car="features" data-type="lines" rows="6">${esc((c.features || []).join("\n"))}</textarea></div></div></section>`;
    if (drawer.tab === "photos") pane = `<section class="card">
      <div class="dropzone" id="dropzone">${icon("upload")}<b>${online() ? "Drop photos here or click to upload" : "Uploads need the server (npm start)"}</b>JPG, PNG or WebP · resized automatically to 1600px</div>
      <div class="progress" id="uploadProgress" style="margin-top:10px" hidden><div></div></div>
      <div style="display:flex;gap:8px;margin:14px 0;flex-wrap:wrap"><button type="button" class="btn btn--light btn--sm" id="libBtn">${icon("image")} Add from photo library</button><button type="button" class="btn btn--light btn--sm" id="pathBtn">${icon("plus")} Add by file path</button><span style="color:var(--muted);font-size:13px;align-self:center">The first photo with the star is the cover shown on the card.</span></div>
      <div class="imggrid" id="imgGrid">${(c.images || []).map((src, i) => `<div class="imgtile ${src === c.cover ? "is-cover" : ""}">${src === c.cover ? `<span class="imgtile__cover">Cover</span>` : ""}<img src="${esc(src.replace(/(\d{2})\.jpg$/, "$1-sm.jpg"))}" onerror="this.onerror=null;this.src='${esc(src)}'" alt="" /><div class="imgtile__bar"><button type="button" data-img-cover="${i}" title="Set as cover">${icon("star")}</button><button type="button" data-img-move="${i}|-1" title="Move left" ${i === 0 ? "disabled" : ""}>${icon("chevron-left")}</button><button type="button" data-img-move="${i}|1" title="Move right" ${i === c.images.length - 1 ? "disabled" : ""}>${icon("chevron-right")}</button><button type="button" class="danger" data-img-remove="${i}" title="Remove">${icon("trash")}</button></div></div>`).join("") || `<p style="color:var(--muted);grid-column:1/-1">No photos yet. Upload some or pick from the library.</p>`}</div></section>`;
    body.innerHTML = tabs + pane; hydrateIcons(body);
    $$("[data-tab]", body).forEach((b) => (b.onclick = () => { drawer.tab = b.dataset.tab; renderDrawer(); }));
    $$("[data-car]", body).forEach((el) => { const h = () => { const k = el.dataset.car; const t = el.dataset.type || el.type; c[k] = t === "bool" ? el.checked : t === "number" ? Number(el.value) : t === "lines" ? el.value.split("\n").map((s) => s.trim()).filter(Boolean) : el.value; }; el.addEventListener("input", h); el.addEventListener("change", h); });
    $$("[data-img-cover]", body).forEach((b) => (b.onclick = () => { c.cover = c.images[+b.dataset.imgCover]; renderDrawer(); }));
    $$("[data-img-move]", body).forEach((b) => (b.onclick = () => { const [i, d] = b.dataset.imgMove.split("|").map(Number); [c.images[i], c.images[i + d]] = [c.images[i + d], c.images[i]]; renderDrawer(); }));
    $$("[data-img-remove]", body).forEach((b) => (b.onclick = () => { const removed = c.images.splice(+b.dataset.imgRemove, 1)[0]; if (c.cover === removed) c.cover = c.images[0] || ""; renderDrawer(); }));
    const dz = $("#dropzone");
    if (dz && online()) {
      dz.onclick = () => pickFiles(true, (files) => addUploads(files));
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("is-over"); }; dz.ondragleave = () => dz.classList.remove("is-over");
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("is-over"); addUploads(Array.from(e.dataTransfer.files)); };
    }
    const libBtn = $("#libBtn"); if (libBtn) libBtn.onclick = () => openLibrary({ single: false, exclude: c.images }, (paths) => { paths.forEach((p) => { if (!c.images.includes(p)) c.images.push(p); }); if (!c.cover && c.images[0]) c.cover = c.images[0]; renderDrawer(); });
    const pathBtn = $("#pathBtn"); if (pathBtn) pathBtn.onclick = () => { const p = prompt("Image path relative to the site folder, e.g. assets/img/cars/thar/01.jpg"); if (p && p.trim()) { c.images.push(p.trim()); if (!c.cover) c.cover = p.trim(); renderDrawer(); } };
    async function addUploads(files) {
      if (!files.length) return;
      const folder = slugify(c.id || c.name || "car");
      const paths = await uploadFiles(files, folder, (pct) => { const p = $("#uploadProgress"); if (p) { p.hidden = false; p.firstElementChild.style.width = pct + "%"; } });
      paths.forEach((p) => c.images.push(p)); if (!c.cover && c.images[0]) c.cover = c.images[0];
      renderDrawer();
    }
  }
  function commitDrawer() {
    const c = drawer.car;
    if (!c.name.trim()) { toast("Please give the car a name", "error"); drawer.tab = "details"; renderDrawer(); return; }
    if (!c.id) c.id = uniqueId(slugify(c.name));
    if (!c.cover && c.images.length) c.cover = c.images[0];
    if (drawer.index == null) state.content.fleet.push(c); else state.content.fleet[drawer.index] = c;
    markDirty(); closeDrawer(); go(state.section === "dashboard" ? "dashboard" : "fleet"); toast(drawer.index == null ? "Car added. Publish to make it live." : "Car updated. Publish to make it live.");
  }
  function bindDrawer() {
    $$("[data-drawer-close]").forEach((el) => (el.onclick = closeDrawer));
    $("#drawerDone").onclick = commitDrawer;
    $("#drawerDelete").onclick = () => { if (!confirm(`Delete "${drawer.car.name}" from the fleet? Photos stay on disk.`)) return; state.content.fleet.splice(drawer.index, 1); markDirty(); closeDrawer(); go("fleet"); toast("Car removed. Publish to update the site."); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("#libModal").classList.contains("is-open")) closeLibrary(); else if ($("#previewModal").classList.contains("is-open")) closePreview(); else if ($("#drawer").classList.contains("is-open")) closeDrawer(); } });
  }

  /* ---------- uploads ---------- */
  function pickFiles(multiple, cb) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = multiple; inp.onchange = () => cb(Array.from(inp.files)); inp.click(); }
  function resizeImage(file, max = 1600, quality = 0.84) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); let { width: w, height: h } = img; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s); const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(img, 0, 0, w, h); resolve(cv.toDataURL("image/jpeg", quality)); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read " + file.name)); };
      img.src = url;
    });
  }
  async function uploadFiles(files, folder, onProgress) {
    if (!online()) { toast("Uploads need the server. Run npm start.", "error"); return []; }
    const out = []; let n = 0;
    for (const f of files) {
      if (!f.type.startsWith("image/")) { n++; continue; }
      try { const data = await resizeImage(f); const d = await api("POST", "/api/upload", { name: f.name, data, folder }); out.push(d.path); } catch (e) { toast(e.message, "error"); }
      n++; if (onProgress) onProgress(Math.round((n / files.length) * 100));
    }
    if (out.length) toast(state.mode === "vercel" ? `${out.length} photo${out.length > 1 ? "s" : ""} committed to GitHub. They appear on the site after Vercel finishes deploying (about a minute).` : `${out.length} photo${out.length > 1 ? "s" : ""} uploaded`, "success");
    return out;
  }

  /* ---------- library modal ---------- */
  const lib = { all: [], selected: new Set(), single: false, cb: null };
  async function openLibrary(opts, cb) {
    lib.single = !!opts.single; lib.cb = cb; lib.selected = new Set();
    if (online()) { try { lib.all = (await api("GET", "/api/images")).images; } catch (e) { lib.all = []; } }
    else lib.all = Array.from(new Set(state.content.fleet.flatMap((x) => x.images || []).concat(state.content.hero.image ? [state.content.hero.image] : [])));
    lib.exclude = new Set(opts.exclude || []);
    $("#libSearch").value = ""; renderLib(); $("#libModal").classList.add("is-open");
  }
  function closeLibrary() { $("#libModal").classList.remove("is-open"); }
  function renderLib() {
    const q = $("#libSearch").value.toLowerCase(); const groups = {};
    lib.all.filter((p) => !lib.exclude.has(p) && p.toLowerCase().includes(q)).forEach((p) => { const folder = p.split("/").slice(2, -1).join("/") || "root"; (groups[folder] = groups[folder] || []).push(p); });
    $("#libGrid").innerHTML = Object.keys(groups).sort().map((g) => `<div class="lib__folder">${esc(g)} · ${groups[g].length}</div>` + groups[g].map((p) => `<button type="button" data-pick="${esc(p)}" class="${lib.selected.has(p) ? "is-selected" : ""}" title="${esc(p)}"><img src="${esc(p.replace(/(\d{2})\.jpg$/, "$1-sm.jpg"))}" loading="lazy" onerror="this.onerror=null;this.src='${esc(p)}'" alt="" /></button>`).join("")).join("") || `<p style="color:var(--muted);grid-column:1/-1">No photos found.</p>`;
    $("#libCount").textContent = lib.selected.size ? `${lib.selected.size} selected` : lib.single ? "Pick one photo" : "Pick one or more photos";
    $$("[data-pick]", $("#libGrid")).forEach((b) => (b.onclick = () => { const p = b.dataset.pick; if (lib.single) { lib.selected = new Set([p]); } else if (lib.selected.has(p)) lib.selected.delete(p); else lib.selected.add(p); renderLib(); }));
  }
  function bindLibrary() {
    $$("[data-lib-close]").forEach((el) => (el.onclick = closeLibrary));
    $("#libSearch").oninput = renderLib;
    $("#libUse").onclick = () => { const picked = Array.from(lib.selected); closeLibrary(); if (lib.cb) lib.cb(picked); };
  }

  /* ---------- preview ---------- */
  function openPreview() { const fr = $("#previewFrame"); fr.style.width = "100%"; if (!fr.src) fr.src = "index.html?preview=1"; else pushPreview(); $("#previewModal").classList.add("is-open"); }
  function closePreview() { $("#previewModal").classList.remove("is-open"); }
  function pushPreview() { const fr = $("#previewFrame"); if (fr && fr.contentWindow && $("#previewModal").classList.contains("is-open")) fr.contentWindow.postMessage({ type: "driveease:preview", content: state.content }, "*"); }
  function bindPreview() {
    $("#previewBtn").onclick = openPreview;
    $$("[data-preview-close]").forEach((el) => (el.onclick = closePreview));
    $("#previewFrame").onload = pushPreview;
    window.addEventListener("message", (e) => { if (e.data && e.data.type === "driveease:ready") pushPreview(); });
    $("#previewMobile").onclick = () => ($("#previewFrame").style.width = "390px");
    $("#previewDesktop").onclick = () => ($("#previewFrame").style.width = "100%");
  }

  /* ---------- save / export / import ---------- */
  async function save() {
    const btn = $("#saveBtn"); btn.disabled = true;
    try {
      if (online()) { const d = await api("PUT", "/api/content", state.content); state.saved = clone(state.content); state.savedAt = d.updatedAt; markDirty(); $("#savedAt").textContent = "Published " + new Date(d.updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); toast(state.mode === "vercel" ? "Published to GitHub. Vercel is deploying now, live in about a minute." : "Changes published to the live site", "success"); }
      else { exportJson(); toast("Static mode: content.json downloaded. Replace data/content.json to publish.", ""); }
    } catch (e) { toast(e.message, "error"); }
    btn.disabled = false;
  }
  function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function exportJson() { const json = JSON.stringify(state.content, null, 2); download("content.json", json + "\n", "application/json"); download("content.js", "window.SITE_CONTENT = " + json + ";\n", "application/javascript"); }
  function importJson(file) {
    const r = new FileReader();
    r.onload = () => { try { const c = JSON.parse(String(r.result).replace(/^\s*window\.SITE_CONTENT\s*=\s*/, "").replace(/;\s*$/, "")); if (!c.site || !Array.isArray(c.fleet)) throw new Error("This does not look like a DriveEase content file"); migrate(c); state.content = c; markDirty(); go(state.section); toast("Content imported. Review it, then publish.", "success"); } catch (e) { toast(e.message, "error"); } };
    r.readAsText(file);
  }

  function migrate(c) {
    if (!c.social) {
      const old = (c.site && c.site.social) || {};
      c.social = { showInHeader: true, showInFooter: true, showInContact: true, shareButtons: true,
        links: ["instagram", "facebook", "youtube"].map((k) => ({ platform: k, label: k[0].toUpperCase() + k.slice(1), url: old[k] || "", enabled: !!old[k] })),
        section: { enabled: false, eyebrow: "Follow us", title: "See the fleet in action", text: "", handle: "", ctaText: "Follow us", ctaLink: "", posts: [] } };
    }
    if (c.site) delete c.site.social;
    if (!c.promos) c.promos = { enabled: true, interval: 5, showArrows: true, showDots: true, pauseOnHover: true, items: [] };
    c.promos.items = c.promos.items || [];
    c.social.links = c.social.links || []; c.social.section = c.social.section || {}; c.social.section.posts = c.social.section.posts || [];
  }

  /* ---------- boot ---------- */
  async function boot() {
    try { state.content = await loadContent(); } catch (e) { toast(e.message, "error"); return; }
    migrate(state.content);
    state.saved = clone(state.content);
    if (online() && state.token) { try { const me = await api("GET", "/api/me"); state.defaultPassword = !!me.defaultPassword; } catch (e) { return; } }
    // restore draft?
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const d = JSON.parse(raw); if (JSON.stringify(d.content) !== JSON.stringify(state.saved) && confirm(`You have unsaved edits from ${new Date(d.at).toLocaleString("en-IN")}. Restore them?`)) state.content = d.content; else localStorage.removeItem(DRAFT_KEY); } } catch (e) { /* ignore */ }
    $("#login").hidden = true; $("#app").hidden = false;
    $("#sbBrand").innerHTML = `${esc(state.content.site.name)}<small>Admin panel</small>`;
    $("#sbMode").innerHTML = state.mode === "server" ? `<span class="dot"></span><span>Connected · one-click publish</span>` : state.mode === "vercel" ? `<span class="dot"></span><span>Vercel · publishes via GitHub</span>` : `<span class="dot off"></span><span>Static mode · export to publish</span>`;
    if (state.content.updatedAt) $("#savedAt").textContent = "Last published " + new Date(state.content.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    renderNav(); hydrateIcons(document);
    const hash = location.hash.slice(1); go(SECTIONS.some((s) => s.id === hash) ? hash : "dashboard"); markDirty();
  }
  async function init() {
    hydrateIcons(document);
    await detectMode();
    const lm = $("#loginMode");
    if (state.mode === "server") { lm.innerHTML = `<span class="dot"></span><span>Server connected. Default password is <b>admin123</b> until you change it.</span>`; }
    else if (state.mode === "vercel") { lm.innerHTML = state.configError ? `<span class="dot off"></span><span><b>Vercel setup incomplete.</b> ${esc(state.configError)}. Add them in Vercel → Project → Settings → Environment Variables, then redeploy.</span>` : `<span class="dot"></span><span>Hosted on Vercel. Sign in with the ADMIN_PASSWORD you set in Vercel. Changes are committed to GitHub and go live after a short deploy.</span>`; }
    else { lm.innerHTML = `<span class="dot off"></span><span>Static mode (no server). You can edit and export content.json, but nothing is password-protected.</span>`; $("#loginPw").placeholder = "No password needed in static mode"; $("#loginPw").disabled = true; $("#loginBtn").innerHTML = icon("edit") + " Open editor"; }
    $("#loginForm").onsubmit = async (e) => { e.preventDefault(); $("#loginErr").hidden = true; $("#loginBtn").disabled = true; try { await signIn($("#loginPw").value); } catch (err) { $("#loginErr").textContent = err.message; $("#loginErr").hidden = false; } $("#loginBtn").disabled = false; };
    $("#logoutBtn").onclick = () => { if (state.dirty && !confirm("You have unsaved changes. Sign out anyway?")) return; signOut(); };
    $("#saveBtn").onclick = save; $("#exportBtn").onclick = exportJson;
    $("#importBtn").onclick = () => $("#importFile").click(); $("#importFile").onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; };
    $("#menuBtn").onclick = () => $("#sidebar").classList.toggle("is-open");
    document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#app").hidden) { e.preventDefault(); save(); } });
    bindDrawer(); bindLibrary(); bindPreview();
    if (online() && state.token) { try { await boot(); } catch (e) { signOut(true); } }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
