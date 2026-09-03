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

/* Build the OOXML parts for the Inventory Sheet workbook. Pure function.
   opts.writeIn adds the blank RC/RCR # and Date Arrived columns. */
function _invXlsxParts(data, opts) {
  const writeIn = !!(opts && opts.writeIn);
  const m = data.meta || {};
  const rows = _invRows(data);
  const nCols = writeIn ? 8 : 6;
  const half = nCols / 2;
  const ST = _invXlsxStyles();

  const S = new _PlSheetWriter();
  const C = (v, s, t) => ({ v, s, t });
  const blank = (s) => ({ v: "", s });
  const pad = (n, s) => { const a = []; for (let i = 0; i < n; i++) a.push(blank(s)); return a; };

  let totalUnits = 0, totalRecv = 0;
  rows.forEach(k => { totalUnits += k.req; totalRecv += k.recv; });

  // Title band
  S.addRow([C("TRLS II", PLS.brand)].concat(pad(half - 1, PLS.bandBlank),
            [C("INVENTORY SHEET", PLS.titleR)], pad(half - 1, PLS.bandBlank)), 26);
  S.merge(1, 1, 1, half); S.merge(1, half + 1, 1, nCols);
  S.addRow([C("TechTrans International", PLS.subL)].concat(pad(half - 1, PLS.bandBlank),
            [C(`${m.wmtr || ""}  ·  ${_plToday()}`, PLS.subR)], pad(half - 1, PLS.bandBlank)), 16);
  S.merge(2, 1, 2, half); S.merge(2, half + 1, 2, nCols);

  S.addRow([]); // spacer

  // Summary — label/value pairs, two columns each. The WMTR pair only fits when
  // the write-in columns widen the sheet to eight; it's in the title band anyway.
  const sum = [["LINE ITEMS", rows.length],
               ["TOTAL QTY REQUESTED", Math.trunc(totalUnits)],
               ["TOTAL QTY RECEIVED", Math.trunc(totalRecv)]];
  if (writeIn) sum.push(["WMTR NUMBER", m.wmtr || ""]);
  const sumRow = (pick, style) => {
    const cells = [];
    sum.forEach(p => { cells.push(C(pick(p), style)); cells.push(null); });
    S.addRow(cells);
    const r = S.lastRow();
    sum.forEach((p, i) => S.merge(r, i * 2 + 1, r, i * 2 + 2));
  };
  sumRow(p => p[0], PLS.chipK);
  sumRow(p => p[1], PLS.chipV);

  S.addRow([]); // spacer

  S.addRow([C(writeIn ? "EXPECTED INVENTORY — RECORD RECEIPT BELOW" : "INVENTORY STATUS", PLS.section)]);
  const rSec = S.lastRow(); S.merge(rSec, 1, rSec, nCols);

  // Header row
  const head = [C("#", PLS.thC), C("Description", PLS.thL), C("Model #", PLS.thL),
                C("U/I", PLS.thC), C("Qty Requested", PLS.thC), C("Qty Received", PLS.thC)];
  if (writeIn) head.push(C("RC/RCR #", PLS.thC), C("Date Arrived", PLS.thC));
  S.addRow(head);

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
      const r = [C(i + 1, PLS.tdNum), C(k.desc, PLS.tdL), C(k.model, PLS.tdL),
                 C(k.uom, PLS.tdC), C(req, PLS.tdR), recvCell];
      // These two stay empty on purpose — the warehouse writes in the receipt
      // number and the arrival date by hand.
      if (writeIn) r.push(blank(PLS.tdC), blank(PLS.tdC));
      S.addRow(r);
    });
  } else {
    S.addRow([C("No inventory items in this UDQ.", PLS.tdC)]);
    const rn = S.lastRow(); S.merge(rn, 1, rn, nCols);
  }

  S.addRow([]);
  S.addRow([C(INV_FOOTER(writeIn), PLS.boiler)], 30);
  const rPrep = S.lastRow(); S.merge(rPrep, 1, rPrep, nCols);

  const cols = [
    { min:1,max:1,w:5 }, { min:2,max:2,w:46 }, { min:3,max:3,w:18 }, { min:4,max:4,w:8 },
    { min:5,max:5,w:15 }, { min:6,max:6,w:15 },
  ];
  if (writeIn) cols.push({ min:7,max:7,w:16 }, { min:8,max:8,w:14 });
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

