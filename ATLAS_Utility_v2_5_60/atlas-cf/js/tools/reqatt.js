/* =========================================================================
   ATLAS Utility Web — reqatt.js
   Required Attachments check.

   Faithful port of:
     - services/required_attachments_service.py  (run_required_attachments,
                                                   _required_abbrs_for_category, DOC_RULES)
     - services/metrics_service.py               (parse_metrics_udq + the
                                                   Attachment-List scan, _shipment_category,
                                                   _is_us, _has_any_exact, _to_date,
                                                   _wmtr_sort_key, _looks_like_wmtr_row)
     - ui/required_attachments_dialog.py         (FY + Period window selector,
                                                   summary line, columns, Copy Results,
                                                   View Category WMTRs)

   Behavioral parity notes (intentional, flagged):
     * Required Attachments uses the LOOSE WMTR check (any WMTR-…-SRF), NOT the
       metrics cutoff/allow-list (_is_wmtr_value) used by the big Metrics tool.
       Every WMTR-…-SRF block in the window is checked. Preserved exactly.
     * Category comes from Country of Origin / Country of Destination header
       fields (not the pickup/delivery org-country fallback the Metrics tool
       uses).
     * The desktop dialog has no Excel export — display + clipboard only. The
       web tool keeps Copy Results and View Category WMTRs, and ADDS a small
       "Export (.xlsx)" convenience button (flagged as a web addition).
   ========================================================================= */

/* The header fields the metrics parser pulls onto each WMTR block. Mirrors the
   subset of metrics_service.REQUIRED_HEADERS that Required Attachments reads,
   plus the two org-country headers the desktop parser validates as present. */
const REQATT_FIELD_HEADERS = [
  "WMTR Number",
  "Country of Origin",
  "Country of Destination",
  "Delivery Date",
  "Identify Shipment As",
  "Delivery Destination Organization Country",
  "Pickup Location Organization Country",
];

const REQATT_DOC_RULES = {
  CIV: "Commercial/Proforma Invoices",
  PKL: "Packing List",
  AWB: "Carrier waybills",
  POD: "Proof of Delivery",
  VAT: "VAT Exemption",
  SLI: "Shippers Letter of Instructions",
  AES: "Automated Export System (AES) records",
  MCT: "MCT",
};

const REQATT_US_NAMES = ["USA", "US", "UNITED STATES", "UNITED STATES OF AMERICA", "U.S.A.", "U.S."];

/* ---------------- low-level helpers (ports of metrics_service) ----------- */

function _raLooksWmtr(v) {
  const s = norm(v).toUpperCase();
  return !!s && s.startsWith("WMTR") && s.endsWith("-SRF");
}

function _raWmtrSortKey(wmtr) {
  const m = norm(wmtr).toUpperCase().match(/-(\d+)-SRF$/);
  if (!m) return 1e12;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 1e12;
}

/** Port of metrics_service._to_date (ISO first, then the M/D/Y and D-Mon-Y forms). */
function _raToDate(v) {
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { y: +m[3], mo: +m[1], d: +m[2] };
  m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (m) {
    const mo = PMR_MONTHS[m[2].toLowerCase()];
    if (mo) { let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000; return { y, mo, d: +m[1] }; }
  }
  return null;
}
function _raIso(d) { const p = (n) => String(n).padStart(2, "0"); return `${d.y}-${p(d.mo)}-${p(d.d)}`; }
function _raInWindow(dIso, s, e) { return s <= dIso && dIso <= e; }

function _raIsUs(country) {
  const c = norm(country).toUpperCase();
  return !!c && REQATT_US_NAMES.includes(c);
}
function _raSameCountry(a, b) { return norm(a).toLowerCase() === norm(b).toLowerCase(); }

/* Couriers: FedEx / UPS / DHL / USPS. These require ONLY AWB/BoL + POD,
   regardless of geographic category. They are STILL classified into their
   geographic bucket (Export/Import/F2F/Domestic) for the category tallies —
   only the required-document SET is overridden. (USPS was previously skipped
   entirely; it is now checked for AWB/BoL + POD.) Hand Carry remains skipped. */
const REQATT_COURIERS = ["fedex", "ups", "dhl", "usps"];
function _raIsCourier(shipmentAs) {
  // Token-exact match. Tolerant of separate ATLAS values ("FEDEX") or a single
  // combined value ("FedEx/UPS/DHL/USPS"); -, _ and / all split into tokens.
  const toks = norm(shipmentAs).toLowerCase().replace(/[-_/]/g, " ").split(/\s+/).filter(Boolean);
  return toks.some((t) => REQATT_COURIERS.includes(t));
}

