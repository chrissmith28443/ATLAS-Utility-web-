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

// Captured when present, but not required (so older UDQ exports still parse).
// "Status" drives delivered-vs-canceled handling; the others are for display.
const PMR_OPTIONAL_HEADERS = [
  "Status",
  "Date Submitted",
  "Request Title",
];

const PMR_DISPLAY_MODES = ["Air Freight", "Ocean Freight", "Ground Freight", "Courier", "Hand Carry"];

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
  // Couriers (FedEx/UPS/DHL/USPS) report under their own "Courier" mode.
  // (Was: USPS/FedEx folded into Ground Freight in the web v2.x build.)
  const toks = s.replace(/[-_/]/g, " ").split(/\s+/).filter(Boolean);
  if (toks.some((t) => ["fedex", "ups", "dhl", "usps"].includes(t))) return "Courier";
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

/* =========================================================================
   Daily Update Check (new in 2.5.0 — no desktop predecessor)

   For every WMTR that carries a "Daily Status History" sub-section, confirm:
     1. a daily entry exists for each *business day* in the logged span
        (weekends + US federal holidays are not expected), and
     2. the first daily entry lands within PMR_DAILY_START_GRACE_BIZDAYS
        business days of the record's "Date Submitted".

   WMTRs with no daily entries are skipped — the check only applies once daily
   updates have been entered. This computation is independent of the PMR/Metrics
   reporting window (which filters on Delivery Date); update cadence matters most
   for in-progress requests that have no Delivery Date yet.

   Tunables below are intentionally simple to edit:
     * PMR_DAILY_START_GRACE_BIZDAYS — the "within N days" start allowance. Set
       to business days to match the rest of the check; change pmrCountToFirst()
       to pmrDayDiff() if you'd rather treat it as calendar days.
     * pmrFederalHolidays() — the observed-holiday set. Edit here to add agency
       closures / skip a holiday your team still works.
   ========================================================================= */

const PMR_DAILY_START_GRACE_BIZDAYS = 3;
const PMR_DAILY_SECTION_TITLE = "Daily Status History";

// On-time / late scoring floor. TTI was relieved of the NLT Completion Date
// requirement for anything delivered before this date, so WMTRs with a Delivery
// Date earlier than this are excluded from the On-Time Rate / Late Deliveries
// metric only. They are still counted everywhere else (delivered totals,
// destinations, modes, cost, value, programs).
const PMR_NLT_CUTOFF_ISO = "2025-10-01";

// Relief exception(s): request IDs (WMTR last-5) that were actually reviewed for
// metrics during the relieved window and are therefore scored normally despite
// delivering before the cutoff. 10095 was the one SRF looked at in the Apr–Sep
// FY25 half PMR; every other pre-cutoff SRF delivery was not examined.
const PMR_RELIEF_EXCEPTION_IDS = ["10095"];

/** SRF-only relief. A delivered-before-cutoff SRF is relieved of ALL metric
    scoring (delivery, daily-status, docs, tracking, cost, rejected) — it is
    still counted in every total/denominator elsewhere — except the reviewed
    exception WMTR(s), which are scored normally. Non-SRF and not-yet-delivered
    records are never relieved. Single source of truth: both the PMR tool and the
    Christmas-Tree rollup call this so their outputs cannot drift. */
function pmrSrfRelieved(wmtr, deliveryIso) {
  if (!deliveryIso) return false;                        // in-flight → not relieved
  if (!/-SRF$/i.test(String(wmtr || "").trim())) return false; // SRF-only relief
  if (PMR_RELIEF_EXCEPTION_IDS.includes(pmrmxLast5(wmtr))) return false; // reviewed → scored
  return deliveryIso < PMR_NLT_CUTOFF_ISO;
}

/* ---- US federal holidays (observed), generated per calendar year ---- */

