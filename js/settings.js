/* =========================================================================
   ATLAS Utility Web — settings.js
   User-configurable defaults + editable reference data, persisted in
   localStorage (Feature #5).

   Two things live here:
     1) Defaults the "Generate packet" action uses (pre-selected documents,
        signer, unit system) plus general document defaults (contract, purpose).
     2) Editable REFERENCE DATA — the team can add their own signers and SLI
        freight forwarders without a code change/redeploy.

   How the reference-data editing stays non-invasive: every tool reads the
   global SIGNERS array and SLI_LOCATIONS object at render time. We snapshot the
   built-ins once, then rebuild those same globals in place (built-ins + the
   user's custom entries) at startup and whenever settings change — so CI/PL
   signer pickers, the SLI freight/forwarder pickers and PO's vendor address
   lookup all see custom entries automatically, with no tool changes. MCT uses
   its own template-baked signer list and is intentionally left alone.

   Storage is per-browser. The secret purple theme is intentionally NOT exposed
   here — it stays an easter egg.
   ========================================================================= */

const AtlasSettings = {
  KEY: "atlas.settings",
  _data: null,

  defaults() {
    return {
      packetDocs: { ci: true, pl: true, placards: true, ipc: false, sli: false },
      packetSigner: "",   // Default signer NAME ("" = none set)
      lastSigner: "",     // signer last picked on the CI / PL / Packet (used when no default is set)
      packetUnit: "imperial",
      defaultContract: (typeof DEFAULT_CONTRACT_NO !== "undefined" ? DEFAULT_CONTRACT_NO : ""),
      defaultPurpose: (typeof PURPOSE_CHOICES !== "undefined" ? PURPOSE_CHOICES[0] : "Donation"),
      customSigners: [],      // [{name, title}]
      customForwarders: [],   // [{name, address}]
      customVendors: [],      // [{name, address, abbrev}] — Property PO vendor list
      autoSaveForms: true,    // persist in-progress tool form inputs
      copDailyPreview: false, // COP daily-update entry/editing shown before the ATLAS API exists (browser-only, temporary)
      dashInfo: true,         // Procurement / Property dashboards: show the (i) "how this is calculated" bubbles
      dashDrop: true,         // Dashboard: one UDQ drop box under the tab bar; tabs light up as their UDQ loads (off = connected to ATLAS)
      packetSliFreight: "",   // last-used SLI freight location (packet default)
      packetSliForward: "",   // last-used SLI forwarding agent (packet default)
      hardBlock: { enabled: false, codes: {} }, // Validation gate (Feature #3)
      railCollapsed: false,   // left tool-rail collapsed state (persisted)
      loaderView: "show",     // "show" = compact UDQ drop zone visible in main (default);
                              // "hide" = no main drop zone (drop into the Fetch popover)
      udqIds: {},             // per-env overrides for ATLAS UDQ IDs: { qa:{...}, prod:{...} }.
                              // Blank/absent => use the hard-coded default in json_udq.js.
      udqApi: {},             // per-env override for the ATLAS API base URL: { qa:"...", prod:"..." }.
                              // Blank/absent => use ATLAS_UDQ_CONFIG's built-in base in json_udq.js.
      dailyStatus: {},        // per-env COP daily-update save settings: { qa:{ url, editUrl, requestIdField }, ... }.
                              // Blank/absent => ATLAS_UDQ_CONFIG.dailyStatus in json_udq.js.
    };
  },

  load() {
    if (this._data) return this._data;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.KEY) || "{}") || {}; } catch (e) { saved = {}; }
    const d = this.defaults();
    this._data = Object.assign(d, saved);
    this._data.packetDocs = Object.assign(this.defaults().packetDocs, saved.packetDocs || {});
    if (!Array.isArray(this._data.customSigners)) this._data.customSigners = [];
    if (!Array.isArray(this._data.customForwarders)) this._data.customForwarders = [];
    if (!Array.isArray(this._data.customVendors)) this._data.customVendors = [];
    const hb = (saved.hardBlock && typeof saved.hardBlock === "object") ? saved.hardBlock : {};
    this._data.hardBlock = { enabled: !!hb.enabled, codes: (hb.codes && typeof hb.codes === "object") ? hb.codes : {} };
    if (!this._data.udqIds || typeof this._data.udqIds !== "object") this._data.udqIds = {};
    if (!this._data.udqApi || typeof this._data.udqApi !== "object") this._data.udqApi = {};
    if (!this._data.dailyStatus || typeof this._data.dailyStatus !== "object") this._data.dailyStatus = {};
    return this._data;
  },

  get() { return this.load(); },

  save(patch) {
    const d = this.load();
    Object.assign(d, patch || {});
    if (patch && patch.packetDocs) d.packetDocs = Object.assign({}, d.packetDocs, patch.packetDocs);
    try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) { /* storage off — keep in memory */ }
    this._data = d;
    return d;
  },

  reset() {
    this._data = this.defaults();
    try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
    return this._data;
  },
};

/* ---- snapshot the built-in reference data ONCE, before any mutation ---- */
const BUILTIN_SIGNERS = (typeof SIGNERS !== "undefined") ? SIGNERS.map((s) => ({ ...s })) : [];
const BUILTIN_SLI_LOCATIONS = (typeof SLI_LOCATIONS !== "undefined") ? { ...SLI_LOCATIONS } : {};

/** Rebuild SIGNERS and SLI_LOCATIONS in place as built-ins + custom entries.
 *  Mutates the existing const structures so every consumer sees the result. */
function applyReferenceData() {
  try {
    const s = AtlasSettings.get();
    if (typeof SIGNERS !== "undefined") {
      SIGNERS.length = 0;
      for (const b of BUILTIN_SIGNERS) SIGNERS.push({ name: b.name, title: b.title });
      for (const c of (s.customSigners || [])) {
        if (c && (c.name || "").trim()) SIGNERS.push({ name: c.name.trim(), title: (c.title || "").trim() });
      }
    }
    if (typeof SLI_LOCATIONS !== "undefined") {
      for (const k of Object.keys(SLI_LOCATIONS)) delete SLI_LOCATIONS[k];
      for (const k of Object.keys(BUILTIN_SLI_LOCATIONS)) SLI_LOCATIONS[k] = BUILTIN_SLI_LOCATIONS[k];
      for (const c of (s.customForwarders || [])) {
        if (c && (c.name || "").trim()) SLI_LOCATIONS[c.name.trim()] = (c.address || "").trim();
      }
    }
  } catch (e) { /* never let reference-data assembly break the app */ }
}