/** Port of metrics_service._shipment_category. */
function _raShipmentCategory(origin, dest) {
  origin = norm(origin); dest = norm(dest);
  if (!origin || !dest) return "UNKNOWN";
  if (origin.toLowerCase() === dest.toLowerCase()) return "DOMESTIC";
  const ou = _raIsUs(origin), du = _raIsUs(dest);
  if (ou && !du) return "EXPORT";
  if (du && !ou) return "IMPORT";
  if (!ou && !du) return "F2F";
  return "DOMESTIC";
}

/** Case-insensitive, whitespace-normalized "any exact match" (port of _has_any_exact). */
function _raHasAnyExact(values, allowed) {
  const vset = new Set(values.map((x) => norm(x).toLowerCase()).filter(Boolean));
  for (const a of allowed) if (vset.has(norm(a).toLowerCase())) return true;
  return false;
}

/* ---------------- parser (port of parse_metrics_udq) --------------------- */

/** Returns an array of { fields, attachment_types, attachment_notes }. */
function reqattParseUdq(grid) {
  const shipMap = buildHeaderMap(grid, 1); // normalized header -> 1-based col
  const cell0 = (r0, c0) => {
    const row = grid[r0];
    if (!row) return "";
    return norm(row[c0]);
  };

  // Desktop validates these headers are present.
  for (const need of ["Delivery Destination Organization Country",
    "Pickup Location Organization Country", "WMTR Number"]) {
    if (!shipMap[normWs(need)]) {
      throw new Error(`UDQ missing required header: '${need}' (Metrics UDQ format expected).`);
    }
  }

  const headerCols = {}; // header -> 0-based col index
  for (const h of REQATT_FIELD_HEADERS) {
    if (shipMap[normWs(h)]) headerCols[h] = shipMap[normWs(h)] - 1;
  }

  const n = grid.length;
  const isWmtrRow = (idx) => idx >= 0 && idx < n && _raLooksWmtr(cell0(idx, 0));

  const blocks = [];
  let r = 1; // 0-based row index for Excel row 2
  while (r < n) {
    if (!isWmtrRow(r)) { r++; continue; }

    const blk = { fields: {}, attachment_types: [], attachment_notes: [] };
    for (const [h, c] of Object.entries(headerCols)) blk.fields[h] = cell0(r, c);

    let j = r + 1;
    while (j < n && !isWmtrRow(j)) {
      const b = cell0(j, 1);
      if (b === "Attachment List") {
        const hdrIdx = j + 1;
        if (hdrIdx >= n) break;
        const hdr = grid[hdrIdx] || [];
        let typeCol = null, notesCol = null;
        const scan = Math.min(hdr.length, 30);
        for (let c = 0; c < scan; c++) {
          const hv = norm(hdr[c]);
          if (hv === "Type") typeCol = c;
          else if (hv === "Attachment Notes") notesCol = c;
        }
        let k = hdrIdx + 1;
        while (k < n && !isWmtrRow(k)) {
          if (typeCol !== null) { const t = cell0(k, typeCol); if (t) blk.attachment_types.push(t); }
          if (notesCol !== null) { const nt = cell0(k, notesCol); if (nt) blk.attachment_notes.push(nt); }
          k++;
        }
        j = k;
        continue;
      }
      j++;
    }
    blocks.push(blk);
    r = j;
  }
  return blocks;
}

/* ---------------- required-abbrs by category (port) ---------------------- */

function _raRequiredAbbrs(category, attachmentTypes, isCourier) {
  if (isCourier) return ["AWB", "POD"];   // couriers: transport doc + POD only, any geography
  category = norm(category).toUpperCase();
  if (category === "DOMESTIC") return ["AWB", "POD"];
  const required = ["CIV", "PKL", "AWB", "POD", "VAT"];
  if (category === "EXPORT") {
    if (!_raHasAnyExact(attachmentTypes, ["MFR_NO AES"])) required.push("SLI", "AES");
  } else if (category === "IMPORT") {
    required.push("MCT");
  }
  return required;
}

/**
 * Evaluate one shipment's required documents against its attachment types.
 * Returns { required:[{abbr,label,satisfied}], missing:[label,…] }. The order
 * and per-abbr rules are identical to the desktop run_required_attachments loop,
 * so both the metrics check and the single-WMTR (SRF) audit share this logic.
 */
