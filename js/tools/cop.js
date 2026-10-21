/* =========================================================================
   ATLAS Utility Web — tools/cop.js
   "COP" — Common Operational Picture (new in 2.5.95).

   WHAT IT DOES
     One view of every active shipment (SRF) in a Metrics UDQ: a pipeline strip
     of the eight workflow lanes across the top, and a table of shipments below
     it. Each shipment carries a checklist of what has to be done at each step
     before it moves to the next one, so a shipper can see what's left on their
     own requests and a manager can see every request, by lane and by TTI POC,
     and spot missed metrics or skipped requirements between steps.

   WHERE THE RULES COME FROM
     The stage checklists were agreed with the shipping lead (questionnaire,
     21 Oct 2026 — see NOTES.md): TTI Quality Review items from the Step-by-Step,
     the Required Docs Checklist split by when each document is due, the RFQ /
     Pack Date / AES-ITN / MARAD dates from the TTI Ops Tracker, and "stuck"
     day limits per lane. Checks the Christmas Tree already makes (rejected,
     manual flag, cost vs. approved amount, delivered after RDD, Ready to
     Invoice / Invoiced) are taken from its own engine (xtBuildRow /
     xtRowIssues) so the two views can't disagree, and its per-WMTR
     acknowledgement list is shared.

   HOW A CHECK IS JUDGED
     Each requirement belongs to the stage it must be finished in. While the
     shipment sits in that stage an unmet item is simply "to do"; once the
     shipment has moved past it, an unmet required item is red and an unmet
     recommended item is amber. Items with a clock (RFQ within 1 business day,
     daily updates, RDD, ITN before departure, MARAD, stuck limits) go amber /
     red on their own dates wherever the shipment is.

   OPS TRACKER
     RFQ Sent, Date Packed, AES Class, ITN / NOEEI Citation, Estimated Export
     Date and the MARAD dates aren't in ATLAS yet, so they're read from the Ops
     Tracker workbook ("Active MTR" tab). Drop it on the COP (or the main drop
     zone) whenever it's updated; the last one loaded is kept in this browser.
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIG — lanes, status mapping, defaults (edit here if ATLAS renames).
   ------------------------------------------------------------------------- */
const COP_LANES = [
  { id: "draft",      label: "Draft",                  short: "Draft" },
  { id: "qr",         label: "TTI Quality Review",     short: "TTI QR" },
  { id: "program",    label: "DTRA Program Review",    short: "Program" },
  { id: "compliance", label: "DTRA Compliance Review", short: "Compliance" },
  { id: "estimate",   label: "Estimate",               short: "Estimate" },
  { id: "ready",      label: "Ready to Ship",          short: "Ready" },
  { id: "transit",    label: "In Transit",             short: "Transit" },
  { id: "delivered",  label: "Delivered",              short: "Delivered" },
];
const COP_LANE_IDX = {};
COP_LANES.forEach((l, i) => { COP_LANE_IDX[l.id] = i; });
const COP_CLOSED_IDX = COP_LANES.length;   // "past every lane" — closed requests

/* ATLAS Status (lower-case) -> lane. Approval-workflow statuses and the
   shipping-activity statuses share the one Status field. */
const COP_STATUS_LANE = {
  "draft": "draft",
  "tti quality review": "qr",
  "dtra program review": "program",
  "dtra compliance review": "compliance",
  "tti estimate preparation": "estimate",
  "ct program > 100k approval": "estimate",
  "dtra estimate review": "estimate",
  "dtra approved": "ready",
  "pending": "ready",
  "scheduled": "ready",
  "picked up": "transit",
  "in transit": "transit",
  "arrived warehouse": "transit",
  "departed warehouse": "transit",
  "arrived pol": "transit",
  "departed pol": "transit",
  "arrived transshipment port": "transit",
  "departed transshipment port": "transit",
  "arrived pod": "transit",
  "departed pod": "transit",
  "awaiting customs clearance": "transit",
  "cleared customs": "transit",
  "out for delivery": "transit",
  "delivered - pending pod": "delivered",
  "delivered - pod received": "delivered",
};
/* Problem statuses: the shipment keeps its last real lane and gets a red badge. */
const COP_PROBLEM_STATUSES = new Set([
  "delayed", "on hold", "exception", "failed delivery attempt", "returned to sender",
]);
/* Closed requests fall off the default view (Closed view lists them). */
function copIsClosedStatus(low) {
  return /^(completed|ready to invoice|invoiced|cancel+ed( with (charges|costs))?|shipment cancel+ed)$/.test(low);
}

/* "Stuck" limits — business days in a lane before amber / red. Editable in the
   COP's settings box; In Transit has none (RDD + daily updates cover it). */
const COP_STUCK_DEFAULTS = {
  draft:         [10, 20],
  qr:            [2, 3],
  program:       [3, 5],
  compliance:    [3, 5],
  estimate_tti:  [2, 3],
  estimate_dtra: [3, 5],
  ready:         [10, 20],
  delivered:     [5, 10],
};
const COP_STUCK_LABELS = {
  draft: "Draft (requestor)", qr: "TTI Quality Review", program: "DTRA Program Review",
  compliance: "DTRA Compliance Review", estimate_tti: "Estimate — TTI preparation",
  estimate_dtra: "Estimate — DTRA / CT review", ready: "Ready to Ship",
  delivered: "Delivered → Completed",
};
const COP_RDD_WARN_BDAYS = 5;      // amber when the RDD is this many business days away
const COP_DUE_SOON_DAYS = 5;       // ETD / MARAD "coming due" window (calendar days)
const COP_PLACARD_TYPE_ISO = "2026-10-21";   // ATLAS "Pallet Placard" attachment type added
const COP_CHECK_ESTIMATE = false;            // "Estimate attached" check (Request Estimate List) — off for now
// MARAD report due: working days after loading (Departure from Origin Act. Date),
// per 46 CFR 381.3 — 20 for cargo from the US, 30 for cargo from abroad.
const COP_MARAD_WORKDAYS_US = 20;
const COP_MARAD_WORKDAYS_FOREIGN = 30;

const COP_PREFS_KEY = "atlas.cop.prefs";
const COP_TRACKER_KEY = "atlas.cop.tracker";

/* Attachment types (ATLAS "Type" column) per document. */
const COP_DOC_TYPES = {
  po:      ["Purchase Order"],
  civ:     ["Commercial/Proforma Invoices"],
  civAny:  ["Commercial/Proforma Invoices", "Draft CIV"],
  pkl:     ["Packing List"],
  sli:     ["Shippers Letter of Instructions"],
  aes:     ["Automated Export System (AES) records", "MFR_NO AES"],
  photo:   ["TRLS Label Photo", "Photo", "Image"],
  placard: ["Pallet Placard"],
  rc:      ["RC"],
  dgd:     ["Dangerous Goods Declaration"],
  awb:     ["Carrier waybills", "Bills of Lading", "House waybills"],
  vat:     ["VAT Exemption"],
  pod:     ["Proof of Delivery"],
  mct:     ["MCT"],
  vinv:    ["Vendor Invoice"],
  bid:     ["Vendor Bid"],
  rfq:     ["RFQ Email", "RFQ Attachment"],
  rdd:     ["Approval to Adjust RDD"],
};

/* Acknowledgement keys (shared with the Christmas Tree ignore list). Labels are
   registered so the Tree's "Ignored" box names them properly. */
const COP_ACK_LABELS = {
  "cop.status": "COP: problem status", "cop.redflag": "COP: Red Flag", "cop.stuck": "COP: time in lane",
  "cop.rdd": "COP: RDD", "cop.tracker": "COP: on Ops Tracker",
  "cop.parties": "COP: addresses & POCs", "cop.invbasic": "COP: inventory basics", "cop.eccn": "COP: ECCN/USML",
  "cop.hts": "COP: Schedule B/HTS", "cop.coo": "COP: country of origin", "cop.shipfields": "COP: shipment fields",
  "cop.value": "COP: line values", "cop.wtdims": "COP: weights/dims", "cop.temphaz": "COP: temp/HAZMAT",
  "cop.shipgroup": "COP: Ship Group #", "cop.civearly": "COP: CIV before compliance", "cop.dps": "COP: Denied Party Screen",
  "cop.auth": "COP: BIS/DDTC authorization", "cop.rfq": "COP: RFQ sent", "cop.costlist": "COP: cost list",
  "cop.totalcost": "COP: total cost", "cop.estimate": "COP: estimate attached", "cop.100k": "COP: >$100K approval",
  "cop.bid": "COP: vendor quotes", "cop.rfqdoc": "COP: RFQ email uploaded", "cop.costsum": "COP: total = cost list",
  "cop.packed": "COP: pack date", "cop.itn": "COP: AES / ITN", "cop.awb": "COP: AWB/BoL", "cop.marad": "COP: MARAD",
  "cop.deldate": "COP: Delivery Date", "cop.podstatus": "COP: POD status",
};
["po", "civ", "civAny", "pkl", "sli", "aes", "photo", "placard", "rc", "dgd", "vat", "pod", "mct", "vinv"]
  .forEach((k) => { COP_ACK_LABELS["cop.doc." + k] = "COP: " + k.toUpperCase() + " document"; });
if (typeof XT_METRIC_LABELS !== "undefined") {
  for (const k of Object.keys(COP_ACK_LABELS)) if (!XT_METRIC_LABELS[k]) XT_METRIC_LABELS[k] = COP_ACK_LABELS[k];
}

/* Check states. rank orders the worst first; cls drives the colour. */
const COP_STATES = {
  fail:    { word: "Missed",       icon: "✕", cls: "bad",  rank: 0 },
  warn:    { word: "Attention",    icon: "!",      cls: "warn", rank: 1 },
  due:     { word: "Due soon",     icon: "◷", cls: "warn", rank: 2 },
  open:    { word: "To do",        icon: "□", cls: "open", rank: 3 },
  unknown: { word: "No data",      icon: "?",      cls: "na",   rank: 4 },
  ack:     { word: "Acknowledged", icon: "✓", cls: "ack",  rank: 5 },
  later:   { word: "Later step",   icon: "○", cls: "na",   rank: 6 },
  na:      { word: "N/A",          icon: "–", cls: "na",   rank: 7 },
  ok:      { word: "Done",         icon: "✓", cls: "good", rank: 8 },
};

/* -------------------------------------------------------------------------
   STATE
   ------------------------------------------------------------------------- */
const CopUi = {
  view: "active",       // "active" | "closed"
  scope: null,          // "mine" | "all" (null = pick from prefs on first render)
  poc: "",              // TTI POC filter ("" = all)
  lane: "",             // lane filter ("" = all)
  atRisk: false,        // only shipments with a red/amber item
  rddDays: 0,           // only RDD within N calendar days (0 = any)
  stuckOnly: false,
  hit: "",              // check id — only shipments missing it ("Find metric hits")
  q: "",
  expanded: new Set(),  // WMTRs with the checklist open
  settingsOpen: false,
  msg: "",
  _parsed: null,        // { grid, data } — parse cache keyed by grid identity
};

/* ---- prefs (me + stuck limits) ---- */
function copGetPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(COP_PREFS_KEY) || "{}") || {}; } catch (e) { p = {}; }
  if (typeof p !== "object") p = {};
  p.stuck = Object.assign({}, COP_STUCK_DEFAULTS, (p.stuck && typeof p.stuck === "object") ? p.stuck : {});
  p.me = typeof p.me === "string" ? p.me : "";
  return p;
}
function copSetPrefs(p) {
  try { localStorage.setItem(COP_PREFS_KEY, JSON.stringify(p)); } catch (e) { /* storage off */ }
}

/* -------------------------------------------------------------------------
   SMALL HELPERS
   ------------------------------------------------------------------------- */
