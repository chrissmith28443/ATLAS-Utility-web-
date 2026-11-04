/* =========================================================================
   ATLAS Utility Web — tools/deltek.js
   Deltek PO Lines export: a Property (PR) request's Inventory List as an
   .xlsx the purchasing team imports into Deltek CostPoint
   (Manage Purchase Orders → Lines).

   One output row per inventory item (row 2 on). Only five CostPoint columns
   are filled — CostPoint generates the rest or the buyer enters them:
     Item            = DELTEK_DEFAULT_ITEM (constants.js)
     U/M             = Unit Of Measure Ordered, else Unit Of Measure Requested,
                       through DELTEK_UM_MAP (unmapped -> upper-cased, flagged)
     Quantity        = Quantity Ordered, else Quantity Requested (number)
     Gross Unit Cost = Value(USD) — a unit price (number)
     Notes           = Description (full text, trimmed)
   Rows with no Description are skipped; zero-value rows are kept.

   Reads AppState.grid by header name (udq.js helpers), so a dropped PR export
   and a PR fetched from ATLAS (json_udq.js atlasPropertyRecordToGrid — JSON
   fields description, qtyOrdered, qtyRequested, unitOfMeasureOrderedText,
   unitOfMeasureText, valueUsd) read the same way.

   Output: the embedded CostPoint template (deltek_template.js — CostPoint's
   own line-grid export, header row only) edited at the XML level with JSZip,
   like the CoreIMS / IPC / PL tools. Row 1 stays exactly as CostPoint wrote
   it; target columns are found by reading that header row.
   ========================================================================= */

/* UDQ inventory headers to try, first present wins. */
const DELTEK_SOURCES = {
  desc:   ["Description"],
  qtyOrd: ["Quantity Ordered"],
  qtyReq: ["Quantity Requested"],
  umOrd:  ["Unit Of Measure Ordered"],
  umReq:  ["Unit Of Measure Requested"],
  value:  ["Value(USD)", "Value (USD)"],
};
/* Sources that must exist for the export (the "Ordered" pair may be absent). */
const DELTEK_REQUIRED = ["desc", "qtyReq", "umReq", "value"];

/* CostPoint's U/M code is at most 3 characters (PO_LN.PO_LN_UM_CD, Character 3
   in the Import Purchase Orders preprocessor's PO Line record format). */
const DELTEK_UM_MAX = 3;

/* CostPoint template headers written to. */
const DELTEK_COLS = { item: "Item", um: "U/M", qty: "Quantity", cost: "Gross Unit Cost", notes: "Notes" };

/** Unit price / quantity text -> number, or null when blank. */
function _deltekNum(v) {
  const s = norm(v);
  if (!s) return null;
  return toFloat(s);
}

function deltekBuildModel(grid) {
  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);
  const invMap = buildHeaderMap(grid, inventoryHeaderRow(grid));
  const startRow = inventoryStartRow(grid);
  const endRow = inventoryEndRow(grid);
  const wmtr = shipValue(grid, shipMap, "WMTR Number");

  const cols = {};
  for (const [key, names] of Object.entries(DELTEK_SOURCES)) {
    for (const name of names) {
      const c = invMap[normWs(name)];
      if (c) { cols[key] = c; break; }
    }
  }
  const missing = DELTEK_REQUIRED.filter((k) => !cols[k]).map((k) => DELTEK_SOURCES[k][0]);

  const lines = [];
  const fell = { qty: 0, um: 0 };
  let blankQty = 0;
  const unmapped = new Set();
  const tooLong = new Set();
  const asEa = {};   // ATLAS unit -> lines sent as EA
  if (!missing.length) {
    const cell = (r, key) => (cols[key] ? gridCell(grid, r, cols[key]) : "");
    for (let r = startRow; r <= endRow; r++) {
      const notes = String(cell(r, "desc")).trim();
      if (!notes) continue;

      let qty = _deltekNum(cell(r, "qtyOrd"));
      if (qty === null) { qty = _deltekNum(cell(r, "qtyReq")); fell.qty++; }
      if (qty === null) blankQty++;

      let umRaw = String(cell(r, "umOrd")).trim();
      if (!umRaw) { umRaw = String(cell(r, "umReq")).trim(); fell.um++; }
      const umKey = umRaw.toUpperCase();
      let um = "";
      if (umKey) {
        if (Object.prototype.hasOwnProperty.call(DELTEK_UM_MAP, umKey)) um = DELTEK_UM_MAP[umKey];
        else if (DELTEK_UM_AS_EA.indexOf(umKey) !== -1) { um = "EA"; asEa[umRaw] = (asEa[umRaw] || 0) + 1; }
        else { um = umKey; unmapped.add(umKey); }
        if (um.length > DELTEK_UM_MAX) tooLong.add(um);
      }

      const cost = _deltekNum(cell(r, "value"));
      const ext = qty !== null && cost !== null ? roundHalfUp(qty * cost, 2) : null;
      lines.push({ row: r, item: DELTEK_DEFAULT_ITEM, umRaw, um, qty, cost, ext, notes });
    }
  }
  const total = roundHalfUp(lines.reduce((a, l) => a + (l.ext || 0), 0), 2);

  return {
    wmtr, wmtr_last5: wmtrLast5(wmtr), cols, missing, lines, total,
    fell, blankQty, unmapped: Array.from(unmapped).sort(), tooLong: Array.from(tooLong).sort(), asEa,
  };
}