function _raEvaluate(category, attachmentTypes, origin, isCourier) {
  const required = [];
  for (const abbr of _raRequiredAbbrs(category, attachmentTypes, isCourier)) {
    let label, satisfied;
    if (abbr === "AWB") {
      label = "AWB/BoL";
      satisfied = _raHasAnyExact(attachmentTypes, ["Carrier waybills", "Bills of Lading"]);
    } else if (abbr === "PKL") {
      label = "PKL";
      const originIsUs = ["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"]
        .includes(norm(origin).toLowerCase());
      const allowed = ["Packing List"];
      if (!originIsUs) allowed.push("IPC");
      satisfied = _raHasAnyExact(attachmentTypes, allowed);
    } else {
      label = abbr;
      satisfied = _raHasAnyExact(attachmentTypes, [REQATT_DOC_RULES[abbr]]);
    }
    required.push({ abbr, label, satisfied });
  }
  return { required, missing: required.filter((x) => !x.satisfied).map((x) => x.label) };
}

/* ---------------- main run (port of run_required_attachments) ------------ */

function reqattRun(grid, startIso, endIso) {
  const blocks = reqattParseUdq(grid);
  const useWindow = !!(startIso && endIso); // Show All passes null/null -> no date filter

  const rows = [];
  let checkedCount = 0;
  const categoryCounts = { EXPORT: 0, IMPORT: 0, F2F: 0, DOMESTIC: 0 };
  const categoryWmtrs = { EXPORT: [], IMPORT: [], F2F: [], DOMESTIC: [] };
  const missingCountryRows = [];

  for (const blk of blocks) {
    const wmtr = norm(blk.fields["WMTR Number"]);
    if (!wmtr.toUpperCase().startsWith("WMTR") || !wmtr.toUpperCase().endsWith("-SRF")) continue;

    const delivery = _raToDate(blk.fields["Delivery Date"]);
    if (!delivery) continue;
    const deliveryIso = _raIso(delivery);
    if (useWindow && !_raInWindow(deliveryIso, startIso, endIso)) continue;

    // Identify Shipment As (case-insensitive header match, like the desktop)
    let shipmentAs = "";
    for (const [key, value] of Object.entries(blk.fields)) {
      if (norm(key).toLowerCase() === "identify shipment as") { shipmentAs = norm(value); break; }
    }
    const shipKey = shipmentAs.toLowerCase().replace(/[-_]/g, " ").split(/\s+/).filter(Boolean).join(" ");
    if (shipKey === "hand carry") continue;           // Hand Carry still skipped (no check)
    const isCourier = _raIsCourier(shipmentAs);        // FedEx/UPS/DHL/USPS -> AWB/BoL + POD only

    const origin = norm(blk.fields["Country of Origin"]);
    const dest = norm(blk.fields["Country of Destination"]);
    if (!origin || !dest) {
      missingCountryRows.push([wmtr, "Missing Country of Origin or Country of Destination"]);
      continue;
    }

    checkedCount += 1;
    const category = _raShipmentCategory(origin, dest);
    if (category in categoryCounts) {
      categoryCounts[category] += 1;
      categoryWmtrs[category].push(wmtr);
    }

    const { missing } = _raEvaluate(category, blk.attachment_types, origin, isCourier);
    if (missing.length) rows.push([wmtr, category, deliveryIso, missing.join(", ")]);
  }

  rows.sort((a, b) => _raWmtrSortKey(a[0]) - _raWmtrSortKey(b[0]));
  for (const k of Object.keys(categoryWmtrs)) {
    categoryWmtrs[k].sort((a, b) => _raWmtrSortKey(a) - _raWmtrSortKey(b));
  }

  return {
    rows,
    checked_count: checkedCount,
    category_counts: categoryCounts,
    category_wmtrs: categoryWmtrs,
    missing_count: rows.length,
    missing_country_rows: missingCountryRows,
  };
}

/* ---------------- single-WMTR (SRF UDQ) audit ---------------------------- */

/* Section titles that terminate the Attachment List in an SRF UDQ (a single
   shipment has no "next WMTR row" to stop at, so we stop at the next section). */
const REQATT_SRF_STOP = new Set([
  "inventory list", "cost list", "shipping activity & history", "request estimate list",
]);

/** Read the single SRF UDQ's Attachment List Type/Notes (stops at the next section). */
function reqattParseSrfAttachments(grid) {
  const n = grid.length;
  const cell0 = (r, c) => { const row = grid[r]; return row ? norm(row[c]) : ""; };

  let marker = -1;
  for (let r = 0; r < n; r++) {
    if (cell0(r, 0) === "Attachment List" || cell0(r, 1) === "Attachment List") { marker = r; break; }
  }
  if (marker < 0) return { attachment_types: [], attachment_notes: [] };

  const hdrIdx = marker + 1;
  const hdr = grid[hdrIdx] || [];
  let typeCol = null, notesCol = null;
  const scan = Math.min(hdr.length, 30);
  for (let c = 0; c < scan; c++) {
    const hv = norm(hdr[c]);
    if (hv === "Type") typeCol = c;
    else if (hv === "Attachment Notes") notesCol = c;
  }

  const types = [], notes = [];
  for (let k = hdrIdx + 1; k < n; k++) {
    const a = cell0(k, 0).toLowerCase(), b = cell0(k, 1).toLowerCase();
    if (REQATT_SRF_STOP.has(a) || REQATT_SRF_STOP.has(b)) break;
    if (typeCol !== null) { const t = cell0(k, typeCol); if (t) types.push(t); }
    if (notesCol !== null) { const nt = cell0(k, notesCol); if (nt) notes.push(nt); }
  }
  return { attachment_types: types, attachment_notes: notes };
}