function copLow(v) { return normWs(v).toLowerCase(); }
/** Workflow-log status with its "(Approved)" / "(Rejected)" suffix removed. */
function copBaseStatus(s) { return copLow(s).replace(/\s*\((approved|rejected)\)\s*$/, ""); }
function copLaneOf(status) { return COP_STATUS_LANE[copBaseStatus(status)] || null; }
function copHasType(types, allowed) {
  const set = new Set((types || []).map((t) => copLow(t)).filter(Boolean));
  return allowed.some((a) => set.has(copLow(a)));
}
function copFmt(d) { return d instanceof Date ? xtDisplayDate(d) : ""; }
function copIsoToDate(s) { return s ? xtParseDate(s) : null; }
function copToday() { return xtDayStart(new Date()); }
function copIsWorkday(d) { return !xtIsWeekend(d) && !xtIsHoliday(d); }
/** Working days strictly after `from` up to and including `to` (0 when to <= from). */
function copBizDaysBetween(from, to) {
  if (!from || !to) return null;
  let n = 0;
  for (let d = xtAddDays(from, 1); d.getTime() <= xtDayStart(to).getTime(); d = xtAddDays(d, 1)) if (copIsWorkday(d)) n++;
  return n;
}
function copCalDays(from, to) { return Math.round((xtDayStart(to).getTime() - xtDayStart(from).getTime()) / 86400000); }
function copMoney(v) {
  return typeof v === "number" ? "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}
function copPlural(n, w) { return `${n} ${w}${n === 1 ? "" : "s"}`; }
function copShortCountry(s) { const m = norm(s).match(/^(.*?)\s+-\s+[A-Z0-9]{1,3}$/); return m ? m[1] : norm(s); }

/* -------------------------------------------------------------------------
   PARSE — every SRF record in the Metrics UDQ, with the sub-sections the
   checks read. Record row in col A; sub-sections beneath it until the next
   record row (same block model as the Christmas Tree / PMR readers).
   ------------------------------------------------------------------------- */
const COP_B_TITLES = new Set([
  "attachment list", "inventory list", "cost list", "shipping activity & history",
  "linked request list", "workflow logs", "request estimate list", "activity tracker list",
]);
const COP_C_TITLES = new Set(["daily status history", "transshipments", "attachment list"]);

function copFindTitle(grid, rr, rEnd, title, col) {
  for (let r = rr + 1; r < rEnd; r++) if (copLow(gridCell(grid, r, col)) === title) return r;
  return 0;
}
/** Header row -> [{c, key}] from `fromCol` rightwards. */
function copHeaders(grid, r, fromCol, maxCol) {
  const out = [];
  for (let c = fromCol; c <= maxCol; c++) { const k = copLow(gridCell(grid, r, c)); if (k) out.push({ c, key: k }); }
  return out;
}
function copRowObj(grid, r, hdrs) {
  const o = {};
  for (const h of hdrs) o[h.key] = norm(gridCell(grid, r, h.c));
  return o;
}
/** A col-B section whose rows run until a blank col B (or the next title). */
function copReadListB(grid, rr, rEnd, title, maxCol) {
  const t = copFindTitle(grid, rr, rEnd, title, 2);
  if (!t) return { present: false, rows: [] };
  const hdrs = copHeaders(grid, t + 1, 2, maxCol);
  const rows = [];
  for (let k = t + 2; k < rEnd; k++) {
    const b = copLow(gridCell(grid, k, 2));
    if (!b || COP_B_TITLES.has(b)) break;
    rows.push(copRowObj(grid, k, hdrs));
  }
  return { present: true, rows };
}
/** Inventory: col B (Serial #) is often blank, so run until the next col-B title. */
function copReadInventory(grid, rr, rEnd, maxCol) {
  const t = copFindTitle(grid, rr, rEnd, "inventory list", 2);
  if (!t) return { present: false, rows: [] };
  const hdrs = copHeaders(grid, t + 1, 2, maxCol);
  const rows = [];
  for (let k = t + 2; k < rEnd; k++) {
    if (COP_B_TITLES.has(copLow(gridCell(grid, k, 2)))) break;
    const o = copRowObj(grid, k, hdrs);
    if (Object.values(o).some((v) => v)) rows.push(o);
  }
  return { present: true, rows };
}
/** Cost List: cost lines, each optionally followed by its own nested
    Attachment List (title + header + rows in col C). Nested rows only fill
    C–E; a row with anything from col H on is the next cost line. */
function copReadCostList(grid, rr, rEnd, maxCol) {
  const t = copFindTitle(grid, rr, rEnd, "cost list", 2);
  if (!t) return { present: false, rows: [], attachTypes: [] };
  const hdrs = copHeaders(grid, t + 1, 2, maxCol);
  const rows = [], attachTypes = [];
  let nested = null;   // nested attachment header -> type column
  for (let k = t + 2; k < rEnd; k++) {
    if (COP_B_TITLES.has(copLow(gridCell(grid, k, 2)))) break;
    if (copLow(gridCell(grid, k, 3)) === "attachment list") {
      const nh = copHeaders(grid, k + 1, 3, maxCol);
      const tc = nh.find((h) => h.key === "type");
      nested = { typeCol: tc ? tc.c : 0 };
      k++;                                   // skip the nested header row
      continue;
    }
    let wide = false;
    for (let c = 8; c <= maxCol; c++) if (norm(gridCell(grid, k, c))) { wide = true; break; }
    if (nested && !wide) {
      const ty = nested.typeCol ? norm(gridCell(grid, k, nested.typeCol)) : "";
      if (ty) attachTypes.push(ty);
      continue;
    }
    nested = null;
    const o = copRowObj(grid, k, hdrs);
    if (Object.values(o).some((v) => v)) rows.push(o);
  }
  return { present: true, rows, attachTypes };
}
/** Shipping Activity & History: header + one value row (col B onward). */
function copReadShipping(grid, rr, rEnd, maxCol) {
  const t = copFindTitle(grid, rr, rEnd, "shipping activity & history", 2);
  if (!t) return {};
  return copRowObj(grid, t + 2, copHeaders(grid, t + 1, 2, maxCol));
}
/** Daily Status History (col C): [{date, note}] newest first, as listed. */
function copReadDaily(grid, rr, rEnd) {
  const t = copFindTitle(grid, rr, rEnd, "daily status history", 3);
  if (!t) return [];
  const out = [];
  for (let k = t + 2; k < rEnd; k++) {
    if (norm(gridCell(grid, k, 2))) break;
    const c = norm(gridCell(grid, k, 3));
    if (COP_C_TITLES.has(c.toLowerCase())) break;
    const d = xtParseDate(c);
    if (!d) { if (!c && !norm(gridCell(grid, k, 4))) continue; break; }
    out.push({ date: d, note: norm(gridCell(grid, k, 4)) });
  }
  return out;
}

/** Parse the whole Metrics UDQ. Returns { records[], ds{} }. */
function copParseGrid(grid) {
  const maxRow = gridMaxRow(grid), maxCol = gridMaxCol(grid);
  const hmap = buildHeaderMap(grid, 1);
  const recRows = [];
  for (let r = 2; r <= maxRow; r++) if (xtLooksWmtr(gridCell(grid, r, 1))) recRows.push(r);

  // dpsSince / estSince: the earliest date each newer ATLAS field appears in this
  // export. Records that went through that step before then can't be held to it.
  const ds = { hasCostList: false, hasEstimateList: false, hasWfl: false, hasDaily: false, dpsSince: null, estSince: null };
  const earliest = (cur, d) => (d && (!cur || d.getTime() < cur.getTime()) ? d : cur);
  const records = [];
  for (let i = 0; i < recRows.length; i++) {
    const rr = recRows[i];
    const wmtr = norm(gridCell(grid, rr, 1));
    if (xtServiceTag(wmtr) !== "SRF") continue;          // SRF only (for now)
    const rEnd = i + 1 < recRows.length ? recRows[i + 1] : maxRow + 1;
    const S = (h) => { const c = hmap[normWs(h)]; return c ? norm(gridCell(grid, rr, c)) : ""; };

    const att = copReadListB(grid, rr, rEnd, "attachment list", maxCol);
    const inv = copReadInventory(grid, rr, rEnd, maxCol);
    const cost = copReadCostList(grid, rr, rEnd, maxCol);
    const linked = copReadListB(grid, rr, rEnd, "linked request list", maxCol);
    const est = copReadListB(grid, rr, rEnd, "request estimate list", maxCol);
    const wfl = xtReadWorkflowLogs(grid, rr, rEnd);
    const daily = copReadDaily(grid, rr, rEnd);
    if (cost.present) ds.hasCostList = true;
    if (est.present) ds.hasEstimateList = true;
    if (wfl.length) ds.hasWfl = true;
    if (daily.length) ds.hasDaily = true;

    const fields = {};
    for (const h of Object.keys(hmap)) fields[h.toLowerCase()] = S(h);
    ds.dpsSince = earliest(ds.dpsSince, xtParseDate(fields["denied party screen result date"]));
    for (const e of est.rows) ds.estSince = earliest(ds.estSince, xtParseDate(e["estimate date"]));

    records.push({
      wmtr,
      reqNo: xtStripSuffix(wmtr),
      num: xtWmtrNumber(wmtr),
      f: fields,                             // every header -> value (lower-case keys)
      att: att.rows.map((a) => ({
        file: a["file name"] || "", type: a["type"] || "", notes: a["attachment notes"] || "",
        at: xtParseDate(a["created at"]),
      })),
      inv: inv.rows,
      cost: cost.rows,
      costAttachTypes: cost.attachTypes,
      linked: linked.rows,
      est: est.rows,
      ship: copReadShipping(grid, rr, rEnd, maxCol),
      wfl,
      daily,
    });
  }
  return { records, ds };
}

/** Parse once per loaded grid (Metrics UDQ only). */
function copData() {
  const grid = AppState.grid;
  if (!grid || AppState.udqType !== "metrics") return null;
  if (!CopUi._parsed || CopUi._parsed.grid !== grid) {
    CopUi._parsed = { grid, data: copParseGrid(grid) };
    // A new UDQ starts unfiltered (view / scope / your name are kept).
    Object.assign(CopUi, { lane: "", poc: "", atRisk: false, stuckOnly: false, rddDays: 0, q: "", hit: "", msg: "" });
    CopUi.expanded = new Set();
  }
  return CopUi._parsed.data;
}

/* -------------------------------------------------------------------------
   OPS TRACKER — read the "Active MTR" tab (and the Closed tab's WMTR list).
   Dates are stored as ISO strings; anything else (N/A, "Low value") as text.
   ------------------------------------------------------------------------- */
const COP_TRACKER_COLS = {
  packed: ["date packed"],
  rfq: ["rfq sent"],
  etd: ["estimated export date/time", "estimated export date"],
  aesClass: ["aes class"],
  itn: ["itn / noeei citation", "itn/noeei citation", "itn"],
  maradDue: ["marad due date"],
  maradSub: ["marad submitted"],
};
function copSerialToIso(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
/** Cell -> ISO date when it is one (serial or date text), else trimmed text. */
function copTrackerCell(v, isDate) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && isDate && v > 20000 && v < 80000) return copSerialToIso(v);
  if (v instanceof Date) return xtIso(v);
  const s = norm(String(v));
  if (isDate) { const d = xtParseDate(s); if (d) return xtIso(d); }
  return s;
}
function copSheetRows(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
}
function copHeaderIndex(rows, need) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const keys = (rows[r] || []).map((v) => copLow(v));
    if (need.every((n) => keys.includes(n))) return { r, keys };
  }
  return null;
}
/** Returns a tracker object, or null when the workbook isn't an Ops Tracker. */
function copParseTrackerWorkbook(buf, fileName) {
  const wb = XLSX.read(buf, { type: "array" });
  let active = null;
  for (const name of wb.SheetNames) {
    if (/closed/i.test(name)) continue;
    const rows = copSheetRows(wb, name);
    const h = copHeaderIndex(rows, ["mtr", "rfq sent"]);
    if (h) { active = { name, rows, h }; break; }
  }
  if (!active) return null;
  // ITN too: the Closed tab records the date the ITN was filed instead of the number.
  const dateKeys = new Set(["packed", "rfq", "etd", "maradDue", "maradSub", "itn"]);
  /** One tracker tab -> { rows: {request#: {...}}, cols: [found keys] }. */
  const readTab = (rows, h) => {
    const col = (alts) => { for (const a of alts) { const i = h.keys.indexOf(a); if (i !== -1) return i; } return -1; };
    const cMtr = h.keys.indexOf("mtr");
    const cols = {};
    for (const k of Object.keys(COP_TRACKER_COLS)) cols[k] = col(COP_TRACKER_COLS[k]);
    const out = {};
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const mtr = norm(row[cMtr]);
      if (!/^WMTR-/i.test(mtr)) continue;               // skip divider rows ("New MTRs as of…")
      const o = { mtr };
      for (const k of Object.keys(cols)) o[k] = cols[k] === -1 ? "" : copTrackerCell(row[cols[k]], dateKeys.has(k));
      out[String(xtWmtrNumber(mtr))] = o;
    }
    return { rows: out, cols: Object.keys(cols).filter((k) => cols[k] !== -1) };
  };
  const act = readTab(active.rows, active.h);

  // Closed tab(s): their WMTRs explain "not on the Active tab", and a Closed MTR
  // Tracker tab (same columns) supplies RFQ / pack / ITN / MARAD dates to the
  // COP's Closed view.
  const closed = [];
  let closedRows = {};
  for (const name of wb.SheetNames) {
    if (!/closed/i.test(name)) continue;
    const cr = copSheetRows(wb, name);
    for (const row of cr) for (const v of (row || []).slice(0, 2)) {
      const s = norm(v);
      if (/^WMTR-/i.test(s)) { closed.push(String(xtWmtrNumber(s))); break; }
    }
    const h = copHeaderIndex(cr, ["mtr"]);
    if (h) closedRows = Object.assign(closedRows, readTab(cr, h).rows);
  }
  return {
    fileName: fileName || "", loadedAt: new Date().toISOString(), sheet: active.name,
    rows: act.rows, closedRows, closed: Array.from(new Set(closed)),
    hasCols: act.cols,
  };
}
function copGetTracker() {
  try { const t = JSON.parse(localStorage.getItem(COP_TRACKER_KEY) || "null"); return (t && t.rows) ? t : null; }
  catch (e) { return null; }
}
function copSetTracker(t) {
  try {
    if (t) localStorage.setItem(COP_TRACKER_KEY, JSON.stringify(t));
    else localStorage.removeItem(COP_TRACKER_KEY);
  } catch (e) { /* storage off */ }
}
/** Load a dropped/browsed Ops Tracker file. Returns the tracker or throws. */
async function copLoadTrackerFile(file) {
  const buf = await file.arrayBuffer();
  const t = copParseTrackerWorkbook(buf, file.name);
  if (!t) throw new Error(`${file.name} doesn't look like the Ops Tracker (no tab with "MTR" and "RFQ Sent" headers).`);
  copSetTracker(t);
  return t;
}
/** Hook for the main drop zone (app.js loadFile): an Ops Tracker dropped
    there is taken by the COP instead of replacing the loaded UDQ. Cheap check
    first (sheet names only). Returns true when the file was handled. */
async function copMaybeTrackerFile(file) {
  if (!file || !/\.xls[xm]$/i.test(file.name || "")) return false;
  let names = [];
  try { names = XLSX.read(await file.arrayBuffer(), { type: "array", bookSheets: true }).SheetNames || []; }
  catch (e) { return false; }
  if (!names.some((n) => /^\s*active mtr\s*$/i.test(n))) return false;
  const status = document.getElementById("loadStatus");
  try {
    const t = await copLoadTrackerFile(file);
    if (status) {
      status.classList.remove("err");
      status.textContent = `Loaded Ops Tracker ${file.name} — ${Object.keys(t.rows).length} active MTRs. ` +
        (AppState.udqType === "metrics" ? "The COP now uses its RFQ, pack, AES/ITN and MARAD dates."
                                        : "Load or fetch a Metrics UDQ to see the COP.");
    }
  } catch (e) {
    if (status) { status.textContent = e.message; status.classList.add("err"); }
    return true;
  }
  if (AppState.activeTool === "cop") renderWorkspace();
  return true;
}

/* -------------------------------------------------------------------------
   ENGINE — one record -> lane, timing and the stage checklists.
   ------------------------------------------------------------------------- */

/** Lane, problem badge and when the shipment entered its current lane. */
function copLaneInfo(rec) {
  const status = rec.f["status"] || "";
  const low = copLow(status);
  const closed = copIsClosedStatus(low);
  const problem = COP_PROBLEM_STATUSES.has(low);
  let lane = COP_STATUS_LANE[low] || null;
  const wfl = rec.wfl;                                    // newest first
  if (!lane && !closed) {
    for (const e of wfl) { const l = copLaneOf(e.status); if (l) { lane = l; break; } }
    if (!lane && problem) lane = "transit";
  }
  // Entered = oldest entry of the newest unbroken run of this lane's statuses
  // (problem statuses inside the run don't break it).
  let entered = null, idx = -1;
  for (let i = 0; i < wfl.length; i++) {
    const l = copLaneOf(wfl[i].status);
    if (l === lane) { idx = i; break; }
    if (l && l !== lane) break;
  }
  if (idx !== -1) {
    entered = wfl[idx].dt;
    for (let i = idx + 1; i < wfl.length; i++) {
      const l = copLaneOf(wfl[i].status);
      if (l === lane || (!l && COP_PROBLEM_STATUSES.has(copBaseStatus(wfl[i].status)))) entered = wfl[i].dt || entered;
      else break;
    }
  }
  // The estimate lane has two clocks: TTI preparation vs DTRA / CT review.
  let stuckKey = lane;
  let stuckSince = entered;
  if (lane === "estimate") {
    const base = copBaseStatus(status);
    stuckKey = base === "tti estimate preparation" ? "estimate_tti" : "estimate_dtra";
    stuckSince = null;
    for (const e of wfl) {
      if (copBaseStatus(e.status) === base) stuckSince = e.dt;
      else if (stuckSince) break;
    }
    if (!stuckSince) stuckSince = entered;
  }
  // A cancelled request is only judged on the steps it reached: its "lane" is the
  // last one in the Workflow Logs before it was cancelled.
  const cancelled = /^(cancel|shipment cancel)/.test(low);
  let reached = null;
  if (cancelled) for (const e of wfl) { const l = copLaneOf(e.status); if (l) { reached = l; break; } }
  return { status, low, closed, cancelled, reached, problem, lane, unmapped: !lane && !closed, entered, stuckKey, stuckSince };
}

