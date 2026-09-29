/* =========================================================================
   ATLAS Utility Web — tools/manual_details.js

   Manual override for ANY UDQ value, on every Shipping (SRF) and Property (PR)
   document — and "manual entry" mode, which builds those documents with no UDQ
   loaded at all.

   WHY THIS EXISTS
   ----------------
   Details are sometimes corrected AFTER Compliance Review and can no longer be
   edited in ATLAS, so the UDQ export carries stale values. Sometimes there is no
   UDQ at all yet. This lets the user type the values the paperwork should carry.

   WHAT CAN BE OVERRIDDEN
   ----------------------
     • Common edits (shown first): the six party blocks — organization, address,
       city/state/ZIP, country, POC name, phone, e-mail (+ Tax ID on SRF) — and,
       on SRF, the invoice terms (Payment Terms, Remarks, IncoTerms).
     • Every other field (collapsed section): every shipment-header field the
       documents read (MD_META_FIELDS), plus a full line-item table that replaces
       the UDQ inventory when switched on.
     • Packages / weights stay in Manual Parents (manual_parents.js); the dialog
       links to it.

   Party fields are the same 10 raw UDQ fields the parser reads (org, addr0,
   addr1, city, state, zip, country, poc_name, email, phone). An override rebuilds
   the party exactly as udq.js readPartyBlock does (addr_lines, contact, city,
   country, phone, email) AND its .raw block, so DD1149/TOP (which read .raw) and
   every SRF document pick it up.

   Blank = keep the UDQ value. A single "-" = print this field blank.

   DEFAULT BEHAVIOR (parity)
   -------------------------
   Strictly opt-in. Override OFF → every document uses exactly the UDQ.

   HOW THE OVERRIDE REACHES THE DOCUMENTS
   --------------------------------------
   AppState.dataBase holds the pristine parse. When enabled, AppState.data points
   at a clone carrying the manual values. Every tool reads AppState.data. Layered
   ON TOP of the parent-items override, so the order in app.js is always mp → md.

   MANUAL ENTRY (NO UDQ)
   ---------------------
   mdStartManual() loads a blank data model with AppState.manualOnly = true and
   opens this dialog with everything expanded. The override is always on in this
   mode — it IS the data. One manual entry serves BOTH document families: the
   model is SRF-shaped (udqType "srf", so the dashboard, packet, Manual Parents
   and validation all work) and each line item also carries the property fields
   (qty, mfr, qty_requested, …), so DD1149 / TOP / CoreIMS / Inventory read it
   too — the rail unlocks Property tools in manual entry. The field set is the
   union of both ("manual" in the catalogs below). Tools that read the raw
   spreadsheet (Audit, Required Attachments) stay off.

   PERSISTENCE
   -----------
   localStorage "atlas.shipdetails" (covered by Settings backup), keyed by WMTR.
   Manual-entry sessions are keyed "manual:<WMTR>" (WMTR numbers are unique
   across services) so they never collide with a real UDQ's override. Older
   saved entries (payment terms at the top level, party addr_lines text) are
   read and upgraded transparently.
   ========================================================================= */

/* ---- field catalogs ---- */

const MD_PARTIES = [
  { key: "pickup",       label: "Pickup Location" },
  { key: "origin",       label: "Shipper / Shipment Origin", note: "SRF: Import / F2F CI only" },
  { key: "deliver",      label: "Delivery Destination" },
  { key: "consignee",    label: "Ultimate Consignee" },
  { key: "intermediate", label: "Intermediate Consignee" },
  { key: "end_user",     label: "End User" },
];

/* The 10 raw UDQ party fields, in the order the parser reads them. */
const MD_RAW_KEYS = ["org", "addr0", "addr1", "city", "state", "zip", "country", "poc_name", "phone", "email"];
const MD_ADDR_KEYS = ["org", "addr0", "addr1", "city", "state", "zip"];

const MD_PARTY_FIELDS = [
  { k: "org",      label: "Organization", wide: true },
  { k: "addr0",    label: "Address", wide: true },
  { k: "addr1",    label: "Address line 2", wide: true },
  { k: "city",     label: "City" },
  { k: "state",    label: "State / Province" },
  { k: "zip",      label: "ZIP / Postal code" },
  { k: "country",  label: "Country" },
  { k: "poc_name", label: "POC name" },
  { k: "phone",    label: "Phone" },
  { k: "email",    label: "E-mail" },
  { k: "tax_id",   label: "Tax ID", srfOnly: true },
];

/* Shipment-header fields per UDQ type. quick = shown under Common edits.
   Keys starting with "_" are derived numerics (see mdApplyToData). */
const MD_META_FIELDS = {
  srf: [
    { k: "payment_terms",         label: "Payment Terms", quick: true },
    { k: "payment_terms_remarks", label: "Payment Terms Remarks", quick: true },
    { k: "incoterm",              label: "IncoTerms", quick: true },
    { k: "wmtr",                  label: "WMTR number" },
    { k: "request_title",         label: "Request title" },
    { k: "contract_no",           label: "Contract #" },
    { k: "ctr_program",           label: "CTR program" },
    { k: "country_origin",        label: "Country of origin" },
    { k: "country_destination",   label: "Country of destination" },
    { k: "mode_of_transit",       label: "Mode of transit" },
    { k: "shipment_type",         label: "Shipment type" },
    { k: "purpose",               label: "Purpose of shipment (CI)" },
    { k: "awb_bol",               label: "AWB / BOL #" },
    { k: "shipment_ref_no",       label: "Shipment reference #" },
    { k: "special_handling",      label: "Special handling instructions" },
    { k: "temp_requirements",     label: "Temperature requirements" },
    { k: "nlt_date",              label: "NLT completion date" },
    { k: "value_of_cargo",        label: "Value of cargo (USD)" },
    { k: "total_pkgs",            label: "Total packages" },
    { k: "_lbs",                  label: "Total gross weight (lbs)" },
    { k: "_ft3",                  label: "Total volume (ft³)" },
  ],
  property: [
    { k: "wmtr",                    label: "WMTR number" },
    { k: "request_title",           label: "Request title" },
    { k: "contract_no",             label: "Contract #" },
    { k: "ctr_program",             label: "CTR program" },
    { k: "country_destination",     label: "Country of destination" },
    { k: "partner_country",         label: "Partner country (TOP)" },
    { k: "purchasing_instructions", label: "Purchasing instructions" },
    { k: "value_of_cargo",          label: "Value of cargo (USD)" },
    { k: "nlt_date",                label: "NLT completion date" },
  ],
};
/* Manual entry (no UDQ) feeds both families: every Shipping field plus the
   Property-only ones. */
MD_META_FIELDS.manual = MD_META_FIELDS.srf.concat([
  { k: "partner_country",         label: "Partner country (TOP)" },
  { k: "purchasing_instructions", label: "Purchasing instructions" },
]);