function _pmrNthWeekday(year, month, weekday, n) {
  // weekday: 0=Sun..6=Sat (JS getUTCDay); returns {y,mo,d}
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return { y: year, mo: month, d: day };
}
function _pmrLastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last of this
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return { y: year, mo: month, d: last.getUTCDate() - offset };
}
function _pmrObserved(year, month, day) {
  // Fixed-date holidays shift off Sat (→Fri) / Sun (→Mon) for federal observance.
  const dt = new Date(Date.UTC(year, month - 1, day));
  const w = dt.getUTCDay();
  if (w === 6) dt.setUTCDate(dt.getUTCDate() - 1);
  else if (w === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Set of "YYYY-MM-DD" observed US federal holidays for one calendar year. */
function pmrFederalHolidays(year) {
  const out = [
    _pmrObserved(year, 1, 1),            // New Year's Day
    _pmrNthWeekday(year, 1, 1, 3),       // MLK Jr. — 3rd Monday Jan
    _pmrNthWeekday(year, 2, 1, 3),       // Washington's Birthday — 3rd Monday Feb
    _pmrLastWeekday(year, 5, 1),         // Memorial Day — last Monday May
    _pmrObserved(year, 6, 19),           // Juneteenth
    _pmrObserved(year, 7, 4),            // Independence Day
    _pmrNthWeekday(year, 9, 1, 1),       // Labor Day — 1st Monday Sep
    _pmrNthWeekday(year, 10, 1, 2),      // Columbus Day — 2nd Monday Oct
    _pmrObserved(year, 11, 11),          // Veterans Day
    _pmrNthWeekday(year, 11, 4, 4),      // Thanksgiving — 4th Thursday Nov
    _pmrObserved(year, 12, 25),          // Christmas Day
  ];
  return out.map(pmrIso);
}

let _pmrHolidayCache = {};
function pmrHolidaySet(years) {
  const set = new Set();
  for (const y of years) {
    if (!_pmrHolidayCache[y]) _pmrHolidayCache[y] = pmrFederalHolidays(y);
    for (const iso of _pmrHolidayCache[y]) set.add(iso);
  }
  return set;
}

/* ---- business-day math (operates on {y,mo,d}) ---- */

function _pmrToUTC(d) { return new Date(Date.UTC(d.y, d.mo - 1, d.d)); }
function _pmrFromUTC(dt) {
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function pmrIsBusinessDay(d, holSet) {
  const dt = _pmrToUTC(d);
  const w = dt.getUTCDay();
  if (w === 0 || w === 6) return false;          // Sun / Sat
  return !holSet.has(pmrIso(d));
}
function pmrAddDays(d, n) {
  const dt = _pmrToUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return _pmrFromUTC(dt);
}
/** Business days strictly after `from` up to and including `to` (0 if to<=from). */
function pmrCountToFirst(from, to, holSet) {
  if (pmrDayDiff(from, to) <= 0) return 0;
  let cnt = 0, cur = from;
  while (pmrDayDiff(cur, to) > 0) {
    cur = pmrAddDays(cur, 1);
    if (pmrIsBusinessDay(cur, holSet)) cnt += 1;
  }
  return cnt;
}

/* ---- parse the per-WMTR Daily Status History blocks ---- */

/**
 * Walk the grid block-by-block (each WMTR record row in col A starts a block,
 * which runs until the next record row). Within a block, locate the
 * "Daily Status History" sub-section (title in col C), then collect the date
 * column (col C) of the entry rows that follow its Date/Notes header — stopping
 * at the first row that starts a new sub-section (col B non-empty) or whose
 * date column no longer parses as a date. Returns one entry per record:
 *   { wmtr, submitted:{y,mo,d}|null, dates:[{y,mo,d}...] (ascending, de-duped) }
 */
function pmrParseDailyBlocks(grid) {
  const shipMap = buildHeaderMap(grid, 1);
  const subCol = shipMap[normWs("Date Submitted")] || 0;
  const statusCol = shipMap[normWs("Status")] || 0;
  const deliveryCol = shipMap[normWs("Delivery Date")] || 0;
  const maxRow = gridMaxRow(grid);

  // Record rows (col A is a WMTR key).
  const recRows = [];
  for (let r = 2; r <= maxRow; r++) {
    if (pmrLooksWmtr(gridCell(grid, r, 1))) recRows.push(r);
  }

  const out = [];
  for (let i = 0; i < recRows.length; i++) {
    const rr = recRows[i];
    const rEnd = i + 1 < recRows.length ? recRows[i + 1] : maxRow + 1;
    const wmtr = norm(gridCell(grid, rr, 1));
    const submitted = subCol ? pmrToDate(gridCell(grid, rr, subCol)) : null;
    const status = statusCol ? norm(gridCell(grid, rr, statusCol)) : "";
    const delivery = deliveryCol ? pmrToDate(gridCell(grid, rr, deliveryCol)) : null;

    // Find the Daily Status History title within this block.
    let titleRow = 0;
    for (let r = rr + 1; r < rEnd; r++) {
      if (normWs(gridCell(grid, r, 3)).toLowerCase() === PMR_DAILY_SECTION_TITLE.toLowerCase()) {
        titleRow = r; break;
      }
    }

    const dates = [];
    if (titleRow) {
      // Entry rows start two rows below the title (title, then Date/Notes header).
      for (let r = titleRow + 2; r < rEnd; r++) {
        if (norm(gridCell(grid, r, 2))) break;          // a new sub-section began
        const c = gridCell(grid, r, 3);
        const d = pmrToDate(c);
        if (!d) {
          if (!norm(c) && !norm(gridCell(grid, r, 4))) continue; // skip blank spacer rows
          break;                                                 // non-date → block ended
        }
        dates.push(d);
      }
    }

    // De-dupe + sort ascending by ISO.
    const seen = new Set();
    const uniq = [];
    for (const d of dates) {
      const iso = pmrIso(d);
      if (!seen.has(iso)) { seen.add(iso); uniq.push(d); }
    }
    uniq.sort((a, b) => {
      const ia = pmrIso(a), ib = pmrIso(b);
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
    out.push({ wmtr, submitted, status, delivery, dates: uniq });
  }
  return out;
}

/**
 * Run the Daily Update Check across the whole file (window-independent).
 * Returns:
 *   {
 *     total_records, with_daily, compliant, late_start, has_gaps,
 *     compliant_pct,
 *     rows: [{ wmtr, submitted(iso|''), first(iso), last(iso), entries,
 *              biz_to_first(int|null), late_start(bool), missing(iso[]),
 *              missing_count(int), status }]
 *   }
 * `rows` lists only WMTRs that have daily entries (compliant + flagged), sorted
 * with flagged records first, then by WMTR number.
 */
function pmrDailyUpdateCheck(grid, startIso, endIso) {
  const blocks = pmrParseDailyBlocks(grid);
  const useWindow = !!(startIso && endIso);   // All Time passes null/null
  const winStart = useWindow ? pmrToDate(startIso) : null;
  const winEnd = useWindow ? pmrToDate(endIso) : null;

  // Holiday set spanning every year the daily logs touch.
  const years = new Set();
  for (const b of blocks) for (const d of b.dates) years.add(d.y);
  if (winStart) years.add(winStart.y);
  if (winEnd) years.add(winEnd.y);
  if (!years.size) years.add(new Date().getFullYear());
  const holSet = pmrHolidaySet([...years]);

  const rows = [];
  let compliant = 0, lateStart = 0, hasGaps = 0;
  let inWindowRecords = 0;

  for (const b of blocks) {
    if (!b.dates.length) continue;              // only check WMTRs with daily logs
    if (String(b.status || "").toLowerCase().startsWith("cancel")) continue; // canceled: not expected to keep logging
    if (pmrSrfRelieved(b.wmtr, b.delivery ? pmrIso(b.delivery) : null)) continue; // relieved SRF: not scored on any metric
    const first = b.dates[0];
    const last = b.dates[b.dates.length - 1];

    // Clip the checked span to the reporting window. A WMTR is only in scope when
    // its logged span overlaps the window; the gap check then runs over the
    // overlapping business days (parallels how delivered SRFs are window-filtered).
    let spanStart = first, spanEnd = last;
    if (useWindow) {
      if (pmrDayDiff(first, winStart) > 0) spanStart = winStart;   // winStart later than first
      if (pmrDayDiff(winEnd, last) > 0) spanEnd = winEnd;          // winEnd earlier than last
      if (pmrDayDiff(spanEnd, spanStart) > 0) continue;            // no overlap with window
    }
    inWindowRecords += 1;

    // --- Start-timeliness check: TEMPORARILY DISABLED (2.5.0) ---
    // "Date Submitted" is user-entered, not system-generated: a request can sit
    // in draft for months after the entered date before it is actually submitted
    // to TTI (which is when daily updates should begin). Until a reliable
    // submission timestamp exists, we do NOT flag a late first entry, and the
    // start window does not affect compliance.
    //
    // To re-enable later: uncomment the block below, then restore `isLateStart`
    // into `ok`, the `lateStart` tally, and the `statusBits` push further down.
    let bizToFirst = null, isLateStart = false;
    // if (b.submitted) {
    //   bizToFirst = pmrCountToFirst(b.submitted, first, holSet);
    //   isLateStart = bizToFirst > PMR_DAILY_START_GRACE_BIZDAYS;
    // }

    // Gaps: business days in the (possibly clipped) span with no entry.
    const have = new Set(b.dates.map(pmrIso));
    const missing = [];
    let cur = spanStart;
    while (pmrDayDiff(cur, spanEnd) >= 0) {
      if (pmrIsBusinessDay(cur, holSet) && !have.has(pmrIso(cur))) missing.push(pmrIso(cur));
      cur = pmrAddDays(cur, 1);
    }

    // Entries that fall inside the clipped span (for display).
    const entriesInSpan = b.dates.filter(
      (d) => pmrDayDiff(spanStart, d) >= 0 && pmrDayDiff(d, spanEnd) >= 0
    ).length;

    // if (isLateStart) lateStart += 1;   // disabled — see note above
    if (missing.length) hasGaps += 1;
    const ok = /* !isLateStart && */ missing.length === 0;
    if (ok) compliant += 1;

    const statusBits = [];
    // if (isLateStart) statusBits.push(`First entry ${bizToFirst} business days after submission`);
    if (missing.length) statusBits.push(`${missing.length} missing business day${missing.length === 1 ? "" : "s"}`);

    rows.push({
      wmtr: b.wmtr,
      submitted: b.submitted ? pmrIso(b.submitted) : "",
      first: pmrIso(spanStart),
      last: pmrIso(spanEnd),
      entries: entriesInSpan,
      biz_to_first: bizToFirst,
      late_start: isLateStart,
      missing,
      missing_count: missing.length,
      status: ok ? "OK" : statusBits.join("; "),
    });
  }

  // Flagged first, then by WMTR number.
  rows.sort((a, b) => {
    const af = a.status === "OK" ? 1 : 0, bf = b.status === "OK" ? 1 : 0;
    if (af !== bf) return af - bf;
    return pmrWmtrSortKey(a.wmtr) - pmrWmtrSortKey(b.wmtr);
  });

  const withDaily = rows.length;
  return {
    window_start: startIso || null,
    window_end: endIso || null,
    total_records: blocks.length,
    with_daily: withDaily,
    compliant,
    late_start: lateStart,
    has_gaps: hasGaps,
    compliant_pct: withDaily ? pmrRound2((compliant / withDaily) * 100) : 0,
    grace_bizdays: PMR_DAILY_START_GRACE_BIZDAYS,
    rows,
  };
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
    for (const h of PMR_OPTIONAL_HEADERS) {
      const c = shipMap[normWs(h)];
      if (c) fields[h] = gridCell(grid, r, c);
    }
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
  const noNltRows = [];           // delivered, but NLT Completion Date missing in ATLAS
  const missingModeRows = [];     // delivered, but "Identify Shipment As" blank in ATLAS
  const unknownModeRows = [];     // delivered, but mode not one PMR recognizes (typo / new mode)
  const missingDestRows = [];     // delivered, but "Country of Destination" blank
  const missingProgramRows = [];  // delivered, but "CTR Program" blank
  const cancelledRows = [];       // Status = Cancelled/Canceled (no delivery date)
  const deliveredWmtrs = [];      // every WMTR counted in totalDelivered (this window)
  let totalDelivered = 0, onTimeCount = 0;
  let nltScoped = 0;              // delivered, in-window, on/after the NLT cutoff
  let nltExempt = 0;             // delivered before the NLT cutoff (scoring waived)

  for (const b of blocks) {
    const wmtr = norm(b["WMTR Number"]);
    const status = norm(b["Status"]);

    // Canceled WMTRs are reported on their own and never counted as delivered.
    // They show in every view regardless of the reporting window (no date filter).
    if (status.toLowerCase().startsWith("cancel")) {
      const sub = pmrToDate(b["Date Submitted"]);
      cancelledRows.push([wmtr, status, sub ? pmrIso(sub) : "", norm(b["CTR Program"]), norm(b["Request Title"])]);
      continue;
    }

    const delivery = pmrToDate(b["Delivery Date"]);
    if (!delivery) continue;   // not delivered → excluded from all delivered metrics
    const deliveryIso = pmrIso(delivery);
    if (useWindow && !pmrInWindow(deliveryIso, startIso, endIso)) continue;

    totalDelivered += 1;
    deliveredWmtrs.push(wmtr);

    const dest = norm(b["Country of Destination"]);
    if (dest) {
      locationCounts[dest] = (locationCounts[dest] || 0) + 1;
      (locationWmtrs[dest] = locationWmtrs[dest] || []).push(wmtr);
    } else {
      missingDestRows.push([wmtr, deliveryIso]);
    }

    const rawMode = norm(b["Identify Shipment As"]);
    const mode = pmrNormalizeMode(rawMode);
    if (mode) {
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
      (modeWmtrs[mode] = modeWmtrs[mode] || []).push(wmtr);
    } else if (!rawMode) {
      // Blank in ATLAS — data error, not counted under any mode.
      missingModeRows.push([wmtr, deliveryIso]);
    } else {
      // Has a value, but not one PMR maps to a mode — likely a typo / new mode.
      unknownModeRows.push([wmtr, rawMode, deliveryIso]);
    }

    const program = norm(b["CTR Program"]);
    if (program) {
      costByProgram[program] = (costByProgram[program] || 0) + toFloat(b["Total Cost in USD"]);
      valueByProgram[program] = (valueByProgram[program] || 0) + toFloat(b["Value of Cargo (USD)"]);
      costCountByProgram[program] = (costCountByProgram[program] || 0) + 1;
      valueCountByProgram[program] = (valueCountByProgram[program] || 0) + 1;
      (programWmtrs[program] = programWmtrs[program] || []).push(wmtr);
    } else {
      missingProgramRows.push([wmtr, deliveryIso]);
    }

    // On-time / late scoring is waived for relieved deliveries (delivered before
    // the NLT cutoff, TTI relieved of the NLT requirement) — except the reviewed
    // exception WMTR(s). These still count toward delivered totals, destinations,
    // modes, cost, value and programs above — just not the on-time metric.
    if (pmrSrfRelieved(wmtr, deliveryIso)) {
      nltExempt += 1;
    } else {
      nltScoped += 1;
      const nlt = pmrToDate(b["NLT Completion Date"]);
      if (nlt && deliveryIso <= pmrIso(nlt)) onTimeCount += 1;
      if (nlt && deliveryIso > pmrIso(nlt)) {
        lateRows.push([wmtr, pmrIso(nlt), deliveryIso, pmrDayDiff(nlt, delivery)]);
      }
      if (!nlt) {
        // Delivered on/after the cutoff and in-window, but no usable NLT
        // Completion Date in ATLAS. Counted in the scored total; can't be
        // scored on-time or late until corrected.
        noNltRows.push([wmtr, deliveryIso]);
      }
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
  noNltRows.sort((a, b) => pmrWmtrSortKey(a[0]) - pmrWmtrSortKey(b[0]));
  const byWmtr = (a, b) => pmrWmtrSortKey(a[0]) - pmrWmtrSortKey(b[0]);
  missingModeRows.sort(byWmtr);
  unknownModeRows.sort(byWmtr);
  missingDestRows.sort(byWmtr);
  missingProgramRows.sort(byWmtr);
  cancelledRows.sort((a, b) => pmrWmtrSortKey(a[0]) - pmrWmtrSortKey(b[0]));

  const onTimePct = nltScoped ? pmrRound2((onTimeCount / nltScoped) * 100) : 0.0;

  // Daily Update Check is window-independent (cadence matters for in-progress
  // WMTRs that have no Delivery Date). Computed defensively so a file missing the
  // "Date Submitted" header still produces a PMR.
  let dailyUpdate;
  try { dailyUpdate = pmrDailyUpdateCheck(grid, startIso, endIso); }
  catch (e) { dailyUpdate = { total_records: 0, with_daily: 0, compliant: 0, late_start: 0, has_gaps: 0, compliant_pct: 0, grace_bizdays: PMR_DAILY_START_GRACE_BIZDAYS, rows: [] }; }

  return {
    window_start: startIso,
    window_end: endIso,
    daily_update: dailyUpdate,
    location_rows: locationRows,
    mode_rows: modeRows,
    cost_rows: costRows,
    value_rows: valueRows,
    late_rows: lateRows,
    total_delivered: totalDelivered,
    delivered_wmtrs: deliveredWmtrs,
    nlt_scoped: nltScoped,
    nlt_exempt: nltExempt,
    nlt_cutoff: PMR_NLT_CUTOFF_ISO,
    late_count: lateRows.length,
    no_nlt_rows: noNltRows,
    no_nlt_count: noNltRows.length,
    missing_mode_rows: missingModeRows,
    missing_mode_count: missingModeRows.length,
    unknown_mode_rows: unknownModeRows,
    unknown_mode_count: unknownModeRows.length,
    missing_dest_rows: missingDestRows,
    missing_dest_count: missingDestRows.length,
    missing_program_rows: missingProgramRows,
    missing_program_count: missingProgramRows.length,
    cancelled_rows: cancelledRows,
    cancelled_count: cancelledRows.length,
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

/** Reverse lookup: an ISO date -> { fy, qtr, key } fiscal-quarter bucket.
    FY starts Oct 1 (Oct–Dec = 1st Qtr of the NEXT calendar year's FY). Returns
    null for a blank/invalid date. `key` sorts chronologically ("FY26 Q1"). */
function pmrFyQuarterOf(iso) {
  const d = pmrToDate(iso);
  if (!d) return null;
  const y = d.y, mo = d.mo;
  const fy = mo >= 10 ? y + 1 : y;
  let qtr;
  if (mo >= 10) qtr = "1st Qtr";
  else if (mo <= 3) qtr = "2nd Qtr";
  else if (mo <= 6) qtr = "3rd Qtr";
  else qtr = "4th Qtr";
  const qn = { "1st Qtr": 1, "2nd Qtr": 2, "3rd Qtr": 3, "4th Qtr": 4 }[qtr];
  return { fy, qtr, key: `FY${String(fy).slice(-2)} Q${qn}` };
}

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
/** Whichever fiscal half we're currently in (FY starts Oct 1:
    First Half = Oct–Mar, Second Half = Apr–Sep). Used as the PMR default. */
function pmrCurrentHalfDates() {
  const m = pmrToday().mo;
  const firstHalf = (m >= 10 || m <= 3);   // Oct–Mar
  return firstHalf ? pmrFirstHalfDates() : pmrSecondHalfDates();
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
    { key: "daily", title: "Daily Update Check",
      columns: ["WMTR Number", "First Daily Entry", "Last Daily Entry",
                "Daily Entries", "Missing Business Days", "Missing Dates", "Status"],
      rows: (result.daily_update ? result.daily_update.rows : []).map((r) => [
        r.wmtr,
        r.first,
        r.last,
        r.entries,
        r.missing_count,
        r.missing.join(", "),
        r.status,
      ]) },
    { key: "cancelled", title: "Canceled WMTRs",
      columns: ["WMTR Number", "Status", "Date Submitted", "CTR Program", "Request Title"],
      rows: (result.cancelled_rows || []).map((r) => [r[0], r[1], r[2] || "—", r[3], r[4]]) },
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

const PmrUi = { result: null, ignoreOpen: false };

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
          (Delivery Date after NLT Completion Date). FedEx, UPS, DHL and USPS are counted under Courier; blank modes are
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
    pmrClearActiveQuick();
  };

  g("pmrFy").addEventListener("change", applyFyQtr);
  g("pmrQtr").addEventListener("change", applyFyQtr);

  const setWindow = (info) => {
    g("pmrStart").value = info.start; g("pmrEnd").value = info.end;
    g("pmrFy").value = String(info.fy); g("pmrQtr").value = info.qtr;
  };

  /** Highlight the quick button whose window is active (matches the Metrics
      tool), and clear it when the window is set another way. */
  function pmrClearActiveQuick() {
    panel.querySelectorAll("[data-quick].active").forEach((b) => b.classList.remove("active"));
  }
  function pmrMarkActiveQuick(key) {
    pmrClearActiveQuick();
    const b = panel.querySelector(`[data-quick="${key}"]`);
    if (b) b.classList.add("active");
  }

  // Default the reporting window to the current fiscal half on open.
  const _half = pmrCurrentHalfDates();
  setWindow(_half);
  pmrMarkActiveQuick(pmrToday().mo >= 10 || pmrToday().mo <= 3 ? "h1" : "h2");

  const quickMap = {
    cq: pmrCurrentQtrDates, pq: pmrPreviousQtrInfo, cfy: pmrCurrentFyDates,
    pfy: pmrPreviousFyDates, h1: pmrFirstHalfDates, h2: pmrSecondHalfDates,
  };
  panel.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.quick === "all") { pmrMarkActiveQuick("all"); runPmrAllTime(); return; }
      setWindow(quickMap[btn.dataset.quick]());
      pmrMarkActiveQuick(btn.dataset.quick);
      runPmrReport();
    });
  });

  g("pmrRun").addEventListener("click", () => { pmrClearActiveQuick(); runPmrReport(); });
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
      `On-time: ${result.on_time_count}/${result.nlt_scoped} (${result.on_time_pct.toFixed(2)}%) · ` +
      `Late: ${result.late_count} · ` +
      `Missing NLT: ${result.no_nlt_count}` +
      (result.nlt_exempt ? ` · ${result.nlt_exempt} pre-cutoff excluded` : "") +
      ` · ${windowText}`;
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

/* =========================================================================
   Shared "Ignore" list for the PMR and Metrics tools.

   The two tools are two views of the SAME pmrRun() output, so they share one
   suppression list (persisted to the browser). "Ignoring" a WMTR/category hides
   the matching on-screen reminder — the red data-quality banners in PMR and the
   flagged / data-quality strips in Metrics — for reviewer noise reduction.

   IMPORTANT (compliance safety): ignoring NEVER changes a computed value. It
   does not touch delivered totals, on-time %, cost/value, the section tables,
   the Daily Update Check detail table, or ANY exported workbook. It only hides
   the "go fix this in ATLAS" prompts the reviewer has already acknowledged —
   the underlying data problem still exists and still shows in the true counts.
   Storage:  atlas.pmr_metrics.ignores  ->  { "<WMTR>": ["nlt","dest",...] | ["*"] }
   Matching is flexible: a stored key matches a row by exact string OR shared
   last-5 digits, so a reviewer can type "10097" or the full WMTR string.
   ========================================================================= */
const PMRMX_IGNORE_KEY = "atlas.pmr_metrics.ignores";
const PMRMX_CATS = ["nlt", "mode", "unknown_mode", "dest", "program", "daily", "docs", "country", "manual"];
const PMRMX_CAT_LABELS = {
  "*": "All flags",
  nlt: "Missing NLT date",
  mode: "Missing shipping mode",
  unknown_mode: "Unknown shipping mode",
  dest: "Missing destination",
  program: "Missing CTR program",
  daily: "Daily update gap",
  docs: "Missing documents",
  country: "Missing country / unclassifiable",
  manual: "Manually-entered metric flag",
};
function pmrmxLast5(s) { const m = String(s || "").match(/(\d{5})(?!.*\d)/); return m ? m[1] : ""; }
function pmrmxGetIgnores() {
  try { const o = JSON.parse(localStorage.getItem(PMRMX_IGNORE_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
function pmrmxSetIgnores(o) { try { localStorage.setItem(PMRMX_IGNORE_KEY, JSON.stringify(o)); } catch (e) { /* storage off */ } }
function pmrmxAddIgnore(wmtr, cat) {
  const key = String(wmtr || "").trim();
  if (!key) return;
  const ig = pmrmxGetIgnores();
  const list = new Set(ig[key] || []);
  if (cat === "*") { ig[key] = ["*"]; }
  else { list.add(cat); ig[key] = Array.from(list).filter((m) => m !== "*"); }
  pmrmxSetIgnores(ig);
}
function pmrmxRemoveIgnore(wmtr, cat) {
  const ig = pmrmxGetIgnores();
  const key = String(wmtr || "").trim();
  if (!ig[key]) return;
  if (!cat) { delete ig[key]; }
  else { ig[key] = ig[key].filter((m) => m !== cat); if (!ig[key].length) delete ig[key]; }
  pmrmxSetIgnores(ig);
}
function pmrmxKeyMatches(key, wmtr) {
  const k = String(key || "").trim().toUpperCase();
  const w = String(wmtr || "").trim().toUpperCase();
  if (!k || !w) return false;
  if (k === w) return true;
  const k5 = pmrmxLast5(k), w5 = pmrmxLast5(w);
  return !!(k5 && k5 === w5);
}
function pmrmxIsIgnored(wmtr, cat) {
  const ig = pmrmxGetIgnores();
  for (const key of Object.keys(ig)) {
    if (!pmrmxKeyMatches(key, wmtr)) continue;
    const list = ig[key] || [];
    if (list.includes("*") || list.includes(cat)) return true;
  }
  return false;
}
function pmrmxCount() { return Object.keys(pmrmxGetIgnores()).length; }

/* One-time CSS injection so we don't touch app.css for this small feature. */
function pmrmxInjectStyle() {
  if (typeof document === "undefined" || document.getElementById("pmrmxIgnoreStyle")) return;
  const s = document.createElement("style");
  s.id = "pmrmxIgnoreStyle";
  s.textContent =
    ".pmrmx-ignorewrap{margin:2px 0 12px}" +
    ".pmrmx-ignorebox{margin:8px 0 2px;border:1px solid var(--line);border-radius:var(--radius-panel);padding:10px 12px;background:var(--paper)}" +
    ".pmrmx-ignore-add{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 2px}" +
    ".pmrmx-ignore-add input{flex:1;min-width:240px}" +
    ".pmrmx-ignore-add select{min-width:170px}" +
    ".pmrmx-ignore-row{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;padding:5px 0;border-top:1px solid var(--line)}" +
    ".pmrmx-ignore-row:first-child{border-top:0}" +
    ".pmrmx-ignore-row .cats{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10.5px;color:var(--steel)}" +
    ".pmrmx-ignore-row button{margin-left:auto;border:1px solid var(--line);background:var(--card);color:var(--steel);border-radius:var(--radius-badge);cursor:pointer;font-size:11px;padding:1px 8px}" +
    ".pmrmx-ignore-row button:hover{border-color:var(--warn);color:var(--warn)}" +
    ".pmrmx-ackx{margin-left:6px;border:0;background:none;color:var(--steel);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;border-radius:var(--radius-badge)}" +
    ".pmrmx-ackx:hover{color:var(--warn);background:#F3E3E3}" +
    ".pmrmx-acknote{color:var(--steel);font-family:var(--body);font-size:11.5px}";
  document.head.appendChild(s);
}

/** Render the current ignore list into `host`, with per-row Remove buttons. */
function pmrmxRenderIgnoreList(host, onChange) {
  const ig = pmrmxGetIgnores();
  const keys = Object.keys(ig).sort((a, b) => (pmrmxLast5(a) || a).localeCompare(pmrmxLast5(b) || b));
  if (!keys.length) { host.innerHTML = `<div class="hint" style="margin-top:6px">Nothing ignored yet.</div>`; return; }
  host.innerHTML = keys.map((k) => {
    const cats = (ig[k] || []).map((m) => PMRMX_CAT_LABELS[m] || m).join(", ");
    return `<div class="pmrmx-ignore-row"><span>${esc(k)}</span><span class="cats">${esc(cats)}</span><button data-wmtr="${esc(k)}" type="button">Remove</button></div>`;
  }).join("");
  host.querySelectorAll("button[data-wmtr]").forEach((b) =>
    b.addEventListener("click", () => { pmrmxRemoveIgnore(b.getAttribute("data-wmtr")); if (typeof onChange === "function") onChange(); }));
}

/**
 * Build the shared "Ignored (N)…" toggle + management box as a DOM node.
 * opts.onChange() runs after any add/remove (caller repaints its flags).
 * opts.open / opts.onToggle(open) let the caller persist the box's open state
 * across repaints (so it doesn't snap shut on every change).
 */
function pmrmxBuildIgnoreUI(opts) {
  opts = opts || {};
  const onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
  const onToggle = typeof opts.onToggle === "function" ? opts.onToggle : function () {};
  pmrmxInjectStyle();
  const n = pmrmxCount();
  const open = !!opts.open;
  const catOpts = ["*"].concat(PMRMX_CATS)
    .map((k) => `<option value="${k}">${esc(PMRMX_CAT_LABELS[k])}</option>`).join("");
  const wrap = el(`
    <div class="pmrmx-ignorewrap">
      <button class="btn ghost" type="button" data-role="btn">Ignored${n ? ` (${n})` : ""}&hellip;</button>
      <div class="pmrmx-ignorebox${open ? "" : " hidden"}" data-role="box">
        <div class="hint" style="margin:0 0 6px">Hide data-quality reminders you've already reviewed. This affects only the on-screen flags — it never changes any count, percentage, or exported report.</div>
        <div class="pmrmx-ignore-add">
          <input type="text" data-role="wmtr" placeholder="WMTR number (full or last 5, e.g. 10097)" spellcheck="false" autocomplete="off">
          <select data-role="cat">${catOpts}</select>
          <button class="btn primary" type="button" data-role="add">Ignore</button>
        </div>
        <div data-role="list"></div>
      </div>
    </div>`);
  const box = wrap.querySelector('[data-role="box"]');
  const wmtrInput = wrap.querySelector('[data-role="wmtr"]');
  pmrmxRenderIgnoreList(wrap.querySelector('[data-role="list"]'), onChange);
  wrap.querySelector('[data-role="btn"]').addEventListener("click", () => {
    const nowHidden = box.classList.toggle("hidden");
    onToggle(!nowHidden);
  });
  const add = () => {
    const raw = wmtrInput.value.trim();
    if (!raw) return;
    pmrmxAddIgnore(raw, wrap.querySelector('[data-role="cat"]').value);
    wmtrInput.value = "";
    onChange();
  };
  wrap.querySelector('[data-role="add"]').addEventListener("click", add);
  wmtrInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  return wrap;
}


/**
 * Data-quality banner. A delivered SRF should populate every PMR field; when a
 * field is blank/unrecognized the record is still in the delivered total but is
 * silently dropped from a section, so we surface it at the top for correction in
 * ATLAS. level: "error" (red, must fix) | "warn" (amber, verify) | "info"
 * (muted, excluded by design). `items` are pre-built, escaped <li> strings.
 */
function pmrIssueBanner(opts) {
  const colors = { error: "#c0392b", warn: "#b9770e", info: "var(--muted)" };
  const tags = { error: "not counted", warn: "not counted", info: "excluded by design" };
  const c = colors[opts.level] || colors.error;
  const statusClass = opts.level === "error" ? "statusline err" : "statusline";
  return el(`
    <div class="panel" style="margin-bottom:14px;border:1px solid ${c};border-left:4px solid ${c};">
      <header>
        <h2 style="font-size:15px;color:${c};">${opts.title}</h2>
        <span class="count">${tags[opts.level] || ""}</span>
      </header>
      <div class="body" style="padding-top:8px;">
        <div class="${statusClass}">${opts.intro}</div>
        <ul style="margin:8px 0 0;padding-left:20px;">${opts.items.join("")}</ul>
      </div>
    </div>`);
}

function renderPmrResults(result) {
  const host = document.getElementById("pmrResults");
  host.innerHTML = "";

  // ---- Shared "Ignored" manager (PMR + Metrics). Suppresses only the on-screen
  //      reminders below — never a count, percentage, or exported figure. ----
  host.appendChild(pmrmxBuildIgnoreUI({
    open: PmrUi.ignoreOpen,
    onToggle: (o) => { PmrUi.ignoreOpen = o; },
    onChange: () => renderPmrResults(PmrUi.result),
  }));

  // ---- Data-quality banners (only render when something is actually wrong) ----
  const plural = (n) => (n === 1 ? "" : "s");
  const total = result.total_delivered;
  const ackx = (wmtr, cat) =>
    ` <button class="pmrmx-ackx" data-wmtr="${esc(wmtr)}" data-cat="${cat}" type="button" title="Acknowledge &amp; hide this reminder">\u00d7</button>`;
  const liDate = (cat) => (r) => `<li><strong>${esc(r[0])}</strong> — delivered ${esc(r[1])}${ackx(r[0], cat)}</li>`;

  // Render one data-quality banner minus any WMTR/category the reviewer has
  // acknowledged in the Ignored list. Per-item "×" acknowledges just that row.
  // The true counts are untouched — only these reminders are hidden.
  function pmrDqBanner(cfg) {
    const visible = cfg.rows.filter((r) => !pmrmxIsIgnored(r[0], cfg.cat));
    const acked = cfg.rows.length - visible.length;
    if (!visible.length) return;                     // nothing actionable; banner hidden
    const ackNote = acked
      ? ` <span class="pmrmx-acknote">(+${acked} acknowledged &amp; hidden — manage in “Ignored”.)</span>`
      : "";
    const banner = pmrIssueBanner({
      level: cfg.level,
      title: cfg.titleFn(visible.length),
      intro: cfg.intro + ackNote,
      items: visible.map(cfg.liFn),
    });
    host.appendChild(banner);
    banner.querySelectorAll(".pmrmx-ackx").forEach((b) =>
      b.addEventListener("click", () => {
        pmrmxAddIgnore(b.getAttribute("data-wmtr"), b.getAttribute("data-cat"));
        renderPmrResults(PmrUi.result);
      }));
  }

  pmrDqBanner({
    cat: "nlt", level: "error", rows: result.no_nlt_rows, liFn: liDate("nlt"),
    titleFn: (n) => `Action required — ${n} record${plural(n)} missing NLT Completion Date`,
    intro: `These SRFs are delivered and included in the ${total} delivered total, but have no NLT Completion Date in ATLAS, so they can't be scored on-time or late. Correct the NLT date on each record in ATLAS, re-export the UDQ, and re-run this report.`,
  });
  pmrDqBanner({
    cat: "mode", level: "error", rows: result.missing_mode_rows, liFn: liDate("mode"),
    titleFn: (n) => `Action required — ${n} record${plural(n)} missing shipping mode`,
    intro: `These SRFs are in the ${total} delivered total but have no "Identify Shipment As" value in ATLAS, so they aren't counted under any shipping mode. Set the shipping mode on each record in ATLAS, re-export the UDQ, and re-run.`,
  });
  pmrDqBanner({
    cat: "dest", level: "error", rows: result.missing_dest_rows, liFn: liDate("dest"),
    titleFn: (n) => `Action required — ${n} record${plural(n)} missing Country of Destination`,
    intro: `These SRFs are in the ${total} delivered total but have no Country of Destination in ATLAS, so they aren't counted in "Completed SRFs by Location." Set the destination on each record in ATLAS, re-export the UDQ, and re-run.`,
  });
  pmrDqBanner({
    cat: "program", level: "error", rows: result.missing_program_rows, liFn: liDate("program"),
    titleFn: (n) => `Action required — ${n} record${plural(n)} missing CTR Program`,
    intro: `These SRFs are in the ${total} delivered total but have no CTR Program in ATLAS, so they're excluded from the Cost of Service, Value of Cargo, and "Total WMTRs by Program" sections. Set the CTR Program on each record in ATLAS, re-export the UDQ, and re-run.`,
  });
  pmrDqBanner({
    cat: "unknown_mode", level: "warn", rows: result.unknown_mode_rows,
    liFn: (r) => `<li><strong>${esc(r[0])}</strong> — "${esc(r[1])}" — delivered ${esc(r[2])}${ackx(r[0], "unknown_mode")}</li>`,
    titleFn: (n) => `Check — ${n} record${plural(n)} with an unrecognized shipping mode`,
    intro: `PMR maps shipping modes to Air / Ocean / Ground / Courier / Hand Carry (FedEx, UPS, DHL and USPS count as Courier). These values match none of those, so the records aren't counted under a mode. Verify each value in ATLAS — likely a typo, or a mode PMR doesn't recognize yet.`,
  });

  // Actionable (non-acknowledged) counts — used only to keep the section
  // summaries' "see banner above" wording honest when a banner is fully hidden.
  const _act = (cat, rows) => rows.filter((r) => !pmrmxIsIgnored(r[0], cat)).length;
  const destAct = _act("dest", result.missing_dest_rows);
  const modeAct = _act("mode", result.missing_mode_rows) + _act("unknown_mode", result.unknown_mode_rows);
  const progAct = _act("program", result.missing_program_rows);

  const modeUncounted = result.missing_mode_count + result.unknown_mode_count;

  const summaries = {
    location: `${result.location_total} of ${total} delivered SRFs counted across ${result.location_rows.length} destination ${result.location_rows.length === 1 ? "country" : "countries"}.${result.missing_dest_count ? ` ${result.missing_dest_count} not counted — ${destAct ? "see banner above." : "all acknowledged."}` : ""}`,
    mode: `${result.mode_total} of ${total} delivered SRFs counted by shipping mode.${modeUncounted ? ` ${modeUncounted} not counted — ${modeAct ? "see banner above." : "all acknowledged."}` : ""}`,
    cost: `Total service cost in window: $${result.cost_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    value: `Total cargo value in window: $${result.value_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    nlt: `On-time: ${result.on_time_count} · Late: ${result.late_count} · Missing NLT: ${result.no_nlt_count} → ${result.nlt_scoped} scored (on-time ${result.on_time_pct.toFixed(2)}%).${result.nlt_exempt ? ` ${result.nlt_exempt} delivered before ${result.nlt_cutoff} excluded from on-time scoring (NLT requirement waived); still in the ${total} delivered total.` : ""}`,
    program_count: `${result.program_count_total} of ${total} delivered WMTRs counted across ${result.program_count_rows.length} ${result.program_count_rows.length === 1 ? "program" : "programs"}.${result.missing_program_count ? ` ${result.missing_program_count} not counted — ${progAct ? "see banner above." : "all acknowledged."}` : ""}`,
    daily: (() => {
      const d = result.daily_update || { with_daily: 0, compliant: 0, has_gaps: 0, compliant_pct: 0 };
      const scope = (result.window_start && result.window_end) ? "with daily activity in this window" : "with daily logs";
      if (!d.with_daily) return `No WMTRs ${scope} — nothing to check.`;
      return `${d.compliant} of ${d.with_daily} WMTRs ${scope} have no gaps (${d.compliant_pct.toFixed(1)}%) · WMTRs with gaps: ${d.has_gaps}. ` +
        `A daily entry is expected every business day (weekends + US federal holidays excluded), checked over the part of each WMTR's logged span that falls inside the reporting window.`;
    })(),
    cancelled: (() => {
      const n = result.cancelled_count || 0;
      if (!n) return "No canceled WMTRs in this file.";
      return `${n} canceled WMTR${n === 1 ? "" : "s"} (shown in every view, regardless of the reporting window). Canceled requests are reported here only — they are not counted as delivered or scored for on-time/late.`;
    })(),
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
    // Shared SRF relief predicate + FY-quarter bucketing (reconciliation core):
    pmrSrfRelieved, pmrFyQuarterOf, PMR_NLT_CUTOFF_ISO, PMR_RELIEF_EXCEPTION_IDS,
    pmrFederalHolidays, pmrHolidaySet, pmrIsBusinessDay,
    pmrParseDailyBlocks, pmrDailyUpdateCheck,
    // Shared PMR/Metrics ignore list (pure logic + UI builders):
    pmrmxLast5, pmrmxGetIgnores, pmrmxSetIgnores, pmrmxAddIgnore,
    pmrmxRemoveIgnore, pmrmxKeyMatches, pmrmxIsIgnored, pmrmxCount,
    pmrmxInjectStyle, pmrmxRenderIgnoreList, pmrmxBuildIgnoreUI,
    PMRMX_IGNORE_KEY, PMRMX_CATS, PMRMX_CAT_LABELS,
  };
}
