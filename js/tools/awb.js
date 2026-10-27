/* =========================================================================
   ATLAS Utility Web — tools/awb.js

   Air Waybill — a FILLABLE PDF laid out like the standard IATA air waybill
   (the neutral AWB form forwarders and carriers use). Built with pdf-lib:
   every box is a real PDF form field, pre-filled from the shipment, so the
   PDF can still be edited in Acrobat / Edge / Chrome after download (or
   locked with "Flatten").

   WHERE THE VALUES COME FROM
   --------------------------
   Each AWB box (AWB_FIELDS) is a field on the Air Waybill form. A box left
   blank on the form uses its AUTO value (awbAutoValues) — worked out from the
   loaded shipment: shipper / consignee blocks, pieces, gross weight, volume
   and chargeable weight (1 kg per 6,000 cm³, rounded up to the next 0.5 kg),
   goods description + dimensions, notify party, dates. The form shows each
   auto value as its placeholder.

   OFFLINE MODE ONLY (offline.js rail) — not on the normal Shipping menu.
   What's typed is saved inside the offline shipment (and round-trips through
   the Excel template).

   No TTI / DTRA markings: the user's company name is the default issuing agent
   and their logo prints in the agent box.
   ========================================================================= */

/* Field catalog. g = form group; k = key (PDF field name + storage key);
   rows = textarea height; list = dropdown values; noTemplate = form only. */
const AWB_FIELDS = [
  { g: "Air waybill number", k: "prefix", label: "Airline prefix", hint: "3-digit airline code, e.g. 706 (Kenya Airways), 235 (Turkish), 176 (Emirates)" },
  { g: "Air waybill number", k: "serial", label: "AWB serial number", hint: "8 digits" },
  { g: "Air waybill number", k: "dep_code", label: "Departure airport code", hint: "IATA 3-letter, e.g. NBO" },
  { g: "Air waybill number", k: "issued_by", label: "Issued by (carrier)", rows: 3, hint: "Airline name and address" },
  { g: "Air waybill number", k: "copy_label", label: "Copy", list: ["Original 3 (For Shipper)", "Original 1 (For Issuing Carrier)", "Original 2 (For Consignee)", "Copy 4 (Delivery Receipt)", "Draft", "All 3 originals"], noTemplate: true },

  { g: "Shipper & consignee", k: "shipper_text", label: "Shipper's name and address", rows: 5 },
  { g: "Shipper & consignee", k: "shipper_acct", label: "Shipper's account number" },
  { g: "Shipper & consignee", k: "consignee_text", label: "Consignee's name and address", rows: 5 },
  { g: "Shipper & consignee", k: "consignee_acct", label: "Consignee's account number" },
  { g: "Shipper & consignee", k: "agent", label: "Issuing carrier's agent name and city", rows: 2 },
  { g: "Shipper & consignee", k: "agent_iata", label: "Agent's IATA code" },
  { g: "Shipper & consignee", k: "agent_acct", label: "Agent account no." },
  { g: "Shipper & consignee", k: "accounting", label: "Accounting information", rows: 3 },

  { g: "Routing", k: "dep_airport", label: "Airport of departure", hint: "Addr. of first carrier and requested routing" },
  { g: "Routing", k: "route_to1", label: "To (1st)", hint: "Airport code" },
  { g: "Routing", k: "route_by1", label: "By first carrier", hint: "Airline code, e.g. KQ" },
  { g: "Routing", k: "route_to2", label: "To (2nd)" },
  { g: "Routing", k: "route_by2", label: "By (2nd)" },
  { g: "Routing", k: "route_to3", label: "To (3rd)" },
  { g: "Routing", k: "route_by3", label: "By (3rd)" },
  { g: "Routing", k: "dest_airport", label: "Airport of destination" },
  { g: "Routing", k: "flight1", label: "Requested flight / date", hint: "e.g. KQ402/16" },
  { g: "Routing", k: "flight2", label: "2nd flight / date" },
  { g: "Routing", k: "ref_no", label: "Reference number" },
  { g: "Routing", k: "opt_info", label: "Optional shipping information" },

  { g: "Charges & values", k: "currency", label: "Currency" },
  { g: "Charges & values", k: "chgs_code", label: "CHGS code", hint: "e.g. PP, CC" },
  { g: "Charges & values", k: "wt_val", label: "WT/VAL charges", list: ["PP", "CC"], hint: "PP = prepaid, CC = collect" },
  { g: "Charges & values", k: "other", label: "Other charges", list: ["PP", "CC"] },
  { g: "Charges & values", k: "dv_carriage", label: "Declared value for carriage", hint: "NVD = no value declared" },
  { g: "Charges & values", k: "dv_customs", label: "Declared value for customs", hint: "NCV = no customs value" },
  { g: "Charges & values", k: "insurance", label: "Amount of insurance", hint: "XXX = none" },
  { g: "Charges & values", k: "as_agreed", label: "Rate / charges “AS AGREED”", list: ["Yes", "No"], hint: "Yes prints AS AGREED instead of a rate and totals" },
  { g: "Charges & values", k: "rate", label: "Rate / charge (per kg)" },
  { g: "Charges & values", k: "valuation", label: "Valuation charge" },
  { g: "Charges & values", k: "tax", label: "Tax" },
  { g: "Charges & values", k: "due_agent", label: "Total other charges due agent" },
  { g: "Charges & values", k: "due_carrier", label: "Total other charges due carrier" },
  { g: "Charges & values", k: "other_charges", label: "Other charges (detail)", rows: 3, hint: "e.g. AWC: 30.00  MYC: 12.50" },
  { g: "Charges & values", k: "cc_rates", label: "Currency conversion rates" },
  { g: "Charges & values", k: "cc_dest", label: "CC charges in dest. currency" },
  { g: "Charges & values", k: "charges_dest", label: "Charges at destination" },

  { g: "Goods", k: "pieces", label: "No. of pieces" },
  { g: "Goods", k: "gross", label: "Gross weight" },
  { g: "Goods", k: "wt_unit", label: "kg / lb", list: ["K", "L"] },
  { g: "Goods", k: "rate_class", label: "Rate class", hint: "e.g. Q (quantity), M (minimum), N (normal)" },
  { g: "Goods", k: "commodity", label: "Commodity item no." },
  { g: "Goods", k: "chargeable", label: "Chargeable weight" },
  { g: "Goods", k: "total", label: "Total (weight charge)" },
  { g: "Goods", k: "goods", label: "Nature and quantity of goods", rows: 7, hint: "Incl. dimensions or volume" },
  { g: "Goods", k: "handling", label: "Handling information", rows: 3 },
  { g: "Goods", k: "sci", label: "SCI", hint: "Special customs information" },

  { g: "Signatures", k: "shipper_sig", label: "Signature of shipper or agent" },
  { g: "Signatures", k: "exec_date", label: "Executed on (date)" },
  { g: "Signatures", k: "exec_place", label: "At (place)" },
  { g: "Signatures", k: "carrier_sig", label: "Signature of issuing carrier or agent" },
];

