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
      packetSigner: "",   // signer NAME ("" = leave blank)
      packetUnit: "imperial",
      defaultContract: (typeof DEFAULT_CONTRACT_NO !== "undefined" ? DEFAULT_CONTRACT_NO : ""),
      defaultPurpose: (typeof PURPOSE_CHOICES !== "undefined" ? PURPOSE_CHOICES[0] : "Donation"),
      customSigners: [],      // [{name, title}]
      customForwarders: [],   // [{name, address}]
      customVendors: [],      // [{name, address, abbrev}] — Property PO vendor list
      autoSaveForms: true,    // persist in-progress tool form inputs
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

/* =========================================================================
   Settings modal UI
   ========================================================================= */

const SETTINGS_STYLE = `
  .settings-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1000;padding:5vh 16px;overflow:auto;}
  .settings-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:580px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .settings-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .settings-dialog header h2{margin:0;font-family:var(--disp);}
  .settings-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .settings-body{padding:16px 18px;}
  .settings-section{margin-bottom:18px;}
  .settings-section h3{margin:0 0 8px;font:600 .82rem/1 var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);}
  .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;}
  .settings-field{display:flex;flex-direction:column;gap:4px;}
  .settings-field.span2{grid-column:1 / -1;}
  .settings-field label{font-size:.82rem;font-weight:600;}
  .settings-field input,.settings-field select{width:100%;}
  .settings-checks{display:flex;flex-wrap:wrap;gap:12px;}
  .settings-checks label{display:flex;align-items:center;gap:7px;font-weight:400;}
  .settings-checks input{width:auto;}
  .settings-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);}
  .settings-foot .spacer{margin-left:auto;}
  .settings-note{color:var(--steel);font-size:.8rem;margin-top:4px;}
  .ref-builtin{font-size:.78rem;color:var(--steel);margin-bottom:8px;}
  .ref-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;}
  .ref-row .ref-name{flex:0 0 38%;}
  .ref-row .ref-title{flex:1 1 auto;}
  .ref-row .ref-addr{flex:1 1 auto;resize:vertical;}
  .ref-row .ref-abbrev{flex:0 0 22%;}
  .ref-row .ref-del{flex:0 0 auto;background:none;border:1px solid var(--line);border-radius:7px;width:30px;height:30px;cursor:pointer;color:var(--steel);font-size:16px;line-height:1;}
  .ref-row .ref-del:hover{border-color:var(--warn);color:var(--warn);}
  .ref-empty{font-size:.8rem;color:var(--steel);margin-bottom:8px;}
  .set-appearance{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;}
  .set-appx{background:var(--card);color:var(--ink);border:0;padding:7px 16px;font:600 .8rem var(--disp);letter-spacing:.04em;text-transform:uppercase;cursor:pointer;}
  .set-appx+.set-appx{border-left:1px solid var(--line);}
  .set-appx.active{background:var(--accent);color:#fff;}
  .set-check{display:flex;align-items:center;gap:8px;font-size:.9rem;cursor:pointer;}
  .udq-id{font-family:var(--mono);font-size:.82rem;}
  .udq-id.udq-bad{border-color:var(--warn);outline:1px solid var(--warn);}
  .udq-summary{font-family:var(--mono);font-size:.78rem;color:var(--steel);margin:2px 0 10px;word-break:break-all;}
  .udq-adv{display:none;margin-top:10px;}
  .udq-adv.open{display:block;}
`;

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
  const _udqOvCount = ["metrics", "shipping", "property"].filter((k) => String(_udqOv[k] || "").trim()).length +
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
            <div class="udq-summary" id="setUdqSummary">API: ${esc(_udqApiEff)}${_udqApiOv ? " (override)" : ""}${_udqOvCount ? ` &middot; ${_udqOvCount} UDQ ID override${_udqOvCount === 1 ? "" : "s"}` : ""}</div>
            <button class="btn ghost" id="setUdqAdvBtn" type="button" aria-expanded="false" aria-controls="setUdqAdv">Adjust API settings&hellip;</button>
            <div class="udq-adv" id="setUdqAdv">
              <div class="ref-builtin">Leave a field blank to use the built-in default shown in grey; UDQ IDs must be GUIDs (e.g. cfb99354-d596-4a86-b067-7b19eea14708). Saved in <em>this browser only</em> — the built-in defaults stay the source of truth for everyone else, so this is for quick corrections without a redeploy.</div>
              <div class="settings-grid">
                <div class="settings-field span2">
                  <label for="setUdqApi">API base URL</label>
                  <input type="text" id="setUdqApi" class="udq-id" value="${esc(_udqApiOv)}" placeholder="default: ${esc(_udqApiBuiltin)}" spellcheck="false" autocomplete="off" autocapitalize="off">
                  <div class="settings-note">The base every UDQ ID is appended to (<span style="font-family:var(--mono);">&lt;base&gt;/&lt;UDQ ID&gt;</span>). A relative path (e.g. /api/UDQ) rides the ATLAS session on this host; an absolute https:// URL targets another host (cross-origin rules apply).</div>
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
            <div class="settings-note">Saves your settings, reference data, run history and recents to one JSON file
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
    const udqVals = {
      metrics:  readUdq("setUdqMetrics"),
      shipping: readUdq("setUdqShipping"),
      property: readUdq("setUdqProperty"),
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
        if (apiBad) parts.push("The API base URL must be blank, a relative path starting with \u201c/\u201d, or an absolute http(s):// URL.");
        if (udqBad.length) parts.push(`${udqBad.length} UDQ ID${udqBad.length === 1 ? " is" : "s are"} not a valid GUID. Fix the highlighted field${udqBad.length === 1 ? "" : "s"}, or clear ${udqBad.length === 1 ? "it" : "them"} to use the built-in default.`);
        udqErrEl.textContent = parts.join(" ");
      }
      return; // abort Save — nothing changes
    }
    if (udqErrEl) udqErrEl.style.display = "none";
    // Keep only non-blank overrides so a blank field falls back to the default.
    const envOv = {};
    ["metrics", "shipping", "property"].forEach((k) => { if (udqVals[k]) envOv[k] = udqVals[k]; });
    const ctOv = {};
    ["srf", "pr", "pmct", "ws"].forEach((k) => { if (udqVals.christmasTree[k]) ctOv[k] = udqVals.christmasTree[k]; });
    if (Object.keys(ctOv).length) envOv.christmasTree = ctOv;
    const allUdqIds = Object.assign({}, AtlasSettings.get().udqIds || {});
    if (Object.keys(envOv).length) allUdqIds[udqEnv] = envOv; else delete allUdqIds[udqEnv];
    // API base URL override: keep only a non-blank value so blank = built-in.
    const allUdqApi = Object.assign({}, AtlasSettings.get().udqApi || {});
    if (apiVal) allUdqApi[udqEnv] = apiVal; else delete allUdqApi[udqEnv];

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
      hardBlock,
      udqIds: allUdqIds,
      udqApi: allUdqApi,
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
