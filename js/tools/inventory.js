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

/** The item list, in the order the UDQ lists it. */
function _invRows(data) {
  return (data.items || []).slice();
}

/** Vendor / PO # as one cell — either alone, or "PO — Vendor". */
function _invVendorCell(k) {
  return [k.purchase_order, k.vendor].filter(Boolean).join(" — ");
}

/* Build the OOXML parts for the Inventory Sheet workbook. Pure function. */
function _invXlsxParts(data, opts) {
  opts = opts || {};
  const m = data.meta || {};
  const rows = _invRows(data);
  const showVendor = !!opts.vendor;
  const nCols = showVendor ? 8 : 7;

  const S = new _PlSheetWriter();
  const C = (v, s, t) => ({ v, s, t });
  const blank = (s) => ({ v: "", s });
  const pad = (n, s) => { const a = []; for (let i = 0; i < n; i++) a.push(blank(s)); return a; };

  let totalUnits = 0;
  rows.forEach(k => totalUnits += (toFloat(k.units) || 0));

  // Title band
  S.addRow([C("TRLS II", PLS.brand)].concat(pad(3, PLS.bandBlank),
            [C("INVENTORY SHEET", PLS.titleR)], pad(nCols - 5, PLS.bandBlank)), 26);
  S.merge(1, 1, 1, 4); S.merge(1, 5, 1, nCols);
  S.addRow([C("TechTrans International", PLS.subL)].concat(pad(3, PLS.bandBlank),
            [C(`${m.wmtr || ""}  ·  ${_plToday()}`, PLS.subR)], pad(nCols - 5, PLS.bandBlank)), 16);
  S.merge(2, 1, 2, 4); S.merge(2, 5, 2, nCols);

  S.addRow([]); // spacer

  // Summary
  S.addRow([C("LINE ITEMS", PLS.chipK), null, C("TOTAL UNITS EXPECTED", PLS.chipK), null,
            C("WMTR NUMBER", PLS.chipK), null]);
  const rSL = S.lastRow(); S.merge(rSL, 1, rSL, 2); S.merge(rSL, 3, rSL, 4); S.merge(rSL, 5, rSL, nCols);
  S.addRow([C(rows.length, PLS.chipV), null, C(Math.trunc(totalUnits), PLS.chipV), null,
            C(m.wmtr || "", PLS.chipV), null]);
  const rSV = S.lastRow(); S.merge(rSV, 1, rSV, 2); S.merge(rSV, 3, rSV, 4); S.merge(rSV, 5, rSV, nCols);

  S.addRow([]); // spacer

  S.addRow([C("EXPECTED INVENTORY — RECORD RECEIPT BELOW", PLS.section)]);
  const rSec = S.lastRow(); S.merge(rSec, 1, rSec, nCols);

  // Header row
  const head = [C("#", PLS.thC), C("Description", PLS.thL), C("Model #", PLS.thL)];
  if (showVendor) head.push(C("Vendor / PO #", PLS.thL));
  head.push(C("Qty", PLS.thC), C("U/I", PLS.thC), C("RC/RCR #", PLS.thC), C("Date Arrived", PLS.thC));
  S.addRow(head);

  if (rows.length) {
    rows.forEach((k, i) => {
      const r = [C(i + 1, PLS.tdNum), C(k.desc, PLS.tdL), C(k.model, PLS.tdL)];
      if (showVendor) r.push(C(_invVendorCell(k), PLS.tdL));
      // The last two cells stay empty on purpose — the warehouse writes in the
      // receipt number and the arrival date.
      r.push(C(toFloat(k.units) || 0, PLS.tdR), C(k.uom, PLS.tdC),
             blank(PLS.tdC), blank(PLS.tdC));
      S.addRow(r);
    });
  } else {
    S.addRow([C("No inventory items in this UDQ.", PLS.tdC)]);
    const rn = S.lastRow(); S.merge(rn, 1, rn, nCols);
  }

  S.addRow([]);
  S.addRow([C("Prepared by TechTrans International (TTI) on behalf of the Defense Threat Reduction Agency (DTRA). Warehouse use — record the warehouse receipt number and arrival date for each line as material is received.", PLS.boiler)], 30);
  const rPrep = S.lastRow(); S.merge(rPrep, 1, rPrep, nCols);

  const cols = showVendor
    ? [{ min:1,max:1,w:5 }, { min:2,max:2,w:40 }, { min:3,max:3,w:16 }, { min:4,max:4,w:20 },
       { min:5,max:5,w:8 }, { min:6,max:6,w:8 }, { min:7,max:7,w:16 }, { min:8,max:8,w:14 }]
    : [{ min:1,max:1,w:5 }, { min:2,max:2,w:46 }, { min:3,max:3,w:18 },
       { min:4,max:4,w:8 }, { min:5,max:5,w:8 }, { min:6,max:6,w:16 }, { min:7,max:7,w:14 }];
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
  parts["xl/styles.xml"] = _plXlsxStyles();
  parts["xl/worksheets/sheet1.xml"] = sheetXml;
  return parts;
}

/* Browser entry point — wired to the Inventory Sheet button on the PL panel.
   Reports into the PL panel's own status line.

   No atlasGenerateGate() call here on purpose: the hard-block validation guards
   export/shipping paperwork (ECCN vs. license, HTS, hazmat and the like). This
   sheet carries none of those fields — it's an internal receiving list of what
   the warehouse should expect — so missing compliance data must not stop it. */
async function generateInvXlsx() {
  const status = document.getElementById("plStatus");
  if (status) { status.classList.remove("err"); status.textContent = "Building Inventory Sheet…"; }
  try {
    if (typeof JSZip === "undefined") throw new Error("JSZip is not available");
    const data = AppState.data;
    const parts = _invXlsxParts(data, { vendor: false });
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
