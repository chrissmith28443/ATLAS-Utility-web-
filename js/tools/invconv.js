/* =========================================================================
   ATLAS Utility Web — invconv.js
   General Tools › Inventory Crosswalk.
   Converts an ATLAS Inventory List export between the service-type templates
   (SRF, PR, WS, PMCT). Row 3 holds the headers, data starts on row 4.

   Layouts (v1.3):
     PR / SRF — identical 58-column layout (Recommended/Actual vendor and
                manufacturer, Requested/Ordered qty and U/M, plus PR extras).
     WS       — 44-column layout (single Vendor / Manufacturer / Qty / U/M).
     PMCT     — the WS layout plus "Transfer Date".

   Columns are matched by HEADER TEXT (not position), so a column move in a
   future template version still lands correctly. Source columns with no home
   in the target are written to a second tab ("Crosswalk Carryover"); when that
   file is converted again, the carryover is read back so nothing is lost.
   ========================================================================= */

const INVCONV_FORMATS = [
  { id: "SRF",  label: "SRF",  layout: "PRSRF" },
  { id: "PR",   label: "PR",   layout: "PRSRF" },
  { id: "WS",   label: "WS",   layout: "WS"    },
  { id: "PMCT", label: "PMCT", layout: "PMCT"  },
];
const INVCONV_LAYOUT_LABEL = { PRSRF: "PR / SRF", WS: "WS", PMCT: "PMCT" };
const INVCONV_CARRY_SHEET = "Crosswalk Carryover";

/* Normalized header text -> field key (union of all four templates). */
const INVCONV_HEADER_KEYS = {
  "item #": "item", "p1": "p1", "p2": "p2", "p3": "p3",
  "description/nomenclature": "desc", "model/catalog #": "model",
  "vendor": "vendor", "recommended vendor": "vendorRec", "actual vendor": "vendorAct",
  "manufacturer": "mfr", "recommended manufacturer": "mfrRec", "actual manufacturer": "mfrAct",
  "brand name only?": "brandOnly", "serial #": "serial",
  "qty": "qty", "qty requested": "qtyReq", "qty received": "qtyRcv", "qty ordered": "qtyOrd",
  "u/m": "um", "u/m requested": "umReq", "u/m ordered": "umOrd", "u/i": "ui",
  "est. shipping cost to trls wh.": "shipCost", "actual trls d. date": "trlsDate",
  "value (usd)": "value",
  "est. wt (lbs)": "estWtLb", "est. wt (kg)": "estWtKg",
  "est. ln (in)": "estLnIn", "est. wd (in)": "estWdIn", "est. ht (in)": "estHtIn",
  "est. ln (cm)": "estLnCm", "est. wd (cm)": "estWdCm", "est. ht (cm)": "estHtCm",
  "final wt (lbs)": "finWtLb", "final wt (kg)": "finWtKg",
  "final ln (in)": "finLnIn", "final wd (in)": "finWdIn", "final ht (in)": "finHtIn",
  "final ln (cm)": "finLnCm", "final wd (cm)": "finWdCm", "final ht (cm)": "finHtCm",
  "eccn/usml": "eccn", "schedule b/hts code": "hts",
  "original equipment manu.": "oem",
  "manu. country of origin": "coo", "mat. manu. country of origin": "coo",
  "property type": "propType", "temp. control req.": "temp",
  "haz class": "haz", "installation req.": "install", "mat. handling req.": "handling",
  "term storage req.": "termStorage", "current custody": "custody",
  "country": "country", "city": "city", "transfer date": "transferDate",
  "general comments": "comments",
  "pr group #": "group", "ws group #": "group", "pmct group #": "group",
  "bis/ddtc auth or exception": "auth", "reorder? y/n": "reorder",
  "previously selected item": "prevItem", "purchase order": "po",
};

/* Where each target column takes its value from (first non-blank wins).
   Long → short: Actual/Ordered first, then Recommended/Requested.
   Short → long: the single value fills BOTH sides. */
