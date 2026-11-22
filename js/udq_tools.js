/* =========================================================================
   ATLAS Utility Web — udq_tools.js
   Export parsed inventory to CSV — dumps the line items the reader produced,
   for ad-hoc analysis in a spreadsheet — plus the row of action links under
   the load status line.
   ========================================================================= */

/* =========================================================================
   Inventory → CSV  (pure, testable)
   ========================================================================= */

/** Build a CSV string from the parsed line items on a state object.
 *  Returns { csv, filename, count } or null when there are no items. */
function atlasInventoryToCsv(state) {
  if (!state || !state.data || !Array.isArray(state.data.items) || !state.data.items.length) return null;
  const meta = state.data.meta || {};
  const wmtr5 = meta.wmtr_last5 || (typeof wmtrLast5 === "function" ? wmtrLast5(meta.wmtr) : "") || "";
  const isProp = state.udqType === "property";

  // [header, accessor] — accessor reads a field off an item.
  const srfCols = [
    ["Line", (it) => it.line], ["Serial", (it) => it.serial], ["Units", (it) => it.units],
    ["UOM", (it) => it.uom], ["Description", (it) => it.desc], ["Model/Catalog", (it) => it.model],
    ["Schedule B/HTS", (it) => it.hts], ["ECCN/USML", (it) => it.eccn],
    ["BIS/DDTC Auth", (it) => it.auth], ["COO", (it) => it.coo],
    ["Unit Value (USD)", (it) => it.unit_value], ["Total Value (USD)", (it) => it.total_value],
    ["Weight (lbs)", (it) => it.weight_lbs], ["Weight (kg)", (it) => it.weight_kg],
    ["UN Code", (it) => it.un_code], ["Hazard Class", (it) => it.hazmat_class],
    ["Temp Control", (it) => it.temp_control], ["Shelf Life", (it) => it.shelf_life],
    ["Purchase Order", (it) => it.purchase_order], ["Vendor", (it) => it.vendor],
    ["Manufacturer", (it) => it.manufacturer], ["Ship Group", (it) => it.ship_group],
  ];
  const propCols = [
    ["Item #", (it) => it.item_no], ["Serial", (it) => it.serial],
    ["Description", (it) => it.desc], ["Model/Catalog", (it) => it.model],
    ["Manufacturer", (it) => it.mfr], ["UOM", (it) => it.uom],
    ["Quantity", (it) => it.qty], ["Unit Value (USD)", (it) => it.unit_value],
  ];
  const cols = isProp ? propCols : srfCols;
  const header = ["WMTR"].concat(cols.map((c) => c[0]));

  const escCsv = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(escCsv).join(",")];
  for (const it of state.data.items) {
    const row = [wmtr5].concat(cols.map((c) => c[1](it)));
    lines.push(row.map(escCsv).join(","));
  }
  const stamp = (typeof fileStamp === "function") ? fileStamp() : Date.now();
  return {
    csv: lines.join("\r\n"),
    filename: `ATLAS_Inventory_${wmtr5 || (isProp ? "property" : "srf")}_${stamp}.csv`,
    count: state.data.items.length,
  };
}

/** Download the parsed inventory as CSV. */
function atlasExportInventoryCsv() {
  const out = atlasInventoryToCsv(typeof AppState !== "undefined" ? AppState : null);
  if (!out) { alert("No parsed inventory to export. Load an SRF or Property UDQ first."); return; }
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(out.csv);
  a.download = out.filename;
  a.dataset.auditSkip = "1";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}

/* =========================================================================
   Action chips under the load status line
   ========================================================================= */

/** Render the Export-CSV chip into #udqActions based on current state.
 *  Export CSV shows only when there are parsed line items. Safe to call
 *  repeatedly. */
function renderUdqActions() {
  let host = document.getElementById("udqActions");
  if (!host) {
    const status = document.getElementById("loadStatus");
    if (!status || !status.parentNode) return;
    host = document.createElement("div");
    host.id = "udqActions";
    host.className = "udq-actions";
    status.parentNode.insertBefore(host, status.nextSibling);
  }
  const hasItems = !!(typeof AppState !== "undefined" && AppState.data && Array.isArray(AppState.data.items) && AppState.data.items.length);

  host.innerHTML = "";
  if (hasItems) {
    const csv = el(`<button class="linkbtn" type="button" id="udqCsvBtn">Export inventory (CSV)</button>`);
    csv.addEventListener("click", atlasExportInventoryCsv);
    host.appendChild(csv);
  }
  // Manual parent items (SRF only) — lets the user override the UDQ's parent
  // "P" rows for shipping documentation (e.g. after Compliance Review locks it).
  if (typeof mpRenderActionChip === "function") mpRenderActionChip(host);
}

/* ---------- Node test support ---------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { atlasInventoryToCsv };
}
