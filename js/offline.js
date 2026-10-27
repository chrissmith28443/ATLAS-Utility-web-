/* =========================================================================
   ATLAS Utility Web — offline.js

   OFFLINE MODE — the Utility as a stand-alone shipping-document tool, for use
   OUTSIDE ATLAS (no UDQ, no fetch). Turned on with the "Offline mode" box in
   the About window header (the version chip); remembered per browser.

   WHAT CHANGES WHILE IT'S ON
   --------------------------
     • The menu shows only: Shipment details, Commercial Invoice, Packing List,
       Placards and Air Waybill. Every UDQ-only tool, the COP, the Fetch / UDQ
       button, Compare, Run history and Consolidate are hidden.
     • All data is typed in on the Shipment details screen (or uploaded from the
       Offline Shipment Excel template — offXlsxTemplate below writes it, the
       drop zone reads it back).
     • No TTI / DTRA markings on any document: the CIV, PL and Placards print
       the user's own company name + logo (Shipment details › Your company)
       instead of the TTI / DTRA logos, "Prepared by …" lines, the DTRA
       Shipper/USPPI block and the default contract number. The U.S.
       export-control statement and the "no commercial transaction"
       declaration become Yes/No choices. offlineBrand() is what the documents
       read.
     • The pre-flight hard block is skipped (its rules are ATLAS rules).

   HOW THE DATA REACHES THE DOCUMENTS
   ----------------------------------
   Offline mode rides on Manual entry (manual_details.js): AppState.manualOnly
   is set, the shipment's parties / header fields / line items become the
   manual-details override and its packages become manual parent items
   (manual_parents.js). So CIV, PL and Placards read AppState.data exactly as
   they always do. offApplyToApp() rebuilds both from the shipment.

   PARTY MAPPING (offline name → data-model party)
     Shipper / Exporter → origin       Consignee → consignee
     Notify party       → intermediate End user  → end_user
     Pickup location    → pickup       Deliver to → deliver
   End user / Pickup / Deliver to can be "same as" another party.

   STORAGE (localStorage, in the Settings backup)
     atlas.offline            { on, company:{name, logo, logoW, logoH}, current }
     atlas.offline.shipments  { [shipment #]: shipment }   (unsaved draft: "__draft")
   ========================================================================= */

const OFF_KEY = "atlas.offline";
const OFF_SHIP_KEY = "atlas.offline.shipments";
const OFF_DRAFT = "__draft";
const OFF_TEMPLATE_MARK = "OFFLINE SHIPMENT TEMPLATE";
const OFF_TEMPLATE_VERSION = 1;

/* Rail in offline mode, in order. */
const OFF_RAIL = [
  { id: "offship",  label: "Shipment details", short: "Shipment details" },
  { id: "ci",       label: "Commercial Invoice (CIV)", short: "Commercial Invoice" },
  { id: "pl",       label: "Packing List", short: "Packing List" },
  { id: "placards", label: "Placards (box labels)", short: "Placards" },
  { id: "awb",      label: "Air Waybill (AWB)", short: "Air Waybill" },
];

/* ---- field catalogs (shared by the form and the Excel template) ---- */

const OFF_LISTS = {
  purpose: ["Sale", "Sample", "Gift", "Donation", "Return for repair", "Return after repair",
            "Repair / warranty replacement", "Temporary export", "Personal effects", "Other"],
  payterms: ["Prepaid", "Collect", "No Commercial Value", "Net 30", "Cash in advance", "Letter of credit"],
  incoterms: ["EXW", "FCA", "FAS", "FOB", "CPT", "CFR", "CIF", "CIP", "DAP", "DPU", "DDP"],
  mode: ["Air", "Ocean", "Truck", "Rail", "Courier", "Hand carry"],
  yesno: ["Yes", "No"],
  uom: ["EA", "PC", "SET", "KIT", "PR", "BOX", "CTN", "PKG", "ROL", "KG", "LB", "L", "M"],
  eccn: ["EAR99", "3A991", "4A994", "5A991", "5A992.c", "5D992.c", "6A993", "9A991"],
  auth: ["NLR", "LVS", "TMP", "GOV", "ENC", "License"],
  dimunit: ["cm", "in"],
  wtunit: ["kg", "lbs"],
};

const OFF_META_FIELDS = [
  { k: "ref",              label: "Shipment / invoice #", req: true, help: "Your reference — prints as the invoice number and names the files. Shipments are saved under it." },
  { k: "invoice_date",     label: "Invoice date", type: "date" },
  { k: "ship_date",        label: "Shipment date", type: "date" },
  { k: "purpose",          label: "Purpose of shipment", list: "purpose" },
  { k: "payment_terms",    label: "Payment terms", list: "payterms" },
  { k: "payment_remarks",  label: "Payment terms remarks" },
  { k: "incoterm",         label: "Incoterm", list: "incoterms", select: true },
  { k: "incoterm_place",   label: "Incoterm named place", help: "e.g. Addis Ababa" },
  { k: "currency",         label: "Currency", list: "currency", select: true },
  { k: "mode",             label: "Mode of transport", list: "mode", select: true },
  { k: "origin_country",   label: "Country of origin (shipment)" },
  { k: "dest_country",     label: "Country of destination" },
  { k: "awb_no",           label: "AWB / BOL / tracking #" },
  { k: "contract_no",      label: "Contract / PO #" },
  { k: "special_handling", label: "Special handling", wide: true },
  { k: "temp",             label: "Temperature requirements" },
  { k: "comments",         label: "Shipment comments (CIV)", wide: true },
  { k: "remarks",          label: "Additional remarks (CIV)", wide: true },
  { k: "signer_name",      label: "Signed by (printed name)" },
  { k: "signer_title",     label: "Signer title" },
  { k: "no_charge",        label: "No-charge declaration", type: "yesno",
    help: "Yes prints “VALUE IS DECLARED FOR CUSTOMS PURPOSES ONLY; NO COMMERCIAL TRANSACTION OCCURRED.” on the CIV." },
  { k: "dcs",              label: "U.S. export-control statement", type: "yesno",
    help: "Yes prints the U.S. destination control statement on the CIV, Packing List and Placards (U.S. exports)." },
];

const OFF_PARTIES = [
  { key: "shipper",   md: "origin",       label: "Shipper / Exporter" },
  { key: "consignee", md: "consignee",    label: "Consignee" },
  { key: "notify",    md: "intermediate", label: "Notify party / Intermediate consignee" },
  { key: "end_user",  md: "end_user",     label: "End user",         same: "consignee" },
  { key: "pickup",    md: "pickup",       label: "Pickup location",  same: "shipper" },
  { key: "deliver",   md: "deliver",      label: "Deliver to",       same: "consignee" },
];

const OFF_PARTY_FIELDS = [
  { k: "org",      label: "Company / organization", wide: true },
  { k: "addr0",    label: "Address", wide: true },
  { k: "addr1",    label: "Address line 2", wide: true },
  { k: "city",     label: "City" },
  { k: "state",    label: "State / province" },
  { k: "zip",      label: "Postal code" },
  { k: "country",  label: "Country" },
  { k: "poc_name", label: "Contact name" },
  { k: "phone",    label: "Phone" },
  { k: "email",    label: "E-mail" },
  { k: "tax_id",   label: "Tax ID / VAT / EORI" },
];

/* Line items — keys are the manual-entry item keys (manual_details.js). */
const OFF_ITEM_COLS = [
  { k: "units",        label: "Qty",               w: 56, num: true },
  { k: "uom",          label: "UOM",               w: 62, list: "uom" },
  { k: "desc",         label: "Description",       w: 240 },
  { k: "model",        label: "Model / part #",    w: 110 },
  { k: "serial",       label: "Serial #",          w: 100, more: true },
  { k: "hts",          label: "HTS / Sched B",     w: 100 },
  { k: "eccn",         label: "ECCN / USML",       w: 84, list: "eccn" },
  { k: "auth",         label: "License / auth.",   w: 90, list: "auth", more: true },
  { k: "coo",          label: "Country of origin", w: 110 },
  { k: "unit_value",   label: "Unit value",        w: 84, num: true },
  { k: "ship_group",   label: "Package #",         w: 70, help: "Matches a package's Package # — the Packing List nests the item under it." },
  { k: "un_code",      label: "UN # (dangerous goods)", w: 64, more: true },
  { k: "hazmat_class", label: "Hazard class",      w: 70, more: true },
];

/* Line-item columns marked `more` stay hidden until "Show extra columns". */
let _offMoreCols = false;

/* Packages — keys are the manual parent-item keys (manual_parents.js). */
const OFF_PKG_COLS = [
  { k: "ship_group",  label: "Package #",        w: 70 },
  { k: "description", label: "Description",      w: 190, help: "e.g. Wooden crate, Carton" },
  { k: "count",       label: "# identical",      w: 66, num: true },
  { k: "L",           label: "Length",           w: 60, num: true },
  { k: "W",           label: "Width",            w: 60, num: true },
  { k: "H",           label: "Height",           w: 60, num: true },
  { k: "dimUnit",     label: "Dim unit",         w: 66, list: "dimunit", select: true },
  { k: "weight",      label: "Weight (each)",    w: 74, num: true },
  { k: "weightUnit",  label: "Weight unit",      w: 70, list: "wtunit", select: true },
];