const INVCONV_FROM = {
  vendor:    ["vendor", "vendorAct", "vendorRec"],
  vendorRec: ["vendorRec", "vendor"],
  vendorAct: ["vendorAct", "vendor"],
  mfr:       ["mfr", "mfrAct", "mfrRec"],
  mfrRec:    ["mfrRec", "mfr"],
  mfrAct:    ["mfrAct", "mfr"],
  qty:       ["qty", "qtyOrd", "qtyReq"],
  qtyReq:    ["qtyReq", "qty"],
  qtyOrd:    ["qtyOrd", "qty"],
  um:        ["um", "umOrd", "umReq"],
  umReq:     ["umReq", "um"],
  umOrd:     ["umOrd", "um"],
};

/* Date-serial fields — styled as dates on the carryover tab. */
const INVCONV_DATE_KEYS = { trlsDate: 1, shelf: 1, transferDate: 1 };

const InvConvUi = { files: [], targets: {} };

function invconvNormHdr(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
}

function invconvHeaderKey(label) {
  const n = invconvNormHdr(label);
  if (!n) return null;
  if (INVCONV_HEADER_KEYS[n]) return INVCONV_HEADER_KEYS[n];
  if (n.startsWith("leadtime")) return "leadTime";
  if (n.startsWith("shelf life")) return "shelf";
  return "x:" + n;   // unknown column — still carried, keyed by its own header
}

function invconvBlank(v) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/* ---------------- Reading a source workbook ---------------- */

/** Find the header row (row 3 in ATLAS exports; searched in case of drift).
    The carryover tab has no Description column, so it only needs "Item #". */
function _invconvHeaderRow(rows, carryTab) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const n = (rows[r] || []).map(invconvNormHdr);
    if (n.includes("item #") && (carryTab || n.includes("description/nomenclature"))) return r;
  }
  return -1;
}

/** Sheet rows -> { cols:[{idx,key,label}], recs:[{key:value}] }. */
function _invconvReadSheet(rows, carryTab) {
  const h = _invconvHeaderRow(rows, carryTab);
  if (h < 0) return null;
  const cols = [];
  const seen = {};
  (rows[h] || []).forEach((label, idx) => {
    const key = invconvHeaderKey(label);
    if (!key || seen[key]) return;
    seen[key] = 1;
    cols.push({ idx, key, label: String(label).trim() });
  });
  const recs = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rec = {};
    let content = false;
    for (const c of cols) {
      const v = row[c.idx];
      if (invconvBlank(v)) continue;
      rec[c.key] = typeof v === "string" ? v.trim() : v;
      if (c.key !== "item" && c.key !== "p1" && c.key !== "p2" && c.key !== "p3") content = true;
    }
    // Carryover rows stay 1:1 with the main sheet, even when a row carried nothing.
    if (content || (carryTab && rec.item != null)) recs.push(rec);
  }
  return { cols, recs };
}

function invconvDetectLayout(cols) {
  const keys = new Set(cols.map((c) => c.key));
  const hdrs = new Set(cols.map((c) => invconvNormHdr(c.label)));
  if (keys.has("vendorRec") || keys.has("qtyReq") || hdrs.has("pr group #")) return "PRSRF";
  if (hdrs.has("pmct group #") || keys.has("transferDate")) return "PMCT";
  if (hdrs.has("ws group #") || (keys.has("vendor") && keys.has("qty"))) return "WS";
  return null;
}