/* ---- values: saved / auto / effective ---- */

function _awbStr(v) { return String(v == null ? "" : v).trim(); }

/** The AWB values typed for the current offline shipment (blank = auto). */
function awbSaved() {
  return (typeof OffState !== "undefined" && OffState.ship && OffState.ship.awb) || {};
}

function awbSave(vals) {
  const clean = {};
  for (const k of Object.keys(vals)) if (_awbStr(vals[k])) clean[k] = vals[k];
  if (typeof OffState !== "undefined" && OffState.ship) { OffState.ship.awb = clean; offPersist(); }
}

function _awbPartyBlock(p, opts) {
  if (!p) return "";
  const lines = (p.addr_lines || []).filter(Boolean).slice();
  const country = _awbStr(p.country);
  if (country && !lines.some((l) => l.toUpperCase().indexOf(country.toUpperCase()) !== -1)) {
    if (lines.length) lines[lines.length - 1] += ", " + country; else lines.push(country);
  }
  const raw = p.raw || {};
  const poc = _awbStr(raw.poc_name);
  if (opts && opts.attn && poc && poc !== _awbStr(raw.org)) lines.push("ATTN: " + poc);
  if (_awbStr(p.phone)) lines.push("TEL: " + _awbStr(p.phone));
  return lines.join("\n");
}

function _awbHasParty(p) { return !!(p && ((p.addr_lines || []).some(Boolean) || _awbStr(p.country))); }

function _awbNum(n, dp) {
  const k = Math.pow(10, dp == null ? 1 : dp);
  const r = Math.round((+n + Number.EPSILON) * k) / k;
  return r ? String(r) : "";
}