/* Line-item table columns per UDQ type (w = input width in px). */
const MD_ITEM_COLS = {
  srf: [
    { k: "units", label: "Qty", w: 60 }, { k: "uom", label: "UOM", w: 60 },
    { k: "desc", label: "Description", w: 240 }, { k: "model", label: "Model / Cat #", w: 130 },
    { k: "serial", label: "Serial #", w: 100 }, { k: "hts", label: "HTS", w: 100 },
    { k: "eccn", label: "ECCN / USML", w: 90 }, { k: "auth", label: "Authorization", w: 110 },
    { k: "coo", label: "Country of origin", w: 110 }, { k: "unit_value", label: "Unit value (USD)", w: 100 },
    { k: "weight_lbs", label: "Weight (lbs)", w: 80 }, { k: "weight_kg", label: "Weight (kg)", w: 80 },
    { k: "un_code", label: "UN code", w: 80 }, { k: "hazmat_class", label: "HAZMAT class", w: 90 },
    { k: "temp_control", label: "Temp control", w: 100 }, { k: "shelf_life", label: "Shelf life", w: 90 },
    { k: "purchase_order", label: "PO #", w: 90 }, { k: "vendor", label: "Vendor", w: 120 },
    { k: "manufacturer", label: "Manufacturer", w: 120 }, { k: "ship_group", label: "Ship group #", w: 80 },
    { k: "units_received", label: "Qty received", w: 70 },
  ],
  property: [
    { k: "qty", label: "Qty", w: 60 }, { k: "uom", label: "UOM", w: 60 },
    { k: "desc", label: "Description", w: 240 }, { k: "model", label: "Model / Cat #", w: 130 },
    { k: "mfr", label: "Manufacturer", w: 120 }, { k: "serial", label: "Serial #", w: 100 },
    { k: "unit_value", label: "Unit value (USD)", w: 100 },
    { k: "qty_requested", label: "Qty requested", w: 70 }, { k: "qty_received", label: "Qty received", w: 70 },
    { k: "vendor", label: "Vendor (CoreIMS)", w: 120 }, { k: "coo", label: "Country of origin (CoreIMS)", w: 110 },
    { k: "temp_control", label: "Temp control (CoreIMS)", w: 100 }, { k: "shelf_life", label: "Shelf life (CoreIMS)", w: 90 },
    { k: "hazmat", label: "HAZMAT (CoreIMS)", w: 90 }, { k: "handling", label: "Handling (CoreIMS)", w: 110 },
    { k: "comments", label: "Comments (CoreIMS)", w: 140 },
  ],
  // Manual entry: one column per value, shared by both families (mdApplyItems
  // copies e.g. Manufacturer into both `manufacturer` and `mfr`).
  manual: [
    { k: "units", label: "Qty", w: 60 }, { k: "uom", label: "UOM", w: 60 },
    { k: "desc", label: "Description", w: 240 }, { k: "model", label: "Model / Cat #", w: 130 },
    { k: "serial", label: "Serial #", w: 100 }, { k: "manufacturer", label: "Manufacturer", w: 120 },
    { k: "unit_value", label: "Unit value (USD)", w: 100 }, { k: "hts", label: "HTS", w: 100 },
    { k: "eccn", label: "ECCN / USML", w: 90 }, { k: "auth", label: "Authorization", w: 110 },
    { k: "coo", label: "Country of origin", w: 110 },
    { k: "weight_lbs", label: "Weight (lbs)", w: 80 }, { k: "weight_kg", label: "Weight (kg)", w: 80 },
    { k: "un_code", label: "UN code", w: 80 }, { k: "hazmat_class", label: "HAZMAT class", w: 90 },
    { k: "temp_control", label: "Temp control", w: 100 }, { k: "shelf_life", label: "Shelf life", w: 90 },
    { k: "purchase_order", label: "PO #", w: 90 }, { k: "vendor", label: "Vendor", w: 120 },
    { k: "ship_group", label: "Ship group #", w: 80 }, { k: "units_received", label: "Qty received", w: 70 },
    { k: "handling", label: "Material handling (CoreIMS)", w: 110 }, { k: "comments", label: "General comments (CoreIMS)", w: 140 },
  ],
};

/* Tools that host the in-document override bar (every SRF / PR document). */
const MD_HOST_TOOLS = ["packet", "ci", "pl", "placards", "sli", "rfq", "ipc",
                       "dd1149", "topdocs", "coreims", "invpr"];
function mdHostsButton(toolId) { return MD_HOST_TOOLS.indexOf(toolId) !== -1; }

/* ---- small helpers ---- */

function mdStr(v) { return String(v == null ? "" : v).trim(); }

/** Normalize address lines from an array OR a newline-separated string. */
function mdLines(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? "" : v).split(/\r?\n/);
  return arr.map((s) => mdStr(s)).filter(Boolean);
}

/** Override value for one field: null = keep the UDQ value; "-" = blank. */
function mdOv(v) {
  const s = mdStr(v);
  if (!s) return null;
  return s === "-" ? "" : s;
}

function mdType() {
  const t = (typeof AppState !== "undefined") ? AppState.udqType : "";
  return (t === "srf" || t === "property") ? t : "";
}

/** Which field catalog applies: "manual" (no UDQ — both families), else the UDQ type. */
function mdFamily() {
  if (typeof AppState !== "undefined" && AppState.manualOnly) return "manual";
  return mdType();
}

function mdBlankParty() {
  const p = {};
  for (const k of MD_RAW_KEYS) p[k] = "";
  p.tax_id = "";
  p.addr_lines = [];   // legacy (pre-2.5.82) free-text address override
  return p;
}

/** A blank override object (all fields empty, disabled). */
function mdBlank() {
  const o = { enabled: false, meta: {}, parties: {}, items: null };
  for (const f of MD_PARTIES) o.parties[f.key] = mdBlankParty();
  return o;
}

function mdItemRowHasData(r) {
  return !!r && Object.keys(r).some((k) => mdStr(r[k]));
}

/** Normalize a possibly-partial (or older-format) stored object. */
function mdNormalize(src) {
  const o = mdBlank();
  if (!src || typeof src !== "object") return o;
  o.enabled = !!src.enabled;
  const meta = (src.meta && typeof src.meta === "object") ? src.meta : {};
  for (const k of Object.keys(meta)) { const v = mdStr(meta[k]); if (v) o.meta[k] = v; }
  // Older format: invoice terms at the top level.
  for (const k of ["payment_terms", "payment_terms_remarks", "incoterm"]) {
    if (!o.meta[k] && mdStr(src[k])) o.meta[k] = mdStr(src[k]);
  }
  const parties = (src.parties && typeof src.parties === "object") ? src.parties : {};
  for (const f of MD_PARTIES) {
    // Older format stored each party at the top level: { phone, email, addr_lines, country }.
    const p = parties[f.key] || src[f.key] || {};
    const out = o.parties[f.key];
    for (const k of MD_RAW_KEYS) out[k] = mdStr(p[k]);
    out.tax_id = mdStr(p.tax_id);
    out.addr_lines = mdLines(p.addr_lines);
  }
  if (Array.isArray(src.items)) {
    o.items = src.items.filter(mdItemRowHasData).map((r) => {
      const row = {};
      for (const k of Object.keys(r)) row[k] = mdStr(r[k]);
      return row;
    });
  }
  return o;
}

function mdPartyHasValue(p) {
  if (!p) return false;
  return MD_RAW_KEYS.some((k) => mdStr(p[k])) || !!mdStr(p.tax_id) || mdLines(p.addr_lines).length > 0;
}

/** Does this override carry ANY filled-in value? (ignores the enabled flag) */
function mdHasAnyValue(o) {
  if (!o) return false;
  if (o.meta && Object.keys(o.meta).some((k) => mdStr(o.meta[k]))) return true;
  if (o.parties && MD_PARTIES.some((f) => mdPartyHasValue(o.parties[f.key]))) return true;
  return Array.isArray(o.items);
}

/** The override is in effect (always, in manual-entry mode). */
function mdActive() {
  if (typeof AppState === "undefined") return false;
  if (AppState.manualOnly) return true;
  const o = AppState.manualDetails;
  return !!(o && o.enabled && mdHasAnyValue(o));
}

/** WMTRs consolidated (real UDQ only)? The line-item table describes ONE WMTR,
 *  so it's paused rather than hiding the secondaries' inventory. */
function _mdItemsPaused() {
  return !AppState.manualOnly && typeof consolActive === "function" && consolActive();
}