async function invconvParseFile(file) {
  const out = { name: file.name, layout: null, recs: [], labels: {}, carried: 0, error: "" };
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const main = wb.Sheets[wb.SheetNames[0]];
    const sheet = _invconvReadSheet(XLSX.utils.sheet_to_json(main, { header: 1, raw: true, defval: null }));
    if (!sheet) { out.error = "Not an ATLAS Inventory List — no headers found in row 3."; return out; }
    out.layout = invconvDetectLayout(sheet.cols);
    if (!out.layout) { out.error = "Headers found, but they don't match an SRF, PR, WS or PMCT template."; return out; }
    out.recs = sheet.recs;
    for (const c of sheet.cols) out.labels[c.key] = c.label;

    // Carryover tab from an earlier conversion: restore those columns.
    const carryWs = wb.Sheets[INVCONV_CARRY_SHEET];
    if (carryWs) {
      const carry = _invconvReadSheet(XLSX.utils.sheet_to_json(carryWs, { header: 1, raw: true, defval: null }), true);
      if (carry && carry.recs.length) {
        for (const c of carry.cols) if (!out.labels[c.key]) out.labels[c.key] = c.label;
        // Match rows by Item # when every row has a unique one, else by order.
        const items = out.recs.map((r) => (r.item == null ? "" : String(r.item)));
        const byItem = items.every((x) => x) && new Set(items).size === items.length;
        const carryByItem = {};
        carry.recs.forEach((cr) => { if (cr.item != null) carryByItem[String(cr.item)] = cr; });
        out.recs.forEach((rec, i) => {
          const cr = byItem ? carryByItem[items[i]] : carry.recs[i];
          if (!cr) return;
          for (const k of Object.keys(cr)) {
            if (k === "item" || !invconvBlank(rec[k])) continue;
            rec[k] = cr[k];
          }
        });
        out.carried = carry.cols.length - 1;
      }
    }
  } catch (e) {
    console.error(e);
    out.error = "Couldn't read this file: " + e.message;
  }
  return out;
}

/* ---------------- Writing a target workbook ---------------- */

function _invconvXmlEsc(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _invconvColLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function _invconvCell(ref, style, v) {
  const sa = style ? ` s="${style}"` : "";
  if (invconvBlank(v)) return `<c r="${ref}"${sa}/>`;
  if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${sa}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${_invconvXmlEsc(v)}</t></is></c>`;
}

/** Template row 3 (headers) and row 4 (styles) -> [{letter, key, style}]. */
function _invconvTemplateCols(sheetXml, shared) {
  const r3 = (sheetXml.match(/<row r="3"[^>]*>([\s\S]*?)<\/row>/) || [])[1] || "";
  const r4 = (sheetXml.match(/<row r="4"[^>]*>([\s\S]*?)<\/row>/) || [])[1] || "";
  const styles = {};
  r4.replace(/<c r="([A-Z]+)4"(?: s="(\d+)")?/g, (m, col, s) => { styles[col] = s || ""; return m; });
  const cols = [];
  const re = /<c r="([A-Z]+)3"[^>]*?t="s"[^>]*>\s*<v>(\d+)<\/v>/g;
  let m;
  while ((m = re.exec(r3)) !== null) {
    const key = invconvHeaderKey(shared[parseInt(m[2], 10)] || "");
    if (key) cols.push({ letter: m[1], key, style: styles[m[1]] || "" });
  }
  return cols;
}

/** Build one converted workbook. Returns { b64, rows, carryLabels[] }. */
async function invconvBuild(src, fmt) {
  const bin = atob(INVCONV_TEMPLATES_B64[fmt.layout]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const sheetPath = "xl/worksheets/sheet1.xml";
  let sheetXml = await zip.file(sheetPath).async("string");
  const shared = _coreimsParseSharedStrings(await zip.file("xl/sharedStrings.xml").async("string"));
  const tcols = _invconvTemplateCols(sheetXml, shared);

  // Main sheet rows, tracking which source fields actually landed somewhere.
  const used = new Set();
  const rowsXml = src.recs.map((rec, i) => {
    const r = i + 4;
    const cells = tcols.map((c) => {
      let v = null;
      for (const k of (INVCONV_FROM[c.key] || [c.key])) {
        if (!invconvBlank(rec[k])) { v = rec[k]; used.add(k); break; }
      }
      return _invconvCell(c.letter + r, c.style, v);
    });
    return `<row r="${r}">${cells.join("")}</row>`;
  }).join("");
  const lastLetter = tcols.length ? tcols[tcols.length - 1].letter : "A";
  sheetXml = sheetXml
    .replace(/<row r="4"[^>]*>[\s\S]*?<\/row>|<row r="4"[^>]*\/>/, rowsXml)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastLetter}${Math.max(3, src.recs.length + 3)}"/>`);
  zip.file(sheetPath, sheetXml);

  // Carryover: every source field with data that didn't land in the target.
  const carryKeys = [];
  const seen = new Set();
  for (const rec of src.recs) {
    for (const k of Object.keys(rec)) {
      if (k === "item" || used.has(k) || seen.has(k) || invconvBlank(rec[k])) continue;
      seen.add(k); carryKeys.push(k);
    }
  }
  if (carryKeys.length) await _invconvAddCarrySheet(zip, src, fmt, carryKeys);

  return {
    b64: await zip.generateAsync({ type: "base64", compression: "DEFLATE" }),
    rows: src.recs.length,
    carryLabels: carryKeys.map((k) => (src.labels[k] || k).replace(/\s+/g, " ").trim()),
  };
}