/** DD-MMM-YYYY (AWB style), from YYYY-MM-DD or today. */
function _awbDate(iso) {
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(_awbStr(iso));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${MON[d.getMonth()]}-${d.getFullYear()}`;
}

/** Pieces / weights from the data model's packages (manual or UDQ). */
function awbWeights(data) {
  let pieces = 0, kg = 0, volKg = 0;
  const dims = [];
  for (const pk of (data.packages || [])) {
    const n = Math.max(1, Math.trunc(pk.count || 1));
    pieces += n;
    const w = toFloat(pk.weight_kg) || toFloat(pk.weight_lbs) * 0.45359237;
    kg += n * w;
    volKg += n * toFloat(pk.volume_ft3) * 0.028316846592 * 1e6 / 6000;
    const d = _awbStr(pk.dims);
    if (d) {
      const m = /^(.*?)\s*\((in|cm)\)\s*$/i.exec(d);
      const txt = (m ? m[1] : d).replace(/\s*x\s*/gi, " X ");
      dims.push(`${txt} ${m ? m[2].toUpperCase() : ""} X ${n}`.replace(/\s+/g, " "));
    }
  }
  if (!pieces) {
    const raw = (data.meta && data.meta.totals_raw) || {};
    pieces = raw.pkg_count || 0;
    kg = raw.udq_kg || 0;
    volKg = (raw.udq_m3 || 0) * 1e6 / 6000;
  }
  const charge = Math.ceil(Math.max(kg, volKg) * 2) / 2;
  return { pieces, kg, volKg, chargeable: charge, dims };
}

/** Auto value for every box, from the loaded shipment. */
function awbAutoValues(data) {
  const d = data || AppState.data;
  const m = d.meta || {};
  const P = d.parties || {};
  const off = typeof offlineOn === "function" && offlineOn();
  const brand = off && typeof offlineBrand === "function" ? offlineBrand() : null;
  const om = brand ? brand.meta : {};
  const wt = awbWeights(d);
  const shipper = _awbHasParty(P.origin) ? P.origin : P.pickup;
  const consignee = _awbHasParty(P.consignee) ? P.consignee : P.deliver;
  const depParty = _awbHasParty(P.pickup) ? P.pickup : shipper;
  const destParty = _awbHasParty(P.deliver) ? P.deliver : consignee;
  const saved = awbSaved();
  const asAgreed = !/^n/i.test(_awbStr(saved.as_agreed) || "Yes");
  const wtVal = _awbStr(saved.wt_val) || "PP";

  // Goods: item descriptions (one per line, qty when > 1), then dimensions.
  const goods = [];
  for (const it of (d.items || []).slice(0, 6)) {
    const q = Math.trunc(toFloat(it.units_raw || it.units));
    const desc = _awbStr(it.desc).replace(/\s+/g, " ");
    if (desc) goods.push(q > 1 ? `${desc}, ${q}` : desc);
  }
  if ((d.items || []).length > 6) goods.push(`+ ${(d.items.length - 6)} MORE LINE(S) - SEE INVOICE`);
  if (wt.dims.length) goods.push("", ...wt.dims);

  const handling = [];
  if (_awbStr(m.special_handling)) handling.push(_awbStr(m.special_handling));
  if (_awbHasParty(P.intermediate)) {
    handling.push("NOTIFY: " + _awbPartyBlock(P.intermediate).replace(/\n/g, ", "));
  }

  const rate = toFloat(saved.rate);
  const total = asAgreed ? "AS AGREED" : (rate && wt.chargeable ? fmtMoney(rate * wt.chargeable) : "");
  const agent = brand && brand.name ? brand.name : "";
  const awbNo = [_awbStr(saved.prefix), _awbStr(saved.serial)].filter(Boolean).join("-");

  return {
    prefix: "", serial: "", dep_code: "", issued_by: "", copy_label: "Original 3 (For Shipper)",
    shipper_text: _awbPartyBlock(shipper),
    shipper_acct: "", consignee_acct: "",
    consignee_text: _awbPartyBlock(consignee, { attn: true }),
    agent, agent_iata: "", agent_acct: "",
    accounting: wtVal === "CC" ? "FREIGHT COLLECT" : "FREIGHT PREPAID",
    dep_airport: _awbStr(depParty && depParty.city),
    route_to1: "", route_by1: "", route_to2: "", route_by2: "", route_to3: "", route_by3: "",
    dest_airport: _awbStr(destParty && destParty.city),
    flight1: "", flight2: "",
    ref_no: _awbStr(m.wmtr), opt_info: "",
    currency: _awbStr(om.currency) || "USD",
    chgs_code: wtVal === "CC" ? "CC" : "PP",
    wt_val: "PP", other: "PP",
    dv_carriage: "NVD", dv_customs: "NCV", insurance: "XXX",
    as_agreed: "Yes", rate: asAgreed ? "AS AGREED" : "",
    valuation: "", tax: "", due_agent: "", due_carrier: "", other_charges: "",
    cc_rates: "", cc_dest: "", charges_dest: "",
    pieces: wt.pieces ? String(wt.pieces) : "",
    gross: _awbNum(wt.kg), wt_unit: "K",
    rate_class: "", commodity: "",
    chargeable: _awbNum(wt.chargeable),
    total,
    goods: goods.join("\n"),
    handling: handling.join("\n"),
    sci: "",
    shipper_sig: _awbStr(shipper && shipper.raw && shipper.raw.org) || _awbStr((shipper && shipper.addr_lines || [])[0]),
    exec_date: _awbDate(om.ship_date || om.invoice_date),
    exec_place: _awbStr(depParty && depParty.city),
    carrier_sig: agent,
    _awbNo: awbNo,
    _volKg: wt.volKg,
  };
}

/** Saved value where typed, auto value otherwise — plus the charge roll-ups. */
function awbEffectiveValues(data) {
  const auto = awbAutoValues(data);
  const saved = awbSaved();
  const v = {};
  for (const f of AWB_FIELDS) v[f.k] = _awbStr(saved[f.k]) ? saved[f.k] : auto[f.k];
  const asAgreed = !/^n/i.test(_awbStr(v.as_agreed));
  if (!_awbStr(saved.total) && !asAgreed) {
    const r = toFloat(v.rate), c = toFloat(v.chargeable);
    v.total = r && c ? fmtMoney(r * c) : "";
  }
  // Prepaid / collect columns.
  const wtSide = v.wt_val === "CC" ? "collect" : "prepaid";
  const otSide = v.other === "CC" ? "collect" : "prepaid";
  const sum = (side) => {
    let n = 0, any = false;
    const add = (val, s) => { if (s !== side) return; const x = toFloat(val); if (x) { n += x; any = true; } };
    add(v.total, wtSide); add(v.valuation, wtSide); add(v.tax, wtSide);
    add(v.due_agent, otSide); add(v.due_carrier, otSide);
    return any ? fmtMoney(n) : "";
  };
  v._wt_prepaid = wtSide === "prepaid" ? v.total : "";
  v._wt_collect = wtSide === "collect" ? v.total : "";
  v._val_prepaid = wtSide === "prepaid" ? v.valuation : "";
  v._val_collect = wtSide === "collect" ? v.valuation : "";
  v._tax_prepaid = wtSide === "prepaid" ? v.tax : "";
  v._tax_collect = wtSide === "collect" ? v.tax : "";
  v._agent_prepaid = otSide === "prepaid" ? v.due_agent : "";
  v._agent_collect = otSide === "collect" ? v.due_agent : "";
  v._carrier_prepaid = otSide === "prepaid" ? v.due_carrier : "";
  v._carrier_collect = otSide === "collect" ? v.due_carrier : "";
  v._total_prepaid = asAgreed && wtSide === "prepaid" ? "AS AGREED" : sum("prepaid");
  v._total_collect = asAgreed && wtSide === "collect" ? "AS AGREED" : sum("collect");
  v._awbNo = [_awbStr(v.prefix), _awbStr(v.serial)].filter(Boolean).join("-");
  return v;
}

/* =========================================================================
   Workspace
   ========================================================================= */

function renderAwbWorkspace(container) {
  const data = AppState.data;
  const auto = awbAutoValues(data);
  const saved = awbSaved();
  const wt = awbWeights(data);
  const groups = [];
  for (const f of AWB_FIELDS) if (groups.indexOf(f.g) === -1) groups.push(f.g);

  const ctl = (f) => {
    const id = "awb_" + f.k;
    const val = saved[f.k] || "";
    const ph = auto[f.k] ? "Auto: " + auto[f.k] : "";
    let input;
    if (f.list) {
      const cur = val || (f.k === "copy_label" ? auto.copy_label : "");
      input = `<select id="${id}" data-awb="${f.k}" data-fc-skip>
        ${f.k === "copy_label" ? "" : `<option value="">${esc(ph || "—")}</option>`}
        ${f.list.map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.rows) {
      input = `<textarea id="${id}" data-awb="${f.k}" rows="${Math.min(f.rows, 4)}" data-fc-skip placeholder="${esc(ph)}">${esc(val)}</textarea>`;
    } else {
      input = `<input type="text" id="${id}" data-awb="${f.k}" data-fc-skip value="${esc(val)}" placeholder="${esc(ph)}">`;
    }
    return `<div class="field${f.rows && f.rows > 2 ? " span2" : ""}"><label for="${id}">${esc(f.label)}</label>${input}
      ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}</div>`;
  };

  const panel = el(`
    <div class="panel">
      <header><h2>Air Waybill</h2><span class="count">${esc(data.meta.wmtr || "")}</span></header>
      <div class="body">
        <div class="formgrid">
          <div class="field span2"><div class="hint awb-lede">
            Blank boxes fill in automatically from the shipment (shown in grey) — type only what you want to change.
            ${wt.pieces ? `This shipment: <strong>${wt.pieces}</strong> piece${wt.pieces === 1 ? "" : "s"},
              <strong>${esc(_awbNum(wt.kg))} kg</strong> gross, volume weight <strong>${esc(_awbNum(wt.volKg))} kg</strong>
              → chargeable <strong>${esc(_awbNum(wt.chargeable))} kg</strong>.` : "No packages entered yet — add them to fill pieces and weights."}
          </div></div>
          ${groups.map((g) => `<div class="field span2 awb-group"><h3>${esc(g)}</h3></div>` +
            AWB_FIELDS.filter((f) => f.g === g).map(ctl).join("")).join("")}
          <div class="field span2">
            <label class="awb-check"><input type="checkbox" id="awbCaps" data-fc-skip ${saved._caps === "No" ? "" : "checked"}> Print in capitals</label>
            <label class="awb-check"><input type="checkbox" id="awbFlatten" data-fc-skip> Lock the boxes (flatten) — the PDF can't be edited after download</label>
          </div>
        </div>
        <div class="btnrow">
          <button class="btn primary" id="awbPdf">Download fillable PDF</button>
          <button class="btn ghost" id="awbClear">Clear my entries</button>
          <button class="btn ghost" id="awbRefresh">Refresh preview</button>
          <span class="statusline" id="awbStatus"></span>
        </div>
        <div class="note">
          The PDF's boxes stay editable in Acrobat, Edge or Chrome after you download it (unless you lock them).
          Print on Letter, portrait, at 100% / actual size.
        </div>
        <div class="previewwrap"><iframe id="awbPreview" title="Air Waybill preview" style="height:1050px"></iframe></div>
      </div>
      <style>
        .awb-group h3{margin:10px 0 0;font:600 .95rem var(--disp);letter-spacing:.03em;text-transform:uppercase;border-top:1px solid var(--line);padding-top:10px;}
        .awb-check{display:flex;align-items:center;gap:8px;font-weight:400;margin:4px 0;}
        .awb-check input{width:auto;}
        .awb-lede{font-size:.88rem;}
      </style>
    </div>`);
  container.appendChild(panel);
  // Starts OPEN (unlike the CI / PL / Placards) — the AWB-only boxes (airline,
  // number, airports, flights) always need typing.
  if (typeof _atlasDetailsOpen !== "undefined" && _atlasDetailsOpen.awb === undefined) _atlasDetailsOpen.awb = true;
  if (typeof atlasCollapsibleDetails === "function") atlasCollapsibleDetails(panel, "awb");

  let timer = null;
  const collect = () => {
    const vals = {};
    panel.querySelectorAll("[data-awb]").forEach((inp) => { vals[inp.dataset.awb] = inp.value; });
    vals._caps = panel.querySelector("#awbCaps").checked ? "" : "No";
    return vals;
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { awbSave(collect()); updateAwbPreview(); }, 450);
  };
  panel.addEventListener("input", (e) => { if (e.target.closest(".formgrid")) changed(); });
  panel.addEventListener("change", (e) => { if (e.target.closest(".formgrid")) changed(); });
  panel.querySelector("#awbRefresh").addEventListener("click", () => { awbSave(collect()); updateAwbPreview(); });
  panel.querySelector("#awbPdf").addEventListener("click", () => { awbSave(collect()); downloadAwbPdf(); });
  panel.querySelector("#awbClear").addEventListener("click", () => {
    if (!confirm("Clear everything typed on this Air Waybill? Every box goes back to its automatic value.")) return;
    awbSave({});
    renderWorkspace();
  });

  updateAwbPreview();
}

