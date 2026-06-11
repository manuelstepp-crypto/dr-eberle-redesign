/* =========================================================
   KPT Kochclub – App-Logik
   ========================================================= */
(function () {
  "use strict";

  const cfg = window.KPT_CONFIG;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    document.getElementById("splash").innerHTML =
      '<div class="empty"><span class="emoji">⚠️</span>Die App-Bibliothek konnte nicht geladen werden.<br/>Bitte Internetverbindung prüfen und neu laden.</div>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  const BUCKET = cfg.STORAGE_BUCKET;

  // ---------- State ----------
  const state = {
    me: null,            // { id, name, avatar_url }
    members: [],         // alle Mitglieder
    currentTab: "termine",
    chatTimer: null,
  };

  // ---------- DOM-Helfer ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const AVATAR_COLORS = ["#b8431f","#e0892b","#4f8a4f","#3b7ea1","#9a5ba6","#c0492b","#7a8b3a","#d18b2c"];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function colorFor(name) {
    let h = 0;
    for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
    return AVATAR_COLORS[h];
  }

  function initials(name) {
    const p = String(name || "?").trim().split(/\s+/);
    return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
  }

  function avatar(member, size = "md") {
    const name = member?.name || "?";
    if (member?.avatar_url) {
      return `<span class="avatar avatar-${size}" style="background-image:url('${esc(member.avatar_url)}')"></span>`;
    }
    return `<span class="avatar avatar-${size}" style="background:${colorFor(name)}">${esc(initials(name))}</span>`;
  }

  const MONTHS = ["Jan","Feb","März","Apr","Mai","Juni","Juli","Aug","Sep","Okt","Nov","Dez"];
  const MONTHS_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const WEEKDAYS = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];

  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function fmtLong(s) { const d = parseDate(s); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS_LONG[d.getMonth()]}`; }
  function fmtDM(s) { const d = parseDate(s); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; }

  function relTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "gerade eben";
    if (diff < 3600) return `vor ${Math.floor(diff/60)} Min`;
    if (diff < 86400) return `vor ${Math.floor(diff/3600)} Std`;
    const d = new Date(iso);
    return `${d.getDate()}.${d.getMonth()+1}. ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  function starsHTML(avg) {
    let h = '<span class="stars">';
    for (let i = 1; i <= 5; i++) h += `<span class="s ${i <= Math.round(avg) ? "" : "off"}">★</span>`;
    return h + "</span>";
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Modal ----------
  function openModal(html) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-overlay"><div class="modal"><div class="modal-grip"></div>${html}</div></div>`;
    const overlay = $(".modal-overlay", root);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    return root;
  }
  function closeModal() { $("#modalRoot").innerHTML = ""; }
  window.closeModal = closeModal;

  // ---------- Data layer ----------
  async function loadMembers() {
    const { data } = await sb.from("members").select("*").order("name");
    state.members = data || [];
    return state.members;
  }

  async function loadTermine() {
    const { data } = await sb.from("termine")
      .select("*, koch:members(id,name,avatar_url)")
      .order("datum");
    return data || [];
  }

  async function loadRatingsMap() {
    // termin_id -> { avg, count }
    const { data } = await sb.from("bewertungen").select("termin_id,punkte");
    const map = {};
    (data || []).forEach((r) => {
      const e = map[r.termin_id] || (map[r.termin_id] = { sum: 0, count: 0 });
      e.sum += r.punkte; e.count++;
    });
    Object.values(map).forEach((e) => (e.avg = e.sum / e.count));
    return map;
  }

  async function loadGerichteMap() {
    const { data } = await sb.from("gerichte").select("*");
    const map = {};
    (data || []).forEach((g) => { if (!map[g.termin_id]) map[g.termin_id] = g; });
    return map;
  }

  // ---------- Identity ----------
  function saveMe(m) { state.me = m; localStorage.setItem("kpt_me", JSON.stringify({ id: m.id, name: m.name })); }

  async function initIdentity() {
    await loadMembers();
    const saved = JSON.parse(localStorage.getItem("kpt_me") || "null");
    if (saved) {
      const fresh = state.members.find((m) => m.id === saved.id);
      if (fresh) { state.me = fresh; return true; }
    }
    return false;
  }

  function renderIdentity() {
    $("#splash").classList.add("hidden");
    $("#app").classList.add("hidden");
    $("#identity").classList.remove("hidden");
    const list = $("#identityList");
    list.innerHTML = state.members.map((m) =>
      `<button class="identity-pick" data-id="${m.id}">${avatar(m, "sm")}<span>${esc(m.name)}</span></button>`
    ).join("") || '<p class="muted">Noch keine Mitglieder – leg unten das erste an.</p>';

    list.querySelectorAll(".identity-pick").forEach((b) =>
      b.addEventListener("click", () => {
        const m = state.members.find((x) => x.id === b.dataset.id);
        saveMe(m); enterApp();
      }));

    const addBtn = $("#addMemberBtn"), input = $("#newMemberName");
    const add = async () => {
      const name = input.value.trim();
      if (!name) return;
      addBtn.disabled = true;
      const { data, error } = await sb.from("members").insert({ name }).select().single();
      addBtn.disabled = false;
      if (error) { toast(error.code === "23505" ? "Name existiert schon" : "Fehler"); return; }
      await loadMembers(); saveMe(data); enterApp();
    };
    addBtn.onclick = add;
    input.onkeydown = (e) => { if (e.key === "Enter") add(); };
  }

  // ---------- App entry ----------
  function enterApp() {
    $("#splash").classList.add("hidden");
    $("#identity").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#topbarAvatar").outerHTML = avatar(state.me, "sm").replace('class="avatar', 'id="topbarAvatar" class="avatar');
    if (!state.appBound) {
      document.querySelectorAll(".tab").forEach((t) =>
        t.addEventListener("click", () => switchTab(t.dataset.view)));
      $("#profileBtn").onclick = renderProfile;
      state.appBound = true;
    }
    switchTab("termine");
  }

  function switchTab(name) {
    state.currentTab = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (state.chatTimer) { clearInterval(state.chatTimer); state.chatTimer = null; }
    view.scrollTop = 0; window.scrollTo(0, 0);
    if (name === "termine") renderTermine();
    else if (name === "rezepte") renderRezepte();
    else if (name === "ranking") renderRanking();
    else if (name === "chat") renderChat();
  }

  function loading() { view.innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:12px"></div><div class="skeleton" style="height:90px;margin-bottom:12px"></div><div class="skeleton" style="height:90px"></div>'; }

  // ========================================================
  //  VIEW: TERMINE
  // ========================================================
  async function renderTermine() {
    loading();
    const [termine, gerichte, ratings] = await Promise.all([loadTermine(), loadGerichteMap(), loadRatingsMap()]);
    const today = todayISO();
    const upcoming = termine.filter((t) => t.datum >= today);
    const past = termine.filter((t) => t.datum < today).reverse();
    const next = upcoming[0];

    let anmeldungen = [];
    if (next) {
      const { data } = await sb.from("anmeldungen")
        .select("*, member:members(id,name,avatar_url)").eq("termin_id", next.id);
      anmeldungen = data || [];
    }

    let html = `<h1 class="page-title">Termine</h1>
      <p class="page-sub">Jeden Freitag kocht eine:r für alle.</p>`;

    if (next) {
      const zu = anmeldungen.filter((a) => a.status === "zugesagt");
      const myA = anmeldungen.find((a) => a.member_id === state.me.id);
      const gericht = gerichte[next.id];
      const d = parseDate(next.datum);
      html += `<div class="card next-card tappable" data-termin="${next.id}">
        <div class="next-label">Nächster Termin</div>
        <div class="top" style="margin-top:8px">
          <div class="date-badge"><span class="d">${d.getDate()}</span><span class="m">${MONTHS[d.getMonth()]}</span></div>
          <div class="grow">
            ${gericht ? `<div class="next-dish">${esc(gericht.name)}</div>` : `<div class="next-dish">Menü offen</div>`}
            <div class="muted">${next.koch ? "👨‍🍳 " + esc(next.koch.name) : "Noch kein Chefkoch"}</div>
          </div>
        </div>
        <hr class="divider"/>
        <div class="spread">
          <div class="row">
            <div class="attend-avatars">${zu.slice(0,5).map((a)=>avatar(a.member,"sm")).join("")}</div>
            <strong>${zu.length}</strong><span class="muted">${zu.length === 1 ? "zugesagt" : "zugesagt"}</span>
          </div>
        </div>
        <div class="attend-bar">
          <button class="btn ${myA?.status==='zugesagt'?'btn-green':'btn-ghost'} grow" data-an="${next.id}">${myA?.status==='zugesagt'?'✓ Ich komme':'Zusagen'}</button>
          <button class="btn ${myA?.status==='abgesagt'?'btn-red':'btn-ghost'} grow" data-ab="${next.id}">${myA?.status==='abgesagt'?'✕ Abgesagt':'Absagen'}</button>
        </div>
      </div>`;
    }

    html += `<div class="spread" style="margin:20px 4px 10px"><span class="section-title" style="margin:0">Geplant</span>
      <button class="btn btn-sm btn-ghost" id="addTerminBtn">+ Termin</button></div>`;
    const rest = upcoming.slice(1);
    if (!rest.length && !next) html += `<div class="empty"><span class="emoji">📭</span>Noch keine Termine geplant.</div>`;
    rest.forEach((t) => { html += terminRow(t, gerichte[t.id], ratings[t.id]); });

    if (past.length) {
      html += `<div class="section-title">Vergangen</div>`;
      past.forEach((t) => { html += terminRow(t, gerichte[t.id], ratings[t.id]); });
    }

    view.innerHTML = html;
    bindTerminActions();
  }

  function terminRow(t, gericht, rating) {
    const d = parseDate(t.datum);
    return `<div class="card termin-card tappable" data-termin="${t.id}">
      <div class="top">
        <div class="date-badge"><span class="d">${d.getDate()}</span><span class="m">${MONTHS[d.getMonth()]}</span></div>
        <div class="grow">
          <div style="font-weight:600">${gericht ? esc(gericht.name) : (t.koch ? "Menü noch offen" : "Freier Termin")}</div>
          <div class="muted" style="font-size:14px">${t.koch ? "👨‍🍳 " + esc(t.koch.name) : "Kein Chefkoch eingetragen"}</div>
          ${rating ? `<div style="margin-top:4px">${starsHTML(rating.avg)} <span class="muted" style="font-size:12px">${rating.avg.toFixed(1)} · ${rating.count}</span></div>` : ""}
        </div>
        <span class="muted" style="font-size:20px">›</span>
      </div>
    </div>`;
  }

  function bindTerminActions() {
    view.querySelectorAll("[data-termin]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-an],[data-ab]")) return;
        renderTerminDetail(el.dataset.termin);
      }));
    view.querySelectorAll("[data-an]").forEach((b) => b.addEventListener("click", () => setAnmeldung(b.dataset.an, "zugesagt")));
    view.querySelectorAll("[data-ab]").forEach((b) => b.addEventListener("click", () => setAnmeldung(b.dataset.ab, "abgesagt")));
    const add = $("#addTerminBtn");
    if (add) add.onclick = addTerminModal;
  }

  async function setAnmeldung(terminId, status) {
    const { error } = await sb.from("anmeldungen")
      .upsert({ termin_id: terminId, member_id: state.me.id, status, updated_at: new Date().toISOString() },
              { onConflict: "termin_id,member_id" });
    if (error) { toast("Fehler beim Speichern"); return; }
    toast(status === "zugesagt" ? "Du bist dabei! 🍽️" : "Abgemeldet");
    if (state.currentTab === "termine") renderTermine();
  }

  function addTerminModal() {
    // Standard: nächster Freitag
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() + ((5 - day + 7) % 7 || 7));
    const def = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    openModal(`<h2>Neuer Termin</h2><p class="muted" style="margin-bottom:14px">Wähle das Datum (meist ein Freitag).</p>
      <div class="field"><label>Datum</label><input type="date" id="mDate" value="${def}"/></div>
      <button class="btn btn-primary btn-block" id="mSave">Termin anlegen</button>`);
    $("#mSave").onclick = async () => {
      const datum = $("#mDate").value;
      if (!datum) return;
      const { error } = await sb.from("termine").insert({ datum });
      if (error) { toast(error.code === "23505" ? "Termin existiert schon" : "Fehler"); return; }
      closeModal(); toast("Termin angelegt"); renderTermine();
    };
  }

  // ========================================================
  //  VIEW: TERMIN-DETAIL
  // ========================================================
  async function renderTerminDetail(id) {
    loading();
    const { data: t } = await sb.from("termine").select("*, koch:members(id,name,avatar_url)").eq("id", id).single();
    if (!t) { switchTab("termine"); return; }
    const [{ data: gerichte }, { data: bilder }, { data: bew }, { data: anm }] = await Promise.all([
      sb.from("gerichte").select("*").eq("termin_id", id),
      sb.from("bilder").select("*").eq("termin_id", id).order("created_at", { ascending: false }),
      sb.from("bewertungen").select("*, member:members(name)").eq("termin_id", id),
      sb.from("anmeldungen").select("*, member:members(id,name,avatar_url)").eq("termin_id", id),
    ]);
    const gericht = gerichte?.[0];
    const isPast = t.datum < todayISO();
    const isCook = t.koch_id === state.me.id;
    const myRating = bew?.find((b) => b.member_id === state.me.id);
    const avg = bew?.length ? bew.reduce((s, b) => s + b.punkte, 0) / bew.length : 0;
    const zu = (anm || []).filter((a) => a.status === "zugesagt");
    const ab = (anm || []).filter((a) => a.status === "abgesagt");
    const myA = (anm || []).find((a) => a.member_id === state.me.id);

    let h = `<a class="back-link" id="backLink">‹ Termine</a>
      <h1 class="page-title">${fmtLong(t.datum)}</h1>
      <p class="page-sub">${isPast ? "Stattgefunden" : "Geplant"} · ${t.koch ? "Chefkoch: " + esc(t.koch.name) : "noch kein Chefkoch"}</p>`;

    // Koch-Eintragung
    h += `<div class="card"><div class="spread"><div class="row">${t.koch ? avatar(t.koch,"md") : '<span class="avatar avatar-md" style="background:#d9cdba">?</span>'}
      <div class="stack"><strong>${t.koch ? esc(t.koch.name) : "Kein Chefkoch"}</strong><span class="muted" style="font-size:13px">Chefkoch</span></div></div>`;
    if (!isPast) {
      if (!t.koch_id) h += `<button class="btn btn-primary btn-sm" id="becomeCook">Eintragen</button>`;
      else if (isCook) h += `<button class="btn btn-ghost btn-sm" id="leaveCook">Austragen</button>`;
    }
    h += `</div></div>`;

    // Gericht / Rezept
    h += `<div class="section-title">Gericht & Rezept</div>`;
    if (gericht) {
      h += `<div class="card"><div class="spread"><h2 style="font-size:20px">${esc(gericht.name)}</h2>
        ${isCook ? `<button class="btn btn-ghost btn-sm" id="editRecipe">Bearbeiten</button>` : ""}</div>`;
      if (gericht.beschreibung) h += `<p class="muted" style="margin-top:6px">${esc(gericht.beschreibung)}</p>`;
      if (gericht.zutaten) h += `<div class="section-title" style="margin:14px 0 6px">Zutaten</div><ul class="ingredients">${gericht.zutaten.split(/[\n,]+/).filter(x=>x.trim()).map(z=>`<li>${esc(z.trim())}</li>`).join("")}</ul>`;
      if (gericht.zubereitung) h += `<div class="section-title" style="margin:14px 0 6px">Zubereitung</div><ol class="steps">${gericht.zubereitung.split(/\n+/).filter(x=>x.trim()).map(s=>`<li>${esc(s.trim())}</li>`).join("")}</ol>`;
      h += `</div>`;
    } else {
      h += `<div class="card center"><p class="muted">Noch kein Rezept hinterlegt.</p>${isCook ? `<button class="btn btn-primary btn-sm" id="addRecipe" style="margin-top:10px">Rezept hinzufügen</button>` : ""}</div>`;
    }

    // Bewertung (nur vergangene)
    if (isPast) {
      h += `<div class="section-title">Bewertung</div><div class="card">
        <div class="spread"><div>${starsHTML(avg)} <strong>${avg ? avg.toFixed(1) : "–"}</strong></div>
        <span class="muted">${bew?.length || 0} Stimmen</span></div>
        <hr class="divider"/>
        <p class="muted" style="font-size:13px;margin-bottom:6px">Deine Bewertung:</p>
        <div class="stars star-input" id="rateInput" data-termin="${id}">
          ${[1,2,3,4,5].map((i)=>`<span class="s ${myRating && i<=myRating.punkte?'on':''}" data-v="${i}">★</span>`).join("")}
        </div></div>`;
    }

    // Wer kommt
    h += `<div class="section-title">Wer ist dabei? (${zu.length})</div><div class="card">`;
    if (!isPast) {
      h += `<div class="attend-bar" style="margin:0 0 12px">
        <button class="btn ${myA?.status==='zugesagt'?'btn-green':'btn-ghost'} grow" data-an="${id}">${myA?.status==='zugesagt'?'✓ Ich komme':'Zusagen'}</button>
        <button class="btn ${myA?.status==='abgesagt'?'btn-red':'btn-ghost'} grow" data-ab="${id}">${myA?.status==='abgesagt'?'✕ Abgesagt':'Absagen'}</button></div>`;
    }
    h += zu.length ? `<div class="row wrap">${zu.map((a)=>`<span class="chip">${avatar(a.member,"sm")}${esc(a.member.name)}</span>`).join("")}</div>` : `<p class="muted">Noch keine Zusagen.</p>`;
    if (ab.length) h += `<p class="muted" style="font-size:13px;margin-top:10px">Abgesagt: ${ab.map((a)=>esc(a.member.name)).join(", ")}</p>`;
    h += `</div>`;

    // Galerie
    h += `<div class="section-title">Bildergalerie</div><div class="gallery">
      <label class="gtile gtile-add">+<input type="file" accept="image/*" id="photoInput" hidden></label>
      ${(bilder||[]).map((b)=>`<img src="${esc(b.url)}" loading="lazy" data-img="${esc(b.url)}"/>`).join("")}
    </div>`;

    view.innerHTML = h;

    $("#backLink").onclick = () => switchTab("termine");
    const bc = $("#becomeCook"); if (bc) bc.onclick = () => setCook(id, state.me.id);
    const lc = $("#leaveCook"); if (lc) lc.onclick = () => setCook(id, null);
    const ar = $("#addRecipe"); if (ar) ar.onclick = () => recipeModal(id, null);
    const er = $("#editRecipe"); if (er) er.onclick = () => recipeModal(id, gericht);
    view.querySelectorAll("[data-an]").forEach((b)=>b.onclick = async()=>{ await setAnmeldung(id,"zugesagt"); renderTerminDetail(id); });
    view.querySelectorAll("[data-ab]").forEach((b)=>b.onclick = async()=>{ await setAnmeldung(id,"abgesagt"); renderTerminDetail(id); });
    const ri = $("#rateInput");
    if (ri) ri.querySelectorAll(".s").forEach((s)=>s.onclick = ()=>rate(id, Number(s.dataset.v)));
    const pi = $("#photoInput");
    if (pi) pi.onchange = () => uploadPhoto(id, pi.files[0]);
    view.querySelectorAll("[data-img]").forEach((im)=>im.onclick = ()=>openModal(`<img src="${im.dataset.img}" style="width:100%;border-radius:14px"/>`));
  }

  async function setCook(terminId, cookId) {
    const { error } = await sb.from("termine").update({ koch_id: cookId }).eq("id", terminId);
    if (error) { toast("Fehler"); return; }
    toast(cookId ? "Du bist Chefkoch! 👨‍🍳" : "Ausgetragen");
    renderTerminDetail(terminId);
  }

  async function rate(terminId, punkte) {
    const { error } = await sb.from("bewertungen")
      .upsert({ termin_id: terminId, member_id: state.me.id, punkte }, { onConflict: "termin_id,member_id" });
    if (error) { toast("Fehler"); return; }
    toast(`${punkte} Sterne – danke!`);
    renderTerminDetail(terminId);
  }

  function recipeModal(terminId, gericht) {
    openModal(`<h2>${gericht ? "Rezept bearbeiten" : "Rezept hinzufügen"}</h2>
      <div class="field"><label>Name des Gerichts</label><input id="rName" value="${esc(gericht?.name||"")}" placeholder="z.B. Thai Green Curry"/></div>
      <div class="field"><label>Kurzbeschreibung</label><input id="rDesc" value="${esc(gericht?.beschreibung||"")}" placeholder="optional"/></div>
      <div class="field"><label>Zutaten <span class="muted">(je Zeile oder mit Komma)</span></label><textarea id="rIng" placeholder="500g Hähnchen&#10;2 Dosen Kokosmilch">${esc(gericht?.zutaten||"")}</textarea></div>
      <div class="field"><label>Zubereitung <span class="muted">(je Schritt eine Zeile)</span></label><textarea id="rSteps" placeholder="Currypaste anrösten&#10;Kokosmilch dazugeben">${esc(gericht?.zubereitung||"")}</textarea></div>
      <button class="btn btn-primary btn-block" id="rSave">Speichern</button>`);
    $("#rSave").onclick = async () => {
      const payload = {
        termin_id: terminId,
        name: $("#rName").value.trim(),
        beschreibung: $("#rDesc").value.trim() || null,
        zutaten: $("#rIng").value.trim() || null,
        zubereitung: $("#rSteps").value.trim() || null,
      };
      if (!payload.name) { toast("Name fehlt"); return; }
      const q = gericht ? sb.from("gerichte").update(payload).eq("id", gericht.id) : sb.from("gerichte").insert(payload);
      const { error } = await q;
      if (error) { toast("Fehler"); return; }
      closeModal(); toast("Rezept gespeichert"); renderTerminDetail(terminId);
    };
  }

  async function uploadPhoto(terminId, file) {
    if (!file) return;
    toast("Lade Foto hoch…");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `termin/${terminId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (upErr) { toast("Upload fehlgeschlagen"); return; }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const { error } = await sb.from("bilder").insert({ termin_id: terminId, url: pub.publicUrl, storage_path: path, uploaded_by: state.me.id });
    if (error) { toast("Fehler"); return; }
    toast("Foto hinzugefügt 📸"); renderTerminDetail(terminId);
  }

  // ========================================================
  //  VIEW: REZEPTE
  // ========================================================
  async function renderRezepte() {
    loading();
    const { data: gerichte } = await sb.from("gerichte")
      .select("*, termin:termine(datum, koch:members(name))").order("created_at", { ascending: false });
    const ratings = await loadRatingsMap();

    let h = `<h1 class="page-title">Rezepte</h1><p class="page-sub">Unser Archiv aller Menüs.</p>
      <div class="field"><input id="recipeSearch" placeholder="🔍 Suchen nach Gericht oder Koch…"/></div>
      <div id="recipeList"></div>`;
    view.innerHTML = h;

    const list = $("#recipeList");
    const draw = (q = "") => {
      const ql = q.toLowerCase();
      const items = (gerichte || []).filter((g) =>
        g.name.toLowerCase().includes(ql) || (g.termin?.koch?.name || "").toLowerCase().includes(ql));
      if (!items.length) { list.innerHTML = `<div class="empty"><span class="emoji">🍳</span>Keine Rezepte gefunden.</div>`; return; }
      list.innerHTML = items.map((g) => {
        const r = ratings[g.termin_id];
        return `<div class="card tappable" data-termin="${g.termin_id}">
          <div class="spread"><div class="grow">
            <strong style="font-size:17px">${esc(g.name)}</strong>
            <div class="muted" style="font-size:13px;margin-top:2px">${g.termin?.koch?.name ? "👨‍🍳 "+esc(g.termin.koch.name)+" · " : ""}${g.termin?.datum ? fmtDM(g.termin.datum) : ""}</div>
            ${r ? `<div style="margin-top:4px">${starsHTML(r.avg)} <span class="muted" style="font-size:12px">${r.avg.toFixed(1)}</span></div>` : ""}
          </div><span class="muted" style="font-size:20px">›</span></div>
        </div>`;
      }).join("");
      list.querySelectorAll("[data-termin]").forEach((el)=>el.onclick = ()=>renderTerminDetail(el.dataset.termin));
    };
    draw();
    $("#recipeSearch").oninput = (e) => draw(e.target.value);
  }

  // ========================================================
  //  VIEW: RANKING & STATISTIK
  // ========================================================
  async function renderRanking() {
    loading();
    const [termine, gerichte, ratings] = await Promise.all([loadTermine(), loadGerichteMap(), loadRatingsMap()]);
    const year = new Date().getFullYear();

    // Bestenliste: Gerichte mit Bewertungen
    const rated = termine
      .filter((t) => ratings[t.id] && gerichte[t.id])
      .map((t) => ({ t, g: gerichte[t.id], r: ratings[t.id] }))
      .sort((a, b) => b.r.avg - a.r.avg || b.r.count - a.r.count);
    const best = rated[0];

    // Koch-Counter (dieses Jahr)
    const counter = {};
    state.members.forEach((m) => (counter[m.id] = { m, count: 0, last: null }));
    termine.forEach((t) => {
      if (t.koch_id && counter[t.koch_id] && t.datum.startsWith(String(year)) && t.status === "stattgefunden") counter[t.koch_id].count++;
      if (t.koch_id && counter[t.koch_id] && (!counter[t.koch_id].last || t.datum > counter[t.koch_id].last)) counter[t.koch_id].last = t.datum;
    });
    const cooks = Object.values(counter).sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...cooks.map((c) => c.count));

    // Fairness: am längsten nicht / nie gekocht
    const fairness = [...Object.values(counter)].sort((a, b) => {
      if (!a.last && !b.last) return 0; if (!a.last) return -1; if (!b.last) return 1;
      return a.last.localeCompare(b.last);
    }).slice(0, 4);

    const totalTermine = termine.filter((t) => t.status === "stattgefunden").length;

    let h = `<h1 class="page-title">Ranking</h1><p class="page-sub">Die besten Gerichte & faire Verteilung.</p>`;

    if (best) {
      h += `<div class="card podium-card tappable" data-termin="${best.t.id}">
        <div class="row"><span class="crown">👑</span><div class="grow">
          <div class="next-label" style="opacity:.8">Bestes Gericht aller Zeiten</div>
          <div class="next-dish" style="color:#4a2d05">${esc(best.g.name)}</div>
          <div class="row" style="gap:6px">${starsHTML(best.r.avg)}<strong>${best.r.avg.toFixed(1)}</strong>
          <span style="opacity:.8">· ${best.t.koch ? esc(best.t.koch.name) : "?"}</span></div>
        </div></div></div>`;
    } else {
      h += `<div class="empty"><span class="emoji">🏆</span>Noch keine bewerteten Gerichte.</div>`;
    }

    if (rated.length > 1) {
      h += `<div class="section-title">Top-Gerichte</div><div class="card">`;
      rated.slice(1, 6).forEach((x, i) => {
        h += `<div class="rank-item" data-termin="${x.t.id}" style="cursor:pointer">
          <div class="rank-num">${i + 2}</div>
          <div class="grow"><strong>${esc(x.g.name)}</strong><div class="muted" style="font-size:12px">${x.t.koch ? esc(x.t.koch.name) : ""}</div></div>
          <div>${starsHTML(x.r.avg)} <span class="muted" style="font-size:12px">${x.r.avg.toFixed(1)}</span></div>
        </div>`;
      });
      h += `</div>`;
    }

    // Statistik
    h += `<div class="section-title">Statistik</div>
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-box"><div class="stat-num">${totalTermine}</div><div class="stat-lbl">Koch-Abende ${year}+</div></div>
        <div class="stat-box"><div class="stat-num">${state.members.length}</div><div class="stat-lbl">Mitglieder</div></div>
      </div>`;

    h += `<div class="card"><div class="section-title" style="margin-top:0">Koch-Counter ${year}</div>`;
    cooks.filter((c) => c.count > 0).forEach((c) => {
      h += `<div class="bar-row"><span style="width:78px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.m.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(c.count/maxCount)*100}%"></div></div>
        <strong style="width:20px;text-align:right">${c.count}</strong></div>`;
    });
    if (!cooks.some((c) => c.count > 0)) h += `<p class="muted">Dieses Jahr wurde noch nicht gekocht.</p>`;
    h += `</div>`;

    h += `<div class="card"><div class="section-title" style="margin-top:0">⚖️ Wer wäre mal wieder dran?</div>`;
    fairness.forEach((c) => {
      h += `<div class="rank-item"><div class="grow row">${avatar(c.m,"sm")}<strong>${esc(c.m.name)}</strong></div>
        <span class="chip ${c.last ? "" : "chip-primary"}">${c.last ? "zuletzt " + fmtDM(c.last) : "noch nie 🙈"}</span></div>`;
    });
    h += `</div>`;

    view.innerHTML = h;
    view.querySelectorAll("[data-termin]").forEach((el)=>el.onclick = ()=>renderTerminDetail(el.dataset.termin));
  }

  // ========================================================
  //  VIEW: CHAT
  // ========================================================
  async function renderChat() {
    view.innerHTML = `<div class="chat-wrap">
      <div class="chat-scroll" id="chatScroll"><div class="skeleton" style="height:50px"></div></div>
      <form class="chat-input" id="chatForm">
        <input id="chatText" placeholder="Nachricht an die Gruppe…" autocomplete="off"/>
        <button type="submit">➤</button>
      </form></div>`;

    const scroll = $("#chatScroll");
    const draw = async (firstLoad) => {
      if (!document.body.contains(scroll)) return;
      const { data } = await sb.from("chat_messages")
        .select("*, member:members(name,avatar_url)").order("created_at").limit(200);
      const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
      scroll.innerHTML = (data || []).map((m) => {
        const me = m.member_id === state.me.id;
        return `<div class="msg ${me ? "me" : ""}">
          <div class="bubble">${esc(m.text)}</div>
          <div class="meta">${me ? "Du" : esc(m.member?.name || "?")} · ${relTime(m.created_at)}</div>
        </div>`;
      }).join("") || `<div class="empty"><span class="emoji">💬</span>Noch keine Nachrichten – sag Hallo!</div>`;
      if (firstLoad || atBottom) scroll.scrollTop = scroll.scrollHeight;
    };
    await draw(true);

    if (state.chatTimer) clearInterval(state.chatTimer);
    state.chatTimer = setInterval(() => { if (state.currentTab === "chat") draw(false); }, 4000);

    $("#chatForm").onsubmit = async (e) => {
      e.preventDefault();
      const input = $("#chatText"); const text = input.value.trim();
      if (!text) return;
      input.value = "";
      const { error } = await sb.from("chat_messages").insert({ member_id: state.me.id, text });
      if (error) { toast("Konnte nicht senden"); return; }
      draw(true);
    };
  }

  // ========================================================
  //  VIEW: PROFIL
  // ========================================================
  async function renderProfile() {
    const termine = await loadTermine();
    const year = new Date().getFullYear();
    const myCooks = termine.filter((t) => t.koch_id === state.me.id && t.status === "stattgefunden").length;
    const myUpcoming = termine.filter((t) => t.koch_id === state.me.id && t.datum >= todayISO()).length;

    openModal(`<h2>Profil</h2>
      <div class="center" style="margin:10px 0 18px">
        <label style="cursor:pointer;display:inline-block;position:relative">
          ${avatar(state.me, "lg")}
          <input type="file" accept="image/*" id="avInput" hidden>
          <span class="chip chip-primary" style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%)">ändern</span>
        </label>
        <h2 style="margin-top:14px">${esc(state.me.name)}</h2>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-num">${myCooks}</div><div class="stat-lbl">Mal gekocht ${year}</div></div>
        <div class="stat-box"><div class="stat-num">${myUpcoming}</div><div class="stat-lbl">Anstehende Einsätze</div></div>
      </div>
      <button class="btn btn-outline btn-block" id="switchUser" style="margin-top:18px">Benutzer wechseln</button>`);

    $("#avInput").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      toast("Lade Profilbild…");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `avatar/${state.me.id}.${ext}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true });
      if (upErr) { toast("Upload fehlgeschlagen"); return; }
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
      const url = pub.publicUrl + "?t=" + Date.now();
      const { error } = await sb.from("members").update({ avatar_url: url }).eq("id", state.me.id);
      if (error) { toast("Fehler"); return; }
      state.me.avatar_url = url;
      await loadMembers();
      const fresh = state.members.find((m)=>m.id===state.me.id); if (fresh) state.me = fresh;
      toast("Profilbild aktualisiert");
      closeModal(); renderProfile();
      $("#topbarAvatar").outerHTML = avatar(state.me, "sm").replace('class="avatar', 'id="topbarAvatar" class="avatar');
    };
    $("#switchUser").onclick = () => {
      localStorage.removeItem("kpt_me"); state.me = null;
      closeModal(); loadMembers().then(renderIdentity);
    };
  }

  // ---------- Boot ----------
  (async function boot() {
    try {
      const ok = await initIdentity();
      if (ok) enterApp(); else renderIdentity();
    } catch (e) {
      console.error(e);
      $("#splash").innerHTML = `<div class="empty"><span class="emoji">⚠️</span>Verbindung fehlgeschlagen.<br/><small>${esc(e.message||e)}</small></div>`;
    }
  })();
})();