/** Plain-English notices for the panel (non-blocking). */
function deltekNotices(model) {
  const out = [];
  const n = (k) => `${k} line${k === 1 ? "" : "s"}`;
  if (model.fell.qty) out.push(`Qty Ordered blank on ${n(model.fell.qty)} — used Qty Requested.`);
  if (model.fell.um) out.push(`U/M Ordered blank on ${n(model.fell.um)} — used U/M Requested.`);
  if (model.blankQty) out.push(`No quantity at all on ${n(model.blankQty)} — CostPoint will reject ${model.blankQty === 1 ? "it" : "them"}; fill the quantity in ATLAS first.`);
  const ea = Object.keys(model.asEa).sort();
  if (ea.length) out.push(`No CostPoint U/M for ${ea.map((u) => `${u} (${n(model.asEa[u])})`).join(", ")} — sent as EA.`);
  if (model.tooLong.length) out.push(`U/M too long for CostPoint (${DELTEK_UM_MAX} characters max): ${model.tooLong.join(", ")} — CostPoint will reject these lines until they're mapped to a CostPoint code.`);
  const shortUnmapped = model.unmapped.filter((u) => model.tooLong.indexOf(u) === -1);
  if (shortUnmapped.length) out.push(`U/M not mapped: ${shortUnmapped.join(", ")} — exported as shown; check they're valid CostPoint U/M codes.`);
  return out;
}

/* ---- Workbook writer: edit the template's sheet XML with JSZip ---- */

function _deltekXmlEsc(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _deltekXmlUnesc(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function _deltekColIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** {normalized header -> column letters} from row 1 (inline or shared strings; first wins). */
function _deltekHeaderLetters(sheetXml, shared) {
  const map = {};
  const rowM = sheetXml.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/);
  if (!rowM) return map;
  const cRe = /<c r="([A-Z]+)1"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cRe.exec(rowM[1])) !== null) {
    const body = m[3] || "";
    let text = "";
    if (/t="s"/.test(m[2])) {
      const v = body.match(/<v>(\d+)<\/v>/);
      text = v ? (shared[parseInt(v[1], 10)] || "") : "";
    } else {
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(body)) !== null) text += _deltekXmlUnesc(t[1]);
    }
    const key = normWs(text);
    if (key && map[key] === undefined) map[key] = m[1];
  }
  return map;
}

async function deltekWriteWorkbook(model) {
  if (model.missing.length) throw new Error("UDQ is missing inventory column(s): " + model.missing.join(", "));

  const bin = atob(DELTEK_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const SHEET_PATH = "xl/worksheets/sheet1.xml";
  let sheetXml = await zip.file(SHEET_PATH).async("string");
  const ssFile = zip.file("xl/sharedStrings.xml");
  const shared = [];
  if (ssFile) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    const ssXml = await ssFile.async("string");
    let m;
    while ((m = siRe.exec(ssXml)) !== null) {
      let parts = "";
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1])) !== null) parts += t[1];
      shared.push(_deltekXmlUnesc(parts));
    }
  }

  const letters = _deltekHeaderLetters(sheetXml, shared);
  const missingTmpl = Object.values(DELTEK_COLS).filter((h) => letters[normWs(h)] === undefined);
  if (missingTmpl.length) throw new Error("Missing CostPoint template header(s): " + missingTmpl.join(", "));
  const dimM = sheetXml.match(/<dimension ref="A1:([A-Z]+)\d+"\/>/);
  const lastCol = dimM ? dimM[1] : "DQ";

  let rowsXml = "";
  model.lines.forEach((l, i) => {
    const r = i + 2;
    const cells = [
      [DELTEK_COLS.item, l.item, "s"], [DELTEK_COLS.um, l.um, "s"], [DELTEK_COLS.qty, l.qty, "n"],
      [DELTEK_COLS.cost, l.cost, "n"], [DELTEK_COLS.notes, l.notes, "s"],
    ].filter(([, v]) => v !== "" && v !== null && v !== undefined)
     .map(([h, v, kind]) => ({ col: letters[normWs(h)], v, kind }))
     .sort((a, b) => _deltekColIndex(a.col) - _deltekColIndex(b.col));
    let cx = "";
    for (const c of cells) {
      if (c.kind === "n") cx += `<c r="${c.col}${r}"><v>${c.v}</v></c>`;
      else cx += `<c r="${c.col}${r}" t="inlineStr"><is><t xml:space="preserve">${_deltekXmlEsc(c.v).replace(/\r?\n/g, "&#10;")}</t></is></c>`;
    }
    rowsXml += `<row r="${r}">${cx}</row>`;
  });

  sheetXml = sheetXml.replace("</sheetData>", rowsXml + "</sheetData>")
    .replace(/<dimension ref="A1:[A-Z]+\d+"\/>/, `<dimension ref="A1:${lastCol}${1 + model.lines.length}"/>`);
  zip.file(SHEET_PATH, sheetXml);

  // No stale calcChain (Excel offers a repair otherwise) — same as DD1149 / PL.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = await zip.file("[Content_Types].xml").async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    const relsPath = "xl/_rels/workbook.xml.rels";
    const rels = await zip.file(relsPath).async("string");
    zip.file(relsPath, rels.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
  }
  return await zip.generateAsync({ type: "base64" });
}