let _awbPreviewUrl = "";
let _awbPreviewSeq = 0;
async function updateAwbPreview() {
  const iframe = document.getElementById("awbPreview");
  const status = document.getElementById("awbStatus");
  if (!iframe) return;
  const seq = ++_awbPreviewSeq;
  try {
    const bytes = await awbBuildPdf(AppState.data, { flatten: false });
    if (seq !== _awbPreviewSeq) return;
    if (_awbPreviewUrl) URL.revokeObjectURL(_awbPreviewUrl);
    _awbPreviewUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    iframe.src = _awbPreviewUrl + "#toolbar=0&view=FitH";
    if (status) { status.classList.remove("err"); status.textContent = "Preview up to date"; }
  } catch (e) {
    console.error(e);
    if (status) { status.textContent = "Couldn't build the Air Waybill: " + e.message; status.classList.add("err"); }
  }
}

function awbDocTitle(v) {
  const tag = (v && v._awbNo) || (AppState.data.meta.wmtr_last5 || "");
  return `AWB_${String(tag).replace(/[^A-Za-z0-9._-]+/g, "-") || "draft"}_${fileStamp()}`;
}

async function downloadAwbPdf() {
  const status = document.getElementById("awbStatus");
  try {
    const flatten = !!(document.getElementById("awbFlatten") || {}).checked;
    const v = awbEffectiveValues(AppState.data);
    const bytes = await awbBuildPdf(AppState.data, { flatten });
    const name = awbDocTitle(v) + ".pdf";
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    if (typeof auditRecordPrint === "function") auditRecordPrint("Air Waybill", name, AppState.data.meta.wmtr_last5 || "");
    if (status) { status.classList.remove("err"); status.textContent = `✅ Downloaded ${name}`; }
  } catch (e) {
    console.error(e);
    if (status) { status.textContent = "Error: " + e.message; status.classList.add("err"); }
  }
}