/* ── Preview (HTML mirror of the generated workbook) ─────────────────────────
   The panel shows this before anything is downloaded, so the sheet can be
   checked — and the write-in columns toggled — first. */

/** Footer text, shared by the preview and the workbook so they can't drift. */
function INV_FOOTER(writeIn) {
  return "Prepared by TechTrans International (TTI) on behalf of the Defense " +
    "Threat Reduction Agency (DTRA). Quantities received are green when the " +
    "full requested quantity has arrived and red when the counts don't match; " +
    "a blank means nothing has been received against that line yet." +
    (writeIn ? " Record the warehouse receipt number and arrival date for each " +
      "line as material is received." : "");
}

function invRenderHtml(data, opts) {
  const writeIn = !!(opts && opts.writeIn);
  const m = data.meta || {};
  const rows = _invRows(data);
  const nCols = writeIn ? 8 : 6;

  let totalUnits = 0, totalRecv = 0;
  rows.forEach(k => { totalUnits += k.req; totalRecv += k.recv; });

  const body = rows.length
    ? rows.map((k, i) => {
        // Same rule as the workbook: nothing received reads as blank, a match is
        // dark green, anything else (short or over) is red.
        const recv = k.recv
          ? `<td class="inv-mono r ${k.recv === k.req ? "ok" : "bad"}">${esc(Math.trunc(k.recv))}</td>`
          : `<td class="inv-mono r"></td>`;
        return `<tr>
          <td class="inv-num">${i + 1}</td>
          <td>${esc(k.desc)}</td>
          <td class="inv-mono">${esc(k.model)}</td>
          <td class="c">${esc(k.uom)}</td>
          <td class="inv-mono r">${esc(Math.trunc(k.req))}</td>
          ${recv}
          ${writeIn ? `<td class="inv-fill"></td><td class="inv-fill"></td>` : ""}
        </tr>`;
      }).join("")
    : `<tr><td colspan="${nCols}" class="inv-none">No inventory items in this UDQ.</td></tr>`;

  const chips = [
    [rows.length, "Line items"],
    [Math.trunc(totalUnits).toLocaleString("en-US"), "Total qty requested"],
    [Math.trunc(totalRecv).toLocaleString("en-US"), "Total qty received"],
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><title>Inventory Sheet</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${INV_CSS}</style></head><body>
<div class="inv-doc">
  <div class="inv-head">
    <div class="inv-brand">
      <span class="inv-brand-1">TRLS II</span>
      <span class="inv-brand-2">TechTrans International</span>
    </div>
    <div class="inv-ttl"><h1>Inventory Sheet</h1>
      <div class="sub"><b>${esc(m.wmtr || "")}</b> · ${esc(_plToday())}</div></div>
  </div>

  <div class="inv-chips">
    ${chips.map(c => `<div class="chip"><div class="v">${esc(c[0])}</div><div class="k">${esc(c[1])}</div></div>`).join("")}
  </div>

  <div class="inv-body">
    <div class="inv-sec">${writeIn ? "Expected inventory — record receipt below" : "Inventory status"}</div>
    <table class="inv-items">
      <colgroup><col style="width:40px"><col><col style="width:17%"><col style="width:7%">
        <col style="width:13%"><col style="width:13%">
        ${writeIn ? `<col style="width:14%"><col style="width:13%">` : ""}</colgroup>
      <thead><tr>
        <th class="inv-num">#</th><th>Description</th><th>Model&nbsp;#</th>
        <th class="c">U/I</th><th class="r">Qty Requested</th><th class="r">Qty Received</th>
        ${writeIn ? `<th class="c inv-fill-h">RC/RCR&nbsp;#</th><th class="c inv-fill-h">Date Arrived</th>` : ""}
      </tr></thead><tbody>${body}</tbody></table>
  </div>

  <div class="inv-foot"><div class="inv-prep">${esc(INV_FOOTER(writeIn))}</div></div>
</div>
</body></html>`;
}

const INV_CSS = `
:root{
  --ink:#16283C; --ink-2:#23364D; --steel:#5B6B7C; --paper:#EFF1F3;
  --line:#D4DAE0; --line-soft:#E7EBEF; --accent:#E8590C; --fill:#FFF8F0;
  --ok:#1B6B34; --bad:#B3261E;
  --disp:"Barlow Condensed","Arial Narrow",Arial,sans-serif;
  --body:-apple-system,"Segoe UI",system-ui,Roboto,Arial,sans-serif;
  --mono:"IBM Plex Mono",Consolas,monospace;
}
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--paper); }
body{ font-family:var(--body); color:var(--ink); padding:18px 14px 40px; }
.inv-doc{ max-width:860px; margin:0 auto; background:#fff; border:1px solid var(--line);
  border-radius:10px; overflow:hidden; box-shadow:0 10px 30px rgba(22,40,60,.10); }

