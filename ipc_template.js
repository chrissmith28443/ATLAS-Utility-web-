/* =========================================================================
   ATLAS Utility Web — ecm.js
   Export-Controlled Materials list.

   Faithful port of:
     - services/export_controlled_materials_service.py
         (_iter_export_rows, build_export_controlled_materials_result,
          write_export_controlled_materials_workbook, _auth_is_export_controlled,
          _fy_qtr_from_date, _extract_wmtr_5digit, _wmtr_sort_key, …)
     - ui/actions.run_export_controlled_materials_clicked
         (no dialog / no date window — exports every export-controlled inventory
          item across all WMTRs in the Metrics UDQ)

   Behavioral parity notes (intentional, flagged):
     * No date window. The desktop ECM button reads the whole UDQ and lists every
       inventory line whose "BIS/DDTC Authorization or Exception" is something other
       than blank, N/A, or NLR. Preserved exactly.
     * Output filename matches the desktop: Export_Controlled_Materials_<YYYYMMDD_HHMMSS>.xlsx
       (note: compact stamp, no dashes — different from PMR's stamp).
   ========================================================================= */

const ECM_TEMPLATE_HEADERS = [
  "WMTR Number", "WMTR #", "FY/QTR", "Delivery Date", "Request Title",
  "Description", "Model/Catalog Number", "Quantity", "Unit Of Measure",
  "Unit Of Issue", "Value(USD)", "BIS/DDTC Authorization or Exception",
];

/* UDQ inventory label -> output (template) label. */
const ECM_INVENTORY_FIELD_MAP = {
  "Description": "Description",
  "Model/Catalog Number": "Model/Catalog Number",
  "Quantity": "Quantity",
  "Unit Of Measure": "Unit Of Measure",
  "Unit Of Issue": "Unit Of Issue",
  "Value(USD)": "Value(USD)",
  "BIS/DDTC Authorization or Exception": "BIS/DDTC Authorization or Exception",
};

const ECM_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const ECM_BLOCK_SECTIONS = new Set([
  "Attachment List", "Inventory List", "Cost List", "Service List", "Shipping Activity & History",
]);

/* ---------------- helpers (ports) ---------------------------------------- */

function _ecmNormHdr(v) { return norm(v).toLowerCase(); }

/** Grid values are already strings (SheetJS raw:false); strip and pass through. */
function _ecmClean(v) { return v === null || v === undefined ? "" : String(v).trim(); }

/** Port of _coerce_to_date (only the formats the desktop accepts). */
function _ecmCoerceDate(v) {
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000; return { y, mo: +m[1], d: +m[2] }; }
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]+)[ -](\d{2,4})$/);
  if (m) {
    const mo = ECM_MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mo) { let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000; return { y, mo, d: +m[1] }; }
  }
  return null;
}

/** Port of _fy_qtr_from_date -> e.g. "FY25 / Q4". */
function _ecmFyQtr(v) {
  const d = _ecmCoerceDate(v);
  if (!d) return "";
  let fy, qtr;
  if (d.mo >= 10) { fy = d.y + 1; qtr = 1; }
  else if (d.mo >= 7) { fy = d.y; qtr = 4; }
  else if (d.mo >= 4) { fy = d.y; qtr = 3; }
  else { fy = d.y; qtr = 2; }
  return `FY${String(fy).slice(-2)} / Q${qtr}`;
}

function _ecmIsWmtrRow(row) {
  if (!row) return false;
  return norm(row[0]).toUpperCase().startsWith("WMTR-");
}
function _ecmSectionLabel(row) { return row ? norm(row[1]) : ""; } // column B
function _ecmIsBlockSectionStart(row) { return ECM_BLOCK_SECTIONS.has(_ecmSectionLabel(row)); }

function _ecmExtract5(v) {
  const m = norm(v).match(/\b(1\d{4})\b/);
  return m ? m[1] : "";
}
function _ecmWmtrSortKey(v) {
  const m = norm(v).match(/\b(1\d{4})\b/);
  if (!m) return 1e12;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 1e12;
}

function _ecmIso(d) { const p = (n) => String(n).padStart(2, "0"); return `${d.y}-${p(d.mo)}-${p(d.d)}`; }
function _ecmInWindow(iso, s, e) { return s <= iso && iso <= e; }