/* =========================================================================
   PDF (pdf-lib) — US Letter portrait, coordinates in points from the TOP
   ========================================================================= */

const AWB_COND_TEXT =
  "It is agreed that the goods described herein are accepted in apparent good order and condition (except as noted) " +
  "for carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. ALL GOODS MAY BE CARRIED BY ANY OTHER MEANS " +
  "INCLUDING ROAD OR ANY OTHER CARRIER UNLESS SPECIFIC CONTRARY INSTRUCTIONS ARE GIVEN HEREON BY THE SHIPPER, AND SHIPPER " +
  "AGREES THAT THE SHIPMENT MAY BE CARRIED VIA INTERMEDIATE STOPPING PLACES WHICH THE CARRIER DEEMS APPROPRIATE. THE " +
  "SHIPPER'S ATTENTION IS DRAWN TO THE NOTICE CONCERNING CARRIER'S LIMITATION OF LIABILITY. Shipper may increase such " +
  "limitation of liability by declaring a higher value for carriage and paying a supplemental charge if required.";
const AWB_CERT_TEXT =
  "Shipper certifies that the particulars on the face hereof are correct and that insofar as any part of the consignment " +
  "contains dangerous goods, such part is properly described by name and is in proper condition for carriage by air " +
  "according to the applicable Dangerous Goods Regulations.";
const AWB_INS_TEXT =
  "INSURANCE - If carrier offers insurance, and such insurance is requested in accordance with the conditions thereof, " +
  "indicate amount to be insured in figures in box marked \"Amount of Insurance\".";

function _awbAnsi(s) {
  if (typeof poAnsi === "function") return poAnsi(s);
  return String(s == null ? "" : s).replace(/[^\u0000-ÿ]/g, "?");
}

