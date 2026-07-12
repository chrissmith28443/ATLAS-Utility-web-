/* =========================================================================
   ATLAS Utility Web — tools/xmastree.js
   "Christmas Tree" tracker (new in 2.5.5 — no desktop predecessor).

   WHAT IT DOES
     Wendy's Christmas Tree is a single tracker that unions every WMTR across
     the four service areas (SRF / PR / PMCT / WS). Today she types every field
     by hand. This tool lets her drop the four per-service UDQ exports (or fetch
     them from ATLAS) and auto-populates the tracker.

   WHY IT'S A SELF-CONTAINED TOOL (conscious divergence from parity)
     Every other feature loads ONE UDQ, detects ONE type, and drives AppState.
     The Christmas Tree needs FOUR UDQs held together, so it keeps its own
     ingestion buffer (XTree.slots) and never touches loadFile()/AppState/
     detectUdqType. That keeps the single-file pipeline — and every existing
     tool — completely unaffected.

   FIELD MAP / CALC LOGIC
     Transcribed from the Christmas Tree workbook's Instructions tab and the
     live WMTR-tab formulas (the formulas win where the two disagree, per
     sign-off). See ChristmasTree_CalcNotes for the human-readable rationale.

   Multi-WMTR aware: each per-service UDQ may carry many WMTR blocks (record
   row in col A, its Workflow Logs / Daily-update sub-sections beneath it,
   until the next record row) — same block model the PMR reader uses.
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIG — status strings & service signatures (edit here if ATLAS renames).
   ------------------------------------------------------------------------- */
const XT_SERVICES = ["SRF", "PR", "PMCT", "WS"];

/* Column signatures used to auto-classify a dropped UDQ by service area.
   (WMTR suffix alone is unreliable — some exports carry a stale "-SRF".) */
const XT_SERVICE_SIGNATURE = {
  WS:   ["Requested Warehouse Location", "Inventory Requirements"],
  SRF:  ["Pickup Location Organization", "Requested Mode of Transit"],
  PR:   ["Purchasing Instructions"],
  PMCT: ["Government Point Of Contact Authorizing the Release"],
};
// Evaluation order matters (most specific first) so WS/PMCT win over the
// generic PR/SRF signatures.
const XT_SERVICE_ORDER = ["WS", "PMCT", "SRF", "PR"];

/* Exact Workflow-Logs Status strings (case-insensitive match). */
const XT_WFL = {
  qualityReview:      "DTRA Program Review",              // col 12 (see note in calc doc)
  programReview:      "DTRA Program Review (Approved)",   // col 13
  complianceApproved: "DTRA Compliance Review (Approved)",// col 14
  estimateReview:     "DTRA Estimate Review",             // col 20 (oldest) / 26 (revised)
  estimate100k:       "CT Program > 100K Approval (Approved)", // col 22
  estimateApproved:   "DTRA Approved",                    // col 23
  estReviewApproved:  "DTRA Estimate Review (Approved)",  // col 24 (oldest) / 27,28 (revised)
  completed:          "Completed",                        // col 37
  readyToInvoice:     "Ready to Invoice",                 // col 40 (matches "Ready To Invoice")
  invoiced:           "Invoiced",                         // col 43
};

/* Default US-federal-style holiday list (from the workbook's Calculations tab).
   User-editable in the panel; persisted to localStorage. Extend yearly. */
const XT_DEFAULT_HOLIDAYS = [
  "2025-01-13","2025-01-20","2025-02-17","2025-05-26","2025-06-19","2025-07-04",
  "2025-09-01","2025-10-13","2025-11-11","2025-11-27","2025-12-25","2026-01-01",
  "2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03","2026-09-07",
  "2026-10-12","2026-11-11","2026-11-26","2026-12-25","2027-01-01","2027-01-18",
  "2027-02-15","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-10-11",
  "2027-11-11","2027-11-25","2027-12-24","2028-12-31","2028-01-17","2028-02-21",
  "2028-05-29","2028-06-19","2028-07-04","2028-09-04","2028-10-09","2028-11-10",
  "2028-11-23","2028-12-25","2029-01-01","2029-01-15","2029-02-19","2029-05-28",
  "2029-06-19","2029-07-04","2029-09-03","2029-10-08","2029-11-12","2029-11-22",
  "2029-12-25","2030-01-01","2030-01-21","2030-02-18","2030-05-27","2030-06-19",
  "2030-07-04","2030-09-02","2030-10-14","2030-11-11","2030-11-28","2030-12-25",
];
const XT_HOLIDAYS_KEY = "atlas.xmastree.holidays";

/* Column order = the WMTR tab's export order. type drives view/export format.
   id = internal key; label = header text; type ∈ text|date|money|pct|badge. */
const XT_COLUMNS = [
  { id: "request_no",        label: "Request #",                                   type: "text"  },
  { id: "service",           label: "Service",                                     type: "text"  },
  { id: "tti_poc",           label: "TTI POC Name",                                type: "text"  },
  { id: "red_flag",          label: "Red Flag",                                    type: "text", hidden: true },
  { id: "top_required",      label: "TOP Required",                                type: "text"  },
  { id: "current_total_cost",label: "Current Total Cost",                          type: "money" },
  { id: "submitted_date",    label: "Submitted Date",                              type: "date"  },
  { id: "submitted_to_dtra", label: "Submitted to DTRA",                           type: "date"  },
  { id: "original_nlt",      label: "Original NLT Completion Date",                type: "date"  },
  { id: "nlt_completion",    label: "NLT Completion Date (i.e. RDD)",              type: "date"  },
  { id: "current_status",    label: "Current Status",                              type: "text"  },
  { id: "action_required",   label: "Action Required",                             type: "text"  },
  { id: "tti_quality_review",label: "TTI Quality Review Date",                     type: "date"  },
  { id: "dtra_program_review",label: "DTRA Program Review Date",                   type: "date"  },
  { id: "compliance_review", label: "Compliance Review Date",                      type: "date"  },
  { id: "packed_date",       label: "Packed Date",                                 type: "date"  },
  { id: "est_init_due",      label: "Estimate Inititation Due Date",               type: "date"  },
  { id: "est_initiated",     label: "Estimate Initiated Date",                     type: "date"  },
  { id: "est_int_helper",    label: "EST INT HELPER",                              type: "badge" },
  { id: "estimate_due_pr",   label: "Estimate Due Date   (PR ONLY)",              type: "date"  },
  { id: "estimate_submitted",label: "Estimate Submitted Date",                     type: "date"  },
  { id: "pr_est_helper",     label: "PR EST HELPER",                               type: "badge" },
  { id: "est_100k_approved", label: "100K Estimate Approved Date",                 type: "date"  },
  { id: "estimate_approved", label: "Estimate Approved Date",                      type: "date"  },
  { id: "approved_amount",   label: "Approved Amount",                             type: "money" },
  { id: "est_vs_actual",     label: "Estimate vs. Actual %",                       type: "pct"   },
  { id: "rev_est_submitted", label: "Revised Estimate Submitted Date",             type: "date"  },
  { id: "rev_est_approved",  label: "Revised Estimate Approved Date",              type: "date"  },
  { id: "rev_est_amount",    label: "Revised Estimate Amount",                     type: "money" },
  { id: "rev_est_vs_actual", label: "Revised Estimate vs. Actual %",               type: "pct"   },
  { id: "last_activity",     label: "Last Update to Activity Tracker",             type: "date"  },
  { id: "activity_late",     label: "Is Activity Tracker Update Late?",            type: "badge" },
  { id: "po_exec_due",       label: "PO Execution Due Date",                       type: "date"  },
  { id: "po_exec_date",      label: "PO Execution Date",                           type: "date"  },
  { id: "po_helper",         label: "PO HELPER",                                   type: "badge" },
  { id: "delivered",         label: "Delivered or PR-Completed Date",             type: "date"  },
  { id: "rdd_helper",        label: "RDD HELPER",                                  type: "badge" },
  { id: "completed_date",    label: "Completed Date",                              type: "date"  },
  { id: "rti_due",           label: "Ready to Invoice Due Date",                   type: "date"  },
  { id: "tti_rti_due",       label: "TTI Ready to Invoice Due Date",               type: "date"  },
  { id: "rti_date",          label: "Ready to Invoice Date",                       type: "date"  },
  { id: "invoiced_due",      label: "Invoiced Due Date",                           type: "date"  },
  { id: "tti_invoiced_due",  label: "TTI Invoiced Due Date",                       type: "date"  },
  { id: "invoiced_date",     label: "Invoiced Date",                               type: "date"  },
  { id: "invoiced_amount",   label: "Invoiced Amount",                             type: "money" },
  { id: "var_helper",        label: "10Var Helper",                                type: "badge" },
  { id: "rejected",          label: "Was request rejected during/after Compliance Review?", type: "text" },
  { id: "comments",          label: "Comments",                                    type: "text"  },
];

/* -------------------------------------------------------------------------
   STATE — the four-slot ingestion buffer + view options.
   ------------------------------------------------------------------------- */
const XTree = {
  slots: { SRF: null, PR: null, PMCT: null, WS: null }, // {fileName, records:[...]}
  view: "table",         // "table" | "stack"
  filter: "ALL",         // "ALL" | a service
  sort: "wmtr",          // "wmtr" | "service"
  issuesOnly: false,     // show only rows that have issues
  activeMode: "hidden",  // active/undelivered records: "hidden" | "bottom" | "only"
  grouping: "flat",      // delivered/completed body: "flat" | "quarter" (FY-quarter groups)
  // Reporting window defaults to the current fiscal half, same as the Metrics/PMR date
  // picker (mxCurrentHalfDefault). Scopes the tracker by delivery/completed date.
  window: (typeof mxCurrentHalfDefault === "function"
    ? (function () { const q = mxCurrentHalfDefault().quick; const r = xtWindowRange(q); return { quick: q, start: r.start || null, end: r.end || null, label: xtWindowLabel(q, r.start, r.end) }; })()
    : { quick: "all", start: null, end: null, label: "All time" }),
  rollupDrill: null,     // {metric, quarter} — which rollup cell is expanded, or null
  rollupExtraOpen: false, // is the "not scored by ATLAS" (pending + not-tracked) list expanded?
  windowPickerOpen: false, // is the manual date-range picker expanded? (primary selection is via the rollup quarters)
  status: "",
  statusErr: false,
};

/* Manual ignore list: request# -> array of metric keys (or ["*"] for all).
   Persisted to the browser so a user's suppressions carry across sessions. */
