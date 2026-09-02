/* =========================================================================
   ATLAS Utility Web — tools/inventory.js

   Warehouse Inventory Sheet — an Excel-only export that lives on the Packing
   List panel (its own button, next to the PL exports).

   Same look as the Packing List, but this is a RECEIVING document, not a
   shipping one: nothing has been packed yet, so there are no packages, no
   ship-from/ship-to block, no HS codes and no signature block. Instead each
   line ends in two blank write-in columns the warehouse fills in as material
   shows up — RC/RCR # (warehouse receipt) and Date Arrived.

   Built with the Packing List's OOXML writer/styles (_PlSheetWriter,
   _plXlsxStyles, PLS) so both documents stay visually in sync.
   ========================================================================= */

/* The two UDQ types describe a line item differently, so normalize before the
   sheet sees them. SRF (shipping) items come from makeLineItem and carry string
   `units` / `units_received`; property (PR) items carry numeric `qty_requested`
   / `qty_received`. `units` is present on every SRF item — even when blank —
   and on no property item, so it's the discriminator. */
function _invNormRow(k) {
  const srf = ("units" in k);
  return {
    desc: k.desc || "",
    model: k.model || "",
    uom: k.uom || "",
    req: toFloat(srf ? k.units : k.qty_requested) || 0,
    recv: toFloat(srf ? k.units_received : k.qty_received) || 0,
  };
}

/** The item list, in the order the UDQ lists it. */
function _invRows(data) {
  return (data.items || []).map(_invNormRow);
}

/* The Inventory Sheet needs two cell styles the Packing List has no use for:
   a received quantity that matches what was requested (dark green) and one
   that doesn't (red). Rather than fork the PL's style catalogue, append to it
   and let the new indices fall out of whatever the PL currently defines — so
   this keeps working if pl.js adds fonts or styles of its own. */
function _invXlsxStyles() {
  let xml = _plXlsxStyles();
  const fontCount = Number((xml.match(/<fonts count="(\d+)"/) || [])[1] || 0);
  const xfCount = Number((xml.match(/<cellXfs count="(\d+)"/) || [])[1] || 0);

  const fonts =
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF1B6B34"/></font>` +  // dark green
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FFB3261E"/></font>`;   // red
  xml = xml.replace(/<fonts count="\d+">/, `<fonts count="${fontCount + 2}">`)
           .replace("</fonts>", fonts + "</fonts>");

  // Same shape as the PL's "td right" style, just with a colored font.
  const xf = (f) =>
    `<xf numFmtId="0" fontId="${f}" fillId="0" borderId="1" xfId="0"` +
    ` applyFont="1" applyBorder="1" applyAlignment="1">` +
    `<alignment horizontal="right" vertical="top"/></xf>`;
  xml = xml.replace(/<cellXfs count="\d+">/, `<cellXfs count="${xfCount + 2}">`)
           .replace("</cellXfs>", xf(fontCount) + xf(fontCount + 1) + "</cellXfs>");

  return { xml, recvOk: xfCount, recvShort: xfCount + 1 };
}