async function awbBuildPdf(data, opts) {
  const lib = (typeof poEnsurePdfLib === "function") ? poEnsurePdfLib() : PDFLib;
  const { PDFDocument, StandardFonts, rgb, TextAlignment } = lib;
  const v = awbEffectiveValues(data);
  const saved = awbSaved();
  const caps = saved._caps !== "No";
  const up = (s) => _awbAnsi(caps ? String(s == null ? "" : s).toUpperCase() : s);

  const pdf = await PDFDocument.create();
  pdf.setTitle(awbDocTitle(v));
  pdf.setCreator("ATLAS Utility");
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cour = await pdf.embedFont(StandardFonts.Courier);
  const courB = await pdf.embedFont(StandardFonts.CourierBold);
  const form = pdf.getForm();

  let logo = null;
  const brand = (typeof offlineBrand === "function") ? offlineBrand() : null;
  if (brand && brand.logo && typeof poDataUriToBytes === "function") {
    try { logo = await pdf.embedPng(poDataUriToBytes(brand.logo)); } catch (e) { logo = null; }
  }

  const copies = v.copy_label === "All 3 originals"
    ? ["Original 1 (For Issuing Carrier)", "Original 2 (For Consignee)", "Original 3 (For Shipper)"]
    : [v.copy_label || "Original 3 (For Shipper)"];

  const W = 612, H = 792;
  const INK = rgb(0.13, 0.22, 0.33);       // lines + labels
  const SHADE = rgb(0.93, 0.95, 0.97);
  const fields = {};                       // one field per box, shared by every copy page
  const fieldFont = {};

  for (const copyLabel of copies) {
    const page = pdf.addPage([W, H]);
    const Y = (y) => H - y;
    const line = (x1, y1, x2, y2, t) => page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: t || 0.6, color: INK });
    const box = (x, y, w, h, t) => page.drawRectangle({ x, y: Y(y + h), width: w, height: h, borderColor: INK, borderWidth: t || 0.6 });
    const shade = (x, y, w, h) => page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color: SHADE });
    const label = (text, x, y, o) => {
      const size = (o && o.size) || 5.6;
      const f = (o && o.bold) ? helvB : helv;
      let tx = x + 2;
      if (o && o.center) tx = x + (o.center - f.widthOfTextAtSize(text, size)) / 2;
      page.drawText(_awbAnsi(text), { x: tx, y: Y(y + size + 1.2), size, font: f, color: INK });
    };
    const para = (text, x, y, w, size, font) => {
      const f = font || helv;
      const words = _awbAnsi(text).split(/\s+/);
      let cur = "", yy = y;
      const out = () => { page.drawText(cur, { x: x + 2, y: Y(yy + size), size, font: f, color: INK }); yy += size * 1.18; };
      for (const wd of words) {
        const t = cur ? cur + " " + wd : wd;
        if (f.widthOfTextAtSize(t, size) > w - 4 && cur) { out(); cur = wd; } else cur = t;
      }
      if (cur) out();
      return yy;
    };
    // A box's value. Same name on every copy page = one field shown on each.
    const field = (name, value, x, y, w, h, o) => {
      o = o || {};
      let tf = fields[name];
      const multi = !!o.multi;
      const font = o.bold ? courB : cour;
      const text = multi ? up(value) : up(value).replace(/\s*\n\s*/g, ", ");
      let size = o.size || (multi ? 8.5 : 9);
      if (multi) size = _awbFitSize(text, font, size, w - 4, h - 2);
      else while (size > 5.5 && font.widthOfTextAtSize(text, size) > w - 4) size -= 0.5;
      const isNew = !tf;
      if (isNew) {
        tf = form.createTextField(name);
        if (multi) tf.enableMultiline();
        tf.setText(text);
        if (o.align === "right") tf.setAlignment(TextAlignment.Right);
        if (o.align === "center") tf.setAlignment(TextAlignment.Center);
        fields[name] = tf;
        fieldFont[name] = font;
      }
      tf.addToPage(page, {
        x: x + 1, y: Y(y + h), width: w - 2, height: h, font,
        textColor: rgb(0, 0, 0), backgroundColor: undefined, borderColor: undefined, borderWidth: 0,
      });
      if (isNew) tf.setFontSize(size);   // needs the /DA that addToPage writes
    };

    const L = 24, R = 588, M = 306;          // left edge, right edge, centre split

    /* ---- top line: AWB number ---- */
    field("hdr_prefix", v.prefix, L, 18, 34, 16, { size: 11 });
    line(L + 36, 20, L + 36, 34);
    field("hdr_dep", v.dep_code, L + 38, 18, 40, 16, { size: 11 });
    line(L + 80, 20, L + 80, 34);
    field("hdr_serial", v.serial, L + 82, 18, 110, 16, { size: 11 });
    field("hdr_awbno", v._awbNo, R - 160, 18, 160, 16, { size: 11, align: "right" });

    /* ---- left column ---- */
    const T = 38;
    box(L, T, R - L, 260, 0.8);               // outer frame of the top half
    line(M, T, M, T + 260);
    // Shipper
    label("Shipper's Name and Address", L, T);
    box(L + 168, T, M - L - 168, 18);
    label("Shipper's Account Number", L + 168, T);
    field("shipper_acct", v.shipper_acct, L + 168, T + 7, M - L - 168, 11, { size: 8 });
    field("shipper_text", v.shipper_text, L, T + 19, M - L, 51, { multi: true });
    line(L, T + 70, M, T + 70);
    // Consignee
    label("Consignee's Name and Address", L, T + 70);
    box(L + 168, T + 70, M - L - 168, 18);
    label("Consignee's Account Number", L + 168, T + 70);
    field("consignee_acct", v.consignee_acct, L + 168, T + 77, M - L - 168, 11, { size: 8 });
    field("consignee_text", v.consignee_text, L, T + 89, M - L, 51, { multi: true });
    line(L, T + 140, R, T + 140);
    // Agent
    label("Issuing Carrier's Agent Name and City", L, T + 140);
    const logoW = logo ? Math.min(90, 30 * logo.width / logo.height) : 0;
    field("agent", v.agent, L, T + 148, M - L - logoW - 6, 32, { multi: true });
    if (logo) {
      const h = Math.min(30, 90 * logo.height / logo.width), w = h * logo.width / logo.height;
      page.drawImage(logo, { x: M - w - 4, y: Y(T + 150 + h), width: w, height: h });
    }
    line(L, T + 180, M, T + 180);
    label("Agent's IATA Code", L, T + 180);
    field("agent_iata", v.agent_iata, L, T + 187, 140, 13);
    line(L + 142, T + 180, L + 142, T + 200);
    label("Account No.", L + 142, T + 180);
    field("agent_acct", v.agent_acct, L + 142, T + 187, M - L - 142, 13);
    line(L, T + 200, R, T + 200);
    label("Airport of Departure (Addr. of First Carrier) and Requested Routing", L, T + 200);
    field("dep_airport", v.dep_airport, L, T + 207, M - L, 13);
    line(L, T + 220, R, T + 220);
    // Routing row
    const rc = [L, L + 30, L + 132, L + 162, L + 196, L + 226, L + 260, M];
    const rl = ["To", "By First Carrier", "to", "by", "to", "by", ""];
    for (let i = 1; i < rc.length - 1; i++) line(rc[i], T + 220, rc[i], T + 240);
    const rk = ["route_to1", "route_by1", "route_to2", "route_by2", "route_to3", "route_by3"];
    for (let i = 0; i < 6; i++) {
      label(rl[i], rc[i], T + 220);
      field(rk[i], v[rk[i]], rc[i], T + 227, rc[i + 1] - rc[i], 13, { size: 8.5 });
    }
    label("Routing and Destination", L + 78, T + 220, { size: 4.4 });
    line(L, T + 240, R, T + 240);
    // Destination + flights
    page.drawRectangle({ x: L, y: Y(T + 260), width: 160, height: 20, borderColor: INK, borderWidth: 1.6 });
    label("Airport of Destination", L, T + 240);
    field("dest_airport", v.dest_airport, L, T + 247, 160, 13);
    line(L + 160, T + 240, L + 160, T + 260);
    label("Requested Flight/Date", L + 160, T + 240, { center: M - L - 160 });
    line(L + 233, T + 247, L + 233, T + 260);
    field("flight1", v.flight1, L + 160, T + 247, 73, 13, { size: 8.5 });
    field("flight2", v.flight2, L + 233, T + 247, M - L - 233, 13, { size: 8.5 });

    /* ---- right column ---- */
    label("Not Negotiable", M, T, { bold: true, size: 6 });
    page.drawText("Air Waybill", { x: M + 4, y: Y(T + 26), size: 17, font: helvB, color: INK });
    label("Issued by", M, T + 30);
    field("issued_by", v.issued_by, M + 102, T + 4, R - M - 104, 52, { multi: true, size: 8.5 });
    line(M, T + 58, R, T + 58);
    label("Copies 1, 2 and 3 of this Air Waybill are originals and have the same validity.", M, T + 59.5, { size: 5.6 });
    line(M, T + 68, R, T + 68);
    para(AWB_COND_TEXT, M, T + 70, R - M, 5.25);
    label("Accounting Information", M, T + 140);
    field("accounting", v.accounting, M, T + 148, R - M, 52, { multi: true });
    // Reference / optional info
    label("Reference Number", M, T + 200, { center: 95 });
    line(M + 95, T + 200, M + 95, T + 220);
    label("Optional Shipping Information", M + 95, T + 200, { center: R - M - 95 });
    field("ref_no", v.ref_no, M, T + 207, 95, 13, { size: 8 });
    field("opt_info", v.opt_info, M + 95, T + 207, R - M - 95, 13, { size: 8 });
    // Currency / charges codes / declared values
    const cx = [M, M + 34, M + 56, M + 76, M + 96, M + 116, M + 136, M + 212, R];
    for (let i = 1; i < cx.length - 1; i++) line(cx[i], T + 220, cx[i], T + 240);
    line(M + 56, T + 228, M + 136, T + 228, 0.4);
    label("Currency", cx[0], T + 220);
    label("CHGS", cx[1], T + 220, { size: 4.8 });
    label("WT/VAL", cx[2], T + 220, { size: 5, center: 40 });
    label("Other", cx[4], T + 220, { size: 5, center: 40 });
    ["PPD", "COLL", "PPD", "COLL"].forEach((t, i) => label(t, cx[2 + i], T + 228, { size: 4.4, center: 20 }));
    label("Declared Value for Carriage", cx[6], T + 220, { size: 5.2 });
    label("Declared Value for Customs", cx[7], T + 220, { size: 5.2 });
    field("currency", v.currency, cx[0], T + 227, 34, 13, { size: 8.5 });
    field("chgs_code", v.chgs_code, cx[1], T + 227, 22, 13, { size: 8 });
    const wtC = v.wt_val === "CC", otC = v.other === "CC";
    field("wt_ppd", wtC ? "" : "X", cx[2], T + 230, 20, 10, { size: 8, align: "center" });
    field("wt_coll", wtC ? "X" : "", cx[3], T + 230, 20, 10, { size: 8, align: "center" });
    field("ot_ppd", otC ? "" : "X", cx[4], T + 230, 20, 10, { size: 8, align: "center" });
    field("ot_coll", otC ? "X" : "", cx[5], T + 230, 20, 10, { size: 8, align: "center" });
    field("dv_carriage", v.dv_carriage, cx[6], T + 227, cx[7] - cx[6], 13, { align: "center" });
    field("dv_customs", v.dv_customs, cx[7], T + 227, R - cx[7], 13, { align: "center" });
    // Insurance
    label("Amount of Insurance", M, T + 240, { center: 90 });
    line(M + 90, T + 240, M + 90, T + 260);
    field("insurance", v.insurance, M, T + 247, 90, 13, { align: "center" });
    para(AWB_INS_TEXT, M + 90, T + 241, R - M - 90, 4.9);

    /* ---- handling ---- */
    const HT = T + 260;
    box(L, HT, R - L, 36, 0.8);
    label("Handling Information", L, HT);
    field("handling", v.handling, L, HT + 7, R - L - 72, 29, { multi: true, size: 8 });
    box(R - 70, HT + 16, 70, 20);
    label("SCI", R - 70, HT + 16, { center: 70 });
    field("sci", v.sci, R - 70, HT + 23, 70, 13, { size: 8, align: "center" });

    /* ---- rate table ---- */
    const RT = HT + 36, RH = 22, RB = 156, RF = 18;
    box(L, RT, R - L, RH + RB + RF, 0.8);
    const col = [L, L + 34, L + 86, L + 98, L + 112, L + 166, L + 222, L + 286, L + 370, R];
    for (let i = 1; i < col.length - 1; i++) line(col[i], RT, col[i], RT + RH + RB + RF);
    line(L, RT + RH, R, RT + RH);
    line(L, RT + RH + RB, L + 370, RT + RH + RB);
    const hl = (t, i, dy) => label(t, col[i], RT + (dy || 3), { center: col[i + 1] - col[i], size: 5.4 });
    hl("No. of", 0, 2); hl("Pieces", 0, 8); hl("RCP", 0, 14);
    hl("Gross", 1, 5); hl("Weight", 1, 11);
    hl("kg", 2, 2); hl("lb", 2, 11);
    label("Rate Class", col[3], RT + 1, { size: 5.4 });
    line(col[4], RT + 8, col[5], RT + 8, 0.4);
    hl("Commodity", 4, 10); hl("Item No.", 4, 15);
    hl("Chargeable", 5, 5); hl("Weight", 5, 11);
    hl("Rate", 6, 3); hl("Charge", 6, 13);
    line(col[6] + 30, RT + 18, col[7] - 6, RT + 6, 0.4);
    hl("Total", 7, 8);
    hl("Nature and Quantity of Goods", 8, 5); hl("(incl. Dimensions or Volume)", 8, 12);
    const by = RT + RH + 2;
    field("pieces", v.pieces, col[0], by, col[1] - col[0], 12, { align: "right" });
    field("gross", v.gross, col[1], by, col[2] - col[1], 12, { align: "right" });
    field("wt_unit", v.wt_unit, col[2], by, col[3] - col[2], 12, { size: 8, align: "center" });
    field("rate_class", v.rate_class, col[3], by, col[4] - col[3], 12, { size: 8, align: "center" });
    field("commodity", v.commodity, col[4], by, col[5] - col[4], 12, { size: 8 });
    field("chargeable", v.chargeable, col[5], by, col[6] - col[5], 12, { align: "right" });
    field("rate", v.rate, col[6], by, col[7] - col[6], 24, { multi: true, size: 8 });
    field("total", v.total, col[7], by, col[8] - col[7], 12, { align: "right", size: 8.5 });
    field("goods", v.goods, col[8], by, R - col[8], RB - 4, { multi: true, size: 8.5 });
    const fy = RT + RH + RB + 3;
    field("sum_pieces", v.pieces, col[0], fy, col[1] - col[0], 12, { align: "right" });
    field("sum_gross", v.gross, col[1], fy, col[2] - col[1], 12, { align: "right" });
    field("sum_unit", v.wt_unit, col[2], fy, col[3] - col[2], 12, { size: 8, align: "center" });
    field("sum_total", v.total, col[7], fy, col[8] - col[7], 12, { align: "right", size: 8.5 });

    /* ---- charges (left) ---- */
    const CT = RT + RH + RB + RF, RW = 24;
    box(L, CT, R - L, RW * 9, 0.8);
    line(M, CT, M, CT + RW * 9);
    const hx = L + 140;                       // prepaid | collect split
    const chRow = (i, title, kp, kc, centerLabel) => {
      const y = CT + RW * i;
      if (i) line(L, y, M, y);
      if (centerLabel) {
        const tw = helv.widthOfTextAtSize(title, 5.6) + 14;
        const x0 = L + (M - L - tw) / 2;
        line(x0, y, x0 + 6, y + 8, 0.4); line(x0 + tw - 6, y + 8, x0 + tw, y, 0.4); line(x0 + 6, y + 8, x0 + tw - 6, y + 8, 0.4);
        label(title, x0, y + 0.8, { center: tw });
      }
      line(hx, y + 8, hx, y + RW);
      if (kp) field(kp, v[kp], L, y + 9, hx - L, 14);
      if (kc) field(kc, v[kc], hx, y + 9, M - hx, 14);
    };
    label("Prepaid", L, CT + 0.8);
    label("Collect", M - 30, CT + 0.8);
    chRow(0, "Weight Charge", "_wt_prepaid", "_wt_collect", true);
    chRow(1, "Valuation Charge", "_val_prepaid", "_val_collect", true);
    chRow(2, "Tax", "_tax_prepaid", "_tax_collect", true);
    chRow(3, "Total Other Charges Due Agent", "_agent_prepaid", "_agent_collect", true);
    chRow(4, "Total Other Charges Due Carrier", "_carrier_prepaid", "_carrier_collect", true);
    shade(L + 0.5, CT + RW * 5 + 0.5, M - L - 1, RW - 1);
    line(L, CT + RW * 5, M, CT + RW * 5);
    line(hx, CT + RW * 5, hx, CT + RW * 6);
    const y6 = CT + RW * 6;
    line(L, y6, M, y6);
    label("Total Prepaid", L, y6 + 0.8, { center: hx - L });
    label("Total Collect", hx, y6 + 0.8, { center: M - hx });
    line(hx, y6, hx, y6 + RW);
    field("_total_prepaid", v._total_prepaid, L, y6 + 9, hx - L, 14, { bold: true });
    field("_total_collect", v._total_collect, hx, y6 + 9, M - hx, 14, { bold: true });
    const y7 = CT + RW * 7;
    line(L, y7, M, y7);
    label("Currency Conversion Rates", L, y7 + 0.8, { center: hx - L });
    label("CC Charges in Dest. Currency", hx, y7 + 0.8, { center: M - hx });
    line(hx, y7, hx, y7 + RW);
    field("cc_rates", v.cc_rates, L, y7 + 9, hx - L, 14);
    field("cc_dest", v.cc_dest, hx, y7 + 9, M - hx, 14);
    const y8 = CT + RW * 8;
    line(L, y8, R, y8);
    label("For Carrier's Use only", L, y8 + 6, { center: hx - L });
    label("at Destination", L, y8 + 12.5, { center: hx - L });
    line(hx, y8, hx, y8 + RW);
    label("Charges at Destination", hx, y8 + 0.8, { center: M - hx });
    field("charges_dest", v.charges_dest, hx, y8 + 9, M - hx, 14);

    /* ---- charges (right) ---- */
    label("Other Charges", M, CT);
    field("other_charges", v.other_charges, M, CT + 8, R - M, RW * 3 - 10, { multi: true, size: 8.5 });
    line(M, CT + RW * 3, R, CT + RW * 3);
    para(AWB_CERT_TEXT, M, CT + RW * 3 + 1, R - M, 5.3);
    field("shipper_sig", v.shipper_sig, M, CT + RW * 3 + 22, R - M, 16, { align: "center" });
    _awbDots(page, M + 6, Y(CT + RW * 3 + 40), R - 6, INK);
    label("Signature of Shipper or his Agent", M, CT + RW * 3 + 41, { center: R - M });
    line(M, CT + RW * 5 + 6, R, CT + RW * 5 + 6);
    field("exec_date", v.exec_date, M, CT + RW * 5 + 14, 92, 18);
    field("exec_place", v.exec_place, M + 92, CT + RW * 5 + 14, 88, 18);
    field("carrier_sig", v.carrier_sig, M + 180, CT + RW * 5 + 14, R - M - 180, 18, { align: "center" });
    _awbDots(page, M + 6, Y(CT + RW * 5 + 34), R - 6, INK);
    label("Executed on (date)", M, CT + RW * 5 + 35);
    label("at (place)", M + 92, CT + RW * 5 + 35);
    label("Signature of Issuing Carrier or its Agent", M + 180, CT + RW * 5 + 35, { center: R - M - 180 });
    // Bottom row: total collect charges | AWB number
    line(M + 150, y8, M + 150, y8 + RW);
    label("Total Collect Charges", M, y8 + 0.8, { center: 150 });
    field("total_cc", "", M, y8 + 9, 150, 14);
    field("ftr_awbno", v._awbNo, M + 152, y8 + 5, R - M - 154, 16, { size: 11, align: "right" });

    /* ---- copy label ---- */
    const cl = _awbAnsi(copyLabel);
    page.drawText(cl, { x: (W - helvB.widthOfTextAtSize(cl, 10)) / 2, y: Y(CT + RW * 9 + 16), size: 10, font: helvB, color: rgb(0.55, 0.1, 0.1) });
  }

  // Redraw every box in its own (Courier) font at its final size — pdf-lib
  // would otherwise redraw them in Helvetica on save.
  for (const name of Object.keys(fields)) fields[name].updateAppearances(fieldFont[name]);
  if (opts && opts.flatten) form.flatten();
  return pdf.save({ updateFieldAppearances: false });
}

/** Biggest font size (≤ start) at which the wrapped text fits the box. */
function _awbFitSize(text, font, start, w, h) {
  let size = start;
  while (size > 5) {
    let lines = 0;
    for (const para of String(text).split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      let cur = "", n = 1;
      for (const wd of words) {
        const t = cur ? cur + " " + wd : wd;
        if (font.widthOfTextAtSize(t, size) > w && cur) { n++; cur = wd; } else cur = t;
      }
      lines += n;
    }
    if (lines * size * 1.18 <= h) return size;
    size -= 0.5;
  }
  return 5;
}

function _awbDots(page, x1, y, x2, color) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color, dashArray: [1, 2] });
}
