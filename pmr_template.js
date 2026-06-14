/* =========================================================================
   ATLAS Utility Web — tools/ipc.js
   Inventory Packing Checklist (IPC) generator.

   FAITHFUL PORT of the desktop v4.4 IPC:
     - services/ipc_service.py        (run_ipc_pipeline: header party blocks,
                                        whole-number qty, dynamic inventory rows,
                                        package rows skipped, last-5 WMTR naming)
     - templates/ipc_template.xlsx    (embedded as base64 in ipc_template.js)

   Output is an .xlsx (like the desktop), produced entirely in the browser by
   editing the template at the XML level with JSZip — the same approach the SLI
   and PL tools use. Reuses PL's shared XML helpers (_plCloneRow,
   _plRenumberRows, _plGetRow, _plReplaceExact, _xmlEsc), which load first.

   Template cell map (sheet "Sheet1"):
     Row 2  labels:  WMTR#  | Origin Location | Ultimate Consignee | End User
     Row 3  VALUES:  A3 (A3:C3) | D3 (D3:F3)   | G3 (G3:I3)        | J3 (J3:L3)
     Row 5  item header: A5 PO# | C5 Line item # | D5 Part # | E5 Description
                         H5 QTY  | I5 Serial #    | J5 Packed in/on carton/pallet #
     Item rows 6-8 (expandable). Per row write:
        C line#  D part#(model)  E desc(E:G)  H qty  I serial.
        A (PO#, A:B) and J (packed, J:L) intentionally left blank for hand entry.
     Row 9  thin spacer.  Rows 10-12 footer (signature block + certification).
   ========================================================================= */

/* ---- Port of party_utils.party_block (addr_lines + country, no POC) ---- */

function _ipcPartyBlock(party) {
  if (!party) return "";
  const lines = [];
  for (const a of (party.addr_lines || [])) {
    const s = norm(a);
    if (s) lines.push(s);
  }
  const country = norm(party.country);
  if (country && !lines.some((ln) => ln.toLowerCase() === country.toLowerCase())) {
    lines.push(country);
  }
  return lines.join("\n").trim();
}

/** Port of ipc_service._qty_whole: show whole numbers, "" when blank. */
function _ipcQtyWhole(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const n = Number(s.replace(/,/g, ""));
  if (Number.isFinite(n)) {
    if (n === 0) return "0";
    return String(Math.trunc(n));
  }
  return s;
}

/* ---- Model builder: faithful port of run_ipc_pipeline (minus Excel I/O) ---- */

function ipcBuildModel(data) {
  const meta = data.meta || {};
  const parties = data.parties || {};

  const wmtr = norm(meta.invoice_no) || norm(meta.wmtr);

  const headerValues = {
    A3: wmtr,
    D3: _ipcPartyBlock(parties.origin),
    G3: _ipcPartyBlock(parties.consignee),
    J3: _ipcPartyBlock(parties.end_user),
  };

  // Inventory rows. The web UDQ reader already routes package rows (Serial == "P")
  // into data.packages, so data.items holds only checklist items; we still guard.
  const items = [];
  for (const it of (data.items || [])) {
    const serial = norm(it.serial);
    if (serial.toUpperCase() === "P") continue;
    items.push({
      model: norm(it.model),
      desc: norm(it.desc || it.description),
      qty: _ipcQtyWhole(it.units),
      serial,
    });
  }
  items.forEach((it, i) => { it.line = i + 1; });

  return { headerValues, items, wmtr };
}

/* ---- Cell setter (handles self-closing template cells; preserves style) ---- */

function _ipcSetCell(rowXml, addr, value) {
  // inline multiline string, matching SLI/PL inline cells
  const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
  const cellContent = `<is><t xml:space="preserve">${esc}</t></is>`;
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const existM = rowXml.match(cellRe);
  let style = "0";
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  } else {
    const rm = rowXml.match(/\bs="(\d+)"/);
    if (rm) style = rm[1];
  }
  const newCell = `<c r="${addr}" s="${style}" t="inlineStr">${cellContent}</c>`;
  if (existM) return _plReplaceExact(rowXml, existM[0], newCell);
  return rowXml.replace("</row>", newCell + "</row>");
}

function _ipcFillItemRow(rowXml, r, item) {
  item = item || {};
  let rx = rowXml;
  rx = _ipcSetCell(rx, `C${r}`, item.line != null ? String(item.line) : "");
  rx = _ipcSetCell(rx, `D${r}`, item.model || "");
  rx = _ipcSetCell(rx, `E${r}`, item.desc || "");
  rx = _ipcSetCell(rx, `H${r}`, item.qty || "");
  rx = _ipcSetCell(rx, `I${r}`, item.serial || "");
  return rx;
}

/* ---- Pure workbook-part editor (faithful port of the openpyxl writer) ---- */