/** Shipment classification for the document rules (same rules as Required Attachments). */
function copShipClass(rec) {
  const origin = rec.f["country of origin"] || "";
  const dest = rec.f["country of destination"] || "";
  const as = rec.f["identify shipment as"] || "";
  const shipKey = copLow(as).replace(/[-_]/g, " ");
  const category = (origin && dest) ? _raShipmentCategory(origin, dest) : "UNKNOWN";
  const mode = [as, rec.f["requested mode of transit"] || ""].join(" ");
  return {
    origin, dest, as, category,
    handCarry: shipKey === "hand carry",
    courier: _raIsCourier(as),
    ocean: /ocean|sealift|vessel/i.test(mode),
    originUs: _raIsUs(origin),
  };
}

/** Inventory value by header, tolerant of ATLAS spellings ("Dimentions"). */
function copInv(row, re) {
  for (const k of Object.keys(row)) if (re.test(k)) return row[k];
  return "";
}
function copInvLines(rec) {
  const items = [], parents = [];
  for (const r of rec.inv) {
    const serial = copLow(r["serial #"]);
    if (serial === "serial #" || copLow(r["description"]) === "description") continue;
    (serial === "p" ? parents : items).push(r);
  }
  return { items, parents };
}

/** Daily-update gaps from `start` to `end` (inclusive) — every working day
    needs an entry. Today's missing entry is "due", not missed. */
function copDailyGaps(dates, start, end) {
  const have = new Set(dates.map((d) => xtIso(d)));
  const today = copToday();
  const todayIso = xtIso(today);
  const last = end && end.getTime() < today.getTime() ? xtDayStart(end) : today;
  const missed = [];
  let dueToday = false;
  for (let d = xtDayStart(start); d.getTime() <= last.getTime(); d = xtAddDays(d, 1)) {
    if (!copIsWorkday(d)) continue;
    const iso = xtIso(d);
    if (have.has(iso)) continue;
    if (iso === todayIso) dueToday = true; else missed.push(iso);
  }
  return { missed, dueToday };
}

/**
 * Build the COP view of one record.
 * ctx = { today, tracker, prefs, ds, ignores }
 */
