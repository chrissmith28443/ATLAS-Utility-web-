/* =========================================================================
   ATLAS Utility Web — tools/deltek.js
   Deltek PO export: a Property (PR) request as the .xlsx the purchasing team
   copies into Deltek CostPoint's Manage Purchase Orders — the PO header table
   (rows 1–2) and the Lines table (header row 4, one line per inventory item
   from row 5).

   PO header (row 2): Type, Buyer (picker), Order Date (date picker), PO Status
   (picker), Project (the request's Charge Code), Account, Organization
   (CONUS / OCONUS, must be chosen), Ship ID, Taxable Status.
   Each line: PO Line (1, 2, 3…), Status (picker, per line), Item, Description,
   U/M, Due / Desired / Order / Original Due Date (the picked date), Quantity,
   Gross Unit Cost, Ship ID, Ord Ref Type, Notes. Fixed values and picker
   choices live in constants.js (DELTEK_*).
     U/M             = Unit Of Measure Ordered, else Unit Of Measure Requested,
                       through DELTEK_UM_MAP / DELTEK_UM_AS_EA
     Quantity        = Quantity Ordered, else Quantity Requested (number)
     Gross Unit Cost = Value(USD) — a unit price (number)
     Notes           = Description (full text, trimmed)
   Rows with no Description are skipped; zero-value rows are kept.

   Reads AppState.grid by header name (udq.js helpers), so a dropped PR export
   and a PR fetched from ATLAS (json_udq.js atlasPropertyRecordToGrid — JSON
   fields ChargeCode, description, qtyOrdered, qtyRequested,
   unitOfMeasureOrderedText, unitOfMeasureText, valueUsd) read the same way.

   Output: the embedded template (deltek_template.js — CostPoint's PO header
   headers in row 1, Lines headers in row 4) edited at the XML level with
   JSZip, like the CoreIMS / IPC / PL tools. Target columns are found by
   reading those header rows.
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

/* Template layout: PO header headers in row 1 (values row 2); Lines headers in
   row 4 (lines from row 5). */
const DELTEK_HDR_ROW = 1;
const DELTEK_LINES_HDR_ROW = 4;
const DELTEK_DATE_STYLE = 2;   // template cellXfs index with a date format (m/d/yyyy)

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
  const chargeCode = shipValue(grid, shipMap, "Charge Code");

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
      // The PR Inventory List has no line-number column: lines number 1, 2, 3… in order.
      lines.push({ row: r, lineNo: lines.length + 1, item: DELTEK_DEFAULT_ITEM, umRaw, um, qty, cost, ext, notes });
    }
  }
  const total = roundHalfUp(lines.reduce((a, l) => a + (l.ext || 0), 0), 2);

  return {
    wmtr, wmtr_last5: wmtrLast5(wmtr), chargeCode, cols, missing, lines, total,
    fell, blankQty, unmapped: Array.from(unmapped).sort(), tooLong: Array.from(tooLong).sort(), asEa,
  };
}