function ipcEditWorkbookParts(parts, model) {
  const ITEM_START = 6, ITEM_TEMPLATE_ROWS = 3, FOOTER_START = 9;

  let xml = parts.sheet;
  const hv = model.headerValues || {};
  const rows = model.items || [];
  const n = rows.length;
  const extra = Math.max(0, n - ITEM_TEMPLATE_ROWS);

  const editRow = (r, fn) => {
    const rowXml = _plGetRow(xml, r);
    if (!rowXml) return;
    xml = _plReplaceExact(xml, rowXml, fn(rowXml));
  };

  // 1) Header values (row 3)
  editRow(3, (rx) => {
    rx = _ipcSetCell(rx, "A3", hv.A3 || "");
    rx = _ipcSetCell(rx, "D3", hv.D3 || "");
    rx = _ipcSetCell(rx, "G3", hv.G3 || "");
    rx = _ipcSetCell(rx, "J3", hv.J3 || "");
    return rx;
  });

  // 2) First up-to-3 item rows, filled in place
  for (let i = 0; i < ITEM_TEMPLATE_ROWS; i++) {
    const r = ITEM_START + i;
    const item = i < rows.length ? rows[i] : null;
    if (item) editRow(r, (rx) => _ipcFillItemRow(rx, r, item));
  }

  // 3) Extra item rows: clone last template item row, insert before footer, fill
  let tempBase = 9000;
  for (let i = ITEM_TEMPLATE_ROWS; i < n; i++) {
    const tRow = tempBase++;
    const clone = _plCloneRow(xml, ITEM_START + ITEM_TEMPLATE_ROWS - 1, tRow);
    if (!clone) continue;
    const anchor = _plGetRow(xml, FOOTER_START);
    if (!anchor) continue;
    const at = xml.indexOf(anchor);
    xml = xml.slice(0, at) + clone + xml.slice(at);
    const tRowXml = _plGetRow(xml, tRow);
    if (tRowXml) xml = _plReplaceExact(xml, tRowXml, _ipcFillItemRow(tRowXml, tRow, rows[i]));
  }

  // 4) Renumber every row sequentially (1, 2, 3, …)
  xml = _plRenumberRows(xml);

  // 5) Dimension + merge shifting + new item-row merges
  const finalRowCount = (xml.match(/<row /g) || []).length;
  xml = xml.replace(/(<dimension ref="[^:]+:)[A-Z]+\d+(")/, (_, pre, suf) => `${pre}L${finalRowCount}${suf}`);

  if (extra > 0) {
    // Shift any merge at/below the footer down by `extra`
    xml = xml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, (full) =>
      full.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (_, c1, r1, c2, r2) => {
        const n1 = parseInt(r1, 10), n2 = parseInt(r2, 10);
        const s1 = n1 >= FOOTER_START ? n1 + extra : n1;
        const s2 = n2 >= FOOTER_START ? n2 + extra : n2;
        return `<mergeCell ref="${c1}${s1}:${c2}${s2}"/>`;
      })
    );
    // Each inserted item row keeps the template item merges: A:B, E:G, J:L
    let newMerges = "";
    for (let r = FOOTER_START; r < FOOTER_START + extra; r++) {
      newMerges += `<mergeCell ref="A${r}:B${r}"/><mergeCell ref="E${r}:G${r}"/><mergeCell ref="J${r}:L${r}"/>`;
    }
    if (newMerges) {
      xml = xml.replace(/<mergeCells count="(\d+)">/, (_, cnt) =>
        `<mergeCells count="${parseInt(cnt, 10) + extra * 3}">`);
      xml = xml.replace("</mergeCells>", newMerges + "</mergeCells>");
    }
  }

  // 6) workbook.xml print area bottom row shifts with the inserted rows
  let wbXml = parts.workbook;
  if (extra > 0) {
    wbXml = wbXml.replace(/(_xlnm\.Print_Area[\s\S]*?\$L\$)(\d+)/, (_, pre, row) =>
      pre + (parseInt(row, 10) + extra));
  }

  return { sheet: xml, workbook: wbXml };
}

/* ---- Browser: load template, edit, repack to base64 ---- */

async function ipcWriteWorkbook(model) {
  const bin = atob(IPC_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const parts = {
    sheet: await zip.file("xl/worksheets/sheet1.xml").async("string"),
    workbook: await zip.file("xl/workbook.xml").async("string"),
  };

  const edited = ipcEditWorkbookParts(parts, model);

  const outZip = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (name === "xl/worksheets/sheet1.xml") outZip.file(name, edited.sheet);
    else if (name === "xl/workbook.xml") outZip.file(name, edited.workbook);
    else outZip.file(name, await entry.async("uint8array")); // logo, styles, theme, etc. verbatim
  }
  return await outZip.generateAsync({ type: "base64" });
}

/* ---- Live preview: HTML mirror of the generated .xlsx (browser only) ---- */

