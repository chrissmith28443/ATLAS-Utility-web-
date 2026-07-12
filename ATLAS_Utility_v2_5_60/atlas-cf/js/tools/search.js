/* =========================================================================
   ATLAS Utility Web — tools/search.js
   "Compliance Search" — a Tools-section utility for querying a loaded
   history / dataset workbook for compliance details (HS / Schedule B,
   ECCN / USML, country of manufacture, license authorization, ITAR, …)
   by a partial item description OR by any compliance value.

   Design notes
   ------------
   - Header-driven, never fixed columns. Every field is resolved by matching
     the column-header text (case-insensitively) the same way udq.js does.
   - Handles two very different worksheet shapes found in a history workbook:
       (1) FLAT  : one line item per row, headers in row 1
                   (e.g. "Line Item Description" + "Schedule B or HTS").
       (2) BLOCKS: the familiar Metrics layout — repeating per-WMTR blocks,
                   each with an "Inventory List" section.
     Both are mapped onto one canonical item model so results look uniform.
   - Reuses grid helpers from udq.js (gridCell, gridMaxRow/Col, buildHeaderMap,
     findSectionTitleRow, SECTION_STOP_TITLES) and util.js (norm, normWs,
     normKey, esc).
   ========================================================================= */

/* ---------------- Canonical field spec (header candidates) ----------------
   For each canonical compliance field, list the header names seen across the
   FLAT (TRLS I-style) and BLOCK (Metrics-style) layouts. First match wins, so
   put the more specific combined headers first. `primary: true` fields get
   their own results-table column; the rest render as chips under the item. */
const SEARCH_FIELD_SPEC = [
  { key: "hs",     label: "HS / Schedule B",     primary: true,
    headers: ["Schedule B/HTS Code", "Schedule B or HTS", "Schedule B", "HTS"] },
  { key: "eccn",   label: "ECCN / USML",         primary: true,
    headers: ["ECCN/USML", "ECCN", "USML"] },
  { key: "com",    label: "Country of Mfr",      primary: true,
    headers: ["Material/Equipment Manufacture Country of Origin", "Manufacturer Country"] },
  { key: "auth",   label: "Authorization",       primary: true,
    headers: ["BIS/DDTC Authorization or Exception",
              "Line Item Export Import License Authorization", "License Authorization"] },
  // Hazardous-cargo details, aggregated across both tab layouts. Only surfaced
  // where present. The Hazmat flag shows only when affirmative (NO is dropped).
  { key: "hazmat", label: "Hazmat", drop: ["no", "n", "false", "0"],
    headers: ["Hazmat", "Hazardous Material", "HazMat"] },
  { key: "hazclass", label: "Haz Class",
    headers: ["HAZMAT/Dangerous Goods Classification", "Hazmat Class", "Hazard Class"] },
  { key: "uncode", label: "UN Code",
    headers: ["UN Code", "UN Number", "UN #", "UN#"] },
  { key: "cite",   label: "License Citation",
    headers: ["Line Item Export Import License Citation", "License Citation"] },
  { key: "itarc",  label: "ITAR Class",          headers: ["ITAR Class"] },
  { key: "sme",    label: "Sig. Military Equip.",
    headers: ["Line Item Significant Military Equimpent",      // (sic — source typo)
              "Line Item Significant Military Equipment"] },
  { key: "mfr",    label: "Manufacturer",
    headers: ["Manufacturer", "Vendor or Manufacturer", "Vendor"] },
  { key: "model",  label: "Model / Catalog", primary: true,
    headers: ["Model/Catalog Number", "Model or Catalog number", "Part Number"] },
  { key: "serial", label: "Serial", primary: true,
    headers: ["Serial #", "Line Item Serial numbers"] },
];

const SEARCH_DESC_HEADERS  = ["Line Item Description", "Description"];
// Record identifier shown for each hit. Request# (flat) takes precedence over
// the numeric Request ID; WMTR Number is the block-layout identifier.
const SEARCH_ID_HEADERS    = ["Request#", "Request Number", "WMTR Number"];
const SEARCH_TITLE_HEADERS = ["Request Description", "Request Title"];