/**
 * Audit a single WMTR from an SRF UDQ. Unlike the metrics check there is no
 * date window or "delivered" gate — it evaluates the loaded shipment as-is.
 */
function reqattAuditSrf(grid) {
  const shipMap = buildHeaderMap(grid, 1);
  const sv = (h) => shipValue(grid, shipMap, h);

  const wmtr = sv("WMTR Number");
  const origin = sv("Country of Origin");
  const dest = sv("Country of Destination");
  const shipmentAs = sv("Identify Shipment As");
  const delivery = sv("Delivery Date");
  const { attachment_types } = reqattParseSrfAttachments(grid);

  const shipKey = shipmentAs.toLowerCase().replace(/[-_]/g, " ").split(/\s+/).filter(Boolean).join(" ");
  const handCarry = shipKey === "hand carry";
  const isCourier = _raIsCourier(shipmentAs);

  const classifiable = !!(origin && dest);
  const category = classifiable ? _raShipmentCategory(origin, dest) : "";

  let required = [], missing = [];
  if (classifiable && !handCarry) {
    const ev = _raEvaluate(category, attachment_types, origin, isCourier);
    required = ev.required;
    missing = ev.missing;
  }

  return {
    wmtr, wmtr_last5: wmtrLast5(wmtr),
    origin, dest, shipment_as: shipmentAs, delivery,
    hand_carry: handCarry, is_courier: isCourier, classifiable, category,
    attachment_types, required, missing,
  };
}

const REQATT_PERIODS = ["1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr", "First Half", "Second Half", "Show All"];

/** Default period label by *calendar* month (matches desktop _current_qtr_label). */
function reqattCurrentQtrLabel() {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return "1st Qtr";
  if (m <= 6) return "2nd Qtr";
  if (m <= 9) return "3rd Qtr";
  return "4th Qtr";
}

/** FY + period -> [startIso, endIso], or null for "Show All" (no date filter).
    FY2026 = Oct 1 2025 .. Sep 30 2026. */
function reqattPeriodDates(fy, period) {
  const D = (y, mo, d) => _raIso({ y, mo, d });
  switch (period) {
    case "1st Qtr": return [D(fy - 1, 10, 1), D(fy - 1, 12, 31)];
    case "2nd Qtr": return [D(fy, 1, 1), D(fy, 3, 31)];
    case "3rd Qtr": return [D(fy, 4, 1), D(fy, 6, 30)];
    case "4th Qtr": return [D(fy, 7, 1), D(fy, 9, 30)];
    case "First Half": return [D(fy - 1, 10, 1), D(fy, 3, 31)];
    case "Second Half": return [D(fy, 4, 1), D(fy, 9, 30)];
    case "Show All": return null;
    default: return [D(fy - 1, 10, 1), D(fy, 9, 30)];
  }
}

function reqattStamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* =========================================================================
   Workspace UI
   ========================================================================= */

const ReqAttUi = { result: null, start: "", end: "", showCats: false, ignoreOpen: false };
const REQATT_COLUMNS = ["WMTR Number", "Shipment Type", "Delivery Date", "Missing Documents"];