/* ---- Panel ---- */

function deltekModelForState() {
  return deltekBuildModel(AppState.grid || []);
}

function renderDeltekWorkspace(container) {
  const m = (AppState.data && AppState.data.meta) || {};
  const panel = el(`
    <div class="panel">
      <header><h2>Deltek PO Lines</h2><span class="count">${esc(m.wmtr || "Property UDQ")}</span></header>
      <div class="body">
        <div class="note">
          Builds the CostPoint <b>Manage Purchase Orders → Lines</b> import from this request's Inventory List:
          one line per item with Item, U/M, Quantity, Gross Unit Cost and Notes (the description). Every other
          column is left blank for CostPoint or the buyer.
        </div>
        <div class="btnrow">
          <button class="btn primary" id="dkGen">Generate Deltek Export</button>
          <span class="statusline" id="dkStatus"></span>
        </div>
        <div id="dkSummary" class="statusline"></div>
        <div id="dkNotices"></div>
        <div class="scrollwrap" style="margin-top:10px"><table class="data" id="dkTable"></table></div>
      </div>
    </div>`);
  container.appendChild(panel);
  panel.querySelector("#dkGen").addEventListener("click", generateDeltek);
  updateDeltekPreview();
}

function updateDeltekPreview() {
  const model = deltekModelForState();
  const summary = document.getElementById("dkSummary");
  const gen = document.getElementById("dkGen");
  if (gen) gen.disabled = !!model.missing.length || !model.lines.length;
  if (summary) {
    summary.classList.toggle("err", !!model.missing.length);
    summary.textContent = model.missing.length
      ? `Cannot generate — the UDQ's Inventory List has no ${model.missing.join(", ")} column.`
      : `${model.lines.length} line${model.lines.length === 1 ? "" : "s"} · extended total ${fmtMoney(model.total)}`;
  }
  const notes = document.getElementById("dkNotices");
  if (notes) {
    notes.innerHTML = deltekNotices(model).map((t) => `<div class="statusline warn">${esc(t)}</div>`).join("");
  }
  const tbl = document.getElementById("dkTable");
  if (tbl) {
    const num = (v, d) => (v === null ? "" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) }));
    tbl.innerHTML = `<thead><tr><th>Line #</th><th>Notes</th><th>U/M</th><th>Qty</th><th>Unit Cost</th><th>Extended</th></tr></thead><tbody>` +
      model.lines.map((l, i) => {
        const short = l.notes.length > 80 ? l.notes.slice(0, 80) + "…" : l.notes;
        return `<tr><td class="num">${i + 1}</td><td title="${esc(l.notes)}">${esc(short)}</td>` +
          `<td class="mono">${esc(l.um)}</td><td class="num">${num(l.qty, 0)}</td>` +
          `<td class="num">${num(l.cost, 2)}</td><td class="num">${num(l.ext, 2)}</td></tr>`;
      }).join("") + `</tbody>`;
  }
}

async function generateDeltek() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("deltek", generateDeltek)) return;
  const status = document.getElementById("dkStatus");
  status.classList.remove("err");
  status.textContent = "Generating…";
  try {
    const model = deltekModelForState();
    const outB64 = await deltekWriteWorkbook(model);
    const fname = (model.wmtr_last5 ? `Deltek_PO_${model.wmtr_last5}_${fileStamp()}` : `Deltek_PO_${fileStamp()}`) + ".xlsx";
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    status.textContent = `✅ Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't generate the Deltek export: ${e.message}`;
    status.classList.add("err");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { deltekBuildModel, deltekNotices, deltekWriteWorkbook };
}