/** Port of _auth_is_export_controlled. */
function _ecmAuthIsControlled(v) {
  const s = norm(v).toUpperCase();
  if (!s) return false;
  if (/\bN\s*[/_\- ]?\s*A\b/.test(s)) return false; // N/A, N A, N-A, …
  if (/\bNLR\b/.test(s)) return false;
  return true;
}

function _ecmRowHeaderMap(row) {
  const map = {};
  (row || []).forEach((v, i) => { const k = _ecmNormHdr(v); if (k && !(k in map)) map[k] = i; });
  return map;
}

/* ---------------- numeric formatting (Qty / Value display + write) ------- */

/** Parse a numeric cell ("1.000000", "20000.00") -> finite Number, or null. */
function _ecmNum(v) {
  const s = norm(v).replace(/,/g, "").replace(/\$/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
/** Quantity for display: "1.000000" -> "1", "2.500000" -> "2.5"; pass through if non-numeric. */
function _ecmQtyDisplay(v) {
  const n = _ecmNum(v);
  return n === null ? _ecmClean(v) : String(n);
}
/** Value for display: "20000.000000" -> "$20,000.00"; pass through if non-numeric. */
function _ecmMoneyDisplay(v) {
  const n = _ecmNum(v);
  return n === null ? _ecmClean(v)
    : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Ensure the template's styles.xml has a USD-currency cellXf and return its
 * index. The embedded template ships with no currency format, so we inject one
 * (numFmt 164 = "$"#,##0.00) at generation time and reference it on Value cells.
 */
function _ecmEnsureCurrencyStyle(stylesXml) {
  const NUMFMT = '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>';
  if (/<numFmts /.test(stylesXml)) {
    stylesXml = stylesXml.replace(/<numFmts count="(\d+)">/, (m, c) => `<numFmts count="${+c + 1}">${NUMFMT}`);
  } else {
    stylesXml = stylesXml.replace("<fonts", () => `<numFmts count="1">${NUMFMT}</numFmts><fonts`);
  }
  let xfIndex = 0;
  stylesXml = stylesXml.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (m, c, body) => {
    xfIndex = +c; // new xf appended at the end -> its index is the old count
    const xf = '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>';
    return `<cellXfs count="${+c + 1}">${body}${xf}</cellXfs>`;
  });
  return { xml: stylesXml, xfIndex };
}

/* ---------------- parse (port of _iter_export_rows) ---------------------- */

function ecmIterExportRows(grid, startIso, endIso) {
  const n = grid.length;
  if (!n) return [];
  const useWindow = !!(startIso && endIso); // Show All / no window -> scan everything

  const cell = (r, c) => { const row = grid[r]; return c >= 0 && row && c < row.length ? row[c] : null; };

  const shipMap = _ecmRowHeaderMap(grid[0]);
  for (const need of ["wmtr number", "request title", "delivery date"]) {
    if (!(need in shipMap)) {
      throw new Error(`Could not find '${need.replace(/\b\w/g, (m) => m.toUpperCase())}' in row 1 of the UDQ.`);
    }
  }
  const wmtrIdx = shipMap["wmtr number"];
  const deliveryIdx = shipMap["delivery date"];
  const titleIdx = shipMap["request title"];

  const out = [];
  let r = 1;
  while (r < n) {
    const rowR = grid[r];
    if (!_ecmIsWmtrRow(rowR)) { r++; continue; }

    const wmtrNumber = _ecmClean(cell(r, wmtrIdx));
    const wmtr5 = _ecmExtract5(wmtrNumber);
    const rawDelivery = cell(r, deliveryIdx);
    const deliveryDate = _ecmClean(rawDelivery);
    const fyQtr = _ecmFyQtr(rawDelivery);
    const requestTitle = _ecmClean(cell(r, titleIdx));

    // Block boundary
    let nextWmtr = r + 1;
    while (nextWmtr < n && !_ecmIsWmtrRow(grid[nextWmtr])) nextWmtr++;

    // Date-window filter (on the WMTR's Delivery Date). Show All skips this.
    if (useWindow) {
      const dd = _ecmCoerceDate(rawDelivery);
      if (!dd || !_ecmInWindow(_ecmIso(dd), startIso, endIso)) { r = nextWmtr; continue; }
    }

    // Inventory List marker within block
    let invMarker = null;
    for (let j = r + 1; j < nextWmtr; j++) {
      if (_ecmSectionLabel(grid[j]) === "Inventory List") { invMarker = j; break; }
    }
    if (invMarker === null) { r = nextWmtr; continue; }

    const invHeaderIdx = invMarker + 1;
    const firstItemIdx = invMarker + 2;
    if (invHeaderIdx >= nextWmtr) { r = nextWmtr; continue; }

    const invMap = _ecmRowHeaderMap(grid[invHeaderIdx]);
    const missing = Object.keys(ECM_INVENTORY_FIELD_MAP).filter((label) => !(_ecmNormHdr(label) in invMap));
    if (missing.length) {
      throw new Error(`Missing inventory header(s) in WMTR block starting at Excel row ${r + 1}: ${missing.join(", ")}`);
    }

    const authIdx = invMap[_ecmNormHdr("BIS/DDTC Authorization or Exception")];
    const descIdx = invMap[_ecmNormHdr("Description")];
    const modelIdx = invMap[_ecmNormHdr("Model/Catalog Number")];

    for (let k = firstItemIdx; k < nextWmtr; k++) {
      const itemRow = grid[k];
      if (k > firstItemIdx && _ecmIsBlockSectionStart(itemRow)) break;

      const descVal = _ecmClean(cell(k, descIdx));
      const modelVal = _ecmClean(cell(k, modelIdx));
      const authVal = cell(k, authIdx);

      if (!norm(descVal) && !norm(modelVal)) continue;
      if (norm(descVal).toLowerCase() === "description" ||
          norm(modelVal).toLowerCase() === "model/catalog number") continue;

      if (_ecmAuthIsControlled(authVal)) {
        const outRow = {
          "WMTR Number": wmtrNumber, "WMTR #": wmtr5, "FY/QTR": fyQtr,
          "Delivery Date": deliveryDate, "Request Title": requestTitle,
        };
        for (const [udqLabel, tmplLabel] of Object.entries(ECM_INVENTORY_FIELD_MAP)) {
          outRow[tmplLabel] = _ecmClean(cell(k, invMap[_ecmNormHdr(udqLabel)]));
        }
        out.push(outRow);
      }
    }
    r = nextWmtr;
  }
  return out;
}

/** Port of build_export_controlled_materials_result. Optional date window. */
function ecmBuildResult(grid, startIso, endIso) {
  const exportRows = ecmIterExportRows(grid, startIso, endIso);
  exportRows.sort((a, b) => _ecmWmtrSortKey(String(a["WMTR Number"] || "")) - _ecmWmtrSortKey(String(b["WMTR Number"] || "")));

  const wmtrMap = {};
  for (const row of exportRows) {
    const w = _ecmClean(row["WMTR Number"]);
    if (!w) continue;
    (wmtrMap[w] = wmtrMap[w] || []).push(row);
  }
  const wmtrRows = Object.entries(wmtrMap)
    .sort((a, b) => _ecmWmtrSortKey(a[0]) - _ecmWmtrSortKey(b[0]))
    .map(([w, items]) => [w, items.length]);

  return {
    export_rows: exportRows,
    wmtr_rows: wmtrRows,
    wmtrs: wmtrRows.map((r) => r[0]),
    wmtr_total: wmtrRows.length,
    item_total: exportRows.length,
    wmtr_map: wmtrMap,
  };
}

/* ---------------- workbook writer (template rewrite) --------------------- */

function _ecmXmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _ecmColLetter(idx1) { // 1-based -> letters
  let s = "", n = idx1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function ecmWriteWorkbook(result) {
  const bin = atob(ECM_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  // Inject a USD-currency cell style and learn its index for the Value column.
  let styles = await zip.file("xl/styles.xml").async("string");
  const cur = _ecmEnsureCurrencyStyle(styles);
  zip.file("xl/styles.xml", cur.xml);
  const CURRENCY_XF = cur.xfIndex;

  const SHEET = "xl/worksheets/sheet1.xml";
  let xml = await zip.file(SHEET).async("string");

  const headerM = xml.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
  const header = headerM ? headerM[0] : "";

  let body = "";
  result.export_rows.forEach((row, i) => {
    const r = i + 2;
    let cells = "";
    ECM_TEMPLATE_HEADERS.forEach((h, ci) => {
      const ref = _ecmColLetter(ci + 1) + r;
      const v = _ecmClean(row[h]);
      if (v === "") return; // skip blank cells (matches template leaving blanks)

      // Quantity -> plain number; Value(USD) -> number with currency format.
      if (h === "Quantity") {
        const n = _ecmNum(v);
        if (n !== null) { cells += `<c r="${ref}"><v>${n}</v></c>`; return; }
      } else if (h === "Value(USD)") {
        const n = _ecmNum(v);
        if (n !== null) { cells += `<c r="${ref}" s="${CURRENCY_XF}"><v>${n}</v></c>`; return; }
      }

      const t = _ecmXmlEsc(v).replace(/\r?\n/g, "&#10;");
      cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`;
    });
    body += `<row r="${r}" spans="1:${ECM_TEMPLATE_HEADERS.length}">${cells}</row>`;
  });

  xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${header}${body}</sheetData>`);
  const lastRow = 1 + result.export_rows.length;
  xml = xml.replace(/<dimension ref="A1:[A-Z]+\d+"\/>/, `<dimension ref="A1:L${lastRow}"/>`);

  zip.file(SHEET, xml);
  return await zip.generateAsync({ type: "base64" });
}

/** "YYYYMMDD_HHMMSS" — matches the desktop ECM stamp (compact, no dashes). */
function ecmStamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* =========================================================================
   Workspace UI
   ========================================================================= */

const EcmUi = { result: null };

function renderEcmWorkspace(container) {
  EcmUi.result = null;

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear - 3; y <= thisYear + 1; y++) years.push(y);
  const yearOpts = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  const periodOpts = REQATT_PERIODS.map((p) => `<option value="${p}">${esc(p)}</option>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Export-Controlled Materials</h2><span class="count" id="ecmBadge">Metrics UDQ</span></header>
      <div class="body">
        <div class="note">
          Scans each WMTR's Inventory List and lists every line item whose
          <strong>BIS/DDTC Authorization or Exception</strong> is populated with something other than blank,
          <span class="mono">N/A</span>, or <span class="mono">NLR</span> — i.e. items that are export-controlled.
          WMTRs are filtered by Delivery Date for the selected fiscal period; choose <strong>Show All</strong> to
          scan every WMTR in the system regardless of date. The generated workbook matches the desktop template
          (12 columns, one row per controlled line item).
        </div>

        <div class="pmr-quick">
          <label class="pmr-qlabel">Quick window</label>
          <div class="btnrow"><button class="btn ghost" id="ecmAllTime">All Time</button></div>
          <div class="hint">"All Time" scans every WMTR in the UDQ, ignoring the fiscal period.</div>
        </div>

        <div class="pmr-window">
          <div class="field">
            <label for="ecmFy">Fiscal year</label>
            <select id="ecmFy">${yearOpts}</select>
          </div>
          <div class="field">
            <label for="ecmPeriod">Period</label>
            <select id="ecmPeriod">${periodOpts}</select>
          </div>
          <div class="field pmr-runcell">
            <button class="btn primary" id="ecmRun">Run</button>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="ecmGen" disabled>Generate list (.xlsx)</button>
          <button class="btn ghost" id="ecmCopy" disabled>Copy</button>
          <span class="statusline" id="ecmStatus">Scanning…</span>
        </div>

        <div id="ecmSummary" class="statusline"></div>
        <div class="scrollwrap" id="ecmTableWrap" style="display:none; max-height:480px; margin-top:10px;">
          <table class="data" id="ecmTable">
            <thead><tr>${ECM_TEMPLATE_HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`);
  container.appendChild(panel);

  panel.querySelector("#ecmFy").value = String(thisYear);
  panel.querySelector("#ecmPeriod").value = reqattCurrentQtrLabel();

  panel.querySelector("#ecmRun").addEventListener("click", runEcmScan);
  panel.querySelector("#ecmAllTime").addEventListener("click", () => {
    panel.querySelector("#ecmPeriod").value = "Show All";
    runEcmScan();
  });
  panel.querySelector("#ecmGen").addEventListener("click", generateEcm);
  panel.querySelector("#ecmCopy").addEventListener("click", copyEcm);

  runEcmScan();
}

function runEcmScan() {
  const status = document.getElementById("ecmStatus");
  const summary = document.getElementById("ecmSummary");
  status.classList.remove("err");

  const fy = Number(document.getElementById("ecmFy").value);
  const period = document.getElementById("ecmPeriod").value;
  const win = reqattPeriodDates(fy, period);          // [start,end] or null (Show All)
  const start = win ? win[0] : null;
  const end = win ? win[1] : null;
  const windowText = win ? `${start} to ${end}` : "All WMTRs (no date filter)";

  try {
    const result = ecmBuildResult(AppState.grid, start, end);
    EcmUi.result = result;

    summary.textContent =
      `${windowText} · WMTRs containing controlled items: ${result.wmtr_total} · ` +
      `Controlled line items: ${result.item_total}`;
    status.textContent = result.item_total
      ? "Ready to generate." : "No export-controlled items in this selection.";

    document.getElementById("ecmGen").disabled = result.item_total === 0;
    document.getElementById("ecmCopy").disabled = result.item_total === 0;
    renderEcmTable(result);
  } catch (e) {
    console.error(e);
    EcmUi.result = null;
    document.getElementById("ecmGen").disabled = true;
    document.getElementById("ecmCopy").disabled = true;
    document.getElementById("ecmTableWrap").style.display = "none";
    summary.textContent = "";
    status.textContent = `Export-Controlled Materials error: ${e.message}`;
    status.classList.add("err");
  }
}

function _ecmCellDisplay(h, v) {
  if (h === "Quantity") return _ecmQtyDisplay(v);
  if (h === "Value(USD)") return _ecmMoneyDisplay(v);
  return _ecmClean(v);
}

function renderEcmTable(result) {
  const wrap = document.getElementById("ecmTableWrap");
  const tbody = wrap.querySelector("tbody");
  if (!result.export_rows.length) {
    tbody.innerHTML = `<tr><td colspan="${ECM_TEMPLATE_HEADERS.length}" style="color:var(--muted)">No export-controlled items.</td></tr>`;
  } else {
    tbody.innerHTML = result.export_rows.map((row) =>
      `<tr>${ECM_TEMPLATE_HEADERS.map((h) => `<td>${esc(_ecmCellDisplay(h, row[h]))}</td>`).join("")}</tr>`).join("");
  }
  wrap.style.display = "";
}

async function generateEcm() {
  const status = document.getElementById("ecmStatus");
  status.classList.remove("err");
  if (!EcmUi.result || !EcmUi.result.item_total) return;
  status.textContent = "Generating…";
  try {
    const b64 = await ecmWriteWorkbook(EcmUi.result);
    const fname = `Export_Controlled_Materials_${ecmStamp()}.xlsx`;
    pmrDownloadXlsxB64(b64, fname);
    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the workbook: ${e.message}`;
    status.classList.add("err");
  }
}

function copyEcm() {
  const r = EcmUi.result;
  if (!r) return;
  // Paste-friendly: trim Quantity, and emit Value as a plain number (no $) so it
  // pastes into a spreadsheet as a number rather than text.
  const cell = (h, v) => {
    if (h === "Quantity") return _ecmQtyDisplay(v);
    if (h === "Value(USD)") { const n = _ecmNum(v); return n === null ? _ecmClean(v) : String(n); }
    return _ecmClean(v);
  };
  const lines = [ECM_TEMPLATE_HEADERS.join("\t")];
  for (const row of r.export_rows) lines.push(ECM_TEMPLATE_HEADERS.map((h) => cell(h, row[h])).join("\t"));
  const text = lines.join("\n");
  const status = document.getElementById("ecmStatus");
  const done = () => { status.textContent = "Copied to clipboard."; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ecmIterExportRows, ecmBuildResult, _ecmAuthIsControlled, _ecmFyQtr,
    _ecmExtract5, _ecmCoerceDate,
  };
}
