/* =========================================================================
   ATLAS Utility Web — tools/placards.js  (v1.0)

   Shipping placards — one full-page placard per package, ready to tape to
   the outside of each crate/box. Shows SHIP FROM / SHIP TO, the WMTR marking,
   "PACKAGE n OF N", weight / dimensions, program / contract, special-handling
   notes, and an optional hazardous-materials warning.

   Mirrors the look and feel of the CI and PL tools:
     • a .panel form with a live <iframe> preview that updates as you type
     • "Save as PDF"  — opens the browser print dialog (same as CI / PL)
     • "Download as Word (.docx)" — builds a genuine OOXML document entirely
       in the browser with JSZip (already loaded for the PL tool). Logos are
       embedded, so the .docx is self-contained and opens cleanly in Word.

   Everything runs in your browser; UDQ data never leaves the machine.
   ========================================================================= */

/* ── UI ──────────────────────────────────────────────────────────────────── */

function renderPlacardsWorkspace(container) {
  const data = AppState.data;
  const m = data.meta;

  const boxesTotal = _pkBoxCount(data);
  const hazmatAuto = _pkHasHazmat(data);

  const panel = el(`
    <div class="panel">
      <header>
        <h2>Placards</h2>
        <span class="count">${esc(m.wmtr)}</span>
      </header>
      <div class="body">
        <div class="formgrid">
          <div class="field">
            <label for="pkFrom">Ship from</label>
            <select id="pkFrom">
              <option value="pickup" selected>Pickup location</option>
              <option value="origin">Shipment origin</option>
            </select>
          </div>
          <div class="field">
            <label for="pkTo">Ship to</label>
            <select id="pkTo">
              <option value="deliver" selected>Delivery destination</option>
              <option value="consignee">Ultimate consignee</option>
            </select>
          </div>
          <div class="field">
            <label for="pkCount">Number of placards</label>
            <input type="number" id="pkCount" min="1" max="200" value="${esc(String(boxesTotal))}">
            <div class="hint">Defaults to the package count from the UDQ (${esc(String(boxesTotal))}). Adjust if needed.</div>
          </div>
          <div class="field">
            <label for="pkStart">Starting number</label>
            <input type="number" id="pkStart" min="1" max="200" value="1">
            <div class="hint">Useful when printing a partial batch.</div>
          </div>
          <div class="field span2">
            <label for="pkHandling">Special handling note</label>
            <textarea id="pkHandling" rows="2">${esc(m.special_handling || "")}</textarea>
            <div class="hint">Printed in the handling band on every placard.</div>
          </div>
          <div class="field">
            <label for="pkHazmat">Hazardous materials</label>
            <select id="pkHazmat">
              <option value="auto" ${hazmatAuto ? "selected" : ""}>Show DG warning${hazmatAuto ? " (detected)" : ""}</option>
              <option value="off" ${hazmatAuto ? "" : "selected"}>No DG warning</option>
            </select>
            ${hazmatAuto ? `<div class="hint">UN/HAZMAT data found in the UDQ.</div>` : ""}
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="pkDocx">Download as Word (.docx)</button>
          <button class="btn primary" id="pkPrint">Save as PDF</button>
          <button class="btn ghost" id="pkRefresh">Refresh preview</button>
          <span class="statusline" id="pkStatus"></span>
        </div>
        <div class="note">
          Generates one full-page placard per package
          (<span style="font-family:var(--mono)">Placards_${esc(m.wmtr_last5 || "UDQ")}_…</span>).
          <strong>Save as PDF</strong> opens the browser print window — choose “Save as PDF”, Portrait / Letter.
          <strong>Word</strong> builds a real .docx you can edit. The preview below updates as you change the form.
        </div>

        <div class="previewwrap"><iframe id="pkPreview" title="Placards preview"></iframe></div>
      </div>
    </div>`);

  container.appendChild(panel);

  const refresh = () => updatePlacardsPreview();
  for (const id of ["pkFrom", "pkTo", "pkCount", "pkStart", "pkHandling", "pkHazmat"]) {
    const node = panel.querySelector("#" + id);
    node.addEventListener("change", refresh);
    node.addEventListener("input", refresh);
  }
  panel.querySelector("#pkRefresh").addEventListener("click", refresh);
  panel.querySelector("#pkPrint").addEventListener("click", printPlacards);
  panel.querySelector("#pkDocx").addEventListener("click", downloadPlacardsDocx);

  updatePlacardsPreview();
}

/* ── Read the form ───────────────────────────────────────────────────────── */

