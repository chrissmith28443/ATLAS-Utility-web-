/* =========================================================================
   ATLAS Utility Web — tools/pl.js  (v1.3)

   Manipulates the .xlsx zip at the XML level using JSZip.
   All styles/merges/fonts stay intact.

   Row insertion strategy (avoids duplicate-row corruption):
     1. All edits at original template row numbers first.
     2. Inserted rows get TEMPORARY high row numbers (9000, 9001, …)
        so they never collide with existing rows.
     3. After all insertions, a single sequential renumber pass walks
        the XML in document order and assigns r=1,2,3,… to every <row>,
        also updating the cell addresses inside each row.
     4. Merge ranges and <dimension> are updated based on final row count.
   ========================================================================= */

/* ── UI ──────────────────────────────────────────────────────────────────── */

function renderPlWorkspace(container) {
  const m = AppState.data.meta;
  const signerOpts = ['<option value="">(leave blank)</option>']
    .concat(SIGNERS.map((s, i) =>
      `<option value="${i}">${esc(s.name)} — ${esc(s.title)}</option>`))
    .join("");

  const panel = el(`
    <div class="panel">
      <header>
        <h2>Packing List</h2>
        <span class="count">${esc(m.wmtr)}</span>
      </header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="plUnit">Unit system</label>
            <select id="plUnit">
              <option value="imperial" selected>Imperial (lbs / in)</option>
              <option value="metric">Metric (kg / cm)</option>
            </select>
          </div>
          <div class="field">
            <label for="plSigner">Printed name / signer</label>
            <select id="plSigner">${signerOpts}</select>
          </div>
        </div>
        <div class="btnrow">
          <button class="btn primary" id="plGenerate">Download Packing List (.xlsx)</button>
          <button class="btn primary" id="plPrint">Save as PDF</button>
          <button class="btn ghost" id="plRefresh">Refresh preview</button>
          <span class="statusline" id="plStatus"></span>
        </div>
        <div class="note">
          Generates a filled <strong>PL_${esc(m.wmtr_last5 || "UDQ")}_….xlsx</strong> using
          ${AppState.data.packages.length} package row(s) and
          ${AppState.data.items.length} inventory item(s) from the loaded UDQ.
          The preview below updates as you change the unit system or signer.
        </div>

        <div class="previewwrap"><iframe id="plPreview" title="Packing List preview"></iframe></div>
      </div>
    </div>`);

  container.appendChild(panel);
  panel.querySelector("#plGenerate").addEventListener("click", generatePl);
  panel.querySelector("#plPrint").addEventListener("click", printPl);

  const refresh = () => updatePlPreview();
  panel.querySelector("#plUnit").addEventListener("change", refresh);
  panel.querySelector("#plSigner").addEventListener("change", refresh);
  panel.querySelector("#plRefresh").addEventListener("click", refresh);

  updatePlPreview();
}

/* ── Live preview (HTML mirror of the generated .xlsx) ───────────────────── */