.inv-head{ background:var(--ink); color:#fff; display:flex; align-items:center;
  justify-content:space-between; gap:20px; padding:18px 24px; border-bottom:3px solid var(--accent); }
.inv-brand{ display:flex; flex-direction:column; line-height:1; }
.inv-brand-1{ font-family:var(--disp); font-weight:700; font-size:30px; letter-spacing:2px; }
.inv-brand-2{ font-family:var(--disp); font-weight:500; font-size:12px; letter-spacing:3px;
  text-transform:uppercase; color:#9FB0C2; margin-top:5px; }
.inv-ttl{ text-align:right; }
.inv-ttl h1{ font-family:var(--disp); font-weight:700; letter-spacing:3px; text-transform:uppercase;
  font-size:32px; margin:0; line-height:.95; }
.inv-ttl .sub{ font-family:var(--mono); font-size:11px; color:#9FB0C2; letter-spacing:1px; margin-top:5px; }
.inv-ttl .sub b{ color:#fff; font-weight:600; }

.inv-chips{ display:grid; grid-template-columns:repeat(3,1fr); border-bottom:1px solid var(--line); }
.inv-chips .chip{ padding:12px 18px; border-right:1px solid var(--line-soft); }
.inv-chips .chip:last-child{ border-right:0; }
.inv-chips .v{ font-family:var(--mono); font-weight:600; font-size:17px; }
.inv-chips .k{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1.5px;
  font-size:10.5px; color:var(--steel); margin-top:1px; }

.inv-body{ padding:20px 24px 10px; }
.inv-sec{ font-family:var(--disp); text-transform:uppercase; letter-spacing:2px; font-size:13px;
  color:var(--steel); font-weight:600; display:flex; align-items:center; gap:10px; margin:2px 0 14px; }
.inv-sec::after{ content:""; flex:1; height:1px; background:var(--line-soft); }

table.inv-items{ width:100%; border-collapse:collapse; table-layout:fixed; border:1px solid var(--line); }
table.inv-items th{ font-family:var(--disp); text-transform:uppercase; letter-spacing:1px; font-size:10px;
  color:var(--steel); text-align:left; padding:8px 12px; border-bottom:1px solid var(--line);
  background:#F7F9FB; font-weight:600; }
table.inv-items td{ padding:9px 12px; font-size:12.5px; border-bottom:1px solid var(--line-soft);
  vertical-align:top; word-wrap:break-word; overflow-wrap:break-word; }
table.inv-items tr:last-child td{ border-bottom:0; }
table.inv-items tbody tr:nth-child(even) td{ background:#FCFDFE; }
.inv-num{ width:40px; }
table.inv-items td.inv-num{ font-family:var(--mono); color:var(--steel); }
.inv-mono{ font-family:var(--mono); font-size:11.5px; }
table.inv-items .c{ text-align:center; }
table.inv-items .r{ text-align:right; }
table.inv-items td.ok{ color:var(--ok); font-weight:700; }
table.inv-items td.bad{ color:var(--bad); font-weight:700; }
.inv-none{ text-align:center; color:#9aa6b2; font-style:italic; padding:18px; }

table.inv-items th.inv-fill-h{ background:var(--fill); color:var(--accent); border-left:1px solid var(--line); }
table.inv-items td.inv-fill{ background:var(--fill) !important; border-left:1px solid var(--line); }
table.inv-items th.inv-fill-h + th.inv-fill-h,
table.inv-items td.inv-fill + td.inv-fill{ border-left:1px solid var(--line-soft); }

.inv-foot{ padding:12px 24px 20px; border-top:2px solid var(--ink); margin-top:10px; }
.inv-prep{ font-size:11px; color:var(--steel); font-style:italic; }
@media (max-width:600px){ .inv-chips{ grid-template-columns:1fr; } }
`;

/* ── Panel ───────────────────────────────────────────────────────────────────
   One component, two hosts: appended under the Packing List panel on shipping
   UDQs (where the write-in columns are offered), and the whole workspace on
   property UDQs (where they aren't — a PR sheet is a status report). */

function _invStatusEl() { return document.getElementById("invStatus"); }

/** Current options. The checkbox only exists on the shipping panel. */
function invOptionsFromForm() {
  const cb = document.getElementById("invWriteIn");
  return { writeIn: !!(cb && cb.checked) };
}

function _invBuildPanel(o) {
  const rows = _invRows(AppState.data);
  const recvLines = rows.filter(k => k.recv).length;

  const toggle = o.showWriteIn ? `
    <div class="field" style="max-width:340px">
      <label for="invWriteIn">Warehouse write-in columns</label>
      <select id="invWriteIn-sel" data-fc-skip>
        <option value="yes" selected>Include RC/RCR # and Date Arrived</option>
        <option value="no">Leave them off (status only)</option>
      </select>
    </div>` : "";

  const panel = el(`
    <div class="panel" id="invPanel">
      <header>
        <h2>Inventory Sheet</h2>
        <span class="count">${esc(o.badge)}</span>
      </header>
      <div class="body">
        <div class="note">
          ${esc(o.blurb)}
          Every inventory item on this request, showing
          <strong>Qty Requested</strong> against <strong>Qty Received</strong> —
          dark green when they match, red when they don't, blank when nothing has
          arrived yet. ${rows.length} item(s); ${recvLines} show a received quantity.
        </div>
        ${toggle ? `<div class="formgrid">${toggle}</div>` : ""}
        <div class="btnrow">
          <button class="btn navy" id="invExcel">Download Excel (.xlsx)</button>
          <button class="btn ghost" id="invRefresh">Refresh preview</button>
          <span class="statusline" id="invStatus"></span>
        </div>
        <div class="previewwrap"><iframe id="invPreview" title="Inventory Sheet preview"></iframe></div>
      </div>
    </div>`);

  // The <select> carries the state; a hidden checkbox keeps invOptionsFromForm
  // simple and lets the workbook and preview read the same flag.
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.id = "invWriteIn"; cb.checked = !!o.showWriteIn; cb.hidden = true;
  panel.appendChild(cb);

  panel.querySelector("#invExcel").addEventListener("click", generateInvXlsx);
  panel.querySelector("#invRefresh").addEventListener("click", updateInvPreview);
  const sel = panel.querySelector("#invWriteIn-sel");
  if (sel) sel.addEventListener("change", () => {
    cb.checked = sel.value === "yes";
    updateInvPreview();
  });
  return panel;
}

function updateInvPreview() {
  const iframe = document.getElementById("invPreview");
  if (!iframe) return;
  iframe.srcdoc = invRenderHtml(AppState.data, invOptionsFromForm());
  const status = _invStatusEl();
  if (status && !status.classList.contains("err")) {
    status.textContent = `Preview · ${_invRows(AppState.data).length} item(s)`;
  }
  iframe.addEventListener("load", () => {
    try { iframe.contentDocument.body.style.background = "transparent"; } catch (e) { /* ignore */ }
  }, { once: true });
}

/* Shipping (SRF): the Packing List panel's navy button opens this below it. */
function invShowPanel() {
  const ws = document.getElementById("workspace");
  if (!ws) return;
  let panel = document.getElementById("invPanel");
  if (!panel) {
    panel = _invBuildPanel({
      badge: AppState.data.meta.wmtr || "",
      blurb: "A receiving sheet for the warehouse, separate from the Packing List above.",
      showWriteIn: true,
    });
    ws.appendChild(panel);
  }
  updateInvPreview();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Property (PR): the sheet IS the workspace. No write-in columns — this one is
   a status report of what has arrived, not a form to fill in by hand. */
function renderInvPrWorkspace(container) {
  container.appendChild(_invBuildPanel({
    badge: AppState.data.meta.wmtr || "Property UDQ",
    blurb: "The same sheet the Packing List window produces for shipping requests, " +
           "built from this Property Management UDQ instead.",
    showWriteIn: false,
  }));
  updateInvPreview();
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
    const parts = _invXlsxParts(data, invOptionsFromForm());
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