async function _invconvAddCarrySheet(zip, src, fmt, carryKeys) {
  const heads = ["Item #"].concat(carryKeys.map((k) => src.labels[k] || k));
  const inline = (ref, v) => _invconvCell(ref, "", v);
  const rowsXml = [];
  rowsXml.push(`<row r="1">${inline("A1", "ATLAS Utility — Inventory Crosswalk carryover")}</row>`);
  rowsXml.push(`<row r="2">${inline("A2",
    `Columns from the ${src.sourceLabel || INVCONV_LAYOUT_LABEL[src.layout] + " file"} that have no place in the ${fmt.label} template. ` +
    `Converting this file again in the Utility restores them.`)}</row>`);
  rowsXml.push(`<row r="3">${heads.map((h, i) => inline(_invconvColLetter(i + 1) + "3", h)).join("")}</row>`);
  src.recs.forEach((rec, i) => {
    const r = i + 4;
    const cells = [_invconvCell("A" + r, "", rec.item == null ? i + 1 : rec.item)]
      .concat(carryKeys.map((k, j) =>
        _invconvCell(_invconvColLetter(j + 2) + r, INVCONV_DATE_KEYS[k] && typeof rec[k] === "number" ? "25" : "", rec[k])));
    rowsXml.push(`<row r="${r}">${cells.join("")}</row>`);
  });
  const lastCol = _invconvColLetter(heads.length);
  const colsXml = heads.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${i ? 22 : 8}" customWidth="1"/>`).join("");
  zip.file("xl/worksheets/sheet2.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${src.recs.length + 3}"/><cols>${colsXml}</cols>` +
    `<sheetData>${rowsXml.join("")}</sheetData></worksheet>`);

  const wbPath = "xl/workbook.xml";
  const wb = await zip.file(wbPath).async("string");
  zip.file(wbPath, wb.replace("</sheets>",
    `<sheet name="${INVCONV_CARRY_SHEET}" sheetId="2" r:id="rIdIcCarry"/></sheets>`));

  const relPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relPath).async("string");
  zip.file(relPath, rels.replace("</Relationships>",
    `<Relationship Id="rIdIcCarry" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`));

  const ctPath = "[Content_Types].xml";
  const ct = await zip.file(ctPath).async("string");
  zip.file(ctPath, ct.replace("</Types>",
    `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
}

/* ---------------- Workspace UI ---------------- */

function renderInvConvWorkspace(container) {
  const fmtBoxes = INVCONV_FORMATS.map((f) => `
    <label class="ic-fmt"><input type="checkbox" data-fmt="${f.id}"${InvConvUi.targets[f.id] ? " checked" : ""}> ${esc(f.label)}</label>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>Inventory Crosswalk</h2><span class="count">General Tools</span></header>
      <div class="body">
        <div class="note">
          Converts an ATLAS Inventory List export from one service type to another, so a PR inventory can be
          uploaded into an SRF, WS or PMCT (and back) without the columns getting jumbled. Drop one or more
          exports — the template type is detected automatically — then pick the format(s) you want.
        </div>

        <div class="dropzone compact" id="icDrop" tabindex="0" role="button" aria-label="Load inventory list files">
          <div>
            <div class="dz-title">Drop inventory lists here</div>
            <div class="dz-sub">or click to browse — SRF, PR, WS or PMCT template (.xlsx), one or several files</div>
          </div>
        </div>
        <input type="file" id="icInput" accept=".xlsx,.xlsm,.xls" multiple class="hidden">

        <div id="icFiles"></div>

        <div class="ic-out">
          <div class="ic-outhead">Convert to</div>
          <div class="ic-fmts">
            ${fmtBoxes}
            <button class="btn ghost" id="icAll" type="button">All</button>
          </div>
          <div class="hint">PR and SRF use the same layout, so a PR inventory already uploads into an SRF as-is (and vice versa).
            A file is never converted to its own layout.</div>
        </div>

        <div class="btnrow"><button class="btn primary" id="icGo" type="button">Convert &amp; download</button></div>
        <div class="statusline" id="icStatus"></div>
        <div id="icResults"></div>

        <details class="ic-map">
          <summary>How fields are mapped</summary>
          <ul>
            <li>Columns are matched by their header name, so matching columns copy straight across.</li>
            <li><strong>PR/SRF → WS/PMCT:</strong> Vendor, Manufacturer and U/M take the <em>Actual</em> / <em>Ordered</em>
              value, or the Recommended / Requested value when that's blank. Qty takes Qty Ordered, or Qty Requested when blank.</li>
            <li><strong>WS/PMCT → PR/SRF:</strong> Vendor, Manufacturer, Qty and U/M fill both the Recommended/Requested and
              Actual/Ordered columns.</li>
            <li>Mat. Manu. Country of Origin ↔ Manu. Country of Origin, and WS / PMCT / PR Group # carry across.</li>
            <li>Anything with no home in the target (e.g. Brand Name Only?, Lead Time, Property Type, Transfer Date) goes to a
              second tab, <em>${esc(INVCONV_CARRY_SHEET)}</em>. Convert that file again and those columns come back.</li>
          </ul>
        </details>
      </div>
    </div>`);
  container.appendChild(panel);

  const drop = panel.querySelector("#icDrop");
  const input = panel.querySelector("#icInput");
  const addFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    _invconvStatus("Reading…", false);
    for (const f of files) {
      const parsed = await invconvParseFile(f);
      InvConvUi.files = InvConvUi.files.filter((x) => x.name !== parsed.name).concat(parsed);
    }
    _invconvStatus("", false);
    _invconvRenderFiles();
  };
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  panel.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  panel.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) drop.classList.remove("dragover"); });
  panel.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("dragover");
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });

  panel.querySelectorAll("input[data-fmt]").forEach((cb) => cb.addEventListener("change", () => {
    InvConvUi.targets[cb.dataset.fmt] = cb.checked;
  }));
  panel.querySelector("#icAll").addEventListener("click", () => {
    const all = !INVCONV_FORMATS.every((f) => InvConvUi.targets[f.id]);
    panel.querySelectorAll("input[data-fmt]").forEach((cb) => { cb.checked = all; InvConvUi.targets[cb.dataset.fmt] = all; });
  });
  panel.querySelector("#icGo").addEventListener("click", invconvRun);

  _invconvRenderFiles();
}

