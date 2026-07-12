/* =========================================================================
   ATLAS Utility Web — udq_tools.js
   Two UDQ-insight utilities:
     #5 Parse diagnostics — a modal that shows, for the loaded file, which
        layout signals / sections / inventory columns were found vs missing.
        Most useful when a file detects as "unknown" or fails to parse.
     #6 Export parsed inventory to CSV — dumps the line items the reader
        produced, for ad-hoc analysis in a spreadsheet.

   The heavy "what does this grid contain" logic lives in udq.js (udqDiagnose)
   next to the layout knowledge; this file is the browser glue + the CSV shape.
   ========================================================================= */

/* =========================================================================
   #6  Inventory → CSV  (pure, testable)
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
   #5  Parse diagnostics modal
   ========================================================================= */

const DIAG_STYLE = `
  .dg-overlay{position:fixed;inset:0;background:rgba(12,18,28,.55);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:5vh 16px;overflow:auto;}
  .dg-dialog{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:12px;max-width:680px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);}
  .dg-dialog header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);}
  .dg-dialog header h2{margin:0;font:600 1.05rem var(--disp);}
  .dg-dialog header .x{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:var(--steel);}
  .dg-body{padding:14px 18px;max-height:70vh;overflow:auto;}
  .dg-type{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
  .dg-type .tag{font:600 .8rem var(--mono);background:var(--accent);color:#fff;border-radius:6px;padding:2px 8px;text-transform:uppercase;}
  .dg-type.unknown .tag{background:#b32424;}
  .dg-err{background:rgba(218,54,51,.10);border:1px solid rgba(218,54,51,.5);border-radius:8px;padding:9px 11px;margin:8px 0;font-size:.9rem;}
  .dg-group{margin:14px 0 4px;font:600 .78rem/1 var(--disp);letter-spacing:.04em;text-transform:uppercase;color:var(--steel);}
  .dg-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
  .dg-list li{display:flex;gap:9px;align-items:flex-start;font-size:.9rem;}
  .dg-list .mk{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff;margin-top:2px;}
  .dg-list .mk.y{background:#2ea043;}
  .dg-list .mk.n{background:#b32424;}
  .dg-list .mk.o{background:#8a94a0;}
  .dg-list .lbl{flex:1 1 auto;}
  .dg-list .det{color:var(--steel);font-size:.86em;}
  .dg-chips{display:flex;flex-wrap:wrap;gap:6px;}
  .dg-chip{font-size:.8rem;border:1px solid var(--line);border-radius:999px;padding:2px 9px;display:inline-flex;align-items:center;gap:5px;}
  .dg-chip.y{border-color:rgba(46,160,67,.5);} .dg-chip.n{border-color:rgba(179,36,36,.5);color:#b32424;}
  .dg-foot{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid var(--line);}
  .dg-foot .spacer{margin-left:auto;}
  .dg-note{color:var(--steel);font-size:.82rem;}
`;

function _diagMark(state) { // state: true|false|"opt"
  if (state === "opt") return `<span class="mk o" aria-hidden="true">○</span>`;
  return state ? `<span class="mk y" aria-hidden="true">\u2713</span>` : `<span class="mk n" aria-hidden="true">\u2715</span>`;
}

function closeDiagnostics() {
  const o = document.getElementById("dgOverlay");
  if (o) o.remove();
  document.removeEventListener("keydown", _dgEsc);
}
function _dgEsc(e) { if (e.key === "Escape") closeDiagnostics(); }