/* ---- shared signer helpers (used by Settings + the packet tool) ---- */

function atlasSignerOptions(selectedName) {
  let html = `<option value="">(leave blank)</option>`;
  (typeof SIGNERS !== "undefined" ? SIGNERS : []).forEach((s) => {
    const sel = s.name === selectedName ? "selected" : "";
    html += `<option value="${esc(s.name)}" ${sel}>${esc(s.name)} — ${esc(s.title)}</option>`;
  });
  return html;
}

function atlasResolveSigner(name) {
  if (!name) return null;
  return (typeof SIGNERS !== "undefined" ? SIGNERS : []).find((s) => s.name === name) || null;
}

/** The signer a CI / Packing List / Packet starts with: the Settings "Default
 *  signer" when one is set; otherwise whoever was picked last on any of those
 *  documents (any shipment). "" = start blank. */
function atlasStartSignerName() {
  const s = AtlasSettings.get();
  if (s.packetSigner && atlasResolveSigner(s.packetSigner)) return s.packetSigner;
  return atlasResolveSigner(s.lastSigner) ? s.lastSigner : "";
}

/** Remember the signer just picked on a document ("" = left blank). */
function atlasRememberSigner(name) {
  AtlasSettings.save({ lastSigner: name || "" });
}

/* =========================================================================
   Settings modal UI
   ========================================================================= */

/* Settings window (2.9.10 look): sections listed down the left, one section showing at a time on the
   right; every explanatory line is an "i" you hover (see _setDecorate). Less is more. */
const SETTINGS_STYLE = `
  .settings-overlay{position:fixed;inset:0;background:rgba(12,18,28,.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:24px 16px;}
  .settings-dialog{--s-blue:#1e5aa8;--s-soft:color-mix(in srgb,#1e5aa8 5%,var(--card));background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:16px;
    width:min(880px,100%);height:min(680px,calc(100vh - 48px));display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(10,18,40,.35);
    font-family:Inter,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-size:13px;}
  body.theme-dark .settings-dialog{--s-blue:#8fbaf0;}
  .settings-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px 12px;border-bottom:1px solid var(--line);}
  .settings-dialog header h2{margin:0;font:650 17px/1.2 inherit;letter-spacing:-.01em;text-transform:none;}
  .settings-dialog header .x{margin-left:auto;width:30px;height:30px;border-radius:8px;background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:var(--steel);}
  .settings-dialog header .x:hover{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);}
  .settings-body{flex:1;min-height:0;display:flex;padding:16px 18px;overflow:auto;}
  .settings-dialog.navd .settings-body{padding:0;overflow:hidden;}
  .set-nav{flex:0 0 204px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;overflow:auto;border-right:1px solid var(--line);background:var(--s-soft);}
  .set-nav button{text-align:left;border:0;background:transparent;border-radius:8px;padding:8px 11px;font:600 12.5px/1.3 inherit;color:var(--steel);cursor:pointer;}
  .set-nav button:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 6%,transparent);}
  .set-nav button.on{background:var(--card);color:var(--s-blue);box-shadow:0 1px 2px rgba(16,24,40,.14);}
  .set-pane{flex:1;min-width:0;overflow:auto;padding:20px 24px 24px;}
  .settings-section{margin-bottom:18px;}
  .settings-dialog.navd .settings-section{display:none;margin:0;}
  .settings-dialog.navd .settings-section.on{display:block;}
  .settings-section h3{margin:0 0 14px;font:650 15px/1.25 inherit;letter-spacing:0;text-transform:none;color:var(--ink);display:flex;align-items:center;gap:8px;}
  .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;}
  .settings-field{display:flex;flex-direction:column;gap:5px;}
  .settings-field.span2{grid-column:1 / -1;}
  .settings-field label{font-size:11px;font-weight:650;color:var(--steel);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:6px;}
  .settings-dialog input[type=text],.settings-dialog input[type=number],.settings-dialog input[type=date],.settings-dialog input:not([type]),.settings-dialog select,.settings-dialog textarea{
    border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:var(--card);color:var(--ink);font:inherit;font-size:13px;}
  .settings-dialog input:focus,.settings-dialog select:focus,.settings-dialog textarea:focus{outline:2px solid color-mix(in srgb,var(--s-blue) 30%,transparent);border-color:var(--s-blue);}
  .settings-field input,.settings-field select{width:100%;}
  .settings-checks{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:2px 0 6px;}
  .settings-checks label{display:flex;align-items:center;gap:8px;font-weight:500;}
  .settings-checks input{width:auto;}
  .settings-dialog input[type=checkbox],.settings-dialog input[type=radio]{width:16px;height:16px;accent-color:var(--s-blue);flex:none;}
  .settings-foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line);}
  .settings-foot .spacer{margin-left:auto;}
  .settings-dialog .btn{font-family:inherit;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;border-radius:9px;padding:7px 14px;}
  .settings-dialog .btn.ghost{background:var(--card);border-color:var(--line);color:var(--ink);}
  .settings-dialog .btn.ghost:hover{border-color:var(--s-blue);color:var(--s-blue);}
  .settings-dialog .btn.primary{background:#1e2a4a;color:#fff;}
  .settings-dialog .btn.primary:hover{background:#2a3a63;}
  body.theme-dark .settings-dialog .btn.primary{background:#3d5a8c;}
  .settings-note{color:var(--steel);font-size:12px;margin-top:4px;}
  .ref-builtin{font-size:12px;color:var(--steel);margin-bottom:8px;}
  /* the "i" that replaces a line of small print */
  .set-tip{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;border-radius:50%;border:1.4px solid currentColor;
    font:italic 700 10px/1 Georgia,"Times New Roman",serif;color:var(--steel);opacity:.65;cursor:help;text-transform:none;letter-spacing:0;}
  .set-tip:hover,.set-tip:focus{opacity:1;color:var(--s-blue);outline:none;}
  .set-tip .pop{display:none;position:absolute;left:-6px;top:calc(100% + 6px);z-index:20;width:300px;max-width:56vw;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:10px;
    box-shadow:0 10px 28px rgba(20,30,60,.22);padding:10px 12px;font:400 12px/1.5 Inter,"Segoe UI",system-ui,sans-serif;text-align:left;white-space:normal;cursor:default;}
  .set-tip.r .pop{left:auto;right:-6px;}
  .set-tip:hover .pop,.set-tip:focus .pop{display:block;}
  .ref-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;}
  .ref-row .ref-name{flex:0 0 38%;}
  .ref-row .ref-title{flex:1 1 auto;}
  .ref-row .ref-addr{flex:1 1 auto;resize:vertical;}
  .ref-row .ref-abbrev{flex:0 0 22%;}
  .ref-row .ref-del{flex:0 0 auto;background:none;border:1px solid var(--line);border-radius:9px;width:32px;height:32px;cursor:pointer;color:var(--steel);font-size:16px;line-height:1;}
  .ref-row .ref-del:hover{border-color:var(--warn);color:var(--warn);}
  .ref-empty{font-size:12px;color:var(--steel);margin-bottom:8px;}
  .set-appearance{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--ink) 6%,transparent);}
  .set-appx{background:transparent;color:var(--steel);border:0;border-radius:7px;padding:6px 14px;font:600 12.5px inherit;letter-spacing:0;text-transform:none;cursor:pointer;}
  .set-appx+.set-appx{border-left:0;}
  .set-appx.active{background:var(--card);color:var(--s-blue);box-shadow:0 1px 2px rgba(16,24,40,.14);}
  .set-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;cursor:pointer;margin:9px 0;}
  .udq-id{font-family:var(--mono);font-size:12px;}
  .udq-id.udq-bad{border-color:var(--warn);outline:1px solid var(--warn);}
  .udq-summary{font-family:var(--mono);font-size:11.5px;color:var(--steel);margin:2px 0 10px;word-break:break-all;}
  .udq-adv{display:none;margin-top:10px;}
  .udq-adv.open{display:block;}
  @media (max-width:680px){
    .settings-dialog.navd .settings-body{flex-direction:column;}
    .set-nav{flex:none;flex-direction:row;border-right:0;border-bottom:1px solid var(--line);}
    .set-nav button{white-space:nowrap;}
  }
`;

