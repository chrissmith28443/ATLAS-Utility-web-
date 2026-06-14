/* =========================================================================
   ATLAS Utility Web — pmr.js
   Program Management Review (PMR) report.

   Faithful port of:
     - services/pmr_service.py    (parse_pmr_udq, run_pmr, _normalize_mode,
                                    _to_date, _wmtr_sort_key, export_section_to_excel,
                                    export_pmr_with_template)
     - ui/pmr_dialog.py           (reporting-window controls: fiscal-year quarters,
                                    Current/Previous Qtr, Current/Previous FY,
                                    FY First/Second Half, custom start/end)

   Behavioral parity notes (intentional, flagged):
     * The desktop preserved the template's four charts by driving native Excel
       via win32com. The browser has no Excel, so the full-report export rewrites
       the .xlsx zip at the XML level (data cells, table refs, and chart caches)
       the same way the IPC/PL/SLI/CoreIMS tools rewrite their templates — the
       charts survive untouched and simply re-point at the new ranges.
     * Per-section export mirrors export_section_to_excel (one sheet, header +
       rows). The free SheetJS build can't write the bold-header / auto-width
       styling, so those are omitted; data and layout are identical.
     * Output names match the desktop exactly:
         full report   -> PMR_<YYYY-MM-DD_HHMMSS>.xlsx
         single section-> PMR - <Section Title>_<YYYY-MM-DD_HHMMSS>.xlsx
   ========================================================================= */

const PMR_REQUIRED_HEADERS = [
  "WMTR Number",
  "Country of Destination",
  "CTR Program",
  "Total Cost in USD",
  "Value of Cargo (USD)",
  "Identify Shipment As",
  "Delivery Date",
  "NLT Completion Date",
];

const PMR_DISPLAY_MODES = ["Air Freight", "Ocean Freight", "Ground Freight", "Hand Carry"];

const PMR_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* ---------------- date / value parsing (ports of _to_date, _to_float) ---- */

/** Parse a UDQ date cell to {y,m,d} or null. Mirrors pmr_service._to_date. */
function pmrToDate(v) {
  const s = norm(v);
  if (!s) return null;

  // ISO YYYY-MM-DD (optionally with trailing time)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

  // M/D/YYYY  (optionally with time, e.g. "1/26/2026 12:00:00 AM")
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { y: +m[3], mo: +m[1], d: +m[2] };

  // D-Mon-YYYY or D-Mon-YY  (e.g. "04-Dec-2025", "4-Dec-25")
  m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (m) {
    const mo = PMR_MONTHS[m[2].toLowerCase()];
    if (mo) {
      let y = +m[3];
      if (y < 100) y += y >= 70 ? 1900 : 2000;
      return { y, mo, d: +m[1] };
    }
  }
  return null;
}