function placardsOptionsFromForm() {
  const g = (id) => document.getElementById(id);
  const data = AppState.data;

  const fromKey = (g("pkFrom") || {}).value || "pickup";
  const toKey = (g("pkTo") || {}).value || "deliver";

  // Resolve parties with graceful fallback when the preferred block is empty.
  const fromParty = _pkResolveParty(data, fromKey, "origin");
  const toParty = _pkResolveParty(data, toKey, "consignee");

  let count = parseInt((g("pkCount") || {}).value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > 200) count = 200;

  let start = parseInt((g("pkStart") || {}).value, 10);
  if (!Number.isFinite(start) || start < 1) start = 1;

  const handling = ((g("pkHandling") || {}).value || "").replace(/\s+/g, " ").trim();
  const hazmatMode = (g("pkHazmat") || {}).value || "off";
  const hazmat = hazmatMode === "auto";

  return {
    fromKey, toKey, fromParty, toParty,
    count, start, handling, hazmat,
    fromLabel: fromKey === "origin" ? "Shipment Origin" : "Pickup Location",
    toLabel: toKey === "consignee" ? "Ultimate Consignee" : "Delivery Destination",
  };
}

/* Pick a party block, falling back to a secondary one if the first is empty. */
function _pkResolveParty(data, key, fallbackKey) {
  const map = {
    pickup: data.parties.pickup,
    origin: data.parties.origin,
    deliver: data.parties.deliver,
    consignee: data.parties.consignee,
  };
  const primary = map[key];
  if (primary && _pkPartyLines(primary).length) return primary;
  const fb = map[fallbackKey];
  if (fb && _pkPartyLines(fb).length) return fb;
  return primary || makeParty();
}

/* ── Model: one entry per physical placard ───────────────────────────────── */

/** Expand the UDQ package rows into individual boxes (carrying weight/dims). */
function _pkBoxes(data) {
  const boxes = [];
  for (const pk of data.packages || []) {
    const n = Math.max(1, Math.trunc(pk.count || 1));
    for (let i = 0; i < n; i++) {
      boxes.push({ weight_lbs: pk.weight_lbs, dims: pk.dims, desc: pk.description });
    }
  }
  return boxes;
}

function _pkBoxCount(data) {
  const n = _pkBoxes(data).length;
  if (n) return n;
  const fromMeta = parseInt(data.meta.total_pkgs, 10);
  return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : 1;
}

function placardsBuildModel(data, opts) {
  const m = data.meta;
  const boxes = _pkBoxes(data);
  // Use per-box weight/dims only when the requested count matches what the
  // UDQ describes; otherwise fall back to shipment-level totals.
  const usePerBox = boxes.length === opts.count;

  const fromLines = _pkPartyLines(opts.fromParty);
  const toLines = _pkPartyLines(opts.toParty);

  const placards = [];
  const start = opts.start || 1;
  const total = opts.count;
  for (let i = 0; i < total; i++) {
    const n = start + i;
    const box = usePerBox ? boxes[i] : null;
    placards.push({
      number: n,
      total: start - 1 + total,
      wmtr: m.wmtr,
      title: m.request_title || "",
      fromLabel: opts.fromLabel,
      toLabel: opts.toLabel,
      fromLines,
      toLines,
      weight: box ? _pkFmtWeight(box.weight_lbs, box.weight_kg) : (m.total_weight || ""),
      weightIsTotal: !box,
      dims: box ? (box.dims || "") : "",
      program: _pkExpandProgram(m.ctr_program || ""),
      contract: m.contract_no || "",
      origin_country: _pkCountryShort(m.country_origin),
      dest_country: _pkCountryShort(m.country_destination),
      handling: opts.handling || "",
      hazmat: opts.hazmat ? _pkHazmatText(data) : "",
    });
  }
  return placards;
}

/* ── Live preview / PDF (HTML) ───────────────────────────────────────────── */