const XT_IGNORES_KEY = "atlas.xmastree.ignores";
const XT_METRIC_LABELS = {
  "*": "All metrics",
  delivery: "Delivery / RDD",
  rti: "Ready to Invoice",
  invoiced: "Invoiced",
  estimate_pr: "Estimate (PR)",
  activity: "Activity update",
  variance_est: "Estimate variance",
  variance_rev: "Revised-estimate variance",
  rejected: "Rejected",
  docs: "Shipping Documents Attached to WMTR",
  manual: "Manually-entered Metrics",
};
function xtGetIgnores() {
  try { const o = JSON.parse(localStorage.getItem(XT_IGNORES_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
function xtSetIgnores(obj) {
  try { localStorage.setItem(XT_IGNORES_KEY, JSON.stringify(obj)); } catch (e) { /* storage off */ }
}
function xtAddIgnore(requestNo, metric) {
  const ig = xtGetIgnores();
  const list = new Set(ig[requestNo] || []);
  if (metric === "*") { ig[requestNo] = ["*"]; }
  else { list.add(metric); ig[requestNo] = Array.from(list).filter((m) => m !== "*"); }
  xtSetIgnores(ig);
}
function xtRemoveIgnore(requestNo, metric) {
  const ig = xtGetIgnores();
  if (!ig[requestNo]) return;
  if (!metric) { delete ig[requestNo]; }
  else { ig[requestNo] = ig[requestNo].filter((m) => m !== metric); if (!ig[requestNo].length) delete ig[requestNo]; }
  xtSetIgnores(ig);
}

/** One-shot: a WMTR to scroll to + flash on the next table render (from a flag chip). */
let xtPendingFocus = null;

/* ---- Reporting window (mirrors the Metrics/PMR date picker; FY starts Oct 1) ----
   Scopes the tracker by Date Submitted so in-progress WMTRs stay visible (unlike
   the Metrics dashboard, which windows on Delivery Date). Reuses the shared PMR
   fiscal helpers so the periods line up exactly with the other tools. */
function xtWindowLabel(quick, start, end) {
  switch (quick) {
    case "all": return "All time";
    case "cfy": return "Current FY (FY" + pmrCurrentFiscalYear() + ")";
    case "pfy": return "Previous FY (FY" + (pmrCurrentFiscalYear() - 1) + ")";
    case "cq":  return "Current Qtr \u00b7 " + pmrCurrentQuarterLabel();
    case "pq":  { const i = pmrPreviousQtrInfo(); return "Previous Qtr \u00b7 " + i.qtr + " FY" + i.fy; }
    case "h1":  return "FY" + pmrCurrentFiscalYear() + " First Half";
    case "h2":  return "FY" + pmrCurrentFiscalYear() + " Second Half";
    default:    return (start && end) ? (start + " \u2192 " + end) : "All time";
  }
}
function xtWindowRange(quick) {
  const has = (fn) => typeof fn === "function";
  switch (quick) {
    case "cfy": return has(pmrCurrentFyDates)  ? pmrCurrentFyDates()  : { start: null, end: null };
    case "pfy": return has(pmrPreviousFyDates) ? pmrPreviousFyDates() : { start: null, end: null };
    case "cq":  return has(pmrCurrentQtrDates) ? pmrCurrentQtrDates() : { start: null, end: null };
    case "pq":  return has(pmrPreviousQtrInfo) ? pmrPreviousQtrInfo() : { start: null, end: null };
    case "h1":  return has(pmrFirstHalfDates)  ? pmrFirstHalfDates()  : { start: null, end: null };
    case "h2":  return has(pmrSecondHalfDates) ? pmrSecondHalfDates() : { start: null, end: null };
    default:    return { start: null, end: null };
  }
}
/** A delivered/completed row is in-window if its delivery date (SRF) / completed date
    (PR/PMCT/WS) falls inside [start,end]. Active (undelivered) rows have no such date;
    they're governed by the Active control, not the date window, so they're handled
    separately in xtBuildRows and never filtered here. */
function xtRowInWindow(row) {
  const w = XTree.window;
  if (!w || !w.start || !w.end) return true;
  const d = row.delivered;
  if (!(d instanceof Date)) return false;
  const iso = xtIso(d);
  return w.start <= iso && iso <= w.end;
}

/* -------------------------------------------------------------------------
   DATE UTILITIES
   ------------------------------------------------------------------------- */
const XT_MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

/** Tolerant parse: "M/D/YYYY [h:mm:ss AM]", "D-Mon-YYYY", "YYYY-MM-DD". null if empty/bad. */
function xtParseDate(v) {
  const s = norm(v);
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/))) {           // US M/D/YYYY
    const d = new Date(+m[3], +m[1] - 1, +m[2]);
    return isNaN(d) ? null : d;
  }
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/))) {           // D-Mon-YYYY
    const mo = XT_MONTHS[m[2].toLowerCase()];
    if (mo === undefined) return null;
    const d = new Date(+m[3], mo, +m[1]);
    return isNaN(d) ? null : d;
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {                   // ISO
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  return null;
}

function xtIso(d) {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function xtDayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function xtAddDays(d, n) { if (!d) return null; const x = xtDayStart(d); x.setDate(x.getDate() + n); return x; }
function xtIsWeekend(d) { const g = d.getDay(); return g === 0 || g === 6; }

let _xtHolidaySet = null;
function xtHolidaySet() {
  if (_xtHolidaySet) return _xtHolidaySet;
  _xtHolidaySet = new Set(xtGetHolidays());
  return _xtHolidaySet;
}
function xtIsHoliday(d) { return xtHolidaySet().has(xtIso(d)); }

/** Excel WORKDAY: date `n` working days from start (start excluded), skipping
    weekends and holidays. n may be 0 (returns start). Holidays optional. */
function xtWorkday(start, n, useHolidays) {
  if (!start) return null;
  let d = xtDayStart(start);
  if (n === 0) return d;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d = xtAddDays(d, step);
    if (xtIsWeekend(d)) continue;
    if (useHolidays && xtIsHoliday(d)) continue;
    remaining--;
  }
  return d;
}

/** On-Time / Late badge: blank if either side missing; actual <= due -> On Time. */
function xtOnTimeLate(actual, due) {
  if (!actual || !due) return "";
  return actual.getTime() <= due.getTime() ? "On Time" : "Late";
}

function xtHolidaysStorageLoad() {
  try {
    const raw = localStorage.getItem(XT_HOLIDAYS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
function xtGetHolidays() { return xtHolidaysStorageLoad() || XT_DEFAULT_HOLIDAYS.slice(); }

/** Daily-update gap check over a list of activity-entry dates. Every working day
    (Mon–Fri, excluding holidays) from the first entry through today must have an entry.
    Returns "missed" (a past working day has no entry), "due" (only today's entry is
    outstanding), or "" (no gap, or no entries yet — updates haven't started). */
function xtDailyGap(dates) {
  if (!dates || !dates.length) return "";
  const have = new Set(dates.map((d) => xtIso(d)));
  let start = dates[0];
  for (const d of dates) if (d.getTime() < start.getTime()) start = d;
  const today = xtDayStart(new Date());
  const todayIso = xtIso(today);
  let missedPast = false, dueToday = false;
  for (let day = xtDayStart(start); day.getTime() <= today.getTime(); day = xtAddDays(day, 1)) {
    if (xtIsWeekend(day) || xtIsHoliday(day)) continue;    // weekends/holidays exempt
    if (have.has(xtIso(day))) continue;
    if (xtIso(day) === todayIso) dueToday = true; else missedPast = true;
  }
  return missedPast ? "missed" : (dueToday ? "due" : "");
}
function xtSetHolidays(list) {
  try { localStorage.setItem(XT_HOLIDAYS_KEY, JSON.stringify(list)); } catch (e) { /* storage off */ }
  _xtHolidaySet = null; // invalidate cache
}

/* -------------------------------------------------------------------------
   PARSING — classify a grid, then extract per-WMTR records.
   ------------------------------------------------------------------------- */

/** Guess the service area of a UDQ grid from its column signature. */
function xtClassifyService(grid) {
  const row1 = new Set();
  const maxCol = gridMaxCol(grid);
  for (let c = 1; c <= maxCol; c++) {
    const v = normWs(gridCell(grid, 1, c));
    if (v) row1.add(v);
  }
  for (const svc of XT_SERVICE_ORDER) {
    const sig = XT_SERVICE_SIGNATURE[svc];
    if (sig.every((h) => row1.has(h))) return svc;
  }
  return null;
}

function xtLooksWmtr(v) { return /^WMTR-/i.test(norm(v)); }

/** Trailing service tag on a WMTR: "…-SRF" (hyphen) or "…/PR", "…/PMCT", "…/WS"
    (slash). The delimiter is tolerated either way, so a stray "…-PR" still reads
    as PR. Returns "SRF" | "PR" | "PMCT" | "WS", or null when there's no tag. */
function xtServiceTag(wmtr) {
  const m = norm(wmtr).match(/[-/](SRF|PR|PMCT|WS)\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

/** A UDQ contributes ONLY the WMTRs whose trailing tag matches its own service;
    ATLAS once allowed a WMTR to be listed under several service areas, so the
    stale cross-listings (e.g. a "…/PR" WMTR sitting in the SRF export) are
    ignored — each WMTR number then appears exactly once across the tree.
    Untagged WMTRs carry no service tag; by the same rule they aren't pulled.
    Flip XT_KEEP_UNTAGGED to true to instead attribute an untagged WMTR to the
    file it was found in (note: an untagged number present in multiple files
    would then appear more than once). */
const XT_KEEP_UNTAGGED = false;

/** Strip the trailing service suffix: "…-10097-SRF" / "…-10189/PMCT" -> base. */
function xtStripSuffix(wmtr) {
  return norm(wmtr).replace(/[-/](SRF|PR|PMCT|WS)\s*$/i, "");
}
/** Numeric request number (the 4-6 digits before the suffix) for sorting. */
function xtWmtrNumber(wmtr) {
  const m = norm(wmtr).match(/(\d{4,6})(?:[-/](?:SRF|PR|PMCT|WS))?\s*$/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Read the Workflow Logs block that lives inside [rr, rEnd). Newest-first. */
function xtReadWorkflowLogs(grid, rr, rEnd) {
  let titleRow = 0;
  for (let r = rr; r < rEnd; r++) {
    if (normWs(gridCell(grid, r, 2)).toLowerCase() === "workflow logs") { titleRow = r; break; }
  }
  if (!titleRow) return [];
  // header row is titleRow+1 (Status | Date/Time | User | Rejected Reason | Total Cost)
  const out = [];
  for (let r = titleRow + 2; r < rEnd; r++) {
    const status = norm(gridCell(grid, r, 2));
    if (!status) break;                                   // blank col B -> section ended
    // A new titled sub-section would also sit in col B; stop if it's a known title.
    if (/^(attachment list|inventory list|shipping activity & history|linked request list|activity tracker list|request estimate list|cost list)$/i.test(status)) break;
    out.push({
      status,
      dt: xtParseDate(gridCell(grid, r, 3)),
      user: norm(gridCell(grid, r, 4)),
      reason: norm(gridCell(grid, r, 5)),
      cost: gridCell(grid, r, 6) ? toFloat(gridCell(grid, r, 6)) : null,
    });
  }
  return out;
}

/** Read a WMTR's "Shipping Activity & History" section within [rr,rEnd) and pull
    the tracking fields. Scoped per-record port of udq.js sectionTableValue: find
    the section title, then read header row (title+1) and the single value row
    (title+2). Returns { carrier, awb, tracklink }. */
function xtReadShippingActivity(grid, rr, rEnd) {
  const out = { carrier: "", awb: "", tracklink: "" };
  const maxCol = gridMaxCol(grid);
  for (let r = rr; r < rEnd; r++) {
    let titleCol = 0;
    for (let c = 1; c <= maxCol; c++) {
      if (normWs(gridCell(grid, r, c)).toLowerCase() === "shipping activity & history") { titleCol = c; break; }
    }
    if (!titleCol) continue;
    const headerRow = r + 1, valueRow = r + 2;
    for (let hc = 1; hc <= maxCol; hc++) {
      const h = normWs(gridCell(grid, headerRow, hc)).toLowerCase();
      if (!h) continue;
      const v = norm(gridCell(grid, valueRow, hc));
      if (h === "carrier / freight forwarder") out.carrier = v;
      else if (h === "awb/bol") out.awb = v;
      else if (h === "tracking link") out.tracklink = v;
    }
    return out;
  }
  return out;
}

/** Every activity-history date within [rr,rEnd), for daily-gap detection.
    SRF -> each "Daily Status History" date (col C); PR -> each "Activity Tracker List"
    row whose Stage is "TTI POC Status Check" (Date = col E). PMCT/WS -> [] (no
    daily/periodic update required). Returns Date[]. */
function xtActivityDates(grid, rr, rEnd, service) {
  const out = [];
  if (service === "SRF") {
    for (let r = rr; r < rEnd; r++) {
      if (normWs(gridCell(grid, r, 3)).toLowerCase() === "daily status history") {
        for (let k = r + 2; k < rEnd; k++) {
          if (norm(gridCell(grid, k, 2))) break;           // a new sub-section began
          const d = xtParseDate(gridCell(grid, k, 3));
          if (!d) { if (!norm(gridCell(grid, k, 3)) && !norm(gridCell(grid, k, 4))) continue; break; }
          out.push(d);
        }
        break;
      }
    }
  } else if (service === "PR") {
    for (let r = rr; r < rEnd; r++) {
      if (normWs(gridCell(grid, r, 2)).toLowerCase() === "activity tracker list") {
        for (let k = r + 2; k < rEnd; k++) {
          const grp = norm(gridCell(grid, k, 2));
          if (/^(workflow logs|linked request list|request estimate list|attachment list|inventory list)$/i.test(grp)) break;
          if (normWs(gridCell(grid, k, 4)).toLowerCase() === "tti poc status check") {
            const d = xtParseDate(gridCell(grid, k, 5));
            if (d) out.push(d);
          }
        }
        break;
      }
    }
  }
  return out; // PMCT / WS: no update required -> []
}

/** Most-recent activity date (max of xtActivityDates), or null. */
function xtLastActivityDate(grid, rr, rEnd, service) {
  let best = null;
  for (const d of xtActivityDates(grid, rr, rEnd, service))
    if (!best || d.getTime() > best.getTime()) best = d;
  return best;
}

/** Extract every WMTR record from one service grid. */
function xtParseRecords(grid, service) {
  const shipMap = buildHeaderMap(grid, 1);
  const S = (r, header) => {
    const c = shipMap[normWs(header)];
    return c ? gridCell(grid, r, c) : "";
  };
  const maxRow = gridMaxRow(grid);
  const recRows = [];
  for (let r = 2; r <= maxRow; r++) if (xtLooksWmtr(gridCell(grid, r, 1))) recRows.push(r);

  const records = [];
  const untagged = [];
  for (let i = 0; i < recRows.length; i++) {
    const rr = recRows[i];
    const wmtr = norm(gridCell(grid, rr, 1));

    // Service-tag gate: keep only WMTRs whose trailing tag matches this file's
    // service; drop stale cross-listed rows, and set aside untagged rows (these
    // are deleted records — surfaced in the panel but not pulled into the tree).
    const tag = xtServiceTag(wmtr);
    if (!tag) {
      untagged.push(wmtr);
      if (!XT_KEEP_UNTAGGED) continue;
    } else if (tag !== service) {
      continue;
    }

    const rEnd = i + 1 < recRows.length ? recRows[i + 1] : maxRow + 1;
    records.push({
      service,
      wmtr,
      scalar: {
        ttiPoc:         norm(S(rr, "TTI POC Name")),
        redFlag:        norm(S(rr, "Red Flag")),
        redFlagComments:norm(S(rr, "Red Flag Comments")),
        topRequired:    norm(S(rr, "Transfer of Property (TOP) Required?")),
        totalCost:      S(rr, "Total Cost in USD"),
        dateSubmitted:  S(rr, "Date Submitted"),
        originalRdd:    S(rr, "Original RDD"),
        nltCompletion:  S(rr, "NLT Completion Date"),
        status:         norm(S(rr, "Status")),
        dateCompleted:  S(rr, "Date Completed"),
        deliveryDate:   S(rr, "Delivery Date"),
        // Manually-entered metric flag: repurposes the (DTRA-unused) "DTRA-Only
        // Import/Export Comments" field so a reviewer can flag a WMTR that busted
        // a metric the utility can't detect (e.g. a lost package). Any text here
        // flags the WMTR; the text is shown as the reason.
        manualMetric:   norm(S(rr, "DTRA-Only Import/Export Comments")),
      },
      wfl: xtReadWorkflowLogs(grid, rr, rEnd),
      lastActivity: xtLastActivityDate(grid, rr, rEnd, service),
      activityDates: xtActivityDates(grid, rr, rEnd, service),
      shipping: service === "SRF" ? xtReadShippingActivity(grid, rr, rEnd) : { carrier: "", awb: "", tracklink: "" },
    });
  }
  return { records, untagged };
}

/** Aggregate every no-service-tag WMTR found across the loaded UDQs, de-duped by
    number, with the file(s) it appeared in. These are skipped (deleted records);
    the panel exposes them via a small icon so they can be eyeballed. */
function xtUntaggedList() {
  const map = {};
  for (const svc of XT_SERVICES) {
    const slot = XTree.slots[svc];
    if (!slot || !slot.untagged) continue;
    for (const w of slot.untagged) {
      const key = w.toUpperCase();
      (map[key] = map[key] || { wmtr: w, files: [] }).files.push(svc);
    }
  }
  return Object.values(map).sort((a, b) => xtWmtrNumber(a.wmtr) - xtWmtrNumber(b.wmtr));
}

/* -------------------------------------------------------------------------
   CALC ENGINE — turn one record into the 47-column tracker row.
   ------------------------------------------------------------------------- */
function xtBoolYesNo(v) {
  const s = norm(v).toLowerCase();
  if (s === "true" || s === "yes") return "Yes";
  if (s === "false" || s === "no") return "No";
  return "";
}
function xtActionFromStatus(status) {
  const s = norm(status);
  const low = s.toLowerCase();
  if (/review/i.test(s)) return "Approve/Reject";
  if (low === "invoiced" || low === "canceled" || low === "cancelled") return "Archive Record";
  if (low === "deleted") return "Deleted";
  if (low === "ready to invoice") return "TTI Closeout";
  if (low === "tti estimate preparation") return "TTI Prepare & Submit Estimate";
  return "TTI Execution";
}
function xtPct(numeratorRatio) { return numeratorRatio; }  // stored as ratio; formatted 0.0%

function xtBuildRow(rec) {
  const sc = rec.scalar;
  const wfl = rec.wfl; // newest-first
  const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
  const withStatus = (name) => wfl.filter((e) => eq(e.status, name));
  const mostRecent = (name) => { const m = withStatus(name); return m.length ? m[0].dt : null; };
  const oldest = (name) => { const m = withStatus(name); return m.length ? m[m.length - 1].dt : null; };
  const oldestCost = (name) => { const m = withStatus(name); return m.length ? m[m.length - 1].cost : null; };

  const currentTotalCost = sc.totalCost ? toFloat(sc.totalCost) : null;
  const complianceReview = mostRecent(XT_WFL.complianceApproved);
  const nltCompletion = xtParseDate(sc.nltCompletion);
  // Delivered/PR-Completed: SRF uses Delivery Date; PR/PMCT/WS use Date Completed.
  // (In QA the SRF Delivery Date is sparsely populated; production is complete.)
  const delivered = rec.service === "SRF" ? xtParseDate(sc.deliveryDate) : xtParseDate(sc.dateCompleted);
  const estimateApproved = mostRecent(XT_WFL.estimateApproved);
  const approvedAmount = oldestCost(XT_WFL.estReviewApproved);

  // Packed / Estimate-Initiated / PO-Execution / Invoiced-Amount are not in the UDQ.
  const packedDate = null;
  const estInitiated = null;
  const poExecDate = null;
  const invoicedAmount = null;

  // Est Init Due = WORKDAY(MAX(ComplianceReview, Packed), 1)  [no holidays, per formula]
  let estInitDue = null;
  if (complianceReview || packedDate) {
    const base = [complianceReview, packedDate].filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    estInitDue = xtWorkday(base, 1, false);
  }

  // Estimate Due (PR only) = WORKDAY(ComplianceReview, 3, holidays)
  const estimateDuePr = (rec.service === "PR" && complianceReview)
    ? xtWorkday(complianceReview, 3, true) : null;

  const estimateSubmitted = oldest(XT_WFL.estimateReview);

  // Revised estimate: only when 2+ instances exist.
  const revReviews = withStatus(XT_WFL.estimateReview);
  const revEstSubmitted = revReviews.length >= 2 ? revReviews[0].dt : null;
  const revApproved = withStatus(XT_WFL.estReviewApproved);
  const revEstApproved = revApproved.length >= 2 ? revApproved[0].dt : null;
  const revEstAmount   = revApproved.length >= 2 ? revApproved[0].cost : null;

  const ratio = (amount) => {
    // A zero (or blank) approved cost is treated the same as "no cost captured"
    // and is not scored — cost wasn't being recorded at that point in the
    // workflow. currentTotalCost of 0 keeps the IFERROR(...,0) behavior.
    if (!amount || currentTotalCost == null) return "";
    if (currentTotalCost === 0) return 0;                 // IFERROR(...,0)
    return xtPct(1 - amount / currentTotalCost);
  };
  // Estimate vs. actual variance. "DTRA Estimate Review (Approved)" and
  // "DTRA Approved" are the same event/date, so we key off the approved COST
  // rather than an approval-status date: PRs never carry a "DTRA Approved" stamp,
  // yet they do carry the Estimate-Review-(Approved) amount. ratio() returns ""
  // when there's no approved amount (e.g. an approved stamp from before cost was
  // captured), so those records are simply not scored. Actual cost = current
  // Total Cost until invoiced amounts land in the UDQ (invoiced never exceeds it).
  const estVsActual = ratio(approvedAmount);
  const revEstVsActual = ratio(revEstAmount);

  // Is Activity Tracker Update Late? SRF (daily) and PR (TTI POC Status Check) only.
  // A daily update is expected every working day (holidays/weekends exempt) from the
  // first daily-history entry onward. Any missing past working day -> "missed"; only
  // today's entry still outstanding -> "due". No entries yet -> nothing (can't know
  // when updates should have started). Only evaluated while the request is active.
  const activityGap = ((rec.service === "SRF" || rec.service === "PR") && !delivered)
    ? xtDailyGap(rec.activityDates) : "";
  const activityLate = activityGap === "missed" ? "Yes" : "";

  // PO Execution Due (PR) = WORKDAY(EstimateApproved, 1)  [no holidays, per formula]
  const poExecDue = (rec.service === "PR" && estimateApproved)
    ? xtWorkday(estimateApproved, 1, false) : null;

  const readyToInvoiceDate = mostRecent(XT_WFL.readyToInvoice);
  const invoicedDate = mostRecent(XT_WFL.invoiced);

  const rtiDue = delivered ? xtWorkday(delivered, 30, true) : null;
  const ttiRtiDue = delivered ? xtAddDays(delivered, 15) : null;
  const invoicedDue = delivered ? xtWorkday(delivered, 45, true) : null;
  let ttiInvoicedDue = null;
  if (eq(sc.status, "Cancelled with Costs")) ttiInvoicedDue = xtAddDays(readyToInvoiceDate, 30);
  else if (delivered) ttiInvoicedDue = xtAddDays(delivered, 30);

  // 10Var Helper (invoiced amount is placeholder -> blank)
  let varHelper = "";
  if (invoicedAmount != null) {
    varHelper = (invoicedAmount > (approvedAmount || 0) * 1.1 && invoicedAmount > (revEstAmount || 0) * 1.1)
      ? "Over" : "On Budget";
  }

  // Rejected flag + reason -> Comments (per sign-off decision #3/#6)
  const rejectedEntries = wfl.filter((e) => /reject/i.test(e.status));
  const rejected = rejectedEntries.length ? "Yes" : "";
  const rejectReason = rejectedEntries.length ? rejectedEntries[0].reason : "";

  return {
    request_no:         xtStripSuffix(rec.wmtr),
    wmtr_full:          rec.wmtr,
    service:            rec.service,
    reject_reason:      rejectReason,
    tracking_carrier:   (rec.shipping && rec.shipping.carrier) || "",
    tracking_awb:       (rec.shipping && rec.shipping.awb) || "",
    tracking_link:      (rec.shipping && rec.shipping.tracklink) || "",
    tti_poc:            sc.ttiPoc,
    red_flag:           /^true$/i.test(sc.redFlag) ? sc.redFlagComments : "",
    top_required:       xtBoolYesNo(sc.topRequired),
    current_total_cost: currentTotalCost,
    submitted_date:     xtParseDate(sc.dateSubmitted),
    submitted_to_dtra:  oldest(XT_WFL.qualityReview),
    original_nlt:       xtParseDate(sc.originalRdd),
    nlt_completion:     nltCompletion,
    current_status:     sc.status,
    action_required:    xtActionFromStatus(sc.status),
    tti_quality_review: mostRecent(XT_WFL.qualityReview),
    dtra_program_review:mostRecent(XT_WFL.programReview),
    compliance_review:  complianceReview,
    packed_date:        packedDate,
    est_init_due:       estInitDue,
    est_initiated:      estInitiated,
    est_int_helper:     xtOnTimeLate(estInitiated, estInitDue),
    estimate_due_pr:    estimateDuePr,
    estimate_submitted: estimateSubmitted,
    pr_est_helper:      xtOnTimeLate(estimateSubmitted, estimateDuePr),
    est_100k_approved:  mostRecent(XT_WFL.estimate100k),
    estimate_approved:  estimateApproved,
    approved_amount:    approvedAmount,
    est_vs_actual:      estVsActual,
    rev_est_submitted:  revEstSubmitted,
    rev_est_approved:   revEstApproved,
    rev_est_amount:     revEstAmount,
    rev_est_vs_actual:  revEstVsActual,
    last_activity:      rec.lastActivity,
    activity_late:      activityLate,
    activity_gap:       activityGap,
    po_exec_due:        poExecDue,
    po_exec_date:       poExecDate,
    po_helper:          xtOnTimeLate(poExecDate, poExecDue),
    delivered:          delivered,
    rdd_helper:         rec.service === "SRF" ? xtOnTimeLate(delivered, nltCompletion) : "",
    // "Completed Date" column: PR/PMCT/WS use the Date Completed field (the workflow
    // "Completed" stamp is system-generated and often lags the real completion, so it
    // isn't a reliable reference). SRF has no separate completion date \u2014 its Delivery
    // Date is the completion \u2014 so it's left blank.
    completed_date:     rec.service === "SRF" ? null : delivered,
    rti_due:            rtiDue,
    tti_rti_due:        ttiRtiDue,
    rti_date:           readyToInvoiceDate,
    invoiced_due:       invoicedDue,
    tti_invoiced_due:   ttiInvoicedDue,
    invoiced_date:      invoicedDate,
    invoiced_amount:    invoicedAmount,
    var_helper:         varHelper,
    rejected:           rejected,
    comments:           rejectReason ? `[Auto] Rejection: ${rejectReason}` : "",
    manual_metric:      rec.scalar.manualMetric || "",
  };
}

/** All loaded records -> tracker rows, sorted + filtered per XTree.view opts. */
function xtBuildRows() {
  let recs = [];
  for (const svc of XT_SERVICES) {
    const slot = XTree.slots[svc];
    if (slot && slot.records) recs = recs.concat(slot.records);
  }
  // Identity = service + request #. WMTR numbers are unique per service, so this
  // only ever drops a true duplicate within one service export (never a
  // legitimate same-number row that lives in a different service area).
  const seen = new Set();
  const rows = [];
  for (const rec of recs) {
    const row = xtBuildRow(rec);
    const key = row.service + "|" + row.request_no;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  let all = rows;
  if (XTree.filter !== "ALL") { const f = XTree.filter; all = all.filter((r) => r.service === f); }
  // Split active/undelivered from delivered/completed. The date window scopes only the
  // delivered set (by delivery/completed date). Active rows are never windowed — they're
  // governed by the Active control (hidden / bottom / only) and always sort by WMTR.
  const byNum = (a, b) => xtWmtrNumber(a.request_no) - xtWmtrNumber(b.request_no);
  const active = all.filter((r) => !r.delivered).slice().sort(byNum);
  let delivered = all.filter((r) => r.delivered);
  if (XTree.window && XTree.window.start && XTree.window.end) delivered = delivered.filter(xtRowInWindow);
  delivered = xtSortRows(delivered);
  const mode = XTree.activeMode || "hidden";
  if (mode === "only") return active;
  return mode === "bottom" ? delivered.concat(active) : delivered;
}
function xtSortRows(rows) {
  const byNum = (a, b) => xtWmtrNumber(a.request_no) - xtWmtrNumber(b.request_no);
  if (XTree.sort === "service") {
    const ord = { SRF: 0, PR: 1, PMCT: 2, WS: 3 };
    return rows.slice().sort((a, b) => (ord[a.service] - ord[b.service]) || byNum(a, b));
  }
  return rows.slice().sort(byNum);
}

/* -------------------------------------------------------------------------
   ISSUE DETECTION — the whole point: surface missed / late metrics.
   Mirrors the tracker's conditional formatting, but only for metrics ATLAS
   actually supplies (placeholder columns can't be "missed", so they're never
   flagged — that avoids lighting up every row with false positives).

   kind: "missing" (a due date has passed but the value is still blank),
         "late"    (the value exists but landed after its due date),
         "variance"(estimate vs actual off by >=10%),
         "flag"    (rejected during/after review),
         "due"     (an open Ready-to-Invoice / Invoiced milestone coming due soon).
   Each issue names the column it belongs to + a short human label.
   ------------------------------------------------------------------------- */
// How many days ahead counts as "coming due" for the Ready-to-Invoice / Invoiced
// reminders. Open milestones only; tune here.
const XT_DUE_SOON_DAYS = 7;
function xtRowIssues(row) {
  const today = xtDayStart(new Date());
  const isD = (v) => v instanceof Date;
  const past = (v) => isD(v) && v.getTime() < today.getTime();
  const soonCut = today.getTime() + XT_DUE_SOON_DAYS * 86400000;
  const dueSoon = (v) => isD(v) && v.getTime() >= today.getTime() && v.getTime() <= soonCut;
  const out = [];
  const add = (metric, col, kind, label) => out.push({ metric, col, kind, label });

  // Delivery vs RDD — SRF only. This is the "NLT vs. Actual Delivery Timeliness"
  // shipping metric; PR/WS/PMCT have no delivery-vs-RDD concept, only a completion date,
  // so they're never flagged here (see rdd_helper, also SRF-only). An undelivered SRF
  // record past its RDD is NOT flagged: the RDD is normally approved to move to the
  // eventual delivery date. A hit is only an SRF record delivered later than its
  // (un-adjusted) RDD — delivered late without the RDD being moved.
  if (row.service === "SRF" && isD(row.delivered) && isD(row.nlt_completion) && row.delivered.getTime() > row.nlt_completion.getTime())
    add("delivery", "delivered", "late", "Delivered after RDD");

  // Ready to Invoice / Invoiced. Only *actionable* states are flagged: the milestone
  // is still open (no date yet) and is either coming due or already past due. A
  // completed milestone is never flagged \u2014 even if it landed late, there's nothing to
  // be done once it's happened \u2014 and once the record has been Invoiced it's closed, so
  // neither target is flagged.
  if (!isD(row.invoiced_date)) {
    if (!isD(row.rti_date)) {
      if (past(row.rti_due)) add("rti", "rti_date", "yellow", "Ready-to-Invoice past due");
      else if (dueSoon(row.rti_due)) add("rti", "rti_date", "due", "Ready-to-Invoice due soon");
    }
    if (past(row.invoiced_due)) add("invoiced", "invoiced_date", "yellow", "Invoicing past due");
    else if (dueSoon(row.invoiced_due)) add("invoiced", "invoiced_date", "due", "Invoicing due soon");
  }

  // Estimate (PR)
  if (row.service === "PR" && past(row.estimate_due_pr) && !isD(row.estimate_submitted))
    add("estimate_pr", "estimate_submitted", "missing", "Estimate overdue (PR)");
  else if (row.pr_est_helper === "Late")
    add("estimate_pr", "estimate_submitted", "late", "Estimate submitted late (PR)");

  // Activity tracker (SRF daily / PR TTI POC Status Check). A missed past working day
  // is a hard flag; only today's entry still outstanding is a soft "due" reminder.
  if (row.activity_gap === "missed")
    add("activity", "last_activity", "missing",
        row.service === "PR" ? "TTI POC Status Check missed" : "Daily update missed");
  else if (row.activity_gap === "due")
    add("activity", "last_activity", "due",
        row.service === "PR" ? "TTI POC Status Check due today" : "Daily update due today");

  // Cost variance. Two regimes:
  //  - Active (undelivered): flag only once DTRA has approved an amount and the current
  //    total cost has climbed above it \u2014 that's the signal to seek reapproval. Requests
  //    with no approved amount yet (still in TTI/DTRA review) have a cost but nothing to
  //    compare against, so they don't flag.
  //  - Delivered/completed: the estimate-vs-actual accuracy check (>=10% either way).
  if (!isD(row.delivered)) {
    if (typeof row.approved_amount === "number" && typeof row.current_total_cost === "number"
        && row.current_total_cost > row.approved_amount)
      add("variance_est", "current_total_cost", "variance", "Cost exceeds DTRA-approved amount \u2014 reapproval needed");
  } else {
    if (typeof row.est_vs_actual === "number" && Math.abs(row.est_vs_actual) >= 0.10)
      add("variance_est", "est_vs_actual", "variance", "Estimate vs actual off by \u226510%");
    if (typeof row.rev_est_vs_actual === "number" && Math.abs(row.rev_est_vs_actual) >= 0.10)
      add("variance_rev", "rev_est_vs_actual", "variance", "Revised estimate vs actual off by \u226510%");
  }

  // Rejected during/after review
  if (row.rejected === "Yes")
    add("rejected", "current_status", "flag", "Rejected during/after review");

  // Manually-entered metric (SRF): any text in the repurposed DTRA-Only field
  // flags the WMTR; the text is the reason. Not tied to a column, so it shows in
  // the Issues panel / row shading only.
  if (row.service === "SRF" && norm(row.manual_metric))
    add("manual", null, "flag", "Manually flagged: " + norm(row.manual_metric));

  return out;
}

/** Per-WMTR shipping-documents status for the SRF records the rollup SCORES
    (delivered, not relieved, not hand-carry, classifiable). Returns
    { strippedWMTR: { missing:[labels] } } for records missing required docs.
    Mirrors the reqatt-sourced "docs" metric in xtBuildRollup exactly so the
    per-row tracker flag lines up with the rollup. This never changes the rollup
    score or any export — it only lets the tracker show (and ignore) the flag. */
function xtDocsIssueMap() {
  const out = {};
  const srfSlot = XTree.slots.SRF;
  const grid = srfSlot && srfSlot.grid ? srfSlot.grid : null;
  if (!grid || typeof reqattParseUdq !== "function" || typeof _raEvaluate !== "function") return out;
  let blocks = [];
  try { blocks = reqattParseUdq(grid) || []; } catch (e) { return out; }
  for (const blk of blocks) {
    const f = blk.fields || {};
    const wmtr = norm(f["WMTR Number"]);
    const dIso = xtIsoStr(f["Delivery Date"]);
    if (!dIso) continue;                                   // not delivered -> not scored
    if (typeof pmrSrfRelieved === "function" && pmrSrfRelieved(wmtr, dIso)) continue; // relieved
    if (norm(f["Identify Shipment As"]).toLowerCase() === "hand carry") continue;     // hand-carry skipped
    const origin = norm(f["Country of Origin"]), dest = norm(f["Country of Destination"]);
    const cat = (typeof _raShipmentCategory === "function") ? _raShipmentCategory(origin, dest) : "UNKNOWN";
    if (cat === "UNKNOWN") continue;                       // unclassifiable -> not scored
    const ev = _raEvaluate(cat, blk.attachment_types || [], origin,
      (typeof _raIsCourier === "function") ? _raIsCourier(f["Identify Shipment As"]) : false);
    if (ev && ev.missing && ev.missing.length) out[xtStripSuffix(wmtr)] = { missing: ev.missing };
  }
  return out;
}

/** Attach .issues + .issueByCol to each row (in place) and return the rows.
    Honors the manual ignore list (request# -> metric keys / "*") and the shared
    Oct-1 SRF relief. A relieved SRF record (delivered before Oct 1, 2025 — except
    WMTR 10095) is out of the measurement window entirely, so it isn't flagged in the
    tracker / Issues Only at all — not for metric flags (delivery, daily activity, cost
    variance, QC/rejected) nor for the operational milestones (Ready-to-Invoice,
    Invoiced). These are the same records the rollup drops from metric scoring. */
function xtAnnotateIssues(rows) {
  const ig = xtGetIgnores();
  const docsMap = xtDocsIssueMap();
  for (const row of rows) {
    let raw = xtRowIssues(row);
    const dIso = row.delivered ? xtIso(row.delivered) : null;
    if (typeof pmrSrfRelieved === "function" &&
        pmrSrfRelieved(row.wmtr_full, row.service === "SRF" ? dIso : null))
      raw = [];                                              // relieved -> fully historical
    // Shipping-documents metric (SRF only) — surfaced as a per-WMTR flag so it can
    // be seen and ignored like every other metric. No column of its own, so it
    // shades the row and shows in the Issues panel; the rollup score is untouched.
    if (row.service === "SRF") {
      const d = docsMap[row.request_no];
      if (d && d.missing.length)
        raw.push({ metric: "docs", col: null, kind: "missing", label: "Shipping documents missing" });
    }
    const supp = ig[row.request_no];
    row.issues = supp ? raw.filter((i) => !(supp.includes("*") || supp.includes(i.metric))) : raw;
    row.issueByCol = {};
    for (const iss of row.issues) {
      if (!iss.col) continue;                                // col-less (docs) -> row/panel only, no cell tint
      // keep the most severe per cell: missing/flag > late > variance
      const rank = { due: 1, variance: 1, yellow: 2, late: 2, missing: 3, flag: 3 };
      const cur = row.issueByCol[iss.col];
      if (!cur || rank[iss.kind] > rank[cur.kind]) row.issueByCol[iss.col] = iss;
    }
  }
  return rows;
}

/** Group all issues across the given rows by metric label -> WMTR list. */
function xtCollectIssues(rows) {
  const groups = {};
  let flaggedRows = 0;
  for (const row of rows) {
    if (row.issues && row.issues.length) flaggedRows++;
    for (const iss of (row.issues || [])) {
      const g = groups[iss.label] || (groups[iss.label] = { label: iss.label, kind: iss.kind, metric: iss.metric, wmtrs: [] });
      g.wmtrs.push({ request_no: row.request_no, service: row.service });
    }
  }
  const order = { missing: 0, late: 1, flag: 2, yellow: 3, variance: 4, due: 5 };
  const list = Object.values(groups).sort((a, b) =>
    (order[a.kind] - order[b.kind]) || b.wmtrs.length - a.wmtrs.length);
  const total = list.reduce((n, g) => n + g.wmtrs.length, 0);
  return { list, total, flaggedRows };
}

/* =========================================================================
   PMR METRIC ROLLUP — the reportable dashboard.

   Every scored line reuses the SAME calculation the PMR / ReqAtt tools use, so
   the tracker can never report a number those tools wouldn't:
     • delivery + daily  -> pmrRun() per fiscal quarter, on the retained SRF grid
     • shipping documents -> ReqAtt _raEvaluate() per SRF record (same category
                             rules, courier/hand-carry handling included)
     • the rest          -> the tracker's own per-record signals (row fields)

   SRF metrics honor the shared Oct-1 relief (pmrSrfRelieved — WMTR 10095 scored).
   Records bucket by fiscal quarter of Delivery Date (SRF) / Date Completed
   (others), per the agreed rule. RYG uses the PMR deck's per-metric thresholds.
   Placeholder metrics whose ATLAS fields don't exist yet are listed, not scored.
   ========================================================================= */
// The AWB/BoL tracking field was added to ATLAS in Feb 2026; deliveries before this
// date are relieved from the tracking metric (see the "tracking" metric's elig).
const XT_TRACKING_CUTOFF_ISO = "2026-03-01";
const XT_ROLLUP_METRICS = [
  { key: "delivery", svc: "SRF", src: "pmr_delivery",
    label: "NLT vs. Actual Delivery Timeliness", green: 0.95, yellow: 0.90 },
  { key: "daily", svc: "SRF", src: "pmr_daily",
    label: "Near-Real-Time WMTR Status Updates (daily)", green: 1.00, yellow: 0.95 },
  { key: "qc", svc: "SRF", src: "row",
    label: "WMTR QC Issues (rejected in/after Compliance Review)", green: 0.95, yellow: 0.90,
    elig: () => true, pass: (r) => r.rejected !== "Yes",
    failReason: (r) => r.reject_reason ? ("Rejected: " + r.reject_reason) : "Rejected during/after Compliance Review" },
  { key: "docs", svc: "SRF", src: "reqatt",
    label: "Shipping Documents Attached to WMTR", green: 1.00, yellow: 0.99 },
  { key: "tracking", svc: "SRF", src: "row",
    label: "Shipment Tracking Details Input (AWB/BoL)", green: 0.98, yellow: 0.95,
    // The AWB/BoL field was added to ATLAS in Feb 2026, so deliveries before Mar 2026
    // can't be held to it — they're relieved (not scored) for this metric.
    elig: (r) => !!r.delivered && xtIso(r.delivered) >= XT_TRACKING_CUTOFF_ISO,
    pass: (r) => !!r.tracking_awb,
    failReason: () => "No value in the AWB/BoL field" },
  { key: "cost_srf", svc: "SRF", src: "row",
    label: "SRF Cost Estimate Accuracy (\u226410%)", green: 0.95, yellow: 0.90,
    elig: (r) => typeof r.est_vs_actual === "number", pass: (r) => Math.abs(r.est_vs_actual) < 0.10,
    failReason: (r) => "Estimate vs. actual off by " + Math.round(Math.abs(r.est_vs_actual) * 100) + "%" },
  // Manually-entered metric: a reviewer flags a WMTR by putting text in the
  // (DTRA-unused) "DTRA-Only Import/Export Comments" field. Any text = a bust
  // the utility can't otherwise detect (e.g. a lost package); the text is the
  // reason. green/yellow at 1.00 so a single flag turns the metric red.
  { key: "manual", svc: "SRF", src: "row",
    label: "Manually-entered Metrics", green: 1.00, yellow: 1.00,
    elig: () => true, pass: (r) => !norm(r.manual_metric),
    failReason: (r) => norm(r.manual_metric) || "Manually flagged" },
  { key: "pr_estimate", svc: "PR", src: "row",
    label: "PR Cost Estimate Submitted \u22643 Business Days", green: 1.00, yellow: 0.95,
    elig: (r) => r.pr_est_helper === "On Time" || r.pr_est_helper === "Late",
    pass: (r) => r.pr_est_helper === "On Time",
    failReason: () => "Estimate submitted after 3-business-day due date" },
  { key: "cost_pr", svc: "PR", src: "row",
    label: "PR Cost Estimate Accuracy (\u226410%)", green: 0.95, yellow: 0.90,
    elig: (r) => typeof r.est_vs_actual === "number", pass: (r) => Math.abs(r.est_vs_actual) < 0.10,
    failReason: (r) => "Estimate vs. actual off by " + Math.round(Math.abs(r.est_vs_actual) * 100) + "%" },
];
// Date-comparison metrics we would score today if ATLAS captured one missing
// timestamp. Rendered as their own rows so Wendy can see exactly which field is the
// blocker; they'll move up into the scored set once the field is added to the UDQ.
const XT_ROLLUP_PENDING = [
  { label: "Transportation quote & plan \u22641 business day of completed WMTR", svc: "SRF",
    why: "Awaiting ATLAS field: date the transportation quote/plan was delivered (to compare against WMTR completion date)" },
  { label: "Procurement purchased \u22641 business day of Gov\u2019t Approval", svc: "PR",
    why: "Awaiting ATLAS field: purchase / PO execution date (to compare against Government Approval date)" },
];

// Every other WMTR (SRF / PR / WS) metric on the PMR deck that ATLAS can't answer from
// the UDQ today. Surveillance for these is inspection-, file-review-, or contractor-
// reporting-based, so there is no date or field in the export to compute against.
// Listed to acknowledge the metric exists; tracking any of these in ATLAS would require
// new data fields to be added.
const XT_ROLLUP_UNTRACKED = [
  { label: "Shipment indicator violations (temp-sensitive, perishable, shock, orientation)", svc: "SRF", why: "Contractor reporting / program feedback \u2014 no UDQ field" },
  { label: "Use of pre-solicited freight rates, posted in ATLAS", svc: "SRF", why: "File review \u2014 no UDQ field" },
  { label: "Customs clearances free of VAT, taxes, levies & fees", svc: "SRF", why: "File review / system query \u2014 no UDQ field" },
  { label: "Export-Controlled Materials: handling, marking, accountability", svc: "SRF", why: "Periodic inspection \u2014 no UDQ field" },
  { label: "HAZMAT identification, marking & handling (receipt \u2192 delivery)", svc: "SRF", why: "Periodic inspection \u2014 no UDQ field" },
  { label: "Environmental, Safety & Occupational Health (ESOH) compliance", svc: "SRF", why: "Significant Incident Report CDRL \u2014 no UDQ field" },
  { label: "Accurate customs clearance filings", svc: "SRF", why: "File review \u2014 no UDQ field" },
  { label: "Packaging for international transport per best practices", svc: "SRF", why: "Periodic inspection \u2014 no UDQ field" },
  { label: "Lost or damaged cargo", svc: "SRF", why: "Contractor reporting \u2014 no UDQ field" },
  { label: "Warehouse material receipt status update \u22641 business day", svc: "WS", why: "Needs warehouse receipt + status-update timestamps \u2014 no UDQ field" },
  { label: "Capability to source procurements internationally & locally/regionally", svc: "PR", why: "Invoice / inspection review \u2014 no UDQ field" },
  { label: "Shipment consolidation efficiency", svc: "SRF", why: "Metric eliminated 12 Feb 2026 (no longer measured)" },
];

const XT_QORD = { "1st Qtr": 1, "2nd Qtr": 2, "3rd Qtr": 3, "4th Qtr": 4 };
function xtIsoStr(v) { const d = xtParseDate(v); return d ? xtIso(d) : ""; }

/** All loaded records -> built rows, WITHOUT the UI window/filter (the rollup
    has its own fiscal-quarter columns). Deduped by service + request #. */
function xtRollupRows() {
  let recs = [];
  for (const svc of XT_SERVICES) { const s = XTree.slots[svc]; if (s && s.records) recs = recs.concat(s.records); }
  const seen = new Set(), rows = [];
  for (const rec of recs) {
    const row = xtBuildRow(rec);
    const k = row.service + "|" + row.request_no;
    if (seen.has(k)) continue;
    seen.add(k); rows.push(row);
  }
  return rows;
}

/** Compute the per-metric, per-fiscal-quarter rollup. Returns:
    { quarters:[{key,fy,qtr,start,end}], metrics:[{def,cells:{qkey:{pass,total}},tot}],
      pending, untracked, srfGrid:bool, generatedAt } */
function xtBuildRollup() {
  const rows = xtRollupRows();
  const srfSlot = XTree.slots.SRF;
  const srfGrid = srfSlot && srfSlot.grid ? srfSlot.grid : null;

  // Fiscal quarters present in the data (by each row's bucket date).
  const qmap = {};
  const addQ = (iso) => {
    const q = iso && typeof pmrFyQuarterOf === "function" ? pmrFyQuarterOf(iso) : null;
    if (!q || qmap[q.key]) return;
    const [start, end] = pmrQuarterDates(q.fy, q.qtr);
    qmap[q.key] = { key: q.key, fy: q.fy, qtr: q.qtr, start, end, order: q.fy * 10 + XT_QORD[q.qtr] };
  };
  for (const r of rows) if (r.delivered) addQ(xtIso(r.delivered));
  const quarters = Object.values(qmap).sort((a, b) => a.order - b.order);

  const metrics = XT_ROLLUP_METRICS.map((m) => ({ def: m, cells: {}, tot: { pass: 0, total: 0, fails: [] } }));
  const byKey = {}; metrics.forEach((x) => (byKey[x.def.key] = x));
  for (const q of quarters) for (const x of metrics) x.cells[q.key] = { pass: 0, total: 0, fails: [] };
  const shortId = (w) => (typeof xtStripSuffix === "function" ? xtStripSuffix(w) : String(w || ""));

  // --- pmr-sourced: delivery + daily, one pmrRun per quarter on the SRF grid ---
  if (srfGrid && typeof pmrRun === "function") {
    for (const q of quarters) {
      let pr = null;
      try { pr = pmrRun(srfGrid, q.start, q.end); } catch (e) { pr = null; }
      if (!pr) continue;
      const dFails = [];
      for (const lr of (pr.late_rows || [])) dFails.push({ req: shortId(lr[0]), svc: "SRF", reason: `Delivered ${lr[2]} vs RDD ${lr[1]} (${lr[3]}d late)` });
      for (const nr of (pr.no_nlt_rows || [])) dFails.push({ req: shortId(nr[0]), svc: "SRF", reason: `Delivered ${nr[1]} — no NLT date in ATLAS (unscored)` });
      byKey.delivery.cells[q.key] = { pass: pr.on_time_count || 0, total: pr.nlt_scoped || 0, fails: dFails };
      const du = pr.daily_update || {};
      const daFails = (du.rows || []).filter((r) => r.status !== "OK")
        .map((r) => ({ req: shortId(r.wmtr), svc: "SRF", reason: `${r.missing_count} missing business day${r.missing_count === 1 ? "" : "s"}` }));
      byKey.daily.cells[q.key] = { pass: du.compliant || 0, total: du.with_daily || 0, fails: daFails };
    }
  }

  // --- reqatt-sourced: shipping documents attached (SRF) ---
  if (srfGrid && typeof reqattParseUdq === "function") {
    let blocks = [];
    try { blocks = reqattParseUdq(srfGrid) || []; } catch (e) { blocks = []; }
    for (const blk of blocks) {
      const f = blk.fields || {};
      const wmtr = norm(f["WMTR Number"]);
      const dIso = xtIsoStr(f["Delivery Date"]);
      if (!dIso) continue;                                  // not delivered -> not scored
      if (pmrSrfRelieved(wmtr, dIso)) continue;             // relieved
      if (norm(f["Identify Shipment As"]).toLowerCase() === "hand carry") continue; // skipped, matches ReqAtt
      const origin = norm(f["Country of Origin"]), dest = norm(f["Country of Destination"]);
      const cat = _raShipmentCategory(origin, dest);
      if (cat === "UNKNOWN") continue;                      // unclassifiable -> not scored
      const q = pmrFyQuarterOf(dIso);
      const cell = q && byKey.docs.cells[q.key];
      if (!cell) continue;
      const ev = _raEvaluate(cat, blk.attachment_types || [], origin, _raIsCourier(f["Identify Shipment As"]));
      cell.total += 1;
      if (!ev.missing.length) cell.pass += 1;
      else cell.fails.push({ req: shortId(wmtr), svc: "SRF", reason: `Missing: ${ev.missing.join(", ")}` });
    }
  }

  // --- row-sourced: qc, cost_srf, pr_estimate, cost_pr ---
  for (const r of rows) {
    if (!r.delivered) continue;                             // bucket date required
    const dIso = xtIso(r.delivered);
    const q = pmrFyQuarterOf(dIso);
    if (!q) continue;
    const relieved = pmrSrfRelieved(r.wmtr_full, r.service === "SRF" ? dIso : null);
    for (const x of metrics) {
      const m = x.def;
      if (m.src !== "row" || m.svc !== r.service) continue;
      if (m.svc === "SRF" && relieved) continue;            // relief only touches SRF
      const cell = x.cells[q.key];
      if (!cell || !m.elig(r)) continue;
      cell.total += 1;
      if (m.pass(r)) cell.pass += 1;
      else cell.fails.push({ req: r.request_no, svc: r.service, reason: m.failReason ? m.failReason(r) : "" });
    }
  }

  for (const x of metrics) for (const q of quarters) {
    const c = x.cells[q.key];
    x.tot.pass += c.pass; x.tot.total += c.total;
    for (const fl of c.fails) x.tot.fails.push({ ...fl, quarter: q.key });
  }
  return { quarters, metrics, pending: XT_ROLLUP_PENDING, untracked: XT_ROLLUP_UNTRACKED, srfGrid: !!srfGrid, generatedAt: new Date() };
}

/** RYG bucket for a ratio 0..1 against a metric's thresholds. */
function xtRollupRyg(ratio, m) { return ratio >= m.green ? "G" : ratio >= m.yellow ? "Y" : "R"; }

/** Raw-HTML string for the rollup panel (nests inside the workspace el() template). */
function xtRollupPanelHtml() {
  const R = xtBuildRollup();
  if (!R.quarters.length) {
    return `<div class="panel xt-rollup" style="margin-top:12px"><div class="header"><h2>PMR Metrics \u2014 Fiscal Quarter Rollup</h2></div><div class="body"><div class="statusline">No dated records yet \u2014 load service UDQs to score metrics.</div></div></div>`;
  }
  const bg = { G: "#e7f4ec", Y: "#fdf1e3", R: "#fbe7e7" };
  const fg = { G: "var(--cleared)", Y: "#B8530B", R: "var(--warn)" };
  const drill = XTree.rollupDrill;
  const cell = (c, m, qkey) => {
    if (!c || !c.total) return `<td class="xtr-c xtr-na">\u2014</td>`;
    const ratio = c.pass / c.total;
    const g = xtRollupRyg(ratio, m);
    const pct = Math.round(ratio * 1000) / 10;
    const nf = (c.fails || []).length;
    // "Flagged" = the box is below target (yellow/red) AND has requests to hone in on.
    // Clicking a flagged box scopes the window AND switches to Issues-only so the
    // table shows just those requests. A green box only scopes the window.
    const flagged = (g === "R" || g === "Y") && nf > 0;
    const active = drill && drill.metric === m.key && drill.quarter === qkey;
    const qlabel = qkey === "__total__" ? "all quarters" : qkey;
    const cls = `xtr-c xtr-qcell${flagged ? " xtr-click" : ""}${active ? " xtr-active" : ""}`;
    const drillAttrs = flagged ? ` data-drill-metric="${esc(m.key)}" data-drill-q="${esc(qkey)}"` : "";
    const title = flagged
      ? `${nf} flagged \u2014 click to scope to ${qlabel} and show only these issues`
      : `Click to scope the window to ${qlabel}`;
    return `<td class="${cls}" data-qcell-q="${esc(qkey)}"${drillAttrs} style="background:${bg[g]};color:${fg[g]}" title="${esc(title)}"><span class="xtr-pct">${pct}%</span><span class="xtr-frac">${c.pass}/${c.total}${flagged ? ` \u00b7 ${nf}\u26a0` : ""}</span></td>`;
  };
  const qh = R.quarters.map((q) => {
    const active = XTree.window.start === q.start && XTree.window.end === q.end && q.start;
    return `<th class="xtr-qhead${active ? " active" : ""}" data-qwin="${esc(q.key)}" data-qwin-start="${esc(q.start)}" data-qwin-end="${esc(q.end)}" title="Click to scope the reporting window to ${esc(q.key)} (click again to clear)"><span class="xtr-qh-btn">${esc(q.key)}<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg></span></th>`;
  }).join("");
  const body = R.metrics.map((x) =>
    `<tr><td class="xtr-l">${esc(x.def.label)}<span class="xtr-svc">${x.def.svc}</span></td>${R.quarters.map((q) => cell(x.cells[q.key], x.def, q.key)).join("")}${cell(x.tot, x.def, "__total__")}</tr>`
  ).join("");
  // Non-scored WMTR metrics render as in-table rows: a section header row, then one
  // row per metric with a note spanning the score columns (no per-quarter data).
  const nSpan = R.quarters.length + 2;      // metric + quarters + total
  const noteSpan = R.quarters.length + 1;   // quarters + total
  const secRow = (title) => `<tr class="xtr-sec"><td colspan="${nSpan}">${esc(title)}</td></tr>`;
  const infoRow = (p, cls) => `<tr class="${cls}"><td class="xtr-l">${esc(p.label)}<span class="xtr-svc">${esc(p.svc)}</span></td><td class="xtr-note" colspan="${noteSpan}">${esc(p.why)}</td></tr>`;
  const pendingRows = R.pending.length
    ? secRow("Pending an ATLAS field \u2014 will score once the field is captured") + R.pending.map((p) => infoRow(p, "xtr-pend")).join("")
    : "";
  const untrackedRows = R.untracked.length
    ? secRow("Not tracked in ATLAS \u2014 acknowledged; would require additional data fields") + R.untracked.map((p) => infoRow(p, "xtr-untr")).join("")
    : "";
  // The non-scored metrics collapse under a single toggle row, collapsed by default.
  const extraCount = R.pending.length + R.untracked.length;
  const extraOpen = !!XTree.rollupExtraOpen;
  const toggleRow = extraCount
    ? `<tr class="xtr-toggle" id="xtRollupExtraToggle"><td colspan="${nSpan}"><span class="xtr-caret">${extraOpen ? "\u25be" : "\u25b8"}</span>Metrics not scored by ATLAS (${extraCount}) \u2014 ${extraOpen ? "hide" : "show"}</td></tr>`
    : "";
  const extraRows = extraOpen ? pendingRows + untrackedRows : "";

  // ----- drill-down detail (only when a cell is selected) -----
  let drillHtml = "";
  if (drill) {
    const mx = R.metrics.find((x) => x.def.key === drill.metric);
    if (mx) {
      let list, qlabel;
      if (drill.quarter === "__total__") { list = mx.tot.fails; qlabel = "all quarters"; }
      else { const c = mx.cells[drill.quarter]; list = (c && c.fails) || []; qlabel = drill.quarter; }
      const rowsHtml = list.map((f) =>
        `<div class="xtr-fail"><span class="xt-wmtr-chip" data-wmtr="${esc(f.req)}"><span class="lbl">${esc(f.req.replace(/^WMTR-/, ""))}</span></span><span class="xtr-reason">${esc(f.reason)}</span></div>`
      ).join("");
      drillHtml = `<div class="xtr-drill" id="xtRollupDrill">
        <div class="xtr-drill-h"><span><strong>${esc(mx.def.label)}</strong> \u00b7 ${esc(qlabel)} \u2014 ${list.length} flagged</span><button class="xtr-drill-x" id="xtRollupDrillClose" type="button" title="Close">\u00d7</button></div>
        ${list.length ? `<div class="xtr-drill-hint">Click a WMTR to isolate it in the tracker below.</div>${rowsHtml}` : `<div class="xtr-drill-hint">No flagged records in this cell.</div>`}
      </div>`;
    }
  }
  return `
    <style>
      .xt-rollup .scrollwrap{overflow:auto}
      table.xtr-tbl{border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap;width:100%}
      table.xtr-tbl th{position:sticky;top:0;background:#F7F9FA;font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:11px;color:var(--steel);border-bottom:2px solid var(--line);padding:7px 9px;text-align:center}
      body.theme-dark table.xtr-tbl th{background:#131c26}
      table.xtr-tbl th.xtr-l,table.xtr-tbl td.xtr-l{text-align:left;position:sticky;left:0;background:var(--card);z-index:1;border-right:1px solid var(--line);min-width:280px;white-space:normal}
      table.xtr-tbl th.xtr-l{z-index:3;background:#F7F9FA}
      body.theme-dark table.xtr-tbl th.xtr-l{background:#131c26}
      table.xtr-tbl th.xtr-qhead{cursor:pointer;transition:color .12s}
      .xtr-qh-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:var(--radius-badge);padding:2px 8px;background:var(--card);color:var(--ink);transition:background .12s,border-color .12s,color .12s}
      .xtr-qh-btn svg{opacity:.45;transition:opacity .12s}
      table.xtr-tbl th.xtr-qhead:hover .xtr-qh-btn{border-color:var(--accent);color:var(--accent-dark)}
      table.xtr-tbl th.xtr-qhead:hover .xtr-qh-btn svg{opacity:1}
      table.xtr-tbl th.xtr-qhead.active .xtr-qh-btn{background:var(--accent);border-color:var(--accent);color:#fff}
      table.xtr-tbl th.xtr-qhead.active .xtr-qh-btn svg{opacity:1}
      .xtr-qhint{font-family:var(--body);font-size:11.5px;color:var(--steel);margin:0 0 8px;display:flex;align-items:center;gap:6px}
      .xtr-qhint svg{opacity:.6;flex:none}
      /* Shaded section band so the rollup header is easy to spot while scrolling. */
      .xt-rollup .header{background:#E9EEF3;border-left:3px solid var(--accent)}
      body.theme-dark .xt-rollup .header{background:#1a2632}
      table.xtr-tbl td{border-bottom:1px solid #E8ECEF;padding:6px 9px;text-align:center}
      body.theme-dark table.xtr-tbl td{border-bottom-color:var(--line)}
      td.xtr-c{font-family:var(--mono)}
      td.xtr-na{color:var(--steel)}
      td.xtr-qcell{cursor:pointer}
      td.xtr-qcell:not(.xtr-click):hover{outline:2px solid rgba(91,107,124,.45);outline-offset:-2px}
      td.xtr-click{cursor:pointer}
      td.xtr-click:hover{outline:2px solid var(--ink);outline-offset:-2px}
      td.xtr-active{outline:2px solid var(--accent);outline-offset:-2px}
      .xtr-pct{display:block;font-weight:600;font-size:12.5px}
      .xtr-frac{display:block;font-size:10.5px;opacity:.75}
      .xtr-svc{display:inline-block;margin-left:8px;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:10px;color:var(--steel);border:1px solid var(--line);border-radius:var(--radius-badge);padding:0 5px}
      .xt-rollnote{font-family:var(--body);font-size:11.5px;color:var(--steel);margin-top:8px;line-height:1.5}
      tr.xtr-toggle td{cursor:pointer;user-select:none;background:#f3f5f7;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:10.5px;font-weight:600;color:var(--steel);padding:7px 9px;text-align:left;border-top:2px solid var(--line);border-bottom:1px solid var(--line)}
      tr.xtr-toggle td:hover{color:var(--ink)}
      body.theme-dark tr.xtr-toggle td{background:#131c26}
      .xtr-caret{display:inline-block;width:14px;color:var(--accent)}
      tr.xtr-sec td{background:#eef1f4;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:10.5px;font-weight:600;color:var(--steel);padding:6px 9px;text-align:left;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
      body.theme-dark tr.xtr-sec td{background:#131c26}
      tr.xtr-pend td.xtr-l,tr.xtr-untr td.xtr-l{font-weight:500}
      td.xtr-note{text-align:left;font-family:var(--body);font-style:italic;font-size:11.5px;color:var(--steel);white-space:normal}
      .xtr-drill{margin-top:10px;border:1px solid var(--line);border-radius:var(--radius-panel);background:var(--paper);padding:10px 12px}
      .xtr-drill-h{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--ink);margin-bottom:4px}
      .xtr-drill-x{border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:var(--steel)}
      .xtr-drill-x:hover{color:var(--warn)}
      .xtr-drill-hint{font-size:11px;color:var(--steel);margin-bottom:6px}
      .xtr-fail{display:flex;gap:10px;align-items:baseline;padding:3px 0;border-top:1px solid var(--line)}
      .xtr-reason{font-size:12px;color:var(--ink)}
    </style>
    <div class="panel xt-rollup" style="margin-top:12px">
      <div class="header"><h2>PMR Metrics \u2014 Fiscal Quarter Rollup</h2><span class="count">${R.metrics.length} scored \u00b7 ${R.pending.length + R.untracked.length} not tracked \u00b7 SRF relief applied</span><span style="margin-left:auto;display:inline-flex;gap:6px"><button class="btn ghost" id="xtRollupXlsx" type="button" style="padding:5px 12px;font-size:12.5px">Summary (.xlsx)</button><button class="btn ghost" id="xtRollupPdf" type="button" style="padding:5px 12px;font-size:12.5px">Summary (.pdf)</button></span></div>
      <div class="body">
        ${R.srfGrid ? "" : `<div class="statusline warn">Load the SRF UDQ to score the shipping metrics (delivery, daily, docs, SRF cost).</div>`}
        <div class="xtr-qhint"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>Click a <strong>quarter heading</strong> (or a green cell) to scope the reporting window to that quarter. Click a <strong>flagged (red/yellow) cell</strong> to also switch to <strong>Issues only</strong> and land on the requests that caused it. Click the active quarter heading again to clear.</div>
        <div class="scrollwrap"><table class="xtr-tbl">
          <thead><tr><th class="xtr-l">Metric</th>${qh}<th>Total</th></tr></thead>
          <tbody>${body}${toggleRow}${extraRows}</tbody>
        </table></div>
        ${drillHtml}
        <div class="xt-rollnote">Green / Yellow / Red per the PMR deck thresholds. Cells with flags (\u26a0) are clickable. SRF lines honor the Oct-1 relief (WMTR 10095 scored normally). Bucketed by fiscal quarter of Delivery Date (SRF) / Date Completed (others). Cost accuracy uses current total cost as the actual-cost proxy until invoiced amounts are in the UDQ. The AWB/BoL (tracking) metric exempts deliveries before Mar 2026 (that field was added to ATLAS in Feb 2026). The two sections below the scored metrics cover every other WMTR metric on the PMR deck \u2014 the ATLAS UDQ doesn\u2019t currently carry the data to compute them.</div>
      </div>
    </div>`;
}

/** Flatten every failing record across metrics/quarters into a worklist:
    [{ metric, mlabel, svc, quarter, req, reason }]. Powers both the summary
    export and (next) the click-to-drill-down. */
function xtRollupFlatFails(R) {
  const out = [];
  for (const x of R.metrics) {
    for (const q of R.quarters) {
      const c = x.cells[q.key];
      for (const f of (c && c.fails || [])) out.push({ metric: x.def.key, mlabel: x.def.label, svc: f.svc, quarter: q.key, req: f.req, reason: f.reason });
    }
  }
  return out;
}
function xtRollupPctStr(c) { return c && c.total ? (Math.round(c.pass / c.total * 1000) / 10) + "%" : "\u2014"; }
function xtRollupRygWord(c, m) {
  if (!c || !c.total) return "\u2014";
  const g = xtRollupRyg(c.pass / c.total, m);
  return g === "G" ? "Green" : g === "Y" ? "Yellow" : "Red";
}
function xtMetricsStamp() { return (typeof fileStamp === "function") ? fileStamp() : new Date().toISOString().slice(0, 10); }

/** Excel summary: sheet 1 = the rollup table; sheet 2 = the flagged-records worklist. */
function xtExportMetricsXlsx() {
  if (typeof XLSX === "undefined") { xtSetStatus("Spreadsheet library not loaded.", true); return; }
  try {
    const R = xtBuildRollup();
    if (!R.quarters.length) { xtSetStatus("No dated records to summarize yet.", true); return; }
    const qk = R.quarters.map((q) => q.key);

    // Sheet 1 — summary.
    const head1 = ["Metric", "Svc", ...qk, "Total", "Status (Total)"];
    const aoa1 = [head1];
    for (const x of R.metrics) {
      const row = [x.def.label, x.def.svc];
      for (const q of R.quarters) { const c = x.cells[q.key]; row.push(c && c.total ? `${c.pass}/${c.total} ${xtRollupPctStr(c)}` : "\u2014"); }
      row.push(x.tot.total ? `${x.tot.pass}/${x.tot.total} ${xtRollupPctStr(x.tot)}` : "\u2014");
      row.push(xtRollupRygWord(x.tot, x.def));
      aoa1.push(row);
    }
    aoa1.push([]);
    aoa1.push(["Pending an ATLAS field (will score once the field is captured):"]);
    for (const p of R.pending) aoa1.push([p.label, p.svc, p.why]);
    aoa1.push([]);
    aoa1.push(["Not tracked in ATLAS (acknowledged; would require additional data fields):"]);
    for (const p of R.untracked) aoa1.push([p.label, p.svc, p.why]);
    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1["!cols"] = [{ wch: 52 }, { wch: 5 }, ...qk.map(() => ({ wch: 13 })), { wch: 15 }, { wch: 14 }];

    // Sheet 2 — flagged records worklist.
    const fails = xtRollupFlatFails(R);
    const head2 = ["Metric", "Svc", "Quarter", "WMTR", "Flagged For"];
    const aoa2 = [head2, ...fails.map((f) => [f.mlabel, f.svc, f.quarter, f.req, f.reason])];
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2["!cols"] = [{ wch: 52 }, { wch: 5 }, { wch: 10 }, { wch: 22 }, { wch: 60 }];
    ws2["!autofilter"] = { ref: ws2["!ref"] };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "PMR Metrics");
    XLSX.utils.book_append_sheet(wb, ws2, "Flagged Records");
    const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const b64 = xtArrayToBase64(arr);
    const fname = `PMR_Metrics_${xtMetricsStamp()}.xlsx`;
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    xtSetStatus(`\u2705 Exported ${fname} (${R.metrics.length} metrics, ${fails.length} flagged records).`, false);
  } catch (e) { console.error(e); xtSetStatus(`Couldn't build the Excel summary: ${e.message}`, true); }
}

/** pdf-lib's standard fonts use WinAnsi encoding, which can't encode chars like
    "≤"/"→". Map the typographic characters we emit to ASCII and replace anything
    else outside Latin-1 so drawText/widthOfTextAtSize never throw. */
function xtPdfSafe(v) {
  return String(v == null ? "" : v)
    .replace(/\u2264/g, "<=").replace(/\u2265/g, ">=")
    .replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/\u2022/g, "*")
    .replace(/[^\x00-\xFF]/g, "?");
}

/** PDF summary: colored RYG rollup table + a grouped flagged-records worklist. */
async function xtExportMetricsPdf() {
  const PL = (typeof PDFLib !== "undefined" && PDFLib && PDFLib.PDFDocument) ? PDFLib : null;
  if (!PL) { xtSetStatus("PDF library not loaded.", true); return; }
  try {
    const R = xtBuildRollup();
    if (!R.quarters.length) { xtSetStatus("No dated records to summarize yet.", true); return; }
    const { PDFDocument, StandardFonts, rgb } = PL;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 792, H = 612, M = 36;               // US Letter landscape
    const ink = rgb(0.09, 0.16, 0.24), steel = rgb(0.36, 0.42, 0.49);
    const fill = { G: rgb(0.906, 0.957, 0.925), Y: rgb(0.992, 0.945, 0.89), R: rgb(0.984, 0.906, 0.906), N: rgb(0.96, 0.97, 0.98) };
    const fg = { G: rgb(0.12, 0.5, 0.31), Y: rgb(0.72, 0.33, 0.04), R: rgb(0.69, 0, 0), N: steel };

    let page = doc.addPage([W, H]);
    let y = H - M;
    const text = (s, x, yy, sz, f, c) => page.drawText(xtPdfSafe(s), { x, y: yy, size: sz, font: f || font, color: c || ink });
    const trunc = (s, max) => { s = String(s || ""); return s.length > max ? s.slice(0, max - 1) + "\u2026" : s; };

    text("PMR Metrics \u2014 Fiscal Quarter Rollup", M, y, 15, bold); y -= 16;
    text(`Generated ${R.generatedAt.toLocaleString()} \u00b7 SRF relief applied (WMTR 10095 scored) \u00b7 FY starts Oct 1`, M, y, 8.5, font, steel); y -= 18;

    // ----- summary table -----
    const qk = R.quarters.map((q) => q.key);
    const labelW = 250, totW = 74, colW = Math.max(52, Math.min(78, (W - 2 * M - labelW - totW) / (qk.length || 1)));
    const rowH = 20;
    const drawCellRYG = (cx, cyTop, w, c, m) => {
      const g = (!c || !c.total) ? "N" : xtRollupRyg(c.pass / c.total, m);
      page.drawRectangle({ x: cx, y: cyTop - rowH, width: w, height: rowH, color: fill[g], borderColor: rgb(0.85, 0.87, 0.89), borderWidth: 0.5 });
      const t1 = xtPdfSafe((!c || !c.total) ? "\u2014" : `${Math.round(c.pass / c.total * 1000) / 10}%`);
      const t2 = xtPdfSafe((!c || !c.total) ? "" : `${c.pass}/${c.total}`);
      page.drawText(t1, { x: cx + w / 2 - font.widthOfTextAtSize(t1, 9) / 2, y: cyTop - 9, size: 9, font: bold, color: fg[g] });
      if (t2) page.drawText(t2, { x: cx + w / 2 - font.widthOfTextAtSize(t2, 7) / 2, y: cyTop - 17, size: 7, font, color: fg[g] });
    };
    // header row
    let hx = M + labelW;
    page.drawRectangle({ x: M, y: y - rowH, width: labelW, height: rowH, color: rgb(0.97, 0.98, 0.98), borderColor: rgb(0.85, 0.87, 0.89), borderWidth: 0.5 });
    text("Metric", M + 4, y - 13, 8.5, bold, steel);
    for (const k of qk) { const ks = xtPdfSafe(k); page.drawRectangle({ x: hx, y: y - rowH, width: colW, height: rowH, color: rgb(0.97, 0.98, 0.98), borderColor: rgb(0.85, 0.87, 0.89), borderWidth: 0.5 }); page.drawText(ks, { x: hx + colW / 2 - bold.widthOfTextAtSize(ks, 8) / 2, y: y - 13, size: 8, font: bold, color: steel }); hx += colW; }
    page.drawRectangle({ x: hx, y: y - rowH, width: totW, height: rowH, color: rgb(0.97, 0.98, 0.98), borderColor: rgb(0.85, 0.87, 0.89), borderWidth: 0.5 });
    page.drawText("Total", { x: hx + totW / 2 - bold.widthOfTextAtSize("Total", 8) / 2, y: y - 13, size: 8, font: bold, color: steel });
    y -= rowH;
    for (const x of R.metrics) {
      page.drawRectangle({ x: M, y: y - rowH, width: labelW, height: rowH, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.87, 0.89), borderWidth: 0.5 });
      text(trunc(x.def.label, 48), M + 4, y - 9, 7.6, font, ink);
      text(x.def.svc, M + 4, y - 17, 6.5, font, steel);
      let cx = M + labelW;
      for (const q of R.quarters) { drawCellRYG(cx, y, colW, x.cells[q.key], x.def); cx += colW; }
      drawCellRYG(cx, y, totW, x.tot, x.def);
      y -= rowH;
    }
    y -= 12;
    const ensure = (need) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M; } };

    // ----- non-scored WMTR metrics (pending a field / not tracked in ATLAS) -----
    const infoSection = (title, items) => {
      if (!items.length) return;
      ensure(26);
      text(title, M, y, 9.5, bold, ink); y -= 13;
      for (const p of items) {
        ensure(12);
        text(trunc(p.label, 62), M + 8, y, 7.5, font, ink);
        text(p.svc, M + 336, y, 7, font, steel);
        text(trunc(p.why, 92), M + 366, y, 7, font, steel);
        y -= 11;
      }
      y -= 8;
    };
    infoSection("Pending an ATLAS field (will score once the field is captured)", R.pending);
    infoSection("Not tracked in ATLAS (acknowledged; would require additional data fields)", R.untracked);

    // ----- flagged records worklist -----
    const fails = xtRollupFlatFails(R);
    ensure(20);
    text(`Flagged Records (${fails.length})`, M, y, 12, bold); y -= 16;
    const byMetric = {};
    for (const f of fails) (byMetric[f.mlabel] = byMetric[f.mlabel] || []).push(f);
    for (const [mlabel, list] of Object.entries(byMetric)) {
      ensure(28);
      text(`${mlabel}  (${list.length})`, M, y, 9, bold, ink); y -= 13;
      for (const f of list) {
        ensure(12);
        text(`${f.quarter}`, M + 8, y, 7.5, font, steel);
        text(`${f.req}`, M + 62, y, 7.5, bold, ink);
        text(trunc(f.reason, 120), M + 190, y, 7.5, font, ink);
        y -= 11;
      }
      y -= 5;
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const fname = `PMR_Metrics_${xtMetricsStamp()}.pdf`;
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    xtSetStatus(`\u2705 Exported ${fname} (${R.metrics.length} metrics, ${fails.length} flagged records).`, false);
  } catch (e) { console.error(e); xtSetStatus(`Couldn't build the PDF summary: ${e.message}`, true); }
}

/* -------------------------------------------------------------------------
   INGESTION — drop or fetch -> classify -> parse -> store slot.
   ------------------------------------------------------------------------- */
function xtSetStatus(msg, isErr) {
  XTree.status = msg || ""; XTree.statusErr = !!isErr;
  const s = document.getElementById("xtStatus");
  if (s) { s.textContent = XTree.status; s.classList.toggle("err", XTree.statusErr); }
}

async function xtIngestFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const grid = workbookToGrid(buf);
    const service = xtClassifyService(grid);
    if (!service) {
      xtSetStatus(`Couldn't tell which service area "${file.name}" is — expected an SRF, PR, PMCT or WS UDQ export.`, true);
      return;
    }
    const { records, untagged } = xtParseRecords(grid, service);
    if (!records.length) {
      xtSetStatus(`No ${service} WMTRs found in "${file.name}" (recognized as ${service}).`, true);
      return;
    }
    XTree.slots[service] = { fileName: file.name, records, untagged, grid };
    const extra = untagged.length ? ` (${untagged.length} untagged skipped)` : "";
    xtSetStatus(`Loaded ${service}: ${records.length} WMTR${records.length === 1 ? "" : "s"} from ${file.name}${extra}.`, false);
    renderWorkspace();
  } catch (e) {
    console.error(e);
    xtSetStatus(`Couldn't read "${file.name}": ${e.message}`, true);
  }
}

async function xtIngestFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => /\.xlsx?$/i.test(f.name));
  for (const f of files) await xtIngestFile(f);   // sequential: last status wins
}

/** Fetch service UDQ(s) from ATLAS. Pass a service ("SRF"/"PR"/"PMCT"/"WS") to
    fetch just that one; omit (or "all") to fetch all four. */
async function xtFetchFromAtlas(service) {
  if (typeof loadFromAtlasXmasTree === "function") {
    await loadFromAtlasXmasTree(service && service !== "all" ? { service } : undefined);
    return;
  }
  xtSetStatus("ATLAS fetch for the Christmas Tree isn't wired to live UDQ IDs yet.", true);
}

function xtClearAll() {
  XTree.slots = { SRF: null, PR: null, PMCT: null, WS: null };
  xtSetStatus("Cleared all four slots.", false);
  renderWorkspace();
}
/** Clear a single service slot, leaving the others loaded. */
function xtClearSlot(svc) {
  if (!XTree.slots[svc]) return;
  XTree.slots[svc] = null;
  XTree.rollupDrill = null;
  xtSetStatus(`Cleared ${svc}.`, false);
  renderWorkspace();
}

/* -------------------------------------------------------------------------
   VIEW
   ------------------------------------------------------------------------- */
function xtFmtCell(row, col) {
  const v = row[col.id];
  if (v === null || v === undefined || v === "") return "";
  switch (col.type) {
    case "date":  return v instanceof Date ? xtDisplayDate(v) : String(v);
    case "money": return typeof v === "number" ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    case "pct":   return typeof v === "number" ? (v * 100).toFixed(1) + "%" : String(v);
    default:      return String(v);
  }
}
function xtDisplayDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
}
function xtBadgeClass(v) {
  const s = String(v).toLowerCase();
  if (s === "on time" || s === "on budget") return "xt-badge good";
  if (s === "late" || s === "over" || s === "yes") return "xt-badge bad";
  return "xt-badge";
}