function renderReqattWorkspace(container) {
  if (AppState.udqType === "srf") return renderReqattSrf(container);

  ReqAttUi.result = null; ReqAttUi.showCats = false;

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear - 3; y <= thisYear + 1; y++) years.push(y);
  const yearOpts = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  const periodOpts = REQATT_PERIODS.map((p) => `<option value="${p}">${esc(p)}</option>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Required Attachments</h2><span class="count" id="raBadge">Metrics UDQ</span></header>
      <div class="body">
        <div class="note">
          Checks every <strong>delivered</strong> SRF whose Delivery Date falls in the selected fiscal period for the
          attachments its shipment category requires. Category is derived from Country of Origin and Country of
          Destination (US→foreign = Export, foreign→US = Import, foreign→foreign = F2F, same country = Domestic).
          Hand Carry shipments are skipped. Couriers (FedEx, UPS, DHL, USPS) require only AWB/BoL + POD (full
          document set waived) but are still counted in their geographic category. Lists only WMTRs that are
          <strong>missing</strong> one or more required documents.
        </div>

        <div class="pmr-quick">
          <label class="pmr-qlabel">Quick window</label>
          <div class="btnrow"><button class="btn ghost" id="raAllTime">All Time</button></div>
          <div class="hint">"All Time" checks every delivered WMTR in the UDQ, ignoring the fiscal period.</div>
        </div>

        <div class="pmr-window">
          <div class="field">
            <label for="raFy">Fiscal year</label>
            <select id="raFy">${yearOpts}</select>
          </div>
          <div class="field">
            <label for="raPeriod">Period</label>
            <select id="raPeriod">${periodOpts}</select>
          </div>
          <div class="field pmr-runcell">
            <button class="btn primary" id="raRun">Run</button>
          </div>
        </div>

        <div class="statusline" id="raSummary">Select a period and click Run.</div>
        <div class="statusline err" id="raWarn" style="display:none;"></div>

        <div class="btnrow" id="raResultBtns" style="display:none;">
          <button class="btn ghost" id="raViewCats">View Category WMTRs</button>
          <button class="btn ghost" id="raCopy">Copy Results</button>
          <button class="btn ghost" id="raExport">Export (.xlsx)</button>
          <span class="statusline" id="raMsg"></span>
        </div>

        <div id="raIgnoreHost"></div>

        <div id="raCatPanel"></div>

        <div class="scrollwrap" id="raTableWrap" style="display:none; max-height:460px; margin-top:10px;">
          <table class="data" id="raTable">
            <thead><tr>${REQATT_COLUMNS.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);

  const g = (id) => panel.querySelector("#" + id);
  g("raFy").value = String(thisYear);            // calendar year as the FY label (matches desktop default)
  g("raPeriod").value = reqattCurrentQtrLabel(); // calendar-quarter label (matches desktop default)

  // Quick-window highlight, consistent with the Metrics tool: "All Time" lights
  // up when active; picking a period or running clears it.
  const raClearQuick = () => g("raAllTime").classList.remove("active");

  g("raRun").addEventListener("click", () => { raClearQuick(); runReqatt(); });
  g("raPeriod").addEventListener("change", raClearQuick);
  g("raFy").addEventListener("change", raClearQuick);
  g("raAllTime").addEventListener("click", () => { g("raPeriod").value = "Show All"; g("raAllTime").classList.add("active"); runReqatt(); });
  g("raViewCats").addEventListener("click", () => { ReqAttUi.showCats = !ReqAttUi.showCats; renderReqattCatPanel(); });
  g("raCopy").addEventListener("click", copyReqattResults);
  g("raExport").addEventListener("click", exportReqatt);

  // Auto-run on open (mirrors the desktop dialog's after(50, _run)).
  runReqatt();
}

function runReqatt() {
  const fy = Number(document.getElementById("raFy").value);
  const period = document.getElementById("raPeriod").value;
  const win = reqattPeriodDates(fy, period);   // [start,end] or null for Show All
  const start = win ? win[0] : null;
  const end = win ? win[1] : null;
  ReqAttUi.start = start; ReqAttUi.end = end; ReqAttUi.showCats = false;

  const summary = document.getElementById("raSummary");
  const warn = document.getElementById("raWarn");
  summary.classList.remove("err");
  warn.style.display = "none"; warn.textContent = "";
  summary.textContent = "Checking required attachments…";

  try {
    const result = reqattRun(AppState.grid, start, end);
    ReqAttUi.result = result;

    const windowText = win ? `${start} to ${end}` : "All WMTRs (no date filter)";
    const c = result.category_counts;
    summary.textContent =
      `${windowText} | Total Delivered: ${result.checked_count} | ` +
      `US Exports: ${c.EXPORT} | US Imports: ${c.IMPORT} | F2F: ${c.F2F} | ` +
      `Domestic: ${c.DOMESTIC} | Missing Attachments: ${result.missing_count}`;

    reqattRenderCountWarn();
    renderReqattTable(result);
    renderReqattIgnore();
    renderReqattCatPanel();
    document.getElementById("raResultBtns").style.display = "";
    document.getElementById("raMsg").textContent = "";
  } catch (e) {
    console.error(e);
    ReqAttUi.result = null;
    document.getElementById("raResultBtns").style.display = "none";
    document.getElementById("raTableWrap").style.display = "none";
    document.getElementById("raCatPanel").innerHTML = "";
    summary.textContent = `Required Attachments error: ${e.message}`;
    summary.classList.add("err");
  }
}

/* ---- Shared ignore integration (PMR/Metrics list) ------------------------
   Required Attachments reuses the SAME shared ignore list as PMR/Metrics
   (atlas.pmr_metrics.ignores), keyed by WMTR. "docs" hides a missing-documents
   row; "country" hides an unclassifiable (blank-country) row. Exactly like PMR,
   ignoring is DISPLAY-ONLY: the true missing count in the summary, the category
   breakdown, and every export/copy stay complete — only the on-screen list is
   trimmed, with a "+N acknowledged" note so nothing is silently lost. */
function _raIgnored(wmtr, cat) {
  return (typeof pmrmxIsIgnored === "function") ? pmrmxIsIgnored(wmtr, cat) : false;
}

function renderReqattTable(result) {
  const wrap = document.getElementById("raTableWrap");
  const tbody = wrap.querySelector("tbody");

  const allRows = result.rows || [];
  const visible = allRows.filter((r) => !_raIgnored(r[0], "docs"));
  const acked = allRows.length - visible.length;

  if (!allRows.length) {
    tbody.innerHTML = `<tr><td colspan="${REQATT_COLUMNS.length}" style="color:var(--muted)">No delivered WMTRs are missing required attachments in this window.</td></tr>`;
  } else if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="${REQATT_COLUMNS.length}" style="color:var(--muted)">All ${acked} missing-attachment reminder${acked === 1 ? "" : "s"} in this window have been acknowledged &amp; hidden. Manage in “Ignored”.</td></tr>`;
  } else {
    const ackNote = acked
      ? `<tr><td colspan="${REQATT_COLUMNS.length}" style="color:var(--steel);font-size:11.5px;">+${acked} acknowledged &amp; hidden — manage in “Ignored”. (The true “Missing Attachments” count above and every export stay complete.)</td></tr>`
      : "";
    tbody.innerHTML = visible.map((r) => {
      const wmtr = r[0];
      const ackx = `<button class="pmrmx-ackx" data-wmtr="${esc(wmtr)}" data-cat="docs" type="button" title="Acknowledge &amp; hide this reminder">\u00d7</button>`;
      return `<tr>` +
        `<td>${esc(wmtr == null ? "" : String(wmtr))}${ackx}</td>` +
        r.slice(1).map((v) => `<td>${esc(v == null ? "" : String(v))}</td>`).join("") +
        `</tr>`;
    }).join("") + ackNote;

    tbody.querySelectorAll(".pmrmx-ackx").forEach((b) =>
      b.addEventListener("click", () => {
        if (typeof pmrmxAddIgnore === "function") pmrmxAddIgnore(b.getAttribute("data-wmtr"), b.getAttribute("data-cat"));
        renderReqattTable(ReqAttUi.result);
        renderReqattIgnore();
      }));
  }
  wrap.style.display = "";
}