function placardsRenderHtml(placards, docTitle) {
  const pages = placards.map((p) => _pkRenderPage(p)).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<style>${PLACARD_CSS}</style></head><body>
${pages || `<div class="pk-page"><div class="pk-empty">No packages to placard.</div></div>`}
</body></html>`;
}

function _pkRenderPage(p) {
  const fromBlock = p.fromLines.length ? p.fromLines.map(esc).join("<br/>") : "—";
  const toBlock = p.toLines.length ? p.toLines.map(esc).join("<br/>") : "—";

  const weightLabel = p.weightIsTotal ? "Total Weight" : "Weight";
  const route = (p.origin_country || p.dest_country)
    ? `<div class="pk-route">${esc(p.origin_country || "ORIGIN")} <span class="arr">→</span> ${esc(p.dest_country || "DESTINATION")}</div>`
    : "";

  const hazmat = p.hazmat
    ? `<div class="pk-hazmat"><span class="hz-bang">!</span>
         <div><div class="hz-title">DANGEROUS GOODS</div><div class="hz-body">${esc(p.hazmat)}</div></div>
       </div>`
    : "";

  const handling = p.handling
    ? `<div class="pk-band">
         <div class="pk-band-lbl">Special Handling</div>
         <div class="pk-band-val">${escBr(p.handling)}</div>
       </div>`
    : "";

  return `
<div class="pk-page">
  <div class="pk-card">
    <div class="pk-head">
      <div class="pk-logo left"><img src="${LOGO_LEFT}" alt=""></div>
      <div class="pk-head-mid">
        <div class="pk-sub">Prepared by TechTrans International<br>on behalf of DTRA</div>
      </div>
      <div class="pk-logo right"><img src="${LOGO_RIGHT}" alt=""></div>
    </div>

    <div class="pk-wmtr">
      <div class="pk-wmtr-lbl">WMTR NUMBER</div>
      <div class="pk-wmtr-val">${esc(p.wmtr || "—")}</div>
    </div>

    <div class="pk-fromto">
      <div class="pk-party">
        <div class="pk-party-lbl">Ship From — ${esc(p.fromLabel)}</div>
        <div class="pk-party-val">${fromBlock}</div>
      </div>
      <div class="pk-party">
        <div class="pk-party-lbl">Ship To — ${esc(p.toLabel)}</div>
        <div class="pk-party-val">${toBlock}</div>
      </div>
    </div>

    <div class="pk-grid">
      <div class="pk-cell big">
        <div class="pk-cell-lbl">Package</div>
        <div class="pk-cell-val">${esc(String(p.number))} <span class="of">of</span> ${esc(String(p.total))}</div>
      </div>
      <div class="pk-cell">
        <div class="pk-cell-lbl">${esc(weightLabel)}</div>
        <div class="pk-cell-val mono">${esc(p.weight || "—")}</div>
      </div>
      <div class="pk-cell">
        <div class="pk-cell-lbl">Dimensions (L×W×H)</div>
        <div class="pk-cell-val mono">${esc(p.dims || "—")}</div>
      </div>
      <div class="pk-cell">
        <div class="pk-cell-lbl">Program</div>
        <div class="pk-cell-val">${esc(p.program || "—")}</div>
      </div>
      <div class="pk-cell agency">
        <div class="pk-agency">Defense Threat Reduction Agency</div>
      </div>
    </div>

    ${route}
    ${hazmat}
    ${handling}

    <div class="pk-foot">
      These items are controlled by the U.S. government and authorized for export only to the country of
      ultimate destination for use by the ultimate consignee or end-user(s) herein identified.
    </div>
  </div>
</div>`;
}

function placardsDocTitle() {
  const last5 = AppState.data.meta.wmtr_last5 || "UDQ";
  return `Placards_${last5}_${fileStamp()}`;
}

function updatePlacardsPreview() {
  const iframe = document.getElementById("pkPreview");
  if (!iframe) return;
  const opts = placardsOptionsFromForm();
  const placards = placardsBuildModel(AppState.data, opts);
  iframe.srcdoc = placardsRenderHtml(placards, placardsDocTitle());

  const status = document.getElementById("pkStatus");
  if (status && !status.classList.contains("err")) {
    status.textContent =
      `${placards.length} placard${placards.length === 1 ? "" : "s"} · ` +
      `from ${opts.fromLabel} · to ${opts.toLabel}`;
  }
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      doc.body.style.background = "transparent";
    } catch (e) { /* ignore */ }
  }, { once: true });
}

function printPlacards() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("placards", printPlacards)) return;
  const status = document.getElementById("pkStatus");
  const opts = placardsOptionsFromForm();
  const placards = placardsBuildModel(AppState.data, opts);
  const docTitle = placardsDocTitle();
  const html = placardsRenderHtml(placards, docTitle);

  const w = window.open("", "_blank");
  if (!w) {
    if (status) {
      status.textContent = "Pop-up blocked — allow pop-ups for this page, then click Save as PDF again.";
      status.classList.add("err");
    }
    return;
  }
  if (status) { status.classList.remove("err"); status.textContent = "Opening print dialog…"; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = docTitle;
  if (typeof auditRecordPrint === "function") auditRecordPrint("Placards", docTitle + ".pdf", (AppState.data.meta && AppState.data.meta.wmtr_last5) || "");
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

/* ── Word (.docx) export — real OOXML built with JSZip ───────────────────── */

async function downloadPlacardsDocx() {
  if (typeof atlasGenerateGate === "function" && !atlasGenerateGate("placards", downloadPlacardsDocx)) return;
  const status = document.getElementById("pkStatus");
  try {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip not loaded — cannot build the Word document.");
    }
    if (status) { status.classList.remove("err"); status.textContent = "Building Word document…"; }

    const opts = placardsOptionsFromForm();
    const placards = placardsBuildModel(AppState.data, opts);
    const zip = placardsBuildDocxZip(placards);

    const b64 = await zip.generateAsync({ type: "base64" });
    const fname = placardsDocTitle() + ".docx";
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64," + b64;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 1000);

    if (status) status.textContent = `✅ Downloaded ${fname}`;
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = `Error: ${err.message}`; status.classList.add("err"); }
  }
}

/** Assemble a complete .docx (as a JSZip) for the given placards. */
function placardsBuildDocxZip(placards) {
  const zip = new JSZip();

  // Logos -> media. The data URIs live in assets.js.
  const logoL = _pkB64ToU8(_pkStripDataUri(LOGO_LEFT));
  const logoR = _pkB64ToU8(_pkStripDataUri(LOGO_RIGHT));
  zip.file("word/media/logoL.png", logoL);
  zip.file("word/media/logoR.png", logoR);

  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`);

  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`);

  zip.file("word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdLogoL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logoL.png"/>` +
    `<Relationship Id="rIdLogoR" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logoR.png"/>` +
    `</Relationships>`);

  zip.file("word/styles.xml", _PK_STYLES_XML);
  zip.file("word/document.xml", _pkBuildDocumentXml(placards));
  return zip;
}