/** Is the line-item table replacing the UDQ inventory? */
function mdItemsActive() {
  return mdActive() && !_mdItemsPaused() &&
    !!(AppState.manualDetails && Array.isArray(AppState.manualDetails.items));
}

/** A short list of what's being overridden (for the doc bar / status line). */
function mdActiveLabels() {
  const o = (typeof AppState !== "undefined") ? AppState.manualDetails : null;
  if (!o) return [];
  const out = [];
  const fields = MD_META_FIELDS[mdFamily()] || [];
  for (const f of fields) if (mdStr(o.meta[f.k])) out.push(f.label);
  for (const f of MD_PARTIES) if (mdPartyHasValue(o.parties[f.key])) out.push(f.label);
  if (Array.isArray(o.items)) out.push(`line items (${o.items.length})`);
  return out;
}

/** One-line summary of a party as the documents print it. */
function _mdPartySummary(p) {
  if (!p) return "";
  return [(p.addr_lines || []).filter(Boolean).join(", "), p.country, p.contact, p.phone, p.email, p.tax_id]
    .map(mdStr).filter(Boolean).join(" · ");
}

/** What the saved manual values ACTUALLY change versus the UDQ:
 *  [{ label, udq, now }] — only values that print differently. Empty when the
 *  override is off, and in manual entry (there's no UDQ to differ from). */
function mdDiffs() {
  if (typeof AppState === "undefined" || AppState.manualOnly || !mdActive()) return [];
  const base = AppState.dataBase || AppState.data;
  if (!base || !base.meta) return [];
  const out = mdApplyToData(base);
  const fam = mdFamily();
  const diffs = [];
  const add = (label, a, b) => { a = mdStr(a); b = mdStr(b); if (a !== b) diffs.push({ label, udq: a, now: b }); };
  for (const f of (MD_META_FIELDS[fam] || [])) {
    const k = f.k === "_lbs" ? "total_weight" : f.k === "_ft3" ? "total_volume" : f.k;
    add(f.label, base.meta[k], out.meta[k]);
  }
  for (const f of MD_PARTIES) {
    add(f.label, _mdPartySummary(base.parties && base.parties[f.key]), _mdPartySummary(out.parties && out.parties[f.key]));
  }
  const cols = MD_ITEM_COLS[fam] || [];
  const proj = (items) => (items || []).map((it) => cols.map((c) => mdStr(it[c.k])).join("\u0001")).join("\u0002");
  if (proj(base.items) !== proj(out.items)) {
    const desc = (d) => `${(d.items || []).length} line${(d.items || []).length === 1 ? "" : "s"}` +
      (fam === "srf" && d.meta.total_value ? ` · total $${d.meta.total_value}` : "");
    diffs.push({ label: "Line items", udq: desc(base), now: desc(out) + " (your table)" });
  }
  return diffs;
}

/** Yellow "saved manual values" block listing every value that differs from the
 *  UDQ — on the dashboard and at the top of each document. */