/* Which section was open last (kept while the Utility stays open). */
let _setLastSec = 0;
/** Turns the built Settings window into the two-pane layout and moves every line of small print
    into a hover "i". Works on the finished overlay, so field ids and the save logic are untouched. */
function _setDecorate(overlay) {
  const dlg = overlay.querySelector(".settings-dialog"), body = overlay.querySelector(".settings-body");
  if (!dlg || !body || dlg.classList.contains("navd")) return;
  const secs = Array.from(body.children).filter((c) => c.classList && c.classList.contains("settings-section"));
  if (!secs.length) return;
  const nav = document.createElement("nav");
  nav.className = "set-nav"; nav.setAttribute("aria-label", "Settings sections");
  const pane = document.createElement("div");
  pane.className = "set-pane";
  while (body.firstChild) pane.appendChild(body.firstChild);
  body.appendChild(nav); body.appendChild(pane);
  const show = (i) => {
    if (i < 0 || i >= secs.length) i = 0;
    secs.forEach((s, k) => s.classList.toggle("on", k === i));
    Array.from(nav.children).forEach((b, k) => { b.classList.toggle("on", k === i); if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    pane.scrollTop = 0; _setLastSec = i;
  };
  secs.forEach((s, i) => {
    const h = s.querySelector("h3");
    const b = document.createElement("button");
    b.type = "button"; b.textContent = h ? h.textContent.trim() : "Section " + (i + 1);
    b.addEventListener("click", () => show(i));
    nav.appendChild(b);
  });
  // small print -> hover tips (anything with an id is a live message, e.g. an error line: left alone)
  pane.querySelectorAll(".settings-note, .ref-builtin").forEach((n) => {
    if (n.id || !n.textContent.trim()) return;
    const tip = document.createElement("span");
    tip.className = "set-tip"; tip.tabIndex = 0; tip.setAttribute("role", "note"); tip.setAttribute("aria-label", n.textContent.trim());
    tip.innerHTML = 'i<span class="pop"></span>';
    tip.lastChild.innerHTML = n.innerHTML;
    tip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    const place = () => { const r = tip.getBoundingClientRect(), p = pane.getBoundingClientRect(); tip.classList.toggle("r", r.left - p.left > p.width * 0.5); };
    tip.addEventListener("mouseenter", place); tip.addEventListener("focus", place);
    // Hang it on the thing the note is about: the label / button row / heading just before it (a field or a
    // grid of fields counts by its label); failing that the field it sits in, then the section heading.
    let host = null;
    for (let p = n.previousElementSibling; p && !host; p = p.previousElementSibling) {
      if (p.matches("label, .settings-checks, h3, h4")) host = p;
      else if (p.matches(".settings-field")) host = p.querySelector("label");
      else if (p.matches(".settings-grid")) { const ls = p.querySelectorAll(".settings-field label"); host = ls.length ? ls[ls.length - 1] : null; }
    }
    const field = n.closest(".settings-field"), sec = n.closest(".settings-section");
    if (!host && field) host = field.querySelector("label");
    if (!host && sec) host = sec.querySelector("h3");
    if (!host) return;
    // one "i" per label: a second note for the same thing joins the first one's pop-up
    const had = Array.from(host.children).find((c) => c.classList.contains("set-tip"));
    if (had) {
      const pop = had.querySelector(".pop");
      pop.innerHTML += '<div style="margin-top:8px">' + n.innerHTML + "</div>";
      had.setAttribute("aria-label", pop.textContent.trim());
    } else host.appendChild(tip);
    n.remove();
  });
  dlg.classList.add("navd");
  show(_setLastSec);
  // a section the rest of openSettings hides (e.g. Application, once installed) drops out of the list
  setTimeout(() => {
    secs.forEach((s, i) => { if (s.style.display === "none") nav.children[i].style.display = "none"; });
    if (secs[_setLastSec] && secs[_setLastSec].style.display === "none") show(0);
  }, 0);
  // Save refused (a bad UDQ ID…): bring the section with the problem into view
  const save = overlay.querySelector("#setSave");
  if (save) save.addEventListener("click", () => setTimeout(() => {
    const bad = pane.querySelector(".udq-bad") || Array.from(pane.querySelectorAll("#setUdqErr")).find((e) => e.style.display !== "none" && e.textContent.trim());
    if (bad && document.body.contains(bad)) show(secs.indexOf(bad.closest(".settings-section")));
  }, 0));
}

function _refSignerRow(name, title) {
  return `<div class="ref-row" data-kind="signer">
    <input class="ref-name" type="text" placeholder="Name" value="${esc(name || "")}">
    <input class="ref-title" type="text" placeholder="Title" value="${esc(title || "")}">
    <button class="ref-del" type="button" title="Remove">×</button>
  </div>`;
}
function _refForwarderRow(name, address) {
  return `<div class="ref-row" data-kind="fwd">
    <input class="ref-name" type="text" placeholder="Name" value="${esc(name || "")}">
    <textarea class="ref-addr" rows="2" placeholder="Address (multi-line ok)">${esc(address || "")}</textarea>
    <button class="ref-del" type="button" title="Remove">×</button>
  </div>`;
}
function _refVendorRow(name, address, abbrev) {
  return `<div class="ref-row" data-kind="vendor">
    <input class="ref-name" type="text" placeholder="Vendor name" value="${esc(name || "")}">
    <textarea class="ref-addr" rows="2" placeholder="Address (multi-line ok)">${esc(address || "")}</textarea>
    <input class="ref-abbrev" type="text" placeholder="Abbr." title="Optional abbreviation used in the PO number" value="${esc(abbrev || "")}">
    <button class="ref-del" type="button" title="Remove">×</button>
  </div>`;
}

function openSettings() {
  closeSettings();
  const s = AtlasSettings.get();

  const docDefs = [
    ["ci", "Commercial Invoice"], ["pl", "Packing List"],
    ["placards", "Placards"], ["ipc", "Inventory Packing Checklist"],
  ];
  const docChecks = docDefs.map(([id, label]) =>
    `<label><input type="checkbox" class="set-doc" data-id="${id}" ${s.packetDocs[id] ? "checked" : ""}> ${esc(label)}</label>`
  ).join("");

  const purposeOpts = (typeof PURPOSE_CHOICES !== "undefined" ? PURPOSE_CHOICES : ["Donation"])
    .map((p) => `<option ${p === s.defaultPurpose ? "selected" : ""}>${esc(p)}</option>`).join("");

  const builtinSignerNames = BUILTIN_SIGNERS.map((b) => b.name).join(", ") || "none";
  const builtinFwdNames = Object.keys(BUILTIN_SLI_LOCATIONS).join(", ") || "none";
  const signerRows = (s.customSigners || []).map((c) => _refSignerRow(c.name, c.title)).join("");
  const fwdRows = (s.customForwarders || []).map((c) => _refForwarderRow(c.name, c.address)).join("");
  const vendorRows = (s.customVendors || []).map((c) => _refVendorRow(c.name, c.address, c.abbrev)).join("");

  const hbCodes = (s.hardBlock && s.hardBlock.codes) || {};
  const hbDisabled = !(s.hardBlock && s.hardBlock.enabled);
  const hbCodeChecks = (typeof VAL_BLOCKABLE !== "undefined" ? VAL_BLOCKABLE : [])
    .map((b) => `<label><input type="checkbox" class="set-hb" data-code="${esc(b.code)}" ${hbCodes[b.code] ? "checked" : ""} ${hbDisabled ? "disabled" : ""}> ${esc(b.label)}</label>`)
    .join("") || `<div class="ref-empty">No blockable checks defined.</div>`;

  // ---- ATLAS data source (UDQ IDs) — built-in defaults + this browser's overrides ----
  const _udqEnv = (typeof ATLAS_UDQ_CONFIG !== "undefined") ? (ATLAS_UDQ_CONFIG.env || "qa") : "qa";
  const _udqBuiltins = (typeof ATLAS_UDQ_CONFIG !== "undefined") ? (ATLAS_UDQ_CONFIG.ids[_udqEnv] || {}) : {};
  const _udqBct = _udqBuiltins.christmasTree || {};
  const _udqOv = (s.udqIds && s.udqIds[_udqEnv] && typeof s.udqIds[_udqEnv] === "object") ? s.udqIds[_udqEnv] : {};
  // API base URL: built-in default from ATLAS_UDQ_CONFIG + this browser's per-env override.
  const _udqApiBuiltin = (typeof ATLAS_UDQ_CONFIG !== "undefined")
    ? (((ATLAS_UDQ_CONFIG.absoluteOrigin || "").replace(/\/$/, "")) + (ATLAS_UDQ_CONFIG.baseUrl || ""))
    : "/api/UDQ";
  const _udqApiOv = String((s.udqApi && s.udqApi[_udqEnv]) || "").trim();
  const _udqApiEff = _udqApiOv || _udqApiBuiltin;
  // COP daily-update save (address + request ID field) — built-in + this browser's override.
  const _dsBuiltin = (typeof ATLAS_UDQ_CONFIG !== "undefined" && ATLAS_UDQ_CONFIG.dailyStatus) || {};
  const _dsOv = (s.dailyStatus && s.dailyStatus[_udqEnv] && typeof s.dailyStatus[_udqEnv] === "object") ? s.dailyStatus[_udqEnv] : {};
  const _udqOvCount = ["metrics", "shipping", "property", "pls"].filter((k) => String(_udqOv[k] || "").trim()).length +
    ["srf", "pr", "pmct", "ws"].filter((k) => {
      const oct = (_udqOv.christmasTree && typeof _udqOv.christmasTree === "object") ? _udqOv.christmasTree : {};
      return String(oct[k] || "").trim();
    }).length;
  const _udqOct = (_udqOv.christmasTree && typeof _udqOv.christmasTree === "object") ? _udqOv.christmasTree : {};
  const _udqField = (id, label, cur, def, note) => `
    <div class="settings-field span2">
      <label for="${id}">${esc(label)}</label>
      <input type="text" id="${id}" class="udq-id" value="${esc(cur || "")}" placeholder="${esc(def ? ("default: " + def) : "not set")}" spellcheck="false" autocomplete="off" autocapitalize="off">
      ${note ? `<div class="settings-note">${note}</div>` : ""}
    </div>`;
  const udqFieldsHtml =
    _udqField("setUdqMetrics", "Metrics UDQ", _udqOv.metrics, _udqBuiltins.metrics, "") +
    _udqField("setUdqShipping", "Shipping (SR) UDQ", _udqOv.shipping, _udqBuiltins.shipping, "Usually the same ID as the Metrics UDQ — the single SR shipment is filtered by WMTR inside the utility.") +
    _udqField("setUdqProperty", "Property (PR) UDQ", _udqOv.property, _udqBuiltins.property, "The full property dataset; filtered to the entered number inside the utility.") +
    _udqField("setUdqPls", "PLS UDQ", _udqOv.pls, _udqBuiltins.pls, "Personnel Logistics Services — feeds the Dashboard's PLS tab. Until it's set, drop the PLS UDQ export on that tab.") +
    _udqField("setUdqCtSrf", "Christmas Tree — SRF", _udqOct.srf, _udqBct.srf, "Usually the same ID as the Metrics UDQ.") +
    _udqField("setUdqCtPr", "Christmas Tree — PR", _udqOct.pr, _udqBct.pr, "") +
    _udqField("setUdqCtPmct", "Christmas Tree — PMCT", _udqOct.pmct, _udqBct.pmct, "") +
    _udqField("setUdqCtWs", "Christmas Tree — WS", _udqOct.ws, _udqBct.ws, "");

  const overlay = el(`
    <div class="settings-overlay" id="settingsOverlay">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <style>${SETTINGS_STYLE}</style>
        <header>
          <h2>Settings</h2>
          <button class="x" id="setClose" title="Close" aria-label="Close">×</button>
        </header>
        <div class="settings-body">
          <div class="settings-section">
            <h3>Tools</h3>
            <div class="settings-checks" style="gap:10px;flex-direction:row;flex-wrap:wrap;">
              <button class="btn ghost" id="setOpenCompare" type="button">Compare UDQs&hellip;</button>
              <button class="btn ghost" id="setOpenHistory" type="button">Run history&hellip;</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>Packet defaults</h3>
            <div class="settings-grid">
              <div class="settings-field span2">
                <label>Documents included by default</label>
                <div class="settings-checks">${docChecks}</div>
              </div>
              <div class="settings-field">
                <label for="setSigner">Default signer</label>
                <select id="setSigner">${atlasSignerOptions(s.packetSigner)}</select>
                <div class="settings-note">Applied to the Commercial Invoice and Packing List.</div>
              </div>
              <div class="settings-field">
                <label for="setUnit">Default unit system</label>
                <select id="setUnit">
                  <option value="imperial" ${s.packetUnit === "imperial" ? "selected" : ""}>Imperial (lbs / in)</option>
                  <option value="metric" ${s.packetUnit === "metric" ? "selected" : ""}>Metric (kg / cm)</option>
                </select>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Document defaults</h3>
            <div class="settings-grid">
              <div class="settings-field">
                <label for="setContract">Default contract number</label>
                <input type="text" id="setContract" value="${esc(s.defaultContract)}">
                <div class="settings-note">Used when the UDQ has no contract number.</div>
              </div>
              <div class="settings-field">
                <label for="setPurpose">Default CI purpose</label>
                <select id="setPurpose">${purposeOpts}</select>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Appearance</h3>
            <div class="set-appearance" id="setAppearance">
              <button type="button" class="set-appx" data-mode="default">Light</button>
              <button type="button" class="set-appx" data-mode="dark">Dark</button>
            </div>
            <div class="settings-note">Applies immediately and is remembered on this device.</div>
          </div>

          <div class="settings-section">
            <h3>General</h3>
            <label class="set-check"><input type="checkbox" id="setAutoSave" ${s.autoSaveForms ? "checked" : ""}> Auto-save in-progress form inputs</label>
            <div class="settings-note">Remembers what you've typed in a tool's form (per UDQ) so it survives switching tools or an accidental reload. Turn off if a form misbehaves.</div>
            <label class="set-check"><input type="checkbox" id="setDashInfo" ${s.dashInfo !== false ? "checked" : ""}> Show &ldquo;how it's calculated&rdquo; info bubbles on the Procurement and Property dashboards</label>
            <div class="settings-note">Each card and chart gets a small &#9432; you can hover or tap to see which ATLAS fields it uses and how its numbers are worked out.</div>
            <label class="set-check"><input type="checkbox" id="setDashDrop" ${s.dashDrop !== false ? "checked" : ""}> Dashboard UDQ drop box (only when not connected to ATLAS)</label>
            <div class="settings-note">One drop box under the Dashboard tabs for working without ATLAS: drop any Metrics, PR, PMCT or PLS UDQ export (or several at once) and each lights up its own tab. It hides itself once the Utility has pulled from ATLAS. Untick to never show it.</div>
          </div>

          <div class="settings-section" id="setAppSection">
            <h3>Application</h3>
            <div class="settings-checks" style="gap:10px;">
              <button class="btn ghost" id="setInstallApp" type="button">Install ATLAS Utility&hellip;</button>
            </div>
            <div class="settings-note">Add ATLAS Utility to your desktop as an app (Chrome, Edge, or Safari). If your browser already offered to install it, this uses that prompt; otherwise you'll get quick per-browser instructions.</div>
          </div>

          <div class="settings-section" id="setUdqSection">
            <h3>ATLAS data source</h3>
            <div class="ref-builtin">Environment: <strong>${esc(_udqEnv.toUpperCase())}</strong>. Where the &ldquo;Fetch from ATLAS&rdquo; buttons pull data from.</div>
            <label class="set-check"><input type="checkbox" id="setCopPreview" ${s.copDailyPreview ? "checked" : ""}> Show COP daily-update entry &amp; editing (preview)</label>
            <div class="settings-note">Try entering and editing daily updates on the COP before the ATLAS save API exists. In preview, updates stay in this browser (marked &ldquo;pending&rdquo;) and nothing is sent to ATLAS; edits to ATLAS entries last until the page reloads. Once the save address and Request ID field below are set and you're inside ATLAS, saving is real whether or not this is ticked.</div>
            <div class="udq-summary" id="setUdqSummary">API: ${esc(_udqApiEff)}${_udqApiOv ? " (override)" : ""}${_udqOvCount ? ` &middot; ${_udqOvCount} UDQ ID override${_udqOvCount === 1 ? "" : "s"}` : ""}${(_dsOv.url || _dsBuiltin.url) && (_dsOv.requestIdField || _dsBuiltin.requestIdField) ? " &middot; daily-update saving set up" : ""}</div>
            <button class="btn ghost" id="setUdqAdvBtn" type="button" aria-expanded="false" aria-controls="setUdqAdv">Adjust API settings&hellip;</button>
            <div class="udq-adv" id="setUdqAdv">
              <div class="ref-builtin">Leave a field blank to use the built-in default shown in grey; UDQ IDs must be GUIDs (e.g. cfb99354-d596-4a86-b067-7b19eea14708). Saved in <em>this browser only</em> — the built-in defaults stay the source of truth for everyone else, so this is for quick corrections without a redeploy.</div>
              <div class="settings-grid">
                <div class="settings-field span2">
                  <label for="setUdqApi">API base URL</label>
                  <input type="text" id="setUdqApi" class="udq-id" value="${esc(_udqApiOv)}" placeholder="default: ${esc(_udqApiBuiltin)}" spellcheck="false" autocomplete="off" autocapitalize="off">
                  <div class="settings-note">The base every UDQ ID is appended to (<span style="font-family:var(--mono);">&lt;base&gt;/&lt;UDQ ID&gt;</span>). A relative path (e.g. /api/UDQ) rides the ATLAS session on this host; an absolute https:// URL targets another host (cross-origin rules apply).</div>
                </div>
                <div class="settings-field span2">
                  <label for="setDsUrl">Daily update save address</label>
                  <input type="text" id="setDsUrl" class="udq-id" value="${esc(_dsOv.url || "")}" placeholder="${esc(_dsBuiltin.url ? "default: " + _dsBuiltin.url : "not set — e.g. /api/wmtr/{requestId}/daily-status")}" spellcheck="false" autocomplete="off" autocapitalize="off">
                  <div class="settings-note">From the ATLAS team. Where the COP saves a daily update (Date + Notes/Comments); <span style="font-family:var(--mono);">{requestId}</span> is replaced with the request's ID. Saving only works inside ATLAS.</div>
                </div>
                <div class="settings-field span2">
                  <label for="setDsEditUrl">Daily update edit address</label>
                  <input type="text" id="setDsEditUrl" class="udq-id" value="${esc(_dsOv.editUrl || "")}" placeholder="${esc(_dsBuiltin.editUrl ? "default: " + _dsBuiltin.editUrl : "not set — e.g. /api/wmtr/{requestId}/daily-status/{entryId}")}" spellcheck="false" autocomplete="off" autocapitalize="off">
                  <div class="settings-note">From the ATLAS team. Where the COP saves a change to a past update; <span style="font-family:var(--mono);">{entryId}</span> is replaced with that update's ID. Blank = past updates can't be edited from the COP.</div>
                </div>
                <div class="settings-field span2">
                  <label for="setDsIdField">Request ID field</label>
                  <input type="text" id="setDsIdField" class="udq-id" value="${esc(_dsOv.requestIdField || "")}" placeholder="${esc(_dsBuiltin.requestIdField ? "default: " + _dsBuiltin.requestIdField : "not set — e.g. RequestId")}" spellcheck="false" autocomplete="off" autocapitalize="off">
                  <div class="settings-note">From the ATLAS team. The name of the field in the Metrics UDQ that holds each request's unique ID. COP daily-update saving turns on when both are set (after the next fetch).</div>
                </div>
                ${udqFieldsHtml}
              </div>
              <div class="settings-note" id="setUdqErr" style="color:var(--warn);display:none;"></div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Validation gate</h3>
            <label class="set-check"><input type="checkbox" id="setHardBlock" ${s.hardBlock && s.hardBlock.enabled ? "checked" : ""}> Block document generation on selected errors</label>
            <div class="settings-note">By default the pre-flight validator is advisory. Turn this on and tick the checks below to make them <em>block</em> generation — you'll still get a one-click override (with an optional reason, recorded in run history) for when a draft is needed before every detail is in hand.</div>
            <div id="setHbCodes" class="settings-checks" style="flex-direction:column;align-items:flex-start;gap:8px;margin-top:8px;">${hbCodeChecks}</div>
          </div>

          <div class="settings-section">
            <h3>Signers</h3>
            <div class="ref-builtin">Built-in (not editable): ${esc(builtinSignerNames)}</div>
            <div id="setSignerRows">${signerRows || `<div class="ref-empty">No custom signers yet.</div>`}</div>
            <button class="btn ghost" id="setAddSigner" type="button">+ Add signer</button>
          </div>

          <div class="settings-section">
            <h3>SLI freight forwarders</h3>
            <div class="ref-builtin">Built-in (not editable): ${esc(builtinFwdNames)}</div>
            <div id="setFwdRows">${fwdRows || `<div class="ref-empty">No custom forwarders yet.</div>`}</div>
            <button class="btn ghost" id="setAddFwd" type="button">+ Add forwarder</button>
          </div>

          <div class="settings-section">
            <h3>Purchase Order vendors</h3>
            <div class="ref-builtin">For the Property management ▸ Purchase Order. Add vendors here to pick them quickly on the PO form. The optional abbreviation is used in the PO number (e.g. 2026-<em>Abbr</em>-10256); if left blank a slug of the name is used.</div>
            <div id="setVendorRows">${vendorRows || `<div class="ref-empty">No saved vendors yet.</div>`}</div>
            <button class="btn ghost" id="setAddVendor" type="button">+ Add vendor</button>
          </div>

          <div class="settings-section">
            <h3>Data backup &amp; restore</h3>
            <div class="settings-checks" style="gap:10px;">
              <button class="btn ghost" id="setBackupExport" type="button">Export backup…</button>
              <button class="btn ghost" id="setBackupImport" type="button">Import backup…</button>
              <input type="file" id="setBackupFile" accept=".json,application/json" class="hidden">
            </div>
            <div class="settings-note">Saves your settings, reference data and run history to one JSON file
            you can keep, move to another machine, or share with teammates. Import lets you Replace or Merge.
            Storage is per-browser — a backup is a point-in-time file, not a live sync.</div>
          </div>
        </div>
        <div class="settings-foot">
          <button class="btn ghost" id="setReset">Reset to defaults</button>
          <span class="spacer"></span>
          <button class="btn ghost" id="setCancel">Cancel</button>
          <button class="btn primary" id="setSave">Save</button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(overlay);
  _setDecorate(overlay);

  const close = () => closeSettings();
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#setClose").addEventListener("click", close);
  overlay.querySelector("#setCancel").addEventListener("click", close);
  document.addEventListener("keydown", _settingsEscHandler);

  // Appearance — applies immediately (theme is its own preference, not part of Save).
  const appHost = overlay.querySelector("#setAppearance");
  if (appHost) {
    const markApp = () => {
      const cur = (typeof currentTheme === "function" ? currentTheme() : "default");
      const base = cur === "dark" ? "dark" : "default"; // purple easter-egg shows as Light here
      appHost.querySelectorAll(".set-appx").forEach((b) => b.classList.toggle("active", b.dataset.mode === base));
    };
    appHost.querySelectorAll(".set-appx").forEach((b) => {
      b.addEventListener("click", () => {
        if (typeof setAppearance === "function") setAppearance(b.dataset.mode);
        markApp();
      });
    });
    markApp();
  }

  // Add-row buttons (clear any "empty" placeholder first)
  const addRow = (containerId, html) => {
    const c = overlay.querySelector("#" + containerId);
    const empty = c.querySelector(".ref-empty");
    if (empty) empty.remove();
    c.insertAdjacentHTML("beforeend", html);
    const last = c.lastElementChild;
    const nameInput = last && last.querySelector(".ref-name");
    if (nameInput) nameInput.focus();
  };
  overlay.querySelector("#setAddSigner").addEventListener("click", () => addRow("setSignerRows", _refSignerRow("", "")));
  overlay.querySelector("#setAddFwd").addEventListener("click", () => addRow("setFwdRows", _refForwarderRow("", "")));
  overlay.querySelector("#setAddVendor").addEventListener("click", () => addRow("setVendorRows", _refVendorRow("", "", "")));

  // Validation gate: master toggle enables/disables the per-check boxes live.
  const hbMaster = overlay.querySelector("#setHardBlock");
  if (hbMaster) {
    const syncHb = () => {
      overlay.querySelectorAll(".set-hb").forEach((cb) => { cb.disabled = !hbMaster.checked; });
    };
    hbMaster.addEventListener("change", syncHb);
    syncHb();
  }

  // Data backup & restore (Feature #1) — immediate actions, independent of Save.
  const bkExport = overlay.querySelector("#setBackupExport");
  const bkImport = overlay.querySelector("#setBackupImport");
  const bkFile = overlay.querySelector("#setBackupFile");
  if (bkExport && typeof atlasExportBackupDownload === "function") {
    bkExport.addEventListener("click", () => atlasExportBackupDownload());
  }
  if (bkImport && bkFile && typeof atlasImportBackupFile === "function") {
    bkImport.addEventListener("click", () => bkFile.click());
    bkFile.addEventListener("change", () => {
      const f = bkFile.files && bkFile.files[0];
      bkFile.value = ""; // allow re-importing the same file
      if (f) atlasImportBackupFile(f);
    });
  }

  // Install app (moved here from the header). Hidden when already running as an
  // installed/standalone app.
  // Tools that used to be icons in the top bar: close Settings, then open the tool.
  const openTool = (sel, name) => {
    const b = overlay.querySelector(sel);
    if (b) b.addEventListener("click", () => { closeSettings(); if (typeof window[name] === "function") window[name](); });
  };
  openTool("#setOpenCompare", "openCompare");
  openTool("#setOpenHistory", "openHistory");
  const installBtn = overlay.querySelector("#setInstallApp");
  const appSection = overlay.querySelector("#setAppSection");
  if (installBtn && window.AtlasPWA) {
    if (typeof window.AtlasPWA.isStandalone === "function" && window.AtlasPWA.isStandalone() && appSection) {
      appSection.style.display = "none";
    }
    installBtn.addEventListener("click", () => window.AtlasPWA.install());
  }

  // Remove-row (event delegation)
  overlay.addEventListener("click", (e) => {
    const del = e.target.closest && e.target.closest(".ref-del");
    if (!del) return;
    const row = del.closest(".ref-row");
    if (row) row.remove();
  });

  // ATLAS data source: the API fields are buried behind this toggle so the
  // section stays one line tall unless someone actually needs to adjust them.
  const udqAdvBtn = overlay.querySelector("#setUdqAdvBtn");
  const udqAdvBox = overlay.querySelector("#setUdqAdv");
  if (udqAdvBtn && udqAdvBox) {
    udqAdvBtn.addEventListener("click", () => {
      const open = udqAdvBox.classList.toggle("open");
      udqAdvBtn.setAttribute("aria-expanded", open ? "true" : "false");
      udqAdvBtn.innerHTML = open ? "Hide API settings" : "Adjust API settings&hellip;";
    });
  }

  overlay.querySelector("#setReset").addEventListener("click", () => {
    AtlasSettings.reset();
    applyReferenceData();
    _settingsAfterChange();
    openSettings();
  });

  overlay.querySelector("#setSave").addEventListener("click", () => {
    // ---- ATLAS data source (UDQ IDs): validate first; a bad GUID blocks the
    //      whole Save so nothing is persisted in a half-valid state. ----
    const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const udqEnv = (typeof ATLAS_UDQ_CONFIG !== "undefined") ? (ATLAS_UDQ_CONFIG.env || "qa") : "qa";
    const udqErrEl = overlay.querySelector("#setUdqErr");
    const udqBad = [];
    const readUdq = (id) => {
      const inp = overlay.querySelector("#" + id);
      if (inp) inp.classList.remove("udq-bad");
      const v = ((inp && inp.value) || "").trim();
      if (v && !GUID_RE.test(v)) { if (inp) inp.classList.add("udq-bad"); udqBad.push(id); }
      return v;
    };
    // API base URL: blank (use built-in), a relative path starting with "/",
    // or an absolute http(s) URL. Anything else blocks Save like a bad GUID.
    const apiInp = overlay.querySelector("#setUdqApi");
    if (apiInp) apiInp.classList.remove("udq-bad");
    const apiVal = ((apiInp && apiInp.value) || "").trim().replace(/\/+$/, "");
    let apiBad = false;
    if (apiVal && !(apiVal.startsWith("/") || /^https?:\/\/\S+$/i.test(apiVal))) {
      apiBad = true;
      if (apiInp) apiInp.classList.add("udq-bad");
    }
    const dsUrlInp = overlay.querySelector("#setDsUrl");
    const dsUrl = dsUrlInp ? dsUrlInp.value.trim() : "";
    const dsIdField = ((overlay.querySelector("#setDsIdField") || {}).value || "").trim();
    const dsEditInp = overlay.querySelector("#setDsEditUrl");
    const dsEditUrl = dsEditInp ? dsEditInp.value.trim() : "";
    for (const [inp, v] of [[dsUrlInp, dsUrl], [dsEditInp, dsEditUrl]]) {
      if (inp) inp.classList.remove("udq-bad");
      if (v && !(v.startsWith("/") || /^https?:\/\/\S+$/i.test(v))) {
        apiBad = true;
        if (inp) inp.classList.add("udq-bad");
      }
    }
    const udqVals = {
      metrics:  readUdq("setUdqMetrics"),
      shipping: readUdq("setUdqShipping"),
      property: readUdq("setUdqProperty"),
      pls:      readUdq("setUdqPls"),
      christmasTree: {
        srf:  readUdq("setUdqCtSrf"),  pr: readUdq("setUdqCtPr"),
        pmct: readUdq("setUdqCtPmct"), ws: readUdq("setUdqCtWs"),
      },
    };
    if (udqBad.length || apiBad) {
      // Make sure the buried fields are visible so the highlight can be seen.
      const advBox = overlay.querySelector("#setUdqAdv");
      const advBtn = overlay.querySelector("#setUdqAdvBtn");
      if (advBox && !advBox.classList.contains("open")) {
        advBox.classList.add("open");
        if (advBtn) { advBtn.setAttribute("aria-expanded", "true"); advBtn.textContent = "Hide API settings"; }
      }
      if (udqErrEl) {
        udqErrEl.style.display = "block";
        const parts = [];
        if (apiBad) parts.push("The API base URL and daily update save / edit addresses must be blank, a relative path starting with \u201c/\u201d, or an absolute http(s):// URL.");
        if (udqBad.length) parts.push(`${udqBad.length} UDQ ID${udqBad.length === 1 ? " is" : "s are"} not a valid GUID. Fix the highlighted field${udqBad.length === 1 ? "" : "s"}, or clear ${udqBad.length === 1 ? "it" : "them"} to use the built-in default.`);
        udqErrEl.textContent = parts.join(" ");
      }
      return; // abort Save — nothing changes
    }
    if (udqErrEl) udqErrEl.style.display = "none";
    // Keep only non-blank overrides so a blank field falls back to the default.
    const envOv = {};
    ["metrics", "shipping", "property", "pls"].forEach((k) => { if (udqVals[k]) envOv[k] = udqVals[k]; });
    const ctOv = {};
    ["srf", "pr", "pmct", "ws"].forEach((k) => { if (udqVals.christmasTree[k]) ctOv[k] = udqVals.christmasTree[k]; });
    if (Object.keys(ctOv).length) envOv.christmasTree = ctOv;
    const allUdqIds = Object.assign({}, AtlasSettings.get().udqIds || {});
    if (Object.keys(envOv).length) allUdqIds[udqEnv] = envOv; else delete allUdqIds[udqEnv];
    // API base URL override: keep only a non-blank value so blank = built-in.
    const allUdqApi = Object.assign({}, AtlasSettings.get().udqApi || {});
    if (apiVal) allUdqApi[udqEnv] = apiVal; else delete allUdqApi[udqEnv];
    const allDs = Object.assign({}, AtlasSettings.get().dailyStatus || {});
    const dsOv = {};
    if (dsUrl) dsOv.url = dsUrl;
    if (dsEditUrl) dsOv.editUrl = dsEditUrl;
    if (dsIdField) dsOv.requestIdField = dsIdField;
    if (Object.keys(dsOv).length) allDs[udqEnv] = dsOv; else delete allDs[udqEnv];

    const packetDocs = {};
    overlay.querySelectorAll(".set-doc").forEach((cb) => { packetDocs[cb.dataset.id] = cb.checked; });

    const customSigners = [];
    overlay.querySelectorAll('#setSignerRows .ref-row').forEach((r) => {
      const name = (r.querySelector(".ref-name").value || "").trim();
      const title = (r.querySelector(".ref-title").value || "").trim();
      if (name) customSigners.push({ name, title });
    });
    const customForwarders = [];
    overlay.querySelectorAll('#setFwdRows .ref-row').forEach((r) => {
      const name = (r.querySelector(".ref-name").value || "").trim();
      const address = (r.querySelector(".ref-addr").value || "").trim();
      if (name) customForwarders.push({ name, address });
    });
    const customVendors = [];
    overlay.querySelectorAll('#setVendorRows .ref-row').forEach((r) => {
      const name = (r.querySelector(".ref-name").value || "").trim();
      const address = (r.querySelector(".ref-addr").value || "").trim();
      const abbrev = (r.querySelector(".ref-abbrev").value || "").trim();
      if (name) customVendors.push({ name, address, abbrev });
    });

    const hbCodesOut = {};
    overlay.querySelectorAll(".set-hb").forEach((cb) => { if (cb.checked) hbCodesOut[cb.dataset.code] = true; });
    const hardBlock = { enabled: !!(overlay.querySelector("#setHardBlock") || {}).checked, codes: hbCodesOut };

    AtlasSettings.save({
      packetDocs,
      packetSigner: overlay.querySelector("#setSigner").value || "",
      packetUnit: overlay.querySelector("#setUnit").value || "imperial",
      defaultContract: overlay.querySelector("#setContract").value.trim(),
      defaultPurpose: overlay.querySelector("#setPurpose").value || "Donation",
      customSigners,
      customForwarders,
      customVendors,
      autoSaveForms: !!overlay.querySelector("#setAutoSave").checked,
      copDailyPreview: !!(overlay.querySelector("#setCopPreview") || {}).checked,
      dashInfo: !!(overlay.querySelector("#setDashInfo") || {}).checked,
      dashDrop: !!(overlay.querySelector("#setDashDrop") || {}).checked,
      hardBlock,
      udqIds: allUdqIds,
      udqApi: allUdqApi,
      dailyStatus: allDs,
    });
    applyReferenceData();
    _settingsAfterChange();
    close();
  });
}

function closeSettings() {
  const o = document.getElementById("settingsOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _settingsEscHandler);
}

function _settingsEscHandler(e) { if (e.key === "Escape") closeSettings(); }

/** After settings change: drop the packet's cached selection so it re-reads the
 *  new defaults, and re-render the active workspace so any open tool's dropdowns
 *  (signers, forwarders) pick up edited reference data. */
function _settingsAfterChange() {
  if (typeof FormCache !== "undefined" && typeof AtlasSettings !== "undefined" &&
      AtlasSettings.get().autoSaveForms === false) {
    FormCache.purgeAll();
  }
  if (typeof PacketUi !== "undefined") PacketUi.selected = null;
  if (typeof AppState !== "undefined" && AppState.activeTool && typeof renderWorkspace === "function") {
    try { renderWorkspace(); } catch (e) { /* ignore */ }
  } else if (typeof copHubActive === "function" && copHubActive()) {
    // The Metrics tab lives in the dashboard area — redraw it so the Dashboard drop box setting applies.
    try { renderDashboard(); renderWorkspace(); } catch (e) { /* ignore */ }
  }
}

function initSettingsButton() {
  const btn = document.getElementById("settingsBtn");
  if (btn) btn.addEventListener("click", openSettings);
}

/* Merge custom reference data into the global lists at startup, before any tool
   renders. */
applyReferenceData();

document.addEventListener("DOMContentLoaded", initSettingsButton);
