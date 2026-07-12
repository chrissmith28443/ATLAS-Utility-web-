/* =========================================================================
   ATLAS Utility Web — tools/dd1149.js
   DD1149 (Transfer of Property / Requisition & Shipping Document) generator
   for the Property Management group.

   FAITHFUL PORT of the desktop v4.4 tool:
     - services/top_service.py   (run_top_pipeline, _iter_top_items,
        _party_block_from_udq, _city_state_zip, _excel_date, _wmtr_last5,
        _prepare_continuation_sheets, _write_item_row)
     - ui/top_dialog.py          (field order, defaults, validation: requisition
        date required, signatory name/title required, optional dates validated)
     - templates/DD_FORM_1149_EXCEL_TEMPLATE.xlsx (embedded in dd1149_template.js)

   Output: a single .xlsx built entirely in the browser (no upload, no server)
   by editing the embedded template's worksheet XML with JSZip — the same
   approach as SLI / IPC / PL / TOP Documents. Reuses PL's shared helpers
   (_plGetRow, _plReplaceExact, _xmlEsc), which load first.

   Template cell map (desktop top_service):
     DD_FORM_1149 sheet:
       K5 page#(=1)  M5 total-sheets  O5 requisition date  Q5 WMTR
       K7 date required  Q7 priority   A9 ultimate-consignee block
       Q11 signatory name  A13 delivery block  K13 date signed
       Q13 signatory title  K15 mode of shipment  A19 WMTR
       item rows 22-26 (cap 5): A item#  C desc(+model)  J UoI  K qty
                                Q unit price  S line total
       R29 first-page subtotal (static)   R31 grand total (static)
       (S19 = "=R31" and the per-page SUM formulas are preserved & recompute)
     Continuation Sheet (cap 10, rows 8-17):
       A5 page#  D5 total-sheets  E5 WMTR  + the same six item columns
   ========================================================================= */

/* ---- layout constants (mirror top_service) ---- */
const DD_FIRST_ITEM_ROW = 22, DD_FIRST_CAP = 5;
const DD_CONT_ITEM_ROW = 8,   DD_CONT_CAP = 10;
const DD_ITEM_COLS = ["A", "C", "J", "K", "Q", "S"];

/* ---- small helpers (ports of top_service helpers) ---- */

/** Port of top_service._excel_date: ISO YYYY-MM-DD -> YYYYMMDD (blank stays blank). */
function _ddExcelDate(iso) {
  iso = norm(iso);
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : iso;
}

/** Port of top_service._num. */
function _ddNum(v) {
  let s = (v === null || v === undefined ? "" : String(v)).replace(/,/g, "").replace(/\$/g, "").trim();
  if (!s) return 0.0;
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1).trim();
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n;
  let cleaned = "";
  for (const ch of s) if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-") cleaned += ch;
  const c = parseFloat(cleaned);
  return Number.isFinite(c) ? c : 0.0;
}

/** Desktop writes int(qty) when integral, else the float. */
function _ddQty(v) {
  const n = _ddNum(v);
  return Number.isInteger(n) ? n : n;
}

/** Port of top_service._city_state_zip. */
function _ddCityStateZip(city, state, zip) {
  city = norm(city); state = norm(state); zip = norm(zip);
  if (city && state && zip) return `${city}, ${state} ${zip}`;
  if (city && state) return `${city}, ${state}`;
  if (city && zip) return `${city} ${zip}`;
  return city || state || zip;
}

/** Port of top_service._party_block_from_udq, fed by the property reader's
    party.raw object (same 10 UDQ fields the desktop reads). Keeps the org
    line and the trailing "POC: name, email, cell" line. */
function _dd1149PartyBlock(raw) {
  raw = raw || {};
  const lines = [];
  for (const v of [raw.org, raw.addr0, raw.addr1,
                   _ddCityStateZip(raw.city, raw.state, raw.zip), raw.country]) {
    const s = norm(v);
    if (s) lines.push(s);
  }
  const poc = [norm(raw.poc_name), norm(raw.email), norm(raw.phone)].filter(Boolean);
  if (poc.length) lines.push("POC: " + poc.join(", "));
  return lines.join("\n").trim();
}

