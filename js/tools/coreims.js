/* =========================================================================
   ATLAS Utility Web — tools/coreims.js
   CoreIMS import workbook generator.

   FAITHFUL PORT of the desktop v4.4 CoreIMS export:
     - services/coreims_service.py     (run_coreims_pipeline / _read_udq_rows:
                                         fixed UDQ→template column map, serial
                                         "P" blanking, break on first all-empty
                                         row, write-by-template-header,
                                         last-5 WMTR naming)
     - templates/coreims_import_template.xlsx  (embedded as base64 in
                                                 coreims_template.js)

   Output is an .xlsx produced entirely in the browser by editing the template
   at the XML level with JSZip — the same approach the IPC/SLI/PL tools use. The
   template's own header row (sheet "in") is read at runtime — exactly like the
   desktop's _build_template_header_map — and the mapped UDQ values are written
   beneath it by header name, so untouched CoreIMS columns stay blank.

   Reads directly from AppState.grid (not the property data model): CoreIMS needs
   several inventory columns the property reader doesn't capture (Actual Vendor,
   Equipment Manufacture Country Of Origin, Temperature Control Requirements,
   Shelf Life, HAZMAT Classification, Material Handling Requirements, General
   Comments). Column discovery uses the shared udq.js helpers, so it tracks the
   "Inventory List" section the same way every other tool does.

   PARITY NOTES (intentional, all flagged):
     - Row scanning starts at udq.js inventoryStartRow() (header row + 1) rather
       than the desktop's hard-coded row 5. On a standard property UDQ these are
       identical; the dynamic start is more robust and matches the rest of the
       web app. Scanning is additionally bounded by inventoryEndRow() (the next
       section title) and still stops at the first fully-empty source row, as the
       desktop does.
     - The desktop raises if any source column is missing and produces no file.
       The web surfaces the missing UDQ headers up front and blocks generation —
       same outcome (no file), clearer feedback.
     - Package rows (Serial # == "P") are NOT skipped, matching the desktop: the
       row is still exported, but its serial (isSerialControlled / customField03)
       is blanked. This differs from IPC and the property reader, which drop "P".
   ========================================================================= */

/* ---- UDQ source column → CoreIMS template-header mapping (desktop order) ----
   Each entry: the template-header field that receives the value, plus the
   ordered list of UDQ inventory headers to try (first present wins). Mirrors
   coreims_service._read_udq_rows source_cols + UDQ_TO_TEMPLATE_MAP. */
const COREIMS_SOURCES = [
  { key: "description",        target: "description",        udq: ["Description"] },
  // Serial drives BOTH isSerialControlled and customField03 (handled specially).
  { key: "serial",            target: "isSerialControlled",  udq: ["Serial #"] },
  { key: "model",             target: "customField06",
    udq: ["Model/Catalog Number", "Model / Catalog No", "Model", "Catalog Number"] },
  { key: "vendor",            target: "customField07",      udq: ["Actual Vendor"] },
  { key: "manufacturer",      target: "customField08",      udq: ["Actual Manufacturer"] },
  { key: "unit_of_issue",     target: "customField09",      udq: ["Unit Of Issue", "Unit Of Measure"] },
  { key: "country_of_origin", target: "customField11",      udq: ["Equipment Manufacture Country Of Origin"] },
  { key: "temp_control",      target: "customField12",      udq: ["Temperature Control Requirements"] },
  { key: "shelf_life",        target: "customField13",      udq: ["Shelf Life/Expiration Date For Perishable Items"] },
  { key: "hazmat",            target: "customField14",      udq: ["HAZMAT Classification"] },
  { key: "handling",          target: "customField16",      udq: ["Material Handling Requirements"] },
  { key: "comments",          target: "customField17",      udq: ["General Comments"] },
];

/* Template headers the desktop requires to be present (coreims_service
   required_template_headers). customField03 has no own source — it mirrors the
   serial — so it is validated but not in COREIMS_SOURCES. */