// Values that are present but carry no compliance meaning — don't surface them.
const SEARCH_EMPTY_VALUES = new Set(["", "-", "—", "n/a", "na", "none", "null"]);

/* ---------------- Header resolution (case-insensitive) ---------------- */

/** {normalized-lowercase header -> 1-based col} for a given header row. */
function searchHeaderMap(grid, headerRow) {
  const map = {};
  const maxCol = gridMaxCol(grid);
  for (let c = 1; c <= maxCol; c++) {
    const k = normKey(gridCell(grid, headerRow, c));
    if (k && !(k in map)) map[k] = c;
  }
  return map;
}

/** First candidate header present in `map` → its column (0 if none). */
function searchResolveCol(map, headers) {
  for (const h of headers) {
    const c = map[normKey(h)];
    if (c) return c;
  }
  return 0;
}

/** Resolve description / id / title / field columns from one header row. */
function searchResolveCols(grid, headerRow) {
  const map = searchHeaderMap(grid, headerRow);
  const cols = {
    desc:  searchResolveCol(map, SEARCH_DESC_HEADERS),
    id:    searchResolveCol(map, SEARCH_ID_HEADERS),
    title: searchResolveCol(map, SEARCH_TITLE_HEADERS),
    fields: [],
  };
  for (const f of SEARCH_FIELD_SPEC) {
    const c = searchResolveCol(map, f.headers);
    if (c) cols.fields.push({ key: f.key, label: f.label, primary: !!f.primary, col: c, drop: f.drop });
  }
  return cols;
}

/* ---------------- Sheet-shape classification ---------------- */

function searchIsFlatSheet(grid) {
  const m = searchHeaderMap(grid, 1);
  const hasDesc = !!searchResolveCol(m, ["Line Item Description"]);
  const hasCompliance =
    !!searchResolveCol(m, ["Schedule B or HTS", "Schedule B/HTS Code"]) ||
    !!searchResolveCol(m, ["ECCN", "ECCN/USML"]);
  return hasDesc && hasCompliance;
}

function searchIsBlockSheet(grid) {
  const lim = Math.min(gridMaxRow(grid), 500);
  for (let r = 1; r <= lim; r++) {
    const v = normWs(gridCell(grid, r, 1)).toUpperCase();
    if (v.startsWith("WMTR-")) {
      return findSectionTitleRow(grid, "Inventory List") > 0;
    }
  }
  return false;
}

/* ---------------- Item factory ---------------- */

function searchMakeItem(grid, r, cols, ridOverride, titleOverride, sheet) {
  const description = norm(gridCell(grid, r, cols.desc));
  if (!description) return null;

  const rid = (ridOverride != null && ridOverride !== "")
    ? ridOverride
    : (cols.id ? norm(gridCell(grid, r, cols.id)) : "");
  const title = (titleOverride != null)
    ? titleOverride
    : (cols.title ? norm(gridCell(grid, r, cols.title)) : "");

  const fields = [];
  for (const f of cols.fields) {
    const v = norm(gridCell(grid, r, f.col));
    if (!v || SEARCH_EMPTY_VALUES.has(v.toLowerCase())) continue;
    if (f.drop && f.drop.includes(v.toLowerCase())) continue; // e.g. Hazmat "NO"
    fields.push({ key: f.key, label: f.label, value: v, primary: f.primary });
  }

  // Per-scope lowercased text so search can be restricted to chosen columns.
  const scopes = {
    desc: description.toLowerCase(),
    rid: (rid || "").toLowerCase(),
    title: (title || "").toLowerCase(),
  };
  for (const f of fields) {
    scopes[f.key] = (scopes[f.key] ? scopes[f.key] + " " : "") + f.value.toLowerCase();
  }

  const blob = (description + " " + rid + " " + title + " " +
    fields.map((x) => x.value).join(" ")).toLowerCase();

  return { rid: rid || "", title, sheet, description, fields, blob, scopes };
}