function xtSlotCount(svc) { const s = XTree.slots[svc]; return s ? s.records.length : 0; }
function xtAnyLoaded() { return XT_SERVICES.some((s) => XTree.slots[s]); }

/** Render the current manual-ignore list into a host element, with remove buttons. */
function xtRenderIgnoreList(host) {
  const ig = xtGetIgnores();
  const keys = Object.keys(ig).sort((a, b) => xtWmtrNumber(a) - xtWmtrNumber(b));
  if (!keys.length) { host.innerHTML = `<div class="hint" style="margin-top:6px">Nothing ignored yet.</div>`; return; }
  host.innerHTML = keys.map((k) => {
    const metrics = ig[k].map((m) => XT_METRIC_LABELS[m] || m).join(", ");
    return `<div class="xt-ignore-row" data-wmtr="${esc(k)}">
      <span>${esc(k.replace(/^WMTR-/, ""))}</span><span class="metrics">${esc(metrics)}</span>
      <button data-wmtr="${esc(k)}" type="button">Remove</button>
    </div>`;
  }).join("");
  host.querySelectorAll("button[data-wmtr]").forEach((b) =>
    b.addEventListener("click", () => { xtRemoveIgnore(b.getAttribute("data-wmtr")); renderWorkspace(); }));
}

function renderXmasTreeWorkspace(container) {
  const loaded = xtAnyLoaded();
  const allRows = loaded ? xtAnnotateIssues(xtBuildRows()) : [];
  const untagged = loaded ? xtUntaggedList() : [];
  const issueSummary = loaded ? xtCollectIssues(allRows) : { list: [], total: 0, flaggedRows: 0 };
  const rows = XTree.issuesOnly ? allRows.filter((r) => r.issues.length) : allRows;
  const ignoreCount = Object.keys(xtGetIgnores()).length;

  const slotChips = XT_SERVICES.map((svc) => {
    const s = XTree.slots[svc];
    const cls = s ? "xt-slot filled" : "xt-slot";
    const sub = s ? `${s.records.length} WMTR${s.records.length === 1 ? "" : "s"}` : "empty";
    const x = s ? `<button class="xt-slot-x" data-clear-svc="${svc}" type="button" title="Clear ${svc}" aria-label="Clear ${svc}">\u00d7</button>` : "";
    return `<div class="${cls}">${x}<span class="xt-slot-svc">${svc}</span><span class="xt-slot-sub">${esc(sub)}</span></div>`;
  }).join("");

  const panel = el(`
    <div class="panel">
      <style>
        /* This tool uses custom .panel-head/.panel-body classes; mirror the app's
           standard .panel>header and .panel .body chrome so it matches every other
           tool (side padding + consistent header), scoped to the Christmas Tree.
           The nested rollup panel uses <div class="header">, so give it the same. */
        .panel-head,.xt-rollup .header{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line)}
        .panel-head h2,.xt-rollup .header h2{font-family:var(--disp);font-size:17px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin:0}
        .panel-head .count,.xt-rollup .header .count{font-family:var(--mono);font-size:11px;color:var(--steel)}
        .panel-body{padding:14px 16px}
        .xt-actionrow{align-items:center}
        .xt-slots{display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:auto;align-items:center}
        .xt-slot{position:relative;display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--line);border-radius:var(--radius-badge);padding:3px 8px;background:var(--card);line-height:1.4;transition:border-color .15s ease}
        .xt-slot.filled{border-color:var(--accent);background:#FFF7F2;padding-right:22px}
        body.theme-dark .xt-slot{background:var(--card)}
        body.theme-dark .xt-slot.filled{background:#241a12}
        .xt-slot-svc{font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:var(--ink)}
        .xt-slot-sub{font-family:var(--mono);font-size:10px;color:var(--steel)}
        .xt-slot-x{position:absolute;top:50%;transform:translateY(-50%);right:4px;width:15px;height:15px;line-height:12px;text-align:center;border:1px solid var(--line);border-radius:50%;background:var(--card);color:var(--steel);font-size:11px;cursor:pointer;padding:0;transition:background .12s,border-color .12s,color .12s}
        .xt-slot-x:hover{background:var(--warn);border-color:var(--warn);color:#fff}
        /* Drag-drop still works anywhere on the panel even though the big dropzone is gone. */
        .panel.xt-dragover{outline:2px dashed var(--accent);outline-offset:-4px;background:#FFF7F2}
        body.theme-dark .panel.xt-dragover{background:#241a12}
        /* Section header band — shaded so sections are easy to tell apart while scrolling. */
        .xt-section{overflow:hidden}
        .xt-section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;background:#E9EEF3;border-left:3px solid var(--accent);border-bottom:1px solid var(--line);cursor:pointer;user-select:none}
        body.theme-dark .xt-section-head{background:#1a2632}
        .xt-section-head h3{margin:0;font-family:var(--disp);text-transform:uppercase;letter-spacing:1.2px;font-size:13.5px;color:var(--ink)}
        .xt-section-head .xt-caret{font-size:11px;color:var(--steel);width:12px}
        .xt-section-head .mx-windowlabel{font-family:var(--mono);font-size:12px;color:var(--accent-dark)}
        .xt-section-head .xt-section-hint{margin-left:auto;font-family:var(--body);font-size:11.5px;color:var(--steel)}
        .xt-section .body{padding:12px 14px}
        .xt-fetch-select{font-family:var(--body);font-size:13px;padding:8px 12px;border:1px solid #B9C4CE;border-radius:var(--radius-btn);background:var(--card);color:var(--ink);cursor:pointer;transition:border-color .12s,box-shadow .12s}
        .xt-fetch-select:hover{border-color:var(--ink)}
        .xt-fetch-select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px rgba(232,89,12,.25)}
        .xt-controls{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin:6px 0 12px}
        .xt-controls .field label{display:block;font-family:var(--disp);text-transform:uppercase;letter-spacing:1.2px;font-size:12px;color:var(--steel);margin-bottom:3px}
        .xt-seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius-btn);overflow:hidden}
        .xt-seg button{border:0;background:var(--card);color:var(--ink);font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:12.5px;padding:7px 12px;cursor:pointer}
        .xt-seg button.active{background:var(--accent);color:#fff}
        .xt-count{font-family:var(--mono);font-size:11px;color:var(--steel)}
        .xt-scrollwrap{overflow:auto;max-height:600px;border:1px solid var(--line);border-radius:var(--radius-panel)}
        table.xt-data{border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap}
        table.xt-data th{position:sticky;top:0;z-index:2;background:#F7F9FA;font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:11px;color:var(--steel);border-bottom:2px solid var(--line);padding:7px 9px;text-align:left}
        body.theme-dark table.xt-data th{background:#131c26}
        table.xt-data td{border-bottom:1px solid #E8ECEF;padding:6px 9px;vertical-align:top}
        body.theme-dark table.xt-data td{border-bottom-color:var(--line)}
        table.xt-data td.num{font-family:var(--mono);text-align:right}
        table.xt-data th.stick,table.xt-data td.stick{position:sticky;left:0;background:var(--card);z-index:1;border-right:1px solid var(--line);font-family:var(--mono)}
        table.xt-data th.stick{z-index:3;background:#F7F9FA}
        body.theme-dark table.xt-data th.stick{background:#131c26}
        .xt-badge{display:inline-block;font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;padding:1px 6px;border-radius:var(--radius-badge);border:1px solid var(--line);color:var(--steel)}
        .xt-badge.good{border-color:var(--cleared);color:var(--cleared)}
        .xt-badge.bad{border-color:var(--warn);color:var(--warn)}
        .xt-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
        .xt-card{border:1px solid var(--line);border-radius:var(--radius-panel);overflow:hidden}
        .xt-card h4{margin:0;padding:8px 12px;background:var(--header-bg);color:#fff;font-family:var(--mono);font-size:13px;display:flex;justify-content:space-between;align-items:center}
        .xt-card .svc-tag{font-family:var(--disp);text-transform:uppercase;letter-spacing:1.5px;font-size:11px;border:1px solid var(--accent);color:#fff;border-radius:var(--radius-badge);padding:0 6px}
        .xt-kv{display:grid;grid-template-columns:1fr 1fr;gap:0}
        .xt-kv .k{font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;color:var(--steel);padding:5px 12px;border-bottom:1px solid #EEF1F3}
        .xt-kv .v{font-size:12.5px;padding:5px 12px;border-bottom:1px solid #EEF1F3;text-align:right}
        body.theme-dark .xt-kv .k,body.theme-dark .xt-kv .v{border-bottom-color:var(--line)}
        .xt-holidays{margin-top:8px}
        .xt-holidays textarea{width:100%;min-height:90px;font-family:var(--mono);font-size:11.5px}
        /* --- issue highlighting --- */
        /* Whole-row shade via the <tr> background so untinted cells pick it up while
           per-cell issue tints still show on top; sticky first column matches. */
        table.xt-data tr.xt-row-red{background:#FDECEC}
        table.xt-data tr.xt-row-red td.stick{background:#FDECEC;box-shadow:inset 3px 0 0 var(--warn)}
        table.xt-data tr.xt-row-warn{background:#FEF7DC}
        table.xt-data tr.xt-row-warn td.stick{background:#FEF7DC;box-shadow:inset 3px 0 0 #C79A1E}
        body.theme-dark table.xt-data tr.xt-row-red{background:#2a1a1c}
        body.theme-dark table.xt-data tr.xt-row-red td.stick{background:#2a1a1c}
        body.theme-dark table.xt-data tr.xt-row-warn{background:#2a2612}
        body.theme-dark table.xt-data tr.xt-row-warn td.stick{background:#2a2612}
        table.xt-data tr.xt-grp td{background:#e9edf1;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:var(--ink);padding:6px 10px;border-top:2px solid var(--line);border-bottom:1px solid var(--line)}
        body.theme-dark table.xt-data tr.xt-grp td{background:#182430;color:var(--ink)}
        table.xt-data tr.xt-grp .xt-grp-n{font-family:var(--mono);font-size:10.5px;color:var(--steel);margin-left:8px}
        .xt-cell-missing,.xt-cell-late,.xt-cell-flag{color:var(--warn) !important}
        table.xt-data td.xt-cell-missing,table.xt-data td.xt-cell-late,table.xt-data td.xt-cell-flag{background:#FDE7E7}
        table.xt-data td.xt-cell-variance{background:#FFF6E5}
        .xt-cell-variance{color:#B8530B !important;font-weight:600}
        table.xt-data td.xt-cell-due{background:#E9F1FB}
        .xt-cell-due{color:#2C5A8C !important;font-weight:600}
        .xt-due{color:#2C5A8C;font-weight:600;font-style:italic}
        table.xt-data td.xt-cell-yellow{background:#FEF6D0}
        .xt-cell-yellow{color:#8A6A00 !important;font-weight:600}
        .xt-yellow{color:#8A6A00;font-weight:600;font-style:italic}
        .xt-miss{color:var(--warn);font-weight:600;font-style:italic}
        .xt-rowflag{color:var(--warn);margin-right:5px;cursor:help}
        body.theme-dark table.xt-data td.xt-cell-missing,body.theme-dark table.xt-data td.xt-cell-late,body.theme-dark table.xt-data td.xt-cell-flag{background:#3a1e20}
        body.theme-dark table.xt-data td.xt-cell-variance{background:#33280f}
        body.theme-dark table.xt-data td.xt-cell-due{background:#132a40}
        body.theme-dark .xt-cell-due,body.theme-dark .xt-due{color:#8FB8E2 !important}
        body.theme-dark table.xt-data td.xt-cell-yellow{background:#33300f}
        body.theme-dark .xt-cell-yellow,body.theme-dark .xt-yellow{color:#E0C15A !important}
        .xt-flagbtn{border:1px solid var(--warn);background:#FDECEC;color:var(--warn);font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:13px;padding:9px 14px;border-radius:var(--radius-btn);cursor:pointer;display:inline-flex;align-items:center;gap:7px}
        .xt-flagbtn:hover{background:var(--warn);color:#fff}
        .xt-flagbtn.clean{border-color:var(--cleared);background:transparent;color:var(--cleared)}
        .xt-flagbtn.clean:hover{background:var(--cleared);color:#fff}
        .xt-flagbtn .n{font-family:var(--mono)}
        .xt-flagbtn-sub{font-size:11px;opacity:.8}
        .xt-flagpanel{border:1px solid var(--warn);border-radius:var(--radius-panel);padding:12px 14px;margin:4px 0 12px;background:#FFF7F7}
        body.theme-dark .xt-flagpanel{background:#241214}
        .xt-flagpanel h4{margin:0 0 2px;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:14px;color:var(--ink)}
        .xt-flagpanel .sub{font-family:var(--mono);font-size:11px;color:var(--steel);margin-bottom:10px}
        .xt-issue-group{padding:8px 0;border-top:1px solid var(--line)}
        .xt-issue-group:first-of-type{border-top:0}
        .xt-issue-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
        .xt-issue-dot{width:9px;height:9px;border-radius:50%;flex:none}
        .xt-issue-dot.missing,.xt-issue-dot.late,.xt-issue-dot.flag{background:var(--warn)}
        .xt-issue-dot.variance{background:#B8530B}
        .xt-issue-title{font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:12.5px;color:var(--ink)}
        .xt-issue-title .cnt{font-family:var(--mono);color:var(--steel);margin-left:6px;text-transform:none}
        .xt-wmtr-chips{display:flex;flex-wrap:wrap;gap:5px}
        .xt-wmtr-chip{font-family:var(--mono);font-size:11px;border:1px solid var(--line);border-radius:var(--radius-badge);padding:1px 6px;background:var(--card);cursor:pointer}
        .xt-wmtr-chip:hover{border-color:var(--warn);color:var(--warn)}
        .xt-wmtr-chip .svc{color:var(--steel)}
        .xt-card-flagged{border-color:var(--warn)}
        .xt-card-flagged h4{background:var(--warn)}
        .xt-card-issues{display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px;background:#FFF4F4;border-bottom:1px solid var(--line)}
        body.theme-dark .xt-card-issues{background:#2a1a1c}
        .xt-chip{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10px;padding:1px 6px;border-radius:var(--radius-badge);border:1px solid currentColor}
        .xt-kv .v.xt-cell-missing,.xt-kv .v.xt-cell-late,.xt-kv .v.xt-cell-flag,.xt-kv .v.xt-cell-variance{font-weight:600}
        @keyframes xtflash{0%,100%{background:transparent}30%{background:#FFE08A}}
        table.xt-data tr.xt-focusflash td{animation:xtflash 1.1s ease-in-out 2}
        .xt-ignorebox{margin:8px 0 2px;border:1px solid var(--line);border-radius:var(--radius-panel);padding:10px 12px;background:var(--paper)}
        .xt-ignore-add{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
        .xt-ignore-add input{flex:1;min-width:220px}
        .xt-ignore-add select{min-width:150px}
        .xt-ignore-row{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;padding:4px 0;border-top:1px solid var(--line)}
        .xt-ignore-row:first-child{border-top:0}
        .xt-ignore-row .metrics{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10.5px;color:var(--steel)}
        .xt-ignore-row button{margin-left:auto;border:1px solid var(--line);background:var(--card);color:var(--steel);border-radius:var(--radius-badge);cursor:pointer;font-size:11px;padding:1px 7px}
        .xt-ignore-row button:hover{border-color:var(--warn);color:var(--warn)}
        .xt-wmtr-chip{display:inline-flex;align-items:center;gap:3px}
        .xt-wmtr-chip .lbl{cursor:pointer}
        .xt-chip-x{border:0;background:transparent;color:var(--steel);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;border-radius:3px}
        .xt-chip-x:hover{background:var(--warn);color:#fff}
        .xt-icon-btn{border:1px solid var(--line);background:var(--card);color:var(--steel);width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin-left:8px;vertical-align:middle}
        .xt-icon-btn:hover{border-color:var(--accent);color:var(--accent)}
        .xt-untagged{margin:8px 0 2px;border:1px solid var(--line);border-radius:var(--radius-panel);padding:10px 12px;background:var(--paper)}
        .xt-untagged h5{margin:0 0 4px;font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:12px;color:var(--ink)}
        .xt-untagged .hint{margin-bottom:8px}
        .xt-untagged ul{margin:0;padding:0;list-style:none;columns:2;column-gap:24px}
        .xt-untagged li{font-family:var(--mono);font-size:12px;padding:2px 0;break-inside:avoid}
        .xt-untagged li .files{color:var(--steel);font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10px;margin-left:6px}
      </style>

      <div class="panel-head"><h2>Christmas Tree</h2><span class="count">${loaded ? rows.length + " WMTRs" : "no UDQs loaded"}${
        untagged.length ? `<button class="xt-icon-btn" id="xtUntaggedBtn" type="button" title="${untagged.length} untagged WMTR${untagged.length === 1 ? "" : "s"} were found and skipped — click to view">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        </button>` : ""
      }</span></div>
      <div class="panel-body">

        ${untagged.length ? `
        <div class="xt-untagged hidden" id="xtUntaggedBox">
          <h5>Untagged WMTRs — skipped (${untagged.length})</h5>
          <div class="hint">These WMTRs carry no service suffix (<code>-SRF</code> / <code>/PR</code> / <code>/WS</code> / <code>/PMCT</code>). They're deleted records, so they're excluded from the tree. Listed here for reference only.</div>
          <ul>${untagged.map((u) => `<li>${esc(u.wmtr)}<span class="files">${esc(u.files.join(" · "))}</span></li>`).join("")}</ul>
        </div>` : ""}

        <input type="file" id="xtFileInput" accept=".xlsx,.xlsm" multiple class="hidden">

        <div class="btnrow xt-actionrow" style="margin-bottom:8px">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <select id="xtFetchSvc" class="xt-fetch-select" title="Which service to fetch from ATLAS">
              <option value="all">All WMTR</option>
              <option value="SRF">SRF only</option>
              <option value="PR">PR only</option>
              <option value="PMCT">PMCT only</option>
              <option value="WS">WS only</option>
            </select>
            <button class="btn primary" id="xtFetch" type="button">Fetch from ATLAS</button>
          </span>
          <button class="btn ghost" id="xtLoadFile" type="button" title="Load service UDQ export(s) from a file — you can also drag files onto this panel">Load file&hellip;</button>
          <button class="btn ghost" id="xtClear" type="button" ${loaded ? "" : "disabled"}>Clear</button>
          <button class="btn ghost" id="xtHolidaysBtn" type="button">Holidays&hellip;</button>
          <button class="btn ghost" id="xtIgnoreBtn" type="button">Ignored${ignoreCount ? ` (${ignoreCount})` : ""}&hellip;</button>
          <div class="xt-slots">${slotChips}</div>
        </div>
        <div class="xt-holidays hidden" id="xtHolidaysBox">
          <div class="hint">Working-day calculations skip weekends and these dates (one ISO date <code>YYYY-MM-DD</code> per line). Saved to this browser.</div>
          <textarea id="xtHolidaysText" spellcheck="false"></textarea>
          <div class="btnrow" style="margin-top:6px">
            <button class="btn primary" id="xtHolidaysSave" type="button">Save holidays</button>
            <button class="btn ghost" id="xtHolidaysReset" type="button">Reset to default</button>
          </div>
        </div>

        <div class="xt-ignorebox hidden" id="xtIgnoreBox">
          <div class="hint">WMTRs listed here are excluded from the chosen metric flag (or all flags). Saved to this browser. To add, use the \u00d7 on a WMTR in the Issues panel, or the form below.</div>
          <div class="xt-ignore-add">
            <input type="text" id="xtIgnoreWmtr" placeholder="WMTR (e.g. WMTR-25-1-P-TN-10001 or 10001)" spellcheck="false">
            <select id="xtIgnoreMetric">${Object.entries(XT_METRIC_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
            <button class="btn primary" id="xtIgnoreAdd" type="button">Ignore</button>
          </div>
          <div id="xtIgnoreList"></div>
        </div>

        <div class="statusline" id="xtStatus">${esc(XTree.status)}</div>

        ${loaded ? xtRollupPanelHtml() : ""}

        ${loaded ? `
        <div class="panel mx-control xt-section" style="margin-top:12px">
          <div class="xt-section-head" id="xtWinToggle" role="button" tabindex="0" aria-expanded="${XTree.windowPickerOpen ? "true" : "false"}">
            <span class="xt-caret">${XTree.windowPickerOpen ? "\u25be" : "\u25b8"}</span>
            <h3>Reporting window</h3>
            <span class="mx-windowlabel" id="xtWinLabel">${esc(XTree.window.label)}</span>
            <span class="xt-section-hint">Pick a quarter in the rollup above, or expand for a custom range</span>
          </div>
          <div class="body${XTree.windowPickerOpen ? "" : " hidden"}" id="xtWinBody">
            <div class="mx-quickrow">
              <div class="btnrow" style="flex-wrap:wrap;gap:6px;">
                <button class="btn ghost mx-quick" data-q="all">All time</button>
                <button class="btn ghost mx-quick" data-q="cfy">Current FY</button>
                <button class="btn ghost mx-quick" data-q="pfy">Previous FY</button>
                <button class="btn ghost mx-quick" data-q="cq">Current Qtr</button>
                <button class="btn ghost mx-quick" data-q="pq">Previous Qtr</button>
                <button class="btn ghost mx-quick" data-q="h1">FY First Half</button>
                <button class="btn ghost mx-quick" data-q="h2">FY Second Half</button>
              </div>
            </div>
            <div class="mx-customrow">
              <div class="field"><label for="xtWinStart">Custom start</label><input type="date" id="xtWinStart"></div>
              <div class="field"><label for="xtWinEnd">Custom end</label><input type="date" id="xtWinEnd"></div>
              <div class="field mx-applycell"><button class="btn primary" id="xtWinApply" type="button">Apply range</button></div>
              <div class="hint mx-windowhint">Fiscal year starts Oct 1. Scoped by <strong>Delivery / Completed date</strong>. Active (undelivered) requests aren\u2019t dated, so they\u2019re controlled separately by the Active toggle below. "All time" shows every dated WMTR.</div>
            </div>
          </div>
        </div>

        <div class="xt-controls">
          <div class="field">
            <label>Service</label>
            <div class="xt-seg" id="xtFilter">
              ${["ALL"].concat(XT_SERVICES).map((s) =>
                `<button data-f="${s}" class="${XTree.filter === s ? "active" : ""}">${s === "ALL" ? "All" : s}</button>`).join("")}
            </div>
          </div>
          <div class="field">
            <label>Sort by</label>
            <div class="xt-seg" id="xtSort">
              <button data-s="wmtr" class="${XTree.sort === "wmtr" ? "active" : ""}">WMTR #</button>
              <button data-s="service" class="${XTree.sort === "service" ? "active" : ""}">Service</button>
            </div>
          </div>
          <div class="field">
            <label>View</label>
            <div class="xt-seg" id="xtViewSeg">
              <button data-v="table" class="${XTree.view === "table" ? "active" : ""}">Table (scroll)</button>
              <button data-v="stack" class="${XTree.view === "stack" ? "active" : ""}">Stacked</button>
            </div>
          </div>
          <div class="field">
            <label>Show</label>
            <div class="xt-seg" id="xtShowSeg">
              <button data-o="all" class="${XTree.issuesOnly ? "" : "active"}">All (${allRows.length})</button>
              <button data-o="issues" class="${XTree.issuesOnly ? "active" : ""}">Issues only (${issueSummary.flaggedRows})</button>
            </div>
          </div>
          <div class="field">
            <label>Grouping</label>
            <div class="xt-seg" id="xtGroupSeg">
              <button data-g="flat" class="${XTree.grouping === "flat" ? "active" : ""}">Flat</button>
              <button data-g="quarter" class="${XTree.grouping === "quarter" ? "active" : ""}">By FY qtr</button>
            </div>
          </div>
          <div class="field">
            <label>Active</label>
            <div class="xt-seg" id="xtActiveSeg">
              <button data-a="hidden" class="${XTree.activeMode === "hidden" ? "active" : ""}">Hidden</button>
              <button data-a="bottom" class="${XTree.activeMode === "bottom" ? "active" : ""}">At bottom</button>
              <button data-a="only" class="${XTree.activeMode === "only" ? "active" : ""}">Active only</button>
            </div>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="xt-flagbtn ${issueSummary.total ? "" : "clean"}" id="xtFlagBtn" type="button" title="Show every missed / late metric and the WMTRs it affects">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              ${issueSummary.total ? `<span>Issues</span> <span class="n">${issueSummary.total}</span> <span class="xt-flagbtn-sub">\u00b7 <span class="n">${issueSummary.flaggedRows}</span> WMTR${issueSummary.flaggedRows === 1 ? "" : "s"}</span>` : `<span>No issues</span>`}
            </button>
          </div>
          <div class="field" style="margin-left:auto">
            <label>&nbsp;</label>
            <button class="btn primary" id="xtExport" type="button">Export tracker (.xlsx)</button>
          </div>
        </div>
        ${issueSummary.total ? `
        <div class="xt-flagpanel hidden" id="xtFlagPanel">
          <h4>\u2691 Missed &amp; late metrics</h4>
          <div class="sub">${issueSummary.total} issue${issueSummary.total === 1 ? "" : "s"} across ${issueSummary.flaggedRows} WMTR${issueSummary.flaggedRows === 1 ? "" : "s"}. Click a WMTR to isolate it in the table.</div>
          ${issueSummary.list.map((grp) => `
            <div class="xt-issue-group">
              <div class="xt-issue-head">
                <span class="xt-issue-dot ${grp.kind}"></span>
                <span class="xt-issue-title">${esc(grp.label)}<span class="cnt">${grp.wmtrs.length}</span></span>
              </div>
              <div class="xt-wmtr-chips">
                ${grp.wmtrs.map((w) => `<span class="xt-wmtr-chip" data-wmtr="${esc(w.request_no)}" data-metric="${esc(grp.metric)}"><span class="lbl">${esc(w.request_no.replace(/^WMTR-/, ""))}<span class="svc"> ${esc(w.service)}</span></span><button class="xt-chip-x" title="Ignore this metric for this WMTR" aria-label="Ignore">\u00d7</button></span>`).join("")}
              </div>
            </div>`).join("")}
        </div>` : ""}
        <div id="xtViewHost"></div>
        ` : `<div class="hint" style="margin-top:10px">Load at least one service UDQ to build the tracker.</div>`}
      </div>
    </div>`);

  container.appendChild(panel);

  // Browse via the "Load file…" button; drag-drop still works anywhere on the
  // Christmas Tree panel (the big dropzone box was removed — fetch is primary).
  const input = panel.querySelector("#xtFileInput");
  const loadBtn = panel.querySelector("#xtLoadFile");
  if (loadBtn) loadBtn.addEventListener("click", () => input.click());
  panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("xt-dragover"); });
  panel.addEventListener("dragleave", (e) => { if (e.target === panel) panel.classList.remove("xt-dragover"); });
  panel.addEventListener("drop", (e) => {
    e.preventDefault(); panel.classList.remove("xt-dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) xtIngestFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", () => { xtIngestFiles(input.files); input.value = ""; });

  panel.querySelector("#xtFetch").addEventListener("click", () => {
    const sel = panel.querySelector("#xtFetchSvc");
    xtFetchFromAtlas(sel ? sel.value : "all");
  });
  const untaggedBtn = panel.querySelector("#xtUntaggedBtn");
  if (untaggedBtn) untaggedBtn.addEventListener("click", () =>
    panel.querySelector("#xtUntaggedBox").classList.toggle("hidden"));
  const clr = panel.querySelector("#xtClear");
  if (clr && !clr.disabled) clr.addEventListener("click", xtClearAll);
  panel.querySelectorAll(".xt-slot-x").forEach((b) =>
    b.addEventListener("click", () => xtClearSlot(b.getAttribute("data-clear-svc"))));

  // Holidays editor.
  const holBtn = panel.querySelector("#xtHolidaysBtn");
  const holBox = panel.querySelector("#xtHolidaysBox");
  const holText = panel.querySelector("#xtHolidaysText");
  holText.value = xtGetHolidays().join("\n");
  holBtn.addEventListener("click", () => holBox.classList.toggle("hidden"));
  panel.querySelector("#xtHolidaysSave").addEventListener("click", () => {
    const list = holText.value.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    xtSetHolidays(list);
    xtSetStatus(`Saved ${list.length} holiday date${list.length === 1 ? "" : "s"}.`, false);
    renderWorkspace();
  });
  panel.querySelector("#xtHolidaysReset").addEventListener("click", () => {
    xtSetHolidays(XT_DEFAULT_HOLIDAYS.slice());
    renderWorkspace();
  });

  // Ignore list management
  const ignBtn = panel.querySelector("#xtIgnoreBtn");
  const ignBox = panel.querySelector("#xtIgnoreBox");
  if (ignBtn && ignBox) {
    ignBtn.addEventListener("click", () => ignBox.classList.toggle("hidden"));
    xtRenderIgnoreList(panel.querySelector("#xtIgnoreList"));
    panel.querySelector("#xtIgnoreAdd").addEventListener("click", () => {
      const raw = panel.querySelector("#xtIgnoreWmtr").value.trim();
      if (!raw) return;
      // Accept a full WMTR or just the trailing number; resolve to a loaded request #.
      let wmtr = raw;
      if (/^\d{4,6}$/.test(raw)) {
        const match = allRows.find((r) => xtWmtrNumber(r.request_no) === parseInt(raw, 10));
        if (match) wmtr = match.request_no;
      }
      xtAddIgnore(xtStripSuffix(wmtr), panel.querySelector("#xtIgnoreMetric").value);
      renderWorkspace();
    });
  }

  if (loaded) {
    const seg = (sel, attr, apply) => panel.querySelectorAll(`${sel} button`).forEach((b) =>
      b.addEventListener("click", () => { apply(b.getAttribute(attr)); renderWorkspace(); }));
    seg("#xtFilter", "data-f", (v) => XTree.filter = v);
    seg("#xtSort", "data-s", (v) => XTree.sort = v);
    seg("#xtViewSeg", "data-v", (v) => XTree.view = v);
    seg("#xtShowSeg", "data-o", (v) => XTree.issuesOnly = (v === "issues"));
    seg("#xtGroupSeg", "data-g", (v) => XTree.grouping = v);
    seg("#xtActiveSeg", "data-a", (v) => XTree.activeMode = v);
    panel.querySelector("#xtExport").addEventListener("click", () => xtExportXlsx());
    const rx = panel.querySelector("#xtRollupXlsx"); if (rx) rx.addEventListener("click", () => xtExportMetricsXlsx());
    const rp = panel.querySelector("#xtRollupPdf"); if (rp) rp.addEventListener("click", () => xtExportMetricsPdf());
    // Rollup cells: clicking any scored cell scopes the reporting window to that
    // quarter (the Total column -> All time). If the cell is flagged (red/yellow),
    // it ALSO switches the table to Issues-only and drills the metric so you land
    // on exactly the requests that made the box red.
    panel.querySelectorAll("td.xtr-qcell").forEach((td) =>
      td.addEventListener("click", () => {
        const q = td.getAttribute("data-qcell-q");
        const flagged = td.hasAttribute("data-drill-metric");
        if (q === "__total__") {
          XTree.window = { quick: "all", start: null, end: null, label: "All time" };
        } else {
          const qh = panel.querySelector(`th[data-qwin="${(window.CSS && CSS.escape) ? CSS.escape(q) : q}"]`);
          if (qh) XTree.window = { quick: "q", start: qh.getAttribute("data-qwin-start") || null, end: qh.getAttribute("data-qwin-end") || null, label: q };
        }
        if (flagged) {
          XTree.issuesOnly = true;                          // red box -> hone in on the offending requests
          const m = td.getAttribute("data-drill-metric");
          const cur = XTree.rollupDrill;
          XTree.rollupDrill = (cur && cur.metric === m && cur.quarter === q) ? null : { metric: m, quarter: q };
        }
        renderWorkspace();
      }));
    const drillClose = panel.querySelector("#xtRollupDrillClose");
    if (drillClose) drillClose.addEventListener("click", () => { XTree.rollupDrill = null; renderWorkspace(); });
    const extraToggle = panel.querySelector("#xtRollupExtraToggle");
    if (extraToggle) extraToggle.addEventListener("click", () => { XTree.rollupExtraOpen = !XTree.rollupExtraOpen; renderWorkspace(); });
    panel.querySelectorAll("#xtRollupDrill .xt-wmtr-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        xtPendingFocus = chip.getAttribute("data-wmtr");
        if (XTree.issuesOnly && !rows.some((r) => r.request_no === xtPendingFocus)) XTree.issuesOnly = false;
        if (XTree.filter !== "ALL" && !rows.some((r) => r.request_no === xtPendingFocus)) XTree.filter = "ALL";
        if (XTree.view !== "table") { XTree.view = "table"; renderWorkspace(); }
        else xtRenderView(panel.querySelector("#xtViewHost"), rows);
      }));

    // Reporting window (mirrors the Metrics date picker)
    const winToggle = panel.querySelector("#xtWinToggle");
    if (winToggle) {
      const toggleWin = () => { XTree.windowPickerOpen = !XTree.windowPickerOpen; renderWorkspace(); };
      winToggle.addEventListener("click", toggleWin);
      winToggle.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleWin(); } });
    }
    // Rollup quarter headers = the primary window selector: click a quarter to
    // scope the tracker (and the results table) to that fiscal quarter.
    panel.querySelectorAll("th[data-qwin]").forEach((th) =>
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-qwin");
        const s = th.getAttribute("data-qwin-start") || null;
        const e = th.getAttribute("data-qwin-end") || null;
        // Clicking the already-selected quarter clears back to All time.
        const isActive = XTree.window.start === s && XTree.window.end === e && s;
        XTree.window = isActive
          ? { quick: "all", start: null, end: null, label: "All time" }
          : { quick: "q", start: s, end: e, label: key };
        renderWorkspace();
      }));
    const winStart = panel.querySelector("#xtWinStart");
    const winEnd = panel.querySelector("#xtWinEnd");
    panel.querySelectorAll(".mx-quick").forEach((b) =>
      b.classList.toggle("active", b.dataset.q === XTree.window.quick));
    if (winStart) winStart.value = XTree.window.start || "";
    if (winEnd) winEnd.value = XTree.window.end || "";
    panel.querySelectorAll(".mx-quick").forEach((btn) =>
      btn.addEventListener("click", () => {
        const q = btn.dataset.q;
        const info = xtWindowRange(q);
        XTree.window = { quick: q, start: info.start || null, end: info.end || null, label: xtWindowLabel(q, info.start, info.end) };
        renderWorkspace();
      }));
    const applyBtn = panel.querySelector("#xtWinApply");
    if (applyBtn) applyBtn.addEventListener("click", () => {
      const s = winStart.value, e = winEnd.value;
      if (!s || !e) { xtSetStatus("Pick both a start and an end date.", true); return; }
      if (s > e) { xtSetStatus("Start date is after end date.", true); return; }
      XTree.window = { quick: "custom", start: s, end: e, label: s + " \u2192 " + e };
      renderWorkspace();
    });

    const flagBtn = panel.querySelector("#xtFlagBtn");
    const flagPanel = panel.querySelector("#xtFlagPanel");
    if (flagBtn && flagPanel) {
      flagBtn.addEventListener("click", () => flagPanel.classList.toggle("hidden"));
      flagPanel.querySelectorAll(".xt-wmtr-chip").forEach((chip) => {
        const jump = () => {
          xtPendingFocus = chip.getAttribute("data-wmtr");
          if (XTree.issuesOnly && !rows.some((r) => r.request_no === xtPendingFocus)) XTree.issuesOnly = false;
          if (XTree.view !== "table") { XTree.view = "table"; renderWorkspace(); }
          else xtRenderView(panel.querySelector("#xtViewHost"), rows);
        };
        const lbl = chip.querySelector(".lbl");
        if (lbl) lbl.addEventListener("click", jump);
        const x = chip.querySelector(".xt-chip-x");
        if (x) x.addEventListener("click", (e) => {
          e.stopPropagation();
          xtAddIgnore(chip.getAttribute("data-wmtr"), chip.getAttribute("data-metric"));
          renderWorkspace();
        });
      });
    } else if (flagBtn) {
      flagBtn.addEventListener("click", () => xtSetStatus("No missed or late metrics in the loaded WMTRs.", false));
    }

    xtRenderView(panel.querySelector("#xtViewHost"), rows);
  }
}