const COREIMS_REQUIRED_TEMPLATE_HEADERS = [
  "description", "isSerialControlled", "customField03", "customField06",
  "customField07", "customField08", "customField09", "customField11",
  "customField12", "customField13", "customField14", "customField16",
  "customField17",
];

/** Normalize a header for matching (port of _normalize_header: collapse ws + casefold). */
function _coreimsNormHdr(v) {
  return normWs(v).toLowerCase();
}

/* ---- Model builder: faithful port of _read_udq_rows (minus Excel I/O) ---- */

function coreimsBuildModel(grid) {
  const shipMap = buildHeaderMap(grid, SHIP_HDR_ROW);
  const invHdrRow = inventoryHeaderRow(grid);
  const invStartRow = inventoryStartRow(grid);
  const invEndRow = inventoryEndRow(grid);
  const invMap = buildHeaderMap(grid, invHdrRow);

  const wmtr = shipValue(grid, shipMap, "WMTR Number");

  // Resolve every source column (first present UDQ header wins). All are
  // required by the desktop; collect the resolved column and any that are
  // missing so the UI can block generation with a clear message.
  const cols = {};      // key -> 1-based column
  const resolvedHeader = {}; // key -> the UDQ header that matched (for display)
  const missing = [];   // [{key, tried:[...]}]
  for (const src of COREIMS_SOURCES) {
    let found = 0, foundName = "";
    for (const name of src.udq) {
      const c = invMap[normWs(name)];
      if (c) { found = c; foundName = name; break; }
    }
    if (found) { cols[src.key] = found; resolvedHeader[src.key] = foundName; }
    else missing.push({ key: src.key, tried: src.udq });
  }

  const items = [];
  if (!missing.length) {
    for (let r = invStartRow; r <= invEndRow; r++) {
      // Read all 12 source values for this row.
      const raw = {};
      for (const src of COREIMS_SOURCES) raw[src.key] = norm(gridCell(grid, r, cols[src.key]));

      // Break on the first row with no source data at all (desktop behavior).
      if (!Object.values(raw).some((v) => v)) break;

      // Serial "P" -> blank (drives both isSerialControlled and customField03).
      const serialClean = raw.serial.toUpperCase() === "P" ? "" : raw.serial;

      // Build the template-target field map (untouched columns stay absent/blank).
      const fields = {
        description:        raw.description,
        isSerialControlled: serialClean,
        customField03:      serialClean,
        customField06:      raw.model,
        customField07:      raw.vendor,
        customField08:      raw.manufacturer,
        customField09:      raw.unit_of_issue,
        customField11:      raw.country_of_origin,
        customField12:      raw.temp_control,
        customField13:      raw.shelf_life,
        customField14:      raw.hazmat,
        customField16:      raw.handling,
        customField17:      raw.comments,
      };

      items.push({ row: r, fields });
    }
  }

  return {
    wmtr,
    wmtr_last5: wmtrLast5(wmtr),
    invHdrRow,
    cols,
    resolvedHeader,
    missing,                       // non-empty => generation blocked
    items,
  };
}

/* ---- Workbook writer: edit the template's sheet XML with JSZip ----
   Matches the IPC/PL/SLI tools (and avoids SheetJS XLSX.write, which froze the
   main thread). The template (sheet "in") is a single shared-strings header row
   in columns A–AD; we read that header row to map each CoreIMS field to its
   column letter (faithful to coreims_service._build_template_header_map), append
   one inline-string data row per item, and repack — every other part verbatim. */

/** Minimal XML text/attribute escaper. */
function _coreimsXmlEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tiny entity un-escaper for header text pulled from sharedStrings. */
function _coreimsXmlUnesc(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Column letters -> 1-based index ("C" -> 3, "AA" -> 27). */
function _coreimsColIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Parse sharedStrings.xml into an ordered array of plain strings. */
function _coreimsParseSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t, parts = "";
    while ((t = tRe.exec(m[1])) !== null) parts += t[1];
    out.push(_coreimsXmlUnesc(parts));
  }
  return out;
}

