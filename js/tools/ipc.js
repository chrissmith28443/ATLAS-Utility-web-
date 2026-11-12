/* =========================================================================
   ATLAS Utility Web — tools/ipc.js
   Inventory Packing Checklist (IPC) generator.

   Redesigned in 2.8.12 (was a faithful port of the desktop v4.4 IPC). The
   shipper fills three sections and returns the form:
     1. Inventory Checklist — every inventory item (package "P" rows excluded)
        with PO#, line, part, description, qty, serial, an "Inventoried ✓"
        box, the package it is packed in, and remarks.
     2. Package Summary — every parent item (carton / crate / pallet) with its
        contents (line #s), L × W × H and gross weight, plus totals.
     3. Inventory Certification — "inventory completed" / "discrepancies
        found" check boxes, a discrepancy box, the certification statement
        and the name / company / signature / date / stamp block.
   Package rows already on the UDQ (Serial "P") prefill Section 2 (and the
   "Packed in" column via Ship Group #); otherwise those rows are blank for
   hand entry.

   Output is an .xlsx produced in the browser with JSZip. The template
   (ipc_template.js) is a one-of-each sample; its rows are PROTOTYPES that
   are cloned in order to build the sheet. Template row map:
      1 title + logo      2 instructions     3 header labels   4 header values
      5 spacer            6 Section 1 bar    7 item col heads  8 ITEM ROW
      9 spacer           10 Section 2 bar   11 units line     12 pkg col heads
     13 PACKAGE ROW      14 totals          15 spacer         16 Section 3 bar
     17 ☐ completed      18 ☐ discrepancies 19 discrepancy box 20 statement
     21 signature boxes  22 signature labels
   Item row cells:    A PO#  B line  C part  D:F desc  G qty  H serial
                      I inventoried  J packed in  K:L remarks
   Package row cells: A pkg#  B:C type  D:F contents  G L  H W  I H
                      J weight  K:L remarks
   Reuses PL's shared XML helpers (_plGetRow, _plReplaceExact, _xmlEsc).
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

/** "48.0" -> "48", "12.50" -> "12.5" */
function _ipcNum(n) {
  return String(Math.round(n * 100) / 100);
}

const IPC_MIN_ITEM_ROWS = 3;     // blank hand-entry rows pad the checklist to this
const IPC_BLANK_PKG_ROWS = 4;    // package rows when the UDQ has none (keeps a short IPC on one page)
const IPC_EXTRA_PKG_ROWS = 2;    // extra blank package rows after prefilled ones

/* ---- Model builder ---- */

function ipcBuildModel(data) {
  const meta = data.meta || {};
  const parties = data.parties || {};

  const wmtr = norm(meta.invoice_no) || norm(meta.wmtr);

  const header = {
    wmtr,
    origin: _ipcPartyBlock(parties.origin),
    consignee: _ipcPartyBlock(parties.consignee),
    end_user: _ipcPartyBlock(parties.end_user),
  };

  // Package (parent) rows from the UDQ prefill Section 2.
  const pkgsIn = data.packages || [];
  const groups = new Set(pkgsIn.map((p) => norm(p.ship_group)).filter(Boolean));

  // Inventory rows. The web UDQ reader already routes package rows (Serial == "P")
  // into data.packages, so data.items holds only checklist items; we still guard.
  const items = [];
  for (const it of (data.items || [])) {
    const serial = norm(it.serial);
    if (serial.toUpperCase() === "P") continue;
    const sg = norm(it.ship_group);
    items.push({
      model: norm(it.model),
      desc: norm(it.desc || it.description),
      qty: _ipcQtyWhole(it.units),
      serial,
      packed_in: sg && groups.has(sg) ? sg : "",
    });
  }
  items.forEach((it, i) => { it.line = i + 1; });

  const packages = pkgsIn.map((p, i) => {
    const sg = norm(p.ship_group);
    const count = Number(p.count) || 1;
    let type = norm(p.description) || norm(p.uoi);
    if (count > 1) type = (type ? type + " " : "") + `(×${count})`;
    const [L, W, H] = parseDimsIn(p.dims);
    const hasDims = L > 0 && W > 0 && H > 0;
    const lbs = toFloat(p.weight_lbs);
    return {
      pkg_no: sg || String(i + 1),
      type,
      contents: sg ? items.filter((it) => it.packed_in === sg).map((it) => it.line).join(", ") : "",
      length: hasDims ? `${_ipcNum(L)} in` : "",
      width: hasDims ? `${_ipcNum(W)} in` : "",
      height: hasDims ? `${_ipcNum(H)} in` : "",
      weight: lbs ? `${_ipcNum(lbs)} lbs` : norm(p.weight_lbs),
      remarks: !hasDims && norm(p.dims) ? `Dims: ${norm(p.dims)}` : "",
    };
  });

  return { header, items, packages, wmtr };
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

/** Rough wrapped-line count for a cell `chars` wide (Excel can't autofit merged cells). */
function _ipcLines(text, chars) {
  return String(text || "").split("\n")
    .reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / chars)), 0);
}