function xtRenderView(host, rows) {
  if (!rows.length) { host.innerHTML = `<div class="hint">No WMTRs match this filter.</div>`; return; }
  if (XTree.view === "stack") { xtRenderStacked(host, rows); return; }

  const cols = XT_COLUMNS.filter((c) => !c.hidden);
  const th = cols.map((c, i) =>
    `<th class="${i === 0 ? "stick" : ""}">${esc(c.label)}</th>`).join("");
  const renderRow = (row) => {
    // Whole-row shading so flagged WMTRs are visible without scrolling right to
    // the flagged cell: light pink for a hard issue, light yellow for a warning.
    const kinds = (row.issues || []).map((i) => i.kind);
    const hasRed = kinds.some((k) => k === "missing" || k === "late" || k === "flag");
    const hasWarn = kinds.some((k) => k === "yellow" || k === "due" || k === "variance");
    const rowClass = hasRed ? "xt-row-red" : hasWarn ? "xt-row-warn" : "";
    const rowFlag = hasRed;   // the ⚑ glyph in the first column marks hard issues
    const tds = cols.map((c, i) => {
      const iss = row.issueByCol ? row.issueByCol[c.id] : null;
      const issCls = iss ? ` xt-cell-${iss.kind}` : "";
      const stick = i === 0 ? " stick" : "";
      const num = (c.type === "money" || c.type === "pct") ? " num" : "";
      let inner;
      if (iss && iss.kind === "missing") {
        inner = `<span class="xt-miss" title="${esc(iss.label)}">\u26A0 ${esc(iss.label.length > 22 ? "missing" : iss.label)}</span>`;
      } else if (iss && iss.kind === "due") {
        inner = `<span class="xt-due" title="${esc(iss.label)}">due</span>`;
      } else if (iss && iss.kind === "yellow") {
        inner = `<span class="xt-yellow" title="${esc(iss.label)}">past due</span>`;
      } else {
        const txt = xtFmtCell(row, c);
        inner = (c.type === "badge" && txt) ? `<span class="${xtBadgeClass(txt)}">${esc(txt)}</span>`
              : (i === 0 && rowFlag) ? `<span class="xt-rowflag" title="${esc(row.issues.map((x) => x.label).join("\n"))}">\u2691</span>${esc(txt)}`
              : esc(txt);
      }
      return `<td class="${(stick + num + issCls).trim()}"${iss ? ` title="${esc(iss.label)}"` : ""}>${inner}</td>`;
    }).join("");
    return `<tr class="${rowClass}" data-wmtr="${esc(row.request_no)}">${tds}</tr>`;
  };
  const grpHead = (label, n) =>
    `<tr class="xt-grp"><td colspan="${cols.length}">${esc(label)}<span class="xt-grp-n">${n}</span></td></tr>`;

  // Active/undelivered rows form their own labelled section at the bottom (or the whole
  // table in "active only"). Delivered rows make up the body, optionally grouped by the
  // FY quarter of their delivery/completed date.
  const activeRows = rows.filter((r) => !r.delivered);
  const deliveredRows = rows.filter((r) => r.delivered);
  let body = "";
  if (XTree.grouping === "quarter" && deliveredRows.length) {
    const groups = new Map();
    for (const r of deliveredRows) {
      const q = pmrFyQuarterOf(xtIso(r.delivered));
      const key = q ? q.key : "No fiscal quarter";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const sortVal = (k) => { const m = k.match(/FY(\d+)\s*Q(\d+)/); return m ? (+m[1]) * 10 + (+m[2]) : 9999; };
    for (const [key, grp] of [...groups.entries()].sort((a, b) => sortVal(a[0]) - sortVal(b[0])))
      body += grpHead(key, grp.length) + grp.map(renderRow).join("");
  } else {
    body += deliveredRows.map(renderRow).join("");
  }
  if (activeRows.length)
    body += grpHead("Active / Undelivered", activeRows.length) + activeRows.map(renderRow).join("");

  host.innerHTML =
    `<div class="xt-scrollwrap"><table class="xt-data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;

  if (xtPendingFocus) {
    const tr = host.querySelector(`tr[data-wmtr="${(window.CSS && CSS.escape) ? CSS.escape(xtPendingFocus) : xtPendingFocus}"]`);
    if (tr) {
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      tr.classList.add("xt-focusflash");
      setTimeout(() => tr.classList.remove("xt-focusflash"), 2200);
    }
    xtPendingFocus = null;
  }
}

function xtRenderStacked(host, rows) {
  const cols = XT_COLUMNS.filter((c) => !c.hidden && c.id !== "request_no" && c.id !== "service");
  const cards = rows.map((row) => {
    const flagged = row.issues && row.issues.length;
    const rowFlag = row.issues && row.issues.some((i) => i.kind === "missing" || i.kind === "flag");
    const issueStrip = flagged
      ? `<div class="xt-card-issues">${row.issues.map((x) => `<span class="xt-chip xt-cell-${x.kind}">${esc(x.label)}</span>`).join("")}</div>`
      : "";
    const kv = cols.map((c) => {
      const iss = row.issueByCol ? row.issueByCol[c.id] : null;
      const txt = xtFmtCell(row, c);
      let val;
      if (iss && iss.kind === "missing") val = `<span class="xt-miss">\u26A0 ${esc(iss.label)}</span>`;
      else if (iss && iss.kind === "due") val = `<span class="xt-due">${esc(iss.label)}</span>`;
      else if (iss && iss.kind === "yellow") val = `<span class="xt-yellow">${esc(iss.label)}</span>`;
      else val = (c.type === "badge" && txt) ? `<span class="${xtBadgeClass(txt)}">${esc(txt)}</span>` : esc(txt || "\u2014");
      const vcls = iss ? ` xt-cell-${iss.kind}` : "";
      return `<div class="k">${esc(c.label)}</div><div class="v${vcls}">${val}</div>`;
    }).join("");
    return `<div class="xt-card${rowFlag ? " xt-card-flagged" : ""}">
      <h4><span>${rowFlag ? "\u2691 " : ""}${esc(row.request_no)}</span><span class="svc-tag">${esc(row.service)}</span></h4>
      ${issueStrip}
      <div class="xt-kv">${kv}</div>
    </div>`;
  }).join("");
  host.innerHTML = `<div class="xt-cards">${cards}</div>`;
}

/* -------------------------------------------------------------------------
   EXPORT — SheetJS workbook, sorted by WMTR number (matches the example).
   ------------------------------------------------------------------------- */
function xtColLetter(i1) { let s = "", n = i1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

async function xtExportXlsx() {
  if (typeof XLSX === "undefined") { xtSetStatus("Spreadsheet library not loaded.", true); return; }
  try {
    xtSetStatus("Building tracker\u2026", false);
    // Export the rows currently shown \u2014 respecting the active filters (reporting
    // window, service filter, current sort) and the Issues-only toggle. To export
    // everything, clear the filters first.
    const built = xtAnnotateIssues(xtBuildRows());   // window + service filter + sort applied
    const rows = XTree.issuesOnly ? built.filter((r) => r.issues.length) : built;
    const activeFilters = [];
    if (XTree.issuesOnly) activeFilters.push("Issues only");
    if (XTree.filter !== "ALL") activeFilters.push(`${XTree.filter} only`);
    if (XTree.window && XTree.window.start && XTree.window.end) activeFilters.push(XTree.window.label || "date range");
    if (XTree.activeMode === "only") activeFilters.push("Active only");
    else if (XTree.activeMode === "bottom") activeFilters.push("+ active");
    const isFiltered = activeFilters.length > 0;
    if (!rows.length) { xtSetStatus("Nothing to export \u2014 the current filter matches no records.", true); return; }

    const aoa = [XT_COLUMNS.map((c) => c.label)];
    for (const row of rows) {
      aoa.push(XT_COLUMNS.map((c) => {
        const v = row[c.id];
        if (v === null || v === undefined || v === "") return "";
        if (c.type === "date")  return v instanceof Date ? v : "";
        if (c.type === "money" || c.type === "pct") return typeof v === "number" ? v : "";
        return String(v);
      }));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cols = [];
    XT_COLUMNS.forEach((c, ci) => {
      let width = Math.max(c.label.length, 9);
      for (let ri = 1; ri <= range.e.r; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (!cell || cell.v === "" || cell.v == null) continue;
        if (c.type === "date" && cell.v instanceof Date) { cell.t = "d"; cell.z = "m/d/yyyy"; }
        else if (c.type === "money") { cell.t = "n"; cell.z = "#,##0.00"; }
        else if (c.type === "pct")   { cell.t = "n"; cell.z = "0.0%"; }
        width = Math.max(width, String(cell.w || cell.v).length);
      }
      cols.push({ wch: Math.min(width + 2, 40) });
    });
    ws["!cols"] = cols;
    ws["!autofilter"] = { ref: ws["!ref"] };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "WMTR");
    const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" });

    // Which cells to highlight (baked from computed issues; no reliance on CF).
    const flags = {};
    rows.forEach((row, ri) => {
      const r = ri + 2;
      XT_COLUMNS.forEach((c, ci) => {
        const iss = row.issueByCol && row.issueByCol[c.id];
        if (iss) flags[xtColLetter(ci + 1) + r] = iss.kind;
      });
    });

    const b64 = (typeof JSZip !== "undefined")
      ? await xtStyleWorkbook(arr, XT_COLUMNS.length, flags)
      : xtArrayToBase64(arr);

    const fname = `Christmas_Tree${isFiltered ? "_filtered" : ""}_${fileStamp()}.xlsx`;
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
    a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    xtSetStatus(`\u2705 Exported ${fname} (${rows.length} WMTR${rows.length === 1 ? "" : "s"}${isFiltered ? " \u2014 " + activeFilters.join(" \u00b7 ") : ""}, ${Object.keys(flags).length} flagged cells).`, false);
  } catch (e) {
    console.error(e);
    xtSetStatus(`Couldn't build the export: ${e.message || e}`, true);
  }
}