/** {y,mo,d} -> "YYYY-MM-DD". */
function pmrIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.y}-${p(d.mo)}-${p(d.d)}`;
}

/** Day count between two {y,mo,d} (b - a), using UTC to avoid DST drift. */
function pmrDayDiff(a, b) {
  const ua = Date.UTC(a.y, a.mo - 1, a.d);
  const ub = Date.UTC(b.y, b.mo - 1, b.d);
  return Math.round((ub - ua) / 86400000);
}

/** ISO-string comparison works for start<=x<=end since all are zero-padded. */
function pmrInWindow(dIso, startIso, endIso) {
  return startIso <= dIso && dIso <= endIso;
}

/** Port of _normalize_mode. */
function pmrNormalizeMode(v) {
  const s = norm(v).toLowerCase();
  if (!s) return "";
  if (s.includes("fedex")) return "Ground Freight";
  if (s.includes("ground")) return "Ground Freight";
  if (s.includes("air")) return "Air Freight";
  if (s.includes("ocean") || s.includes("sea")) return "Ocean Freight";
  if (s.includes("hand") && s.includes("carry")) return "Hand Carry";
  return "";
}

/** Numeric sort key from the WMTR's "-<digits>-SRF" segment (port of _wmtr_sort_key). */
function pmrWmtrSortKey(wmtr) {
  const m = norm(wmtr).toUpperCase().match(/-(\d+)-SRF$/);
  if (!m) return 1e12;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 1e12;
}

function pmrLooksWmtr(v) {
  const s = norm(v).toUpperCase();
  return !!s && s.startsWith("WMTR") && s.endsWith("-SRF");
}

/** Round to 2 dp (sums of 6-dp dollar inputs never land on a half-cent). */
function pmrRound2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/* ---------------- parse + compute (ports of parse_pmr_udq + run_pmr) ------ */

/** Returns {blocks, missing}. Each block is a {header: rawValue} map. */
function pmrParseUdq(grid) {
  const shipMap = buildHeaderMap(grid, 1); // normalized header -> 1-based col
  const headerCols = {};
  for (const h of PMR_REQUIRED_HEADERS) {
    if (shipMap[normWs(h)]) headerCols[h] = shipMap[normWs(h)];
  }
  const missing = PMR_REQUIRED_HEADERS.filter((h) => !(h in headerCols));
  if (missing.length) return { blocks: [], missing };

  const blocks = [];
  for (let r = 2; r <= gridMaxRow(grid); r++) {
    const a = gridCell(grid, r, 1);
    if (!pmrLooksWmtr(a)) continue;
    const fields = {};
    for (const h of Object.keys(headerCols)) fields[h] = gridCell(grid, r, headerCols[h]);
    blocks.push(fields);
  }
  return { blocks, missing: [] };
}

/**
 * Port of run_pmr. `startIso`/`endIso` are "YYYY-MM-DD". Returns the same
 * result shape the desktop dialog consumes.
 */
function pmrRun(grid, startIso, endIso) {
  const { blocks, missing } = pmrParseUdq(grid);
  if (missing.length) {
    throw new Error("UDQ missing required header(s): " + missing.join(", "));
  }
  const useWindow = !!(startIso && endIso); // All Time passes null/null -> no date filter

  const locationCounts = {}, locationWmtrs = {};
  const modeCounts = {}, modeWmtrs = {};
  for (const mode of PMR_DISPLAY_MODES) { modeCounts[mode] = 0; modeWmtrs[mode] = []; }

  const costByProgram = {}, valueByProgram = {};
  const costCountByProgram = {}, valueCountByProgram = {};
  const programWmtrs = {};

  const lateRows = [];
  let totalDelivered = 0, onTimeCount = 0;

  for (const b of blocks) {
    const wmtr = norm(b["WMTR Number"]);
    const delivery = pmrToDate(b["Delivery Date"]);
    if (!delivery) continue;
    const deliveryIso = pmrIso(delivery);
    if (useWindow && !pmrInWindow(deliveryIso, startIso, endIso)) continue;

    totalDelivered += 1;

    const dest = norm(b["Country of Destination"]);
    if (dest) {
      locationCounts[dest] = (locationCounts[dest] || 0) + 1;
      (locationWmtrs[dest] = locationWmtrs[dest] || []).push(wmtr);
    }

    const mode = pmrNormalizeMode(b["Identify Shipment As"]);
    if (mode) {
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
      (modeWmtrs[mode] = modeWmtrs[mode] || []).push(wmtr);
    }

    const program = norm(b["CTR Program"]);
    if (program) {
      costByProgram[program] = (costByProgram[program] || 0) + toFloat(b["Total Cost in USD"]);
      valueByProgram[program] = (valueByProgram[program] || 0) + toFloat(b["Value of Cargo (USD)"]);
      costCountByProgram[program] = (costCountByProgram[program] || 0) + 1;
      valueCountByProgram[program] = (valueCountByProgram[program] || 0) + 1;
      (programWmtrs[program] = programWmtrs[program] || []).push(wmtr);
    }

    const nlt = pmrToDate(b["NLT Completion Date"]);
    if (nlt && deliveryIso <= pmrIso(nlt)) onTimeCount += 1;
    if (nlt && deliveryIso > pmrIso(nlt)) {
      lateRows.push([wmtr, pmrIso(nlt), deliveryIso, pmrDayDiff(nlt, delivery)]);
    }
  }

  const byKeyCI = (a, b) => a[0].toLowerCase() < b[0].toLowerCase() ? -1
    : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0;

  const locationRows = Object.entries(locationCounts)
    .filter(([k]) => k).map(([k, v]) => [k, v]).sort(byKeyCI);

  const modeRows = PMR_DISPLAY_MODES.map((mode) => [mode, modeCounts[mode] || 0]);

  const costRows = Object.entries(costByProgram)
    .filter(([p]) => p)
    .map(([p, c]) => [p, costCountByProgram[p] || 0, pmrRound2(c)])
    .sort(byKeyCI);

  const valueRows = Object.entries(valueByProgram)
    .map(([p, c]) => [p, valueCountByProgram[p] || 0, pmrRound2(c)])
    .sort(byKeyCI);

  const programCountRows = Object.entries(programWmtrs)
    .filter(([p]) => p)
    .map(([p, w]) => [p, w.length])
    .sort(byKeyCI);

  const programDetailRows = [];
  for (const [p, w] of Object.entries(programWmtrs).sort(byKeyCI)) {
    for (const wmtr of [...w].sort()) programDetailRows.push([p, wmtr]);
  }

  lateRows.sort((a, b) => pmrWmtrSortKey(a[0]) - pmrWmtrSortKey(b[0]));

  const onTimePct = totalDelivered ? pmrRound2((onTimeCount / totalDelivered) * 100) : 0.0;

  return {
    window_start: startIso,
    window_end: endIso,
    location_rows: locationRows,
    mode_rows: modeRows,
    cost_rows: costRows,
    value_rows: valueRows,
    late_rows: lateRows,
    total_delivered: totalDelivered,
    late_count: lateRows.length,
    on_time_count: onTimeCount,
    on_time_pct: onTimePct,
    location_total: locationRows.reduce((s, r) => s + r[1], 0),
    mode_total: modeRows.reduce((s, r) => s + r[1], 0),
    cost_total: pmrRound2(costRows.reduce((s, r) => s + r[2], 0)),
    value_total: pmrRound2(valueRows.reduce((s, r) => s + r[2], 0)),
    location_wmtrs: locationWmtrs,
    mode_wmtrs: modeWmtrs,
    program_wmtrs: programWmtrs,
    program_count_rows: programCountRows,
    program_detail_rows: programDetailRows,
    program_count_total: programCountRows.reduce((s, r) => s + r[1], 0),
  };
}

/* ---------------- fiscal-year window helpers (port of pmr_dialog) -------- */

const PMR_QTRS = ["1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr"];

function pmrToday() {
  const d = new Date();
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() };
}
function pmrCurrentFiscalYear() {
  const t = pmrToday();
  return t.mo >= 10 ? t.y + 1 : t.y;
}
function pmrCurrentQuarterLabel() {
  const m = pmrToday().mo;
  if (m >= 10) return "1st Qtr";          // Oct–Dec
  if (m <= 3) return "2nd Qtr";           // Jan–Mar
  if (m <= 6) return "3rd Qtr";           // Apr–Jun
  return "4th Qtr";                       // Jul–Sep
}
/** Returns [startIso, endIso] for a fiscal quarter. */
function pmrQuarterDates(fy, qLabel) {
  if (qLabel === "1st Qtr") return [pmrIso({ y: fy - 1, mo: 10, d: 1 }), pmrIso({ y: fy - 1, mo: 12, d: 31 })];
  if (qLabel === "2nd Qtr") return [pmrIso({ y: fy, mo: 1, d: 1 }), pmrIso({ y: fy, mo: 3, d: 31 })];
  if (qLabel === "3rd Qtr") return [pmrIso({ y: fy, mo: 4, d: 1 }), pmrIso({ y: fy, mo: 6, d: 30 })];
  return [pmrIso({ y: fy, mo: 7, d: 1 }), pmrIso({ y: fy, mo: 9, d: 30 })];
}
function pmrTodayIso() { return pmrIso(pmrToday()); }

function pmrCurrentQtrDates() {
  const fy = pmrCurrentFiscalYear();
  const [start] = pmrQuarterDates(fy, pmrCurrentQuarterLabel());
  return { start, end: pmrTodayIso(), fy, qtr: pmrCurrentQuarterLabel() };
}
function pmrPreviousQtrInfo() {
  const fy = pmrCurrentFiscalYear();
  const cur = pmrCurrentQuarterLabel();
  const prevMap = {
    "1st Qtr": ["4th Qtr", fy - 1],
    "2nd Qtr": ["1st Qtr", fy],
    "3rd Qtr": ["2nd Qtr", fy],
    "4th Qtr": ["3rd Qtr", fy],
  };
  const [pq, pfy] = prevMap[cur];
  const [start, end] = pmrQuarterDates(pfy, pq);
  return { start, end, fy: pfy, qtr: pq };
}
function pmrCurrentFyDates() {
  const fy = pmrCurrentFiscalYear();
  return { start: pmrIso({ y: fy - 1, mo: 10, d: 1 }), end: pmrTodayIso(), fy, qtr: pmrCurrentQuarterLabel() };
}
function pmrPreviousFyDates() {
  const fy = pmrCurrentFiscalYear() - 1;
  return { start: pmrIso({ y: fy - 1, mo: 10, d: 1 }), end: pmrIso({ y: fy, mo: 9, d: 30 }), fy, qtr: "4th Qtr" };
}
function pmrFirstHalfDates() {
  const fy = pmrCurrentFiscalYear();
  return { start: pmrIso({ y: fy - 1, mo: 10, d: 1 }), end: pmrIso({ y: fy, mo: 3, d: 31 }), fy, qtr: "2nd Qtr" };
}
function pmrSecondHalfDates() {
  const fy = pmrCurrentFiscalYear();
  return { start: pmrIso({ y: fy, mo: 4, d: 1 }), end: pmrIso({ y: fy, mo: 9, d: 30 }), fy, qtr: "4th Qtr" };
}
function pmrBuildYearList() {
  const fy = pmrCurrentFiscalYear();
  const out = [];
  for (let y = fy + 1; y >= fy - 6; y--) out.push(y);
  return out;
}

/* ---------------- section metadata (titles, columns, rows) --------------- */

function pmrSections(result) {
  return [
    { key: "location", title: "Completed SRFs by Location",
      columns: ["Country of Destination", "SRF Count"], rows: result.location_rows },
    { key: "mode", title: "SRF by Shipping Mode",
      columns: ["Shipping Mode", "SRF Count"], rows: result.mode_rows },
    { key: "cost", title: "SRF Cost of Service by Program",
      columns: ["CTR Program", "Request Count", "Total Cost in USD"], rows: result.cost_rows },
    { key: "value", title: "SRF Value of Cargo by Program",
      columns: ["CTR Program", "Request Count", "Value of Cargo (USD)"], rows: result.value_rows },
    { key: "nlt", title: "NLT vs Actual Delivery Date",
      columns: ["WMTR Number", "NLT Completion Date", "Delivery Date", "Days Late"], rows: result.late_rows },
    { key: "program_count", title: "Total WMTRs by Program",
      columns: ["CTR Program", "WMTR Number"], rows: result.program_detail_rows.length
        ? result.program_detail_rows : result.program_count_rows },
  ];
}

/* ---------------- XLSX writers ------------------------------------------- */

function _pmrXmlEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build the <c> cells for one data row. `cols` describes A/B/C/D types. */
function _pmrRowCells(r, values, types) {
  const letters = ["A", "B", "C", "D"];
  let xml = "";
  values.forEach((v, i) => {
    const ref = letters[i] + r;
    if (types[i] === "num") {
      const styled = types.styleCol === i ? ` s="3"` : "";
      xml += `<c r="${ref}"${styled}><v>${v}</v></c>`;
    } else {
      const t = _pmrXmlEsc(String(v)).replace(/\r?\n/g, "&#10;");
      xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`;
    }
  });
  return `<row r="${r}" spans="1:${values.length}">${xml}</row>`;
}