/** Build {normalized header -> column letters} from the template's row 1. */
function _coreimsHeaderLetters(sheetXml, shared) {
  const map = {};
  const rowM = sheetXml.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/);
  if (!rowM) return map;
  const cRe = /<c r="([A-Z]+)1"[^>]*?t="s"[^>]*?>\s*<v>(\d+)<\/v>\s*<\/c>/g;
  let m;
  while ((m = cRe.exec(rowM[1])) !== null) {
    const key = _coreimsNormHdr(shared[parseInt(m[2], 10)] || "");
    if (key && map[key] === undefined) map[key] = m[1];
  }
  return map;
}

async function coreimsWriteWorkbook(model) {
  if (model.missing && model.missing.length) {
    throw new Error(
      "UDQ is missing required inventory column(s): " +
      model.missing.map((m) => m.tried[0]).join(", ")
    );
  }

  // Decode the embedded template and open it with JSZip.
  const bin = atob(COREIMS_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const SHEET_PATH = "xl/worksheets/sheet1.xml";
  let sheetXml = await zip.file(SHEET_PATH).async("string");
  const sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
  const shared = _coreimsParseSharedStrings(sharedXml);

  // Map each CoreIMS field to its template column letter (read from the header).
  const hletters = _coreimsHeaderLetters(sheetXml, shared);
  const missingTmpl = COREIMS_REQUIRED_TEMPLATE_HEADERS
    .filter((h) => hletters[_coreimsNormHdr(h)] === undefined);
  if (missingTmpl.length) {
    throw new Error("Missing CoreIMS template header(s): " + missingTmpl.join(", "));
  }

  // Build one inline-string data row per item; blank fields are simply omitted.
  let rowsXml = "";
  model.items.forEach((it, i) => {
    const r = i + 2; // row 1 is the header
    const cells = [];
    for (const [target, value] of Object.entries(it.fields)) {
      if (value === "" || value === null || value === undefined) continue;
      const letters = hletters[_coreimsNormHdr(target)];
      if (!letters) continue;
      cells.push({ ci: _coreimsColIndex(letters), ref: letters + r, value });
    }
    cells.sort((a, b) => a.ci - b.ci);
    let cellsXml = "";
    for (const c of cells) {
      const v = _coreimsXmlEsc(String(c.value)).replace(/\r?\n/g, "&#10;");
      cellsXml += `<c r="${c.ref}" t="inlineStr"><is><t xml:space="preserve">${v}</t></is></c>`;
    }
    rowsXml += `<row r="${r}" spans="1:30">${cellsXml}</row>`;
  });

  // Insert the data rows after the header and widen the dimension.
  sheetXml = sheetXml.replace("</sheetData>", rowsXml + "</sheetData>");
  const lastRow = 1 + model.items.length;
  sheetXml = sheetXml.replace(
    /<dimension ref="A1:[A-Z]+\d+"\/>/,
    `<dimension ref="A1:AD${lastRow}"/>`
  );

  zip.file(SHEET_PATH, sheetXml); // all other parts kept verbatim
  return await zip.generateAsync({ type: "base64" });
}

/* ---- Live preview: HTML mirror of the generated .xlsx (browser only) ---- */

const COREIMS_PREVIEW_COLS = [
  { hdr: "description",        label: "description" },
  { hdr: "isSerialControlled", label: "isSerialControlled" },
  { hdr: "customField03",      label: "cf03 · serial" },
  { hdr: "customField06",      label: "cf06 · model" },
  { hdr: "customField07",      label: "cf07 · vendor" },
  { hdr: "customField08",      label: "cf08 · mfr" },
  { hdr: "customField09",      label: "cf09 · U/I" },
  { hdr: "customField11",      label: "cf11 · country" },
  { hdr: "customField12",      label: "cf12 · temp" },
  { hdr: "customField13",      label: "cf13 · shelf life" },
  { hdr: "customField14",      label: "cf14 · HAZMAT" },
  { hdr: "customField16",      label: "cf16 · handling" },
  { hdr: "customField17",      label: "cf17 · comments" },
];

function coreimsRenderHtml(model) {
  if (model.missing && model.missing.length) {
    const rows = model.missing.map((m) =>
      `<li><span class="mono">${esc(m.tried[0])}</span>${
        m.tried.length > 1 ? ` <span class="muted">(or ${m.tried.slice(1).map(esc).join(", ")})</span>` : ""
      }</li>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><style>${COREIMS_CSS}</style></head>
      <body><div class="cims-page">
        <div class="cims-title">CoreIMS import — cannot generate</div>
        <div class="cims-err">
          This UDQ is missing inventory column(s) CoreIMS requires:
          <ul>${rows}</ul>
          Check that this is an unmodified Property Management export.
        </div>
      </div></body></html>`;
  }

  const head = COREIMS_PREVIEW_COLS
    .map((c) => `<th>${esc(c.label)}</th>`).join("");

  const body = model.items.map((it, i) => {
    const cells = COREIMS_PREVIEW_COLS.map((c) => {
      const v = it.fields[c.hdr] || "";
      const cls = ["description", "isSerialControlled"].includes(c.hdr) ? "" : "mono";
      return `<td class="${cls}">${esc(v)}</td>`;
    }).join("");
    return `<tr><td class="rn">${i + 1}</td>${cells}</tr>`;
  }).join("");

  const empty = `<tr><td colspan="${COREIMS_PREVIEW_COLS.length + 1}" class="empty">No inventory items found</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>CoreIMS</title>
<style>${COREIMS_CSS}</style></head><body>
<div class="cims-page">
  <div class="cims-title">CoreIMS Import Workbook</div>
  <div class="cims-sub">Sheet <span class="mono">in</span> · ${model.items.length} item${model.items.length === 1 ? "" : "s"}
    · header row read from <span class="mono">coreims_import_template.xlsx</span>.
    Columns not shown (code, altCode, barcode, isLotControlled, …) are exported blank.</div>
  <div class="cims-scroll">
    <table class="cims-tbl">
      <thead><tr><th class="rn">#</th>${head}</tr></thead>
      <tbody>${body || empty}</tbody>
    </table>
  </div>
</div>
</body></html>`;
}

const COREIMS_CSS = `
html,body{ margin:0; padding:0; }
body{ font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#000; background:#fff; }
.cims-page{ box-sizing:border-box; padding:16px 18px 22px; }
.cims-title{ font-size:14pt; font-weight:bold; padding:2px 0 4px; }
.cims-sub{ font-size:8.5pt; color:#444; padding-bottom:10px; line-height:1.4; }
.cims-scroll{ overflow-x:auto; border:1px solid #cdd3da; }
.cims-tbl{ border-collapse:collapse; table-layout:auto; min-width:100%; white-space:nowrap; }
.cims-tbl th{ background:#e9edf1; border:1px solid #c2c9d1; padding:4px 7px; font-size:7.5pt; text-align:left; position:sticky; top:0; }
.cims-tbl td{ border:1px solid #d7dce2; padding:3px 7px; font-size:8pt; vertical-align:top; }
.cims-tbl td.rn, .cims-tbl th.rn{ text-align:right; color:#888; width:28px; }
.cims-tbl td.mono{ font-family:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; font-size:7.5pt; }
.cims-tbl td.empty{ text-align:center; color:#888; font-style:italic; white-space:normal; }
.cims-err{ border:1px solid #d9534f; background:#fdf3f2; padding:10px 14px; font-size:9pt; line-height:1.5; border-radius:4px; }
.cims-err ul{ margin:8px 0 2px; padding-left:20px; }
.cims-err .muted{ color:#777; }
.mono{ font-family:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; }
`;

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    coreimsBuildModel, coreimsRenderHtml, COREIMS_SOURCES,
    _coreimsParseSharedStrings, _coreimsHeaderLetters, _coreimsColIndex,
    _coreimsXmlEsc, COREIMS_REQUIRED_TEMPLATE_HEADERS,
  };
  const u = require("../util.js");
  for (const k of Object.keys(u)) global[k] = u[k];
  const q = require("../udq.js");
  for (const k of Object.keys(q)) global[k] = q[k];
}