function xtArrayToBase64(arr) {
  let bin = ""; const bytes = new Uint8Array(arr);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Post-process the SheetJS xlsx (as Uint8Array) to add a styled header band,
    freeze panes, and red/amber highlighting on the flagged cells — via JSZip,
    the same surgery pattern the ECM/PL exporters use. Returns base64. */
async function xtStyleWorkbook(arr, ncols, flags) {
  const zip = await JSZip.loadAsync(arr);
  let styles = await zip.file("xl/styles.xml").async("string");

  // fonts: header (bold white), red, amber
  const fontsCount = parseInt(styles.match(/<fonts count="(\d+)"/)[1], 10);
  const headerFontId = fontsCount, redFontId = fontsCount + 1, amberFontId = fontsCount + 2;
  styles = styles
    .replace(/<fonts count="\d+">/, `<fonts count="${fontsCount + 3}">`)
    .replace(/<\/fonts>/,
      `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
      `<font><sz val="12"/><color rgb="FF9C0006"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="12"/><color rgb="FFB8530B"/><name val="Calibri"/></font></fonts>`);

  // fills: header navy, red tint, amber tint
  const fillsCount = parseInt(styles.match(/<fills count="(\d+)"/)[1], 10);
  const headerFillId = fillsCount, redFillId = fillsCount + 1, amberFillId = fillsCount + 2;
  styles = styles
    .replace(/<fills count="\d+">/, `<fills count="${fillsCount + 3}">`)
    .replace(/<\/fills>/,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF16283C"/></patternFill></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFFDE7E7"/></patternFill></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF6E5"/></patternFill></fill></fills>`);

  // cellXfs: header + red/amber variants of every existing xf (format-preserving)
  const block = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  const baseCount = parseInt(block[1], 10);
  const baseXfs = block[2].match(/<xf[^>]*\/>|<xf[^>]*>[\s\S]*?<\/xf>/g) || [];
  const numFmtOf = baseXfs.map((xf) => (xf.match(/numFmtId="(\d+)"/) || [0, "0"])[1]);
  const headerXf = baseCount;
  const redXf = [], amberXf = [];
  let extra = `<xf numFmtId="0" fontId="${headerFontId}" fillId="${headerFillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`;
  let idx = baseCount + 1;
  for (let i = 0; i < baseCount; i++) { redXf[i] = idx++; extra += `<xf numFmtId="${numFmtOf[i]}" fontId="${redFontId}" fillId="${redFillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`; }
  for (let i = 0; i < baseCount; i++) { amberXf[i] = idx++; extra += `<xf numFmtId="${numFmtOf[i]}" fontId="${amberFontId}" fillId="${amberFillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`; }
  styles = styles
    .replace(/<cellXfs count="\d+">/, `<cellXfs count="${idx}">`)
    .replace(/<\/cellXfs>/, extra + "</cellXfs>");
  zip.file("xl/styles.xml", styles);

  // sheet: freeze header + first column, stamp header + flagged cells
  const SHEET = "xl/worksheets/sheet1.xml";
  let xml = await zip.file(SHEET).async("string");
  if (!/<pane /.test(xml)) {
    xml = xml.replace(/<sheetView([^>]*)\/>/, `<sheetView$1><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView>`);
    if (!/<pane /.test(xml)) xml = xml.replace(/(<sheetView[^>]*>)/, `$1<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>`);
  }
  const setS = (ref, s) => {
    const re = new RegExp(`(<c r="${ref}")( s="\\d+")?([ />])`);
    if (re.test(xml)) { xml = xml.replace(re, `$1 s="${s}"$3`); return true; }
    return false;
  };
  for (let ci = 0; ci < ncols; ci++) setS(xtColLetter(ci + 1) + "1", headerXf);
  for (const ref of Object.keys(flags)) {
    const m = xml.match(new RegExp(`<c r="${ref}"( s="(\\d+)")?`));
    const baseS = (m && m[2]) ? parseInt(m[2], 10) : 0;
    const target = (flags[ref] === "variance") ? amberXf[baseS] : redXf[baseS];
    if (!setS(ref, target)) {
      const rowNum = ref.match(/\d+$/)[0];
      xml = xml.replace(new RegExp(`(<row r="${rowNum}"[^>]*>)`), `$1<c r="${ref}" s="${target}"/>`);
    }
  }
  zip.file(SHEET, xml);

  return await zip.generateAsync({ type: "base64" });
}

/* Node/Jest export hook (browser ignores this) for offline parity testing. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    XT_COLUMNS, XTree, xtParseDate, xtIso, xtWorkday, xtOnTimeLate,
    xtClassifyService, xtParseRecords, xtBuildRow, xtBuildRows,
    xtStripSuffix, xtWmtrNumber, xtActionFromStatus, xtSetHolidays,
    xtBuildRollup, xtRollupRows, xtRollupPanelHtml, XT_ROLLUP_METRICS,
    xtRollupFlatFails, xtExportMetricsXlsx, xtExportMetricsPdf, xtPdfSafe,
  };
}