function copEvaluate(rec, ctx) {
  const li = copLaneInfo(rec);
  const sc = copShipClass(rec);
  const f = rec.f;
  const today = ctx.today;
  const laneIdx = li.cancelled ? (li.reached ? COP_LANE_IDX[li.reached] : -1)
    : li.closed ? COP_CLOSED_IDX : (li.lane ? COP_LANE_IDX[li.lane] : -1);
  const types = rec.att.map((a) => a.type);
  const hasDoc = (k) => copHasType(types, COP_DOC_TYPES[k]);
  // Tracker row: the Active tab; a closed request may only be on the Closed tab.
  const trk = ctx.tracker ? (ctx.tracker.rows[String(rec.num)]
    || ((li.closed && ctx.tracker.closedRows) ? ctx.tracker.closedRows[String(rec.num)] : null) || null) : null;
  const ig = ctx.ignores[rec.reqNo] || [];
  const isAcked = (keys) => ig.indexOf("*") !== -1 || keys.some((k) => ig.indexOf(k) !== -1);
  const delivered = xtParseDate(f["delivery date"]);
  const rdd = xtParseDate(f["nlt completion date"]);
  const wfl = rec.wfl;
  const oldestOf = (name) => { let d = null; for (const e of wfl) if (copLow(e.status) === name) d = e.dt; return d; };
  const anyOf = (re) => wfl.some((e) => re.test(copLow(e.status)));

  // The Christmas Tree's own row + issues for the checks it already makes.
  const xtRec = {
    service: "SRF", wmtr: rec.wmtr,
    scalar: {
      ttiPoc: f["tti poc name"] || "", redFlag: f["red flag"] || "", redFlagComments: f["red flag comments"] || "",
      topRequired: f["transfer of property (top) required?"] || "", totalCost: f["total cost in usd"] || "",
      dateSubmitted: f["date submitted"] || "", originalRdd: f["original rdd"] || "",
      nltCompletion: f["nlt completion date"] || "", status: li.status,
      dateCompleted: f["date completed"] || "", deliveryDate: f["delivery date"] || "",
      manualMetric: xtManualMetricNote(f["dtra-only import/export comments"], f["revision number"]),
    },
    wfl,
    lastActivity: rec.daily.length ? rec.daily.reduce((m, x) => (!m || x.date > m ? x.date : m), null) : null,
    activityDates: rec.daily.map((x) => x.date),
    shipping: { carrier: rec.ship["carrier / freight forwarder"] || "", awb: rec.ship["awb/bol"] || "", tracklink: rec.ship["tracking link"] || "" },
  };
  const xrow = xtBuildRow(xtRec);
  const xissues = xtRowIssues(xrow);
  const xHit = (metric) => xissues.filter((i) => i.metric === metric);

  const checks = [];
  /**
   * Add a check.
   *   stage   lane id or "general"
   *   level   "req" | "rec"
   *   res     { met: true|false|null|"na", detail } for gate items, or
   *           { state, detail } for items that judge themselves (clocks).
   *   opt     { onEntry: due as soon as the shipment is IN the stage }
   */
  const add = (id, stage, level, label, res, ackKeys, opt) => {
    let state = res.state;
    if (!state) {
      const sIdx = stage === "general" ? -1 : COP_LANE_IDX[stage];
      if (res.met === "na") state = "na";
      else if (res.met === null || res.met === undefined) state = "unknown";
      else if (res.met) state = "ok";
      else if (laneIdx < sIdx) state = "later";
      else if (laneIdx === sIdx) state = (opt && opt.onEntry) ? "warn" : "open";
      else state = level === "req" ? "fail" : "warn";
    }
    let detail = res.detail || "";
    const keys = ackKeys || ["cop." + id];
    if ((state === "fail" || state === "warn" || state === "due") && isAcked(keys)) {
      detail = "Acknowledged — " + detail;
      state = "ack";
    }
    checks.push({ id, stage, level, label, state, detail, ackKey: keys[0] });
  };

  /* ===================== GENERAL (throughout) ===================== */
  if (li.problem) {
    add("status", "general", "req", "Shipment status", { state: "fail", detail: `ATLAS status is "${li.status}".` }, ["cop.status"]);
  } else if (li.unmapped) {
    add("status", "general", "req", "Shipment status", { state: "warn", detail: `"${li.status || "(blank)"}" isn't a status the COP recognises, so the shipment can't be placed in a lane.` }, ["cop.status"]);
  }
  if (xrow.red_flag || /^true$/i.test(f["red flag"] || "")) {
    add("redflag", "general", "req", "Red Flag", { state: "fail", detail: xrow.red_flag || "Red Flag is set on the request." }, ["cop.redflag"]);
  }

  // Daily status updates: every business day from the business day after the
  // request left Draft (its oldest non-Draft Workflow Logs stamp — "Date Submitted" is
  // user-entered and can predate the real submission by months — or its first
  // daily entry, if earlier) until delivery. Same rule as PMR / Christmas Tree.
  (function () {
    const label = "Daily status updates";
    let start = null;
    for (const e of wfl) if (e.dt && !/^draft\b/i.test(norm(e.status)) && (!start || e.dt.getTime() < start.getTime())) start = e.dt;
    if (start) start = xtWorkday(start, 1, true);              // first update due the next business day
    // Never before ATLAS began recording daily updates (Feb 2026).
    const logStart = typeof PMR_DAILY_LOG_START_ISO !== "undefined" ? xtParseDate(PMR_DAILY_LOG_START_ISO) : null;
    if (start && logStart && start.getTime() < logStart.getTime()) start = logStart;
    if (start && delivered && delivered.getTime() < start.getTime()) start = null;
    for (const x of rec.daily) if (!start || x.date.getTime() < start.getTime()) start = x.date;
    if (laneIdx === COP_LANE_IDX.draft || laneIdx === -1) {
      add("daily", "general", "req", label, { met: "na", detail: "Required once the request enters TTI Quality Review." }, ["activity"]);
      return;
    }
    if (!start) {
      add("daily", "general", "req", label, { met: null, detail: "No Workflow Logs stamp or daily entry to count from." }, ["activity"]);
      return;
    }
    if (li.closed && !rec.daily.length) {
      add("daily", "general", "req", label, { met: null, detail: "No Daily Status History on this closed request." }, ["activity"]);
      return;
    }
    let end = delivered || (li.lane === "delivered" ? li.entered : null);
    if (!end && li.closed) end = xtParseDate(f["date completed"]) || today;
    const g = copDailyGaps(rec.daily.map((x) => x.date), start, end);
    const lastTxt = xrow.last_activity ? ` Last update ${copFmt(xrow.last_activity)}.` : " No updates yet.";
    if (g.missed.length) {
      const shown = g.missed.slice(-6);
      add("daily", "general", "req", label, {
        state: "fail",
        detail: `${copPlural(g.missed.length, "business day")} without an update since ${copFmt(start)}` +
          ` (${g.missed.length > shown.length ? "latest: " : ""}${xtFmtDayList(shown)}).${lastTxt}`,
      }, ["activity"]);
    } else if (g.dueToday) {
      add("daily", "general", "req", label, { state: "due", detail: `Today's update is still due.${lastTxt}` }, ["activity"]);
    } else {
      add("daily", "general", "req", label, { state: "ok", detail: `Every business day covered since ${copFmt(start)}.${lastTxt}` }, ["activity"]);
    }
  })();

  // RDD (active, not yet delivered).
  if (!li.closed && !delivered && li.lane !== "delivered") {
    const label = "RDD";
    if (!rdd) add("rdd", "general", "req", label, { met: null, detail: "No NLT Completion Date (RDD) on the request." });
    else if (rdd.getTime() < today.getTime()) {
      const adj = hasDoc("rdd");
      add("rdd", "general", "req", label, adj
        ? { state: "warn", detail: `RDD ${copFmt(rdd)} has passed. An "Approval to Adjust RDD" is attached — make sure the NLT date was moved.` }
        : { state: "fail", detail: `RDD ${copFmt(rdd)} has passed (${copPlural(copCalDays(rdd, today), "day")} ago) and no "Approval to Adjust RDD" is attached.` });
    } else {
      const bd = copBizDaysBetween(today, rdd);
      add("rdd", "general", "req", label, bd <= COP_RDD_WARN_BDAYS
        ? { state: "due", detail: `RDD ${copFmt(rdd)} is ${copPlural(bd, "business day")} away.` }
        : { state: "ok", detail: `RDD ${copFmt(rdd)} (${copPlural(bd, "business day")} away).` });
    }
  }

  // Time in lane.
  if (!li.closed && li.lane && li.lane !== "transit") {
    const lim = ctx.prefs.stuck[li.stuckKey];
    const label = "Time in this step";
    if (!li.stuckSince) add("stuck", "general", "rec", label, { met: null, detail: "No Workflow Logs entry shows when it entered this step." });
    else if (lim) {
      const n = copBizDaysBetween(li.stuckSince, today);
      const who = COP_STUCK_LABELS[li.stuckKey] || li.lane;
      const txt = `${copPlural(n, "business day")} in ${who} (since ${copFmt(li.stuckSince)}; amber at ${lim[0]}, red at ${lim[1]}).`;
      add("stuck", "general", "rec", label, { state: n >= lim[1] ? "fail" : n >= lim[0] ? "warn" : "ok", detail: txt });
    }
  }

  // Christmas Tree checks: rejected, manual flag, cost vs approved amount.
  for (const h of xHit("rejected")) add("rejected", "general", "req", "QC — rejected in or after review",
    { state: "fail", detail: h.label + (xrow.reject_reason ? ` — reason: ${xrow.reject_reason}` : "") }, ["rejected"]);
  for (const h of xHit("manual")) add("manual", "general", "req", "Manually-entered metric flag", { state: "fail", detail: h.label }, ["manual"]);
  for (const m of ["variance_est", "variance_rev"]) for (const h of xHit(m)) {
    add("cost", "general", "req", "Cost vs. DTRA-approved amount",
      { state: li.closed || delivered ? "warn" : "fail",
        detail: `${h.label} (approved ${copMoney(xrow.governing_amount) || "—"}, current ${copMoney(xrow.current_total_cost) || "—"}).` }, [m]);
  }
  if (li.closed) {
    for (const m of ["rti", "invoiced"]) for (const h of xHit(m))
      add(m, "general", "req", m === "rti" ? "Ready to Invoice" : "Invoiced", { state: h.kind === "due" ? "due" : "warn", detail: h.label }, [m]);
  }

  // Ops Tracker presence (while it still supplies RFQ / pack / ITN / MARAD dates).
  if (ctx.tracker && !li.closed && laneIdx >= COP_LANE_IDX.qr && !trk) {
    const onClosed = (ctx.tracker.closed || []).indexOf(String(rec.num)) !== -1;
    add("tracker", "general", "rec", "On the Ops Tracker", { state: "warn",
      detail: onClosed ? "Active in ATLAS, but the tracker has it on its Closed tab." : "Active in ATLAS, but not on the tracker's Active MTR tab." });
  }

  /* ===================== 2 · TTI QUALITY REVIEW ===================== */
  const { items, parents } = copInvLines(rec);
  (function () {
    const PARTIES = [
      ["Pickup Location Organization", "Pickup"], ["Shipment Origin Organization", "Origin"],
      ["Delivery Destination Organization", "Destination"], ["Ultimate Consignee Organization", "Ultimate Consignee"],
      ["End-User Organization", "End-User"],
    ];
    const gaps = [];
    for (const [p, nm] of PARTIES) {
      const g = (s) => f[(p + (s ? " " + s : "")).toLowerCase()] || "";
      const miss = [];
      if (!g("")) miss.push("name");
      if (!g("Address")) miss.push("address");
      if (!g("City")) miss.push("city");
      if (!g("Country")) miss.push("country");
      if (!g("POC Name")) miss.push("POC");
      if (!g("Email") && !g("Cell")) miss.push("POC email/phone");
      if (miss.length) gaps.push(`${nm} (${miss.join(", ")})`);
    }
    add("parties", "qr", "req", "Addresses & POCs filled (except Intermediate Consignee)",
      { met: !gaps.length, detail: gaps.length ? "Missing: " + gaps.join("; ") + "." : "All five parties complete." });
  })();

  const lineGap = (label, id, test, level, emptyOk) => {
    if (!items.length) { add(id, "qr", level, label, { met: emptyOk ? "na" : false, detail: "No inventory lines on the request." }); return; }
    const bad = items.filter((r) => !test(r)).length;
    add(id, "qr", level, label, { met: bad === 0, detail: bad ? `${bad} of ${copPlural(items.length, "line")} missing it.` : `All ${copPlural(items.length, "line")}.` });
  };
  lineGap("Inventory: description, model, qty, U/M, unit of issue", "invbasic", (r) =>
    !!(r["description"] && r["model/catalog number"] && r["quantity"] && r["unit of measure"] && r["unit of issue"]), "req");
  lineGap("ECCN / USML on every line", "eccn", (r) => !!copInv(r, /^eccn/), "req");
  lineGap("Schedule B / HTS on every line", "hts", (r) => !!copInv(r, /schedule b|hts/), "req");
  lineGap("Manufacturer country of origin on every line", "coo", (r) => !!copInv(r, /country of origin/), "req");
  (function () {
    const miss = ["identify shipment as", "requested mode of transit", "requested shipment tracing options", "shipment type"]
      .filter((k) => !f[k]);
    add("shipfields", "qr", "rec", "Identify As / mode / tracing / shipment type",
      { met: !miss.length, detail: miss.length ? "Blank: " + miss.join(", ") + "." : "All filled." });
  })();
  lineGap("Value (USD) on every line", "value", (r) => toFloat(copInv(r, /^value/)) > 0, "rec");
  (function () {
    const units = parents.length ? parents : items;
    const label = "Weights & dimensions";
    if (!units.length) { add("wtdims", "qr", "rec", label, { met: false, detail: "No inventory lines on the request." }); return; }
    const ok = (r) => {
      const wt = toFloat(copInv(r, /^estimated weight\(lbs/)) || toFloat(copInv(r, /^estimated weight\(kg/)) ||
                 toFloat(copInv(r, /^final weight\(lbs/)) || toFloat(copInv(r, /^final weight\(kg/));
      const dims = /\d/.test(copInv(r, /^estimated dim/)) || /\d/.test(copInv(r, /^final dim/));
      return wt > 0 && dims;
    };
    const bad = units.filter((r) => !ok(r)).length;
    const what = parents.length ? "package" : "line";
    add("wtdims", "qr", "rec", label, { met: bad === 0,
      detail: bad ? `${bad} of ${copPlural(units.length, what)} without a weight and dimensions.` : `Every ${what} has a weight and dimensions.` });
  })();
  lineGap("Temp control + HAZMAT filled (N/A or TBD is fine)", "temphaz", (r) =>
    !!(copInv(r, /temperature/) && copInv(r, /^hazmat/)), "rec");
  lineGap("Ship Group # on every line", "shipgroup", (r) => !!r["ship group #"], "rec");
  if (li.lane === "qr" || li.lane === "draft") {
    const civ = hasDoc("civAny");
    add("civearly", "qr", "rec", "No Commercial Invoice uploaded yet", civ
      ? { state: "warn", detail: "A CIV is already attached — it can't be final before Compliance Review." }
      : { state: "ok", detail: "None attached yet (correct at this step)." });
  }

  /* ===================== 4 · DTRA COMPLIANCE REVIEW (DTRA) ===================== */
  (function () {
    const label = "Denied Party Screen result (DTRA)";
    const v = f["denied party screen result"];
    const passed = oldestOf("dtra compliance review (approved)");
    if (v) {
      const d = xtParseDate(f["denied party screen result date"]);
      add("dps", "compliance", "req", label, { met: true, detail: `${v}${d ? " — " + copFmt(d) : ""}.` });
    } else if (passed && (!ctx.ds.dpsSince || passed.getTime() < ctx.ds.dpsSince.getTime())) {
      add("dps", "compliance", "req", label, { met: null, detail: `Blank — Compliance was approved ${copFmt(passed)}, before ATLAS recorded screen results${ctx.ds.dpsSince ? ` (first seen ${copFmt(ctx.ds.dpsSince)})` : ""}.` });
    } else {
      add("dps", "compliance", "req", label, { met: false, detail: "Blank." });
    }
  })();
  lineGap0("BIS/DDTC authorization or exception on every line", "auth", "compliance",
    (r) => !!copInv(r, /^bis\/ddtc/));
  function lineGap0(label, id, stage, test) {
    if (!items.length) { add(id, stage, "req", label, { met: false, detail: "No inventory lines on the request." }); return; }
    const bad = items.filter((r) => !test(r)).length;
    add(id, stage, "req", label, { met: bad === 0, detail: bad ? `${bad} of ${copPlural(items.length, "line")} blank.` : `All ${copPlural(items.length, "line")}.` });
  }

  /* ===================== 5 · ESTIMATE ===================== */
  const compApproved = oldestOf("dtra compliance review (approved)");
  (function () {
    const label = "RFQ sent within 1 business day of Compliance approval";
    if (!compApproved) {
      add("rfq", "estimate", "req", label, laneIdx > COP_LANE_IDX.compliance
        ? { met: null, detail: "No \"DTRA Compliance Review (Approved)\" stamp in the Workflow Logs." }
        : { state: laneIdx < 0 ? "na" : "later", detail: "Clock starts when Compliance Review is approved." });
      return;
    }
    const due = xtWorkday(compApproved, 1, true);
    if (!ctx.tracker) { add("rfq", "estimate", "req", label, { met: null, detail: `Due ${copFmt(due)}. Load the Ops Tracker to check the RFQ Sent date.` }); return; }
    if (!trk) { add("rfq", "estimate", "req", label, { met: null, detail: `Due ${copFmt(due)}. Not on the Ops Tracker.` }); return; }
    const sent = copIsoToDate(trk.rfq);
    // Text instead of a date ("Hand Carry", "FEDEX", "N/A") = no RFQ for this one.
    if (!sent && norm(trk.rfq)) { add("rfq", "estimate", "req", label, { met: "na", detail: `Tracker shows "${trk.rfq}" — no RFQ needed.` }); return; }
    if (sent) {
      add("rfq", "estimate", "req", label, sent.getTime() <= due.getTime()
        ? { state: "ok", detail: `Sent ${copFmt(sent)} (due ${copFmt(due)}).` }
        : { state: "fail", detail: `Sent ${copFmt(sent)}, after the ${copFmt(due)} due date.` });
    } else if (today.getTime() > due.getTime()) {
      add("rfq", "estimate", "req", label, { state: "fail", detail: `No RFQ Sent date on the tracker; it was due ${copFmt(due)}.` });
    } else {
      add("rfq", "estimate", "req", label, { state: "due", detail: `Due ${copFmt(due)}.` });
    }
  })();
  (function () {
    const label = "Cost List: a Services line with a burdened rate";
    if (!ctx.ds.hasCostList) { add("costlist", "estimate", "req", label, { met: null, detail: "This export doesn't include the Cost List (fetched data leaves it out — drop the .xlsx export instead)." }); return; }
    const okLine = rec.cost.some((c) => copLow(c["rate type"]) === "services" && toFloat(copInv(c, /^burdened rate/)) > 0);
    add("costlist", "estimate", "req", label, { met: okLine,
      detail: okLine ? `${copPlural(rec.cost.length, "cost line")}.` : rec.cost.length ? "No line with Rate Type \"Services\" and a burdened rate." : "No cost lines." });
  })();
  const total = toFloat(f["total cost in usd"]);
  add("totalcost", "estimate", "req", "Total Cost in USD above $0", { met: total > 0, detail: total > 0 ? copMoney(total) + "." : "Total Cost is $0 or blank." });
  if (!sc.handCarry && !sc.courier && sc.category !== "DOMESTIC") {
    add("doc.civAny", "estimate", "req", "Commercial Invoice attached", { met: hasDoc("civAny"), detail: hasDoc("civAny") ? "Attached." : "No Commercial/Proforma Invoice or Draft CIV attached." }, ["cop.doc.civAny", "docs"]);
  }
  // Placeholder — switched off (COP_CHECK_ESTIMATE): not every POC fills the
  // Request Estimate List yet. The approved amount is always in the Workflow
  // Logs, and POCs upload the estimate as an attachment.
  if (COP_CHECK_ESTIMATE) (function () {
    const label = "Estimate attached";
    const n = rec.est.filter((e) => e["estimate"]).length;
    const asAttachment = rec.att.some((a) => /estimate/i.test(a.file) && !/rfq/i.test(a.file));
    if (n) { add("estimate", "estimate", "req", label, { met: true, detail: `${copPlural(n, "estimate")} in the Request Estimate List.` }); return; }
    if (asAttachment) { add("estimate", "estimate", "req", label, { met: true, detail: "Estimate PDF in the Attachment List." }); return; }
    if (!ctx.ds.hasEstimateList) { add("estimate", "estimate", "req", label, { met: null, detail: "This export doesn't include the Request Estimate List." }); return; }
    const submitted = oldestOf("dtra estimate review");
    if (submitted && ctx.ds.estSince && submitted.getTime() < ctx.ds.estSince.getTime()) {
      add("estimate", "estimate", "req", label, { met: null, detail: `Submitted for estimate review ${copFmt(submitted)}, before the Request Estimate List shows up in this export (${copFmt(ctx.ds.estSince)}).` });
      return;
    }
    add("estimate", "estimate", "req", label, { met: false, detail: "Request Estimate List is empty and no estimate PDF is attached." });
  })();
  if (total > 100000) {
    const ok = anyOf(/^ct program > 100k approval \(approved\)$/);
    add("100k", "estimate", "req", "CT Program > $100K approval", { met: ok, detail: ok ? "Approved." : `Total ${copMoney(total)} is over $100K and there's no "CT Program > 100K Approval (Approved)" stamp.` });
  }
  (function () {
    const ok = hasDoc("bid") || copHasType(rec.costAttachTypes, ["Quotation"]);
    add("bid", "estimate", "rec", "Vendor quotes attached", { met: ok, detail: ok ? "Vendor Bid / Quotation on file." : "No Vendor Bid attachment or Quotation on a cost line." });
  })();
  add("rfqdoc", "estimate", "rec", "RFQ email / RFQ attachment uploaded", { met: hasDoc("rfq"), detail: hasDoc("rfq") ? "Uploaded." : "No RFQ Email or RFQ Attachment." });
  if (ctx.ds.hasCostList && rec.cost.length) {
    let sum = 0;
    for (const c of rec.cost) sum += toFloat(c["total in usd"]) + toFloat(c["total in usd (other cost)"]);
    const okSum = Math.abs(sum - total) <= Math.max(1, total * 0.005);
    add("costsum", "estimate", "rec", "Total Cost matches the Cost List", { met: okSum,
      detail: okSum ? `${copMoney(sum)}.` : `Cost List adds to ${copMoney(sum)}; Total Cost shows ${copMoney(total)}.` });
  }

  /* ===================== 6 · READY TO SHIP (due by Picked Up) ===================== */
  const docRule = (key, label, stage, applies, extraOk, opt) => {
    if (sc.handCarry) return;
    if (!applies) return;
    if (sc.category === "UNKNOWN" && ["civ", "pkl", "sli", "aes", "vat", "mct"].includes(key)) {
      add("doc." + key, stage, "req", label, { met: null, detail: "Country of Origin or Destination is blank, so the required set can't be worked out." }, ["cop.doc." + key, "docs"]);
      return;
    }
    const ok = hasDoc(key) || !!(extraOk && extraOk());
    add("doc." + key, stage, "req", label, { met: ok, detail: ok ? "Attached." : "Not attached." }, ["cop.doc." + key, "docs"], opt);
  };
  const full = !sc.courier && sc.category !== "DOMESTIC";   // couriers / domestic: AWB + POD only
  const exportUs = sc.category === "EXPORT";
  const viaWarehouse = anyOf(/^arrived warehouse$/) || !!copInv(rec.ship, /^first item warehouse act/) || !!copInv(rec.ship, /^last item warehouse act/);
  // A real HAZMAT class or UN number ("Not DG per IATA SP A26", "None", "N_A" don't count).
  const isHaz = (v) => hasRealValue(v) && !/^(no|none|not\b|non[- ]?(dg|haz))/i.test(norm(v));
  const hazLines = items.filter((r) => isHaz(copInv(r, /^hazmat/)) || isHaz(copInv(r, /^un code/)));
  docRule("po", "Purchase Order attached", "ready", !sc.courier);
  docRule("civ", "Final Commercial Invoice attached", "ready", full);
  docRule("pkl", "Packing List attached", "ready", full, () => !sc.originUs && copHasType(types, ["IPC"]));
  docRule("sli", "SLI attached (US export)", "ready", full && exportUs && !copHasType(types, ["MFR_NO AES"]));
  docRule("aes", "AES record or MFR_NO AES attached (US export)", "ready", full && exportUs);
  docRule("photo", "Photo with label attached", "ready", !sc.courier);
  // The "Pallet Placard" type was added in ATLAS on 21 Oct 2026; before that
  // placards were filed as "Other". A placard-named file counts; otherwise an
  // older "Other" attachment might be it, so that's "can't tell", not a miss.
  if (!sc.handCarry && !sc.courier) {
    const label = "Pallet placard / label attached";
    if (hasDoc("placard") || rec.att.some((a) => /placard|pallet label/i.test(a.file + " " + a.notes))) {
      add("doc.placard", "ready", "req", label, { met: true, detail: "Attached." }, ["cop.doc.placard", "docs"]);
    } else if (rec.att.some((a) => (!a.type || copLow(a.type) === "other") && a.at && xtIso(a.at) < COP_PLACARD_TYPE_ISO)) {
      add("doc.placard", "ready", "req", label, { met: null, detail: "No Pallet Placard attachment. Placards were filed as \"Other\" before 21 Oct 2026, so one of those may be it." }, ["cop.doc.placard", "docs"]);
    } else {
      add("doc.placard", "ready", "req", label, { met: false, detail: "Not attached." }, ["cop.doc.placard", "docs"]);
    }
  }
  docRule("rc", "Warehouse receipt (RC) attached", "ready", !sc.courier && viaWarehouse);
  docRule("dgd", "Dangerous Goods Declaration attached", "ready", hazLines.length > 0);
  if (!sc.handCarry) {
    const label = "Pack date (Ops Tracker)";
    if (!ctx.tracker) add("packed", "ready", "req", label, { met: null, detail: "Load the Ops Tracker to check Date Packed." });
    else if (!trk) add("packed", "ready", "req", label, { met: null, detail: "Not on the Ops Tracker." });
    else {
      const d = copIsoToDate(trk.packed);
      const na = /^n\/?a$/i.test(norm(trk.packed));
      add("packed", "ready", "req", label, { met: d ? true : na ? "na" : false,
        detail: d ? `Packed ${copFmt(d)}.` : trk.packed ? `Tracker shows "${trk.packed}".` : "No Date Packed on the tracker." });
    }
  }
  // AES / ITN. Required for every US export (origin US, destination abroad),
  // hand carry excepted — decided from the ATLAS route, not a tracker class.
  // The export date is ATLAS "Departure from Origin Est. Date"; once the
  // shipment has actually departed (Act. Date, or status Picked Up or later)
  // without an ITN it's a hard red. The ITN / NOEEI citation itself isn't in
  // ATLAS yet, so it's read from the Ops Tracker until that field exists.
  (function () {
    const label = "AES filed / ITN before departure";
    if (!exportUs) return;
    if (sc.handCarry) { add("itn", "ready", "req", label, { met: "na", detail: "Hand carry — AES not checked." }); return; }
    const depAct = xtParseDate(rec.ship["departure from origin act. date"]);
    const etd = xtParseDate(rec.ship["departure from origin est. date"]) || (trk ? copIsoToDate(trk.etd) : null);
    const left = !!depAct || laneIdx >= COP_LANE_IDX.transit;
    const notYet = laneIdx < COP_LANE_IDX.ready;
    const itn = trk ? norm(trk.itn) : "";
    if (itn) {
      const filed = /^\d{4}-\d{2}-\d{2}$/.test(itn) ? copIsoToDate(itn) : null;
      add("itn", "ready", "req", label, { state: "ok", detail: filed ? `ITN filed ${copFmt(filed)}.` : `${/^x\d/i.test(itn) ? "ITN" : "Exemption / citation"}: ${itn}.` });
      return;
    }
    if (!ctx.tracker || !trk) {
      const why = !ctx.tracker ? "Load the Ops Tracker to check the ITN" : "Not on the Ops Tracker, so the ITN can't be checked";
      add("itn", "ready", "req", label, { met: null, detail: `US export — AES required. ${why}${etd ? ` (departs ${copFmt(etd)})` : ""}.` });
      return;
    }
    if (left) { add("itn", "ready", "req", label, { state: "fail", detail: `Departed without an ITN — ${depAct ? `left origin ${copFmt(depAct)}` : `status is "${li.status}"`} and the tracker has no ITN or exemption citation.` }); return; }
    if (!etd) { add("itn", "ready", "req", label, notYet ? { state: "open", detail: "US export — AES required; ITN and departure date still to come." } : { state: "warn", detail: "US export, no ITN yet, and no \"Departure from Origin Est. Date\" in ATLAS." }); return; }
    const d = copCalDays(today, etd);
    if (d < 0) add("itn", "ready", "req", label, { state: "fail", detail: `Estimated export date ${copFmt(etd)} has passed with no ITN.` });
    else if (d <= 3) add("itn", "ready", "req", label, { state: "fail", detail: `Exports ${copFmt(etd)} (${copPlural(d, "day")}) and there's no ITN yet.` });
    else if (d <= COP_DUE_SOON_DAYS) add("itn", "ready", "req", label, { state: "due", detail: `Exports ${copFmt(etd)} (${copPlural(d, "day")}); ITN still needed.` });
    else add("itn", "ready", "req", label, { state: notYet ? "later" : "open", detail: `ITN needed before ${copFmt(etd)}.` });
  })();

  /* ===================== 7 · IN TRANSIT ===================== */
  if (!sc.handCarry) {
    const awbAtt = hasDoc("awb");
    // Delivered before ATLAS had the AWB/BoL field: only the attachment is checked (Christmas Tree rule).
    const preField = delivered && typeof XT_TRACKING_CUTOFF_ISO !== "undefined" && xtIso(delivered) < XT_TRACKING_CUTOFF_ISO;
    const awbNo = preField || !!xrow.tracking_awb, carrier = preField || !!xrow.tracking_carrier;
    const miss = [];
    if (!awbAtt) miss.push("AWB/BoL attachment");
    if (!awbNo) miss.push("AWB/BoL number");
    if (!carrier) miss.push("carrier");
    add("awb", "transit", "req", "AWB/BoL attached, AWB/BoL # and carrier entered", {
      met: !miss.length,
      detail: miss.length ? "Missing: " + miss.join(", ") + "." : `${xrow.tracking_carrier} · ${xrow.tracking_awb}.`,
    }, ["cop.awb", "tracking"], { onEntry: true });
  }
  docRule("vat", "VAT Exemption attached", "transit", full, null, { onEntry: true });
  // MARAD (sealift only). Due date is calculated from ATLAS "Departure from
  // Origin Act. Date" (= loading): COP_MARAD_WORKDAYS_US working days for
  // US-origin cargo, COP_MARAD_WORKDAYS_FOREIGN otherwise (46 CFR 381.3). The
  // submitted date isn't in ATLAS yet — read from the Ops Tracker until it is.
  if (sc.ocean) {
    const label = "MARAD report (sealift)";
    const loaded = xtParseDate(rec.ship["departure from origin act. date"]);
    const days = sc.originUs ? COP_MARAD_WORKDAYS_US : COP_MARAD_WORKDAYS_FOREIGN;
    const due = loaded ? xtWorkday(loaded, days, true) : null;
    const rule = `${days} working days after departure from origin`;
    const sub = trk ? copIsoToDate(trk.maradSub) : null;
    if (sub) add("marad", "transit", "req", label, { state: "ok", detail: `Submitted ${copFmt(sub)}${due ? ` (due ${copFmt(due)})` : ""}.` });
    else if (trk && (/^n\/?a$/i.test(norm(trk.maradDue)) || /^n\/?a$/i.test(norm(trk.maradSub)))) add("marad", "transit", "req", label, { state: "na", detail: "Ops Tracker shows N/A (e.g. waiver)." });
    else if (!loaded && li.closed) add("marad", "transit", "req", label, { met: null, detail: `No "Departure from Origin Act. Date" in ATLAS, so the due date (${rule}) can't be worked out.` });
    else if (!loaded) add("marad", "transit", "req", label, { state: laneIdx < COP_LANE_IDX.transit ? "later" : "open", detail: `Due ${rule}; no "Departure from Origin Act. Date" in ATLAS yet.` });
    else if (!ctx.tracker || !trk) add("marad", "transit", "req", label, { met: null, detail: `Due ${copFmt(due)} (${rule}). ${!ctx.tracker ? "Load the Ops Tracker" : "Not on the Ops Tracker"} to check whether it was submitted.` });
    else {
      const d = copCalDays(today, due);
      add("marad", "transit", "req", label, d < 0 ? { state: "fail", detail: `Was due ${copFmt(due)} (${rule}); not submitted.` }
        : d <= COP_DUE_SOON_DAYS ? { state: "due", detail: `Due ${copFmt(due)} (${copPlural(d, "day")}).` }
        : { state: "open", detail: `Due ${copFmt(due)} (${rule}).` });
    }
  }

  /* ===================== 8 · DELIVERED (before Completed) ===================== */
  if (!sc.handCarry) {
    add("deldate", "delivered", "req", "Delivery Date entered", { met: !!delivered, detail: delivered ? copFmt(delivered) + "." : "Delivery Date is blank." }, ["cop.deldate"], { onEntry: true });
  }
  docRule("pod", "Proof of Delivery attached", "delivered", true);
  docRule("mct", "MCT attached (US import)", "delivered", full && sc.category === "IMPORT");
  docRule("vinv", "Vendor Invoice attached", "delivered", !sc.courier);
  if (copLow(li.status) === "delivered - pending pod" && hasDoc("pod")) {
    add("podstatus", "delivered", "rec", "Status updated to POD Received", { state: "warn", detail: "POD is attached but the status is still \"Delivered - Pending POD\"." });
  }
  for (const h of xHit("delivery")) add("late", "delivered", "req", "Delivered on or before RDD",
    { state: "fail", detail: `${h.label} — delivered ${copFmt(delivered)}, RDD ${copFmt(rdd)}.` }, ["delivery"]);
  if (delivered && rdd && !xHit("delivery").length) add("late", "delivered", "req", "Delivered on or before RDD", { state: "ok", detail: `Delivered ${copFmt(delivered)}, RDD ${copFmt(rdd)}.` }, ["delivery"]);

  /* ---- roll-up ---- */
  // Closed before the 1 Oct 2025 measurement cutoff: shown for reference, not scored
  // (same relief the Christmas Tree and PMR apply).
  const relieved = li.closed && typeof pmrSrfRelieved === "function" && pmrSrfRelieved(rec.wmtr, delivered ? xtIso(delivered) : null);
  if (relieved) for (const c of checks) {
    if (c.state === "fail" || c.state === "warn" || c.state === "due") { c.detail = "Historical, not scored — " + c.detail; c.state = "na"; }
  }
  if (li.cancelled) for (const c of checks) {
    if (c.state === "open" || c.state === "later") { c.detail = "Cancelled before this step — " + c.detail; c.state = "na"; }
  }
  const counts = { red: 0, amber: 0, ack: 0 };
  for (const c of checks) {
    if (c.state === "fail") counts.red++;
    else if (c.state === "warn" || c.state === "due") counts.amber++;
    else if (c.state === "ack") counts.ack++;
  }
  const stageWorst = {};
  for (const c of checks) {
    const cur = stageWorst[c.stage];
    if (!cur || COP_STATES[c.state].rank < COP_STATES[cur].rank) stageWorst[c.stage] = c.state;
  }
  const latest = rec.daily.length ? rec.daily.slice().sort((a, b) => b.date - a.date)[0] : null;
  const consol = rec.linked.filter((l) => /consol/i.test(l["linkage type"] || "")).map((l) => xtWmtrNumber(l["request number"]))
    .filter((n) => n !== Number.MAX_SAFE_INTEGER);
  const stuckCheck = checks.find((c) => c.id === "stuck");

  return {
    rec, wmtr: rec.wmtr, reqNo: rec.reqNo, num: rec.num, last5: wmtrLast5(rec.wmtr),
    poc: f["tti poc name"] || "", title: f["request title"] || "", program: f["ctr program"] || "",
    status: li.status, lane: li.lane, laneIdx, closed: li.closed, problem: li.problem, unmapped: li.unmapped,
    entered: li.entered, daysInLane: li.stuckSince ? copBizDaysBetween(li.stuckSince, today) : null,
    stuck: stuckCheck ? stuckCheck.state : "", rdd, delivered,
    rddDays: rdd && !delivered ? copCalDays(today, rdd) : null,
    dest: copShortCountry(f["country of destination"] || ""), origin: copShortCountry(f["country of origin"] || ""),
    mode: sc.as || f["requested mode of transit"] || "",
    latest, daily: rec.daily, carrier: xrow.tracking_carrier, awb: xrow.tracking_awb, tracklink: xrow.tracking_link,
    consol, checks, counts, stageWorst, onTracker: !!trk,
  };
}

/** Evaluate every record for the current view. */
function copBuildAll() {
  const data = copData();
  if (!data) return null;
  const ctx = {
    today: copToday(), tracker: copGetTracker(), prefs: copGetPrefs(), ds: data.ds,
    ignores: typeof xtGetIgnores === "function" ? xtGetIgnores() : {},
  };
  const rows = [];
  for (const rec of data.records) {
    const low = copLow(rec.f["status"]);
    if (low === "deleted") continue;
    try { rows.push(copEvaluate(rec, ctx)); }
    catch (e) { console.error("COP: couldn't evaluate", rec.wmtr, e); }
  }
  return { rows, ctx, ds: data.ds };
}

/* -------------------------------------------------------------------------
   FILTERS
   ------------------------------------------------------------------------- */
function copScope() {
  if (!CopUi.scope) CopUi.scope = copGetPrefs().me ? "mine" : "all";
  return CopUi.scope;
}
function copFilterRows(all) {
  const me = copGetPrefs().me;
  let rows = all.filter((r) => CopUi.view === "closed" ? r.closed : !r.closed);
  if (copScope() === "mine" && me) rows = rows.filter((r) => copLow(r.poc) === copLow(me));
  else if (CopUi.poc) rows = rows.filter((r) => copLow(r.poc) === copLow(CopUi.poc));
  const base = rows;                                 // before lane / risk filters (strip counts)
  if (CopUi.lane && CopUi.view === "active") rows = rows.filter((r) => r.lane === CopUi.lane);
  if (CopUi.atRisk) rows = rows.filter((r) => r.counts.red || r.counts.amber);
  if (CopUi.hit) rows = rows.filter((r) => r.checks.some((c) => c.id === CopUi.hit && (c.state === "fail" || c.state === "warn" || c.state === "due")));
  if (CopUi.stuckOnly) rows = rows.filter((r) => r.stuck === "fail" || r.stuck === "warn");
  if (CopUi.rddDays) rows = rows.filter((r) => r.rddDays !== null && r.rddDays <= CopUi.rddDays);
  if (CopUi.q) {
    const q = copLow(CopUi.q);
    rows = rows.filter((r) => copLow(r.wmtr + " " + r.title + " " + r.dest + " " + r.poc).includes(q));
  }
  const sorted = rows.slice().sort((a, b) =>
    CopUi.view === "closed" ? b.num - a.num
      : (b.laneIdx - a.laneIdx) || (b.counts.red - a.counts.red) || (a.num - b.num));
  return { base, rows: sorted };
}

/* -------------------------------------------------------------------------
   VIEW
   ------------------------------------------------------------------------- */
const COP_CSS = `
  .cop-controls{display:flex;gap:10px 14px;align-items:flex-end;flex-wrap:wrap;margin:2px 0 12px}
  .cop-controls .field label{display:block;font-family:var(--disp);text-transform:uppercase;letter-spacing:1.2px;font-size:11.5px;color:var(--steel);margin-bottom:3px}
  .cop-controls select,.cop-controls input[type=search]{font-family:var(--body);font-size:13px;padding:6px 9px;border:1px solid #B9C4CE;border-radius:var(--radius-btn);background:var(--card);color:var(--ink)}
  .cop-seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius-btn);overflow:hidden}
  .cop-seg button{border:0;background:var(--card);color:var(--ink);font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:12px;padding:7px 11px;cursor:pointer}
  .cop-seg button.active{background:var(--accent);color:#fff}
  .cop-check{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--ink);padding-bottom:6px;cursor:pointer}
  .cop-tracker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--line);border-radius:var(--radius-panel);padding:8px 12px;margin-bottom:12px;background:var(--paper);font-size:12.5px}
  .cop-tracker.missing{border-color:#C79A1E;background:#FEF7DC}
  body.theme-dark .cop-tracker.missing{background:#2a2612}
  .cop-tracker .t{font-family:var(--disp);text-transform:uppercase;letter-spacing:1px;font-size:12px;color:var(--ink)}
  .cop-tracker .sub{font-family:var(--mono);font-size:11px;color:var(--steel)}
  .cop-tracker .btn{padding:5px 10px;font-size:12px}
  .cop-strip{display:flex;align-items:stretch;gap:0;margin:0 0 14px;overflow-x:auto;padding-bottom:4px}
  .cop-lane{flex:1 1 0;min-width:98px;border:1px solid var(--line);border-radius:var(--radius-panel);background:var(--card);padding:8px 8px 9px;cursor:pointer;text-align:center;position:relative;transition:border-color .12s,box-shadow .12s}
  .cop-lane:hover{border-color:var(--accent)}
  .cop-lane.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(232,89,12,.25)}
  .cop-lane.dim{opacity:.55}
  .cop-lane .ln{font-family:var(--disp);text-transform:uppercase;letter-spacing:.8px;font-size:10.5px;color:var(--steel);line-height:1.2;min-height:25px;display:flex;align-items:center;justify-content:center}
  .cop-lane .n{font-family:var(--mono);font-size:24px;font-weight:600;color:var(--ink);line-height:1.15}
  .cop-lane .rc{display:flex;gap:4px;justify-content:center;min-height:17px;margin-top:2px}
  .cop-lane .dots{display:flex;flex-wrap:wrap;gap:3px;justify-content:center;margin-top:6px;max-height:44px;overflow:hidden}
  .cop-dot{width:9px;height:9px;border-radius:50%;background:var(--cleared,#1a7f37);display:inline-block}
  .cop-dot.bad{background:var(--warn)}
  .cop-dot.warn{background:#D8A200}
  .cop-arrow{flex:0 0 14px;display:flex;align-items:center;justify-content:center;color:var(--steel);font-size:13px}
  .cop-pill{font-family:var(--mono);font-size:10.5px;padding:0 5px;border-radius:var(--radius-badge);border:1px solid currentColor;line-height:15px}
  .cop-pill.bad{color:var(--warn)}
  .cop-pill.warn{color:#B8530B}
  .cop-pill.good{color:var(--cleared,#1a7f37)}
  .cop-pill.na{color:var(--steel)}
  .cop-roll{margin:0 0 14px}
  .cop-roll table{border-collapse:collapse;font-size:12px}
  .cop-roll th,.cop-roll td{border:1px solid var(--line);padding:4px 8px;text-align:center}
  .cop-roll th{font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;color:var(--steel);background:#F7F9FA}
  body.theme-dark .cop-roll th{background:#131c26}
  .cop-roll td.poc{text-align:left;white-space:nowrap;font-weight:600}
  .cop-roll td.c{cursor:pointer;font-family:var(--mono)}
  .cop-roll td.c:hover{outline:2px solid var(--accent);outline-offset:-2px}
  .cop-roll td.hasred{background:#FDECEC}
  .cop-roll td.hasamber{background:#FEF7DC}
  body.theme-dark .cop-roll td.hasred{background:#2a1a1c}
  body.theme-dark .cop-roll td.hasamber{background:#2a2612}
  .cop-roll .red{color:var(--warn);font-weight:700}
  .cop-wrap{overflow:auto;max-height:720px;border:1px solid var(--line);border-radius:var(--radius-panel)}
  table.cop-t{border-collapse:separate;border-spacing:0;font-size:12px;width:100%}
  table.cop-t th{position:sticky;top:0;z-index:2;background:#F7F9FA;font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;color:var(--steel);border-bottom:2px solid var(--line);padding:7px 8px;text-align:left;white-space:nowrap}
  body.theme-dark table.cop-t th{background:#131c26}
  table.cop-t td{border-bottom:1px solid #E8ECEF;padding:6px 8px;vertical-align:top}
  body.theme-dark table.cop-t td{border-bottom-color:var(--line)}
  table.cop-t tr.row{cursor:pointer}
  table.cop-t tr.row:hover td{background:#F2F6FA}
  body.theme-dark table.cop-t tr.row:hover td{background:#16212c}
  table.cop-t tr.row.r-red td:first-child{box-shadow:inset 3px 0 0 var(--warn)}
  table.cop-t tr.row.r-amber td:first-child{box-shadow:inset 3px 0 0 #D8A200}
  table.cop-t tr.row.consol-hl td{background:#FFF1D6}
  body.theme-dark table.cop-t tr.row.consol-hl td{background:#33280f}
  .cop-w{font-family:var(--mono);white-space:nowrap}
  .cop-w .full{display:block;font-size:10px;color:var(--steel)}
  .cop-st{white-space:nowrap}
  .cop-st .lane{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:11px;color:var(--ink)}
  .cop-st .atl{display:block;font-size:11px;color:var(--steel)}
  .cop-badge{display:inline-block;font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:9.5px;padding:0 5px;border-radius:var(--radius-badge);margin-left:4px;vertical-align:1px}
  .cop-badge.bad{background:var(--warn);color:#fff}
  .cop-badge.consol{border:1px solid var(--steel);color:var(--steel)}
  .cop-track{display:flex;gap:3px;align-items:center;white-space:nowrap}
  .cop-track i{width:10px;height:10px;border-radius:50%;display:inline-block;background:#DDE3E8;border:1px solid transparent}
  body.theme-dark .cop-track i{background:#2a3743}
  .cop-track i.done{background:var(--cleared,#1a7f37)}
  .cop-track i.done.bad{background:var(--warn)}
  .cop-track i.done.warn{background:#D8A200}
  .cop-track i.cur{background:#2C5A8C;box-shadow:0 0 0 2px rgba(44,90,140,.25)}
  .cop-track i.cur.bad{background:#2C5A8C;border-color:var(--warn);box-shadow:0 0 0 2px var(--warn)}
  .cop-upd{max-width:280px}
  .cop-upd .d{font-family:var(--mono);font-size:10.5px;color:var(--steel)}
  .cop-upd .t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .cop-upd .stale{color:var(--warn)}
  .cop-num{font-family:var(--mono);white-space:nowrap}
  .cop-num.bad{color:var(--warn);font-weight:700}
  .cop-num.warn{color:#B8530B;font-weight:700}
  .cop-ttl{max-width:240px}
  .cop-ttl .p{font-family:var(--disp);text-transform:uppercase;letter-spacing:.5px;font-size:10.5px;color:var(--steel)}
  tr.cop-detail td{background:var(--paper);padding:10px 14px 14px}
  .cop-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
  .cop-stage{border:1px solid var(--line);border-radius:var(--radius-panel);background:var(--card);overflow:hidden}
  .cop-stage h5{margin:0;padding:6px 10px;font-family:var(--disp);text-transform:uppercase;letter-spacing:.8px;font-size:11.5px;color:var(--ink);background:#E9EEF3;display:flex;justify-content:space-between;align-items:center}
  body.theme-dark .cop-stage h5{background:#1a2632}
  .cop-stage.cur{border-color:#2C5A8C}
  .cop-stage.cur h5{background:#2C5A8C;color:#fff}
  .cop-stage ul{list-style:none;margin:0;padding:4px 0}
  .cop-stage li{display:grid;grid-template-columns:20px 1fr auto;gap:2px 6px;padding:4px 10px;font-size:12px;align-items:start}
  .cop-stage li .ic{font-weight:700;text-align:center;line-height:18px}
  .cop-stage li .lb{font-weight:600}
  .cop-stage li .lb .rec{font-weight:400;font-size:10.5px;color:var(--steel);margin-left:4px}
  .cop-stage li .dt{grid-column:2 / 4;color:var(--steel);font-size:11.5px}
  .cop-stage li.s-good .ic{color:var(--cleared,#1a7f37)}
  .cop-stage li.s-bad{background:#FDECEC}.cop-stage li.s-bad .ic{color:var(--warn)}
  .cop-stage li.s-warn{background:#FEF7DC}.cop-stage li.s-warn .ic{color:#B8530B}
  body.theme-dark .cop-stage li.s-bad{background:#2a1a1c}
  body.theme-dark .cop-stage li.s-warn{background:#2a2612}
  .cop-stage li.s-open .ic{color:#2C5A8C}
  .cop-stage li.s-na,.cop-stage li.s-ack{color:var(--steel)}
  .cop-stage li.s-na .lb,.cop-stage li.s-ack .lb{font-weight:400}
  .cop-ack{border:1px solid var(--line);background:var(--card);color:var(--steel);border-radius:var(--radius-badge);cursor:pointer;font-size:10.5px;padding:0 6px;line-height:16px;white-space:nowrap}
  .cop-ack:hover{border-color:var(--accent);color:var(--accent)}
  .cop-dinfo{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 10px;font-size:12px}
  .cop-dinfo .k{font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10px;color:var(--steel);display:block}
  .cop-dlog{margin:0 0 10px;font-size:12px}
  .cop-dlog div{padding:1px 0}
  .cop-dlog .d{font-family:var(--mono);color:var(--steel);margin-right:6px}
  #copHover{position:fixed;z-index:9999;max-width:380px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius-panel);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:12px;pointer-events:none;display:none}
  #copHover .h{font-family:var(--mono);font-weight:600;margin-bottom:2px}
  #copHover .s{color:var(--steel);font-size:11px;margin-bottom:6px}
  #copHover .k{font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10px;color:var(--steel);margin-top:6px}
  #copHover ul{margin:2px 0 0;padding-left:16px}
  #copHover li.bad{color:var(--warn)}
  #copHover li.warn{color:#B8530B}
  .cop-settings{border:1px solid var(--line);border-radius:var(--radius-panel);padding:10px 12px;margin:0 0 12px;background:var(--paper)}
  .cop-settings table td{padding:3px 8px 3px 0;font-size:12px}
  .cop-settings input[type=number]{width:60px;font-family:var(--mono)}
  .cop-empty{padding:18px;text-align:center;color:var(--steel)}
  @media (max-width:1000px){.cop-strip{flex-wrap:wrap;gap:6px;overflow:visible}.cop-arrow{display:none}.cop-lane{flex:1 1 calc(25% - 6px);min-width:0}}
  @media (max-width:560px){.cop-lane{flex-basis:calc(50% - 6px)}.cop-upd,.cop-ttl{max-width:180px}}
`;

/* -------------------------------------------------------------------------
   HUB — the COP is the one rail button for every management view; Pipeline,
   Metrics (the Metrics dashboard), PMR, Export-Controlled and the Christmas
   Tree are tabs inside it. Tab ids are the TOOLS ids (app.js, hub: true).
   ------------------------------------------------------------------------- */
const COP_HUB_TOOLS = ["cop", "pmr", "ecm", "xmastree"];     // workspace tools ("metrics" = the dashboard)
function copIsHubTool(id) { return COP_HUB_TOOLS.indexOf(id) !== -1; }
/** True while any COP tab is on screen (the Metrics tab = no tool on a Metrics UDQ). */
function copHubActive() {
  return copIsHubTool(AppState.activeTool) || (!AppState.activeTool && AppState.udqType === "metrics");
}
function copHubSelect(id) {
  if (id === "metrics") { AppState.activeTool = null; AppState.dashCollapsed = false; }
  else { AppState.activeTool = id; AppState.dashCollapsed = true; }
  renderRail(); renderDashboard(); renderWorkspace();
  requestAnimationFrame(() => {
    const nav = document.querySelector(".cop-hub");
    if (nav) nav.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
function copRailButton() {
  const btn = el(`
    <button class="rail-cop ${copHubActive() ? "active" : ""}" type="button" title="Common Operational Picture — pipeline, metrics, PMR, Christmas Tree">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="10" rx="1"/><rect x="17" y="4" width="4" height="6" rx="1"/>
      </svg>
      <span><span class="t">COP</span><span class="s">Common Operational Picture</span></span>
    </button>`);
  btn.addEventListener("click", () => copHubSelect("cop"));
  return btn;
}
function copHubTabs() {
  const hasMetrics = AppState.udqType === "metrics";
  const cur = AppState.activeTool || (hasMetrics ? "metrics" : "");
  const tabs = (typeof TOOLS !== "undefined" ? TOOLS : []).filter((t) => t.hub);
  const nav = el(`<nav class="cop-hub" aria-label="COP views"></nav>`);
  for (const t of tabs) {
    const ok = t.needs !== "metrics" || hasMetrics;
    const b = el(`<button type="button" class="${cur === t.id ? "active" : ""}" ${ok ? "" : "disabled"}
      ${cur === t.id ? 'aria-current="page"' : ""} title="${ok ? esc(t.label) : "Load or fetch a Metrics UDQ first"}">${esc(t.label)}</button>`);
    if (ok) b.addEventListener("click", () => { if (cur !== t.id) copHubSelect(t.id); });
    nav.appendChild(b);
  }
  return nav;
}

function copChip(state) {
  const s = COP_STATES[state] || COP_STATES.na;
  return `<span class="cop-pill ${s.cls}">${esc(s.word)}</span>`;
}

function renderCopWorkspace(container) {
  const built = copBuildAll();
  const tracker = copGetTracker();
  const prefs = copGetPrefs();
  const scope = copScope();

  const panel = el(`<div class="panel"><style>${COP_CSS}</style>
    <header><h2>COP — Common Operational Picture</h2><span class="count" id="copCount"></span></header>
    <div class="body" id="copBody"></div></div>`);
  container.appendChild(panel);
  const body = panel.querySelector("#copBody");

  if (!built) {
    const empty = el(`<div>
      <div class="statusline" style="margin-bottom:10px">The COP runs on the Metrics UDQ (every shipment). Fetch it from ATLAS, or drop the exported .xlsx on the drop zone.</div>
      <div class="btnrow">
        <button class="btn" id="copFetch" type="button">Fetch Metrics UDQ from ATLAS</button>
        <button class="btn ghost" id="copBrowse" type="button">Browse for the .xlsx…</button>
      </div>
      <div class="note" style="margin-top:10px">The Christmas Tree tab works without it — it loads its own SRF / PR / PMCT / WS UDQs.</div>
    </div>`);
    body.appendChild(empty);
    empty.querySelector("#copFetch").addEventListener("click", () => {
      if (typeof loadFromAtlasUdq === "function") loadFromAtlasUdq({ dataset: "metrics" });
    });
    empty.querySelector("#copBrowse").addEventListener("click", () => {
      const fi = document.getElementById("fileInput");
      if (fi) fi.click();
    });
    return;
  }
  const all = built.rows;
  const pocs = Array.from(new Set(all.map((r) => r.poc).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const { base, rows } = copFilterRows(all);
  panel.querySelector("#copCount").textContent =
    `${rows.length} of ${base.length} ${CopUi.view === "closed" ? "closed" : "active"} shipment${base.length === 1 ? "" : "s"}`;

  /* ---- tracker bar ---- */
  const trkHtml = tracker
    ? `<span class="t">Ops Tracker</span><span>${esc(tracker.fileName)}</span>
       <span class="sub">${Object.keys(tracker.rows).length} active MTRs · loaded ${esc(new Date(tracker.loadedAt).toLocaleString())}</span>
       <span style="margin-left:auto;display:inline-flex;gap:6px"><button class="btn ghost" id="copTrkLoad" type="button">Load updated tracker</button>
       <button class="btn ghost" id="copTrkClear" type="button">Clear</button></span>`
    : `<span class="t">No Ops Tracker loaded</span>
       <span>RFQ Sent, Date Packed, AES/ITN and MARAD checks show "No data" until it's loaded. Drop the tracker .xlsx here or</span>
       <span style="margin-left:auto"><button class="btn" id="copTrkLoad" type="button">Load Ops Tracker</button></span>`;
  body.appendChild(el(`<div class="cop-tracker ${tracker ? "" : "missing"}">${trkHtml}
    <input type="file" id="copTrkFile" accept=".xlsx,.xlsm" class="hidden"></div>`));

  /* ---- controls ---- */
  const pocOpts = (sel) => `<option value="">All TTI POCs</option>` +
    pocs.map((p) => `<option value="${esc(p)}"${copLow(p) === copLow(sel) ? " selected" : ""}>${esc(p)}</option>`).join("");
  const meOpts = `<option value="">— pick your name —</option>` +
    pocs.map((p) => `<option value="${esc(p)}"${copLow(p) === copLow(prefs.me) ? " selected" : ""}>${esc(p)}</option>`).join("");
  // "Find metric hits": every check that's red or amber somewhere in this scope, worst first.
  const hits = {};
  for (const r of base) for (const c of r.checks) {
    if (c.state !== "fail" && c.state !== "warn" && c.state !== "due") continue;
    const h = hits[c.id] || (hits[c.id] = { label: c.label, red: 0, amber: 0 });
    if (c.state === "fail") h.red++; else h.amber++;
  }
  const hitOpts = `<option value="">All checks</option>` + Object.keys(hits)
    .sort((a, b) => (hits[b].red - hits[a].red) || (hits[b].amber - hits[a].amber) || hits[a].label.localeCompare(hits[b].label))
    .map((id) => {
      const h = hits[id];
      const n = [h.red ? `${h.red} red` : "", h.amber ? `${h.amber} amber` : ""].filter(Boolean).join(", ");
      return `<option value="${esc(id)}"${CopUi.hit === id ? " selected" : ""}>${esc(h.label)} — ${n}</option>`;
    }).join("");
  if (CopUi.hit && !hits[CopUi.hit]) CopUi.hit = "";
  const rddOpts = [[0, "Any RDD"], [7, "RDD ≤ 7 days"], [14, "RDD ≤ 14 days"], [30, "RDD ≤ 30 days"]]
    .map(([v, t]) => `<option value="${v}"${CopUi.rddDays === v ? " selected" : ""}>${t}</option>`).join("");
  body.appendChild(el(`
    <div class="cop-controls">
      <div class="field"><label>View</label><div class="cop-seg" id="copView">
        <button type="button" data-v="active" class="${CopUi.view === "active" ? "active" : ""}">Active</button>
        <button type="button" data-v="closed" class="${CopUi.view === "closed" ? "active" : ""}">Closed</button></div></div>
      <div class="field"><label>Shipments</label><div class="cop-seg" id="copScope">
        <button type="button" data-v="mine" class="${scope === "mine" ? "active" : ""}">My shipments</button>
        <button type="button" data-v="all" class="${scope === "all" ? "active" : ""}">All</button></div></div>
      ${scope === "mine"
        ? `<div class="field"><label>You are</label><select id="copMe">${meOpts}</select></div>`
        : `<div class="field"><label>TTI POC</label><select id="copPoc">${pocOpts(CopUi.poc)}</select></div>`}
      <div class="field"><label>Find metric hits</label><select id="copHit" style="max-width:320px">${hitOpts}</select></div>
      <div class="field"><label>RDD</label><select id="copRdd">${rddOpts}</select></div>
      <div class="field"><label>Search</label><input type="search" id="copQ" placeholder="WMTR, title, country" value="${esc(CopUi.q)}"></div>
      <label class="cop-check"><input type="checkbox" id="copRisk"${CopUi.atRisk ? " checked" : ""}> At-risk only</label>
      <label class="cop-check"><input type="checkbox" id="copStuck"${CopUi.stuckOnly ? " checked" : ""}> Stuck only</label>
    </div>`));

  if (scope === "mine" && !prefs.me) {
    body.appendChild(el(`<div class="statusline" style="margin-bottom:10px">Pick your name under <strong>You are</strong> to see your shipments. It's remembered in this browser.</div>`));
  }

  /* ---- pipeline strip (active view) ---- */
  if (CopUi.view === "active") {
    const strip = el(`<div class="cop-strip" role="list"></div>`);
    COP_LANES.forEach((ln, i) => {
      const inLane = base.filter((r) => r.lane === ln.id);
      const red = inLane.filter((r) => r.counts.red).length;
      const amb = inLane.filter((r) => !r.counts.red && r.counts.amber).length;
      const dots = inLane.slice().sort((a, b) => b.counts.red - a.counts.red || b.counts.amber - a.counts.amber)
        .map((r) => `<span class="cop-dot ${r.counts.red ? "bad" : r.counts.amber ? "warn" : ""}" data-w="${esc(r.wmtr)}" title="${esc(r.last5 + " · " + (r.poc || "no POC"))}"></span>`).join("");
      if (i) strip.appendChild(el(`<div class="cop-arrow" aria-hidden="true">›</div>`));
      const box = el(`
        <div class="cop-lane ${CopUi.lane === ln.id ? "sel" : ""} ${CopUi.lane && CopUi.lane !== ln.id ? "dim" : ""}" role="listitem" tabindex="0" data-lane="${ln.id}"
             title="${esc(ln.label)} — click to show only this step">
          <div class="ln">${esc(ln.label)}</div>
          <div class="n">${inLane.length}</div>
          <div class="rc">${red ? `<span class="cop-pill bad">${red} red</span>` : ""}${amb ? `<span class="cop-pill warn">${amb} amber</span>` : ""}</div>
          <div class="dots">${dots}</div>
        </div>`);
      strip.appendChild(box);
    });
    const unplaced = base.filter((r) => !r.lane).length;
    body.appendChild(strip);
    if (unplaced) body.appendChild(el(`<div class="statusline err" style="margin:-6px 0 10px">${copPlural(unplaced, "shipment")} with a status the COP doesn't recognise — listed in the table with a flag.</div>`));

    /* ---- per-POC rollup (manager view) ---- */
    if (scope === "all" && !CopUi.poc) {
      const byPoc = {};
      for (const r of base) (byPoc[r.poc || "(no POC)"] = byPoc[r.poc || "(no POC)"] || []).push(r);
      const names = Object.keys(byPoc).sort((a, b) => a.localeCompare(b));
      const head = COP_LANES.map((l) => `<th>${esc(l.short)}</th>`).join("");
      const body2 = names.map((nm) => {
        const list = byPoc[nm];
        const cells = COP_LANES.map((l) => {
          const xs = list.filter((r) => r.lane === l.id);
          if (!xs.length) return `<td></td>`;
          const red = xs.filter((r) => r.counts.red).length, amb = xs.filter((r) => !r.counts.red && r.counts.amber).length;
          return `<td class="c ${red ? "hasred" : amb ? "hasamber" : ""}" data-poc="${esc(nm)}" data-lane="${l.id}" title="${esc(nm)} · ${esc(l.label)}">${xs.length}${red ? ` <span class="red">(${red})</span>` : ""}</td>`;
        }).join("");
        const red = list.filter((r) => r.counts.red).length;
        return `<tr><td class="poc">${esc(nm)}</td>${cells}<td class="c" data-poc="${esc(nm)}" data-lane="">${list.length}${red ? ` <span class="red">(${red})</span>` : ""}</td></tr>`;
      }).join("");
      body.appendChild(el(`<div class="cop-roll"><div class="xt-count" style="margin-bottom:4px;font-family:var(--mono);font-size:11px;color:var(--steel)">By TTI POC — shipments per step, (red) = with a missed item. Click a cell to filter.</div>
        <div style="overflow-x:auto"><table><thead><tr><th>TTI POC</th>${head}<th>Total</th></tr></thead><tbody>${body2}</tbody></table></div></div>`));
    }
  }

  /* ---- settings (stuck limits) ---- */
  const stuckRows = Object.keys(COP_STUCK_DEFAULTS).map((k) => `
    <tr><td>${esc(COP_STUCK_LABELS[k])}</td>
      <td>amber <input type="number" min="1" max="200" data-k="${k}" data-i="0" value="${prefs.stuck[k][0]}"></td>
      <td>red <input type="number" min="1" max="200" data-k="${k}" data-i="1" value="${prefs.stuck[k][1]}"></td></tr>`).join("");
  body.appendChild(el(`
    <div class="btnrow" style="margin:0 0 10px">
      <button class="btn ghost" id="copCopy" type="button">Copy as text</button>
      <button class="btn ghost" id="copExport" type="button">Export (.xlsx)</button>
      <button class="btn ghost" id="copPrint" type="button">Print / PDF</button>
      <button class="btn ghost" id="copSettingsBtn" type="button">${CopUi.settingsOpen ? "Hide" : "Day limits"}</button>
      ${CopUi.lane || CopUi.poc || CopUi.atRisk || CopUi.stuckOnly || CopUi.rddDays || CopUi.q || CopUi.hit ? `<button class="btn ghost" id="copClear" type="button">Clear filters</button>` : ""}
      <span class="statusline" id="copMsg">${esc(CopUi.msg)}</span>
    </div>`));
  if (CopUi.settingsOpen) {
    body.appendChild(el(`<div class="cop-settings">
      <div class="note" style="margin-bottom:6px">Business days a shipment can sit in each step before it turns amber / red. Saved in this browser (and in Settings › Backup).</div>
      <table>${stuckRows}</table>
      <div class="btnrow" style="margin-top:8px"><button class="btn ghost" id="copStuckReset" type="button">Reset to defaults</button></div></div>`));
  }

  /* ---- table ---- */
  const wrap = el(`<div class="cop-wrap"></div>`);
  if (!rows.length) {
    wrap.appendChild(el(`<div class="cop-empty">${base.length ? "No shipments match these filters." : (CopUi.view === "closed" ? "No closed shipments in this UDQ." : "No active shipments here.")}</div>`));
  } else {
    const showPoc = !(scope === "mine" && prefs.me);
    const table = el(`<table class="cop-t"><thead><tr>
      <th>Flags</th><th>WMTR</th><th>Step / ATLAS status</th><th>Progress</th><th>Latest daily update</th>
      ${showPoc ? "<th>TTI POC</th>" : ""}<th>RDD</th><th>Days in step</th><th>Destination / mode</th><th>Program / title</th>
    </tr></thead><tbody></tbody></table>`);
    const tb = table.querySelector("tbody");
    const ncol = showPoc ? 10 : 9;
    const today = copToday();
    for (const r of rows) {
      const laneLbl = r.closed ? "Closed" : r.lane ? COP_LANES[COP_LANE_IDX[r.lane]].label : "Unplaced";
      const track = COP_LANES.map((l, i) => {
        const w = r.stageWorst[l.id];
        const sev = w === "fail" ? "bad" : (w === "warn" || w === "due") ? "warn" : "";
        if (i < r.laneIdx) return `<i class="done ${sev}" title="${esc(l.label)}${sev ? " — has open items" : " — done"}"></i>`;
        if (i === r.laneIdx) return `<i class="cur ${sev === "bad" ? "bad" : ""}" title="${esc(l.label)} — current step"></i>`;
        return `<i title="${esc(l.label)}"></i>`;
      }).join("");
      const upd = r.latest
        ? `<span class="d ${copCalDays(r.latest.date, today) > 3 && !r.closed && r.lane !== "delivered" ? "stale" : ""}">${esc(copFmt(r.latest.date))}</span><span class="t">${esc(r.latest.note)}</span>`
        : `<span class="d">—</span>`;
      const rddTxt = r.rdd ? copFmt(r.rdd) + (r.rddDays !== null && !r.closed ? `<br><span class="d" style="font-size:10.5px;color:var(--steel)">${r.rddDays < 0 ? `${-r.rddDays}d past` : `${r.rddDays}d`}</span>` : "") : "—";
      const rddCls = r.rddDays !== null && !r.closed ? (r.rddDays < 0 ? "bad" : r.rddDays <= 7 ? "warn" : "") : "";
      const dCls = r.stuck === "fail" ? "bad" : r.stuck === "warn" ? "warn" : "";
      const flags = `${r.counts.red ? `<span class="cop-pill bad">${r.counts.red}</span> ` : ""}${r.counts.amber ? `<span class="cop-pill warn">${r.counts.amber}</span>` : ""}${!r.counts.red && !r.counts.amber ? `<span class="cop-pill good">✓</span>` : ""}`;
      const tr = el(`<tr class="row ${r.counts.red ? "r-red" : r.counts.amber ? "r-amber" : ""}" data-w="${esc(r.wmtr)}" data-num="${r.num}">
        <td>${flags}</td>
        <td class="cop-w">${esc(r.last5 || r.wmtr)}${r.consol.length ? `<span class="cop-badge consol" title="Consolidated with ${esc(r.consol.join(", "))}">Consol</span>` : ""}<span class="full">${esc(r.wmtr)}</span></td>
        <td class="cop-st"><span class="lane">${esc(laneLbl)}</span>${r.problem ? `<span class="cop-badge bad">${esc(r.status)}</span>` : ""}<span class="atl">${esc(r.status || "—")}</span></td>
        <td><div class="cop-track">${track}</div></td>
        <td class="cop-upd">${upd}</td>
        ${showPoc ? `<td>${esc(r.poc || "—")}</td>` : ""}
        <td class="cop-num ${rddCls}">${rddTxt}</td>
        <td class="cop-num ${dCls}">${r.daysInLane === null || r.closed ? "—" : r.daysInLane}</td>
        <td>${esc(r.dest || "—")}<br><span style="color:var(--steel);font-size:11px">${esc(r.mode || "")}</span></td>
        <td class="cop-ttl"><span class="p">${esc(r.program)}</span><br>${esc(r.title)}</td>
      </tr>`);
      tb.appendChild(tr);
      if (CopUi.expanded.has(r.wmtr)) tb.appendChild(copDetailRow(r, ncol));
    }
    wrap.appendChild(table);
  }
  body.appendChild(wrap);
  body.appendChild(el(`<div class="note" style="margin-top:8px">Click a shipment to open its step-by-step checklist. Red = a required item was missed or a deadline passed; amber = attention / coming due. Acknowledging an item is shared with the Christmas Tree's ignore list and is saved in this browser only.</div>`));

  copWire(panel, built, rows);
}

/** The expanded checklist row for one shipment. */
function copDetailRow(r, ncol) {
  const groups = [{ id: "general", label: "Throughout" }].concat(COP_LANES.map((l, i) => ({ id: l.id, label: `${i + 1} · ${l.label}` })));
  const cards = groups.map((g) => {
    const cs = r.checks.filter((c) => c.stage === g.id);
    if (!cs.length) return "";
    const cur = g.id === r.lane && !r.closed;
    const worst = cs.reduce((w, c) => (COP_STATES[c.state].rank < COP_STATES[w].rank ? c.state : w), "ok");
    const items = cs.map((c) => {
      const s = COP_STATES[c.state];
      const btn = (c.state === "fail" || c.state === "warn" || c.state === "due")
        ? `<button class="cop-ack" type="button" data-ack="${esc(c.ackKey)}" data-req="${esc(r.reqNo)}" title="Mark as reviewed — not a miss">Acknowledge</button>`
        : c.state === "ack" ? `<button class="cop-ack" type="button" data-unack="${esc(c.ackKey)}" data-req="${esc(r.reqNo)}">Undo</button>` : "";
      return `<li class="s-${s.cls}" title="${esc(s.word)}"><span class="ic">${s.icon}</span>
        <span class="lb">${esc(c.label)}${c.level === "rec" ? `<span class="rec">recommended</span>` : ""}</span>${btn || "<span></span>"}
        <span class="dt">${esc(c.detail)}</span></li>`;
    }).join("");
    return `<div class="cop-stage ${cur ? "cur" : ""}"><h5><span>${esc(g.label)}${cur ? " — current" : ""}</span>${copChip(worst)}</h5><ul>${items}</ul></div>`;
  }).join("");
  const log = (r.daily || []).slice().sort((a, b) => b.date - a.date).slice(0, 5)
    .map((d) => `<div><span class="d">${esc(copFmt(d.date))}</span>${esc(d.note)}</div>`).join("");
  const link = r.tracklink && /^https?:\/\//i.test(r.tracklink)
    ? `<a href="${esc(r.tracklink)}" target="_blank" rel="noopener">Tracking link</a>` : esc(r.tracklink || "");
  const tr = el(`<tr class="cop-detail"><td colspan="${ncol}">
    <div class="cop-dinfo">
      <span><span class="k">WMTR</span>${esc(r.wmtr)}</span>
      <span><span class="k">TTI POC</span>${esc(r.poc || "—")}</span>
      <span><span class="k">Route</span>${esc(r.origin || "?")} → ${esc(r.dest || "?")}</span>
      <span><span class="k">Carrier / AWB</span>${esc(r.carrier || "—")} · ${esc(r.awb || "—")} ${link}</span>
      ${r.consol.length ? `<span><span class="k">Consolidated with</span>${esc(r.consol.join(", "))}</span>` : ""}
    </div>
    ${log ? `<div class="cop-dlog"><span class="k" style="font-family:var(--disp);text-transform:uppercase;letter-spacing:.6px;font-size:10px;color:var(--steel)">Recent daily updates</span>${log}</div>` : ""}
    <div class="cop-stages">${cards}</div>
  </td></tr>`);
  return tr;
}

/* ---- hover card ---- */
function copHoverEl() {
  let h = document.getElementById("copHover");
  if (!h) { h = document.createElement("div"); h.id = "copHover"; document.body.appendChild(h); }
  return h;
}
function copHoverHtml(r) {
  const open = r.checks.filter((c) => c.state === "fail" || c.state === "warn" || c.state === "due")
    .sort((a, b) => COP_STATES[a.state].rank - COP_STATES[b.state].rank);
  const items = open.slice(0, 8).map((c) => `<li class="${COP_STATES[c.state].cls}">${esc(c.label)}${c.detail ? " — " + esc(c.detail) : ""}</li>`).join("");
  return `<div class="h">${esc(r.wmtr)}</div>
    <div class="s">${esc(r.status || "—")}${r.poc ? " · " + esc(r.poc) : ""}</div>
    <div class="k">Latest daily update</div>
    <div>${r.latest ? `<strong>${esc(copFmt(r.latest.date))}</strong> — ${esc(r.latest.note)}` : "No daily updates yet."}</div>
    <div class="k">Carrier / AWB-BoL</div>
    <div>${esc(r.carrier || "—")} · ${esc(r.awb || "—")}${r.tracklink ? `<br><span style="color:var(--steel);font-size:11px">${esc(r.tracklink)}</span>` : ""}</div>
    ${open.length ? `<div class="k">Open items (${open.length})</div><ul>${items}</ul>${open.length > 8 ? `<div style="color:var(--steel)">…and ${open.length - 8} more</div>` : ""}`
                  : `<div class="k">Open items</div><div style="color:var(--cleared,#1a7f37)">Nothing open.</div>`}`;
}

function copRerender() { if (AppState.activeTool === "cop") renderWorkspace(); }

function copWire(panel, built, rows) {
  const $ = (s) => panel.querySelector(s);
  const byW = {};
  for (const r of built.rows) byW[r.wmtr] = r;

  const setMsg = (t) => { CopUi.msg = t; const m = $("#copMsg"); if (m) m.textContent = t; };

  // tracker load / clear / drop
  const fileIn = $("#copTrkFile");
  const loadTrk = async (file) => {
    try { const t = await copLoadTrackerFile(file); CopUi.msg = `Ops Tracker loaded — ${Object.keys(t.rows).length} active MTRs.`; }
    catch (e) { CopUi.msg = e.message; }
    copRerender();
  };
  $("#copTrkLoad").addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => { if (fileIn.files && fileIn.files[0]) loadTrk(fileIn.files[0]); });
  const clr = $("#copTrkClear");
  if (clr) clr.addEventListener("click", () => { copSetTracker(null); CopUi.msg = "Ops Tracker cleared."; copRerender(); });
  panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("xt-dragover"); });
  panel.addEventListener("dragleave", () => panel.classList.remove("xt-dragover"));
  panel.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation(); panel.classList.remove("xt-dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadTrk(f);
  });

  // controls
  panel.querySelectorAll("#copView button").forEach((b) => b.addEventListener("click", () => { CopUi.view = b.dataset.v; CopUi.lane = ""; copRerender(); }));
  panel.querySelectorAll("#copScope button").forEach((b) => b.addEventListener("click", () => { CopUi.scope = b.dataset.v; copRerender(); }));
  const me = $("#copMe");
  if (me) me.addEventListener("change", () => { const p = copGetPrefs(); p.me = me.value; copSetPrefs(p); copRerender(); });
  const poc = $("#copPoc");
  if (poc) poc.addEventListener("change", () => { CopUi.poc = poc.value; copRerender(); });
  $("#copRdd").addEventListener("change", (e) => { CopUi.rddDays = Number(e.target.value) || 0; copRerender(); });
  $("#copHit").addEventListener("change", (e) => { CopUi.hit = e.target.value; copRerender(); });
  $("#copRisk").addEventListener("change", (e) => { CopUi.atRisk = e.target.checked; copRerender(); });
  $("#copStuck").addEventListener("change", (e) => { CopUi.stuckOnly = e.target.checked; copRerender(); });
  const q = $("#copQ");
  let qt = null;
  q.addEventListener("input", () => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      CopUi.q = q.value; copRerender();
      const nq = document.getElementById("copQ");
      if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
    }, 250);
  });
  const clear = $("#copClear");
  if (clear) clear.addEventListener("click", () => { Object.assign(CopUi, { lane: "", poc: "", atRisk: false, stuckOnly: false, rddDays: 0, q: "", hit: "" }); copRerender(); });

  // lane strip + rollup
  panel.querySelectorAll(".cop-lane").forEach((b) => {
    const go = () => { CopUi.lane = CopUi.lane === b.dataset.lane ? "" : b.dataset.lane; copRerender(); };
    b.addEventListener("click", go);
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  panel.querySelectorAll(".cop-roll td.c").forEach((td) => td.addEventListener("click", () => {
    CopUi.poc = td.dataset.poc === "(no POC)" ? "" : td.dataset.poc;
    CopUi.lane = td.dataset.lane || "";
    copRerender();
  }));

  // buttons
  $("#copCopy").addEventListener("click", () => {
    const text = copSummaryText(built, rows);
    const done = () => setMsg("Copied to clipboard.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  $("#copExport").addEventListener("click", () => {
    try { copExportXlsx(rows); setMsg("Exported."); } catch (e) { console.error(e); setMsg("Export failed: " + e.message); }
  });
  $("#copPrint").addEventListener("click", () => copPrint(built, rows));
  $("#copSettingsBtn").addEventListener("click", () => { CopUi.settingsOpen = !CopUi.settingsOpen; copRerender(); });
  panel.querySelectorAll(".cop-settings input[type=number]").forEach((inp) => inp.addEventListener("change", () => {
    const p = copGetPrefs();
    const k = inp.dataset.k, i = Number(inp.dataset.i);
    const v = Math.max(1, Math.round(Number(inp.value) || 1));
    const pair = p.stuck[k].slice();
    pair[i] = v;
    if (pair[1] < pair[0]) pair[i === 0 ? 1 : 0] = v;
    p.stuck[k] = pair;
    copSetPrefs(p);
    copRerender();
  }));
  const rs = $("#copStuckReset");
  if (rs) rs.addEventListener("click", () => { const p = copGetPrefs(); p.stuck = Object.assign({}, COP_STUCK_DEFAULTS); copSetPrefs(p); copRerender(); });

  // rows: expand, hover card, consol highlight
  const hover = copHoverEl();
  const tbody = panel.querySelector("table.cop-t tbody");
  if (!tbody) return;
  const rowEls = Array.from(tbody.querySelectorAll("tr.row"));
  for (const tr of rowEls) {
    const r = byW[tr.dataset.w];
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a,button")) return;
      if (CopUi.expanded.has(r.wmtr)) CopUi.expanded.delete(r.wmtr); else CopUi.expanded.add(r.wmtr);
      hover.style.display = "none";
      copRerender();
    });
    tr.addEventListener("mouseenter", () => {
      hover.innerHTML = copHoverHtml(r);
      hover.style.display = "block";
      if (r.consol.length) rowEls.forEach((o) => { if (r.consol.indexOf(Number(o.dataset.num)) !== -1) o.classList.add("consol-hl"); });
    });
    tr.addEventListener("mousemove", (e) => {
      const pad = 16, w = hover.offsetWidth, h = hover.offsetHeight;
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - pad);
      if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - pad);
      hover.style.left = x + "px"; hover.style.top = y + "px";
    });
    tr.addEventListener("mouseleave", () => {
      hover.style.display = "none";
      rowEls.forEach((o) => o.classList.remove("consol-hl"));
    });
  }
  // acknowledge / undo
  tbody.querySelectorAll("button[data-ack]").forEach((b) => b.addEventListener("click", () => {
    if (typeof xtAddIgnore === "function") xtAddIgnore(b.dataset.req, b.dataset.ack);
    copRerender();
  }));
  tbody.querySelectorAll("button[data-unack]").forEach((b) => b.addEventListener("click", () => {
    if (typeof xtRemoveIgnore !== "function") return;
    const ig = xtGetIgnores()[b.dataset.req] || [];
    if (ig.indexOf(b.dataset.unack) !== -1) xtRemoveIgnore(b.dataset.req, b.dataset.unack);
    else alert("This item is covered by a broader acknowledgement made in the Christmas Tree (e.g. all metrics, or all shipping documents). Undo it there, in the Ignored list.");
    copRerender();
  }));
}

/* -------------------------------------------------------------------------
   OUTPUTS — copy as text, Excel export, print snapshot
   ------------------------------------------------------------------------- */
function copScopeLabel() {
  const me = copGetPrefs().me;
  if (copScope() === "mine" && me) return `${me}'s shipments`;
  return CopUi.poc ? `${CopUi.poc}'s shipments` : "All shipments";
}
function copSummaryText(built, rows) {
  const { base } = copFilterRows(built.rows);
  const lines = [`ATLAS COP — ${copFmt(copToday())} · ${copScopeLabel()} · ${CopUi.view === "closed" ? "closed" : "active"}: ${base.length}`];
  if (CopUi.view === "active") {
    lines.push(COP_LANES.map((l) => {
      const xs = base.filter((r) => r.lane === l.id);
      const red = xs.filter((r) => r.counts.red).length;
      return `${l.short} ${xs.length}${red ? ` (${red} red)` : ""}`;
    }).join(" · "));
  }
  const reds = rows.filter((r) => r.counts.red);
  if (reds.length) {
    lines.push("", `Missed items (${reds.length} shipment${reds.length === 1 ? "" : "s"}):`);
    for (const r of reds) {
      const items = r.checks.filter((c) => c.state === "fail").map((c) => c.label).join("; ");
      lines.push(`- ${r.last5 || r.wmtr} (${r.poc || "no POC"}, ${r.closed ? "Closed" : r.lane ? COP_LANES[COP_LANE_IDX[r.lane]].short : "?"}): ${items}`);
    }
  } else lines.push("", "No missed items.");
  return lines.join("\n");
}
function copExportXlsx(rows) {
  const top = [["WMTR", "TTI POC", "Step", "ATLAS Status", "Red", "Amber", "Days in step", "RDD", "Delivered",
    "Origin", "Destination", "Mode", "Program", "Title", "Latest update date", "Latest update", "Carrier", "AWB/BoL"]];
  const det = [["WMTR", "TTI POC", "Step", "Checklist stage", "Check", "Required / recommended", "Result", "Detail"]];
  for (const r of rows) {
    const step = r.closed ? "Closed" : r.lane ? COP_LANES[COP_LANE_IDX[r.lane]].label : "Unplaced";
    top.push([r.wmtr, r.poc, step, r.status, r.counts.red, r.counts.amber, r.closed ? "" : (r.daysInLane ?? ""),
      copFmt(r.rdd), copFmt(r.delivered), r.origin, r.dest, r.mode, r.program, r.title,
      r.latest ? copFmt(r.latest.date) : "", r.latest ? r.latest.note : "", r.carrier, r.awb]);
    for (const c of r.checks) {
      const stg = c.stage === "general" ? "Throughout" : COP_LANES[COP_LANE_IDX[c.stage]].label;
      det.push([r.wmtr, r.poc, step, stg, c.label, c.level === "rec" ? "Recommended" : "Required", COP_STATES[c.state].word, c.detail]);
    }
  }
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(top);
  ws1["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 20 }, { wch: 24 }, { wch: 5 }, { wch: 6 }, { wch: 8 }, { wch: 11 }, { wch: 11 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 40 }, { wch: 11 }, { wch: 60 }, { wch: 18 }, { wch: 18 }];
  const ws2 = XLSX.utils.aoa_to_sheet(det);
  ws2["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 48 }, { wch: 13 }, { wch: 13 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws1, "COP");
  XLSX.utils.book_append_sheet(wb, ws2, "Checklist");
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  pmrDownloadXlsxB64(b64, `COP_${CopUi.view === "closed" ? "Closed" : "Active"}_${fileStamp()}.xlsx`);
}
function copPrint(built, rows) {
  const { base } = copFilterRows(built.rows);
  const lanes = CopUi.view === "active" ? COP_LANES.map((l) => {
    const xs = base.filter((r) => r.lane === l.id);
    const red = xs.filter((r) => r.counts.red).length;
    return `<td><div class="l">${esc(l.label)}</div><div class="n">${xs.length}</div>${red ? `<div class="r">${red} red</div>` : ""}</td>`;
  }).join("") : "";
  const trs = rows.map((r) => {
    const fails = r.checks.filter((c) => c.state === "fail").map((c) => esc(c.label)).join("; ");
    const warns = r.checks.filter((c) => c.state === "warn" || c.state === "due").map((c) => esc(c.label)).join("; ");
    return `<tr><td class="m">${esc(r.last5 || r.wmtr)}</td><td>${esc(r.poc)}</td>
      <td>${esc(r.closed ? "Closed" : r.lane ? COP_LANES[COP_LANE_IDX[r.lane]].label : "?")}<br><small>${esc(r.status)}</small></td>
      <td class="m">${esc(copFmt(r.rdd))}</td><td>${r.latest ? `<small>${esc(copFmt(r.latest.date))}</small> ${esc(r.latest.note)}` : ""}</td>
      <td class="red">${fails}</td><td class="amb">${warns}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ATLAS COP ${esc(copFmt(copToday()))}</title><style>
    @page{size:landscape;margin:10mm}body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#16283C;margin:0}
    h1{font-size:15px;margin:0 0 2px}.sub{color:#5B6B7C;margin-bottom:8px}
    table.lanes{border-collapse:collapse;width:100%;margin-bottom:10px}table.lanes td{border:1px solid #D4DAE0;text-align:center;padding:4px}
    .l{font-size:9px;text-transform:uppercase;color:#5B6B7C}.n{font-size:16px;font-weight:bold}.r{color:#B00000;font-weight:bold}
    table.t{border-collapse:collapse;width:100%}table.t th,table.t td{border:1px solid #D4DAE0;padding:3px 4px;vertical-align:top;text-align:left}
    table.t th{background:#E9EEF3;font-size:9px;text-transform:uppercase}.m{font-family:Consolas,monospace;white-space:nowrap}
    td.red{color:#B00000}td.amb{color:#8A5A00}small{color:#5B6B7C}
  </style></head><body>
    <h1>ATLAS COP — Common Operational Picture</h1>
    <div class="sub">${esc(copFmt(copToday()))} · ${esc(copScopeLabel())} · ${CopUi.view === "closed" ? "closed" : "active"} · ${rows.length} shown</div>
    ${lanes ? `<table class="lanes"><tr>${lanes}</tr></table>` : ""}
    <table class="t"><thead><tr><th>WMTR</th><th>TTI POC</th><th>Step</th><th>RDD</th><th>Latest daily update</th><th>Missed (red)</th><th>Attention (amber)</th></tr></thead>
    <tbody>${trs}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Your browser blocked the print window. Allow pop-ups for this site and try again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* Node test support */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { copParseGrid, copEvaluate, copLaneInfo, copParseTrackerWorkbook, copDailyGaps, COP_LANES };
}