/** Build the DD1149 item list from the shared property inventory (port of
    _iter_top_items: combine description + model, UoI, whole-ish qty,
    unit price, line total). The shared reader already drops serial=="P". */
function dd1149Items(data) {
  const src = (data && data.items) || [];
  return src.map((it, i) => {
    const desc = norm(it.desc), model = norm(it.model);
    const combined = model ? (desc ? `${desc}\n${model}` : model) : desc;
    const qty = _ddQty(it.qty);
    const unit = _ddNum(it.unit_value);
    return {
      item_no: i + 1,
      description: combined,
      uoi: norm(it.uom),
      qty,
      unit_price: unit,
      line_total: qty * unit,
    };
  });
}

/* ---- defaults from a loaded Property UDQ (port of the dialog prefill) ---- */
function dd1149BuildDefaults(data) {
  const meta = (data && data.meta) || {};
  const parties = (data && data.parties) || {};
  return {
    wmtr: meta.wmtr || "",
    requisition_date: todayISO(),
    required_date: "",
    priority: "Routine",
    mode_of_shipment: "Air",
    signatory_name: "",
    signatory_title: "",
    date_signed: "",
    ultimate_block: _dd1149PartyBlock(parties.consignee && parties.consignee.raw),
    delivery_block: _dd1149PartyBlock(parties.deliver && parties.deliver.raw),
  };
}

/* ---- derived model from the form options ---- */
function dd1149BuildModel(opts, data) {
  const m = { ...opts };
  m.items = dd1149Items(data);
  m.continuation_needed = Math.ceil(Math.max(0, m.items.length - DD_FIRST_CAP) / DD_CONT_CAP);
  m.total_sheets = 1 + m.continuation_needed;
  m.first_total = m.items.slice(0, DD_FIRST_CAP).reduce((s, it) => s + Number(it.line_total || 0), 0);
  m.grand_total = m.items.reduce((s, it) => s + Number(it.line_total || 0), 0);
  return m;
}

/* =========================================================================
   XML-level fill (reuses PL's _plGetRow / _plReplaceExact / _xmlEsc).
   ========================================================================= */

/** Set a cell, preserving the template's existing style index. kind: num|inline. */
function _ddSetCell(rowXml, addr, value, kind) {
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const existM = rowXml.match(cellRe);
  let style = null;
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  }
  const sAttr = style != null ? ` s="${style}"` : "";
  let newCell;
  if (kind === "num") {
    newCell = `<c r="${addr}"${sAttr}><v>${value}</v></c>`;
  } else {
    const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
    newCell = `<c r="${addr}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`;
  }
  if (existM) return _plReplaceExact(rowXml, existM[0], newCell);
  return rowXml.replace("</row>", newCell + "</row>");
}

function _ddEditRow(xml, r, fn) {
  const rowXml = _plGetRow(xml, r);
  if (!rowXml) return xml;
  return _plReplaceExact(xml, rowXml, fn(rowXml));
}

function _ddWriteItemRow(xml, r, item) {
  return _ddEditRow(xml, r, (rx) => {
    rx = _ddSetCell(rx, `A${r}`, String(item.item_no), "num");
    rx = _ddSetCell(rx, `C${r}`, norm(item.description), "inline");
    rx = _ddSetCell(rx, `J${r}`, norm(item.uoi), "inline");
    rx = _ddSetCell(rx, `K${r}`, String(item.qty), "num");
    rx = _ddSetCell(rx, `Q${r}`, String(item.unit_price), "num");
    rx = _ddSetCell(rx, `S${r}`, String(item.line_total), "num");
    return rx;
  });
}

function _ddBlankItemRow(xml, r) {
  return _ddEditRow(xml, r, (rx) => {
    for (const c of DD_ITEM_COLS) rx = _ddSetCell(rx, `${c}${r}`, "", "inline");
    return rx;
  });
}