function _ipcItemHeight(it) {
  const lines = Math.max(_ipcLines(it.desc, 46), _ipcLines(it.model, 21), _ipcLines(it.serial, 19), 1);
  return lines > 1 ? lines * 12 + 4 : null;
}

function _ipcPkgHeight(p) {
  const lines = Math.max(_ipcLines(p.type, 18), _ipcLines(p.contents, 46), _ipcLines(p.remarks, 32), 1);
  return lines > 1 ? lines * 12 + 4 : null;
}

/* ---- Pure workbook-part editor: rebuild sheetData from prototype rows ---- */

function ipcEditWorkbookParts(parts, model) {
  const P = {
    title: 1, instr: 2, hdrLbl: 3, hdrVal: 4, sp1: 5, s1: 6, itemHdr: 7, item: 8,
    sp2: 9, s2: 10, units: 11, pkgHdr: 12, pkg: 13, totals: 14, sp3: 15, s3: 16,
    chk1: 17, chk2: 18, disc: 19, stmt: 20, sigBox: 21, sigLbl: 22,
  };
  const LAST_PROTO = 22;

  let xml = parts.sheet;
  const hv = model.header || {};
  const items = model.items || [];
  const pkgs = model.packages || [];

  // Prototype rows + their (single-row) merges
  const proto = {};
  for (let r = 1; r <= LAST_PROTO; r++) proto[r] = _plGetRow(xml, r);
  const mergesByRow = {};
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
    const r = parseInt(m[2], 10);
    (mergesByRow[r] = mergesByRow[r] || []).push([m[1], m[3]]);
  }

  // Output plan: [protoRow, {col: value}, heightOrNull]
  const plan = [];
  const add = (p, vals, ht) => plan.push([p, vals || {}, ht || null]);

  add(P.title); add(P.instr); add(P.hdrLbl);
  add(P.hdrVal, { A: hv.wmtr || "", D: hv.origin || "", G: hv.consignee || "", J: hv.end_user || "" });
  add(P.sp1); add(P.s1); add(P.itemHdr);
  for (const it of items) {
    add(P.item, { B: String(it.line), C: it.model || "", D: it.desc || "", G: it.qty || "",
                  H: it.serial || "", J: it.packed_in || "" }, _ipcItemHeight(it));
  }
  for (let i = items.length; i < IPC_MIN_ITEM_ROWS; i++) add(P.item);
  add(P.sp2); add(P.s2); add(P.units); add(P.pkgHdr);
  for (const p of pkgs) {
    add(P.pkg, { A: p.pkg_no || "", B: p.type || "", D: p.contents || "", G: p.length || "",
                 H: p.width || "", I: p.height || "", J: p.weight || "", K: p.remarks || "" }, _ipcPkgHeight(p));
  }
  const blanks = pkgs.length ? IPC_EXTRA_PKG_ROWS : IPC_BLANK_PKG_ROWS;
  for (let i = 0; i < blanks; i++) add(P.pkg);
  for (const p of [P.totals, P.sp3, P.s3, P.chk1, P.chk2, P.disc, P.stmt, P.sigBox, P.sigLbl]) add(p);

  // Emit rows + merges
  let rowsXml = "";
  let merges = "";
  let mergeCount = 0;
  plan.forEach(([p, vals, ht], i) => {
    const r = i + 1;
    let rx = proto[p] || `<row r="${p}"></row>`;
    rx = rx.replace(/(<row [^>]*\br=")(\d+)(")/, (_, a, _r, b) => a + r + b);
    rx = rx.replace(/\br="([A-Z]+)\d+"/g, (_, col) => `r="${col}${r}"`);
    if (ht) {
      rx = rx.replace(/<row ([^>]*?)\s*\bht="[^"]*"/, "<row $1")
             .replace(/\s*\bcustomHeight="[^"]*"/, "")
             .replace(/<row /, `<row ht="${ht}" customHeight="1" `);
    }
    for (const [col, v] of Object.entries(vals)) rx = _ipcSetCell(rx, `${col}${r}`, v);
    rowsXml += rx;
    for (const [c1, c2] of (mergesByRow[p] || [])) {
      merges += `<mergeCell ref="${c1}${r}:${c2}${r}"/>`;
      mergeCount++;
    }
  });
  const lastRow = plan.length;

  xml = xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, () => `<sheetData>${rowsXml}</sheetData>`);
  xml = xml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/,
    () => `<mergeCells count="${mergeCount}">${merges}</mergeCells>`);
  xml = xml.replace(/(<dimension ref="[^:]+:)[A-Z]+\d+(")/, (_, pre, suf) => `${pre}L${lastRow}${suf}`);

  // workbook.xml print area follows the last row
  const wbXml = parts.workbook.replace(/(_xlnm\.Print_Area[\s\S]*?\$L\$)(\d+)/, (_, pre) => pre + lastRow);

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
  const hv = model.header;
  const items = model.items || [];
  const pkgs = model.packages || [];

  let itemRows = items.map((it) => `
    <tr>
      <td></td><td class="c">${esc(it.line)}</td><td class="mono">${esc(it.model)}</td>
      <td>${esc(it.desc)}</td><td class="c">${esc(it.qty)}</td><td class="mono">${esc(it.serial)}</td>
      <td class="c"></td><td class="c">${esc(it.packed_in)}</td><td></td>
    </tr>`).join("");
  for (let i = items.length; i < IPC_MIN_ITEM_ROWS; i++) itemRows += `<tr>${"<td></td>".repeat(9)}</tr>`;

  let pkgRows = pkgs.map((p) => `
    <tr>
      <td class="c">${esc(p.pkg_no)}</td><td>${esc(p.type)}</td><td>${esc(p.contents)}</td>
      <td class="c">${esc(p.length)}</td><td class="c">${esc(p.width)}</td><td class="c">${esc(p.height)}</td>
      <td class="c">${esc(p.weight)}</td><td>${esc(p.remarks)}</td>
    </tr>`).join("");
  const blanks = pkgs.length ? IPC_EXTRA_PKG_ROWS : IPC_BLANK_PKG_ROWS;
  for (let i = 0; i < blanks; i++) pkgRows += `<tr>${"<td></td>".repeat(8)}</tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>IPC</title>
<style>${IPC_CSS}</style></head><body>
<div class="ipc-page">
  <div class="ipc-title">Inventory Packing Checklist</div>
  <div class="ipc-instr">Shipper: (1) inventory every item and check it off &nbsp;·&nbsp; (2) record the package each item is packed in &nbsp;·&nbsp; (3) list every package with its dimensions and weight &nbsp;·&nbsp; (4) sign the certification and return this form.</div>

  <table class="ipc-head">
    <tr><th>WMTR #</th><th>Origin Location</th><th>Ultimate Consignee</th><th>End User</th></tr>
    <tr>
      <td class="hv">${esc(hv.wmtr || "")}</td>
      <td class="hv">${esc(hv.origin || "")}</td>
      <td class="hv">${esc(hv.consignee || "")}</td>
      <td class="hv">${esc(hv.end_user || "")}</td>
    </tr>
  </table>

  <div class="ipc-bar">1 · INVENTORY CHECKLIST — check off each item and record the package it is packed in</div>
  <table class="ipc-tbl items">
    <colgroup><col style="width:9%"><col style="width:5%"><col style="width:13%"><col><col style="width:5%"><col style="width:12%"><col style="width:8%"><col style="width:9%"><col style="width:16%"></colgroup>
    <thead><tr>
      <th>PO #</th><th class="c">Line #</th><th>Part #</th><th>Description</th><th class="c">Qty</th>
      <th>Serial #</th><th class="c">Inventoried&nbsp;✓</th><th class="c">Packed in Package #</th>
      <th>Remarks (damage, shortage, etc.)</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="ipc-bar">2 · PACKAGE SUMMARY — list every carton, crate, or pallet (parent item) with its dimensions and weight</div>
  <div class="ipc-units">Units (circle one): &nbsp;&nbsp; Dimensions: &nbsp; in &nbsp;/&nbsp; cm &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Weight: &nbsp; lbs &nbsp;/&nbsp; kg</div>
  <table class="ipc-tbl pkgs">
    <colgroup><col style="width:9%"><col style="width:15%"><col><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:10%"><col style="width:17%"></colgroup>
    <thead><tr>
      <th class="c">Package #</th><th>Package type (carton / crate / pallet)</th><th>Contents (Line #s packed inside)</th>
      <th class="c">Length</th><th class="c">Width</th><th class="c">Height</th><th class="c">Gross weight</th><th>Marks / remarks</th>
    </tr></thead>
    <tbody>${pkgRows}</tbody>
  </table>
  <table class="ipc-totals"><tr>
    <td class="lbl">Total packages:</td><td class="box"></td>
    <td class="lbl">Total gross weight:</td><td class="box sm"></td><td class="gap"></td>
  </tr></table>

  <div class="ipc-bar">3 · INVENTORY CERTIFICATION</div>
  <div class="ipc-chk">☐ &nbsp; Inventory completed — every item in Section 1 was physically counted and verified against this checklist, and nothing is missing.</div>
  <div class="ipc-chk">☐ &nbsp; Discrepancies found — shortages, overages, damage, or serial # mismatches are described below.</div>
  <div class="ipc-disc">Discrepancies / remarks:</div>
  <div class="ipc-stmt">I certify that a physical inventory of this shipment was completed, that all items listed above are included and packed as shown, and that the package dimensions and weights are accurate.</div>
  <table class="ipc-foot">
    <tr>
      <td class="sig w3"><div class="lbl">Printed name &amp; title</div></td>
      <td class="sig w3"><div class="lbl">Company</div></td>
      <td class="sig w3"><div class="lbl">Signature</div></td>
      <td class="sig"><div class="lbl">Date</div></td>
      <td class="sig w2"><div class="lbl">Stamp (if available)</div></td>
    </tr>
  </table>
</div>
</body></html>`;
}

