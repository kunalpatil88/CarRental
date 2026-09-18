/* ============================================================
   DP Self Drive — public site
   Renders every section from data/content.json (edited in the admin).
   ============================================================ */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const params = new URLSearchParams(location.search);
  const isPreview = params.get("preview") === "1" && window.parent !== window;
  let previewTheme = isPreview && /^(light|dark)$/.test(params.get("theme") || "") ? params.get("theme") : "";
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { if (isPreview) return; try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  let C = null; // content
  const state = { cat: "", trans: "", fuel: "", sort: "rec", q: "", days: 0, pickup: "", ret: "" };
  const sheet = { car: null, idx: 0 };
  let firstRender = true;

  /* ---------- dates (local time; toISOString would give yesterday in IST before 05:30) ---------- */
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => { if (!a || !b) return 0; const d = Math.round((parse(b) - parse(a)) / 86400000); return d > 0 ? d : 0; };
  const fmtDate = (s, withYear) => (s ? parse(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }) : "");

  /* ---------- safe URLs: block javascript:/data: etc. from content ---------- */
  function safeUrl(u, fallback) {
    const s = String(u || "").trim();
    if (!s) return fallback || "#";
    if (/^(#|\/(?!\/)|\.\/|assets\/|tel:|mailto:|https?:\/\/)/i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
    return fallback || "#";
  }
  const safeImg = (u) => { const s = String(u || "").trim(); return /^(assets\/|\/|https:\/\/)/i.test(s) && !/["'()\\]/.test(s) ? s : ""; };
  const small = (src) => src.replace(/(\/\d{2})\.jpg$/i, "$1-sm.jpg");

  /* ---------- contact helpers ---------- */
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function waNumber() { let n = digits(C.site.whatsapp || C.site.phone); if (n.length === 10) n = "91" + n; if (n.length === 11 && n[0] === "0") n = "91" + n.slice(1); return n; }
  const waLink = (text) => `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`;
  const telLink = () => "tel:" + String(C.site.phone || "").replace(/[^\d+]/g, "");

  const PLATFORM_ICON = { x: "x-social", google: "google", instagram: "instagram", facebook: "facebook", youtube: "youtube", linkedin: "linkedin", threads: "threads", telegram: "telegram", whatsapp: "whatsapp", custom: "link" };
  const socialCfg = () => C.social || { links: [], showInFooter: true, shareButtons: true, section: { enabled: false } };
  const isPlaceholder = (u) => /^https?:\/\/(www\.)?(instagram|facebook|youtube|x|twitter)\.com\/?$/i.test(String(u || "").trim());
  const socialLinks = () => (socialCfg().links || []).filter((l) => l.enabled !== false && l.url && !isPlaceholder(l.url) && safeUrl(l.url) !== "#");
  const socialIcon = (l) => icon(PLATFORM_ICON[l.platform] || "link") || icon("link");
  const socialAnchor = (l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener" aria-label="${esc(l.label || l.platform)}" title="${esc(l.label || l.platform)}">${socialIcon(l)}</a>`;

  /* ---------- fleet helpers ---------- */
  const visibleFleet = () => (C.fleet || []).filter((c) => c && c.hidden !== true);
  const isBooked = (c) => c.available === false && (!c.bookedUntil || c.bookedUntil >= today());
  const nextFree = (c) => (isBooked(c) && c.bookedUntil ? addDays(c.bookedUntil, 1) : "");
  const categories = () => { const seen = []; visibleFleet().forEach((c) => { if (c.category && !seen.includes(c.category)) seen.push(c.category); }); return seen; };
  const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
  /* Best total for a trip: daily, or weekly/monthly bundles when the car has them */
  function tripPrice(c, days) {
    const daily = num(c.pricePerDay, 0);
    let best = daily * days;
    const wk = num(c.priceWeekly, 0), mo = num(c.priceMonthly, 0);
    if (wk && days >= 7) best = Math.min(best, Math.floor(days / 7) * wk + (days % 7) * daily, Math.ceil(days / 7) * wk);
    if (mo && days >= 30) best = Math.min(best, Math.floor(days / 30) * mo + (days % 30) * daily, Math.ceil(days / 30) * mo);
    return best;
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("is-visible"), 2800);
  }

  /* ============================================================
     Theme
     ============================================================ */
  const root = document.documentElement;
  const themeCfg = () => Object.assign({ mode: "auto", accent: "", allowToggle: true }, C && C.theme);
  function resolveTheme() {
    if (previewTheme) return previewTheme;
    const choice = store.get("dp-theme");
    if (choice === "light" || choice === "dark") return choice;
    const m = themeCfg().mode; if (m === "light" || m === "dark") return m;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(t, animate) {
    if (animate && !reduceMotion.matches) { root.classList.add("theme-switching"); setTimeout(() => root.classList.remove("theme-switching"), 50); }
    root.setAttribute("data-theme", t);
    const btn = $("#themeToggle"); if (btn) btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $$('meta[name="theme-color"]').forEach((m) => (m.content = t === "dark" ? "#0b0c0f" : "#f5f5f7"));
    renderThemeSwitch();
  }
  function setThemeChoice(choice) { store.set("dp-theme", choice === "auto" ? null : choice); applyTheme(resolveTheme(), true); }
  function renderThemeSwitch() {
    const box = $("#footTheme"); if (!box || !C) return;
    const cur = store.get("dp-theme") || "auto";
    box.innerHTML = [["light", "sun", "Light"], ["dark", "moon", "Dark"], ["auto", "gear", "Auto"]].map(([v, ic, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${cur === v}">${icon(ic)}${l}</button>`).join("");
    $$("[data-theme-set]", box).forEach((b) => (b.onclick = () => setThemeChoice(b.dataset.themeSet)));
  }
  function applyBrandTheme() {
    const t = themeCfg();
    const accent = /^#[0-9a-f]{6}$/i.test(t.accent || "") ? t.accent : "";
    if (accent) root.style.setProperty("--brand", accent); else root.style.removeProperty("--brand");
    store.set("dp-accent", accent || null);
    store.set("dp-theme-default", t.mode === "light" || t.mode === "dark" ? t.mode : null);
    const allow = t.allowToggle !== false;
    $("#themeToggle").hidden = !allow; $("#footTheme").hidden = !allow;
    applyTheme(resolveTheme());
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!store.get("dp-theme")) applyTheme(resolveTheme(), true); });

  /* ============================================================
     Content loading
     ============================================================ */
  async function loadContent() {
    try {
      const r = await fetch("data/content.json", { cache: "no-cache" });
      if (r.ok) return await r.json();
    } catch (e) { /* file:// or offline */ }
    if (!window.SITE_CONTENT) await new Promise((res) => { const s = document.createElement("script"); s.src = "data/content.js"; s.onload = s.onerror = res; document.head.appendChild(s); });
    if (window.SITE_CONTENT) return window.SITE_CONTENT;
    throw new Error("No content available");
  }

  /* ============================================================
     Global: brand, SEO, contact links, announcement
     ============================================================ */
  function renderGlobal() {
    const s = C.site, seo = C.seo || {};
    const name = s.name || "DP Self Drive";
    document.title = seo.title || `${name} · ${s.tagline || ""}`;
    setMeta("name", "description", seo.description); setMeta("name", "keywords", seo.keywords);
    setMeta("property", "og:title", seo.title || name); setMeta("property", "og:description", seo.description);
    setMeta("property", "og:site_name", name);
    const ogImg = safeImg(seo.image) || safeImg(C.hero && C.hero.image); if (ogImg) setMeta("property", "og:image", new URL(ogImg, location.href).href);

    const logo = safeImg(s.logo);
    $$("[data-brand-mark]").forEach((m) => { m.innerHTML = logo ? `<img src="${esc(logo)}" alt="" style="--logo-h:${num(s.logoHeight, 38)}px" />` : brandMark(38); });
    $$(".brand").forEach((b) => b.classList.toggle("brand--logo-only", !!logo && s.logoShowText === false));
    $$("[data-brand-name]").forEach((el) => (el.textContent = name));
    $$("[data-brand-sub]").forEach((el) => (el.textContent = s.tagline || ""));
    if (safeImg(s.favicon)) { const l = document.querySelector('link[rel="icon"]'); l.href = s.favicon; l.removeAttribute("type"); }

    const hello = generalMessage();
    ["#headerWa", "#dockWa", "#ctaWa", "#faqWa", "#heroSecondary"].forEach((id) => { const el = $(id); if (el) el.href = waLink(hello); });
    ["#headerCall", "#dockCall", "#ctaCall"].forEach((id) => { const el = $(id); if (el) el.href = telLink(); });
    $("#headerPhone").textContent = s.phone || ""; $("#headerCall").setAttribute("aria-label", "Call " + (s.phone || ""));
    $("#ctaPhone").textContent = s.phone ? "Call " + s.phone : "Call us";
    $("#menuSocial").innerHTML = socialLinks().map(socialAnchor).join("");

    const an = $("#announce"), key = "dp-announce:" + (s.announcement || "");
    let dismissed = false; try { dismissed = sessionStorage.getItem(key) === "1"; } catch (e) { /* ignore */ }
    an.hidden = !(s.announcementEnabled && s.announcement && !dismissed);
    $("#announceText").textContent = s.announcement || "";
    $("#announceClose").onclick = () => { an.hidden = true; try { sessionStorage.setItem(key, "1"); } catch (e) { /* ignore */ } };
  }
  function setMeta(attr, key, content) {
    if (!content) return; let m = document.querySelector(`meta[${attr}="${key}"]`);
    if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.appendChild(m); } m.content = content;
  }
  function renderJsonLd() {
    const s = C.site, links = socialLinks().map((l) => l.url);
    const fleet = visibleFleet(); const prices = fleet.map((c) => num(c.pricePerDay, 0)).filter(Boolean);
    const data = {
      "@context": "https://schema.org", "@type": "AutoRental", name: s.name, description: (C.seo || {}).description, telephone: s.phone, email: s.email,
      url: location.origin + location.pathname, image: new URL(safeImg(C.hero.image) || "assets/img/logo.svg", location.href).href, logo: new URL("assets/img/logo.svg", location.href).href,
      address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: s.city || "Pune", addressRegion: "Maharashtra", addressCountry: "IN" },
      priceRange: prices.length ? `${inr(Math.min(...prices))} - ${inr(Math.max(...prices))} per day` : undefined,
      openingHoursSpecification: /24\s*x\s*7|24\/7/i.test(s.hours || "") ? { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: "00:00", closes: "23:59" } : undefined,
      sameAs: links.length ? links : undefined,
      makesOffer: fleet.slice(0, 30).map((c) => ({ "@type": "Offer", name: c.name, price: num(c.pricePerDay, 0), priceCurrency: "INR", availability: isBooked(c) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" })),
    };
    const faq = (C.faq && C.faq.items) || [];
    const graph = [data];
    if (faq.length) graph.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
    let el = $("#ld"); if (!el) { el = document.createElement("script"); el.type = "application/ld+json"; el.id = "ld"; document.head.appendChild(el); }
    el.textContent = JSON.stringify(graph).replace(/</g, "\\u003c");
  }

  /* ============================================================
     Hero + booking widget
     ============================================================ */
  function renderHero() {
    const h = C.hero || {};
    const img = $("#heroImage"), src = safeImg(h.image);
    if (src && img.getAttribute("src") !== src) {
      const sm = small(src);
      img.removeAttribute("srcset"); img.src = src;
      if (sm !== src) { img.srcset = `${sm} 720w, ${src} 1400w`; img.sizes = "100vw"; }
    }
    img.alt = (C.site.name || "") + " self-drive car";
    $("#heroEyebrow").textContent = h.eyebrow || ""; $(".hero__eyebrow").hidden = !h.eyebrow;
    $("#heroTitle").textContent = h.title || ""; $("#heroHighlight").textContent = h.titleHighlight || "";
    $("#heroSubtitle").textContent = h.subtitle || "";
    $("#heroPrimaryText").textContent = h.primaryCta || "Explore the fleet"; $("#heroPrimary").href = safeUrl(h.primaryLink, "#fleet");
    $("#heroSecondaryText").textContent = h.secondaryCta || "Chat on WhatsApp";
    $("#heroBadges").innerHTML = (h.badges || []).map((b) => `<li>${icon("check-circle")}${esc(b)}</li>`).join("");

    const sel = $("#bkType"), cur = sel.value;
    sel.innerHTML = `<option value="">Any car</option>` + categories().map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
    const km = num((visibleFleet()[0] || {}).kmPerDay, 300);
    $("#bookingHint").textContent = `Free cancellation up to 24 hours before pickup · ${km} km/day included`;
    const pk = $("#bkPickup"), rt = $("#bkReturn"), t = today();
    pk.min = t; if (!pk.value || pk.value < t) pk.value = t;
    rt.min = addDays(pk.value, 1); if (!rt.value || rt.value < rt.min) rt.value = rt.min;
    pk.onchange = () => { if (!pk.value) return; rt.min = addDays(pk.value, 1); if (!rt.value || rt.value < rt.min) rt.value = rt.min; };
    $("#bookingForm").onsubmit = (e) => {
      e.preventDefault();
      const d = daysBetween(pk.value, rt.value);
      if (!pk.value || !rt.value || d < 1) { toast("Please choose a valid pickup and return date."); return; }
      setDates(pk.value, rt.value); state.cat = sel.value;
      renderChips(); renderFleet(true);
      $("#fleet").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
    };
  }
  function setDates(p, r) {
    state.pickup = p; state.ret = r; state.days = daysBetween(p, r);
    ["#cfPickup", "#bkPickup"].forEach((id) => ($(id).value = p)); ["#cfReturn", "#bkReturn"].forEach((id) => ($(id).value = r));
  }

  /* ============================================================
     Stats
     ============================================================ */
  function renderStats() {
    const st = C.stats || [];
    $(".stats").hidden = !st.length;
    $("#stats").innerHTML = st.map((s) => `<div class="stat"><div class="stat__value">${esc(s.value)}</div><div class="stat__label">${esc(s.label)}</div></div>`).join("");
    $("#stats").style.gridTemplateColumns = st.length && st.length < 4 && innerWidth > 960 ? `repeat(${st.length}, 1fr)` : "";
  }

  /* ============================================================
     Offers carousel
     ============================================================ */
  const promo = { idx: 0, timer: null, count: 0, visible: true, paused: false };
  function activePromos() {
    const p = C.promos || {}; if (!p.enabled) return [];
    const t = today();
    return (p.items || []).filter((it) => it.enabled !== false && safeImg(it.image) && (!it.startDate || it.startDate <= t) && (!it.endDate || it.endDate >= t));
  }
  function renderPromos() {
    const items = activePromos(), sec = $("#promos"), p = C.promos || {};
    sec.hidden = !items.length; stopPromo(); if (!items.length) return;
    const isAction = (l) => l && l !== "#";
    $("#promosTrack").innerHTML = items.map((it, i) => {
      const link = safeUrl(it.link, ""), img = safeImg(it.image), tag = isAction(link) ? "a" : "div", ext = /^https?:/i.test(link);
      const cta = it.ctaText && isAction(link) ? `<span class="btn btn--primary btn--sm">${esc(it.ctaText)}</span>` : "";
      const cap = it.caption || it.text || cta ? `<div class="promo__caption"><div>${it.caption ? `<h3>${esc(it.caption)}</h3>` : ""}${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>${cta}</div>` : "";
      return `<${tag} class="promo ${it.fit === "cover" ? "promo--cover" : ""}" data-fit="${esc(it.fit || "auto")}" role="group" aria-roledescription="slide" aria-label="${esc((i + 1) + " of " + items.length + (it.title ? ": " + it.title : ""))}" ${tag === "a" ? `href="${esc(link)}" ${ext ? 'target="_blank" rel="noopener"' : ""}` : ""}><div class="promo__bg" style="background-image:url(&quot;${esc(img)}&quot;)"></div><img class="promo__img" src="${esc(img)}" alt="${esc(it.title || "")}" loading="${i ? "lazy" : "eager"}" decoding="async" />${cap}</${tag}>`;
    }).join("");
    $$(".promo[data-fit='auto'] .promo__img").forEach((img) => { const apply = () => { const box = img.closest(".promo"), r = img.naturalWidth / img.naturalHeight, f = box.clientWidth / box.clientHeight; box.classList.toggle("promo--cover", Math.abs(r - f) / f < 0.12); }; if (img.complete) apply(); else img.addEventListener("load", apply, { once: true }); });
    const frame = $(".promos__frame"); frame.classList.toggle("promos--single", items.length < 2);
    $("#promosDots").innerHTML = p.showDots === false ? "" : items.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Go to offer ${i + 1}"></button>`).join("");
    $("#promosPrev").hidden = $("#promosNext").hidden = p.showArrows === false;
    promo.count = items.length; promo.idx = 0; syncDots();
    $$("[data-dot]").forEach((b) => (b.onclick = () => goPromo(+b.dataset.dot, true)));
    $("#promosPrev").onclick = () => goPromo(promo.idx - 1, true); $("#promosNext").onclick = () => goPromo(promo.idx + 1, true);
    const track = $("#promosTrack"); let st;
    track.onscroll = () => { clearTimeout(st); st = setTimeout(() => { promo.idx = nearestSlide(track); syncDots(); }, 90); };
    $$("a.promo", track).forEach((a) => (a.onclick = (e) => { const h = a.getAttribute("href"); if (h.startsWith("#car-")) { e.preventDefault(); openCar(h.slice(5)); } }));
    const pause = (v) => () => { promo.paused = v; v ? stopPromo() : startPromo(); };
    frame.onmouseenter = p.pauseOnHover !== false ? pause(true) : null; frame.onmouseleave = p.pauseOnHover !== false ? pause(false) : null;
    frame.ontouchstart = pause(true); frame.ontouchend = () => setTimeout(pause(false), 4000);
    frame.onfocusin = pause(true); frame.onfocusout = pause(false);
    if (!promo.io) { promo.io = new IntersectionObserver(([en]) => { promo.visible = en.isIntersecting; promo.visible ? startPromo() : stopPromo(); }); promo.io.observe(sec); }
    startPromo();
  }
  function nearestSlide(track) { const slides = track.children; let best = 0, dist = Infinity; for (let i = 0; i < slides.length; i++) { const d = Math.abs(slides[i].offsetLeft - track.offsetLeft - track.scrollLeft - (track.clientWidth - slides[i].clientWidth) / 2); if (d < dist) { dist = d; best = i; } } return best; }
  function startPromo() {
    stopPromo();
    if (promo.count < 2 || promo.paused || !promo.visible || document.hidden || reduceMotion.matches) return;
    const secs = Math.max(2, num((C.promos || {}).interval, 5));
    promo.timer = setInterval(() => goPromo(promo.idx + 1), secs * 1000);
  }
  function stopPromo() { clearInterval(promo.timer); promo.timer = null; }
  function goPromo(i, user) {
    const track = $("#promosTrack"); if (!promo.count) return;
    promo.idx = (i + promo.count) % promo.count; const s = track.children[promo.idx];
    track.scrollTo({ left: s.offsetLeft - track.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: reduceMotion.matches ? "auto" : "smooth" });
    syncDots(); if (user) startPromo();
  }
  function syncDots() { $$("[data-dot]").forEach((b) => { const on = +b.dataset.dot === promo.idx; b.classList.toggle("is-active", on); b.setAttribute("aria-current", on); }); }
  document.addEventListener("visibilitychange", () => (document.hidden ? stopPromo() : startPromo()));

  /* ============================================================
     Fleet
     ============================================================ */
  function renderChips() {
    const cats = categories(), all = visibleFleet();
    if (state.cat && !cats.includes(state.cat)) state.cat = "";
    const chip = (v, label, n) => `<button type="button" role="tab" aria-selected="${state.cat === v}" data-cat="${esc(v)}">${esc(label)}<span class="count">${n}</span></button>`;
    $("#fleetChips").innerHTML = chip("", "All", all.length) + cats.map((c) => chip(c, c, all.filter((x) => x.category === c).length)).join("");
    $$("#fleetChips button").forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; renderChips(); renderFleet(true); b.scrollIntoView({ block: "nearest", inline: "nearest" }); }));
    const fuels = Array.from(new Set(all.map((c) => c.fuel).filter(Boolean)));
    const fs = $("#fltFuel"); fs.innerHTML = `<option value="">Any fuel</option>` + fuels.map((f) => `<option ${f === state.fuel ? "selected" : ""}>${esc(f)}</option>`).join("");
  }

  function filteredFleet() {
    const list = visibleFleet().filter((c) =>
      (!state.cat || c.category === state.cat) && (!state.trans || c.transmission === state.trans) && (!state.fuel || c.fuel === state.fuel) &&
      (!state.q || [c.name, c.brand, c.category, c.fuel, c.transmission].join(" ").toLowerCase().includes(state.q)));
    const price = (c) => num(c.pricePerDay, 0);
    if (state.sort === "asc") list.sort((a, b) => price(a) - price(b));
    else if (state.sort === "desc") list.sort((a, b) => price(b) - price(a));
    else if (state.sort === "seats") list.sort((a, b) => num(b.seats, 0) - num(a.seats, 0));
    else list.sort((a, b) => (isBooked(a) - isBooked(b)) || ((b.featured === true) - (a.featured === true)));
    return list;
  }

  function carCard(c, i) {
    const cover = safeImg(c.cover || (c.images && c.images[0]));
    const booked = isBooked(c), free = nextFree(c);
    const est = state.days ? `<span class="price__est">${inr(tripPrice(c, state.days))} for ${plural(state.days, "day")}</span>` : num(c.priceWeekly, 0) ? `<span class="price__note">Weekly deals available</span>` : "";
    const photos = (c.images || []).length;
    return `<article class="car ${booked ? "is-unavailable" : ""}" data-id="${esc(c.id)}">
      <button type="button" class="car__media" data-open="${esc(c.id)}" aria-label="View ${esc(c.name)} photos and details">
        ${cover ? `<img src="${esc(small(cover))}" data-full="${esc(cover)}" alt="${esc(c.name)}" loading="${i < 3 ? "eager" : "lazy"}" decoding="async" width="720" height="450" />` : ""}
        <span class="car__tags">${c.featured ? `<span class="tag tag--accent">Popular</span>` : ""}${booked ? `<span class="tag tag--muted">${free ? "Free from " + esc(fmtDate(free)) : "Booked"}</span>` : ""}<span class="tag">${esc(c.transmission)}</span></span>
        ${photos > 1 ? `<span class="car__photos">${icon("camera")}${photos}</span>` : ""}
      </button>
      <div class="car__body">
        <div><h3 class="car__name"><button type="button" data-open="${esc(c.id)}">${esc(c.name)}</button></h3><p class="car__cat">${esc(c.category)} · ${esc(c.brand)}</p></div>
        <ul class="car__specs">
          <li>${icon("users")}${esc(c.seats)} seats</li>
          <li>${icon("fuel")}${esc(c.fuel)}</li>
          <li>${icon("road")}${esc(num(c.kmPerDay, 300))} km/day</li>
        </ul>
        <div class="car__foot">
          <div class="price"><span class="price__amount">${inr(c.pricePerDay)}</span><span class="price__unit"> /day</span>${est}</div>
          <div class="car__actions">
            <button type="button" class="btn btn--wa btn--sm" data-open="${esc(c.id)}" data-book="1" aria-label="Book ${esc(c.name)}">${icon("whatsapp")}${booked ? "Enquire" : "Book"}</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  /* ---------- WhatsApp messages (WhatsApp formatting: *bold*, _italic_) ---------- */
  const fmtLong = (s) => { const d = parse(s); return `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[d.getDay()]}, ${d.getDate()} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()]} ${d.getFullYear()}`; };
  function generalMessage() {
    return `Hello ${C.site.name},\n\nI would like to enquire about renting a self-drive car. Kindly share the available cars and rates.\n\nThank you.`;
  }
  function bookingMessage({ car, pickup, ret, name, phone, note, ref }) {
    const d = daysBetween(pickup, ret), L = [];
    L.push(`Hello ${C.site.name},`, "", "I would like to book a self-drive car. My booking details are below.", "");
    L.push(`*BOOKING ENQUIRY*${ref ? `  |  Ref: ${ref}` : ""}`, "━━━━━━━━━━━━━━━━");
    if (car) {
      L.push(`*Car:* ${car.name}`, `*Type:* ${[car.category, car.transmission, car.fuel].filter(Boolean).join(" · ")}`);
      // WhatsApp turns this link into the car's photo thumbnail (served by /car/<id>, see lib/carpage.js)
      if (/^https?:$/.test(location.protocol)) L.push(`*Photo:* ${location.origin}/car/${encodeURIComponent(car.id)}`);
    } else L.push("*Car:* Not decided yet, please suggest options");
    if (pickup) L.push(`*Pickup:* ${fmtLong(pickup)}`);
    if (ret) L.push(`*Return:* ${fmtLong(ret)}`);
    if (d) L.push(`*Duration:* ${plural(d, "day")}`);
    if (car && d) {
      L.push(`*Estimated rent:* ${inr(tripPrice(car, d))}`);
      L.push(`_${inr(car.pricePerDay)}/day · ${num(car.kmPerDay, 300)} km/day included${num(car.deposit, 0) ? ` · Refundable deposit ${inr(car.deposit)}` : ""}_`);
    } else if (car) L.push(`*Rate:* ${inr(car.pricePerDay)}/day`);
    L.push("");
    if (name) L.push(`*Name:* ${name}`);
    if (phone) L.push(`*Mobile:* ${phone}`);
    if (note) L.push(`*Note:* ${note}`);
    L.push("", "Kindly confirm availability and share the next steps.", "", "Thank you.");
    return L.join("\n");
  }
  const newRef = () => { const d = new Date(); return `DP-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X")}`; };
  const visitor = {
    get() { try { return JSON.parse(store.get("dp-visitor") || "{}"); } catch (e) { return {}; } },
    set(name, phone) { store.set("dp-visitor", JSON.stringify({ name, phone })); },
  };
  /* Saved to the owner's enquiry log (Admin → Enquiries). Fire-and-forget: WhatsApp opens either way. */
  function recordEnquiry(data) {
    if (isPreview || location.protocol === "file:") return;
    try { fetch("api/enquiry", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).catch(() => {}); } catch (e) { /* offline */ }
  }

  function renderFleet(animate) {
    const list = filteredFleet(), grid = $("#fleetGrid");
    grid.innerHTML = list.length ? list.map(carCard).join("") : `<div class="fleet-empty"><h3>No cars match those filters</h3><p>Try a different type or clear the search.</p><button type="button" class="btn btn--line" id="clearFilters">Clear filters</button></div>`;
    const clr = $("#clearFilters"); if (clr) clr.onclick = clearFilters;
    grid.classList.remove("is-swapping"); if (animate && !reduceMotion.matches) { void grid.offsetWidth; grid.classList.add("is-swapping"); }
    $$("img[data-full]", grid).forEach((im) => im.addEventListener("error", () => { if (im.src !== new URL(im.dataset.full, location.href).href) im.src = im.dataset.full; }, { once: true }));
    const total = visibleFleet().length;
    $("#fleetCount").textContent = list.length === total ? `${plural(total, "car")} available to book` : `Showing ${list.length} of ${plural(total, "car")}`;
    const chip = $("#dateChip");
    chip.hidden = !state.days;
    if (state.days) $("#dateChipText").textContent = `${fmtDate(state.pickup)} – ${fmtDate(state.ret)} · ${plural(state.days, "day")}`;
    chip.setAttribute("aria-label", `Clear dates ${$("#dateChipText").textContent}`);
    $("#filtersBadge").hidden = !(state.trans || state.fuel || state.q || state.sort !== "rec");
    $("#fleetText").textContent = `Every car is serviced, insured and sanitised before handover. Prices include ${num((visibleFleet()[0] || {}).kmPerDay, 300)} km per day.`;
  }
  function clearFilters() {
    Object.assign(state, { cat: "", trans: "", fuel: "", sort: "rec", q: "" });
    $("#fltTrans").value = ""; $("#fltFuel").value = ""; $("#fltSort").value = "rec"; $("#fltSearch").value = "";
    renderChips(); renderFleet(true);
  }

  function bindFleetControls() {
    $("#fleetGrid").addEventListener("click", (e) => { const t = e.target.closest("[data-open]"); if (t) openCar(t.dataset.open, t, false, !!t.dataset.book); });
    $("#fltTrans").onchange = (e) => { state.trans = e.target.value; renderFleet(true); };
    $("#fltFuel").onchange = (e) => { state.fuel = e.target.value; renderFleet(true); };
    $("#fltSort").onchange = (e) => { state.sort = e.target.value; renderFleet(true); };
    let t; $("#fltSearch").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); renderFleet(); }, 140); };
    $("#dateChip").onclick = () => { state.days = 0; state.pickup = state.ret = ""; renderFleet(true); };
    const bar = $("#filterbar"), btn = $("#filtersBtn");
    btn.onclick = () => { const open = !bar.classList.contains("is-expanded"); bar.classList.toggle("is-expanded", open); btn.setAttribute("aria-expanded", open); if (open && innerWidth > 960) $("#fltSearch").focus({ preventScroll: true }); };
  }

  /* ============================================================
     Car sheet (native <dialog>, history-aware, swipe to close)
     ============================================================ */
  const dlg = () => $("#carSheet");
  let opener = null;
  function openCar(id, from, fromHistory, toBooking) {
    const c = visibleFleet().find((x) => x.id === id); if (!c) return;
    opener = from || document.activeElement;
    sheet.car = c; sheet.idx = Math.max(0, (c.images || []).indexOf(c.cover));
    renderGallery(true); renderDetail(c);
    const d = dlg();
    if (!d.open) { d.classList.remove("is-closing"); d.showModal(); }
    $("#sheetScroll").scrollTop = 0;
    if (toBooking) requestAnimationFrame(() => { const b = $(".detail__dates"); if (b) b.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" }); });
    if (!fromHistory) {
      if (history.state && history.state.car) history.replaceState({ car: c.id }, "", "#car-" + c.id);
      else history.pushState({ car: c.id }, "", "#car-" + c.id);
    }
  }
  function renderDetail(c) {
    const booked = isBooked(c), free = nextFree(c);
    const pickup = state.pickup || today(), ret = state.ret || addDays(pickup, 1);
    const rows = [["Rental per day", inr(c.pricePerDay), true]];
    if (num(c.priceWeekly, 0)) rows.push(["Weekly (7 days)", inr(c.priceWeekly)]);
    if (num(c.priceMonthly, 0)) rows.push(["Monthly (30 days)", inr(c.priceMonthly)]);
    rows.push(["Kilometres included", `${num(c.kmPerDay, 300)} km / day`], ["Extra km charge", `${inr(c.extraKmCharge)} / km`], ["Refundable deposit", inr(c.deposit)]);
    $("#detail").innerHTML = `
      <div><p class="detail__cat">${esc(c.category)} · ${esc(c.brand)}</p><h2 class="detail__name" id="detailName">${esc(c.name)}</h2>${c.description ? `<p class="detail__desc">${esc(c.description)}</p>` : ""}</div>
      ${booked ? `<div class="notice notice--warn">${free ? `Booked right now. Available again from ${esc(fmtDate(free, true))}.` : "This car is currently booked. Message us for the next available date."}</div>` : ""}
      <div class="spec-grid">
        <div class="spec">${icon("users")}<div><small>Seating</small><b>${esc(c.seats)} seats</b></div></div>
        <div class="spec">${icon("gear")}<div><small>Gearbox</small><b>${esc(c.transmission)}</b></div></div>
        <div class="spec">${icon("fuel")}<div><small>Fuel</small><b>${esc(c.fuel)}</b></div></div>
        <div class="spec">${icon("road")}<div><small>Included</small><b>${esc(num(c.kmPerDay, 300))} km / day</b></div></div>
      </div>
      <div class="price-table">${rows.map(([l, v, main]) => `<div class="${main ? "is-main" : ""}"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("")}</div>
      ${(c.features || []).length ? `<ul class="feature-pills">${c.features.map((f) => `<li>${icon("check")}${esc(f)}</li>`).join("")}</ul>` : ""}
      <div class="detail__dates"><h4>Booking details</h4><div class="booking__fields">
        <label class="pill-field"><span>Pickup</span><input type="date" id="dtPickup" min="${today()}" value="${esc(pickup)}" /></label>
        <label class="pill-field"><span>Return</span><input type="date" id="dtReturn" min="${addDays(pickup, 1)}" value="${esc(ret)}" /></label>
        <label class="pill-field"><span>Your name</span><input id="dtName" autocomplete="name" placeholder="Full name" value="${esc(visitor.get().name || "")}" /></label>
        <label class="pill-field"><span>Mobile number</span><input id="dtPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="10-digit mobile" value="${esc(visitor.get().phone || "")}" /></label>
      </div><p class="detail__privacy">We use these only to confirm your booking.</p></div>
      ${socialCfg().shareButtons !== false ? shareBar(c) : ""}`;
    $("#sheetFooter").innerHTML = `<div class="sheet__total"><small id="dtSummary"></small><b id="dtTotal"></b></div>
      <div class="sheet__actions"><a class="btn btn--line btn--icon-sm" href="${telLink()}" aria-label="Call">${icon("phone")}</a><a class="btn btn--wa" id="dtBook" href="#" target="_blank" rel="noopener">${icon("whatsapp")}${booked ? "Ask on WhatsApp" : "Book on WhatsApp"}</a></div>`;
    const read = () => ({ p: $("#dtPickup").value, r: $("#dtReturn").value, name: $("#dtName").value.trim(), phone: $("#dtPhone").value.trim() });
    const calc = () => {
      const { p, r } = read();
      if (p) { $("#dtReturn").min = addDays(p, 1); if (r && r <= p) $("#dtReturn").value = addDays(p, 1); }
      const v = read(), d = daysBetween(v.p, v.r);
      $("#dtSummary").textContent = d ? `${plural(d, "day")} · ${fmtDate(v.p)}–${fmtDate(v.r)}` : "Pick your dates";
      $("#dtTotal").textContent = d ? inr(tripPrice(c, d)) : inr(c.pricePerDay) + " /day";
      $("#dtBook").href = waLink(bookingMessage({ car: c, pickup: v.p, ret: v.r, name: v.name, phone: v.phone }));
    };
    ["#dtPickup", "#dtReturn"].forEach((id) => ($(id).onchange = calc));
    ["#dtName", "#dtPhone"].forEach((id) => ($(id).oninput = () => { $(id).closest(".pill-field").classList.remove("is-invalid"); calc(); }));
    calc();
    $("#dtBook").onclick = (e) => {
      const v = read(), d = daysBetween(v.p, v.r);
      const badName = v.name.length < 2, badPhone = digits(v.phone).length < 10;
      $("#dtName").closest(".pill-field").classList.toggle("is-invalid", badName);
      $("#dtPhone").closest(".pill-field").classList.toggle("is-invalid", badPhone);
      if (badName || badPhone || !d) {
        e.preventDefault();
        toast(!d ? "Please choose your pickup and return dates." : "Please add your name and mobile number so we can confirm your booking.");
        const target = !d ? $("#dtPickup") : badName ? $("#dtName") : $("#dtPhone");
        target.closest(".detail__dates").scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => target.focus({ preventScroll: true }), 250);
        return;
      }
      // The reference ties the WhatsApp chat to the saved enquiry
      const ref = newRef();
      $("#dtBook").href = waLink(bookingMessage({ car: c, pickup: v.p, ret: v.r, name: v.name, phone: v.phone, ref }));
      recordEnquiry({ ref, source: "car", name: v.name, phone: v.phone, carId: c.id, carName: c.name, pickup: v.p, return: v.r, days: d, pricePerDay: num(c.pricePerDay, 0), estimate: tripPrice(c, d), website: "" });
      visitor.set(v.name, v.phone); setDates(v.p, v.r); renderFleet();
    };
    $$("[data-copy]", $("#detail")).forEach((b) => (b.onclick = async () => {
      const url = b.dataset.copy;
      try { if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title: c.name, url }); return; } await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { /* cancelled */ }
    }));
  }
  function shareBar(c) {
    const url = location.origin + location.pathname + "#car-" + c.id, text = `${c.name} on rent, ${inr(c.pricePerDay)}/day at ${C.site.name}`;
    return `<div class="share">Share
      <a href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">${icon("whatsapp")}</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener" aria-label="Share on Facebook">${icon("facebook")}</a>
      <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener" aria-label="Share on X">${icon("x-social")}</a>
      <button type="button" data-copy="${esc(url)}" aria-label="Copy link">${icon("copy")}</button></div>`;
  }
  function closeCar(fromHistory) {
    const d = dlg(); if (!d.open || d.classList.contains("is-closing")) return;
    if (!fromHistory && history.state && history.state.car) { history.back(); return; } // popstate closes it
    const finish = () => { d.classList.remove("is-closing"); d.close(); $("#sheetScroll").style.transform = ""; if (opener && opener.focus) opener.focus({ preventScroll: true }); };
    if (reduceMotion.matches) finish(); else { d.classList.add("is-closing"); setTimeout(finish, 260); }
    if (!fromHistory && location.hash.startsWith("#car-")) history.replaceState(null, "", location.pathname + location.search);
  }

  function renderGallery(reset) {
    const imgs = (sheet.car.images || []).map(safeImg).filter(Boolean); const n = imgs.length;
    const track = $("#galTrack");
    if (reset) {
      track.innerHTML = imgs.map((s, i) => `<img src="${esc(i === sheet.idx ? s : small(s))}" data-src="${esc(s)}" alt="${esc(sheet.car.name)} photo ${i + 1}" loading="${Math.abs(i - sheet.idx) < 2 ? "eager" : "lazy"}" decoding="async" />`).join("");
      $("#galThumbs").innerHTML = imgs.map((s, i) => `<button type="button" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(small(s))}" alt="" loading="lazy" /></button>`).join("");
      $$("#galThumbs img, #galTrack img").forEach((im) => im.addEventListener("error", () => { const full = im.dataset.src || im.closest("button") && imgs[+im.closest("button").dataset.i]; if (full && !im.src.endsWith(full)) im.src = full; }, { once: true }));
      $$("#galThumbs button").forEach((b) => (b.onclick = () => galGo(+b.dataset.i)));
      let dots = $(".gallery__dots"); if (!dots) { dots = document.createElement("div"); dots.className = "gallery__dots"; $(".gallery").appendChild(dots); }
      dots.innerHTML = n > 1 && n <= 20 ? imgs.map(() => "<i></i>").join("") : "";
      requestAnimationFrame(() => (track.scrollLeft = sheet.idx * track.clientWidth));
    }
    $("#galCounter").textContent = n ? `${sheet.idx + 1} / ${n}` : "";
    $("#galPrev").hidden = $("#galNext").hidden = n < 2;
    $$("#galThumbs button").forEach((b, i) => b.classList.toggle("is-active", i === sheet.idx));
    $$(".gallery__dots i").forEach((d, i) => d.classList.toggle("is-active", i === sheet.idx));
    const act = $("#galThumbs .is-active"); if (act) { const box = $("#galThumbs"); box.scrollTo({ left: act.offsetLeft - box.clientWidth / 2 + act.clientWidth / 2, behavior: "smooth" }); }
    // upgrade the visible photo to full resolution
    const cur = track.children[sheet.idx]; if (cur && cur.dataset.src && !cur.src.endsWith(cur.dataset.src)) cur.src = cur.dataset.src;
  }
  function galGo(i) {
    const n = (sheet.car.images || []).length; if (!n) return;
    sheet.idx = (i + n) % n; const track = $("#galTrack");
    track.scrollTo({ left: sheet.idx * track.clientWidth, behavior: reduceMotion.matches ? "auto" : "smooth" });
    renderGallery(); if ($("#lightbox").open) $("#lbImg").src = track.children[sheet.idx].dataset.src;
  }
  function bindSheet() {
    const d = dlg();
    $$("[data-close]", d).forEach((el) => (el.onclick = () => closeCar()));
    d.addEventListener("cancel", (e) => { e.preventDefault(); closeCar(); });
    d.addEventListener("click", (e) => { if (e.target === d) closeCar(); }); // backdrop
    $("#galPrev").onclick = () => galGo(sheet.idx - 1); $("#galNext").onclick = () => galGo(sheet.idx + 1);
    const track = $("#galTrack"); let st;
    track.addEventListener("scroll", () => { clearTimeout(st); st = setTimeout(() => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i !== sheet.idx) { sheet.idx = i; renderGallery(); } }, 80); }, { passive: true });
    track.addEventListener("click", (e) => { const im = e.target.closest("img"); if (!im) return; $("#lbImg").src = im.dataset.src; $("#lbImg").alt = im.alt; $("#lightbox").showModal(); });
    d.addEventListener("keydown", (e) => {
      if ($("#lightbox").open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") galGo(sheet.idx - 1); if (e.key === "ArrowRight") galGo(sheet.idx + 1);
    });
    // Lightbox
    const lb = $("#lightbox");
    $("#lbClose").onclick = () => lb.close(); lb.addEventListener("click", (e) => { if (e.target === lb) lb.close(); });
    $("#lbPrev").onclick = () => galGo(sheet.idx - 1); $("#lbNext").onclick = () => galGo(sheet.idx + 1);
    lb.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") galGo(sheet.idx - 1); if (e.key === "ArrowRight") galGo(sheet.idx + 1); });
    let lx = null; lb.addEventListener("touchstart", (e) => (lx = e.touches[0].clientX), { passive: true });
    lb.addEventListener("touchend", (e) => { if (lx == null) return; const dx = e.changedTouches[0].clientX - lx; if (Math.abs(dx) > 50) galGo(sheet.idx + (dx < 0 ? 1 : -1)); lx = null; });
    // Swipe down to close (mobile bottom sheet): grabber, or anywhere when scrolled to top
    const panel = $(".sheet__panel", d), scroller = $("#sheetScroll");
    let y0 = null, dy = 0, dragging = false;
    const start = (e) => { if (innerWidth > 960) return; const onGrab = e.target.closest("#sheetGrabber"); if (!onGrab && (scroller.scrollTop > 0 || e.target.closest(".gallery__track"))) return; y0 = e.touches[0].clientY; dy = 0; dragging = false; };
    const move = (e) => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 6) { dragging = true; panel.style.transition = "none"; panel.style.transform = `translateY(${dy}px)`; if (e.cancelable) e.preventDefault(); } else if (dy < -4 && !dragging) y0 = null; };
    const end = () => { if (y0 == null) return; y0 = null; panel.style.transition = "transform .3s var(--ease-sheet)"; if (dragging && dy > 110) { panel.style.transform = "translateY(100%)"; setTimeout(() => { panel.style.transform = ""; panel.style.transition = ""; d.classList.remove("is-closing"); if (history.state && history.state.car) history.back(); else { d.close(); } }, 260); } else { panel.style.transform = ""; } };
    panel.addEventListener("touchstart", start, { passive: true }); panel.addEventListener("touchmove", move, { passive: false }); panel.addEventListener("touchend", end);
    // Back button closes the sheet
    addEventListener("popstate", () => { if (d.open && !(history.state && history.state.car)) closeCar(true); else if (history.state && history.state.car && !d.open) openCar(history.state.car, null, true); });
  }

  /* ============================================================
     Why us, steps, reviews, follow, faq
     ============================================================ */
  function renderFeatures() {
    const f = C.features || {}; $("#featEyebrow").textContent = f.eyebrow || ""; $("#featTitle").textContent = f.title || "";
    $("#features").innerHTML = (f.items || []).map((it) => `<div class="feature reveal"><div class="feature__icon">${icon(it.icon) || icon("check-circle")}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join("");
    $("#why").hidden = !(f.items || []).length;
  }
  function renderSteps() {
    const h = C.howItWorks || {}; $("#howEyebrow").textContent = h.eyebrow || ""; $("#howTitle").textContent = h.title || "";
    $("#steps").innerHTML = (h.steps || []).map((s, i) => `<li class="step reveal"><div class="step__num" aria-hidden="true">${i + 1}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("");
    $("#how").hidden = !(h.steps || []).length;
  }
  function renderTestimonials() {
    const t = C.testimonials || {}, items = t.items || [];
    $("#testiEyebrow").textContent = t.eyebrow || ""; $("#testiTitle").textContent = t.title || "";
    $("#reviews").hidden = !items.length;
    const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const stars = (n) => icon("star").repeat(Math.max(1, Math.min(5, Math.round(+n || 5))));
    $("#testiTrack").innerHTML = items.map((it) => `<figure class="testi" style="margin:0">
      <div class="testi__stars" role="img" aria-label="${esc(Math.min(5, +it.rating || 5))} out of 5 stars">${stars(it.rating)}</div>
      <blockquote class="testi__text" style="margin:0">${esc(it.text)}</blockquote>
      <figcaption class="testi__author"><span class="avatar" aria-hidden="true">${esc(initials(it.name))}</span><span><span class="testi__name" style="display:block">${esc(it.name)}</span><span class="testi__role">${esc(it.role)}</span></span></figcaption>
    </figure>`).join("");
    const g = (C.stats || []).find((s) => /rating|google/i.test(s.label || "")), gl = socialLinks().find((l) => l.platform === "google");
    const score = g ? String(g.value).replace(/[^\d.]/g, "") : "";
    $("#ratingSummary").innerHTML = score ? `<span class="rating__score">${esc(score)}</span><span><span class="rating__stars">${icon("star").repeat(5)}</span><span class="rating__label">${esc(g.label)}${gl ? ` · <a href="${esc(safeUrl(gl.url))}" target="_blank" rel="noopener">Read on Google</a>` : ""}</span></span>` : "";
    const track = $("#testiTrack"); const step = () => (track.firstElementChild ? track.firstElementChild.offsetWidth + 20 : 300);
    const sync = () => { $("#testiPrev").disabled = track.scrollLeft < 8; $("#testiNext").disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8; };
    $("#testiPrev").onclick = () => track.scrollBy({ left: -step(), behavior: "smooth" });
    $("#testiNext").onclick = () => track.scrollBy({ left: step(), behavior: "smooth" });
    track.onscroll = () => requestAnimationFrame(sync); requestAnimationFrame(sync);
  }
  function embedFor(url) {
    const u = String(url || "").trim(); if (!/^https:\/\//i.test(u)) return "";
    let m;
    if ((m = u.match(/instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)/))) return `<div class="embed embed--ig"><iframe src="https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/embed/" loading="lazy" title="Instagram post"></iframe></div>`;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/))) return `<div class="embed embed--yt"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="YouTube video"></iframe></div>`;
    if (/facebook\.com\/.+\/(videos|reel)\//.test(u) || /fb\.watch\//.test(u)) return `<div class="embed embed--fb"><iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false" loading="lazy" allowfullscreen title="Facebook video"></iframe></div>`;
    if (/facebook\.com\//.test(u)) return `<div class="embed embed--fb"><iframe src="https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(u)}&show_text=true" loading="lazy" title="Facebook post"></iframe></div>`;
    let host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { /* keep */ }
    return `<a class="embed embed--link" href="${esc(u)}" target="_blank" rel="noopener"><span class="embed__icon">${icon("link")}</span><span><b>${esc(host)}</b><span>${esc(u)}</span></span></a>`;
  }
  function renderFollow() {
    const sec = socialCfg().section || {}, links = socialLinks(), posts = (sec.posts || []).map(embedFor).filter(Boolean);
    const show = sec.enabled && (posts.length || links.length);
    $("#follow").hidden = !show; if (!show) return;
    $("#followEyebrow").textContent = sec.eyebrow || "Follow us"; $("#followTitle").textContent = sec.title || ""; $("#followText").textContent = sec.text || "";
    $("#followLinks").innerHTML = links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${socialIcon(l)}${esc(l.label || l.platform)}</a>`).join("");
    const cta = $("#followCta"), ctaUrl = safeUrl(sec.ctaLink, "");
    cta.innerHTML = `${esc(sec.ctaText || "")}${icon("arrow-right")}`; cta.href = ctaUrl || "#"; cta.hidden = !sec.ctaText || !ctaUrl || isPlaceholder(ctaUrl);
    $("#followGrid").innerHTML = posts.join("");
  }
  function renderFaq() {
    const f = C.faq || {}; $("#faqEyebrow").textContent = f.eyebrow || ""; $("#faqTitle").textContent = f.title || "";
    $("#faqList").innerHTML = (f.items || []).map((it, i) => `<details class="faq" name="faq" ${i === 0 ? "open" : ""}><summary>${esc(it.q)}${icon("chevron-down")}</summary><div class="faq__a">${esc(it.a)}</div></details>`).join("");
    $("#faq").hidden = !(f.items || []).length;
  }

  /* ============================================================
     Contact & footer
     ============================================================ */
  function mapSrc(s) {
    const u = String(s.mapEmbed || "").trim();
    if (/^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed\?/i.test(u)) return u;
    if (/^<iframe/i.test(u)) { const m = u.match(/src="(https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed\?[^"]+)"/i); if (m) return m[1].replace(/&amp;/g, "&"); }
    // Short links (maps.app.goo.gl) cannot be framed: fall back to an address search embed
    if (u || s.address) return `https://maps.google.com/maps?q=${encodeURIComponent(s.address || s.name)}&z=15&output=embed`;
    return "";
  }
  function directionsUrl(s) {
    const u = String(s.mapEmbed || "").trim();
    if (/^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)\//i.test(u) && !/\/embed\?/.test(u)) return u;
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(s.address || s.name);
  }
  function renderContact() {
    const s = C.site, c = C.contact || {};
    $("#contactEyebrow").textContent = c.eyebrow || ""; $("#contactTitle").textContent = c.title || ""; $("#contactText").textContent = c.text || "";
    const card = (ic, b, sub, href, wide, ext) => `<a class="contact-card ${wide ? "contact-card--wide" : ""}" href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ""}><span class="contact-card__icon">${icon(ic)}</span><span><b>${esc(b)}</b><span>${esc(sub)}</span></span></a>`;
    $("#contactCards").innerHTML =
      card("phone", "Call us", s.phone, telLink()) +
      card("whatsapp", "WhatsApp", "Replies in minutes", waLink(generalMessage()), false, true) +
      (s.email ? card("mail", s.email, "Reply within a few hours", "mailto:" + s.email, true) : "") +
      card("navigation", "Get directions", [s.address, s.hours].filter(Boolean).join(" · "), directionsUrl(s), true, true);
    const src = mapSrc(s), map = $("#map");
    map.hidden = !src;
    if (src && map.dataset.src !== src) { map.dataset.src = src; map.innerHTML = `<iframe src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map showing ${esc(s.name)}"></iframe>`; }

    const cur = $("#cfCar").value;
    $("#cfCar").innerHTML = `<option value="">Not sure yet</option>` + visibleFleet().map((x) => `<option value="${esc(x.name)}" ${x.name === cur ? "selected" : ""}>${esc(x.name)} · ${inr(x.pricePerDay)}/day</option>`).join("");
    $("#cfPickup").min = today();
    $("#cfPickup").onchange = () => { const p = $("#cfPickup").value; if (p) { $("#cfReturn").min = addDays(p, 1); if ($("#cfReturn").value && $("#cfReturn").value <= p) $("#cfReturn").value = addDays(p, 1); } };
    const who = visitor.get();
    if (!$("#cfName").value && who.name) $("#cfName").value = who.name;
    if (!$("#cfPhone").value && who.phone) $("#cfPhone").value = who.phone;
    $("#contactForm").onsubmit = (e) => {
      e.preventDefault();
      if ($("#cfWebsite").value) return; // honeypot
      const name = $("#cfName").value.trim(), phone = $("#cfPhone").value.trim();
      $("#cfName").closest(".field").classList.toggle("is-invalid", !name);
      $("#cfPhone").closest(".field").classList.toggle("is-invalid", digits(phone).length < 10);
      if (!name || digits(phone).length < 10) { toast("Please enter your name and a 10-digit mobile number."); (!name ? $("#cfName") : $("#cfPhone")).focus(); return; }
      const car = visibleFleet().find((x) => x.name === $("#cfCar").value) || null;
      const p = $("#cfPickup").value, r = $("#cfReturn").value, d = daysBetween(p, r), note = $("#cfMsg").value.trim(), ref = newRef();
      window.open(waLink(bookingMessage({ car, pickup: p, ret: r, name, phone, note, ref })), "_blank", "noopener");
      recordEnquiry({ ref, source: "contact", name, phone, carId: car ? car.id : "", carName: car ? car.name : "", pickup: p, return: r, days: d, pricePerDay: car ? num(car.pricePerDay, 0) : 0, estimate: car && d ? tripPrice(car, d) : 0, message: note, website: "" });
      visitor.set(name, phone);
      toast("Opening WhatsApp. Just press send.");
    };

    const f = C.footer || {};
    $("#footAbout").textContent = f.about || "";
    $("#footCopy").textContent = (f.copyright || `© {year} ${s.name}`).replace("{year}", new Date().getFullYear());
    const sc = socialCfg(), links = socialLinks();
    $("#footSocial").innerHTML = sc.showInFooter !== false ? links.map(socialAnchor).join("") : "";
    const pop = visibleFleet().filter((x) => x.featured);
    $("#footCars").innerHTML = (pop.length ? pop : visibleFleet()).slice(0, 6).map((x) => `<li><a href="#car-${esc(x.id)}" data-open-car="${esc(x.id)}">${esc(x.name)}</a></li>`).join("");
    $$("#footCars [data-open-car]").forEach((el) => (el.onclick = (e) => { e.preventDefault(); openCar(el.dataset.openCar, el); }));
    $("#footContact").innerHTML = `<li><a href="${telLink()}">${esc(s.phone)}</a></li>${s.email ? `<li><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>` : ""}<li>${esc(s.address)}</li><li>${esc(s.hours)}</li>`;
  }

  /* ============================================================
     Chrome: header states, menu, active nav, reveal
     ============================================================ */
  function bindChrome() {
    const header = $("#header"), hero = $("#hero");
    const onScroll = () => {
      const y = scrollY; header.classList.toggle("is-scrolled", y > 8);
      const heroBottom = hero.offsetTop + hero.offsetHeight - 80;
      header.classList.toggle("on-hero", y < heroBottom - header.offsetHeight);
      $("#toTop").classList.toggle("is-visible", y > 900);
    };
    let ticking = false; addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { onScroll(); ticking = false; }); } }, { passive: true }); onScroll();
    addEventListener("resize", onScroll, { passive: true });
    $("#toTop").onclick = () => scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
    $("#themeToggle").onclick = () => setThemeChoice(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    // Date pills: open the calendar from anywhere on the pill (browsers without the full-size indicator)
    document.addEventListener("click", (e) => {
      const inp = e.target.closest?.(".pill-field")?.querySelector('input[type="date"]');
      if (inp && inp.showPicker) { try { inp.showPicker(); } catch {} }
    });

    const menu = $("#menu"), tog = $("#navToggle");
    const setMenu = (open) => {
      menu.hidden = !open; tog.setAttribute("aria-expanded", open); tog.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      tog.innerHTML = icon(open ? "x" : "menu"); root.classList.toggle("is-locked", open);
      if (open) { const a = $("a", menu); if (a) a.focus({ preventScroll: true }); }
    };
    tog.onclick = () => setMenu(menu.hidden);
    $$("[data-menu-close], #menu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); tog.focus(); } });
    matchMedia("(min-width: 961px)").addEventListener("change", (e) => { if (e.matches) setMenu(false); });

    const links = $$("[data-nav]"); const secs = links.map((l) => $(l.getAttribute("href"))).filter(Boolean);
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === "#" + en.target.id)); }), { rootMargin: "-45% 0px -50% 0px" });
    secs.forEach((s) => io.observe(s));
  }
  let revealIO;
  function observeReveal() {
    if (isPreview || !("IntersectionObserver" in window)) { $$(".reveal").forEach((el) => el.classList.add("is-in")); return; }
    if (!revealIO) revealIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); } }), { threshold: .12, rootMargin: "0px 0px -40px 0px" });
    $$(".reveal:not(.is-in)").forEach((el) => revealIO.observe(el));
  }

  /* ============================================================
     Boot + admin live preview
     ============================================================ */
  function renderAll() {
    if (!Array.isArray(C.fleet)) C.fleet = [];
    C.site = C.site || {}; C.hero = C.hero || {};
    applyBrandTheme(); renderGlobal(); renderHero(); renderStats(); renderPromos(); renderChips(); renderFleet(!firstRender);
    renderFeatures(); renderSteps(); renderTestimonials(); renderFollow(); renderFaq(); renderContact();
    hydrateIcons(document); observeReveal(); renderJsonLd();
    firstRender = false;
  }
  async function init() {
    hydrateIcons(document);
    try { C = await loadContent(); } catch (e) {
      $("#fleetGrid").innerHTML = `<div class="fleet-empty"><h3>We couldn't load the cars</h3><p>Please check your connection and refresh the page.</p></div>`; return;
    }
    renderAll(); bindFleetControls(); bindSheet(); bindChrome();
    const h = location.hash;
    if (h.startsWith("#car-")) { history.replaceState(null, "", location.pathname + location.search); openCar(h.slice(5)); }
    if (isPreview) {
      document.body.classList.add("is-preview");
      window.parent.postMessage({ type: "dp:ready" }, location.origin);
    }
  }
  window.addEventListener("message", (e) => {
    if (!isPreview || e.origin !== location.origin || e.source !== window.parent || !e.data) return;
    if (e.data.type === "dp:preview" && e.data.content && C) { C = e.data.content; renderAll(); }
    if (e.data.type === "dp:theme" && (e.data.theme === "light" || e.data.theme === "dark")) { previewTheme = e.data.theme; applyTheme(previewTheme); }
  });
  document.addEventListener("DOMContentLoaded", init);
})();