/** Today's date formatted DD-Mon-YYYY, matching the generated workbook. */
function _plToday() {
  const d = new Date();
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}-${MON[d.getMonth()]}-${d.getFullYear()}`;
}

/** Read the current form selections. */
function plOptionsFromForm() {
  const unitSystem = (document.getElementById("plUnit") || {}).value || "imperial";
  const signerIdx = (document.getElementById("plSigner") || {}).value;
  let printedName = "";
  if (signerIdx !== "" && signerIdx != null) {
    const sg = SIGNERS[Number(signerIdx)];
    if (sg) printedName = `${sg.name}, ${sg.title}`;
  }
  return { unitSystem, printedName };
}

/**
 * Convert one package to display values using the SAME math as _plFillPkgRow,
 * so the preview matches the downloaded workbook exactly.
 */
function _plPkgDisplay(pkg, pkgNo, unitSystem) {
  const desc = _plStripParens(pkg.description || "");
  const count = pkg.count || 1;
  const uoi = pkg.uoi || "";

  const wLbs = toFloat(pkg.weight_lbs), wKg = toFloat(pkg.weight_kg);
  let outWt = unitSystem === "imperial"
    ? (wLbs || (wKg ? wKg / 0.45359237 : null))
    : (wKg  || (wLbs ? wLbs * 0.45359237 : null));
  const wt = outWt != null
    ? (Math.round(outWt * 100) / 100).toLocaleString("en-US")
    : "";

  let L = "", W = "", H = "";
  const dims = _plParseDims(pkg.dims || "");
  if (dims) {
    const Lin = _plToIn(dims.L, dims.unit);
    const Win = _plToIn(dims.W, dims.unit);
    const Hin = _plToIn(dims.H, dims.unit);
    const [oL, oW, oH] = unitSystem === "imperial"
      ? [Lin, Win, Hin] : [Lin * 2.54, Win * 2.54, Hin * 2.54];
    L = Math.round(oL * 100) / 100;
    W = Math.round(oW * 100) / 100;
    H = Math.round(oH * 100) / 100;
  }
  return { pkgNo, desc, count, uoi, wt, L, W, H };
}

/** Build the printable HTML for the Packing List preview. */
function plRenderHtml(data, opts) {
  const m = data.meta;
  const raw = m.totals_raw || {};
  const unitSystem = opts.unitSystem;
  const wUnit = unitSystem === "imperial" ? "lbs" : "kg";
  const dUnit = unitSystem === "imperial" ? "in" : "cm";

  const dateStr = _plToday();

  const pickup = _plPartyBlock(data.parties.pickup);
  const deliver = _plPartyBlock(data.parties.deliver);

  const pkgRows = data.packages.map((pk, i) => {
    const d = _plPkgDisplay(pk, i + 1, unitSystem);
    return `<tr>
      <td class="c">${esc(d.pkgNo)}</td>
      <td>${esc(d.desc)}</td>
      <td class="c">${esc(d.count)}</td>
      <td class="c">${esc(d.uoi)}</td>
      <td class="r">${esc(d.wt)}</td>
      <td class="r">${esc(d.L)}</td>
      <td class="r">${esc(d.W)}</td>
      <td class="r">${esc(d.H)}</td>
    </tr>`;
  }).join("");

  const itemRows = data.items.map((it) => `
    <tr>
      <td>${esc(it.desc)}</td>
      <td class="c">${esc(it.model)}</td>
      <td class="c">${esc(it.hts)}</td>
      <td class="c">${esc(it.units)}</td>
      <td class="c">${esc(it.uom)}</td>
    </tr>`).join("");

  const cube  = _plFmtVol(raw.udq_ft3 || 0);
  const gross = _plFmtWt(raw.udq_lbs || 0);
  const pkgCount = data.packages.length;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing List</title>
<style>${PL_CSS}</style></head><body>
<div class="pl-page">
  <div class="pl-head">
    <div class="pl-company">TRLS II<br/>TechTrans International (TTI)</div>
    <div class="pl-title">PACKING LIST</div>
  </div>

  <div class="pl-locs">
    <div class="pl-loc"><div class="lbl">Pickup Location</div><div class="val">${escBr(pickup)}</div></div>
    <div class="pl-loc"><div class="lbl">Deliver To Location</div><div class="val">${escBr(deliver)}</div></div>
  </div>

  <div class="pl-meta">
    <div class="m"><div class="lbl">Packing List Date</div><div class="val">${esc(dateStr)}</div></div>
    <div class="m"><div class="lbl">WMTR Number</div><div class="val">${esc(m.wmtr)}</div></div>
    <div class="m prep"><div class="val">Prepared by TechTrans Intl on behalf of the Defense Threat Reduction Agency (DTRA)</div></div>
  </div>

  <table class="pl-tbl pl-pkg">
    <thead><tr>
      <th class="c">PKG #</th><th>DESCRIPTION</th><th class="c">QTY</th><th class="c">U/I</th>
      <th class="r">WEIGHT (${wUnit})</th><th class="r">LN (${dUnit})</th><th class="r">WD (${dUnit})</th><th class="r">HT (${dUnit})</th>
    </tr></thead>
    <tbody>${pkgRows || `<tr><td colspan="8" class="empty">No package rows</td></tr>`}</tbody>
  </table>

  <table class="pl-tbl pl-inv">
    <thead><tr>
      <th>Description</th><th class="c">Model #</th><th class="c">HS Code</th><th class="c">Qty</th><th class="c">U/I</th>
    </tr></thead>
    <tbody>${itemRows || `<tr><td colspan="5" class="empty">No inventory items</td></tr>`}</tbody>
  </table>

  <div class="pl-footer">
    <div class="pl-totals">
      <div><span class="lbl">Tot No Packages:</span> <span class="val">${esc(pkgCount)}</span></div>
      <div><span class="lbl">Cube:</span> <span class="val">${esc(cube)}</span></div>
      <div><span class="lbl">Net:</span> <span class="val"></span></div>
      <div><span class="lbl">Tare:</span> <span class="val"></span></div>
      <div><span class="lbl">Gross:</span> <span class="val">${esc(gross)}</span></div>
    </div>
    <div class="pl-auth">
      <div class="arow"><span class="lbl">Authorized By:</span><span class="line"></span></div>
      <div class="arow"><span class="lbl">Printed Name:</span><span class="val">${esc(opts.printedName)}</span></div>
      <div class="arow"><span class="lbl">Date:</span><span class="val">${esc(dateStr)}</span></div>
    </div>
  </div>

  <div class="pl-boiler">These items are controlled by the U.S. government and authorized for export only to the country of ultimate destination for use by the ultimate consignee or end-user(s) herein identified. They may not be resold, transferred, or otherwise disposed of, to any other country or to any person other than the authorized ultimate consignee without first obtaining approval from the U.S. government or as otherwise authorized by U.S. law and regulations.</div>
</div>
</body></html>`;
}