/* Unclassifiable (blank-country) warning, honoring the shared "country" ignore. */
function reqattRenderCountWarn() {
  const warn = document.getElementById("raWarn");
  if (!warn) return;
  const rows = (ReqAttUi.result && ReqAttUi.result.missing_country_rows) || [];
  const visible = rows.filter((r) => !_raIgnored(r[0], "country"));
  if (!visible.length) { warn.style.display = "none"; warn.textContent = ""; return; }
  const acked = rows.length - visible.length;
  const preview = visible.slice(0, 10).map((r) => `${r[0]}: ${r[1]}`).join(" · ");
  const more = visible.length - Math.min(visible.length, 10);
  warn.textContent = `${visible.length} delivered WMTR(s) couldn't be classified (blank country): ` +
    preview + (more ? ` …and ${more} more` : "") +
    (acked ? ` (+${acked} acknowledged & hidden — manage in “Ignored”.)` : "");
  warn.style.display = "";
}

/* Shared "Ignored (N)…" manager — the same box PMR and Metrics use. */
function renderReqattIgnore() {
  const host = document.getElementById("raIgnoreHost");
  if (!host) return;
  host.innerHTML = "";
  if (!ReqAttUi.result || typeof pmrmxBuildIgnoreUI !== "function") return;
  host.appendChild(pmrmxBuildIgnoreUI({
    open: ReqAttUi.ignoreOpen,
    onToggle: (o) => { ReqAttUi.ignoreOpen = o; },
    onChange: () => { reqattRenderCountWarn(); renderReqattTable(ReqAttUi.result); renderReqattIgnore(); },
  }));
}

function renderReqattCatPanel() {
  const host = document.getElementById("raCatPanel");
  if (!ReqAttUi.result || !ReqAttUi.showCats) { host.innerHTML = ""; return; }
  const cw = ReqAttUi.result.category_wmtrs;
  const labels = [["EXPORT", "US Exports"], ["IMPORT", "US Imports"], ["F2F", "F2F"], ["DOMESTIC", "Domestic"]];
  const blocks = labels.map(([key, label]) => {
    const list = cw[key] || [];
    const items = list.length ? list.map((w) => `<div class="mono">${esc(w)}</div>`).join("") : `<div style="color:var(--muted)">None</div>`;
    return `<div class="party"><div class="plabel">${esc(label)} (${list.length})</div>${items}</div>`;
  }).join("");
  host.innerHTML = `
    <div class="panel" style="margin-top:10px;">
      <header><h2 style="font-size:14px;">Delivered WMTRs by Category</h2>
        <span class="count"><button class="btn ghost" id="raCatCopy">Copy</button></span></header>
      <div class="body"><div class="parties">${blocks}</div></div>
    </div>`;
  const btn = host.querySelector("#raCatCopy");
  if (btn) btn.addEventListener("click", copyReqattCategories);
}