function _invconvStatus(msg, isErr) {
  const s = document.getElementById("icStatus");
  if (!s) return;
  s.textContent = msg;
  s.classList.toggle("err", !!isErr);
}

function _invconvRenderFiles() {
  const box = document.getElementById("icFiles");
  if (!box) return;
  if (!InvConvUi.files.length) { box.innerHTML = ""; return; }
  const rows = InvConvUi.files.map((f, i) => `
    <tr>
      <td>${esc(f.name)}</td>
      <td>${f.error ? "—" : `<strong>${esc(INVCONV_LAYOUT_LABEL[f.layout])}</strong>`}</td>
      <td class="num">${f.error ? "" : f.recs.length}</td>
      <td>${f.error ? `<span class="ic-err">${esc(f.error)}</span>`
        : (f.carried ? `Includes a carryover tab (${f.carried} column${f.carried === 1 ? "" : "s"} restored)` : "Ready")}</td>
      <td><button class="btn ghost ic-rm" type="button" data-i="${i}" title="Remove" aria-label="Remove ${esc(f.name)}">×</button></td>
    </tr>`).join("");
  box.innerHTML = `
    <div class="scrollwrap"><table class="data ic-table">
      <thead><tr><th>File</th><th>Detected template</th><th>Rows</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  box.querySelectorAll(".ic-rm").forEach((b) => b.addEventListener("click", () => {
    InvConvUi.files.splice(parseInt(b.dataset.i, 10), 1);
    _invconvRenderFiles();
  }));
}

async function invconvRun() {
  const results = document.getElementById("icResults");
  if (results) results.innerHTML = "";
  const files = InvConvUi.files.filter((f) => !f.error);
  const fmts = INVCONV_FORMATS.filter((f) => InvConvUi.targets[f.id]);
  if (!files.length) return _invconvStatus("Add at least one inventory list first.", true);
  if (!fmts.length) return _invconvStatus("Pick at least one format to convert to.", true);
  if (typeof JSZip === "undefined") return _invconvStatus("JSZip is not available.", true);

  _invconvStatus("Converting…", false);
  const outputs = [];
  const lines = [];
  try {
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, "");
      for (const fmt of fmts) {
        if (fmt.layout === f.layout) {
          lines.push({ file: f.name, to: fmt.label, msg: "Skipped — already this layout" });
          continue;
        }
        const r = await invconvBuild(f, fmt);
        const fname = `${base}_to_${fmt.id}.xlsx`;
        outputs.push({ fname, b64: r.b64 });
        lines.push({
          file: f.name, to: fmt.label,
          msg: `${r.rows} row${r.rows === 1 ? "" : "s"}` +
            (r.carryLabels.length ? ` · moved to the carryover tab: ${r.carryLabels.join(", ")}` : " · every column carried across"),
        });
      }
    }
    if (!outputs.length) {
      _invconvStatus("Nothing to convert — each file is already in the selected layout.", true);
    } else if (outputs.length === 1) {
      _invconvDownload(outputs[0].fname, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", outputs[0].b64);
      _invconvStatus(`✅ Downloaded ${outputs[0].fname}`, false);
    } else {
      const zip = new JSZip();
      for (const o of outputs) zip.file(o.fname, o.b64, { base64: true });
      const fname = `Inventory_Crosswalk_${fileStamp()}.zip`;
      _invconvDownload(fname, "application/zip", await zip.generateAsync({ type: "base64" }));
      _invconvStatus(`✅ Downloaded ${fname} (${outputs.length} files)`, false);
    }
  } catch (e) {
    console.error(e);
    _invconvStatus(`Error: ${e.message}`, true);
  }
  if (results && lines.length) {
    results.innerHTML = `
      <div class="scrollwrap"><table class="data ic-table">
        <thead><tr><th>File</th><th>To</th><th>Result</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.file)}</td><td><strong>${esc(l.to)}</strong></td><td>${esc(l.msg)}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }
}

function _invconvDownload(fname, mime, b64) {
  const a = document.createElement("a");
  a.href = `data:${mime};base64,${b64}`;
  a.download = fname;
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}