/* ---------------- Searchable scopes (column selector) ---------------- */

// Order + labels for the "Search in" selector. Only scopes that actually carry
// data in the loaded workbook are offered (computed at index build).
const SEARCH_SCOPE_ORDER = [
  { key: "desc",   label: "Description" },
  { key: "rid",    label: "Record" },
  { key: "title",  label: "Request Title" },
  { key: "model",  label: "Model / Catalog" },
  { key: "serial", label: "Serial" },
  { key: "hs",     label: "HS / Schedule B" },
  { key: "eccn",   label: "ECCN / USML" },
  { key: "com",    label: "Country of Mfr" },
  { key: "auth",   label: "Authorization" },
  { key: "hazclass", label: "Haz Class" },
  { key: "uncode", label: "UN Code" },
  { key: "cite",   label: "License Citation" },
  { key: "itarc",  label: "ITAR Class" },
  { key: "sme",    label: "Sig. Military Equip." },
  { key: "mfr",    label: "Manufacturer" },
];

/* ---------------- Per-shape parsers ---------------- */

// Parent items in the Metrics layout are containers (pallets/boxes/crates) used
// for counts and parent-weight totals, not real inventory. The canonical marker
// is Serial "P". Some are entered without it, so we also drop: rows the source
// explicitly labels as parents; rows whose description is only a container label
// ("Pallet #1", "Box 2"); and container+contents rows ("Pallet, Multiple Cases",
// "Crate [CABINET...]") that carry NO compliance data. Real items that merely
// mention packaging ("Container, Bucket, Plastic, 5 Gallon" [HS/ECCN present],
// "BOX, BREAKOUT, 2X SURGE ARRESTORS") have compliance data and are kept.
function searchIsContainerOnly(d) {
  return /^(pallet|box|crate|carton|skid|container|tote|bin|drum)\s*#?\s*\d*$/i.test((d || "").trim());
}
function searchIsContainerPrefixed(d) {
  return /^(pallet|box|crate|carton|skid|container|tote|bin|drum)\s*[,\(\[]/i.test((d || "").trim());
}
function searchHasCompliance(it) {
  return (it.fields || []).some((f) => {
    const v = (f.value || "").trim().toLowerCase();
    if (!v || v === "n/a" || v === "na" || v === "none") return false;
    if ((f.key === "itar" || f.key === "sme") && v === "no") return false;
    return ["hs", "eccn", "com", "coo", "auth", "cite", "itarc", "itar", "sme"].includes(f.key);
  });
}
function searchIsParentItem(serialValue, it) {
  if (normWs(serialValue).toUpperCase() === "P") return true;
  const d = it.description || "";
  if (/\bparent item\b/i.test(d) || /\bnot on ci\b/i.test(d)) return true;
  if (searchIsContainerOnly(d)) return true;
  if (searchIsContainerPrefixed(d) && !searchHasCompliance(it)) return true;
  return false;
}

function searchParseFlatSheet(grid, sheet) {
  const cols = searchResolveCols(grid, 1);
  const items = [];
  const ids = new Set();
  const maxR = gridMaxRow(grid);
  for (let r = 2; r <= maxR; r++) {
    const it = searchMakeItem(grid, r, cols, null, null, sheet);
    if (it) { items.push(it); if (it.rid) ids.add(it.rid); }
  }
  return { kind: "flat", items, records: ids.size };
}

function searchParseBlockSheet(grid, sheet) {
  const shipMap = searchHeaderMap(grid, 1);
  const wmtrCol = searchResolveCol(shipMap, ["WMTR Number"]) || 1;
  const titleCol = searchResolveCol(shipMap, SEARCH_TITLE_HEADERS);
  const stops = (typeof SECTION_STOP_TITLES !== "undefined" ? SECTION_STOP_TITLES : [])
    .map((s) => normKey(s));
  const maxR = gridMaxRow(grid);
  const maxC = Math.min(gridMaxCol(grid), 30);

  const cellHasTitle = (r, want) => {
    for (let c = 1; c <= maxC; c++) if (normKey(gridCell(grid, r, c)) === want) return true;
    return false;
  };
  const cellHasStop = (r) => {
    for (let c = 1; c <= maxC; c++) if (stops.includes(normKey(gridCell(grid, r, c)))) return true;
    return false;
  };

  const items = [];
  let curWmtr = "", curTitle = "", cols = null, inInv = false, invHeaderRow = 0, serialCol = 0, records = 0;

  for (let r = 1; r <= maxR; r++) {
    const a = normWs(gridCell(grid, r, wmtrCol)).toUpperCase();
    if (a.startsWith("WMTR-")) {                              // new shipment block
      curWmtr = norm(gridCell(grid, r, wmtrCol));
      curTitle = titleCol ? norm(gridCell(grid, r, titleCol)) : "";
      inInv = false; cols = null; invHeaderRow = 0; serialCol = 0; records++;
      continue;
    }
    if (cellHasTitle(r, "inventory list")) {                 // header is r+1, items at r+2+
      invHeaderRow = r + 1;
      cols = searchResolveCols(grid, invHeaderRow);
      serialCol = (cols.fields.find((f) => f.key === "serial") || {}).col || 0;
      inInv = !!cols.desc;
      continue;
    }
    if (cellHasStop(r)) { inInv = false; cols = null; continue; }
    if (inInv && cols && curWmtr && r > invHeaderRow) {
      // Skip parent/container rows (pallets, boxes, crates) — not real items.
      const serialVal = serialCol ? gridCell(grid, r, serialCol) : "";
      const it = searchMakeItem(grid, r, cols, curWmtr, curTitle, sheet);
      if (it && !searchIsParentItem(serialVal, it)) items.push(it);
    }
  }
  return { kind: "blocks", items, records };
}

/* ---------------- Public: detection + index build ----------------
   `sheets` is the shape produced by app.js workbookAllSheets():
   { names: [...], grids: { name -> grid } }. */

function historyDetect(sheets) {
  if (!sheets || !sheets.names || !sheets.names.length) return false;
  let flat = false, compliant = 0;
  for (const name of sheets.names) {
    const g = sheets.grids[name];
    if (!g) continue;
    const isFlat = searchIsFlatSheet(g);
    const isBlk  = searchIsBlockSheet(g);
    if (isFlat) flat = true;
    if (isFlat || isBlk) compliant++;
  }
  // A flat compliance table is unique to a history dataset (no working UDQ has
  // one), so it triggers on its own. Otherwise require a multi-sheet workbook
  // so a normal single-sheet UDQ isn't hijacked into the search tool.
  return flat || (sheets.names.length >= 2 && compliant >= 1);
}

function historyBuildIndex(sheets) {
  const items = [];
  const sources = [];
  for (const name of sheets.names) {
    const g = sheets.grids[name];
    if (!g) continue;
    let got = null;
    if (searchIsFlatSheet(g)) got = searchParseFlatSheet(g, name);
    else if (searchIsBlockSheet(g)) got = searchParseBlockSheet(g, name);
    else continue;
    sources.push({ sheet: name, kind: got.kind, items: got.items.length, records: got.records });
    for (const it of got.items) items.push(it);
  }
  // Which scopes actually carry data → offered in the column selector.
  const present = new Set();
  for (const it of items) for (const k in it.scopes) if (it.scopes[k]) present.add(k);
  const scopes = SEARCH_SCOPE_ORDER.filter((s) => present.has(s.key));
  return { items, sources, total: items.length, scopes };
}

/* ---------------- Bundled (pre-built) index ----------------
   A sanitized index can be shipped with the app (js/data/history_index.js sets
   window.ATLAS_HISTORY_BUNDLE_JSON to a compact JSON string). It carries only
   the search fields — never the raw workbook's other columns. We parse + hydrate
   it lazily (first time Compliance Search is opened) so page load stays fast. */
let _bundledIndex; // undefined = not yet attempted; null = unavailable/failed

function bundledHistoryAvailable() {
  return typeof window !== "undefined" && !!window.ATLAS_HISTORY_BUNDLE_JSON;
}

/** Expand the compact bundle into the same shape historyBuildIndex() returns. */
function hydrateBundledIndex(raw) {
  if (!raw || !raw.items) return null;
  const specByKey = {};
  for (const f of SEARCH_FIELD_SPEC) specByKey[f.key] = f;
  const items = raw.items.map((o) => {
    const description = o.d || "";
    const rid = o.r || "";
    const title = o.t || "";
    const sheet = (raw.sheets && raw.sheets[o.s]) || "";
    const fields = (o.f || []).map(([k, v]) => {
      const sp = specByKey[k] || {};
      return { key: k, label: sp.label || k, value: v, primary: !!sp.primary };
    });
    const scopes = { desc: description.toLowerCase(), rid: rid.toLowerCase(), title: title.toLowerCase() };
    for (const f of fields) {
      scopes[f.key] = (scopes[f.key] ? scopes[f.key] + " " : "") + f.value.toLowerCase();
    }
    const blob = (description + " " + rid + " " + title + " " +
      fields.map((x) => x.value).join(" ")).toLowerCase();
    return { rid, title, sheet, description, fields, blob, scopes };
  });
  const present = new Set();
  for (const it of items) for (const k in it.scopes) if (it.scopes[k]) present.add(k);
  const scopes = SEARCH_SCOPE_ORDER.filter((s) => present.has(s.key));
  return { items, sources: raw.sources || [], total: items.length, scopes, bundled: true };
}

function bundledHistoryIndex() {
  if (_bundledIndex !== undefined) return _bundledIndex;
  try {
    const s = (typeof window !== "undefined") ? window.ATLAS_HISTORY_BUNDLE_JSON : null;
    _bundledIndex = s ? hydrateBundledIndex(JSON.parse(s)) : null;
  } catch (e) {
    console.error("Bundled history index failed to parse:", e);
    _bundledIndex = null;
  }
  return _bundledIndex;
}

/** The index in effect: an uploaded history file overrides the bundled default. */
function activeHistoryIndex() {
  return AppState.history || bundledHistoryIndex();
}

/* ---------------- Search ---------------- */

/** AND match: every whitespace-separated term must appear in the searchable
    text. `scopeKeys` (optional) restricts matching to those scopes; empty/omitted
    searches all fields (the precomputed blob). */
function searchHistoryItems(index, term, scopeKeys) {
  const q = normKey(term);
  if (!q) return { terms: [], items: [] };
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return { terms: [], items: [] };

  const useScopes = Array.isArray(scopeKeys) && scopeKeys.length > 0;
  const items = index.items.filter((it) => {
    if (!useScopes) return terms.every((t) => it.blob.includes(t));
    let text = "";
    for (const k of scopeKeys) { const v = it.scopes[k]; if (v) text += v + " "; }
    return terms.every((t) => text.includes(t));
  });
  return { terms, items };
}

/* ---------------- Rendering ---------------- */

const SEARCH_MAX_RENDER = 400;
let _searchTimer = null;
let _searchScopeSel = new Set();   // selected scope keys; empty = all fields

/* ---- Excel export -------------------------------------------------------
   Column order for the exported workbook (all captured fields, not just the
   on-screen columns). `get` pulls a non-field value; `key` pulls a compliance
   field by its canonical key. */
const SEARCH_EXPORT_COLS = [
  { h: "Record",               get: (it) => it.rid },
  { h: "Item Description",     get: (it) => it.description },
  { h: "Model / Catalog",      key: "model" },
  { h: "Serial",               key: "serial" },
  { h: "HS / Schedule B",      key: "hs" },
  { h: "ECCN / USML",          key: "eccn" },
  { h: "Country of Mfr",       key: "com" },
  { h: "Authorization",        key: "auth" },
  { h: "Hazmat",               key: "hazmat" },
  { h: "Haz Class",            key: "hazclass" },
  { h: "UN Code",              key: "uncode" },
  { h: "License Citation",     key: "cite" },
  { h: "ITAR Class",           key: "itarc" },
  { h: "Sig. Military Equip.", key: "sme" },
  { h: "Manufacturer",         key: "mfr" },
  { h: "Source Sheet",         get: (it) => it.sheet },
  { h: "Request Title",        get: (it) => it.title },
];

function searchFieldValue(it, key) {
  const f = it.fields.find((x) => x.key === key);
  return f ? f.value : "";
}

function searchColLetter(n) { // 1 -> A, 27 -> AA
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function searchXlsxEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a minimal single-sheet .xlsx (inline strings, no template, no
    XLSX.write) from a header array + array-of-row-arrays. Returns a Blob. */
async function searchBuildXlsx(headers, rows) {
  const cellXml = (colIdx, rowIdx, val) =>
    `<c r="${searchColLetter(colIdx)}${rowIdx}" t="inlineStr">` +
    `<is><t xml:space="preserve">${searchXlsxEsc(val)}</t></is></c>`;

  const rowXml = (rowIdx, cells) =>
    `<row r="${rowIdx}">${cells.map((v, i) => cellXml(i + 1, rowIdx, v)).join("")}</row>`;

  const allRows = [rowXml(1, headers)]
    .concat(rows.map((r, i) => rowXml(i + 2, r)))
    .join("");

  const lastCol = searchColLetter(Math.max(1, headers.length));
  const dim = `A1:${lastCol}${rows.length + 1}`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dim}"/><sheetData>${allRows}</sheetData></worksheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Compliance Search" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", workbookRels);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}

async function searchExportXlsx(term) {
  const { items } = searchHistoryItems(activeHistoryIndex(), term, Array.from(_searchScopeSel));
  if (!items.length) return;
  const headers = SEARCH_EXPORT_COLS.map((c) => c.h);
  const rows = items.map((it) =>
    SEARCH_EXPORT_COLS.map((c) => (c.get ? c.get(it) : searchFieldValue(it, c.key))));
  const blob = await searchBuildXlsx(headers, rows);

  const slug = normKey(term).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const stamp = (typeof fileStamp === "function") ? fileStamp() : Date.now();
  const fname = `Compliance_Search_${slug || "results"}_${stamp}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function searchHighlight(text, terms) {
  let html = esc(text == null ? "" : String(text));
  if (!terms || !terms.length) return html;
  // Escape regex specials in each term, longest first so overlaps prefer longer.
  const safe = terms.slice().sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!safe.length) return html;
  const re = new RegExp("(" + safe.join("|") + ")", "gi");
  return html.replace(re, "<mark>$1</mark>");
}

function renderSearchWorkspace(container) {
  const idx = activeHistoryIndex();
  if (!idx) {
    container.appendChild(el(`<div class="panel"><div class="body">
      Load a history / dataset workbook to use compliance search.</div></div>`));
    return;
  }

  _searchScopeSel = new Set();   // fresh panel → search all fields by default

  const srcLine = idx.sources.map((s) =>
    `${esc(s.sheet)} — ${s.items.toLocaleString()} item${s.items === 1 ? "" : "s"}` +
    `${s.records ? ` · ${s.records.toLocaleString()} record${s.records === 1 ? "" : "s"}` : ""}`
  ).join(" • ");

  const scopeChips = (idx.scopes || []).map((s) =>
    `<button class="cs-scope" type="button" data-scope="${esc(s.key)}">${esc(s.label)}</button>`
  ).join("");

  const panel = el(`
    <div class="panel">
      <style>
        /* Match the other tools: frame the inputs as an accent-edged "card"
           with an uppercase label bar (overriding formgrid's default text). */
        .workspace .cs-form.formgrid::before{ content: "Search \\00B7 enter a term and choose fields"; }
        .cs-form .cs-scopes{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .cs-scope{ font-family:var(--body); font-size:12px; color:var(--ink); background:#fff;
                  border:1px solid #B9C4CE; border-radius:14px; padding:4px 11px; cursor:pointer; }
        .cs-scope:hover{ border-color:var(--ink); }
        .cs-scope.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
        body.theme-dark .cs-scope{ background:#0F1822; border-color:#36465A; }
        body.theme-dark .cs-scope.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
        .cs-meta{ font-family:var(--mono); font-size:11.5px; color:var(--steel); margin-top:14px; }
        .cs-count{ font-family:var(--disp); font-weight:600; letter-spacing:.5px; margin-top:6px; }
        .cs-empty{ color:var(--steel); font-style:italic; padding:18px 2px; }
        #csResults{ margin-top:10px; }
        table.cs-data td .cs-desc{ font-size:13px; line-height:1.4; }
        table.cs-data td .cs-title{ color:var(--steel); font-size:11.5px; margin-top:2px; }
        table.cs-data td .cs-chips{ margin-top:5px; display:flex; flex-wrap:wrap; gap:5px; }
        .cs-chip{ font-family:var(--mono); font-size:10.5px; color:var(--ink-2);
                  background:#F2F5F8; border:1px solid var(--line); border-radius:10px; padding:1px 7px; }
        body.theme-dark .cs-chip{ background:#0F1822; }
        .cs-chip b{ color:var(--steel); font-weight:600; }
        table.cs-data td.cs-rec{ font-family:var(--mono); font-size:11.5px; white-space:nowrap; }
        table.cs-data td.cs-fld{ font-family:var(--mono); font-size:11.5px; }
        table.cs-data mark{ background:#FFE08A; color:inherit; border-radius:2px; padding:0 1px; }
        body.theme-dark table.cs-data mark{ background:#7A5C12; color:#FFF; }
        table.cs-data .cs-na{ color:#A9B4BF; }
      </style>
      <header>
        <h2>Compliance Search</h2>
        <span class="count">${idx.total.toLocaleString()} items</span>
      </header>
      <div class="body">
        <div class="formgrid cs-form">
          <div class="field span3">
            <label for="csTerm">Search term</label>
            <input type="text" id="csTerm" autocomplete="off" spellcheck="false"
                   placeholder="Partial description, HS code, ECCN, country, authorization…">
            <div class="hint">Searches the selected fields (all by default). Multiple words must all match.</div>
          </div>
          <div class="field span3">
            <label>Search in</label>
            <div class="cs-scopes" id="csScopes">
              <button class="cs-scope" type="button" data-all="1">All fields</button>
              ${scopeChips}
            </div>
          </div>
        </div>
        <div class="btnrow">
          <button class="btn primary" id="csExport" type="button" disabled>Export to Excel</button>
          <button class="btn ghost" id="csClear" type="button">Clear</button>
        </div>
        <div class="cs-meta">Sources: ${srcLine}</div>
        <div class="cs-count" id="csCount">Type at least 2 characters to search.</div>
        <div id="csResults"></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const input = panel.querySelector("#csTerm");
  const run = () => searchRenderResults(input.value);

  const scopesRow = panel.querySelector("#csScopes");
  const paintScopes = () => {
    scopesRow.querySelectorAll(".cs-scope").forEach((b) => {
      const on = b.dataset.all === "1"
        ? _searchScopeSel.size === 0
        : _searchScopeSel.has(b.dataset.scope);
      b.classList.toggle("active", on);
    });
  };
  scopesRow.querySelectorAll(".cs-scope").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.all === "1") {
        _searchScopeSel.clear();
      } else {
        const k = b.dataset.scope;
        if (_searchScopeSel.has(k)) _searchScopeSel.delete(k); else _searchScopeSel.add(k);
      }
      paintScopes();
      run();
    });
  });
  paintScopes();

  input.addEventListener("input", () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(run, 120);
  });
  panel.querySelector("#csClear").addEventListener("click", () => {
    input.value = ""; run(); input.focus();
  });
  const exportBtn = panel.querySelector("#csExport");
  exportBtn.addEventListener("click", () => {
    if (exportBtn.disabled) return;
    const label = exportBtn.textContent;
    exportBtn.disabled = true; exportBtn.textContent = "Exporting…";
    Promise.resolve(searchExportXlsx(input.value))
      .catch((e) => { console.error(e); alert("Couldn't build the Excel file: " + e.message); })
      .finally(() => { exportBtn.textContent = label; searchRenderResults(input.value); });
  });
  setTimeout(() => input.focus(), 0);
}

function searchRenderResults(term) {
  const countEl = document.getElementById("csCount");
  const out = document.getElementById("csResults");
  const exportBtn = document.getElementById("csExport");
  if (!countEl || !out) return;
  const setExport = (n) => { if (exportBtn) exportBtn.disabled = !n; };

  const q = (term || "").trim();
  if (q.length < 2) {
    countEl.textContent = "Type at least 2 characters to search.";
    out.innerHTML = "";
    setExport(0);
    return;
  }

  const { terms, items } = searchHistoryItems(activeHistoryIndex(), q, Array.from(_searchScopeSel));
  if (!items.length) {
    countEl.textContent = `No matches for “${q}”.`;
    out.innerHTML = `<div class="cs-empty">Nothing found. Try a shorter or different term${_searchScopeSel.size ? ", or widen the fields you're searching in" : ""}.</div>`;
    setExport(0);
    return;
  }
  setExport(items.length);

  const shown = items.slice(0, SEARCH_MAX_RENDER);
  countEl.textContent = items.length > shown.length
    ? `${items.length.toLocaleString()} matches — showing first ${shown.length} (export includes all ${items.length.toLocaleString()}).`
    : `${items.length.toLocaleString()} match${items.length === 1 ? "" : "es"}.`;

  // Highlight only within the fields actually being searched (all when none chosen).
  const inScope = (key) => _searchScopeSel.size === 0 || _searchScopeSel.has(key);
  const hl = (text, key) => inScope(key) ? searchHighlight(text, terms) : esc(text == null ? "" : String(text));
  const cell = (it, key) => {
    const f = it.fields.find((x) => x.key === key);
    return f ? hl(f.value, key) : '<span class="cs-na">—</span>';
  };

  const rows = shown.map((it) => {
    const extras = it.fields.filter((f) => !f.primary);
    const chips = extras.length
      ? `<div class="cs-chips">${extras.map((f) =>
          `<span class="cs-chip"><b>${esc(f.label)}:</b> ${hl(f.value, f.key)}</span>`).join("")}</div>`
      : "";
    const title = it.title ? `<div class="cs-title">${hl(it.title, "title")}</div>` : "";
    return `
      <tr>
        <td class="cs-rec">${it.rid ? hl(it.rid, "rid") : '<span class="cs-na">—</span>'}</td>
        <td>
          <div class="cs-desc">${hl(it.description, "desc")}</div>
          ${title}${chips}
        </td>
        <td class="cs-fld">${cell(it, "model")}</td>
        <td class="cs-fld">${cell(it, "serial")}</td>
        <td class="cs-fld">${cell(it, "hs")}</td>
        <td class="cs-fld">${cell(it, "eccn")}</td>
        <td class="cs-fld">${cell(it, "com")}</td>
        <td class="cs-fld">${cell(it, "auth")}</td>
      </tr>`;
  }).join("");

  out.innerHTML = `
    <div class="scrollwrap">
      <table class="data cs-data">
        <thead><tr>
          <th>Record</th><th>Item description</th>
          <th>Model / Catalog</th><th>Serial</th>
          <th>HS / Schedule B</th><th>ECCN / USML</th>
          <th>Country of Mfr</th><th>Authorization</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ---------------- Node test hook (no effect in the browser) ---------------- */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    historyDetect, historyBuildIndex, searchHistoryItems,
    searchIsFlatSheet, searchIsBlockSheet,
  };
}