function _mdWarnBlock(diffs) {
  mdEnsureStyle();
  const restored = !!(AppState.manualDetails && AppState.manualDetails._restored);
  const n = diffs.length;
  const rows = diffs.map((d) => `<tr><td class="lbl">${esc(d.label)}</td>
      <td class="v">${esc(d.now) || "(blank)"}</td><td class="v">${esc(d.udq) || "(blank)"}</td></tr>`).join("");
  const b = el(`
    <div class="md-warn" role="status">
      <div class="md-warn-head">
        <span class="md-warn-badge">${restored ? "FROM MEMORY · " : ""}MANUAL VALUES</span>
        <span class="md-warn-title">${n} value${n === 1 ? "" : "s"} on the documents ${n === 1 ? "comes" : "come"} from manual values
          ${restored ? "saved earlier for this WMTR" : "you entered"} and ${n === 1 ? "doesn't" : "don't"} match the UDQ.</span>
        <button class="btn ghost btn-sm" type="button" data-md-edit>Review / edit</button>
      </div>
      <table>
        <thead><tr><th>Field</th><th>In use (manual)</th><th>UDQ says</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
  b.querySelector("[data-md-edit]").addEventListener("click", openManualDetails);
  return b;
}

/** Dashboard banner (SRF + Property) — null when nothing differs from the UDQ. */
function mdDashboardBanner() {
  const d = mdDiffs();
  return d.length ? _mdWarnBlock(d) : null;
}

/* =========================================================================
   Apply the override onto AppState.data (always clones — never mutates base)
   ========================================================================= */

function mdApplyParty(cur, ov, type) {
  if (!cur || !mdPartyHasValue(ov)) return cur;
  const raw0 = cur.raw || {};
  const raw = {};
  let rawTouched = false;
  for (const k of MD_RAW_KEYS) {
    const v = mdOv(ov[k]);
    if (v !== null) rawTouched = true;
    raw[k] = v !== null ? v : mdStr(raw0[k]);
  }
  const out = Object.assign({}, cur);
  const addrTouched = MD_ADDR_KEYS.some((k) => mdOv(ov[k]) !== null);
  if (rawTouched) {
    if (addrTouched) out.addr_lines = safeLines([raw.org, raw.addr0, raw.addr1, cityStateZip(raw.city, raw.state, raw.zip)]);
    out.city = raw.city;
    out.country = raw.country;
    out.phone = raw.phone;
    out.email = raw.email;
    out.contact = raw.poc_name || raw.org;
    out.raw = raw;
  }
  // Older free-text address override (kept until replaced by the fields above).
  const legacy = mdLines(ov.addr_lines);
  if (legacy.length && !addrTouched) out.addr_lines = legacy;
  const tax = mdOv(ov.tax_id);
  if (tax !== null && type !== "property") out.tax_id = tax;
  return out;
}

function mdApplyItems(rows, type) {
  const use = rows.filter(mdItemRowHasData);
  if (type === "property") {
    return use.map((r, i) => {
      const qty = toFloat(r.qty), val = toFloat(r.unit_value);
      return {
        item_no: i + 1,
        desc: mdStr(r.desc), model: mdStr(r.model), mfr: mdStr(r.mfr),
        serial: mdStr(r.serial), uom: mdStr(r.uom),
        qty, unit_value: val,
        qty_raw: mdStr(r.qty), value_raw: mdStr(r.unit_value),
        qty_requested: toFloat(r.qty_requested) || qty,
        qty_received: toFloat(r.qty_received),
        vendor: mdStr(r.vendor), coo: mdStr(r.coo), temp_control: mdStr(r.temp_control),
        shelf_life: mdStr(r.shelf_life), hazmat: mdStr(r.hazmat),
        handling: mdStr(r.handling), comments: mdStr(r.comments),
      };
    });
  }
  return use.map((r, i) => {
    const q = toFloat(r.units), u = toFloat(r.unit_value);
    const o = {};
    for (const c of MD_ITEM_COLS.srf) o[c.k] = mdStr(r[c.k]);
    o.line = String(i + 1);
    o.units_raw = o.units;                           // exact, as typed (see _mdUdqItemRows)
    o.units = q ? String(Math.trunc(q)) : o.units;   // whole-number display, like readUdq
    o.unit_value = u ? fmtMoney(u) : o.unit_value;
    o.total_value = fmtMoney(q * u);
    const it = makeLineItem(o);
    if (type !== "manual") return it;
    // Manual entry: the same item also carries the property-reader fields, so
    // DD1149 / TOP / CoreIMS / Inventory Sheet read it as well. (unit_value stays
    // the SRF display string — the property tools parse "1,200.00" fine.)
    return Object.assign(it, {
      item_no: i + 1,
      qty: q,
      mfr: it.manufacturer,
      qty_raw: mdStr(r.units),
      value_raw: mdStr(r.unit_value),
      qty_requested: q,   // Qty is the requested quantity (Inventory Sheet reads it that way)
      qty_received: toFloat(r.units_received),
      hazmat: it.hazmat_class,
      handling: mdStr(r.handling),
      comments: mdStr(r.comments),
    });
  });
}

function mdApplyToData(data) {
  if (!data) return data;
  if (!mdType()) return data;
  if (!mdActive()) return data;
  const type = mdFamily();   // "srf" | "property" | "manual" (both)

  const o = AppState.manualDetails || mdBlank();

  const meta = Object.assign({}, data.meta);
  if (meta.totals_raw) meta.totals_raw = Object.assign({}, meta.totals_raw);
  const tr = meta.totals_raw;
  for (const f of (MD_META_FIELDS[type] || [])) {
    const v = mdOv(o.meta[f.k]);
    if (v === null) continue;
    if (f.k === "wmtr") {
      meta.wmtr = v;
      meta.wmtr_last5 = wmtrLast5(v);
      if (type !== "property") meta.invoice_no = v;
    } else if (f.k === "total_pkgs") {
      meta.total_pkgs = v;
      if (tr) tr.pkg_count = Math.trunc(toFloat(v));
    } else if (f.k === "_lbs") {
      const lbs = toFloat(v), kg = lbs * 0.45359237;
      meta.total_weight = fmtWeight(lbs, kg);
      if (tr) { tr.udq_lbs = lbs; tr.udq_kg = kg; }
    } else if (f.k === "_ft3") {
      const ft3 = toFloat(v), m3 = ft3 * 0.028316846592;
      meta.total_volume = fmtVolume(ft3, m3);
      if (tr) { tr.udq_ft3 = ft3; tr.udq_m3 = m3; }
    } else {
      meta[f.k] = v;
    }
  }

  const parties = Object.assign({}, data.parties);
  for (const f of MD_PARTIES) {
    if (parties[f.key]) parties[f.key] = mdApplyParty(parties[f.key], o.parties[f.key], type);
  }

  let items = data.items;
  if (Array.isArray(o.items) && !_mdItemsPaused()) {
    items = mdApplyItems(o.items, type);
    if (type !== "property") {
      const sum = items.reduce((s, it) => s + toFloat(it.total_value), 0);
      meta.total_value = fmtMoney(sum);
      if (tr) tr.value_usd = sum;
    }
  }

  return Object.assign({}, data, { meta, parties, items });
}

/** Point AppState.data (already mp-applied by the caller) at the overridden view. */
function mdApplyGlobal() {
  if (typeof AppState === "undefined" || !AppState.data) return;
  AppState.data = mdApplyToData(AppState.data);
}

/* =========================================================================
   Manual entry (no UDQ loaded)
   ========================================================================= */

/** Blank manual-entry model: the SRF shape (so every Shipping tool works) plus
 *  the Property-only meta fields (so every Property tool works too). */
function mdBlankModel() {
  const party = () => {
    const p = makeParty({});
    p.raw = {};
    for (const k of MD_RAW_KEYS) p.raw[k] = "";
    return p;
  };
  const parties = { origin: party(), consignee: party(), intermediate: party(),
                    end_user: party(), pickup: party(), deliver: party() };
  return {
    meta: {
      invoice_no: "", wmtr: "", wmtr_last5: "", request_title: "", contract_no: "",
      purpose: "Donation", payment_terms: "No Commercial Value", payment_terms_remarks: "No Charge (NC)",
      incoterm: "", shipment_ref_no: "", awb_bol: "", mode_of_transit: "", shipment_type: "",
      special_handling: "", temp_requirements: "", country_origin: "", country_destination: "",
      ctr_program: "", nlt_date: "", value_of_cargo: "",
      partner_country: "", purchasing_instructions: "",
      total_pkgs: "", total_weight: "", total_volume: "", total_value: "",
      totals_raw: { pkg_count: 0, udq_lbs: 0, udq_kg: 0, udq_ft3: 0, udq_m3: 0, pkg_lbs: 0, pkg_ft3: 0, value_usd: 0 },
    },
    parties, items: [], packages: [],
  };
}

/** Keep the blank base's WMTR in step with what was typed, so Manual Parents and
 *  the form cache key off it like they would for a real UDQ. */
function _mdSyncManualWmtr() {
  if (!AppState.manualOnly || !AppState.dataBase) return;
  const w = mdStr(AppState.manualDetails && AppState.manualDetails.meta.wmtr);
  const m = AppState.dataBase.meta;
  m.wmtr = w === "-" ? "" : w;
  m.wmtr_last5 = wmtrLast5(m.wmtr);
  m.invoice_no = m.wmtr;
}

/** Start building documents with no UDQ — Shipping and Property documents alike.
 *  udqType is "srf" so all the shipping machinery runs; the rail also unlocks
 *  the Property tools while AppState.manualOnly is set. */
function mdStartManual() {
  if (typeof AppState === "undefined") return;
  // Already in manual entry: this is the way back to the form — never a wipe.
  // (A new blank entry is started from the dialog's entry picker.)
  if (AppState.manualOnly) { openManualDetails(); return; }
  if ((AppState.data || AppState.grid || AppState.history) &&
      !confirm("Switch to manual entry? The UDQ that's loaded now will be closed.")) return;
  _mdBeginManual();
}

/** Load a blank manual entry and open the dialog (no confirmation — callers ask). */
function _mdBeginManual() {
  AppState.grid = null;
  AppState.history = null;
  AppState.manualParents = null;
  if (typeof consolReset === "function") consolReset();
  if (typeof siReset === "function") siReset();
  AppState.udqType = "srf";
  AppState.fileName = "Manual entry (no UDQ)";
  AppState.data = mdBlankModel();
  AppState.dataBase = AppState.data;
  AppState.manualOnly = true;
  AppState.manualDetails = Object.assign(mdBlank(), { enabled: true, items: [] });
  AppState.activeTool = null;
  AppState.dashCollapsed = false;
  const status = document.getElementById("loadStatus");
  if (status) {
    status.classList.remove("err");
    status.textContent = `Manual entry — no UDQ loaded. Enter the details, then pick any Shipping or Property document from the menu.`;
  }
  if (typeof renderAll === "function") renderAll();
  openManualDetails();
}

/* =========================================================================
   Per-WMTR persistence (localStorage, "atlas." namespace)
   ========================================================================= */

const MD_STORE_KEY = "atlas.shipdetails";

function mdStoreLoad() {
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(MD_STORE_KEY) : null;
    const o = raw ? JSON.parse(raw) : {};
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
}
function mdStoreSave(map) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(MD_STORE_KEY, JSON.stringify(map)); return true; }
  catch (e) { return false; }
}

/** Current shipment's WMTR (pristine parse, or what was typed in manual entry). */
function mdCurrentWmtr() {
  if (typeof AppState === "undefined") return "";
  if (AppState.manualOnly) {
    const w = mdStr(AppState.manualDetails && AppState.manualDetails.meta.wmtr);
    return w === "-" ? "" : w;
  }
  const b = AppState.dataBase || AppState.data;
  return (b && b.meta && b.meta.wmtr) ? String(b.meta.wmtr).trim() : "";
}

function _mdStoreKey() {
  const wmtr = mdCurrentWmtr();
  if (!wmtr) return "";
  return AppState.manualOnly ? `manual:${wmtr}` : wmtr;
}

/** Save (or clear) the current override. Returns false if there was no key. */
function mdPersistCurrent() {
  const key = _mdStoreKey();
  if (!key) return false;
  const map = mdStoreLoad();
  const o = AppState.manualDetails;
  if (o && mdHasAnyValue(o)) {
    map[key] = Object.assign(mdNormalize(o), { savedAt: new Date().toISOString() });
  } else {
    delete map[key];
  }
  mdStoreSave(map);
  return true;
}

/** Restore a saved override for a WMTR. Returns true if something was restored. */
function mdRestoreForWmtr(wmtr) {
  if (!wmtr) return false;
  const e = mdStoreLoad()[wmtr];
  if (e && mdHasAnyValue(mdNormalize(e))) {
    AppState.manualDetails = Object.assign(mdNormalize(e), { _restored: true });
    return true;
  }
  return false;
}

/** Saved manual-entry sessions, newest first: [{key, wmtr, savedAt}]. */
function _mdManualSessions() {
  const map = mdStoreLoad();
  const pre = "manual:";
  return Object.keys(map).filter((k) => k.indexOf(pre) === 0)
    .map((k) => ({ key: k, wmtr: k.slice(pre.length), savedAt: map[k].savedAt || "" }))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** Called from loadFile right after an SRF or Property UDQ is parsed. */
function mdOnSrfLoaded() {
  if (typeof AppState === "undefined" || !mdType()) return;
  const wmtr = mdCurrentWmtr();
  if (!wmtr) return;
  if (mdRestoreForWmtr(wmtr)) {
    mdApplyGlobal();
    const status = document.getElementById("loadStatus");
    if (status) {
      status.textContent += mdActive()
        ? `  •  Restored your saved manual overrides for this WMTR — the documents are using them.`
        : `  •  Restored your saved manual overrides for this WMTR (currently turned off).`;
    }
    if (typeof atlasAnnounce === "function") {
      try { atlasAnnounce("Saved manual overrides were restored for this WMTR."); } catch (e) {}
    }
  }
}

/* =========================================================================
   In-document indicator bar + button (every SRF / PR document)
   ========================================================================= */

function mdEnsureStyle() {
  if (document.getElementById("mdDocStyle")) return;
  const s = document.createElement("style");
  s.id = "mdDocStyle";
  s.textContent = `
  .md-docbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;padding:9px 12px;
    border:1px solid var(--line);border-left:4px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);transition:background .15s,border-color .15s;}
  .md-docbar.on{border-left-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
  .md-docbar .md-db-lbl{font:600 .8rem var(--disp);letter-spacing:.02em;color:var(--ink);text-transform:uppercase;}
  .md-docbar .md-db-badge{display:none;font:700 .68rem var(--disp);letter-spacing:.06em;background:var(--accent);color:#fff;border-radius:5px;padding:2px 7px;}
  .md-docbar.on .md-db-badge{display:inline-block;}
  .md-docbar .md-db-state{font-size:.86rem;color:var(--steel);flex:1 1 240px;}
  .md-docbar .md-db-state strong{color:var(--ink);}
  .md-docbar .md-db-edit{margin-left:auto;}

  .md-warn{margin:0 0 14px;padding:11px 14px;border:1px solid var(--mx-warn-bd);border-left:6px solid var(--mx-warn-bd);
    border-radius:9px;background:var(--mx-warn-bg);color:var(--mx-warn-fg);}
  .md-warn .md-warn-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .md-warn .md-warn-badge{font:700 .72rem var(--disp);letter-spacing:.06em;background:var(--mx-warn-bd);color:#3a2c00;border-radius:6px;padding:3px 9px;flex:0 0 auto;}
  .md-warn .md-warn-title{font-size:.92rem;font-weight:600;flex:1 1 260px;color:var(--mx-warn-fg);}
  .md-warn table{width:100%;border-collapse:collapse;margin:9px 0 2px;font-size:.84rem;}
  .md-warn th{text-align:left;font:600 .66rem var(--disp);letter-spacing:.05em;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid var(--mx-warn-bd);}
  .md-warn td{padding:4px 6px;border-bottom:1px dashed var(--mx-warn-bd);vertical-align:top;color:var(--ink);}
  .md-warn td.v{font-family:var(--mono);font-size:.8rem;word-break:break-word;}
  .md-warn td.lbl{font-weight:600;white-space:nowrap;}

  .md-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:4vh 16px;overflow:auto;}
  .md-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:980px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .md-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .md-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .md-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .md-body{padding:14px 18px;max-height:74vh;overflow:auto;}
  .md-intro{font-size:.9rem;color:var(--steel);margin:0 0 10px;line-height:1.45;}
  .md-intro strong{color:inherit;}
  .md-toggle{display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:9px;padding:10px 12px;margin-bottom:14px;background:var(--card);color:var(--ink);}
  .md-toggle input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;accent-color:var(--accent);}
  .md-toggle label{font-size:.92rem;line-height:1.4;cursor:pointer;color:var(--ink);}
  .md-toggle .hint{display:block;color:var(--steel);font-size:.82rem;margin-top:2px;}
  .md-sec{margin:0 0 16px;}
  .md-sec h3{font:600 .74rem var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--steel);margin:0 0 8px;border-bottom:1px solid var(--line);padding-bottom:5px;}
  .md-sec h3 span{font-weight:400;text-transform:none;letter-spacing:0;}
  .md-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;}
  .md-row .md-rl{flex:0 0 200px;font-size:.86rem;color:var(--ink);}
  .md-row input{flex:1 1 220px;box-sizing:border-box;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:.86rem;}
  .md-party{border:1px solid var(--line);border-radius:9px;margin-bottom:8px;background:var(--card);}
  .md-party > summary{cursor:pointer;padding:8px 12px;font-size:.88rem;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;}
  .md-party > summary b{font-weight:600;color:var(--ink);}
  .md-party > summary .md-sum{color:var(--steel);font-size:.8rem;}
  .md-party > summary .md-tag{font:700 .64rem var(--disp);letter-spacing:.06em;background:var(--accent);color:#fff;border-radius:5px;padding:1px 6px;}
  .md-pgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 10px;padding:4px 12px 12px;}
  .md-pgrid .wide{grid-column:1 / -1;}
  .md-pgrid label{display:flex;flex-direction:column;gap:2px;font-size:.68rem;color:var(--steel);text-transform:uppercase;letter-spacing:.03em;}
  .md-pgrid input{box-sizing:border-box;width:100%;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:.86rem;text-transform:none;letter-spacing:0;}
  .md-legacy{grid-column:1 / -1;font-size:.8rem;color:var(--steel);display:flex;gap:8px;align-items:flex-start;}
  .md-pgrid .md-legacy label{display:block;text-transform:none;letter-spacing:0;font-size:.8rem;}
  .md-pgrid .md-legacy input{width:auto;flex:0 0 auto;margin-top:2px;accent-color:var(--accent);}
  .md-all{border:1px solid var(--line);border-radius:9px;background:var(--card);}
  .md-all > summary{cursor:pointer;padding:10px 12px;font:600 .82rem var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--ink);}
  .md-all-body{padding:4px 12px 12px;}
  .md-mtable{width:100%;border-collapse:collapse;font-size:.84rem;margin-bottom:14px;}
  .md-mtable th{text-align:left;font:600 .68rem var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);padding:4px 6px;border-bottom:1px solid var(--line);}
  .md-mtable td{padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:middle;}
  .md-mtable td.udq{color:var(--steel);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .md-mtable input{box-sizing:border-box;width:100%;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:5px 7px;font:inherit;font-size:.84rem;}
  .md-itwrap{overflow:auto;max-height:46vh;border:1px solid var(--line);border-radius:7px;}
  .md-itable{border-collapse:collapse;font-size:.8rem;}
  .md-itable th{position:sticky;top:0;background:var(--card);text-align:left;font:600 .64rem var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);padding:5px 4px;border-bottom:1px solid var(--line);white-space:nowrap;}
  .md-itable td{padding:2px 3px;border-bottom:1px solid var(--line);}
  .md-itable td.n{color:var(--steel);text-align:right;padding-right:6px;}
  .md-itable input{box-sizing:border-box;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:5px;padding:4px 5px;font:inherit;font-size:.8rem;}
  .md-itable .del{background:none;border:0;color:var(--steel);cursor:pointer;font-size:16px;line-height:1;}
  .md-itbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;}
  .md-itbar .hint{font-size:.8rem;color:var(--steel);}
  .md-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);flex-wrap:wrap;}
  .md-foot .spacer{margin-left:auto;}
  .btn.btn-sm{font-size:12px;letter-spacing:.6px;padding:6px 12px;}
  @media (max-width:640px){ .md-pgrid{grid-template-columns:1fr;} .md-row .md-rl{flex-basis:100%;} }
  `;
  document.head.appendChild(s);
}

function _mdDocBarStateHtml() {
  if (AppState.manualOnly) {
    const n = (AppState.data && AppState.data.items) ? AppState.data.items.length : 0;
    return `<strong>Manual entry — no UDQ loaded.</strong> Every value comes from what you entered · ${n} line item${n === 1 ? "" : "s"}.`;
  }
  if (!mdActive()) return `Using <strong>UDQ values</strong> — no manual overrides in effect.`;
  // (Values that differ from the UDQ are shown in the yellow block instead.)
  return `Manual values are on, but <strong>all match the UDQ</strong> right now.`;
}

/** Inject the indicator bar + edit button at the top of a document panel. */
function mdInjectDocBar(container, toolId) {
  if (!container) return;
  if (typeof AppState === "undefined" || !mdType() || !AppState.data) return;
  if (!mdHostsButton(toolId)) return;
  mdEnsureStyle();

  const on = mdActive();
  const bar = el(`
    <div class="md-docbar${on ? " on" : ""}" id="mdDocBar">
      <span class="md-db-lbl">${AppState.manualOnly ? "Manual entry" : "Manual overrides"}</span>
      <span class="md-db-badge">MANUAL</span>
      <span class="md-db-state" id="mdDocState">${_mdDocBarStateHtml()}</span>
      <button class="btn ghost btn-sm md-db-edit" type="button" id="mdDocEdit">${AppState.manualOnly ? "Edit details" : (on ? "Edit overrides" : "Override UDQ values")}</button>
    </div>`);

  const body = container.querySelector(".panel > .body") || container.querySelector(".panel") || container;
  // Values that differ from the UDQ get the loud yellow list, not just the bar.
  const diffs = mdDiffs();
  if (diffs.length) {
    const warn = _mdWarnBlock(diffs);
    warn.id = "mdDocWarn";
    body.insertBefore(warn, body.firstChild);
    return;
  }
  body.insertBefore(bar, body.firstChild);
  bar.querySelector("#mdDocEdit").addEventListener("click", openManualDetails);
}

/* =========================================================================
   Dialog
   ========================================================================= */

function closeManualDetails() {
  const o = document.getElementById("mdOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _mdEsc);
}
function _mdEsc(e) { if (e.key === "Escape") closeManualDetails(); }

/** The pristine (pre-override) data the placeholders show — the UDQ, or in
 *  manual entry the blank model (whose only values are the built-in defaults). */
function _mdBase() {
  return AppState.dataBase || AppState.data;
}

function _mdUdqMetaValue(f) {
  const b = _mdBase();
  if (!b || !b.meta) return "";
  const tr = b.meta.totals_raw || {};
  if (f.k === "_lbs") return tr.udq_lbs ? String(Math.round(tr.udq_lbs * 100) / 100) : "";
  if (f.k === "_ft3") return tr.udq_ft3 ? String(Math.round(tr.udq_ft3 * 100) / 100) : "";
  return mdStr(b.meta[f.k]);
}

function _mdUdqParty(key) {
  const b = _mdBase();
  const p = (b && b.parties) ? b.parties[key] : null;
  const out = {};
  for (const k of MD_RAW_KEYS) out[k] = p && p.raw ? mdStr(p.raw[k]) : "";
  out.tax_id = p ? mdStr(p.tax_id) : "";
  out.summary = p ? [(p.addr_lines || []).filter(Boolean).join(", "), p.country].filter(Boolean).join(" · ") : "";
  return out;
}

function _mdPh(v) {
  if (AppState.manualOnly) return v ? "Default: " + v : "";
  return v ? "UDQ: " + v : "(blank in UDQ)";
}

function _mdPartyHtml(f, cur, type) {
  const ph = _mdUdqParty(f.key);
  const has = mdPartyHasValue(cur);
  const fields = MD_PARTY_FIELDS.filter((pf) => !pf.srfOnly || type !== "property").map((pf) => `
      <label class="${pf.wide ? "wide" : ""}">${esc(pf.label)}
        <input type="text" data-party="${f.key}" data-pf="${pf.k}" value="${esc(cur[pf.k])}" placeholder="${esc(_mdPh(ph[pf.k]))}">
      </label>`).join("");
  const legacy = mdLines(cur.addr_lines);
  const legacyHtml = legacy.length ? `
      <div class="md-legacy">
        <input type="checkbox" data-legacy="${f.key}" checked id="mdLeg_${f.key}">
        <label for="mdLeg_${f.key}">Keep the address override saved earlier: <strong>${esc(legacy.join(" / "))}</strong>.
          Filling in any address field above replaces it; untick to drop it.</label>
      </div>` : "";
  return `
    <details class="md-party" ${has ? "open" : ""}>
      <summary><b>${esc(f.label)}</b>${f.note && type !== "property" ? ` <span class="md-sum">(${esc(f.note)})</span>` : ""}
        ${has ? `<span class="md-tag">OVERRIDDEN</span>` : ""}
        <span class="md-sum">${esc(ph.summary || (AppState.manualOnly ? "" : "Not specified in UDQ"))}</span></summary>
      <div class="md-pgrid">${fields}${legacyHtml}</div>
    </details>`;
}

function _mdMetaRowHtml(f, cur) {
  const udq = _mdUdqMetaValue(f);
  return `<tr>
      <td>${esc(f.label)}</td>
      ${AppState.manualOnly ? "" : `<td class="udq" title="${esc(udq)}">${esc(udq) || "—"}</td>`}
      <td><input type="text" data-meta="${f.k}" value="${esc(cur.meta[f.k] || "")}" aria-label="${esc(f.label)}"
                 placeholder="${AppState.manualOnly && f.k !== "wmtr" ? esc(_mdPh(udq)) : ""}"></td>
    </tr>`;
}

/** Line-item rows for the table, from the UDQ items (pristine). */
function _mdUdqItemRows(type) {
  const b = _mdBase();
  const items = (b && b.items) || [];
  return items.map((it) => {
    const r = {};
    for (const c of MD_ITEM_COLS[type]) {
      let v = it[c.k];
      if (type === "property") {
        if (c.k === "qty") v = it.qty_raw || (it.qty ? String(it.qty) : "");
        else if (c.k === "unit_value") v = it.value_raw || (it.unit_value ? String(it.unit_value) : "");
        else if (c.k === "qty_requested" || c.k === "qty_received") v = it[c.k] ? String(it[c.k]) : "";
      } else if (c.k === "units" && it.units_raw &&
                 Math.trunc(toFloat(it.units_raw)) === toFloat(it.units)) {
        // SRF `units` is the whole-number display; seed the exact quantity so an
        // untouched 2.5 × $100 row keeps its $250 total. (The equality guard skips
        // a stale units_raw on a line that item splits re-quantified.)
        v = it.units_raw;
      }
      // A text box can't hold line breaks (the browser silently deletes them,
      // running words together) — keep multi-line UDQ cells readable.
      r[c.k] = mdStr(v).replace(/\s*\r?\n\s*/g, " ");
    }
    return r;
  });
}

function _mdItemRowHtml(r, i, type) {
  const cells = MD_ITEM_COLS[type].map((c) =>
    `<td><input type="text" data-col="${c.k}" value="${esc(r[c.k] || "")}" style="width:${c.w}px" aria-label="${esc(c.label)}"></td>`).join("");
  return `<tr><td class="n">${i + 1}</td>${cells}<td><button class="del" type="button" title="Delete row" aria-label="Delete row">×</button></td></tr>`;
}

function openManualDetails() {
  if (typeof AppState === "undefined" || !mdType() || !AppState.data) {
    alert("Load a Shipping (SRF) or Property UDQ first — or use ATLAS / UDQ ▸ Manual entry to build documents without one.");
    return;
  }
  closeManualDetails();
  mdEnsureStyle();

  const type = mdFamily();   // "srf" | "property" | "manual" (both families)
  const manual = !!AppState.manualOnly;
  const cur = mdNormalize(AppState.manualDetails);
  const wmtr = mdCurrentWmtr();
  const metaFields = MD_META_FIELDS[type];
  const quickMeta = metaFields.filter((f) => f.quick);
  const otherMeta = metaFields.filter((f) => !f.quick);
  const itemsOn = manual || Array.isArray(cur.items);
  const itemsPaused = _mdItemsPaused();
  const itemRows = Array.isArray(cur.items) ? cur.items : _mdUdqItemRows(type);

  const sessions = manual ? _mdManualSessions().filter((s) => s.wmtr !== wmtr) : [];
  const resumeHtml = manual ? `
      <div class="md-row">
        <span class="md-rl">${wmtr ? `Editing <strong>${esc(wmtr)}</strong>` : "This entry"}</span>
        <select id="mdResume" style="flex:1 1 220px;" aria-label="Switch manual entry">
          <option value="">— keep working on this entry —</option>
          <option value="__new">Start a new, blank entry</option>
          ${sessions.map((s) => `<option value="${esc(s.key)}">Open saved: ${esc(s.wmtr)}${s.savedAt ? " · saved " + esc(s.savedAt.slice(0, 10)) : ""}</option>`).join("")}
        </select>
      </div>` : "";

  const intro = manual
    ? `<p class="md-intro"><strong>No UDQ loaded.</strong> Everything the Shipping and Property documents print comes from what you enter here.
         Fill in what you need, Save, then pick any document from the menu. Enter a <strong>WMTR number</strong> (under Every other field) to have this saved so you can come back to it.</p>`
    : `<p class="md-intro">Overwrite any value from the UDQ — for details corrected <strong>after Compliance Review</strong> that can no longer be edited in ATLAS.
         <strong>Leave a field blank to keep the UDQ value</strong> (shown in grey); type a single <strong>-</strong> to print it blank.
         Saved for this WMTR${wmtr ? ` (${esc(wmtr)})` : ""} and restored automatically when you reopen this UDQ.</p>`;

  const toggle = manual ? "" : `
      <div class="md-toggle">
        <input type="checkbox" id="mdEnabled" ${cur.enabled ? "checked" : ""}>
        <label for="mdEnabled">Use these manual values on the documents (override the UDQ)
          <span class="hint">Off = use the UDQ values as normal. Your entries stay saved and you can turn this back on any time.</span>
        </label>
      </div>`;

  const quickTerms = quickMeta.length ? `
      <div class="md-sec">
        <h3>Invoice terms <span>(Commercial Invoice)</span></h3>
        ${quickMeta.map((f) => `
          <div class="md-row">
            <span class="md-rl">${esc(f.label)}</span>
            <input type="text" data-meta="${f.k}" value="${esc(cur.meta[f.k] || "")}" placeholder="${esc(_mdPh(_mdUdqMetaValue(f)))}">
          </div>`).join("")}
      </div>` : "";

  const itemsHint = type === "property"
    ? "The CoreIMS columns only feed the CoreIMS export."
    : type === "manual"
      ? "Total value is worked out from Qty × Unit value. Columns marked CoreIMS only feed the CoreIMS export. Packages and package weights are set under Packages & weights."
      : "Total value is worked out from Qty × Unit value. Packages and package weights are set under Packages & weights.";

  const overlay = el(`
    <div class="md-overlay" id="mdOverlay">
      <div class="md-dialog" role="dialog" aria-modal="true" aria-label="${manual ? "Manual entry" : "Manual overrides"}">
        <header><h2>${manual ? "Manual entry" : "Override UDQ values"}</h2><button class="x" id="mdX" title="Close" aria-label="Close">×</button></header>
        <div class="md-body">
          ${intro}
          ${resumeHtml}
          ${toggle}
          ${quickTerms}
          <div class="md-sec">
            <h3>Addresses &amp; contacts <span>(every document that prints the party)</span></h3>
            ${MD_PARTIES.map((f) => _mdPartyHtml(f, cur.parties[f.key], type)).join("")}
          </div>

          <details class="md-all" id="mdAll" ${manual || otherMeta.some((f) => cur.meta[f.k]) || Array.isArray(cur.items) ? "open" : ""}>
            <summary>Every other field — shipment details &amp; line items</summary>
            <div class="md-all-body">
              <table class="md-mtable">
                <thead><tr><th>Field</th>${manual ? "" : "<th>From UDQ</th>"}<th>${manual ? "Value" : "Your value"}</th></tr></thead>
                <tbody>${otherMeta.map((f) => _mdMetaRowHtml(f, cur)).join("")}</tbody>
              </table>

              <div class="md-sec">
                <h3>Line items</h3>
                ${itemsPaused ? `
                <p class="md-intro">The line-item table is <strong>paused while WMTRs are consolidated</strong> — it describes one WMTR,
                  so the documents use the combined UDQ inventory. ${Array.isArray(cur.items) ? "Your saved table is kept and applies again when consolidation is off." : ""}</p>` : `
                ${manual ? "" : `
                <div class="md-toggle" style="margin-bottom:8px;">
                  <input type="checkbox" id="mdItemsOn" ${itemsOn ? "checked" : ""}>
                  <label for="mdItemsOn">Replace the UDQ line items with this table
                    <span class="hint">Starts as a copy of the UDQ items — edit, add or delete rows. Off = documents use the UDQ items.</span></label>
                </div>`}
                <div class="md-itbar">
                  <button class="btn ghost btn-sm" type="button" id="mdAddRow">+ Add row</button>
                  ${manual ? "" : `<button class="btn ghost btn-sm" type="button" id="mdResetRows">Reset to UDQ items</button>`}
                  <span class="hint">${esc(itemsHint)}</span>
                </div>
                <div class="md-itwrap">
                  <table class="md-itable">
                    <thead><tr><th>#</th>${MD_ITEM_COLS[type].map((c) => `<th>${esc(c.label)}</th>`).join("")}<th></th></tr></thead>
                    <tbody id="mdItBody">${itemRows.map((r, i) => _mdItemRowHtml(r, i, type)).join("")}</tbody>
                  </table>
                </div>`}
              </div>
            </div>
          </details>
        </div>
        <div class="md-foot">
          ${type !== "property" ? `<button class="btn ghost" id="mdPkgs" type="button" title="Save, then open Manual Parents">Save &amp; edit packages &amp; weights…</button>` : ""}
          <span class="spacer"></span>
          <button class="btn ghost" id="mdCancel" type="button">Cancel</button>
          <button class="btn primary" id="mdSave" type="button">Save</button>
        </div>
      </div>
    </div>`);

  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeManualDetails(); });
  overlay.querySelector("#mdX").addEventListener("click", closeManualDetails);
  overlay.querySelector("#mdCancel").addEventListener("click", closeManualDetails);
  document.addEventListener("keydown", _mdEsc);

  // Editing any value implies intent to use it — auto-check the enable box.
  const autoEnable = (e) => {
    const t = e.target;
    if (!t || t.id === "mdEnabled" || t.id === "mdItemsOn" || t.id === "mdResume") return;
    const cb = document.getElementById("mdEnabled");
    if (cb && !cb.checked) cb.checked = true;
    if (t.hasAttribute && t.hasAttribute("data-col")) {
      const ic = document.getElementById("mdItemsOn");
      if (ic && !ic.checked) ic.checked = true;
    }
  };
  overlay.querySelector(".md-body").addEventListener("input", autoEnable);

  // Line-item table: add / delete / reset. (Absent while consolidation pauses it.)
  const tbody = overlay.querySelector("#mdItBody");
  const renumber = () => tbody.querySelectorAll("tr").forEach((tr, i) => { tr.querySelector("td.n").textContent = i + 1; });
  const markItemsOn = () => {
    const ic = document.getElementById("mdItemsOn"); if (ic) ic.checked = true;
    const cb = document.getElementById("mdEnabled"); if (cb) cb.checked = true;
  };
  if (tbody) {
    overlay.querySelector("#mdAddRow").addEventListener("click", () => {
      const n = tbody.querySelectorAll("tr").length;
      tbody.appendChild(el(`<table><tbody>${_mdItemRowHtml({}, n, type)}</tbody></table>`).querySelector("tr"));
      markItemsOn();
      const first = tbody.lastElementChild.querySelector("input");
      if (first) first.focus();
    });
    tbody.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("button.del");
      if (!b) return;
      b.closest("tr").remove();
      renumber();
      markItemsOn();
    });
    const reset = overlay.querySelector("#mdResetRows");
    if (reset) reset.addEventListener("click", () => {
      tbody.innerHTML = _mdUdqItemRows(type).map((r, i) => _mdItemRowHtml(r, i, type)).join("");
    });
  }

  // Manual entry: open a saved entry, or start a new blank one. Unsaved work
  // (no WMTR yet, so nothing is stored) is confirmed before it's discarded.
  const resume = overlay.querySelector("#mdResume");
  if (resume) resume.addEventListener("change", () => {
    const pick = resume.value;
    if (!pick) return;
    if (!wmtr && (mdHasAnyValue(collect()) || (typeof mpHasRows === "function" && mpHasRows())) &&
        !confirm("This entry has no WMTR number, so it hasn't been saved. Discard it?")) {
      resume.value = "";
      return;
    }
    if (pick === "__new") {
      closeManualDetails();
      _mdBeginManual();
      return;
    }
    const e = mdStoreLoad()[pick];
    if (!e) return;
    closeManualDetails();
    _mdOpenSaved(e);
  });

  const collect = () => {
    const o = mdBlank();
    o.enabled = manual ? true : !!overlay.querySelector("#mdEnabled").checked;
    overlay.querySelectorAll("input[data-meta]").forEach((inp) => {
      const v = mdStr(inp.value); if (v) o.meta[inp.dataset.meta] = v;
    });
    overlay.querySelectorAll("input[data-party]").forEach((inp) => {
      o.parties[inp.dataset.party][inp.dataset.pf] = mdStr(inp.value);
    });
    overlay.querySelectorAll("input[data-legacy]").forEach((cb) => {
      if (cb.checked) o.parties[cb.dataset.legacy].addr_lines = mdLines(cur.parties[cb.dataset.legacy].addr_lines);
    });
    const itemsCb = overlay.querySelector("#mdItemsOn");
    if (!tbody) {
      o.items = cur.items;               // table paused (consolidated) — keep what was saved
    } else if (manual || (itemsCb && itemsCb.checked)) {
      o.items = [];
      tbody.querySelectorAll("tr").forEach((tr) => {
        const r = {};
        tr.querySelectorAll("input[data-col]").forEach((inp) => { r[inp.dataset.col] = mdStr(inp.value); });
        if (mdItemRowHasData(r)) o.items.push(r);
      });
    }
    return o;
  };

  const save = () => {
    const o = collect();
    if (!manual && o.enabled && !mdHasAnyValue(o)) {
      alert("Enter at least one value before turning the override on (or leave it off to keep using the UDQ).");
      return false;
    }
    // Manual entry: a WMTR that already has its own saved entry must not be
    // silently overwritten by this one.
    if (manual) {
      const newW = mdOv(o.meta.wmtr) || "";
      const saved = newW && newW !== wmtr ? mdStoreLoad()[`manual:${newW}`] : null;
      if (saved) {
        if (confirm(`There's already a saved manual entry for ${newW}.\n\n` +
                    `OK = open that saved entry (what's in this window is discarded).\n` +
                    `Cancel = go back and change the WMTR number.`)) {
          closeManualDetails();
          _mdOpenSaved(saved);
        }
        return false;
      }
    }
    AppState.manualDetails = o;
    closeManualDetails();
    _mdAfterSave(true);
    return true;
  };

  overlay.querySelector("#mdSave").addEventListener("click", save);
  const pk = overlay.querySelector("#mdPkgs");
  if (pk) pk.addEventListener("click", () => {
    if (save() && typeof openManualParents === "function") openManualParents();
  });
}