/** Replace rows 2+ in a sheet, preserving the verbatim header row 1, and fix <dimension>. */
function _pmrWriteSheet(sheetXml, rows, types, lastColLetter) {
  const headerM = sheetXml.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
  const header = headerM ? headerM[0] : "";
  let body = "";
  rows.forEach((vals, i) => { body += _pmrRowCells(i + 2, vals, types); });
  sheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${header}${body}</sheetData>`);
  const lastRow = 1 + rows.length;
  sheetXml = sheetXml.replace(/<dimension ref="A1:[A-Z]+\d+"\/>/,
    `<dimension ref="A1:${lastColLetter}${lastRow}"/>`);
  return sheetXml;
}

/** Update a table's ref + autoFilter ref to A1:<lastCol><1+n> (header-only if n==0). */
function _pmrWriteTable(tableXml, lastColLetter, n) {
  const end = `${lastColLetter}${1 + n}`;
  tableXml = tableXml.replace(/(<table[^>]*\sref=")[^"]+(")/, `$1A1:${end}$2`);
  tableXml = tableXml.replace(/(<autoFilter\s+ref=")[^"]+(")/, `$1A1:${end}$2`);
  return tableXml;
}

/**
 * Re-point a chart at the new data and refresh its cached points.
 * `colData` maps a column letter ("A","B","C") to {kind, values}.
 *   kind: "str" for categories, "num" for values.
 * Each <c:strRef>/<c:numRef> in the chart is rebuilt from its <c:f> column.
 */
function _pmrWriteChart(chartXml, sheetName, colData) {
  const n = Math.max(1, (colData.A ? colData.A.values.length : 1));
  const endRow = 1 + n;

  const rebuildRef = (block, tag) => {
    const fM = block.match(/<c:f>'?[^!]+'?!\$([A-Z])\$\d+:\$[A-Z]\$\d+<\/c:f>/);
    if (!fM) return block;
    const col = fM[1];
    const data = colData[col];
    if (!data) return block;
    const fRange = `'${sheetName}'!$${col}$2:$${col}$${endRow}`;
    if (tag === "str") {
      let pts = "";
      data.values.forEach((v, i) => { pts += `<c:pt idx="${i}"><c:v>${_pmrXmlEsc(String(v))}</c:v></c:pt>`; });
      return `<c:strRef><c:f>${fRange}</c:f><c:strCache><c:ptCount val="${data.values.length || 1}"/>${pts}</c:strCache></c:strRef>`;
    }
    // num: preserve the original formatCode
    const fmtM = block.match(/<c:formatCode>([\s\S]*?)<\/c:formatCode>/);
    const fmt = fmtM ? `<c:formatCode>${fmtM[1]}</c:formatCode>` : "<c:formatCode>General</c:formatCode>";
    let pts = "";
    data.values.forEach((v, i) => { pts += `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`; });
    return `<c:numRef><c:f>${fRange}</c:f><c:numCache>${fmt}<c:ptCount val="${data.values.length || 1}"/>${pts}</c:numCache></c:numRef>`;
  };

  chartXml = chartXml.replace(/<c:strRef>[\s\S]*?<\/c:strRef>/g, (b) => rebuildRef(b, "str"));
  chartXml = chartXml.replace(/<c:numRef>[\s\S]*?<\/c:numRef>/g, (b) => rebuildRef(b, "num"));
  return chartXml;
}

/** Build the full PMR workbook (.xlsx, base64) from the embedded template, charts intact. */
async function pmrWriteWorkbook(result) {
  const bin = atob(PMR_TEMPLATE_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);

  const loc = result.location_rows;     // [country, count]
  const mode = result.mode_rows;        // [mode, count]
  const cost = result.cost_rows;        // [program, count, cost]
  const value = result.value_rows;      // [program, count, value]
  const late = result.late_rows;        // [wmtr, nltIso, deliveryIso, daysLate]

  // ---- Sheet 1: Completed SRFs by Location (A str, B num) ----
  {
    let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const types = ["str", "num"];
    xml = _pmrWriteSheet(xml, loc, types, "B");
    zip.file("xl/worksheets/sheet1.xml", xml);

    let t = await zip.file("xl/tables/table1.xml").async("string");
    zip.file("xl/tables/table1.xml", _pmrWriteTable(t, "B", loc.length));

    let c = await zip.file("xl/charts/chart1.xml").async("string");
    zip.file("xl/charts/chart1.xml", _pmrWriteChart(c, "Completed SRFs by Location", {
      A: { values: loc.map((r) => r[0]) },
      B: { values: loc.map((r) => r[1]) },
    }));
  }

  // ---- Sheet 2: SRF by Shipping Mode (A str, B num) ----
  {
    let xml = await zip.file("xl/worksheets/sheet2.xml").async("string");
    xml = _pmrWriteSheet(xml, mode, ["str", "num"], "B");
    zip.file("xl/worksheets/sheet2.xml", xml);

    let t = await zip.file("xl/tables/table2.xml").async("string");
    zip.file("xl/tables/table2.xml", _pmrWriteTable(t, "B", mode.length));

    let c = await zip.file("xl/charts/chart2.xml").async("string");
    zip.file("xl/charts/chart2.xml", _pmrWriteChart(c, "SRF by Shipping Mode", {
      A: { values: mode.map((r) => r[0]) },
      B: { values: mode.map((r) => r[1]) },
    }));
  }

  // ---- Sheet 3: SRF Cost of Service by Program (A str, B num, C num currency) ----
  {
    const types = ["str", "num", "num"]; types.styleCol = 2; // col C -> Currency style s="3"
    let xml = await zip.file("xl/worksheets/sheet3.xml").async("string");
    xml = _pmrWriteSheet(xml, cost, types, "C");
    zip.file("xl/worksheets/sheet3.xml", xml);

    let t = await zip.file("xl/tables/table3.xml").async("string");
    zip.file("xl/tables/table3.xml", _pmrWriteTable(t, "C", cost.length));

    let c = await zip.file("xl/charts/chart3.xml").async("string");
    zip.file("xl/charts/chart3.xml", _pmrWriteChart(c, "SRF Cost of Service by Program", {
      A: { values: cost.map((r) => r[0]) },
      B: { values: cost.map((r) => r[1]) },
      C: { values: cost.map((r) => r[2]) },
    }));
  }

  // ---- Sheet 4: SRF Value of Cargo by Program (A str, B num, C num currency) ----
  {
    const types = ["str", "num", "num"]; types.styleCol = 2;
    let xml = await zip.file("xl/worksheets/sheet4.xml").async("string");
    xml = _pmrWriteSheet(xml, value, types, "C");
    zip.file("xl/worksheets/sheet4.xml", xml);

    let t = await zip.file("xl/tables/table4.xml").async("string");
    zip.file("xl/tables/table4.xml", _pmrWriteTable(t, "C", value.length));

    let c = await zip.file("xl/charts/chart4.xml").async("string");
    zip.file("xl/charts/chart4.xml", _pmrWriteChart(c, "SRF Value of Cargo by Program", {
      A: { values: value.map((r) => r[0]) },
      B: { values: value.map((r) => r[1]) },
      C: { values: value.map((r) => r[2]) },
    }));
  }

  // ---- Sheet 5: NLT vs Actual Delivery Date (A,B,C str, D num) — no chart/table ----
  {
    let xml = await zip.file("xl/worksheets/sheet5.xml").async("string");
    xml = _pmrWriteSheet(xml, late, ["str", "str", "str", "num"], "D");
    zip.file("xl/worksheets/sheet5.xml", xml);
  }

  return await zip.generateAsync({ type: "base64" });
}

/** Per-section workbook (plain, single sheet) — mirrors export_section_to_excel. */
function pmrWriteSectionWorkbook(title, columns, rows) {
  const aoa = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths ~ max content length (cap 40), matching the desktop's autosize intent.
  ws["!cols"] = columns.map((c, i) => {
    let w = String(c).length;
    for (const r of rows) {
      const v = r[i];
      if (v !== null && v !== undefined) w = Math.max(w, String(v).length);
    }
    return { wch: Math.min(w + 2, 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

/* ---------------- naming (port of the desktop stamps) -------------------- */

/** "YYYY-MM-DD_HHMMSS" — matches dt.datetime.now().strftime("%Y-%m-%d_%H%M%S"). */
function pmrStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ---------------- download helper ---------------------------------------- */

function pmrDownloadXlsxB64(b64, fname) {
  const a = document.createElement("a");
  a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
  a.download = fname;
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

/* =========================================================================
   Workspace UI
   ========================================================================= */

const PmrUi = { result: null };

function renderPmrWorkspace(container) {
  PmrUi.result = null;

  const fy = pmrCurrentFiscalYear();
  const yearOpts = pmrBuildYearList().map((y) => `<option value="${y}">${y}</option>`).join("");
  const qtrOpts = PMR_QTRS.map((q) => `<option value="${q}">${esc(q)}</option>`).join("");

  const panel = el(`
    <div class="panel">
      <header><h2>PMR — Program Management Review</h2><span class="count" id="pmrBadge">Metrics UDQ</span></header>
      <div class="body">
        <div class="note">
          Counts <strong>delivered</strong> SRFs whose <strong>Delivery Date</strong> falls inside the reporting
          window, then breaks them out by destination, shipping mode, and CTR program, and flags late deliveries
          (Delivery Date after NLT Completion Date). FEDEX is counted under Ground Freight; USPS and blank modes are
          not counted. Pick a window, run the report, then export the full workbook (charts included) or any
          single section.
        </div>

        <div class="pmr-quick">
          <label class="pmr-qlabel">Quick windows</label>
          <div class="btnrow" style="flex-wrap:wrap;gap:6px;">
            <button class="btn ghost" data-quick="cq">Current Qtr</button>
            <button class="btn ghost" data-quick="pq">Previous Qtr</button>
            <button class="btn ghost" data-quick="cfy">Current FY</button>
            <button class="btn ghost" data-quick="pfy">Previous FY</button>
            <button class="btn ghost" data-quick="h1">FY First Half</button>
            <button class="btn ghost" data-quick="h2">FY Second Half</button>
            <button class="btn ghost" data-quick="all">All Time</button>
          </div>
          <div class="hint">Fiscal year starts Oct 1. Quick buttons fill the dates and run immediately. "All Time" reports on every delivered WMTR, ignoring the date window.</div>
        </div>

        <div class="pmr-window">
          <div class="field">
            <label for="pmrFy">Fiscal year</label>
            <select id="pmrFy">${yearOpts}</select>
          </div>
          <div class="field">
            <label for="pmrQtr">Quarter</label>
            <select id="pmrQtr">${qtrOpts}</select>
          </div>
          <div class="pmr-spacer"></div>

          <div class="field">
            <label for="pmrStart">Start</label>
            <input type="date" id="pmrStart">
          </div>
          <div class="field">
            <label for="pmrEnd">End</label>
            <input type="date" id="pmrEnd">
          </div>
          <div class="field pmr-runcell">
            <button class="btn primary" id="pmrRun">Run report</button>
          </div>
        </div>

        <div class="btnrow">
          <button class="btn primary" id="pmrExportAll" disabled>Export full PMR (.xlsx)</button>
          <span class="statusline" id="pmrStatus"></span>
        </div>

        <div id="pmrResults"></div>
      </div>
    </div>`);
  container.appendChild(panel);

  const g = (id) => panel.querySelector("#" + id);
  g("pmrFy").value = String(fy);
  g("pmrQtr").value = pmrCurrentQuarterLabel();

  // Seed the custom dates from the current FY/Qtr selection.
  const applyFyQtr = () => {
    const [s, e] = pmrQuarterDates(Number(g("pmrFy").value), g("pmrQtr").value);
    g("pmrStart").value = s; g("pmrEnd").value = e;
  };
  applyFyQtr();

  g("pmrFy").addEventListener("change", applyFyQtr);
  g("pmrQtr").addEventListener("change", applyFyQtr);

  const setWindow = (info) => {
    g("pmrStart").value = info.start; g("pmrEnd").value = info.end;
    g("pmrFy").value = String(info.fy); g("pmrQtr").value = info.qtr;
  };

  const quickMap = {
    cq: pmrCurrentQtrDates, pq: pmrPreviousQtrInfo, cfy: pmrCurrentFyDates,
    pfy: pmrPreviousFyDates, h1: pmrFirstHalfDates, h2: pmrSecondHalfDates,
  };
  panel.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.quick === "all") { runPmrAllTime(); return; }
      setWindow(quickMap[btn.dataset.quick]());
      runPmrReport();
    });
  });

  g("pmrRun").addEventListener("click", runPmrReport);
  g("pmrExportAll").addEventListener("click", exportPmrFull);
}

/** Core PMR run/render. start/end null => All Time (no date window). */
function executePmr(start, end) {
  const status = document.getElementById("pmrStatus");
  status.classList.remove("err");
  status.textContent = "Running PMR report…";
  try {
    const result = pmrRun(AppState.grid, start, end);
    PmrUi.result = result;
    document.getElementById("pmrExportAll").disabled = false;
    renderPmrResults(result);
    const windowText = (start && end) ? `window ${start} → ${end}` : "All time (every delivered WMTR)";
    status.textContent =
      `Delivered SRFs: ${result.total_delivered} · ` +
      `On-time: ${result.on_time_count} (${result.on_time_pct.toFixed(2)}%) · ` +
      `Late: ${result.late_count} · ${windowText}`;
  } catch (e) {
    console.error(e);
    PmrUi.result = null;
    document.getElementById("pmrExportAll").disabled = true;
    document.getElementById("pmrResults").innerHTML = "";
    status.textContent = `Could not run PMR: ${e.message}`;
    status.classList.add("err");
  }
}

function runPmrReport() {
  const status = document.getElementById("pmrStatus");
  status.classList.remove("err");
  const start = document.getElementById("pmrStart").value;
  const end = document.getElementById("pmrEnd").value;
  if (!start || !end) { status.textContent = "Pick a start and end date."; status.classList.add("err"); return; }
  if (start > end) { status.textContent = "Start date is after end date."; status.classList.add("err"); return; }
  executePmr(start, end);
}

function runPmrAllTime() { executePmr(null, null); }

function pmrFmtCell(key, colIdx, v) {
  // Currency display for the cost/value columns in the inline preview.
  if ((key === "cost" || key === "value") && colIdx === 2) {
    return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return v === null || v === undefined ? "" : String(v);
}

function renderPmrResults(result) {
  const host = document.getElementById("pmrResults");
  host.innerHTML = "";

  const summaries = {
    location: `${result.location_total} delivered SRFs across ${result.location_rows.length} destination ${result.location_rows.length === 1 ? "country" : "countries"}.`,
    mode: `${result.mode_total} delivered SRFs counted across the shipping modes below.`,
    cost: `Total service cost in window: $${result.cost_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    value: `Total cargo value in window: $${result.value_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    nlt: `Late deliveries: ${result.late_count} of ${result.total_delivered} · On-time: ${result.on_time_count} (${result.on_time_pct.toFixed(2)}%)`,
    program_count: `${result.program_count_total} delivered WMTRs across ${result.program_count_rows.length} ${result.program_count_rows.length === 1 ? "program" : "programs"}.`,
  };

  for (const sec of pmrSections(result)) {
    const head = sec.columns.map((c) => `<th>${esc(c)}</th>`).join("");
    const body = sec.rows.length
      ? sec.rows.map((r) => `<tr>${sec.columns.map((_c, i) =>
          `<td>${esc(pmrFmtCell(sec.key, i, r[i]))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${sec.columns.length}" style="color:var(--muted)">No rows in this window.</td></tr>`;

    const card = el(`
      <div class="panel" style="margin-top:14px;">
        <header>
          <h2 style="font-size:15px;">${esc(sec.title)}</h2>
          <span class="count">${sec.rows.length} row${sec.rows.length === 1 ? "" : "s"}</span>
        </header>
        <div class="body" style="padding-top:8px;">
          <div class="statusline">${esc(summaries[sec.key] || "")}</div>
          <div class="btnrow" style="margin:4px 0 8px;">
            <button class="btn ghost" data-act="copy" data-key="${sec.key}">Copy</button>
            <button class="btn ghost" data-act="export" data-key="${sec.key}">Export (.xlsx)</button>
            <span class="statusline" data-status="${sec.key}"></span>
          </div>
          <div class="scrollwrap" style="max-height:280px;">
            <table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
          </div>
        </div>
      </div>`);
    host.appendChild(card);

    card.querySelector('[data-act="copy"]').addEventListener("click", () => pmrCopySection(sec));
    card.querySelector('[data-act="export"]').addEventListener("click", () => pmrExportSection(sec, card));
  }
}

function pmrCopySection(sec) {
  const lines = [sec.columns.join("\t")];
  for (const r of sec.rows) lines.push(r.map((v) => (v == null ? "" : String(v))).join("\t"));
  const text = lines.join("\n");
  const status = document.querySelector(`[data-status="${sec.key}"]`);
  const done = () => { if (status) status.textContent = "Copied to clipboard."; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta); done();
}

function pmrExportSection(sec, card) {
  const status = card.querySelector(`[data-status="${sec.key}"]`);
  status.classList.remove("err");
  try {
    const b64 = pmrWriteSectionWorkbook(sec.title, sec.columns, sec.rows);
    const safe = sec.title.replace(/\//g, "-");
    pmrDownloadXlsxB64(b64, `PMR - ${safe}_${pmrStamp()}.xlsx`);
    status.textContent = "Exported.";
  } catch (e) {
    console.error(e);
    status.textContent = `Export failed: ${e.message}`;
    status.classList.add("err");
  }
}

async function exportPmrFull() {
  const status = document.getElementById("pmrStatus");
  status.classList.remove("err");
  if (!PmrUi.result) { status.textContent = "Run the report first."; status.classList.add("err"); return; }
  status.textContent = "Building full PMR workbook…";
  try {
    const b64 = await pmrWriteWorkbook(PmrUi.result);
    const fname = `PMR_${pmrStamp()}.xlsx`;
    pmrDownloadXlsxB64(b64, fname);
    status.textContent = `\u2705 Downloaded ${fname}`;
  } catch (e) {
    console.error(e);
    status.textContent = `Couldn't build the PMR workbook: ${e.message}`;
    status.classList.add("err");
  }
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pmrToDate, pmrIso, pmrDayDiff, pmrNormalizeMode, pmrWmtrSortKey,
    pmrParseUdq, pmrRun, pmrQuarterDates, pmrCurrentFiscalYear,
    pmrCurrentQuarterLabel, pmrStamp,
  };
}