function openDiagnostics() {
  closeDiagnostics();
  const grid = (typeof AppState !== "undefined") ? AppState.grid : null;
  if (!grid) { alert("Load a file first — there's nothing to diagnose yet."); return; }
  const rep = udqDiagnose(grid);

  const signalsHtml = rep.signals.map((s) => `
    <li>${_diagMark(s.found)}<span class="lbl">${esc(s.label)}${s.detail ? ` <span class="det">— ${esc(s.detail)}</span>` : ""}</span></li>`).join("");

  const sectionsHtml = `<div class="dg-chips">` + rep.sections.map((s) =>
    `<span class="dg-chip ${s.found ? "y" : "n"}">${s.found ? "\u2713" : "\u2715"} ${esc(s.title)}${s.found ? ` (row ${s.row})` : ""}</span>`).join("") + `</div>`;

  const keyH = rep.shipment.keyHeaders.map((h) =>
    `<span class="dg-chip ${h.found ? "y" : "n"}">${h.found ? "\u2713" : "\u2715"} ${esc(h.name)}</span>`).join("");
  const partyH = rep.shipment.partyBlocks.map((p) =>
    `<span class="dg-chip ${p.found ? "y" : "n"}">${p.found ? "\u2713" : "\u2715"} ${esc(p.name)}</span>`).join("");

  let invHtml = `<div class="dg-note">No inventory header row was located.</div>`;
  if (rep.inventory) {
    const iv = rep.inventory;
    const req = iv.columns.filter((c) => c.required);
    const opt = iv.columns.filter((c) => !c.required);
    const colLi = (c) => `<li>${_diagMark(c.required ? c.found : (c.found ? true : "opt"))}<span class="lbl">${esc(c.label)}${
      c.matched && c.matched !== c.label ? ` <span class="det">— matched "${esc(c.matched)}"</span>` : ""}${
      c.found && c.col ? ` <span class="det">(col ${c.col})</span>` : (c.required ? ` <span class="det">— missing</span>` : "")}</span></li>`;
    invHtml = `
      <div class="dg-note">Layout: <strong>${esc(iv.layout.toUpperCase())}</strong> · header row ${iv.headerRow || "—"} · ${iv.columnCount} column${iv.columnCount === 1 ? "" : "s"} read${
        iv.missingRequired.length ? ` · <span style="color:#b32424;font-weight:600;">missing required: ${esc(iv.missingRequired.join(", "))}</span>` : ""}</div>
      <div class="dg-group">Required columns</div>
      <ul class="dg-list">${req.map(colLi).join("")}</ul>
      <div class="dg-group">Optional columns</div>
      <ul class="dg-list">${opt.map(colLi).join("")}</ul>`;
  }

  const typeLabel = (rep.detectedType || "unknown").toUpperCase();
  const overlay = el(`
    <div class="dg-overlay" id="dgOverlay">
      <div class="dg-dialog" role="dialog" aria-modal="true" aria-label="UDQ parse diagnostics">
        <style>${DIAG_STYLE}</style>
        <header><h2>UDQ parse diagnostics</h2><button class="x" id="dgX" title="Close" aria-label="Close">×</button></header>
        <div class="dg-body">
          <div class="dg-type ${rep.detectedType === "unknown" ? "unknown" : ""}">
            <span class="dg-note">Detected layout:</span><span class="tag">${esc(typeLabel)}</span>
            <span class="dg-note">${esc((AppState && AppState.fileName) || "")}</span>
          </div>
          ${rep.parseError ? `<div class="dg-err"><strong>Parse error:</strong> ${esc(rep.parseError)}</div>` : ""}
          <div class="dg-group">Type-detection signals</div>
          <ul class="dg-list">${signalsHtml}</ul>
          <div class="dg-group">Section titles</div>
          ${sectionsHtml}
          <div class="dg-group">Shipment header (row 1) — ${rep.shipment.headerCount} headers</div>
          <div class="dg-chips">${keyH}</div>
          <div class="dg-group">Party blocks</div>
          <div class="dg-chips">${partyH}</div>
          <div class="dg-group">Inventory columns</div>
          ${invHtml}
        </div>
        <div class="dg-foot">
          <span class="dg-note">Diagnostics are descriptive — they don't change how the file is read.</span>
          <span class="spacer"></span>
          <button class="btn primary" id="dgOk" type="button">Close</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeDiagnostics(); });
  overlay.querySelector("#dgX").addEventListener("click", closeDiagnostics);
  overlay.querySelector("#dgOk").addEventListener("click", closeDiagnostics);
  document.addEventListener("keydown", _dgEsc);
}

/* =========================================================================
   Action chips under the load status line
   ========================================================================= */

/** Render Diagnose / Export-CSV chips into #udqActions based on current state.
 *  Diagnose appears whenever a grid is loaded; Export CSV only when there are
 *  parsed line items. Safe to call repeatedly. */
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
  const hasGrid = !!(typeof AppState !== "undefined" && AppState.grid);
  const hasItems = !!(typeof AppState !== "undefined" && AppState.data && Array.isArray(AppState.data.items) && AppState.data.items.length);
  const hasRecents = (typeof recentsHasAny === "function") && recentsHasAny();
  if (!hasGrid && !hasRecents) { host.innerHTML = ""; return; }

  host.innerHTML = "";
  if (hasGrid) {
    const diag = el(`<button class="linkbtn" type="button" id="udqDiagBtn">Diagnose layout</button>`);
    diag.addEventListener("click", openDiagnostics);
    host.appendChild(diag);
  }
  // "Recent UDQs" — a discreet orange link sitting next to Diagnose layout (a
  // little spaced apart) that toggles the recents list, which is otherwise
  // collapsed so it stays out of the way.
  if (hasRecents) {
    const open = (typeof RecentUdqs !== "undefined") && RecentUdqs._open;
    const rb = el(`<button class="linkbtn udq-recents-link${open ? " active" : ""}" type="button" id="udqRecentsBtn" aria-expanded="${open ? "true" : "false"}">Recent UDQs</button>`);
    rb.addEventListener("click", () => { if (typeof recentsToggle === "function") recentsToggle(); });
    host.appendChild(rb);
  }
  if (hasItems) {
    host.appendChild(el(`<span class="udq-sep" aria-hidden="true">·</span>`));
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