function ipcRenderHtml(data) {
  const model = ipcBuildModel(data);
  const hv = model.headerValues;

  const itemRows = (model.items || []).map((it) => `
    <tr>
      <td class="po"></td>
      <td class="c">${esc(it.line)}</td>
      <td class="mono">${esc(it.model)}</td>
      <td>${esc(it.desc)}</td>
      <td class="c">${esc(it.qty)}</td>
      <td class="mono">${esc(it.serial)}</td>
      <td class="pk"></td>
    </tr>`).join("");

  // Keep a few blank rows visible when there are very few items, mirroring the
  // template's hand-entry rows (rows 6-8 always present on the sheet).
  const blanks = Math.max(0, 3 - (model.items || []).length);
  let blankRows = "";
  for (let i = 0; i < blanks; i++) {
    blankRows += `<tr><td class="po"></td><td class="c"></td><td></td><td></td><td class="c"></td><td></td><td class="pk"></td></tr>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>IPC</title>
<style>${IPC_CSS}</style></head><body>
<div class="ipc-page">
  <div class="ipc-title">Inventory Packing Checklist</div>

  <table class="ipc-head">
    <tr>
      <th>WMTR#</th><th>Origin Location</th><th>Ultimate Consignee</th><th>End User</th>
    </tr>
    <tr>
      <td class="hv">${esc(hv.A3 || "")}</td>
      <td class="hv">${esc(hv.D3 || "")}</td>
      <td class="hv">${esc(hv.G3 || "")}</td>
      <td class="hv">${esc(hv.J3 || "")}</td>
    </tr>
  </table>

  <table class="ipc-tbl">
    <thead><tr>
      <th class="po">PO#</th><th class="c">Line&nbsp;item&nbsp;#</th><th>Part&nbsp;#</th>
      <th>Description</th><th class="c">QTY</th><th>Serial&nbsp;#</th>
      <th class="pk">Packed in/on carton/pallet&nbsp;#</th>
    </tr></thead>
    <tbody>${itemRows}${blankRows || (itemRows ? "" : `<tr><td colspan="7" class="empty">No inventory items</td></tr>`)}</tbody>
  </table>

  <table class="ipc-foot">
    <tr>
      <td class="sig"><div class="lbl">Printed name &amp; Company</div></td>
      <td class="sig"><div class="lbl">Signature</div></td>
      <td class="sig"><div class="lbl">Date</div></td>
      <td class="sig"><div class="lbl">Stamp (if available)</div></td>
    </tr>
  </table>
  <div class="cert">I certify that all items listed above have been included in this shipment.</div>
</div>
</body></html>`;
}

const IPC_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#000; }
.ipc-page{ box-sizing:border-box; width:820px; margin:0 auto; background:#fff; box-shadow:0 0 10px rgba(0,0,0,0.25); padding:18px 22px 22px; }
.ipc-title{ font-size:15pt; font-weight:bold; text-align:center; padding:6px 0 12px; }
.ipc-head{ width:100%; border-collapse:collapse; table-layout:fixed; }
.ipc-head th{ background:#e9edf1; border:1px solid #000; padding:4px 6px; font-size:8pt; text-align:left; }
.ipc-head td.hv{ border:1px solid #000; padding:6px; font-size:8pt; line-height:1.3; vertical-align:top; height:90px; white-space:pre-line; }
.ipc-tbl{ width:100%; border-collapse:collapse; table-layout:fixed; margin-top:12px; }
.ipc-tbl th{ background:#e9edf1; border:1px solid #000; padding:4px 5px; font-size:7.5pt; text-align:left; }
.ipc-tbl td{ border:1px solid #000; padding:4px 5px; font-size:8pt; vertical-align:top; word-wrap:break-word; overflow-wrap:break-word; height:20px; }
.ipc-tbl .c{ text-align:center; }
.ipc-tbl .mono{ font-family:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; font-size:7.5pt; }
.ipc-tbl .empty{ text-align:center; color:#888; font-style:italic; }
.ipc-tbl th.po, .ipc-tbl td.po{ width:9%; }
.ipc-tbl th.c, .ipc-tbl td.c{ width:8%; }
.ipc-tbl th.pk, .ipc-tbl td.pk{ width:16%; }
.ipc-foot{ width:100%; border-collapse:collapse; table-layout:fixed; margin-top:14px; }
.ipc-foot td.sig{ border:1px solid #000; height:66px; vertical-align:bottom; padding:0; }
.ipc-foot td.sig .lbl{ background:#e9edf1; border-top:1px solid #000; font-size:7.5pt; font-weight:bold; padding:3px 6px; }
.cert{ border:1px solid #000; border-top:0; padding:5px 8px; font-size:8pt; }
`;

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ipcBuildModel, ipcEditWorkbookParts, _ipcPartyBlock, _ipcQtyWhole };
  const u = require("../util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
  const q = require("../udq.js");
  global.makeParty = q.makeParty;
  global.makeLineItem = q.makeLineItem;
}