/** Plain-English notices for the panel (non-blocking). */
function deltekNotices(model) {
  const out = [];
  const n = (k) => `${k} line${k === 1 ? "" : "s"}`;
  if (!model.chargeCode) out.push("No Charge Code on this request — the PO header's Project is left blank.");
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

/** The XML of template row `r`, or "". */
function _deltekRowXml(sheetXml, r) {
  const m = sheetXml.match(new RegExp(`<row r="${r}"[^>]*>[\\s\\S]*?<\\/row>`));
  return m ? m[0] : "";
}

/** {normalized header -> column letters} from template row `r` (inline or shared strings; first wins). */
function _deltekHeaderLetters(sheetXml, shared, r) {
  const map = {};
  const rowXml = _deltekRowXml(sheetXml, r);
  const cRe = new RegExp(`<c r="([A-Z]+)${r}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`, "g");
  let m;
  while ((m = cRe.exec(rowXml)) !== null) {
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

/** "YYYY-MM-DD" -> Excel date serial number. */
function _deltekDateSerial(iso) {
  const [y, mo, d] = String(iso).split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / 86400000 + 25569;
}

/** One sheet row from [[header, value, kind]] (kind "s" text, "n" number, "d" date). */
function _deltekRow(r, letters, fields, where) {
  const missing = fields.map(([h]) => h).filter((h) => letters[normWs(h)] === undefined);
  if (missing.length) throw new Error(`Missing CostPoint template header(s) in the ${where}: ` + missing.join(", "));
  const cells = fields
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([h, v, kind]) => ({ col: letters[normWs(h)], v, kind }))
    .sort((a, b) => _deltekColIndex(a.col) - _deltekColIndex(b.col));
  let cx = "";
  for (const c of cells) {
    const ref = c.col + r;
    if (c.kind === "n") cx += `<c r="${ref}"><v>${c.v}</v></c>`;
    else if (c.kind === "d") cx += `<c r="${ref}" s="${DELTEK_DATE_STYLE}"><v>${_deltekDateSerial(c.v)}</v></c>`;
    else cx += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${_deltekXmlEsc(c.v).replace(/\r?\n/g, "&#10;")}</t></is></c>`;
  }
  return `<row r="${r}">${cx}</row>`;
}

/* opts: { date "YYYY-MM-DD", buyer (code), poStatus, lineStatus(i) -> status, region "CONUS"|"OCONUS" } */
async function deltekWriteWorkbook(model, opts) {
  if (model.missing.length) throw new Error("UDQ is missing inventory column(s): " + model.missing.join(", "));
  if (!DELTEK_ORGS[opts.region]) throw new Error("Choose CONUS or OCONUS first.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date || "")) throw new Error("Pick a date first.");

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

  const hdrLetters = _deltekHeaderLetters(sheetXml, shared, DELTEK_HDR_ROW);
  const lnLetters = _deltekHeaderLetters(sheetXml, shared, DELTEK_LINES_HDR_ROW);
  const dimM = sheetXml.match(/<dimension ref="A1:([A-Z]+)\d+"\/>/);
  const lastCol = dimM ? dimM[1] : "DN";

  const hdrRow = _deltekRow(DELTEK_HDR_ROW + 1, hdrLetters, [
    ["Type", DELTEK_PO_TYPE, "s"],
    ["Buyer", opts.buyer, "s"],
    ["Order Date", opts.date, "d"],
    ["PO Status", opts.poStatus, "s"],
    ["Project", model.chargeCode, "s"],
    ["Account", DELTEK_ACCOUNT, "s"],
    ["Organization", DELTEK_ORGS[opts.region], "s"],
    ["Ship ID", DELTEK_SHIP_ID, "s"],
    ["Taxable Status", DELTEK_TAXABLE_STATUS, "s"],
  ], "PO header");

  let lineRows = "";
  model.lines.forEach((l, i) => {
    lineRows += _deltekRow(DELTEK_LINES_HDR_ROW + 1 + i, lnLetters, [
      ["PO Line", l.lineNo, "n"],
      ["Status", opts.lineStatus(i), "s"],
      ["Item", l.item, "s"],
      ["Description", DELTEK_LINE_DESCRIPTION, "s"],
      ["U/M", l.um, "s"],
      ["Due Date", opts.date, "d"],
      ["Desired Date", opts.date, "d"],
      ["Order Date", opts.date, "d"],
      ["Original Due Date", opts.date, "d"],
      ["Quantity", l.qty, "n"],
      ["Gross Unit Cost", l.cost, "n"],
      ["Ship ID", DELTEK_SHIP_ID, "s"],
      ["Ord Ref Type", DELTEK_ORD_REF_TYPE, "s"],
      ["Notes", l.notes, "s"],
    ], "Lines table");
  });

  // Rows in order: PO header labels (1), values (2), Lines labels (4), lines (5+).
  const sheetData = _deltekRowXml(sheetXml, DELTEK_HDR_ROW) + hdrRow +
    _deltekRowXml(sheetXml, DELTEK_LINES_HDR_ROW) + lineRows;
  sheetXml = sheetXml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${sheetData}</sheetData>`)
    .replace(/<dimension ref="A1:[A-Z]+\d+"\/>/, `<dimension ref="A1:${lastCol}${DELTEK_LINES_HDR_ROW + model.lines.length}"/>`);
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

/* Picker choices for the loaded request; reset when another request loads.
   perLine: line index -> status chosen in the table (else lineStatus). */
const DeltekUi = { key: null };
function deltekUiFor(model) {
  const key = `${AppState.fileName}|${model.wmtr}`;
  if (DeltekUi.key !== key) {
    Object.assign(DeltekUi, {
      key, date: todayISO(), buyer: DELTEK_BUYERS[0].code, poStatus: DELTEK_PO_STATUSES[0],
      lineStatus: DELTEK_LINE_STATUSES[0], perLine: {}, region: "",
    });
  }
  return DeltekUi;
}
function deltekOpts(ui) {
  return {
    date: ui.date, buyer: ui.buyer, poStatus: ui.poStatus, region: ui.region,
    lineStatus: (i) => ui.perLine[i] || ui.lineStatus,
  };
}

function deltekModelForState() {
  return deltekBuildModel(AppState.grid || []);
}

function renderDeltekWorkspace(container) {
  const m = (AppState.data && AppState.data.meta) || {};
  const ui = deltekUiFor(deltekModelForState());
  const opt = (list, cur) => list.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const panel = el(`
    <div class="panel">
      <header><h2>Deltek PO Lines</h2><span class="count">${esc(m.wmtr || "Property UDQ")}</span></header>
      <div class="body">
        <div class="note">
          Builds the CostPoint <b>Manage Purchase Orders</b> copy/paste sheet: the PO header in rows 1–2 and the
          Lines table from row 4, one line per inventory item.
        </div>
        <div class="formgrid" style="margin-top:12px">
          <div class="field">
            <label for="dkDate">Date</label>
            <input type="date" id="dkDate" value="${esc(ui.date)}">
            <div class="hint">Every line's Due, Desired, Order and Original Due Date, and the PO's Order Date.</div>
          </div>
          <div class="field">
            <label for="dkBuyer">Buyer Name</label>
            <select id="dkBuyer">${DELTEK_BUYERS.map((b) => `<option value="${esc(b.code)}" ${b.code === ui.buyer ? "selected" : ""}>${esc(b.name)} / ${esc(b.code)}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="dkPoStatus">PO Status</label>
            <select id="dkPoStatus">${opt(DELTEK_PO_STATUSES, ui.poStatus)}</select>
          </div>
          <div class="field">
            <label for="dkLineStatus">Line Status</label>
            <select id="dkLineStatus">${opt(DELTEK_LINE_STATUSES, ui.lineStatus)}</select>
            <div class="hint">Sets every line; change a single line in the table below.</div>
          </div>
          <div class="field span2">
            <label>Location</label>
            <div class="checkrow">
              ${Object.keys(DELTEK_ORGS).map((k) => `<label class="inline"><input type="radio" name="dkRegion" value="${k}" ${ui.region === k ? "checked" : ""}> ${k}</label>`).join("")}
            </div>
            <div class="hint" id="dkRegionHint"></div>
          </div>
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
  panel.querySelector("#dkDate").addEventListener("change", (e) => { ui.date = e.target.value; updateDeltekPreview(); });
  panel.querySelector("#dkBuyer").addEventListener("change", (e) => { ui.buyer = e.target.value; updateDeltekPreview(); });
  panel.querySelector("#dkPoStatus").addEventListener("change", (e) => { ui.poStatus = e.target.value; updateDeltekPreview(); });
  panel.querySelector("#dkLineStatus").addEventListener("change", (e) => { ui.lineStatus = e.target.value; ui.perLine = {}; updateDeltekPreview(); });
  panel.querySelectorAll('input[name="dkRegion"]').forEach((r) =>
    r.addEventListener("change", (e) => { ui.region = e.target.value; updateDeltekPreview(); }));
  panel.querySelector("#dkTable").addEventListener("change", (e) => {
    const i = e.target && e.target.getAttribute("data-line");
    if (i !== null) { ui.perLine[i] = e.target.value; }
  });
  panel.querySelector("#dkGen").addEventListener("click", generateDeltek);
  updateDeltekPreview();
}

function updateDeltekPreview() {
  const model = deltekModelForState();
  const ui = deltekUiFor(model);
  const summary = document.getElementById("dkSummary");
  const gen = document.getElementById("dkGen");
  const blocked = model.missing.length ? `Cannot generate — the UDQ's Inventory List has no ${model.missing.join(", ")} column.`
    : !ui.region ? "Choose CONUS or OCONUS to generate."
    : !ui.date ? "Pick a date to generate." : "";
  if (gen) gen.disabled = !!blocked || !model.lines.length;
  const hint = document.getElementById("dkRegionHint");
  if (hint) hint.textContent = ui.region ? `Organization ${DELTEK_ORGS[ui.region]}` : "Required — choose one.";
  if (summary) {
    summary.classList.toggle("err", !!blocked);
    const fmtD = (iso) => (iso ? iso.slice(5, 7) + "/" + iso.slice(8, 10) + "/" + iso.slice(0, 4) : "—");
    summary.textContent = (blocked ? blocked + "\n" : "") +
      `${model.lines.length} line${model.lines.length === 1 ? "" : "s"} · extended total ${fmtMoney(model.total)}\n` +
      `PO header: Buyer ${ui.buyer} · Order Date ${fmtD(ui.date)} · PO Status ${ui.poStatus} · ` +
      `Project ${model.chargeCode || "—"} · Organization ${ui.region ? DELTEK_ORGS[ui.region] + " (" + ui.region + ")" : "—"}`;
  }
  const notes = document.getElementById("dkNotices");
  if (notes) {
    notes.innerHTML = deltekNotices(model).map((t) => `<div class="statusline warn">${esc(t)}</div>`).join("");
  }
  const tbl = document.getElementById("dkTable");
  if (tbl) {
    const num = (v, d) => (v === null ? "" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) }));
    tbl.innerHTML = `<thead><tr><th>Line #</th><th>Status</th><th>Notes</th><th>U/M</th><th>Qty</th><th>Unit Cost</th><th>Extended</th></tr></thead><tbody>` +
      model.lines.map((l, i) => {
        const short = l.notes.length > 80 ? l.notes.slice(0, 80) + "…" : l.notes;
        const st = ui.perLine[i] || ui.lineStatus;
        return `<tr><td class="num">${l.lineNo}</td>` +
          `<td><select data-line="${i}">${DELTEK_LINE_STATUSES.map((s) => `<option ${s === st ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></td>` +
          `<td title="${esc(l.notes)}">${esc(short)}</td>` +
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
    const outB64 = await deltekWriteWorkbook(model, deltekOpts(deltekUiFor(model)));
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