function _offListValues(name) {
  if (name === "currency") return (typeof CI_CURRENCIES !== "undefined" ? CI_CURRENCIES : [{ code: "USD" }]).map((c) => c.code);
  return OFF_LISTS[name] || [];
}

/* ---- small helpers ---- */

function _offStr(v) { return String(v == null ? "" : v).trim(); }
function _offYes(v) { return v === true || /^(y|yes|true|1|x)$/i.test(_offStr(v)); }

/** File-name-safe tag from the shipment # (used in document file names). */
function offlineSlug(ref) {
  return _offStr(ref).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function _offLoadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function _offSaveJson(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
}

function _offPrefs() { return _offLoadJson(OFF_KEY); }
function _offSavePrefs(patch) { _offSaveJson(OFF_KEY, Object.assign(_offPrefs(), patch)); }

/** Is offline mode on (this browser)? */
function offlineOn() { return !!_offPrefs().on; }

function offlineCompany() {
  const c = _offPrefs().company;
  return (c && typeof c === "object") ? c : {};
}

/** What the documents print in place of the TTI / DTRA markings. null when
 *  offline mode is off — callers then keep their normal (TTI) output. */
function offlineBrand() {
  if (!offlineOn()) return null;
  const c = offlineCompany();
  const s = OffState.ship || offBlankShipment();
  return {
    name: _offStr(c.name),
    logo: c.logo || "",
    logoW: c.logoW || 0,
    logoH: c.logoH || 0,
    preparedBy: _offStr(c.name) ? `Prepared by ${_offStr(c.name)}.` : "",
    declaration: _offYes(s.meta.no_charge) ? (typeof CI_DECLARATION !== "undefined" ? CI_DECLARATION : "") : "",
    dcs: _offYes(s.meta.dcs),
    signerName: _offStr(s.meta.signer_name),
    signerTitle: _offStr(s.meta.signer_title),
    remarks: _offStr(s.meta.remarks),
    comments: _offStr(s.meta.comments),
    meta: s.meta,
  };
}

/* =========================================================================
   Shipment model
   ========================================================================= */

const OffState = { ship: null, key: "" };

function _offBlankParty() {
  const p = {};
  for (const f of OFF_PARTY_FIELDS) p[f.k] = "";
  return p;
}

function offBlankShipment() {
  const meta = {};
  for (const f of OFF_META_FIELDS) meta[f.k] = "";
  meta.invoice_date = todayISO();
  meta.currency = "USD";
  meta.mode = "Air";
  meta.no_charge = "No";
  meta.dcs = "No";
  const parties = {};
  for (const p of OFF_PARTIES) parties[p.key] = _offBlankParty();
  return {
    v: 1, meta, parties,
    same: { end_user: true, pickup: true, deliver: true },
    items: [], packages: [], awb: {}, savedAt: "",
  };
}

function _offRowHasData(r) { return !!r && Object.keys(r).some((k) => _offStr(r[k]) && !(k === "count" && _offStr(r[k]) === "1") && k !== "dimUnit" && k !== "weightUnit"); }

/** Fill in anything a stored / imported shipment is missing. */
function offNormalize(src) {
  const s = offBlankShipment();
  if (!src || typeof src !== "object") return s;
  const meta = src.meta || {};
  for (const k of Object.keys(meta)) s.meta[k] = _offStr(meta[k]);
  if (!s.meta.currency) s.meta.currency = "USD";
  for (const p of OFF_PARTIES) {
    const sp = (src.parties && src.parties[p.key]) || {};
    for (const f of OFF_PARTY_FIELDS) s.parties[p.key][f.k] = _offStr(sp[f.k]);
  }
  if (src.same && typeof src.same === "object") {
    for (const p of OFF_PARTIES) if (p.same) s.same[p.key] = !!src.same[p.key];
  }
  s.items = (Array.isArray(src.items) ? src.items : []).filter(_offRowHasData)
    .map((r) => { const o = {}; for (const c of OFF_ITEM_COLS) o[c.k] = _offStr(r[c.k]); return o; });
  s.packages = (Array.isArray(src.packages) ? src.packages : []).filter(_offRowHasData)
    .map((r) => {
      const o = {}; for (const c of OFF_PKG_COLS) o[c.k] = _offStr(r[c.k]);
      o.count = o.count || "1";
      o.dimUnit = /^in/i.test(o.dimUnit) ? "in" : "cm";
      o.weightUnit = /^lb/i.test(o.weightUnit) ? "lbs" : "kg";
      return o;
    });
  s.awb = (src.awb && typeof src.awb === "object") ? Object.assign({}, src.awb) : {};
  s.savedAt = src.savedAt || "";
  return s;
}

/** The party a document should print — follows "same as". */
function _offEffParty(s, key) {
  const def = OFF_PARTIES.find((p) => p.key === key);
  if (def && def.same && s.same[key]) return s.parties[def.same];
  return s.parties[key];
}

/* ---- persistence ---- */

function _offShipments() { return _offLoadJson(OFF_SHIP_KEY); }

/** Saved shipments, newest first: [{key, ref, savedAt}] (the draft excluded). */
function offSavedList() {
  const map = _offShipments();
  return Object.keys(map).filter((k) => k !== OFF_DRAFT)
    .map((k) => ({ key: k, ref: k, savedAt: map[k].savedAt || "" }))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** Save the working shipment under its shipment # (or the draft slot). */
function offPersist() {
  const s = OffState.ship;
  if (!s) return;
  const map = _offShipments();
  const ref = _offStr(s.meta.ref);
  const key = ref || OFF_DRAFT;
  // An untouched blank shipment isn't worth a saved draft.
  const blank = !ref && !s.items.length && !s.packages.length &&
    !OFF_PARTIES.some((p) => OFF_PARTY_FIELDS.some((f) => _offStr(s.parties[p.key][f.k])));
  if (blank && !OffState.key) return;
  if (OffState.key && OffState.key !== key) delete map[OffState.key];
  s.savedAt = new Date().toISOString();
  map[key] = s;
  _offSaveJson(OFF_SHIP_KEY, map);
  OffState.key = key;
  _offSavePrefs({ current: key });
}

function offOpenSaved(key) {
  const e = _offShipments()[key];
  OffState.ship = offNormalize(e);
  OffState.key = key;
  _offSavePrefs({ current: key });
}

/* =========================================================================
   Shipment → AppState (manual entry + manual parents)
   ========================================================================= */

function offApplyToApp() {
  if (typeof AppState === "undefined") return;
  const s = OffState.ship || (OffState.ship = offBlankShipment());
  const m = s.meta;

  if (!AppState.manualOnly || !AppState.dataBase) {
    AppState.grid = null;
    AppState.history = null;
    if (typeof consolReset === "function") consolReset();
    if (typeof siReset === "function") siReset();
    AppState.udqType = "srf";
    AppState.manualOnly = true;
    AppState.dataBase = mdBlankModel();
    AppState.data = AppState.dataBase;
  }
  // Neutral base — the manual-entry defaults (Donation / No Commercial Value)
  // are TTI's, not this user's.
  const bm = AppState.dataBase.meta;
  bm.purpose = ""; bm.payment_terms = ""; bm.payment_terms_remarks = "";
  bm.wmtr = _offStr(m.ref);
  bm.wmtr_last5 = offlineSlug(m.ref);
  bm.invoice_no = bm.wmtr;
  AppState.fileName = m.ref ? `Offline shipment ${m.ref}` : "Offline shipment";

  const incoterm = [m.incoterm, m.incoterm_place].map(_offStr).filter(Boolean).join(" ");
  const meta = {
    wmtr: m.ref, purpose: m.purpose, payment_terms: m.payment_terms,
    payment_terms_remarks: m.payment_remarks, incoterm,
    country_origin: m.origin_country, country_destination: m.dest_country,
    mode_of_transit: m.mode, awb_bol: m.awb_no, shipment_ref_no: m.awb_no,
    contract_no: m.contract_no, special_handling: m.special_handling,
    temp_requirements: m.temp,
  };
  const md = mdBlank();
  md.enabled = true;
  for (const k of Object.keys(meta)) { const v = _offStr(meta[k]); if (v) md.meta[k] = v; }
  for (const p of OFF_PARTIES) {
    const src = _offEffParty(s, p.key);
    const out = md.parties[p.md];
    for (const f of OFF_PARTY_FIELDS) out[f.k] = _offStr(src[f.k]);
  }
  md.items = s.items.filter(_offRowHasData).map((r) => Object.assign({}, r));
  AppState.manualDetails = md;

  AppState.manualParents = {
    enabled: true,
    perTool: {},
    items: s.packages.filter(_offRowHasData).map((r) => Object.assign(mpBlankRow(), r, {
      count: Math.max(1, Math.trunc(toFloat(r.count) || 1)),
    })),
  };
}

/** Totals for the summary line: { items, value, pkgs, kg, volKg }. */
function offTotals(s) {
  let value = 0, pkgs = 0, kg = 0, cm3 = 0;
  for (const r of s.items) value += toFloat(r.units) * toFloat(r.unit_value);
  for (const r of s.packages) {
    const n = Math.max(1, Math.trunc(toFloat(r.count) || 1));
    pkgs += n;
    const w = toFloat(r.weight);
    kg += n * (r.weightUnit === "lbs" ? w * 0.45359237 : w);
    const f = r.dimUnit === "in" ? 2.54 : 1;
    cm3 += n * toFloat(r.L) * f * toFloat(r.W) * f * toFloat(r.H) * f;
  }
  return { items: s.items.length, value, pkgs, kg, volKg: cm3 / 6000 };
}

/* =========================================================================
   Turning offline mode on / off
   ========================================================================= */

/** Switch offline mode on or off. Reloads the page so every screen starts
 *  clean in the new mode. */
function offlineSetMode(on) {
  if (on === offlineOn()) return;
  if (on && typeof AppState !== "undefined" && (AppState.grid || (AppState.data && !AppState.manualOnly)) &&
      !confirm("Turn on offline mode? The UDQ that's loaded now will be closed.")) return false;
  _offSavePrefs({ on: !!on });
  location.reload();
  return true;
}

/** Start-up: enter offline mode (called on DOMContentLoaded when it's on). */
function offlineEnter() {
  document.body.classList.add("offline-mode");
  _offEnsureStyle();
  _offEnsureBadge();
  const cur = _offPrefs().current;
  if (cur && _offShipments()[cur]) offOpenSaved(cur);
  else { OffState.ship = offBlankShipment(); OffState.key = ""; }
  offApplyToApp();
  AppState.activeTool = "offship";
  AppState.dashCollapsed = true;
  const status = document.getElementById("loadStatus");
  if (status) {
    status.classList.remove("err");
    status.textContent = "Offline mode — enter the shipment below (or drop a filled Offline Shipment template), then pick a document from the menu.";
  }
  if (typeof renderAll === "function") renderAll();
}

function _offEnsureBadge() {
  if (document.getElementById("offlineBadge")) return;
  const ver = document.getElementById("aboutBtn");
  if (!ver) return;
  const b = el(`<button class="offline-badge" id="offlineBadge" type="button" title="Offline mode is on — click to turn it off">OFFLINE MODE</button>`);
  b.addEventListener("click", () => { if (typeof openAbout === "function") openAbout(); });
  ver.insertAdjacentElement("afterend", b);
}

/** About window header: the on/off box. */
function offlineAboutToggleHtml() {
  return `<label class="ab-offline" title="Use the Utility outside ATLAS: enter shipments by hand or from an Excel template; only the CIV, Packing List, Placards and Air Waybill are shown, with no TTI / DTRA markings.">
      <input type="checkbox" id="abOffline" ${offlineOn() ? "checked" : ""}> Offline mode</label>`;
}
/** About window body in offline mode: plain help instead of the ATLAS changelog. */
function offlineAboutHelpHtml() {
  return `<div class="ab-offhelp">
      <p><strong>Shipping documents, made by hand.</strong> Everything stays in this browser — nothing is sent anywhere.</p>
      <ol>
        <li><b>Shipment details</b> (left menu): type in the shipment, or download the blank Excel template, fill it in and upload it.</li>
        <li>Pick a document: <b>Commercial Invoice</b>, <b>Packing List</b>, <b>Placards</b> (box labels) or <b>Air Waybill</b>.</li>
        <li>Each document has a preview and a <b>Save as PDF</b> button. The Air Waybill downloads as a PDF you can still type in.</li>
      </ol>
      <p>Your company name and logo go under Shipment details ▸ Your company. Shipments are saved by shipment # — open them again from Shipment details.</p>
    </div>`;
}

function offlineWireAboutToggle(root) {
  const cb = root && root.querySelector("#abOffline");
  if (!cb) return;
  cb.addEventListener("change", () => {
    if (offlineSetMode(cb.checked) === false) cb.checked = !cb.checked;
  });
}

/* ---- rail ---- */

function offlineRenderRail(rail) {
  OFF_RAIL.forEach((t, i) => {
    if (i === 0) rail.appendChild(el(`<h3>Your shipment</h3>`));
    if (i === 1) rail.appendChild(el(`<h3>Documents</h3>`));
    const btn = el(`
      <button class="toolbtn ready ${AppState.activeTool === t.id ? "active" : ""}" data-tool="${t.id}">
        <span class="dot"></span>${esc(t.label)}
      </button>`);
    btn.addEventListener("click", () => {
      if (AppState.activeTool === "offship") offCollectFromForm();
      AppState.activeTool = t.id;
      AppState.dashCollapsed = true;
      renderRail();
      renderWorkspace();
      if (typeof scrollAfterToolSelect === "function") scrollAfterToolSelect();
    });
    rail.appendChild(btn);
  });
  const s = OffState.ship;
  if (s) {
    const t = offTotals(s);
    rail.appendChild(el(`<div class="off-railsum">${esc(s.meta.ref || "Unsaved shipment")}<br>
      ${t.items} item${t.items === 1 ? "" : "s"} · ${t.pkgs} pkg${t.pkgs === 1 ? "" : "s"}</div>`));
  }
}

/** Bar at the top of each offline document: which shipment, and a way back. */
function offlineInjectDocBar(container, toolId) {
  if (!offlineOn() || toolId === "offship" || !container) return;
  const s = OffState.ship || offBlankShipment();
  const t = offTotals(s);
  const body = container.querySelector(".panel > .body") || container.querySelector(".panel") || container;
  const bar = el(`
    <div class="off-docbar">
      <span class="off-db-lbl">Offline shipment</span>
      <span class="off-db-state"><strong>${esc(s.meta.ref || "(no shipment # yet)")}</strong> · ${t.items} line item${t.items === 1 ? "" : "s"} ·
        ${t.pkgs} package${t.pkgs === 1 ? "" : "s"}${t.kg ? " · " + esc(_offNum(t.kg)) + " kg" : ""}</span>
      <button class="btn ghost btn-sm" type="button">Edit shipment details</button>
    </div>`);
  bar.querySelector("button").addEventListener("click", () => {
    AppState.activeTool = "offship";
    renderRail();
    renderWorkspace();
  });
  body.insertBefore(bar, body.firstChild);
}

function _offNum(n) {
  const r = Math.round((+n + Number.EPSILON) * 100) / 100;
  return r.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* =========================================================================
   Shipment details screen
   ========================================================================= */

function _offInput(attr, f, val) {
  const id = `off_${attr.replace(/[^a-z0-9]/gi, "_")}`;
  if (f.type === "yesno") {
    return `<label class="off-check"><input type="checkbox" data-off="${attr}" id="${id}" data-fc-skip ${_offYes(val) ? "checked" : ""}>
      ${esc(f.label)}${f.help ? `<span class="hint">${esc(f.help)}</span>` : ""}</label>`;
  }
  let ctl;
  if (f.type === "date") {
    ctl = `<input type="date" data-off="${attr}" id="${id}" data-fc-skip value="${esc(_offIsoDate(val))}">`;
  } else if (f.select) {
    const vals = _offListValues(f.list);
    const opts = (f.k === "incoterm" ? [""] : []).concat(vals);
    if (val && opts.indexOf(val) === -1) opts.push(val);
    ctl = `<select data-off="${attr}" id="${id}" data-fc-skip>${opts.map((o) =>
      `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`;
  } else if (f.wide && (f.k === "special_handling" || f.k === "comments" || f.k === "remarks")) {
    ctl = `<textarea data-off="${attr}" id="${id}" rows="2" data-fc-skip>${esc(val)}</textarea>`;
  } else {
    ctl = `<input type="text" data-off="${attr}" id="${id}" data-fc-skip value="${esc(val)}"${f.list ? ` list="offList_${f.list}"` : ""}>`;
  }
  return `<div class="field${f.wide ? " span2" : ""}"><label for="${id}">${esc(f.label)}${f.req ? " *" : ""}</label>${ctl}
    ${f.help ? `<div class="hint">${esc(f.help)}</div>` : ""}</div>`;
}

function _offDatalists() {
  return Object.keys(OFF_LISTS).map((n) =>
    `<datalist id="offList_${n}">${OFF_LISTS[n].map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`).join("");
}

function _offPartyHtml(p, s) {
  const cur = s.parties[p.key];
  const same = p.same && s.same[p.key];
  const sameLbl = p.same ? OFF_PARTIES.find((x) => x.key === p.same).label : "";
  const fields = OFF_PARTY_FIELDS.map((f) => `
      <label class="${f.wide ? "wide" : ""}">${esc(f.label)}
        <input type="text" data-off="p.${p.key}.${f.k}" data-fc-skip value="${esc(cur[f.k])}">
      </label>`).join("");
  return `
    <div class="off-party${same ? " is-same" : ""}" data-party="${p.key}">
      <div class="off-party-h"><b>${esc(p.label)}</b>
        ${p.same ? `<label class="off-same"><input type="checkbox" data-off="same.${p.key}" data-fc-skip ${same ? "checked" : ""}> Same as ${esc(sameLbl)}</label>` : ""}
      </div>
      <div class="off-pgrid">${fields}</div>
    </div>`;
}

function _offRowHtml(cols, r, i, kind) {
  const cells = cols.map((c) => {
    const v = r[c.k] == null ? "" : r[c.k];
    if (c.select) {
      const vals = _offListValues(c.list);
      return `<td${c.more ? ' class="off-more"' : ""}><select data-c="${c.k}" data-fc-skip aria-label="${esc(c.label)}" style="width:${c.w}px">${vals.map((o) =>
        `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></td>`;
    }
    return `<td${c.more ? ' class="off-more"' : ""}><input type="text" data-c="${c.k}" data-fc-skip value="${esc(v)}" style="width:${c.w}px" aria-label="${esc(c.label)}"${c.list ? ` list="offList_${c.list}"` : ""}${c.num ? ` inputmode="decimal"` : ""}></td>`;
  }).join("");
  const extra = kind === "item" ? `<td class="off-calc" data-total>${esc(_offLineTotal(r))}</td>` : "";
  return `<tr><td class="n">${i + 1}</td>${cells}${extra}<td><button class="del" type="button" title="Delete row" aria-label="Delete row">×</button></td></tr>`;
}

function _offLineTotal(r) {
  const t = toFloat(r.units) * toFloat(r.unit_value);
  return t ? fmtMoney(t) : "";
}

function _offTableHtml(cols, rows, kind, tbodyId) {
  return `
    <div class="off-twrap">
      <table class="off-table">
        <thead><tr><th>#</th>${cols.map((c) => `<th${c.more ? ' class="off-more"' : ""}${c.help ? ` title="${esc(c.help)}"` : ""}>${esc(c.label)}</th>`).join("")}
          ${kind === "item" ? "<th>Line total</th>" : ""}<th></th></tr></thead>
        <tbody id="${tbodyId}">${rows.map((r, i) => _offRowHtml(cols, r, i, kind)).join("")}</tbody>
      </table>
    </div>`;
}

function renderOfflineShipWorkspace(container) {
  _offEnsureStyle();
  const s = OffState.ship || (OffState.ship = offBlankShipment());
  const c = offlineCompany();
  const saved = offSavedList();
  const items = s.items.length ? s.items : [{}];
  const pkgs = s.packages.length ? s.packages : [{ count: "1", dimUnit: "cm", weightUnit: "kg" }];
  const meta = (keys) => OFF_META_FIELDS.filter((f) => keys.indexOf(f.k) !== -1)
    .map((f) => _offInput("m." + f.k, f, s.meta[f.k])).join("");

  const panel = el(`
    <div class="panel off-ship${_offMoreCols ? " show-more" : ""}">
      <header><h2>Shipment details</h2><span class="count" id="offRefChip">${esc(s.meta.ref || "new shipment")}</span></header>
      <div class="body">
        ${_offDatalists()}
        <ol class="off-steps">
          <li><b>Fill in your shipment</b> on this page — type it in, or fill in the Excel template and upload it.</li>
          <li><b>Pick a document</b> on the left: Commercial Invoice, Packing List, Placards or Air Waybill.</li>
          <li><b>Download it</b> — every document has a Save as PDF button (plus Word or Excel where offered).</li>
        </ol>

        <div class="off-cards">
          <div class="off-card">
            <h4>Shipment</h4>
            <div class="off-card-row">
              <button class="btn primary btn-sm" type="button" id="offNew">+ New shipment</button>
              <select id="offOpen" aria-label="Open a saved shipment" data-fc-skip>
                <option value="">Open a saved shipment (${saved.length})…</option>
                ${saved.map((x) => `<option value="${esc(x.key)}"${x.key === OffState.key ? " disabled" : ""}>${esc(x.ref)}${x.savedAt ? " · " + esc(x.savedAt.slice(0, 10)) : ""}</option>`).join("")}
              </select>
            </div>
            <div class="off-links">
              <button class="linkbtn" type="button" id="offDup" title="Start a new shipment pre-filled with this one">Copy this shipment</button> ·
              <button class="linkbtn" type="button" id="offDel">Delete this shipment</button>
            </div>
            <div class="hint">Everything saves by itself in this browser, under the shipment #.</div>
          </div>
          <div class="off-card">
            <h4>Excel template <span class="off-sum">(optional)</span></h4>
            <div class="off-card-row">
              <button class="btn primary btn-sm" type="button" id="offUpload">Upload a filled template</button>
              <button class="btn ghost btn-sm" type="button" id="offTplBlank">Download blank template</button>
            </div>
            <div class="off-links">
              <button class="linkbtn" type="button" id="offTplExample">Download an example</button> ·
              <button class="linkbtn" type="button" id="offTplThis">Save this shipment to Excel</button>
            </div>
            <div class="hint">You can also drag a filled template onto this page.</div>
            <input type="file" id="offUploadInput" accept=".xlsx,.xlsm" class="hidden" data-fc-skip>
          </div>
        </div>
        <div class="statusline" id="offStatus"></div>

        <details class="off-sec off-company" ${c.name || c.logo ? "" : "open"}>
          <summary><h3>Your company</h3><span class="off-sum">${esc(c.name || "Name and logo printed on the documents")}</span></summary>
          <div class="off-company-body">
            <div class="field"><label for="offCoName">Company name</label>
              <input type="text" id="offCoName" data-fc-skip value="${esc(c.name || "")}" placeholder="e.g. Acme Logistics Ltd">
              <div class="hint">Printed on the CIV, Packing List, Placards and as the issuing agent on the Air Waybill.</div></div>
            <div class="field"><label>Logo</label>
              <div class="off-logo">
                <span class="off-logo-prev" id="offLogoPrev">${c.logo ? `<img src="${c.logo}" alt="Company logo">` : "No logo"}</span>
                <button class="btn ghost btn-sm" type="button" id="offLogoPick">${c.logo ? "Replace" : "Upload logo"}</button>
                ${c.logo ? `<button class="btn ghost btn-sm" type="button" id="offLogoDel">Remove</button>` : ""}
                <input type="file" id="offLogoInput" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" data-fc-skip>
              </div>
              <div class="hint">PNG or JPG. Saved in this browser only — not in the shipment.</div></div>
          </div>
        </details>

        <div class="off-sec"><h3><span class="off-n">1</span>Shipment</h3>
          <p class="off-intro">The basics. Only the shipment # is required — fill in what you know.</p>
          <div class="off-sub">Basics</div>
          <div class="formgrid">${meta(["ref", "invoice_date", "ship_date", "mode", "origin_country", "dest_country", "awb_no"])}</div>
          <div class="off-sub">For the Commercial Invoice</div>
          <div class="formgrid">${meta(["purpose", "payment_terms", "payment_remarks", "incoterm", "incoterm_place", "currency",
            "contract_no", "signer_name", "signer_title", "comments", "remarks"])}</div>
          <div class="off-checks">${meta(["no_charge", "dcs"])}</div>
          <div class="off-sub">Handling</div>
          <div class="formgrid">${meta(["special_handling", "temp"])}</div>
        </div>

        <div class="off-sec"><h3><span class="off-n">2</span>Addresses &amp; contacts</h3>
          <p class="off-intro">Who it's from and who it's going to. Leave the "same as" boxes ticked when pickup, delivery or end user match.</p>
          <div class="off-parties">${OFF_PARTIES.map((p) => _offPartyHtml(p, s)).join("")}</div>
        </div>

        <div class="off-sec"><h3><span class="off-n">3</span>What's in the shipment <span class="off-sum" id="offItemSum"></span></h3>
          <p class="off-intro">One row per item. You can copy rows from Excel and paste them into the first box.</p>
          <div class="off-tbar"><button class="btn ghost btn-sm" type="button" data-add="item">+ Add item</button>
            <button class="linkbtn" type="button" id="offMoreCols">${_offMoreCols ? "Hide extra columns" : "Show extra columns (serial #, license, dangerous goods)"}</button></div>
          ${_offTableHtml(OFF_ITEM_COLS, items, "item", "offItems")}
        </div>

        <div class="off-sec"><h3><span class="off-n">4</span>Packages <span class="off-sum" id="offPkgSum"></span></h3>
          <p class="off-intro">One row per box, crate or pallet size. Several the same size? Enter the number in "# identical". Weight and size are for ONE package.
            To show which items are in which box on the Packing List, give the item the same Package #.</p>
          <div class="off-tbar"><button class="btn ghost btn-sm" type="button" data-add="pkg">+ Add package</button></div>
          ${_offTableHtml(OFF_PKG_COLS, pkgs, "pkg", "offPkgs")}
        </div>

        <div class="off-sec off-next"><h3><span class="off-n">5</span>Make your documents</h3>
          <div class="off-docbtns">
          ${OFF_RAIL.filter((t) => t.id !== "offship").map((t) =>
            `<button class="btn primary" type="button" data-go="${t.id}">${esc(t.label)} →</button>`).join("")}
          </div>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);
  _offWireShipForm(panel);
  _offUpdateSums(panel);
}

/** Read the whole form back into OffState.ship. */
function offCollectFromForm() {
  const panel = document.querySelector(".off-ship");
  const s = OffState.ship;
  if (!panel || !s) return;
  panel.querySelectorAll("[data-off]").forEach((inp) => {
    const path = inp.dataset.off.split(".");
    const v = inp.type === "checkbox" ? inp.checked : inp.value;
    if (path[0] === "m") {
      const f = OFF_META_FIELDS.find((x) => x.k === path[1]);
      s.meta[path[1]] = f && f.type === "yesno" ? (v ? "Yes" : "No") : _offStr(v);
    } else if (path[0] === "p") s.parties[path[1]][path[2]] = _offStr(v);
    else if (path[0] === "same") s.same[path[1]] = !!v;
  });
  const rows = (tbodyId, cols) => {
    const out = [];
    panel.querySelectorAll(`#${tbodyId} tr`).forEach((tr) => {
      const r = {};
      tr.querySelectorAll("[data-c]").forEach((inp) => { r[inp.dataset.c] = _offStr(inp.value); });
      if (_offRowHasData(r)) out.push(r);
    });
    return out;
  };
  s.items = rows("offItems", OFF_ITEM_COLS);
  s.packages = rows("offPkgs", OFF_PKG_COLS);
}

let _offSaveTimer = null;
function _offChanged(panel, immediate) {
  clearTimeout(_offSaveTimer);
  const go = () => {
    offCollectFromForm();
    offPersist();
    offApplyToApp();
    // Rebuild the data the documents read without redrawing this form.
    if (typeof mpApplyGlobal === "function") mpApplyGlobal();
    if (typeof mdApplyGlobal === "function") mdApplyGlobal();
    renderRail();
    _offUpdateSums(panel);
    const st = panel.querySelector("#offStatus");
    if (st && !st.classList.contains("keep")) {
      st.classList.remove("err");
      st.textContent = `Saved${OffState.ship.meta.ref ? " as " + OffState.ship.meta.ref : " (enter a shipment # to keep it)"} · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
  };
  if (immediate) go(); else _offSaveTimer = setTimeout(go, 350);
}

function _offUpdateSums(panel) {
  const s = OffState.ship;
  if (!s || !panel) return;
  const t = offTotals(s);
  const cur = s.meta.currency || "USD";
  const isum = panel.querySelector("#offItemSum");
  if (isum) isum.textContent = t.items ? `· ${t.items} line${t.items === 1 ? "" : "s"} · total ${fmtMoney(t.value)} ${cur}` : "";
  const psum = panel.querySelector("#offPkgSum");
  if (psum) psum.textContent = t.pkgs
    ? `· ${t.pkgs} package${t.pkgs === 1 ? "" : "s"} · ${_offNum(t.kg)} kg (${_offNum(t.kg / 0.45359237)} lbs)` +
      (t.volKg ? ` · volume weight ${_offNum(t.volKg)} kg` : "")
    : "";
  const chip = panel.querySelector("#offRefChip");
  if (chip) chip.textContent = s.meta.ref || "new shipment";
  panel.querySelectorAll("#offItems tr").forEach((tr) => {
    const g = (k) => { const i = tr.querySelector(`[data-c="${k}"]`); return i ? i.value : ""; };
    const cell = tr.querySelector("[data-total]");
    if (cell) cell.textContent = _offLineTotal({ units: g("units"), unit_value: g("unit_value") });
  });
}

function _offWireShipForm(panel) {
  const status = panel.querySelector("#offStatus");
  const say = (msg, err) => { status.textContent = msg; status.classList.toggle("err", !!err); };

  panel.addEventListener("input", (e) => {
    if (e.target.closest(".off-company") || e.target.id === "offOpen") return;
    _offChanged(panel);
  });
  panel.addEventListener("change", (e) => {
    const t = e.target;
    if (t.closest(".off-company") || t.id === "offOpen" || t.type === "file") return;
    if (t.dataset.off && t.dataset.off.indexOf("same.") === 0) {
      t.closest(".off-party").classList.toggle("is-same", t.checked);
    }
    // A shipment # that's already used by ANOTHER saved shipment.
    if (t.dataset.off === "m.ref") {
      const ref = _offStr(t.value);
      const map = _offShipments();
      if (ref && map[ref] && ref !== OffState.key) {
        if (confirm(`There's already a saved shipment ${ref}.\n\nOK = open it (what's on screen stays saved under its current number).\nCancel = keep editing and pick a different number.`)) {
          offOpenSaved(ref);
          offApplyToApp();
          renderAll();
          return;
        }
        t.value = OffState.ship.meta.ref;
        return;
      }
    }
    _offChanged(panel, true);
  });

  // Line items / packages: add + delete rows.
  panel.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      const item = add.dataset.add === "item";
      const tbody = panel.querySelector(item ? "#offItems" : "#offPkgs");
      const n = tbody.querySelectorAll("tr").length;
      const row = item ? {} : { count: "1", dimUnit: "cm", weightUnit: "kg" };
      tbody.appendChild(el(`<table><tbody>${_offRowHtml(item ? OFF_ITEM_COLS : OFF_PKG_COLS, row, n, item ? "item" : "pkg")}</tbody></table>`).querySelector("tr"));
      const first = tbody.lastElementChild.querySelector("input");
      if (first) first.focus();
      return;
    }
    const del = e.target.closest("button.del");
    if (del) {
      const tbody = del.closest("tbody");
      del.closest("tr").remove();
      tbody.querySelectorAll("tr").forEach((tr, i) => { tr.querySelector("td.n").textContent = i + 1; });
      _offChanged(panel, true);
      return;
    }
    const go = e.target.closest("[data-go]");
    if (go) {
      _offChanged(panel, true);
      AppState.activeTool = go.dataset.go;
      renderRail();
      renderWorkspace();
      if (typeof scrollAfterToolSelect === "function") scrollAfterToolSelect();
    }
  });

  // Paste a block of cells (from Excel) into the line-item / package tables.
  panel.addEventListener("paste", (e) => {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.c) return;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const tbody = inp.closest("tbody");
    const item = tbody.id === "offItems";
    const cols = item ? OFF_ITEM_COLS : OFF_PKG_COLS;
    const startCol = cols.findIndex((c) => c.k === inp.dataset.c);
    let tr = inp.closest("tr");
    text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").forEach((line, li) => {
      if (li > 0) {
        tr = tr.nextElementSibling;
        if (!tr) {
          const n = tbody.querySelectorAll("tr").length;
          tbody.appendChild(el(`<table><tbody>${_offRowHtml(cols, item ? {} : { count: "1", dimUnit: "cm", weightUnit: "kg" }, n, item ? "item" : "pkg")}</tbody></table>`).querySelector("tr"));
          tr = tbody.lastElementChild;
        }
      }
      line.split("\t").forEach((v, ci) => {
        const col = cols[startCol + ci];
        const cell = col && tr.querySelector(`[data-c="${col.k}"]`);
        if (cell) cell.value = v.trim();
      });
    });
    _offChanged(panel, true);
  });

  // Saved shipments.
  panel.querySelector("#offOpen").addEventListener("change", (e) => {
    const pick = e.target.value;
    if (!pick) return;
    offCollectFromForm();
    offPersist();
    offOpenSaved(pick);
    offApplyToApp();
    renderAll();
  });
  panel.querySelector("#offNew").addEventListener("click", () => {
    offCollectFromForm();
    offPersist();
    OffState.ship = offBlankShipment();
    OffState.key = "";
    offApplyToApp();
    renderAll();
    const ref = document.getElementById("off_m_ref");
    if (ref) ref.focus();
  });
  panel.querySelector("#offMoreCols").addEventListener("click", (e) => {
    _offMoreCols = !_offMoreCols;
    panel.classList.toggle("show-more", _offMoreCols);
    e.target.textContent = _offMoreCols ? "Hide extra columns" : "Show extra columns (serial #, license, dangerous goods)";
  });
  // Drag a filled template anywhere onto the page (the drop zone is hidden
  // in offline mode).
  panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("off-drop"); });
  panel.addEventListener("dragleave", (e) => { if (e.target === panel) panel.classList.remove("off-drop"); });
  panel.addEventListener("drop", async (e) => {
    e.preventDefault();
    panel.classList.remove("off-drop");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) await offImportTemplateFile(f);
  });
  panel.querySelector("#offDup").addEventListener("click", () => {
    offCollectFromForm();
    offPersist();
    const copy = offNormalize(JSON.parse(JSON.stringify(OffState.ship)));
    copy.meta.ref = "";
    copy.meta.invoice_date = todayISO();
    copy.awb = {};
    OffState.ship = copy;
    OffState.key = "";
    offApplyToApp();
    renderAll();
    const st = document.getElementById("offStatus");
    if (st) st.textContent = "Copied. Give this one its own shipment # to save it.";
    const ref = document.getElementById("off_m_ref");
    if (ref) ref.focus();
  });
  panel.querySelector("#offDel").addEventListener("click", () => {
    const ref = OffState.ship.meta.ref || "this unsaved shipment";
    if (!confirm(`Delete ${ref} from this browser? This can't be undone.`)) return;
    const map = _offShipments();
    delete map[OffState.key || OFF_DRAFT];
    _offSaveJson(OFF_SHIP_KEY, map);
    OffState.ship = offBlankShipment();
    OffState.key = "";
    _offSavePrefs({ current: "" });
    offApplyToApp();
    renderAll();
  });

  // Excel template.
  const up = panel.querySelector("#offUploadInput");
  panel.querySelector("#offUpload").addEventListener("click", () => up.click());
  up.addEventListener("change", async () => {
    const f = up.files && up.files[0];
    up.value = "";
    if (f) await offImportTemplateFile(f);
  });
  panel.querySelector("#offTplBlank").addEventListener("click", () => offDownloadTemplate("blank").catch((e) => say(e.message, true)));
  panel.querySelector("#offTplExample").addEventListener("click", () => offDownloadTemplate("example").catch((e) => say(e.message, true)));
  panel.querySelector("#offTplThis").addEventListener("click", () => {
    offCollectFromForm();
    offDownloadTemplate("current").catch((e) => say(e.message, true));
  });

  // Company name + logo (per browser, not per shipment).
  const co = panel.querySelector("#offCoName");
  co.addEventListener("input", () => {
    _offSavePrefs({ company: Object.assign({}, offlineCompany(), { name: co.value.trim() }) });
    panel.querySelector(".off-company .off-sum").textContent = co.value.trim() || "Name and logo printed on the documents";
  });
  const li = panel.querySelector("#offLogoInput");
  panel.querySelector("#offLogoPick").addEventListener("click", () => li.click());
  li.addEventListener("change", async () => {
    const f = li.files && li.files[0];
    li.value = "";
    if (!f) return;
    try {
      const img = await _offLogoToPng(f);
      _offSavePrefs({ company: Object.assign({}, offlineCompany(), img) });
      renderWorkspace();
    } catch (err) { say(err.message, true); }
  });
  const ld = panel.querySelector("#offLogoDel");
  if (ld) ld.addEventListener("click", () => {
    const c = Object.assign({}, offlineCompany());
    delete c.logo; delete c.logoW; delete c.logoH;
    _offSavePrefs({ company: c });
    renderWorkspace();
  });
}

/** Read an image file and re-encode it as a PNG (max 600 px on the long side)
 *  — PNG embeds everywhere (PDF, Word, HTML) and keeps localStorage small. */
function _offLogoToPng(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error("That isn't an image file — use a PNG or JPG.")); return; }
    const r = new FileReader();
    r.onerror = () => reject(new Error("Couldn't read the logo file."));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read the logo image."));
      img.onload = () => {
        const max = 600;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve({ logo: cv.toDataURL("image/png"), logoW: w, logoH: h });
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* =========================================================================
   Excel template — write
   ========================================================================= */

const _OFF_AWB_TPL = () => (typeof AWB_FIELDS !== "undefined" ? AWB_FIELDS.filter((f) => !f.noTemplate) : []);

/** Rows of the Shipment sheet: { section } or { key, label, help, list, value }. */
function _offShipmentRows(s) {
  const rows = [];
  rows.push({ section: "SHIPMENT" });
  for (const f of OFF_META_FIELDS) {
    rows.push({ key: "m." + f.k, label: f.label + (f.req ? " *" : ""), help: f.help || (f.type === "date" ? "Date, e.g. 2026-10-16" : ""),
      list: f.type === "yesno" ? "yesno" : f.list, value: s ? s.meta[f.k] : (f.type === "yesno" ? "No" : f.k === "currency" ? "USD" : f.k === "mode" ? "Air" : "") });
  }
  for (const p of OFF_PARTIES) {
    rows.push({ section: p.label.toUpperCase() });
    if (p.same) {
      const sl = OFF_PARTIES.find((x) => x.key === p.same).label;
      rows.push({ key: "same." + p.key, label: `Same as ${sl}?`, help: `Yes = use the ${sl} address and leave the rest of this section blank.`,
        list: "yesno", value: s ? (s.same[p.key] ? "Yes" : "No") : "Yes" });
    }
    for (const f of OFF_PARTY_FIELDS) rows.push({ key: `p.${p.key}.${f.k}`, label: f.label, value: s ? s.parties[p.key][f.k] : "" });
  }
  const awb = _OFF_AWB_TPL();
  if (awb.length) {
    rows.push({ section: "AIR WAYBILL (optional — only used by the Air Waybill; blank = worked out from the rest of the shipment)" });
    for (const f of awb) rows.push({ key: "awb." + f.k, label: f.label, help: f.hint || "", list: f.list, value: s ? (s.awb[f.k] || "") : "" });
  }
  return rows;
}

const OFF_EXAMPLE = {
  meta: { ref: "ACME-2026-014", invoice_date: "2026-10-14", ship_date: "2026-10-16", purpose: "Sale",
    payment_terms: "Prepaid", incoterm: "DAP", incoterm_place: "Addis Ababa", currency: "USD", mode: "Air",
    origin_country: "Kenya", dest_country: "Ethiopia", awb_no: "706-52342102", contract_no: "PO-88213",
    special_handling: "Keep dry. Do not stack.", temp: "Ambient", signer_name: "Jane Mwangi", signer_title: "Logistics Manager",
    no_charge: "No", dcs: "No" },
  parties: {
    shipper: { org: "Change Biotec Limited", addr0: "House 37B Kayahwe Road", addr1: "Kilimani", city: "Nairobi", zip: "00100",
      country: "Kenya", poc_name: "Pauline Otieno", phone: "+254 111 777 258", email: "shipping@example.com", tax_id: "P051234567X" },
    consignee: { org: "Addis Research Laboratory", addr0: "Entoto Street", addr1: "P.O. Box 1014", city: "Addis Ababa",
      country: "Ethiopia", poc_name: "Mohammed Raja", phone: "+251 111 307 568", email: "receiving@example.org" },
  },
  same: { end_user: true, pickup: true, deliver: true },
  items: [
    { units: "1", uom: "EA", desc: "DNA sequencing system, compact benchtop", model: "MK1D", serial: "SN-0042", hts: "9027.81",
      eccn: "EAR99", auth: "NLR", coo: "United Kingdom", unit_value: "4995.00", ship_group: "1" },
    { units: "5", uom: "EA", desc: "Flow cell, sequencing consumable", model: "FLO-MIN114", hts: "3822.19", eccn: "EAR99",
      auth: "NLR", coo: "United Kingdom", unit_value: "900.00", ship_group: "1" },
  ],
  packages: [{ ship_group: "1", description: "Carton", count: "1", L: "76", W: "52", H: "53", dimUnit: "cm", weight: "22", weightUnit: "kg" }],
  awb: { prefix: "706", serial: "52342102", dep_code: "NBO", dep_airport: "Nairobi", dest_airport: "Addis Ababa",
    route_to1: "ADD", route_by1: "KQ", flight1: "KQ402/16", issued_by: "Kenya Airways\nAirport North Road\nNairobi, Kenya" },
};

function _offXmlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _offCol(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

/* Styles: 0 normal · 1 title · 2 section band · 3 label · 4 input · 5 help · 6 table header · 7 key (grey) · 8 note */
const _OFF_XLSX_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="6">` +
  `<font><sz val="10"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="10"/><name val="Calibri"/></font>` +
  `<font><i/><sz val="9"/><color rgb="FF5B6B7C"/><name val="Calibri"/></font>` +
  `<font><sz val="8"/><color rgb="FF9AA4B2"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF16283C"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF5B6B7C"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8DC"/></patternFill></fill></fills>` +
  `<borders count="2"><border/><border><left style="thin"><color rgb="FFD4DAE0"/></left><right style="thin"><color rgb="FFD4DAE0"/></right>` +
  `<top style="thin"><color rgb="FFD4DAE0"/></top><bottom style="thin"><color rgb="FFD4DAE0"/></bottom></border></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="9">` +
  `<xf fontId="0" fillId="0" borderId="0"/>` +
  `<xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>` +
  `<xf fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>` +
  `<xf fontId="3" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" numFmtId="49" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf fontId="4" fillId="0" borderId="0" applyFont="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>` +
  `<xf fontId="5" fillId="0" borderId="0" applyFont="1"/>` +
  `<xf fontId="0" fillId="0" borderId="0"><alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs></styleSheet>`;

/** One worksheet's XML. sheet: { rows:[[cell]], cols:[width], merges:[], dv:[{sqref, ref}], freeze, hidden:[colIdx], heights:{row:h} } */
function _offSheetXml(sheet) {
  const cols = (sheet.cols || []).map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${(sheet.hidden || []).indexOf(i + 1) !== -1 ? ` hidden="1"` : ""}/>`).join("");
  const rows = sheet.rows.map((row, ri) => {
    const r = ri + 1;
    const ht = sheet.heights && sheet.heights[r] ? ` ht="${sheet.heights[r]}" customHeight="1"` : "";
    const cells = row.map((c, ci) => {
      if (c == null) return "";
      const cell = typeof c === "object" ? c : { v: c };
      const ref = _offCol(ci + 1) + r;
      const st = cell.s ? ` s="${cell.s}"` : "";
      if (cell.v === "" || cell.v == null) return st ? `<c r="${ref}"${st}/>` : "";
      if (typeof cell.v === "number") return `<c r="${ref}"${st}><v>${cell.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${_offXmlEsc(cell.v)}</t></is></c>`;
    }).join("");
    return `<row r="${r}"${ht}>${cells}</row>`;
  }).join("");
  const freeze = sheet.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  const dv = (sheet.dv || []).length ? `<dataValidations count="${sheet.dv.length}">${sheet.dv.map((d) =>
    `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${d.sqref}"><formula1>${_offXmlEsc(d.ref)}</formula1></dataValidation>`).join("")}</dataValidations>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}${dv}` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
}

/** Build the template workbook. mode: "blank" | "example" | "current". */
async function offBuildTemplate(mode) {
  if (typeof JSZip === "undefined") throw new Error("The Excel engine (JSZip) isn't loaded — reload the page while online once.");
  const s = mode === "blank" ? null : mode === "example" ? offNormalize(OFF_EXAMPLE) : OffState.ship;

  // Lists sheet: one column per dropdown list.
  const listNames = Object.keys(OFF_LISTS).concat(["currency"]);
  const listCol = {};
  const listRows = [listNames.map((n) => ({ v: n, s: 6 }))];
  listNames.forEach((n, i) => {
    listCol[n] = _offCol(i + 1);
    _offListValues(n).forEach((v, ri) => {
      if (!listRows[ri + 1]) listRows[ri + 1] = [];
      listRows[ri + 1][i] = v;
    });
  });
  const listRef = (n) => `Lists!$${listCol[n]}$2:$${listCol[n]}$${_offListValues(n).length + 1}`;

  // Shipment sheet (A label · B value · C help · D key, hidden).
  const shRows = [
    [{ v: OFF_TEMPLATE_MARK, s: 1 }, { v: "", s: 1 }, { v: "", s: 1 }, { v: "key", s: 7 }],
    [{ v: "Fill in column B (yellow). Leave anything you don't need blank. Line items and packages go on their own tabs. Then drop this file onto the Utility in offline mode (or Shipment details ▸ Upload Excel template). Don't rename the tabs or column A.", s: 8 }],
    [{ v: "Template version", s: 3 }, { v: String(OFF_TEMPLATE_VERSION), s: 4 }, "", { v: "_version", s: 7 }],
  ];
  const merges = ["A1:C1", "A2:C2"];
  const dv = [];
  for (const r of _offShipmentRows(s)) {
    const rn = shRows.length + 1;
    if (r.section) {
      shRows.push([{ v: r.section, s: 2 }, { v: "", s: 2 }, { v: "", s: 2 }]);
      merges.push(`A${rn}:C${rn}`);
      continue;
    }
    shRows.push([{ v: r.label, s: 3 }, { v: r.value || "", s: 4 }, { v: r.help || "", s: 5 }, { v: r.key, s: 7 }]);
    if (Array.isArray(r.list)) dv.push({ sqref: `B${rn}`, ref: `"${r.list.join(",")}"` });   // short inline list (AWB)
    else if (r.list && listCol[r.list]) dv.push({ sqref: `B${rn}`, ref: listRef(r.list) });
  }

  // Items + Packages sheets: header row, then one row per entry (50 styled rows).
  const tableSheet = (cols, rows, n) => {
    const out = [cols.map((c) => ({ v: c.label, s: 6 }))];
    for (let i = 0; i < Math.max(n, rows.length); i++) {
      const r = rows[i] || {};
      out.push(cols.map((c) => ({ v: r[c.k] || "", s: 4 })));
    }
    const tdv = [];
    cols.forEach((c, i) => { if (c.list && listCol[c.list]) tdv.push({ sqref: `${_offCol(i + 1)}2:${_offCol(i + 1)}${n + 1}`, ref: listRef(c.list) }); });
    return { rows: out, cols: cols.map((c) => Math.max(9, Math.round(c.w / 6.5))), freeze: 1, dv: tdv, heights: { 1: 30 } };
  };
  const pkgDefaults = s ? s.packages : [];
  const help = [
    [{ v: "HOW TO USE THIS TEMPLATE", s: 1 }],
    [{ v: "1. Shipment tab: fill column B. Pick from the drop-downs where there is one (you can also type your own value for purpose, payment terms, UOM, ECCN and license).", s: 8 }],
    [{ v: "2. Items tab: one row per line item. Qty × Unit value = line total on the Commercial Invoice.", s: 8 }],
    [{ v: "3. Packages tab: one row per package size. '# identical' covers several of the same size. Weight and dimensions are PER package.", s: 8 }],
    [{ v: "4. Package # links items to packages: give an item the Package # of the package it is packed in and the Packing List lists it inside that package. Optional.", s: 8 }],
    [{ v: "5. Air Waybill section (bottom of the Shipment tab) is optional. Anything left blank is worked out from the rest of the shipment (pieces, weights, chargeable weight, addresses, goods description).", s: 8 }],
    [{ v: "6. In the Utility: turn on Offline mode (click the version number at the top), then drop this file on the drop zone or use Shipment details ▸ Upload Excel template.", s: 8 }],
    [{ v: "The Lists tab feeds the drop-downs — leave it in place.", s: 8 }],
  ];
  const sheets = [
    { name: "Shipment", sheet: { rows: shRows, cols: [34, 46, 60, 14], hidden: [4], merges, dv, heights: { 1: 26, 2: 42 } } },
    { name: "Items", sheet: tableSheet(OFF_ITEM_COLS, s ? s.items : [], 50) },
    { name: "Packages", sheet: tableSheet(OFF_PKG_COLS, pkgDefaults.length ? pkgDefaults : [{ count: "1", dimUnit: "cm", weightUnit: "kg" }], 25) },
    { name: "How to use", sheet: { rows: help, cols: [120] } },
    { name: "Lists", sheet: { rows: listRows, cols: listNames.map(() => 18) } },
  ];

  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets.map((x, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`);
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((x, i) => `<sheet name="${_offXmlEsc(x.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((x, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", _OFF_XLSX_STYLES);
  sheets.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, _offSheetXml(x.sheet)));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function offDownloadTemplate(mode) {
  const blob = await offBuildTemplate(mode);
  const ref = mode === "current" ? offlineSlug(OffState.ship && OffState.ship.meta.ref) : "";
  const name = mode === "blank" ? "Offline_Shipment_Template.xlsx"
    : mode === "example" ? "Offline_Shipment_Template_Example.xlsx"
    : `Offline_Shipment_${ref || "unsaved"}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  const st = document.getElementById("offStatus");
  if (st) { st.classList.remove("err"); st.textContent = `Downloaded ${name}`; }
}

/* =========================================================================
   Excel template — read
   ========================================================================= */

/** Is this workbook ({names, grids}) an Offline Shipment template? */
function offIsTemplate(sheets) {
  const g = sheets && sheets.grids && sheets.grids["Shipment"];
  return !!(g && g[0] && String(g[0][0] || "").toUpperCase().indexOf(OFF_TEMPLATE_MARK) !== -1);
}

/** Dates typed in Excel arrive as text ("10/16/26", "16-Oct-2026", …) → YYYY-MM-DD. */
function _offIsoDate(v) {
  const s = _offStr(v);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);   // US order (Excel's default text)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  }
  const d = new Date(s.replace(/-/g, " "));
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return "";
}

/** Parse a template workbook into a shipment. */
function offParseTemplate(sheets) {
  const s = offBlankShipment();
  s.same = { end_user: false, pickup: false, deliver: false };
  const g = sheets.grids["Shipment"] || [];
  // Fallback when the hidden key column was lost: section title + label.
  const byLabel = {};
  for (const r of _offShipmentRows(null)) if (!r.section) byLabel[r.label.replace(/\s*\*$/, "").toLowerCase()] = r.key;
  const sectionKey = {};
  for (const p of OFF_PARTIES) sectionKey[p.label.toUpperCase()] = p.key;
  let section = "";
  for (const row of g) {
    if (!row) continue;
    const a = _offStr(row[0]), b = _offStr(row[1]);
    let key = _offStr(row[3]);
    if (!key && a && !b && /^[A-Z /()—-]+/.test(a) && a === a.toUpperCase()) { section = a; continue; }
    if (!key) {
      const lbl = a.replace(/\s*\*$/, "").toLowerCase();
      const pk = sectionKey[section];
      const pf = OFF_PARTY_FIELDS.find((f) => f.label.toLowerCase() === lbl);
      if (pk && pf) key = `p.${pk}.${pf.k}`;
      else if (pk && /^same as/.test(lbl)) key = `same.${pk}`;
      else key = byLabel[lbl] || "";
    }
    if (!key || key === "key" || key === "_version") continue;
    const path = key.split(".");
    if (path[0] === "m") {
      const f = OFF_META_FIELDS.find((x) => x.k === path[1]);
      if (!f) continue;
      s.meta[f.k] = f.type === "date" ? _offIsoDate(b) : f.type === "yesno" ? (_offYes(b) ? "Yes" : "No") : b;
    } else if (path[0] === "p" && s.parties[path[1]]) {
      s.parties[path[1]][path[2]] = b;
    } else if (path[0] === "same") {
      s.same[path[1]] = _offYes(b);
    } else if (path[0] === "awb") {
      if (b) s.awb[path[1]] = b;
    }
  }
  if (!s.meta.currency) s.meta.currency = "USD";
  // A party marked "same as" with nothing typed stays linked; if they typed an
  // address anyway, the typed one wins.
  for (const p of OFF_PARTIES) {
    if (!p.same) continue;
    const typed = OFF_PARTY_FIELDS.some((f) => _offStr(s.parties[p.key][f.k]));
    if (!typed && !s.same[p.key]) s.same[p.key] = true;
    if (typed) s.same[p.key] = false;
  }
  const table = (name, cols) => {
    const t = sheets.grids[name] || [];
    if (!t.length) return [];
    const head = (t[0] || []).map((h) => _offStr(h).toLowerCase());
    const idx = cols.map((c) => head.indexOf(c.label.toLowerCase()));
    const out = [];
    for (let i = 1; i < t.length; i++) {
      const row = t[i] || [];
      const r = {};
      cols.forEach((c, ci) => { r[c.k] = idx[ci] === -1 ? "" : _offStr(row[idx[ci]]); });
      if (_offRowHasData(r)) out.push(r);
    }
    return out;
  };
  s.items = table("Items", OFF_ITEM_COLS);
  s.packages = table("Packages", OFF_PKG_COLS);
  return offNormalize(s);
}

/** Load an uploaded template (from the drop zone or the Upload button). */
async function offImportTemplateFile(file) {
  const status = document.getElementById("offStatus") || document.getElementById("loadStatus");
  let sheets;
  try {
    sheets = workbookAllSheets(await file.arrayBuffer());
  } catch (e) {
    if (status) { status.textContent = `Couldn't read ${file.name}: ${e.message}`; status.classList.add("err"); }
    return false;
  }
  if (!offIsTemplate(sheets)) {
    if (status) {
      status.textContent = `${file.name} isn't an Offline Shipment template. Download the blank template from Shipment details, fill it in, and upload that.`;
      status.classList.add("err");
    }
    return false;
  }
  const s = offParseTemplate(sheets);
  const ref = _offStr(s.meta.ref);
  const map = _offShipments();
  if (ref && map[ref] && !confirm(`Shipment ${ref} is already saved in this browser.\n\nOK = replace it with the template.\nCancel = keep the saved one.`)) return true;
  if (OffState.ship && AppState.activeTool === "offship") { offCollectFromForm(); offPersist(); }
  OffState.ship = s;
  OffState.key = ref && map[ref] ? ref : "";
  offPersist();
  offApplyToApp();
  AppState.activeTool = "offship";
  renderAll();
  const st = document.getElementById("offStatus");
  if (st) {
    st.classList.remove("err");
    st.textContent = `Loaded ${file.name} — ${s.items.length} line item${s.items.length === 1 ? "" : "s"}, ${s.packages.length} package row${s.packages.length === 1 ? "" : "s"}${ref ? `, saved as ${ref}` : ""}.`;
  }
  return true;
}

/** loadFile() hook. In offline mode every dropped file is handled here; with
 *  offline mode off, a dropped template offers to switch it on. */
async function offlineMaybeFile(file) {
  if (offlineOn()) { await offImportTemplateFile(file); return true; }
  if (!/\.xls[xm]$/i.test(file.name)) return false;
  let sheets;
  try { sheets = workbookAllSheets(await file.arrayBuffer()); } catch (e) { return false; }
  if (!offIsTemplate(sheets)) return false;
  if (!confirm("This is an Offline Shipment template. Turn on offline mode and load it?")) return true;
  const s = offParseTemplate(sheets);
  OffState.ship = s;
  OffState.key = "";
  offPersist();
  _offSavePrefs({ on: true });
  location.reload();
  return true;
}

/* =========================================================================
   Styles
   ========================================================================= */

function _offEnsureStyle() {
  if (document.getElementById("offStyle")) return;
  const st = document.createElement("style");
  st.id = "offStyle";
  st.textContent = `
  body.offline-mode #compareBtn, body.offline-mode #historyBtn, body.offline-mode .fetch-wrap,
  body.offline-mode #consolBtn, body.offline-mode #recentUdqs, body.offline-mode #dashboard,
  body.offline-mode .udq-actions, body.offline-mode #settingsBtn, body.offline-mode #dropzone,
  body.offline-mode #loadStatus, body.offline-mode .rail-packet{display:none !important;}
  .offline-badge{display:none;}
  body.offline-mode .offline-badge{display:inline-block;margin-left:8px;font:700 .7rem var(--disp);letter-spacing:.08em;
    background:var(--accent);color:#fff;border:0;border-radius:5px;padding:3px 9px;cursor:pointer;}
  .off-railsum{margin:12px 10px 0;padding:8px 10px;border:1px dashed var(--line);border-radius:8px;font-size:.78rem;color:var(--steel);line-height:1.4;word-break:break-word;}
  .off-docbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:9px 12px;border:1px solid var(--line);
    border-left:4px solid var(--accent);border-radius:9px;background:var(--card);}
  .off-docbar .off-db-lbl{font:600 .8rem var(--disp);letter-spacing:.02em;text-transform:uppercase;}
  .off-docbar .off-db-state{font-size:.86rem;color:var(--steel);flex:1 1 240px;}
  .off-docbar .off-db-state strong{color:var(--ink);}
  .workspace .off-ship .formgrid::before{content:none;display:none;}
  .off-steps{margin:0 0 14px;padding:12px 14px 12px 34px;background:var(--paper);border:1px solid var(--line);border-radius:9px;
    display:flex;flex-direction:column;gap:4px;font-size:.92rem;}
  .off-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:6px;}
  .off-card{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--card);}
  .off-card h4{margin:0 0 8px;font:600 .9rem var(--disp);letter-spacing:.03em;text-transform:uppercase;}
  .off-card-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
  .off-card-row select{flex:1 1 180px;min-width:0;}
  .off-links{margin-top:8px;font-size:.84rem;color:var(--steel);}
  .linkbtn{background:none;border:0;padding:0;cursor:pointer;color:var(--accent);font:600 .84rem inherit;}
  .linkbtn:hover{text-decoration:underline;}
  .off-card .hint{margin-top:6px;}
  .off-n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;
    background:var(--accent);color:#fff;font-size:.8rem;margin-right:8px;vertical-align:1px;}
  .off-intro{margin:-4px 0 10px;color:var(--steel);font-size:.88rem;}
  .off-sub{font:600 .78rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin:12px 0 6px;}
  .off-ship .off-more{display:none;}
  .off-ship.show-more .off-more{display:table-cell;}
  .off-ship.off-drop{outline:3px dashed var(--accent);outline-offset:-6px;}
  .off-docbtns{display:flex;gap:10px;flex-wrap:wrap;}
  .ab-offhelp p{margin:0 0 10px;font-size:.92rem;}
  .ab-offhelp ol{margin:0 0 10px;padding-left:20px;font-size:.92rem;}
  .ab-offhelp li{margin:4px 0;}
  @media (max-width:700px){ .off-cards{grid-template-columns:1fr;} }
  .off-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}
  .off-toolbar select{max-width:280px;}
  .off-sep{flex:1 1 auto;}
  .off-sec{margin:18px 0 0;padding-top:12px;border-top:1px solid var(--line);}
  .off-sec h3{margin:0 0 10px;font:600 1rem var(--disp);letter-spacing:.03em;text-transform:uppercase;}
  .off-sec h3 .off-sum, .off-sum{font:400 .82rem var(--body, inherit);text-transform:none;letter-spacing:0;color:var(--steel);margin-left:6px;}
  details.off-sec > summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:6px;}
  details.off-sec > summary::-webkit-details-marker{display:none;}
  details.off-sec > summary h3{margin:0;display:inline;}
  details.off-sec > summary::before{content:"▸";color:var(--steel);}
  details.off-sec[open] > summary::before{content:"▾";}
  .off-company-body{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px;}
  .off-logo{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .off-logo-prev{display:inline-flex;align-items:center;justify-content:center;min-width:90px;height:46px;padding:3px 8px;
    border:1px dashed var(--line);border-radius:6px;color:var(--steel);font-size:.8rem;background:#fff;}
  .off-logo-prev img{max-height:40px;max-width:180px;}
  .off-checks{display:flex;flex-direction:column;gap:6px;margin-top:10px;}
  .off-check{display:flex;align-items:flex-start;gap:8px;font-weight:600;font-size:.9rem;}
  .off-check input{width:auto;margin-top:3px;}
  .off-check .hint{display:block;font-weight:400;margin-left:4px;}
  .off-parties{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;}
  .off-party{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--card);}
  .off-party-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
  .off-party-h b{font-size:.92rem;}
  .off-same{display:flex;align-items:center;gap:6px;font-size:.84rem;color:var(--steel);margin-left:auto;}
  .off-same input{width:auto;}
  .off-party.is-same .off-pgrid{display:none;}
  .off-pgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;}
  .off-pgrid label{display:flex;flex-direction:column;gap:2px;font-size:.76rem;color:var(--steel);}
  .off-pgrid label.wide{grid-column:1 / -1;}
  .off-pgrid input{font-size:.88rem;padding:5px 7px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);}
  .off-tbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
  .off-twrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;}
  .off-table{border-collapse:collapse;font-size:.85rem;}
  .off-table th{background:var(--ink);color:#fff;font:600 .74rem var(--disp);letter-spacing:.03em;text-transform:uppercase;padding:6px 6px;text-align:left;white-space:nowrap;}
  .off-table td{padding:3px 4px;border-top:1px solid var(--line);}
  .off-table td.n{color:var(--steel);text-align:right;padding:0 6px;}
  .off-table input, .off-table select{font-size:.85rem;padding:4px 6px;border:1px solid var(--line);border-radius:5px;background:var(--card);color:var(--ink);}
  .off-table .off-calc{font-family:var(--mono);font-size:.8rem;text-align:right;color:var(--steel);min-width:80px;padding-right:8px;}
  .off-table button.del{background:none;border:0;color:var(--steel);font-size:18px;cursor:pointer;line-height:1;}
  .off-table button.del:hover{color:#b32424;}
  .off-next{margin-top:18px;}
  .ab-offline{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font:600 .8rem var(--disp);letter-spacing:.03em;
    text-transform:uppercase;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 9px;cursor:pointer;}
  .ab-offline input{width:auto;margin:0;}
  .ab-offline + .x{margin-left:6px !important;}
  @media (max-width:700px){ .off-company-body{grid-template-columns:1fr;} .off-pgrid{grid-template-columns:1fr;} }
  `;
  document.head.appendChild(st);
}

/* A link with ?offline (e.g. https://atlas-utility.net/?offline) switches
   offline mode on for this browser — the link to hand a non-ATLAS user. The
   parameter is then dropped from the address bar; the mode stays on. */
function _offUrlSwitch() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has("offline")) return;
    _offSavePrefs({ on: true });
    u.searchParams.delete("offline");
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  } catch (e) { /* old browser — the About box still works */ }
}

document.addEventListener("DOMContentLoaded", () => {
  _offEnsureStyle();
  _offUrlSwitch();
  if (offlineOn()) offlineEnter();
});