/** Manual entry: switch to a saved entry — a different request, so the previous
 *  entry's packages / splits are dropped and this one's own are loaded. */
function _mdOpenSaved(entry) {
  AppState.manualDetails = Object.assign(mdNormalize(entry), { enabled: true });
  if (!Array.isArray(AppState.manualDetails.items)) AppState.manualDetails.items = [];
  AppState.manualParents = null;
  if (typeof siReset === "function") siReset();
  _mdSyncManualWmtr();
  if (typeof mpRestoreForWmtr === "function") mpRestoreForWmtr(mdCurrentWmtr());
  if (typeof renderAll === "function") renderAll();
  const status = document.getElementById("loadStatus");
  if (status) {
    status.classList.remove("err");
    status.textContent = `Opened the saved manual entry for ${mdCurrentWmtr()}.`;
  }
  openManualDetails();
}

/** Persist, rebuild AppState.data and re-render everything that shows it. */
function _mdAfterSave(announce) {
  const prevW = (AppState.manualOnly && AppState.dataBase && AppState.dataBase.meta.wmtr) || "";
  _mdSyncManualWmtr();
  const saved = mdPersistCurrent();
  // Manual entry whose WMTR was just typed (or corrected): the packages belong
  // to this entry, so save them under the new WMTR; with none entered yet, pick
  // up any saved for that WMTR.
  const curW = mdCurrentWmtr();
  if (AppState.manualOnly && curW && curW !== prevW) {
    if (typeof mpHasRows === "function" && mpHasRows()) mpPersistCurrent();
    else if (typeof mpRestoreForWmtr === "function") mpRestoreForWmtr(curW);
  }
  if (typeof renderAll === "function") renderAll();

  if (!announce) return;
  const status = document.getElementById("loadStatus");
  if (status) {
    status.classList.remove("err");
    if (AppState.manualOnly) {
      status.textContent = saved
        ? `Manual entry saved under ${mdCurrentWmtr()} — pick a document from the menu.`
        : `Manual entry updated — enter a WMTR number if you want it saved for later.`;
    } else {
      status.textContent = mdActive()
        ? `Manual overrides ON — ${mdActiveLabels().join(", ")}.`
        : `Manual overrides saved but OFF — documents use the UDQ values.`;
    }
  }
  if (typeof atlasAnnounce === "function") {
    try { atlasAnnounce(mdActive() ? "Manual values saved and in use." : "Manual values saved, override off."); } catch (e) {}
  }
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mdBlank, mdNormalize, mdHasAnyValue, mdApplyToData, mdApplyParty, mdApplyItems, mdLines, mdOv,
    MD_PARTIES, MD_META_FIELDS, MD_ITEM_COLS,
  };
}