function updatePlPreview() {
  const iframe = document.getElementById("plPreview");
  if (!iframe) return;
  const opts = plOptionsFromForm();
  iframe.srcdoc = plRenderHtml(AppState.data, opts);
  const status = document.getElementById("plStatus");
  if (status && !status.classList.contains("err")) {
    status.textContent =
      `Preview · ${AppState.data.packages.length} package row(s) · ${AppState.data.items.length} item(s)`;
  }
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      doc.body.style.background = "transparent";
    } catch (e) { /* ignore */ }
  }, { once: true });
}

/** Filename stem for the PDF, mirroring the .xlsx naming. */
function plDocTitle() {
  const last5 = AppState.data.meta.wmtr_last5 || "UDQ";
  return `PL_${last5}_${fileStamp()}`;
}

/**
 * Open the rendered Packing List in a new window and trigger the browser's
 * print dialog. Choosing "Save as PDF" there produces a PDF that matches the
 * on-screen preview (same HTML, with the print @page rules in PL_CSS applied).
 */
function printPl() {
  const status = document.getElementById("plStatus");
  const html = plRenderHtml(AppState.data, plOptionsFromForm());
  const docTitle = plDocTitle();

  const w = window.open("", "_blank");
  if (!w) {
    if (status) {
      status.textContent =
        "Pop-up blocked — allow pop-ups for this page, then click Save as PDF again.";
      status.classList.add("err");
    }
    return;
  }
  if (status) { status.classList.remove("err"); status.textContent = "Opening print dialog…"; }

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = docTitle;
  // Give the browser a beat to lay out fonts/tables, then print.
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

const PL_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#000; }
.pl-page{
  box-sizing:border-box;
  width:760px;
  margin:0 auto;
  background:#fff;
  box-shadow:0 0 10px rgba(0,0,0,0.25);
  padding:22px 24px 26px;
}
.pl-head{
  display:flex; align-items:center; justify-content:space-between;
  border:1px solid #000;
}
.pl-company{
  font-weight:bold; font-size:9pt; line-height:1.2;
  padding:8px 10px; border-right:1px solid #000; flex:1;
}
.pl-title{
  font-size:16pt; font-weight:bold; letter-spacing:1px;
  padding:8px 16px; flex:1; text-align:center;
}
.pl-locs{ display:grid; grid-template-columns:1fr 1fr; border:1px solid #000; border-top:0; }
.pl-loc + .pl-loc{ border-left:1px solid #000; }
.pl-loc .lbl{ background:#e9edf1; font-weight:bold; font-size:8pt; padding:3px 6px; border-bottom:1px solid #000; }
.pl-loc .val{ padding:6px; font-size:8pt; line-height:1.25; min-height:64px; white-space:pre-line; }
.pl-meta{ display:grid; grid-template-columns:1fr 1fr 2fr; border:1px solid #000; border-top:0; }
.pl-meta .m{ display:flex; flex-direction:column; }
.pl-meta .m + .m{ border-left:1px solid #000; }
.pl-meta .lbl{ background:#e9edf1; font-weight:bold; font-size:8pt; padding:3px 6px; border-bottom:1px solid #000; }
.pl-meta .val{ padding:4px 6px; font-size:8pt; }
.pl-meta .prep .val{ font-style:italic; font-size:7.5pt; line-height:1.2; }
.pl-tbl{ width:100%; border-collapse:collapse; table-layout:fixed; margin-top:10px; }
.pl-tbl th{
  background:#e9edf1; border:1px solid #000; padding:4px 5px;
  font-size:7.5pt; font-weight:bold; text-align:left; vertical-align:middle;
}
.pl-tbl td{
  border:1px solid #000; padding:3px 5px; font-size:7.5pt;
  vertical-align:top; word-wrap:break-word; overflow-wrap:break-word;
}
.pl-tbl .c{ text-align:center; }
.pl-tbl .r{ text-align:right; }
.pl-tbl .empty{ text-align:center; color:#888; font-style:italic; }
.pl-pkg th:nth-child(1),.pl-pkg td:nth-child(1){ width:7%; }
.pl-pkg th:nth-child(3),.pl-pkg td:nth-child(3){ width:7%; }
.pl-pkg th:nth-child(4),.pl-pkg td:nth-child(4){ width:7%; }
.pl-pkg th:nth-child(n+5),.pl-pkg td:nth-child(n+5){ width:11%; }
.pl-inv th:nth-child(2),.pl-inv td:nth-child(2){ width:16%; }
.pl-inv th:nth-child(3),.pl-inv td:nth-child(3){ width:14%; }
.pl-inv th:nth-child(4),.pl-inv td:nth-child(4){ width:8%; }
.pl-inv th:nth-child(5),.pl-inv td:nth-child(5){ width:8%; }
.pl-footer{ display:grid; grid-template-columns:1fr 1fr; gap:0; margin-top:12px; border:1px solid #000; }
.pl-totals{ padding:8px 10px; border-right:1px solid #000; font-size:8pt; line-height:1.9; }
.pl-totals .lbl{ font-weight:bold; display:inline-block; min-width:120px; }
.pl-auth{ padding:8px 10px; font-size:8pt; }
.pl-auth .arow{ display:flex; align-items:flex-end; gap:6px; margin-bottom:10px; }
.pl-auth .lbl{ font-weight:bold; white-space:nowrap; }
.pl-auth .line{ flex:1; border-bottom:1px solid #000; height:1em; }
.pl-auth .val{ flex:1; border-bottom:1px solid #000; min-height:1em; }
.pl-boiler{
  margin-top:10px; border:1px solid #000; padding:8px 10px;
  font-size:7pt; line-height:1.25; text-align:justify;
}

/* ── Print / PDF (Save as PDF uses these) ─────────────────────────────── */
@page{ size: 8.5in 11in; margin: 0.5in; }
@media print{
  html,body{ margin:0; padding:0; background:#fff; }
  .pl-page{
    width:auto;
    margin:0;
    padding:0;
    box-shadow:none;
  }
  /* Repeat the column headers on every printed page of a long table */
  .pl-tbl thead{ display:table-header-group; }
  .pl-tbl tr{ page-break-inside:avoid; }
  /* Keep the summary blocks intact across page breaks */
  .pl-footer, .pl-boiler{ page-break-inside:avoid; }
  .pl-head, .pl-locs, .pl-meta{ page-break-inside:avoid; }
}
`;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function _plStripParens(s) {
  return (s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
}
function _plFmtVol(ft3) {
  if (!ft3) return "";
  return `${ft3.toFixed(2)} ft\u00B3 (${(ft3 * 0.0283168466).toFixed(2)} m\u00B3)`;
}
function _plFmtWt(lbs) {
  if (!lbs) return "";
  return `${lbs.toFixed(2)} lbs (${(lbs * 0.45359237).toFixed(2)} kg)`;
}
function _plParseDims(s) {
  s = (s || "").trim();
  const uM = s.match(/\(([^)]+)\)/);
  let unit = uM ? uM[1].trim().toLowerCase() : "in";
  const uMap = {in:"in",inch:"in",inches:"in",cm:"cm",centimeter:"cm",
    centimeters:"cm",mm:"mm",millimeter:"mm",millimeters:"mm",
    ft:"ft",foot:"ft",feet:"ft"};
  unit = uMap[unit] || "in";
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  if (nums.length < 3) return null;
  return {L:parseFloat(nums[0]),W:parseFloat(nums[1]),H:parseFloat(nums[2]),unit};
}
function _plToIn(v, unit) {
  if (unit==="cm") return v/2.54;
  if (unit==="mm") return v/25.4;
  if (unit==="ft") return v*12;
  return v;
}
function _plPartyBlock(party) {
  if (!party) return "";
  const lines = (party.addr_lines||[]).filter(Boolean);
  if (party.country) lines.push(party.country);
  const poc = [party.contact, party.phone, party.email].filter(Boolean);
  if (poc.length) lines.push(...poc);
  return lines.join("\n").trim();
}
function _xmlEsc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── Shared-string table (pure string — no DOMParser/XMLSerializer) ─────── */

function PlStringTable(xml) {
  this._xml   = xml;
  this._map   = {};
  this._count = 0;

  // Parse existing entries: index each <si><t>…</t></si> by its text content
  const siRe = /<si>.*?<\/si>/gs;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tM = m[0].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (tM) this._map[tM[1]] = this._count;
    this._count++;
  }

  this.idx = function(str) {
    if (str in this._map) return this._map[str];
    // Escape XML special chars in the new string value
    const esc = str
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const spaceAttr = (str !== str.trim()) ? ' xml:space="preserve"' : '';
    const newSi = `<si><t${spaceAttr}>${esc}</t></si>`;
    // Insert before </sst>
    this._xml = this._xml.replace("</sst>", newSi + "</sst>");
    this._map[str] = this._count;
    return this._count++;
  };

  this.toXml = function() {
    // Set count and uniqueCount to the actual unique count
    return this._xml
      .replace(/\bcount="\d+"/, `count="${this._count}"`)
      .replace(/\buniqueCount="\d+"/, `uniqueCount="${this._count}"`);
  };
}

/* ── Sheet XML helpers ───────────────────────────────────────────────────── */

/**
 * Find and return the raw XML string for a <row> whose opening tag contains
 * r="N" (with a non-letter character immediately before the r= to avoid
 * matching cell addresses like <c r="A14"> when looking for r="4").
 */
function _plGetRow(xml, r) {
  const rAttr = `r="${r}"`;
  let search = 0;
  while (true) {
    const rowStart = xml.indexOf("<row ", search);
    if (rowStart === -1) return null;
    const tagEnd = xml.indexOf(">", rowStart);
    if (tagEnd === -1) return null;
    const openingTag = xml.slice(rowStart, tagEnd + 1);
    const rIdx = openingTag.indexOf(rAttr);
    if (rIdx !== -1) {
      const charBefore = rIdx > 0 ? openingTag[rIdx - 1] : " ";
      if (!/[A-Za-z]/.test(charBefore)) {
        const rowEnd = xml.indexOf("</row>", tagEnd);
        if (rowEnd === -1) return null;
        return xml.slice(rowStart, rowEnd + 6);
      }
    }
    search = tagEnd + 1;
  }
}

/**
 * Replace the exact occurrence of oldRowXml with newRowXml using indexOf
 * (not .replace(), which treats $ specially).
 */
function _plReplaceExact(xml, oldStr, newStr) {
  const idx = xml.indexOf(oldStr);
  if (idx === -1) return xml;
  return xml.slice(0, idx) + newStr + xml.slice(idx + oldStr.length);
}

/**
 * Set or update a cell in a row XML string.
 * type: "s"=shared-string index | "n"=number | "inline"=multiline text
 * Returns the updated row XML string.
 */
function _plSetCell(rowXml, addr, value, type) {
  let cellContent, typeAttr;
  if (type === "inline") {
    const esc = _xmlEsc(String(value)).replace(/\n/g, "&#10;");
    cellContent = `<is><t xml:space="preserve">${esc}</t></is>`;
    typeAttr    = ` t="inlineStr"`;
  } else if (type === "s") {
    cellContent = `<v>${value}</v>`;
    typeAttr    = ` t="s"`;
  } else {
    cellContent = `<v>${value}</v>`;
    typeAttr    = ``;
  }

  // Find existing cell and extract its s= style
  const cellRe = new RegExp(`<c [^>]*\\br="${addr}"[^>]*(?:/>|>.*?</c>)`, "s");
  const existM = rowXml.match(cellRe);
  let style = "10";
  if (existM) {
    const sm = existM[0].match(/\bs="(\d+)"/);
    if (sm) style = sm[1];
  } else {
    const rm = rowXml.match(/\bs="(\d+)"/);
    if (rm) style = rm[1];
  }

  const newCell = `<c r="${addr}" s="${style}"${typeAttr}>${cellContent}</c>`;
  if (existM) {
    return _plReplaceExact(rowXml, existM[0], newCell);
  } else {
    return rowXml.replace("</row>", newCell + "</row>");
  }
}

/**
 * Clone a row, replacing its r= attribute and all cell addresses with tempR.
 * Use a high tempR (e.g. 9000+) to avoid colliding with existing rows.
 */
function _plCloneRow(xml, srcR, tempR) {
  const src = _plGetRow(xml, srcR);
  if (!src) return null;
  // Update row r= attribute (use function to avoid $1 collision with tempR)
  let clone = src.replace(/(<row [^>]*\br=")(\d+)(")/, (_, a, _r, b) => a + tempR + b);
  // Update all cell addresses in the row
  clone = clone.replace(/\br="([A-Z]+)\d+"/g, (_, col) => `r="${col}${tempR}"`);
  return clone;
}

/**
 * Walk the entire XML in document order, renumbering every <row> element
 * sequentially (1, 2, 3, …). Also updates cell addresses inside each row.
 * Returns the renumbered XML.
 */
function _plRenumberRows(xml) {
  const parts = [];
  let lastEnd  = 0;
  let rCounter = 0;
  let search   = 0;

  while (true) {
    const rowStart = xml.indexOf("<row ", search);
    if (rowStart === -1) { parts.push(xml.slice(lastEnd)); break; }

    const tagEnd = xml.indexOf(">", rowStart);
    if (tagEnd === -1) { parts.push(xml.slice(lastEnd)); break; }

    const rowEnd = xml.indexOf("</row>", tagEnd);
    if (rowEnd === -1) { parts.push(xml.slice(lastEnd)); break; }

    rCounter++;
    const rowXml  = xml.slice(rowStart, rowEnd + 6);
    const origR   = parseInt((xml.slice(rowStart, tagEnd + 1).match(/\br="(\d+)"/) || [,"0"])[1], 10);

    // Update row r= attribute (use function to avoid $1 collision with counter)
    let newRowXml = rowXml.replace(/(<row [^>]*\br=")(\d+)(")/, (_, a, _r, b) => a + rCounter + b);
    // Update all cell addresses if row number changed
    if (origR !== rCounter) {
      newRowXml = newRowXml.replace(/\br="([A-Z]+)\d+"/g, (_, col) => `r="${col}${rCounter}"`);
    }

    parts.push(xml.slice(lastEnd, rowStart));
    parts.push(newRowXml);
    lastEnd = rowEnd + 6;
    search  = rowEnd + 6;
  }

  return parts.join("");
}

/* ── Main generator ──────────────────────────────────────────────────────── */

async function generatePl() {
  const status = document.getElementById("plStatus");
  status.textContent = "Loading…";
  status.classList.remove("err");



  try {
    status.textContent = "Generating…";

    const unitSystem = document.getElementById("plUnit").value;
    const signerIdx  = document.getElementById("plSigner").value;
    const data       = AppState.data;
    const m          = data.meta;
    const raw        = m.totals_raw;
    const packages   = data.packages;
    const items      = data.items;

    /* ── Load template ── */
    const b64 = unitSystem === "metric" ? PL_TEMPLATE_METRIC_B64 : PL_TEMPLATE_IMPERIAL_B64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const zip = await JSZip.loadAsync(bytes);

    let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const st = new PlStringTable(await zip.file("xl/sharedStrings.xml").async("string"));

    /* ── Date & signer ── */
    const today = new Date();
    const MON   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dateStr = `${String(today.getDate()).padStart(2,"0")}-${MON[today.getMonth()]}-${today.getFullYear()}`;
    let printedName = "";
    if (signerIdx !== "") {
      const sg = SIGNERS[Number(signerIdx)];
      printedName = `${sg.name}, ${sg.title}`;
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 1 — Edit all cells at their ORIGINAL template row numbers.
       This must happen before any row insertions so the row numbers
       in the XML still match the template layout.
    ═══════════════════════════════════════════════════════════════════ */

    // Helper: read row, edit cells, write back
    const editRow = (r, fn) => {
      const rx = _plGetRow(xml, r);
      if (!rx) return;
      const updated = fn(rx);
      xml = _plReplaceExact(xml, rx, updated);
    };

    // Row 4: address blocks
    editRow(4, rx => {
      rx = _plSetCell(rx, "A4", _plPartyBlock(data.parties.pickup),  "inline");
      rx = _plSetCell(rx, "O4", _plPartyBlock(data.parties.deliver), "inline");
      // Row height is stored in POINTS. The user's display shows the template's
      // 60pt as 120px (2 px/pt at 150% scaling), so 162px target = 81pt.
      rx = rx.replace(/(<row [^>]*\br="4"[^>]*?)\bht="[\d.]+"/,
                      (_, pre) => pre + 'ht="81"');
      if (!/\bcustomHeight=/.test((rx.match(/<row [^>]*>/) || [""])[0])) {
        rx = rx.replace(/(<row [^>]*\br="4"[^>]*?)>/,
                        (_, pre) => pre + ' customHeight="1">');
      }
      return rx;
    });

    // Row 7: date + WMTR
    editRow(7, rx => {
      rx = _plSetCell(rx, "A7", st.idx(dateStr), "s");
      if (m.wmtr) rx = _plSetCell(rx, "G7", st.idx(m.wmtr), "s");
      return rx;
    });

    // Row 10: first package value row
    if (packages.length > 0) {
      editRow(10, rx => _plFillPkgRow(rx, 10, 1, packages[0], unitSystem, st));
    }

    // Row 13: first inventory item row
    if (items.length > 0) {
      editRow(13, rx => _plFillInvRow(rx, 13, items[0], st));
    }

    // Footer rows (original positions 14–23)
    editRow(16, rx => _plSetCell(rx, "C16", packages.length, "n"));
    if (printedName) editRow(18, rx => _plSetCell(rx, "R18", st.idx(printedName), "s"));
    // Footer date under the Printed Name (R20). The template ships this as a
    // formula (=A7) with a cached 0; writing the date literally makes it always
    // display and removes the sheet's only formula (so the calc chain is moot).
    editRow(20, rx => _plSetCell(rx, "R20", st.idx(dateStr), "s"));
    const volStr = _plFmtVol(raw.udq_ft3 || 0);
    if (volStr) editRow(19, rx => _plSetCell(rx, "C19", st.idx(volStr), "s"));
    const wtStr  = _plFmtWt(raw.udq_lbs || 0);
    if (wtStr)  editRow(23, rx => _plSetCell(rx, "C23", st.idx(wtStr),  "s"));

    /* ═══════════════════════════════════════════════════════════════════
       STEP 2 — Insert extra package blocks using TEMP row numbers.
       Template pkg block = rows 9 (hdr) / 10 (val) / 11 (spacer).
       Extra blocks go before the original row 12 (inventory header).
       Each extra block gets temp rows 9000+, 9001+, 9002+, etc.
    ═══════════════════════════════════════════════════════════════════ */

    let tempBase = 9000;

    for (let pi = 1; pi < packages.length; pi++) {
      const tHdr = tempBase++;
      const tVal = tempBase++;
      const tSpc = tempBase++;

      const newHdr = _plCloneRow(xml, 9,  tHdr);
      const newVal = _plCloneRow(xml, 10, tVal);
      const newSpc = _plCloneRow(xml, 11, tSpc);

      if (!newHdr || !newVal || !newSpc) continue;

      // Insert all three before the original row 12
      const row12 = _plGetRow(xml, 12);
      if (!row12) continue;
      const ins12 = xml.indexOf(row12);
      xml = xml.slice(0, ins12) + newHdr + newVal + newSpc + xml.slice(ins12);

      // Fill the temp value row with package data
      const tValXml = _plGetRow(xml, tVal);
      if (tValXml) {
        const filled = _plFillPkgRow(tValXml, tVal, pi + 1, packages[pi], unitSystem, st);
        xml = _plReplaceExact(xml, tValXml, filled);
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 3 — Insert extra inventory rows using TEMP row numbers.
       Extra rows go before the original row 14 (footer separator).
    ═══════════════════════════════════════════════════════════════════ */

    for (let ii = 1; ii < items.length; ii++) {
      const tRow = tempBase++;
      const newRow = _plCloneRow(xml, 13, tRow);
      if (!newRow) continue;

      const row14 = _plGetRow(xml, 14);
      if (!row14) continue;
      const ins14 = xml.indexOf(row14);
      xml = xml.slice(0, ins14) + newRow + xml.slice(ins14);

      const tRowXml = _plGetRow(xml, tRow);
      if (tRowXml) {
        const filled = _plFillInvRow(tRowXml, tRow, items[ii], st);
        xml = _plReplaceExact(xml, tRowXml, filled);
      }
    }

    /* ═══════════════════════════════════════════════════════════════════
       STEP 4 — Renumber ALL rows sequentially in document order.
       This resolves temp numbers and produces a clean r=1,2,3,… sequence.
    ═══════════════════════════════════════════════════════════════════ */

    xml = _plRenumberRows(xml);

    /* ═══════════════════════════════════════════════════════════════════
       STEP 5 — Update <dimension> and <mergeCells>.
    ═══════════════════════════════════════════════════════════════════ */

    // Count final rows
    const finalRowCount = (xml.match(/<row /g) || []).length;

    // Update dimension
    xml = xml.replace(/(<dimension ref="[^:]+:)[A-Z]+\d+(")/,
      (_, pre, suf) => `${pre}AB${finalRowCount}${suf}`);

    // Shift merge ranges: original rows 1-11 unchanged, 12+ shift by totalShift.
    // totalShift = finalRowCount - 23 (original row count).
    const totalShift = finalRowCount - 23;
    if (totalShift > 0) {
      xml = xml.replace(/<mergeCells[^>]*>.*?<\/mergeCells>/s, full =>
        full.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g,
          (_, c1, r1, c2, r2) => {
            const n1 = parseInt(r1,10), n2 = parseInt(r2,10);
            const s1 = n1 >= 12 ? n1 + totalShift : n1;
            const s2 = n2 >= 12 ? n2 + totalShift : n2;
            return `<mergeCell ref="${c1}${s1}:${c2}${s2}"/>`;
          })
      );
    }

    // Add missing merges for extra package blocks.
    // The template has merges for pkg rows 9 and 10 only. Each extra pkg block
    // (after renumber) sits at rows 9+(i*3) and 9+(i*3)+1 for i=1,2,...
    // We replicate the row-9 and row-10 merge patterns for each extra block.
    if (packages.length > 1) {
      // Extract the set of merges that exist for rows 9 and 10 from the final XML
      const mergeSection = xml.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/);
      if (mergeSection) {
        const existingMerges = mergeSection[1];
        const pkgMerges9  = [];
        const pkgMerges10 = [];
        const mRe = /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g;
        let mm;
        while ((mm = mRe.exec(existingMerges)) !== null) {
          const r1 = parseInt(mm[2], 10), r2 = parseInt(mm[4], 10);
          if (r1 === 9  && r2 === 9)  pkgMerges9.push( [mm[1], mm[3]]);
          if (r1 === 10 && r2 === 10) pkgMerges10.push([mm[1], mm[3]]);
        }
        // Build new merge entries for each extra pkg block
        let newMerges = "";
        for (let pi = 1; pi < packages.length; pi++) {
          const baseR = 9 + pi * 3;
          for (const [c1, c2] of pkgMerges9) {
            newMerges += `<mergeCell ref="${c1}${baseR}:${c2}${baseR}"/>`;
          }
          for (const [c1, c2] of pkgMerges10) {
            newMerges += `<mergeCell ref="${c1}${baseR+1}:${c2}${baseR+1}"/>`;
          }
        }
        if (newMerges) {
          // Update count and insert new merges
          xml = xml.replace(/<mergeCells count="(\d+)">/,
            (_, cnt) => `<mergeCells count="${parseInt(cnt,10) + newMerges.split("<mergeCell").length - 1}">`);
          xml = xml.replace("</mergeCells>", newMerges + "</mergeCells>");
        }
      }
    }

    /* ── Repack and download ── */
    // Build a fresh JSZip to avoid generateAsync ignoring in-place modifications
    let wbXml = await zip.file("xl/workbook.xml").async("string");
    wbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");

    // The footer "Printed Name" date cell carries a formula (=A7). We drop the
    // stale calcChain entirely (rather than ship an empty one, which Excel flags
    // as unreadable content) and force a full recalc on load so that formula —
    // and any others — re-evaluates and shows today's date instead of a cached 0.
    if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (full, attrs) => {
        let a = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
        return `<calcPr${a} fullCalcOnLoad="1"/>`;
      });
    } else {
      wbXml = wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
    }

    // Strip the calcChain declaration from Content Types and the workbook rels,
    // so the part can be omitted without leaving a dangling reference.
    let ctXml = await zip.file("[Content_Types].xml").async("string");
    ctXml = ctXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");

    let wbRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    wbRels = wbRels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, "");

    const outZip = new JSZip();
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (name === "xl/worksheets/sheet1.xml") {
        outZip.file(name, xml);
      } else if (name === "xl/sharedStrings.xml") {
        outZip.file(name, st.toXml());
      } else if (name === "xl/workbook.xml") {
        outZip.file(name, wbXml);
      } else if (name === "[Content_Types].xml") {
        outZip.file(name, ctXml);
      } else if (name === "xl/_rels/workbook.xml.rels") {
        outZip.file(name, wbRels);
      } else if (name === "xl/calcChain.xml") {
        // Intentionally omitted — Excel rebuilds the calc chain on open.
        continue;
      } else {
        outZip.file(name, await entry.async("uint8array"));
      }
    }

    // Use base64 data: URL instead of blob: URL to avoid file:// origin restrictions
    const outB64 = await outZip.generateAsync({type:"base64"});
    const last5 = m.wmtr_last5 || "";
    const stamp  = fileStamp();
    const fname  = last5 ? `PL_${last5}_${stamp}.xlsx` : `PL_${stamp}.xlsx`;

    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + outB64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    status.textContent = `✅ Downloaded ${fname}`;

  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
    status.classList.add("err");
  }
}

/* ── Fill a package value row ── */
function _plFillPkgRow(rowXml, r, pkgNo, pkg, unitSystem, st) {
  rowXml = _plSetCell(rowXml, `A${r}`, pkgNo, "n");
  const desc = _plStripParens(pkg.description || "");
  if (desc) rowXml = _plSetCell(rowXml, `C${r}`, st.idx(desc), "s");
  rowXml = _plSetCell(rowXml, `N${r}`, pkg.count || 1, "n");
  if (pkg.uoi) rowXml = _plSetCell(rowXml, `Q${r}`, pkg.uoi, "inline");

  const wLbs = toFloat(pkg.weight_lbs), wKg = toFloat(pkg.weight_kg);
  let outWt = unitSystem === "imperial"
    ? (wLbs || (wKg ? wKg / 0.45359237 : null))
    : (wKg  || (wLbs ? wLbs * 0.45359237 : null));
  if (outWt != null)
    rowXml = _plSetCell(rowXml, `S${r}`, Math.round(outWt * 100) / 100, "n");

  const dims = _plParseDims(pkg.dims || "");
  if (dims) {
    const Lin = _plToIn(dims.L, dims.unit);
    const Win = _plToIn(dims.W, dims.unit);
    const Hin = _plToIn(dims.H, dims.unit);
    const [oL,oW,oH] = unitSystem === "imperial"
      ? [Lin, Win, Hin] : [Lin*2.54, Win*2.54, Hin*2.54];
    rowXml = _plSetCell(rowXml, `W${r}`,  Math.round(oL*100)/100, "n");
    rowXml = _plSetCell(rowXml, `Y${r}`,  Math.round(oW*100)/100, "n");
    rowXml = _plSetCell(rowXml, `AA${r}`, Math.round(oH*100)/100, "n");
  }
  return rowXml;
}

/* ── Fill an inventory item row ── */
function _plFillInvRow(rowXml, r, item, st) {
  if (item.desc)  rowXml = _plSetCell(rowXml, `C${r}`,  st.idx(item.desc),  "s");
  if (item.model) rowXml = _plSetCell(rowXml, `P${r}`,  st.idx(item.model), "s");
  if (item.hts)   rowXml = _plSetCell(rowXml, `V${r}`,  st.idx(item.hts),   "s");
  const qtyN = toFloat(item.units);
  if (qtyN)       rowXml = _plSetCell(rowXml, `Y${r}`,  qtyN, "n");
  // Z (U/I) must be written AFTER Y — the regex for Y13 self-closing would
  // otherwise swallow the following Z inlineStr cell in its match.
  if (item.uom)   rowXml = _plSetCell(rowXml, `Z${r}`,  item.uom,  "inline");
  return rowXml;
}
