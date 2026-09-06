/* ============================================================
   DriveEase public site — renders everything from content JSON
   ============================================================ */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const DAY = 86400000;

  let C = null;                 // content
  const state = { cat: "", trans: "", fuel: "", sort: "rec", q: "", days: 0, pickup: "", ret: "" };
  const modal = { car: null, idx: 0 };

  /* ---------- content loading ---------- */
  async function loadContent() {
    try {
      const r = await fetch("data/content.json?v=" + Date.now(), { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) { /* file:// or offline → fallback */ }
    if (window.SITE_CONTENT) return window.SITE_CONTENT;
    throw new Error("No content available");
  }

  /* ---------- helpers ---------- */
  const waNumber = () => String(C.site.whatsapp || "").replace(/\D/g, "");
  const waLink = (text) => `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`;
  const telLink = () => "tel:" + String(C.site.phone || "").replace(/[^\d+]/g, "");
  const fmtDate = (s) => { if (!s) return ""; const d = new Date(s + "T00:00:00"); return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
  const daysBetween = (a, b) => { if (!a || !b) return 0; const d = Math.round((new Date(b) - new Date(a)) / DAY); return d > 0 ? d : 0; };
  const PLATFORM_ICON = { x: "x-social", google: "google", instagram: "instagram", facebook: "facebook", youtube: "youtube", linkedin: "linkedin", threads: "threads", telegram: "telegram", whatsapp: "whatsapp", custom: "link" };
  const socialCfg = () => C.social || { links: Object.entries((C.site && C.site.social) || {}).map(([k, v]) => ({ platform: k, label: k, url: v, enabled: !!v })), showInHeader: false, showInFooter: true, showInContact: false, shareButtons: true, section: { enabled: false } };
  const socialLinks = () => (socialCfg().links || []).filter((l) => l.enabled !== false && l.url);
  const socialIcon = (l) => icon(PLATFORM_ICON[l.platform] || "link") || icon("link");
  const socialAnchor = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="${esc(l.label || l.platform)}" title="${esc(l.label || l.platform)}">${socialIcon(l)}</a>`;
  const visibleFleet = () => (C.fleet || []).filter((c) => c.hidden !== true);
  const categories = () => { const seen = []; visibleFleet().forEach((c) => { if (c.category && !seen.includes(c.category)) seen.push(c.category); }); return seen; };

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("is-visible"), 2600);
  }

  /* ---------- render: global ---------- */
  function renderGlobal() {
    const s = C.site, seo = C.seo || {};
    document.title = seo.title || `${s.name} · ${s.tagline}`;
    setMeta("description", seo.description); setMeta("keywords", seo.keywords);
    $("#brandName").textContent = s.name; $("#brandTagline").textContent = s.tagline;
    $("#footBrand").textContent = s.name; $("#footTagline").textContent = s.tagline;
    // logo: uploaded image or the default car mark
    $$(".brand").forEach((b) => {
      const mark = $(".brand__mark", b);
      if (s.logo) { mark.classList.add("brand__mark--img"); mark.innerHTML = `<img class="brand__logo" src="${esc(s.logo)}" alt="${esc(s.name)}" style="--logo-h:${Number(s.logoHeight) || 40}px" />`; }
      else { mark.classList.remove("brand__mark--img"); mark.innerHTML = icon("car"); }
      b.classList.toggle("brand--logo-only", !!s.logo && s.logoShowText === false);
    });
    if (s.favicon) { let l = document.querySelector('link[rel="icon"]'); if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); } l.href = s.favicon; l.removeAttribute("type"); }

    const hello = `Hi ${s.name}, I'd like to enquire about a self-drive car.`;
    ["#headerWa", "#mobileWa", "#fabWa", "#ctaWa", "#faqWa", "#heroSecondary"].forEach((id) => { const el = $(id); if (el) el.href = waLink(hello); });
    ["#headerCall", "#mobileCall", "#ctaCall"].forEach((id) => { const el = $(id); if (el) el.href = telLink(); });
    $("#headerPhone").textContent = s.phone; $("#ctaPhone").textContent = "Call " + s.phone;

    const sc = socialCfg();
    $("#headerSocial").innerHTML = sc.showInHeader ? socialLinks().slice(0, 4).map(socialAnchor).join("") : "";

    // announcement
    const an = $("#announce");
    if (s.announcementEnabled && s.announcement && !sessionStorage.getItem("announceClosed")) {
      $("#announceText").innerHTML = `<strong>${esc(s.announcement)}</strong>`; an.hidden = false;
    }
    $("#announceClose").onclick = () => { an.hidden = true; sessionStorage.setItem("announceClosed", "1"); };
  }
  function setMeta(name, content) {
    if (!content) return; let m = document.querySelector(`meta[name="${name}"]`);
    if (!m) { m = document.createElement("meta"); m.name = name; document.head.appendChild(m); } m.content = content;
  }

  /* ---------- render: hero ---------- */
  function renderHero() {
    const h = C.hero;
    const img = $("#heroImage"); img.src = h.image || ""; img.alt = C.site.name + " fleet";
    $("#heroEyebrow").textContent = h.eyebrow; $("#heroTitle").textContent = h.title; $("#heroHighlight").textContent = h.titleHighlight;
    $("#heroSubtitle").textContent = h.subtitle;
    $("#heroPrimaryText").textContent = h.primaryCta; $("#heroPrimary").href = h.primaryLink || "#fleet";
    $("#heroSecondaryText").textContent = h.secondaryCta;
    $("#heroBadges").innerHTML = (h.badges || []).map((b) => `<li>${icon("check-circle")}${esc(b)}</li>`).join("");

    const sel = $("#bkType"); sel.innerHTML = `<option value="">Any car</option>` + categories().map((c) => `<option>${esc(c)}</option>`).join("");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    $("#bkPickup").min = today; $("#bkReturn").min = tomorrow;
    if (!$("#bkPickup").value) $("#bkPickup").value = today; if (!$("#bkReturn").value) $("#bkReturn").value = tomorrow;
    $("#bkPickup").onchange = (e) => { const min = new Date(new Date(e.target.value).getTime() + DAY).toISOString().slice(0, 10); $("#bkReturn").min = min; if ($("#bkReturn").value < min) $("#bkReturn").value = min; };
    $("#bookingForm").onsubmit = (e) => {
      e.preventDefault();
      const p = $("#bkPickup").value, r = $("#bkReturn").value;
      const d = daysBetween(p, r);
      if (!p || !r || d < 1) { toast("Please choose a valid pickup and return date."); return; }
      state.pickup = p; state.ret = r; state.days = d; state.cat = $("#bkType").value;
      $("#cfPickup").value = p; $("#cfReturn").value = r;
      renderChips(); renderFleet();
      document.getElementById("fleet").scrollIntoView({ behavior: "smooth" });
    };
  }

  /* ---------- render: stats ---------- */
  function renderStats() {
    $("#stats").innerHTML = (C.stats || []).map((s) => `<div class="stat"><div class="stat__value">${esc(s.value)}</div><div class="stat__label">${esc(s.label)}</div></div>`).join("");
  }

  /* ---------- render: fleet ---------- */
  function renderChips() {
    const cats = categories(); const all = visibleFleet();
    const chip = (v, label, n) => `<button type="button" class="chip ${state.cat === v ? "is-active" : ""}" data-cat="${esc(v)}">${esc(label)}<span class="count">${n}</span></button>`;
    $("#fleetChips").innerHTML = chip("", "All cars", all.length) + cats.map((c) => chip(c, c, all.filter((x) => x.category === c).length)).join("");
    $$("#fleetChips .chip").forEach((b) => (b.onclick = () => { state.cat = b.dataset.cat; renderChips(); renderFleet(); }));
  }

  function filteredFleet() {
    let list = visibleFleet().filter((c) =>
      (!state.cat || c.category === state.cat) && (!state.trans || c.transmission === state.trans) && (!state.fuel || c.fuel === state.fuel) &&
      (!state.q || (c.name + " " + c.brand + " " + c.category).toLowerCase().includes(state.q))
    );
    if (state.sort === "asc") list.sort((a, b) => a.pricePerDay - b.pricePerDay);
    else if (state.sort === "desc") list.sort((a, b) => b.pricePerDay - a.pricePerDay);
    else if (state.sort === "seats") list.sort((a, b) => b.seats - a.seats);
    else list.sort((a, b) => (b.featured === true) - (a.featured === true) || (b.available !== false) - (a.available !== false));
    return list;
  }

  function carCard(c) {
    const cover = c.cover || (c.images && c.images[0]) || "";
    const sm = cover.replace(/(\d{2})\.jpg$/, "$1-sm.jpg");
    const unavailable = c.available === false;
    const est = state.days ? `<span class="price__est">${inr(c.pricePerDay * state.days)} for ${state.days} day${state.days > 1 ? "s" : ""}</span>` : "";
    return `<article class="car-card ${unavailable ? "is-unavailable" : ""} reveal" data-id="${esc(c.id)}">
      <div class="car-card__media" data-open="${esc(c.id)}">
        <img src="${esc(sm)}" alt="${esc(c.name)}" loading="lazy" onerror="this.onerror=null;this.src='${esc(cover)}'" />
        <div class="car-card__tags">${c.featured ? `<span class="tag tag--accent">Popular</span>` : ""}${unavailable ? `<span class="tag tag--muted">Booked</span>` : ""}<span class="tag">${esc(c.transmission)}</span></div>
        <span class="car-card__photos">${icon("camera")}${(c.images || []).length}</span>
      </div>
      <div class="car-card__body">
        <div class="car-card__head"><div><h3 class="car-card__name">${esc(c.name)}</h3><div class="car-card__cat">${esc(c.category)} · ${esc(c.brand)}</div></div></div>
        <ul class="car-card__specs">
          <li>${icon("users")}${esc(c.seats)} seats</li>
          <li>${icon("fuel")}${esc(c.fuel)}</li>
          <li>${icon("road")}${esc(c.kmPerDay || 300)} km/day</li>
        </ul>
        <div class="car-card__foot">
          <div class="price"><span class="price__amount">${inr(c.pricePerDay)}</span> <span class="price__unit">/ day</span>${est}</div>
          <div class="car-card__actions">
            <button class="btn btn--outline btn--sm" type="button" data-open="${esc(c.id)}">Details</button>
            <a class="btn btn--dark btn--sm" href="${waLink(bookMsg(c))}" target="_blank" rel="noopener">Book</a>
          </div>
        </div>
      </div>
    </article>`;
  }

  function bookMsg(c, extra) {
    let m = `Hi ${C.site.name}, I'd like to book the *${c.name}* (${inr(c.pricePerDay)}/day).`;
    if (state.pickup && state.ret) m += `\nPickup: ${fmtDate(state.pickup)}\nReturn: ${fmtDate(state.ret)} (${state.days} day${state.days > 1 ? "s" : ""})`;
    if (extra) m += "\n" + extra;
    m += "\nIs it available?";
    return m;
  }

  function renderFleet() {
    const list = filteredFleet();
    const grid = $("#fleetGrid");
    grid.innerHTML = list.length ? list.map(carCard).join("") : `<div class="fleet-empty"><h3 style="font-size:20px;margin-bottom:6px">No cars match those filters</h3>Try a different category or clear the search.</div>`;
    $$("[data-open]", grid).forEach((el) => (el.onclick = () => openCar(el.dataset.open)));
    const note = $("#fleetNote");
    if (state.days) { $("#fleetNoteText").textContent = `Showing estimates for ${state.days} day${state.days > 1 ? "s" : ""} · ${fmtDate(state.pickup)} → ${fmtDate(state.ret)}`; note.classList.add("is-visible"); }
    else note.classList.remove("is-visible");
    observeReveal(grid);
  }

  function bindFleetControls() {
    $("#fltTrans").onchange = (e) => { state.trans = e.target.value; renderFleet(); };
    $("#fltFuel").onchange = (e) => { state.fuel = e.target.value; renderFleet(); };
    $("#fltSort").onchange = (e) => { state.sort = e.target.value; renderFleet(); };
    let t; $("#fltSearch").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); renderFleet(); }, 120); };
    $("#fleetNoteClear").onclick = () => { state.days = 0; state.pickup = state.ret = ""; renderFleet(); };
  }

  /* ---------- car modal ---------- */
  function openCar(id) {
    const c = visibleFleet().find((x) => x.id === id); if (!c) return;
    modal.car = c; modal.idx = Math.max(0, (c.images || []).indexOf(c.cover));
    renderGallery();
    const unavailable = c.available === false;
    $("#detail").innerHTML = `
      <div><div class="detail__cat">${esc(c.category)} · ${esc(c.brand)}</div><h2 class="detail__name" id="detailName">${esc(c.name)}</h2><p class="detail__desc">${esc(c.description)}</p></div>
      <div class="spec-grid">
        <div class="spec">${icon("users")}<div><small>Seating</small><b>${esc(c.seats)} seats</b></div></div>
        <div class="spec">${icon("gear")}<div><small>Transmission</small><b>${esc(c.transmission)}</b></div></div>
        <div class="spec">${icon("fuel")}<div><small>Fuel</small><b>${esc(c.fuel)}</b></div></div>
        <div class="spec">${icon("road")}<div><small>Included</small><b>${esc(c.kmPerDay || 300)} km / day</b></div></div>
      </div>
      <div class="price-table">
        <div><span>Rental per day</span><b>${inr(c.pricePerDay)}</b></div>
        <div><span>Extra km charge</span><b>${inr(c.extraKmCharge)} / km</b></div>
        <div><span>Refundable deposit</span><b>${inr(c.deposit)}</b></div>
      </div>
      ${(c.features || []).length ? `<ul class="feature-pills">${c.features.map((f) => `<li>${icon("check")}${esc(f)}</li>`).join("")}</ul>` : ""}
      ${unavailable ? `<div class="detail__unavailable">This car is currently booked. Message us to check the next available date.</div>` : ""}
      <form class="detail__form" id="detailForm">
        <h4>Book this car</h4>
        <div class="row">
          <div class="field"><label>Pickup date</label><input type="date" id="dtPickup" value="${esc(state.pickup)}" /></div>
          <div class="field"><label>Return date</label><input type="date" id="dtReturn" value="${esc(state.ret)}" /></div>
        </div>
        <div class="detail__total"><span id="dtLabel">Select dates for an estimate</span><b id="dtTotal"></b></div>
        <div class="detail__actions">
          <button class="btn btn--wa" type="submit">${icon("whatsapp")} Book on WhatsApp</button>
          <a class="btn btn--outline" href="${telLink()}">${icon("phone")} Call us</a>
        </div>
      </form>
      ${socialCfg().shareButtons !== false ? shareBar(c) : ""}`;
    const calc = () => {
      const d = daysBetween($("#dtPickup").value, $("#dtReturn").value);
      $("#dtLabel").textContent = d ? `${d} day${d > 1 ? "s" : ""} × ${inr(c.pricePerDay)}` : "Select dates for an estimate";
      $("#dtTotal").textContent = d ? inr(d * c.pricePerDay) : "";
      return d;
    };
    $("#dtPickup").onchange = $("#dtReturn").onchange = calc; calc();
    $$("[data-copy]", $("#detail")).forEach((b) => (b.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.copy) : Promise.reject()).then(() => toast("Link copied"), () => prompt("Copy this link", b.dataset.copy)); }));
    $("#detailForm").onsubmit = (e) => {
      e.preventDefault();
      const p = $("#dtPickup").value, r = $("#dtReturn").value, d = daysBetween(p, r);
      if (p && r && d) { state.pickup = p; state.ret = r; state.days = d; }
      window.open(waLink(bookMsg(c)), "_blank", "noopener");
    };
    $("#carModal").classList.add("is-open"); document.body.classList.add("no-scroll");
    history.replaceState(null, "", "#car-" + c.id);
  }
  function shareBar(c) {
    const url = location.origin + location.pathname + "#car-" + c.id, text = `${c.name} on rent, ${inr(c.pricePerDay)}/day at ${C.site.name}`;
    return `<div class="share">Share
      <a href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}" target="_blank" rel="noopener" title="WhatsApp">${icon("whatsapp")}</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener" title="Facebook">${icon("facebook")}</a>
      <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener" title="X">${icon("x-social")}</a>
      <button type="button" data-copy="${esc(url)}" title="Copy link">${icon("copy")}</button></div>`;
  }
  function closeCar() { $("#carModal").classList.remove("is-open"); document.body.classList.remove("no-scroll"); if (location.hash.startsWith("#car-")) history.replaceState(null, "", " "); }
  function renderGallery() {
    const imgs = modal.car.images || []; const src = imgs[modal.idx] || modal.car.cover;
    $("#galMain").src = src; $("#galMain").alt = modal.car.name;
    $("#galCounter").textContent = `${modal.idx + 1} / ${imgs.length}`;
    $("#galThumbs").innerHTML = imgs.map((s, i) => `<button type="button" class="${i === modal.idx ? "is-active" : ""}" data-i="${i}"><img src="${esc(s.replace(/(\d{2})\.jpg$/, "$1-sm.jpg"))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(s)}'" /></button>`).join("");
    $$("#galThumbs button").forEach((b) => (b.onclick = () => { modal.idx = +b.dataset.i; renderGallery(); }));
    const act = $("#galThumbs .is-active"); if (act) act.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
  const galStep = (n) => { const len = (modal.car.images || []).length; modal.idx = (modal.idx + n + len) % len; renderGallery(); if ($("#lightbox").classList.contains("is-open")) $("#lbImg").src = $("#galMain").src; };
  function bindModal() {
    $$("#carModal [data-close]").forEach((el) => (el.onclick = closeCar));
    $("#galPrev").onclick = () => galStep(-1); $("#galNext").onclick = () => galStep(1);
    $("#galMain").onclick = () => { $("#lbImg").src = $("#galMain").src; $("#lightbox").classList.add("is-open"); };
    $("#lbClose").onclick = () => $("#lightbox").classList.remove("is-open");
    $("#lightbox").onclick = (e) => { if (e.target === e.currentTarget) $("#lightbox").classList.remove("is-open"); };
    $("#lbPrev").onclick = () => galStep(-1); $("#lbNext").onclick = () => galStep(1);
    document.addEventListener("keydown", (e) => {
      if ($("#lightbox").classList.contains("is-open")) { if (e.key === "Escape") $("#lightbox").classList.remove("is-open"); if (e.key === "ArrowLeft") galStep(-1); if (e.key === "ArrowRight") galStep(1); return; }
      if ($("#carModal").classList.contains("is-open")) { if (e.key === "Escape") closeCar(); if (e.key === "ArrowLeft") galStep(-1); if (e.key === "ArrowRight") galStep(1); }
    });
    // swipe on gallery
    let x0 = null; const g = $("#galMain");
    g.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    g.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) galStep(dx < 0 ? 1 : -1); x0 = null; });
  }

  /* ---------- render: offers carousel ---------- */
  const promoState = { idx: 0, timer: null, count: 0 };
  function activePromos() {
    const p = C.promos || {}; if (!p.enabled) return [];
    const today = new Date().toISOString().slice(0, 10);
    return (p.items || []).filter((it) => it.enabled !== false && it.image && (!it.startDate || it.startDate <= today) && (!it.endDate || it.endDate >= today));
  }
  function renderPromos() {
    const items = activePromos(); const sec = $("#promos"); const p = C.promos || {};
    sec.hidden = !items.length; clearInterval(promoState.timer); if (!items.length) return;
    const isAction = (l) => l && l !== "#";
    $("#promosTrack").innerHTML = items.map((it, i) => {
      const tag = isAction(it.link) ? "a" : "div";
      const ext = /^https?:/i.test(it.link || "");
      const cap = it.caption || it.text || (it.ctaText && isAction(it.link)) ? `<div class="promo__caption"><div>${it.caption ? `<h3>${esc(it.caption)}</h3>` : ""}${it.text ? `<p>${esc(it.text)}</p>` : ""}</div>${it.ctaText && isAction(it.link) ? `<span class="btn btn--primary btn--sm">${esc(it.ctaText)}</span>` : ""}</div>` : "";
      return `<${tag} class="promo ${it.fit === "cover" ? "promo--cover" : ""}" data-fit="${esc(it.fit || "auto")}" data-i="${i}" ${isAction(it.link) ? `href="${esc(it.link)}" ${ext ? 'target="_blank" rel="noopener"' : ""}` : ""} aria-label="${esc(it.title || "Offer " + (i + 1))}"><div class="promo__bg" style="background-image:url('${esc(it.image)}')"></div><img class="promo__img" src="${esc(it.image)}" alt="${esc(it.title || "")}" loading="${i ? "lazy" : "eager"}" />${cap}</${tag}>`;
    }).join("");
    // auto fit: landscape posters fill the frame, portrait/square ones are letterboxed on a blurred backdrop
    $$(".promo[data-fit='auto'] .promo__img", $("#promosTrack")).forEach((img) => { const apply = () => { if (img.naturalWidth / img.naturalHeight > 1.9) img.closest(".promo").classList.add("promo--cover"); }; if (img.complete) apply(); else img.onload = apply; });
    const frame = $(".promos__frame"); frame.classList.toggle("promos--single", items.length < 2);
    $("#promosDots").innerHTML = p.showDots === false ? "" : items.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Go to offer ${i + 1}"></button>`).join("");
    $("#promosPrev").hidden = $("#promosNext").hidden = p.showArrows === false;
    promoState.count = items.length; promoState.idx = 0; syncPromoDots();
    $$("[data-dot]").forEach((b) => (b.onclick = () => goPromo(+b.dataset.dot)));
    $("#promosPrev").onclick = () => goPromo(promoState.idx - 1); $("#promosNext").onclick = () => goPromo(promoState.idx + 1);
    const track = $("#promosTrack"); let st;
    track.onscroll = () => { clearTimeout(st); st = setTimeout(() => { promoState.idx = Math.round(track.scrollLeft / track.clientWidth); syncPromoDots(); }, 80); };
    // in-page links: open car modal or smooth scroll without leaving the page
    $$("a.promo", track).forEach((a) => (a.onclick = (e) => { const h = a.getAttribute("href"); if (h.startsWith("#car-")) { e.preventDefault(); openCar(h.slice(5)); } else if (h.startsWith("#")) { e.preventDefault(); const t = $(h); if (t) t.scrollIntoView({ behavior: "smooth" }); } }));
    startPromoTimer();
    if (p.pauseOnHover !== false) { frame.onmouseenter = () => clearInterval(promoState.timer); frame.onmouseleave = startPromoTimer; }
  }
  function startPromoTimer() { clearInterval(promoState.timer); const secs = Math.max(2, Number((C.promos || {}).interval) || 5); if (promoState.count > 1) promoState.timer = setInterval(() => goPromo(promoState.idx + 1), secs * 1000); }
  function goPromo(i) { const track = $("#promosTrack"); promoState.idx = (i + promoState.count) % promoState.count; track.scrollTo({ left: promoState.idx * track.clientWidth, behavior: "smooth" }); syncPromoDots(); }
  function syncPromoDots() { $$("[data-dot]").forEach((b) => b.classList.toggle("is-active", +b.dataset.dot === promoState.idx)); }

  /* ---------- render: features, steps, cta ---------- */
  function renderFeatures() {
    const f = C.features; $("#featEyebrow").textContent = f.eyebrow; $("#featTitle").textContent = f.title;
    $("#features").innerHTML = (f.items || []).map((it) => `<div class="feature reveal"><div class="feature__icon">${icon(it.icon) || icon("check-circle")}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join("");
  }
  function renderSteps() {
    const h = C.howItWorks; $("#howEyebrow").textContent = h.eyebrow; $("#howTitle").textContent = h.title;
    $("#steps").innerHTML = (h.steps || []).map((s, i) => `<div class="step reveal"><div class="step__num"><b>${i + 1}</b>Step ${i + 1}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><span class="step__arrow">${icon("arrow-right")}</span></div>`).join("");
  }
  function renderCta() { $("#ctaTitle").textContent = C.contact.title; $("#ctaText").textContent = C.contact.text; }

  /* ---------- render: testimonials ---------- */
  function renderTestimonials() {
    const t = C.testimonials; $("#testiEyebrow").textContent = t.eyebrow; $("#testiTitle").textContent = t.title;
    const initials = (n) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    $("#testiTrack").innerHTML = (t.items || []).map((it) => `<div class="testi">
      <div class="testi__stars">${icon("star").repeat(Math.max(1, Math.min(5, +it.rating || 5)))}</div>
      <p class="testi__text">“${esc(it.text)}”</p>
      <div class="testi__author"><div class="avatar">${esc(initials(it.name || "?"))}</div><div><div class="testi__name">${esc(it.name)}</div><div class="testi__role">${esc(it.role)}</div></div></div>
    </div>`).join("");
    const track = $("#testiTrack"); const step = () => (track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 22 : 300);
    $("#testiPrev").onclick = () => track.scrollBy({ left: -step(), behavior: "smooth" });
    $("#testiNext").onclick = () => track.scrollBy({ left: step(), behavior: "smooth" });
  }

  /* ---------- render: follow / social ---------- */
  function embedFor(url) {
    const u = String(url || "").trim(); if (!u) return "";
    let m;
    if ((m = u.match(/instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)/))) return `<div class="embed embed--ig"><iframe src="https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/embed/" loading="lazy" allowtransparency="true" title="Instagram post"></iframe></div>`;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/))) return `<div class="embed embed--yt"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="YouTube video"></iframe></div>`;
    if (/facebook\.com\/.+\/(videos|reel)\//.test(u) || /fb\.watch\//.test(u)) return `<div class="embed embed--fb"><iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false" loading="lazy" allowfullscreen title="Facebook video"></iframe></div>`;
    if (/facebook\.com\//.test(u)) return `<div class="embed embed--fb"><iframe src="https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(u)}&show_text=true" loading="lazy" title="Facebook post"></iframe></div>`;
    let host = ""; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { host = u; }
    return `<a class="embed embed--link" href="${esc(u)}" target="_blank" rel="noopener"><span class="embed__icon">${icon("link")}</span><span><b>${esc(host)}</b><span>${esc(u)}</span></span></a>`;
  }
  function renderFollow() {
    const sc = socialCfg(), sec = sc.section || {}, links = socialLinks();
    const el = $("#follow"); el.hidden = !sec.enabled; if (!sec.enabled) return;
    $("#followEyebrow").textContent = sec.eyebrow || "Follow us"; $("#followTitle").textContent = sec.title || ""; $("#followText").textContent = sec.text || "";
    const h = $("#followHandle"); h.textContent = sec.handle || ""; h.href = sec.ctaLink || (links[0] && links[0].url) || "#"; h.hidden = !sec.handle;
    $("#followLinks").innerHTML = links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${socialIcon(l)}${esc(l.label || l.platform)}</a>`).join("");
    const cta = $("#followCta"); cta.innerHTML = `${esc(sec.ctaText || "")}${icon("arrow-right")}`; cta.href = sec.ctaLink || "#"; cta.hidden = !sec.ctaText;
    $("#followGrid").innerHTML = (sec.posts || []).map(embedFor).join("");
  }

  /* ---------- render: faq ---------- */
  function renderFaq() {
    const f = C.faq; $("#faqEyebrow").textContent = f.eyebrow; $("#faqTitle").textContent = f.title;
    $("#faqList").innerHTML = (f.items || []).map((it, i) => `<details class="faq reveal" ${i === 0 ? "open" : ""}><summary>${esc(it.q)}${icon("plus")}</summary><div class="faq__a">${esc(it.a)}</div></details>`).join("");
  }

  /* ---------- render: contact & footer ---------- */
  function renderContact() {
    const s = C.site, c = C.contact;
    $("#contactEyebrow").textContent = c.eyebrow; $("#contactTitle").textContent = c.title; $("#contactText").textContent = c.text;
    const card = (ic, b, sub, href) => `<a class="contact-card" ${href ? `href="${esc(href)}" target="_blank" rel="noopener"` : ""}><div class="contact-card__icon">${icon(ic)}</div><div><b>${esc(b)}</b><span>${esc(sub)}</span></div></a>`;
    $("#contactCards").innerHTML =
      card("phone", s.phone, "Call or WhatsApp, 24x7", telLink()) +
      card("mail", s.email, "Reply within a few hours", "mailto:" + s.email) +
      card("map", s.address, s.hours, "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.address));
    if (s.mapEmbed) { $("#map").hidden = false; $("#map").innerHTML = `<iframe src="${esc(s.mapEmbed)}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" title="Map"></iframe>`; }
    $("#cfCar").innerHTML = `<option value="">Not sure yet</option>` + visibleFleet().map((x) => `<option value="${esc(x.name)}">${esc(x.name)} · ${inr(x.pricePerDay)}/day</option>`).join("");
    $("#contactForm").onsubmit = (e) => {
      e.preventDefault();
      const name = $("#cfName").value.trim(), phone = $("#cfPhone").value.trim();
      if (!name || !phone) { toast("Please enter your name and mobile number."); return; }
      let m = `Hi ${s.name}, I'd like to book a car.\nName: ${name}\nMobile: ${phone}`;
      if ($("#cfCar").value) m += `\nCar: ${$("#cfCar").value}`;
      if ($("#cfPickup").value) m += `\nPickup: ${fmtDate($("#cfPickup").value)}`;
      if ($("#cfReturn").value) m += `\nReturn: ${fmtDate($("#cfReturn").value)}`;
      if ($("#cfMsg").value.trim()) m += `\nMessage: ${$("#cfMsg").value.trim()}`;
      window.open(waLink(m), "_blank", "noopener");
    };

    $("#footAbout").textContent = C.footer.about;
    $("#footCopy").textContent = (C.footer.copyright || "").replace("{year}", new Date().getFullYear());
    const sc = socialCfg(), links = socialLinks();
    $("#footSocial").innerHTML = sc.showInFooter !== false ? links.map(socialAnchor).join("") : "";
    $("#contactSocial").hidden = !(sc.showInContact && links.length); $("#contactSocialLinks").innerHTML = links.map(socialAnchor).join("");
    $("#footCars").innerHTML = visibleFleet().filter((x) => x.featured).slice(0, 6).map((x) => `<li><a href="#car-${esc(x.id)}" data-open="${esc(x.id)}">${esc(x.name)}</a></li>`).join("");
    $$("#footCars [data-open]").forEach((el) => (el.onclick = (e) => { e.preventDefault(); openCar(el.dataset.open); }));
    $("#footContact").innerHTML = `<li><a href="${telLink()}">${esc(s.phone)}</a></li><li><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li><li>${esc(s.address)}</li><li>${esc(s.hours)}</li>`;
  }

  /* ---------- chrome: header, nav, reveal, to-top ---------- */
  function bindChrome() {
    const header = $("#header");
    const onScroll = () => { header.classList.toggle("is-scrolled", window.scrollY > 8); $("#toTop").classList.toggle("is-visible", window.scrollY > 700); };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    $("#toTop").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
    const mob = $("#mobileNav"), tog = $("#navToggle");
    const setMenu = (open) => { mob.classList.toggle("is-open", open); tog.setAttribute("aria-expanded", open); tog.innerHTML = icon(open ? "x" : "menu"); document.body.classList.toggle("no-scroll", open); };
    tog.onclick = () => setMenu(!mob.classList.contains("is-open"));
    $$("#mobileNav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    // active nav link
    const links = $$("[data-nav]"); const secs = links.map((l) => $(l.getAttribute("href"))).filter(Boolean);
    const io = new IntersectionObserver((ents) => { ents.forEach((en) => { if (en.isIntersecting) links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === "#" + en.target.id)); }); }, { rootMargin: "-40% 0px -55% 0px" });
    secs.forEach((s) => io.observe(s));
  }
  let revealIO;
  function observeReveal(root) {
    if (!revealIO) revealIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); } }), { threshold: .08 });
    $$(".reveal:not(.is-in)", root).forEach((el) => revealIO.observe(el));
  }

  /* ---------- boot ---------- */
  async function init() {
    try { C = await loadContent(); } catch (e) { document.body.innerHTML = `<div style="padding:60px;text-align:center;font-family:sans-serif"><h2>Content not found</h2><p>Run <code>npm start</code> and open <code>http://localhost:3000</code>.</p></div>`; return; }
    renderAll(); bindFleetControls(); bindModal(); bindChrome();
    if (location.hash.startsWith("#car-")) openCar(location.hash.slice(5));
    // Live preview from the admin panel (index.html?preview=1 inside an iframe)
    ready = true;
    if (pendingPreview) applyPreview(pendingPreview);
    if (isPreview) { document.body.classList.add("is-preview"); $$(".reveal").forEach((el) => el.classList.add("is-in")); if (window.parent !== window) window.parent.postMessage({ type: "driveease:ready" }, "*"); }
  }
  const isPreview = new URLSearchParams(location.search).get("preview") === "1";
  let ready = false, pendingPreview = null;
  function applyPreview(content) { C = content; renderAll(); $$(".reveal").forEach((el) => el.classList.add("is-in")); }
  window.addEventListener("message", (e) => {
    if (!isPreview || !e.data || e.data.type !== "driveease:preview" || !e.data.content) return;
    if (ready) applyPreview(e.data.content); else pendingPreview = e.data.content;
  });
  function renderAll() {
    if (!Array.isArray(C.fleet)) C.fleet = [];
    renderGlobal(); renderHero(); renderStats(); renderPromos(); renderChips(); renderFleet();
    renderFeatures(); renderSteps(); renderCta(); renderTestimonials(); renderFollow(); renderFaq(); renderContact();
    hydrateIcons(document); observeReveal(document);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