/* Build the OOXML parts for the Inventory Sheet workbook. Pure function. */
function _invXlsxParts(data) {
  const m = data.meta || {};
  const rows = _invRows(data);
  const nCols = 8;
  const ST = _invXlsxStyles();

  const S = new _PlSheetWriter();
  const C = (v, s, t) => ({ v, s, t });
  const blank = (s) => ({ v: "", s });
  const pad = (n, s) => { const a = []; for (let i = 0; i < n; i++) a.push(blank(s)); return a; };

  let totalUnits = 0, totalRecv = 0;
  rows.forEach(k => { totalUnits += k.req; totalRecv += k.recv; });

  // Title band
  S.addRow([C("TRLS II", PLS.brand)].concat(pad(3, PLS.bandBlank),
            [C("INVENTORY SHEET", PLS.titleR)], pad(3, PLS.bandBlank)), 26);
  S.merge(1, 1, 1, 4); S.merge(1, 5, 1, nCols);
  S.addRow([C("TechTrans International", PLS.subL)].concat(pad(3, PLS.bandBlank),
            [C(`${m.wmtr || ""}  ·  ${_plToday()}`, PLS.subR)], pad(3, PLS.bandBlank)), 16);
  S.merge(2, 1, 2, 4); S.merge(2, 5, 2, nCols);

  S.addRow([]); // spacer

  // Summary — four label/value pairs, two columns each
  S.addRow([C("LINE ITEMS", PLS.chipK), null, C("TOTAL QTY REQUESTED", PLS.chipK), null,
            C("TOTAL QTY RECEIVED", PLS.chipK), null, C("WMTR NUMBER", PLS.chipK), null]);
  const rSL = S.lastRow();
  S.merge(rSL, 1, rSL, 2); S.merge(rSL, 3, rSL, 4); S.merge(rSL, 5, rSL, 6); S.merge(rSL, 7, rSL, 8);
  S.addRow([C(rows.length, PLS.chipV), null, C(Math.trunc(totalUnits), PLS.chipV), null,
            C(Math.trunc(totalRecv), PLS.chipV), null, C(m.wmtr || "", PLS.chipV), null]);
  const rSV = S.lastRow();
  S.merge(rSV, 1, rSV, 2); S.merge(rSV, 3, rSV, 4); S.merge(rSV, 5, rSV, 6); S.merge(rSV, 7, rSV, 8);

  S.addRow([]); // spacer

  S.addRow([C("EXPECTED INVENTORY — RECORD RECEIPT BELOW", PLS.section)]);
  const rSec = S.lastRow(); S.merge(rSec, 1, rSec, nCols);

  // Header row
  S.addRow([C("#", PLS.thC), C("Description", PLS.thL), C("Model #", PLS.thL),
            C("U/I", PLS.thC), C("Qty Requested", PLS.thC), C("Qty Received", PLS.thC),
            C("RC/RCR #", PLS.thC), C("Date Arrived", PLS.thC)]);

  if (rows.length) {
    rows.forEach((k, i) => {
      const req = k.req, recvN = k.recv;
      // Blank or zero received reads as "nothing yet" — leave the cell empty
      // rather than printing a 0 the warehouse has to interpret. Anything else
      // is colored: dark green when it matches the request, red when it doesn't
      // (short, or over).
      const recvCell = recvN
        ? C(Math.trunc(recvN), recvN === req ? ST.recvOk : ST.recvShort)
        : blank(PLS.tdR);
      // The last two cells stay empty on purpose — the warehouse writes in the
      // receipt number and the arrival date.
      S.addRow([C(i + 1, PLS.tdNum), C(k.desc, PLS.tdL), C(k.model, PLS.tdL),
                C(k.uom, PLS.tdC), C(req, PLS.tdR), recvCell,
                blank(PLS.tdC), blank(PLS.tdC)]);
    });
  } else {
    S.addRow([C("No inventory items in this UDQ.", PLS.tdC)]);
    const rn = S.lastRow(); S.merge(rn, 1, rn, nCols);
  }

  S.addRow([]);
  S.addRow([C("Prepared by TechTrans International (TTI) on behalf of the Defense Threat Reduction Agency (DTRA). Quantities received are green when the full requested quantity has arrived and red when the counts don't match; a blank means nothing has been received against that line yet.", PLS.boiler)], 30);
  const rPrep = S.lastRow(); S.merge(rPrep, 1, rPrep, nCols);

  const cols = [
    { min:1,max:1,w:5 }, { min:2,max:2,w:46 }, { min:3,max:3,w:18 }, { min:4,max:4,w:8 },
    { min:5,max:5,w:15 }, { min:6,max:6,w:15 }, { min:7,max:7,w:16 }, { min:8,max:8,w:14 },
  ];
  const sheetXml = S.xml(cols, nCols);

  const parts = {};
  parts["[Content_Types].xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  parts["_rels/.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  parts["xl/workbook.xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Inventory Sheet" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  parts["xl/_rels/workbook.xml.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  parts["xl/styles.xml"] = ST.xml;
  parts["xl/worksheets/sheet1.xml"] = sheetXml;
  return parts;
}

/* The sheet is reachable from two places: a button on the SRF Packing List
   panel, and its own panel on property (PR) UDQs. Only one is ever mounted, so
   whichever status line is on the page is the right one to report into. */
function _invStatusEl() {
  return document.getElementById("invStatus") || document.getElementById("plStatus");
}

/* ── Property (PR) workspace ─────────────────────────────────────────────────
   Property UDQs have no Packing List to hang the button off, so the sheet gets
   its own panel here. Same document, same builder — only the source columns
   differ, and _invNormRow has already smoothed that over. */
function renderInvPrWorkspace(container) {
  const m = AppState.data.meta;
  const rows = _invRows(AppState.data);
  const recvLines = rows.filter(k => k.recv).length;

  const panel = el(`
    <div class="panel">
      <header>
        <h2>Inventory Sheet</h2>
        <span class="count">${esc(m.wmtr || "Property UDQ")}</span>
      </header>
      <div class="body">
        <div class="note">
          The same receiving sheet the Packing List window produces for shipping
          requests, built from this Property Management UDQ instead. A flat,
          numbered list of every inventory item showing
          <strong>Qty Requested</strong> against <strong>Qty Received</strong>
          (dark green when they match, red when they don't, blank when nothing
          has arrived yet), followed by blank <strong>RC/RCR #</strong> and
          <strong>Date Arrived</strong> columns for the warehouse to fill in.
          Excel only. This UDQ has ${rows.length} inventory item(s);
          ${recvLines} already show a received quantity.
        </div>

        <div class="btnrow">
          <button class="btn navy" id="invPrExcel">Inventory Sheet (.xlsx)</button>
          <span class="statusline" id="invStatus"></span>
        </div>
      </div>
    </div>`);

  container.appendChild(panel);
  panel.querySelector("#invPrExcel").addEventListener("click", generateInvXlsx);
}

/* Browser entry point — wired to the Inventory Sheet button on both panels.

   No atlasGenerateGate() call here on purpose: the hard-block validation guards
   export/shipping paperwork (ECCN vs. license, HTS, hazmat and the like). This
   sheet carries none of those fields — it's an internal receiving list of what
   the warehouse should expect — so missing compliance data must not stop it. */
async function generateInvXlsx() {
  const status = _invStatusEl();
  if (status) { status.classList.remove("err"); status.textContent = "Building Inventory Sheet…"; }
  try {
    if (typeof JSZip === "undefined") throw new Error("JSZip is not available");
    const data = AppState.data;
    const parts = _invXlsxParts(data);
    const zip = new JSZip();
    for (const [name, content] of Object.entries(parts)) zip.file(name, content);
    const b64 = await zip.generateAsync({ type: "base64" });

    const last5 = data.meta.wmtr_last5 || "";
    const fname = (last5 ? `INV_${last5}_` : `INV_`) + fileStamp() + ".xlsx";
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    if (status) status.textContent = `✅ Downloaded ${fname}`;
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = `Error: ${err.message}`; status.classList.add("err"); }
  }
}