/** Fill the DD_FORM_1149 sheet (sheet1.xml). */
function _ddFillFirstSheet(xml, model) {
  const items = model.items;
  const wmtr = norm(model.wmtr);

  xml = _ddEditRow(xml, 5, (rx) => {
    rx = _ddSetCell(rx, "K5", "1", "num");
    rx = _ddSetCell(rx, "M5", String(model.total_sheets), "num");
    rx = _ddSetCell(rx, "O5", _ddExcelDate(model.requisition_date), "inline");
    rx = _ddSetCell(rx, "Q5", wmtr, "inline");
    return rx;
  });
  xml = _ddEditRow(xml, 7, (rx) => {
    rx = _ddSetCell(rx, "K7", _ddExcelDate(model.required_date), "inline");
    rx = _ddSetCell(rx, "Q7", norm(model.priority), "inline");
    return rx;
  });
  xml = _ddEditRow(xml, 9, (rx) => _ddSetCell(rx, "A9", norm(model.ultimate_block), "inline"));
  xml = _ddEditRow(xml, 11, (rx) => _ddSetCell(rx, "Q11", norm(model.signatory_name), "inline"));
  xml = _ddEditRow(xml, 13, (rx) => {
    rx = _ddSetCell(rx, "A13", norm(model.delivery_block), "inline");
    rx = _ddSetCell(rx, "K13", _ddExcelDate(model.date_signed), "inline");
    rx = _ddSetCell(rx, "Q13", norm(model.signatory_title), "inline");
    return rx;
  });
  xml = _ddEditRow(xml, 15, (rx) => _ddSetCell(rx, "K15", norm(model.mode_of_shipment), "inline"));
  xml = _ddEditRow(xml, 19, (rx) => _ddSetCell(rx, "A19", wmtr, "inline"));

  const firstItems = items.slice(0, DD_FIRST_CAP);
  for (let i = 0; i < firstItems.length; i++) {
    xml = _ddWriteItemRow(xml, DD_FIRST_ITEM_ROW + i, firstItems[i]);
  }
  for (let r = DD_FIRST_ITEM_ROW + firstItems.length; r <= DD_FIRST_ITEM_ROW + DD_FIRST_CAP - 1; r++) {
    xml = _ddBlankItemRow(xml, r);
  }

  // R29 first-page subtotal and R31 grand total become static values (desktop
  // overwrites the template's SUM formula). S19 (="=R31") recomputes on open.
  xml = _ddEditRow(xml, 29, (rx) => _ddSetCell(rx, "R29", String(model.first_total), "num"));
  xml = _ddEditRow(xml, 31, (rx) => _ddSetCell(rx, "R31", String(model.grand_total), "num"));
  return xml;
}

/** Fill one continuation sheet (pageIndex >= 2). */
function _ddFillContinuationSheet(xml, model, pageIndex) {
  const items = model.items;
  const wmtr = norm(model.wmtr);
  const start = DD_FIRST_CAP + (pageIndex - 2) * DD_CONT_CAP;
  const pageItems = items.slice(start, start + DD_CONT_CAP);

  xml = _ddEditRow(xml, 5, (rx) => {
    rx = _ddSetCell(rx, "A5", String(pageIndex), "num");
    rx = _ddSetCell(rx, "D5", String(model.total_sheets), "num");
    rx = _ddSetCell(rx, "E5", wmtr, "inline");
    return rx;
  });
  for (let i = 0; i < pageItems.length; i++) {
    xml = _ddWriteItemRow(xml, DD_CONT_ITEM_ROW + i, pageItems[i]);
  }
  for (let r = DD_CONT_ITEM_ROW + pageItems.length; r <= DD_CONT_ITEM_ROW + DD_CONT_CAP - 1; r++) {
    xml = _ddBlankItemRow(xml, r);
  }
  return xml;
}

/* ---- package-level assembly (add/remove continuation sheets, drop calcChain) ---- */

function _ddDropCalcChain(zip) {
  zip.remove("xl/calcChain.xml");
}

async function _ddPatchManifestsRemoveCont(zip) {
  // remove the single Continuation Sheet (<=5 items)
  zip.remove("xl/worksheets/sheet2.xml");
  zip.remove("xl/worksheets/_rels/sheet2.xml.rels");
  zip.remove("xl/printerSettings/printerSettings2.bin");

  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace(/<Override PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*\/>/, "")
         .replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  zip.file("[Content_Types].xml", ct);

  let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  rels = rels.replace(/<Relationship [^>]*Target="worksheets\/sheet2\.xml"[^>]*\/>/, "")
             .replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, "");
  zip.file("xl/_rels/workbook.xml.rels", rels);

  let wb = await zip.file("xl/workbook.xml").async("string");
  wb = wb.replace(/<sheet name="Continuation Sheet1"[^>]*\/>/, "")
         .replace(/<definedName name="_xlnm\.Print_Area" localSheetId="1">[^<]*<\/definedName>/, "");
  zip.file("xl/workbook.xml", wb);
}