function copyReqattResults() {
  const r = ReqAttUi.result;
  if (!r) return;
  const lines = [REQATT_COLUMNS.join("\t")];
  for (const row of r.rows) lines.push(row.map((v) => (v == null ? "" : String(v))).join("\t"));
  reqattClip(lines.join("\n"), "Results copied to clipboard.");
}

function copyReqattCategories() {
  const cw = ReqAttUi.result.category_wmtrs;
  const labels = [["EXPORT", "US Exports"], ["IMPORT", "US Imports"], ["F2F", "F2F"], ["DOMESTIC", "Domestic"]];
  const lines = [];
  for (const [key, label] of labels) {
    const list = cw[key] || [];
    lines.push(`${label} (${list.length})`);
    lines.push(...(list.length ? list : ["None"]));
    lines.push("");
  }
  reqattClip(lines.join("\n"), "Category list copied to clipboard.");
}

function reqattClip(text, okMsg) {
  const msg = document.getElementById("raMsg");
  const done = () => { if (msg) msg.textContent = okMsg; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function exportReqatt() {
  const r = ReqAttUi.result;
  const msg = document.getElementById("raMsg");
  if (!r) return;
  msg.classList.remove("err");
  try {
    const aoa = [REQATT_COLUMNS, ...r.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = REQATT_COLUMNS.map((c, i) => {
      let w = String(c).length;
      for (const row of r.rows) { const v = row[i]; if (v != null) w = Math.max(w, String(v).length); }
      return { wch: Math.min(w + 2, 60) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Required Attachments");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    pmrDownloadXlsxB64(b64, `Required Attachments_${reqattStamp()}.xlsx`);
    msg.textContent = "Exported.";
  } catch (e) {
    console.error(e);
    msg.textContent = `Export failed: ${e.message}`;
    msg.classList.add("err");
  }
}

/* ---------------- single-WMTR (SRF) audit UI ----------------------------- */

const ReqAttSrf = { audit: null };

const REQATT_CAT_LABEL = {
  EXPORT: "Export (US → foreign)", IMPORT: "Import (foreign → US)",
  F2F: "F2F (foreign → foreign)", DOMESTIC: "Domestic (same country)",
};

function renderReqattSrf(container) {
  const a = reqattAuditSrf(AppState.grid);
  ReqAttSrf.audit = a;

  const route = `${esc(a.origin || "—")} → ${esc(a.dest || "—")}`;
  const catLabel = a.category ? (REQATT_CAT_LABEL[a.category] || a.category) : "—";

  // Body varies by case.
  let bodyHtml;
  if (!a.classifiable) {
    bodyHtml = `<div class="statusline err">Can't classify this shipment — Country of Origin and/or
      Country of Destination is blank, so the required-document set is undefined.</div>`;
  } else if (a.hand_carry) {
    bodyHtml = `<div class="statusline">Shipment mode is <strong>${esc(a.shipment_as)}</strong> —
      no attachment check is required for Hand Carry.</div>`;
  } else {
    const checklist = a.required.map((r) => `
      <tr>
        <td>${esc(r.label)}</td>
        <td>${esc(REQATT_DOC_RULES[r.abbr] || r.label)}</td>
        <td style="font-weight:600;color:${r.satisfied ? "var(--ok,#1a7f37)" : "var(--err,#b42318)"}">
          ${r.satisfied ? "\u2713 Present" : "\u2717 Missing"}
        </td>
      </tr>`).join("");

    const present = a.attachment_types.length
      ? a.attachment_types.map((t) => `<span class="badge" style="margin:2px 4px 2px 0;">${esc(t)}</span>`).join("")
      : `<span style="color:var(--muted)">No attachments found on this UDQ.</span>`;

    const verdict = a.missing.length
      ? `<span style="color:var(--err,#b42318);font-weight:600">Missing ${a.missing.length} of ${a.required.length}: ${esc(a.missing.join(", "))}</span>`
      : `<span style="color:var(--ok,#1a7f37);font-weight:600">All ${a.required.length} required attachments present.</span>`;

    bodyHtml = `
      ${a.is_courier ? `<div class="statusline">Courier shipment (${esc(a.shipment_as)}) — only AWB/BoL + POD required; full document set waived. Counted as <strong>${esc(a.category)}</strong> for category tallies.</div>` : ""}
      <div class="statusline">${verdict}</div>
      <div class="scrollwrap" style="margin-top:8px;">
        <table class="data">
          <thead><tr><th>Required</th><th>Document type</th><th>Status</th></tr></thead>
          <tbody>${checklist}</tbody>
        </table>
      </div>
      <header style="border-top:1px solid var(--line);margin-top:6px;"><h2 style="font-size:14px;">Attachments on this UDQ</h2></header>
      <div class="body" style="padding-top:6px;">${present}</div>`;
  }

  const panel = el(`
    <div class="panel">
      <header><h2>Required Attachments — Single WMTR</h2><span class="count">${esc(a.wmtr || "SRF UDQ")}</span></header>
      <div class="body">
        <div class="note">
          Audits the one shipment in this SRF UDQ against the documents its category requires — no date window or
          delivery filter. Category comes from Country of Origin and Country of Destination (US→foreign = Export,
          foreign→US = Import, foreign→foreign = F2F, same country = Domestic).
        </div>

        <div class="stats" style="margin-bottom:10px;">
          <div class="stat"><div class="k">Route</div><div class="v">${route}</div></div>
          <div class="stat"><div class="k">Category</div><div class="v">${esc(catLabel)}</div></div>
          <div class="stat"><div class="k">Shipment mode</div><div class="v">${esc(a.shipment_as || "—")}</div></div>
          <div class="stat"><div class="k">Delivery date</div><div class="v">${esc(a.delivery || "Not delivered")}</div></div>
        </div>

        ${bodyHtml}

        <div class="btnrow" style="margin-top:10px;">
          <button class="btn ghost" id="raSrfCopy">Copy</button>
          <button class="btn ghost" id="raSrfExport">Export (.xlsx)</button>
          <span class="statusline" id="raSrfMsg"></span>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelector("#raSrfCopy").addEventListener("click", copyReqattSrf);
  panel.querySelector("#raSrfExport").addEventListener("click", exportReqattSrf);
}

function reqattSrfSummaryLines(a) {
  const lines = [`WMTR: ${a.wmtr}`, `Route: ${a.origin || "—"} -> ${a.dest || "—"}`,
    `Category: ${a.category || "Unclassified"}`, `Mode: ${a.shipment_as || "—"}`,
    `Delivery: ${a.delivery || "Not delivered"}`, ""];
  if (!a.classifiable) { lines.push("Cannot classify — missing origin/destination country."); return lines; }
  if (a.hand_carry) { lines.push("Hand Carry — no attachment check required."); return lines; }
  lines.push("Required\tDocument type\tStatus");
  for (const r of a.required) {
    lines.push(`${r.label}\t${REQATT_DOC_RULES[r.abbr] || r.label}\t${r.satisfied ? "Present" : "Missing"}`);
  }
  lines.push("");
  lines.push(a.missing.length ? `Missing: ${a.missing.join(", ")}` : "All required attachments present.");
  return lines;
}

function copyReqattSrf() {
  const a = ReqAttSrf.audit; if (!a) return;
  reqattSrfClip(reqattSrfSummaryLines(a).join("\n"), "Audit copied to clipboard.");
}

function reqattSrfClip(text, okMsg) {
  const msg = document.getElementById("raSrfMsg");
  const done = () => { if (msg) msg.textContent = okMsg; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function exportReqattSrf() {
  const a = ReqAttSrf.audit; const msg = document.getElementById("raSrfMsg");
  if (!a) return;
  msg.classList.remove("err");
  try {
    // Same 4-column shape as the metrics export so rows paste into the same tracker.
    const missingText = !a.classifiable ? "(unclassified — missing country)"
      : a.hand_carry ? "(no check required — Hand Carry)"
        : a.missing.length ? a.missing.join(", ") : "(none — all present)";
    const aoa = [REQATT_COLUMNS, [a.wmtr, a.category || "", a.delivery || "", missingText]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Required Attachments");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const tag = a.wmtr_last5 ? `_${a.wmtr_last5}` : "";
    pmrDownloadXlsxB64(b64, `Required Attachments${tag}_${reqattStamp()}.xlsx`);
    msg.textContent = "Exported.";
  } catch (e) {
    console.error(e);
    msg.textContent = `Export failed: ${e.message}`;
    msg.classList.add("err");
  }
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    reqattParseUdq, reqattRun, _raShipmentCategory, _raHasAnyExact,
    _raToDate, reqattPeriodDates, reqattCurrentQtrLabel,
    reqattParseSrfAttachments, reqattAuditSrf, _raEvaluate,
  };
}