const IPC_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#000; }
.ipc-page{ box-sizing:border-box; width:900px; margin:0 auto; background:#fff; box-shadow:0 0 10px rgba(0,0,0,0.25); padding:18px 22px 22px; }
.ipc-title{ font-size:16pt; font-weight:bold; text-align:center; padding:6px 0 4px; }
.ipc-instr{ font-size:8pt; font-style:italic; color:#444; text-align:center; padding:0 0 10px; }
.ipc-head{ width:100%; border-collapse:collapse; table-layout:fixed; }
.ipc-head th{ background:#e9edf1; border:1px solid #000; padding:4px 6px; font-size:8pt; text-align:left; }
.ipc-head td.hv{ border:1px solid #000; padding:6px; font-size:8pt; line-height:1.3; vertical-align:top; height:84px; white-space:pre-line; }
.ipc-bar{ background:#1f3a5f; color:#fff; font-weight:bold; font-size:8.5pt; padding:4px 6px; margin-top:12px; border:1px solid #000; }
.ipc-units{ border:1px solid #000; border-top:0; font-size:8pt; padding:4px 6px; }
.ipc-tbl{ width:100%; border-collapse:collapse; table-layout:fixed; }
.ipc-tbl th{ background:#e9edf1; border:1px solid #000; border-top:0; padding:4px 5px; font-size:7.5pt; text-align:left; vertical-align:middle; }
.ipc-tbl td{ border:1px solid #000; padding:4px 5px; font-size:8pt; vertical-align:top; word-wrap:break-word; overflow-wrap:break-word; height:16px; }
.ipc-tbl .c{ text-align:center; }
.ipc-tbl .mono{ font-family:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; font-size:7.5pt; }
.ipc-totals{ border-collapse:collapse; margin-top:4px; width:100%; table-layout:fixed; }
.ipc-totals td{ font-size:8pt; padding:4px 6px; height:16px; }
.ipc-totals td.lbl{ font-weight:bold; text-align:right; width:16%; }
.ipc-totals td.box{ border:1px solid #000; width:18%; }
.ipc-totals td.box.sm{ width:10%; }
.ipc-chk{ border:1px solid #000; border-top:0; font-size:8.5pt; padding:5px 8px; }
.ipc-disc{ border:1px solid #000; border-top:0; font-size:7.5pt; font-weight:bold; color:#444; padding:4px 8px; height:46px; }
.ipc-stmt{ font-size:8.5pt; font-weight:bold; padding:8px 2px; }
.ipc-foot{ width:100%; border-collapse:collapse; table-layout:fixed; }
.ipc-foot td.sig{ border:1px solid #000; height:56px; vertical-align:bottom; padding:0; }
.ipc-foot td.sig.w3{ width:25%; }
.ipc-foot td.sig.w2{ width:17%; }
.ipc-foot td.sig .lbl{ background:#e9edf1; border-top:1px solid #000; font-size:7.5pt; font-weight:bold; padding:3px 6px; }
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