async function _ddPatchManifestsCalcChainOnly(zip) {
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  zip.file("[Content_Types].xml", ct);
  let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  rels = rels.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, "");
  zip.file("xl/_rels/workbook.xml.rels", rels);
}

async function _ddAddContinuationSheets(zip, baseContXml, model, extraCount) {
  let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  let wb = await zip.file("xl/workbook.xml").async("string");
  let ct = await zip.file("[Content_Types].xml").async("string");

  let maxRid = 0;
  for (const m of rels.matchAll(/Id="rId(\d+)"/g)) maxRid = Math.max(maxRid, +m[1]);
  let maxSheetId = 0;
  for (const m of wb.matchAll(/sheetId="(\d+)"/g)) maxSheetId = Math.max(maxSheetId, +m[1]);
  let maxSheetNum = 0;
  for (const name of Object.keys(zip.files)) {
    const mm = name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/);
    if (mm) maxSheetNum = Math.max(maxSheetNum, +mm[1]);
  }

  const newSheets = [], newRels = [], newOverrides = [];
  for (let i = 0; i < extraCount; i++) {
    const pageIndex = 3 + i;          // Continuation Sheet1 is page 2
    const contNo = 2 + i;             // "Continuation Sheet2", 3, ...
    const sheetNum = ++maxSheetNum;
    const rid = ++maxRid;
    const sheetId = ++maxSheetId;

    const filled = _ddFillContinuationSheet(baseContXml, model, pageIndex);
    zip.file(`xl/worksheets/sheet${sheetNum}.xml`, filled);
    zip.file(`xl/worksheets/_rels/sheet${sheetNum}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings2.bin"/></Relationships>`);

    newOverrides.push(`<Override PartName="/xl/worksheets/sheet${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    newRels.push(`<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>`);
    newSheets.push(`<sheet name="Continuation Sheet${contNo}" sheetId="${sheetId}" r:id="rId${rid}"/>`);
  }

  ct = ct.replace("</Types>", newOverrides.join("") + "</Types>");
  rels = rels.replace("</Relationships>", newRels.join("") + "</Relationships>");
  wb = wb.replace("</sheets>", newSheets.join("") + "</sheets>");
  zip.file("[Content_Types].xml", ct);
  zip.file("xl/_rels/workbook.xml.rels", rels);
  zip.file("xl/workbook.xml", wb);
}

/** Build the filled DD1149 workbook; returns a base64 string. */
async function dd1149WriteWorkbook(model) {
  if (typeof JSZip === "undefined") throw new Error("JSZip isn't loaded on this page");
  const bin = atob(DD1149_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  // keep the pristine continuation sheet for cloning before we edit it
  const baseContXml = await zip.file("xl/worksheets/sheet2.xml").async("string");

  // 1) main form page
  const sheet1 = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.file("xl/worksheets/sheet1.xml", _ddFillFirstSheet(sheet1, model));

  // 2) continuation pages
  if (model.continuation_needed === 0) {
    await _ddPatchManifestsRemoveCont(zip);
    _ddDropCalcChain(zip);
  } else {
    zip.file("xl/worksheets/sheet2.xml", _ddFillContinuationSheet(baseContXml, model, 2));
    if (model.continuation_needed > 1) {
      await _ddAddContinuationSheets(zip, baseContXml, model, model.continuation_needed - 1);
    }
    await _ddPatchManifestsCalcChainOnly(zip);
    _ddDropCalcChain(zip);
  }

  return zip.generateAsync({ type: "base64" });
}

function dd1149Name(model) {
  const last5 = wmtrLast5(model.wmtr);
  return last5 ? `TOP_DD1149_${last5}_${fileStamp()}.xlsx` : `TOP_DD1149_${fileStamp()}.xlsx`;
}

/* =========================================================================
   HTML preview (mirrors the generated .xlsx; shown in the workspace iframe).
   Display-only — never affects the produced file.
   ========================================================================= */
function dd1149RenderHtml(model) {
  const esc2 = (typeof esc === "function") ? esc : (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const money = (typeof fmtMoney === "function")
    ? (n) => fmtMoney(n)
    : (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ph = (s) => (norm(s) ? esc2(s) : `<span class="ph">—</span>`);
  const items = model.items || [];

  const hdr = [
    ["WMTR #", model.wmtr, "Requisition date", _ddExcelDate(model.requisition_date)],
    ["Priority", model.priority, "Date required", _ddExcelDate(model.required_date)],
    ["Mode of shipment", model.mode_of_shipment, "Date signed", _ddExcelDate(model.date_signed)],
    ["Signatory", model.signatory_name, "Title", model.signatory_title],
    ["Total sheets", String(model.total_sheets), "Items", String(items.length)],
  ].map(([k1, v1, k2, v2]) =>
    `<div class="row"><span class="k">${esc2(k1)}</span><span class="v">${ph(v1)}</span></div>` +
    `<div class="row"><span class="k">${esc2(k2)}</span><span class="v">${ph(v2)}</span></div>`).join("");

  const itemRows = items.map((it) => `
    <tr>
      <td class="num">${it.item_no}</td>
      <td>${esc2(it.description).replace(/\n/g, "<br>")}</td>
      <td>${esc2(it.uoi)}</td>
      <td class="num">${esc2(String(it.qty))}</td>
      <td class="num">${money(it.unit_price)}</td>
      <td class="num">${money(it.line_total)}</td>
    </tr>`).join("");

  const pagingNote = model.continuation_needed === 0
    ? `Single page (${items.length} of max 5 first-page rows used).`
    : `${model.total_sheets} sheets — first page holds 5 items, then ${model.continuation_needed} continuation page${model.continuation_needed === 1 ? "" : "s"} of 10.`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{ color-scheme: light; } *{ box-sizing:border-box; }
    body{ margin:0; background:#fff; color:#111; font-family: Arial, Helvetica, sans-serif; }
    .inv{ padding:14px 16px; font-size:12px; }
    .inv h3{ margin:0 0 8px; font-size:13px; }
    .sub{ color:#555; margin:0 0 12px; }
    .hdr{ display:grid; grid-template-columns:1fr 1fr; gap:2px 26px; margin-bottom:12px; }
    .hdr .row{ display:flex; gap:6px; padding:2px 0; border-bottom:1px solid #eee; }
    .hdr .k{ color:#555; min-width:130px; } .hdr .v{ font-weight:600; white-space:pre-line; }
    .blk{ border:1px solid #cfcfcf; padding:6px 8px; margin:0 0 10px; white-space:pre-line; }
    .blk .lab{ display:block; color:#555; font-weight:600; margin-bottom:3px; }
    table{ border-collapse:collapse; width:100%; font-size:11px; }
    th,td{ border:1px solid #cfcfcf; padding:3px 5px; text-align:left; vertical-align:top; }
    th{ background:#f2f2f2; font-weight:600; }
    td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    tr.total td{ font-weight:700; background:#fafafa; }
    .ph{ color:#b00; background:#fff0f0; padding:0 2px; border-radius:2px; font-style:italic; }
  </style></head><body><div class="inv">
    <h3>DD Form 1149 — Requisition &amp; Shipping Document</h3>
    <p class="sub">${esc2(pagingNote)}</p>
    <div class="hdr">${hdr}</div>
    <div class="blk"><span class="lab">Ultimate consignee</span>${ph(model.ultimate_block)}</div>
    <div class="blk"><span class="lab">Delivery destination</span>${ph(model.delivery_block)}</div>
    <table>
      <thead><tr><th>#</th><th>Description</th><th>UoI</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
      <tbody>
        ${itemRows || `<tr><td colspan="6" style="text-align:center;color:#888;">No inventory rows</td></tr>`}
        <tr class="total"><td colspan="5" style="text-align:right;">Grand total</td><td class="num">${money(model.grand_total)}</td></tr>
      </tbody>
    </table>
  </div></body></html>`;
}