/* Word color/measure constants */
const _PK_INK = "16283C";
const _PK_ACCENT = "C74A08";
const _PK_GRAY = "EFF1F3";
const _PK_WARN = "B00000";
const _PK_LINE = "16283C";
const _DXA = 12240 - 1440;        // page width (Letter) minus 0.5in margins each side ≈ 11520 twips usable

let _pkDocPrId = 1; // unique ids for inline drawings

function _pkBuildDocumentXml(placards) {
  _pkDocPrId = 1;
  const bodies = placards.map((p, i) =>
    _pkPlacardXml(p) + (i < placards.length - 1 ? _pkPageBreakXml() : "")
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${bodies}` +
    `<w:sectPr>` +
    `<w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body></w:document>`;
}

function _pkPageBreakXml() {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/>` +
    `<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>`;
}

/* Empty spacer paragraph — also separates consecutive tables so Word keeps
   them as distinct tables rather than merging them. */
function _pkSpacer(sz) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${sz || 60}" w:lineRule="exact"/></w:pPr></w:p>`;
}

/* The placard is ONE flat full-page table (no nested tables, which break
   layout in LibreOffice/Word). A 6-column grid + gridSpan provides every
   section layout; internal divider lines are drawn with per-cell borders and
   the heavy outer frame with table borders. Row heights are EXACT and sized to
   comfortably exceed their content, so the card fills the printable page
   top-to-bottom — matching the HTML preview. */
function _pkPlacardXml(p) {
  const W = 10800;                              // card width (~7.5 in)
  const COLS = [1800, 1800, 1800, 1800, 1800, 1800]; // 6-col grid, sums to W
  const TARGET = 13350;                         // total height (~9.27 in) fills the page with safety margin

  const hasRoute = !!(p.origin_country || p.dest_country);
  const Hheader = 1150, Hwmtr = 1500, Hfoot = 860;
  const Hroute = hasRoute ? 700 : 0;
  const Hhaz = p.hazmat ? Math.max(1100, 360 + _pkEstLines(p.hazmat, 50) * 240) : 0;
  const Hhand = p.handling ? Math.max(900, 320 + _pkEstLines(p.handling, 62) * 240) : 0;

  // Remaining vertical space goes to Ship From/To and the details grid so the
  // card always reaches the bottom of the page.
  const fixed = Hheader + Hwmtr + Hfoot + Hroute + Hhaz + Hhand;
  let flex = TARGET - fixed;
  if (flex < 5400) flex = 5400;
  let Hfromto = Math.round(flex * 0.48);
  let detailsTotal = flex - Hfromto;
  if (Hfromto < 2700) Hfromto = 2700;
  if (detailsTotal < 2800) detailsTotal = 2800;
  const Hcontract = 760;
  const Hdrow = Math.max(900, Math.round((detailsTotal - Hcontract) / 2));

  const rows = [];

  // 1) Header — logos pinned to the corners (floating) with the "Prepared by"
  //    line centered on the FULL page width, independent of the logo widths.
  rows.push({ h: Hheader, cells: [
    _C(6,
      _pkPara(
        _pkFloatLogo("rIdLogoL", 140, 140, 0.62, "left") +
        _pkFloatLogo("rIdLogoR", 393, 140, 0.62, "right") +
        _pkRun("Prepared by TechTrans International", { sz: 26, bold: true, color: _PK_INK }) +
        "<w:r><w:br/></w:r>" +
        _pkRun("on behalf of DTRA", { sz: 26, bold: true, color: _PK_INK }),
        { jc: "center" }),
      { b: 1, vAlign: "center" }),
  ] });

  // 2) WMTR band (shaded, full width)
  rows.push({ h: Hwmtr, cells: [ _C(6, _pkWmtrContent(p), { b: 1, vAlign: "center", shade: _PK_GRAY }) ] });

  // 3) Ship From / Ship To  (spans 3 + 3, vertical divider via right border)
  rows.push({ h: Hfromto, cells: [
    _C(3, _pkFromToCell("Ship From — " + p.fromLabel, p.fromLines), { b: 1, r: 1, vAlign: "top" }),
    _C(3, _pkFromToCell("Ship To — " + p.toLabel, p.toLines), { b: 1, vAlign: "top" }),
  ] });

  // 4) Details grid
  rows.push({ h: Hdrow, cells: [
    _C(3, _pkDetailCell("Package", _pkPkgVal(p)), { b: 1, r: 1, vAlign: "center" }),
    _C(3, _pkDetailCell(p.weightIsTotal ? "Total Weight" : "Weight",
        _pkPara(_pkRun(p.weight || "\u2014", { sz: 26, mono: true, bold: true }))), { b: 1, vAlign: "center" }),
  ] });
  rows.push({ h: Hdrow, cells: [
    _C(3, _pkDetailCell("Dimensions (L\u00d7W\u00d7H)",
        _pkPara(_pkRun(p.dims || "\u2014", { sz: 26, mono: true, bold: true }))), { b: 1, r: 1, vAlign: "center" }),
    _C(3, _pkDetailCell("Program",
        _pkPara(_pkRun(p.program || "\u2014", { sz: 20, bold: true }))), { b: 1, vAlign: "center" }),
  ] });
  rows.push({ h: Hcontract, cells: [
    _C(6,
      _pkPara(_pkRun("Defense Threat Reduction Agency", { sz: 26, bold: true, color: _PK_INK }), { jc: "center" }),
      { b: 1, vAlign: "center" }),
  ] });

  // 5) Route (optional)
  if (Hroute) rows.push({ h: Hroute, cells: [ _C(6, _pkRouteContent(p), { b: 1, vAlign: "center" }) ] });
  // 6) Dangerous goods (optional)
  if (Hhaz) rows.push({ h: Hhaz, cells: [ _C(6, _pkHazmatContent(p), { b: 1, vAlign: "center", shade: "FBE9E7" }) ] });
  // 7) Special handling (optional)
  if (Hhand) rows.push({ h: Hhand, cells: [ _C(6, _pkBandContent("Special Handling", p.handling), { b: 1, vAlign: "center" }) ] });
  // 8) Footer (no bottom border — outer frame closes the card)
  rows.push({ h: Hfoot, cells: [ _C(6, _pkFooterContent(), { vAlign: "center" }) ] });

  return _pkFlatTable(W, COLS, rows);
}

/* Estimate wrapped line count for a block of text at ~perLine characters. */
function _pkEstLines(text, perLine) {
  perLine = perLine || 60;
  let lines = 0;
  for (const seg of String(text || "").split(/\n/)) {
    lines += Math.max(1, Math.ceil((seg.trim().length || 1) / perLine));
  }
  return Math.max(1, lines);
}

/* ---- flat single-table card (no nesting) -------------------------------- */

function _C(span, content, opts) { return { span: span, content: content, opts: opts || {} }; }

function _pkFlatTable(width, cols, rows) {
  const edge = (side) => `<w:${side} w:val="single" w:sz="18" w:space="0" w:color="${_PK_LINE}"/>`;
  const tblPr =
    `<w:tblPr>` +
    `<w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${edge("top")}${edge("left")}${edge("bottom")}${edge("right")}</w:tblBorders>` +
    `</w:tblPr>`;
  const grid = `<w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join("")}</w:tblGrid>`;
  const trs = rows.map((r) => {
    let start = 0, cells = "";
    for (const c of r.cells) { cells += _pkCellXml(start, cols, c.span, c.content, c.opts); start += c.span; }
    return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${r.h}" w:hRule="exact"/></w:trPr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl>${tblPr}${grid}${trs}</w:tbl>`;
}

function _pkTcBorders(o) {
  const line = (side) => `<w:${side} w:val="single" w:sz="10" w:space="0" w:color="${_PK_LINE}"/>`;
  const s = [];
  if (o.t) s.push(line("top"));
  if (o.l) s.push(line("left"));
  if (o.b) s.push(line("bottom"));
  if (o.r) s.push(line("right"));
  return s.length ? `<w:tcBorders>${s.join("")}</w:tcBorders>` : "";
}

function _pkCellXml(start, cols, span, content, opts) {
  opts = opts || {};
  let w = 0;
  for (let i = 0; i < span; i++) w += cols[start + i];
  const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
  const borders = _pkTcBorders(opts);
  const shd = opts.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>` : "";
  const mar = opts.img
    ? `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>`
    : `<w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="200" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tcMar>`;
  const vAlign = opts.vAlign ? `<w:vAlign w:val="${opts.vAlign}"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${gridSpan}${borders}${shd}${mar}${vAlign}</w:tcPr>${content}</w:tc>`;
}

/* ---- cell content builders ---------------------------------------------- */

function _pkFromToCell(lbl, lines) {
  return _pkPara(_pkRun(lbl, { sz: 18, bold: true, color: _PK_ACCENT, caps: true }), { after: 100 }) +
    (lines && lines.length
      ? lines.map((ln) => _pkPara(_pkRun(ln, { sz: 24 }), { after: 40 })).join("")
      : _pkPara(_pkRun("\u2014", { sz: 24 })));
}

function _pkDetailCell(lbl, valPara) {
  return _pkPara(_pkRun(lbl, { sz: 17, bold: true, color: "5B6B7C", caps: true }), { after: 60 }) + valPara;
}

function _pkPkgVal(p) {
  return _pkPara(
    _pkRun(String(p.number), { sz: 44, bold: true, color: _PK_INK }) +
    _pkRun("  of  ", { sz: 24, color: "5B6B7C" }) +
    _pkRun(String(p.total), { sz: 44, bold: true, color: _PK_INK }));
}

/* ---- full-width section content (paragraphs) ---------------------------- */

function _pkWmtrContent(p) {
  return _pkPara(_pkRun("WMTR NUMBER", { sz: 17, bold: true, color: _PK_ACCENT, caps: true, spacing: 40 }), { jc: "center", after: 60 }) +
    _pkPara(_pkRun(p.wmtr || "\u2014", { sz: 48, bold: true, color: _PK_INK, mono: true }), { jc: "center" });
}

function _pkRouteContent(p) {
  const o = p.origin_country || "ORIGIN", d = p.dest_country || "DESTINATION";
  return _pkPara(
    _pkRun(o + "  ", { sz: 26, bold: true, color: _PK_INK, caps: true, spacing: 30 }) +
    _pkRun("\u2192", { sz: 26, bold: true, color: _PK_ACCENT }) +
    _pkRun("  " + d, { sz: 26, bold: true, color: _PK_INK, caps: true, spacing: 30 }),
    { jc: "center" });
}

function _pkHazmatContent(p) {
  return _pkPara(_pkRun("\u26A0  DANGEROUS GOODS", { sz: 28, bold: true, color: _PK_WARN, caps: true }), { jc: "center", after: 60 }) +
    _pkParaMultiline(p.hazmat, { sz: 22, bold: true, color: _PK_WARN }, { jc: "center" });
}

function _pkBandContent(label, text) {
  return _pkPara(_pkRun(label, { sz: 17, bold: true, color: _PK_ACCENT, caps: true }), { after: 70 }) +
    _pkParaMultiline(text, { sz: 24 });
}

function _pkFooterContent() {
  return _pkPara(
    _pkRun("These items are controlled by the U.S. government and authorized for export only to the country of " +
      "ultimate destination for use by the ultimate consignee or end-user(s) herein identified.",
      { sz: 16, italic: true, color: "5B6B7C" }),
    { jc: "center" });
}

/* ---- run / paragraph / image helpers ---- */

function _pkPara(runsXml, opts) {
  opts = opts || {};
  const jc = opts.jc ? `<w:jc w:val="${opts.jc}"/>` : "";
  const spacing = `<w:spacing w:before="${opts.before || 0}" w:after="${opts.after != null ? opts.after : 0}" w:line="240" w:lineRule="auto"/>`;
  return `<w:p><w:pPr>${spacing}${jc}</w:pPr>${runsXml}</w:p>`;
}

/** Render text with embedded newlines as a single paragraph using <w:br/>. */
function _pkParaMultiline(text, runOpts, paraOpts) {
  const parts = String(text).split(/\n/);
  const runs = parts.map((seg, i) =>
    (i ? `<w:r><w:br/></w:r>` : "") + _pkRun(seg, runOpts)
  ).join("");
  return _pkPara(runs, paraOpts || {});
}

function _pkRun(text, opts) {
  opts = opts || {};
  const rpr = [];
  if (opts.bold) rpr.push(`<w:b/>`);
  if (opts.italic) rpr.push(`<w:i/>`);
  if (opts.caps) rpr.push(`<w:caps/>`);
  if (opts.color) rpr.push(`<w:color w:val="${opts.color}"/>`);
  if (opts.spacing) rpr.push(`<w:spacing w:val="${opts.spacing}"/>`);
  if (opts.mono) rpr.push(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`);
  else rpr.push(`<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>`);
  if (opts.sz) rpr.push(`<w:sz w:val="${opts.sz}"/><w:szCs w:val="${opts.sz}"/>`);
  const rprXml = rpr.length ? `<w:rPr>${rpr.join("")}</w:rPr>` : "";
  return `<w:r>${rprXml}<w:t xml:space="preserve">${_pkXmlEsc(text)}</w:t></w:r>`;
}

/** Inline image paragraph. px W/H define aspect; heightIn sets display height. */
function _pkImagePara(rId, pxW, pxH, heightIn, align) {
  const EMU = 914400;
  const h = Math.round(heightIn * EMU);
  const w = Math.round((pxW / pxH) * heightIn * EMU);
  const id = _pkDocPrId++;
  const jc = align === "right" ? "right" : (align === "left" ? "left" : "center");
  const drawing =
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${w}" cy="${h}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="logo${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="logo${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${jc}"/></w:pPr><w:r>${drawing}</w:r></w:p>`;
}

/* Floating logo anchored to the left/right margin, vertically centered on the
   line. Returns a run (to drop inside a centered paragraph) so the surrounding
   text stays centered on the full page width while the logo hugs the corner. */
function _pkFloatLogo(rId, pxW, pxH, heightIn, side) {
  const EMU = 914400;
  const h = Math.round(heightIn * EMU);
  const w = Math.round((pxW / pxH) * heightIn * EMU);
  const id = _pkDocPrId++;
  const halign = side === "right" ? "right" : "left";
  return `<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="2" ` +
    `behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin"><wp:align>${halign}</wp:align></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:align>center</wp:align></wp:positionV>` +
    `<wp:extent cx="${w}" cy="${h}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="logo${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="logo${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

const _PK_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>` +
  `</w:styles>`;

/* ── Small data helpers (shared by HTML + DOCX) ──────────────────────────── */

function _pkPartyLines(party) {
  if (!party) return [];
  const lines = (party.addr_lines || []).filter(Boolean).map((s) => String(s).trim());
  if (party.country) lines.push(String(party.country).trim());
  const poc = [party.contact, party.phone, party.email].filter(Boolean).map((s) => String(s).trim());
  for (const x of poc) lines.push(x);
  // de-dupe consecutive identical lines (contact often == org first line)
  const out = [];
  for (const ln of lines) { if (ln && ln !== out[out.length - 1]) out.push(ln); }
  return out.slice(0, 8);
}

function _pkCountryShort(s) {
  const m = String(s || "").match(/^(.*?)\s+-\s+[A-Z]{2}$/);
  return (m ? m[1] : (s || "")).trim().toUpperCase();
}

/* Known DTRA program acronyms -> full names. The program field is rendered as
   "Full Name (ACRONYM)". Ordered longest/most-specific first so e.g. PPP-U wins
   over PPP. If a value carries the "CTR" umbrella (e.g. "CTR / BTRP") only the
   specific program is shown. Unrecognized values pass through unchanged. */
const _PK_PROGRAMS = [
  ["PPP-U", "Proliferation Prevention Program - Ukraine"],
  ["BTRP", "Biological Threat Reduction Program"],
  ["CSE", "Chemical Security & Elimination"],
  ["DSTR", "Delivery System Threat Reduction"],
  ["GNS", "Global Nuclear Security"],
  ["PPP", "Proliferation Prevention Program"],
  ["RD", "Research and Development"],
];

function _pkExpandProgram(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  const up = s.toUpperCase().replace(/R\s*&\s*D/g, "RD");
  for (const [ac, full] of _PK_PROGRAMS) {
    const re = new RegExp("(^|[^A-Z0-9])" + ac.replace(/-/g, "\\-") + "($|[^A-Z0-9])");
    if (re.test(up)) return `${full} (${ac})`;
  }
  return s;
}

function _pkFmtWeight(lbs, kg) {
  const wl = toFloat(lbs), wk = toFloat(kg);
  if (!wl && !wk) return "";
  const lbsN = wl || (wk ? wk / 0.45359237 : 0);
  const kgN = wk || (wl ? wl * 0.45359237 : 0);
  return `${fmtFixed2(lbsN)} lb (${fmtFixed2(kgN)} kg)`;
}

function _pkHasHazmat(data) {
  return (data.items || []).some((it) => norm(it.un_code) || norm(it.hazmat_class));
}

function _pkHazmatText(data) {
  const seen = new Set();
  const parts = [];
  for (const it of data.items || []) {
    const cls = norm(it.hazmat_class);
    const un = norm(it.un_code);
    if (!cls && !un) continue;
    const key = `${cls}|${un}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bits = [];
    if (cls) bits.push("Class " + cls);
    if (un) bits.push(/^un/i.test(un) ? un.toUpperCase() : "UN" + un);
    parts.push(bits.join(" · "));
  }
  if (!parts.length) return "Contains hazardous materials — handle per applicable dangerous-goods regulations.";
  return parts.join("   |   ");
}

/* base64 / data-uri helpers for embedding logos in the .docx */
function _pkStripDataUri(s) {
  const i = String(s).indexOf("base64,");
  return i >= 0 ? String(s).slice(i + 7) : String(s);
}

function _pkB64ToU8(b64) {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  // Node fallback (tests)
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function _pkXmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── Placard preview/print CSS ───────────────────────────────────────────── */

const PLACARD_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; color:#000; }

.pk-page{
  box-sizing:border-box;
  width:760px;
  margin:0 auto 18px;
  background:#fff;
  box-shadow:0 0 10px rgba(0,0,0,0.25);
  padding:26px 28px;
}
.pk-empty{ padding:60px; text-align:center; color:#888; font-style:italic; }

.pk-card{ border:2px solid #16283C; }

.pk-head{
  display:grid; grid-template-columns:1fr auto 1fr;
  align-items:center; gap:14px;
  padding:10px 14px; border-bottom:2px solid #16283C;
}
.pk-logo img{ max-height:46px; max-width:100%; object-fit:contain; display:block; }
.pk-logo.left{ justify-self:start; } .pk-logo.left img{ margin-right:auto; }
.pk-logo.right{ justify-self:end; } .pk-logo.right img{ margin-left:auto; }
.pk-head-mid{ text-align:center; }
.pk-sub{ font-size:14pt; font-weight:bold; color:#16283C; line-height:1.25; white-space:nowrap; }

.pk-wmtr{ text-align:center; padding:12px 10px; background:#EFF1F3; border-bottom:2px solid #16283C; }
.pk-wmtr-lbl{ font-size:9pt; font-weight:bold; letter-spacing:2px; color:#C74A08; }
.pk-wmtr-val{ font-family:Consolas,"Courier New",monospace; font-size:26pt; font-weight:bold; color:#16283C; letter-spacing:1px; }

.pk-fromto{ display:grid; grid-template-columns:1fr 1fr; }
.pk-party{ padding:12px 14px; }
.pk-party + .pk-party{ border-left:2px solid #16283C; }
.pk-party-lbl{ font-size:9pt; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#C74A08; margin-bottom:6px; }
.pk-party-val{ font-size:13pt; line-height:1.45; }

.pk-grid{ display:grid; grid-template-columns:1fr 1fr; border-top:2px solid #16283C; }
.pk-cell{ padding:10px 14px; border-top:1px solid #16283C; border-left:1px solid #16283C; }
.pk-cell:nth-child(odd){ border-left:0; }
.pk-cell.big{ }
.pk-cell-lbl{ font-size:8.5pt; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#5B6B7C; }
.pk-cell-val{ font-size:15pt; font-weight:bold; color:#16283C; margin-top:2px; }
.pk-cell-val.mono{ font-family:Consolas,"Courier New",monospace; font-size:12pt; font-weight:600; }
.pk-cell-val .of{ font-weight:400; color:#5B6B7C; font-size:12pt; }
.pk-cell.agency{ grid-column:1 / -1; text-align:center; }
.pk-agency{ font-size:15pt; font-weight:bold; color:#16283C; letter-spacing:0.5px; }

.pk-route{
  text-align:center; padding:8px; border-top:2px solid #16283C;
  font-size:13pt; font-weight:bold; letter-spacing:2px; color:#16283C;
}
.pk-route .arr{ color:#C74A08; margin:0 8px; }

.pk-hazmat{
  display:flex; align-items:center; gap:12px;
  border-top:2px solid #16283C; background:#FBE9E7; padding:10px 14px;
}
.pk-hazmat .hz-bang{
  flex:0 0 auto; width:30px; height:30px; border-radius:50%;
  background:#B00000; color:#fff; font-weight:bold; font-size:18pt;
  display:flex; align-items:center; justify-content:center; line-height:1;
}
.pk-hazmat .hz-title{ font-size:11pt; font-weight:bold; letter-spacing:1px; color:#B00000; }
.pk-hazmat .hz-body{ font-size:10pt; font-weight:bold; color:#B00000; }

.pk-band{ border-top:2px solid #16283C; padding:10px 14px; }
.pk-band-lbl{ font-size:9pt; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#C74A08; margin-bottom:3px; }
.pk-band-val{ font-size:11pt; line-height:1.35; white-space:pre-line; }

.pk-foot{
  border-top:2px solid #16283C; padding:8px 14px;
  font-size:7.5pt; font-style:italic; color:#5B6B7C; text-align:center; line-height:1.3;
}

@page{ size:8.5in 11in; margin:0.5in; }
@media print{
  html,body{ background:#fff; }
  .pk-page{ width:auto; margin:0; padding:0; box-shadow:none; page-break-after:always; }
  .pk-page:last-child{ page-break-after:auto; }
  .pk-card{ page-break-inside:avoid; }
}
`;

/* ── Node test support (ignored by the browser) ──────────────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    placardsBuildModel, placardsRenderHtml, placardsBuildDocxZip,
    _pkBuildDocumentXml, _pkPartyLines, _pkHazmatText, _pkBoxCount: _pkBoxCount,
  };
  const u = require("../util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
  const q = require("../udq.js");
  global.makeParty = q.makeParty;
  try {
    const a = require("../assets.js");
    global.LOGO_LEFT = a.LOGO_LEFT; global.LOGO_RIGHT = a.LOGO_RIGHT;
  } catch (e) { global.LOGO_LEFT = ""; global.LOGO_RIGHT = ""; }
}
